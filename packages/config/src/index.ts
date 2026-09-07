/**
 * KAURAX configuration.
 *
 * Every operational parameter of the L3 lives here and is read from the environment, so
 * that no chain ID, RPC URL, contract address or key is compiled into any component.
 */
import {config as loadDotenv} from "dotenv";
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk upward until a directory containing pnpm-workspace.yaml is found. */
export function repoRoot(from: string = HERE): string {
  let dir = from;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let dotenvLoaded = false;
function ensureDotenv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const root = repoRoot();
  for (const file of [".env", ".env.local"]) {
    const p = resolve(root, file);
    if (existsSync(p)) loadDotenv({path: p, override: false});
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function env(key: string, fallback?: string): string {
  ensureDotenv();
  const v = process.env[key];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(
    `Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`,
  );
}

function envOptional(key: string): string | undefined {
  ensureDotenv();
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

function envInt(key: string, fallback?: number): number {
  const raw = envOptional(key);
  if (raw === undefined) {
    if (fallback === undefined) throw new ConfigError(`Missing required numeric variable ${key}`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigError(`${key} must be a number, got "${raw}"`);
  return n;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = envOptional(key);
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

/** An 0x-prefixed 20-byte address, or undefined when not yet deployed. */
export type Address = `0x${string}`;

function envAddress(key: string): Address | undefined {
  const raw = envOptional(key);
  if (raw === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new ConfigError(`${key} is not a valid 20-byte address: "${raw}"`);
  }
  return raw.toLowerCase() as Address;
}

function envPrivateKey(key: string, required: boolean): `0x${string}` | undefined {
  const raw = envOptional(key);
  if (raw === undefined) {
    if (required) throw new ConfigError(`Missing required key ${key}. See docs/security.md.`);
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    // Deliberately does not echo the value.
    throw new ConfigError(`${key} is not a valid 32-byte hex private key.`);
  }
  return raw as `0x${string}`;
}

export type Profile = "devnet" | "testnet";
export type DaMode = "calldata" | "blob" | "altda";
export type SignerMode = "local" | "remote";

export interface KauraxConfig {
  profile: Profile;

  /** Layer 1: Ethereum. KAURAX settles here only indirectly, through the L2. */
  l1: {rpcUrl: string; wsUrl: string | undefined; chainId: number};

  /** Layer 2: the underlying rollup KAURAX settles to. Configurable, never hardcoded. */
  l2: {
    rpcUrl: string;
    wsUrl: string | undefined;
    chainId: number;
    name: string;
    blockTimeSeconds: number;
  };

  /** Layer 3: KAURAX itself. */
  l3: {
    chainId: number;
    rpcUrl: string;
    wsUrl: string;
    /** Internal execution-engine endpoint. Never exposed publicly. */
    engineRpcUrl: string;
    blockTimeSeconds: number;
    gasLimit: number;
    nativeCurrency: {name: string; symbol: string; decimals: number};
  };

  /**
   * First KAURAX block produced by the sequencer is genesisBlock + 1. Blocks at or below
   * this height are genesis state, distributed as a config artifact rather than through
   * data availability.
   */
  genesisBlock: number;

  /**
   * Write-ahead log for sequenced block payloads. Between sealing a block and the batcher
   * publishing it, this file is the only copy of those transactions.
   */
  walPath: string;
  /** Durable record of how far deposit derivation has got. See docs/bridge.md. */
  derivationCheckpointPath: string;
  /** Operator override for where derivation resumes. Undefined in normal operation. */
  derivationFromL2Block: bigint | undefined;

  /** Settlement contract addresses on the L2. Undefined until deployed. */
  contracts: {
    portal: Address | undefined;
    outputOracle: Address | undefined;
    batchInbox: Address | undefined;
    l2Bridge: Address | undefined;
  };

  /** Fixed KAURAX predeploy addresses. */
  predeploys: {messagePasser: Address; l3ERC20Bridge: Address};

  batcher: {intervalSeconds: number; maxL3BlocksPerBatch: number};
  proposer: {intervalSeconds: number};
  bridge: {challengeWindowSeconds: number};
  da: {mode: DaMode; altdaEndpoint: string | undefined; maxBatchBytes: number};

  /**
   * true  => settlement contracts live on a local L2. Contract calls are real, the chain
   *          is local. This is the devnet.
   * false => settlement contracts must already exist on the configured public L2.
   */
  localDevSettlement: boolean;

  keys: {
    sequencer: `0x${string}` | undefined;
    batcher: `0x${string}` | undefined;
    proposer: `0x${string}` | undefined;
  };

  /**
   * How operator keys are held.
   *
   * `local` reads raw private keys from the environment. It is the only mode a devnet
   * needs and the mode you should never run a public network with, because the key is
   * readable by anything that can read the process environment.
   *
   * `remote` never sees a private key. The node sends a 32-byte hash to a signing service
   * and receives a signature back; the key lives in that service (or in the HSM/KMS behind
   * it). See docs/key-management.md.
   */
  signer: {
    mode: SignerMode;
    remoteUrl: string | undefined;
    remoteToken: string | undefined;
    timeoutMs: number;
    /**
     * Expected addresses per role. In `remote` mode these are how the node learns which
     * address it is signing as; if the service answers with a different one, startup fails
     * rather than quietly settling from an unexpected account.
     */
    addresses: {
      sequencer: Address | undefined;
      batcher: Address | undefined;
      proposer: Address | undefined;
    };
  };

  metrics: {enabled: boolean; port: number};
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Fixed predeploy addresses, mirrored in chain/genesis and the deployment script. */
export const PREDEPLOYS = {
  /** Origin of every L3 -> L2 withdrawal. */
  messagePasser: "0x4200000000000000000000000000000000000016" as Address,
  /** KAURAX-side ERC-20 bridge. */
  l3ERC20Bridge: "0x4200000000000000000000000000000000000010" as Address,
} as const;

export function loadConfig(): KauraxConfig {
  ensureDotenv();

  const profile = env("KAURAX_PROFILE", "devnet") as Profile;
  if (profile !== "devnet" && profile !== "testnet") {
    throw new ConfigError(`KAURAX_PROFILE must be "devnet" or "testnet", got "${profile}"`);
  }

  const signerMode = env("KAURAX_SIGNER_MODE", "local") as SignerMode;
  if (!["local", "remote"].includes(signerMode)) {
    throw new ConfigError(`KAURAX_SIGNER_MODE must be local|remote, got "${signerMode}"`);
  }

  const daMode = env("DA_MODE", "calldata") as DaMode;
  if (!["calldata", "blob", "altda"].includes(daMode)) {
    throw new ConfigError(`DA_MODE must be calldata|blob|altda, got "${daMode}"`);
  }

  const cfg: KauraxConfig = {
    profile,
    l1: {
      rpcUrl: env("L1_RPC_URL"),
      wsUrl: envOptional("L1_WS_URL"),
      chainId: envInt("L1_CHAIN_ID"),
    },
    l2: {
      rpcUrl: env("L2_RPC_URL"),
      wsUrl: envOptional("L2_WS_URL"),
      chainId: envInt("L2_CHAIN_ID"),
      name: env("L2_NAME", "underlying-l2"),
      blockTimeSeconds: envInt("L2_BLOCK_TIME", 2),
    },
    l3: {
      chainId: envInt("KAURAX_CHAIN_ID"),
      rpcUrl: env("KAURAX_RPC_URL"),
      wsUrl: env("KAURAX_WS_URL"),
      engineRpcUrl: env("KAURAX_ENGINE_RPC_URL"),
      blockTimeSeconds: envInt("KAURAX_BLOCK_TIME", 2),
      gasLimit: envInt("KAURAX_GAS_LIMIT", 30_000_000),
      nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
    },
    genesisBlock: envInt("KAURAX_GENESIS_BLOCK", 0),
    walPath: env("KAURAX_WAL_PATH", resolve(repoRoot(), ".devnet", "sequencer-wal.jsonl")),
    derivationCheckpointPath: env(
      "KAURAX_DERIVATION_CHECKPOINT_PATH",
      resolve(repoRoot(), ".devnet", "derivation-cursor.json"),
    ),
    derivationFromL2Block: envOptional("KAURAX_DERIVATION_FROM_L2_BLOCK") === undefined
      ? undefined
      : BigInt(envOptional("KAURAX_DERIVATION_FROM_L2_BLOCK")!),
    contracts: {
      portal: envAddress("KAURAX_PORTAL_ADDRESS"),
      outputOracle: envAddress("KAURAX_OUTPUT_ORACLE_ADDRESS"),
      batchInbox: envAddress("KAURAX_BATCH_INBOX_ADDRESS"),
      l2Bridge: envAddress("KAURAX_L2_BRIDGE_ADDRESS"),
    },
    predeploys: {...PREDEPLOYS},
    batcher: {
      intervalSeconds: envInt("BATCH_SUBMISSION_INTERVAL", 12),
      maxL3BlocksPerBatch: envInt("BATCH_MAX_L3_BLOCKS", 50),
    },
    proposer: {intervalSeconds: envInt("OUTPUT_PROPOSAL_INTERVAL", 24)},
    bridge: {challengeWindowSeconds: envInt("WITHDRAWAL_CHALLENGE_WINDOW", 120)},
    da: {
      mode: daMode,
      altdaEndpoint: envOptional("DA_ALTDA_ENDPOINT"),
      maxBatchBytes: envInt("DA_MAX_BATCH_BYTES", 128_000),
    },
    localDevSettlement: envBool("LOCAL_DEV_SETTLEMENT", profile === "devnet"),
    keys: {
      sequencer: envPrivateKey("SEQUENCER_PRIVATE_KEY", false),
      batcher: envPrivateKey("BATCHER_PRIVATE_KEY", false),
      proposer: envPrivateKey("PROPOSER_PRIVATE_KEY", false),
    },
    signer: {
      mode: signerMode,
      remoteUrl: envOptional("KAURAX_SIGNER_URL"),
      remoteToken: envOptional("KAURAX_SIGNER_TOKEN"),
      timeoutMs: envInt("KAURAX_SIGNER_TIMEOUT_MS", 10_000),
      addresses: {
        sequencer: envAddress("SEQUENCER_ADDRESS"),
        batcher: envAddress("BATCHER_ADDRESS"),
        proposer: envAddress("PROPOSER_ADDRESS"),
      },
    },
    metrics: {enabled: envBool("METRICS_ENABLED", true), port: envInt("METRICS_PORT", 7300)},
    logLevel: (envOptional("LOG_LEVEL") ?? "info") as KauraxConfig["logLevel"],
  };

  validate(cfg);
  return cfg;
}

function validate(cfg: KauraxConfig): void {
  const problems: string[] = [];

  // A shared chain ID between layers would let a signed transaction be replayed from one
  // layer onto another.
  const ids = [cfg.l1.chainId, cfg.l2.chainId, cfg.l3.chainId];
  if (new Set(ids).size !== ids.length) {
    problems.push(`L1, L2 and L3 chain IDs must all differ (got ${ids.join(", ")})`);
  }
  if (!Number.isInteger(cfg.l3.chainId) || cfg.l3.chainId <= 0) {
    problems.push(`KAURAX_CHAIN_ID must be a positive integer`);
  }
  if (cfg.l3.blockTimeSeconds <= 0) problems.push("KAURAX_BLOCK_TIME must be > 0");
  if (cfg.l3.gasLimit < 1_000_000) problems.push("KAURAX_GAS_LIMIT is implausibly low");

  if (cfg.profile === "testnet" && cfg.localDevSettlement) {
    problems.push(
      "LOCAL_DEV_SETTLEMENT=true is not permitted with KAURAX_PROFILE=testnet: " +
        "a public network must settle against real contracts on a real L2.",
    );
  }
  if (cfg.da.mode === "altda" && !cfg.da.altdaEndpoint) {
    problems.push("DA_MODE=altda requires DA_ALTDA_ENDPOINT");
  }

  if (cfg.signer.mode === "remote") {
    if (!cfg.signer.remoteUrl) {
      problems.push("KAURAX_SIGNER_MODE=remote requires KAURAX_SIGNER_URL");
    }
    // A remote signer that is reachable without a credential is reachable by anything else
    // on the same network, and it signs whatever it is asked to sign.
    if (!cfg.signer.remoteToken) {
      problems.push("KAURAX_SIGNER_MODE=remote requires KAURAX_SIGNER_TOKEN");
    }
    // Raw keys in the environment defeat the entire point of using a remote signer.
    const leaked = (["sequencer", "batcher", "proposer"] as const).filter((r) => cfg.keys[r] !== undefined);
    if (leaked.length > 0) {
      problems.push(
        `KAURAX_SIGNER_MODE=remote but raw private keys are still set for: ${leaked.join(", ")}. ` +
          `Remove them from the environment; the signing service holds them now.`,
      );
    }
  }

  // A public network must not hold its operator keys as plain environment variables.
  if (cfg.profile === "testnet" && cfg.signer.mode === "local" && !cfg.localDevSettlement) {
    const held = (["sequencer", "batcher", "proposer"] as const).filter((r) => cfg.keys[r] !== undefined);
    if (held.length > 0 && env("KAURAX_ALLOW_LOCAL_KEYS", "false") !== "true") {
      problems.push(
        `KAURAX_PROFILE=testnet with KAURAX_SIGNER_MODE=local keeps operator keys (${held.join(", ")}) ` +
          `in plain environment variables. Use KAURAX_SIGNER_MODE=remote (docs/key-management.md), ` +
          `or set KAURAX_ALLOW_LOCAL_KEYS=true to accept the risk deliberately.`,
      );
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(`Invalid KAURAX configuration:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Read the addresses written by `forge script DeploySettlement`, if present. This is how
 * the devnet hands deployed addresses to the node without anyone editing a file by hand.
 */
export function readDeployment(chainId: number): Record<string, string> | undefined {
  const p = resolve(repoRoot(), "blockchain", "contracts", "deployments", `${chainId}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
  } catch {
    return undefined;
  }
}

/**
 * Wallet-facing network descriptor. This is exactly what a user needs to add KAURAX to
 * MetaMask or any EIP-1193 wallet.
 */
export function networkDescriptor(cfg: KauraxConfig, explorerUrl?: string) {
  return {
    chainId: `0x${cfg.l3.chainId.toString(16)}`,
    chainIdDecimal: cfg.l3.chainId,
    chainName: cfg.profile === "devnet" ? "KAURAX Devnet" : "KAURAX Testnet",
    nativeCurrency: cfg.l3.nativeCurrency,
    rpcUrls: [cfg.l3.rpcUrl],
    wsUrls: [cfg.l3.wsUrl],
    blockExplorerUrls: explorerUrl ? [explorerUrl] : [],
  };
}
