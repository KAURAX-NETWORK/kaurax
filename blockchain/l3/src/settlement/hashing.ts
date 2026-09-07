/**
 * TypeScript mirror of blockchain/contracts/src/libraries/Hashing.sol.
 *
 * These definitions are consensus-critical: the proposer computes output roots here and
 * `KauraxPortal` recomputes them on the L2. A divergence would either block every
 * withdrawal or, worse, admit one that was never made. `blockchain/l3/test/hashing.test.ts`
 * pins them against values produced by the Solidity implementation.
 */
import {encodeAbiParameters, keccak256} from "viem";
import type {Hex} from "../engine/types.js";

/** Version tag for v0 output roots. Matches Hashing.OUTPUT_ROOT_VERSION. */
export const OUTPUT_ROOT_VERSION: Hex = `0x${"00".repeat(32)}`;

export interface OutputRootProof {
  version: Hex;
  stateRoot: Hex;
  withdrawalTreeRoot: Hex;
  latestBlockHash: Hex;
}

export interface WithdrawalTransaction {
  nonce: bigint;
  sender: Hex;
  target: Hex;
  value: bigint;
  gasLimit: bigint;
  data: Hex;
}

export function hashOutputRoot(proof: OutputRootProof): Hex {
  return keccak256(
    encodeAbiParameters(
      [{type: "bytes32"}, {type: "bytes32"}, {type: "bytes32"}, {type: "bytes32"}],
      [proof.version, proof.stateRoot, proof.withdrawalTreeRoot, proof.latestBlockHash],
    ),
  );
}

export function hashWithdrawal(tx: WithdrawalTransaction): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {type: "uint256"},
        {type: "address"},
        {type: "address"},
        {type: "uint256"},
        {type: "uint256"},
        {type: "bytes32"},
      ],
      [tx.nonce, tx.sender, tx.target, tx.value, tx.gasLimit, keccak256(tx.data)],
    ),
  );
}
