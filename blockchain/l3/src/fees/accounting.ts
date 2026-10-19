/**
 * Where a KAURAX transaction fee actually goes.
 *
 * KAURAX runs an unmodified EIP-1559 fee market, so every fee splits in two and the two
 * halves have different destinations:
 *
 *   burned    gasUsed x min(baseFeePerGas, effectiveGasPrice)   destroyed, unrecoverable
 *   priority  the remainder                                     credited to the coinbase
 *
 * Conflating the two is the single easiest way to overstate what a network collects: the
 * burned portion is usually the larger one and no party ever receives it. Everything in
 * this module keeps them apart, and nothing here estimates — each figure is arithmetic
 * over values the chain already recorded in a block header and a receipt.
 *
 * See docs/PROTOCOL_FEES.md.
 */

export interface FeeSplit {
  /** gasUsed x effectiveGasPrice. What the sender was actually charged. */
  paidWei: bigint;
  /** The EIP-1559 base fee component. Destroyed; no address receives it. */
  burnedWei: bigint;
  /** The priority component, credited to the block coinbase. */
  priorityWei: bigint;
}

export const ZERO_SPLIT: Readonly<FeeSplit> = Object.freeze({
  paidWei: 0n,
  burnedWei: 0n,
  priorityWei: 0n,
});

/**
 * Split one transaction's fee.
 *
 * `baseFeePerGas` is null for a pre-1559 block, where nothing is burned and the whole fee
 * reaches the coinbase.
 *
 * The base fee is clamped to the effective gas price before subtracting. A receipt whose
 * effective price is below its block's base fee cannot occur on a correct chain, but
 * arithmetic that trusts it would produce a negative priority fee and, summed, a treasury
 * balance that is too low — a silent accounting error rather than a visible one. Clamping
 * keeps every figure non-negative and keeps `burned + priority === paid` exactly.
 */
export function splitTransactionFee(
  gasUsed: bigint,
  effectiveGasPrice: bigint,
  baseFeePerGas: bigint | null,
): FeeSplit {
  if (gasUsed < 0n) throw new RangeError(`gasUsed must not be negative (got ${gasUsed})`);
  if (effectiveGasPrice < 0n) {
    throw new RangeError(`effectiveGasPrice must not be negative (got ${effectiveGasPrice})`);
  }
  if (baseFeePerGas !== null && baseFeePerGas < 0n) {
    throw new RangeError(`baseFeePerGas must not be negative (got ${baseFeePerGas})`);
  }

  const paidWei = gasUsed * effectiveGasPrice;
  const burnedPerGas = baseFeePerGas === null ? 0n : min(baseFeePerGas, effectiveGasPrice);
  const burnedWei = gasUsed * burnedPerGas;

  return {paidWei, burnedWei, priorityWei: paidWei - burnedWei};
}

/** Add splits. Separate from `splitTransactionFee` so a caller cannot double-count a row. */
export function addSplits(a: FeeSplit, b: FeeSplit): FeeSplit {
  return {
    paidWei: a.paidWei + b.paidWei,
    burnedWei: a.burnedWei + b.burnedWei,
    priorityWei: a.priorityWei + b.priorityWei,
  };
}

export function sumSplits(splits: Iterable<FeeSplit>): FeeSplit {
  let total: FeeSplit = {...ZERO_SPLIT};
  for (const s of splits) total = addSplits(total, s);
  return total;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
