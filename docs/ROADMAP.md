# KAURAX — Roadmap

No date is given for fault proofs. Anyone who gives one has not built one.

Phases are ordered by dependency, not by calendar. Where a range appears it is
engineer-months of focused work, and elapsed time is longer.

---

## Phase 1 — Public testnet · **largely complete**

| | |
|---|---|
| Three-layer chain, real EVM at every layer | ✅ |
| Data availability verified by reconstruction | ✅ `tests/acceptance.ts` |
| Forced inclusion, verified on a live chain | ✅ |
| Proof-based withdrawals | ✅ |
| Dispute game: bonds, bisection, resolution | ✅ 41 + 11 tests |
| Proposer escrow at proposal time | ✅ |
| Finalization blocked during a dispute | ✅ |
| Governance holds every privileged role | ✅ 2-of-3, 1h timelock |
| Explorer, API, indexer, wallet, faucet, CLI | ✅ |
| TLS on the public RPC | ❌ blocked on host port restrictions |
| Operator keys on the signing service | ❌ built and tested, unused in production |
| Recovery rehearsal | ❌ |

**Remaining: three items, all operational.**

---

## Phase 2 — Security hardening · 3–5 engineer-months

1. TLS, and the RPC on standard ports
2. Operator keys moved to the signing service or an HSM
3. Alerting on the metrics that already exist
4. Disaster recovery rehearsed against a real failure, not a script
5. Sequencer rotation to a standby, tested by killing the primary
6. Fuzz and invariant tests across the bridge, not only the dispute game
7. Public bug bounty

Nothing here needs research. It is work.

---

## Phase 3 — Fault proof research and implementation · 18–30 engineer-months

**The phase that decides whether KAURAX can ever be a mainnet.**

| Step | Scale |
|---|---|
| Pin the state transition function; differential tests | 1–2 |
| Choose and adopt a proving VM (MIPS recommended) | 3–6 |
| Emit and commit to execution traces | 3–6 |
| Preimage oracle | 1 |
| One-step verifier, full instruction set | 6–12 |
| Trace bisection in the dispute game | 1–2 |
| Challenger agent | 2–3 |

Detail in [FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md).

**No completion date is offered.** OP Stack's Cannon took years and repeated audits. A
verifier with a bug is worse than no verifier — it lets an honest proposer lose — so this
phase ends when it is correct, not when a quarter does.

---

## Phase 4 — External audit · 3–6 months elapsed

Scope: settlement contracts, bridge, dispute game, and the verifier from Phase 3. Two
independent firms if funding allows, because auditors miss different things.

Remediation and re-review are part of the phase, not a footnote to it.

---

## Phase 5 — Sequencer decentralization · 6–12 engineer-months

Today one sequencer orders transactions. Forced inclusion bounds the damage — it cannot
censor you indefinitely without halting its own settlement — but it can reorder and delay.

Options, in increasing difficulty: a permissioned rotating set with on-chain leader
schedule; a shared sequencer shared with other rollups; a permissionless set with staking.

**Deliberately after fault proofs.** Decentralising who produces blocks while nobody can
prove a block wrong distributes the ability to lie rather than removing it.

---

## Phase 6 — Mainnet

Entry conditions, all required:

- [ ] Fault proofs implemented, tested, audited
- [ ] Two external audits with findings remediated
- [ ] Sequencer decentralised or a proven escape hatch beyond forced inclusion
- [ ] Bond parameters sized against real value at risk
- [ ] Disaster recovery rehearsed
- [ ] Bug bounty running for at least six months
- [ ] Governance distributed beyond the founding team

Only then do the words *trustless* and *fault-proven* become available.

---

## What KAURAX may say at each phase

| Phase | Honest description |
|---|---|
| 1–2 | "An experimental Ethereum L3 testnet with permissionless dispute games" |
| 3 | "…with a fault proof system under development" |
| 4 | "…undergoing external audit" |
| 5 | "…with a decentralised sequencer set" |
| 6 | "A fault-proven Ethereum L3" |

Using a later phase's language earlier is the failure mode this table exists to prevent.
