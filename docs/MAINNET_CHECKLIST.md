# KAURAX — Mainnet Checklist

**Verdict: NOT READY.** Three blockers, one of which requires replacing the execution engine.

Filling in a checklist does not make a system ready. This document exists to make the
distance visible, not to close it.

## Definition of COMPLETE

A gate is complete only when **all seven** hold:

1. The implementation exists in this repository
2. Tests exist and pass
3. Adversarial tests exist where an adversary is possible
4. Documentation matches the code
5. A deployment procedure exists and has been run
6. A rollback or recovery path exists
7. Security assumptions are written down

Six of seven is not complete.

---

## Blockers — mainnet is impossible while any of these stands

| | Gate | State | What it needs |
|---|---|---|---|
| **B1** | Fault proof over KAURAX execution | ❌ | The engine is `anvil` over JSON-RPC and cannot emit a trace. A verifier exists for a documented EVM subset and is deliberately unwired from settlement |
| **B2** | Dispute resolution without a trusted party | ❌ | A 2-of-3 multisig decides. Follows from B1 |
| **B3** | External security audit | ❌ | None commissioned. Requires a budget and a code freeze |

**B1 is the whole thing.** B2 cannot close before it, and B3 should not begin until the code
that would be audited exists.

---

## Gates

### Protocol

| Gate | Impl | Tests | Adversarial | Docs | Deploy | Recovery | Assumptions | Complete |
|---|---|---|---|---|---|---|---|---|
| Data availability | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Deposits | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Forced inclusion | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Withdrawal proofs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Output roots | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ *unverified by construction — B1* |
| Dispute game (bonded, bisecting) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ *guardian-resolved — B2* |
| One-step verifier | ✅ | ✅ | ✅ | ✅ | ❌ | — | ✅ | ❌ *not deployed, not wired* |
| Bridge | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |
| Governance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** |

### Operations

| Gate | State | Note |
|---|---|---|
| Reproducible build | ✅ | [REPRODUCIBILITY.md](REPRODUCIBILITY.md) |
| Reproducible from a clean machine | ✅ | Two defects fixed; CI now restarts the devnet |
| Monitoring deployed and scraping | ✅ | Fixed and verified this round |
| Alerting on a metric that exists | ✅ | 11 alerts, all names checked against a running node |
| Backup and restore | ✅ | Rehearsed once |
| **Disaster recovery for host loss** | ❌ | Chain state is in Docker volumes; the L2 is a devnet anvil, so history cannot be re-derived |
| **Key management in production** | ❌ | Signer built and tested; **not deployed** (M-3) |
| **TLS on the public RPC** | ❌ | Host blocks 80/443 on this account (M-4) |
| **Sequencer failover** | ❌ | Does not exist |
| Deploy safety guards | ✅ | Refuses to unpublish a live port; refuses to redeploy over a live chain |
| Rollback | ⚠️ | `deploy.sh` records prior images; not rehearsed under failure |

### Testing

| Gate | State |
|---|---|
| Unit tests | ✅ 385 Solidity, 181 node |
| Adversarial tests | ✅ 44 integration, 46 contract-level |
| Property / fuzz | ✅ 10 KVS properties, 2 game fuzz at 256 runs, 5 Merkle |
| Differential | ✅ 404 cases, two independent implementations |
| End-to-end | ✅ 47 acceptance checks |
| Chaos | ✅ 10 scenarios |
| Load | ✅ 204 tx/s measured; harness-bound, not capacity |
| **Contract branch coverage** | ❌ 16–70% on several contracts |
| **Node unit coverage** | ⚠️ 12% statements — runtime paths are integration-tested only |
| **Long-run soak** | ❌ Never run |

### Documentation

All present and matching the code: security model, threat model, fault proofs, audit package,
operations, developer and operator guides, decentralization roadmap. ✅

---

## Not blockers, but not ready either

| | Why it matters |
|---|---|
| Bond sizing is unanalysed | A bond that does not deter griefing is theatre |
| Alert thresholds are reasoned, not calibrated | No alert has ever fired in production |
| An unproven leaf resolves to the proposer | A censored or absent challenger loses a dispute it should have won |
| One sequencer | No failover. Liveness depends on one host |
| The public testnet runs the `devnet` profile | `anvil` engine, local L1/L2 stand-ins. The `testnet` profile has never been operated |

---

## The order

1. An execution engine that can be instrumented — **everything waits on this**
2. Output roots that commit to a trace
3. Full opcode coverage, account model, preimage oracle
4. Autonomous challenger
5. External audit
6. Remove the guardian path
7. Sequencer failover, then decentralization research

Steps 1–3 are the 18–30 engineer-month estimate in
[FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md). **Nothing before step 6 permits the word
"trustless" about KAURAX output roots.**

---

## Self-assessed readiness

**Mainnet: 51/100** ([MAINNET_READINESS.md](../MAINNET_READINESS.md)). This round removed
operational failure modes and added measurement; it did not change the protocol's security
ceiling, and the score should not move much for that reason.
