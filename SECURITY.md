# Security Policy

## Reporting a vulnerability

**Email:** softnextgr@gmail.com — a monitored mailbox, not an alias that may or may not
forward. You can also open a GitHub **Security Advisory** (Security → Advisories → Report a
vulnerability) on this repository; advisories stay private until published, so use whichever
you prefer.

**Please do not open a public issue for a security bug.**

Include what you can:

- what the bug is, and what an attacker gains
- how to reproduce it — a failing test or a script is ideal
- affected contracts, files or endpoints
- how you would fix it, if you have a view

### What to expect

| | |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Fix or a written plan | 30 days for HIGH and CRITICAL |
| Public disclosure | After a fix ships, coordinated with you |

We will credit you unless you ask us not to.

**There is no bug bounty yet.** Saying otherwise would be worse than saying nothing. One is
planned for Milestone 1 of `docs/FUNDING.md`.

---

## Scope

**In scope:** the settlement contracts (`KauraxPortal`, `KauraxL2OutputOracle`,
`KauraxBatchInbox`, `KauraxL2ERC20Bridge`), the dispute game, governance, the L3 predeploys,
the node (sequencer, derivation, batcher, proposer), the signing service, the backend API and
indexer, and the CLI wallet.

**Out of scope:** anything already documented as a known limitation in
`MAINNET_READINESS.md`. Reporting that KAURAX has no fault proofs is not a finding — it is
on the front page. The same goes for the single sequencer and the guardian's role in
resolving disputes.

Also out of scope: denial of service against the public devnet endpoint, and the published
Anvil keys used by the local devnet, which are public by design.

---

## Known limitations — please read before reporting

KAURAX is a **testnet**. KAX has no monetary value.

1. **No fault proof system.** Output roots are accepted because the proposer key signed them.
   Nothing verifies they match any execution.
2. **The guardian resolves disputes.** A 2-of-3 multisig is the final arbiter.
3. **One sequencer.** It can reorder and delay. Forced inclusion bounds censorship: an
   ignored forced transaction halts settlement for everyone.
4. **No external audit.**

These are documented in `docs/SECURITY_REVIEW.md` with severities, and in
`MAINNET_READINESS.md` with a readiness score of 51/100.

---

## What we consider a real finding

- A way to move funds you are not entitled to
- A way to finalize a withdrawal against a disputed or deleted output root
- A way to make the dispute game pay out incorrectly, or strand a bond
- A way to bypass forced inclusion, or to acknowledge a transaction that was not included
- A way to reach an admin RPC namespace through the public endpoint
- Access control, reentrancy, or arithmetic bugs in any in-scope contract
- A way to make the node accept a batch or deposit it should reject

---

## Security practices

- No secrets in the repository. History was scanned before it was made public; see the
  report in `docs/GRANT_READINESS.md`.
- Operator keys can be held by a signing service so the node never sees them
  (`docs/key-management.md`).
- Every privileged role is held by a multisig or a timelock, not an EOA.
- CI runs Slither as a hard gate on high-severity findings.
- `infra/scripts/security-sweep.sh` scans for committed keys, mock data and fabricated
  metrics.
