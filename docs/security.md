# Security & Key Management

## Never commit

```
private keys        mnemonics       seed phrases
RPC secrets         deployment keys sequencer/batcher/proposer keys
keystore files      .env
```

`.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.key`, `*.pem`,
`keystore/` and `mnemonic.txt`.

## The keys in `.env.example` are deliberately public

They are the well-known Anvil development accounts, published in Foundry's own
documentation. They hold no value and exist so a local devnet needs no key generation.

**They must never be used on any network that is not a local devnet.** Anyone can spend
from them.

## Operational keys

| Role | Used for | Compromise impact |
|---|---|---|
| `SEQUENCER_PRIVATE_KEY` | Block production identity | Ordering and liveness |
| `BATCHER_PRIVATE_KEY` | Posting batches to the L2 | Data availability |
| `PROPOSER_PRIVATE_KEY` | Posting output roots to the L2 | **Funds at risk** — see T1 in the threat model |
| `DEPLOYER_PRIVATE_KEY` | One-time contract deployment | Contract ownership |
| `GUARDIAN_ADDRESS` | Pausing the portal | Bridge halted |
| `CHALLENGER_ADDRESS` | Deleting bad proposals | Loss of the only backstop |

## Production requirements

None of these are implemented in v0. All are mandatory before a public deployment.

- [ ] Proposer, batcher and sequencer keys in a KMS or hardware signer — never in a file
- [ ] Guardian and challenger as **multisigs**, not EOAs
- [ ] Contract upgrades behind a timelock long enough for users to exit
- [ ] Documented, rehearsed key rotation
- [ ] Separate keys per environment; no reuse between testnet and mainnet
- [ ] Alerting on batcher and proposer balance, so a key does not silently run dry
- [ ] The public RPC behind a reverse proxy providing rate limiting and TLS

## Configuration safety already enforced

The config loader (`packages/config/src/index.ts`) refuses to start on:

- Duplicate chain IDs across L1, L2 and L3 — a shared ID makes transactions replayable
  between layers.
- `LOCAL_DEV_SETTLEMENT=true` with `KAURAX_PROFILE=testnet` — a public network must settle
  against real contracts on a real L2.
- A malformed private key (validated without echoing the value into the error).
- `DA_MODE=altda` without an endpoint.

The node additionally refuses to start if:

- The execution engine reports a chain ID different from `KAURAX_CHAIN_ID`.
- The configured settlement contracts have no code at their addresses.
- The `L3ToL2MessagePasser` predeploy is missing — withdrawals would silently be
  unprovable.

## RPC exposure

The public endpoint blocks `anvil_`, `evm_`, `hardhat_`, `debug_`, `admin_`, `miner_`,
`personal_`, `txpool_`, `engine_` and `ots_` over both HTTP and WebSocket. The devnet
startup script actively probes this and aborts if the block ever regresses.

The execution engine binds to loopback and is not the endpoint users are given.

`eth_accounts` returns an empty array by design.

## Reporting a vulnerability

This is a testnet with no audits and no bug bounty. Do not deposit anything of value.
If you find an issue, open a GitHub issue for anything already disclosed here, and contact
the maintainers privately for anything that is not.
