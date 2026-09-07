/**
 * TypeScript mirror of blockchain/contracts/src/libraries/MerkleTree.sol.
 *
 * The node rebuilds the withdrawal tree from `MessagePassed` events and produces the
 * inclusion proofs that `KauraxPortal` verifies. Both implementations are exercised
 * against each other by the contract tests and by blockchain/l3/test/merkle.test.ts.
 */
import {concatHex, keccak256} from "viem";
import type {Hex} from "../engine/types.js";

export const TREE_DEPTH = 32;

export const ZERO_HASH: Hex = `0x${"00".repeat(32)}`;

/** zeroHashes[h] is the root of an empty subtree of height h. */
export const ZERO_HASHES: Hex[] = (() => {
  const out: Hex[] = [ZERO_HASH];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    out.push(keccak256(concatHex([out[i - 1]!, out[i - 1]!])));
  }
  return out;
})();

function hashPair(left: Hex, right: Hex): Hex {
  return keccak256(concatHex([left, right]));
}

/** Root over the full leaf set. Equals the on-chain incremental root. */
export function computeRoot(leaves: Hex[]): Hex {
  let level = leaves;
  for (let height = 0; height < TREE_DEPTH; height++) {
    if (level.length === 0) return ZERO_HASHES[TREE_DEPTH]!;
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : ZERO_HASHES[height]!;
      next.push(hashPair(left, right));
    }
    level = next;
  }
  return level[0]!;
}

/** Sibling path from `index` to the root. Always TREE_DEPTH entries. */
export function computeProof(leaves: Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`leaf index ${index} out of range (${leaves.length} leaves)`);
  }

  const path: Hex[] = [];
  let level = leaves;
  let idx = index;

  for (let height = 0; height < TREE_DEPTH; height++) {
    const sibling = idx ^ 1;
    path.push(sibling < level.length ? level[sibling]! : ZERO_HASHES[height]!);

    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : ZERO_HASHES[height]!;
      next.push(hashPair(left, right));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return path;
}

/** Local check of a proof before paying gas to have the portal reject it. */
export function verifyProof(root: Hex, leaf: Hex, index: number, proof: Hex[]): boolean {
  if (proof.length !== TREE_DEPTH) return false;
  let node = leaf;
  let idx = index;
  for (let height = 0; height < TREE_DEPTH; height++) {
    node = idx % 2 === 1 ? hashPair(proof[height]!, node) : hashPair(node, proof[height]!);
    idx = Math.floor(idx / 2);
  }
  return node.toLowerCase() === root.toLowerCase();
}
