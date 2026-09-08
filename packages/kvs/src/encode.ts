/**
 * ABI encoding of a step proof, in exactly the shape
 * `KauraxOneStepVerifier.StepProof` decodes.
 *
 * The differential test carries proofs across the language boundary as one opaque blob
 * rather than as parsed JSON. Nested `bytes32[][]` is miserable to reassemble from JSON in
 * Foundry, and every line of reassembly is a place where the fixture could differ from what
 * the emulator meant — which would make a differential failure ambiguous exactly when it
 * matters.
 */
import {encodeAbiParameters, type Hex} from "viem";
import type {MachineState} from "./state.js";
import type {StepProofData} from "./machine.js";

const MACHINE_STATE = {
  type: "tuple",
  components: [
    {name: "pc", type: "uint64"},
    {name: "gas", type: "uint64"},
    {name: "codeHash", type: "bytes32"},
    {name: "stackRoot", type: "bytes32"},
    {name: "stackSize", type: "uint16"},
    {name: "memRoot", type: "bytes32"},
    {name: "memWords", type: "uint32"},
    {name: "storageRoot", type: "bytes32"},
    {name: "status", type: "uint8"},
    {name: "halt", type: "uint8"},
  ],
} as const;

const STEP_PROOF = {
  type: "tuple",
  components: [
    {name: "pre", ...MACHINE_STATE},
    {name: "code", type: "bytes"},
    {name: "stackLeaves", type: "bytes32[]"},
    {name: "stackSiblings", type: "bytes32[][]"},
    {name: "memLeaves", type: "bytes32[]"},
    {name: "memSiblings", type: "bytes32[][]"},
    {name: "storageLeaves", type: "bytes32[]"},
    {name: "storageSiblings", type: "bytes32[][]"},
  ],
} as const;

/** The final machine state as a struct, for tests that tamper with one field at a time. */
export function encodeMachineState(s: MachineState): Hex {
  return encodeAbiParameters(
    [MACHINE_STATE],
    [
      {
        pc: s.pc,
        gas: s.gas,
        codeHash: s.codeHash,
        stackRoot: s.stackRoot,
        stackSize: s.stackSize,
        memRoot: s.memRoot,
        memWords: s.memWords,
        storageRoot: s.storageRoot,
        status: s.status,
        halt: s.halt,
      },
    ] as never,
  );
}

export function encodeStepProof(pre: MachineState, proof: StepProofData): Hex {
  return encodeAbiParameters(
    [STEP_PROOF],
    [
      {
        pre: {
          pc: pre.pc,
          gas: pre.gas,
          codeHash: pre.codeHash,
          stackRoot: pre.stackRoot,
          stackSize: pre.stackSize,
          memRoot: pre.memRoot,
          memWords: pre.memWords,
          storageRoot: pre.storageRoot,
          status: pre.status,
          halt: pre.halt,
        },
        code: proof.code,
        stackLeaves: proof.stackLeaves,
        stackSiblings: proof.stackSiblings,
        memLeaves: proof.memLeaves,
        memSiblings: proof.memSiblings,
        storageLeaves: proof.storageLeaves,
        storageSiblings: proof.storageSiblings,
      },
    ] as never,
  );
}

/** The whole fixture set as one blob, so the Solidity side does a single decode. */
export function encodeFixtures(
  cases: {label: string; preHash: Hex; postHash: Hex; proof: Hex}[],
): Hex {
  return encodeAbiParameters(
    [{type: "string[]"}, {type: "bytes32[]"}, {type: "bytes32[]"}, {type: "bytes[]"}],
    [
      cases.map((c) => c.label),
      cases.map((c) => c.preHash),
      cases.map((c) => c.postHash),
      cases.map((c) => c.proof),
    ] as never,
  );
}
