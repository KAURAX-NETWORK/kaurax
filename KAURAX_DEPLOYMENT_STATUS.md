# KAURAX — Deployment Status

**Date:** 2026-09-07
**Legend:** ✅ working (verified by running it) · ⚠️ needs configuration · ❌ not implemented

> **What "verified" means here.** ✅ is used only where the thing was actually executed and
> its output checked. Nothing is marked working on the strength of the code looking correct.
> Where something could not be run in this environment, it is ⚠️ with the reason stated.

---

## Verification summary

| Suite | Result | What it exercises |
|---|---|---|
| `forge test` | **210 passed** | Settlement, bridge, Merkle proofs, forced inclusion, governance, Names, Swap, Launchpad |
| `pnpm test` | **121 passed** | Write-ahead log recovery, derivation checkpoint, signing seam, keystore, indexer decoding, API validation |
| `tests/acceptance.sh` | **47 passed** | Deposit → sequence → batch → recover from L2 calldata → output root → proven withdrawal |
| `tests/forced-inclusion.sh` | **passed** | Censorship halts settlement on a live chain, and recovery resumes it |
| `tests/api-smoke.sh` | **35 passed** | API + indexer + PostgreSQL against live chain data |
| `tests/apps-smoke.sh` | **43 passed** | Names, Swap and Launchpad through the frontends' own ABIs |
| `pnpm build` | **25/25 tasks** | Every package, service and all 10 frontends |
| Security sweep | **0 real findings** | No TODOs, mock data, fabricated metrics or committed keys |

**Total: 456 automated checks passing.**

---

## Blockchain

| Component | Status | URL / Port | Env vars | Deploy | Depends on |
|---|---|---|---|---|---|
| KAURAX L3 chain | ✅ working | `:8420` HTTP, `:8421` WS | `KAURAX_CHAIN_ID` `KAURAX_BLOCK_TIME` `KAURAX_GAS_LIMIT` | Docker `kaurax-l3` | execution engine, L2 |
| Sequencer | ✅ working | in `kaurax-l3` | `SEQUENCER_PRIVATE_KEY` | Docker | execution engine |
| Deposit derivation | ✅ working | in `kaurax-l3` | `KAURAX_PORTAL_ADDRESS` | Docker | L2 RPC |
| Batcher | ✅ working | in `kaurax-l3` | `BATCH_SUBMISSION_INTERVAL` `BATCHER_PRIVATE_KEY` | Docker | L2, batch inbox |
| Proposer | ✅ working | in `kaurax-l3` | `OUTPUT_PROPOSAL_INTERVAL` `PROPOSER_PRIVATE_KEY` | Docker | L2, output oracle |
| Execution engine | ✅ working | `:18420` **internal only** | `KAURAX_ENGINE_RPC_URL` | Docker `l3-engine` | — |
| Settlement contracts | ✅ working | on the L2 | `KAURAX_*_ADDRESS` | `forge script` / bootstrap | L2 RPC, deployer key |
| Bridge (deposit + proven withdrawal) | ✅ working | via portal on the L2 | `WITHDRAWAL_CHALLENGE_WINDOW` | with contracts | output oracle |
| AI layer contracts | ✅ working | on KAURAX | — | `DeployAILayer.s.sol` | KAURAX RPC |
| KauraxNames | ✅ working | on KAURAX | `KAURAX_NAMES_ADDRESS` | `DeployApps.s.sol` | KAURAX RPC |
| KauraxSwap (AMM) | ✅ working | on KAURAX | `KAURAX_SWAP_*`, `KAURAX_WKAX_ADDRESS` | `DeployApps.s.sol` | KAURAX RPC |
| KauraxLaunchpad | ✅ working | on KAURAX | `KAURAX_LAUNCHPAD_ADDRESS` | `DeployApps.s.sol` | KAURAX RPC |
| **Fault proofs** | ❌ **not implemented** | — | — | — | — |
| **Decentralized sequencing** | ❌ not implemented | — | — | — | — |
| **Forced exit** | ❌ not implemented | — | — | — | — |
| Public testnet on a real L2 | ⚠️ configured, never operated | — | `L2_RPC_URL` `L2_CHAIN_ID` | `infra/scripts/testnet/deploy.sh` | funded keys, real L2 |

*Verified live:* 36 batches on the L2, 18 output roots published, a withdrawal proven by
Merkle inclusion and finalized, and a transaction rebuilt from L2 calldata alone.

---

## Backend services

| Component | Status | URL / Port | Env vars | Deploy | Depends on |
|---|---|---|---|---|---|
| API (Fastify) | ✅ working | `:4000` → `api.<domain>` | `API_PORT` `API_CORS_ORIGINS` `API_RATE_LIMIT_*` `DATABASE_URL` | Docker `api` | PostgreSQL, RPC |
| Health endpoints | ✅ working | `/api/health` `/rpc` `/database` `/indexer` `/live` | — | with API | all dependencies |
| Indexer | ✅ working | `:7301` internal | `INDEXER_*` `DATABASE_URL` | Docker `indexer` | PostgreSQL, RPC |
| PostgreSQL | ✅ working | `:5432` **internal only** | `POSTGRES_*` | Docker `postgres` | — |
| Payments | ✅ working | `/api/payments` | `DATABASE_URL` | with API | PostgreSQL, RPC |
| Analytics | ✅ working | `/api/analytics` | `DATABASE_URL` | with API | PostgreSQL |
| Feature registry | ✅ working | `/api/features` | contract addresses | with API | RPC |
| AI proxy (xKiro) | ⚠️ needs `XKIRO_API_KEY` | `/api/ai/chat` | `XKIRO_API_KEY` `XKIRO_MODEL` | with API | xkiro.com |
| Relayer | ❌ not implemented | — | — | — | — |
| Redis cache | ⚠️ optional, unused | — | `REDIS_URL` | Docker | — |

*Verified live:* indexer caught up with **0 blocks of lag**; `/api/health` returned **200**
with `rpc`, `database` and `indexer` all healthy; a payment was created, settled against a
real transaction, and correctly rejected for a fake hash, an underpayment and a reused
transaction.

---

## Frontends (Vercel)

| App | Status | Local | Domain | Deploy | Data source |
|---|---|---|---|---|---|
| Landing | ✅ working | `:3010` | `kaurax.com` | Vercel `apps/web` | API |
| Explorer | ✅ working | `:3000` | `explorer.` | Vercel `apps/explorer` | RPC + API |
| Wallet | ✅ working | `:3011` | `wallet.` | Vercel `apps/wallet` | wallet + API |
| Bridge | ✅ working | `:3012` | `bridge.` | Vercel `apps/bridge` | wallet + API |
| Pay | ✅ working | `:3013` | `pay.` | Vercel `apps/pay` | API |
| AI | ⚠️ needs `XKIRO_API_KEY` | `:3014` | `ai.` | Vercel `apps/ai` | API |
| Docs | ✅ working | `:3018` | `docs.` | Vercel `apps/docs` | repository `docs/` |
| Swap | ✅ working | `:3015` | `swap.` | Vercel `apps/swap` | AMM contracts + API — swap, liquidity, pools |
| Names | ✅ working | `:3016` | `names.` | Vercel `apps/names` | registry + API |
| Launchpad | ✅ working | `:3017` | `launchpad.` | Vercel `apps/launchpad` | launchpad + API — participate and create |

All ten return **HTTP 200** and were confirmed to render live chain values.

Swap, Names and Launchpad now run against **real contracts deployed on KAURAX**. Feature
state is still read from `/api/features`, which calls `eth_getCode` on the configured
address — so if the contracts are absent on a given network, each app renders as
*not deployed* rather than showing an interface with nothing behind it. The chain decides,
not a flag.

Shared env for every app — none of it secret:
`NEXT_PUBLIC_KAURAX_RPC_URL` `_WS_URL` `_CHAIN_ID` `_API_URL` `_EXPLORER_URL` `_DOMAIN`

---

## Infrastructure

| Component | Status | Notes |
|---|---|---|
| Monorepo (Turborepo + pnpm) | ✅ working | 18 build targets, dependency-ordered |
| Dockerfiles (l3, api, indexer, bootstrap) | ⚠️ written, **not built** | No Docker daemon in this environment |
| `docker-compose.yml` | ⚠️ valid YAML, **never run** | 10 services; only Nginx publishes ports |
| Nginx reverse proxy | ⚠️ written, **not run** | Rate limiting, envsubst templates, TLS-ready |
| `infra/scripts/bootstrap.sh` | ⚠️ syntax-checked, **not run** | Docker, UFW, Fail2ban, SSH hardening |
| `infra/scripts/deploy.sh` | ⚠️ syntax-checked, **not run** | Health-gated, prints failing logs, rollback documented |
| `infra/scripts/enable-tls.sh` | ⚠️ syntax-checked, **not run** | Checks DNS before calling certbot |
| Devnet scripts | ✅ working | Full stack from a clean slate, repeatedly |
| Prometheus + alerts | ✅ config valid | 4 alert groups; metrics served by node and indexer |
| Grafana dashboard | ✅ config valid | 15 panels, loopback-only binding |
| UpCloud server | ❌ **does not exist** | No server, no domain, no DNS provided |

---

## CI/CD

| Workflow | Status | Trigger |
|---|---|---|
| `ci.yml` | ✅ valid | typecheck, unit tests, contracts, devnet + acceptance + API smoke |
| `frontend.yml` | ✅ valid | 10 app builds, secret-leak checks, bundle scan |
| `contracts.yml` | ✅ valid | build, fmt, test, extended Merkle fuzzing |
| `security.yml` | ✅ valid | gitleaks, tracked-`.env`, dependency audit, Slither |
| `docker.yml` | ✅ valid | image builds, compose validation |
| `deploy.yml` | ⚠️ needs secrets | SSH deploy; fails with a clear message if unconfigured |
| `release.yml` | ✅ valid | verify, publish SDK and CLI |

All seven parse as valid YAML. None has run on GitHub — there is no remote yet.

---

## Security posture

| Control | Status |
|---|---|
| Admin RPC namespaces blocked publicly | ✅ verified — asserted at devnet startup |
| No secrets in frontend bundles | ✅ verified — scanned all 10 built bundles |
| No `.env` tracked in git | ✅ verified |
| No private keys outside `.env.example` | ✅ verified |
| CORS wildcard rejected at startup | ✅ verified by unit test |
| Pagination clamped | ✅ verified by unit test and live |
| Payment settlement verified on chain | ✅ verified — fake, underpaying and reused transactions all rejected |
| SQL parameterised throughout | ✅ verified by inspection |
| Only Nginx publishes ports | ✅ verified in the compose file |
| PostgreSQL / engine / Grafana not exposed | ✅ verified in the compose file |
| TLS | ⚠️ script written, no domain to run it against |
| UFW / Fail2ban / SSH hardening | ⚠️ script written, no server to run it on |
| KMS or hardware signing | ❌ not implemented |
| Multisig for privileged roles | ❌ not implemented |
| **Security audit** | ❌ **none** |

---

## What you must supply

None of these can be guessed, and none is invented anywhere in the repository:

| Needed | For | Where it goes |
|---|---|---|
| UpCloud server | Everything stateful | — |
| Domain + DNS control | Subdomains, TLS | `KAURAX_DOMAIN` |
| `XKIRO_API_KEY` | KAURAX AI | server `.env` |
| Real operator keys | Sequencer, batcher, proposer, deployer | server `.env`, ideally a KMS |
| Funded L2 keys | Batcher and proposer transactions | on the L2 |
| Guardian / challenger multisigs | Bridge safety | `.env` |
| Vercel account | 10 frontend projects | — |
| GitHub repo + secrets | CI/CD | Actions secrets |
| `POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` | Database, dashboards | server `.env` |

---

## Honest bottom line

**Works, verified by running it:** the L3 chain and its full settlement path; the bridge
including a proof-verified withdrawal; data availability, proven by rebuilding a transaction
from L2 calldata; the indexer, API and database; payments with on-chain verification; the
Names registry; the AMM — a swap whose realised output matched its quote exactly, plus
liquidity added and removed with the pool price unchanged; the launchpad — a full sale
lifecycle through to claim and withdrawal, and a second sale created, escrowed and
cancelled with the allocation returned exactly; and all ten frontends.

**Written and reviewed, never executed:** everything that needs a server, a domain or a
Docker daemon — the images, the compose stack, Nginx, the bootstrap and deploy scripts, TLS.
Their preflight checks are real, but the path itself is unproven.

**Not implemented, and not claimed:** fault proofs, decentralized sequencing, forced exit,
and account abstraction.

**Not audited. KAX has no monetary value. Nothing here is production.**

For the protocol-level gate list, see [`MAINNET_READINESS.md`](MAINNET_READINESS.md).
