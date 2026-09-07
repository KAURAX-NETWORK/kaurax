# KAURAX Architecture

KAURAX is an **Ethereum Layer-3**. It executes application transactions, publishes its data
to an underlying Layer-2, and through that L2 inherits settlement from Ethereum.

It is **not** a Layer-1. It has no validator set, no independent consensus, and no
security of its own.

## The three layers

```
┌──────────────────────────────────────────────────────────┐
│ ETHEREUM  (Layer 1)                                      │
│ Root of trust. Settlement and data availability for the  │
│ L2. KAURAX never talks to it directly.                   │
└───────────────────────┬──────────────────────────────────┘
                        │  L2 posts batches + proofs
                        ▼
┌──────────────────────────────────────────────────────────┐
│ UNDERLYING ROLLUP  (Layer 2)   — configurable            │
│ KAURAX's settlement layer. Hosts:                        │
│   KauraxPortal            deposits / withdrawals         │
│   KauraxL2OutputOracle    KAURAX state commitments       │
│   KauraxBatchInbox        KAURAX transaction data        │
│   KauraxL2ERC20Bridge     ERC-20 escrow                  │
└───────────────────────┬──────────────────────────────────┘
                        │  KAURAX posts batches + output roots
                        ▼
┌──────────────────────────────────────────────────────────┐
│ KAURAX  (Layer 3)                                        │
│ Execution. EVM-equivalent. KAX is the gas asset.         │
│   L3ToL2MessagePasser     withdrawal origination         │
│   KauraxL3ERC20Bridge     mint/burn representation       │
└──────────────────────────────────────────────────────────┘
```

The L2 is **configuration, not architecture**. `L2_CHAIN_ID` and `L2_RPC_URL` select it.
The default for the testnet profile is Base Sepolia; OP Sepolia, Arbitrum Sepolia, Mode or
any other rollup with the settlement contracts deployed works identically.

## Node components

`kaurax-node` follows the OP Stack (Bedrock) split between deciding what a block contains
and deciding what it means.

```
                 ┌──────────────────────────────────────────┐
  user tx ──────►│ RPC facade        blockchain/l3/src/rpc  │
                 │  eth_* proxied, eth_sendRawTransaction   │
                 │  intercepted, kaurax_* served locally    │
                 └───────────────┬──────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────┐
                 │ Mempool + ordering policy                │
                 │  blockchain/l3/src/sequencer/mempool.ts  │
                 └───────────────┬──────────────────────────┘
                                 ▼
 L2 deposit ────►┌──────────────────────────────────────────┐
   (derivation)  │ Sequencer                                │
                 │  deposits first, then user txs           │
                 └───────────────┬──────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────┐
                 │ ExecutionEngine (interface)              │
                 │  devnet:  anvil (revm)                   │
                 │  testnet: op-geth over the Engine API    │
                 └───────────────┬──────────────────────────┘
                                 ▼
                            L3 blocks
                          ┌───┴────┐
                          ▼        ▼
                    ┌─────────┐ ┌──────────┐
                    │ Batcher │ │ Proposer │
                    └────┬────┘ └────┬─────┘
                         ▼           ▼
                 KauraxBatchInbox  KauraxL2OutputOracle
                          (on the underlying L2)
```

| Component | Responsibility | Source |
|---|---|---|
| RPC facade | Public JSON-RPC and WebSocket; blocks admin namespaces | `src/rpc/` |
| Mempool | Accept, validate, replace, order | `src/sequencer/mempool.ts` |
| Sequencer | Build and seal L3 blocks | `src/sequencer/Sequencer.ts` |
| Derivation | Turn L2 deposit events into L3 transactions | `src/derivation/` |
| Execution engine | Execute transactions, compute state | `src/engine/` |
| Batcher | Compress and publish L3 data to the L2 | `src/batcher/` |
| Proposer | Publish output roots to the L2 | `src/proposer/` |
| Settlement adapter | All L2 contract interaction | `src/settlement/` |
| Withdrawal index | Build Merkle proofs for the bridge | `src/withdrawals.ts` |

## Interfaces

Four boundaries are explicit so that any one implementation can be replaced:

- `ExecutionEngineInterface` — `src/engine/types.ts`
- `SettlementInterface` — `src/settlement/types.ts`
- `BatcherInterface` — `src/settlement/types.ts`
- `DataAvailabilityInterface` — `src/settlement/types.ts`

## Transaction lifecycle

1. A wallet signs a transaction for chain ID `KAURAX_CHAIN_ID` and posts it to
   `eth_sendRawTransaction`.
2. The mempool recovers the sender, rejects wrong-chain and unprotected transactions, and
   queues it under that sender's nonce.
3. At the next block interval the sequencer selects deposits first, then ready user
   transactions in effective-priority-fee order.
4. The execution engine executes them and seals the block. State root, receipts and logs
   are real EVM output.
5. The batcher compresses the block range and posts it as calldata to `KauraxBatchInbox` on
   the L2.
6. The proposer publishes `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` to
   `KauraxL2OutputOracle`.
7. Anyone can now reconstruct the block from the L2 and prove a withdrawal against the root.

Steps 5 and 6 are what make KAURAX an L3 rather than a private chain with an EVM.

## What is honestly missing

| Property | State |
|---|---|
| EVM equivalence | Implemented |
| Real data availability on the L2 | Implemented and tested end to end |
| Deposits, forced inclusion | Implemented |
| Proof-verified withdrawals | Implemented (binary Merkle; see `bridge.md`) |
| Fault proofs | **Not implemented** |
| Decentralized sequencing | **Not implemented** |
| ERC-4337 account abstraction | **Not implemented** (interface only) |
| Audits | **None** |

See [`decentralization.md`](./decentralization.md) and [`../MAINNET_READINESS.md`](../MAINNET_READINESS.md).
