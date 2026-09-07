/** API configuration. Environment only — no compiled-in URLs, keys or chain IDs. */
export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string | null;
  rpcUrl: string;
  wsUrl: string | null;
  chainId: number;
  explorerUrl: string;
  l2: {chainId: number | null; name: string | null; rpcUrl: string | null};
  indexerHealthUrl: string;
  corsOrigins: string[];
  rateLimit: {max: number; timeWindow: string};
  ai: {baseUrl: string; apiKey: string | null; model: string};
  /**
   * Devnet faucet. Disabled unless a key is configured, because a faucet on a network
   * where the gas token has value would simply be theft.
   */
  faucet: {
    privateKey: string | null;
    amountKax: string;
    cooldownHours: number;
  };
  version: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new ConfigError(`${key} is not set. See .env.example.`);
  return v;
}

function optional(key: string): string | null {
  const v = process.env[key];
  return v === undefined || v === "" ? null : v;
}

function num(key: string, fallback: number): number {
  const raw = optional(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigError(`${key} must be a number, got "${raw}"`);
  return n;
}

export function loadApiConfig(): ApiConfig {
  // CORS_ORIGINS is accepted as well as API_CORS_ORIGINS. Setting the wrong one of these
  // is silent and expensive: the allow-list ends up empty, @fastify/cors answers no
  // preflight, and every cross-origin browser call fails while curl — which sends no
  // preflight — keeps working. That combination is very hard to read from the outside.
  const origins = (optional("API_CORS_ORIGINS") ?? optional("CORS_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.includes("*")) {
    throw new ConfigError(
      'API_CORS_ORIGINS must not be "*". List the exact origins allowed to call this API.',
    );
  }

  return {
    host: optional("API_HOST") ?? "0.0.0.0",
    port: num("API_PORT", 4000),
    // The API degrades gracefully without a database: chain reads still work, indexed
    // history does not, and /api/health reports database: false rather than pretending.
    databaseUrl: optional("DATABASE_URL"),
    rpcUrl: required("KAURAX_RPC_URL"),
    wsUrl: optional("KAURAX_WS_URL"),
    chainId: Number(required("KAURAX_CHAIN_ID")),
    explorerUrl: optional("NEXT_PUBLIC_KAURAX_EXPLORER_URL") ?? "",
    l2: {
      chainId: optional("L2_CHAIN_ID") ? Number(optional("L2_CHAIN_ID")) : null,
      name: optional("L2_NAME"),
      rpcUrl: optional("L2_RPC_URL"),
    },
    indexerHealthUrl:
      optional("INDEXER_HEALTH_URL") ?? `http://127.0.0.1:${num("INDEXER_METRICS_PORT", 7301)}/health`,
    corsOrigins: origins,
    rateLimit: {
      max: num("API_RATE_LIMIT_MAX", 120),
      timeWindow: optional("API_RATE_LIMIT_WINDOW") ?? "1 minute",
    },
    ai: {
      baseUrl: optional("XKIRO_BASE_URL") ?? "https://api.xkiro.com/v1",
      // Server-side only. Absent means the AI endpoints report themselves unconfigured
      // rather than failing mysteriously or inventing a reply.
      apiKey: optional("XKIRO_API_KEY"),
      model: optional("XKIRO_MODEL") ?? "openai/gpt-5.6-sol",
    },
    faucet: {
      // Absent means no faucet. The endpoint then reports itself unconfigured rather than
      // failing in a way a caller has to guess at.
      privateKey: optional("FAUCET_PRIVATE_KEY"),
      amountKax: optional("FAUCET_AMOUNT_KAX") ?? "100",
      cooldownHours: Number(optional("FAUCET_COOLDOWN_HOURS") ?? 6),
    },
    version: process.env.KAURAX_VERSION ?? "0.1.0",
  };
}
