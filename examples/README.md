# KAURAX examples

Three examples, in the order a new developer should meet them. Each is runnable against the
local devnet or the public testnet — only `KAURAX_RPC_URL` changes.

| | What it shows |
|---|---|
| [hello-world](hello-world) | Deploy a contract and call it, in about 40 lines |
| [basic-contract](basic-contract) | A contract with Foundry tests, deployed and exercised |
| [basic-frontend](basic-frontend) | A page that connects a wallet and reads the chain, with no build step and no dependencies |

## Network

| | Local devnet | Public testnet |
|---|---|---|
| RPC | `http://127.0.0.1:8420` | `https://kaurax.network/rpc` |
| Chain ID | 8420 | 8420 |
| Symbol | KAX | KAX |
| Explorer | `http://127.0.0.1:3000` | `https://kaurax.network/explorer` |
| Faucet | funded at genesis | `POST https://kaurax.network/api/faucet` |

**KAX is a testnet gas token with no monetary value.**

## Getting gas

```bash
curl -s -X POST https://kaurax.network/api/faucet \
  -H 'content-type: application/json' \
  -d '{"address":"0xYourAddress"}'
```

100 KAX, one grant per address **and per client IP** per 6 hours.

Or, on the devnet, use a genesis account — `0x90F79bf6EB2c4f870365E785982E1f101E93b906`, key
`0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6`. These keys are
public, in every Foundry install, and worthless. Never use them anywhere real.
