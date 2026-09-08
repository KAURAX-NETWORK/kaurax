/**
 * Deploy a contract to KAURAX and call it. No framework, no build step of its own.
 *
 *   cd blockchain/contracts && forge build      # produces the artifact this reads
 *   node examples/hello-world/deploy.mjs
 *
 * The contract is blockchain/contracts/src/examples/HelloKaurax.sol — the repository's own,
 * not a copy. An example that carried its own near-identical contract would be a second
 * thing to keep correct, and the first one to drift.
 *
 * Environment:
 *   KAURAX_RPC_URL   default http://127.0.0.1:8420  (public testnet: https://kaurax.network/rpc)
 *   PRIVATE_KEY      default devnet account 3 — a published Foundry key, worthless, never reuse
 */
import {createPublicClient, createWalletClient, defineChain, http, parseAbi} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const RPC = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";
const KEY =
  process.env.PRIVATE_KEY ?? "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

const kaurax = defineChain({
  id: Number(process.env.KAURAX_CHAIN_ID ?? 8420),
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactPath = resolve(repo, "blockchain/contracts/out/HelloKaurax.sol/HelloKaurax.json");

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch {
  console.error(`no artifact at ${artifactPath}\n  build it first:  cd blockchain/contracts && forge build`);
  process.exit(1);
}

const abi = parseAbi([
  "function greeting() view returns (string)",
  "function greetCount() view returns (uint256)",
  "function lastCaller() view returns (address)",
  "function chainId() view returns (uint256)",
  "function greet() returns (string)",
  "function setGreeting(string _greeting)",
]);

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({chain: kaurax, transport: http(RPC)});
const wallet = createWalletClient({account, chain: kaurax, transport: http(RPC)});

const chainId = await pub.getChainId();
if (chainId !== kaurax.id) {
  console.error(`the node at ${RPC} reports chain ${chainId}, expected ${kaurax.id}`);
  process.exit(1);
}

const balance = await pub.getBalance({address: account.address});
if (balance === 0n) {
  const api = process.env.KAURAX_API_URL ?? "https://kaurax.network";
  console.error(
    `${account.address} has no KAX.\n` +
      `  curl -s -X POST ${api}/api/faucet -H 'content-type: application/json' \\\n` +
      `    -d '{"address":"${account.address}"}'`,
  );
  process.exit(1);
}

console.log(`chain ${chainId} at ${RPC}`);
console.log(`from  ${account.address}  ${balance / 10n ** 18n} KAX\n`);

const hash = await wallet.deployContract({abi, bytecode: artifact.bytecode.object, args: []});
const {contractAddress, gasUsed} = await pub.waitForTransactionReceipt({hash});
console.log(`deployed   ${contractAddress}  (gas ${gasUsed})`);

const read = (functionName) => pub.readContract({address: contractAddress, abi, functionName});
console.log(`greeting   ${await read("greeting")}`);
console.log(`chainId()  ${await read("chainId")}`);

const tx = await wallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "setGreeting",
  args: ["Hello from examples/hello-world"],
});
const r = await pub.waitForTransactionReceipt({hash: tx});
console.log(`setGreeting  block ${r.blockNumber}, gas ${r.gasUsed}`);
console.log(`greeting   ${await read("greeting")}`);

const explorer = process.env.KAURAX_EXPLORER_URL ?? "https://kaurax.network/explorer";
console.log(`\nview it:   ${explorer}/address/${contractAddress}`);
