#!/usr/bin/env tsx
/**
 * KAURAX L3 genesis.
 *
 * Installs the KAURAX predeploys and the genesis allocation into the execution engine
 * before the node starts sequencing. On a production OP Stack deployment this same state
 * is baked into `genesis.json` and loaded by `op-geth`; on the devnet it is applied to a
 * running engine, which produces the identical starting state.
 *
 * Nothing here is mocked: the bytecode installed is the compiled output of
 * blockchain/contracts/src/L3, and the balances are the documented devnet allocation.
 */
import {readFileSync, existsSync} from "node:fs";
import {dirname, resolve} from "node:path";

/** Walk upward to the repository root so this file can be moved without breaking. */
function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the KAURAX repository root");
}
const ROOT = findRepoRoot(import.meta.dirname);
const OUT = resolve(ROOT, "blockchain/contracts/out");

const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const L3_ERC20_BRIDGE = "0x4200000000000000000000000000000000000010";

type Hex = `0x${string}`;

interface Alloc {
  alloc: Record<string, {balance: string; label?: string}>;
}

let rpcId = 1;
async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: rpcId++, method, params}),
  });
  const body = (await res.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

function artifact(path: string): {abi: unknown[]; bytecode: {object: Hex}; deployedBytecode: {object: Hex}} {
  const p = resolve(OUT, path);
  if (!existsSync(p)) {
    throw new Error(`Missing contract artifact ${p}. Run "forge build" in blockchain/contracts/ first.`);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function encodeAddressArg(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function main(): Promise<void> {
  const engineUrl = process.env.KAURAX_ENGINE_RPC_URL ?? "http://127.0.0.1:18420";
  const l2BridgeAddress = process.env.KAURAX_L2_BRIDGE_ADDRESS;
  const allocPath = resolve(ROOT, "blockchain/chain/genesis/devnet.alloc.json");

  if (!l2BridgeAddress) {
    throw new Error(
      "KAURAX_L2_BRIDGE_ADDRESS is not set. Deploy the settlement contracts to the L2 first — " +
        "the L3 bridge needs to know its counterpart at construction.",
    );
  }

  const chainId = Number(BigInt(await rpc<Hex>(engineUrl, "eth_chainId")));
  console.log(`[genesis] engine at ${engineUrl}, chain id ${chainId}`);

  // Genesis writes need blocks to be mined immediately; sequencing takes over afterwards.
  await rpc(engineUrl, "evm_setAutomine", [true]);

  // ---- 1. Genesis allocation -------------------------------------------------
  const alloc = JSON.parse(readFileSync(allocPath, "utf8")) as Alloc;
  for (const [address, entry] of Object.entries(alloc.alloc)) {
    const wei = BigInt(entry.balance);
    await rpc(engineUrl, "anvil_setBalance", [address, `0x${wei.toString(16)}`]);
    console.log(`[genesis] funded ${address} with ${wei / 10n ** 18n} KAX  (${entry.label ?? ""})`);
  }

  // ---- 2. L3ToL2MessagePasser -----------------------------------------------
  // No constructor arguments and no immutables, so the compiled runtime code can be
  // installed directly at the predeploy address.
  const passer = artifact("L3ToL2MessagePasser.sol/L3ToL2MessagePasser.json");
  await rpc(engineUrl, "anvil_setCode", [MESSAGE_PASSER, passer.deployedBytecode.object]);
  const passerCode = await rpc<Hex>(engineUrl, "eth_getCode", [MESSAGE_PASSER, "latest"]);
  if (passerCode.length <= 2) throw new Error("L3ToL2MessagePasser predeploy installation failed");
  console.log(`[genesis] L3ToL2MessagePasser installed at ${MESSAGE_PASSER}`);

  // ---- 3. KauraxL3ERC20Bridge ------------------------------------------------
  // This one has immutables (message passer, counterpart bridge, and the counterpart's
  // aliased form), which are baked into runtime code at construction. So it is deployed
  // normally and then relocated to its predeploy address.
  const bridge = artifact("KauraxL3ERC20Bridge.sol/KauraxL3ERC20Bridge.json");
  const deployer = (await rpc<string[]>(engineUrl, "eth_accounts"))[0];
  if (!deployer) throw new Error("engine exposes no accounts to deploy from");

  const initCode =
    bridge.bytecode.object + encodeAddressArg(MESSAGE_PASSER) + encodeAddressArg(l2BridgeAddress);

  const deployTx = await rpc<Hex>(engineUrl, "eth_sendTransaction", [
    {from: deployer, data: initCode, gas: "0x7a1200"},
  ]);
  const receipt = await rpc<{contractAddress: Hex; status: Hex}>(engineUrl, "eth_getTransactionReceipt", [
    deployTx,
  ]);
  if (!receipt || receipt.status !== "0x1") {
    throw new Error("KauraxL3ERC20Bridge deployment reverted during genesis");
  }

  const runtime = await rpc<Hex>(engineUrl, "eth_getCode", [receipt.contractAddress, "latest"]);
  await rpc(engineUrl, "anvil_setCode", [L3_ERC20_BRIDGE, runtime]);
  // Remove the staging copy so there is exactly one L3 bridge.
  await rpc(engineUrl, "anvil_setCode", [receipt.contractAddress, "0x"]);
  console.log(
    `[genesis] KauraxL3ERC20Bridge installed at ${L3_ERC20_BRIDGE} (counterpart ${l2BridgeAddress})`,
  );

  // ---- 4. Verify --------------------------------------------------------------
  const treeRoot = await rpc<Hex>(engineUrl, "eth_call", [
    {to: MESSAGE_PASSER, data: "0x365fc5a8"}, // withdrawalTreeRoot()
    "latest",
  ]);
  console.log(`[genesis] initial withdrawal tree root ${treeRoot}`);

  await rpc(engineUrl, "evm_setAutomine", [false]);
  const height = Number(BigInt(await rpc<Hex>(engineUrl, "eth_blockNumber")));
  console.log(`[genesis] complete at L3 block ${height}`);

  // Emitted for start.sh to capture.
  console.log(`KAURAX_GENESIS_BLOCK=${height}`);
}

main().catch((err: Error) => {
  console.error(`[genesis] FAILED: ${err.message}`);
  process.exit(1);
});
