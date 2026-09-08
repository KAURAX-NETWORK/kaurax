/**
 * The KVS machine state and its commitment. Mirrors contracts/src/kvs/KVSTypes.sol.
 *
 * Field order and ABI types are load-bearing: the dispute game compares hashes produced
 * here against hashes produced there, so a reordering is a consensus failure rather than a
 * refactor. `hashing.test.ts` pins them against the Solidity output.
 */
import {encodeAbiParameters, keccak256} from "viem";
import type {Hex} from "./merkle.js";

export const STACK_HEIGHT = 10;
export const MEMORY_HEIGHT = 16;
export const STORAGE_HEIGHT = 256;

export const STACK_LIMIT = 1024;
export const MEMORY_WORD_LIMIT = 1 << MEMORY_HEIGHT;

export const Status = {RUNNING: 0, STOPPED: 1, REVERTED: 2, HALTED: 3} as const;

export const Halt = {
  NONE: 0,
  STACK_UNDERFLOW: 1,
  STACK_OVERFLOW: 2,
  OUT_OF_GAS: 3,
  INVALID_JUMP: 4,
  INVALID_OPCODE: 5,
  UNSUPPORTED_OPCODE: 6,
  UNALIGNED_MEMORY: 7,
  MEMORY_OUT_OF_RANGE: 8,
} as const;

export const HALT_NAMES: Record<number, string> = {
  0: "none",
  1: "stack underflow",
  2: "stack overflow",
  3: "out of gas",
  4: "invalid jump destination",
  5: "invalid opcode",
  6: "unsupported opcode",
  7: "unaligned memory access",
  8: "memory out of range",
};

export interface MachineState {
  pc: bigint;
  gas: bigint;
  codeHash: Hex;
  stackRoot: Hex;
  stackSize: number;
  memRoot: Hex;
  memWords: number;
  storageRoot: Hex;
  status: number;
  halt: number;
}

const STATE_ABI = [
  {type: "uint64"},
  {type: "uint64"},
  {type: "bytes32"},
  {type: "bytes32"},
  {type: "uint16"},
  {type: "bytes32"},
  {type: "uint32"},
  {type: "bytes32"},
  {type: "uint8"},
  {type: "uint8"},
] as const;

export function hashState(s: MachineState): Hex {
  return keccak256(
    encodeAbiParameters(STATE_ABI, [
      s.pc,
      s.gas,
      s.codeHash,
      s.stackRoot,
      s.stackSize,
      s.memRoot,
      s.memWords,
      s.storageRoot,
      s.status,
      s.halt,
    ]),
  );
}

/** A terminal state is its own successor, so a padded trace commits to real states. */
export function isTerminal(s: MachineState): boolean {
  return s.status !== Status.RUNNING;
}
