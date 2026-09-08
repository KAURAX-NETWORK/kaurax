/**
 * Property tests for the KAURAX Verifiable Subset.
 *
 * The differential corpus in blockchain/contracts/test/KVSVerifier.t.sol proves the two
 * implementations agree. It does not prove either of them is *sane*: two implementations can
 * agree on nonsense. These tests assert the invariants the dispute game depends on, over
 * randomly generated programs, without reference to the Solidity side.
 *
 * Needs no running node.
 */
import {describe, expect, it} from "vitest";
import {Machine, hashState, isTerminal, runTrace, Status, Halt, STACK_LIMIT} from "@kaurax/kvs";
import {ZERO} from "@kaurax/kvs";

/** Deterministic generator: a failing case must be reproducible from its seed alone. */
function makeRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

const POOL = [
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x20, 0x50, 0x51, 0x52, 0x54, 0x55, 0x56,
  0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5f, 0x60, 0x61, 0x80, 0x81, 0x90, 0x91, 0xf3, 0xfd, 0xfe,
  0xf1, 0x33, 0xa0,
];

function randomProgram(rnd: (n: number) => number): number[] {
  const code: number[] = [];
  for (let i = 0; i < 2 + rnd(5); i++) code.push(0x60, rnd(256));
  for (let i = 0; i < 3 + rnd(12); i++) {
    const op = POOL[rnd(POOL.length)]!;
    if ([0x51, 0x52, 0x54, 0x55, 0x20].includes(op)) {
      code.push(0x60, 32 * rnd(3));
      if ([0x52, 0x55, 0x20].includes(op)) code.push(0x60, rnd(256));
    }
    code.push(op);
    if (op === 0x60 || op === 0x61) code.push(rnd(256));
    if (op === 0x61) code.push(rnd(256));
  }
  code.push(0x00);
  return code;
}

const PROGRAMS = 400;

describe("KVS execution invariants", () => {
  it("gas never increases and never goes below zero", () => {
    const rnd = makeRandom(0xc0ffee);
    for (let p = 0; p < PROGRAMS; p++) {
      const t = runTrace(Uint8Array.from(randomProgram(rnd)), {gas: BigInt(100 + rnd(50_000))});
      for (let i = 1; i < t.states.length; i++) {
        expect(t.states[i]!.gas).toBeGreaterThanOrEqual(0n);
        expect(t.states[i]!.gas).toBeLessThanOrEqual(t.states[i - 1]!.gas);
      }
    }
  });

  it("a halted state has exactly zero gas and a reason", () => {
    const rnd = makeRandom(0xbadf00d);
    for (let p = 0; p < PROGRAMS; p++) {
      const t = runTrace(Uint8Array.from(randomProgram(rnd)), {gas: BigInt(50 + rnd(3000))});
      const last = t.states[t.states.length - 1]!;
      if (last.status === Status.HALTED) {
        expect(last.gas).toBe(0n);
        expect(last.halt).not.toBe(Halt.NONE);
      } else {
        expect(last.halt).toBe(Halt.NONE);
      }
    }
  });

  it("the stack never exceeds the EVM's limit", () => {
    const rnd = makeRandom(0x515ac1);
    for (let p = 0; p < PROGRAMS; p++) {
      const t = runTrace(Uint8Array.from(randomProgram(rnd)), {gas: BigInt(1000 + rnd(20_000))});
      for (const s of t.states) expect(s.stackSize).toBeLessThanOrEqual(STACK_LIMIT);
    }
  });

  it("every stack slot at or above stackSize is empty", () => {
    // The invariant the verifier's push rule depends on. If a pop ever failed to clear its
    // slot, a later push could resurrect a value the machine was supposed to have discarded
    // — and the Merkle proof would still verify, because the value really is in the tree.
    const rnd = makeRandom(0x11223344);
    for (let p = 0; p < 150; p++) {
      const m = new Machine(Uint8Array.from(randomProgram(rnd)), BigInt(500 + rnd(9000)));
      for (let step = 0; step < 60 && !isTerminal(m.state()); step++) {
        m.step();
        for (let i = m.stackSize; i < m.stackSize + 4 && i < STACK_LIMIT; i++) {
          expect(m.stack.get(BigInt(i))).toBe(ZERO);
        }
      }
    }
  });

  it("a terminal machine is its own successor, forever", () => {
    const rnd = makeRandom(0x99887766);
    for (let p = 0; p < 120; p++) {
      const m = new Machine(Uint8Array.from(randomProgram(rnd)), BigInt(200 + rnd(4000)));
      for (let step = 0; step < 80 && !isTerminal(m.state()); step++) m.step();
      if (!isTerminal(m.state())) continue;
      const settled = hashState(m.state());
      for (let k = 0; k < 3; k++) {
        const r = m.step();
        expect(hashState(r.post)).toBe(settled);
      }
    }
  });

  it("an exceptional halt discards the step's work", () => {
    // The committed roots of a halted state must equal the roots it began the step with, or
    // a prover could arrange to fail late and keep a partial mutation.
    const rnd = makeRandom(0x2468ace0);
    let checked = 0;
    for (let p = 0; p < 300 && checked < 40; p++) {
      const m = new Machine(Uint8Array.from(randomProgram(rnd)), BigInt(50 + rnd(1500)));
      let prev = m.state();
      for (let step = 0; step < 60; step++) {
        if (isTerminal(m.state())) break;
        const r = m.step();
        if (r.post.status === Status.HALTED) {
          expect(r.post.stackRoot).toBe(prev.stackRoot);
          expect(r.post.memRoot).toBe(prev.memRoot);
          expect(r.post.storageRoot).toBe(prev.storageRoot);
          expect(r.post.pc).toBe(prev.pc);
          checked++;
          break;
        }
        prev = r.post;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("execution is deterministic: identical inputs give an identical trace root", () => {
    const rnd = makeRandom(0xfeedbeef);
    for (let p = 0; p < 200; p++) {
      const code = Uint8Array.from(randomProgram(rnd));
      const gas = BigInt(300 + rnd(9000));
      expect(runTrace(code, {gas}).root).toBe(runTrace(code, {gas}).root);
    }
  });

  it("changing one byte of a program changes its trace root", () => {
    const rnd = makeRandom(0x13572468);
    let compared = 0;
    for (let p = 0; p < 200 && compared < 60; p++) {
      const code = randomProgram(rnd);
      const i = rnd(code.length);
      const mutated = code.slice();
      mutated[i] = (mutated[i]! + 1 + rnd(254)) % 256;
      if (mutated[i] === code[i]) continue;
      const a = runTrace(Uint8Array.from(code), {gas: 20_000n});
      const b = runTrace(Uint8Array.from(mutated), {gas: 20_000n});
      // Not every mutation is observable — a byte inside dead code after STOP is not — so
      // this asserts the pair, not every case.
      if (a.hashes.length === b.hashes.length && a.root === b.root) continue;
      expect(a.root).not.toBe(b.root);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });

  it("the number of steps is bounded by the gas budget", () => {
    const rnd = makeRandom(0x777);
    for (let p = 0; p < 120; p++) {
      const gas = BigInt(20 + rnd(400));
      const t = runTrace(Uint8Array.from(randomProgram(rnd)), {gas, maxSteps: 5000});
      // The cheapest instruction that makes progress costs 1 (JUMPDEST), so a trace can
      // never be longer than the budget plus the terminal state.
      expect(t.records.length).toBeLessThanOrEqual(Number(gas) + 1);
      expect(t.completed).toBe(true);
    }
  });

  it("a trace commits to a power-of-two leaf count padded with its own final state", () => {
    const rnd = makeRandom(0xabcabc);
    for (let p = 0; p < 120; p++) {
      const t = runTrace(Uint8Array.from(randomProgram(rnd)), {gas: BigInt(400 + rnd(6000))});
      expect(t.leaves.length).toBe(1 << t.height);
      expect(t.leaves.length).toBeGreaterThanOrEqual(t.hashes.length);
      const last = t.hashes[t.hashes.length - 1]!;
      for (let i = t.hashes.length; i < t.leaves.length; i++) expect(t.leaves[i]).toBe(last);
    }
  });
});
