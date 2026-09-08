// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KVSTypes} from "./KVSTypes.sol";
import {KVSMerkle} from "./KVSMerkle.sol";
import {KVSGas} from "./KVSGas.sol";

/// @title KauraxOneStepVerifier
/// @notice Executes exactly one instruction of the KAURAX Verifiable Subset and returns the
///         resulting machine state commitment.
///
/// @dev ─────────────────────────────────────────────────────────────────────────────────
///      WHAT THIS IS. Given a committed pre-state and the minimum data that state's next
///      instruction touches, this contract *runs that instruction* and returns the post-state
///      commitment. It consults no oracle, trusts no signature, and has no privileged caller.
///      The proposer and the challenger are irrelevant to it: identical inputs give identical
///      output for anyone.
///
///      WHAT THIS IS NOT. The KVS is a strict subset of the EVM — same opcode bytes, same
///      stack semantics, same static gas for what it covers — but it is not the EVM, and
///      KAURAX blocks are not executed on it. KAURAX's execution engine is `anvil` over the
///      full EVM. So this verifier cannot today adjudicate a dispute about a real KAURAX
///      block, and KAURAX does not have fault proofs for its own state transitions. That gap
///      is the subject of docs/FAULT_PROOFS.md, which names it rather than hiding it.
///
///      SOUNDNESS SKETCH. Every committed structure is a Merkle tree, and the only way to
///      change one is `KVSMerkle.update`, which proves the prior leaf before returning the
///      new root. A prover therefore cannot invent a stack item, a memory word or a storage
///      value: it must exhibit the value that was already committed. Slots above `stackSize`
///      are held at zero by clearing on every pop, so a push proves the slot was empty and a
///      stale value cannot be resurrected.
///      ─────────────────────────────────────────────────────────────────────────────────
contract KauraxOneStepVerifier {
    using KVSTypes for KVSTypes.MachineState;

    /// @notice Everything one instruction can need, and nothing else.
    ///
    /// @dev The leaf arrays are consumed in access order. A proof with the wrong number of
    ///      entries reverts on out-of-bounds rather than being interpreted loosely.
    struct StepProof {
        KVSTypes.MachineState pre;
        /// @dev Checked against `pre.codeHash`. Passing the whole program bounds program
        ///      size by calldata; a Merkleized code commitment is the scaling path and is
        ///      named as future work rather than pretended here.
        bytes code;
        bytes32[] stackLeaves;
        bytes32[][] stackSiblings;
        bytes32[] memLeaves;
        bytes32[][] memSiblings;
        bytes32[] storageLeaves;
        bytes32[][] storageSiblings;
    }

    /// @dev Mutable working state. A memory struct rather than locals, because the dispatch
    ///      below would otherwise exceed the stack limit.
    struct Ctx {
        KVSTypes.MachineState st;
        uint256 sCur;
        uint256 mCur;
        uint256 cCur;
    }

    error PreStateMismatch(bytes32 expected, bytes32 computed);
    error CodeMismatch(bytes32 expected, bytes32 computed);
    error BadStackProof(uint256 index);
    error BadMemoryProof(uint256 index);
    error BadStorageProof(uint256 index);

    // ------------------------------------------------------------------ entry --

    /// @notice Run one instruction.
    /// @param _preHash Commitment to the state the instruction starts from.
    /// @return postHash Commitment to the state it ends in.
    ///
    /// @dev A terminal state is its own successor. Traces are padded to a power of two so
    ///      they can be Merkleized, and padding must not be a state the prover picks freely.
    function step(bytes32 _preHash, StepProof calldata _p) external pure returns (bytes32 postHash) {
        KVSTypes.MachineState memory pre = _p.pre;

        bytes32 computed = KVSTypes.hashState(pre);
        if (computed != _preHash) revert PreStateMismatch(_preHash, computed);

        if (KVSTypes.isTerminal(pre)) return _preHash;

        bytes32 codeHash = keccak256(_p.code);
        if (codeHash != pre.codeHash) revert CodeMismatch(pre.codeHash, codeHash);

        Ctx memory c = Ctx({st: pre, sCur: 0, mCur: 0, cCur: 0});
        uint8 reason = _execute(c, _p);

        if (reason != KVSTypes.HALT_NONE) {
            // An exceptional halt discards the frame's work. The committed result is built
            // from the untouched pre-state, so a prover cannot smuggle partial mutations
            // through by arranging to fail late.
            KVSTypes.MachineState memory h = _p.pre;
            h.status = KVSTypes.HALTED;
            h.halt = reason;
            h.gas = 0;
            return KVSTypes.hashState(h);
        }
        return KVSTypes.hashState(c.st);
    }

    /// @notice Convenience for callers assembling a genesis or expected state off chain.
    function hashState(KVSTypes.MachineState calldata _s) external pure returns (bytes32) {
        return KVSTypes.hashState(_s);
    }

    /// @notice Stated on chain so an integrator cannot mistake what this covers.
    function coverage() external pure returns (string memory) {
        return "EVM subset: arithmetic, comparison, bitwise, KECCAK256, stack, aligned memory, "
            "storage, jumps, PUSH/DUP/SWAP, RETURN/REVERT/INVALID. No CALL, CREATE, LOG, "
            "precompiles, external environment, returndata or transaction context. Single frame. "
            "Storage is a flat map, not the Ethereum MPT. See docs/FAULT_PROOFS.md";
    }

    // -------------------------------------------------------------- dispatch --

    function _execute(Ctx memory c, StepProof calldata p) private pure returns (uint8) {
        uint8 op = _opAt(p.code, c.st.pc);

        if (op == 0x00) {
            // STOP. Costs nothing, ends the frame.
            c.st.status = KVSTypes.STOPPED;
            return KVSTypes.HALT_NONE;
        }
        if (op == 0xFE) return KVSTypes.HALT_INVALID_OPCODE;

        // Binary arithmetic / comparison / bitwise: two in, one out.
        if (_isBinary(op)) return _binary(c, p, op);
        // ISZERO and NOT: one in, one out.
        if (op == 0x15 || op == 0x19) return _unary(c, p, op);
        // ADDMOD, MULMOD: three in, one out.
        if (op == 0x08 || op == 0x09) return _ternary(c, p, op);

        if (op == 0x20) return _keccak(c, p);
        if (op == 0x50) return _pop_(c, p);
        if (op == 0x51 || op == 0x52) return _memory(c, p, op);
        if (op == 0x54 || op == 0x55) return _storage(c, p, op);
        if (op == 0x56 || op == 0x57) return _jump(c, p, op);
        if (op == 0x58 || op == 0x59 || op == 0x5A) return _context(c, p, op);
        if (op == 0x5B) return _jumpdest(c);
        if (op == 0x5F || (op >= 0x60 && op <= 0x7F)) return _pushOp(c, p, op);
        if (op >= 0x80 && op <= 0x8F) return _dup(c, p, op);
        if (op >= 0x90 && op <= 0x9F) return _swap(c, p, op);
        if (op == 0xF3 || op == 0xFD) return _terminate(c, p, op);

        // Everything else — CALL, CREATE, LOG, precompiles, environment, returndata — is
        // outside the subset. It halts rather than being approximated, so a program that
        // strays outside what the verifier can prove fails loudly.
        return KVSTypes.HALT_UNSUPPORTED_OPCODE;
    }

    // ------------------------------------------------------------ opcode groups --

    function _isBinary(uint8 _op) private pure returns (bool) {
        return (_op >= 0x01 && _op <= 0x07) // ADD MUL SUB DIV SDIV MOD SMOD
            || (_op >= 0x10 && _op <= 0x14) // LT GT SLT SGT EQ
            || (_op >= 0x16 && _op <= 0x18) // AND OR XOR
            || (_op >= 0x1A && _op <= 0x1D); // BYTE SHL SHR SAR
    }

    function _binary(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        if (c.st.stackSize < 2) return KVSTypes.HALT_STACK_UNDERFLOW;
        uint64 cost = (op >= 0x02 && op <= 0x07) ? KVSGas.LOW : KVSGas.VERYLOW;
        if (op == 0x01 || op == 0x03) cost = KVSGas.VERYLOW;
        if (!_charge(c, cost)) return KVSTypes.HALT_OUT_OF_GAS;

        uint256 a = _pop(c, p);
        uint256 b = _pop(c, p);
        _push(c, p, _apply2(op, a, b));
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _unary(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        if (c.st.stackSize < 1) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, KVSGas.VERYLOW)) return KVSTypes.HALT_OUT_OF_GAS;
        uint256 a = _pop(c, p);
        unchecked {
            _push(c, p, op == 0x15 ? (a == 0 ? 1 : 0) : ~a);
        }
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _ternary(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        if (c.st.stackSize < 3) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, KVSGas.MID)) return KVSTypes.HALT_OUT_OF_GAS;
        uint256 a = _pop(c, p);
        uint256 b = _pop(c, p);
        uint256 n = _pop(c, p);
        uint256 r;
        if (n == 0) {
            r = 0; // The EVM defines modulus by zero as zero here, not as a halt.
        } else if (op == 0x08) {
            r = addmod(a, b, n);
        } else {
            r = mulmod(a, b, n);
        }
        _push(c, p, r);
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _pop_(Ctx memory c, StepProof calldata p) private pure returns (uint8) {
        if (c.st.stackSize < 1) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, KVSGas.BASE)) return KVSTypes.HALT_OUT_OF_GAS;
        _pop(c, p);
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _context(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        if (c.st.stackSize >= 1024) return KVSTypes.HALT_STACK_OVERFLOW;
        if (!_charge(c, KVSGas.BASE)) return KVSTypes.HALT_OUT_OF_GAS;
        uint256 v;
        if (op == 0x58) v = c.st.pc; // PC — the value before the increment, as the EVM does
        else if (op == 0x59) v = uint256(c.st.memWords) * 32; // MSIZE
        else v = c.st.gas; // GAS — remaining after this instruction's own cost
        _push(c, p, v);
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _jumpdest(Ctx memory c) private pure returns (uint8) {
        if (!_charge(c, KVSGas.JUMPDEST)) return KVSTypes.HALT_OUT_OF_GAS;
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _pushOp(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        if (c.st.stackSize >= 1024) return KVSTypes.HALT_STACK_OVERFLOW;
        uint256 n = op == 0x5F ? 0 : uint256(op) - 0x5F;
        if (!_charge(c, op == 0x5F ? KVSGas.BASE : KVSGas.VERYLOW)) return KVSTypes.HALT_OUT_OF_GAS;

        // Immediate bytes past the end of code read as zero, as they do in the EVM.
        uint256 v = 0;
        for (uint256 i = 0; i < n; i++) {
            v = (v << 8) | _byteAt(p.code, uint256(c.st.pc) + 1 + i);
        }
        _push(c, p, v);
        c.st.pc += uint64(1 + n);
        return KVSTypes.HALT_NONE;
    }

    function _dup(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        uint256 n = uint256(op) - 0x7F; // DUP1 -> 1
        if (c.st.stackSize < n) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (c.st.stackSize >= 1024) return KVSTypes.HALT_STACK_OVERFLOW;
        if (!_charge(c, KVSGas.VERYLOW)) return KVSTypes.HALT_OUT_OF_GAS;
        uint256 v = _peek(c, p, n - 1);
        _push(c, p, v);
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _swap(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        uint256 n = uint256(op) - 0x8F; // SWAP1 -> 1
        if (c.st.stackSize < n + 1) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, KVSGas.VERYLOW)) return KVSTypes.HALT_OUT_OF_GAS;
        uint256 top = _peek(c, p, 0);
        uint256 deep = _peek(c, p, n);
        _writeAt(c, p, 0, deep);
        _writeAt(c, p, n, top);
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _jump(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        uint256 need = op == 0x56 ? 1 : 2;
        if (c.st.stackSize < need) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, op == 0x56 ? KVSGas.MID : KVSGas.HIGH)) return KVSTypes.HALT_OUT_OF_GAS;

        uint256 dest = _pop(c, p);
        bool take = true;
        if (op == 0x57) take = _pop(c, p) != 0;

        if (!take) {
            c.st.pc += 1;
            return KVSTypes.HALT_NONE;
        }
        if (!_isJumpDest(p.code, dest)) return KVSTypes.HALT_INVALID_JUMP;
        c.st.pc = uint64(dest);
        return KVSTypes.HALT_NONE;
    }

    function _terminate(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        // RETURN and REVERT take (offset, size). The subset has no caller to hand data
        // back to, so the range is popped and priced but its contents are not modelled;
        // docs/FAULT_PROOFS.md states this rather than leaving it to be discovered.
        if (c.st.stackSize < 2) return KVSTypes.HALT_STACK_UNDERFLOW;
        uint256 off = _pop(c, p);
        uint256 size = _pop(c, p);
        if (size > 0) {
            if (off % 32 != 0 || size % 32 != 0) return KVSTypes.HALT_UNALIGNED_MEMORY;
            uint256 endWord = (off / 32) + (size / 32);
            if (endWord > (uint256(1) << KVSTypes.MEMORY_HEIGHT)) return KVSTypes.HALT_MEMORY_OUT_OF_RANGE;
            if (!_chargeExpansion(c, endWord)) return KVSTypes.HALT_OUT_OF_GAS;
        }
        c.st.status = op == 0xF3 ? KVSTypes.STOPPED : KVSTypes.REVERTED;
        return KVSTypes.HALT_NONE;
    }

    // --------------------------------------------------------- memory & storage --

    function _memory(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        uint256 need = op == 0x51 ? 1 : 2;
        if (c.st.stackSize < need) return KVSTypes.HALT_STACK_UNDERFLOW;
        if (!_charge(c, KVSGas.VERYLOW)) return KVSTypes.HALT_OUT_OF_GAS;

        uint256 off = _pop(c, p);
        // The subset addresses memory by byte offset, as the EVM does, but only at word
        // boundaries. An unaligned access would span two words and turn every memory proof
        // into two; refusing it keeps the committed structure honest and the cost bounded.
        if (off % 32 != 0) return KVSTypes.HALT_UNALIGNED_MEMORY;
        uint256 word = off / 32;
        if (word >= (uint256(1) << KVSTypes.MEMORY_HEIGHT)) return KVSTypes.HALT_MEMORY_OUT_OF_RANGE;
        if (!_chargeExpansion(c, word + 1)) return KVSTypes.HALT_OUT_OF_GAS;

        if (op == 0x51) {
            uint256 v = _memRead(c, p, word);
            if (c.st.stackSize >= 1024) return KVSTypes.HALT_STACK_OVERFLOW;
            _push(c, p, v);
        } else {
            uint256 v = _pop(c, p);
            _memWrite(c, p, word, v);
        }
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _keccak(Ctx memory c, StepProof calldata p) private pure returns (uint8) {
        if (c.st.stackSize < 2) return KVSTypes.HALT_STACK_UNDERFLOW;
        uint256 off = _peek(c, p, 0);
        uint256 size = _peek(c, p, 1);
        if (off % 32 != 0 || size % 32 != 0) return KVSTypes.HALT_UNALIGNED_MEMORY;

        uint256 words = size / 32;
        uint256 endWord = (off / 32) + words;
        if (endWord > (uint256(1) << KVSTypes.MEMORY_HEIGHT)) return KVSTypes.HALT_MEMORY_OUT_OF_RANGE;
        if (!_charge(c, KVSGas.KECCAK256_BASE + KVSGas.KECCAK256_WORD * uint64(words))) {
            return KVSTypes.HALT_OUT_OF_GAS;
        }
        if (words > 0 && !_chargeExpansion(c, endWord)) return KVSTypes.HALT_OUT_OF_GAS;

        _pop(c, p);
        _pop(c, p);

        bytes memory data = new bytes(size);
        for (uint256 i = 0; i < words; i++) {
            bytes32 w = bytes32(_memRead(c, p, (off / 32) + i));
            for (uint256 j = 0; j < 32; j++) {
                data[i * 32 + j] = w[j];
            }
        }
        _push(c, p, uint256(keccak256(data)));
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    function _storage(Ctx memory c, StepProof calldata p, uint8 op) private pure returns (uint8) {
        uint256 need = op == 0x54 ? 1 : 2;
        if (c.st.stackSize < need) return KVSTypes.HALT_STACK_UNDERFLOW;

        if (op == 0x54) {
            if (!_charge(c, KVSGas.SLOAD)) return KVSTypes.HALT_OUT_OF_GAS;
            uint256 slot = _pop(c, p);
            uint256 v = _storageRead(c, p, slot);
            _push(c, p, v);
        } else {
            uint256 slot = _peek(c, p, 0);
            uint256 idx = uint256(keccak256(abi.encode(slot)));
            bytes32 old = p.storageLeaves[c.cCur];

            // The prior value must be PROVED before it is used, because it decides the
            // price: a fresh slot costs SSTORE_SET and an occupied one SSTORE_RESET, and
            // that difference decides whether this step runs out of gas. Reading the leaf
            // and pricing from it without checking the proof first let a prover choose the
            // cheaper branch — and therefore the step's outcome — by supplying a value that
            // was never in the tree. The differential corpus caught it on
            // `halt-out-of-gas-on-sstore`.
            bytes32 computed = KVSMerkle.computeRoot(old, idx, p.storageSiblings[c.cCur]);
            if (computed != c.st.storageRoot) revert BadStorageProof(c.cCur);

            if (!_charge(c, old == bytes32(0) ? KVSGas.SSTORE_SET : KVSGas.SSTORE_RESET)) {
                return KVSTypes.HALT_OUT_OF_GAS;
            }
            _pop(c, p);
            uint256 v = _pop(c, p);
            c.st.storageRoot = KVSMerkle.computeRoot(bytes32(v), idx, p.storageSiblings[c.cCur]);
            c.cCur++;
        }
        c.st.pc += 1;
        return KVSTypes.HALT_NONE;
    }

    // ---------------------------------------------------------------- helpers --

    function _charge(Ctx memory c, uint64 _amount) private pure returns (bool) {
        if (c.st.gas < _amount) return false;
        c.st.gas -= _amount;
        return true;
    }

    function _chargeExpansion(Ctx memory c, uint256 _neededWords) private pure returns (bool) {
        uint256 extra = KVSGas.expansionCost(c.st.memWords, _neededWords);
        if (extra > type(uint64).max || !_charge(c, uint64(extra))) return false;
        if (_neededWords > c.st.memWords) c.st.memWords = uint32(_neededWords);
        return true;
    }

    function _pop(Ctx memory c, StepProof calldata p) private pure returns (uint256) {
        uint256 idx = uint256(c.st.stackSize) - 1;
        bytes32 leaf = p.stackLeaves[c.sCur];
        c.st.stackRoot = KVSMerkle.update(c.st.stackRoot, idx, leaf, bytes32(0), p.stackSiblings[c.sCur]);
        c.sCur++;
        c.st.stackSize = uint16(idx);
        return uint256(leaf);
    }

    /// @dev Proves the destination slot is empty before writing. That is what keeps the
    ///      invariant "every slot at or above stackSize is zero", which in turn is what
    ///      stops a prover reusing a value an earlier pop was supposed to have discarded.
    function _push(Ctx memory c, StepProof calldata p, uint256 _v) private pure {
        uint256 idx = c.st.stackSize;
        c.st.stackRoot =
            KVSMerkle.update(c.st.stackRoot, idx, bytes32(0), bytes32(_v), p.stackSiblings[c.sCur]);
        c.sCur++;
        c.st.stackSize = uint16(idx + 1);
    }

    function _peek(Ctx memory c, StepProof calldata p, uint256 _depth) private pure returns (uint256) {
        uint256 idx = uint256(c.st.stackSize) - 1 - _depth;
        bytes32 leaf = p.stackLeaves[c.sCur];
        if (KVSMerkle.computeRoot(leaf, idx, p.stackSiblings[c.sCur]) != c.st.stackRoot) {
            revert BadStackProof(c.sCur);
        }
        c.sCur++;
        return uint256(leaf);
    }

    function _writeAt(Ctx memory c, StepProof calldata p, uint256 _depth, uint256 _v) private pure {
        uint256 idx = uint256(c.st.stackSize) - 1 - _depth;
        bytes32 leaf = p.stackLeaves[c.sCur];
        c.st.stackRoot = KVSMerkle.update(c.st.stackRoot, idx, leaf, bytes32(_v), p.stackSiblings[c.sCur]);
        c.sCur++;
    }

    function _memRead(Ctx memory c, StepProof calldata p, uint256 _word) private pure returns (uint256) {
        bytes32 leaf = p.memLeaves[c.mCur];
        if (KVSMerkle.computeRoot(leaf, _word, p.memSiblings[c.mCur]) != c.st.memRoot) {
            revert BadMemoryProof(c.mCur);
        }
        c.mCur++;
        return uint256(leaf);
    }

    function _memWrite(Ctx memory c, StepProof calldata p, uint256 _word, uint256 _v) private pure {
        bytes32 leaf = p.memLeaves[c.mCur];
        c.st.memRoot = KVSMerkle.update(c.st.memRoot, _word, leaf, bytes32(_v), p.memSiblings[c.mCur]);
        c.mCur++;
    }

    function _storageRead(Ctx memory c, StepProof calldata p, uint256 _slot) private pure returns (uint256) {
        uint256 idx = uint256(keccak256(abi.encode(_slot)));
        bytes32 leaf = p.storageLeaves[c.cCur];
        if (KVSMerkle.computeRoot(leaf, idx, p.storageSiblings[c.cCur]) != c.st.storageRoot) {
            revert BadStorageProof(c.cCur);
        }
        c.cCur++;
        return uint256(leaf);
    }

    function _opAt(bytes calldata _code, uint64 _pc) private pure returns (uint8) {
        // Running off the end of code is STOP, not a halt. That is the EVM's rule and
        // programs rely on it.
        return _pc >= _code.length ? 0x00 : uint8(_code[_pc]);
    }

    function _byteAt(bytes calldata _code, uint256 _i) private pure returns (uint256) {
        return _i >= _code.length ? 0 : uint256(uint8(_code[_i]));
    }

    /// @dev A jump destination must be a JUMPDEST opcode that is not immediate data of a
    ///      PUSH. Scanning the code is the only way to know, and the verifier holds it.
    function _isJumpDest(bytes calldata _code, uint256 _dest) private pure returns (bool) {
        if (_dest >= _code.length) return false;
        uint256 i = 0;
        while (i < _code.length) {
            uint8 op = uint8(_code[i]);
            if (i == _dest) return op == 0x5B;
            if (op >= 0x60 && op <= 0x7F) {
                i += uint256(op) - 0x5F + 1; // skip the immediate
            } else {
                i += 1;
            }
        }
        return false;
    }

    function _apply2(uint8 _op, uint256 a, uint256 b) private pure returns (uint256) {
        unchecked {
            if (_op == 0x01) return a + b;
            if (_op == 0x02) return a * b;
            if (_op == 0x03) return a - b;
            if (_op == 0x04) return b == 0 ? 0 : a / b;
            if (_op == 0x05) return _sdiv(a, b);
            if (_op == 0x06) return b == 0 ? 0 : a % b;
            if (_op == 0x07) return _smod(a, b);
            if (_op == 0x10) return a < b ? 1 : 0;
            if (_op == 0x11) return a > b ? 1 : 0;
            if (_op == 0x12) return int256(a) < int256(b) ? 1 : 0;
            if (_op == 0x13) return int256(a) > int256(b) ? 1 : 0;
            if (_op == 0x14) return a == b ? 1 : 0;
            if (_op == 0x16) return a & b;
            if (_op == 0x17) return a | b;
            if (_op == 0x18) return a ^ b;
            if (_op == 0x1A) return a >= 32 ? 0 : uint256(uint8(bytes32(b)[a]));
            if (_op == 0x1B) return a >= 256 ? 0 : b << a;
            if (_op == 0x1C) return a >= 256 ? 0 : b >> a;
            // SAR: arithmetic shift, saturating to the sign bit past 255.
            if (a >= 256) return int256(b) < 0 ? type(uint256).max : 0;
            return uint256(int256(b) >> a);
        }
    }

    function _sdiv(uint256 a, uint256 b) private pure returns (uint256) {
        if (b == 0) return 0;
        unchecked {
            // The one case where two's-complement division overflows: INT256_MIN / -1.
            if (int256(a) == type(int256).min && int256(b) == -1) return a;
            return uint256(int256(a) / int256(b));
        }
    }

    function _smod(uint256 a, uint256 b) private pure returns (uint256) {
        if (b == 0) return 0;
        unchecked {
            if (int256(a) == type(int256).min && int256(b) == -1) return 0;
            return uint256(int256(a) % int256(b));
        }
    }
}
