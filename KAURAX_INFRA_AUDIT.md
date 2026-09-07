# KAURAX — Infrastructure Audit

**Date:** 2026-09-07
**Scope:** the repository as it stands, before any infrastructure restructuring.
**Method:** live inspection of the running devnet, the source tree, the test suites and the
existing CI. Nothing below is inferred from documentation — every claim was checked.

---

## 1. Current architecture

### What the repository actually is today

A **single-package pnpm workspace** containing a working Ethereum Layer-3 and one frontend.
It is not yet a monorepo in the `apps/` + `services/` sense.

```
kaurax/
├── contracts/            Foundry — L2 settlement, L3 predeploys, bridges, AI layer
├── packages/
│   ├── config/           typed configuration loader
│   ├── node/             kaurax-node: sequencer, derivation, batcher, proposer, RPC
│   ├── sdk/              @kaurax/sdk
│   └── cli/              kaurax CLI
├── explorer/             Next.js 16 — explorer + bridge UI + dashboard (12 routes)
├── website/              static index.html
├── chain/                chain config + genesis allocation
├── scripts/              devnet / testnet / deployment shell scripts
├── infrastructure/       docker (3 Dockerfiles), monitoring (Prometheus + Grafana)
├── docs/                 23 documents
└── tests/                end-to-end acceptance test
```

| Property | Value |
|---|---|
| Package manager | **pnpm 10.28.0** (workspace via `pnpm-workspace.yaml`) |
| Workspace globs | `packages/*`, `explorer`, `tests` |
| Frontend framework | **Next.js 16.3.4**, App Router, React 19 |
| Contracts | **Foundry**, Solidity 0.8.28, `evm_version = cancun` |
| Node runtime | Node.js ≥ 20, TypeScript 5.7, ESM (`"type": "module"`) |
| Build orchestration | **none** — plain `pnpm -r` recursion, no Turborepo |
| Chain client | `anvil` (revm) as the L3 execution engine, driven by `kaurax-node` |

### Network configuration in place

| | Devnet | Testnet (configured, never run) |
|---|---|---|
| KAURAX chain ID | **8420** | **8421** |
| Native currency | **KAX**, 18 decimals | KAX |
| Underlying L2 | local anvil, chain 8415 | Base Sepolia, chain 84532 |
| L1 | local anvil, chain 8410 | Sepolia, 11155111 |

> **Discrepancy to resolve.** The infrastructure brief's example uses `chainId 123456` and
> symbol `KXR`. The project already uses **8420 / KAX**, and those chain IDs were verified
> free against the public registry (chainid.network, 2 750 chains). Per the brief's own
> instruction (*"ΜΗΝ χρησιμοποιήσεις το παράδειγμα chain ID αν υπάρχει ήδη άλλο"*), the
> existing values are kept. **The `KXR` symbol is not adopted** — changing it would break
> the genesis, the explorer, the SDK and every document. It is a one-line config change if
> you want it; say the word and I will do it properly across the tree.

---

## 2. What works

Verified live during this audit — the devnet was running throughout.

| Component | Evidence |
|---|---|
| **L3 chain** | Head at block 219 while auditing; 2s block time; real EVM state roots |
| **Sequencer** | Own mempool, nonce ordering, deposits ahead of user transactions |
| **Deposit derivation** | L2 `TransactionDeposited` → L3 transaction, exactly once |
| **Batcher** | **36 batches** landed on the L2 as real calldata |
| **Proposer** | **18 output roots** published to `KauraxL2OutputOracle` |
| **Bridge** | Deposit + Merkle-proven withdrawal + finalize, end to end |
| **Data availability** | A transaction was **recovered from L2 calldata alone** by the test |
| **JSON-RPC + WS** | Full `eth_*` surface, subscriptions, `kaurax_*` namespace |
| **RPC hardening** | `anvil_*`, `evm_*`, `debug_*`, `hardhat_*` blocked on the public port |
| **Explorer** | 12 routes, all 200, all reading live chain state |
| **SDK + CLI** | Verified against the live chain |
| **Contracts** | **76 forge tests** passing, `forge fmt` clean |
| **Node/SDK units** | **29 vitest tests** passing |
| **Acceptance** | **47 checks** passing from a clean slate |
| **Monitoring** | Prometheus metrics on :7300, Grafana dashboard provisioned |
| **CI** | 6 workflows, all valid YAML |

Running processes at audit time: `anvil` ×3 (L1 8545, L2 9545, L3 engine 18420),
`kaurax-node` (8420/8421/7300), `next start` (3000).

---

## 3. What doesn't work / doesn't exist

### Not present at all

| Missing | Impact |
|---|---|
| `apps/` directory | 9 of the 10 required frontends do not exist |
| `services/api` | No backend API. No `/api/health`. |
| `services/indexer` | No indexer. The explorer scans blocks over RPC on every request. |
| `services/relayer` | Withdrawal proving/finalizing is manual |
| `services/analytics` | — |
| **PostgreSQL** | **No database anywhere in the repository** |
| **Redis** | Not present |
| **Nginx** | No reverse proxy config; no TLS termination |
| **UpCloud provisioning** | No bootstrap, no deploy script, no firewall config |
| `turbo.json` | No build orchestration or caching |
| Wallet / Pay / AI / Swap / Names / Launchpad / Docs UIs | Do not exist |
| Deployment workflow | `deploy.yml` absent — CI builds but never deploys |

### Present but limited

| Component | Limitation |
|---|---|
| Explorer address & tx history | Scans a rolling window of recent blocks over RPC. **Not a historical index.** The UI states this. |
| Contract verification | None. No contract is marked verified, and the UI says so. |
| `docker-compose.yml` | Written and valid, but **never executed** — the Docker daemon was unavailable |
| Testnet profile | Configured and version-pinned, **never operated** |
| Website | Static HTML, not a Next.js app, not Vercel-structured |
| Bridge UI | Initiates and tracks; proving/finalizing on the L2 is left to the CLI/SDK |

---

## 4. Missing components (by brief section)

| § | Requirement | Status |
|---|---|---|
| 2 | Monorepo layout `apps/ services/ blockchain/ packages/ infra/` | **Missing** |
| 3 | `deploy.yml` for UpCloud | **Missing** (other 5 workflows exist) |
| 4 | 11 Vercel applications | **1 of 11** (explorer) |
| 5 | UpCloud server provisioning | **Missing** |
| 6 | Per-service Docker layout | **Partial** — 3 Dockerfiles, not the `docker/{l3,rpc,…}` layout |
| 7 | Public RPC endpoint config | **Partial** — RPC works, no TLS/proxy/domain |
| 16 | Backend API | **Missing** |
| 17 | Indexer | **Missing** |
| 18 | PostgreSQL | **Missing** |
| 19 | Nginx | **Missing** |
| 20 | UFW / Fail2ban / SSH hardening | **Missing** |
| 23 | Health endpoints | **Missing** |
| 24 | `infra/scripts/deploy.sh` | **Missing** |
| 25 | `infra/scripts/bootstrap.sh` | **Missing** |
| 26 | DNS plan | **Missing** |
| 28 | `DEPLOYMENT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md` | **Missing** (docs/ covers architecture and security at a protocol level, not an ops level) |

---

## 5. Security risks

| # | Risk | Severity | State |
|---|---|---|---|
| S1 | **No fault proof system.** Output roots are trusted; an incorrect one surviving the challenge window can drain `KauraxPortal`. | **Critical** | Known, documented, unresolved |
| S2 | **No TLS.** RPC and everything else is plain HTTP. | **High** | Nginx + certbot needed |
| S3 | **No rate limiting, no auth, no CORS policy** on the public RPC. Trivially DoS-able. | **High** | Must be fronted by a proxy |
| S4 | Keys are plain environment variables. No KMS, no hardware signing, no rotation. | **High** | Documented; unresolved |
| S5 | Every privileged role (guardian, challenger, proposer, deployer) is a **single EOA**. | **High** | Unresolved |
| S6 | `.env` **is present in the working tree**. Correctly gitignored and untracked (verified), but it holds the devnet keys. | Medium | Contained |
| S7 | Execution engine exposes `anvil_*`. Bound to loopback and blocked at the RPC facade, but a misconfigured deployment could expose port 18420. | Medium | Must never be published — enforced in compose |
| S8 | No firewall, no Fail2ban, no non-root deploy user — because no server exists yet. | **High** | To be built |
| S9 | No database, therefore no database credentials — but also no place for indexer data. | Medium | To be built |
| S10 | **Nothing has been audited.** | **Critical** | Stated everywhere |

**Positive findings:** no tracked `.env`; no private-key literals outside `.env.example`
(which deliberately holds the public Anvil keys); zero TODO/FIXME markers; zero mock or
fabricated data; admin RPC namespaces actively blocked and asserted at devnet startup.

---

## 6. Deployment risks

| # | Risk | Mitigation planned |
|---|---|---|
| D1 | `docker-compose.yml` has **never been run**. Docker daemon unavailable in this environment. | Rewrite for the target topology; validate with `docker compose config`; mark as unverified until a real host runs it |
| D2 | **Unbatched L3 blocks are not durably persisted.** A node loss before batching loses those transactions. | Named Docker volumes for chain data; documented as a remaining gap |
| D3 | Devnet state lives in `.devnet/` on the local filesystem. Not suitable for a server. | Docker volumes |
| D4 | No rollback procedure. | `deploy.sh` keeps the previous image tag and can revert |
| D5 | No health gating — CI has no way to know a deploy succeeded. | `/api/health` + `deploy.sh` failing on unhealthy services |
| D6 | Secrets would have to reach the server somehow. | GitHub Actions secrets → SSH → server-side `.env`, never in the image or repo |
| D7 | Single server = single point of failure. | Accepted for a €0-budget testnet; documented |
| D8 | Explorer queries the chain on **every request** with no cache. Will not survive public traffic. | Indexer + PostgreSQL |

---

## 7. Recommended changes

Ordered, non-destructive, each verifiable.

1. **Restructure to the target monorepo** by *moving* existing directories, not rewriting
   them: `explorer/ → apps/explorer/`, `website/ → apps/web/`, `contracts/ → blockchain/contracts/`,
   `infrastructure/ → infra/`. Keep `packages/*` where it is. Add Turborepo.
2. **Add PostgreSQL + the indexer** — this is the single highest-value addition. It unlocks
   real address history, token tracking and analytics, and takes the read load off the RPC.
3. **Add the backend API** (Fastify) with real health endpoints backed by real checks.
4. **Build the remaining apps** against real data where it exists, and label everything else
   explicitly `Coming Soon` / `Testnet` / `Not deployed` — never as working production.
5. **Nginx + TLS-ready config**, with the RPC rate-limited and CORS-scoped.
6. **UpCloud `bootstrap.sh` and `deploy.sh`**, idempotent, with checks before every
   destructive step.
7. **`deploy.yml`** driving SSH deployment, with secrets only from GitHub Actions.
8. **Ops documentation**: `DEPLOYMENT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`.

### Explicitly *not* recommended

- Changing the chain ID or the KAX symbol without instruction — it would break genesis, the
  explorer, the SDK and the docs for no functional gain.
- Rewriting `kaurax-node`, the contracts or the explorer. They work and are tested.
- Adding any paid service. The plan uses Vercel (free tier), GitHub (free), one UpCloud VPS,
  and self-hosted PostgreSQL/Redis/Nginx in Docker.

---

## 8. Constraint: what cannot be verified from here

Stated so that nothing in the deliverable is mistaken for tested:

- **No Docker daemon** in this environment (`colima` not running) — every container image
  and compose topology is written and statically validated, but **not executed**.
- **No UpCloud server, no domain, no DNS control, no TLS certificate, no API keys.** All of
  these become `.env.example` entries and documentation, never guesses.
- **Vercel deployment cannot be performed** — no authenticated project. The apps are built
  to deploy, and the configuration is provided.

Everything that *can* be run locally will be run and its result reported honestly.
