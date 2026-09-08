# KAURAX — Node Operator Guide

Running `kaurax-node`. For the public testnet specifically, see
[TESTNET_OPERATIONS.md](TESTNET_OPERATIONS.md).

---

## 1. What a node is

One process — `blockchain/l3` — running six things against an execution engine:

| Component | Responsibility |
|---|---|
| Sequencer | Orders transactions, seals blocks, writes a WAL first |
| Derivation | Turns L2 `TransactionDeposited` events into L3 transactions, exactly once |
| Batcher | RLP + zlib of blocks to `KauraxBatchInbox` as L2 calldata |
| Proposer | `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` to the output oracle |
| RPC | Public JSON-RPC — an **allowlist**, not a filtered passthrough |
| Metrics | Prometheus text format on `:7300` |

**The execution engine is `anvil`, driven over JSON-RPC.** It is the only implementation
(`engine/AnvilEngine.ts`), and the profile is not consulted when constructing it. The engine
endpoint must never be publicly reachable: it exposes `anvil_*` cheatcodes that can mint
balances and impersonate accounts.

## 2. Requirements

Node ≥ 20.9 · pnpm 10.28.0 · Foundry (`anvil` **is** the engine) · PostgreSQL for the indexer
(optional; the API degrades to chain-only reads without it).

Observed on a shared devnet host: well under 1 GB resident for the node. Chain data grows with
history; no measurement of long-run growth exists
([PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) §6).

## 3. Configuration

All through environment variables, loaded by `@kaurax/config`, documented in `.env.example`.
The node refuses to start on a missing required variable rather than defaulting.

The ones that matter most:

| Variable | Why it matters |
|---|---|
| `KAURAX_RPC_URL` | How **this process** reaches the node |
| `KAURAX_PUBLIC_RPC_URL` | What **browsers** are told to dial. Set it behind any CDN or proxy — see below |
| `KAURAX_ENGINE_RPC_URL` | The engine. Bind to loopback. Never expose |
| `KAURAX_CHAIN_ID` | 8420 |
| `KAURAX_GENESIS_BLOCK` | Blocks at or below this are genesis and are not published |
| `KAURAX_DERIVATION_CHECKPOINT_PATH` | Position in the **L2**. Chain-specific |
| `KAURAX_WAL_PATH` | Sealed-but-unbatched blocks |
| `SEQUENCER_/BATCHER_/PROPOSER_PRIVATE_KEY` | Local today. Compromising the host yields all three |

**`KAURAX_PUBLIC_RPC_URL` is not optional behind a proxy.** TLS usually terminates at a CDN
which reaches nginx over plain http, and nginx rewrites `X-Forwarded-Proto` to its own hop
scheme — so the public origin cannot be derived. Getting this wrong advertises an `http://`
RPC URL to pages served over `https`, which browsers block and MetaMask refuses.

## 4. Starting

```bash
./infra/scripts/devnet/start.sh          # everything: L1, L2, engine, contracts, genesis, node
./infra/scripts/devnet/status.sh
./infra/scripts/devnet/stop.sh
```

Containerised: `docker compose up -d`, with `COMPOSE_FILE` naming every file the host needs.

## 5. Refusals are deliberate

The node stops rather than continuing on a wrong assumption:

| Refusal | Meaning |
|---|---|
| `Derivation checkpoint says L2 block N, but the L2 head is only M` | Pointed at a different or reset L2. **Do not clear the checkpoint on a chain you intend to keep** |
| `the execution engine is already at block N` | `deploy-contracts.sh` would redeploy over a live chain |
| `SECURITY: the public KAURAX RPC forwarded anvil_setBalance` | Cheatcodes are reachable through the public endpoint |
| `L2 reports chain id X, expected Y` | Wrong settlement target |

## 6. Monitoring

[MONITORING.md](MONITORING.md). Nineteen metrics, eleven alerts, all verified against a
running node. The two that matter most:

- `kaurax_forced_overdue > 0` — a forced transaction passed its deadline; **settlement is
  halted for everyone** until it is included. This is the censorship escape hatch working.
- `increase(kaurax_l3_block_height[3m]) == 0` — the chain has stopped.

## 7. Keys

Keys are read from environment variables today. `services/signer` implements a keystore
(scrypt + AES-256-GCM) and an HTTP signing seam, is tested, and **is not deployed** — finding
M-3. Until it is, host compromise yields the sequencer, batcher and proposer identities
together.

## 8. Backup

`infra/scripts/ops/backup.sh` and `restore.sh`. Back up the database and the node's WAL and
checkpoint. On a devnet L2 with no persistence, losing chain state loses the chain — history
cannot be re-derived from a chain that no longer exists.

## 9. What a node operator cannot do

Run a second sequencer — there is no failover and no leader election. Verify another node's
output roots — no fault proof exists for KAURAX execution. Serve state you did not derive
yourself, and be believed: every block is L2 calldata, so users can rebuild the chain without
trusting you. That last one is a feature.
