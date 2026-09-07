/**
 * Health endpoints.
 *
 * Every check performs a real operation — a real query, a real RPC call, a real HTTP
 * request to the indexer. Nothing reports "ok" because a process is running; it reports
 * "ok" because the dependency answered.
 *
 * Status codes matter here: deployment automation gates on them.
 *   200 everything healthy
 *   503 at least one dependency is down
 */
import type {FastifyInstance} from "fastify";
import type {HealthCheck, HealthResponse, HealthState} from "@kaurax/types";
import type {Context} from "../context.js";

async function timed(name: string, fn: () => Promise<string | null>): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const detail = await fn();
    return {name, status: "ok", latencyMs: Date.now() - started, detail};
  } catch (err) {
    return {name, status: "down", latencyMs: Date.now() - started, detail: (err as Error).message};
  }
}

async function checkRpc(ctx: Context): Promise<HealthCheck> {
  return timed("rpc", async () => {
    const chainId = Number(BigInt(await ctx.rpc.call<string>("eth_chainId")));
    if (chainId !== ctx.cfg.chainId) {
      throw new Error(`RPC reports chain ${chainId}, API is configured for ${ctx.cfg.chainId}`);
    }
    const head = BigInt(await ctx.rpc.call<string>("eth_blockNumber"));
    return `chain ${chainId} at block ${head}`;
  });
}

async function checkDatabase(ctx: Context): Promise<HealthCheck> {
  if (!ctx.db) {
    return {
      name: "database",
      status: "down",
      latencyMs: null,
      detail: "DATABASE_URL is not configured on this API instance",
    };
  }
  return timed("database", async () => {
    const {rows} = await ctx.db!.query<{n: string}>("SELECT count(*)::text AS n FROM blocks");
    return `reachable, ${rows[0]?.n ?? "0"} blocks indexed`;
  });
}

async function checkIndexer(ctx: Context): Promise<HealthCheck> {
  return timed("indexer", async () => {
    const res = await fetch(ctx.cfg.indexerHealthUrl, {signal: AbortSignal.timeout(5000)});
    const body = (await res.json()) as {
      status?: string;
      lastIndexedBlock?: string;
      lagBlocks?: number | null;
      lastError?: string | null;
    };
    if (!res.ok || body.status !== "ok") {
      throw new Error(body.lastError ?? `indexer reported ${body.status ?? res.status}`);
    }
    const lag = body.lagBlocks;
    return `block ${body.lastIndexedBlock}${lag === null || lag === undefined ? "" : `, ${lag} behind head`}`;
  });
}

function overall(checks: HealthCheck[]): HealthState {
  if (checks.every((c) => c.status === "ok")) return "ok";
  if (checks.some((c) => c.name === "rpc" && c.status === "down")) return "down";
  return "degraded";
}

export function registerHealthRoutes(app: FastifyInstance, ctx: Context): void {
  app.get("/api/health", async (_req, reply) => {
    const checks = await Promise.all([checkRpc(ctx), checkDatabase(ctx), checkIndexer(ctx)]);
    const status = overall(checks);

    const body: HealthResponse = {
      status,
      network: `kaurax-${process.env.KAURAX_PROFILE ?? "devnet"}`,
      rpc: checks.find((c) => c.name === "rpc")?.status === "ok",
      database: checks.find((c) => c.name === "database")?.status === "ok",
      indexer: checks.find((c) => c.name === "indexer")?.status === "ok",
      checks,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
      version: ctx.cfg.version,
    };

    return reply.code(status === "ok" ? 200 : 503).send(body);
  });

  app.get("/api/health/rpc", async (_req, reply) => {
    const check = await checkRpc(ctx);
    return reply.code(check.status === "ok" ? 200 : 503).send(check);
  });

  app.get("/api/health/database", async (_req, reply) => {
    const check = await checkDatabase(ctx);
    return reply.code(check.status === "ok" ? 200 : 503).send(check);
  });

  app.get("/api/health/indexer", async (_req, reply) => {
    const check = await checkIndexer(ctx);
    return reply.code(check.status === "ok" ? 200 : 503).send(check);
  });

  /**
   * Readiness — should this instance receive traffic. Distinct from liveness: a draining
   * process is alive and must stay alive long enough to finish what it is holding, but
   * must not be given anything new.
   */
  app.get("/api/health/ready", async (_req, reply) => {
    if (ctx.isDraining()) {
      return reply.code(503).send({status: "draining", ready: false});
    }
    const rpc = await checkRpc(ctx);
    return reply.code(rpc.status === "ok" ? 200 : 503).send({
      status: rpc.status === "ok" ? "ok" : "down",
      ready: rpc.status === "ok",
      rpc: rpc.detail,
    });
  });

  /** Liveness only — is this process up. Used by Docker HEALTHCHECK. */
  app.get("/api/health/live", async () => ({status: "ok", uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000)}));
}
