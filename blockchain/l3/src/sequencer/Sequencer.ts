/**
 * The KAURAX sequencer.
 *
 *   user tx -> KAURAX RPC -> mempool -> [ordering] -> execution engine -> L3 block
 *   L2 deposit -----------------------^ (ahead of every user transaction)
 *
 * v0 runs a SINGLE sequencer. It decides inclusion and order, and nothing forces it to be
 * fair. The mitigations that exist today are: deposits bypass it entirely, and all data is
 * published to the L2 so its behaviour is auditable after the fact. Decentralised
 * sequencing is not implemented — see docs/decentralization.md.
 */
import type {KauraxConfig} from "@kaurax/config";
import type {ExecutionEngine, Hex, L3Block} from "../engine/types.js";
import type {BatchBlock} from "../batcher/encoding.js";
import type {BlockPayloadSource} from "../batcher/Batcher.js";
import {Mempool, type PooledTx} from "./mempool.js";
import {BlockWal} from "./wal.js";
import type {Derivation} from "../derivation/Derivation.js";
import {createLogger} from "../log.js";

export interface SequencerStatus {
  running: boolean;
  mode: "single";
  decentralized: false;
  address: Hex | null;
  headBlock: bigint;
  blockTimeSeconds: number;
  mempoolSize: number;
  producedBlocks: number;
  includedTransactions: number;
  appliedDeposits: number;
  lastBlockAt: number | null;
  lastError: string | null;
  /** Blocks sealed but not yet confirmed on the L2 — the data-loss window, now durable. */
  walPendingBlocks: number;
}

export class Sequencer implements BlockPayloadSource {
  private readonly log = createLogger("sequencer");
  private readonly mempool: Mempool;

  /**
   * Durable record of the raw transactions the sequencer placed in each block. The batcher
   * reads from here so batches carry exactly what was sequenced.
   *
   * This is a write-ahead log on disk, not a memory cache: between sealing a block and the
   * batcher publishing it, this is the only copy of those transactions anywhere. Losing it
   * would lose them permanently.
   */
  private readonly wal: BlockWal;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private producing = false;

  private producedBlocks = 0;
  private includedTransactions = 0;
  private appliedDeposits = 0;
  private lastBlockAt: number | null = null;
  private lastError: string | null = null;
  private head = 0n;

  constructor(
    private readonly cfg: KauraxConfig,
    private readonly engine: ExecutionEngine,
    private readonly derivation: Derivation,
    /** Read lazily: with a remote signer the address is only known after connecting. */
    private readonly sequencerAddress: () => Hex | null,
  ) {
    this.mempool = new Mempool(cfg.l3.chainId);
    this.wal = new BlockWal(cfg.walPath);
  }

  get pool(): Mempool {
    return this.mempool;
  }

  /** Entry point for eth_sendRawTransaction. */
  async submitTransaction(raw: Hex): Promise<Hex> {
    return this.mempool.add(raw);
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Replay anything a previous run sealed but never got batched.
    const recovered = this.wal.open();
    if (recovered.recovered > 0) {
      this.log.warn("recovered unbatched blocks from a previous run", {
        blocks: recovered.recovered,
        range: `${recovered.from}-${recovered.to}`,
      });
    }

    this.head = await this.engine.getBlockNumber();
    this.running = true;

    this.timer = setInterval(() => {
      void this.produce();
    }, this.cfg.l3.blockTimeSeconds * 1000);

    this.log.info("sequencer started", {
      mode: "single",
      blockTimeSeconds: this.cfg.l3.blockTimeSeconds,
      gasLimit: this.cfg.l3.gasLimit,
      head: this.head.toString(),
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.wal.close();
  }

  /** Build and seal one L3 block. */
  async produce(): Promise<L3Block | null> {
    if (this.producing) return null;
    this.producing = true;

    try {
      // 1. Deposits first, in L2 order. These are not optional.
      const deposits = this.derivation.drain();
      for (const deposit of deposits) {
        try {
          await this.engine.applyDeposit(deposit);
          this.appliedDeposits++;
        } catch (err) {
          // A failing deposit must not stall the chain, but losing it silently would break
          // the bridge's accounting, so it is surfaced loudly.
          this.log.error("deposit could not be applied", {
            l2Tx: deposit.l2TxHash,
            error: (err as Error).message,
          });
        }
      }

      // 2. User transactions, in the sequencer's chosen order.
      const selected = await this.mempool.selectForBlock(
        (sender) => this.nonceOf(sender),
        BigInt(this.cfg.l3.gasLimit),
      );

      const accepted: PooledTx[] = [];
      for (const tx of selected) {
        try {
          await this.engine.submitTransaction(tx.raw);
          accepted.push(tx);
        } catch (err) {
          this.log.warn("transaction rejected by the execution engine", {
            hash: tx.hash,
            error: (err as Error).message,
          });
          // Drop it rather than retry forever: it will never become valid.
          this.mempool.markIncluded([tx]);
        }
      }

      const block = await this.engine.produceBlock();

      // Durable before anything else observes the block: a crash immediately after sealing
      // must still leave these transactions recoverable.
      this.recordPayload(block, accepted);

      // Only now is it safe to promise never to re-scan those L2 blocks: the deposits are
      // in a sealed block and that block is durable. Advancing earlier would lose a deposit
      // on a crash; advancing later would re-apply one.
      this.derivation.markSealed(deposits);

      this.head = block.number;
      this.producedBlocks++;
      this.includedTransactions += accepted.length;
      this.lastBlockAt = Date.now();
      this.lastError = null;

      this.mempool.markIncluded(accepted);

      if (accepted.length > 0 || deposits.length > 0) {
        this.log.info("L3 block produced", {
          number: block.number.toString(),
          hash: block.hash,
          txs: block.transactions.length,
          deposits: deposits.length,
          gasUsed: block.gasUsed.toString(),
        });
      } else {
        this.log.debug("L3 block produced (empty)", {number: block.number.toString()});
      }

      return block;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error("block production failed", {error: this.lastError});
      return null;
    } finally {
      this.producing = false;
    }
  }

  private recordPayload(block: L3Block, accepted: PooledTx[]): void {
    this.wal.append({
      number: block.number,
      timestamp: block.timestamp,
      transactions: accepted.map((t) => t.raw),
    });
  }

  async getBlockPayload(blockNumber: bigint): Promise<BatchBlock | null> {
    return this.wal.get(blockNumber);
  }

  /**
   * Drop write-ahead entries the L2 has confirmed. Called by the batcher only after a
   * batch transaction is mined — until then this log is the only copy.
   */
  pruneWal(throughBlock: bigint): void {
    this.wal.prune(throughBlock);
  }

  walStatus(): ReturnType<BlockWal["status"]> {
    return this.wal.status();
  }

  private async nonceOf(sender: Hex): Promise<bigint> {
    const hex = await this.engine.request<Hex>("eth_getTransactionCount", [sender, "pending"]);
    return BigInt(hex);
  }

  status(): SequencerStatus {
    return {
      running: this.running,
      mode: "single",
      decentralized: false,
      address: this.sequencerAddress(),
      headBlock: this.head,
      blockTimeSeconds: this.cfg.l3.blockTimeSeconds,
      mempoolSize: this.mempool.size,
      producedBlocks: this.producedBlocks,
      includedTransactions: this.includedTransactions,
      appliedDeposits: this.appliedDeposits,
      lastBlockAt: this.lastBlockAt,
      lastError: this.lastError,
      walPendingBlocks: this.wal.status().pendingBlocks,
    };
  }
}
