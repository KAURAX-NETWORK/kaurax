/**
 * The TypeScript Merkle tree must agree with blockchain/contracts/src/libraries/MerkleTree.sol.
 * `blockchain/contracts/test/MerkleTree.t.sol` proves the Solidity side; this proves the client side
 * builds proofs the contract will accept.
 */
import {describe, expect, it} from "vitest";
import {keccak256, concatHex} from "viem";
import {computeProof, computeRoot, verifyProof, TREE_DEPTH, ZERO_HASHES} from "../src/settlement/merkle.js";
import type {Hex} from "../src/engine/types.js";

function leaf(i: number): Hex {
  return keccak256(`0x${i.toString(16).padStart(64, "0")}`) as Hex;
}

describe("zero hash chain", () => {
  it("starts at zero and doubles by keccak", () => {
    expect(ZERO_HASHES[0]).toBe(`0x${"00".repeat(32)}`);
    expect(ZERO_HASHES[1]).toBe(keccak256(concatHex([ZERO_HASHES[0]!, ZERO_HASHES[0]!])));
    expect(ZERO_HASHES[2]).toBe(keccak256(concatHex([ZERO_HASHES[1]!, ZERO_HASHES[1]!])));
  });

  it("has one entry per level plus the root level", () => {
    expect(ZERO_HASHES).toHaveLength(TREE_DEPTH + 1);
  });
});

describe("root", () => {
  it("of an empty tree is the zero chain root", () => {
    expect(computeRoot([])).toBe(ZERO_HASHES[TREE_DEPTH]);
  });

  it("changes with each appended leaf", () => {
    const leaves: Hex[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      leaves.push(leaf(i));
      const root = computeRoot(leaves);
      expect(seen.has(root)).toBe(false);
      seen.add(root);
    }
  });

  it("depends on leaf order", () => {
    const a = [leaf(1), leaf(2)];
    const b = [leaf(2), leaf(1)];
    expect(computeRoot(a)).not.toBe(computeRoot(b));
  });
});

describe("proofs", () => {
  it("always has exactly TREE_DEPTH siblings", () => {
    const leaves = [leaf(0), leaf(1), leaf(2)];
    expect(computeProof(leaves, 1)).toHaveLength(TREE_DEPTH);
  });

  it("verifies for every leaf, at every tree size from 1 to 17", () => {
    for (let n = 1; n <= 17; n++) {
      const leaves = Array.from({length: n}, (_, i) => leaf(i));
      const root = computeRoot(leaves);
      for (let i = 0; i < n; i++) {
        expect(verifyProof(root, leaves[i]!, i, computeProof(leaves, i))).toBe(true);
      }
    }
  });

  it("rejects a forged leaf", () => {
    const leaves = [leaf(0), leaf(1), leaf(2), leaf(3)];
    const root = computeRoot(leaves);
    expect(verifyProof(root, keccak256("0xdeadbeef") as Hex, 2, computeProof(leaves, 2))).toBe(false);
  });

  it("rejects a proof presented at the wrong index", () => {
    const leaves = [leaf(0), leaf(1), leaf(2), leaf(3)];
    const root = computeRoot(leaves);
    expect(verifyProof(root, leaves[1]!, 3, computeProof(leaves, 1))).toBe(false);
  });

  it("rejects a proof against a different root", () => {
    const leaves = [leaf(0), leaf(1)];
    const other = [leaf(5), leaf(6)];
    expect(verifyProof(computeRoot(other), leaves[0]!, 0, computeProof(leaves, 0))).toBe(false);
  });

  it("rejects a proof of the wrong length", () => {
    const leaves = [leaf(0), leaf(1)];
    const short = computeProof(leaves, 0).slice(0, 8);
    expect(verifyProof(computeRoot(leaves), leaves[0]!, 0, short)).toBe(false);
  });

  it("rejects a tampered sibling", () => {
    const leaves = [leaf(0), leaf(1), leaf(2), leaf(3)];
    const root = computeRoot(leaves);
    const proof = computeProof(leaves, 0);
    proof[0] = keccak256("0xbad") as Hex;
    expect(verifyProof(root, leaves[0]!, 0, proof)).toBe(false);
  });

  it("throws rather than returning a useless proof for an out-of-range index", () => {
    expect(() => computeProof([leaf(0)], 5)).toThrow(/out of range/);
  });
});
