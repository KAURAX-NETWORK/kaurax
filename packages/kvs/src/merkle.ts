/**
 * Fixed-height sparse binary Merkle trees, matching contracts/src/kvs/KVSMerkle.sol.
 *
 * The two implementations must agree bit for bit — a divergence here is a soundness bug,
 * not a bug in a helper — so the hashing convention is stated once and shared:
 * internal nodes are `keccak256(left ++ right)`, and an absent subtree of height h is
 * `zeroRoot(h)`.
 *
 * Heights in use: 10 for the stack (the EVM's 1024-slot limit), 16 for memory, 256 for
 * storage. At height 256 a dense tree is impossible, so only non-zero leaves are stored and
 * everything else folds through the precomputed zero chain.
 */
import {keccak256, encodePacked} from "viem";

export type Hex = `0x${string}`;

export const ZERO: Hex = `0x${"00".repeat(32)}`;

const zeroCache: Hex[] = [ZERO];

/** Root of a completely empty tree of the given height. */
export function zeroRoot(height: number): Hex {
  while (zeroCache.length <= height) {
    const prev = zeroCache[zeroCache.length - 1]!;
    zeroCache.push(hashPair(prev, prev));
  }
  return zeroCache[height]!;
}

export function hashPair(left: Hex, right: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [left, right]));
}

/**
 * A sparse tree of fixed height.
 *
 * Roots and proofs are recomputed from the leaf map rather than cached. That is O(leaves ×
 * height) per call, which is irrelevant at the sizes a step proof deals with and removes a
 * whole class of stale-cache bugs from the component whose correctness the verifier depends
 * on.
 */
export class SparseMerkle {
  private readonly leaves = new Map<bigint, Hex>();

  constructor(readonly height: number) {}

  get(index: bigint): Hex {
    return this.leaves.get(index) ?? ZERO;
  }

  set(index: bigint, leaf: Hex): void {
    if (leaf === ZERO) this.leaves.delete(index);
    else this.leaves.set(index, leaf);
  }

  clone(): SparseMerkle {
    const t = new SparseMerkle(this.height);
    for (const [k, v] of this.leaves) t.leaves.set(k, v);
    return t;
  }

  /** Node maps by level. Level 0 is the leaves; level `height` holds the single root. */
  private levels(): Map<bigint, Hex>[] {
    const out: Map<bigint, Hex>[] = [new Map(this.leaves)];
    for (let h = 0; h < this.height; h++) {
      const below = out[h]!;
      const up = new Map<bigint, Hex>();
      const z = zeroRoot(h);
      for (const idx of below.keys()) {
        const parent = idx >> 1n;
        if (up.has(parent)) continue;
        const l = below.get(parent * 2n) ?? z;
        const r = below.get(parent * 2n + 1n) ?? z;
        up.set(parent, hashPair(l, r));
      }
      out.push(up);
    }
    return out;
  }

  root(): Hex {
    return this.levels()[this.height]!.get(0n) ?? zeroRoot(this.height);
  }

  /** Sibling hashes from the leaf upward. Length always equals `height`. */
  proof(index: bigint): Hex[] {
    const lv = this.levels();
    const out: Hex[] = [];
    let idx = index;
    for (let h = 0; h < this.height; h++) {
      const sibling = idx ^ 1n;
      out.push(lv[h]!.get(sibling) ?? zeroRoot(h));
      idx >>= 1n;
    }
    return out;
  }
}

/** Fold a leaf up through siblings — the exact mirror of `KVSMerkle.computeRoot`. */
export function computeRoot(leaf: Hex, index: bigint, siblings: Hex[]): Hex {
  let node = leaf;
  let idx = index;
  for (const s of siblings) {
    node = (idx & 1n) === 1n ? hashPair(s, node) : hashPair(node, s);
    idx >>= 1n;
  }
  return node;
}

/**
 * Merkle root over an ordered list, padded with zero leaves to the next power of two.
 * Used for the execution trace, whose length is not a power of two in general.
 */
export function merkleRootOf(leavesIn: Hex[]): {root: Hex; height: number} {
  if (leavesIn.length === 0) return {root: zeroRoot(0), height: 0};
  let height = 0;
  while (1 << height < leavesIn.length) height++;
  const t = new SparseMerkle(height);
  leavesIn.forEach((l, i) => t.set(BigInt(i), l));
  return {root: t.root(), height};
}
