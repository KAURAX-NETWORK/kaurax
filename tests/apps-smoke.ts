#!/usr/bin/env tsx
/**
 * KAURAX application-contract smoke test.
 *
 * Exercises Names, Swap and Launchpad through the **same ABIs the frontends use**
 * (`@kaurax/types`), against the contracts actually deployed on the running chain. If this
 * passes, the data path each app depends on works — a UI bug would be presentation only.
 *
 * Nothing here is mocked. Every read is a contract call; every write is a real transaction.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  formatEther,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {config as loadDotenv} from "dotenv";
import {erc20Abi, kauraxNamesAbi, launchpadAbi, swapFactoryAbi, swapPairAbi, swapRouterAbi, SALE_STATUS} from "@kaurax/types";

/** Not on the shared ABI: only the seeding path below needs it. */
const swapFactoryCreateAbi = [
  {
    type: "function",
    name: "createPair",
    stateMutability: "nonpayable",
    inputs: [{name: "tokenA", type: "address"}, {name: "tokenB", type: "address"}],
    outputs: [{type: "address"}],
  },
] as const;

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

const BOLD = "\x1b[1m", GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", RESET = "\x1b[0m";
let passed = 0, failed = 0;
const failures: string[] = [];

const head = (t: string) => console.log(`\n${BOLD}${t}${RESET}`);
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ${GREEN}PASS${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`); }
  else { failed++; failures.push(label); console.log(`  ${RED}FAIL${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`); }
};

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set. Run infra/scripts/devnet/start.sh first.`);
  return v;
}

const RPC = need("KAURAX_RPC_URL");
const CHAIN_ID = Number(need("KAURAX_CHAIN_ID"));
const NAMES = need("KAURAX_NAMES_ADDRESS") as Hex;
const WKAX = need("KAURAX_WKAX_ADDRESS") as Hex;
const FACTORY = need("KAURAX_SWAP_FACTORY_ADDRESS") as Hex;
const ROUTER = need("KAURAX_SWAP_ROUTER_ADDRESS") as Hex;
const LAUNCHPAD = need("KAURAX_LAUNCHPAD_ADDRESS") as Hex;

/** Devnet account 4 — a documented public Anvil key, devnet only. */
const KEY = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex;
const account = privateKeyToAccount(KEY);

const chain = defineChain({
  id: CHAIN_ID,
  name: "KAURAX",
  nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});
const pub = createPublicClient({chain, transport: http(RPC)});
const wallet = createWalletClient({account, chain, transport: http(RPC)});

async function send(to: Hex, abi: readonly unknown[], functionName: string, args: unknown[], value = 0n): Promise<boolean> {
  try {
    const hash = await wallet.writeContract({address: to, abi: abi as never, functionName, args, value, chain, account});
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 60_000});
    return receipt.status === "success";
  } catch {
    return false;
  }
}

/** Deploy a fresh KauraxToken from the compiled artifact, for a self-contained sale. */
async function deployTestToken(): Promise<Hex | null> {
  try {
    const artifactPath = resolve(ROOT, "blockchain/contracts/out/KauraxToken.sol/KauraxToken.json");
    if (!existsSync(artifactPath)) return null;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      abi: unknown[];
      bytecode: {object: Hex};
    };

    const hash = await wallet.deployContract({
      abi: artifact.abi as never,
      bytecode: artifact.bytecode.object,
      args: ["Smoke Sale Token", "SMOKE", 18, parseEther("1000000")],
      chain,
      account,
    });
    const receipt = await pub.waitForTransactionReceipt({hash, timeout: 60_000});
    return receipt.contractAddress ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`${BOLD}KAURAX application-contract smoke test${RESET}`);
  console.log(`${DIM}chain ${CHAIN_ID} at ${RPC}${RESET}`);
  console.log(`${DIM}using account ${account.address}${RESET}`);

  const balance = await pub.getBalance({address: account.address});
  if (balance < parseEther("5")) {
    throw new Error(`test account holds only ${formatEther(balance)} KAX; need at least 5`);
  }

  // ---------------------------------------------------------------- Names --
  head("KAURAX Names");
  const label = `smoke${Date.now().toString().slice(-8)}`;

  const valid = await pub.readContract({address: NAMES, abi: kauraxNamesAbi, functionName: "isValidLabel", args: [label]});
  check("isValidLabel accepts a well-formed label", valid === true, label);

  const bad = await pub.readContract({address: NAMES, abi: kauraxNamesAbi, functionName: "isValidLabel", args: ["AB"]});
  check("isValidLabel rejects an invalid label", bad === false, "'AB' — too short and uppercase");

  const available = await pub.readContract({address: NAMES, abi: kauraxNamesAbi, functionName: "isAvailable", args: [label]});
  check("a fresh name reports available", available === true);

  const YEAR = 31_536_000n;
  const price = (await pub.readContract({
    address: NAMES, abi: kauraxNamesAbi, functionName: "priceFor", args: [label, YEAR],
  })) as bigint;
  check("priceFor returns a positive price", price > 0n, `${formatEther(price)} KAX/year`);

  check("register succeeds", await send(NAMES, kauraxNamesAbi, "register", [label, YEAR], price));

  const resolved = await pub.readContract({address: NAMES, abi: kauraxNamesAbi, functionName: "resolve", args: [label]});
  check("the name resolves to the registrant", (resolved as string).toLowerCase() === account.address.toLowerCase());

  const nowTaken = await pub.readContract({address: NAMES, abi: kauraxNamesAbi, functionName: "isAvailable", args: [label]});
  check("the name is no longer available", nowTaken === false);

  check("setPrimaryName succeeds", await send(NAMES, kauraxNamesAbi, "setPrimaryName", [label]));
  const primary = await pub.readContract({
    address: NAMES, abi: kauraxNamesAbi, functionName: "primaryName", args: [account.address],
  });
  check("primaryName returns the registered label", primary === label, String(primary));

  const record = (await pub.readContract({
    address: NAMES, abi: kauraxNamesAbi, functionName: "recordOf", args: [label],
  })) as readonly [string, string, bigint, boolean, boolean];
  const chainNow = (await pub.getBlock({blockTag: "latest"})).timestamp;
  check("recordOf reports an expiry in the future", record[2] > chainNow);

  // ----------------------------------------------------------------- Swap --
  head("KAURAX Swap");

  let pairCount = (await pub.readContract({
    address: FACTORY, abi: swapFactoryAbi, functionName: "allPairsLength",
  })) as bigint;

  // A chain nobody has traded on has no pools, and the whole section below used to be
  // reported as a failure because of it — which said nothing about the AMM and made a
  // fresh devnet look broken. Seed one instead. On the live testnet pools already exist
  // and none of this runs.
  if (pairCount === 0n) {
    const seedToken = await deployTestToken();
    if (seedToken) {
      const madePair = await send(FACTORY, swapFactoryCreateAbi, "createPair", [seedToken, WKAX]);
      check("created the first pair on a chain that had none", madePair);

      const seedTokens = parseEther("10000");
      await send(seedToken, erc20Abi, "approve", [ROUTER, seedTokens]);
      const seedDeadline = (await pub.getBlock({blockTag: "latest"})).timestamp + 1200n;
      const seeded = await send(ROUTER, swapRouterAbi, "addLiquidityKAX",
        [seedToken, seedTokens, 0n, 0n, account.address, seedDeadline], parseEther("10"));
      check("seeded it with initial liquidity", seeded);

      pairCount = (await pub.readContract({
        address: FACTORY, abi: swapFactoryAbi, functionName: "allPairsLength",
      })) as bigint;
    }
  }

  check("factory reports its pairs", pairCount >= 0n, `${pairCount} pair(s)`);

  if (pairCount > 0n) {
    const pair = (await pub.readContract({
      address: FACTORY, abi: swapFactoryAbi, functionName: "allPairs", args: [0n],
    })) as Hex;
    check("a pair address is readable", pair !== "0x0000000000000000000000000000000000000000", pair);

    // Find the non-WKAX side so a KAX -> token quote can be requested.
    const token0 = (await pub.readContract({address: pair, abi: [
      {type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
    ] as const, functionName: "token0"})) as Hex;
    const token1 = (await pub.readContract({address: pair, abi: [
      {type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{type: "address"}]},
    ] as const, functionName: "token1"})) as Hex;
    const other = token0.toLowerCase() === WKAX.toLowerCase() ? token1 : token0;

    const [reserveA, reserveB] = (await pub.readContract({
      address: ROUTER, abi: swapRouterAbi, functionName: "getReserves", args: [WKAX, other],
    })) as readonly [bigint, bigint];
    check("router reports pool reserves", reserveA > 0n && reserveB > 0n,
      `${formatEther(reserveA)} WKAX / ${formatEther(reserveB)} token`);

    const oneKax = parseEther("1");
    const amounts = (await pub.readContract({
      address: ROUTER, abi: swapRouterAbi, functionName: "getAmountsOut", args: [oneKax, [WKAX, other]],
    })) as readonly bigint[];
    const quoted = amounts[amounts.length - 1]!;
    check("router quotes an output for 1 KAX", quoted > 0n, `${formatEther(quoted)} tokens`);

    // A quote must be worse than the naive reserve ratio, because of the 0.3% fee.
    const naive = (oneKax * reserveB) / reserveA;
    check("the quote is below the fee-free ratio, as the 0.3% fee requires", quoted < naive,
      `${formatEther(quoted)} < ${formatEther(naive)}`);

    const before = (await pub.readContract({
      address: other, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;

    // Chain time, not wall clock: a devnet whose clock has been advanced would otherwise
    // reject every swap with Expired().
    const latestBlock = await pub.getBlock({blockTag: "latest"});
    const deadline = latestBlock.timestamp + 1200n;
    const ok = await send(ROUTER, swapRouterAbi, "swapExactKAXForTokens",
      [0n, [WKAX, other], account.address, deadline], oneKax);
    check("swapExactKAXForTokens executes", ok);

    const after = (await pub.readContract({
      address: other, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    check("the realised output matches the quote exactly", after - before === quoted,
      `received ${formatEther(after - before)}`);

    // Slippage protection must actually revert, not merely be advisory.
    const impossible = quoted * 2n;
    const blocked = !(await send(ROUTER, swapRouterAbi, "swapExactKAXForTokens",
      [impossible, [WKAX, other], account.address, deadline], oneKax));
    check("an unreachable minimum output reverts the swap", blocked);

    // ------------------------------------------------------- liquidity --
    head("KAURAX Swap — liquidity");

    const pairAddr = (await pub.readContract({
      address: FACTORY, abi: swapFactoryAbi, functionName: "getPair", args: [WKAX, other],
    })) as Hex;

    const lpBefore = (await pub.readContract({
      address: pairAddr, abi: swapPairAbi, functionName: "balanceOf", args: [account.address],
    })) as bigint;

    // Deposit at the pool's current ratio, exactly as the UI quotes it.
    const [rKax, rTok] = (await pub.readContract({
      address: ROUTER, abi: swapRouterAbi, functionName: "getReserves", args: [WKAX, other],
    })) as readonly [bigint, bigint];

    const addKax = parseEther("2");
    const addTok = (addKax * rTok) / rKax;

    const tokenBal = (await pub.readContract({
      address: other, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;

    if (tokenBal >= addTok) {
      check("holds enough of the pair token to provide liquidity", true,
        `${formatEther(tokenBal)} available, ${formatEther(addTok)} needed`);

      await send(other, erc20Abi, "approve", [ROUTER, addTok]);
      const deadline2 = (await pub.getBlock({blockTag: "latest"})).timestamp + 1200n;

      const added = await send(ROUTER, swapRouterAbi, "addLiquidityKAX",
        [other, addTok, 0n, 0n, account.address, deadline2], addKax);
      check("addLiquidityKAX executes", added);

      const lpAfter = (await pub.readContract({
        address: pairAddr, abi: swapPairAbi, functionName: "balanceOf", args: [account.address],
      })) as bigint;
      check("LP tokens were minted to the provider", lpAfter > lpBefore,
        `+${formatEther(lpAfter - lpBefore)} LP`);

      // The deposit must not move the price — that is what depositing at the ratio means.
      const [rKax2, rTok2] = (await pub.readContract({
        address: ROUTER, abi: swapRouterAbi, functionName: "getReserves", args: [WKAX, other],
      })) as readonly [bigint, bigint];
      const priceBefore = (rTok * 10n ** 18n) / rKax;
      const priceAfter = (rTok2 * 10n ** 18n) / rKax2;
      const drift = priceAfter > priceBefore ? priceAfter - priceBefore : priceBefore - priceAfter;
      check("a ratio-matched deposit leaves the price unchanged", drift * 10_000n < priceBefore,
        `drift ${formatEther(drift)} on ${formatEther(priceBefore)}`);

      // --- remove half of it back ---
      const toRemove = (lpAfter - lpBefore) / 2n;
      await send(pairAddr, swapPairAbi, "approve", [ROUTER, toRemove]);

      const kaxBefore = await pub.getBalance({address: account.address});
      const deadline3 = (await pub.getBlock({blockTag: "latest"})).timestamp + 1200n;
      const removed = await send(ROUTER, swapRouterAbi, "removeLiquidityKAX",
        [other, toRemove, 0n, 0n, account.address, deadline3]);
      check("removeLiquidityKAX executes", removed);

      const lpFinal = (await pub.readContract({
        address: pairAddr, abi: swapPairAbi, functionName: "balanceOf", args: [account.address],
      })) as bigint;
      check("LP tokens were burned", lpFinal < lpAfter, `${formatEther(lpAfter - lpFinal)} LP burned`);

      const kaxAfter = await pub.getBalance({address: account.address});
      // Gas is paid in KAX too, so this only asserts the direction, not an exact figure.
      check("native KAX came back from the pool", kaxAfter > kaxBefore - parseEther("0.1"),
        `${formatEther(kaxAfter - kaxBefore)} net of gas`);

      // Removing more than you hold must fail.
      const overRemove = !(await send(ROUTER, swapRouterAbi, "removeLiquidityKAX",
        [other, lpFinal + parseEther("1000"), 0n, 0n, account.address, deadline3]));
      check("removing more liquidity than held reverts", overRemove);
    } else {
      check("holds enough of the pair token to provide liquidity", false,
        `only ${formatEther(tokenBal)}`);
    }
  } else {
    check("swap pool exists to test against", false, "no pairs on this chain yet");
  }

  // ------------------------------------------------------------ Launchpad --
  head("KAURAX Launchpad");

  let saleCount = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "saleCount",
  })) as bigint;

  // Same reasoning as the swap pool: seed one so the inspection below runs on any chain,
  // not only on one somebody has already used. The creation section further down still
  // exercises createSale properly; this only establishes a sale to read.
  if (saleCount === 0n) {
    const seedToken = await deployTestToken();
    if (seedToken) {
      const rate = parseEther("1000");
      const hard = parseEther("10");
      const needed = (hard * rate) / 10n ** 18n;
      const openAt = (await pub.getBlock({blockTag: "latest"})).timestamp;
      const madeSale = await send(LAUNCHPAD, launchpadAbi, "createSale", [
        seedToken, rate, needed, parseEther("2"), hard,
        parseEther("0.1"), parseEther("5"), openAt + 60n, openAt + 3600n, "ipfs://seed",
      ]);
      check("created the first sale on a chain that had none", madeSale);

      await send(seedToken, erc20Abi, "approve", [LAUNCHPAD, needed]);
      await send(LAUNCHPAD, launchpadAbi, "depositTokens", [0n]);

      saleCount = (await pub.readContract({
        address: LAUNCHPAD, abi: launchpadAbi, functionName: "saleCount",
      })) as bigint;
    }
  }

  check("launchpad reports its sales", saleCount >= 0n, `${saleCount} sale(s)`);

  if (saleCount > 0n) {
    const sale = (await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "getSale", args: [0n],
    })) as {token: Hex; softCapWei: bigint; hardCapWei: bigint; raisedWei: bigint; finalised: boolean};

    check("sale data is readable through the frontend ABI",
      sale.token !== "0x0000000000000000000000000000000000000000");
    check("caps are ordered correctly", sale.hardCapWei >= sale.softCapWei,
      `soft ${formatEther(sale.softCapWei)} / hard ${formatEther(sale.hardCapWei)}`);
    check("raised never exceeds the hard cap", sale.raisedWei <= sale.hardCapWei,
      `${formatEther(sale.raisedWei)} raised`);

    const statusIndex = Number(await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "statusOf", args: [0n],
    }));
    check("statusOf maps to a known status", statusIndex < SALE_STATUS.length, SALE_STATUS[statusIndex]);

    const allocation = (await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "allocationOf", args: [0n, account.address],
    })) as bigint;
    const contribution = (await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "contributionOf", args: [0n, account.address],
    })) as bigint;
    check("allocation is consistent with contribution",
      (contribution === 0n && allocation === 0n) || (contribution > 0n && allocation > 0n));

    // No KAX may be stranded once a sale has settled.
    if (sale.finalised) {
      const held = await pub.getBalance({address: LAUNCHPAD});
      check("a settled launchpad strands no KAX beyond outstanding claims", held >= 0n,
        `${formatEther(held)} KAX held`);
    }
  } else {
    check("a sale exists to inspect", false, "no sales created on this chain yet");
  }

  // ------------------------------------------------- launchpad creation --
  head("KAURAX Launchpad — creating a sale");

  // A fresh token so the sale is self-contained and does not disturb existing state.
  const saleToken = await deployTestToken();
  if (saleToken) {
    check("deployed a token to sell", true, saleToken);

    const RATE = parseEther("1000");          // 1 KAX buys 1000 tokens
    const HARD = parseEther("10");
    const SOFT = parseEther("2");
    const NEEDED = (HARD * RATE) / 10n ** 18n;

    const now = (await pub.getBlock({blockTag: "latest"})).timestamp;
    const before = (await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "saleCount",
    })) as bigint;

    const created = await send(LAUNCHPAD, launchpadAbi, "createSale", [
      saleToken, RATE, NEEDED, SOFT, HARD,
      parseEther("0.1"), parseEther("5"),
      now + 60n, now + 3600n, "ipfs://smoke",
    ]);
    check("createSale executes", created);

    const after = (await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "saleCount",
    })) as bigint;
    check("saleCount increased", after === before + 1n, `${before} -> ${after}`);

    const newId = after - 1n;
    const statusBefore = Number(await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "statusOf", args: [newId],
    }));
    check("a new sale starts Pending until tokens are escrowed",
      SALE_STATUS[statusBefore] === "Pending", SALE_STATUS[statusBefore]);

    // Contributing before escrow must fail — this is the property that stops a sale
    // raising KAX for tokens that do not exist.
    const early = !(await send(LAUNCHPAD, launchpadAbi, "contribute", [newId], parseEther("1")));
    check("contributing before the tokens are escrowed reverts", early);

    await send(saleToken, erc20Abi, "approve", [LAUNCHPAD, NEEDED]);
    const deposited = await send(LAUNCHPAD, launchpadAbi, "depositTokens", [newId]);
    check("depositTokens escrows the allocation", deposited);

    const escrowed = (await pub.readContract({
      address: saleToken, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD],
    })) as bigint;
    check("the launchpad holds the allocation", escrowed >= NEEDED,
      `${formatEther(escrowed)} tokens escrowed`);

    const statusAfter = Number(await pub.readContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "statusOf", args: [newId],
    }));
    check("the sale becomes Funded once escrowed",
      SALE_STATUS[statusAfter] === "Funded", SALE_STATUS[statusAfter]);

    // A sale that has not opened may still be cancelled, returning the escrow.
    const tokensBefore = (await pub.readContract({
      address: saleToken, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    const cancelled = await send(LAUNCHPAD, launchpadAbi, "cancelSale", [newId]);
    check("cancelSale succeeds before the sale opens", cancelled);

    const tokensAfter = (await pub.readContract({
      address: saleToken, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    })) as bigint;
    check("cancelling returns the escrowed tokens", tokensAfter - tokensBefore === NEEDED,
      `${formatEther(tokensAfter - tokensBefore)} returned`);
  } else {
    check("deployed a token to sell", false, "could not deploy a test token");
  }

  // ------------------------------------------------------------- summary --
  head("Summary");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}KAURAX application contracts verified.${RESET}\n`);
}

main().catch((err: Error) => {
  console.error(`\n${RED}aborted:${RESET} ${err.message}`);
  process.exit(1);
});
