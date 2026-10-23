/**
 * What KAURAX spends on the L2 to settle.
 *
 * Publishing fee income without publishing settlement cost would be the same error as
 * conflating burned fees with received ones, pointed the other way: the operator pays real
 * gas on the underlying L2 every time a batch or an output root is posted, and until this
 * module existed nothing recorded how much. docs/OPERATING_COSTS.md called it the largest
 * unmeasured recurring cost, which it is.
 *
 * Three things cost L2 gas, and they are kept apart because they scale with different
 * drivers and a single total would hide that:
 *
 *   batch    data availability. Scales with KAURAX throughput and calldata size.
 *   output   settlement. Scales with the proposal interval, not with usage.
 *   forced   forced-inclusion acknowledgement. Rare; driven by censorship attempts.
 *
 * Every figure is `gasUsed x effectiveGasPrice` read from a receipt the node already waited
 * for. Nothing is estimated and nothing is priced in another currency — the amounts are in
 * the L2's native wei, which is NOT KAX, and must never be added to a KAX figure.
 *
 * This counts only what THIS PROCESS spent since it started. It is not a historical total:
 * a restart resets it, and there is no on-chain aggregate to recover one from. Every
 * surface that reports it says so. See docs/PROTOCOL_FEES.md.
 */

export type L2SpendKind = "batch" | "output" | "forced";

export interface SpendEntry {
  transactions: number;
  gasUsed: bigint;
  /** gasUsed x effectiveGasPrice, in the L2's native wei. */
  costWei: bigint;
}

export interface L2SpendTotals extends SpendEntry {
  byKind: Record<L2SpendKind, SpendEntry>;
  /** When this ledger started counting. A restart resets it, and the figures with it. */
  since: number;
}

const KINDS: readonly L2SpendKind[] = ["batch", "output", "forced"];

function emptyEntry(): SpendEntry {
  return {transactions: 0, gasUsed: 0n, costWei: 0n};
}

/**
 * An in-memory accumulator for L2 settlement cost.
 *
 * Deliberately not persisted. A durable ledger that silently double-counted across a
 * restart would be worse than an honest in-memory one that resets, and getting persistence
 * right needs a store and a dedupe key per transaction hash. The hashes are recorded so a
 * replay cannot double-count within a run; across runs, the reported `since` is the answer.
 */
export class L2SpendLedger {
  private readonly byKind: Record<L2SpendKind, SpendEntry>;
  private readonly seen = new Set<string>();
  private readonly startedAt: number;

  constructor(now: number = Date.now()) {
    this.startedAt = now;
    this.byKind = {batch: emptyEntry(), output: emptyEntry(), forced: emptyEntry()};
  }

  /**
   * Record one settled L2 transaction.
   *
   * Returns false when the hash was already recorded. A retry that re-reads the same
   * receipt must not be counted twice: an inflated cost figure is as misleading as an
   * inflated revenue one, and this is the only place that could produce it.
   */
  record(
    kind: L2SpendKind,
    txHash: string,
    gasUsed: bigint,
    effectiveGasPrice: bigint,
  ): boolean {
    if (gasUsed < 0n || effectiveGasPrice < 0n) {
      throw new RangeError("gasUsed and effectiveGasPrice must not be negative");
    }

    const key = `${kind}:${txHash.toLowerCase()}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);

    const entry = this.byKind[kind];
    entry.transactions += 1;
    entry.gasUsed += gasUsed;
    entry.costWei += gasUsed * effectiveGasPrice;
    return true;
  }

  totals(): L2SpendTotals {
    const total = emptyEntry();
    for (const k of KINDS) {
      total.transactions += this.byKind[k].transactions;
      total.gasUsed += this.byKind[k].gasUsed;
      total.costWei += this.byKind[k].costWei;
    }
    return {
      ...total,
      byKind: {
        batch: {...this.byKind.batch},
        output: {...this.byKind.output},
        forced: {...this.byKind.forced},
      },
      since: this.startedAt,
    };
  }
}
