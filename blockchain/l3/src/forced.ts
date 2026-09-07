/**
 * Forced-transaction acknowledgement.
 *
 * `KauraxPortal.forceTransaction` gives a user a deadline the sequencer must meet, and
 * `KauraxL2OutputOracle` refuses output proposals once one is overdue. That enforcement
 * only means anything if the node actually acknowledges what it has included — otherwise a
 * correctly behaving sequencer would halt its own settlement.
 *
 * This component closes that loop: it watches for `TransactionForced`, waits until the
 * corresponding deposit has been derived and applied on KAURAX, and then acknowledges the
 * range on the L2.
 *
 * It deliberately acknowledges **only what the derivation pipeline has actually applied**.
 * Acknowledging optimistically would be a lie to the very mechanism that protects users.
 */
import {parseAbiItem} from "viem";
import type {KauraxConfig} from "@kaurax/config";
import type {ExecutionEngine, Hex} from "./engine/types.js";
import type {L2SettlementAdapter} from "./settlement/L2SettlementAdapter.js";
import type {Derivation} from "./derivation/Derivation.js";
import {portalAbi} from "./settlement/abi.js";
import {createLogger} from "./log.js";

const FORCED_EVENT = parseAbiItem(
  "event TransactionForced(uint256 indexed forcedId, address indexed from, address indexed to, uint256 value, uint64 gasLimit, bytes data, uint256 deadlineL2Block)",
);

export interface ForcedStatus {
  running: boolean;
  /** Forced transactions seen but not yet acknowledged on the L2. */
  pending: number;
  /** Highest forced id acknowledged so far, or null. */
  lastAcknowledgedId: string | null;
  /** L2 block by which the oldest unacknowledged one is due, or null. */
  oldestDeadline: string | null;
  /** L2 blocks remaining before the oldest becomes overdue. Negative once overdue. */
  blocksRemaining: number | null;
  overdue: boolean;
  lastError: string | null;
}

export class ForcedInclusion {
  private readonly log = createLogger("forced");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;

  private cursor = 0n;
  private readonly seen = new Map<string, {l2TxHash: Hex; deadline: bigint; submittedAtL2Block: bigint}>();
  private lastAcknowledgedId: bigint | null = null;
  private oldestDeadline: bigint | null = null;
  private overdue = false;
  private lastError: string | null = null;

  constructor(
    private readonly cfg: KauraxConfig,
    private readonly settlement: L2SettlementAdapter,
    private readonly derivation: Derivation,
    private readonly engine: ExecutionEngine,
  ) {}

  /**
   * Decide where to start reading `TransactionForced` events.
   *
   * Not from the current head. A forced transaction submitted while this node was down is
   * precisely the case the mechanism exists for, and the live event stream will never
   * mention it again — the node would sit there with settlement halted by the oracle,
   * unable to see why. So the starting point is reconciled against the portal's own
   * unacknowledged backlog.
   *
   * Rewinding is safe here in a way that rewinding derivation is not: this component only
   * tracks bookkeeping, and the portal itself rejects any acknowledgement below its cursor.
   */
  async init(fromL2Block?: bigint): Promise<void> {
    const head = await this.settlement.publicClient.getBlockNumber();

    if (fromL2Block !== undefined) {
      this.cursor = fromL2Block;
      return;
    }

    let oldest: bigint | null = null;
    try {
      oldest = await this.settlement.oldestPendingForcedSubmission();
    } catch (err) {
      this.log.warn("could not read the portal's forced backlog; starting from the L2 head", {
        error: (err as Error).message,
      });
    }

    if (oldest !== null) {
      this.cursor = oldest;
      this.log.warn("rewinding to an unacknowledged forced transaction", {
        fromL2Block: oldest.toString(),
        l2Head: head.toString(),
        note: "settlement stays halted until this is included and acknowledged",
      });
      return;
    }

    this.cursor = head;
  }

  start(): void {
    if (this.running) return;
    if (!this.cfg.contracts.portal) {
      this.log.warn("no portal configured; forced transactions will not be acknowledged");
      return;
    }
    this.running = true;
    const period = Math.max(1000, this.cfg.l2.blockTimeSeconds * 1000);
    this.timer = setInterval(() => void this.tick(), period);
    this.log.info("forced-inclusion watcher started", {portal: this.cfg.contracts.portal});
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan();
      await this.acknowledge();
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error("forced-inclusion pass failed", {error: this.lastError});
    } finally {
      this.busy = false;
    }
  }

  /** Record forced transactions emitted on the L2. */
  private async scan(): Promise<void> {
    const portal = this.cfg.contracts.portal;
    if (!portal) return;

    const head = await this.settlement.publicClient.getBlockNumber();
    if (head < this.cursor) return;

    const logs = await this.settlement.publicClient.getLogs({
      address: portal,
      event: FORCED_EVENT,
      fromBlock: this.cursor,
      toBlock: head,
    });

    for (const entry of logs) {
      const args = entry.args as {forcedId?: bigint; deadlineL2Block?: bigint; from?: Hex; to?: Hex};
      if (args.forcedId === undefined || args.deadlineL2Block === undefined) continue;

      const key = args.forcedId.toString();
      if (this.seen.has(key)) continue;

      this.seen.set(key, {
        l2TxHash: entry.transactionHash as Hex,
        deadline: args.deadlineL2Block,
        submittedAtL2Block: entry.blockNumber ?? 0n,
      });
      this.log.warn("forced transaction observed — the sequencer is obliged to include it", {
        forcedId: key,
        from: args.from,
        to: args.to,
        deadlineL2Block: args.deadlineL2Block.toString(),
        l2Tx: entry.transactionHash,
      });
    }

    this.cursor = head + 1n;

    // Track how close the oldest outstanding one is to its deadline.
    let oldest: bigint | null = null;
    for (const [id, info] of this.seen) {
      if (this.lastAcknowledgedId !== null && BigInt(id) <= this.lastAcknowledgedId) continue;
      if (oldest === null || info.deadline < oldest) oldest = info.deadline;
    }
    this.oldestDeadline = oldest;
    this.overdue = oldest !== null && head > oldest;

    if (this.overdue) {
      this.log.error("a forced transaction is OVERDUE; output proposals are now blocked", {
        deadlineL2Block: oldest?.toString(),
        l2Head: head.toString(),
      });
    }
  }

  /**
   * Acknowledge everything whose derived deposit has actually been applied on KAURAX.
   *
   * Inclusion is established two ways, and both are required to be honest about it:
   *
   *  - the in-memory record of what derivation handed to the sequencer this run, and
   *  - the durable derivation checkpoint, which says "every deposit up to this L2 block is
   *    sealed into an L3 block".
   *
   * The second exists because the first does not survive a restart. Without it a node that
   * restarted after including a forced transaction but before acknowledging it could never
   * acknowledge — leaving the output oracle blocking settlement forever over work that was
   * in fact done. The checkpoint is the only durable evidence, so it is the authority.
   */
  private async acknowledge(): Promise<void> {
    const portal = this.cfg.contracts.portal;
    if (!portal) return;

    const outstanding = [...this.seen.entries()]
      .filter(([id]) => this.lastAcknowledgedId === null || BigInt(id) > this.lastAcknowledgedId)
      .sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));

    if (outstanding.length === 0) return;

    // Only acknowledge ids whose originating L2 transaction has been consumed by
    // derivation. Anything still queued has not been included yet.
    const applied = this.derivation.appliedL2Transactions();
    const sealedThrough = this.derivation.checkpointBlock();

    const isIncluded = (info: {l2TxHash: Hex; submittedAtL2Block: bigint}): boolean => {
      if (applied.has(info.l2TxHash.toLowerCase())) return true;
      // The checkpoint is exclusive: it is the next L2 block to scan, so everything
      // strictly below it has been derived and sealed.
      return sealedThrough !== null && info.submittedAtL2Block < sealedThrough;
    };

    let highest: bigint | null = null;
    for (const [id, info] of outstanding) {
      if (!isIncluded(info)) break; // ids must be acknowledged in order
      highest = BigInt(id);
    }
    if (highest === null) return;

    const l3Head = await this.engine.getBlockNumber();
    try {
      const txHash = await this.settlement.acknowledgeForced(highest, l3Head);
      this.lastAcknowledgedId = highest;
      this.log.info("acknowledged forced transactions on the L2", {
        throughId: highest.toString(),
        l3Block: l3Head.toString(),
        l2Tx: txHash,
      });
    } catch (err) {
      // Worth shouting about: while this fails, settlement stays blocked.
      this.log.error("could not acknowledge forced transactions", {error: (err as Error).message});
      throw err;
    }
  }

  status(): ForcedStatus {
    const pending = [...this.seen.keys()].filter(
      (id) => this.lastAcknowledgedId === null || BigInt(id) > this.lastAcknowledgedId,
    ).length;

    return {
      running: this.running,
      pending,
      lastAcknowledgedId: this.lastAcknowledgedId?.toString() ?? null,
      oldestDeadline: this.oldestDeadline?.toString() ?? null,
      blocksRemaining: null,
      overdue: this.overdue,
      lastError: this.lastError,
    };
  }
}

export {portalAbi};
