/**
 * Indexer configuration. Every value comes from the environment; nothing is compiled in.
 */
export interface IndexerConfig {
  databaseUrl: string;
  rpcUrl: string;
  chainId: number;
  /** Block to start from when the database is empty. */
  startBlock: bigint;
  /** How many blocks to request per pass. */
  batchSize: number;
  /** Sleep between passes when caught up, in milliseconds. */
  pollIntervalMs: number;
  /** How many confirmations to stay behind head. 0 is correct for a single-sequencer L3. */
  confirmations: number;
  metricsPort: number;
  logLevel: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new ConfigError(
      `${key} is not set. The indexer cannot start without it — see .env.example.`,
    );
  }
  return v;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigError(`${key} must be a number, got "${raw}"`);
  return n;
}

export function loadIndexerConfig(): IndexerConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    rpcUrl: required("KAURAX_RPC_URL"),
    chainId: num("KAURAX_CHAIN_ID", 0) || Number(required("KAURAX_CHAIN_ID")),
    startBlock: BigInt(process.env.INDEXER_START_BLOCK ?? "0"),
    batchSize: num("INDEXER_BATCH_SIZE", 20),
    pollIntervalMs: num("INDEXER_POLL_INTERVAL_MS", 1000),
    confirmations: num("INDEXER_CONFIRMATIONS", 0),
    metricsPort: num("INDEXER_METRICS_PORT", 7301),
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
