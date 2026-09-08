# KAURAX — Final Readiness Report

**Date:** 2026-09-09 · Every score has evidence beside it. The low scores are the informative
ones, and none has been rounded up.

---

## 1. Scores

| # | Category | Score | Evidence |
|---|---|---|---|
| 1 | Protocol correctness | **72** | 322 Solidity tests, 47 acceptance checks, 404 differential cases. Settlement contracts 86–93% line coverage. Branch coverage 16–70% — revert paths largely unexercised |
| 2 | Execution | **45** | EVM-equivalent via `anvil`, but the state transition function is an external binary over JSON-RPC. Not instrumentable, not pinned, not differentially tested against a second implementation (I-1) |
| 3 | Settlement | **70** | Output roots, proposer bonds, finalization interlock, forced-inclusion gate — tested and verified live. **Nothing verifies a root corresponds to execution** |
| 4 | Data availability | **90** | Every block is L2 calldata; acceptance rebuilds a signed transaction from it alone. Inherits the L2's availability — the honest ceiling |
| 5 | Forced inclusion | **88** | 21 tests plus live verification: overdue → proposals rejected → acknowledged → resumed. Requires the user to reach the L2 |
| 6 | Withdrawals | **75** | Merkle proof against a published root **and** `isOutputFinalized`; 25 portal tests, 8 Merkle including fuzz, live round trip. Only as good as the root |
| 7 | Fault proofs | **25** | A real one-step verifier — 97% lines, 100% functions, 404 differential cases — for a **documented EVM subset**, deliberately unwired from settlement. **KAURAX has no fault proof over its own execution.** Not zero: the machinery is real. Nowhere near passing: it proves nothing about KAURAX |
| 8 | Security | **60** | 3 HIGH open (H-1/H-2/H-3), 4 MEDIUM/LOW, 14 fixed. 44 adversarial + 46 contract-level tests. **No external audit.** Three soundness- or availability-class bugs found and fixed this session |
| 9 | Decentralization | **15** | Stage 1 of 5. One sequencer, one proposer, 2-of-3 multisig, no failover. Points only because forced inclusion and permissionless challenging are real |
| 10 | Testnet | **82** | Live at ~49,500 blocks, ten containers, monitoring scraping, **10/10 chaos scenarios**. Runs the `devnet` profile with local L1/L2 stand-ins, so it inherits no external security |
| 11 | Developer experience | **74** | Three runnable examples verified against a live chain, CLI, SDK, faucet, explorer, quick-start verified end to end. Two blocking defects fixed. No hosted docs search, no source-verified explorer |
| 12 | Documentation | **85** | 60 documents matching the code at this commit. Test counts drifted three times; a CI gate is proposed but not yet built. Volume is itself a risk |
| 13 | Observability | **70** | 19 metrics, 11 alerts, all verified against a running node; deployed and scraping. No host metrics, no withdrawal or dispute metrics. **No alert has ever fired in production** |
| 14 | Reproducibility | **84** | Clean-machine path verified end to end; two blocking defects fixed; CI restarts the devnet; full build 21/21 |
| 15 | Performance | **62** | 204 tx/s with 8,000/8,000 succeeding; latency, DA cost and verifier gas measured. Harness-bound, not capacity. Devnet only, no soak |
| 16 | Governance | **70** | 2-of-3 with owner epochs, 1-hour timelock on inbox ownership, 27 tests, roles verified on chain. Short timelock; two compromised signers is total compromise |
| 17 | External audit readiness | **80** | Scope, invariants, known issues, attack scenarios, build instructions written. Code stable and tested. Not frozen |
| 18 | Grant readiness | **88** | Complete package, third-party-checkable milestones, effort in engineer-months, no fabricated metrics, limitations stated first |

**Unweighted mean: 67/100.**

Read that carefully. It averages an 88 in grant readiness with a 25 in fault proofs, and **the
25 is the one that determines what KAURAX may be used for.**

---

## 2. Weighted by what gates real-value use

| Category | Weight | Score |
|---|---|---|
| Fault proofs | 25% | 25 |
| Security | 20% | 60 |
| Protocol correctness | 15% | 72 |
| Settlement | 10% | 70 |
| Withdrawals | 10% | 75 |
| Decentralization | 10% | 15 |
| Data availability | 10% | 90 |

**Weighted: 52/100** — matching the independently maintained
[MAINNET_READINESS.md](../MAINNET_READINESS.md) score of 52/100. The two were derived
separately and agreeing is a check, not a coincidence to lean on.

---

## 3. Three verdicts, kept apart

| | Verdict | Basis |
|---|---|---|
| **PUBLIC TESTNET** | ✅ **Ready — and running** | Live, monitored, 10/10 chaos, three working examples, verified quick-start |
| **GRANT READY** | ✅ **Ready** | Honest package, checkable milestones, no invented metrics. **This says the documentation is good enough to evaluate — not that the system is safe** |
| **MAINNET** | ❌ **Not ready** | B1 no fault proof over KAURAX execution · B2 a multisig decides disputes · B3 no external audit |

---

## 4. What moved, and what did not

**Moved:** reproducibility (a quick-start that was not runnable, a devnet that started once),
observability (monitoring that had never scraped anything), performance (a load test that
could not finish its own setup), adversarial coverage (+58 tests), operations (three deploy
and lifecycle guards), and API availability (every health probe was unbounded).

**Did not move:** the security ceiling. Every part of B1 stands. The verifier still covers a
subset and is still not wired to settlement, deliberately.

That is the honest shape of this work: it removed operational failure modes and replaced
assumptions with measurements. **It did not make KAURAX safer to hold value on**, and the
score reflects that by barely moving.

---

## 5. The single most valuable next step

An execution engine that can emit a per-instruction trace.

Everything queues behind it — output roots that commit to a trace, a verifier that adjudicates
real disputes, removing the guardian, and every decentralization stage past research. It is
18–30 engineer-months ([FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md)), and no amount of
work elsewhere substitutes for it.
