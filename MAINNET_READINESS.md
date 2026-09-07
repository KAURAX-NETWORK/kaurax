# KAURAX — Mainnet Readiness

**Date:** 2026-09-08
**Verdict: KAURAX is not ready for mainnet, and the reason is one thing — there is no fault
proof system.** Everything else on this page is secondary to that.

Nothing is marked COMPLETE unless it was verified. Where the evidence is a test, the test is
named; where it is a live run, that is said.

---

## Three deployment classes

| | Devnet | Public testnet | Mainnet |
|---|---|---|---|
| L1/L2 | stand-ins on one host | real public L2 | real L2 |
| Token value | none | none | real |
| Sequencer | one operator | one operator | needs decentralisation or a proven escape hatch |
| Output roots | trusted | trusted, disputable | must be proven |
| Final arbiter | guardian | guardian | a verifier |
| Keys | local | signing service | HSM/KMS |
| Audit | none | none | mandatory |
| **KAURAX today** | **this** | close | far |

---

## Matrix

| Component | Status | Trustless? | Evidence | Mainnet blocker |
|---|---|---|---|---|
| Execution | IMPLEMENTED | n/a | anvil/revm, EVM-equivalent; live chain producing blocks | — |
| Consensus | NOT APPLICABLE | No | Single sequencer by design | Yes — needs decentralisation |
| Sequencer | IMPLEMENTED | No | Live; WAL survives SIGKILL (`test/wal.test.ts`, 15 tests) | Yes |
| Batcher | TESTED | Yes | Batches on the L2; transaction rebuilt from calldata alone (`tests/acceptance.ts`) | — |
| Proposer | IMPLEMENTED | **No** | Posts roots nothing verifies | **Yes** |
| Output roots | IMPLEMENTED | **No** | `proposeL2Output` checks the caller, not the state | **Yes** |
| Data availability | TESTED | Yes | Reconstruction verified end to end | — |
| Deposits | TESTED | Yes | Derived from L2 events; sequencer cannot censor | — |
| Forced inclusion | TESTED | Yes | Overdue forced tx halts settlement — verified on a live chain, not only in unit tests | — |
| Withdrawals | TESTED | Partly | Merkle proof required; no operator approval. Rests on unproven roots | Yes, via roots |
| Bridge | TESTED | Partly | 210+ contract tests | Audit |
| **Dispute game** | **TESTED** | **No** | 44 tests; guardian is the arbiter | Yes — see below |
| Bonds | TESTED | Yes | Conservation fuzzed; reentrancy tested with a real attacker contract | — |
| Bisection | TESTED | Yes | Converges to one block (`testFuzz_bisectionAlwaysConverges`) | Reaches a block, not an instruction |
| **One-step verifier** | **NOT STARTED** | — | Specified in `docs/FAULT_PROOF_SPEC.md` | **Yes — the blocker** |
| **Fault proofs** | **NOT STARTED** | — | Requires the verifier | **Yes** |
| Guardian | IMPLEMENTED | No | Multisig + timelock tested (27 tests) | Must hold the roles |
| Governance deployment | IMPLEMENTED | — | `DeployGovernance.s.sol`; **not deployed** | Yes |
| Upgrades | PARTIAL | No | Timelock exists, holds nothing | Yes |
| Key management | TESTED | — | Signing service; node never holds a key (19 tests). Devnet uses local keys | Yes |
| RPC | IMPLEMENTED | n/a | Live; admin namespaces blocked, verified externally | TLS |
| Explorer | IMPLEMENTED | n/a | Live; complete address history from the index | — |
| Faucet | TESTED | n/a | Real transactions; per-address and per-IP cooldowns | Testnet only by design |
| Monitoring | PARTIAL | n/a | Health endpoints, Prometheus metrics | Alerting |
| Disaster recovery | PARTIAL | n/a | Backups verify by restoring; **not rehearsed on the server** | Yes |
| Security review | PARTIAL | n/a | Internal only — `docs/SECURITY_REVIEW.md` | External audit |
| Audits | NOT STARTED | n/a | None | **Yes** |
| Documentation | IMPLEMENTED | n/a | 30+ documents, generated from the repo | — |

---

## Why the dispute game does not close the gap

It makes challenging permissionless, bonds both sides, and narrows a disagreement to one
block on chain. All real improvements.

It does not decide who is right. The guardian does. So a captured or mistaken guardian
still produces a wrong outcome, and no amount of bisection changes that. The gap closes when
`resolve()` is replaced by a verifier — see `docs/FAULT_PROOF_SPEC.md` §9, where that is
step 7 of 9 and step 9 is "only then describe KAURAX as fault proven".

---

## Ordered blockers

**Public testnet**

1. TLS on the RPC endpoint (blocked on the host's trial-account port restrictions)
2. Operator keys moved to the signing service
3. Dispute game deployed and holding the challenger role
4. Oracle refuses to finalize an output with a live dispute

**Mainnet**

1. One-step verifier — built, tested, audited
2. External audit of settlement, bridge and dispute contracts
3. Governance holding guardian, challenger and owner roles
4. Sequencer decentralisation
5. Disaster recovery rehearsed
6. Bond parameters sized against real value at risk

---

## What KAURAX may honestly say today

- "An experimental Layer-3 testnet."
- "Permissionless dispute games with bonds and bisection are implemented."
- "Data availability is verified: any transaction can be rebuilt from L2 calldata."
- "Censorship is bounded: an ignored forced transaction halts settlement."
- "Trustless one-step fault verification is on the roadmap."

## What it may not say

- "Fault proofs" — there is no verifier
- "Trustless" — the guardian decides disputes
- "Ethereum-level security" — it inherits none
- "Audited" — it has not been
- "Decentralised" — one sequencer, one guardian
