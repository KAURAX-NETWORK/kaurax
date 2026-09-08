/**
 * The KVS emulator.
 *
 * This is the off-chain half of the pair whose agreement is the whole point: every
 * instruction here has a counterpart in contracts/src/kvs/KauraxOneStepVerifier.sol, and
 * `differential.test.ts` runs both over randomly generated programs and fails on the first
 * divergence. Neither is the reference — they check each other.
 *
 * While a step runs, every read and write of a committed structure is recorded in access
 * order, together with the Merkle proof as it stood *at that moment*. That is what the
 * verifier consumes: it replays the same sequence, and each `update` proves the prior value
 * before producing the next root. A prover cannot skip, reorder or invent an access.
 */
import {keccak256, toHex} from "viem";
import {SparseMerkle, ZERO, type Hex} from "./merkle.js";
import {
  Halt,
  MEMORY_HEIGHT,
  MEMORY_WORD_LIMIT,
  STACK_HEIGHT,
  STACK_LIMIT,
  STORAGE_HEIGHT,
  Status,
  hashState,
  type MachineState,
} from "./state.js";
import {G, expansionCost} from "./gas.js";

const MASK = (1n << 256n) - 1n;
const SIGN = 1n << 255n;

const asSigned = (v: bigint): bigint => (v & SIGN ? v - (1n << 256n) : v);
const asUnsigned = (v: bigint): bigint => v & MASK;
const word = (v: bigint): Hex => toHex(asUnsigned(v), {size: 32});

/** The proof payload for one step, in the shape `KauraxOneStepVerifier.step` expects. */
export interface StepProofData {
  code: Hex;
  stackLeaves: Hex[];
  stackSiblings: Hex[][];
  memLeaves: Hex[];
  memSiblings: Hex[][];
  storageLeaves: Hex[];
  storageSiblings: Hex[][];
}

export interface StepRecord {
  pre: MachineState;
  post: MachineState;
  proof: StepProofData;
}

export class Machine {
  pc = 0n;
  gas: bigint;
  readonly code: Uint8Array;
  readonly codeHash: Hex;

  stack = new SparseMerkle(STACK_HEIGHT);
  stackSize = 0;
  mem = new SparseMerkle(MEMORY_HEIGHT);
  memWords = 0;
  storage = new SparseMerkle(STORAGE_HEIGHT);

  status: number = Status.RUNNING;
  halt: number = Halt.NONE;

  private sLeaves: Hex[] = [];
  private sSib: Hex[][] = [];
  private mLeaves: Hex[] = [];
  private mSib: Hex[][] = [];
  private cLeaves: Hex[] = [];
  private cSib: Hex[][] = [];

  constructor(code: Uint8Array, gas: bigint, storage?: Map<bigint, bigint>) {
    this.code = code;
    this.codeHash = keccak256(toHex(code));
    this.gas = gas;
    if (storage) {
      for (const [slot, value] of storage) {
        if (value !== 0n) this.storage.set(storageIndex(slot), word(value));
      }
    }
  }

  state(): MachineState {
    return {
      pc: this.pc,
      gas: this.gas,
      codeHash: this.codeHash,
      stackRoot: this.stack.root(),
      stackSize: this.stackSize,
      memRoot: this.mem.root(),
      memWords: this.memWords,
      storageRoot: this.storage.root(),
      status: this.status,
      halt: this.halt,
    };
  }

  stateHash(): Hex {
    return hashState(this.state());
  }

  // ------------------------------------------------------------------- stepping --

  /**
   * Execute one instruction and return the pre-state, post-state and the proof that links
   * them. A terminal machine self-loops, which is what makes a padded trace meaningful.
   */
  step(): StepRecord {
    const pre = this.state();
    this.sLeaves = [];
    this.sSib = [];
    this.mLeaves = [];
    this.mSib = [];
    this.cLeaves = [];
    this.cSib = [];

    if (pre.status !== Status.RUNNING) {
      return {pre, post: pre, proof: this.proof()};
    }

    const snapshot = {
      stack: this.stack.clone(),
      stackSize: this.stackSize,
      mem: this.mem.clone(),
      memWords: this.memWords,
      storage: this.storage.clone(),
      pc: this.pc,
      gas: this.gas,
    };

    const reason = this.execute();

    if (reason !== Halt.NONE) {
      // An exceptional halt discards the frame. Restoring the snapshot before committing is
      // what makes the emulator agree with the verifier, which builds its halted state from
      // the untouched pre-state rather than from whatever the failed step had already done.
      this.stack = snapshot.stack;
      this.stackSize = snapshot.stackSize;
      this.mem = snapshot.mem;
      this.memWords = snapshot.memWords;
      this.storage = snapshot.storage;
      this.pc = snapshot.pc;
      this.gas = 0n;
      this.status = Status.HALTED;
      this.halt = reason;
    }

    return {pre, post: this.state(), proof: this.proof()};
  }

  private proof(): StepProofData {
    return {
      code: toHex(this.code),
      stackLeaves: this.sLeaves,
      stackSiblings: this.sSib,
      memLeaves: this.mLeaves,
      memSiblings: this.mSib,
      storageLeaves: this.cLeaves,
      storageSiblings: this.cSib,
    };
  }

  // ------------------------------------------------------------------ dispatch --

  private execute(): number {
    const op = this.opAt(this.pc);

    if (op === 0x00) {
      this.status = Status.STOPPED;
      return Halt.NONE;
    }
    if (op === 0xfe) return Halt.INVALID_OPCODE;

    if (isBinary(op)) return this.binary(op);
    if (op === 0x15 || op === 0x19) return this.unary(op);
    if (op === 0x08 || op === 0x09) return this.ternary(op);
    if (op === 0x20) return this.keccakOp();
    if (op === 0x50) return this.popOp();
    if (op === 0x51 || op === 0x52) return this.memoryOp(op);
    if (op === 0x54 || op === 0x55) return this.storageOp(op);
    if (op === 0x56 || op === 0x57) return this.jumpOp(op);
    if (op === 0x58 || op === 0x59 || op === 0x5a) return this.contextOp(op);
    if (op === 0x5b) return this.charge(G.JUMPDEST) ? (this.pc++, Halt.NONE) : Halt.OUT_OF_GAS;
    if (op === 0x5f || (op >= 0x60 && op <= 0x7f)) return this.pushOp(op);
    if (op >= 0x80 && op <= 0x8f) return this.dupOp(op);
    if (op >= 0x90 && op <= 0x9f) return this.swapOp(op);
    if (op === 0xf3 || op === 0xfd) return this.terminateOp(op);

    return Halt.UNSUPPORTED_OPCODE;
  }

  // ------------------------------------------------------------------ opcodes --

  private binary(op: number): number {
    if (this.stackSize < 2) return Halt.STACK_UNDERFLOW;
    const cost = op >= 0x02 && op <= 0x07 ? G.LOW : G.VERYLOW;
    if (!this.charge(op === 0x01 || op === 0x03 ? G.VERYLOW : cost)) return Halt.OUT_OF_GAS;
    const a = this.pop();
    const b = this.pop();
    this.push(apply2(op, a, b));
    this.pc += 1n;
    return Halt.NONE;
  }

  private unary(op: number): number {
    if (this.stackSize < 1) return Halt.STACK_UNDERFLOW;
    if (!this.charge(G.VERYLOW)) return Halt.OUT_OF_GAS;
    const a = this.pop();
    this.push(op === 0x15 ? (a === 0n ? 1n : 0n) : asUnsigned(~a));
    this.pc += 1n;
    return Halt.NONE;
  }

  private ternary(op: number): number {
    if (this.stackSize < 3) return Halt.STACK_UNDERFLOW;
    if (!this.charge(G.MID)) return Halt.OUT_OF_GAS;
    const a = this.pop();
    const b = this.pop();
    const n = this.pop();
    let r = 0n;
    if (n !== 0n) r = op === 0x08 ? (a + b) % n : (a * b) % n;
    this.push(asUnsigned(r));
    this.pc += 1n;
    return Halt.NONE;
  }

  private popOp(): number {
    if (this.stackSize < 1) return Halt.STACK_UNDERFLOW;
    if (!this.charge(G.BASE)) return Halt.OUT_OF_GAS;
    this.pop();
    this.pc += 1n;
    return Halt.NONE;
  }

  private contextOp(op: number): number {
    if (this.stackSize >= STACK_LIMIT) return Halt.STACK_OVERFLOW;
    if (!this.charge(G.BASE)) return Halt.OUT_OF_GAS;
    const v = op === 0x58 ? this.pc : op === 0x59 ? BigInt(this.memWords) * 32n : this.gas;
    this.push(v);
    this.pc += 1n;
    return Halt.NONE;
  }

  private pushOp(op: number): number {
    if (this.stackSize >= STACK_LIMIT) return Halt.STACK_OVERFLOW;
    const n = op === 0x5f ? 0 : op - 0x5f;
    if (!this.charge(op === 0x5f ? G.BASE : G.VERYLOW)) return Halt.OUT_OF_GAS;
    let v = 0n;
    for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(this.byteAt(Number(this.pc) + 1 + i));
    this.push(v);
    this.pc += BigInt(1 + n);
    return Halt.NONE;
  }

  private dupOp(op: number): number {
    const n = op - 0x7f;
    if (this.stackSize < n) return Halt.STACK_UNDERFLOW;
    if (this.stackSize >= STACK_LIMIT) return Halt.STACK_OVERFLOW;
    if (!this.charge(G.VERYLOW)) return Halt.OUT_OF_GAS;
    const v = this.peek(n - 1);
    this.push(v);
    this.pc += 1n;
    return Halt.NONE;
  }

  private swapOp(op: number): number {
    const n = op - 0x8f;
    if (this.stackSize < n + 1) return Halt.STACK_UNDERFLOW;
    if (!this.charge(G.VERYLOW)) return Halt.OUT_OF_GAS;
    const top = this.peek(0);
    const deep = this.peek(n);
    this.writeAt(0, deep);
    this.writeAt(n, top);
    this.pc += 1n;
    return Halt.NONE;
  }

  private jumpOp(op: number): number {
    const need = op === 0x56 ? 1 : 2;
    if (this.stackSize < need) return Halt.STACK_UNDERFLOW;
    if (!this.charge(op === 0x56 ? G.MID : G.HIGH)) return Halt.OUT_OF_GAS;
    const dest = this.pop();
    let take = true;
    if (op === 0x57) take = this.pop() !== 0n;
    if (!take) {
      this.pc += 1n;
      return Halt.NONE;
    }
    if (!this.isJumpDest(dest)) return Halt.INVALID_JUMP;
    this.pc = dest;
    return Halt.NONE;
  }

  private terminateOp(op: number): number {
    if (this.stackSize < 2) return Halt.STACK_UNDERFLOW;
    const off = this.pop();
    const size = this.pop();
    if (size > 0n) {
      if (off % 32n !== 0n || size % 32n !== 0n) return Halt.UNALIGNED_MEMORY;
      const endWord = off / 32n + size / 32n;
      if (endWord > BigInt(MEMORY_WORD_LIMIT)) return Halt.MEMORY_OUT_OF_RANGE;
      if (!this.chargeExpansion(endWord)) return Halt.OUT_OF_GAS;
    }
    this.status = op === 0xf3 ? Status.STOPPED : Status.REVERTED;
    return Halt.NONE;
  }

  private memoryOp(op: number): number {
    const need = op === 0x51 ? 1 : 2;
    if (this.stackSize < need) return Halt.STACK_UNDERFLOW;
    if (!this.charge(G.VERYLOW)) return Halt.OUT_OF_GAS;
    const off = this.pop();
    if (off % 32n !== 0n) return Halt.UNALIGNED_MEMORY;
    const w = off / 32n;
    if (w >= BigInt(MEMORY_WORD_LIMIT)) return Halt.MEMORY_OUT_OF_RANGE;
    if (!this.chargeExpansion(w + 1n)) return Halt.OUT_OF_GAS;

    if (op === 0x51) {
      const v = this.memRead(w);
      if (this.stackSize >= STACK_LIMIT) return Halt.STACK_OVERFLOW;
      this.push(v);
    } else {
      const v = this.pop();
      this.memWrite(w, v);
    }
    this.pc += 1n;
    return Halt.NONE;
  }

  private keccakOp(): number {
    if (this.stackSize < 2) return Halt.STACK_UNDERFLOW;
    const off = this.peek(0);
    const size = this.peek(1);
    if (off % 32n !== 0n || size % 32n !== 0n) return Halt.UNALIGNED_MEMORY;
    const words = size / 32n;
    const endWord = off / 32n + words;
    if (endWord > BigInt(MEMORY_WORD_LIMIT)) return Halt.MEMORY_OUT_OF_RANGE;
    if (!this.charge(G.KECCAK256_BASE + G.KECCAK256_WORD * words)) return Halt.OUT_OF_GAS;
    if (words > 0n && !this.chargeExpansion(endWord)) return Halt.OUT_OF_GAS;

    this.pop();
    this.pop();

    const bytes = new Uint8Array(Number(size));
    for (let i = 0n; i < words; i++) {
      const w = this.memRead(off / 32n + i);
      for (let j = 0; j < 32; j++) {
        bytes[Number(i) * 32 + j] = Number((w >> BigInt((31 - j) * 8)) & 0xffn);
      }
    }
    this.push(BigInt(keccak256(toHex(bytes))));
    this.pc += 1n;
    return Halt.NONE;
  }

  private storageOp(op: number): number {
    const need = op === 0x54 ? 1 : 2;
    if (this.stackSize < need) return Halt.STACK_UNDERFLOW;

    if (op === 0x54) {
      if (!this.charge(G.SLOAD)) return Halt.OUT_OF_GAS;
      const slot = this.pop();
      this.push(this.storageRead(slot));
    } else {
      const slot = this.peek(0);
      const idx = storageIndex(slot);
      const old = this.storage.get(idx);
      // Recorded before the gas charge, not after. The verifier has to prove the prior value
      // in order to price the write at all, so the access happens whether or not the step
      // then runs out of gas. Recording it afterwards left the proof one entry short on
      // exactly that path.
      this.cLeaves.push(old);
      this.cSib.push(this.storage.proof(idx));
      if (!this.charge(old === ZERO ? G.SSTORE_SET : G.SSTORE_RESET)) return Halt.OUT_OF_GAS;
      this.pop();
      const v = this.pop();
      this.storage.set(idx, word(v));
    }
    this.pc += 1n;
    return Halt.NONE;
  }

  // ------------------------------------------------------------------ helpers --

  private charge(amount: bigint): boolean {
    if (this.gas < amount) return false;
    this.gas -= amount;
    return true;
  }

  private chargeExpansion(neededWords: bigint): boolean {
    const extra = expansionCost(BigInt(this.memWords), neededWords);
    if (extra > (1n << 64n) - 1n || !this.charge(extra)) return false;
    if (neededWords > BigInt(this.memWords)) this.memWords = Number(neededWords);
    return true;
  }

  private pop(): bigint {
    const idx = BigInt(this.stackSize - 1);
    const leaf = this.stack.get(idx);
    this.sLeaves.push(leaf);
    this.sSib.push(this.stack.proof(idx));
    this.stack.set(idx, ZERO);
    this.stackSize -= 1;
    return BigInt(leaf);
  }

  private push(v: bigint): void {
    const idx = BigInt(this.stackSize);
    this.sLeaves.push(this.stack.get(idx));
    this.sSib.push(this.stack.proof(idx));
    this.stack.set(idx, word(v));
    this.stackSize += 1;
  }

  private peek(depth: number): bigint {
    const idx = BigInt(this.stackSize - 1 - depth);
    const leaf = this.stack.get(idx);
    this.sLeaves.push(leaf);
    this.sSib.push(this.stack.proof(idx));
    return BigInt(leaf);
  }

  private writeAt(depth: number, v: bigint): void {
    const idx = BigInt(this.stackSize - 1 - depth);
    this.sLeaves.push(this.stack.get(idx));
    this.sSib.push(this.stack.proof(idx));
    this.stack.set(idx, word(v));
  }

  private memRead(w: bigint): bigint {
    const leaf = this.mem.get(w);
    this.mLeaves.push(leaf);
    this.mSib.push(this.mem.proof(w));
    return BigInt(leaf);
  }

  private memWrite(w: bigint, v: bigint): void {
    this.mLeaves.push(this.mem.get(w));
    this.mSib.push(this.mem.proof(w));
    this.mem.set(w, word(v));
  }

  private storageRead(slot: bigint): bigint {
    const idx = storageIndex(slot);
    const leaf = this.storage.get(idx);
    this.cLeaves.push(leaf);
    this.cSib.push(this.storage.proof(idx));
    return BigInt(leaf);
  }

  private opAt(pc: bigint): number {
    return pc >= BigInt(this.code.length) ? 0x00 : this.code[Number(pc)]!;
  }

  private byteAt(i: number): number {
    return i >= this.code.length ? 0 : this.code[i]!;
  }

  private isJumpDest(dest: bigint): boolean {
    if (dest >= BigInt(this.code.length)) return false;
    const d = Number(dest);
    let i = 0;
    while (i < this.code.length) {
      const op = this.code[i]!;
      if (i === d) return op === 0x5b;
      i += op >= 0x60 && op <= 0x7f ? op - 0x5f + 1 : 1;
    }
    return false;
  }
}

export function storageIndex(slot: bigint): bigint {
  return BigInt(keccak256(toHex(slot, {size: 32})));
}

function isBinary(op: number): boolean {
  return (
    (op >= 0x01 && op <= 0x07) ||
    (op >= 0x10 && op <= 0x14) ||
    (op >= 0x16 && op <= 0x18) ||
    (op >= 0x1a && op <= 0x1d)
  );
}

function apply2(op: number, a: bigint, b: bigint): bigint {
  switch (op) {
    case 0x01:
      return asUnsigned(a + b);
    case 0x02:
      return asUnsigned(a * b);
    case 0x03:
      return asUnsigned(a - b);
    case 0x04:
      return b === 0n ? 0n : a / b;
    case 0x05:
      return sdiv(a, b);
    case 0x06:
      return b === 0n ? 0n : a % b;
    case 0x07:
      return smod(a, b);
    case 0x10:
      return a < b ? 1n : 0n;
    case 0x11:
      return a > b ? 1n : 0n;
    case 0x12:
      return asSigned(a) < asSigned(b) ? 1n : 0n;
    case 0x13:
      return asSigned(a) > asSigned(b) ? 1n : 0n;
    case 0x14:
      return a === b ? 1n : 0n;
    case 0x16:
      return a & b;
    case 0x17:
      return a | b;
    case 0x18:
      return a ^ b;
    case 0x1a:
      return a >= 32n ? 0n : (b >> ((31n - a) * 8n)) & 0xffn;
    case 0x1b:
      return a >= 256n ? 0n : asUnsigned(b << a);
    case 0x1c:
      return a >= 256n ? 0n : b >> a;
    default: {
      // SAR — arithmetic shift, saturating to the sign bit past 255.
      const sb = asSigned(b);
      if (a >= 256n) return sb < 0n ? MASK : 0n;
      return asUnsigned(sb >> a);
    }
  }
}

function sdiv(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  const sa = asSigned(a);
  const sb = asSigned(b);
  if (sa === -(1n << 255n) && sb === -1n) return a;
  const q = sa / sb;
  // BigInt division truncates toward zero, which is what the EVM does. Stated because the
  // opposite convention would be a silent, rarely-hit divergence.
  return asUnsigned(q);
}

function smod(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  const sa = asSigned(a);
  const sb = asSigned(b);
  if (sa === -(1n << 255n) && sb === -1n) return 0n;
  return asUnsigned(sa % sb);
}

