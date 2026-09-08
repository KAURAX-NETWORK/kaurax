# hello-world

Deploy a contract to KAURAX and call it.

```bash
cd blockchain/contracts && forge build && cd ../..
node examples/hello-world/deploy.mjs
```

Against the public testnet:

```bash
KAURAX_RPC_URL=https://kaurax.network/rpc \
PRIVATE_KEY=0xyour-key \
node examples/hello-world/deploy.mjs
```

## What it does

Checks the node reports chain 8420, checks the account has gas (and prints the faucet command
if not), deploys `HelloKaurax`, reads `greeting()` and `chainId()`, sends `setGreeting`, waits
for the receipt, reads the value back, and prints an explorer link.

## Notes

The contract is the repository's own
[`HelloKaurax.sol`](../../blockchain/contracts/src/examples/HelloKaurax.sol) — the example
reads the compiled artifact rather than carrying a copy that would drift.

The default key is Foundry's published devnet account 3. It is in every Foundry install and
worth nothing. **Never use it on a chain you care about.**
