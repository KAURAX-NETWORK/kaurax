# KAURAX — Internal Security Review

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
| MEDIUM | 5 | 4 |
| LOW | 4 | 3 |
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

254 contract tests are evidence of intent, not of correctness. The settlement, bridge and
dispute contracts have never been read by an independent party.

*Fix:* audit before any deployment carrying value.

---

## MEDIUM

### M-1 — A dispute can outlive the finalization window
**Open. Handled, not solved.**

The oracle finalizes on a timer that a live dispute does not pause. A game that runs past
that point ends with the output already finalized and undeletable. The game pays the
challenger and emits `DisputeOutlivedFinalization` rather than reverting and stranding the
bond, but the wrong commitment survives.

*Found by:* `test_cannotTimeoutTwice` failing with `CannotDeleteFinalized` during
development.

*Fix:* the oracle must refuse to finalize an output with a live game. Not done here because
it changes the finalization rule the portal's withdrawal path also reads, and that deserves
its own change and its own tests.

### M-2 — Proposer bonds late
**Open.**

The proposer stakes on its first defence, not at proposal time, so an output root carries no
stake until challenged. A proposer that never intends to defend loses only the output.

*Fix:* escrow at proposal time. `proposeL2Output` is already `payable`, so the plumbing
exists.

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

### L-2 — Faucet uses a published devnet key
**Open, devnet only.** The faucet account is a well-known Anvil key. Anyone can drain it.
It is isolated from the operator roles, so the blast radius is the faucet's own balance. A
public testnet needs a key that is not published.

### L-3 — `getGame` panicked on an unknown id
**Fixed.** Returned an array out-of-bounds panic instead of `UnknownGame`. Found by
`test_unknownGameReverts`.

### L-4 — Unquoted mnemonic in `.env`
**Open, cosmetic.** `KAURAX_DEV_MNEMONIC=word word word` breaks `. ./.env` in a shell.
Docker Compose parses the file directly so the stack is unaffected.

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
