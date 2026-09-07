<div align="center">

# KAURAX

**An application-focused Ethereum Layer-3.**

Build faster on Ethereum — scalable Web3, AI, payments and next-generation applications,
settling through an underlying Layer-2.

[Architecture](docs/architecture.md) · [Stack decision](docs/STACK_DECISION.md) ·
[Developers](docs/developers.md) · [Bridge](docs/bridge.md) ·
[Threat model](docs/threat-model.md) · [Mainnet readiness](MAINNET_READINESS.md)

</div>

---

```
              ETHEREUM  (L1)
                   │  settlement + data availability
                   ▼
      UNDERLYING ROLLUP  (L2)   ← configurable
                   │  KAURAX batches + output roots
                   ▼
              KAURAX  (L3)
        KAX · Solidity · DeFi · AI · payments · dApps
```

KAURAX is **not** an independent Layer-1. It has no validator set and no consensus of its
own. It executes transactions, publishes its data to an underlying Layer-2, and through
that L2 inherits settlement from Ethereum.

## Status

| | |
|---|---|
| Devnet | **Runs today.** Three real EVM chains, real settlement contracts, verified end to end. |
| Public testnet | **Configured, not deployed.** No KAURAX testnet is running. |
| Mainnet | **No.** See [MAINNET_READINESS.md](MAINNET_READINESS.md). |
| Fault proofs | **Not implemented.** Output roots are trusted. |
| Sequencing | **Centralized.** One operator. |
| Audits | **None.** |
| KAX | Testnet gas asset. **No monetary value.** |

## Quickstart

Requires [Foundry](https://getfoundry.sh), Node.js ≥ 20 and pnpm.

```bash
pnpm install
./infra/scripts/devnet/start.sh
```

This brings up an L1, an L2, the KAURAX settlement contracts on that L2, KAURAX itself, and
prints the wallet parameters. Then:

```bash
./infra/scripts/devnet/status.sh        # three-layer status
./tests/acceptance.sh             # full end-to-end acceptance test
pnpm explorer:dev                 # explorer, bridge and dashboard on :3000
./infra/scripts/devnet/stop.sh
```

Deploy a Solidity contract:

```bash
cd blockchain/contracts
forge build && forge test
export KAURAX_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
forge script script/DeployExamples.s.sol:DeployExamples --rpc-url http://127.0.0.1:8420 --broadcast
```

That key is a well-known public Anvil devnet key. Never use it anywhere else.

## Add KAURAX to a wallet

| Field | Devnet |
|---|---|
| Network name | KAURAX Devnet |
| RPC URL | `http://127.0.0.1:8420` |
| Chain ID | `8420` |
| Currency symbol | `KAX` |
| Explorer | `http://127.0.0.1:3000` |

All configurable in `.env`. `kaurax wallet add` prints the exact
`wallet_addEthereumChain` parameters for whichever network is running.

## What is actually implemented

| | |
|---|---|
| EVM equivalence | Solidity, Foundry, Hardhat, MetaMask, viem, ethers — unmodified |
| JSON-RPC + WebSocket | Full `eth_*` surface, subscriptions, plus a `kaurax_*` namespace |
| Sequencer | Mempool, nonce-aware ordering, fixed-interval block production |
| Deposit derivation | L2 `TransactionDeposited` events become L3 transactions |
| Batcher | RLP + zlib, published as calldata to `KauraxBatchInbox` on the L2 |
| Proposer | `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` to the L2 oracle |
| Bridge | Deposits, and withdrawals proven by Merkle inclusion under a committed root |
| Data availability | **Verified**: the acceptance test recovers a transaction from L2 calldata alone |
| Explorer | Blocks, transactions, addresses, contracts, tokens, network, dashboard |
| Bridge UI | Wallet connect, deposit, withdraw, live stage tracking |
| SDK | `@kaurax/sdk` — chain reads, settlement state, bridge proofs |
| CLI | `kaurax network status`, `block latest`, `tx status`, `bridge status`, … |
| AI layer | Optional service registry, agent registry, escrowed payments |
| Names | Name registry with terms, grace period and verified reverse records |
| Swap | Constant-product AMM: swap, liquidity provision, pool browser, 0.3% LP fee |
| Launchpad | Escrowed token sales with a creator console; below the soft cap everyone refunds in full |
| Backend API | Health, network, blocks, transactions, addresses, tokens, payments, analytics |
| Indexer | PostgreSQL — blocks, transactions, logs, tokens, transfers; atomic and reorg-aware |
| Payments | KAURAX Pay — settlement verified on chain before a payment is confirmed |
| AI | Routed server-side through the [xKiro](https://xkiro.com) gateway |
| Deployment | Docker Compose, Nginx, UpCloud bootstrap and deploy scripts, 7 CI workflows |
| Monitoring | Prometheus metrics, Grafana dashboard, alert rules |

## What is not

- **Fault proofs.** An incorrect output root that survives the challenge window is final.
  This is the single largest risk in the system.
- **Decentralized sequencing.** One sequencer. If it stops, KAURAX stops.
- **Forced exit.** Deposits cannot be censored; withdrawals can.
- **Account abstraction.** The EVM would support ERC-4337; KAURAX operates no bundler,
  paymaster or EntryPoint.
- **Durable unbatched blocks.** Blocks produced but not yet batched live only in the node.
- **Audits.** None.

Each is stated at the point of use in the code, in the RPC responses, and in the UI.

## Repository layout

```
kaurax/
├── apps/            10 Next.js applications (Vercel)
│                    web · explorer · wallet · bridge · pay
│                    ai · swap · names · launchpad · docs
├── services/
│   ├── api/         Fastify — chain reads, payments, analytics, AI proxy
│   └── indexer/     chain → PostgreSQL, plus schema migrations
├── blockchain/
│   ├── l3/          kaurax-node: sequencer, derivation, batcher, proposer, RPC
│   ├── contracts/   Foundry — settlement, bridges, AI layer, examples
│   └── chain/       chain config and genesis allocation
├── packages/        types · ui · sdk · config · cli
├── infra/           docker · nginx · scripts · monitoring
├── docs/            protocol and operations documentation
└── tests/           end-to-end acceptance and API smoke tests
```

Turborepo over pnpm workspaces. See [ARCHITECTURE.md](ARCHITECTURE.md) for what runs where
and [DEPLOYMENT.md](DEPLOYMENT.md) for how to deploy it.

## Running the whole stack locally

```bash
pnpm install
./infra/scripts/devnet/start.sh          # L1 + L2 + settlement contracts + KAURAX

createdb kaurax_dev                      # optional: indexer + API
export DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/kaurax_dev"
pnpm --filter @kaurax/indexer dev &
pnpm --filter @kaurax/api dev &

pnpm dev                                 # all 10 frontends, one per port
```

| Surface | Local |
|---|---|
| KAURAX RPC | `http://127.0.0.1:8420` (ws `:8421`) |
| API | `http://127.0.0.1:4000` |
| Explorer | `http://127.0.0.1:3000` |
| Landing / Wallet / Bridge / Pay / AI | `:3010` `:3011` `:3012` `:3013` `:3014` |
| Swap / Names / Launchpad / Docs | `:3015` `:3016` `:3017` `:3018` |

## Architecture in one paragraph

`kaurax-node` follows the OP Stack (Bedrock) split between deciding *what a block contains*
and deciding *what it means*. The sequencer owns ordering and hands transactions to an
execution engine behind `ExecutionEngineInterface` — `anvil` (revm) on the devnet, `op-geth`
for the testnet profile. Deposits bypass the mempool entirely: they are derived from L2
events, so the sequencer cannot censor them without censoring the L2. The batcher publishes
compressed block data to the L2, the proposer publishes state commitments, and withdrawals
are proven against those commitments by Merkle inclusion. Full detail in
[docs/architecture.md](docs/architecture.md); the reasoning behind the stack choice is in
[docs/STACK_DECISION.md](docs/STACK_DECISION.md).

## Tests

```bash
cd blockchain/contracts && forge test   # 162 contract tests
pnpm test                               # 66 unit tests (node, indexer, API)
./tests/acceptance.sh                   # 47 end-to-end checks against a live devnet
./tests/api-smoke.sh                    # 35 API checks against live chain data
./tests/apps-smoke.sh                   # 43 checks of Names, Swap and Launchpad
```

**353 automated checks in total.**

The acceptance test performs a real deposit through the portal, sends KAX, deploys and calls
a contract, waits for the batch, **recovers the transaction from L2 calldata**, waits for an
output root, then withdraws with a real Merkle proof and finalizes on the L2.

## Security

No component has been audited. KAX has no monetary value. Do not deposit anything you care
about. See [docs/threat-model.md](docs/threat-model.md) and [docs/security.md](docs/security.md).

Never commit a private key. `.env` is gitignored; `.env.example` contains only the publicly
documented Anvil test keys.

## Licence

MIT — see [LICENSE](LICENSE).
