# KAURAX — Funding Plan

**Not an investment offering.** KAX is a testnet gas token with no monetary value and no
sale. This document does not offer returns, equity, or tokens. It describes engineering work
and what it would cost.

---

## Principles

1. **Milestone-based.** Each milestone has a deliverable someone outside the project can
   check without trusting us.
2. **No milestone depends on a claim.** "Fault proofs implemented" means a repository, test
   vectors, and traces a third party can reproduce.
3. **Audit money is ring-fenced.** It is not reallocated when engineering runs long, because
   that is exactly when it gets reallocated.
4. **Unspent funds return.** If a milestone proves unnecessary, the money goes back rather
   than finding a use.

---

## Milestone 1 — Security and infrastructure hardening

**3–5 engineer-months**

| Deliverable | Verifiable by |
|---|---|
| TLS on the RPC, standard ports | `curl https://kaurax.network/rpc` |
| Operator keys on the signing service or HSM | `kaurax_settlementStatus` reports `signers.mode: remote` |
| Alerting on existing metrics | Alert rules in the repository; a test page |
| Disaster recovery rehearsed | Published write-up: what was killed, what broke, how long |
| Sequencer failover to a standby | Rehearsal recording; measured downtime |
| Fuzz and invariant tests across the bridge | Test count and coverage in CI |
| Public bug bounty | Live programme page |

No research risk. This is work with a known shape.

---

## Milestone 2 — Fault proof research and implementation

*Expanded into seven milestones with acceptance tests in
[`docs/grants/MILESTONES.md`](grants/MILESTONES.md); effort in
[`docs/grants/BUDGET.md`](grants/BUDGET.md).*

**18–30 engineer-months. The largest and the least predictable.**

| Deliverable | Verifiable by |
|---|---|
| State transition function pinned and specified | Spec document; differential tests against a second EVM |
| Proving VM adopted | Traces emitted for every block, reproducible by a third party |
| Preimage oracle | Deployed contract; anyone can serve a preimage |
| One-step verifier | Repository, test vectors, an adversarial test suite |
| Trace bisection in the dispute game | Disputes narrowing to an instruction on a testnet |
| Challenger agent | An independent party running one and winning a staged dispute |

**No completion date is offered, and a funder should be suspicious of one.** OP Stack's
Cannon took years and repeated audits. This milestone ends when the verifier is correct: a
verifier with a bug is worse than none, because it lets an honest proposer lose.

Sub-milestones with independent value, so the work is checkable in progress:

- 2a — STF specified and differentially tested
- 2b — traces emitted and verified off chain
- 2c — verifier for one opcode class, with vectors
- 2d — full instruction set
- 2e — integrated, running advisory alongside the guardian

---

## Milestone 3 — Independent audit

**3–6 months elapsed. Ring-fenced.**

| Deliverable | Verifiable by |
|---|---|
| Two audits by independent firms | Published reports, unedited |
| Remediation | Diff per finding |
| Re-review | Follow-up reports |

Two firms if funding allows: auditors miss different things, and a single clean report is
weaker evidence than most people assume.

---

## Milestone 4 — Sequencer decentralization

**6–12 engineer-months**

| Deliverable | Verifiable by |
|---|---|
| Rotating sequencer set with on-chain schedule | Multiple operators producing blocks; rotation observable |
| Liveness under operator failure | Rehearsal: kill the leader, measure the gap |
| Documented ordering-fairness properties | Written down, including what is not guaranteed |

Sequenced after fault proofs deliberately. Distributing block production while nobody can
prove a block wrong distributes the ability to lie.

---

## Milestone 5 — Mainnet preparation

| Deliverable | Verifiable by |
|---|---|
| Every item in MAINNET_READINESS.md §J closed | The checklist, with evidence per line |
| Bond parameters sized against real value | Published analysis |
| Governance distributed beyond the founding team | Owner set on chain |
| Incident response rehearsed | Write-up |

---

## What funding does not buy

- A token sale. There is none planned in this document.
- A launch date for fault proofs.
- The word "trustless" before the verifier exists and is audited.
- Silence about limitations. `SECURITY_REVIEW.md` lists three HIGH findings, all open, and
  two live outages the team caused. That stays in the repository regardless of who funds it.

---

## Reporting

Per milestone: what was delivered, what was not and why, tests run with results, and any
security findings including self-inflicted ones. Published in the repository, not sent
privately — so a funder reads the same account as everyone else.
