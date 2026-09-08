import {describe, expect, it} from "vitest";
import {SparseMerkle, ZERO, computeRoot, hashPair, zeroRoot} from "../src/merkle.js";

describe("zeroRoot", () => {
  it("is the empty leaf at height zero", () => {
    expect(zeroRoot(0)).toBe(ZERO);
  });

  it("is the zero chain, not a shortcut", () => {
    expect(zeroRoot(1)).toBe(hashPair(ZERO, ZERO));
    expect(zeroRoot(2)).toBe(hashPair(zeroRoot(1), zeroRoot(1)));
  });

  it("differs at every height, so a proof cannot be reused at another depth", () => {
    const seen = new Set([zeroRoot(0), zeroRoot(1), zeroRoot(8), zeroRoot(10), zeroRoot(256)]);
    expect(seen.size).toBe(5);
  });
});

describe("SparseMerkle", () => {
  it("an empty tree is the zero root", () => {
    expect(new SparseMerkle(10).root()).toBe(zeroRoot(10));
  });

  it("a proof folds back to the root", () => {
    const t = new SparseMerkle(10);
    t.set(3n, hashPair(ZERO, ZERO));
    t.set(7n, zeroRoot(4));
    expect(computeRoot(t.get(3n), 3n, t.proof(3n))).toBe(t.root());
    expect(computeRoot(t.get(7n), 7n, t.proof(7n))).toBe(t.root());
  });

  it("proves absence as readily as presence", () => {
    const t = new SparseMerkle(10);
    t.set(1n, zeroRoot(3));
    expect(computeRoot(ZERO, 500n, t.proof(500n))).toBe(t.root());
  });

  it("supports a full-depth storage tree", () => {
    const t = new SparseMerkle(256);
    const idx = (1n << 255n) + 12345n;
    t.set(idx, zeroRoot(2));
    expect(t.proof(idx)).toHaveLength(256);
    expect(computeRoot(t.get(idx), idx, t.proof(idx))).toBe(t.root());
  });

  it("clearing a leaf restores the previous root exactly", () => {
    const t = new SparseMerkle(10);
    const before = t.root();
    t.set(5n, zeroRoot(1));
    expect(t.root()).not.toBe(before);
    t.set(5n, ZERO);
    expect(t.root()).toBe(before);
  });

  it("a clone does not share state with its original", () => {
    const t = new SparseMerkle(10);
    t.set(2n, zeroRoot(1));
    const c = t.clone();
    c.set(2n, zeroRoot(2));
    expect(c.root()).not.toBe(t.root());
  });

  it("the same siblings that verify a leaf also produce the root after replacing it", () => {
    // This is the property the verifier depends on: proving and updating are one operation,
    // so a write is impossible without first exhibiting the value being overwritten.
    const t = new SparseMerkle(10);
    t.set(4n, zeroRoot(1));
    const siblings = t.proof(4n);
    const updated = computeRoot(zeroRoot(3), 4n, siblings);
    t.set(4n, zeroRoot(3));
    expect(updated).toBe(t.root());
  });
});
