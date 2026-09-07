# Developer Guide

KAURAX is EVM-equivalent. If your tooling speaks Ethereum, it already speaks KAURAX —
change the RPC URL and the chain ID, and nothing else.

## Quickstart

```bash
git clone <repo> && cd kaurax
pnpm install
./infra/scripts/devnet/start.sh
```

That brings up an L1, an L2, the KAURAX settlement contracts on the L2, KAURAX itself, and
prints the network parameters. Then:

```bash
cd blockchain/contracts
forge build
forge test
forge script script/DeployExamples.s.sol:DeployExamples \
  --rpc-url http://127.0.0.1:8420 --broadcast
```

## Network parameters (devnet)

| | |
|---|---|
| Network name | KAURAX Devnet |
| RPC URL | `http://127.0.0.1:8420` |
| WebSocket | `ws://127.0.0.1:8421` |
| Chain ID | `8420` |
| Currency symbol | `KAX` |
| Explorer | `http://127.0.0.1:3000` |

All configurable — see `.env.example`. `kaurax wallet add` prints these plus the exact
`wallet_addEthereumChain` parameters.

**KAX is a testnet gas asset with no monetary value.**

## Environment variables

Every tool in this repo reads the same three:

```bash
export KAURAX_RPC_URL=http://127.0.0.1:8420
export KAURAX_CHAIN_ID=8420
export KAURAX_PRIVATE_KEY=0x...   # export at the shell; never commit
```

## Foundry

`blockchain/contracts/foundry.toml` already defines the endpoints:

```bash
forge build
forge test -vvv
forge create src/examples/Counter.sol:Counter \
  --rpc-url $KAURAX_RPC_URL --private-key $KAURAX_PRIVATE_KEY --broadcast

cast chain-id       --rpc-url $KAURAX_RPC_URL
cast block-number   --rpc-url $KAURAX_RPC_URL
cast balance <addr> --rpc-url $KAURAX_RPC_URL
cast send <addr> "increment()" --rpc-url $KAURAX_RPC_URL --private-key $KAURAX_PRIVATE_KEY
```

## Hardhat

`blockchain/contracts/hardhat.config.ts` is included. From `contracts/`:

```bash
npx hardhat compile
npx hardhat run scripts/deploy.ts --network kaurax
```

## viem

```ts
import {createPublicClient, defineChain, http} from "viem";

export const kaurax = defineChain({
  id: Number(process.env.KAURAX_CHAIN_ID),
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [process.env.KAURAX_RPC_URL!]}},
});

const client = createPublicClient({chain: kaurax, transport: http()});
```

## ethers

```ts
import {JsonRpcProvider} from "ethers";
const provider = new JsonRpcProvider(process.env.KAURAX_RPC_URL, {
  chainId: Number(process.env.KAURAX_CHAIN_ID),
  name: "kaurax",
});
```

## The KAURAX SDK

Use it for what standard Ethereum RPC cannot express — settlement state and bridge
progress. See [`sdk.md`](./sdk.md).

```bash
pnpm add @kaurax/sdk
```

```ts
import {connect} from "@kaurax/sdk";
const kaurax = await connect({rpcUrl: process.env.KAURAX_RPC_URL!});

const status = await kaurax.getNetworkStatus();
const settled = await kaurax.isBlockSettled(receipt.blockNumber);
```

## Supported JSON-RPC

Standard: `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_getCode`,
`eth_getStorageAt`, `eth_getProof`, `eth_call`, `eth_estimateGas`, `eth_gasPrice`,
`eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_sendRawTransaction`,
`eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getTransactionCount`,
`eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getBlockReceipts`, `eth_getLogs`,
filters, `eth_subscribe` / `eth_unsubscribe` over WebSocket, `net_version`,
`web3_clientVersion`, `web3_sha3`.

KAURAX-specific: `kaurax_networkStatus`, `kaurax_sequencerStatus`, `kaurax_batcherStatus`,
`kaurax_proposerStatus`, `kaurax_derivationStatus`, `kaurax_settlementStatus`,
`kaurax_networkDescriptor`, `kaurax_withdrawalProof`, `kaurax_listWithdrawals`.

Deliberately **not** exposed: `anvil_*`, `evm_*`, `hardhat_*`, `debug_*`, `admin_*`,
`miner_*`, `personal_*`, `txpool_*`, `engine_*`. `eth_accounts` returns `[]`.

## Gas

KAX pays for gas. EIP-1559 applies: `baseFeePerGas` plus a priority fee.

**Known gap:** the chain config defines an L1/L2 data-fee policy, but the devnet execution
engine does not charge it on chain. KAURAX therefore under-charges relative to what the
batcher actually spends posting data to the L2. See
[`data-availability.md`](./data-availability.md#cost).

## Differences from Ethereum you should know about

1. **Blocks are produced on a fixed interval** by a single sequencer, including empty ones.
2. **Deposits appear as transactions you did not send.** They come from the L2.
3. **`block.chainid` is `KAURAX_CHAIN_ID`.** Do not hardcode it.
4. **Withdrawals are not transfers.** They are a three-step protocol —
   see [`bridge.md`](./bridge.md).
5. **There is no address index.** The explorer scans recent blocks; it is not a complete
   historical index, and it says so.
6. **There are no fault proofs.** State commitments are trusted.

## Example contracts

`blockchain/contracts/src/examples/`: `HelloKaurax`, `Counter`, `SimpleStorage`, `KauraxToken`.
`KauraxToken` is an example ERC-20 — it is **not** KAX, which is the native currency and
not a token contract.
