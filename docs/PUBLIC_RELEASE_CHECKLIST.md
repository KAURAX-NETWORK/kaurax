# KAURAX — Public Release Checklist

> **SNAPSHOT.** A report of the round named above, kept unaltered so its conclusions can be
> traced to the numbers they were drawn from. For current status see
> [TEST_STATUS.md](TEST_STATUS.md), [SECURITY_STATUS.md](SECURITY_STATUS.md) and
> [../MAINNET_READINESS.md](../MAINNET_READINESS.md).

**Commit:** `6b1f81a` · **Date:** 2026-09-08

Ticked only where verified in this audit. Nothing is ticked on the strength of a previous
report.

## Secrets

- [x] No secrets in the current tree — scanned for 12 credential classes, 0 hits
- [x] No secrets in git history — **1069 blobs** scanned, 0 hits
- [x] No tracked `.env` files — only `.env.example`
- [x] `.env.example` contains placeholders only — private key values cleared
- [x] No `.pem`, `.key`, `.seed`, `.mnemonic`, keystore or wallet files tracked
- [x] No database dumps or backups tracked
- [x] No personal information — no developer paths, usernames or emails
- [x] `.gitignore` covers env files, keys, wallets, backups, dumps, SSH material
- [ ] **Production credentials rotated** — see Required human actions

## Infrastructure

- [x] No private RFC1918 addresses in application source
- [x] No hardcoded production server as a default — `KAURAX_UPSTREAM_ORIGIN` now defaults to localhost
- [x] No internal hostnames outside Docker network configuration
- [x] No development backdoors or test-only admin shortcuts
- [x] Admin RPC namespaces blocked on the public endpoint — verified externally

## Documentation

- [x] README complete and technically precise
- [x] Architecture documented, including the absence of validator consensus
- [x] Security policy present, with known limitations marked as not-vulnerabilities
- [x] Grant readiness present
- [x] Fault proof roadmap present, marked design-only
- [x] Known limitations disclosed — testnet only, no fault proofs, trusted roots, guardian arbiter, single sequencer, no audit
- [x] No marketing language claiming trustlessness, decentralisation or mainnet readiness
- [x] Readiness score consistent at 52/100 — five stale `47/100` references found and corrected

## Tests

- [x] Contract tests — 338 passed
- [x] Package tests — 126 passed
- [x] Live E2E — 12 passed
- [x] Typecheck — 25/25 tasks
- [x] Build — 19/19 tasks
- [x] `forge fmt --check` — clean, after this audit found and fixed a failure that would have broken CI

## CI

- [x] Test workflows require no secrets
- [x] Deployment workflows are `workflow_dispatch` only, so a fork PR cannot run them
- [x] Secret scanning present and a hard gate (gitleaks, full history)
- [x] Private-key detection verified by a planted-secret test — detected, then removed
- [ ] **Slither** — configured as a hard gate; could not be executed locally (Python 3.15 / cbor2 incompatibility). Will run in CI
- [x] Slither is a hard gate on high severity

## Licensing

- [x] `LICENSE` present — MIT
- [x] Consistent: `package.json`, 34 Solidity SPDX headers, README

## Endpoints

- [x] Testnet URL verified — https://kaurax.network
- [x] Explorer verified — /explorer, all routes resolve
- [x] RPC reviewed — admin namespaces refused; **no TLS**, documented
- [ ] TLS on the public RPC — blocked externally

---

## Required human actions before going public

1. **Rotate the xKiro API key.** It is not in the repository or its history, but it was
   pasted into a development conversation. Not a release blocker; do it anyway.
2. **Decide on the public RPC.** It currently serves plain HTTP on a non-standard port
   because the host blocks 80/443 on trial accounts. Either upgrade the account or state
   the limitation on the site.
3. ~~Confirm the security contact receives mail.~~ **Done** — `SECURITY.md` now lists
   `softnextgr@gmail.com`, a mailbox the maintainer controls, rather than an alias this
   audit could not verify. Note that a plain address in a public repository will be
   scraped; a forwarding alias is worth setting up later, once one can be verified.
4. **Review this checklist yourself.** It was produced by the same party that wrote the code.

---

## PUBLIC RELEASE STATUS: **READY FOR HUMAN REVIEW**

No critical issue was found. Not marked simply READY: items 1–4 above are judgement calls
that belong to a person, and an audit by the author of the code is the weakest kind there is.
