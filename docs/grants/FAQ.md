# KAURAX — Grant FAQ

The questions a reviewer should ask, answered directly.

---

### Does KAURAX have fault proofs?

**No.** No one-step verifier, no proving VM, no trace commitments, no preimage oracle. The
dispute game bisects to a single block and then a 2-of-3 multisig decides.

The contract says so itself:

```solidity
function isFaultProof() external pure returns (bool) { return false; }
```

---

### Then why does the repository contain a "dispute game"?

Because bonds, bisection, timeouts, abandonment, settlement and the finalization interlock are
real, tested and necessary regardless of who resolves the game — and they are the parts a
verifier plugs into. Building them first means M5 delivers a verifier rather than a verifier
plus the machinery around it.

`resolutionMechanism()` returns `"guardian multisig; no on-chain one-step verifier exists
(docs/FAULT_PROOF_SPEC.md)"` so that nobody integrating against it can mistake what it is.

---

### Is KAURAX decentralized?

No. One sequencer, one proposer, a 2-of-3 multisig. Forced inclusion bounds censorship — an
ignored forced transaction halts settlement for everyone — but ordering is centralized.

---

### How much value is at risk?

None. KAURAX is a testnet. **KAX has no monetary value**, there is no token sale, no
tokenomics, and none is proposed.

---

### Has it been audited?

No. None commissioned. M7 is the audit and it comes after the verifier exists — auditing the
current code would mostly produce the findings already published in
[../SECURITY_STATUS.md](../SECURITY_STATUS.md).

---

### What are the open findings?

3 HIGH open, 9 fixed. All listed with status and evidence in
[../SECURITY_STATUS.md](../SECURITY_STATUS.md). The open ones are the trust assumptions above,
not undisclosed bugs.

---

### How many users does it have?

No data available. No TVL, no transaction volume, no partners, no investors. It is an
experimental testnet and reports nothing it cannot measure. See [IMPACT.md](IMPACT.md), which
leads with the empty table rather than burying it.

---

### Why an L3 rather than an L2?

Settlement costs and iteration speed. KAURAX settles to a configurable L2, inheriting that
L2's data availability. This is a design choice with real trade-offs, set out in
[../WHY_KAURAX.md](../WHY_KAURAX.md).

---

### Does KAURAX have validators or consensus?

No, and it should not. A rollup does not need them — security comes from the settlement layer
plus proofs, not from a validator set. Adding validators to a rollup produces something that
looks decentralized while changing nothing about who can commit a bad state root. Fault proofs
address that; validators do not.

---

### Isn't 18–30 engineer-months a long time for one component?

Yes. Cannon took years and multiple audits. A shorter estimate would signal that the work has
not been understood. See [../FAULT_PROOF_ROADMAP.md §6](../FAULT_PROOF_ROADMAP.md).

---

### Why should a funder back this rather than an established team?

They may reasonably prefer the established team. The argument for funding this one:

- The prerequisite work is done and testable — bonds, bisection, settlement, interlock
- The output is a **second independent verifier implementation**, which has value the first
  one does not: bugs found in one become checkable against the other
- Everything is MIT and published per milestone, including partial work and failures

---

### What happens if the verifier is never finished?

The milestones are staged so partial funding still produces reusable output — an STF
specification and differential harness, a proving VM port, a preimage oracle. Each is listed
in [BUDGET.md](BUDGET.md) under "What a funder gets if the work stops early".

And KAURAX stays what it is now: an honest testnet that says it has no fault proofs.

---

### Could you ship a simpler verifier faster?

Not honestly. A verifier that returns `true`, covers a subset of opcodes silently, or trusts
an off-chain oracle for the answer would let KAURAX claim a property it does not have. **A
wrong verifier is worse than no verifier** — it lets an honest proposer lose. That is why M6
runs the verifier advisory beside the guardian instead of cutting over, and why no stub of
`IOneStepVerifier` exists in `src/`.

---

### What is the readiness score and what does it mean?

**52/100** for mainnet ([MAINNET_READINESS.md](../../MAINNET_READINESS.md)), self-assessed
with per-row evidence. The recent gain came from removing operational mistakes — deployment
guards, key rotation, recovery rehearsal — not from adding protocol security. The score cannot
move much further without fault proofs, which is the point of this request.

A higher score is not the objective. Correctness is.

---

### Who verifies these answers?

Nobody has, and that is the honest answer. Everything above is checkable from a clean
checkout: [../REPRODUCIBLE_BUILD.md](../REPRODUCIBLE_BUILD.md) lists the commands and their
observed output, and [../TEST_STATUS.md](../TEST_STATUS.md) breaks the 529 tests down per
suite, including what is **not** run.
