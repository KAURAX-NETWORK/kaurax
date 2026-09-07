# KAURAX — Implementation Plan

Architecture: **Ethereum (L1) → underlying rollup (L2) → KAURAX (L3)**.
Stack: OP Stack / Bedrock component split. See [`docs/STACK_DECISION.md`](./docs/STACK_DECISION.md).

## Phase 0 — Inspect (done)

Environment findings that shaped the plan:

| Capability | State | Consequence |
|---|---|---|
| Foundry 1.5.1 (`anvil`,`forge`,`cast`) | present | devnet L1/L2/L3 execution + contracts + tests |
| Node.js 20.19, pnpm 10.28 | present | node, SDK, CLI, explorer |
| Rust/cargo 1.92 | present | not required by the chosen design |
| Go toolchain | **absent** | cannot build `op-node`/`op-geth` from source |
| Docker daemon | **not running** (colima) | `testnet` profile config generated but not executed |
| npm + GitHub + container registries | reachable | dependency pinning verified live |

## Phase 1 — Chain configuration

- `blockchain/chain/config/*.json` — per-profile chain config: chain ID, block time, gas params,
  settlement target, DA target, genesis allocation.
- `blockchain/chain/genesis/*.json` — genesis state, generated (not hand-written) by a script.
- Chain IDs chosen from a range free of production collisions and **configurable**.

## Phase 2 — Contracts (Foundry)

L2-side (settlement):
- `KauraxPortal` — deposits (L2→L3), withdrawal prove/finalize (L3→L2), pause.
- `KauraxL2OutputOracle` — output-root commitments on an interval.
- `KauraxBatchInbox` — batch data anchoring + events for indexers.
- `KauraxStandardBridge` (L2 side) — ERC-20 + native asset escrow.

L3-side:
- `L3ToL2MessagePasser` — withdrawal message origination.
- `KauraxStandardBridge` (L3 side) — mint/burn representation.

Examples: `HelloKaurax`, `Counter`, `SimpleStorage`, `KauraxToken`.

## Phase 3 — Node (`packages/node`)

Component split mirrors Bedrock:

```
RPC facade ──► Mempool ──► Sequencer ──► ExecutionEngine (anvil/op-geth)
                              │                 │
                              │                 ▼
                              │             L3 blocks
                              ▼                 │
                     Derivation (deposits) ◄────┤
                              ▲                 ▼
                              │             Batcher ──► DA ──► L2 BatchInbox
                        L2 Portal events         │
                                            Proposer ──► L2 OutputOracle
```

Interfaces: `ExecutionEngineInterface`, `SettlementInterface`, `BatcherInterface`,
`DataAvailabilityInterface`.

## Phase 4 — Developer surface

- `@kaurax/sdk` — typed client over the L3 RPC.
- `kaurax` CLI — network/block/account/tx/bridge/sequencer/batch status.
- Foundry + Hardhat configuration driven by `KAURAX_RPC_URL`, `KAURAX_CHAIN_ID`,
  `KAURAX_PRIVATE_KEY`. No keys committed.

## Phase 5 — Explorer, bridge UI, dashboard

Next.js + TypeScript. Every value rendered comes from an RPC or indexer call. Where a value
is unavailable the UI renders `No data available` — never a placeholder number.

## Phase 6 — Devnet

`infra/scripts/devnet/start.sh` brings up, in order: L1 (anvil) → L2 (anvil) → settlement
contracts on L2 → L3 execution engine → kaurax-node (sequencer + derivation + batcher +
proposer) → explorer. Health checks at each step.

## Phase 7 — Test, integrate, security review

`forge test`, node integration tests against a live devnet, RPC conformance checks,
end-to-end deposit → transact → batch → propose acceptance test, then a sweep for
TODO/FIXME/hardcoded secrets/mock data.

## Non-goals for v0

Fault proofs, decentralized sequencing, ERC-4337 bundler operation, mainnet. Each is
specified and interface-stubbed, and each is marked as **not implemented** wherever it
appears.
