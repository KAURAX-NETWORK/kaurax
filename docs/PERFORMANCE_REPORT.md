# KAURAX — Performance Report

**Date:** 2026-09-08 · Every figure was observed. Nothing is extrapolated, and **KAURAX
publishes no TPS claim**.

## The machine and the chain

| | |
|---|---|
| Host | darwin/arm64, Apple M4, 10 cores, 17.2 GB |
| Target | local devnet, `http://127.0.0.1:8420`, chain 8420 |
| Topology | **L1, L2, L3, engine, indexer and database all on one host** |
| Block time | 2s |
| Block gas limit | 30,000,000 — about 1,428 simple transfers |

A throughput number without this table is a marketing claim. These are shared-host devnet
figures, not a public deployment.

---

## 1. Throughput

| Transactions | Senders | In flight | Succeeded | Failed | Wall clock | **Observed** | Busiest block |
|---|---|---|---|---|---|---|---|
| 300 | 5 | 20 | 300 | 0 | 44.8 s | 6.7 tx/s | 20 |
| 1,500 | 5 | 250 | 1,500 | 0 | 21.8 s | 68.8 tx/s | 250 |
| 3,000 | 60 | 300 | 3,000 | 0 | 37.9 s | 79.2 tx/s | 300 |
| **8,000** | **150** | **900** | **8,000** | **0** | **39.1 s** | **204.3 tx/s** | **900** |

**204.3 tx/s is the highest figure observed, not a capacity claim.** The busiest block carried
900 transactions against a limit near 1,428, so even the best run did not fill blocks. What
bounded it was how fast the harness could offer work, not the chain.

### Latency at the 204 tx/s run

| | p50 | p95 | max |
|---|---|---|---|
| Submit (accepted into the mempool) | 570 ms | 1,380 ms | — |
| Inclusion (submit → in a block) | 4,126 ms | 6,400 ms | 11,256 ms |

Inclusion sits near two block times at rest, which is what a 2s block time predicts. Under
load p95 stretches to about three blocks.

At the lightest run (20 in flight) submit p50 was **28 ms** and inclusion p50 **3,089 ms** —
latency is dominated by block time, not by processing.

---

## 2. Where it stops, and why

Two ceilings were hit. **Neither was the chain running out of capacity.**

### The per-account mempool limit

At 3,000 transactions across 5 senders with 600 in flight: **2,827 of 3,000 failed.**

```
   334  too many queued transactions for 0x65f5…
   333  too many queued transactions for 0x3603…
```

`maxPerSender` is 64 (`blockchain/l3/src/sequencer/mempool.ts:50`). Six hundred concurrent
requests across five accounts is 120 queued per account, so the mempool refused — correctly.
Spreading the same load over 150 accounts moved 8,000 transactions with zero failures.

**This is backpressure working, not a failure.** It is reported here because the first run
looked like a collapse and it would have been easy to publish it as one.

### The harness

At 900 in flight the submit p50 was 570 ms — the client, not the node, was the slow part.
Filling blocks would need more concurrency than one Node process comfortably drives.

---

## 3. Data availability

| | |
|---|---|
| Last batch, compressed | **8,063 bytes** |
| Batch interval observed | ~45 s |
| Blocks per batch | ~20 |
| Compression | RLP + zlib, calldata to `KauraxBatchInbox` |

At roughly 20 blocks per batch and 8 KB compressed, a batch carrying several hundred
transfers costs on the order of 16 gas/byte in L2 calldata — **~129,000 gas of calldata per
batch**, plus the inbox call itself. Not measured against a public L2, where the real cost is
set by that L2's fee market.

---

## 4. On-chain gas

Measured by `test_stepVerificationStaysInsideTheGasBudget`:

| Operation | Gas |
|---|---|
| One-step verify — `STOP` | 7,940 |
| One-step verify — `PUSH1` | ~19,200 |
| One-step verify — `ADD` | 36,367 |
| One-step verify — `SLOAD` | 137,987 |
| One-step verify — `SSTORE` | 233,249 |

Execution only. A storage proof adds ~8 KB of calldata, roughly 128,000 gas. Worst case stays
well inside the stated 5,000,000 budget, and the test fails if that stops being true.

Dispute-game gas, from the test suite: opening and playing a game to a proven step costs
roughly 600,000–660,000 gas across all moves.

---

## 5. Three defects found while measuring

The load test could not complete a single run before this session. All three were in the
harness, not the chain.

1. **Funding used no explicit nonces.** All sender-funding transactions went out concurrently
   from one account; viem asked the node for the pending nonce each time, every request got
   the same answer, and the node rejected all but one as *replacement transaction
   underpriced*. **This is why the repository had no measured throughput figures.**
2. **Failures were counted but not explained.** A run reported `2827 failed` and nothing
   else. A rate limit doing its job and a node falling over are opposite problems.
3. **The reason recorded was viem's wrapper**, `Missing or invalid parameters`, rather than
   the node's `details`. Recording the wrapper produced 2,680 identical, useless lines.

Funding is now batched to the mempool limit, and the summary prints the top five reasons.

---

## 6. Not measured

- **The public testnet.** All figures are devnet. Load-testing a live public endpoint is a
  denial-of-service against its users.
- **Node synchronisation from genesis.**
- **State growth over time.**
- **Withdrawal processing throughput** — the acceptance suite proves one works, not how many.
- **RPC latency under concurrent read load** — writes only.
- **CPU, memory and disk during load.** No node exporter is deployed
  ([MONITORING.md](MONITORING.md) §2).

---

## 7. Reproducing

```bash
./infra/scripts/devnet/start.sh
set -a && . ./.env && set +a
LOAD_TX=8000 LOAD_SENDERS=150 LOAD_CONCURRENCY=900 pnpm --filter @kaurax/tests load
```

Your numbers will differ. The harness prints the host, the chain and the configuration next
to every figure so the two are never separated.
