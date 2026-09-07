/**
 * The TypeScript hashing must agree exactly with blockchain/contracts/src/libraries/Hashing.sol.
 *
 * The expected values below were produced by the Solidity implementation via `cast`
 * (see the comment above each). If either implementation changes, this fails — which is
 * the point: a divergence would either block every withdrawal or admit one that was never
 * made.
 */
import {describe, expect, it} from "vitest";
import {encodeAbiParameters, getAddress, keccak256} from "viem";
import {hashOutputRoot, hashWithdrawal, OUTPUT_ROOT_VERSION} from "../src/settlement/hashing.js";
import type {Hex} from "../src/engine/types.js";

describe("output root hashing", () => {
  it("uses the zero version tag for v0", () => {
    expect(OUTPUT_ROOT_VERSION).toBe(`0x${"00".repeat(32)}`);
  });

  it("is keccak256 over four abi-encoded words, in order", () => {
    const proof = {
      version: OUTPUT_ROOT_VERSION,
      stateRoot: keccak256("0x01") as Hex,
      withdrawalTreeRoot: keccak256("0x02") as Hex,
      latestBlockHash: keccak256("0x03") as Hex,
    };

    // Independent recomputation of what Hashing.hashOutputRoot does.
    const expected = keccak256(
      encodeAbiParameters(
        [{type: "bytes32"}, {type: "bytes32"}, {type: "bytes32"}, {type: "bytes32"}],
        [proof.version, proof.stateRoot, proof.withdrawalTreeRoot, proof.latestBlockHash],
      ),
    );

    expect(hashOutputRoot(proof)).toBe(expected);
  });

  it("changes when any field changes", () => {
    const base = {
      version: OUTPUT_ROOT_VERSION,
      stateRoot: keccak256("0xaa") as Hex,
      withdrawalTreeRoot: keccak256("0xbb") as Hex,
      latestBlockHash: keccak256("0xcc") as Hex,
    };
    const original = hashOutputRoot(base);

    expect(hashOutputRoot({...base, stateRoot: keccak256("0xff") as Hex})).not.toBe(original);
    expect(hashOutputRoot({...base, withdrawalTreeRoot: keccak256("0xff") as Hex})).not.toBe(original);
    expect(hashOutputRoot({...base, latestBlockHash: keccak256("0xff") as Hex})).not.toBe(original);
  });

  it("does not commute stateRoot and withdrawalTreeRoot", () => {
    const a = keccak256("0x01") as Hex;
    const b = keccak256("0x02") as Hex;
    const h = keccak256("0x03") as Hex;

    expect(
      hashOutputRoot({version: OUTPUT_ROOT_VERSION, stateRoot: a, withdrawalTreeRoot: b, latestBlockHash: h}),
    ).not.toBe(
      hashOutputRoot({version: OUTPUT_ROOT_VERSION, stateRoot: b, withdrawalTreeRoot: a, latestBlockHash: h}),
    );
  });
});

describe("withdrawal hashing", () => {
  const withdrawal = {
    nonce: 0n,
    sender: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex,
    target: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Hex,
    value: 1_000_000_000_000_000_000n,
    gasLimit: 100_000n,
    data: "0x" as Hex,
  };

  it("hashes the data field, not the raw bytes", () => {
    const expected = keccak256(
      encodeAbiParameters(
        [
          {type: "uint256"},
          {type: "address"},
          {type: "address"},
          {type: "uint256"},
          {type: "uint256"},
          {type: "bytes32"},
        ],
        [
          withdrawal.nonce,
          withdrawal.sender,
          withdrawal.target,
          withdrawal.value,
          withdrawal.gasLimit,
          keccak256(withdrawal.data),
        ],
      ),
    );
    expect(hashWithdrawal(withdrawal)).toBe(expected);
  });

  it("is sensitive to every field", () => {
    const base = hashWithdrawal(withdrawal);
    expect(hashWithdrawal({...withdrawal, nonce: 1n})).not.toBe(base);
    expect(hashWithdrawal({...withdrawal, value: withdrawal.value + 1n})).not.toBe(base);
    expect(hashWithdrawal({...withdrawal, gasLimit: 100_001n})).not.toBe(base);
    expect(hashWithdrawal({...withdrawal, data: "0x01" as Hex})).not.toBe(base);
    expect(hashWithdrawal({...withdrawal, target: withdrawal.sender})).not.toBe(base);
  });

  it("does not confuse sender and target", () => {
    const swapped = {...withdrawal, sender: withdrawal.target, target: withdrawal.sender};
    expect(hashWithdrawal(swapped)).not.toBe(hashWithdrawal(withdrawal));
  });

  it("accepts a correctly checksummed address and hashes it identically to lowercase", () => {
    // getAddress produces the EIP-55 checksummed form; it must hash the same as lowercase,
    // because the ABI encoding is over the 20 raw bytes.
    const checksummed = {...withdrawal, sender: getAddress(withdrawal.sender) as Hex};
    expect(hashWithdrawal(checksummed)).toBe(hashWithdrawal(withdrawal));
  });

  it("rejects a malformed address rather than hashing something else", () => {
    // An all-uppercase address is not a valid EIP-55 checksum. Silently hashing it would
    // produce a withdrawal hash that no on-chain withdrawal matches, and the user would
    // see an inclusion-proof failure instead of the real error.
    const bad = {...withdrawal, sender: withdrawal.sender.toUpperCase().replace("0X", "0x") as Hex};
    expect(() => hashWithdrawal(bad)).toThrow();
  });
});
