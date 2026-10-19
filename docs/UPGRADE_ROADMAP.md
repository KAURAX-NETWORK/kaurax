# Upgrade roadmap

What this round of work changed, what it deliberately left alone, and what should come
next. Findings are in [UPGRADE_AUDIT.md](UPGRADE_AUDIT.md).

---

## 1. Where the requested topics already live

Much of the brief for this work asked for documents that already existed under other
names. Writing near-duplicates would have made 65 documents worse, not better, so this
table points at the existing ones instead.

| Topic | Already covered by |
|---|---|
| Current architecture | [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md), [architecture.md](architecture.md) |
| Grant proposal | [`grants/TECHNICAL_PROPOSAL.md`](grants/TECHNICAL_PROPOSAL.md), [`grants/GRANT_OVERVIEW.md`](grants/GRANT_OVERVIEW.md) |
| Itemised budget | [`grants/BUDGET.md`](grants/BUDGET.md) |
| Milestones with acceptance tests | [`grants/MILESTONES.md`](grants/MILESTONES.md) |
| Security model | [SECURITY_MODEL.md](SECURITY_MODEL.md), [THREAT_MODEL.md](THREAT_MODEL.md) |
| Disclosure policy | [`SECURITY.md`](../SECURITY.md) |
| Node operator guide | [NODE_OPERATOR_GUIDE.md](NODE_OPERATOR_GUIDE.md) |
| Decentralisation plan | [DECENTRALIZATION_ROADMAP.md](DECENTRALIZATION_ROADMAP.md) |
| Reproducibility | [REPRODUCIBILITY.md](REPRODUCIBILITY.md), [REPRODUCIBLE_BUILD.md](REPRODUCIBLE_BUILD.md) |
| Open findings | [SECURITY_REVIEW.md](SECURITY_REVIEW.md) |
| Roadmap | [ROADMAP.md](ROADMAP.md) |

New in this round: [UPGRADE_AUDIT.md](UPGRADE_AUDIT.md),
[PROTOCOL_FEES.md](PROTOCOL_FEES.md), [OPERATING_COSTS.md](OPERATING_COSTS.md),
[SUSTAINABILITY.md](SUSTAINABILITY.md), and this file.

---

## 2. Done

| | Evidence |
|---|---|
| Gas fees have a named destination instead of being burned to the zero address | `kaurax_feeStatus`; acceptance step 12 |
| The destination is verified, not assumed — the engine is read back | `fee-recipient.test.ts`, 6 tests |
| Burned and received are never conflated | `fee-accounting.test.ts`, 11 tests; `GET /api/fees` |
| Failure to route fees is visible | metric `kaurax_fee_recipient_applied`; `problem` string |
| Adoption can be measured excluding faucet grants, self-transfers and failures | `GET /api/adoption` |
| Fee routing demonstrated end to end on a devnet | `./tests/acceptance.sh` — 51 checks, 0 failed |

Both pre-existing suites stayed green throughout: **385 Solidity**, **203 node**. No test
was skipped, weakened or deleted.

---

## 3. Next, in dependency order

### 3.1 Meter L2 gas spend — *highest value, small*

The batcher and proposer pay real gas on the L2 and **nothing records how much**. It is
the largest unmeasured recurring cost ([OPERATING_COSTS.md](OPERATING_COSTS.md) §5), and
without it no net-cost statement is possible.

Shape: accumulate `gasUsed × effectiveGasPrice` per batch and per output-root transaction
in `Batcher` and `Proposer`, expose as counters, surface on `/api/fees`. No protocol
change, no new trust.

### 3.2 Decide the `l2DataFee` question — *design before code*

`blockchain/chain/config/testnet.json` specifies an L2 data fee with a scalar and an
overhead, and **nothing reads it** ([UPGRADE_AUDIT.md](UPGRADE_AUDIT.md) §3.3). Today the
operator absorbs the entire cost of posting batches.

Two defensible outcomes, and the current state is neither:

- **Implement it.** Charging users for data availability is what OP Stack chains do. It
  changes what every transaction costs and needs its own design, tests and a migration
  note.
- **Delete it from the config** and state in the documentation that KAURAX does not charge
  a data fee.

Leaving a specified-but-unread fee block in a config file whose sibling keys are live is
the worst of the three, because it reads as implemented.

### 3.3 Move the fee recipient behind a multisig — *before any value accrues*

The recipient is a single EOA. `KauraxMultisig` exists and is tested (27 tests) but is
deployed on the **L2** for settlement governance. Deploying one on KAURAX and pointing the
coinbase at it is straightforward; doing it *after* value accrues is not.

Then: a written disbursement policy, tests that enforce it, and an audit. In that order.
See [PROTOCOL_FEES.md](PROTOCOL_FEES.md) §7.

### 3.4 Retention policies for the three things that grow

L3 state, the PostgreSQL index and Prometheus all grow without bound and none has a
retention policy. The disk estimate in [OPERATING_COSTS.md](OPERATING_COSTS.md) has no
expiry date attached because nobody has measured the growth rate.

### 3.5 An off-host backup destination

`infra/scripts/ops/backup.sh` exists. No off-host destination is configured, so a host
failure currently loses the index.

---

## 4. Unchanged, and still the largest problems

Neither was in scope and neither moved:

- **No fault proof over KAURAX execution.** 18–30 engineer-months. The engine is `anvil`
  over JSON-RPC and cannot emit a trace. [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md).
- **One sequencer.** Forced inclusion bounds the damage; it does not remove the trust.
  [DECENTRALIZATION_ROADMAP.md](DECENTRALIZATION_ROADMAP.md).

Together they are 30 of the 100 points in [MAINNET_READINESS.md](../MAINNET_READINESS.md),
both at zero. **This round of work did not change the 52/100 score**, and fee accounting is
not a step toward mainnet readiness — it is bookkeeping that should be correct before it
matters, not instead of the work that does.
