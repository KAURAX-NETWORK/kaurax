#!/usr/bin/env node
/**
 * kaurax — command line interface for the KAURAX Layer-3.
 *
 * Reads endpoints from the environment (or .env) so that the same commands work against a
 * devnet, a testnet, or any other KAURAX deployment. Values that cannot be read are
 * printed as "No data available" rather than guessed.
 */
import {connect, formatWei, type KauraxClient} from "./lib.js";
import {config as loadDotenv} from "dotenv";
import {existsSync} from "node:fs";
import {resolve} from "node:path";

for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (existsSync(candidate)) {
    loadDotenv({path: candidate, override: false});
    break;
  }
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const NA = "No data available";

function row(label: string, value: unknown): void {
  const shown = value === null || value === undefined || value === "" ? `${DIM}${NA}${RESET}` : String(value);
  console.log(`  ${label.padEnd(26)} ${shown}`);
}

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}`);
}

function fail(message: string): never {
  console.error(`${RED}error:${RESET} ${message}`);
  process.exit(1);
}

const USAGE = `${BOLD}kaurax${RESET} — KAURAX Layer-3 CLI

${BOLD}USAGE${RESET}
  kaurax <command> [subcommand] [args]

${BOLD}COMMANDS${RESET}
  network status                  Ethereum -> L2 -> KAURAX overview
  block latest                    Latest KAURAX block
  block <number|hash>             A specific block
  account balance <address>       KAX balance
  account nonce <address>         Transaction count
  tx status <hash>                Transaction and its settlement stage
  bridge status <withdrawalHash>  Where a withdrawal has reached
  bridge withdrawals              Withdrawals known to the node
  sequencer status                Sequencer health and mempool
  batcher status                  Batch submission state
  batch latest                    The most recent batch published to the L2
  wallet add                      Network parameters for MetaMask
  version                         Version information

${BOLD}ENVIRONMENT${RESET}
  KAURAX_RPC_URL                  default http://127.0.0.1:8420
  KAURAX_WS_URL                   default ws://127.0.0.1:8421
`;

async function client(): Promise<KauraxClient> {
  const rpcUrl = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";
  const wsUrl = process.env.KAURAX_WS_URL ?? "ws://127.0.0.1:8421";
  try {
    return await connect({rpcUrl, wsUrl});
  } catch (err) {
    fail(`could not reach KAURAX at ${rpcUrl}: ${(err as Error).message}`);
  }
}

function requireArg(value: string | undefined, what: string): string {
  if (!value) fail(`missing ${what}`);
  return value;
}

// ---------------------------------------------------------------- commands --

async function networkStatus(): Promise<void> {
  const k = await client();
  const s = await k.getNetworkStatus();

  heading(`${s.network.name} — Ethereum → L2 → KAURAX`);
  row("profile", s.network.profile);
  row("uptime", `${s.network.uptimeSeconds}s`);

  heading("Ethereum (L1)");
  if (!s.l1) {
    row("status", null);
  } else if (s.l1.isLocalDevnetChain) {
    row("chain id", s.l1.chainId);
    row("head", s.l1.latestBlockNumber);
    row("finality", `${DIM}${NA} — local devnet chain, not Ethereum${RESET}`);
  } else {
    row("chain id", s.l1.chainId);
    row("head", s.l1.latestBlockNumber);
    row("finalized", s.l1.finalizedBlockNumber);
    row("safe", s.l1.safeBlockNumber);
  }

  heading("Underlying rollup (L2)");
  row("name", s.l2?.name ?? null);
  row("chain id", s.l2?.chainId ?? null);
  row("head", s.l2?.blockNumber ?? null);
  row("local devnet", s.l2 ? String(s.l2.isLocalDevnet) : null);

  heading("KAURAX (L3)");
  row("chain id", s.l3.chainId);
  row("head", s.l3.blockNumber);
  row("block time", `${s.l3.blockTimeSeconds}s`);
  row("gas limit", s.l3.gasLimit);
  row("gas price", s.l3.gasPrice ? `${BigInt(s.l3.gasPrice)} wei` : null);
  row("currency", `${s.l3.nativeCurrency.symbol} (${s.l3.nativeCurrency.decimals} decimals)`);
  row("mempool", s.l3.mempoolSize);

  heading("Settlement");
  row("batches on L2", s.settlement.batchCountOnL2);
  row("last batched L3 block", s.settlement.lastBatchedL3Block);
  row("unbatched L3 blocks", s.settlement.unbatchedL3Blocks);
  row("last batch L2 tx", s.settlement.lastBatch?.l2TxHash ?? null);
  row("latest output root", s.settlement.latestOutputRoot?.outputRoot ?? null);
  row("output at L3 block", s.settlement.latestOutputRoot?.l3BlockNumber ?? null);
  row("data availability", `${s.settlement.dataAvailability.mode} → ${s.settlement.dataAvailability.target}`);
  row("fault proofs", s.settlement.faultProofs.status);

  heading("Sequencer");
  row("mode", `${s.sequencer.mode} (decentralized: ${s.sequencer.decentralized})`);
  row("healthy", s.sequencer.healthy);
  row("last error", s.sequencer.lastError ?? "none");
  console.log();
}

async function blockCommand(arg: string | undefined): Promise<void> {
  const k = await client();
  const block =
    !arg || arg === "latest"
      ? await k.getBlock("latest")
      : arg.startsWith("0x")
        ? await k.getBlockByHash(arg as `0x${string}`)
        : await k.getBlock(BigInt(arg));

  if (!block) fail(`block ${arg ?? "latest"} not found`);

  heading(`KAURAX block ${block.number}`);
  row("hash", block.hash);
  row("parent", block.parentHash);
  row("state root", block.stateRoot);
  row("timestamp", `${block.timestamp} (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
  row("transactions", block.transactionCount);
  row("gas used", `${block.gasUsed} / ${block.gasLimit}`);
  row("base fee", block.baseFeePerGas === null ? null : `${block.baseFeePerGas} wei`);
  row("settled to L2", (await k.isBlockSettled(block.number)) ?? null);
  console.log();
}

async function accountCommand(sub: string | undefined, address: string | undefined): Promise<void> {
  const k = await client();
  const addr = requireArg(address, "address") as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) fail(`"${addr}" is not a valid address`);

  if (sub === "balance") {
    const wei = await k.getBalance(addr);
    heading(`Account ${addr}`);
    row("balance", `${formatWei(wei)} KAX`);
    row("wei", wei.toString());
    console.log();
    return;
  }
  if (sub === "nonce") {
    heading(`Account ${addr}`);
    row("nonce (latest)", await k.getTransactionCount(addr, "latest"));
    row("nonce (pending)", await k.getTransactionCount(addr, "pending"));
    console.log();
    return;
  }
  fail(`unknown subcommand "account ${sub ?? ""}"`);
}

async function txStatus(hash: string | undefined): Promise<void> {
  const k = await client();
  const h = requireArg(hash, "transaction hash") as `0x${string}`;

  const tx = await k.getTransaction(h);
  if (!tx) {
    heading(`Transaction ${h}`);
    row("status", "not found (it may still be in the mempool)");
    console.log();
    return;
  }

  const receipt = await k.getTransactionReceipt(h);
  heading(`Transaction ${h}`);
  row("from", tx.from);
  row("to", tx.to ?? "(contract creation)");
  row("value", `${formatWei(tx.value)} KAX`);
  row("nonce", tx.nonce);
  row("block", tx.blockNumber === null ? null : tx.blockNumber.toString());
  row("status", receipt ? receipt.status : "pending");
  row("gas used", receipt ? receipt.gasUsed.toString() : null);
  row("logs", receipt ? receipt.logs.length : null);

  if (receipt) {
    heading("Settlement");
    const settled = await k.isBlockSettled(receipt.blockNumber);
    row("published to L2", settled === null ? null : settled ? "yes" : "not yet");
    const s = await k.getNetworkStatus();
    row("last batched L3 block", s.settlement.lastBatchedL3Block);
    row(
      "committed by output root",
      s.settlement.latestOutputRoot &&
        BigInt(s.settlement.latestOutputRoot.l3BlockNumber) >= receipt.blockNumber
        ? s.settlement.latestOutputRoot.outputRoot
        : null,
    );
  }
  console.log();
}

async function bridgeStatus(hash: string | undefined): Promise<void> {
  const k = await client();
  const h = requireArg(hash, "withdrawal hash") as `0x${string}`;
  const {getWithdrawalStatus} = await import("./lib.js");
  const result = await getWithdrawalStatus(k, h);

  heading(`Withdrawal ${h}`);
  if (result.stage === "unknown") {
    row("stage", "unknown");
    row("reason", result.reason);
  } else if (result.stage === "awaiting-output-root") {
    row("stage", "awaiting output root");
    row("reason", result.reason);
    row("next proposal at", `L3 block ${result.nextProposalAtL3Block}`);
  } else {
    const p = result.proof;
    row("stage", "provable on the L2");
    row("sender", p.withdrawal.sender);
    row("target", p.withdrawal.target);
    row("value", `${formatWei(BigInt(p.withdrawal.value))} KAX`);
    row("L3 block", p.withdrawal.l3BlockNumber);
    row("output index", p.l2OutputIndex);
    row("leaf index", p.withdrawalIndex);
    row("proof length", `${p.withdrawalProof.length} siblings`);
    row("challenge window", `${p.challengeWindowSeconds}s after proving`);
  }
  console.log();
}

async function bridgeWithdrawals(): Promise<void> {
  const k = await client();
  const {listWithdrawals} = await import("./lib.js");
  const list = await listWithdrawals(k);

  heading(`Withdrawals originated on KAURAX (${list.length})`);
  if (list.length === 0) {
    console.log(`  ${DIM}${NA}${RESET}\n`);
    return;
  }
  for (const w of list) {
    console.log(
      `  #${String(w.leafIndex).padEnd(4)} ${w.withdrawalHash}  ${formatWei(BigInt(w.value))} KAX  ` +
        `L3 block ${w.l3BlockNumber}`,
    );
  }
  console.log();
}

async function sequencerStatus(): Promise<void> {
  const k = await client();
  const s = await k.getSequencerStatus();
  heading("KAURAX sequencer");
  row("running", s.running);
  row("mode", s.mode);
  row("decentralized", s.decentralized);
  row("head block", s.headBlock);
  row("block time", `${s.blockTimeSeconds}s`);
  row("mempool", s.mempoolSize);
  row("blocks produced", s.producedBlocks);
  row("transactions sequenced", s.includedTransactions);
  row("deposits applied", s.appliedDeposits);
  row("last block", s.lastBlockAt ? new Date(s.lastBlockAt).toISOString() : null);
  row("last error", s.lastError ?? "none");
  console.log();
}

async function batcherStatus(): Promise<void> {
  const k = await client();
  const s = await k.getBatcherStatus();
  heading("KAURAX batcher");
  row("running", s.running);
  row("next L3 block to batch", s.nextL3BlockToBatch);
  row("pending L3 blocks", s.pendingL3Blocks);
  row("last error", s.lastError ?? "none");
  console.log();
}

async function batchLatest(): Promise<void> {
  const k = await client();
  const s = await k.getBatcherStatus();
  heading("Latest batch published to the L2");
  if (!s.lastSubmission) {
    console.log(`  ${DIM}${NA} — no batch has been submitted by this node yet${RESET}\n`);
    return;
  }
  const b = s.lastSubmission;
  row("batch index", b.batchIndex);
  row("L3 blocks", `${b.l3StartBlock} – ${b.l3EndBlock}`);
  row("L2 transaction", b.commitment.txHash);
  row("L2 block", b.commitment.blockNumber);
  row("data commitment", b.commitment.hash);
  row("size", `${b.uncompressedBytes} → ${b.compressedBytes} bytes`);
  row(
    "compression",
    b.uncompressedBytes > 0 ? `${((1 - b.compressedBytes / b.uncompressedBytes) * 100).toFixed(1)}%` : null,
  );
  row("submitted", new Date(b.submittedAt).toISOString());
  console.log();
}

async function walletAdd(): Promise<void> {
  const k = await client();
  const d = await k.getNetworkDescriptor();
  heading("Add KAURAX to an Ethereum wallet");
  row("Network name", d.chainName);
  row("RPC URL", d.rpcUrls[0]);
  row("Chain ID", `${d.chainIdDecimal}  (${d.chainId})`);
  row("Currency symbol", d.nativeCurrency.symbol);
  row("Block explorer", d.blockExplorerUrls[0] ?? null);
  console.log(`\n${DIM}wallet_addEthereumChain parameters:${RESET}`);
  console.log(
    JSON.stringify(
      {
        chainId: d.chainId,
        chainName: d.chainName,
        nativeCurrency: d.nativeCurrency,
        rpcUrls: d.rpcUrls,
        blockExplorerUrls: d.blockExplorerUrls,
      },
      null,
      2,
    ),
  );
  console.log(`\n${DIM}KAX is a testnet gas asset. It has no monetary value.${RESET}\n`);
}

// -------------------------------------------------------------------- main --

async function main(): Promise<void> {
  const [command, sub, arg] = process.argv.slice(2);

  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(USAGE);
      return;

    case "version":
    case "--version":
      console.log("kaurax 0.1.0");
      return;

    case "network":
      if (sub === "status" || sub === undefined) return networkStatus();
      break;

    case "block":
      return blockCommand(sub);

    case "account":
      return accountCommand(sub, arg);

    case "tx":
      if (sub === "status") return txStatus(arg);
      break;

    case "bridge":
      if (sub === "status") return bridgeStatus(arg);
      if (sub === "withdrawals") return bridgeWithdrawals();
      break;

    case "sequencer":
      if (sub === "status" || sub === undefined) return sequencerStatus();
      break;

    case "batcher":
      if (sub === "status" || sub === undefined) return batcherStatus();
      break;

    case "batch":
      if (sub === "latest" || sub === undefined) return batchLatest();
      break;

    case "wallet":
      if (sub === "add") return walletAdd();
      break;
  }

  fail(`unknown command "${[command, sub].filter(Boolean).join(" ")}"\n\n${USAGE}`);
}

main().catch((err: Error) => fail(err.message));
