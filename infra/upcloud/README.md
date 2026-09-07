# UpCloud — server specification

KAURAX's persistent infrastructure runs on a single Linux VPS. This directory holds the
provisioning notes; the scripts live in [`../scripts/`](../scripts/).

> **No server exists yet.** These are the requirements and the procedure, not a record of a
> deployment.
>
> Provisioning is scripted — `infra/scripts/ops/provision-upcloud.sh` creates the server,
> locks the firewall to 22/80/443 and prints the DNS records to add. It is blocked on one
> thing only: UpCloud restricts API access by source IP, and this machine's address is not
> on the allow-list. Add it under **Account → API** in the UpCloud control panel, then run
> the script.

## Server

| | Minimum | Comfortable |
|---|---|---|
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk | 80 GB | 160 GB |

**Why disk matters most.** Three things grow without bound: L3 chain state, the PostgreSQL
index, and Prometheus retention. 80 GB is a starting point, not a ceiling — watch it.

## What runs on it

Ten containers (see [`../../docker-compose.yml`](../../docker-compose.yml)): `nginx`,
`kaurax-l3`, `l3-engine`, `api`, `indexer`, `postgres`, `prometheus`, `grafana`, `certbot`,
and the one-shot `bootstrap`.

## Network exposure

| Port | Open to | Service |
|---|---|---|
| 22 | the internet (key auth only) | SSH |
| 80 | the internet | Nginx — ACME and HTTP redirect |
| 443 | the internet | Nginx — RPC, API, indexer |
| everything else | **nothing** | internal Docker network only |

PostgreSQL, the L3 execution engine, the indexer and Grafana are **never published**. The
execution engine in particular exposes administrative RPC methods; publishing it would hand
over control of the chain.

Grafana is bound to `127.0.0.1:3001`. Reach it with `ssh -L 3001:127.0.0.1:3001 kaurax@<ip>`.

## Procedure

```bash
# as root, once
bash infra/scripts/bootstrap.sh

# as the kaurax user, thereafter
git clone <repo> ~/kaurax && cd ~/kaurax
cp .env.example .env && $EDITOR .env
bash infra/scripts/deploy.sh

# once DNS points here
bash infra/scripts/enable-tls.sh
```

Full walkthrough: [`../../DEPLOYMENT.md`](../../DEPLOYMENT.md).

## Volumes to back up

| Volume | Holds | Recoverable without a backup? |
|---|---|---|
| `postgres-data` | Indexed chain data, **payments** | Chain data yes, by re-indexing. **Payments no.** |
| `l3-state` | KAURAX chain state | Only as far as batches reached the L2 |
| `certbot-certs` | TLS certificates | Yes, re-issue |
| `grafana-data` | Dashboards | Yes, re-provisioned from `infra/monitoring/` |
| `prometheus-data` | Metrics history | No, but it is only history |

`payments` is the one table with no on-chain equivalent. Back it up off the server.

## Snapshots

UpCloud snapshots are a fine complement but not a substitute: a snapshot of a running
PostgreSQL is crash-consistent, not transactionally clean. Use `pg_dump` for the database
and snapshots for the machine.
