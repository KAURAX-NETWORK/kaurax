# KAURAX — Engineering Status, 2026-09-09

**Round:** audit, security, fault-proof gap analysis, reproducible evidence, readiness and
funding documentation. **Base:** `986607b`.

Every number here came from running the command named beside it, on this commit. Nothing is
quoted from an earlier report.

---

## 1. What was changed

Ordered by how much it matters, not by size.

### A HIGH severity bug was found and fixed

**H-4 — `KauraxL2ERC20Bridge` could credit KAURAX with more than it escrowed.**

`bridgeERC20To` measures `balanceOf` before and after pulling tokens so that a fee-on-transfer
token cannot mint more on KAURAX than was escrowed. That measurement spans `transferFrom` — an
external call into a token address the caller chooses, with no allow-list — and the contract
had no reentrancy guard.

A token that calls back during `transferFrom` (ERC-777's `tokensToSend`, a finalised standard
with deployed tokens) lets a depositor re-enter. The inner deposit's tokens arrive before the
outer deposit reads its "after" balance, so the outer counts them as its own and credits them
twice. The surplus is unbacked supply on KAURAX, redeemable against other users' escrow until
`finalizeWithdrawal` starts reverting for whoever withdraws last.

Reproduced before fixing: **escrowed 200e18, credited 300e18**.

Slither's `reentrancy-balance` detector reports it, but the version pinned by
`crytic/slither-action@v0.4.0` predates that detector — 99 detectors against 101 in 0.11.6 —
so CI could not have caught it. It surfaced only when slither was run locally at a current
version.

### The evidence behind the strongest fault-proof claim was not being checked

`KVSVerifier.t.sol` compares the Solidity verifier against a **committed fixture**, not against
the live emulator. A change to the emulator did not fail it: the fixture went stale and the
test kept passing against a frozen artefact while the two implementations diverged.

Demonstrated, not argued: changing `VERYLOW` from `3n` to `4n` in `packages/kvs/src/gas.ts`
left **all 29 emulator tests and all 6 verifier tests passing**. Regenerating the fixture with
that change in place failed immediately. The rig was correct; nothing regenerated its input.

### The dispute game was not on the devnet at all

One of KAURAX's headline properties, and nobody cloning the repository could reproduce a single
claim about it. It is now deployed by `start.sh` with the challenger role actually transferred —
without that, the oracle does not know about the game, finalization stays a bare timer, and a
single key can still delete output roots.

### Documentation contradicted itself, in the direction of understating the work

`README.md` said "no verifier and no stub" forty lines below its own callout saying a one-step
verifier exists. `MAINNET_READINESS.md` said the same in §D.1 and, in §G.1, "no stub exists —
not even one that compiles", while §F of the same document counted the 404 differential cases
that verifier passes.

### Four new CI gates, each added after finding the drift it prevents

| Gate | Prevents |
|---|---|
| Prose counts in `check-doc-counts.sh` | The README advertised a contract/node tally two rounds out of date, while the gate reported success |
| Per-suite table reconciliation | `TEST_STATUS.md` listed 17 suites summing to 322 under a heading claiming 338 |
| `check-kvs-fixtures.sh` | The verifier drifting from the emulator it claims to agree with |
| Readiness-score consistency | The score had spread to thirteen documents with nothing comparing them |

Each was verified to fail when it should, not only to pass.

---

## 2. Files changed

56 files. The ones that matter:

| File | Change |
|---|---|
| `src/libraries/ReentrancyGuard.sol` | **new** — transient-storage guard (EIP-1153) |
| `src/L2/KauraxL2ERC20Bridge.sol` | H-4 fix |
| `test/BridgeReentrancy.t.sol` | **new** — 5 tests, the exploit and its controls |
| `test/Hashing.t.sol` | **new** — 11 tests, consensus-critical hashing pinned |
| `test/L3ToL2MessagePasser.t.sol` | **new** — 11 tests |
| `test/KauraxBridgedERC20.t.sol` | **new** — 12 tests |
| `test/AddressAliasHelper.t.sol` | **new** — 8 tests |
| `blockchain/l3/test/hashing.test.ts` | The TypeScript half of the two-sided pin |
| `tests/dispute.ts` / `dispute.sh` | **new** — 23 checks against deployed contracts |
| `tests/reproduce.sh` | **new** — one command, clean clone to full evidence |
| `tests/check-kvs-fixtures.sh` | **new** — the fixture freshness gate |
| `infra/monitoring/alertmanager.yml` | **new** — routing, severity split, four inhibition rules |
| `tests/check-alerting.sh` | **new** — proves a real alert reaches a receiver |
| `tests/check-doc-counts.sh` | Prose, per-suite table and score checks |
| `tests/apps-smoke.ts` | Seeds a fresh chain instead of failing on missing state |
| `tests/forced-inclusion.sh` | Records the node's real pid, not the subshell's |
| `infra/scripts/devnet/start.sh` | Deploys governance and the dispute game |
| `.github/workflows/ci.yml` | Build ordering, coverage floor 5 → 13 contracts, two new gates |
| `docs/NEXT_PHASE_ENGINEERING_PLAN.md` | **new** |
| `docs/FAULT_PROOF_GAP_ANALYSIS.md` | **new** |
| `docs/REPRODUCIBLE_TESTNET_DEMO.md` | **new** |
| `docs/FUNDING_TECHNICAL_BRIEF.md` | **new** |
| `MAINNET_READINESS.md` | STATUS / EVIDENCE / REMAINING WORK per category |
| `README.md` | WORKING / EXPERIMENTAL / MISSING / NOT AUDITED / NOT MAINNET READY |

---

## 3. Tests executed

| Suite | Command |
|---|---|
| Solidity | `forge test` |
| Node and services | `pnpm test` |
| Formatting | `forge fmt --check` |
| Coverage floor | `forge coverage` + the CI gate |
| Static analysis | `slither . --exclude-dependencies --exclude naming-convention` |
| Doc counts and score | `./tests/check-doc-counts.sh` |
| KVS fixture freshness | `./tests/check-kvs-fixtures.sh` |
| Acceptance | `./tests/acceptance.sh` |
| Dispute game | `./tests/dispute.sh` |
| Application contracts | `./tests/apps-smoke.sh` |
| Forced inclusion | `./tests/forced-inclusion.sh` |
| Devnet restartability | `stop.sh && start.sh && status.sh` |
| Everything, from clean | `./tests/reproduce.sh` |

---

## 4. Tests passed

| | Before | After |
|---|---|---|
| `forge test` | 338, 18 suites | **385, 23 suites** |
| `pnpm test` | 179 | **181** |
| `tests/acceptance.sh` | 47 | 47 |
| `tests/apps-smoke.sh` | 43 of 45 (2 failed on a fresh chain) | **45** |
| `tests/dispute.sh` | did not exist | **23** |
| Slither High findings | 2 | **0** |

Coverage, on contracts that were below the 80% floor:

| | Before | After |
|---|---|---|
| `KauraxBridgedERC20` | 50.00% | **100%** |
| `L3ToL2MessagePasser` | 71.43% | **100%** |
| `AddressAliasHelper` | 71.43% | **100%** |
| `Hashing` | 66.67% | **100%** |

The coverage gate now covers **13 contracts, up from 5**, and a name in the list with no
matching row is an error rather than a warning — a missing row means the floor is not being
enforced, which is indistinguishable from passing.

**CI:** `ci` and `security` are both fully green — `lint, typecheck, unit tests`, `contracts`,
`coverage` and `devnet end-to-end` all pass. Every workflow had been failing on every commit
for the whole visible history before this and the preceding round.

---

## 5. Tests failed

**None outstanding in `ci`, `security`, `contracts` or `frontend`.**

`deploy` fails at "Check the deployment target is configured" because `UPCLOUD_HOST` is not
set. That is the gate working: it refuses to deploy to an unconfigured target. It needs a
decision about the deployment target, not a code fix.

Failures encountered and fixed during the round, listed because they were real:

| Failure | Cause |
|---|---|
| `@kaurax/api` build in CI | `pnpm --filter <pkg> build` builds only that package; `@kaurax/types` was never built. Same defect in README's quickstart, which failed on a fresh clone |
| `apps-smoke` on a fresh chain | Asserted pre-existing state; the whole AMM section was silently skipped |
| `dispute.sh` after `acceptance.sh` | Acceptance advances the L2 clock to finalize a withdrawal, which finalizes every output, leaving nothing challengeable |
| Devnet not restartable | `forced-inclusion.sh` recorded a subshell's pid, so `stop.sh` killed the wrapper and orphaned the node on port 8420 |
| Governance deploy printed nothing | `--silent` suppresses `console2.log`, and the empty `grep` aborted the script under `pipefail` before the error message could print |

---

## 6. Security issues fixed

| ID | Issue | Evidence |
|---|---|---|
| **H-4** | Bridge escrow could be credited more than it received | `BridgeReentrancy.t.sol`; verified failing without the guard |
| — | Consensus-critical hashing had no Solidity-side test, and the TypeScript test recomputed its own expectation rather than pinning Solidity's | Three shared vectors asserted on both sides; verified by swapping two fields |
| — | Bridges, message passer, bridged token and hashing outside the coverage floor | Gate extended 5 → 13 contracts |
| — | The KVS differential rig could not detect emulator drift | `check-kvs-fixtures.sh` |
| — | Slither's two High findings | One real (H-4), one false positive; both now clean |
| O-5 | Alert rules evaluated and reached nobody | Alertmanager deployed and routed; `tests/check-alerting.sh` posts a real alert through the real routing tree and asserts a receiver was called |

---

## 7. Security issues remaining

| ID | Issue | Status |
|---|---|---|
| **H-1** | No fault proof over KAURAX execution | **OPEN** — structural, 18–30 engineer-months |
| **H-2** | Guardian is the final arbiter of a contested dispute | **OPEN** — follows from H-1 |
| **H-3** | No external audit | **OPEN** — not fixable by the team |
| M-3 | Operator keys local on the devnet | OPEN — signing service built, not in use |
| M-4 | No TLS on the public RPC | OPEN — blocked by the host on trial accounts |
| L-1 | One live game per output allows mild griefing | OPEN, accepted |
| I-1 | KAURAX's own STF is unpinned and untested against a second implementation | OPEN — M1 |

---

## 8. Fault proof status

**KAURAX has no fault proof over its own execution.** Unchanged, and nothing in this round
moved it.

What exists: a real 544-line on-chain one-step verifier for the documented KAURAX Verifiable
Subset, agreeing with a reference emulator on 404 differential cases; a multi-level dispute
game that bisects block → transaction → instruction and terminates in that verifier; a trace
commitment scheme with correct padding. All of it referenced by tests only.

What blocks it: KAURAX's state transition function is `anvil` reached over JSON-RPC. It cannot
emit a per-instruction trace and cannot be re-executed one step at a time, so there is nothing
for a verifier to check. Output roots also commit to nothing about the execution that produced
them.

**M0 was completed this round** — the differential rig is now checked against the current
emulator rather than a frozen fixture. It removes no trust assumption and moves no score. The
next milestone is **M1**, pinning the STF, because M2 cannot be specified until the behaviour
being reproduced is.

Measured against the code: [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md).

---

## 9. Mainnet readiness score

**52/100**, unchanged in total but not in composition.

Operations went 5 → 4 → 5. It had been scored 5/5 while its own note said alerting was absent;
the two could not both be true, so it went to 4. Alertmanager then closed the gap and it
returned to 5. The round trip is the scorecard working: down when the claim was checked, up
when the gap was closed.

Fixing a HIGH severity bug, raising four contracts to 100% coverage, putting the dispute game
on the devnet and closing a hole in the differential rig **moved nothing**, because none of it
changed what the system assumes. That is the scorecard working as intended: it measures trust
removed, not work done.

Fault proofs (25) and audit (5) remain at zero. No work outside those two moves the number past
about 70.

---

## 10. The next five engineering milestones

1. **Pin the state transition function (M1)** — fix the EVM version, test KAURAX's own
   execution against a second implementation, record divergences. 1–2 engineer-months. Closes
   I-1 and is the prerequisite for everything after it.

2. **Replace the execution engine with something provable (M2)** — an in-process,
   instrumentable EVM that emits a per-instruction trace. 3–6 engineer-months. **The blocker.**
   Nothing about fault proofs can proceed until this is done.

3. **Move operator keys onto the signing service in the live deployment** — built and tested
   over a real socket; switching a running chain deserves its own window. Closes M-3.

4. **Commission an external audit of the settlement, bridge and dispute contracts** — closes
   H-3, and it is the only one of these that cannot be done by writing code. Ring-fence the
   budget, because it gets reallocated exactly when engineering runs long.

5. **An external dead-man's switch for alerting** — Alertmanager now delivers, but if
   Alertmanager itself is down, Prometheus has nowhere to send the alert saying so. A heartbeat
   routed to a third-party service that pages on silence is the only thing that closes it.

Explicitly **not** next: sequencer decentralisation. Distributing block production while nobody
can prove a block wrong spreads the ability to lie rather than removing it.
