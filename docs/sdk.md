# SDK — `@kaurax/sdk`

A typed client for KAURAX. It covers standard chain reads, and the L3-specific state that
Ethereum JSON-RPC has no way to express.

**The SDK never holds a private key.** You sign; it submits.

```bash
pnpm add @kaurax/sdk
```

## Connecting

```ts
import {connect} from "@kaurax/sdk";

const kaurax = await connect({
  rpcUrl: "http://127.0.0.1:8420",
  wsUrl: "ws://127.0.0.1:8421",   // only needed for subscriptions
  timeoutMs: 15_000,
});
```

`connect` verifies the endpoint answers and caches the chain ID.

## Chain reads

```ts
await kaurax.getChainId();
await kaurax.getBlockNumber();
await kaurax.getBlock("latest");
await kaurax.getBlockByHash(hash);
await kaurax.getBalance(address);
await kaurax.getTransactionCount(address, "pending");
await kaurax.getCode(address);
await kaurax.getTransaction(hash);
await kaurax.getTransactionReceipt(hash);
await kaurax.waitForTransaction(hash, 60_000);
await kaurax.estimateGas({from, to, value, data});
await kaurax.call({to, data});
await kaurax.getGasPrice();
await kaurax.getLogs({address, topics, fromBlock, toBlock});
```

Everything returns `bigint` where the chain returns a quantity — no lossy `number`
conversions.

## Sending a transaction

```ts
import {createWalletClient, defineChain, http, parseEther} from "viem";
import {privateKeyToAccount} from "viem/accounts";

const account = privateKeyToAccount(process.env.KAURAX_PRIVATE_KEY as `0x${string}`);
const chain = defineChain({
  id: await kaurax.getChainId(),
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: ["http://127.0.0.1:8420"]}},
});

const signed = await createWalletClient({account, chain, transport: http()}).signTransaction({
  to: recipient,
  value: parseEther("0.01"),
  chainId: chain.id,
  nonce: await kaurax.getTransactionCount(account.address, "pending"),
  gas: 21_000n,
  maxFeePerGas: (await kaurax.getGasPrice()) * 2n,
  maxPriorityFeePerGas: 1_000_000n,
});

const hash = await kaurax.sendTransaction(signed);
const receipt = await kaurax.waitForTransaction(hash);
```

## Subscriptions

```ts
const unsubscribe = kaurax.subscribeBlocks(
  (block) => console.log(block.number, block.hash),
  (err) => console.error(err),
);
// later
unsubscribe();
```

## KAURAX-specific state

```ts
const status = await kaurax.getNetworkStatus();

status.l1;                                  // null when unavailable — never a fake number
status.l2?.blockNumber;
status.l3.blockNumber;
status.settlement.lastBatch;                // null until this node has submitted one
status.settlement.latestOutputRoot;
status.settlement.faultProofs;              // {implemented: false, status: "not-implemented"}
status.sequencer.decentralized;             // always false in v0

await kaurax.getSequencerStatus();
await kaurax.getBatcherStatus();
await kaurax.getSettlementStatus();
await kaurax.getNetworkDescriptor();        // wallet_addEthereumChain parameters

// Has this block's data reached the L2 yet?
await kaurax.isBlockSettled(receipt.blockNumber);  // true | false | null
```

### `null` means "unknown", never "zero"

Any field that could not be read is `null`. Render that as *No data available*. The SDK
never substitutes a plausible value.

## Bridge

```ts
import {buildDeposit, buildWithdrawal, getWithdrawalStatus, listWithdrawals, PREDEPLOYS}
  from "@kaurax/sdk";

// Send this on the L2:
const deposit = buildDeposit({portal, recipient, amount: parseEther("1")});

// Send this on KAURAX:
const withdrawal = buildWithdrawal({recipient, amount: parseEther("0.5")});

// Then track it:
const stage = await getWithdrawalStatus(kaurax, withdrawalHash);
switch (stage.stage) {
  case "provable":              stage.proof; break;   // ready for the L2 portal
  case "awaiting-output-root":  stage.reason; break;  // no root covers it yet
  case "unknown":               stage.reason; break;
}
```

The node builds the Merkle proof and **verifies it locally against the committed root**
before returning it. A proof you receive will verify on chain, or you receive an explanation
instead.

## Errors

```ts
import {KauraxRpcError} from "@kaurax/sdk";

try { await kaurax.sendTransaction(signed); }
catch (err) {
  if (err instanceof KauraxRpcError) console.error(err.code, err.message);
}
```

## Examples

`packages/sdk/examples/` — `01-connect.ts`, `02-send.ts`, `03-subscribe.ts`.
