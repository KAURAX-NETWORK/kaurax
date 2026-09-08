# KAURAX — Fault Proof Design Register

Every element a fault proof architecture must define, with **where it is** or **why it is
not**. Implementation and results: [FAULT_PROOFS.md](FAULT_PROOFS.md) and
[FAULT_PROOF_IMPLEMENTATION_REPORT.md](FAULT_PROOF_IMPLEMENTATION_REPORT.md).

> **The scope statement this whole register lives under.** The verifier covers the **KAURAX
> Verifiable Subset (KVS)** — a documented EVM subset. KAURAX blocks execute on the full EVM
> under `anvil`, so the design is **not** connected to `KauraxL2OutputOracle`, and KAURAX has
> **no fault proof over its own state transitions**. Every "implemented" below means
> implemented for the KVS.

## The register

| # | Element | Status | Where |
|---|---|---|---|
| 1 | Execution model | **Implemented** | EVM subset: same opcode bytes, semantics, static gas. `KVSTypes.sol`, `packages/kvs/src/machine.ts` |
| 2 | Initial state | **Implemented** | `MachineState` with zero roots at each tree height; `Machine` constructor |
| 3 | Final state | **Implemented** | `STOPPED`, `REVERTED` or `HALTED`; terminal states self-loop |
| 4 | State commitments | **Implemented** | `keccak256(abi.encode(pc, gas, codeHash, stackRoot, stackSize, memRoot, memWords, storageRoot, status, halt))` |
| 5 | Execution trace | **Implemented** | `runTrace` — one state per instruction, plus the start |
| 6 | Trace commitment | **Implemented** | Merkle root over state hashes, **padded with the terminal state, not zero** |
| 7 | Trace segments | **Implemented** | Bisection ranges within a level; the "segment" of the usual description |
| 8 | Merkle proofs | **Implemented** | `KVSMerkle` — fixed-height sparse trees at 10 (stack), 16 (memory), 256 (storage) |
| 9 | Dispute protocol | **Implemented** | `KauraxFaultDisputeGame`: post → challenge → defend → dispute → descend → prove |
| 10 | Bisection | **Implemented** | Invariant *agreed at `lo`, disputed at `hi`*; ⌈log₂N⌉ exchanges per level |
| 11 | Final execution-step dispute | **Implemented** | `proveStep`, permissionless |
| 12 | One-step verifier | **Implemented** | `KauraxOneStepVerifier.step` — executes the instruction. No oracle, no signature, no privileged caller |
| 13 | State transition verification | **Implemented** | Post-state commitment compared to the disputed claim; the verifier's answer decides |
| 14 | Stack | **Implemented** | 1024 slots, Merkleized. Invariant: every slot ≥ `stackSize` is zero, enforced by clearing on pop |
| 15 | Memory | **Implemented, restricted** | Word-Merkleized, 2¹⁶ words. **32-byte aligned only**; unaligned is `HALT_UNALIGNED_MEMORY` |
| 16 | Storage | **Implemented, restricted** | Height-256 tree keyed by `keccak256(slot)`. **A flat map, not the Ethereum MPT** |
| 17 | Accounts | **NOT IMPLEMENTED** | No balances, nonces, code storage or account trie. One implicit contract. Requires the MPT model |
| 18 | Gas | **Implemented** | EVM static costs; real memory-expansion formula. Two documented divergences, both charging more: no EIP-2929 warm/cold, no SSTORE refunds |
| 19 | CALL | **NOT IMPLEMENTED** | Halts as unsupported. Requires multiple frames and an account model |
| 20 | CREATE | **NOT IMPLEMENTED** | Same |
| 21 | RETURN | **Implemented, partial** | Pops and prices `(offset, size)`; terminates `STOPPED`. Contents not committed — a single frame has no caller to return to |
| 22 | REVERT | **Implemented, partial** | As above, terminating `REVERTED` |
| 23 | Exceptional halts | **Implemented** | Eight reasons. A halt discards the frame: gas to zero, **roots as they were at step start** |
| 24 | Precompiles | **NOT IMPLEMENTED** | Halt as unsupported. Explicitly rejected rather than approximated |
| 25 | Returndata | **NOT IMPLEMENTED** | No calls, so nothing produces returndata. `RETURNDATASIZE`/`COPY` halt |
| 26 | Logs | **NOT IMPLEMENTED** | `LOG0`–`LOG4` halt. Not observable within a frame |
| 27 | Deterministic execution | **Implemented** | Two independent implementations, **404 differential cases**; the corpus is seeded and byte-reproducible |
| 28 | Timeout | **Implemented** | Per-move deadline; `resolveTimeout` is permissionless, and who wins depends on whose turn it was |
| 29 | Bonds | **Implemented** | Proposer bonds at claim time, challenger at challenge time; **pull payments**, so a winner that rejects ETH cannot freeze the game |
| 30 | Challenger/proposer incentives | **Implemented, unanalysed** | Winner takes both bonds. **No economic analysis of whether the values deter griefing** — that depends on deployment figures |
| 31 | Griefing resistance | **Implemented, partial** | One game per claim; no self-challenge; `MAX_SUB_LENGTH` 2⁴⁰; declared sub-length is not security-critical. **Open:** a challenger can stall ~`rounds × timeout`; an unproven leaf resolves to the proposer |

**24 implemented, 5 not implemented, 2 partial.** The five absences are one cluster: calls,
creates, accounts, precompiles, returndata all need multiple frames over an account-model
state. That is the same work item, and it is the largest remaining piece after an
instrumentable execution engine.

## Why this shape

**Why a subset rather than a proving VM.** Compiling a state transition to MIPS or WASM is
the established route (Cannon, WAVM) and remains correct for KAURAX
([FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md) §3.1). It is also 18–30 engineer-months and
it presumes an STF you control. KAURAX's STF is an external binary. Building the verifier
against an EVM *subset* keeps every component real and makes the remaining gap legible —
"extend coverage and bridge the state model" rather than "start again".

**Why claims are plain state hashes.** A commitment scheme that embedded sub-ranges would let
a proposer choose the decomposition after the fact. Plain hashes plus a declared sub-length
avoid that, and the length turns out not to be security-critical: too small and the verifier
disagrees at the leaf; too large and the extra positions are the terminal self-loop, which
the verifier handles identically.

**Why it is not wired to settlement.** An output root commits to
`(version, stateRoot, withdrawalTreeRoot, blockHash)` — nothing about execution. A game about
a trace would say nothing about such a root. Wiring them would produce a contract that looked
like a fault proof over KAURAX state while proving something unrelated.

## Before KAURAX has fault proofs

1. An execution engine that can be instrumented — the blocker.
2. Output roots that commit to a trace.
3. Items 17, 19, 20, 24, 25, 26 above.
4. A preimage oracle.
5. An autonomous challenger.
6. An external audit, then removal of the guardian path.

Only after 6 may KAURAX call its output roots trustless.
