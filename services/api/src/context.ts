/** Shared request context: database pool (optional) and RPC access. */
import pg from "pg";
import type {ApiConfig} from "./config.js";

pg.types.setTypeParser(1700, (v: string) => v); // numeric -> string, uint256-safe
pg.types.setTypeParser(20, (v: string) => v); // int8 -> string

export type Hex = `0x${string}`;

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export class Rpc {
  private id = 1;
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: this.id++, method, params}),
        signal: controller.signal,
      });
      if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as {result?: T; error?: {message: string}};
      if (body.error) throw new RpcError(`${method}: ${body.error.message}`);
      return body.result as T;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if ((err as Error).name === "AbortError") throw new RpcError(`${method}: timed out`);
      throw new RpcError(`${method}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface Context {
  cfg: ApiConfig;
  db: pg.Pool | null;
  rpc: Rpc;
  startedAt: number;
  /**
   * True once the process has received a shutdown signal. Set by the server; read by
   * /api/health/ready so a load balancer stops sending work before the socket closes.
   */
  isDraining: () => boolean;
}

export function createContext(cfg: ApiConfig): Context {
  const db = cfg.databaseUrl
    ? new pg.Pool({
        connectionString: cfg.databaseUrl,
        max: Number(process.env.PGPOOL_MAX ?? 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      })
    : null;

  // Replaced by the server once signal handlers are installed.
  return {cfg, db, rpc: new Rpc(cfg.rpcUrl), startedAt: Date.now(), isDraining: () => false};
}

/**
 * Thrown when a route needs indexed history and no database is configured. The handler
 * turns it into a 503 that says so, rather than returning an empty list that would look
 * like "this address has no transactions".
 */
export class DatabaseUnavailable extends Error {
  constructor() {
    super(
      "This endpoint requires the indexer database, which is not configured on this API instance. " +
        "Set DATABASE_URL and run the indexer.",
    );
    this.name = "DatabaseUnavailable";
  }
}

export function requireDb(ctx: Context): pg.Pool {
  if (!ctx.db) throw new DatabaseUnavailable();
  return ctx.db;
}

/** Clamp pagination so a caller cannot ask for the whole table. */
export function pagination(query: Record<string, unknown>): {limit: number; offset: number} {
  const rawLimit = Number(query.limit ?? 25);
  const rawOffset = Number(query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 25;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  return {limit, offset};
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function isAddress(v: unknown): v is Hex {
  return typeof v === "string" && ADDRESS.test(v);
}
export function isHash(v: unknown): v is Hex {
  return typeof v === "string" && HASH.test(v);
}
