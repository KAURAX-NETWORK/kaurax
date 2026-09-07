/**
 * Connect to KAURAX and read the three-layer status.
 *   pnpm --filter @kaurax/sdk build && npx tsx packages/sdk/examples/01-connect.ts
 */
import {connect} from "../src/index.js";

const kaurax = await connect({
  rpcUrl: process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
  wsUrl: process.env.KAURAX_WS_URL ?? "ws://127.0.0.1:8421",
});

console.log("chain id       ", await kaurax.getChainId());
console.log("head block     ", (await kaurax.getBlockNumber()).toString());
console.log("gas price      ", (await kaurax.getGasPrice()).toString(), "wei");

const status = await kaurax.getNetworkStatus();
console.log("\nEthereum (L1)  ", status.l1 ? status.l1.latestBlockNumber : "No data available");
console.log("underlying L2  ", status.l2 ? `${status.l2.name} @ ${status.l2.blockNumber}` : "No data available");
console.log("KAURAX (L3)    ", status.l3.blockNumber);
console.log("\nlast batch     ", status.settlement.lastBatch?.l2TxHash ?? "No data available");
console.log("latest output  ", status.settlement.latestOutputRoot?.outputRoot ?? "No data available");
console.log("fault proofs   ", status.settlement.faultProofs.status);
