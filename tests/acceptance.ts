#!/usr/bin/env tsx
/**
 * KAURAX end-to-end acceptance test.
 *
 * Exercises the complete path the architecture claims to support:
 *
 *   Ethereum (L1) -> underlying L2 -> KAURAX (L3)
 *
 *   connect wallet
 *        -> receive KAX by depositing on the L2 and having it derived onto KAURAX
 *        -> send KAX on KAURAX
 *        -> transaction enters the sequencer
 *        -> L3 block produced
 *        -> transaction readable over JSON-RPC (what the explorer indexes)
 *        -> deploy and call a Solidity contract
 *        -> batch generated and submitted to the L2
 *        -> batch data recovered from L2 calldata (data availability actually works)
 *        -> output root proposed to the L2
 *        -> withdraw from KAURAX, prove against the output root, finalize on the L2
 *
 * Every assertion reads real chain state. Nothing is asserted about a value this test did
 * not observe.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {readFileSync, existsSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {config as loadDotenv} from "dotenv";
import {decodeBatch} from "@kaurax/l3";

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
loadDotenv({path: resolve(ROOT, ".env")});

// ---------------------------------------------------------------- harness --
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function step(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}PASS${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ${RED}FAIL${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
  }
}

function info(text: string): void {
  console.log(`  ${DIM}${text}${RESET}`);
}

async function until<T>(
  what: string,
  fn: () => Promise<T | null>,
  timeoutMs = 120_000,
  intervalMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${what}${lastErr ? ` (last error: ${lastErr})` : ""}`);
}

// --------------------------------------------------------------- env setup --
function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set. Run infra/scripts/devnet/start.sh first.`);
  return v;
}

const L3_RPC = need("KAURAX_RPC_URL");
const L2_RPC = need("L2_RPC_URL");
const L3_CHAIN_ID = Number(need("KAURAX_CHAIN_ID"));
const L2_CHAIN_ID = Number(need("L2_CHAIN_ID"));
const PORTAL = need("KAURAX_PORTAL_ADDRESS") as Hex;
const INBOX = need("KAURAX_BATCH_INBOX_ADDRESS") as Hex;
const ORACLE = need("KAURAX_OUTPUT_ORACLE_ADDRESS") as Hex;
const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016" as Hex;

/** Devnet account 3, a documented public Anvil key. Never used outside a devnet. */
const USER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const user = privateKeyToAccount(USER_KEY);
const RECIPIENT = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Hex;

const kaurax = defineChain({
  id: L3_CHAIN_ID,
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [L3_RPC]}},
});
const l2 = defineChain({
  id: L2_CHAIN_ID,
  name: "underlying-l2",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: [L2_RPC]}},
});

const l3Public = createPublicClient({chain: kaurax, transport: http(L3_RPC)});
const l3Wallet = createWalletClient({account: user, chain: kaurax, transport: http(L3_RPC)});
const l2Public = createPublicClient({chain: l2, transport: http(L2_RPC)});
const l2Wallet = createWalletClient({account: user, chain: l2, transport: http(L2_RPC)});

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  const body = (await res.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

function abi(path: string): unknown[] {
  const p = resolve(ROOT, "blockchain/contracts/out", path);
  if (!existsSync(p)) throw new Error(`missing artifact ${p}; run forge build`);
  return JSON.parse(readFileSync(p, "utf8")).abi;
}

function artifact(path: string): {abi: unknown[]; bytecode: {object: Hex}} {
  const p = resolve(ROOT, "blockchain/contracts/out", path);
  return JSON.parse(readFileSync(p, "utf8"));
}

const portalAbi = abi("KauraxPortal.sol/KauraxPortal.json");
const inboxAbi = abi("KauraxBatchInbox.sol/KauraxBatchInbox.json");
const oracleAbi = abi("KauraxL2OutputOracle.sol/KauraxL2OutputOracle.json");
const passerAbi = abi("L3ToL2MessagePasser.sol/L3ToL2MessagePasser.json");

// ------------------------------------------------------------------- main --
async function main(): Promise<void> {
  console.log(`${BOLD}KAURAX acceptance test${RESET}`);
  console.log(`${DIM}Ethereum (L1) -> underlying L2 (${L2_CHAIN_ID}) -> KAURAX L3 (${L3_CHAIN_ID})${RESET}`);

  // ---------------------------------------------------------------------- //
  step("1. Wallet connects to KAURAX");
  const chainId = await l3Public.getChainId();
  check("eth_chainId matches the configured KAURAX chain ID", chainId === L3_CHAIN_ID, `${chainId}`);

  const descriptor = await rpc<{chainId: string; nativeCurrency: {symbol: string}}>(
    L3_RPC,
    "kaurax_networkDescriptor",
  );
  check(
    "wallet network descriptor is served",
    descriptor.nativeCurrency.symbol === "KAX" && descriptor.chainId === `0x${L3_CHAIN_ID.toString(16)}`,
    `${descriptor.chainId} ${descriptor.nativeCurrency.symbol}`,
  );

  step("2. Standard Ethereum JSON-RPC surface");
  const rpcChecks: Array<[string, () => Promise<unknown>]> = [
    ["eth_blockNumber", () => rpc(L3_RPC, "eth_blockNumber")],
    ["eth_getBalance", () => rpc(L3_RPC, "eth_getBalance", [user.address, "latest"])],
    ["eth_gasPrice", () => rpc(L3_RPC, "eth_gasPrice")],
    ["eth_getBlockByNumber", () => rpc(L3_RPC, "eth_getBlockByNumber", ["latest", false])],
    ["eth_call", () => rpc(L3_RPC, "eth_call", [{to: MESSAGE_PASSER, data: "0x365fc5a8"}, "latest"])],
    ["eth_estimateGas", () => rpc(L3_RPC, "eth_estimateGas", [{from: user.address, to: RECIPIENT, value: "0x1"}])],
    ["eth_getLogs", () => rpc(L3_RPC, "eth_getLogs", [{fromBlock: "0x0", toBlock: "latest", address: MESSAGE_PASSER}])],
    ["eth_getTransactionCount", () => rpc(L3_RPC, "eth_getTransactionCount", [user.address, "latest"])],
    ["eth_getCode", () => rpc(L3_RPC, "eth_getCode", [MESSAGE_PASSER, "latest"])],
    ["net_version", () => rpc(L3_RPC, "net_version")],
    ["web3_clientVersion", () => rpc(L3_RPC, "web3_clientVersion")],
  ];
  for (const [method, call] of rpcChecks) {
    try {
      const r = await call();
      check(method, r !== undefined && r !== null);
    } catch (err) {
      check(method, false, (err as Error).message);
    }
  }

  step("3. Administrative RPC namespaces are not reachable publicly");
  for (const method of ["anvil_setBalance", "evm_mine", "debug_traceTransaction", "hardhat_impersonateAccount"]) {
    let blocked = false;
    try {
      await rpc(L3_RPC, method, []);
    } catch {
      blocked = true;
    }
    check(`${method} is rejected`, blocked);
  }

  // ---------------------------------------------------------------------- //
  step("4. Receive KAX by depositing through the canonical bridge on the L2");
  const balanceBefore = await l3Public.getBalance({address: user.address});
  info(`KAURAX balance before: ${formatEther(balanceBefore)} KAX`);

  const depositAmount = parseEther("2.5");
  const depositTx = await l2Wallet.writeContract({
    address: PORTAL,
    abi: portalAbi,
    functionName: "depositTransaction",
    args: [user.address, depositAmount, 21000n, false, "0x"],
    value: depositAmount,
  });
  const depositReceipt = await l2Public.waitForTransactionReceipt({hash: depositTx});
  check("deposit accepted by KauraxPortal on the L2", depositReceipt.status === "success", depositTx);

  const portalEscrow = await l2Public.getBalance({address: PORTAL});
  check("value is escrowed by the portal", portalEscrow >= depositAmount, `${formatEther(portalEscrow)} on L2`);

  const balanceAfter = await until(
    "the deposit to be derived onto KAURAX",
    async () => {
      const b = await l3Public.getBalance({address: user.address});
      return b > balanceBefore ? b : null;
    },
    90_000,
  );
  check(
    "KAX credited on KAURAX by the derivation pipeline",
    balanceAfter - balanceBefore >= depositAmount,
    `+${formatEther(balanceAfter - balanceBefore)} KAX`,
  );

  const derivation = await rpc<{derivedTotal: number}>(L3_RPC, "kaurax_derivationStatus");
  check("derivation reports the deposit", derivation.derivedTotal >= 1, `${derivation.derivedTotal} derived`);

  // ---------------------------------------------------------------------- //
  step("5. Send KAX on KAURAX");
  const recipientBefore = await l3Public.getBalance({address: RECIPIENT});
  const sendAmount = parseEther("0.75");

  const poolBefore = (await rpc<{mempoolSize: number}>(L3_RPC, "kaurax_sequencerStatus")).mempoolSize;
  const sendTx = await l3Wallet.sendTransaction({to: RECIPIENT, value: sendAmount});
  check("eth_sendRawTransaction accepted into the sequencer's mempool", Boolean(sendTx), sendTx);
  void poolBefore;

  const sendReceipt = await l3Public.waitForTransactionReceipt({hash: sendTx, timeout: 60_000});
  check("transaction included in an L3 block", sendReceipt.status === "success", `block ${sendReceipt.blockNumber}`);

  const recipientAfter = await l3Public.getBalance({address: RECIPIENT});
  check("recipient balance increased by the sent amount", recipientAfter - recipientBefore === sendAmount);

  const fetched = await l3Public.getTransaction({hash: sendTx});
  check("transaction is queryable by hash (what the explorer indexes)", fetched.hash === sendTx);

  const block = await l3Public.getBlock({blockNumber: sendReceipt.blockNumber, includeTransactions: false});
  check("block containing the transaction is queryable", block.transactions.includes(sendTx));

  const sendBlock = sendReceipt.blockNumber;

  // ---------------------------------------------------------------------- //
  step("6. Deploy and call a Solidity contract");
  const hello = artifact("HelloKaurax.sol/HelloKaurax.json");
  const deployHash = await l3Wallet.deployContract({
    abi: hello.abi as never,
    bytecode: hello.bytecode.object,
    args: [],
  });
  const deployReceipt = await l3Public.waitForTransactionReceipt({hash: deployHash, timeout: 60_000});
  check("contract deployed on KAURAX", deployReceipt.status === "success" && Boolean(deployReceipt.contractAddress));

  const helloAddress = deployReceipt.contractAddress!;
  const reportedChainId = await l3Public.readContract({
    address: helloAddress,
    abi: hello.abi as never,
    functionName: "chainId",
  });
  check(
    "contract observes the KAURAX chain ID via block.chainid",
    reportedChainId === BigInt(L3_CHAIN_ID),
    `${reportedChainId}`,
  );

  const greetHash = await l3Wallet.writeContract({
    address: helloAddress,
    abi: hello.abi as never,
    functionName: "greet",
    args: [],
  });
  const greetReceipt = await l3Public.waitForTransactionReceipt({hash: greetHash, timeout: 60_000});
  check("contract call executed and emitted a log", greetReceipt.logs.length > 0);

  // ---------------------------------------------------------------------- //
  step("7. Batch generated and submitted to the underlying L2");
  const batch = await until(
    `a batch covering L3 block ${sendBlock}`,
    async () => {
      const last = await l2Public.readContract({address: INBOX, abi: inboxAbi, functionName: "lastBatchL3Block"});
      return (last as bigint) >= sendBlock ? last : null;
    },
    120_000,
  );
  check("batch inbox on the L2 covers the transaction's block", (batch as bigint) >= sendBlock, `up to L3 block ${batch}`);

  const batchLogs = await l2Public.getLogs({address: INBOX, fromBlock: 0n, toBlock: "latest"});
  check("BatchSubmitted events are present on the L2", batchLogs.length > 0, `${batchLogs.length} batches`);

  // ---------------------------------------------------------------------- //
  step("8. Data availability: recover the transaction from L2 calldata");
  // This is the check that decides whether KAURAX has real data availability: take only
  // what is on the L2, and rebuild the transaction from it.
  let coveringL2Tx: Hex | null = null;
  let recoveredTxHashes: Hex[] = [];

  for (const entry of batchLogs) {
    const decoded = decodeEventLog({abi: inboxAbi as never, topics: entry.topics, data: entry.data}) as {
      eventName: string;
      args: {l3StartBlock: bigint; l3EndBlock: bigint; dataCommitment: Hex};
    };
    if (decoded.eventName !== "BatchSubmitted") continue;
    if (sendBlock < decoded.args.l3StartBlock || sendBlock > decoded.args.l3EndBlock) continue;

    const l2Tx = await l2Public.getTransaction({hash: entry.transactionHash!});
    const call = decodeFunctionData({abi: inboxAbi as never, data: l2Tx.input}) as {
      functionName: string;
      args: readonly [bigint, bigint, Hex];
    };
    check("batch L2 transaction calls submitBatch", call.functionName === "submitBatch");

    const payloadHex = call.args[2];
    const payload = Buffer.from(payloadHex.slice(2), "hex");

    check(
      "on-chain commitment matches the published bytes",
      keccak256(payloadHex).toLowerCase() === decoded.args.dataCommitment.toLowerCase(),
    );
    check("batch payload carries the KAURAX format version", payload[0] === 0, `version ${payload[0]}`);

    const blocks = decodeBatch(new Uint8Array(payload));
    check("batch decodes to L3 blocks", blocks.length > 0, `${blocks.length} blocks`);

    for (const b of blocks) {
      for (const raw of b.transactions) recoveredTxHashes.push(keccak256(raw));
    }
    coveringL2Tx = entry.transactionHash! as Hex;
    break;
  }

  check(
    "a batch covering the transaction's block exists on the L2",
    coveringL2Tx !== null,
    coveringL2Tx ?? "none found",
  );
  check(
    "the sent transaction is recoverable from L2 data alone",
    recoveredTxHashes.some((h) => h.toLowerCase() === sendTx.toLowerCase()),
    `${recoveredTxHashes.length} transactions recovered from the batch`,
  );

  step("9. Output root proposed to the L2");
  const outputIndex = await until(
    `an output root covering L3 block ${sendBlock}`,
    async () => {
      const latest = await l2Public
        .readContract({address: ORACLE, abi: oracleAbi, functionName: "latestBlockNumber"})
        .catch(() => 0n);
      return (latest as bigint) >= sendBlock ? latest : null;
    },
    180_000,
  );
  check("output oracle commits to a block at or beyond the transaction", (outputIndex as bigint) >= sendBlock, `L3 block ${outputIndex}`);

  const settlement = await rpc<{
    outputOracle: {latestOutput: {outputRoot: string; l3BlockNumber: string} | null; faultProofs: {implemented: boolean}};
  }>(L3_RPC, "kaurax_settlementStatus");
  check("settlement status exposes the latest output root", settlement.outputOracle.latestOutput !== null);
  check(
    "fault proofs are honestly reported as not implemented",
    settlement.outputOracle.faultProofs.implemented === false,
  );

  // ---------------------------------------------------------------------- //
  step("10. Withdraw from KAURAX back to the L2");
  const withdrawAmount = parseEther("0.5");
  const withdrawHash = await l3Wallet.writeContract({
    address: MESSAGE_PASSER,
    abi: passerAbi,
    functionName: "initiateWithdrawal",
    args: [user.address, 100_000n, "0x"],
    value: withdrawAmount,
  });
  const withdrawReceipt = await l3Public.waitForTransactionReceipt({hash: withdrawHash, timeout: 60_000});
  check("withdrawal initiated on KAURAX", withdrawReceipt.status === "success", `block ${withdrawReceipt.blockNumber}`);

  const passed_ = decodeEventLog({
    abi: passerAbi as never,
    topics: withdrawReceipt.logs[0]!.topics,
    data: withdrawReceipt.logs[0]!.data,
  }) as {args: {withdrawalHash: Hex}};
  const wHash = passed_.args.withdrawalHash;
  info(`withdrawal hash ${wHash}`);

  const proof = await until(
    "the node to build a withdrawal proof against a published output root",
    async () => {
      const r = await rpc<{status: string}>(L3_RPC, "kaurax_withdrawalProof", [wHash]);
      return r.status === "ready" ? r : null;
    },
    180_000,
    2000,
  );
  check("kaurax_withdrawalProof returns a usable proof", (proof as {status: string}).status === "ready");

  const p = proof as unknown as {
    withdrawal: {nonce: string; sender: Hex; target: Hex; value: string; gasLimit: string; data: Hex};
    l2OutputIndex: string;
    outputRootProof: {version: Hex; stateRoot: Hex; withdrawalTreeRoot: Hex; latestBlockHash: Hex};
    withdrawalIndex: number;
    withdrawalProof: Hex[];
  };

  const wtx = {
    nonce: BigInt(p.withdrawal.nonce),
    sender: p.withdrawal.sender,
    target: p.withdrawal.target,
    value: BigInt(p.withdrawal.value),
    gasLimit: BigInt(p.withdrawal.gasLimit),
    data: p.withdrawal.data,
  };

  const proveTx = await l2Wallet.writeContract({
    address: PORTAL,
    abi: portalAbi,
    functionName: "proveWithdrawalTransaction",
    args: [wtx, BigInt(p.l2OutputIndex), p.outputRootProof, BigInt(p.withdrawalIndex), p.withdrawalProof],
  });
  const proveReceipt = await l2Public.waitForTransactionReceipt({hash: proveTx});
  check(
    "KauraxPortal accepted the Merkle inclusion proof on the L2",
    proveReceipt.status === "success",
    proveTx,
  );

  // The challenge window must elapse. On this devnet the L2 clock is advanced explicitly
  // rather than waited out. This is a devnet-only operation against the local L2 node; on
  // a public network the wait is real and is measured in days.
  const window = Number(
    await l2Public.readContract({address: ORACLE, abi: oracleAbi, functionName: "finalizationPeriodSeconds"}),
  );
  info(`advancing the local L2 clock past the ${window}s challenge window (devnet only)`);
  await rpc(L2_RPC, "evm_increaseTime", [window + 5]);
  await rpc(L2_RPC, "evm_mine", []);

  const l2BalanceBefore = await l2Public.getBalance({address: user.address});
  const finalizeTx = await l2Wallet.writeContract({
    address: PORTAL,
    abi: portalAbi,
    functionName: "finalizeWithdrawalTransaction",
    args: [wtx],
  });
  const finalizeReceipt = await l2Public.waitForTransactionReceipt({hash: finalizeTx});
  check("withdrawal finalized on the L2", finalizeReceipt.status === "success", finalizeTx);

  const l2BalanceAfter = await l2Public.getBalance({address: user.address});
  const gasCost = finalizeReceipt.gasUsed * finalizeReceipt.effectiveGasPrice;
  check(
    "withdrawn KAX released from escrow on the L2",
    l2BalanceAfter + gasCost - l2BalanceBefore === withdrawAmount,
    `+${formatEther(l2BalanceAfter + gasCost - l2BalanceBefore)}`,
  );

  step("11. Replay protection");
  let replayBlocked = false;
  try {
    await l2Wallet.writeContract({
      address: PORTAL,
      abi: portalAbi,
      functionName: "finalizeWithdrawalTransaction",
      args: [wtx],
    });
  } catch {
    replayBlocked = true;
  }
  check("the same withdrawal cannot be finalized twice", replayBlocked);

  let wrongChainBlocked = false;
  try {
    // A transaction signed for the L2 must not be accepted by KAURAX.
    const signed = await l2Wallet.signTransaction({
      to: RECIPIENT,
      value: 1n,
      chainId: L2_CHAIN_ID,
      nonce: await l2Public.getTransactionCount({address: user.address}),
      gas: 21000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1n,
    });
    await rpc(L3_RPC, "eth_sendRawTransaction", [signed]);
  } catch {
    wrongChainBlocked = true;
  }
  check("a transaction signed for the L2 is rejected by KAURAX", wrongChainBlocked);

  // ---------------------------------------------------------------------- //
  step("Summary");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}KAURAX acceptance test passed.${RESET}\n`);
}

main().catch((err: Error) => {
  console.error(`\n${RED}acceptance test aborted:${RESET} ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
