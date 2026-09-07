/**
 * Sign a KAX transfer with viem and submit it through the KAURAX SDK.
 * The SDK never holds your key — you sign, it submits.
 */
import {createWalletClient, defineChain, http, parseEther} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {connect} from "../src/index.js";

const rpcUrl = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";
const kaurax = await connect({rpcUrl});
const chainId = await kaurax.getChainId();

const key = process.env.KAURAX_PRIVATE_KEY;
if (!key) throw new Error("export KAURAX_PRIVATE_KEY=0x... (never commit it)");

const account = privateKeyToAccount(key as `0x${string}`);
const chain = defineChain({
  id: chainId,
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [rpcUrl]}},
});

const wallet = createWalletClient({account, chain, transport: http(rpcUrl)});
const signed = await wallet.signTransaction({
  to: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  value: parseEther("0.01"),
  chainId,
  nonce: await kaurax.getTransactionCount(account.address, "pending"),
  gas: 21_000n,
  maxFeePerGas: (await kaurax.getGasPrice()) * 2n,
  maxPriorityFeePerGas: 1_000_000n,
});

const hash = await kaurax.sendTransaction(signed);
console.log("submitted", hash);

const receipt = await kaurax.waitForTransaction(hash);
console.log("included in block", receipt.blockNumber.toString(), receipt.status);
console.log("settled to L2?   ", await kaurax.isBlockSettled(receipt.blockNumber));
