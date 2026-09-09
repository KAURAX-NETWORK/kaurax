# KAURAX — Fault Proof Gap Analysis

**Date:** 2026-09-09 · **Method:** read against source, not against documentation. Every file
and line reference was checked.

This document measures one distance: from **what settles KAURAX today** to **a fault proof
over KAURAX execution**. It is not a design document — `docs/FAULT_PROOF_SPEC.md` and
`docs/FAULT_PROOF_DESIGN.md` hold the design. It is an inventory of what is built, what is
missing, and what specifically prevents the built parts from being connected.

> **The one-line answer.** KAURAX has a complete, working, verifier-terminated fault proof
> machine — for a virtual machine that KAURAX does not run on. The gap is not the game, the
> bisection or the verifier. **The gap is that KAURAX's execution engine cannot produce a
> trace, and its output roots do not commit to one.**

---

## 1. Two dispute systems exist. Only one settles anything.

| | `KauraxDisputeGame` | `KauraxFaultDisputeGame` |
|---|---|---|
| File | `src/dispute/KauraxDisputeGame.sol` (542 lines) | `src/dispute/KauraxFaultDisputeGame.sol` (479 lines) |
| Narrows to | one **L3 block** | one **instruction** |
| Decided by | the guardian, a 2-of-3 multisig | `KauraxOneStepVerifier`, on chain |
| Referenced by | `KauraxL2OutputOracle.disputeGame` | **tests only** |
| Deployed by a script | yes | no |
| `isFaultProof()` | `false`, asserted by a test | — |
| Subject of the claim | a KAURAX output root | a KVS machine state |

`KauraxFaultDisputeGame` is not a stub, a sketch or a mock. It bisects across three levels
(`LEVEL_BLOCK` → `LEVEL_TRANSACTION` → `LEVEL_STEP`), terminates in `proveStep`, and is
covered by 35 tests including a full adversarial matrix. The verifier under it is 544 lines
of real opcode execution agreeing with a reference emulator on 404 differential cases.

**It is unwired on purpose**, and that is the correct decision. Connecting it today would
produce a contract that looks like a fault proof over KAURAX state while adjudicating claims
about something else.

---

## 2. State commitment model — the first structural blocker

### What KAURAX commits today

`Hashing.hashOutputRoot` (`src/libraries/Hashing.sol`) commits to four fields:

```
keccak256(abi.encode(version, stateRoot, withdrawalTreeRoot, latestBlockHash))
```

This is enough to prove **membership** — a withdrawal is in the tree — and that is why
withdrawals are genuinely trustless today. It is **not** enough to prove **execution**.
Nothing in that tuple says how the state root was reached, so there is no claim for a
verifier to contradict.

### What a fault proof requires

An output root must additionally commit to the execution that produced it — in practice a
fifth field, a trace root, or a redefinition of `stateRoot` as a claim over a trace. Both
implementations of the hashing must change together; they are pinned to shared vectors in
`blockchain/contracts/test/Hashing.t.sol` and `blockchain/l3/test/hashing.test.ts`, so the
pin will fail loudly when they do, which is the intended behaviour.

**Gap 1 — output roots do not commit to an execution trace.** Small in code, consensus-breaking
in effect: it changes the output root format, so it is a coordinated upgrade of the proposer,
the portal, the oracle and every published root.

---

## 3. Execution trace — the second and much larger structural blocker

### What the engine is

KAURAX's state transition function is **`anvil`, an external binary reached over JSON-RPC**.
The node sends transactions and reads back blocks and receipts. It cannot:

- emit a per-instruction trace of its own execution,
- be re-executed one instruction at a time,
- be asked what its memory, stack or gas were at instruction *i*,
- be replayed deterministically from a committed pre-state under a proof system.

That is not a configuration gap. A fault proof requires the STF to be an artefact the
protocol controls and can re-run inside a verifier's model. An RPC-attached general-purpose
node is the opposite of that.

**Gap 2 — the execution engine cannot produce a trace.** This is the finding. Everything
else in this document is downstream of it.

### What exists that a trace system would reuse

Genuinely reusable, and it is a substantial head start:

| Component | Where | Reusable as-is? |
|---|---|---|
| Trace commitment scheme | `packages/kvs/src/trace.ts` | **Yes** — including the padding rule |
| State hashing | `packages/kvs/src/state.ts`, `src/kvs/KVSTypes.sol` | Yes for the KVS field set; the field set itself must grow |
| Sparse Merkle tree | `packages/kvs/src/merkle.ts`, `src/kvs/KVSMerkle.sol` | **Yes** |
| Multi-level bisection | `src/dispute/KauraxFaultDisputeGame.sol` | **Yes** — levels are a constant list |
| One-step verifier harness | `src/kvs/KauraxOneStepVerifier.sol` | Structure yes; opcode coverage no |
| Differential test rig | `packages/kvs/scripts/generate-fixtures.ts` | **Yes** |
| Bonds, timeouts, settlement | both games | **Yes** |

The padding rule in `trace.ts` is worth singling out because it is the kind of detail that is
usually wrong: the tree pads with the **terminal state repeated**, not with zero leaves. Zero
padding would let a prover claim anything about the padded region, since no real state hashes
to zero. Repeating the terminal state means a bisection landing in the padding resolves
identically to one landing on the last real step — which is exactly what the verifier does
when asked to step a finished machine.

---

## 4. One-step verifier — built, and honestly scoped

`KauraxOneStepVerifier` executes exactly one instruction of the **KAURAX Verifiable Subset**
and returns the resulting state commitment. It consults no oracle, trusts no signature, and
has no privileged caller.

Its soundness rests on a property worth stating plainly: every committed structure is a
Merkle tree, and the only way to change one is `KVSMerkle.update`, which proves the prior leaf
before returning the new root. A prover therefore cannot invent a stack item, a memory word or
a storage value — it must exhibit the value that was already committed. Slots above
`stackSize` are held at zero by clearing on every pop, so a push proves the slot was empty and
a stale value cannot be resurrected.

### What the subset covers

47 opcode branches in Solidity, 18 dispatch groups in the reference emulator: arithmetic,
comparison, bitwise, `SHA3`, stack (`PUSH*` `DUP*` `SWAP*` `POP`), memory (`MLOAD` `MSTORE`
`MSIZE`), storage (`SLOAD` `SSTORE`), control flow (`JUMP` `JUMPI` `JUMPDEST` `PC`), and
termination (`STOP` `RETURN` `REVERT` `INVALID`). Identical opcode bytes, identical stack
semantics, identical static gas.

### What it does not cover — and this is the honest part

`CALL` `CALLCODE` `DELEGATECALL` `STATICCALL` · `CREATE` `CREATE2` · `LOG0`–`LOG4` ·
`SELFDESTRUCT` · every environment opcode · `RETURNDATASIZE` `RETURNDATACOPY` · `EXP`
`SIGNEXTEND` · `MSTORE8` · `MCOPY` `TLOAD` `TSTORE` · all precompiles.

Anything not covered **halts** — an explicit exceptional halt with a reason code, never a
silent approximation. That design choice is what makes the subset honest rather than
misleading.

**Gap 3 — the verifier covers a subset no real contract stays inside.** A contract that
cannot `CALL`, cannot `LOG`, cannot read `msg.sender` and cannot `CREATE` is not a contract
anybody deploys. Extending to the full EVM is the largest single body of work, and it is
where the 18–30 engineer-month estimate mostly lives:

- **Inter-contract calls** need a call stack in the machine state, with each frame committed.
- **Environment opcodes** need a block and transaction context committed in the pre-state.
- **`CREATE`/`CREATE2`** need code to become a committed, writable part of state.
- **Code access** needs a Merkleized code commitment. Today the whole program travels in the
  step proof and is checked against `codeHash`, which bounds program size by calldata — the
  contract's own NatSpec names this as future work rather than pretending otherwise.
- **Precompiles** each need an on-chain implementation or an equivalent proof.
- **`RETURNDATA*`** needs return data committed between frames.
- **Dynamic gas** — memory expansion, `SSTORE` refunds, access lists (EIP-2929), call stipends
  — needs the full cost model, not the static table in `KVSGas.sol`.

### The preimage oracle, which does not exist at all

A real one-step proof cannot carry the whole world in calldata. It needs an on-chain oracle
that, given a hash, can be shown the preimage — for code, for storage nodes, for return data.
Nothing in the repository implements one. `grep` for it returns nothing outside documentation.

**Gap 4 — no preimage oracle.**

---

## 5. Instruction-level bisection — already correct

This is the part that is genuinely finished, and it deserves credit rather than a milestone.

`KauraxFaultDisputeGame` maintains the invariant that makes bisection converge: the parties
**agree** on the state at `lo` and **disagree** about the state at `hi`. Each `bisect` picks a
half and re-establishes the invariant; when a level's range reaches a single unit the game
descends to the next level; the last level ends at `proveStep`.

A detail that reads as a bug and is not: the proposer's declared `length` is **not security
critical**. Too small and the verifier disagrees at the leaf; too large and the bisection lands
in the trace's terminal self-loop, which the verifier handles identically. The `MAX_SUB_LENGTH`
bound of 2^40 exists to cap griefing — about 40 exchanges — not to make the protocol sound.

Adding a fourth level (frames, for inter-contract calls) is a constant-list change, not a
redesign. **No gap here.**

---

## 6. Fraud proof lifecycle — today versus required

| Stage | Today (`KauraxDisputeGame`) | With a fault proof |
|---|---|---|
| Propose | Proposer posts an output root, `PROPOSER_BOND` escrowed at proposal time | Unchanged, plus a trace root |
| Challenge | Anyone posts `CHALLENGER_BOND` and opens a game | Unchanged |
| Narrow | `defend` / `bisect` down to one **L3 block** | …then to a transaction, then to one **instruction** |
| Decide | **`resolve` is `onlyGuardian`** — a person decides | `proveStep` — the verifier decides, permissionlessly |
| Settle | Loser's bond to the winner; output deleted if the challenger wins | Unchanged |
| Fallback | `resolveTimeout` — whoever's turn lapsed loses; guardian silence refunds both sides | Unchanged |

The lifecycle around the decision is already the right shape and is tested (41 + 11 tests). **One
call changes.** That was a deliberate design constraint: the game was built so integration
replaces `resolve` and leaves bonds, timeouts and settlement untouched.

---

## 7. Bond and timeout rules

Both games use the same shape, and both are already sound as far as the tests reach:

- `PROPOSER_BOND` escrowed **at proposal time**, not on first defence. Forfeited to the
  challenger on a loss; refunded when the output finalizes; refunded to proposers of outputs
  deleted as collateral, which were never adjudicated.
- `CHALLENGER_BOND` posted on `challenge`. Slashed on a wrong challenge, which prices
  griefing.
- `RESPONSE_TIMEOUT` per move; whoever's turn lapsed loses. The winner is determined by whose
  turn it was, not by who called — tested.
- `MAX_GAME_DURATION` caps the whole game.
- Reentrancy in settlement: the settled flag is written **before** any transfer, verified with
  an attacker contract that actually re-enters.
- Conservation is fuzzed: the contract holds nothing after every terminal path.

**No gap in bond mechanics.** One property does change under a fault proof: bonds currently
have to price *guardian attention*, whereas under a verifier they need only price *calldata
and griefing*, which is a cheaper and more analysable problem.

### The timeout that matters most

`isOutputFinalized` consults the dispute game, and the portal refuses to finalize a withdrawal
against an unsettled output. Both halves matter: the portal gates on the **proof's** age, so
without the second check a withdrawal could complete against a commitment still under dispute.
This interlock is what stops a dispute outliving the finalization window (finding M-1), and it
is unchanged by a fault proof.

---

## 8. Attack surfaces

### Open today, and closed only by a verifier

| Surface | Consequence |
|---|---|
| **Dishonest proposer** | Commits any output root. Bonded and challengeable, but the guardian decides the challenge |
| **Captured guardian** | Rules for a liar, or against an honest challenger. Cannot rewrite finalized history — the oracle refuses to delete a finalized output — but decides within the window |
| **Both** | Collusion between proposer and guardian is unbounded within the finalization window |

### Open today for a different reason

| Surface | Status |
|---|---|
| **Data withholding** | Closed by construction: every block is published as L2 calldata and reconstruction is verified on every CI run |
| **Sequencer censorship** | Bounded by forced inclusion — ignoring a forced transaction halts settlement for everyone |
| **Griefing a challenger** | One live game per output; a challenger can open and abandon, delaying the next by one timeout, at the cost of a bond. Accepted (L-1); parallel games are worse, because one bond could force a proposer to defend many at once |

### New surfaces a fault proof would introduce

Worth stating, because "add a fault proof" is not purely risk-reducing:

1. **Verifier bugs become consensus bugs.** A wrong `step()` decides disputes wrongly with no
   human able to intervene. This is why the differential rig matters more than the unit tests.
2. **Preimage oracle griefing.** An oracle that must be filled before a step can be proven is a
   denial-of-service surface with its own timeout design.
3. **Proof-size denial of service.** A step proof whose calldata exceeds the block gas limit is
   an unprovable step. Merkleized code is not only a scaling nicety; without it a large contract
   can make a dispute unresolvable.
4. **Trace-length griefing.** An honest party may have to bisect ~40 times; each move is a
   transaction with a timeout, and a well-timed gas spike is an attack on the clock.

---

## 9. Implementation milestones

Ordered so that each is independently useful and independently honest. Estimates are
engineer-months and assume one experienced protocol engineer.

| # | Milestone | Est. | Ends the gap? |
|---|---|---|---|
| **M0** | **Verifiable trace commitments end to end** — reference emulator → fixture → Solidity verifier, enforced rather than assumed | **DONE** | No. Makes the existing machine auditable |
| M1 | Pin KAURAX's own STF: fix the EVM version, test against a second implementation, and record where they diverge | 1–2 | No. Closes finding I-1, a prerequisite for everything after |
| M2 | Replace the RPC-attached engine with an in-process, instrumentable EVM that can emit a per-instruction trace | **4–8** | No, but it removes **Gap 2** — the blocker |
| M3 | Extend machine state to a committed call stack, block/transaction context and Merkleized code | 3–5 | Removes most of **Gap 3** |
| M4 | Preimage oracle with its own timeout and griefing analysis | 2–3 | Removes **Gap 4** |
| M5 | Full-EVM one-step verifier: calls, creates, logs, environment, precompiles, dynamic gas | **6–10** | Removes the rest of **Gap 3** |
| M6 | Commit a trace root in the output root; upgrade proposer, oracle and portal together | 1–2 | Removes **Gap 1** |
| M7 | Swap `resolve` for `proveStep` in the settlement game; retire the guardian as arbiter | 0.5–1 | **Closes H-1 and H-2** |
| M8 | External audit of the whole proof system | — | Closes H-3 |

**Total: 18–32 engineer-months before the audit**, consistent with the 18–30 stated elsewhere
in the documentation. The dominant terms are M2 and M5, and neither can be shortened by
working harder on the parts that are already done.

### M0, completed in this phase

The claim behind the whole KVS effort is *"404 differential cases against the TypeScript
emulator"*. That was true, and it was also weaker than it read: `KVSVerifier.t.sol` compares
the Solidity verifier against a **committed fixture**, not against the live emulator. So a
change to the emulator did not fail it. The fixture simply went stale and the test kept
passing against a frozen artefact while the two implementations diverged.

This was demonstrated rather than reasoned about. Changing `VERYLOW` from `3n` to `4n` in
`packages/kvs/src/gas.ts` — a real semantic divergence between the two implementations — left
**all 29 emulator tests passing and all 6 verifier tests passing**. Regenerating the fixture
with that change in place made the verifier test fail immediately, with
`add#0: 0x9fc4… != 0x0c71…`. The differential rig was working correctly the whole time; nothing
was regenerating its input.

`tests/check-kvs-fixtures.sh` now regenerates the fixtures and requires the result to be
byte-identical to what is committed, and CI runs it. The generator was already deterministic —
seeded programs, reproducible output — so this holds without further work; it had simply never
been checked. The loop is now closed: emulator → fixture → verifier, with no frozen link.

**What this does not do.** It removes no trust assumption from KAURAX, adds no security
property, and moves no readiness score. KAURAX still has no fault proof over its own
execution. What changed is that the machine which does exist can no longer drift away from
the reference it claims to agree with, and a third party can verify that in one command.

### The milestone to do next

**M1**, pinning KAURAX's own state transition function, because M2 — the blocker — cannot be
specified until the behaviour being reproduced is specified.

---

## 10. What must not be said about any of this

Repeating, because this document is the one most likely to be quoted out of context:

1. KAURAX **does not have fault proofs**. A verifier exists for a documented subset and is not
   connected to settlement.
2. `KauraxFaultDisputeGame` **does not secure KAURAX**. It is referenced by tests only.
3. The 404 differential cases prove the Solidity verifier agrees with the reference emulator
   **on the KVS**. They say nothing about KAURAX blocks, which do not run on the KVS.
4. Completing M0 will make the existing machine reproducible. It will **not** make KAURAX
   fault-proven, and the readiness score must not move on it.
5. The honest formulation stands unchanged: *funds are safe if at least one honest party
   challenges a bad state commitment **and** the guardian rules correctly.*
