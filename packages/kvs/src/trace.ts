/**
 * Execution traces and their commitments.
 *
 * A trace is the sequence of machine states a program passes through, `states[0]` being the
 * start and `states[i]` the state after `i` instructions. The commitment is a Merkle root
 * over the state hashes.
 *
 * Padding matters and is easy to get wrong. A tree needs a power-of-two leaf count, and the
 * obvious padding — zero leaves — would let a prover claim anything about the padded region,
 * because no real state hashes to zero. Instead the terminal state is repeated. That is
 * exactly what the verifier does when asked to step a finished machine, so a dispute landing
 * in the padding resolves the same way as one landing on the last real step.
 */
import {merkleRootOf, SparseMerkle, type Hex} from "./merkle.js";
import {hashState, isTerminal, type MachineState} from "./state.js";
import {Machine, type StepRecord} from "./machine.js";

export interface Trace {
  /** `states[i]` is the machine before step `i`; the last entry is the final state. */
  states: MachineState[];
  hashes: Hex[];
  records: StepRecord[];
  /** Leaves actually committed: `hashes` extended to a power of two with the final state. */
  leaves: Hex[];
  root: Hex;
  height: number;
  /** True when the program finished on its own rather than hitting `maxSteps`. */
  completed: boolean;
}

export interface RunOptions {
  gas?: bigint;
  storage?: Map<bigint, bigint>;
  /** A bound, not a semantic limit. A trace that hits it is reported incomplete. */
  maxSteps?: number;
}

export function runTrace(code: Uint8Array, opts: RunOptions = {}): Trace {
  const gas = opts.gas ?? 1_000_000n;
  const maxSteps = opts.maxSteps ?? 4096;

  const m = new Machine(code, gas, opts.storage);
  const states: MachineState[] = [m.state()];
  const records: StepRecord[] = [];

  let completed = false;
  for (let i = 0; i < maxSteps; i++) {
    if (isTerminal(states[states.length - 1]!)) {
      completed = true;
      break;
    }
    const r = m.step();
    records.push(r);
    states.push(r.post);
  }
  if (!completed && isTerminal(states[states.length - 1]!)) completed = true;

  const hashes = states.map(hashState);
  const {leaves, root, height} = commit(hashes);
  return {states, hashes, records, leaves, root, height, completed};
}

/** Merkle-commit a list of state hashes, padding with the final state. */
export function commit(hashes: Hex[]): {leaves: Hex[]; root: Hex; height: number} {
  if (hashes.length === 0) throw new Error("a trace commits to at least one state");
  let height = 0;
  while (1 << height < hashes.length) height++;
  const size = 1 << height;

  const leaves = hashes.slice();
  const last = hashes[hashes.length - 1]!;
  while (leaves.length < size) leaves.push(last);

  const {root} = merkleRootOf(leaves);
  return {leaves, root, height};
}

/** Inclusion proof for one state hash under a trace root. */
export function traceProof(leaves: Hex[], index: number): Hex[] {
  let height = 0;
  while (1 << height < leaves.length) height++;
  const t = new SparseMerkle(height);
  leaves.forEach((l, i) => t.set(BigInt(i), l));
  return t.proof(BigInt(index));
}
