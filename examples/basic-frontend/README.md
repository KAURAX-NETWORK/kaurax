# basic-frontend

A page that reads KAURAX and connects a wallet. **No build step, no dependencies, one file.**

```bash
open examples/basic-frontend/index.html
```

Against the local devnet:

```
file:///…/index.html?rpc=http://127.0.0.1:8420
```

## What it shows

Reads (`eth_chainId`, `eth_blockNumber`, `eth_gasPrice`, `eth_getBlockByNumber`) go straight
to the JSON-RPC endpoint with `fetch`. Connecting uses `window.ethereum` directly, and adds
the network with `wallet_addEthereumChain` if the wallet is on a different chain.

## Two deliberate choices

**No packages.** An example whose first instruction is "install these four dependencies"
teaches the dependencies, not the chain. Everything here is a browser built-in.

**`textContent`, never `innerHTML`.** Chain data is attacker-controlled — anyone can put any
string on chain. A frontend that interpolates it into HTML has an XSS hole that the chain
itself will happily fill.
