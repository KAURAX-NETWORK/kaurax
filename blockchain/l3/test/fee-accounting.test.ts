/**
 * The fee split is the arithmetic every revenue figure KAURAX publishes rests on, so it is
 * tested against the numbers a real block produces rather than only against invariants.
 *
 * The constants here were measured, not derived: `anvil --base-fee 1000000000`, one 21000
 * gas transfer at a 2 gwei priority fee, and the coinbase balance read before and after.
 * The coinbase gained exactly 42000000000000 wei and the 21000000000000 wei base fee went
 * nowhere. See docs/PROTOCOL_FEES.md.
 */
import {describe, expect, it} from "vitest";
import {addSplits, splitTransactionFee, sumSplits, ZERO_SPLIT} from "../src/fees/accounting.js";

const GWEI = 1_000_000_000n;

describe("splitTransactionFee", () => {
  it("reproduces a measured anvil block: base fee burned, priority fee to the coinbase", () => {
    const split = splitTransactionFee(21_000n, 3n * GWEI, 1n * GWEI);

    expect(split.paidWei).toBe(63_000_000_000_000n);
    expect(split.burnedWei).toBe(21_000_000_000_000n);
    // The figure observed on the coinbase account itself.
    expect(split.priorityWei).toBe(42_000_000_000_000n);
  });

  it("burns the whole fee when the sender paid exactly the base fee", () => {
    const split = splitTransactionFee(21_000n, 1n * GWEI, 1n * GWEI);
    expect(split.burnedWei).toBe(split.paidWei);
    expect(split.priorityWei).toBe(0n);
  });

  it("credits everything when the block predates EIP-1559", () => {
    const split = splitTransactionFee(21_000n, 2n * GWEI, null);
    expect(split.burnedWei).toBe(0n);
    expect(split.priorityWei).toBe(split.paidWei);
  });

  it("never reports a negative priority fee when a receipt is below its block base fee", () => {
    // Impossible on a correct chain. Trusting it would understate the treasury silently,
    // so the base fee is clamped and the whole fee counts as burned.
    const split = splitTransactionFee(21_000n, 1n * GWEI, 5n * GWEI);
    expect(split.priorityWei).toBe(0n);
    expect(split.burnedWei).toBe(split.paidWei);
  });

  it("keeps burned + priority exactly equal to paid, with no rounding", () => {
    // Deliberately awkward values: wei is an integer domain and nothing here may divide.
    for (const [gas, price, base] of [
      [1n, 1n, null],
      [21_000n, 7n, 3n],
      [30_000_000n, 999_999_999_999n, 123_456_789n],
      [1n, 2n ** 64n, 2n ** 63n],
    ] as Array<[bigint, bigint, bigint | null]>) {
      const s = splitTransactionFee(gas, price, base);
      expect(s.burnedWei + s.priorityWei).toBe(s.paidWei);
      expect(s.burnedWei).toBeGreaterThanOrEqual(0n);
      expect(s.priorityWei).toBeGreaterThanOrEqual(0n);
    }
  });

  it("charges nothing for zero gas", () => {
    expect(splitTransactionFee(0n, 99n * GWEI, 1n * GWEI)).toEqual({
      paidWei: 0n,
      burnedWei: 0n,
      priorityWei: 0n,
    });
  });

  it("rejects negative inputs rather than producing a plausible wrong total", () => {
    expect(() => splitTransactionFee(-1n, GWEI, GWEI)).toThrow(RangeError);
    expect(() => splitTransactionFee(21_000n, -1n, GWEI)).toThrow(RangeError);
    expect(() => splitTransactionFee(21_000n, GWEI, -1n)).toThrow(RangeError);
  });
});

describe("summing", () => {
  it("adds componentwise", () => {
    const a = splitTransactionFee(21_000n, 3n * GWEI, 1n * GWEI);
    const b = splitTransactionFee(50_000n, 2n * GWEI, 1n * GWEI);
    const total = addSplits(a, b);

    expect(total.paidWei).toBe(a.paidWei + b.paidWei);
    expect(total.burnedWei).toBe(a.burnedWei + b.burnedWei);
    expect(total.priorityWei).toBe(a.priorityWei + b.priorityWei);
  });

  it("sums an empty set to zero rather than to null", () => {
    expect(sumSplits([])).toEqual(ZERO_SPLIT);
  });

  it("sums a block's worth of transactions", () => {
    const txs = [
      splitTransactionFee(21_000n, 3n * GWEI, 1n * GWEI),
      splitTransactionFee(21_000n, 3n * GWEI, 1n * GWEI),
      splitTransactionFee(100_000n, 1n * GWEI, 1n * GWEI),
    ];
    const total = sumSplits(txs);

    expect(total.priorityWei).toBe(84_000_000_000_000n);
    expect(total.burnedWei).toBe(21_000_000_000_000n * 2n + 100_000_000_000_000n);
  });

  it("does not mutate the zero constant", () => {
    sumSplits([splitTransactionFee(21_000n, 3n * GWEI, 1n * GWEI)]);
    expect(ZERO_SPLIT).toEqual({paidWei: 0n, burnedWei: 0n, priorityWei: 0n});
  });
});
