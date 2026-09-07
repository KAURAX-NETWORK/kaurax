/**
 * @kaurax/sdk — typed client for the KAURAX Ethereum Layer-3.
 *
 * KAURAX is EVM-equivalent, so anything that speaks Ethereum JSON-RPC already works
 * against it: viem, ethers, web3.js, MetaMask. This SDK exists for the parts that are not
 * Ethereum — where a transaction sits in the settlement pipeline, which batch carried it
 * to the underlying L2, and what is needed to move assets across the bridge.
 *
 * Design rule: a method returns `null` when a value is genuinely unknown. It never
 * substitutes a zero or a plausible placeholder.
 *
 *   import {connect} from "@kaurax/sdk";
 *
 *   const kaurax = await connect({rpcUrl: "http://127.0.0.1:8420"});
 *   const status = await kaurax.getNetworkStatus();
 *   console.log(status.settlement.lastBatch);
 */
export * from "./client.js";
export * from "./types.js";
export * from "./bridge.js";
export * from "./accountAbstraction.js";
