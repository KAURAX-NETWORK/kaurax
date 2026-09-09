# KAURAX — Mainnet Readiness

**Date:** 2026-09-09 · **Score: 52/100** · **Verdict: not ready, and one reason dominates.**

There is no fault proof system over KAURAX execution (a one-step verifier exists for a
documented EVM subset and is not connected to settlement — see docs/FAULT_PROOFS.md). Everything else on this page is secondary to that, and no
amount of operational polish substitutes for it.

Nothing is marked done unless it was verified. Where evidence is a test, the test is named.

---

## A. Architecture

An application-focused Layer-3 rollup.

```
Ethereum (L1)          settlement and data availability
    ▲
Underlying L2          KauraxPortal · KauraxL2OutputOracle · KauraxBatchInbox
    ▲   batches (calldata) + output roots + bonds
KAURAX (L3)            sequencer · derivation · batcher · proposer
```

There are no validators and no consensus. Ordering is one sequencer's. Security comes from
data availability, forced inclusion, and settlement — not from a quorum. The explorer says
so where users see it.

---

## B. Trust assumptions

| # | Assumption | If violated |
|---|---|---|
| T1 | **Output roots are unverified** | A dishonest proposer commits any root and, once final, withdraws against it |
| T2 | **The guardian decides disputes** | A captured 2-of-3 rules for a liar or against an honest challenger |
| T3 | Single sequencer | Reordering and delay. Not forgery; forced inclusion bounds censorship |
| T4 | Guardian can pause the portal | Withdrawals stop |
| T5 | Forced-inclusion acknowledgement is the sequencer's assertion | Detectable off chain, not proven on it |
| T6 | Operator keys are local on the devnet | Compromising the node yields all three identities |

T1 and T2 are the fault-proof gap. The rest is ordinary operational centralisation.

---

## C. Security model

**Trustless today:** data availability, deposit derivation, forced inclusion, withdrawal
proofs.

**Trusted today:** output roots, dispute resolution, ordering.

Honest summary: *funds are safe if at least one honest party challenges a bad root **and**
the guardian rules correctly.* A fault proof would remove the second clause.

---

## D. Known limitations

1. No fault proof over KAURAX execution. A one-step verifier does exist — a real one, for
   the documented KAURAX Verifiable Subset, with 404 differential cases against a reference
   emulator — and it is deliberately **not** connected to settlement, because KAURAX blocks
   execute on the full EVM and not on that subset. Nothing verifies a KAURAX output root.
2. Bisection reaches a block, not an instruction — no trace commitments exist.
3. Single sequencer; no rotation.
4. Devnet operator keys are local, though the signing seam is implemented and tested.
5. No TLS on the public RPC (host blocks 80/443 on trial accounts).
6. No external audit.
7. No source verification in the explorer — reported as `verified: false`, not hidden.

---

## E. Attack surface

| Surface | Mitigation | Residual |
|---|---|---|
| Malicious proposer | Bonded; anyone may challenge; bisection narrows to one block | **Guardian must rule correctly** |
| Malicious challenger | Bond slashed on a wrong challenge; one live game per output | Griefing costs a bond |
| Sequencer censorship | Forced inclusion halts settlement past the deadline | Sequencer can still delay within the window |
| Sequencer key theft | Signing service available | Not used on the devnet |
| Withdrawal forgery | Merkle proof against a published root | Rests on unverified roots |
| Double withdrawal | `finalizedWithdrawals` mapping | Tested |
| Reentrancy in bonds | Settled flag before transfer | Tested with a real attacker contract |
| Dispute outliving finalization | Live game blocks finalization; portal refuses unsettled outputs | Fixed and tested |
| Bricking a role by misconfiguration | `DeployGuard` refuses to assign a role to an address with no code | Cannot detect the *wrong* live contract |
| Public RPC abuse | Rate limiting; admin namespaces blocked | Verified externally |
| Faucet drain | Per-address and per-IP cooldowns; dedicated key outside the operator roles | Bounded by the faucet's own balance |

---

## F. Security tests executed

Executed for this report, not quoted from memory.

| Suite | Result |
|---|---|
| `forge test` | **385 passed**, 0 failed, 23 suites |
| `pnpm test` | **181 passed**, 0 failed, 29 turbo tasks |
| `tests/e2e-testnet.sh` | **12 passed**, 0 failed, against the live chain |
| Dispute game | 41 tests |
| Adversarial dispute | 11 tests, real attacker contracts |
| Governance | 27 tests |
| Forced inclusion | 21 tests, plus a live-chain run |
| Bridge and portal | 55 tests |
| Merkle proofs | 21 tests including fuzz |
| WAL recovery | 15 tests |
| Derivation checkpoint | 10 tests |
| Signer | 19 tests over a real socket |

Verified live: dispute opened → 4 bisections → guardian resolution → output deleted → node
recovered unaided; proposer escrow held on chain; faucet cooldown enforced.

---

## F2. Fixes completed in this round

Each was implemented, tested, and verified against something real.

| # | Issue | Fix | Evidence |
|---|---|---|---|
| 1 | A role could be assigned to an address from a reverted deployment, unrecoverably | `DeployGuard` library; every deployment script guards each role assignment and each `new` | 8 unit tests; **refused an EOA guardian in a real `forge script` run** and accepted the multisig |
| 2 | Faucet used a published Anvil key on a public endpoint | Rotated to a dedicated key at mnemonic index 9, outside the operator roles | `/api/faucet` reports the new address; 5000 KAX funded |
| 3 | Recovery was scripted but never rehearsed | Ran backup and restore on the live server | Dump 0.5 MB, checksum verified, restored to a scratch database, 7918/7919 rows — the one difference written during the dump |
| 4 | L2 reorg handling had no tests | 5 regression tests | Head behind cursor does not scan; resumes from the cursor not the reorged head; checkpoint never rewinds |
| 5 | Unquoted mnemonic broke `. ./.env` | Quoted on the server | Sourcing produces no errors |

**Not claimed as fixed:** everything in §G. Nothing there moved.

---

## G. Remaining blockers

**Critical**
1. One-step verifier — not started

**High**
2. External audit — not started
3. Guardian is the final arbiter (follows from 1)

**Medium**
4. Sequencer decentralisation — *not fixable safely in this architecture; see below*
5. Operator keys to the signing service in production
6. TLS on the public RPC — *blocked externally; see below*

### Why each remaining blocker remains

**1. One-step verifier over KAURAX execution — NOT FIXABLE HERE.** Requires a proving VM,
execution trace commitments and a preimage oracle over the full EVM: 18–30 engineer-months.
The verifier that exists covers the KVS subset and is unwired by choice; a `step()` that
returned `true` for real KAURAX blocks would let KAURAX claim a property it does not have,
so no such stub exists — not even one that compiles.

**2. External audit — NOT FIXABLE BY THE TEAM.** An internal review by the author of the
code is the weakest kind. This needs an independent firm.

**3. Guardian as final arbiter — FOLLOWS FROM 1.** It cannot be removed before a verifier
exists; something has to decide a narrowed dispute. It was improved as far as this
architecture allows: the arbiter is now a 2-of-3 multisig rather than a key, every
resolution is on chain with a reason, and guardian silence refunds both sides rather than
deciding by inaction.

**4. Sequencer decentralisation — DELIBERATELY NOT ATTEMPTED.** A rotating set is 6–12
engineer-months and belongs *after* fault proofs: distributing block production while nobody
can prove a block wrong spreads the ability to lie rather than removing it. Rushing it would
produce the appearance of decentralisation, which is worse than its acknowledged absence.

**5. Operator keys in production — FIXABLE, NOT DONE HERE.** The signing service is built
and tested (19 tests over a real socket) and the node can run without ever holding a key.
Switching the live devnet means moving keys between processes on a running chain; that is an
operational change deserving its own window, not a side effect of this work.

**6. TLS — BLOCKED EXTERNALLY.** UpCloud blocks inbound 80 and 443 on trial accounts. Proven
by serving on 8880 from the same host and reaching it while 80 stayed filtered under
identical firewall rules, and by the API refusing to disable the firewall at all
(`TRIAL_FIREWALL`). Nothing in the code prevents TLS; upgrading the account unblocks it.

---

## H. Operational requirements

| | Status |
|---|---|
| Persistent sequencer with restart | ✅ `restart: unless-stopped`; WAL survives SIGKILL |
| Health endpoints | ✅ `/api/health`, `/api/health/ready`, per-dependency |
| Graceful shutdown | ✅ readiness flips, drains, hard timer |
| Structured logging | ✅ JSON with request ids |
| Metrics | ✅ Prometheus on 7300 |
| Backups | ✅ script verifies by restoring and comparing rows |
| Recovery rehearsal | ✅ performed on the server — backup, checksum, restore, row comparison |
| Alerting | ✅ Alertmanager routes by severity to a configured destination; `tests/check-alerting.sh` proves a real alert reaches a receiver |

Documented failure behaviour for every component: `docs/TESTNET.md`.

---

## I. Fault proof roadmap

`docs/FAULT_PROOF_ROADMAP.md`. Summary: a proving VM, trace commitments, a preimage oracle
and a one-step verifier — **18–30 engineer-months**, then an audit. The dispute game was
built so integration replaces one call and leaves bonds, timeouts and settlement untouched.

---

## J. Launch checklist

**Done**
- [x] Contracts deploy reproducibly
- [x] Node syncs, produces, batches, proposes
- [x] Data availability verified by reconstruction
- [x] Forced inclusion verified on a live chain
- [x] Withdrawal proofs verified
- [x] Dispute game with bonds and bisection
- [x] Proposer escrow at proposal time
- [x] Finalization blocked during a dispute
- [x] **Governance holds portal guardian, inbox owner and dispute guardian** (2-of-3, 1h timelock)
- [x] Wallet with real signing; keys encrypted at rest
- [x] Faucet with cooldowns
- [x] Health, metrics, structured logs
- [x] Backups that verify by restoring
- [x] Deployment scripts refuse to assign a role to an address with no code
- [x] Faucet key is not a published one
- [x] Backup and restore rehearsed on the server
- [x] 385 + 181 + 12 tests passing

**Not done**
- [ ] One-step verifier
- [ ] External audit
- [ ] Sequencer decentralisation
- [ ] TLS on the public RPC
- [ ] Operator keys on the signing service in production
- [ ] Alerting

### An incident worth recording

While handing roles to governance, `forge script` printed contract addresses from a run that
**reverted**. Those are simulated addresses; nothing was deployed at them. Pointing live
roles at one bricked the portal guardian, inbox owner and dispute guardian — unrecoverable,
because only the current holder may rotate a role.

Recovered by redeploying on the devnet, which a mainnet would not permit. The wiring script
now refuses to assign a role to an address with no code, and governance is set at
construction rather than transferred afterwards.

**Any mainnet role handover must verify code at the target address first, and rehearse the
whole sequence on a fork.**

---

## Score: 52/100

Every row states what would have to be true for the score to move, and names the command that
produced its evidence. Nothing here is quoted from an earlier report.

| Category | Weight | Score | STATUS |
|---|---|---|---|
| Execution and DA | 15 | 15 | **PASS** |
| Settlement mechanics | 10 | 9 | **PARTIAL** |
| Censorship resistance | 10 | 9 | **PARTIAL** |
| Bridge and withdrawals | 10 | 8 | **PARTIAL** |
| Dispute game | 10 | 9 | **PARTIAL** |
| **Fault proofs** | **25** | **0** | **FAIL** |
| Governance | 5 | 5 | **PASS** |
| Key management | 5 | 2 | **PARTIAL** |
| Operations | 5 | 5 | **PASS** |
| **Audit** | **5** | **0** | **FAIL** |
| **Total** | **100** | **52** | |

### Execution and DA — PASS · 15/15

**EVIDENCE:** `tests/acceptance.sh` steps 5–8. Step 8 takes only what is on the L2, decodes
the batch calldata, recomputes `keccak256` of each raw transaction and finds the one it sent.
The KAURAX node is not consulted. Runs on every push.

**REMAINING WORK:** none for this category. Blob-based DA would reduce cost, not increase
assurance.

### Settlement mechanics — PARTIAL · 9/10

**EVIDENCE:** `tests/acceptance.sh` step 9; `KauraxL2OutputOracle.t.sol` (13);
`tests/dispute.sh` step 4 shows the finalization interlock holding on a live chain — the
output stays unfinalized past the window because a game is open.

**REMAINING WORK:** output roots commit to `(version, stateRoot, withdrawalTreeRoot,
latestBlockHash)` and nothing about the execution that produced them. Add a trace root and
upgrade proposer, oracle and portal together. The point cannot be recovered before that.

### Censorship resistance — PARTIAL · 9/10

**EVIDENCE:** `tests/forced-inclusion.sh` against a live chain; `ForcedInclusion.t.sol` (21).
An ignored forced transaction makes the oracle reject every proposal.

**REMAINING WORK:** the acknowledgement is the sequencer's assertion, detectable off chain but
not proven on it. Proving it requires the same execution trace as the fault proof.

### Bridge and withdrawals — PARTIAL · 8/10

**EVIDENCE:** `tests/acceptance.sh` steps 10–11; `KauraxPortal.t.sol` (25), `Bridge.t.sol`
(6), `BridgeReentrancy.t.sol` (5), `MerkleTree.t.sol` (8), `L3ToL2MessagePasser.t.sol` (11),
`KauraxBridgedERC20.t.sol` (12). Both bridges and the message passer are at 100% line coverage
and inside the CI floor.

**REMAINING WORK:** withdrawals rest on unverified output roots, so this cannot exceed 8 until
fault proofs exist. Finding **H-4** — the escrow could be credited more than it received via a
token that re-enters `transferFrom` — was found and fixed in this round; the score does not
rise, because it was never accounting for a bug nobody knew about.

### Dispute game — PARTIAL · 9/10

**EVIDENCE:** `DisputeGame.t.sol` (41), `DisputeGameAdversarial.t.sol` (11) with real attacker
contracts, and now `tests/dispute.sh` — 23 checks against **deployed contracts on a live
chain**: a challenger holding no role opens a game, the range narrows 11 → 5 blocks,
finalization is blocked while the game is live, the root is deleted, and the contract holds
nothing afterwards. The devnet deploys the game and transfers the challenger role, so this is
reproducible by anyone.

**REMAINING WORK:** a *contested* claim is still decided by the guardian. The live run
resolves on the clock because the proposer abandons its claim, which needs no trusted party —
but that is the uncontested path. Replace `resolve` with `proveStep`.

### Fault proofs — FAIL · 0/25

**EVIDENCE:** `KauraxDisputeGame.isFaultProof()` returns `false`, asserted by
`DisputeGame.t.sol:508`. A real one-step verifier exists for the KAURAX Verifiable Subset
(`KVSVerifier.t.sol`, 404 differential cases, now checked against the *current* emulator by
`tests/check-kvs-fixtures.sh`) and is referenced by tests only.

**REMAINING WORK:** [FAULT_PROOF_GAP_ANALYSIS.md](docs/FAULT_PROOF_GAP_ANALYSIS.md). The
blocker is that KAURAX's state transition function is `anvil` over JSON-RPC and cannot emit a
trace. 18–30 engineer-months. **The score stays at 0 until a dispute is decided on chain with
no guardian transaction** — work on the KVS does not move it, and this round's M0 explicitly
did not.

### Governance — PASS · 5/5

**EVIDENCE:** `Governance.t.sol` (27), `TimelockSelfAdmin.t.sol` (16), `DeployGuard.t.sol` (8).
A 2-of-3 multisig and a 1-hour timelock hold every privileged role; roles cannot be assigned
to an address with no code; shortening the timelock delay still costs the current delay.

**REMAINING WORK:** none for a testnet. A mainnet would want a longer delay and a published
signer set.

### Key management — PARTIAL · 2/5

**EVIDENCE:** signing service built and tested over a real socket (19 tests); the node can run
without ever holding a key. `KAURAX_SIGNER_MODE=local` on the devnet.

**REMAINING WORK:** move the sequencer, batcher and proposer keys onto the signing service in
the live deployment. This is an operational change on a running chain and deserves its own
window.

### Operations — PASS · 5/5

**EVIDENCE:** health endpoints with bounded probes (`health-deadlines.test.ts`); Prometheus on
7300; backup verified by restoring and comparing rows; `tests/chaos.sh` fault injection;
`tests/reproduce.sh` runs the whole thing from a clean clone.

Alerting now delivers. `prometheus.yml` had no `alerting:` block and no Alertmanager was
deployed, so every rule evaluated into a UI nobody is watching at 3am. Alertmanager routes by
severity with four inhibition rules, and `tests/check-alerting.sh` posts a real
`KauraxSequencerDown` through the real routing tree and asserts a receiver was called. It runs
in CI.

The failure mode is now unreachable rather than merely fixed: a missing bind-mount source is
not an error to Docker — it creates an empty directory, and Alertmanager starts cleanly and
fails only when an alert fires. `deploy.sh` refuses to deploy without a destination file, and
refuses if it still holds the example value.

**REMAINING WORK:** an external dead-man's switch. If Alertmanager itself is down, Prometheus
has nowhere to send the alert saying so. That needs a heartbeat routed to a third-party service
that pages when the heartbeat stops, which is a deployment decision rather than code.

### Audit — FAIL · 0/5

**EVIDENCE:** none. No external firm has read this code.

**REMAINING WORK:** commission one. Not fixable by the team, and an internal review by the
author of the code is the weakest kind there is.

---

### Why the total moved 52 → 51 → 52

Operations was scored 5/5 while its own note said alerting was absent; the two could not both
be true, and the note was the accurate half, so it went to 4. Alerting now delivers and is
verified end to end in CI, so it returns to 5.

That round trip is the point rather than an embarrassment: the row moved down when the claim
was checked and back up when the gap was closed, which is what a scorecard is for.

This round fixed a HIGH severity bug in the bridge, raised four security-critical contracts
from below the coverage floor to 100%, put the dispute game on the devnet and demonstrated it
live, and closed a hole in the differential rig that let the verifier drift from its reference.
**None of that moves the score**, because none of it changes what the system assumes. That is
the intended behaviour of this scorecard: it measures trust removed, not work done.

Fault proofs and the audit are 30 of the 100 and both remain zero. No amount of work outside
those two moves the number past about 70.

The honest position is unchanged: a well-built rollup with a real dispute game and no fault
proof system.
