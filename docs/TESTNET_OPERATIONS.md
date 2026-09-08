# KAURAX — Testnet Operations

Running the public testnet. Everything here was executed, including the failures.

**Host:** UpCloud, `87.58.152.42`. **Access:** `ssh -i ~/.ssh/kaurax_deploy kaurax@<host>`.
**Repository on the host:** `/opt/kaurax` — **not a git checkout**; files are copied in.

---

## 1. Two rules that come from real outages

### Always compose with both files

```bash
# in /opt/kaurax/.env
COMPOSE_FILE=docker-compose.yml:docker-compose.devnet.yml
```

The override publishes nginx on **8880**, which is the port the CDN reaches, because UpCloud
blocks inbound 80/443 on this account. A bare `docker compose` reads only the base file,
rebinds nginx to 80/443, and **the origin goes dark while every container still reports
healthy**. That happened. `deploy.sh` now refuses a deploy that would stop publishing a port
something is currently reaching.

### Always use `--no-deps` when touching one service

```bash
docker compose up -d --no-deps api
```

Without it, compose pulls in `bootstrap`, which **redeploys the settlement contracts and
re-runs genesis**. That happened too: four orphaned contracts on the live L2, and genesis
failed. `deploy-contracts.sh` now refuses when the engine is past genesis, but the flag is
still correct.

---

## 2. Health

```bash
curl -s https://kaurax.network/api/network | jq '{head, chainId, rpcUrl}'
curl -s -X POST https://kaurax.network/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
ssh kaurax@<host> 'docker ps --format "{{.Names}}\t{{.Status}}"'
```

Ten containers should be up: `kaurax-l1`, `kaurax-l2`, `kaurax-l3-engine`, `kaurax-l3`,
`kaurax-postgres`, `kaurax-indexer`, `kaurax-api`, `kaurax-nginx`, `kaurax-prometheus`,
`kaurax-grafana`.

Metrics and alerts: [MONITORING.md](MONITORING.md). Grafana is loopback-only —
`ssh -L 3001:127.0.0.1:3001`.

---

## 3. After restarting any backend container

**Reload nginx.** It resolves upstream container IPs at config-load time. Restarting a
backend gives it a new IP, and nginx keeps dialling the old one — including the case where
the new container takes the IP nginx had cached for a *different* service, which produced a
502 storm on `/rpc` while the RPC node was perfectly healthy.

```bash
docker compose up -d --no-deps <service>
sleep 10
docker exec kaurax-nginx nginx -s reload
```

---

## 4. Deploying

```bash
ssh kaurax@<host>
cd /opt/kaurax
docker compose config --quiet          # syntax
./infra/scripts/deploy.sh              # refuses to unpublish a live port
```

Copying files in without a full deploy:

```bash
scp -i ~/.ssh/kaurax_deploy <file> kaurax@<host>:/opt/kaurax/<path>
ssh kaurax@<host> 'cd /opt/kaurax && docker compose build api && docker compose up -d --no-deps api && sleep 10 && docker exec kaurax-nginx nginx -s reload'
```

---

## 5. Failure modes, observed

| Symptom | Cause | Response |
|---|---|---|
| `/api` and `/rpc` 502, containers healthy | nginx holding stale upstream IPs | `nginx -s reload` |
| `/api` and `/rpc` unreachable, nginx healthy | nginx rebound to 80/443, losing 8880 | Recompose with both files |
| `bootstrap` exits 1, `kaurax-l3` stuck `Created` | bootstrap re-ran over a live chain | Start with `--no-deps`; the guard now prevents it |
| Node refuses to start, "Derivation checkpoint says L2 block N" | Node pointed at a different or reset L2 | Correct behaviour. Do not clear the checkpoint on a chain you intend to keep |
| Prometheus shows no data | Scrape target does not resolve | Check `docker compose config --services` for the real name |
| Faucet returns `cooldown` | One grant per address **and per client IP** per 6 h | Wait, or use another network |

---

## 6. Simulated failures

`tests/chaos.sh` — **devnet only, destructive.** Results on this commit: **10 scenarios, 10
passed** with a correctly-running stack.

| Scenario | Asserts |
|---|---|
| `sequencer` | SIGKILL; the chain resumes from the same height, no rollback, WAL replays |
| `indexer` | Resumes from its cursor and returns to zero lag |
| `database` | API returns 503 while PostgreSQL is gone and **never fabricates a value**; recovers unaided |
| `graceful` | Readiness is 200, then flips during drain; the process finishes in-flight work |
| `engine` | Run deliberately — needs a full devnet restart |

Two "failures" in an earlier run were **my own environment**: a node orphaned by killing the
harness mid-scenario, and an API process from a previous session holding port 4000 that
predated the readiness route. Both are recorded because a reader should know the difference
between a chaos finding and a dirty machine.

### Not simulated

Host loss · network partition between L2 and L3 · disk exhaustion · **sequencer failover,
because there is no failover**.

---

## 7. Backup and recovery

`infra/scripts/ops/backup.sh` and `restore.sh` cover PostgreSQL and node state. A recovery
rehearsal has been performed once and is recorded in the deployment status document.

**Chain state lives in Docker volumes** (`l3-data`, `l3-state`). Losing them loses the chain:
KAURAX's own L2 is a devnet anvil with no persistence, so history could not be re-derived.
On a real L2 it could.

---

## 8. What this deployment is

The public testnet runs the **`devnet` profile** — `KAURAX_PROFILE=devnet`, `anvil` as the
execution engine, local L1 and L2 stand-ins. That is why the faucet works: it refuses to run
on any other profile.

The `testnet` profile in [STACK_DECISION.md](STACK_DECISION.md) — op-geth, op-node, a public
L2 — is **configured and has never been operated**. Nothing at `kaurax.network` uses it.

Consequences, stated plainly: L1 and L2 finality are local artefacts; the chain inherits no
external security; and losing the host loses the chain.
