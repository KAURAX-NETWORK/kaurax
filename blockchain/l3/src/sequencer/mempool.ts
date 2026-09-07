/**
 * The KAURAX mempool and ordering policy.
 *
 * This is where KAURAX actually sequences: transactions are accepted here, held, ordered,
 * and only then handed to the execution engine. The engine never chooses inclusion order.
 *
 * Ordering policy (v0), applied per block:
 *   1. Deposits derived from the L2 come first, in L2 log order. They are not in this
 *      pool — they bypass it entirely and cannot be dropped by the sequencer.
 *   2. For each sender, transactions are ordered by ascending nonce. A nonce gap stops
 *      that sender's queue for the block; the rest stay queued.
 *   3. Between senders, the ready transaction with the higher effective priority fee goes
 *      first, ties broken by arrival time.
 *
 * This is a single-sequencer policy with no anti-MEV guarantees. See docs/sequencer.md.
 */
import {parseTransaction, recoverTransactionAddress, keccak256} from "viem";
import type {Hex} from "../engine/types.js";
import {createLogger} from "../log.js";

export interface PooledTx {
  hash: Hex;
  raw: Hex;
  sender: Hex;
  nonce: bigint;
  /** maxPriorityFeePerGas for 1559 txs; gasPrice for legacy. */
  priorityFee: bigint;
  gasLimit: bigint;
  receivedAt: number;
}

export class MempoolError extends Error {
  constructor(
    message: string,
    public readonly code = -32000,
  ) {
    super(message);
    this.name = "MempoolError";
  }
}

export class Mempool {
  private readonly bySender = new Map<Hex, PooledTx[]>();
  private readonly byHash = new Map<Hex, PooledTx>();
  private readonly log = createLogger("mempool");

  constructor(
    private readonly chainId: number,
    private readonly maxSize = 20_000,
    private readonly maxPerSender = 64,
  ) {}

  get size(): number {
    return this.byHash.size;
  }

  has(hash: Hex): boolean {
    return this.byHash.has(hash);
  }

  pending(): PooledTx[] {
    return [...this.byHash.values()];
  }

  /** Validate, decode and queue a raw transaction. Returns its hash. */
  async add(raw: Hex): Promise<Hex> {
    if (this.byHash.size >= this.maxSize) {
      throw new MempoolError("KAURAX mempool is full", -32005);
    }

    const hash = keccak256(raw);
    if (this.byHash.has(hash)) return hash;

    let parsed: ReturnType<typeof parseTransaction>;
    try {
      parsed = parseTransaction(raw);
    } catch (err) {
      throw new MempoolError(`could not decode transaction: ${(err as Error).message}`, -32602);
    }

    // Replay protection: a transaction signed for another chain must never execute here.
    if (parsed.chainId !== undefined && parsed.chainId !== this.chainId) {
      throw new MempoolError(
        `wrong chain id: transaction is for ${parsed.chainId}, KAURAX is ${this.chainId}`,
        -32000,
      );
    }
    if (parsed.chainId === undefined) {
      throw new MempoolError("unprotected (pre-EIP-155) transactions are not accepted", -32000);
    }

    let sender: Hex;
    try {
      sender = (await recoverTransactionAddress({serializedTransaction: raw as never})).toLowerCase() as Hex;
    } catch (err) {
      throw new MempoolError(`invalid signature: ${(err as Error).message}`, -32000);
    }

    const priorityFee =
      parsed.maxPriorityFeePerGas ?? (parsed as {gasPrice?: bigint}).gasPrice ?? 0n;

    const tx: PooledTx = {
      hash,
      raw,
      sender,
      nonce: BigInt(parsed.nonce ?? 0),
      priorityFee,
      gasLimit: parsed.gas ?? 0n,
      receivedAt: Date.now(),
    };

    const queue = this.bySender.get(sender) ?? [];

    // Same-nonce replacement, in the style every client implements: a resubmission must
    // pay strictly more to displace the one already queued.
    const existingIndex = queue.findIndex((q) => q.nonce === tx.nonce);
    if (existingIndex >= 0) {
      const existing = queue[existingIndex]!;
      if (tx.priorityFee <= existing.priorityFee) {
        throw new MempoolError("replacement transaction underpriced", -32000);
      }
      this.byHash.delete(existing.hash);
      queue[existingIndex] = tx;
    } else {
      if (queue.length >= this.maxPerSender) {
        throw new MempoolError(`too many queued transactions for ${sender}`, -32005);
      }
      queue.push(tx);
    }

    queue.sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0));
    this.bySender.set(sender, queue);
    this.byHash.set(hash, tx);

    this.log.debug("accepted", {hash, sender, nonce: tx.nonce.toString(), poolSize: this.byHash.size});
    return hash;
  }

  /**
   * Select the transactions for the next block.
   * @param nonceOf Resolves a sender's current on-chain nonce, so that a gap can be detected.
   * @param gasLimit Block gas limit to fill against.
   */
  async selectForBlock(
    nonceOf: (sender: Hex) => Promise<bigint>,
    gasLimit: bigint,
  ): Promise<PooledTx[]> {
    interface Ready {
      tx: PooledTx;
      sender: Hex;
    }

    const ready: Ready[] = [];
    const nextNonce = new Map<Hex, bigint>();

    for (const [sender, queue] of this.bySender) {
      if (queue.length === 0) continue;
      const onChain = await nonceOf(sender);
      nextNonce.set(sender, onChain);
      const head = queue[0]!;
      // Drop anything already mined or otherwise stale.
      if (head.nonce < onChain) {
        this.dropBelow(sender, onChain);
        const q = this.bySender.get(sender);
        if (!q || q.length === 0) continue;
        if (q[0]!.nonce === onChain) ready.push({tx: q[0]!, sender});
        continue;
      }
      if (head.nonce === onChain) ready.push({tx: head, sender});
      // A gap means this sender contributes nothing this block.
    }

    ready.sort((a, b) => {
      if (a.tx.priorityFee !== b.tx.priorityFee) return a.tx.priorityFee > b.tx.priorityFee ? -1 : 1;
      return a.tx.receivedAt - b.tx.receivedAt;
    });

    const selected: PooledTx[] = [];
    let gasUsed = 0n;

    // Walk senders in fee order, taking consecutive nonces from each while they fit.
    for (const {sender} of ready) {
      const queue = this.bySender.get(sender);
      if (!queue) continue;
      let expected = nextNonce.get(sender)!;

      for (const tx of [...queue]) {
        if (tx.nonce !== expected) break;
        if (gasUsed + tx.gasLimit > gasLimit) break;
        selected.push(tx);
        gasUsed += tx.gasLimit;
        expected += 1n;
      }
    }

    return selected;
  }

  /** Remove transactions that made it into a block. */
  markIncluded(txs: PooledTx[]): void {
    for (const tx of txs) {
      this.byHash.delete(tx.hash);
      const queue = this.bySender.get(tx.sender);
      if (!queue) continue;
      const next = queue.filter((q) => q.hash !== tx.hash);
      if (next.length === 0) this.bySender.delete(tx.sender);
      else this.bySender.set(tx.sender, next);
    }
  }

  private dropBelow(sender: Hex, nonce: bigint): void {
    const queue = this.bySender.get(sender);
    if (!queue) return;
    const kept: PooledTx[] = [];
    for (const tx of queue) {
      if (tx.nonce < nonce) this.byHash.delete(tx.hash);
      else kept.push(tx);
    }
    if (kept.length === 0) this.bySender.delete(sender);
    else this.bySender.set(sender, kept);
  }
}
