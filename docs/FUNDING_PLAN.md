# KAURAX — Funding Plan

What KAURAX would seek, from whom, and for what. Companion to
[grants/BUDGET.md](grants/BUDGET.md), which sizes the fault-proof work in engineer-months.

## Three things this plan does not do

**No token.** KAX is a testnet gas token with no monetary value. This plan does not propose
changing that, does not assume a token is necessary, and contains no allocation, sale or
distribution.

**No financial promises.** No returns, equity, revenue share or future consideration of any
kind is offered to any funder.

**No invented numbers.** Effort is estimable from the work; cost depends on the funder's
region and rate assumptions and is filled in jointly. Every currency figure here would be
fabricated, so there are none.

---

## Sources, and what each is right for

### 1. Ecosystem grants — the primary route

**For:** the fault-proof work. M1–M7 in [grants/MILESTONES.md](grants/MILESTONES.md), each
with an acceptance test a third party can run.

**Why it fits:** the deliverables are public goods. A second independent one-step verifier, a
differential harness for EVM-equivalent state transitions, a preimage oracle — all MIT, all
reusable by projects that are not KAURAX.

**Why it is not commercially fundable:** 18–30 engineer-months producing no user-visible
feature. This is precisely the work commercial pressure skips, and precisely why ecosystem
funding exists.

**Ask:** milestone-staged. M1 can fail informatively — if differential testing shows the state
transition diverges, that is the finding, and a funder should not already be committed to M5.

### 2. Research funding

**For:** Stage 3 of [DECENTRALIZATION_ROADMAP.md](DECENTRALIZATION_ROADMAP.md) — a written
comparison of sequencing designs against KAURAX's real constraints, and bond-sizing economics,
which no document in this repository currently analyses.

**Output:** design documents and analysis, not shipped code.

### 3. Security funding

**For:** the external audit (blocker B3) and a bug bounty.

**Sequencing matters:** auditing today would mostly reproduce
[SECURITY_STATUS.md](SECURITY_STATUS.md). The audit is worth commissioning once the verifier
exists and the code is frozen — M7, not now. Asking for audit money before then would be
asking for money to confirm what is already published.

### 4. Infrastructure sponsorship

**For:** hosting. Currently one VPS at roughly €20–40/month observed. Trace generation and an
autonomous challenger would raise that; by how much is not yet measurable.

**In kind is preferable to cash** — compute credits, an archive-capable L2 endpoint, CI
minutes.

### 5. Developer grants and hackathons

**Explicitly deferred.** Paying people to build on a chain with no fault proofs, a
guardian-decided dispute, no audit and one sequencer would be putting their time at risk to
make adoption numbers look better. Revisit after B1–B3.

---

## Allocation, if funded

| | Share | Rationale |
|---|---|---|
| Fault-proof engineering (M1–M7) | Majority | It is the only thing that moves the security ceiling |
| External audit | Second largest | Blocker B3; quoted by the auditor at code freeze |
| Research (sequencing, economics) | Small | Design work, not implementation |
| Infrastructure | Small | One VPS today |
| Growth, marketing, incentives | **Zero** | Not requested and not accepted for this purpose |

---

## What a funder gets if the work stops early

Every milestone is MIT and published on completion, **including partial work and failures**.

| Stopping after | Reusable |
|---|---|
| M1 | A state-transition specification and differential harness — useful to any EVM-equivalent L2/L3 |
| M2 | An EVM state transition on a proving VM, reproducibly |
| M4 | A preimage oracle, not KAURAX-specific |
| M5 | A one-step verifier — the component the ecosystem has fewest independent implementations of |

---

## Reporting

Each milestone closes with a public report: delivered, not delivered, found, changed. **A
milestone that fails is reported as failed**, with the acceptance tests run and published
either way.

No usage metric will be reported that does not exist. Today: no TVL, no users, no
transactions of consequence, no partners, no investors —
[grants/IMPACT.md](grants/IMPACT.md) leads with that empty table rather than burying it.

---

## Current status

**Nothing has been applied for. No funding has been received. No commitments exist.**
