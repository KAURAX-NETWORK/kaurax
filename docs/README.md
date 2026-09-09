# KAURAX Documentation

KAURAX is an **Ethereum Layer-3**: it executes transactions, publishes its data to an
underlying Layer-2, and inherits settlement from Ethereum through that L2. It is not a
Layer-1 and has no security of its own.

## Start here

| Document | What it answers |
|---|---|
| [architecture.md](./architecture.md) | How the whole system fits together |
| [STACK_DECISION.md](./STACK_DECISION.md) | Why OP Stack, what else was considered, what the limits are |
| [l3.md](./l3.md) | What makes KAURAX a Layer-3, and what it does and does not inherit |
| [developers.md](./developers.md) | Deploy your first contract |

## The layers

| Document | Layer |
|---|---|
| [ethereum.md](./ethereum.md) | Ethereum (L1) — the root of trust |
| [underlying-l2.md](./underlying-l2.md) | The configurable rollup KAURAX settles to |

## Components

| Document | Component |
|---|---|
| [sequencer.md](./sequencer.md) | Ordering, block production, censorship |
| [batcher.md](./batcher.md) | Publishing L3 data to the L2 |
| [settlement.md](./settlement.md) | Output roots and the settlement interface |
| [data-availability.md](./data-availability.md) | Where data lives and how to reconstruct the chain |
| [bridge.md](./bridge.md) | Deposits, withdrawals, proofs |
| [contracts.md](./contracts.md) | Every contract and its test coverage |

## Building

| Document | Topic |
|---|---|
| [developers.md](./developers.md) | Foundry, Hardhat, viem, ethers, RPC surface |
| [sdk.md](./sdk.md) | `@kaurax/sdk` |
| [wallet.md](./wallet.md) | Wallet integration and network parameters |
| [apps.md](./apps.md) | Names, Swap and Launchpad — the application contracts |
| [ai.md](./ai.md) | The optional AI application layer |

## Honest limits — read these

| Document | Topic |
|---|---|
| [threat-model.md](./threat-model.md) | Every threat, and which are unmitigated |
| [security.md](./security.md) | Key management and what production requires |
| [decentralization.md](./decentralization.md) | What is centralized today, and the order to fix it |
| [validators.md](./validators.md) | Why KAURAX has no validator set |
| [SECURITY_MODEL.md](./SECURITY_MODEL.md) | **Canonical.** What each property rests on, and what breaks if the assumption fails |
| [SECURITY_STATUS.md](./SECURITY_STATUS.md) | **Canonical.** Every finding, open and fixed |
| [FAULT_PROOFS.md](./FAULT_PROOFS.md) | **Canonical.** The execution model, trace commitments, one-step verifier, dispute protocol, attack model — and exactly what is not covered |
| [FAULT_PROOF_ROADMAP.md](./FAULT_PROOF_ROADMAP.md) | What is missing, and what building it takes |
| [FAULT_PROOF_SPEC.md](./FAULT_PROOF_SPEC.md) | The technical specification of a verifier over KAURAX execution |
| [FAULT_PROOF_AUDIT.md](./FAULT_PROOF_AUDIT.md) | The pre-implementation audit, verified against source |
| [FAULT_PROOF_IMPLEMENTATION_REPORT.md](./FAULT_PROOF_IMPLEMENTATION_REPORT.md) | What was built, what it proves, and what it does not |
| [../MAINNET_READINESS.md](../MAINNET_READINESS.md) | The full gate list — 52/100 |

## Verify it yourself

| Document | Topic |
|---|---|
| [TEST_STATUS.md](./TEST_STATUS.md) | **Canonical.** All 529 tests per suite, and what is *not* run |
| [REPRODUCIBLE_BUILD.md](./REPRODUCIBLE_BUILD.md) | Every command with its observed output |
| [architecture/OVERVIEW.md](./architecture/OVERVIEW.md) | The system with trust labels on each edge |
| [WHY_KAURAX.md](./WHY_KAURAX.md) | Ten questions, answered directly |

## Funding

| Document | Topic |
|---|---|
| [grants/GRANT_OVERVIEW.md](./grants/GRANT_OVERVIEW.md) | The request, in one page |
| [grants/](./grants/) | Proposal, milestones, budget, impact, FAQ, issue backlog |
| [GRANT_READINESS_AUDIT.md](./GRANT_READINESS_AUDIT.md) | Whether the above is accurate, and how it was checked |
| [FUNDING_PLAN.md](./FUNDING_PLAN.md) | Sources, allocation, and what is deliberately not requested |

## Operations

| Document | Topic |
|---|---|
| [TESTNET_OPERATIONS.md](./TESTNET_OPERATIONS.md) | Running the public testnet, including both outages and their guards |
| [NODE_OPERATOR_GUIDE.md](./NODE_OPERATOR_GUIDE.md) | Running a node |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | Deploying to KAURAX |
| [MONITORING.md](./MONITORING.md) | Metrics, alerts and thresholds |
| [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) | Clean machine to running chain |

## Assessment

| Document | Topic |
|---|---|
| [COMPLETE_SYSTEM_AUDIT.md](./COMPLETE_SYSTEM_AUDIT.md) | Every component, verified against source |
| [FINAL_READINESS_REPORT.md](./FINAL_READINESS_REPORT.md) | 18 categories scored with evidence |
| [KAURAX_COMPLETION_REPORT.md](./KAURAX_COMPLETION_REPORT.md) | What was done, what was found, what remains |
| [MAINNET_CHECKLIST.md](./MAINNET_CHECKLIST.md) | Hard gates, and the three blockers |
| [AUDIT_PACKAGE.md](./AUDIT_PACKAGE.md) | Scope and invariants for an external auditor |
| [SECURITY_CLOSURE_REPORT.md](./SECURITY_CLOSURE_REPORT.md) | Findings closed this round |
| [TESTING_REPORT.md](./TESTING_REPORT.md) | Coverage, and what is not tested |
| [ADVERSARIAL_TEST_REPORT.md](./ADVERSARIAL_TEST_REPORT.md) | The adversary matrix |
| [PERFORMANCE_REPORT.md](./PERFORMANCE_REPORT.md) | Measured throughput, latency and gas |
| [DECENTRALIZATION_ROADMAP.md](./DECENTRALIZATION_ROADMAP.md) | Five stages; KAURAX is at one |

## The short version

- **No fault proofs.** Output roots posted to the L2 are trusted, not verified. This is the
  largest risk in the system. A 2-of-3 multisig resolves disputes.
- **Centralized sequencer.** One operator, no failover. Forced inclusion *does* exist and is
  enforced by the output oracle — an ignored forced transaction halts settlement for
  everyone — but ordering is centralized.
- **No audits.** Nothing here has been reviewed by anyone outside the project.
- **KAX has no monetary value.** It is a testnet gas asset. No token sale, no tokenomics.
- **A public testnet is running** at [kaurax.network](https://kaurax.network). It is
  experimental. Do not hold value on it.

## A note on file names

Three documents are referenced in two spellings. `DATA_AVAILABILITY.md` and
`THREAT_MODEL.md` are one-line pointers to the canonical lowercase files, so there is
exactly one copy of each to keep correct.

There is deliberately **no** `DECENTRALIZATION.md`: it differs from `decentralization.md`
by case alone, and on a case-insensitive filesystem the two are the same file — an alias
would silently overwrite the real document. `decentralization.md` is the only spelling.
