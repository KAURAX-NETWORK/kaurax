# KAURAX — Developer Guide

Deploying to KAURAX and building on it. For running a node, see
[NODE_OPERATOR_GUIDE.md](NODE_OPERATOR_GUIDE.md). For getting the repository working, see
[REPRODUCIBILITY.md](REPRODUCIBILITY.md).

---

## 1. Connect

| | Public testnet | Local devnet |
|---|---|---|
| RPC | `https://kaurax.network/rpc` | `http://127.0.0.1:8420` |
| WebSocket | — | `ws://127.0.0.1:8421` |
| Chain ID | **8420** | 8420 |
| Symbol | KAX (18 decimals) | KAX |
| Explorer | `https://kaurax.network/explorer` | `http://127.0.0.1:3000` |

**KAX has no monetary value.** It is a testnet gas token.

MetaMask: remove and re-add the network if you added it before 2026-09-08 — the RPC URL the
API advertised was wrong (a Docker-internal hostname), so wallets showed a zero balance for
funded accounts.

## 2. Get gas

```bash
curl -s -X POST https://kaurax.network/api/faucet \
  -H 'content-type: application/json' -d '{"address":"0xYourAddress"}'
```

100 KAX. One grant per address **and per client IP** per 6 hours — the IP rule is real and
catches shared networks. There is no faucet web page; the endpoint is the interface.

## 3. Deploy

KAURAX is EVM-equivalent for everything a normal contract does. Existing tooling works
unchanged; only the RPC URL and chain ID differ.

**Foundry** — a complete project is in [`examples/basic-contract`](../examples/basic-contract):

```bash
forge create --rpc-url https://kaurax.network/rpc --private-key $PK src/Vault.sol:Vault
forge script script/Deploy.s.sol --rpc-url https://kaurax.network/rpc --broadcast
```

`forge script` prints simulated addresses even when the broadcast reverts. Read the broadcast
summary, not the log line — that mistake once left three KAURAX roles pointing at addresses
holding no code.

**viem** — see [`examples/hello-world/deploy.mjs`](../examples/hello-world/deploy.mjs), which
deploys, reads, writes and waits for a receipt in about 60 lines.

**ethers** — works the same way; construct a `JsonRpcProvider` against the RPC URL above.

**Hardhat**:

```js
networks: {
  kaurax: {url: "https://kaurax.network/rpc", chainId: 8420, accounts: [process.env.PK]},
}
```

## 4. The KAURAX SDK

```bash
pnpm add @kaurax/sdk
```

Chain reads, bridge helpers and the network descriptor for `wallet_addEthereumChain`. Optional
— nothing requires it.

## 5. The CLI

```bash
pnpm --filter @kaurax/cli build
pnpm kaurax network status
pnpm kaurax wallet create mykey
pnpm kaurax faucet
pnpm kaurax wallet send 0xRecipient 1
```

Keys are encrypted with scrypt + AES-256-GCM at `$KAURAX_HOME/keys.json`, mode 600.

## 6. Bridging

Deposits are derived from L2 events, so the sequencer cannot censor one without censoring the
L2. Withdrawals need a Merkle proof against a published output root and then a finalization
window.

**A withdrawal is only as good as the output root it proves against, and nothing verifies
that root corresponds to any execution.** See §8.

## 7. What is different from a normal EVM chain

| | |
|---|---|
| Block time | 2s |
| Block gas limit | 30,000,000 |
| Reorgs | None from KAURAX. An L2 reorg can invalidate a proposal |
| `block.timestamp` | Set by the sequencer; do not use it as a randomness source |
| Ordering | One sequencer. It can reorder and delay you |
| Forced inclusion | If the sequencer ignores you, submit through the L2 portal; settlement halts until it is included |
| Measured throughput | 204 tx/s on a devnet — see [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md). No capacity claim |

## 8. Before you build anything that holds value

Do not. But if you are evaluating:

- **There is no fault proof over KAURAX execution.** Output roots are accepted because the
  proposer key signed them.
- **A 2-of-3 multisig decides every settlement dispute.**
- **No external audit has been performed.**
- **One sequencer, no failover.**
- Operator keys are on one host today.

All of it: [SECURITY_MODEL.md](SECURITY_MODEL.md), [THREAT_MODEL.md](THREAT_MODEL.md),
[SECURITY_STATUS.md](SECURITY_STATUS.md).

## 9. Getting help

Open an issue — templates for bugs, features, documentation and research. Documentation that
overstates what the code does is a bug, and the most valuable kind to report.

**Security issues go privately**: [SECURITY.md](../SECURITY.md).
