# KAURAX — System Architecture

Protocol-level architecture (how the L3 itself works) is in
[`docs/architecture.md`](docs/architecture.md). This document covers the **system**: which
processes exist, where they run, and how they talk to each other.

---

## 1. The whole picture

```
                          ┌──────────────────────────────┐
                          │           GITHUB             │
                          │  source · CI · CD            │
                          └───────┬──────────────┬───────┘
                     deploys apps │              │ deploys services
                                  ▼              ▼
       ┌────────────────────────────────┐   ┌─────────────────────────────────┐
       │            VERCEL              │   │            UPCLOUD              │
       │  10 stateless Next.js apps     │   │  one Ubuntu VPS, Docker Compose │
       │                                │   │                                 │
       │  web       explorer   wallet   │   │  nginx      ← only public       │
       │  bridge    pay        ai       │──►│  kaurax-l3  api                 │
       │  swap      names      launchpad│   │  indexer    postgres            │
       │  docs                          │   │  l3-engine  prometheus  grafana │
       └────────────────────────────────┘   └───────────────┬─────────────────┘
                                                            │
                                                            ▼
                                              underlying L2  →  Ethereum
```

**The division is stateful vs stateless.** A blockchain node cannot live on a platform that
restarts it between requests, so everything with state is on the VPS. The frontends hold
nothing and therefore deploy anywhere.

---

## 2. Repository layout

```
kaurax/
├── apps/                  10 Next.js applications (Vercel)
│   ├── web/               landing page
│   ├── explorer/          blocks, transactions, addresses, dashboard
│   ├── wallet/            connect, balance, send
│   ├── bridge/            L2 ↔ KAURAX transfers
│   ├── pay/               payment requests settled in KAX
│   ├── ai/                assistant, proxied through the API
│   ├── swap/ names/ launchpad/   interfaces awaiting contracts
│   └── docs/              renders docs/ from the repository
│
├── services/              backend processes (UpCloud)
│   ├── api/               Fastify — chain reads, payments, analytics, AI proxy
│   └── indexer/           chain → PostgreSQL, plus schema migrations
│
├── blockchain/
│   ├── l3/                kaurax-node: sequencer, derivation, batcher, proposer, RPC
│   ├── contracts/         Foundry — settlement, bridges, AI layer, examples
│   └── chain/             chain config and genesis allocation
│
├── packages/              shared libraries
│   ├── types/             domain types used by services and apps
│   ├── ui/                design system, components, wallet hook
│   ├── sdk/               @kaurax/sdk
│   ├── config/            typed configuration loader
│   └── cli/               the kaurax CLI
│
├── infra/
│   ├── docker/            per-service Dockerfiles
│   ├── nginx/             reverse proxy templates
│   ├── scripts/           bootstrap, deploy, TLS, devnet, security sweep
│   └── monitoring/        Prometheus rules, Grafana dashboard
│
├── docs/                  protocol and operations documentation
└── tests/                 end-to-end acceptance and API smoke tests
```

`blockchain/l3` is the node. The brief's `sequencer/`, `batcher/` and `proposer/`
directories exist as modules inside `blockchain/l3/src/` rather than as separate packages —
splitting a working, tested node into four packages would have been churn without benefit.

Built with **Turborepo** over **pnpm workspaces**: `pnpm build` respects the dependency
graph, so a package always sees its dependencies' emitted declarations.

---

## 3. Processes

| Process | Where | Port | Public | State |
|---|---|---|---|---|
| `nginx` | UpCloud | 80, 443 | **yes** | none |
| `kaurax-l3` | UpCloud | 8420, 8421, 7300 | via nginx | chain (volume) |
| `l3-engine` (anvil/op-geth) | UpCloud | 18420 | **never** | chain (volume) |
| `api` | UpCloud | 4000 | via nginx | none |
| `indexer` | UpCloud | 7301 | restricted | none (writes PostgreSQL) |
| `postgres` | UpCloud | 5432 | **never** | database (volume) |
| `prometheus` / `grafana` | UpCloud | 9090 / 3001 | loopback only | metrics (volume) |
| 10 Next.js apps | Vercel | — | yes | none |

The execution engine exposes administrative RPC (`anvil_*`, `evm_*`). It is never
published, and `kaurax-l3` blocks those namespaces on the endpoint users actually reach.
Two independent controls for the same risk.

---

## 4. Data flow

### A user transaction

```
wallet ──► rpc.kaurax.com ──► nginx ──► kaurax-l3
                                          │ mempool, ordering
                                          ▼
                                     l3-engine (EVM)
                                          │
                                     ┌────┴────┐
                                     ▼         ▼
                                 batcher   proposer
                                     │         │
                                     ▼         ▼
                              L2 batch    L2 output root
```

Separately, the indexer follows the chain and writes to PostgreSQL, which is what the
explorer and API read for history.

### A page load

```
browser ──► Vercel (SSR) ──► api.kaurax.com ──► PostgreSQL   (indexed history)
                                             └► kaurax-l3    (live state)
```

Frontends never talk to PostgreSQL and never hold a secret. Everything privileged is behind
the API.

---

## 5. Where truth lives

| Data | Source of truth | Cached? |
|---|---|---|
| Blocks, transactions, logs | The chain | Mirrored into PostgreSQL by the indexer |
| Balances, nonces, code | The chain | **Never** — read live per request |
| Settlement state | Contracts on the L2 | No |
| Payment *requests* | PostgreSQL | The only application data with no chain equivalent |
| Payment *settlement* | The chain | Verified before a payment is marked confirmed |
| Token metadata | The token contract | Read once, on first sight |

A cached balance is a wrong balance, so balances are never cached. The database is a queryable
mirror of chain history — losing it costs re-indexing time, not data.

---

## 6. Design decisions worth knowing

**The API degrades rather than lies.** Without `DATABASE_URL` it still serves live chain
reads; endpoints needing history return 503 saying exactly that, instead of an empty list
that would read as "this address has no transactions".

**`null` means unknown, never zero.** Enforced from the database (`NUMERIC(78,0)`, nullable)
through the types (`Quantity | null`) to the UI (`<Value>` renders *No data available*).

**Feature availability is decided by the chain.** `/api/features` calls `eth_getCode` on
each configured contract address. An app cannot present a feature as working when nothing
is deployed, even if someone sets an address in `.env`.

**Uint256 precision is preserved end to end.** PostgreSQL `NUMERIC(78,0)`, `pg` type parsers
returning strings, `bigint` in TypeScript, decimal strings over JSON. A wei value is never
routed through a JavaScript `number`.

**The indexer is atomic per block and reorg-aware.** A block and everything derived from it
are written in one transaction, and each block's parent hash is checked against what is
stored before writing.

**One transaction settles one payment.** Enforced by a unique index, not application code —
two concurrent settle requests would both pass a read-then-write check.

---

## 7. Scaling path

Nothing here needs rewriting to grow:

| Bottleneck | Change |
|---|---|
| API throughput | Run several `api` containers behind Nginx — it is stateless |
| Read load | Add `REDIS_URL`; PostgreSQL read replicas |
| Indexing speed | Raise `INDEXER_BATCH_SIZE`; the indexer already batches RPC calls |
| Node performance | Swap `l3-engine` for `op-geth` — it is behind `ExecutionEngineInterface` |
| One server | Split PostgreSQL and the node onto separate hosts; only URLs change |
| Data availability | Switch `DA_MODE` to blobs or external DA behind `DataAvailabilityInterface` |

The interfaces that make this possible — `ExecutionEngineInterface`, `SettlementInterface`,
`BatcherInterface`, `DataAvailabilityInterface` — exist for exactly this reason.

---

## 8. What this architecture does not solve

- **No fault proofs.** Output roots are trusted. This is a protocol gap, not an
  infrastructure one, and no amount of deployment work addresses it.
- **One sequencer, one server.** Both are single points of failure. Accepted for a
  zero-budget testnet, and stated rather than hidden.
- **Unbatched blocks are not durably persisted** beyond the engine's own state file.
- **No CDN or WAF in front of the RPC** — Nginx rate limiting is the only protection.

See [`docs/threat-model.md`](docs/threat-model.md) and
[`MAINNET_READINESS.md`](MAINNET_READINESS.md).
