# KAURAX Public Release Audit

**Date:** 2026-09-08 · **Commit:** `6b1f81a` · **Auditor:** internal

## Executive Result

**READY FOR HUMAN REVIEW.** No secrets were found in the working tree or in git history. Four
items need a person's judgement rather than a fix; none is a security defect.

This audit was performed by the same party that wrote the code, which is its principal
weakness.

---

## Repository Security

Scanned every tracked file for twelve credential classes: OpenAI-style keys, UpCloud tokens,
GitHub tokens, AWS access keys, Slack tokens, PEM private keys, JWTs, SendGrid and GitLab
tokens, certificates, database URLs with embedded passwords, and SSH material.

**Result: zero.**

Sensitive file types — `.pem`, `.key`, `.p12`, `.seed`, `.mnemonic`, `.sqlite`, `.dump` — none
tracked. The only `.env` file tracked is `.env.example`.

Every 64-character hex string was classified by the name it is bound to rather than by shape:
an ERC-20 topic0 and a Merkle root look identical to a private key. None is bound to a
key-like name outside the test trees and the devnet script.

## Git History Security

**Category A — no secrets ever committed.**

All **1069 blobs** across all 28 commits were decompressed and scanned. Zero hits. `.env` was
never tracked at any commit. The three credentials that passed through this project's
development — an AI gateway API key, a hosting API token, and a hosting account password —
appear in zero blobs.

**No history rewrite is required.**

## Secrets

None found. Nothing to redact, rotate as a release blocker, or purge from history.

One credential warrants rotation as hygiene, not as a blocker: the xKiro API key lives in the
server's `.env` (untracked, mode 600) but was pasted into a development conversation. It is
not in the repository.

## Documentation

| Document | Status |
|---|---|
| README.md | Leads with limitations before capabilities |
| MAINNET_READINESS.md | 52/100, sections A–J, evidence per row |
| SECURITY_REVIEW.md | 3 HIGH open, including two self-inflicted outages |
| SECURITY.md | Known limitations explicitly not vulnerabilities |
| ARCHITECTURE_AUDIT.md | Six trusted components named |
| FAULT_PROOF_SPEC / ROADMAP | Design only; 9 components NOT STARTED |
| GRANT_READINESS.md | Limitations stated, not buried |
| ROADMAP.md / FUNDING.md | No token sale, no returns, no date for fault proofs |

Checked for contradictions. The score reads 52/100 consistently. No document claims
trustlessness, fault proofs, decentralisation, mainnet readiness, an audit, or monetary value
for KAX.

## CI

Test workflows (`ci`, `contracts`, `frontend`, `docker`) reference **no secrets** and run on
pull requests — a fork can run them. Deployment workflows reference nine secrets between them
and are `workflow_dispatch` only, so a fork PR cannot trigger them.

Two gates were hardened during this audit: gitleaks was `continue-on-error` and is now
blocking, and the private-key scan now inspects context instead of raw hex.

That second change fixed a real defect. The old pattern excluded `/tests/` with a leading
slash, which never matches a top-level `tests/` directory — so the check had been passing
over the test tree it believed it was excluding, and would equally have passed over a real
key placed there.

## Tests

| Command | Result |
|---|---|
| `forge test` | **270 passed**, 0 failed, 14 suites |
| `pnpm test` | **126 passed**, 0 failed, 25 packages |
| `tests/e2e-testnet.sh` | **12 passed**, 0 failed, live chain |
| `pnpm typecheck` | 25/25 |
| `pnpm build` | 19/19 |

Re-run after every change in this audit, not quoted from the previous report.

## Architecture

An Ethereum L3 rollup: Ethereum → an underlying L2 → KAURAX. Sequencing, derivation,
batching to L2 calldata, output roots, forced inclusion, proof-based withdrawals, a bonded
dispute game, and governance holding every privileged role.

**No validator consensus, because a rollup does not have one.** Ordering is the sequencer's;
security comes from data availability, forced inclusion and settlement. Documented in
`docs/architecture.md` and stated in the explorer where users see it.

## Known Limitations

Testnet only. KAX has no monetary value. No fault proof system and no one-step verifier.
Output roots are trusted. A 2-of-3 multisig is the final dispute arbiter. One sequencer. No
external audit. No TLS on the public RPC. The production signing service is built and tested
but not active. No bug bounty.

All of these are in the README, and none was removed to improve a score.

## Critical Blockers

**None for a public release.**

The blockers are to *mainnet* and are unchanged: no verifier, no audit, guardian arbitration.

## Required Human Actions

1. Rotate the xKiro API key — hygiene, not a blocker
2. Decide how to present the RPC's lack of TLS, or upgrade the host account
3. ~~Confirm the security contact receives mail~~ — done; `SECURITY.md` now lists a mailbox the maintainer controls
4. Review this audit independently — it was written by the author of the code

## Final Recommendation

**Release after human review.** The repository is clean, the documentation is honest about
what does not exist, the tests reproduce, and CI runs without production credentials.

What would make it stronger is not more work by me. It is somebody else reading it.

---

| Category | Status |
|---|---|
| Current tree secrets | **PASS** |
| Git history secrets | **PASS** |
| .gitignore | **PASS** |
| README | **PASS** |
| Security policy | **PASS** — contact verified |
| Architecture docs | **PASS** |
| CI | **PASS** |
| Solidity tests | **PASS** (270) |
| Package tests | **PASS** (126) |
| E2E | **PASS** (12) |
| Grant readiness | **PASS** |
| License | **PASS** (MIT) |
| **Public release** | **READY FOR HUMAN REVIEW** |
