# Operating costs

What it costs to run KAURAX, what is free, and what is not measured.

**These are not on-chain figures.** Everything here is a hand-maintained estimate or a
quoted list price. Nothing in this repository reads it, and `/api/fees` deliberately does
not subtract it from fee receipts — see [PROTOCOL_FEES.md](PROTOCOL_FEES.md) §4.

**No cost figure here is a billing record.** Where a number is a provider's published
price rather than an invoice that was paid, it says so.

---

## 1. What genuinely needs persistent compute

Serverless functions cannot run these. They hold state, they must be reachable
continuously, and they must not be restarted between requests.

| Component | Why it cannot be serverless | If it stops |
|---|---|---|
| `l3-engine` (anvil) | Holds all L3 state in memory | The chain stops. State is lost unless restored from DA |
| `kaurax-l3` (node) | Sequences, batches, proposes; owns the write-ahead log | No new blocks. Unbatched blocks survive in the WAL |
| `postgres` | The index | Explorer and faucet fail; the chain is unaffected |
| `indexer` | Follows the head continuously | The index falls behind, then catches up |
| `api` | Stateless, but must be up | Frontends fail; the chain is unaffected |
| `nginx` | TLS termination, rate limiting | Nothing is reachable |

Ten containers in total ([`docker-compose.yml`](../docker-compose.yml)).

**The engine holding state in memory is the sharpest operational fact here.** `anvil` is
not a production client. A restart without a snapshot loses L3 state, and recovery means
replaying from data availability. This is the same engine choice that blocks fault proofs
([FAULT_PROOFS.md](FAULT_PROOFS.md) §1).

---

## 2. What the free tiers can and cannot do

Genuinely free, and used:

| Service | Used for | Honest limits |
|---|---|---|
| Vercel | Ten Next.js frontends | Hobby tier is for non-commercial use. Bandwidth is capped |
| GitHub | Source, issues | — |
| GitHub Actions | CI, scheduled checks | Minutes are capped. **Not a node host** |
| Cloudflare | DNS, caching, static | Free tier has no SLA |

**GitHub Actions must not be used as a sequencer or a node.** Runners are ephemeral and
time-limited, using them for persistent services violates the terms, and a chain whose
liveness depends on a CI schedule is not a chain. This is stated because it is a tempting
mistake, not because anyone attempted it.

**No free tier offers an SLA.** "Free hosting" and "guaranteed uptime" are incompatible,
and this project claims only the first.

---

## 3. The server

A single Linux VPS. Specification in [`infra/upcloud/README.md`](../infra/upcloud/README.md):
minimum 2 vCPU / 4 GB / 80 GB, comfortable 4 vCPU / 8 GB / 160 GB.

**Observed cost: roughly €20–40/month** for a host of this size. That figure is carried
over from [FUNDING_PLAN.md](FUNDING_PLAN.md) and is a market rate, not a reconciled
invoice.

**Disk is the cost that grows.** Three things grow without bound — L3 state, the
PostgreSQL index, and Prometheus retention — and none has a retention policy configured
today. 80 GB is a starting point. Budgeting a flat monthly figure indefinitely is wrong,
and the first thing that will break the estimate is disk.

### Costs not included above

| | |
|---|---|
| **L2 gas for batches and output roots** | Real, and paid in the L2's gas token. On a public L2 this scales with usage and can exceed the server cost. Not currently metered — see §5 |
| **L1 gas** | None directly. KAURAX settles to an L2; the L2 pays L1 |
| **Domain** | Annual, small |
| **Monitoring** | Self-hosted Prometheus and Grafana on the same box. No external bill, but it consumes the disk above |
| **Backups** | No off-host backup destination is configured. An off-host copy would cost money and does not exist today |
| **People** | The largest real cost by a wide margin, and the one no infrastructure tier reduces. [`docs/grants/BUDGET.md`](grants/BUDGET.md) sizes the engineering in months |

---

## 4. Running it at home

The specification is modest enough that an ordinary desktop meets it. The
[node operator guide](NODE_OPERATOR_GUIDE.md) covers the procedure; two constraints decide
whether it is viable:

1. **Inbound reachability.** Behind CGNAT or without a static address, inbound connections
   do not arrive. A tunnel or a relay with a public address is then required. **There is no
   configuration that makes inbound work without a network path to the machine** — a port
   forward, a tunnel, or a relay. Claiming otherwise would be false.
2. **Availability is the operator's.** A home machine that sleeps stops the chain. With one
   sequencer there is no failover: see [DECENTRALIZATION_ROADMAP.md](DECENTRALIZATION_ROADMAP.md).

---

## 5. What is not measured

Stated so the gaps are not mistaken for zeroes:

- **L2 gas spend is not metered.** The batcher and proposer send transactions and their
  cost is not aggregated anywhere. This is the largest unmeasured recurring cost and the
  most useful next thing to instrument.
- **No invoices are reconciled** against the estimates above.
- **Bandwidth is not tracked** against free-tier caps.
- **Disk growth rate is not recorded**, so the point at which 80 GB runs out is unknown.

A cost model that does not measure its largest variable item is an estimate, not an
account. This one is an estimate.
