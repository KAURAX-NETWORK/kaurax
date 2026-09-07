/**
 * KAURAX load test.
 *
 * Measures. Does not claim.
 *
 * Everything this prints is something it observed on the machine it ran on, against the
 * chain it was pointed at, in the run that just happened. It reports the hardware and the
 * configuration alongside the numbers, because a throughput figure without them is a
 * marketing claim rather than a measurement.
 *
 * What it deliberately does NOT do:
 *   - extrapolate to "capable of N TPS"
 *   - report a peak as if it were sustained
 *   - hide failed transactions to make a number look better
 *
 * Usage:
 *   pnpm --filter @kaurax/tests load
 *   LOAD_TX=500 LOAD_CONCURRENCY=25 pnpm --filter @kaurax/tests load
 */
import {config} from "dotenv";
import {cpus, totalmem, platform, arch} from "node:os";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import {privateKeyToAccount, generatePrivateKey} from "viem/accounts";

config({path: new URL("../.env", import.meta.url).pathname});

const RPC = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";
const CHAIN_ID = Number(process.env.KAURAX_CHAIN_ID ?? 8420);
// The devnet funds the documented Anvil accounts; DEV_FUNDED_KEY overrides for other targets.
const FUNDER = (process.env.DEV_FUNDED_KEY ?? process.env.DEPLOYER_PRIVATE_KEY) as Hex | undefined;
const TX_COUNT = Number(process.env.LOAD_TX ?? 200);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20);
const SENDERS = Number(process.env.LOAD_SENDERS ?? 5);

if (!FUNDER) {
  console.error("DEV_FUNDED_KEY is not set. This test needs a funded account on the target chain.");
  process.exit(1);
}

const chain = defineChain({
  id: CHAIN_ID,
  name: "KAURAX",
  nativeCurrency: {name: "KAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const publicClient = createPublicClient({chain, transport: http(RPC)});
const funder = privateKeyToAccount(FUNDER);
const funderWallet = createWalletClient({account: funder, chain, transport: http(RPC)});

const BURN = "0x000000000000000000000000000000000000dEaD" as const;

interface Sample {
  submitMs: number;
  inclusionMs: number | null;
  block: bigint | null;
  error: string | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

function ms(value: number | null): string {
  return value === null ? "No data available" : `${value.toFixed(0)} ms`;
}

async function main(): Promise<void> {
  const observedChainId = await publicClient.getChainId();
  if (observedChainId !== CHAIN_ID) {
    console.error(`RPC at ${RPC} reports chain ${observedChainId}, expected ${CHAIN_ID}. Refusing to measure.`);
    process.exit(1);
  }

  console.log("KAURAX load test");
  console.log("─".repeat(72));
  console.log(`  target        ${RPC} (chain ${observedChainId})`);
  console.log(`  host          ${platform()}/${arch()}, ${cpus().length} cores, ${(totalmem() / 1e9).toFixed(1)} GB RAM`);
  console.log(`  cpu           ${cpus()[0]?.model ?? "unknown"}`);
  console.log(`  transactions  ${TX_COUNT} across ${SENDERS} senders, ${CONCURRENCY} in flight`);
  console.log(`  node          ${process.version}`);
  console.log("─".repeat(72));

  // Independent senders, because one account's nonce sequence would serialise everything
  // and measure the mempool's ordering rather than the chain's throughput.
  console.log(`\nfunding ${SENDERS} sender accounts…`);
  const senders = await Promise.all(
    Array.from({length: SENDERS}, async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const hash = await funderWallet.sendTransaction({to: account.address, value: parseEther("1")});
      await publicClient.waitForTransactionReceipt({hash});
      return {
        account,
        wallet: createWalletClient({account, chain, transport: http(RPC)}),
        nonce: 0,
      };
    }),
  );
  console.log(`funded (1 KAX each, funder now holds ${formatEther(await publicClient.getBalance({address: funder.address}))} KAX)`);

  const blockTimeSeconds = Number(process.env.KAURAX_BLOCK_TIME ?? 2);
  console.log(`\nsending ${TX_COUNT} transfers… (block time is configured at ${blockTimeSeconds}s)\n`);

  const samples: Sample[] = [];
  const startedAt = Date.now();
  const startBlock = await publicClient.getBlockNumber();

  let issued = 0;
  const worker = async (): Promise<void> => {
    while (issued < TX_COUNT) {
      const index = issued++;
      if (index >= TX_COUNT) break;
      const sender = senders[index % senders.length]!;
      const nonce = sender.nonce++;

      const t0 = Date.now();
      try {
        const hash = await sender.wallet.sendTransaction({to: BURN, value: 1n, nonce, gas: 21_000n});
        const submitMs = Date.now() - t0;
        const receipt = await publicClient.waitForTransactionReceipt({hash, timeout: 120_000});
        samples.push({
          submitMs,
          inclusionMs: Date.now() - t0,
          block: receipt.blockNumber,
          error: receipt.status === "success" ? null : "reverted",
        });
      } catch (error) {
        samples.push({submitMs: Date.now() - t0, inclusionMs: null, block: null, error: (error as Error).message});
      }

      const done = samples.length;
      if (done % 25 === 0) process.stdout.write(`  ${done}/${TX_COUNT}\n`);
    }
  };

  await Promise.all(Array.from({length: Math.min(CONCURRENCY, TX_COUNT)}, worker));

  const wallSeconds = (Date.now() - startedAt) / 1000;
  const endBlock = await publicClient.getBlockNumber();

  const included = samples.filter((s) => s.inclusionMs !== null && s.error === null);
  const failed = samples.filter((s) => s.error !== null);
  const inclusion = included.map((s) => s.inclusionMs!).sort((a, b) => a - b);
  const submit = samples.map((s) => s.submitMs).sort((a, b) => a - b);

  // Per-block occupancy tells you whether the chain was actually saturated. If blocks were
  // not full, the throughput figure measures the block time, not the chain's capacity —
  // and saying so is the difference between a measurement and a boast.
  const perBlock = new Map<string, number>();
  for (const s of included) if (s.block !== null) perBlock.set(s.block.toString(), (perBlock.get(s.block.toString()) ?? 0) + 1);
  const occupancies = [...perBlock.values()].sort((a, b) => b - a);
  const blocksUsed = perBlock.size;

  console.log("\n" + "═".repeat(72));
  console.log("MEASURED — this run, this machine, this configuration");
  console.log("═".repeat(72));
  console.log(`  submitted             ${samples.length}`);
  console.log(`  included successfully ${included.length}`);
  console.log(`  failed                ${failed.length}`);
  console.log(`  wall clock            ${wallSeconds.toFixed(1)} s`);
  console.log(`  blocks produced       ${endBlock - startBlock} (${startBlock} → ${endBlock})`);
  console.log(`  blocks carrying load  ${blocksUsed}`);
  console.log("");
  console.log(`  observed throughput   ${(included.length / wallSeconds).toFixed(1)} tx/s`);
  console.log(`  busiest block         ${occupancies[0] ?? 0} transactions`);
  console.log(`  median block          ${percentile([...occupancies].sort((a, b) => a - b), 50) ?? 0} transactions`);
  console.log("");
  console.log(`  submit latency  p50   ${ms(percentile(submit, 50))}`);
  console.log(`  submit latency  p95   ${ms(percentile(submit, 95))}`);
  console.log(`  inclusion       p50   ${ms(percentile(inclusion, 50))}`);
  console.log(`  inclusion       p95   ${ms(percentile(inclusion, 95))}`);
  console.log(`  inclusion       max   ${ms(inclusion.at(-1) ?? null)}`);

  if (failed.length > 0) {
    console.log("\n  failures (first 5):");
    for (const f of failed.slice(0, 5)) console.log(`    - ${f.error?.split("\n")[0]?.slice(0, 100)}`);
  }

  console.log("\n" + "─".repeat(72));
  console.log("HOW TO READ THIS");
  console.log("─".repeat(72));
  const gasLimit = BigInt(process.env.KAURAX_GAS_LIMIT ?? 30_000_000);
  const theoreticalPerBlock = Number(gasLimit / 21_000n);
  console.log(`  A block holds ${gasLimit} gas — about ${theoreticalPerBlock} simple transfers.`);
  console.log(`  The busiest block here carried ${occupancies[0] ?? 0}.`);
  if ((occupancies[0] ?? 0) < theoreticalPerBlock * 0.5) {
    console.log("");
    console.log("  Blocks were NOT full. This run measured how fast the harness could offer");
    console.log("  work and how often blocks are produced — not the chain's capacity. Do not");
    console.log("  quote the throughput above as a capacity figure.");
  } else {
    console.log("");
    console.log("  Blocks were substantially full, so this run did exercise block capacity.");
    console.log("  It still measures one machine running every layer locally.");
  }
  console.log("");
  console.log("  These numbers describe a devnet where L1, L2, L3 and the database all share");
  console.log("  one host. They are not a claim about a public deployment, and KAURAX makes");
  console.log("  no published TPS claim.");
  console.log("");

  process.exit(failed.length > samples.length * 0.05 ? 1 : 0);
}

main().catch((error: Error) => {
  console.error(`load test failed: ${error.message}`);
  process.exit(1);
});
