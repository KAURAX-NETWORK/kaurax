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
| L2 settlement cost metered per driver (batch / output / forced) | `kaurax_feeStatus.l2SettlementCost`; `l2-spend.test.ts`, 11 tests |
| The `l2DataFee` config no longer claims `enabled: true` for something nothing reads | `blockchain/chain/config/*.json` |
| Three critical dependency advisories cleared | `pnpm audit --audit-level critical` passes |
| Fees accrue to a 2-of-3 treasury, not an EOA | deployed at genesis; `Treasury.t.sol`, 20 tests |
| A disbursement policy exists, with tests behind each claim | [TREASURY_POLICY.md](TREASURY_POLICY.md) |

Both pre-existing suites stayed green throughout: **405 Solidity**, **214 node**. No test
was skipped, weakened or deleted.

---

## 3. Next, in dependency order

### 3.1 Persist the L2 cost ledger — *small*

Settlement cost is now measured (`kaurax_feeStatus.l2SettlementCost`) but held in memory,
so a restart resets it and there is still no historical total. Persisting it needs a store
and a per-hash dedupe key so a replay cannot double-count. Reverted sends are also not
counted and should be, under their own heading — a failed send burns real gas.

### 3.2 Decide whether to charge an L2 data fee — *design before code*

The `l2DataFee` block no longer claims to be enabled: both chain configs now read
`enabled: false`, `status: "not-implemented"`, and say in the file that the operator
absorbs the full cost of posting batches. That removes the false claim; it does not make
the decision.

Charging users for data availability is what OP Stack chains do, and with §3.1 in place
there is now a measured cost to base it on. It changes what every transaction costs, so it
needs its own design, tests and a migration note — not a config flip.

### 3.3 Make the treasury owner set real — *blocked on people, not code*

The treasury is deployed and tested, and the devnet points fees at it. What is missing is
not code:

1. **Three owners who are three different people**, holding keys on three different
   machines. `start.sh` defaults to Foundry's published devnet accounts, whose private keys
   are in Foundry's own documentation. That is the right default for a devnet and must be
   overridden through `KAURAX_TREASURY_OWNERS` anywhere else. No contract can verify this
   property.
2. **An audit of `KauraxMultisig`.** 300 lines, 47 tests across `Governance.t.sol` and
   `Treasury.t.sol`, read by nobody outside this project. The cheapest audit this project
   will ever commission.
3. **A decision on timelocking large disbursements.** `KauraxTimelock` already exists and
   guards settlement roles on the L2; the treasury does not use it, so a 2-of-3 can move
   funds immediately.

Until 1 and 2 are done, nothing of value should accrue — see
[TREASURY_POLICY.md](TREASURY_POLICY.md) §7.

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
