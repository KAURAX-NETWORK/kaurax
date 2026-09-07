# KAURAX — Security

Protocol threats are in [`docs/threat-model.md`](docs/threat-model.md). This document covers
the **deployment**: secrets, exposure, hardening, and what to do when something goes wrong.

**Nothing in KAURAX has been audited. KAX has no monetary value. Do not deposit anything
you care about.**

---

## 1. Secrets

### Never commit

```
private keys        mnemonics          seed phrases
database passwords  API keys           TLS private keys
.env                keystore files     deployment SSH keys
```

`.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.key`, `*.pem`,
`keystore/` and `mnemonic.txt`. CI fails the build if an `.env` file is ever tracked.

### The keys in `.env.example` are deliberately public

They are the well-known Anvil development accounts, published in Foundry's own
documentation. They hold no value and exist so a local devnet needs no key generation.

**Anyone can spend from them.** `infra/scripts/testnet/deploy.sh` refuses to deploy if any
of them is configured, comparing by *derived address* so no key literal lives in this
repository.

### Where each secret lives

| Secret | Lives in | Never in |
|---|---|---|
| `POSTGRES_PASSWORD` | server `.env` | git, images, CI, browsers |
| `XKIRO_API_KEY` | server `.env`, read by `services/api` | any `NEXT_PUBLIC_*`, any bundle |
| `*_PRIVATE_KEY` | server `.env`, ideally a KMS | git, images, CI logs |
| `UPCLOUD_SSH_KEY` | GitHub Actions secret | git |
| TLS keys | `certbot-certs` volume | git |

`deploy.yml` never transmits application secrets. It triggers a rebuild on the server,
which reads the `.env` already there.

### Generating real values

```bash
openssl rand -base64 32                 # database and Grafana passwords
cast wallet new                         # a fresh keypair per operational role
```

Use a **different key per role** (sequencer, batcher, proposer, deployer). A single
compromised key should not cost you all four.

---

## 2. What is exposed

| Service | Reachable from the internet |
|---|---|
| Nginx (80, 443) | **yes** — the only published ports |
| KAURAX RPC | via Nginx, rate limited |
| KAURAX API | via Nginx, rate limited, CORS allowlisted |
| Indexer health | via Nginx, restricted to private CIDRs |
| **PostgreSQL** | **no** — internal Docker network only |
| **L3 execution engine** | **no** — exposes `anvil_*`; never published |
| **Grafana** | **no** — bound to `127.0.0.1`, reach it over SSH |
| **Prometheus** | **no** — internal only |

Verify after any change:

```bash
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'
sudo ufw status
```

Only `nginx` should show `0.0.0.0` bindings.

---

## 3. RPC hardening

Three independent layers:

1. **The node** blocks `anvil_`, `evm_`, `hardhat_`, `debug_`, `admin_`, `miner_`,
   `personal_`, `txpool_`, `engine_` and `ots_` on the public endpoint, over HTTP **and**
   WebSocket. `eth_accounts` returns `[]`.
2. **The devnet script asserts it** at startup and aborts if the block ever regresses, so
   the guarantee cannot silently rot.
3. **Nginx** rate limits to 20 r/s per IP (burst 40) and caps concurrent connections.

What is **not** implemented: authentication, API keys, per-key quotas, a WAF, DDoS
protection. A public RPC is a free compute endpoint; treat these limits as a speed bump.

---

## 4. Server hardening

`infra/scripts/bootstrap.sh` applies:

- UFW: deny inbound except 22, 80, 443
- SSH: no root login, no password authentication, `MaxAuthTries 3`
- Fail2ban on `sshd`
- A non-root `kaurax` deploy user; containers run as unprivileged users
- Unattended security updates

It **refuses to disable password SSH unless a key is already installed** for the deploy
user, and reverts the change if `sshd` rejects the config. It cannot lock you out.

---

## 5. Application-level controls

**CORS** — `API_CORS_ORIGINS` is an explicit allowlist. `*` is rejected at startup, so a
misconfiguration fails immediately rather than quietly exposing the API.

**Rate limiting** — 120 requests/minute per IP by default. Health endpoints are exempt so
deployment automation is never throttled.

**Input validation** — addresses and hashes are shape-checked before reaching SQL;
pagination is clamped to 100; request bodies are capped at 1 MB.

**SQL injection** — every query is parameterised. No string interpolation anywhere in
`services/`.

**Payment integrity** — a payment is confirmed only after the API verifies the transaction
on chain: receipt exists, status is success, recipient matches, amount is sufficient. A
unique index guarantees one transaction settles one payment, because a read-then-write check
would race.

**AI key isolation** — the browser talks to the KAURAX API, which talks to xKiro. The model
is chosen server-side, so a client cannot select an expensive model. The system prompt is
server-side, so a client cannot override the assistant's constraints. Errors never echo the
upstream body, which can contain request headers.

**Logging** — `authorization` and `cookie` headers are redacted. 5xx messages are not echoed
to clients, since they can carry connection strings.

---

## 6. What is not protected

Stated plainly, because pretending otherwise is the actual danger:

| Gap | Consequence |
|---|---|
| **No fault proofs** | A compromised proposer can drain `KauraxPortal` after the challenge window. This is the largest risk in the entire system. |
| **Single sequencer** | It can censor, reorder, or halt the chain. No failover. |
| **No forced exit** | Deposits cannot be censored; withdrawals can. |
| **Single EOA roles** | Guardian, challenger, proposer and deployer are one key each unless you set multisigs. |
| **No KMS** | Keys are environment variables on the server. |
| **Single server** | One VPS is a single point of failure for the chain. |
| **No audits** | None, of anything. |
| **No DDoS protection** | Rate limiting only. |
| **Unbatched blocks not durable** | Node loss before batching loses those transactions. |

---

## 7. Incident response

**Suspected bridge compromise** — pause first, investigate second:

```bash
cast send $KAURAX_PORTAL_ADDRESS "pause()" --rpc-url $L2_RPC_URL --private-key $GUARDIAN_KEY
```

Halts deposits and withdrawal finalization. Then check whether any output root diverges from
a chain rebuilt from data availability (`docs/data-availability.md`).

**Suspected key compromise** — stop the affected service, generate a new key, rotate it on
chain (`setBatcher`, `setProposer`), update `.env`, redeploy, and move any remaining funds
off the old key.

**Server compromise** — take it off the network, rotate *every* secret including the
database password and the AI key, rebuild from a clean image, restore PostgreSQL from a
backup taken before the incident. Do not reuse the disk.

**Chain halted** — `docker compose logs -f kaurax-l3`. Usually an unfunded batcher key or an
unreachable L2. Funds are not at risk while it is stopped; the chain is simply not advancing.

---

## 8. Regular checks

Weekly: `docker compose ps` and the health endpoint; batcher and proposer balances; disk
usage; `./infra/scripts/security-sweep.sh`.

Monthly: `pnpm audit`, `docker compose pull`, review Fail2ban bans, verify a backup actually
restores.

Automated: `security.yml` runs gitleaks, the tracked-`.env` check, a dependency audit and
Slither on every push and weekly.

---

## 9. Reporting a vulnerability

This is an unaudited testnet with no bug bounty. Do not deposit anything of value.

For anything already documented here or in `docs/threat-model.md`, open an issue. For
anything not documented, contact the maintainers privately before disclosing.
