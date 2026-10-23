/**
 * The settlement-cost ledger.
 *
 * The case that matters most is the duplicate: a retry that re-reads the same receipt
 * must not be counted twice. An inflated cost figure is exactly as misleading as an
 * inflated revenue one, and this ledger is the only place that could produce one.
 */
import {describe, expect, it} from "vitest";
import {L2SpendLedger} from "../src/fees/l2-spend.js";

const GWEI = 1_000_000_000n;

describe("L2SpendLedger", () => {
  it("starts empty rather than null", () => {
    const t = new L2SpendLedger().totals();
    expect(t.transactions).toBe(0);
    expect(t.gasUsed).toBe(0n);
    expect(t.costWei).toBe(0n);
    for (const kind of ["batch", "output", "forced"] as const) {
      expect(t.byKind[kind]).toEqual({transactions: 0, gasUsed: 0n, costWei: 0n});
    }
  });

  it("records cost as gasUsed x effectiveGasPrice", () => {
    const l = new L2SpendLedger();
    l.record("batch", "0xaa", 100_000n, 2n * GWEI);

    const t = l.totals();
    expect(t.costWei).toBe(200_000_000_000_000n);
    expect(t.gasUsed).toBe(100_000n);
    expect(t.transactions).toBe(1);
  });

  it("keeps the three cost drivers apart", () => {
    const l = new L2SpendLedger();
    l.record("batch", "0xaa", 100_000n, 1n * GWEI);
    l.record("output", "0xbb", 50_000n, 1n * GWEI);
    l.record("forced", "0xcc", 30_000n, 1n * GWEI);

    const t = l.totals();
    expect(t.byKind.batch.costWei).toBe(100_000n * GWEI);
    expect(t.byKind.output.costWei).toBe(50_000n * GWEI);
    expect(t.byKind.forced.costWei).toBe(30_000n * GWEI);
    // Batching scales with throughput and proposing does not, so a single total would
    // hide which one is growing.
    expect(t.costWei).toBe(180_000n * GWEI);
    expect(t.transactions).toBe(3);
  });

  it("refuses to count the same transaction twice", () => {
    const l = new L2SpendLedger();
    expect(l.record("batch", "0xaa", 100_000n, GWEI)).toBe(true);
    expect(l.record("batch", "0xaa", 100_000n, GWEI)).toBe(false);

    const t = l.totals();
    expect(t.transactions).toBe(1);
    expect(t.costWei).toBe(100_000n * GWEI);
  });

  it("matches hashes case-insensitively, so checksum casing cannot double-count", () => {
    const l = new L2SpendLedger();
    l.record("output", "0xAbCd", 10n, GWEI);
    expect(l.record("output", "0xabcd", 10n, GWEI)).toBe(false);
    expect(l.totals().transactions).toBe(1);
  });

  it("treats the same hash under a different kind as a separate entry", () => {
    // Distinct contracts, so a shared hash is not possible in practice; the ledger should
    // not silently merge them if it ever were.
    const l = new L2SpendLedger();
    expect(l.record("batch", "0xaa", 10n, GWEI)).toBe(true);
    expect(l.record("output", "0xaa", 10n, GWEI)).toBe(true);
    expect(l.totals().transactions).toBe(2);
  });

  it("handles a zero gas price without counting a transaction as free of record", () => {
    const l = new L2SpendLedger();
    l.record("batch", "0xaa", 100_000n, 0n);

    const t = l.totals();
    expect(t.costWei).toBe(0n);
    // The send still happened, and the count must show it.
    expect(t.transactions).toBe(1);
    expect(t.gasUsed).toBe(100_000n);
  });

  it("rejects negative inputs rather than producing a plausible wrong total", () => {
    const l = new L2SpendLedger();
    expect(() => l.record("batch", "0xaa", -1n, GWEI)).toThrow(RangeError);
    expect(() => l.record("batch", "0xbb", 1n, -1n)).toThrow(RangeError);
  });

  it("reports when it started counting, because a restart resets the figures", () => {
    const l = new L2SpendLedger(1_700_000_000_000);
    expect(l.totals().since).toBe(1_700_000_000_000);
  });

  it("returns a copy, so a caller cannot mutate the ledger through its totals", () => {
    const l = new L2SpendLedger();
    l.record("batch", "0xaa", 100n, GWEI);

    const t = l.totals();
    t.costWei = 999n;
    t.byKind.batch.transactions = 999;

    expect(l.totals().costWei).toBe(100n * GWEI);
    expect(l.totals().byKind.batch.transactions).toBe(1);
  });

  it("stays exact across many large entries", () => {
    // bigint throughout: a float would lose wei here, and a cost figure that drifts is
    // worse than no cost figure.
    const l = new L2SpendLedger();
    for (let i = 0; i < 1000; i++) l.record("batch", `0x${i.toString(16)}`, 123_457n, 7n * GWEI);

    expect(l.totals().costWei).toBe(1000n * 123_457n * 7n * GWEI);
    expect(l.totals().transactions).toBe(1000);
  });
});
