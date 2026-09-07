# KAURAX Documentation

KAURAX is an **Ethereum Layer-3**: it executes transactions, publishes its data to an
underlying Layer-2, and inherits settlement from Ethereum through that L2. It is not a
Layer-1 and has no security of its own.

## Start here

| Document | What it answers |
|---|---|
| [architecture.md](./architecture.md) | How the whole system fits together |
| [STACK_DECISION.md](./STACK_DECISION.md) | Why OP Stack, what else was considered, what the limits are |
| [l3.md](./l3.md) | What makes KAURAX a Layer-3, and what it does and does not inherit |
| [developers.md](./developers.md) | Deploy your first contract |

## The layers

| Document | Layer |
|---|---|
| [ethereum.md](./ethereum.md) | Ethereum (L1) — the root of trust |
| [underlying-l2.md](./underlying-l2.md) | The configurable rollup KAURAX settles to |

## Components

| Document | Component |
|---|---|
| [sequencer.md](./sequencer.md) | Ordering, block production, censorship |
| [batcher.md](./batcher.md) | Publishing L3 data to the L2 |
| [settlement.md](./settlement.md) | Output roots and the settlement interface |
| [data-availability.md](./data-availability.md) | Where data lives and how to reconstruct the chain |
| [bridge.md](./bridge.md) | Deposits, withdrawals, proofs |
| [contracts.md](./contracts.md) | Every contract and its test coverage |

## Building

| Document | Topic |
|---|---|
| [developers.md](./developers.md) | Foundry, Hardhat, viem, ethers, RPC surface |
| [sdk.md](./sdk.md) | `@kaurax/sdk` |
| [wallet.md](./wallet.md) | Wallet integration and network parameters |
| [apps.md](./apps.md) | Names, Swap and Launchpad — the application contracts |
| [ai.md](./ai.md) | The optional AI application layer |

## Honest limits — read these

| Document | Topic |
|---|---|
| [threat-model.md](./threat-model.md) | Every threat, and which are unmitigated |
| [security.md](./security.md) | Key management and what production requires |
| [decentralization.md](./decentralization.md) | What is centralized today, and the order to fix it |
| [validators.md](./validators.md) | Why KAURAX has no validator set |
| [../MAINNET_READINESS.md](../MAINNET_READINESS.md) | The full gate list |

## The short version

- **No fault proofs.** Output roots posted to the L2 are trusted, not verified. This is the
  largest risk in the system.
- **Centralized sequencer.** One operator. No failover. No forced exit.
- **No audits.** Nothing here has been reviewed by anyone.
- **KAX has no monetary value.** It is a testnet gas asset.
- **No public testnet is running.** The devnet works; the testnet profile is configured but
  has never been operated.

## A note on file names

Three documents are referenced in two spellings. `DATA_AVAILABILITY.md` and
`THREAT_MODEL.md` are one-line pointers to the canonical lowercase files, so there is
exactly one copy of each to keep correct.

There is deliberately **no** `DECENTRALIZATION.md`: it differs from `decentralization.md`
by case alone, and on a case-insensitive filesystem the two are the same file — an alias
would silently overwrite the real document. `decentralization.md` is the only spelling.
