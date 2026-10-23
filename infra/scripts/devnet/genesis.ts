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

function encodeUint(value: bigint | number): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

/**
 * ABI-encode `(address[] owners, uint256 threshold)` for the treasury constructor.
 *
 * Hand-rolled because genesis deliberately has no dependency on viem or ethers: it runs
 * before anything is built, against a bare engine. A dynamic array is a head offset
 * followed by a length and the elements.
 */
function encodeMultisigArgs(owners: string[], threshold: number): string {
  const head = encodeUint(64) + encodeUint(threshold);
  const tail = encodeUint(owners.length) + owners.map(encodeAddressArg).join("");
  return head + tail;
}

/**
 * Poll for a receipt, mining if the engine is not doing it for us.
 *
 * Genesis runs against an engine that may or may not be automining, depending on whether
 * kaurax-node has attached yet. Asking it to mine is harmless when it already does.
 */
async function waitForReceipt(
  engineUrl: string,
  hash: Hex,
  attempts = 40,
): Promise<{contractAddress: Hex; status: Hex} | null> {
  for (let i = 0; i < attempts; i++) {
    const receipt = await rpc<{contractAddress: Hex; status: Hex} | null>(
      engineUrl,
      "eth_getTransactionReceipt",
      [hash],
    );
    if (receipt) return receipt;
    await rpc(engineUrl, "evm_mine", []).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
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

  // Wait for the receipt instead of assuming one exists.
  //
  // Reading it immediately only works while the engine is automining. kaurax-node turns
  // automine off as soon as it attaches, so whether genesis succeeded came down to which
  // happened first — and on a CI runner the node usually won. A pending transaction returns
  // a null receipt, which this code then reported as "deployment reverted": the wrong
  // diagnosis for a transaction that had not been mined at all.
  //
  // Mining explicitly makes genesis independent of that race rather than lucky.
  const receipt = await waitForReceipt(engineUrl, deployTx);
  if (!receipt) {
    throw new Error(
      `KauraxL3ERC20Bridge deployment ${deployTx} was never mined. The engine may have ` +
        `automine disabled and be refusing evm_mine.`,
    );
  }
  if (receipt.status !== "0x1") {
    throw new Error("KauraxL3ERC20Bridge deployment reverted during genesis");
  }

  const runtime = await rpc<Hex>(engineUrl, "eth_getCode", [receipt.contractAddress, "latest"]);
  await rpc(engineUrl, "anvil_setCode", [L3_ERC20_BRIDGE, runtime]);
  // Remove the staging copy so there is exactly one L3 bridge.
  await rpc(engineUrl, "anvil_setCode", [receipt.contractAddress, "0x"]);
  console.log(
    `[genesis] KauraxL3ERC20Bridge installed at ${L3_ERC20_BRIDGE} (counterpart ${l2BridgeAddress})`,
  );

  // ---- 4. Treasury ------------------------------------------------------------
  // A KauraxMultisig that receives the priority component of KAURAX gas fees.
  //
  // Deployed here, before kaurax-node starts, for one reason: the node reads
  // KAURAX_FEE_RECIPIENT once at startup and sets the engine coinbase from it. A treasury
  // deployed later would leave every block until then crediting somewhere else, and the
  // accounting in docs/PROTOCOL_FEES.md would start partway through the run.
  //
  // NOT relocated to a predeploy address, unlike the bridge above. The multisig keeps its
  // owner set and threshold in STORAGE, not in immutables, so copying runtime code to a
  // fixed address would install a treasury with no owners and no threshold — one that can
  // receive fees and can never spend them. It keeps its natural deployment address and
  // start.sh writes that address into .env.
  //
  // Fees arrive as a coinbase credit, which is a balance change rather than a call, so
  // the treasury's receive() never runs and no Deposit event is emitted for fee income.
  // That is verified in blockchain/contracts/test/Treasury.t.sol and stated in
  // docs/TREASURY_POLICY.md, because an indexer watching Deposit would report zero.
  const owners = (process.env.KAURAX_TREASURY_OWNERS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const threshold = Number(process.env.KAURAX_TREASURY_THRESHOLD ?? "2");

  if (owners.length === 0) {
    throw new Error(
      "KAURAX_TREASURY_OWNERS is not set. The treasury holds protocol fees and must not " +
        "be deployed without an owner set; a multisig with no owners can never spend.",
    );
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(
      `KAURAX_TREASURY_THRESHOLD must be between 1 and ${owners.length} (got "${threshold}")`,
    );
  }
  for (const owner of owners) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
      throw new Error(`KAURAX_TREASURY_OWNERS contains "${owner}", which is not an address`);
    }
  }

  const multisig = artifact("KauraxMultisig.sol/KauraxMultisig.json");
  const treasuryTx = await rpc<Hex>(engineUrl, "eth_sendTransaction", [
    {
      from: deployer,
      data: multisig.bytecode.object + encodeMultisigArgs(owners, threshold),
      gas: "0x7a1200",
    },
  ]);
  const treasuryReceipt = await waitForReceipt(engineUrl, treasuryTx);
  if (!treasuryReceipt) throw new Error(`treasury deployment ${treasuryTx} was never mined`);
  if (treasuryReceipt.status !== "0x1") throw new Error("treasury deployment reverted during genesis");

  const treasury = treasuryReceipt.contractAddress;

  // Confirm the constructor actually took: a treasury whose threshold read back as 0
  // would accept fees and never release them.
  const onChainThreshold = BigInt(
    await rpc<Hex>(engineUrl, "eth_call", [{to: treasury, data: "0x42cde4e8"}, "latest"]), // threshold()
  );
  if (onChainThreshold !== BigInt(threshold)) {
    throw new Error(
      `treasury deployed at ${treasury} reports threshold ${onChainThreshold}, expected ${threshold}`,
    );
  }
  console.log(
    `[genesis] treasury (KauraxMultisig ${threshold}-of-${owners.length}) deployed at ${treasury}`,
  );

  // ---- 5. Verify --------------------------------------------------------------
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
  console.log(`KAURAX_TREASURY_ADDRESS=${treasury}`);
}

main().catch((err: Error) => {
  console.error(`[genesis] FAILED: ${err.message}`);
  process.exit(1);
});
