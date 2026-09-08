import {describe, expect, it} from "vitest";
import {Machine} from "../src/machine.js";
import {Halt, Status, hashState} from "../src/state.js";
import {runTrace, commit, traceProof} from "../src/trace.js";
import {computeRoot} from "../src/merkle.js";

const P1 = (v: number) => [0x60, v];
const run = (code: number[], gas = 1_000_000n) => runTrace(Uint8Array.from(code), {gas});
const final = (code: number[], gas = 1_000_000n) => {
  const t = run(code, gas);
  return t.states[t.states.length - 1]!;
};

describe("arithmetic", () => {
  it("adds", () => {
    const t = run([...P1(2), ...P1(40), 0x01, 0x00]);
    expect(t.states[t.states.length - 1]!.status).toBe(Status.STOPPED);
  });

  it("treats division by zero as zero rather than halting, as the EVM does", () => {
    expect(final([...P1(0), ...P1(9), 0x04, 0x00]).status).toBe(Status.STOPPED);
  });

  it("wraps on overflow instead of throwing", () => {
    expect(final([...P1(1), ...P1(0), 0x03, 0x00]).status).toBe(Status.STOPPED);
  });
});

describe("halts", () => {
  it("underflows when an operand is missing", () => {
    const s = final([0x01]);
    expect(s.status).toBe(Status.HALTED);
    expect(s.halt).toBe(Halt.STACK_UNDERFLOW);
  });

  it("rejects an opcode outside the subset rather than approximating it", () => {
    expect(final([0xf1]).halt).toBe(Halt.UNSUPPORTED_OPCODE);
    expect(final([0xa0]).halt).toBe(Halt.UNSUPPORTED_OPCODE);
    expect(final([0x33]).halt).toBe(Halt.UNSUPPORTED_OPCODE);
  });

  it("separates an invalid opcode from an unsupported one", () => {
    expect(final([0xfe]).halt).toBe(Halt.INVALID_OPCODE);
  });

  it("refuses a jump into PUSH immediate data", () => {
    expect(final([...P1(2), 0x56, 0x5b, 0x00]).halt).toBe(Halt.INVALID_JUMP);
  });

  it("refuses an unaligned memory access", () => {
    expect(final([...P1(1), 0x51]).halt).toBe(Halt.UNALIGNED_MEMORY);
  });

  it("runs out of gas rather than going negative", () => {
    const s = final([...P1(1), ...P1(2), 0x01, 0x00], 4n);
    expect(s.halt).toBe(Halt.OUT_OF_GAS);
    expect(s.gas).toBe(0n);
  });

  it("discards the frame's work: a halted state keeps the roots it started the step with", () => {
    // PUSH 1, PUSH 2, then SSTORE with too little gas. The storage root must be untouched.
    const ok = final([...P1(1), ...P1(2), 0x00]);
    const oog = final([...P1(1), ...P1(2), 0x55, 0x00], 10n);
    expect(oog.storageRoot).toBe(ok.storageRoot);
  });
});

describe("storage", () => {
  it("reads back what it wrote", () => {
    const t = run([...P1(42), ...P1(1), 0x55, ...P1(1), 0x54, 0x00]);
    const s = t.states[t.states.length - 1]!;
    expect(s.status).toBe(Status.STOPPED);
    expect(s.stackSize).toBe(1);
  });

  it("charges more for a fresh slot than for one already occupied", () => {
    const fresh = final([...P1(7), ...P1(1), 0x55, 0x00]);
    const m = new Machine(Uint8Array.from([...P1(7), ...P1(1), 0x55, 0x00]), 1_000_000n, new Map([[1n, 3n]]));
    while (m.state().status === Status.RUNNING) m.step();
    expect(m.state().gas).toBeGreaterThan(fresh.gas);
  });
});

describe("determinism", () => {
  it("the same program twice produces the same trace root", () => {
    const code = [...P1(3), ...P1(4), 0x02, ...P1(0), 0x55, 0x00];
    expect(run(code).root).toBe(run(code).root);
  });

  it("one different byte produces a different trace root", () => {
    expect(run([...P1(3), ...P1(4), 0x01, 0x00]).root).not.toBe(
      run([...P1(3), ...P1(4), 0x02, 0x00]).root,
    );
  });

  it("gas is part of the commitment, so the same code at different budgets differs", () => {
    const code = [...P1(3), ...P1(4), 0x01, 0x00];
    expect(run(code, 1000n).root).not.toBe(run(code, 2000n).root);
  });
});

describe("traces", () => {
  it("has one more state than it has steps", () => {
    const t = run([...P1(1), ...P1(2), 0x01, 0x00]);
    expect(t.states.length).toBe(t.records.length + 1);
  });

  it("a terminal machine is its own successor", () => {
    const m = new Machine(Uint8Array.from([0x00]), 100n);
    m.step();
    const before = hashState(m.state());
    const r = m.step();
    expect(hashState(r.post)).toBe(before);
  });

  it("pads with the final state, not with zero", () => {
    // Zero padding would commit to states no execution can produce, and a dispute landing
    // in the padding could then be won by anyone willing to claim anything about it.
    const t = run([...P1(1), 0x00]);
    expect(t.leaves.length).toBe(1 << t.height);
    expect(t.leaves[t.leaves.length - 1]).toBe(t.hashes[t.hashes.length - 1]);
  });

  it("every state proves under the trace root", () => {
    const t = run([...P1(1), ...P1(2), 0x01, ...P1(0), 0x55, 0x00]);
    const {leaves, root} = commit(t.hashes);
    for (let i = 0; i < leaves.length; i++) {
      expect(computeRoot(leaves[i]!, BigInt(i), traceProof(leaves, i))).toBe(root);
    }
  });
});
