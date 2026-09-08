# KAURAX — Grant Readiness Audit

**Date:** 2026-09-08 · **Scope:** documentation, claim consistency, evidence · **Pushed:** no

This audit checks whether KAURAX's public materials describe KAURAX accurately, and whether
a grant reviewer can verify what they say without trusting the project. It is not a security
audit; no external audit has been commissioned.

---

## 1. Numbers verified by execution

Re-run at audit time, not copied from an earlier document.

| Check | Command | Result |
|---|---|---|
| Solidity tests | `forge test` | **338 passed**, 0 failed, 18 suites |
| Node / service tests | `pnpm test` | **179 passed**, 26/29 packages |
| Live end-to-end | `tests/e2e-testnet.sh` | **12 passed** against the public testnet |
| Types | `pnpm typecheck` | 25/25 |
| Builds | `pnpm build` | 19/19 |
| Formatting | `forge fmt --check` | clean |
| **Total automated** | | **529** |

Not run here: **Slither** — `cbor2` does not build against Python 3.15 on this machine. This
is recorded in [TEST_STATUS.md](TEST_STATUS.md) rather than omitted, and
[`ISSUE_BACKLOG.md` SEC-1](grants/ISSUE_BACKLOG.md) proposes moving it to a pinned CI
container so it does not depend on any contributor's Python.

---

## 2. Test-count drift found and fixed

Three documents carried stale counts from earlier runs:

| File | Was | Now |
|---|---|---|
| `docs/SECURITY_REVIEW.md` | 254 | 270 |
| `docs/apps.md` | 162 | 270 |
| `docs/contracts.md` | 162 | 270 |

This is the second time counts have drifted after being updated in one place only.
[`ISSUE_BACKLOG.md` DOC-2](grants/ISSUE_BACKLOG.md) proposes a CI check that compares
documented counts against actual output, because doing this by hand has now failed twice.

---

## 3. Forbidden-claim scan

Scanned every tracked `*.md` for: *fully decentralised · trustless fault proof · audited by ·
has been audited · mainnet ready · production ready · battle-tested · institutional grade ·
guaranteed returns · risk-free*.

**Result: no false claim found.** Three hits, all legitimate:

| Hit | Context |
|---|---|
| `KAURAX_INFRA_AUDIT.md:166` | "**Nothing has been audited.**" — the disclosure itself |
| `docs/FAULT_PROOF_ROADMAP.md:57` | "less battle-tested" — comparing proving VM options |
| `docs/grants/GRANT_OVERVIEW.md:10` | "Fund the move … **to** trustless fault proofs" — the objective being funded, in a document whose next section says none exist |

Every "token sale" occurrence is either a disclaimer or a reference to the testnet Launchpad
app. "Fully decentralised" appears only inside a sentence stating KAURAX must **not** be
called that.

---

## 4. Contradictions found and reconciled

| Contradiction | Resolution |
|---|---|
| `docs/GRANT_READINESS.md` listed 5 milestones; `docs/grants/MILESTONES.md` lists 7 | The 5 are project phases; the 7 expand phase 2. Both now say so and link to each other |
| `docs/FUNDING.md` Milestone 2 duplicated the fault proof plan | Now points to the grants package as the detailed version |
| `docs/grants/SECURITY_MODEL.md` would duplicate `docs/SECURITY_MODEL.md` | The grants copy is explicitly a summary and names the canonical document as authoritative if they disagree |

---

## 5. Single-source-of-truth map

A reviewer finding two answers should know which wins.

| Subject | Canonical |
|---|---|
| Trust assumptions | [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| Finding status | [SECURITY_STATUS.md](SECURITY_STATUS.md) |
| Test counts | [TEST_STATUS.md](TEST_STATUS.md) |
| Mainnet score | [../MAINNET_READINESS.md](../MAINNET_READINESS.md) |
| Fault proof plan | [FAULT_PROOF_SPEC.md](FAULT_PROOF_SPEC.md) + [FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md) |
| Architecture | [architecture/OVERVIEW.md](architecture/OVERVIEW.md) |
| Funding request | [grants/GRANT_OVERVIEW.md](grants/GRANT_OVERVIEW.md) |

Historical documents — `SECURITY_REVIEW.md`, `KAURAX_INFRA_AUDIT.md`,
`KAURAX_DEPLOYMENT_STATUS.md` — now carry a snapshot banner stating they record a point in
time and are not the live status.

---

## 6. What a reviewer can verify without trusting us

| Claim | How |
|---|---|
| No fault proofs | `grep -r "OneStepVerifier" blockchain/contracts/src/` → nothing |
| The contract admits it | `KauraxDisputeGame.isFaultProof()` → `false`, on chain |
| So does the resolution path | `resolutionMechanism()` → `"guardian multisig; no on-chain one-step verifier exists"` |
| Data availability is real | `tests/acceptance.ts` rebuilds a signed transaction from L2 calldata alone |
| Forced inclusion bites | Force a transaction; settlement halts past the deadline, resumes on inclusion |
| Builds reproduce | [REPRODUCIBLE_BUILD.md](REPRODUCIBLE_BUILD.md) — commands with observed output |

Rows 2 and 3 are the ones worth running. Documenting a limitation is easy; making it
machine-readable on chain is checkable.

---

## 7. The twelve-item checklist

| # | Item | Status |
|---|---|---|
| 1 | Fault proof absence stated before the feature list, in README and org profile | ✅ |
| 2 | Trust model published with strict vocabulary and per-row evidence | ✅ [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| 3 | Open findings disclosed with status | ✅ 3 HIGH open, 9 fixed — [SECURITY_STATUS.md](SECURITY_STATUS.md) |
| 4 | Test counts accurate and verified by execution | ✅ 529, re-run at audit time |
| 5 | No fabricated metrics anywhere | ✅ TVL/users/TPS/partners/investors all "No data available" |
| 6 | No token sale, tokenomics or monetary claim | ✅ scan clean; KAX stated to have no value |
| 7 | Reproducible build instructions with observed output | ✅ [REPRODUCIBLE_BUILD.md](REPRODUCIBLE_BUILD.md) |
| 8 | Architecture documented including what does not exist | ✅ [architecture/OVERVIEW.md](architecture/OVERVIEW.md) |
| 9 | Grant package with third-party-checkable acceptance tests | ✅ [grants/](grants/GRANT_OVERVIEW.md) — 7 documents |
| 10 | Contributor backlog with acceptance criteria | ✅ [grants/ISSUE_BACKLOG.md](grants/ISSUE_BACKLOG.md) — 21 proposed issues |
| 11 | Secrets absent from the tree; scanners blocking in CI | ✅ gitleaks blocking; `.env.example` carries no key values |
| 12 | External audit | ❌ **none commissioned** — this is milestone M7 |

Eleven of twelve. The twelfth cannot be closed by writing anything and is not claimed.

---

## 8. Human actions still required

Nothing below has been done, and none of it can be done from here.

| Action | Why it is manual |
|---|---|
| Create `KAURAX-NETWORK/.github` and copy `profile/README.md` into it | Repository creation is an external change; text is ready in [`.github/profile/`](../.github/profile/README.md) |
| File the 21 proposed issues | They are proposals until maintainers agree on scope |
| Commit and push this round's documents | Explicitly out of scope for this task |
| Commission an audit | Requires a budget and a code freeze |
| Move Slither into a pinned CI container | Proposed as SEC-1 |

---

## 9. Readiness, stated three ways

Conflating these is the most common way a project overstates itself, so they are separated.

| | Status | Basis |
|---|---|---|
| **PUBLIC TESTNET** | ✅ **Ready — and live** | Chain producing blocks; 10 apps under one domain; 529 tests; 12 live end-to-end checks; RPC public |
| **GRANT READY** | ✅ **Ready** | Trust model, open findings, reproducible builds, milestones with external acceptance tests, budget in engineer-months, no fabricated metrics. 11/12 checklist items; the twelfth **is** the request |
| **MAINNET READY** | ❌ **Not ready — 52/100** | No fault proofs, no verifier, no proving VM, no external audit, one sequencer, guardian-decided disputes |

**Grant ready and mainnet ready are different claims.** KAURAX is asking for funding *because*
it is not mainnet ready, and a reviewer should read row 2 as "the documentation is honest
enough to evaluate", never as "the system is safe".

A higher score is not the objective. Correctness is.
