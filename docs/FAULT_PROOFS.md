# KAURAX — Fault Proofs

> ## Read this before the rest
>
> **KAURAX does not have fault proofs over its own state transitions.**
>
> What exists is a working on-chain one-step verifier, a trace commitment scheme, and a
> dispute game that narrows a disagreement to a single instruction and resolves it by
> *executing that instruction on chain*. All of that is real, and none of it is wired to
> KAURAX's settlement, because it verifies the **KAURAX Verifiable Subset (KVS)** and KAURAX
> blocks are executed by `anvil` over the full EVM.
>
> Settlement disputes are still decided by a 2-of-3 multisig in `KauraxDisputeGame`.
>
> §9 states exactly what must change before that sentence can be rewritten.

---

## 1. Why the subset exists

KAURAX's execution engine is `anvil`, driven over JSON-RPC
(`blockchain/l3/src/engine/AnvilEngine.ts`). Nothing in this repository computes a state
root; the proposer reads one from `eth_getBlockByNumber`
([FAULT_PROOF_AUDIT.md](FAULT_PROOF_AUDIT.md), finding A-2).

A fault proof needs a state transition function that can be instrumented to emit a
per-instruction trace and re-executed one instruction at a time on chain. `anvil` can do
neither. Proving real KAURAX blocks therefore requires replacing the engine first — the
18–30 engineer-month path in [FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md).

So the machinery was built against an execution model that *can* be proved, chosen to be a
strict subset of the EVM rather than a new machine, so that closing the gap later means
extending coverage rather than starting again.

---

## 2. Execution model

The KVS is a single-frame EVM subset. Opcode bytes, stack semantics and static gas costs are
the EVM's for everything covered. Anything not covered **halts**; nothing is approximated.

### 2.1 Machine state

Ten fields, all committed:

| Field | Type | Meaning |
|---|---|---|
| `pc` | uint64 | Program counter |
| `gas` | uint64 | Gas remaining |
| `codeHash` | bytes32 | `keccak256(code)` |
| `stackRoot` | bytes32 | Merkle root, height 10 (1024 slots) |
| `stackSize` | uint16 | Items on the stack |
| `memRoot` | bytes32 | Merkle root over 32-byte words, height 16 |
| `memWords` | uint32 | Words of memory in use, as the EVM prices it |
| `storageRoot` | bytes32 | Merkle root, height 256, keyed by `keccak256(slot)` |
| `status` | uint8 | `RUNNING` `STOPPED` `REVERTED` `HALTED` |
| `halt` | uint8 | Halt reason when `status == HALTED` |

The commitment is `keccak256(abi.encode(...))` over those fields in that order —
`abi.encode`, not `encodePacked`, because packing adjacent short integers is ambiguous and
two different states must never hash alike.

### 2.2 Stack

1024 slots, the EVM's limit. Reads and writes go through Merkle proofs.

**Invariant: every slot at or above `stackSize` holds zero.** A pop clears the slot it read;
a push proves the destination was empty before writing. Without this a prover could push a
value an earlier pop was supposed to have discarded.

Underflow and overflow are halts, not wraps.

### 2.3 Memory

Byte-addressed, as in the EVM, **but only at 32-byte boundaries**. An unaligned access halts
with `HALT_UNALIGNED_MEMORY`. An unaligned access would straddle two words and turn every
memory proof into two; refusing it keeps the commitment and the cost bounded. This is a
divergence from the EVM and is one of the things §8 lists as remaining work.

Expansion is priced with the EVM's own formula, `3w + w²/512`, charged as a delta. Memory is
capped at 2¹⁶ words; beyond that is `HALT_MEMORY_OUT_OF_RANGE`.

### 2.4 Storage

A flat map from `uint256` slot to `uint256` value, committed as a height-256 tree keyed by
the bits of `keccak256(abi.encode(slot))`. Proofs are 256 siblings, most of them zero hashes.

**This is not the Ethereum Merkle-Patricia Trie, and it is not a state root over accounts.**
There is one storage space, belonging to one implicit contract. Bridging to the MPT is §9.

### 2.5 Gas

Static costs match the EVM. Two documented divergences, both charging **more**:

1. **No EIP-2929 warm/cold tracking.** Every `SLOAD` is priced cold (2100); every `SSTORE`
   is priced as a cold write (20000 fresh / 2900 overwrite). Access lists would add a fourth
   committed structure for no gain in what the verifier proves.
2. **No `SSTORE` refunds.** Refunds are transaction-level accounting, and the subset models
   a single frame with no transaction around it.

Gas is part of the state commitment, so a wrong gas figure loses a dispute exactly as a wrong
storage value does. `test_invalidGasAccountingLoses` is that case.

### 2.6 Opcodes covered

| Opcodes | Gas |
|---|---|
| `STOP` | 0 |
| `ADD` `SUB` | 3 |
| `MUL` `DIV` `SDIV` `MOD` `SMOD` | 5 |
| `ADDMOD` `MULMOD` | 8 |
| `LT` `GT` `SLT` `SGT` `EQ` `ISZERO` | 3 |
| `AND` `OR` `XOR` `NOT` `BYTE` `SHL` `SHR` `SAR` | 3 |
| `KECCAK256` | 30 + 6/word + expansion |
| `POP` | 2 |
| `MLOAD` `MSTORE` | 3 + expansion |
| `SLOAD` | 2100 |
| `SSTORE` | 20000 fresh / 2900 overwrite |
| `JUMP` | 8 |
| `JUMPI` | 10 |
| `PC` `MSIZE` `GAS` | 2 |
| `JUMPDEST` | 1 |
| `PUSH0` | 2 |
| `PUSH1`–`PUSH32` | 3 |
| `DUP1`–`DUP16` `SWAP1`–`SWAP16` | 3 |
| `RETURN` `REVERT` | expansion only |
| `INVALID` | consumes all gas |

Semantics follow the EVM including its edge cases: division and modulus by zero yield zero
rather than halting; `SDIV(INT256_MIN, -1)` returns `INT256_MIN`; shifts of 256 or more
produce zero, except `SAR`, which saturates to the sign bit; arithmetic wraps.

Jump destinations are validated by scanning the code and skipping `PUSH` immediates, so a
jump into immediate data is `HALT_INVALID_JUMP` — `test_stepProofForTheWrongStepIsRejected`
and the `halt-invalid-jump-into-push-data` fixture cover it.

### 2.7 Not covered — halts, never approximated

`CALL` `CALLCODE` `DELEGATECALL` `STATICCALL` · `CREATE` `CREATE2` · `LOG0`–`LOG4` ·
`SELFDESTRUCT` · every environment opcode (`ADDRESS` `BALANCE` `CALLER` `CALLVALUE`
`CALLDATA*` `CODE*` `EXTCODE*` `BLOCKHASH` `COINBASE` `TIMESTAMP` `NUMBER` `CHAINID`
`SELFBALANCE` …) · `RETURNDATASIZE` `RETURNDATACOPY` · `EXP` `SIGNEXTEND` · `MSTORE8` ·
`MCOPY` `TLOAD` `TSTORE` · all precompiles.

Anything in that list produces `HALT_UNSUPPORTED_OPCODE`. `INVALID` (`0xFE`) is separate:
`HALT_INVALID_OPCODE`, because a program deliberately reaching `INVALID` is not the same
event as a program straying outside the subset.

**Returndata**: there are no calls, so there is no returndata to model. `RETURN` and `REVERT`
pop and price their `(offset, size)` range but the contents are not committed — nothing in a
single frame can observe them.

### 2.8 Exceptional halts

`STACK_UNDERFLOW` `STACK_OVERFLOW` `OUT_OF_GAS` `INVALID_JUMP` `INVALID_OPCODE`
`UNSUPPORTED_OPCODE` `UNALIGNED_MEMORY` `MEMORY_OUT_OF_RANGE`.

A halt discards the frame's work: gas goes to zero and **the committed roots are those the
step began with**. Both implementations build the halted state from the untouched pre-state,
so a prover cannot smuggle partial mutations through by arranging to fail late.

---

## 3. Traces and commitments

A trace is the sequence of states a program passes through. `states[0]` is the start;
`states[i]` is the state after `i` instructions. The commitment is a Merkle root over the
state hashes.

**Padding is the terminal state, not zero.** A tree needs a power-of-two leaf count. Zero
padding would commit to states no execution can produce, and a dispute landing in the padding
could be won by anyone willing to claim anything about it. Repeating the terminal state works
because a terminal machine is its own successor — asking the verifier to step a finished
machine returns the same state — so a dispute in the padding resolves exactly as one on the
last real instruction.

---

## 4. The dispute protocol

`KauraxFaultDisputeGame`.

1. **`postClaim(start, end, length)`** — a proposer asserts that executing `length` units
   from `start` ends at `end`, and bonds it.
2. **`challenge(claimId)`** — anyone disagrees, and bonds that.
3. **`defend(gameId, midClaim)`** — the proposer states its claim at the midpoint.
4. **`dispute(gameId, agreeWithMid)`** — the challenger says whether it agrees.
5. When a level narrows to one unit, **`descend(gameId, subLength)`** moves down a level.
6. At the bottom, **`proveStep(gameId, proof)`** runs the instruction. Permissionless.

### 4.1 The invariant that makes it converge

> The parties **agree** on the state at `lo` and **disagree** about the state at `hi`.

Agreement moves `lo` up; disagreement moves `hi` down. The invariant survives either way, so
the leaf is always a transition with an agreed pre-state and a disputed post-state — exactly
the verifier's input.

The existing `KauraxDisputeGame` has no such structure: the challenger picks a half without
committing to a counter-claim, and `midClaim` is overwritten each round. That is workable for
a human arbiter and useless for a verifier, which is why this is a new contract rather than
an added function ([FAULT_PROOF_AUDIT.md](FAULT_PROOF_AUDIT.md), finding A-3).

### 4.2 Levels

`BLOCK → TRANSACTION → STEP`. "Execution segment" in the usual description is the
intermediate bisection state inside a level, not a fourth mechanism.

### 4.3 Why the declared sub-length is not security-critical

It looks as though a proposer could cheat by lying about how many sub-units a unit contains.
It cannot:

- **too small** → the verifier disagrees at the leaf and the proposer loses;
- **too large** → the extra positions are the trace's terminal self-loop, which the verifier
  handles identically;
- **absurd** → refused by `MAX_SUB_LENGTH` (2⁴⁰), which bounds griefing, not soundness.

Whatever the length, the single instruction the game ends on decides the outcome.

---

## 5. The one-step verifier

`KauraxOneStepVerifier.step(preHash, proof) → postHash`.

It checks the proof's pre-state hashes to `preHash`; checks the code against `codeHash`;
decodes the instruction at `pc`; charges gas; executes; returns the new commitment. It
consults no oracle, trusts no signature, and has no privileged caller. Identical inputs give
identical output to everyone.

### 5.1 Soundness sketch

Every committed structure is a Merkle tree, and the only way to change one is
`KVSMerkle.update`, which **proves the prior leaf before returning the new root**. A prover
cannot invent a stack item, a memory word or a storage value: it must exhibit the value
already committed. Combined with the stack invariant of §2.2, the reachable post-states from
a given pre-state are exactly one.

### 5.2 Measured gas

From `test_stepVerificationStaysInsideTheGasBudget`, on a program that adds, stores and
reloads:

| Instruction | Gas |
|---|---|
| `STOP` | 7,940 |
| `PUSH1` | ~19,200 |
| `ADD` | 36,367 |
| `SLOAD` | 137,987 |
| `SSTORE` | 233,249 |

Execution only. A storage proof is 256 siblings — 8 KB of calldata, roughly 128,000 gas more
at 16 gas/byte. Worst observed total stays well inside the 5,000,000 budget, and the test
fails if it stops doing so. Bitmap-compressing the zero siblings would cut a typical storage
proof to a handful of hashes; it is not implemented, and §8 says so.

---

## 6. How the two implementations are held together

`packages/kvs` (TypeScript) and `blockchain/contracts/src/kvs` (Solidity) implement the same
model. **Neither is the reference.** `test/fixtures/kvs-differential.hex` carries 404 step
cases produced by the emulator; `KVSVerifier.t.sol` requires the verifier to reproduce every
one. A mismatch names the case and implicates both.

This is not decoration. The one genuine soundness bug in this work was found by it: the
verifier read the prior storage value to *price* an `SSTORE` before proving it, so a prover
could supply a fabricated prior value and change whether the step ran out of gas. The
`halt-out-of-gas-on-sstore` case caught it.

The corpus is seeded, so regenerating on a clean checkout is byte-identical and a diff means
a semantic change. `KVS_FIXTURE_PROGRAMS=2000 pnpm --filter @kaurax/kvs fixtures` runs a
deeper campaign.

---

## 7. Attack model

| Attack | Outcome |
|---|---|
| Proposer commits a wrong final state | Bisection reaches the wrong instruction; the verifier contradicts it; proposer loses both bonds |
| Proposer fabricates a stack, memory or storage value | `KVSMerkle.update` cannot prove it; the call reverts; the proposer cannot win this way |
| Proposer lies about sub-length | §4.3 — the leaf still decides |
| Proposer answers midpoints inconsistently | Each answer is binding; the challenger narrows toward whichever half is wrong |
| Proposer abandons the game | Timeout; challenger wins |
| Challenger opens a baseless game | The verifier confirms the proposer; challenger loses its bond |
| Challenger abandons | Timeout; proposer wins |
| Challenger opens parallel games to exhaust a proposer | One game per claim; a second `challenge` reverts |
| Proposer challenges its own claim to occupy the slot | Refused: `NotChallenger` |
| Winner is a contract that rejects ETH | Settlement credits, it does not push. Only that party's own `withdraw` fails |
| Re-entrancy during settlement | State is written and bonds zeroed before any transfer; a re-entrant call finds the game settled |
| Replaying a settled game | `AlreadySettled` on both `proveStep` and `resolveTimeout` |
| Reusing a step proof for a different step | The pre-state hash will not match; `PreStateMismatch` |
| Reusing a Merkle proof at another tree height | Every height has a distinct zero root, and the index range is checked |

### 7.1 Where it is weak, stated plainly

**Nobody submits the step proof.** At the leaf, if no proof arrives before the deadline, the
claim stands and the proposer wins. Submission is permissionless, so a challenger who was
right could always have ended the game itself — but a challenger that is censored, out of
funds, or simply absent loses a dispute it should have won. Mitigated, not eliminated.

**A challenger can stall a claim.** A challenger willing to move at the last moment of every
round can hold a claim open for roughly `rounds × RESPONSE_TIMEOUT`. With three levels and a
large declared length that is tens of timeouts. It costs the challenger its bond if it is
wrong, but the delay is real.

**Bond sizing is not analysed here.** Whether the bonds make griefing uneconomic depends on
values chosen at deployment. No claim is made that any particular figure is correct.

---

## 8. Known limitations

1. **Not connected to KAURAX settlement.** By design; §9.
2. **A subset, not the EVM.** No calls, no creates, no logs, no precompiles, no environment,
   single frame.
3. **Storage is a flat map, not the MPT.** No accounts, balances, nonces or code storage.
4. **Memory must be 32-byte aligned.**
5. **Code travels whole in every proof.** Sound but not scalable; a Merkleized code
   commitment is the fix.
6. **Storage proofs are uncompressed** — 256 siblings each.
7. **No preimage oracle.** Nothing here needs one yet; a real system does.
8. **No external audit.** None commissioned.
9. **Gas diverges from EIP-2929** in the documented, conservative direction.

---

## 9. What must change before KAURAX has fault proofs

In dependency order:

1. **An execution engine that can be instrumented.** `anvil` over JSON-RPC cannot emit
   per-instruction traces. This is the blocker, and it is the largest item.
2. **Output roots that commit to a trace.** Today an output root is
   `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` — nothing about execution.
   Until a trace root is inside it, a game about a trace says nothing about an output root,
   which is why the two are not wired together.
3. **Full opcode coverage**, including calls and creates, which brings multiple frames.
4. **An account/MPT state model** replacing the flat storage map.
5. **A preimage oracle**, once proofs stop carrying everything they need.
6. **A challenger agent** that detects a bad root and plays the game unassisted.
7. **An external audit**, then removal of the guardian path from `KauraxDisputeGame`.

Only after 7 may KAURAX describe its output roots as trustless. Items 1–6 do not earn that
word, and [MILESTONES.md](grants/MILESTONES.md) says so in the same terms.

---

## 10. Reproducing all of it

```bash
pnpm --filter @kaurax/kvs test        # 29 tests: model, commitments, determinism
pnpm --filter @kaurax/kvs fixtures    # regenerate both fixtures, deterministically
cd blockchain/contracts && forge test --match-path 'test/KVS*'
```

Source: `packages/kvs/`, `blockchain/contracts/src/kvs/`,
`blockchain/contracts/src/dispute/KauraxFaultDisputeGame.sol`.
