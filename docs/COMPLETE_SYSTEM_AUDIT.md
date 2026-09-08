# KAURAX — Complete System Audit

**Date:** 2026-09-08 · **Method:** every row was checked against source or against the running
testnet. Nothing is taken from documentation. **No protocol code was modified to produce it.**

**Scale:** ~31,600 lines across 21 workspace packages — 6,072 Solidity, 4,571 L3 node,
4,824 shared packages, 3,724 services, 8,143 apps, 2,183 infrastructure, 2,144 tests.

---

## 1. Dependency map

```
                    Ethereum L1 (chain 8410, devnet: anvil)
                              ▲  settlement inherited through the L2
                              │
                    Underlying L2 (chain 8415)
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
  KauraxPortal        KauraxL2OutputOracle    KauraxBatchInbox
  deposits/withdrawals   output roots + bonds    DA calldata
        │                     │  ▲                   ▲
        │                     │  │ hasLiveGame       │
        │                     │  └── KauraxDisputeGame (guardian-resolved)
        │                     │
        └────────┬────────────┴──────────────┬───────┘
                 │                           │
            Derivation                  Proposer / Batcher
            (L2 events → L3)            (L3 → L2)
                 │                           │
                 └──────► kaurax-node ◄──────┘
                          sequencer, mempool, WAL, RPC, metrics
                                 │
                          AnvilEngine (JSON-RPC)
                                 │
                          anvil  ← THE STATE TRANSITION FUNCTION
                                 │
        ┌────────────────────────┼──────────────────────────┐
     indexer → PostgreSQL     API (Fastify)            public RPC
                                 │                          │
                              nginx ──── Vercel (10 Next.js zones)
                                            web docs explorer wallet bridge
                                            swap names launchpad pay ai

  Unwired, deliberately:  KauraxFaultDisputeGame → KauraxOneStepVerifier → packages/kvs
```

The single most important edge is `AnvilEngine → anvil`: the state transition function is an
external binary reached over JSON-RPC, and everything about provability follows from that.

---

## 2. Settlement contracts (L2)

| Component | Location | Purpose | Implementation | Security assumption | Tests | Ready? |
|---|---|---|---|---|---|---|
| `KauraxPortal` | `src/L2/KauraxPortal.sol` (432) | Deposits, withdrawal proving and finalization | Merkle proof against a published root **and** `isOutputFinalized` | The output root is honest | 25 | Testnet |
| `KauraxL2OutputOracle` | `src/L2/` (368) | Output roots, proposer bonds, finalization | Checks caller, block number, timestamp, pinned L2 hash | **Nothing verifies the root matches execution** | 13 | Testnet |
| `KauraxBatchInbox` | `src/L2/` (100) | DA calldata sink | RLP+zlib blobs, owner-gated submitters, 1h timelock | Data is published, not verified | 9 | Testnet |
| `KauraxL2ERC20Bridge` | `src/L2/` (103) | ERC-20 escrow | Lock/release against the portal | Portal correctness | 6 | Testnet |
| `KauraxDisputeGame` | `src/dispute/` (542) | Bonded permissionless challenges, block bisection | Real bisection; **2-of-3 multisig decides** | Guardian honesty | 41 + 11 adversarial | Testnet |
| `KauraxMultisig` | `src/governance/` (287) | 2-of-3 with owner epochs | Threshold execution | Signer honesty | 27 (shared) | Testnet |
| `KauraxTimelock` | `src/governance/` (234) | 1h delay on inbox ownership | Queue/execute/cancel | Governance honesty | 27 (shared) | Testnet |

**Verified live**: forced inclusion halts settlement past the deadline and resumes on
acknowledgement; a dispute game was played to resolution; the portal refuses a withdrawal
against an unfinalized output.

### 2.1 L3 predeploys

`L3ToL2MessagePasser` (123) — withdrawal tree, root read at the committed block, not at head.
`KauraxL3ERC20Bridge` (81), `KauraxBridgedERC20` (101).

### 2.2 Libraries

`MerkleTree` (102, append-only depth 32) · `Hashing` (40, mirrored in TypeScript and pinned by
test) · `AddressAliasHelper` (32) · `Types` (48) · `DeployGuard` (53, refuses a role to an
address with no code — added after three roles were bricked in a real deployment).

### 2.3 Application contracts

Swap (AMM), Names, Launchpad, WKAX, AI registries — 30/29/27/15 tests. Not settlement-critical;
they exist to give the testnet something to do.

---

## 3. Execution and node

| Component | Location | What it actually does | Limitation |
|---|---|---|---|
| **Execution engine** | `engine/AnvilEngine.ts` (147) | Drives `anvil` over JSON-RPC: `evm_mine`, `anvil_setBalance`, `anvil_impersonateAccount` | **The only engine.** `index.ts:59` constructs it unconditionally |
| Sequencer | `sequencer/Sequencer.ts` (247) + mempool (222) + WAL (177) | Orders transactions, seals blocks | Single operator |
| Proposer | `proposer/Proposer.ts` (154) | `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` → L2 | **Reads** the state root from `eth_getBlockByNumber` |
| Batcher | `batcher/Batcher.ts` (189) + `da/calldata.ts` | RLP + zlib to the inbox | — |
| Derivation | `derivation/Derivation.ts` (289) | L2 `TransactionDeposited` → L3, exactly once, checkpointed | Does not re-execute anything |
| Settlement adapter | `settlement/L2SettlementAdapter.ts` (446) | L2 reads and writes | — |
| Withdrawals | `withdrawals.ts` (231) | Proof assembly | — |
| Forced inclusion | `forced.ts` (268) | Deadline tracking | — |
| RPC facade | `rpc/server.ts` (301) | Public JSON-RPC | — |
| Metrics | `metrics.ts` (50) | Prometheus text format, port 7300 | **Serving live** — verified |
| Signer client | `signer/` (282) | Remote signing seam | **Not active in production** |

### FINDING A-2 (CRITICAL for provability) — the STF is not in this repository

No component computes a state root, re-executes a transaction, or replays a block. `grep`
confirms `stateRoot` is only ever read from the engine. There is exactly one implementation of
the KAURAX state transition and it is an external binary.

Everything in the fault-proof section follows from this.

### FINDING A-1 (HIGH for credibility) — a false claim in a code comment

`AnvilEngine.ts:11`: *"the `testnet` profile uses `op-geth` for that."* No `op-geth` engine
exists; the profile is never consulted when constructing one. The live node reports
`anvil (revm)`. **Still unfixed — scheduled for Phase 2.**

---

## 4. Fault proofs

| Component | Location | Status |
|---|---|---|
| One-step verifier | `src/kvs/KauraxOneStepVerifier.sol` (544) | **Implemented and real** — executes an instruction, no oracle, no signature, no privileged caller |
| Commitment library | `src/kvs/KVSMerkle.sol` (74) | Implemented; proving and updating are one operation |
| Machine state | `src/kvs/KVSTypes.sol` (96) | Implemented |
| Gas schedule | `src/kvs/KVSGas.sol` (50) | Implemented |
| Emulator + traces | `packages/kvs/` (~990 TS) | Implemented; 404 differential cases against the verifier |
| Multi-level game | `src/dispute/KauraxFaultDisputeGame.sol` (475) | Implemented — bisects BLOCK→TRANSACTION→STEP, resolves through the verifier |
| **Coverage of KAURAX execution** | — | **NOT IMPLEMENTED** |

The verifier covers a documented EVM subset. KAURAX blocks run on the full EVM under `anvil`,
so the game is deliberately **not** wired to `KauraxL2OutputOracle`. Settlement disputes remain
guardian-resolved. [FAULT_PROOFS.md](FAULT_PROOFS.md) §9 lists what must change.

---

## 5. Services and packages

| Component | Location | Purpose | Ready? | Note |
|---|---|---|---|---|
| API | `services/api` (~1,300 TS) | Chain reads, faucet, payments, AI proxy | Testnet | CORS allowlisted; AI key server-side only |
| Indexer | `services/indexer` (1,087) | Blocks/txs/tokens → PostgreSQL | Testnet | 16 tests |
| Signer | `services/signer` (285) | scrypt+AES-256-GCM keystore, HTTP signing | **Built, not deployed** | Finding M-3 |
| SDK | `packages/sdk` (919) | Client, bridge, AA helpers | Testnet | — |
| CLI | `packages/cli` (743) | Wallet, deploy, send, network | Testnet | Real signing; keys at mode 600 |
| KVS | `packages/kvs` (~990) | Execution model, traces, proofs | Research | Not imported by the node |
| Config | `packages/config` | Typed env loading | Testnet | Single source of truth |
| UI / types | `packages/ui`, `packages/types` | Shared components and types | Testnet | — |

### Apps — 10 Next.js zones under one domain

web (3 files) · explorer (17) · docs (7) · swap (7) · launchpad (5) · wallet, bridge, names,
pay, ai (4 each). All live at `kaurax.network/<zone>`, all public.

---

## 6. Infrastructure

| Area | State |
|---|---|
| Docker | 4 images (l3, api, indexer, bootstrap); compose declares 10 services |
| nginx | 4 templates; TLS terminates at the CDN, so `$scheme` at the origin is http |
| Deployment | `deploy.sh`, `provision-upcloud.sh`, `enable-tls.sh`, backup/restore |
| CI | 7 workflows: ci, contracts, deploy, docker, frontend, release, security |
| Secrets | gitleaks **blocking**; committed-`.env` check; bundle key scan; `NEXT_PUBLIC_` smuggling check |
| Monitoring config | Prometheus + Grafana + alerts + dashboard, all committed |

### FINDING A-4 (MEDIUM) — monitoring is configured but not running

`docker compose config --services` lists `prometheus` and `grafana`;
`GRAFANA_ADMIN_PASSWORD` is set; **neither container is running** on the live host. The node's
`/metrics` endpoint *is* serving real data (verified: `kaurax_l3_block_height 37310`,
`kaurax_blocks_produced_total 17018`), so nothing scrapes a working exporter.

### FINDING A-5 (MEDIUM) — nginx overwrites the client protocol

All four templates set `X-Forwarded-Proto $scheme`, discarding what the CDN sent. Worked
around with an explicit `KAURAX_PUBLIC_RPC_URL`; the derivation is still wrong for any other
deployment.

---

## 7. Tests

**499 automated** — 322 Solidity (17 suites), 165 node (26 packages), 12 live end-to-end.
Plus `tests/`: acceptance (545 TS), apps-smoke (438), chaos (282), load (218),
forced-inclusion (174), api-smoke (188), live-check (125).

CI runs typecheck, unit tests, full build, devnet boot, acceptance, API-against-live-chain,
app contracts, contract coverage with a floor on security-critical contracts, and node
coverage.

### FINDING A-6 (LOW) — documented test counts have drifted three times

Counts appear in 12 documents and have been corrected by hand three times this session. No CI
check compares them against reality.

### FINDING A-7 (LOW) — the KVS fixture is not checked for determinism in CI

`pnpm --filter @kaurax/kvs fixtures` is deterministic by construction, but nothing verifies
the committed fixture still matches what the generator produces.

---

## 8. Gaps against the target state

| Missing | Phase |
|---|---|
| `examples/` — no runnable example contracts or frontends | 10 |
| `.github/ISSUE_TEMPLATE/`, PR template | 11 |
| `CODE_OF_CONDUCT.md` | 9 |
| Monitoring deployed and scraping | 8, 13 |
| `docs/MONITORING.md`, `PERFORMANCE_REPORT.md`, `AUDIT_PACKAGE.md`, `MAINNET_CHECKLIST.md`, `DECENTRALIZATION_ROADMAP.md`, `TESTNET_OPERATIONS.md`, `NODE_OPERATOR_GUIDE.md` | 9, 13–18 |
| Measured performance figures — no TPS, latency or DA-cost numbers exist | 14 |
| `docs/THREAT_MODEL.md` is a 6-line pointer; the content is in `threat-model.md` (160 lines, 13 threats) | 3 |

`docs/` already holds 47 files. Several targets have existing equivalents
(`REPRODUCIBLE_BUILD.md`, `MAINNET_READINESS.md`, `decentralization.md`,
`GRANT_READINESS.md`). **The plan extends those rather than adding near-duplicates**, because
doc sprawl is how the count drift in A-6 happened.

---

## 9. Stale claims found in existing documentation

| Claim | Reality |
|---|---|
| `SECURITY_STATUS.md` H-1: *"No verifier exists; no stub written"* | A real verifier now exists for the KVS subset. H-1 stays **OPEN** for KAURAX execution, but the evidence line is wrong |
| `SECURITY_STATUS.md` I-1: *"no differential tests"* | 404 differential cases exist for the KVS. KAURAX's own STF is still unpinned |
| `AnvilEngine.ts:11`: op-geth on testnet | No such engine exists |

---

## 10. Open findings carried in

3 HIGH, 4 MEDIUM/LOW, 1 informational — [SECURITY_STATUS.md](SECURITY_STATUS.md).

H-1 no fault proof over KAURAX execution · H-2 guardian is final arbiter · H-3 no external
audit · M-3 operator keys local · M-4 no TLS on the public RPC (host-blocked) · L-1 one live
game per output · I-1 determinism unspecified.

**Nothing was downgraded.** H-1 and H-2 remain HIGH despite the verifier work, because the
verifier does not cover KAURAX execution.

---

## 11. Honest production-readiness summary

| | Verdict |
|---|---|
| Public testnet | **Operating.** Live, verified this session |
| External developer adoption | **Blocked on Phase 10** — no examples, no quick-start |
| Grant applications | **Ready**, package exists |
| External security review | **Nearly** — needs an audit package and a real threat model at `THREAT_MODEL.md` |
| Mainnet candidate | **No.** H-1 alone forbids it |
| Long-term decentralization | **Not started.** One sequencer by design |
