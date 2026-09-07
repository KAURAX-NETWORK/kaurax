# Wallet Integration

KAURAX is EVM-equivalent, so any Ethereum wallet works. There is no KAURAX wallet to
install and no custom cryptography anywhere in this repository.

## Adding KAURAX

| Field | Devnet value |
|---|---|
| Network name | KAURAX Devnet |
| RPC URL | `http://127.0.0.1:8420` |
| Chain ID | `8420` |
| Currency symbol | `KAX` |
| Block explorer | `http://127.0.0.1:3000` |

Print the exact parameters for the running network:

```bash
kaurax wallet add
```

Or fetch them over RPC:

```bash
curl -s -X POST http://127.0.0.1:8420 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"kaurax_networkDescriptor","params":[]}'
```

## Programmatic add (EIP-3085)

```ts
await window.ethereum.request({
  method: "wallet_addEthereumChain",
  params: [{
    chainId: "0x20e4",                        // 8420
    chainName: "KAURAX",
    nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
    rpcUrls: ["http://127.0.0.1:8420"],
    blockExplorerUrls: ["http://127.0.0.1:3000"],
  }],
});
```

The bridge UI at `/bridge` does exactly this, and also handles `wallet_switchEthereumChain`
when a deposit needs the wallet on the L2 rather than on KAURAX.

## Supported

- MetaMask and any EIP-1193 provider
- WalletConnect — works through any EIP-1193-compatible connector; KAURAX requires no
  special handling, only the chain parameters above
- Rabby, Frame, Coinbase Wallet, hardware wallets via those interfaces
- viem, ethers, web3.js

## Chain IDs

| Network | Chain ID |
|---|---|
| KAURAX Devnet | 8420 |
| KAURAX Testnet | 8421 (configured, not deployed) |

Both were checked against the public chain registry (chainid.network, 2 750 chains) and are
unused. They are **not** registered — KAURAX has not submitted an entry, and this
documentation does not claim otherwise. Both are configurable via `KAURAX_CHAIN_ID`.

## Account abstraction

**Not implemented.** ERC-4337 works on KAURAX exactly as it works on any EVM chain — the
EntryPoint is a contract, and nothing about KAURAX prevents deploying it — but KAURAX
operates no bundler, no paymaster and no session-key infrastructure.

Do not describe KAURAX as having account abstraction. It has an EVM that would support it.

## A note on KAX

KAX is the native gas asset. It is **not** an ERC-20 and will not appear in a wallet's
token list — it appears as the network's native currency, the way ETH does on Ethereum.

`KauraxToken` in `blockchain/contracts/src/examples/` is an example ERC-20 for testing. It is not KAX.

KAX has no monetary value.
