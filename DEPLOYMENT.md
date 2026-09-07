# KAURAX — Deployment

How to take this repository from a clone to a running network: GitHub for source and CI,
Vercel for the frontends, one UpCloud VPS for everything that must persist.

> **Nothing in this repository has been deployed to a public server.** These are written and
> reviewed procedures, and every script's preflight checks are real, but the end-to-end
> path has only been exercised locally. Treat unfamiliar steps as unproven.

---

## 0. What runs where, and why

```
                    ┌─────────────────────────┐
   users ──────────►│         VERCEL          │   10 Next.js apps
                    │  web explorer wallet    │   stateless, free tier
                    │  bridge pay ai swap     │   redeploy on git push
                    │  names launchpad docs   │
                    └────────────┬────────────┘
                                 │  HTTPS
                                 ▼
                    ┌─────────────────────────┐
                    │        UPCLOUD          │   one Ubuntu VPS
                    │  nginx  (only public)   │
                    │  kaurax-l3  api         │   Docker Compose
                    │  indexer  postgres      │
                    │  prometheus  grafana    │
                    └────────────┬────────────┘
                                 │
                                 ▼
                         underlying L2 → Ethereum
```

A blockchain node cannot run on Vercel: it is stateful, long-lived, and must not restart
between requests. Everything stateful is therefore on the VPS, and Vercel serves only the
frontends, which hold nothing.

**Cost:** Vercel free tier, GitHub free tier, one UpCloud VPS. PostgreSQL, Redis, Nginx,
Prometheus and Grafana are self-hosted in Docker on that VPS. No managed service is
required, and this repository adds none.

---

## 1. GitHub setup

```bash
git init
git add .
git commit -m "KAURAX"
git remote add origin git@github.com:<you>/kaurax.git
git push -u origin main
```

### Repository secrets (Settings → Secrets and variables → Actions)

Required only for the `deploy` workflow:

| Secret | Purpose |
|---|---|
| `UPCLOUD_HOST` | Server IP or hostname |
| `UPCLOUD_USER` | Deploy user, e.g. `kaurax` |
| `UPCLOUD_SSH_KEY` | Private key for that user |
| `UPCLOUD_SSH_PORT` | Optional, defaults to 22 |

### Repository *variables* (not secrets — these reach browsers)

| Variable | Example |
|---|---|
| `NEXT_PUBLIC_KAURAX_RPC_URL` | `https://rpc.kaurax.com` |
| `NEXT_PUBLIC_KAURAX_WS_URL` | `wss://rpc.kaurax.com/ws` |
| `NEXT_PUBLIC_KAURAX_CHAIN_ID` | `8421` |
| `NEXT_PUBLIC_KAURAX_API_URL` | `https://api.kaurax.com` |
| `NEXT_PUBLIC_KAURAX_EXPLORER_URL` | `https://explorer.kaurax.com` |
| `NEXT_PUBLIC_KAURAX_DOMAIN` | `kaurax.com` |

**Never** put `XKIRO_API_KEY`, `DATABASE_URL`, `POSTGRES_PASSWORD` or any `*_PRIVATE_KEY`
in a repository *variable* or a `NEXT_PUBLIC_` name. Everything `NEXT_PUBLIC_` is compiled
into a public JavaScript bundle. CI enforces this — see `.github/workflows/frontend.yml`.

### Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push, PR | typecheck, unit tests, contracts, full devnet + acceptance + API smoke |
| `frontend.yml` | app changes | builds all 10 apps, scans bundles for leaked secrets |
| `contracts.yml` | contract changes | `forge build`, `fmt --check`, `test`, extended Merkle fuzzing |
| `security.yml` | push, weekly | gitleaks, tracked-`.env` check, dependency audit, Slither |
| `docker.yml` | infra changes | builds every image, validates the compose file |
| `deploy.yml` | manual / main | SSH deployment to UpCloud, gated on tests passing |
| `release.yml` | version tag | verifies, publishes the SDK and CLI |

---

## 2. Vercel setup

Ten apps, ten Vercel projects. They deploy and roll back independently, which is the point
of separating them.

For **each** app:

1. **New Project** → import the repository.
2. **Root Directory** → `apps/<name>` (e.g. `apps/explorer`).
3. Framework preset: **Next.js**. Leave the build settings alone — `apps/<name>/vercel.json`
   already sets an install and build command that runs from the repository root so
   workspace packages resolve.
4. Environment variables: the six `NEXT_PUBLIC_*` values above.
5. Domain: assign the subdomain from the table in §7.

| App | Directory | Domain |
|---|---|---|
| Landing | `apps/web` | `kaurax.com`, `www.kaurax.com` |
| Explorer | `apps/explorer` | `explorer.kaurax.com` |
| Wallet | `apps/wallet` | `wallet.kaurax.com` |
| Bridge | `apps/bridge` | `bridge.kaurax.com` |
| Pay | `apps/pay` | `pay.kaurax.com` |
| AI | `apps/ai` | `ai.kaurax.com` |
| Swap | `apps/swap` | `swap.kaurax.com` |
| Names | `apps/names` | `names.kaurax.com` |
| Launchpad | `apps/launchpad` | `launchpad.kaurax.com` |
| Docs | `apps/docs` | `docs.kaurax.com` |

> `apps/docs` reads Markdown from the repository at request time, so it must be deployed
> with the whole repository available — which the root-directory setting above already does.

---

## 3. UpCloud setup

### 3.1 Create the server

- **Ubuntu 24.04 LTS**
- Minimum **2 vCPU / 4 GB RAM / 80 GB** disk. The chain state, PostgreSQL and Prometheus
  all grow; 80 GB is a starting point, not a ceiling.
- Add your SSH public key during creation.

### 3.2 Bootstrap it

```bash
ssh root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/<you>/kaurax/main/infra/scripts/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # read it before running it as root
bash bootstrap.sh
```

Installs Docker + Compose, Git, Node 20, UFW and Fail2ban; creates the `kaurax` deploy user;
hardens SSH. It is idempotent, and it **refuses to disable password SSH unless a key is
already installed** for the deploy user, so it cannot lock you out.

Ports opened: **22, 80, 443**. Nothing else. PostgreSQL, the L3 execution engine, the
indexer and Grafana are reachable only on the internal Docker network.

---

## 4. SSH

```bash
ssh kaurax@<server-ip>
```

After bootstrap: root login disabled, password authentication disabled, Fail2ban watching
`sshd`.

**Grafana** is bound to `127.0.0.1:3001` on the server and is not exposed. Reach it with a
tunnel:

```bash
ssh -L 3001:127.0.0.1:3001 kaurax@<server-ip>
# then open http://localhost:3001
```

---

## 5. Docker

```bash
git clone https://github.com/<you>/kaurax.git ~/kaurax
cd ~/kaurax
cp .env.example .env
$EDITOR .env            # §6
bash infra/scripts/deploy.sh
```

`deploy.sh` pulls, builds, recreates containers, **waits for every critical service to
become healthy**, then verifies the RPC, API and Nginx endpoints. It fails loudly rather
than leaving a half-deployed stack, and prints the failing container's logs when it does.

Day to day:

```bash
docker compose ps                    # what is running
docker compose logs -f api           # follow one service
docker compose restart kaurax-l3     # restart one
docker compose down                  # stop everything (volumes survive)
```

---

## 6. Environment variables

`cp .env.example .env`, then set at minimum:

| Variable | Notes |
|---|---|
| `KAURAX_PROFILE` | `testnet` for a public deployment |
| `KAURAX_DOMAIN` | `kaurax.com` — Nginx builds its server names from this |
| `TLS_EMAIL` | Let's Encrypt expiry notices |
| `L1_RPC_URL`, `L1_CHAIN_ID` | Ethereum testnet endpoint |
| `L2_RPC_URL`, `L2_CHAIN_ID`, `L2_NAME` | The rollup KAURAX settles to |
| `POSTGRES_PASSWORD` | **Generate one.** `openssl rand -base64 32` |
| `GRAFANA_ADMIN_PASSWORD` | **Generate one.** |
| `SEQUENCER_/BATCHER_/PROPOSER_/DEPLOYER_PRIVATE_KEY` | **Generate real keys.** Never the Anvil devnet keys — `infra/scripts/testnet/deploy.sh` refuses them by derived address |
| `GUARDIAN_ADDRESS`, `CHALLENGER_ADDRESS` | **Multisigs**, not EOAs |
| `XKIRO_API_KEY` | From https://xkiro.com. Server-side only |
| `API_CORS_ORIGINS` | Your Vercel domains. `*` is rejected at startup |

`deploy.sh` refuses to run while `CHANGE_ME` placeholders remain.

`.env` lives **only on the server**. It is gitignored, never built into an image, and never
transmitted by CI — `deploy.yml` triggers a rebuild on the server, which reads the `.env`
already there.

---

## 7. DNS

Nothing here changes DNS for you. Set these records at your registrar:

| Record | Type | Target |
|---|---|---|
| `@` | A / ALIAS | Vercel |
| `www` | CNAME | Vercel |
| `explorer` `wallet` `bridge` `pay` `ai` `swap` `names` `launchpad` `docs` | CNAME | Vercel (`cname.vercel-dns.com`) |
| `rpc` | **A** | **UpCloud server IP** |
| `api` | **A** | **UpCloud server IP** |
| `indexer` | **A** | **UpCloud server IP** |

The three A records must point at the server *before* requesting certificates — the HTTP-01
challenge depends on it, and failed attempts consume Let's Encrypt rate limit.

Then:

```bash
bash infra/scripts/enable-tls.sh
```

It checks DNS actually resolves here, obtains certificates for all three hosts, writes the
HTTPS server blocks and reloads Nginx. The `certbot` container renews every 12 hours.

---

## 8. RPC

```
https://rpc.kaurax.com          JSON-RPC
wss://rpc.kaurax.com/ws         subscriptions
```

Nginx rate-limits it to 20 r/s per IP with a burst of 40, and caps concurrent connections.
The node itself blocks `anvil_*`, `evm_*`, `debug_*`, `hardhat_*`, `admin_*`, `miner_*`,
`personal_*`, `txpool_*` and `engine_*` on the public endpoint.

Verify:

```bash
curl -s -X POST https://rpc.kaurax.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

---

## 9. Database

PostgreSQL 16 in Docker, on the internal network only, with data in a named volume
(`postgres-data`) that survives `docker compose down`.

Migrations are applied by the indexer at start, in order, once each — there is no separate
migration step to forget.

```bash
# psql, from the server
docker compose exec postgres psql -U kaurax -d kaurax

# backup
docker compose exec -T postgres pg_dump -U kaurax kaurax | gzip > kaurax-$(date +%F).sql.gz

# restore
gunzip -c kaurax-2026-01-01.sql.gz | docker compose exec -T postgres psql -U kaurax -d kaurax
```

**Take backups off the server.** A snapshot sitting on the machine it protects is not a
backup. Note also that the indexer can rebuild everything from the chain — the database is
a cache of chain history, not the source of truth. What it *does* hold uniquely is
`payments`.

---

## 10. Deployment

Routine:

```bash
git push origin main      # CI runs; deploy.yml deploys on success
```

Manual, on the server:

```bash
cd ~/kaurax && bash infra/scripts/deploy.sh
```

One service only:

```bash
bash infra/scripts/deploy.sh --service api
```

---

## 11. Rollback

```bash
cd ~/kaurax
git log --oneline -10
git checkout <previous-sha>
bash infra/scripts/deploy.sh --no-pull
```

Volumes are untouched, so chain state and the database survive.

**Rolling back a database migration is not automatic.** Migrations are additive by design;
if one must be reversed, write a new migration that reverses it rather than restoring an
older schema under newer code.

Vercel rolls back independently: Deployments → the previous one → **Promote to Production**.

---

## 12. Monitoring

| Endpoint | What it tells you |
|---|---|
| `https://api.kaurax.com/api/health` | 200 only when RPC, database and indexer all answer |
| `/api/health/rpc` `/database` `/indexer` | Individual dependencies |
| Grafana (SSH tunnel, `:3001`) | Block heights, sequencer, batcher, indexer lag |
| Prometheus (internal `:9090`) | Raw series and alert state |

Alerts in `infra/monitoring/alerts.yml` cover the failures that matter: the sequencer
stopping, the chain not advancing, the batcher failing to publish to the L2, unbatched
blocks accumulating, and the L2 becoming unreachable.

**Not alertable:** an incorrect output root. Nothing on chain detects one — that is what
fault proofs would be for, and KAURAX has none.

---

## 13. Troubleshooting

**`deploy.sh` fails at "waiting for health"** — it prints the failing container's logs.
Usually `.env`: a wrong `L2_RPC_URL`, or an unfunded batcher/proposer key.

**`/api/health` returns 503** — read the `checks` array; it names the dependency and the
error.

**Indexer lag grows** — `docker compose logs -f indexer`. Usually the RPC is slow or the
database is under-resourced. Raise `INDEXER_BATCH_SIZE` only if the RPC can keep up.

**RPC works locally but not through Nginx** — `docker compose exec nginx nginx -t`, then
check `KAURAX_DOMAIN` matches the Host you are sending. Server names come from that
variable via envsubst at container start.

**`enable-tls.sh` fails** — DNS is not pointing here yet, or port 80 is unreachable. The
script checks both before calling certbot, so read its output rather than re-running.

**A frontend shows "No data available" everywhere** — `NEXT_PUBLIC_KAURAX_API_URL` is wrong,
or that origin is missing from `API_CORS_ORIGINS` on the server. Check the browser console
for a CORS rejection.

**Chain state lost after a restart** — the `l3-state` volume was removed. `docker compose
down -v` deletes volumes; `docker compose down` does not.

---

## 14. Before inviting anyone

- [ ] Real keys generated; no Anvil devnet keys anywhere
- [ ] `GUARDIAN_ADDRESS` and `CHALLENGER_ADDRESS` are multisigs
- [ ] TLS enabled and renewing
- [ ] Backups running **off** the server
- [ ] Grafana password changed; Grafana not exposed
- [ ] `/api/health` returns 200 from outside
- [ ] Batcher and proposer keys funded on the L2, with balance alerting
- [ ] `MAINNET_READINESS.md` read and understood

KAURAX has no fault proof system, a centralized sequencer, no forced exit, and no audits.
Say so to anyone you invite.
