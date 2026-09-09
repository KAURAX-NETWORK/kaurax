# KAURAX — Next Phase Engineering Plan

**Date:** 2026-09-09 · **Base commit:** `1103640` · **Method:** every claim below was checked
against source or against a command that was run. Where a number appears, the command that
produced it is named. Nothing here is quoted from an earlier report.

This plan exists to move KAURAX from *a working testnet with honest documentation* to *a
system a grant reviewer can verify and an auditor can be pointed at*. It is not a feature
list. Three of the eight sections are about things that must **not** be claimed.

---

## 0. The one-paragraph summary

KAURAX is a working application-specific Layer-3 optimistic rollup with genuine data
availability, genuine forced inclusion, genuine proof-based withdrawals, and a genuine
bonded dispute game. It has **no fault proof over its own execution**, so a dishonest
proposer is stopped by a 2-of-3 multisig rather than by mathematics. That single gap
dominates every assessment of the system and no amount of work elsewhere substitutes for
it. The engineering priority for this phase is therefore not to close it — that is 18–30
engineer-months — but to make everything *around* it verifiable by a third party, and to fix
the defects that are actually fixable.

---

## 1. Current verified capabilities

Verified means: a command was run at commit `1103640` and produced this result, or a named
test asserts it.

| Capability | Evidence | Verified how |
|---|---|---|
| EVM execution | `tests/acceptance.ts` steps 5–6 | Sends a transaction, deploys a contract, calls it, reads the log |
| Batch creation and L2 publication | `tests/acceptance.ts` step 7 | `lastBatchL3Block` on the L2 advances past the transaction's block |
| **Data availability** | `tests/acceptance.ts` step 8 | Pulls the batch calldata off the L2, decodes it, recomputes `keccak256` of the raw transaction and finds it. Last CI run: **6 transactions recovered, the sent one among them** |
| On-chain commitment integrity | `tests/acceptance.ts` step 8 | `keccak256(payload)` equals the `dataCommitment` in the `BatchSubmitted` event |
| Withdrawal proofs | `tests/acceptance.ts` step 10 | Merkle proof accepted by `KauraxPortal` on the L2, funds released from escrow, `+0.5` |
| Replay protection | `tests/acceptance.ts` step 11 | The same withdrawal cannot be finalized twice; an L2-signed transaction is rejected by KAURAX |
| Forced inclusion | `tests/forced-inclusion.sh`, `ForcedInclusion.t.sol` (21 tests) | Overdue forced transaction → proposals rejected → acknowledged → settlement resumes. Run against a live chain |
| Dispute game with bonds and bisection | `DisputeGame.t.sol` (41), `DisputeGameAdversarial.t.sol` (11) | Real attacker contracts, including a reentrant winner |
| Finalization interlock | `KauraxL2OutputOracle.isOutputFinalized` consults the game | A live dispute blocks finalization; the portal refuses unsettled outputs |
| Governance | `Governance.t.sol` (27), `TimelockSelfAdmin.t.sol` (16) | 2-of-3 multisig and 1-hour timelock hold every privileged role |
| Deployment safety | `DeployGuard.t.sol` (8) | A role cannot be assigned to an address with no code |
| One-step verifier over the KVS | `KVSVerifier.t.sol` (6, **404 differential cases**), `KVSFaultDisputeGame.t.sol` (35), `KVSMerkle.t.sol` (11) | Solidity verifier agrees with the TypeScript reference emulator on 404 generated cases |
| KVS execution invariants | `tests/fault-proofs/kvs-properties.test.ts` (10) | Gas monotonicity, stack bounds, determinism, trace-root sensitivity |
| Sequencer failure behaviour | `tests/chaos.sh` | SIGSTOP/SIGKILL fault injection against node, database and services |

**Test totals at this commit, from the suites themselves:**

- `forge test` → **385 passed, 0 failed, 23 suites**
- `pnpm test` → **181 passed, 0 failed, 29 turbo tasks**

### What "verified" does not extend to

The KVS verifier is real and its 404 differential cases are real, but **KAURAX blocks do not
execute on the KVS**. KAURAX's execution engine is `anvil` over the full EVM. The verifier
therefore cannot adjudicate any dispute about a real KAURAX block today. The contract's own
NatSpec says this, and `KauraxDisputeGame.isFaultProof()` returns `false` with a test
asserting it.

---

## 2. Current security risks

Ordered by how much of the system's safety rests on them.

1. **Output roots are unverified.** Accepted because the proposer key signed them. A
   dishonest proposer commits an arbitrary root and, once final, withdraws against it.
2. **The guardian is the final arbiter.** A 2-of-3 multisig decides disputes. Capture it and
   it rules for a liar, or against an honest challenger, within the window.
3. **No external audit.** 385 contract tests are evidence of intent, not of correctness. No
   independent party has read the settlement, bridge or dispute contracts.
4. **Bridge escrow accounting can be inflated by a re-entrant token** — new in this audit,
   reproduced, see §3 H-4.
5. **Single sequencer.** Reordering and delay, bounded by forced inclusion. Not forgery.
6. **Operator keys are local on the devnet.** The signing seam exists and is tested; it is
   not in use. Compromising the node yields sequencer, batcher and proposer identities.
7. **No TLS on the public RPC.** Traffic readable and modifiable in transit. Blocked
   externally by the host on trial accounts, not by anything in this repository.
8. **Alert rules evaluate but reach nobody.** `infra/monitoring/alerts.yml` is loaded by
   Prometheus via `rule_files`, but `prometheus.yml` has no `alerting:` block and no
   Alertmanager is deployed. Alerts fire into a UI nobody is watching at 3am.
9. **The contracts holding escrowed value are not coverage-gated.** The CI floor covers
   `KauraxPortal`, `KauraxL2OutputOracle`, `KauraxMultisig`, `KauraxTimelock` and
   `MerkleTree`. It does **not** cover `KauraxL2ERC20Bridge`, `KauraxL3ERC20Bridge` or
   `KauraxDisputeGame`. H-4 was found in an ungated contract.

---

## 3. Every HIGH / CRITICAL issue

**CRITICAL: none open.**

### H-1 — No fault proof over KAURAX execution · OPEN · not fixable in this phase

Nothing verifies that an output root corresponds to any execution. This is the finding; every
other line in this document is secondary.

*Root cause, precisely:* KAURAX's state transition function is `anvil`, an external binary
reached over JSON-RPC. It cannot emit a per-instruction trace and cannot be re-executed one
step at a time, so there is nothing for an on-chain verifier to check.

*Fix:* a proving VM, execution trace commitments, a preimage oracle and a one-step verifier
over the **full** EVM — 18–30 engineer-months, then an audit. See §5 and
`docs/FAULT_PROOF_ROADMAP.md`.

### H-2 — The guardian is the final arbiter · OPEN, mitigated · follows from H-1

`KauraxDisputeGame.resolve` is `onlyGuardian`. Mitigated as far as the architecture allows:
the role is a 2-of-3 multisig behind a 1-hour timelock rather than a key, every resolution is
on chain with a reason string, and guardian silence refunds both sides rather than deciding
by inaction. It cannot be closed before H-1 — something has to decide a narrowed dispute.

### H-3 — No external audit · OPEN · not fixable by the team

An internal review by the author of the code is the weakest kind there is.

### H-4 — Bridge escrow can be credited more than it received · OPEN · **fixable now** · NEW

`KauraxL2ERC20Bridge.bridgeERC20To` measures `balanceOf` before and after pulling tokens, so
that a fee-on-transfer token cannot cause more to be minted on KAURAX than was escrowed. That
measurement spans `transferFrom`, an external call into a token address the caller chooses
and which is not allow-listed. `KauraxL2ERC20Bridge` has no reentrancy guard — it does not
import one, and `nonReentrant` appears in exactly one contract in the tree
(`KauraxLaunchpad`).

*Impact:* a token that calls back into the sender during `transferFrom` — ERC-777's
`tokensToSend` hook, a finalised standard with deployed tokens — lets a depositor re-enter.
The inner deposit's tokens arrive before the outer deposit reads its "after" balance, so the
outer deposit counts them as its own and credits them twice. The surplus is unbacked supply
on KAURAX, redeemable against other users' escrow until `finalizeWithdrawal` starts reverting
with `InsufficientEscrow` for whoever withdraws last.

*Reproduced:* `test/BridgeReentrancy.t.sol::test_creditNeverExceedsEscrowUnderAReentrantToken`
— attacker escrows `200e18`, bridge credits `300e18`.

```
[FAIL: the bridge credited KAURAX with more than it escrowed; the surplus is unbacked
 supply: 300000000000000000000 != 200000000000000000000]
```

*Fix:* §5, step 1.

*How it was missed:* slither's `reentrancy-balance` detector reports it, but the version
pinned by `crytic/slither-action@v0.4.0` predates that detector (99 detectors; slither 0.11.6
has 101). It surfaced only when slither was run locally at a current version. The other
`reentrancy-balance` finding, `KauraxLaunchpad.depositTokens`, is a false positive — that
function is `nonReentrant`.

### Documentation integrity — not a vulnerability, but a credibility failure

A reviewer who finds a document contradicting itself stops trusting every other number in it.
Three contradictions exist today, and all of them **understate** the work done, which is the
less dangerous direction but still disqualifying:

| Where | Says | Actually |
|---|---|---|
| `README.md` "What does not" | "Fault proofs — not started; **no verifier and no stub**" | A 544-line `KauraxOneStepVerifier` exists with 404 differential cases. The README's own callout, 40 lines above, says so |
| `MAINNET_READINESS.md` §D.1 and §G.1 | "No one-step verifier exists and no stub was written"; "no stub exists — not even one that compiles" | Same |
| `MAINNET_READINESS.md` §J | "270 + 126 + 12 tests passing" | §F of the same document says 338 and 179 |
| `README.md` "What works today" | a contract/node tally two rounds out of date | the figures the suites report |
| `README.md` Repository | "39 documents" | 65 in `docs/*.md`, 74 including subdirectories |
| `docs/DISPUTE_GAME.md` | "44 tests" | 41 + 11 = 52 |
| `docs/TEST_STATUS.md` per-suite table | rows sum to 322 | total is 338; `TimelockSelfAdmin.t.sol` (16) has no row |

`tests/check-doc-counts.sh` was built to stop exactly this and does not catch any of it: it
compares only the `forge test` / `pnpm test` **grand totals** against `TEST_STATUS.md`, so
prose counts, per-suite tables and any other phrasing pass unexamined.

Two older fault-proof documents (`FAULT_PROOF_ROADMAP.md`, `FAULT_PROOF_SPEC.md`) still open
with "KAURAX has no fault proof system" in a sense that predates the KVS work, and the README
links to the first of them. Seven fault-proof documents totalling ~1,300 lines is itself a
navigation problem for a reviewer.

---

## 4. Missing components for production

Grouped by whether this phase can deliver them.

### Cannot be delivered in this phase, and must not be implied

- **Fault proof over the full EVM** — proving VM, trace commitments, preimage oracle,
  one-step verifier over real KAURAX execution. 18–30 engineer-months.
- **External audit** — needs an independent firm and a budget.
- **Decentralized sequencing** — 6–12 engineer-months, and it belongs *after* fault proofs.
  Distributing block production while nobody can prove a block wrong spreads the ability to
  lie rather than removing it.

### Can be delivered, in rough order of value

1. **Fix H-4** and gate the contracts that hold value.
2. **A single reproducible entry point** — one command, from a clean clone, that produces the
   evidence for every claim KAURAX makes. Today the evidence is spread across
   `acceptance.sh`, `forced-inclusion.sh`, `chaos.sh`, `e2e-testnet.sh`, `apps-smoke.sh` and
   two Foundry suites, and a reviewer has to know which is which.
3. **End-to-end evidence for the claims that only contract tests cover today** — dispute
   initiation, dispute progression, and rejection of an invalid state commitment are proven
   in Foundry against a simulated L2, not against the running devnet.
4. **Documentation reconciliation** — one authoritative statement per claim, the rest
   explicitly superseded, and a doc-count gate that actually covers prose.
5. **Alertmanager**, so the alert rules that already exist reach a human.
6. **Operator keys onto the signing service** in the live deployment.
7. **TLS**, once the host account is upgraded.
8. **Source verification in the explorer** — currently reports `verified: false` honestly.

---

## 5. Exact implementation order

Each step is independently landable and independently verifiable. Later steps do not depend
on earlier ones except where stated.

**Step 1 — Fix H-4.** Add a reentrancy guard to `KauraxL2ERC20Bridge`. Minimal correct fix:
a transient-storage or storage lock on `bridgeERC20To`, and on `finalizeWithdrawal` for
symmetry. Do **not** remove the balance-delta measurement — it is there for fee-on-transfer
tokens and is correct; the defect is the unguarded reentry across it.

**Step 2 — Extend the coverage floor** to `KauraxL2ERC20Bridge`, `KauraxL3ERC20Bridge` and
`KauraxDisputeGame`, and raise their coverage to clear it. A contract holding escrowed value
belongs in the gate that already covers the portal.

**Step 3 — Close the doc-count gate's blind spot.** Make it check prose counts and per-suite
tables, not only grand totals, then correct every figure in §3.

**Step 4 — Reconcile the fault-proof documentation.** One authoritative document; the older
ones explicitly marked superseded rather than deleted, so findings stay traceable.

**Step 5 — `docs/FAULT_PROOF_GAP_ANALYSIS.md`.** The precise distance between the
block-level dispute game that settles KAURAX today and a one-step fault proof, written
against the code.

**Step 6 — Implement the highest-value feasible fault-proof milestone.** Candidate, to be
confirmed in Step 5: make the *existing* KVS dispute game's trace commitment scheme
verifiable end to end from the reference emulator through the Solidity verifier, and document
exactly which of the remaining milestones it does and does not discharge. It must not be
described as giving KAURAX fault proofs.

**Step 7 — One reproducible evidence command** plus `docs/REPRODUCIBLE_TESTNET_DEMO.md`, so
an external engineer clones the repository and reproduces the core claims without guidance.

**Step 8 — End-to-end dispute and invalid-commitment evidence** against the running devnet.

**Step 9 — Update `MAINNET_READINESS.md`** from the evidence this phase produced, with
STATUS / EVIDENCE / REMAINING WORK per category, and without inflating the score.

**Step 10 — `docs/FUNDING_TECHNICAL_BRIEF.md`** and a README pass that distinguishes
WORKING / EXPERIMENTAL / MISSING / NOT AUDITED / NOT MAINNET READY.

**Step 11 — Full verification run** and `docs/ENGINEERING_STATUS_2026-09-09.md`.

---

## 6. Tests required for every change

The standing rule for this phase: **no change is complete without a test that fails before it
and passes after.** Specifically:

| Change | Test required |
|---|---|
| H-4 fix (Step 1) | The reproduction test already written must flip from fail to pass. Plus: a re-entrant deposit reverts rather than being silently mis-credited; a legitimate fee-on-transfer token still credits only what arrived; a non-re-entrant deposit is unaffected; `finalizeWithdrawal` under a re-entrant token cannot release more than the escrow |
| Coverage floor (Step 2) | The gate itself must be shown to fail on a contract below the floor before it is trusted to pass |
| Doc-count gate (Step 3) | A planted wrong number in prose must make it fail; the repository as-is must make it pass |
| Fault-proof milestone (Step 6) | Differential tests against the reference emulator, and a property test for every invariant claimed. An adversarial case for every new on-chain accept path |
| Reproducible demo (Step 7) | The command must be run from a clean clone in CI, not only locally |
| Dispute end-to-end (Step 8) | An invalid state commitment must be *rejected*, and the test must fail if it is accepted |

Regression suites to run before every commit: `forge test`, `pnpm test`, `forge fmt --check`,
and — for anything touching the node, batcher or settlement — `./tests/acceptance.sh` against
a running devnet.

---

## 7. Evidence required for a funding / grant application

What a serious L2 grant reviewer will ask for, and where it must come from.

| They will ask | Acceptable evidence | Status today |
|---|---|---|
| "Does the chain actually run?" | A reproducible command producing a live chain and a passing acceptance suite | **Have it** — `start.sh` + `acceptance.sh`, run in CI on every push |
| "Is the data really available?" | Reconstruction of a transaction from L2 calldata alone, with the hash checked | **Have it** — step 8, and it is the check most worth watching |
| "Can the sequencer censor me?" | A forced-inclusion run showing settlement halting when a forced transaction is ignored | **Have it** — live-chain run |
| "Can I get my money out without asking you?" | A Merkle-proved withdrawal with no operator approval path | **Have it** — step 10 |
| "What happens when the sequencer dies?" | Fault-injection results | **Have it** — `chaos.sh` |
| "Do you have fault proofs?" | An honest no | **Have it**, and this is a strength: the answer is documented, on chain via `isFaultProof()`, and tested |
| "Show me the dispute game working against a real chain" | An end-to-end run, not only unit tests | **Partial** — Foundry only; Step 8 |
| "Can I reproduce all of this myself in an hour?" | One documented command from a clean clone | **Missing** — Step 7 |
| "Has anyone independent looked at it?" | An audit report | **Missing, and cannot be manufactured** |
| "Are your own numbers internally consistent?" | Documents that agree with each other and with the suites | **Failing today** — §3; this is the cheapest thing on the list to fix and the most damaging to leave |

**The single highest-leverage item for a grant application is Step 7.** A reviewer who can
reproduce the claims in an hour will believe the rest of the document. A reviewer who cannot
will discount all of it, however good the engineering is.

---

## 8. What must NOT be claimed publicly

Absolute. These hold regardless of how any future work goes, unless the thing itself changes.

1. **Never that KAURAX has fault proofs.** It does not. A one-step verifier exists for a
   documented EVM subset and is deliberately not connected to settlement; KAURAX blocks do
   not execute on that subset.
2. **Never that the dispute game is a fault proof.** It narrows a disagreement to one block
   and hands that block to a guardian. `isFaultProof()` returns `false` and a test asserts
   it; keep both.
3. **Never that KAURAX is production or mainnet secure.** There has been no external audit.
   "Audited" may not be written until a report exists and is linked.
4. **Never that funds are unconditionally safe.** The honest formulation, which should be
   reused verbatim: *funds are safe if at least one honest party challenges a bad state
   commitment **and** the guardian rules correctly.*
5. **Never that the sequencer is decentralized.** There is one, and no rotation.
6. **No invented metrics** — no users, TVL, revenue, transaction counts or uptime figures
   that were not measured. No partnerships, investors, grants or audits that do not exist.
7. **No tokenomics and no monetary value for KAX.** It is a testnet token and none is planned
   in this repository.
8. **No test count that has not just been produced by running the suite.** Counts have
   drifted at least six times; every drift was caught by chance.
9. **Never imply the KVS verifier secures KAURAX.** It is real work and worth describing —
   describing it as protecting the chain would be false.
10. **Never describe an internal review as an audit.** `SECURITY_REVIEW.md` already says this
    about itself; keep that framing everywhere.

---

## Appendix — what this plan deliberately does not do

- **It does not attempt fault proofs over the full EVM.** Attempting and half-finishing would
  produce code that looks like a fault proof and is not, which is more dangerous than the
  documented absence.
- **It does not attempt sequencer decentralization.** See §4.
- **It does not raise the readiness score by removing capabilities.** The score moves when
  evidence moves.
- **It does not delete the older fault-proof documents.** They are marked superseded, because
  a project that quietly rewrites its own history is harder to trust than one that leaves the
  trail visible.
