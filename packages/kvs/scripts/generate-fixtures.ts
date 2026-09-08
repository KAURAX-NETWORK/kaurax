/**
 * Generates the differential fixture consumed by blockchain/contracts/test/KVSVerifier.t.sol.
 *
 *   pnpm --filter @kaurax/kvs fixtures
 *
 * Every case is one step: the emulator's pre-state hash, the post-state hash it produced,
 * and the proof. The Solidity verifier is handed the same pre-state and proof and must
 * produce the same post-state. Neither side is the reference — a mismatch means one of them
 * is wrong and the pair says so rather than either quietly winning.
 *
 * The random programs are seeded, so the fixture is reproducible: regenerating on a clean
 * checkout produces a byte-identical file, and a diff means a semantic change.
 */
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Machine} from "../src/machine.js";
import {encodeFixtures, encodeStepProof} from "../src/encode.js";
import {hashState, isTerminal} from "../src/state.js";
import type {Hex} from "../src/merkle.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../blockchain/contracts/test/fixtures/kvs-differential.hex");

interface Case {
  label: string;
  preHash: Hex;
  postHash: Hex;
  proof: Hex;
}

const cases: Case[] = [];

/** Run a program and record every step as its own case. */
function record(label: string, code: number[], gas = 1_000_000n, storage?: Map<bigint, bigint>, maxSteps = 24): void {
  const m = new Machine(Uint8Array.from(code), gas, storage);
  for (let i = 0; i < maxSteps; i++) {
    if (isTerminal(m.state())) break;
    const r = m.step();
    cases.push({
      label: `${label}#${i}`,
      preHash: hashState(r.pre),
      postHash: hashState(r.post),
      proof: encodeStepProof(r.pre, r.proof),
    });
  }
}

const PUSH1 = (v: number) => [0x60, v];
const PUSH32 = (v: bigint) => {
  const out = [0x7f];
  for (let i = 31; i >= 0; i--) out.push(Number((v >> BigInt(i * 8)) & 0xffn));
  return out;
};

// ---------------------------------------------------------------- honest execution --

record("add", [...PUSH1(7), ...PUSH1(35), 0x01, 0x00]);
record("mul", [...PUSH1(6), ...PUSH1(7), 0x02, 0x00]);
record("sub-underflow-wraps", [...PUSH1(1), ...PUSH1(0), 0x03, 0x00]);
record("div-by-zero-is-zero", [...PUSH1(0), ...PUSH1(9), 0x04, 0x00]);
record("mod-by-zero-is-zero", [...PUSH1(0), ...PUSH1(9), 0x06, 0x00]);
record("sdiv-min-by-negative-one", [...PUSH32((1n << 256n) - 1n), ...PUSH32(1n << 255n), 0x05, 0x00]);
record("smod-negative", [...PUSH32((1n << 256n) - 3n), ...PUSH32((1n << 256n) - 10n), 0x07, 0x00]);
record("addmod", [...PUSH1(7), ...PUSH1(200), ...PUSH1(200), 0x08, 0x00]);
record("mulmod", [...PUSH1(7), ...PUSH1(200), ...PUSH1(200), 0x09, 0x00]);
record("comparisons", [...PUSH1(3), ...PUSH1(5), 0x10, ...PUSH1(3), ...PUSH1(5), 0x11, 0x00]);
record("signed-comparisons", [...PUSH32((1n << 256n) - 1n), ...PUSH1(1), 0x12, 0x00]);
record("eq-iszero", [...PUSH1(4), ...PUSH1(4), 0x14, 0x15, 0x00]);
record("bitwise", [...PUSH1(0xf0), ...PUSH1(0x0f), 0x16, ...PUSH1(0xf0), ...PUSH1(0x0f), 0x17, 0x00]);
record("not", [...PUSH1(0), 0x19, 0x00]);
record("byte", [...PUSH32(0xdeadbeefn), ...PUSH1(31), 0x1a, 0x00]);
record("shifts", [...PUSH1(1), ...PUSH1(8), 0x1b, ...PUSH1(0xff), ...PUSH1(4), 0x1c, 0x00]);
record("sar-negative-saturates", [...PUSH32((1n << 256n) - 1n), ...PUSH1(255), 0x1d, 0x00]);
record("shift-over-255-is-zero", [...PUSH1(1), ...PUSH32(300n), 0x1b, 0x00]);
record("pop", [...PUSH1(1), 0x50, 0x00]);
record("pc-msize-gas", [0x58, 0x59, 0x5a, 0x00]);
record("push0", [0x5f, 0x00]);
record("push32", [...PUSH32((1n << 200n) + 12345n), 0x00]);
record("dup1", [...PUSH1(9), 0x80, 0x00]);
record("dup16", [...Array.from({length: 16}, (_, i) => PUSH1(i + 1)).flat(), 0x8f, 0x00]);
record("swap1", [...PUSH1(1), ...PUSH1(2), 0x90, 0x00]);
record("swap16", [...Array.from({length: 17}, (_, i) => PUSH1(i + 1)).flat(), 0x9f, 0x00]);
record("jumpdest-jump", [...PUSH1(4), 0x56, 0x00, 0x00, 0x5b, 0x00]);
record("jumpi-taken", [...PUSH1(1), ...PUSH1(6), 0x57, 0x00, 0x00, 0x00, 0x5b, 0x00]);
record("jumpi-not-taken", [...PUSH1(0), ...PUSH1(6), 0x57, 0x00]);
record("mstore-mload", [...PUSH1(0xab), ...PUSH1(0), 0x52, ...PUSH1(0), 0x51, 0x00]);
record("mstore-high-word", [...PUSH1(0xcd), ...PUSH1(32 * 40), 0x52, 0x00]);
record("keccak-empty", [...PUSH1(0), ...PUSH1(0), 0x20, 0x00]);
record("keccak-one-word", [...PUSH1(0xff), ...PUSH1(0), 0x52, ...PUSH1(32), ...PUSH1(0), 0x20, 0x00]);
record("sstore-fresh", [...PUSH1(42), ...PUSH1(1), 0x55, 0x00]);
record("sstore-then-sload", [...PUSH1(42), ...PUSH1(1), 0x55, ...PUSH1(1), 0x54, 0x00]);
record("sload-empty", [...PUSH1(7), 0x54, 0x00], 1_000_000n);
record(
  "sstore-overwrite",
  [...PUSH1(9), ...PUSH1(1), 0x55, 0x00],
  1_000_000n,
  new Map([[1n, 5n]]),
);
record("return", [...PUSH1(0), ...PUSH1(0), 0xf3]);
record("revert", [...PUSH1(0), ...PUSH1(0), 0xfd]);
record("return-with-range", [...PUSH1(32), ...PUSH1(0), 0xf3]);
record("empty-code-is-stop", [], 1_000_000n);
record("run-off-end-is-stop", [...PUSH1(1), 0x50]);

// ------------------------------------------------------------------- every halt --

record("halt-stack-underflow", [0x01, 0x00]);
record("halt-invalid-opcode", [0xfe]);
record("halt-unsupported-call", [0xf1]);
record("halt-unsupported-log", [0xa0]);
record("halt-unsupported-caller", [0x33]);
record("halt-unsupported-exp", [...PUSH1(2), ...PUSH1(3), 0x0a]);
record("halt-invalid-jump-into-push-data", [...PUSH1(2), 0x56, 0x5b, 0x00]);
record("halt-invalid-jump-out-of-range", [...PUSH1(200), 0x56]);
record("halt-jump-to-non-jumpdest", [...PUSH1(3), 0x56, 0x00, 0x01]);
record("halt-unaligned-mload", [...PUSH1(1), 0x51]);
record("halt-unaligned-mstore", [...PUSH1(0xaa), ...PUSH1(3), 0x52]);
record("halt-unaligned-keccak-size", [...PUSH1(31), ...PUSH1(0), 0x20]);
record("halt-out-of-gas-immediately", [...PUSH1(1), ...PUSH1(2), 0x01, 0x00], 4n);
record("halt-out-of-gas-on-sstore", [...PUSH1(1), ...PUSH1(2), 0x55, 0x00], 100n);
record("halt-out-of-gas-on-memory-expansion", [...PUSH1(1), ...PUSH32(32n * 60000n), 0x52], 5000n);

// --------------------------------------------------------------- seeded random --

/**
 * A small xorshift so the corpus is reproducible without a dependency. Randomness here is
 * for coverage, not for security, and a fixture that changes when nothing changed would be
 * worse than a weaker generator.
 */
let seed = 0x9e3779b9;
function rnd(n: number): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed % n;
}

// SLOAD and SSTORE are deliberately absent. A storage proof is 256 siblings — 8 KB of
// calldata — and letting the random corpus reach for storage made the committed fixture
// several megabytes without covering anything the dedicated storage cases above miss. The
// storage path is exercised there, and by `random-storage-*` below at a controlled rate.
const POOL = [
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x50, 0x58, 0x59, 0x5a, 0x5b, 0x5f, 0x80,
  0x81, 0x90, 0x91, 0x51, 0x52, 0x20, 0xf3, 0xfd, 0xfe, 0xf1, 0x33,
];

// The committed corpus is deliberately modest: it has to live in the repository and run on
// every CI job. A deeper campaign is the same generator with a bigger number —
// `KVS_FIXTURE_PROGRAMS=2000 pnpm --filter @kaurax/kvs fixtures` — and is what a fuzzing run
// should use. The default is chosen so the fixture stays under a megabyte.
const PROGRAMS = Number(process.env.KVS_FIXTURE_PROGRAMS ?? 20);

for (let p = 0; p < PROGRAMS; p++) {
  const code: number[] = [];
  // Seed the stack so the programs are not all immediate underflows — those are covered
  // above, and the interesting divergences need operands.
  const seedPushes = 2 + rnd(4);
  for (let i = 0; i < seedPushes; i++) code.push(...PUSH1(rnd(256)));
  const len = 3 + rnd(10);
  for (let i = 0; i < len; i++) {
    const op = POOL[rnd(POOL.length)]!;
    // Keep memory and storage arguments plausible; a random 256-bit offset is always an
    // out-of-range halt and would crowd out everything else.
    if (op === 0x51 || op === 0x52 || op === 0x20) {
      code.push(...PUSH1(32 * rnd(4)));
      if (op === 0x52 || op === 0x20) code.push(...PUSH1(rnd(256)));
    }
    code.push(op);
  }
  code.push(0x00);
  record(`random-${p}`, code, BigInt(200 + rnd(60000)), undefined, 10);
}

// A handful of random storage programs, kept separate so their 8 KB proofs are a bounded
// cost rather than whatever the main corpus happens to roll.
for (let p = 0; p < 4; p++) {
  const code: number[] = [];
  for (let i = 0; i < 3; i++) code.push(...PUSH1(rnd(256)));
  code.push(...PUSH1(rnd(64)), 0x54);
  code.push(...PUSH1(rnd(256)), ...PUSH1(rnd(64)), 0x55);
  code.push(...PUSH1(rnd(64)), 0x54, 0x00);
  record(`random-storage-${p}`, code, BigInt(30000 + rnd(60000)), new Map([[BigInt(rnd(64)), BigInt(rnd(999))]]), 12);
}

const blob = encodeFixtures(cases);
mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, blob);

console.log(`[kvs] ${cases.length} differential cases -> ${OUT} (${(blob.length / 2048).toFixed(0)} KB)`);
