# KAURAX — Internal Security Review

> **HISTORICAL SNAPSHOT.** This is the internal security review as it stood when written, kept
> unaltered so findings can be traced. For current status see
> [SECURITY_STATUS.md](SECURITY_STATUS.md) and
> [TEST_STATUS.md](TEST_STATUS.md). Individual findings below carry their own
> current state where it has changed.


**Date:** 2026-09-08
**Reviewer:** internal. **This is not an audit.** No external firm has examined this code,
and an internal review by the person who wrote the code is the weakest kind there is.

Findings are listed whether or not they are convenient. Two of them were found by tests
written during this work; two were live outages I caused and fixed.

---

## Summary

| Severity | Count | Open |
|---|---|---|
| CRITICAL | 0 | 0 |
| HIGH | 3 | 3 |
| MEDIUM | 5 | 2 |
| LOW | 4 | 1 |
| INFORMATIONAL | 3 | 2 |

No CRITICAL findings does not mean the system is safe. The HIGH findings are structural and
all three are open.

---

## HIGH

### H-1 — No fault proof system
**Open. This is the finding.**

Output roots are accepted because the proposer key signed them. Nothing verifies they
correspond to any execution. A dishonest proposer can commit an arbitrary root and, once it
finalizes, withdraw against it.

The dispute game reduces the exposure — anyone can object, and objecting is cheap relative
to lying — but the guardian decides, so the ceiling on security is the guardian's honesty
and competence.

*Fix:* implement `docs/FAULT_PROOF_SPEC.md`. Nothing else closes it.

### H-2 — Guardian is the final arbiter
**Open. By design, documented.**

`KauraxDisputeGame.resolve` is `onlyGuardian`. A captured guardian can rule for a lying
proposer, or against an honest one. It cannot rewrite finalized history — the oracle refuses
to delete a finalized output — but within the window it decides outcomes.

*Mitigations in place:* every move and resolution is on chain with a reason string, so
decisions are auditable after the fact; guardian inaction refunds both sides rather than
deciding by silence.

*Fix:* the verifier. Interim: the guardian should be the multisig behind a timelock, which
is deployed but **not yet holding the role**.

### H-3 — No external audit
**Open.**

270 contract tests are evidence of intent, not of correctness. The settlement, bridge and
dispute contracts have never been read by an independent party.

*Fix:* audit before any deployment carrying value.

---

## MEDIUM

### M-1 — A dispute could outlive the finalization window
**Fixed.**

The oracle finalizes on a timer that a live dispute does not pause. A game that runs past
that point ends with the output already finalized and undeletable. The game pays the
challenger and emits `DisputeOutlivedFinalization` rather than reverting and stranding the
bond, but the wrong commitment survives.

*Found by:* `test_cannotTimeoutTwice` failing with `CannotDeleteFinalized` during
development.

*Fix applied:* `isOutputFinalized` consults the dispute game, and the portal refuses to
finalize a withdrawal against an unsettled output — the second half matters, because the
portal gates on the *proof's* age, so without it a withdrawal could complete against a
commitment still under dispute.

### M-2 — Proposer bonded late
**Fixed.**

The proposer stakes on its first defence, not at proposal time, so an output root carries no
stake until challenged. A proposer that never intends to defend loses only the output.

*Fix applied:* the oracle escrows `PROPOSER_BOND` at proposal time. Forfeited to the
challenger on a loss; refunded to the proposer when the output finalizes; refunded to
proposers of outputs deleted as collateral, which were never adjudicated.

### M-3 — Operator keys held locally on the devnet
**Open.**

`KAURAX_SIGNER_MODE=local` puts the sequencer, batcher and proposer keys in the process
environment. Compromising the node yields all three.

*Mitigation:* the signing seam is implemented and tested (19 tests); the node can run
without ever holding a key. The devnet does not use it.

### M-4 — RPC served over plain HTTP
**Open.**

No TLS, so RPC traffic is readable and modifiable in transit. Blocked on DNS records and on
the host blocking 80/443 for trial accounts.

### M-5 — CORS misconfiguration caused a silent total failure
**Fixed.**

The API read `API_CORS_ORIGINS`; the deployment set `CORS_ORIGINS`. The allow-list was empty,
so no preflight was answered and every cross-origin browser call failed — while `curl`, which
sends no preflight, kept returning 200. A one-word difference produced a complete outage for
real users and no signal for the operator.

*Fix:* both names are now accepted. The lesson generalises: a security control that fails
closed *and* silently is worse than one that fails loudly.

---

## LOW

### L-1 — One live game per output allows mild griefing
**Open, accepted.** A challenger can open a game and abandon it, delaying the next challenger
by one timeout. The alternative — parallel games — lets one bond force a proposer to defend
many at once, which is worse. Cost of the grief is the challenger's bond.

### L-2 — Faucet used a published devnet key
**Fixed.** Rotated to a dedicated key derived at mnemonic index 9, outside the operator
roles and outside the genesis demo accounts. Draining it still cannot touch the sequencer,
batcher or proposer, and it is no longer a key anyone can look up.

### L-3 — `getGame` panicked on an unknown id
**Fixed.** Returned an array out-of-bounds panic instead of `UnknownGame`. Found by
`test_unknownGameReverts`.

### L-4 — Unquoted mnemonic in `.env`
**Fixed.** Quoted. Docker Compose parses the file itself and was unaffected, which is why
this survived: it only broke the scripts that source the file, and those failed in a way
that looked like a different problem.

---

## INFORMATIONAL

### I-1 — Determinism is assumed, not specified
revm is deterministic in practice. Nothing pins the EVM version or tests against a second
implementation. A prerequisite for any verifier.

### I-2 — Explorer reports `verified: false` for all contracts
Correct — there is no source verification service. Listed so nobody mistakes it for a bug.

### I-3 — Sequencer is a single operator
Not a defect at this stage. Forced inclusion bounds the damage: an ignored forced
transaction halts settlement for everyone, verified on a live chain.

---

## Checked and found sound

Stated so the review is not only a list of problems. Each was examined and, where a test
exists, it is named.

| Area | Finding |
|---|---|
| Reentrancy in bond settlement | Sound. Settled flag written before any transfer; verified with an attacker contract that actually re-enters (`test_reentrantWinnerCannotSettleTwice`) |
| Bond accounting | Sound. Contract holds nothing after every terminal path; conservation fuzzed |
| Failed payouts | Sound. Reverts rather than silently keeping funds |
| Double resolution | Sound. Guarded by the settled flag and by status checks |
| Access control on the game | Sound. Proposer, challenger and guardian roles each tested for unauthorised callers |
| Timeout fairness | Sound. Winner determined by whose turn lapsed, not by who called |
| Withdrawal proofs | Sound. Merkle proof required; no operator approval path |
| Deposit censorship | Sound. Derived from L2 events |
| Admin RPC exposure | Sound. `anvil_*` and `evm_*` refused on the public endpoint, verified externally |
| Internal ports | Sound. Engine, PostgreSQL and Grafana unreachable from the internet, verified externally |
| Integer overflow | Sound. Solidity 0.8 checked arithmetic; no `unchecked` blocks in the dispute game |
| Role assignment to a dead address | Sound as of this round. `DeployGuard` refuses any address without code; proven by refusing an EOA guardian in a real deployment |
| L2 reorg during derivation | Sound. Scanning stops while the head is behind the cursor, resumes from the cursor rather than the reorged head, and the durable checkpoint never rewinds (5 tests) |
