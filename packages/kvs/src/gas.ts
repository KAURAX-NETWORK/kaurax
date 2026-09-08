/**
 * The KVS gas schedule. Mirrors contracts/src/kvs/KVSGas.sol, and `differential.test.ts`
 * fails if the two ever disagree.
 *
 * Two documented divergences from the EVM, both charging more rather than less: no EIP-2929
 * warm/cold tracking, and no SSTORE refunds. Both are explained in docs/FAULT_PROOFS.md.
 */
export const G = {
  ZERO: 0n,
  BASE: 2n,
  VERYLOW: 3n,
  LOW: 5n,
  MID: 8n,
  HIGH: 10n,
  JUMPDEST: 1n,
  KECCAK256_BASE: 30n,
  KECCAK256_WORD: 6n,
  SLOAD: 2100n,
  SSTORE_SET: 20000n,
  SSTORE_RESET: 2900n,
  MEMORY_WORD: 3n,
} as const;

export function memoryCost(words: bigint): bigint {
  return G.MEMORY_WORD * words + (words * words) / 512n;
}

export function expansionCost(current: bigint, needed: bigint): bigint {
  if (needed <= current) return 0n;
  return memoryCost(needed) - memoryCost(current);
}
