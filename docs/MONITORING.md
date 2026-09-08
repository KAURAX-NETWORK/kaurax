# KAURAX — Monitoring

**Status: deployed and scraping.** Verified 2026-09-08: three targets up,
`kaurax_l3_block_height = 38269` served through Prometheus.

It had not been. §5 says why, because the failure is more instructive than the fix.

---

## 1. What runs

| | Where | Exposure |
|---|---|---|
| Node metrics | `kaurax-l3:7300/metrics` | Container network only |
| Indexer metrics | `indexer:7301/metrics` | Container network only |
| Prometheus | `kaurax-prometheus:9090` | Container network only |
| Grafana | `127.0.0.1:3001` | **Loopback only** — reach it over an SSH tunnel |

```bash
ssh -L 3001:127.0.0.1:3001 kaurax@<host>   # then open http://127.0.0.1:3001
```

Nothing in this stack is on the public internet. Metrics name block heights, mempool depth
and batch ages — operational detail an attacker would rather have.

---

## 2. Metrics that exist

Every name below was read from the running node. There are no recording rules that synthesise
a value: **a gap means "not measured", not "zero"**.

| Metric | Type | What it tells you |
|---|---|---|
| `kaurax_l3_block_height` | gauge | KAURAX head |
| `kaurax_l2_block_height` | gauge | The L2 it settles to |
| `kaurax_l1_block_height` | gauge | L1 head |
| `kaurax_l1_finalized_block` | gauge | L1 finality |
| `kaurax_blocks_produced_total` | counter | Blocks sealed since start |
| `kaurax_transactions_included_total` | counter | User transactions sequenced |
| `kaurax_deposits_applied_total` | counter | Deposits derived from the L2 |
| `kaurax_mempool_size` | gauge | Queued transactions |
| `kaurax_wal_pending_blocks` | gauge | Sealed, not yet durable downstream |
| `kaurax_sequencer_healthy` | gauge | 1 or 0 |
| `kaurax_batcher_healthy` | gauge | 1 or 0 |
| `kaurax_unbatched_l3_blocks` | gauge | Blocks not yet published to the L2 |
| `kaurax_last_batch_age_seconds` | gauge | Since the last batch landed |
| `kaurax_last_batch_compressed_bytes` | gauge | DA cost proxy |
| `kaurax_derivation_queued` | gauge | Deposits waiting to be sequenced |
| `kaurax_forced_pending` | gauge | Forced transactions outstanding |
| `kaurax_forced_overdue` | gauge | **Past the deadline — settlement is halted** |
| `kaurax_rpc_requests_total` | counter | RPC volume |
| `kaurax_rpc_errors_total` | counter | RPC errors |

### Not measured

Disk, memory and CPU — no node exporter is deployed. Withdrawal state and dispute-game
activity have no metrics; they are on-chain events, and reading them would need an exporter
that does not exist. **These are gaps, listed rather than glossed.**

---

## 3. Alerts

Every rule references a metric that exists — checked against the running node, because an
alert on a metric nobody exports never fires and is indistinguishable from a healthy system.

| Alert | Expression | For | Severity |
|---|---|---|---|
| `KauraxScrapeTargetDown` | `up == 0` | 2m | critical |
| `KauraxNodeUnreachable` | `up{job="kaurax-node"} == 0` | 2m | critical |
| `KauraxSequencerDown` | `kaurax_sequencer_healthy == 0` | 1m | critical |
| `KauraxBlockHeightStalled` | `increase(kaurax_l3_block_height[3m]) == 0` | 3m | critical |
| `KauraxBatcherUnhealthy` | `kaurax_batcher_healthy == 0` | 2m | warning |
| `KauraxUnbatchedBlocksHigh` | `kaurax_unbatched_l3_blocks > 200` | 5m | warning |
| `KauraxBatchStale` | `kaurax_last_batch_age_seconds > 600` | 5m | warning |
| `KauraxL2Unreachable` | `absent(kaurax_l2_block_height)` | 5m | critical |
| `KauraxL2Stalled` | `increase(kaurax_l2_block_height[10m]) == 0` | 10m | warning |
| `KauraxRpcErrorRateHigh` | error ratio > 25% | 5m | warning |
| `KauraxMempoolBacklog` | `kaurax_mempool_size > 5000` | 5m | warning |

`KauraxScrapeTargetDown` was added this round and matters most: it is the alert that would
have caught the outage described in §5. **An alert that never fires looks exactly like a
system that never breaks.**

### Thresholds, and why

| Threshold | Reasoning |
|---|---|
| Block stall, 3m | Blocks are 2s. Three minutes is ~90 missed blocks — not a hiccup |
| Unbatched > 200 | ~7 minutes of production. Beyond that, DA is falling behind |
| Batch age > 600s | The batcher submits far more often; ten minutes means it has stopped |
| RPC errors > 25% | Below this is normal user error. Above it is the node |
| Mempool > 5000 | Sustained backlog rather than a burst |
| Scrape down, 2m | Longer than a restart, shorter than an incident |

**No alert has ever fired in production**, because monitoring only started scraping today.
The thresholds are reasoned, not calibrated against observed behaviour, and should be revised
once there is a week of data.

---

## 4. Running it

```bash
docker compose up -d --no-deps prometheus grafana

# targets — all three must say "up"
docker exec kaurax-prometheus wget -qO- \
  'http://127.0.0.1:9090/api/v1/targets?state=any' | jq -r \
  '.data.activeTargets[] | "\(.labels.job) \(.health)"'

# a real value end to end
docker exec kaurax-prometheus wget -qO- \
  'http://127.0.0.1:9090/api/v1/query?query=kaurax_l3_block_height'
```

`--no-deps` is not optional: without it, compose pulls in `bootstrap`, which redeploys
settlement contracts. That is guarded now, but the flag is still correct.

---

## 5. Why this was not working

Prometheus scraped `kaurax-node:7300`. **There is no service called `kaurax-node`** — the
compose service and container are both `kaurax-l3`. The name never resolved, so the job had
been down for as long as it had existed.

It was invisible for a specific reason: an unresolvable target is simply a target that is
down, and **nothing alerted on down targets**. The one alert that would have caught it was
the one missing. Both are fixed — the target name, and `KauraxScrapeTargetDown`.

Worth stating plainly: the config was committed, reviewed and wrong, and no amount of reading
it would have revealed that, because the name looks right. Only running it did.

---

## 6. What a reviewer should check

```bash
# metrics exist and are not stale
docker exec kaurax-l3 node -e "fetch('http://127.0.0.1:7300/metrics').then(r=>r.text()).then(console.log)" | head

# every alert references a metric that exists
grep -oE 'kaurax_[a-z_]+' infra/monitoring/alerts.yml | sort -u
```

Compare the second list against §2. Any name not in the table is an alert that cannot fire.
