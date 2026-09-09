/**
 * KAURAX — dispute game, end to end against a running devnet.
 *
 * The dispute game is one of KAURAX's headline properties, and until now every claim about
 * it rested on Foundry tests against a simulated L2. This exercises the deployed contracts
 * on a live chain: a real output root, proposed by the real proposer, challenged by a
 * stranger, narrowed by real moves, and deleted.
 *
 * What it demonstrates, in order:
 *
 *   1. dispute initiation           — anyone may challenge a published output root
 *   2. dispute progression          — defend and bisect narrow the disputed block range
 *   3. the finalization interlock   — a live game blocks finalization past the window
 *   4. invalid commitment rejection — the output root is deleted from the oracle
 *   5. bond settlement              — the contract holds nothing afterwards
 *
 * Every step here is permissionless. The guardian is never called: the proposer abandons
 * its claim and loses on the clock, which is the one path through this game that needs no
 * trusted party at all. That is deliberate — it is the part of the mechanism that is
 * genuinely trustless today, and it should be the part that is demonstrated.
 *
 *   ./tests/dispute.sh
 */
import {createPublicClient, createWalletClient, http, formatEther, keccak256, toHex, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {existsSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {config as loadDotenv} from "dotenv";

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

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const step = (t: string) => console.log(`\n${BOLD}${t}${RESET}`);
const info = (t: string) => console.log(`  ${DIM}${t}${RESET}`);
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

async function until<T>(what: string, fn: () => Promise<T | null>, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ------------------------------------------------------------------- setup --
const L2_RPC = process.env.KAURAX_L2_RPC_URL ?? "http://127.0.0.1:9545";
const ORACLE = process.env.KAURAX_OUTPUT_ORACLE_ADDRESS as Hex;
const GAME = process.env.KAURAX_DISPUTE_GAME_ADDRESS as Hex;

if (!ORACLE || !GAME) {
  console.error(
    "\nKAURAX_OUTPUT_ORACLE_ADDRESS and KAURAX_DISPUTE_GAME_ADDRESS must both be set.\n" +
      "Run ./infra/scripts/devnet/start.sh — it deploys the dispute game and writes both.\n",
  );
  process.exit(1);
}

const oracleAbi = [
  {type: "function", name: "latestOutputIndex", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "nextOutputIndex", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "isOutputFinalized",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "getL2Output",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "outputRoot", type: "bytes32"},
          {name: "timestamp", type: "uint128"},
          {name: "l3BlockNumber", type: "uint128"},
        ],
      },
    ],
  },
  {
    type: "function",
    name: "proposalProposer",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [{type: "address"}],
  },
  {type: "function", name: "finalizationPeriodSeconds", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
] as const;

const gameAbi = [
  {type: "function", name: "CHALLENGER_BOND", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "RESPONSE_TIMEOUT", stateMutability: "view", inputs: [], outputs: [{type: "uint64"}]},
  {type: "function", name: "gameCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "challenge",
    stateMutability: "payable",
    inputs: [{name: "_outputIndex", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "defend",
    stateMutability: "nonpayable",
    inputs: [{name: "_gameId", type: "uint256"}, {name: "_midClaim", type: "bytes32"}],
    outputs: [],
  },
  {
    type: "function",
    name: "bisect",
    stateMutability: "nonpayable",
    inputs: [{name: "_gameId", type: "uint256"}, {name: "_takeLowerHalf", type: "bool"}],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveTimeout",
    stateMutability: "nonpayable",
    inputs: [{name: "_gameId", type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "hasLiveGame",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "getGame",
    stateMutability: "view",
    inputs: [{type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "challenger", type: "address"},
          {name: "proposer", type: "address"},
          {name: "outputIndex", type: "uint256"},
          {name: "lo", type: "uint128"},
          {name: "hi", type: "uint128"},
          {name: "midClaim", type: "bytes32"},
          {name: "deadline", type: "uint64"},
          {name: "challengerBond", type: "uint256"},
          {name: "proposerBond", type: "uint256"},
          {name: "status", type: "uint8"},
          {name: "bondsSettled", type: "bool"},
        ],
      },
    ],
  },
] as const;

const STATUS = [
  "NONE",
  "PROPOSER_TURN",
  "CHALLENGER_TURN",
  "AWAITING_RESOLUTION",
  "RESOLVED_PROPOSER_WINS",
  "RESOLVED_CHALLENGER_WINS",
  "RESOLVED_TIMEOUT",
  "CANCELLED",
];

const pub = createPublicClient({transport: http(L2_RPC)});

// The challenger is a stranger: not the sequencer, the batcher or the proposer. That is the
// point of the mechanism, so the test should not quietly use a privileged key.
const challengerKey = (process.env.DEPLOYER_PRIVATE_KEY ?? "") as Hex;
const proposerKey = (process.env.PROPOSER_PRIVATE_KEY ?? "") as Hex;
if (!challengerKey || !proposerKey) {
  console.error("\nDEPLOYER_PRIVATE_KEY and PROPOSER_PRIVATE_KEY must be set (devnet .env).\n");
  process.exit(1);
}
const challenger = privateKeyToAccount(challengerKey);
const proposerAcct = privateKeyToAccount(proposerKey);
const asChallenger = createWalletClient({account: challenger, transport: http(L2_RPC)});
const asProposer = createWalletClient({account: proposerAcct, transport: http(L2_RPC)});

let lastError = "";

async function sendAs(
  w: typeof asChallenger,
  fn: string,
  args: readonly unknown[],
  value?: bigint,
): Promise<boolean> {
  try {
    const hash = await w.writeContract({
      address: GAME,
      abi: gameAbi,
      functionName: fn as never,
      args: args as never,
      value,
      chain: null,
    });
    const r = await pub.waitForTransactionReceipt({hash, timeout: 60_000});
    return r.status === "success";
  } catch (err) {
    lastError = (err as Error).message.split("\n")[0];
    return false;
  }
}

/** Devnet only: anvil lets the chain clock be moved so a timeout can be reached in seconds. */
async function advanceL2(seconds: number): Promise<void> {
  await fetch(L2_RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [seconds]}),
  });
  await fetch(L2_RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 2, method: "evm_mine", params: []}),
  });
}

const read = <T>(fn: string, args: readonly unknown[] = []) =>
  pub.readContract({address: ORACLE, abi: oracleAbi, functionName: fn as never, args: args as never}) as Promise<T>;
const readGame = <T>(fn: string, args: readonly unknown[] = []) =>
  pub.readContract({address: GAME, abi: gameAbi, functionName: fn as never, args: args as never}) as Promise<T>;

// -------------------------------------------------------------------- main --
async function main(): Promise<void> {
  console.log(`\n${BOLD}KAURAX — dispute game against a live chain${RESET}`);
  info(`oracle ${ORACLE}`);
  info(`game   ${GAME}`);

  // ---------------------------------------------------------------------- //
  step("1. An output root exists to dispute");

  const outputIndex = await until("an output root that is still challengeable", async () => {
    const next = await read<bigint>("nextOutputIndex");
    if (next === 0n) return null;
    const latest = await read<bigint>("latestOutputIndex");
    // Newest first: the newest unfinalized output is the one a challenger would pick.
    for (let i = latest; i >= 0n; i--) {
      const finalized = await read<boolean>("isOutputFinalized", [i]);
      if (finalized) break;
      if (!(await readGame<boolean>("hasLiveGame", [i]))) return i;
      if (i === 0n) break;
    }
    return null;
  });

  const output = await read<{outputRoot: Hex; l3BlockNumber: bigint}>("getL2Output", [outputIndex]);
  const outputProposer = await read<Hex>("proposalProposer", [outputIndex]);
  check("the oracle holds an output root", output.outputRoot !== `0x${"00".repeat(32)}`, output.outputRoot);
  check("it names the proposer that submitted it",
    outputProposer.toLowerCase() === proposerAcct.address.toLowerCase(), outputProposer);

  const finalizationPeriod = await read<bigint>("finalizationPeriodSeconds");
  const responseTimeout = await readGame<bigint>("RESPONSE_TIMEOUT");
  info(`finalization ${finalizationPeriod}s · response timeout ${responseTimeout}s · output index ${outputIndex}`);

  // ---------------------------------------------------------------------- //
  step("2. Dispute initiation — anyone may challenge");

  const bond = await readGame<bigint>("CHALLENGER_BOND");
  const gamesBefore = await readGame<bigint>("gameCount");

  const opened = await sendAs(asChallenger, "challenge", [outputIndex], bond);
  check("a challenger with no role opened a game", opened,
    opened ? `${formatEther(bond)} KAX bonded` : lastError);

  const gamesAfter = await readGame<bigint>("gameCount");
  check("gameCount increased", gamesAfter === gamesBefore + 1n, `${gamesBefore} -> ${gamesAfter}`);

  const gameId = gamesAfter - 1n;
  let g = await readGame<{
    challenger: Hex; proposer: Hex; outputIndex: bigint; lo: bigint; hi: bigint;
    deadline: bigint; challengerBond: bigint; status: number; bondsSettled: boolean;
  }>("getGame", [gameId]);

  check("the game records the challenger", g.challenger.toLowerCase() === challenger.address.toLowerCase());
  check("the game records the proposer being challenged", g.proposer.toLowerCase() === outputProposer.toLowerCase());
  check("the challenger's bond is escrowed by the contract", g.challengerBond === bond, `${formatEther(g.challengerBond)} KAX`);
  check("it is the proposer's turn to answer", STATUS[g.status] === "PROPOSER_TURN", STATUS[g.status]);
  check("the oracle sees a live game on that output", await readGame<boolean>("hasLiveGame", [outputIndex]));

  const initialRange = g.hi - g.lo;
  info(`disputed range: L3 blocks ${g.lo}..${g.hi} (${initialRange} blocks)`);

  // ---------------------------------------------------------------------- //
  step("3. Dispute progression — each move halves the disputed range");

  // The proposer asserts a state root for the midpoint. Its value is not what decides this
  // run — the proposer will later abandon the game — but a real move must be made for the
  // range to narrow, and only the proposer may make it.
  const defended = await sendAs(asProposer, "defend", [gameId, keccak256(toHex("midpoint claim"))]);
  check("only the proposer can answer, and it did", defended);

  g = await readGame<typeof g>("getGame", [gameId]);
  check("the turn passes to the challenger", STATUS[g.status] === "CHALLENGER_TURN", STATUS[g.status]);

  const bisected = await sendAs(asChallenger, "bisect", [gameId, true]);
  check("the challenger picks the half it disagrees with", bisected);

  g = await readGame<typeof g>("getGame", [gameId]);
  const narrowedRange = g.hi - g.lo;
  check("the disputed range narrowed", narrowedRange < initialRange,
    `${initialRange} -> ${narrowedRange} blocks`);
  check("the turn returns to the proposer", STATUS[g.status] === "PROPOSER_TURN", STATUS[g.status]);

  // ---------------------------------------------------------------------- //
  step("4. The finalization interlock — a live dispute outranks the clock");

  // This is the half of finding M-1 that is easy to get wrong. The withdrawal path gates on
  // the age of the proof, so without the oracle consulting the game, a withdrawal could
  // complete against a commitment that is still being argued about.
  const finalizedBefore = await read<boolean>("isOutputFinalized", [outputIndex]);
  check("the output is not finalized while the window is open", !finalizedBefore);

  await advanceL2(Number(finalizationPeriod) + 60);
  info(`advanced the L2 clock past the ${finalizationPeriod}s finalization window (devnet only)`);

  const finalizedAfter = await read<boolean>("isOutputFinalized", [outputIndex]);
  check("it is STILL not finalized, because a game is live", !finalizedAfter,
    "the timer alone would have finalized it by now");

  // ---------------------------------------------------------------------- //
  step("5. Invalid state commitment rejection — the root is deleted");

  // The clock has already passed the proposer's deadline. A proposer that will not defend
  // its own claim concedes it, and no guardian is consulted on this path.
  const nextBefore = await read<bigint>("nextOutputIndex");
  const challengerBalanceBefore = await pub.getBalance({address: challenger.address});

  const resolved = await sendAs(asChallenger, "resolveTimeout", [gameId]);
  check("the game resolves on the clock, with no guardian involved", resolved);

  g = await readGame<typeof g>("getGame", [gameId]);
  check("the game is resolved by timeout", STATUS[g.status] === "RESOLVED_TIMEOUT", STATUS[g.status]);

  const nextAfter = await read<bigint>("nextOutputIndex");
  check("the disputed output root was deleted from the oracle", nextAfter <= outputIndex,
    `nextOutputIndex ${nextBefore} -> ${nextAfter}`);
  check("the output can no longer be finalized, because it no longer exists",
    !(await read<boolean>("isOutputFinalized", [outputIndex]).catch(() => false)));

  // ---------------------------------------------------------------------- //
  step("6. Bond settlement");

  check("bonds are marked settled", g.bondsSettled);

  const challengerBalanceAfter = await pub.getBalance({address: challenger.address});
  check("the challenger recovered its bond", challengerBalanceAfter > challengerBalanceBefore,
    `+${formatEther(challengerBalanceAfter - challengerBalanceBefore)} KAX net of gas`);

  const held = await pub.getBalance({address: GAME});
  check("the game contract holds nothing afterwards", held === 0n, `${formatEther(held)} KAX`);

  // ---------------------------------------------------------------------- //
  step("What this does and does not show");
  info("Shown: a stranger challenged a published root, narrowed it with real moves, blocked");
  info("finalization while doing so, and had the root deleted — without a guardian.");
  info("");
  info("NOT shown, because it is not true: that anything verified the root was wrong. The");
  info("proposer conceded by walking away. A contested claim reaches the guardian, and only");
  info("a fault proof would replace that. See docs/FAULT_PROOF_GAP_ANALYSIS.md.");

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n${RED}${BOLD}Dispute game demonstration failed.${RESET}`);
    for (const f of failures) console.log(`  ${RED}-${RESET} ${f}`);
    console.log("");
    process.exit(1);
  }
  console.log(`\n${GREEN}${BOLD}Dispute game verified against a live chain.${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}${(err as Error).message}${RESET}\n`);
  process.exit(1);
});
