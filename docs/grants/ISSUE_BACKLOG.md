# KAURAX — Proposed Issue Backlog

Issues to open on https://github.com/KAURAX-NETWORK once maintainers agree on scope.

**These are proposals, not open issues.** Nothing here has been filed. Each is written so a
contributor with no prior context can pick it up: what exists, what is wanted, how it is
judged done.

Labels: `fault-proofs` `research` `security` `testing` `infra` `good-first-issue`
`help-wanted`

---

## Fault proofs

### FP-1 — Pin and specify the state transition function
`fault-proofs` `research` · **M1** · Large

KAURAX executes through revm. That is deterministic in practice but unpinned by specification
and unchecked against a second implementation. A verifier must encode exactly one semantics,
so the semantics must first be written down.

**Done when:** a specification exists covering EVM version, precompiles, gas schedule and
L3-specific rules; the pinned version is committed on chain and read by the derivation
pipeline.

**Prerequisite for everything else in this section.**

---

### FP-2 — Differential test harness against an independent EVM
`fault-proofs` `testing` · **M1** · Large · *depends on FP-1*

Replay testnet blocks through KAURAX's STF and an independent implementation; compare state
roots.

**Done when:** the harness runs from a clean checkout, replays every block of the public
testnet, and reports zero divergences — or reports the divergences, which is a more valuable
outcome.

---

### FP-3 — Evaluate proving VM targets
`fault-proofs` `research` · **M2** · Medium

MIPS, WASM and RISC-V, judged on toolchain maturity, audit history and on-chain verification
cost. [../FAULT_PROOF_ROADMAP.md §3.1](../FAULT_PROOF_ROADMAP.md) recommends MIPS; this issue
is to test that recommendation rather than assume it.

**Done when:** a written comparison with a recommendation and its reasoning.

**Good entry point for a contributor with proving-system background** — it is research, not
production code.

---

### FP-4 — Compile the STF to the proving VM
`fault-proofs` · **M2** · Very large · *depends on FP-1, FP-3*

**Done when:** an off-chain emulator produces instruction-level traces for real testnet
blocks, and a third party regenerating a named block's trace gets the published hash.

---

### FP-5 — Execution trace commitments
`fault-proofs` · **M3** · Large · *depends on FP-4*

Hash machine state after every instruction; Merkleize; commit the root alongside the output
root.

**Done when:** given a block and an instruction index, tooling emits an inclusion proof that
verifies against the committed root, and fails for a wrong index, wrong state, or tampered
proof.

---

### FP-6 — Preimage oracle
`fault-proofs` · **M4** · Medium · *depends on FP-4*

The verifier holds hashes, not data. Anyone must be able to post what it needs.

**Done when:** the oracle is deployed with permissionless submission under size and gas
limits, and a party other than the sequencer supplies every preimage a real dispute requires
using only public data.

**Self-contained and reviewable** — the most approachable of the fault proof issues.

---

### FP-7 — One-step verifier
`fault-proofs` `security` · **M5** · Very large · *depends on FP-5, FP-6*

```solidity
function step(bytes32 preState, bytes calldata proof, bytes calldata preimages)
    external view returns (bytes32 postState);
```

Split by instruction class; each class ships tested.

**Done when:** full instruction coverage, gas under 5,000,000, calldata under 100 KB, and
post-states matching the emulator across a differential fuzzing campaign. **Coverage gaps are
reported, not omitted.**

**Do not open a PR containing a stub.** A `step()` that returns a constant, covers a subset
silently, or defers to an off-chain oracle will be closed. A wrong verifier is worse than no
verifier: it lets an honest proposer lose.

---

### FP-8 — Differential fuzzing of the verifier
`fault-proofs` `testing` · **M5** · Large · *depends on FP-7*

Random and adversarially chosen pre-states through both the verifier and the emulator.

**Done when:** the campaign runs in CI on a schedule and its corpus is published.

---

### FP-9 — Extend bisection to instruction granularity
`fault-proofs` · **M6** · Medium · *depends on FP-5, FP-7*

`KauraxDisputeGame` bisects to a single block. Same loop, finer bounds, plus
`resolveWithProof(gameId, proof, preimages)`.

**Done when:** a game bisects to one instruction and resolves from the verifier's answer, with
`resolve()`'s guardian path still present and authoritative.

---

### FP-10 — Advisory verifier mode
`fault-proofs` `security` · **M6** · Medium · *depends on FP-9*

Run the verifier beside the guardian, recording and comparing every outcome without acting on
it.

**Done when:** outcomes are published per game and the two have agreed over a sustained
period. **Cutting over without this step is not acceptable** — it replaces a known trust
assumption with an unproven one.

---

### FP-11 — Autonomous challenger agent
`fault-proofs` · **M6** · Large · *depends on FP-9*

Detect a bad output root and play the game without human help.

**Done when:** on a testnet issuing deliberately invalid proposals, the challenger wins
unassisted.

---

### FP-12 — External audit of the verifier
`security` · **M7** · *depends on FP-7, FP-9, FP-10*

**Done when:** the report is published **including unfixed findings**, remediation is
complete, `resolve()`'s guardian path is removed, and
[../SECURITY_MODEL.md](../SECURITY_MODEL.md) moves dispute resolution from TRUSTED to
TRUSTLESS citing the commit that did it.

---

## Security and testing

### SEC-1 — Run Slither in CI
`security` `infra` `good-first-issue` · Small

Slither cannot run in the current local environment — `cbor2` does not build against Python
3.15 ([../TEST_STATUS.md](../TEST_STATUS.md) "Not run here"). A pinned container in CI removes
the dependency on any contributor's Python.

**Done when:** Slither runs in CI on a pinned image, with findings triaged and any accepted
ones documented rather than suppressed silently.

---

### SEC-2 — Invariant fuzzing for the dispute game
`security` `testing` · Medium

Bonds and settlement are covered by unit tests. The invariants are not stated as invariants:
escrow in equals payouts out; a resolved game pays exactly once; a deleted game cannot be
resolved.

**Done when:** Foundry invariant tests encode these and run in CI.

*A `receive()` omission that silently lost escrow was caught by a unit test late. Invariants
would have caught it immediately.*

---

### SEC-3 — Formal specification of withdrawal finalization
`security` `research` · Medium

Finalization depends on the proof's age **and** `isOutputFinalized`, which consults
`hasLiveGame`. The interaction is subtle — the portal-side half was nearly missed — and
deserves a written specification with a model check.

---

### SEC-4 — Chaos testing of the derivation pipeline
`testing` `infra` · Medium

L2 reorg handling has 5 tests
([`blockchain/l3/test/derivation-reorg.test.ts`](../../blockchain/l3/test/derivation-reorg.test.ts)).
Restart-under-load, partial-batch and L2-unavailability paths are not covered.

**Done when:** a harness injects reorgs, restarts and RPC failures against a live devnet and
asserts no deposit is lost. *Three bugs where a restart could lose a deposit were found by
inspection, not by tests.*

---

## Decentralization

### DEC-1 — Sequencer decentralization design
`research` · Large

Currently one sequencer. **Do not implement a validator set or a consensus layer** — see
[FAQ.md](FAQ.md). This issue is for a written design of shared or rotating sequencing that
preserves the existing forced-inclusion guarantee.

**Done when:** a design document exists with its trade-offs stated. Implementation is a
separate issue and comes after fault proofs.

---

### DEC-2 — Permissionless proposers
`research` · Medium · *depends on FP-7*

Once output roots are verifiable, the proposer need not be trusted. Bonded permissionless
proposing becomes possible — but only then.

---

## Documentation and tooling

### DOC-1 — Verify every command in the docs in CI
`infra` `good-first-issue` · Small

[../REPRODUCIBLE_BUILD.md](../REPRODUCIBLE_BUILD.md) lists commands with observed output. They
are not re-run, so they can drift.

**Done when:** CI extracts and executes them, failing on divergence.

---

### DOC-2 — Assert test counts in CI
`infra` `good-first-issue` · Small

408 is written in several documents. Three stale counts have already been found and fixed by
hand.

**Done when:** CI compares documented counts against actual output and fails on mismatch.

---

### DOC-3 — Public dispute game walkthrough
`good-first-issue` · Small

Play a game on the live testnet start to finish, with commands and transaction hashes, so a
reader can reproduce it rather than trust the description.

---

## Filing checklist

- [ ] Maintainers agree the issue belongs in scope
- [ ] Milestone assigned per [MILESTONES.md](MILESTONES.md)
- [ ] Acceptance criteria testable by someone outside the team
- [ ] No issue implies a property KAURAX does not have
