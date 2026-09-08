# KAURAX — Fault Proof Implementation Plan

Written after [FAULT_PROOF_AUDIT.md](FAULT_PROOF_AUDIT.md) and before any code was changed.

## The constraint that shapes everything

Finding A-2: **KAURAX's state transition function is `anvil`, an external binary reached over
JSON-RPC.** It cannot emit a per-instruction trace and cannot be re-executed one step at a
time on chain. Production fault proofs over real KAURAX blocks are therefore out of reach in
this repository, and pretending otherwise is the failure mode this brief explicitly forbids.

## What gets built instead

Everything a fault proof needs **except** the part that consumes real KAURAX execution:

| # | Component | Real, or stubbed? |
|---|---|---|
| 1 | A specified deterministic execution model — the **KAURAX Verifiable Subset (KVS)** | Real, documented opcode by opcode |
| 2 | Off-chain emulator emitting a per-step trace | Real |
| 3 | Merkle commitments over stack, memory, storage and the trace | Real |
| 4 | **On-chain one-step verifier** that executes one instruction and returns the post-state | Real — no signatures, no trust |
| 5 | Multi-level bisection game terminating in the verifier | Real |
| 6 | Differential tests: emulator vs verifier | Real |
| — | KAURAX's own EVM blocks running on the KVS | **Not built. The gap.** |

## The claim this permits, and no more

> KAURAX has a working one-step verifier and a dispute protocol that resolves genuine
> execution disagreements through it — for the KVS. KAURAX blocks are executed by anvil over
> the full EVM, which the KVS does not cover. **KAURAX does not have fault proofs for its own
> state transitions.**

## Design decisions

**KVS is an EVM subset, not a new VM.** Same opcode bytes, same stack semantics, same static
gas costs for every opcode it covers. The remaining gap is then legible — "extend coverage
and bridge the state model" — rather than "compile one machine to another".

**Machine state commitment.**
`keccak256(pc, gas, stackRoot, stackSize, memRoot, memWords, storageRoot, status, haltReason)`

Stack is a fixed-height Merkle tree (2¹⁰ = 1024 slots, the EVM limit), memory a fixed-height
tree over 32-byte words (2¹⁶), storage a tree of height 256 keyed by the bits of
`keccak256(slot)`. One Merkle library serves all three; storage proofs are 256 siblings, most
of them precomputed zero hashes.

**Claim structure — fixes Finding A-3.** The game maintains the invariant *agreed at `lo`,
disputed at `hi`*. The proposer supplies a claim at the midpoint; the challenger states
whether it agrees. Agreement moves `lo` up, disagreement moves `hi` down. At `hi == lo + 1`
there is an agreed pre-state and a disputed post-state — precisely the verifier's input. The
current game produces neither, so this replaces the claim structure rather than appending to
it.

**Levels.** `BLOCK → TRANSACTION → STEP`, implemented generically so a level is a bounded
index range with claims at its endpoints. "Execution segment" in the brief is the intermediate
bisection state inside the STEP level, not a fourth mechanism; this is documented rather than
invented.

## Migration and testnet safety

`KauraxL2OutputOracle` depends on the game through one function — `hasLiveGame(uint256)`
(`IKauraxDisputeGame.sol`). A new game satisfying that interface is installed with
`setDisputeGame`, which is challenger-gated and already exercised. **No settlement contract
changes.** The existing `KauraxDisputeGame` stays deployed and unmodified; the live testnet is
untouched until someone explicitly runs the migration.

## Order of work

1. Execution model specification
2. TS emulator + Merkle + trace commitments
3. Solidity Merkle library, state commitment, one-step verifier
4. Differential tests (emulator vs verifier) and fuzzing
5. `KauraxFaultDisputeGame` with multi-level bisection terminating in the verifier
6. The full adversarial test matrix from the brief
7. `docs/FAULT_PROOFS.md` and the implementation report

## Non-goals, stated up front

No CALL/CREATE/precompiles/LOG/SELFDESTRUCT. Single call frame. Storage is a flat
contract-local map, **not** the Ethereum MPT over accounts. No preimage oracle. No change to
the deployed testnet. No claim of production readiness.
