/**
 * Deposit derivation: underlying L2 -> KAURAX L3.
 *
 * `KauraxPortal.depositTransaction` on the L2 emits `TransactionDeposited`. This component
 * watches for those events and turns each one into an L3 transaction that the sequencer
 * must include. Because the source of truth is an L2 event rather than the KAURAX mempool,
 * the sequencer cannot censor a deposit without also censoring the L2 — which is the
 * property that makes this the forced-inclusion escape hatch.
 *
 * Deposits are processed in (L2 block, log index) order and each is applied exactly once.
 */
import {parseAbiItem, type Log} from "viem";
import type {KauraxConfig} from "@kaurax/config";
import type {DepositIntent, Hex} from "../engine/types.js";
import type {L2SettlementAdapter} from "../settlement/L2SettlementAdapter.js";
import {createLogger} from "../log.js";
import {DerivationCheckpoint} from "./checkpoint.js";

const DEPOSIT_EVENT = parseAbiItem(
  "event TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes opaqueData)",
);

export class Derivation {
  private readonly log = createLogger("derivation");
  private readonly queue: DepositIntent[] = [];
  private readonly seen = new Set<string>();
  /** L2 transactions whose deposits have been passed to the sequencer. */
  private readonly applied = new Set<string>();

  private readonly checkpoint: DerivationCheckpoint;
  /** Next L2 block to scan. */
  private cursor = 0n;
  /** Highest L2 block whose deposits are sealed into an L3 block. */
  private sealedThrough: bigint | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;
  private lastError: string | null = null;
  private derivedCount = 0;

  constructor(
    private readonly cfg: KauraxConfig,
    private readonly settlement: L2SettlementAdapter,
  ) {
    this.checkpoint = new DerivationCheckpoint(cfg.derivationCheckpointPath);
  }

  /**
   * Decide where to resume scanning the L2.
   *
   * Order of preference, and the reasoning behind it:
   *
   *  1. An explicit override. The operator knows something we do not.
   *  2. The durable checkpoint. This is the normal path; it is exactly the block after the
   *     last one whose deposits were sealed.
   *  3. Nothing stored. Only safe for a genuinely fresh node. If the portal already holds
   *     unacknowledged forced transactions, starting from head would silently discard a
   *     user's funds and defeat forced inclusion — so this refuses to start instead of
   *     choosing between losing a deposit and minting one twice.
   */
  async init(fromL2Block?: bigint): Promise<void> {
    const head = await this.settlement.publicClient.getBlockNumber();

    if (fromL2Block !== undefined) {
      this.cursor = fromL2Block;
      this.checkpoint.save(this.cursor);
      this.log.warn("derivation starting from an explicit block", {fromL2Block: this.cursor.toString()});
      return;
    }

    const stored = this.checkpoint.load();
    if (stored !== null) {
      // Resume where we left off, never ahead of it. If the L2 is behind the checkpoint the
      // node is pointed at a different or reset chain, which must not be papered over.
      if (stored > head + 1n) {
        throw new Error(
          `Derivation checkpoint says L2 block ${stored}, but the L2 head is only ${head}. ` +
            `This node is pointed at a different or reset L2. Refusing to start.`,
        );
      }
      this.cursor = stored;
      this.log.info("derivation resumed from checkpoint", {
        portal: this.cfg.contracts.portal ?? "(not configured)",
        fromL2Block: this.cursor.toString(),
        l2Head: head.toString(),
        blocksToCatchUp: (head >= stored ? head - stored : 0n).toString(),
      });
      return;
    }

    const outstanding = await this.outstandingForcedSubmission();
    if (outstanding !== null) {
      throw new Error(
        `No derivation checkpoint exists, but the portal holds an unacknowledged forced ` +
          `transaction submitted at L2 block ${outstanding}. Starting from the current head ` +
          `would silently drop it; rewinding blindly could apply earlier deposits twice. ` +
          `Set KAURAX_DERIVATION_FROM_L2_BLOCK=${outstanding} if this node has applied ` +
          `nothing since, or to the correct resume point otherwise. See docs/bridge.md.`,
      );
    }

    this.cursor = head;
    this.checkpoint.save(this.cursor);
    this.log.info("derivation initialised (fresh node, no checkpoint)", {
      portal: this.cfg.contracts.portal ?? "(not configured)",
      fromL2Block: this.cursor.toString(),
    });
  }

  /**
   * The L2 block at which the oldest unacknowledged forced transaction was submitted, or
   * null when the portal has none. Read from the portal rather than from local state,
   * because local state is exactly what is missing when this is consulted.
   */
  private async outstandingForcedSubmission(): Promise<bigint | null> {
    const portal = this.cfg.contracts.portal;
    if (!portal) return null;
    try {
      const state = await this.settlement.forcedInclusionState();
      if (state === null || state.pending === 0n) return null;
      return this.settlement.oldestPendingForcedSubmission();
    } catch (err) {
      this.log.warn("could not read forced-inclusion state while initialising", {
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Called by the sequencer once a block containing these deposits is durably recorded.
   * Only then is it safe to promise never to scan those L2 blocks again.
   */
  markSealed(deposits: readonly DepositIntent[]): void {
    if (deposits.length === 0) return;
    let highest = 0n;
    for (const d of deposits) if (d.l2BlockNumber > highest) highest = d.l2BlockNumber;
    if (this.sealedThrough !== null && highest <= this.sealedThrough) return;
    this.sealedThrough = highest;
    this.checkpoint.save(highest + 1n);
  }

  /** Where a restart would resume from right now. Surfaced in status output. */
  checkpointBlock(): bigint | null {
    return this.checkpoint.current;
  }

  start(): void {
    if (this.running) return;
    if (!this.cfg.contracts.portal) {
      this.log.warn("no portal address configured; deposits will not be derived");
      return;
    }
    this.running = true;
    // Poll at roughly the L2 block rate: deposits cannot arrive faster than that.
    const period = Math.max(500, this.cfg.l2.blockTimeSeconds * 500);
    this.timer = setInterval(() => {
      void this.poll();
    }, period);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan();
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error("deposit scan failed", {error: this.lastError});
    } finally {
      this.busy = false;
    }
  }

  private async scan(): Promise<void> {
    const portal = this.cfg.contracts.portal;
    if (!portal) return;

    const head = await this.settlement.publicClient.getBlockNumber();
    if (head < this.cursor) return; // L2 reorged backwards; wait for it to catch up.

    const logs = await this.settlement.publicClient.getLogs({
      address: portal,
      event: DEPOSIT_EVENT,
      fromBlock: this.cursor,
      toBlock: head,
    });

    for (const entry of logs) {
      const intent = this.decode(entry);
      if (!intent) continue;
      const key = `${intent.l2TxHash}:${intent.l2LogIndex}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.queue.push(intent);
      this.derivedCount++;
      this.log.info("deposit derived from L2", {
        from: intent.from,
        to: intent.to ?? "(create)",
        mint: intent.mint.toString(),
        l2Block: intent.l2BlockNumber.toString(),
        l2Tx: intent.l2TxHash,
      });
    }

    // In-memory only. The durable checkpoint advances in markSealed(), once the deposits
    // are actually in a block — scanning is not inclusion.
    this.cursor = head + 1n;
  }

  /**
   * `opaqueData` is `abi.encodePacked(msg.value, _value, _gasLimit, _isCreation, _data)`:
   *   32 bytes  mint  (value escrowed on the L2)
   *   32 bytes  value (value the L3 transaction carries)
   *    8 bytes  gasLimit
   *    1 byte   isCreation
   *    n bytes  calldata
   */
  private decode(entry: Log<bigint, number, false, typeof DEPOSIT_EVENT>): DepositIntent | null {
    const args = entry.args as {from?: Hex; to?: Hex; opaqueData?: Hex};
    if (!args.from || !args.to || !args.opaqueData) return null;

    const hex = args.opaqueData.slice(2);
    const MIN_CHARS = (32 + 32 + 8 + 1) * 2;
    if (hex.length < MIN_CHARS) {
      this.log.warn("malformed deposit opaqueData; skipping", {l2Tx: entry.transactionHash});
      return null;
    }

    const mint = BigInt(`0x${hex.slice(0, 64)}`);
    const value = BigInt(`0x${hex.slice(64, 128)}`);
    const gasLimit = BigInt(`0x${hex.slice(128, 144)}`);
    const isCreation = hex.slice(144, 146) !== "00";
    const data = (`0x${hex.slice(146)}` || "0x") as Hex;

    return {
      from: args.from.toLowerCase() as Hex,
      to: isCreation ? null : (args.to.toLowerCase() as Hex),
      mint,
      value,
      gasLimit,
      data,
      l2TxHash: entry.transactionHash as Hex,
      l2LogIndex: entry.logIndex ?? 0,
      l2BlockNumber: entry.blockNumber ?? 0n,
    };
  }

  /** Take every deposit awaiting inclusion. The sequencer applies these before user txs. */
  drain(): DepositIntent[] {
    const taken = this.queue.splice(0, this.queue.length);
    for (const d of taken) this.applied.add(d.l2TxHash.toLowerCase());
    return taken;
  }

  /**
   * L2 transaction hashes whose deposits have been handed to the sequencer for inclusion.
   *
   * Used by the forced-inclusion watcher: a forced transaction may only be acknowledged on
   * the L2 once its deposit has actually been applied here. Acknowledging anything else
   * would be a false claim to the mechanism that exists to protect users from exactly that.
   */
  appliedL2Transactions(): ReadonlySet<string> {
    return this.applied;
  }

  status(): {
    running: boolean;
    l2Cursor: bigint;
    queued: number;
    derivedTotal: number;
    lastError: string | null;
  } {
    return {
      running: this.running,
      l2Cursor: this.cursor,
      queued: this.queue.length,
      derivedTotal: this.derivedCount,
      lastError: this.lastError,
    };
  }
}
