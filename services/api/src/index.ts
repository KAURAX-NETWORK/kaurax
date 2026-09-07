#!/usr/bin/env node
/**
 * KAURAX backend API.
 *
 *   frontends ──► API ──► KAURAX RPC        (live chain state)
 *                     └─► PostgreSQL        (indexed history)
 *                     └─► xKiro             (AI, server-side key)
 *
 * The API is stateless: it can be restarted or scaled horizontally without coordination.
 * All state lives in PostgreSQL and on chain.
 */
import Fastify from "fastify";
import {randomUUID} from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import {loadApiConfig} from "./config.js";
import {createContext, DatabaseUnavailable} from "./context.js";
import {registerHealthRoutes} from "./routes/health.js";
import {registerChainRoutes} from "./routes/chain.js";
import {registerAnalyticsRoutes} from "./routes/analytics.js";
import {registerPaymentRoutes} from "./routes/payments.js";
import {registerAiRoutes} from "./routes/ai.js";
import {registerFeatureRoutes} from "./routes/features.js";

async function main(): Promise<void> {
  const cfg = loadApiConfig();
  const ctx = createContext(cfg);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Never log an Authorization header or a cookie: this process holds the AI key.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
    bodyLimit: 1_000_000,
    // One id follows a request from Nginx through the API into the logs, so a user report
    // ("request abc123 failed") can be traced without guessing from timestamps. An
    // inbound id is honoured only if it looks like one — it ends up in log output.
    genReqId: (req) => {
      const supplied = req.headers["x-request-id"];
      if (typeof supplied === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(supplied)) return supplied;
      return randomUUID();
    },
  });

  // Echo the id back so a caller can quote it, and so a browser can surface it on failure.
  app.addHook("onRequest", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });

  /**
   * Readiness is separate from liveness. During shutdown the process is still alive and
   * still finishing in-flight requests, but must stop receiving new ones — the load
   * balancer needs a way to see that before the socket closes.
   */
  let draining = false;
  app.addHook("onRequest", async (req, reply) => {
    if (draining && !req.url.startsWith("/api/health")) {
      void reply.header("connection", "close");
      return reply.code(503).send({
        error: "shutting_down",
        message: "This instance is draining. Retry; another instance can serve you.",
        statusCode: 503,
      });
    }
  });
  ctx.isDraining = () => draining;

  await app.register(sensible);

  await app.register(cors, {
    // An explicit allowlist. loadApiConfig rejects "*" outright.
    origin: cfg.corsOrigins.length > 0 ? cfg.corsOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  });

  await app.register(rateLimit, {
    max: cfg.rateLimit.max,
    timeWindow: cfg.rateLimit.timeWindow,
    // Health checks must never be rate limited — deployment automation depends on them.
    allowList: (req) => req.url.startsWith("/api/health"),
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & {statusCode?: number};
    if (err instanceof DatabaseUnavailable) {
      return reply.code(503).send({error: "database_unavailable", message: err.message, statusCode: 503});
    }
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) req.log.error({err}, "request failed");
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_error",
      // A 5xx message is not echoed back: it can carry connection strings.
      message: statusCode >= 500 ? "The request could not be completed." : err.message,
      statusCode,
    });
  });

  app.get("/", async () => ({
    name: "KAURAX API",
    version: cfg.version,
    network: `kaurax-${process.env.KAURAX_PROFILE ?? "devnet"}`,
    chainId: cfg.chainId,
    endpoints: [
      "/api/health",
      "/api/network",
      "/api/features",
      "/api/blocks",
      "/api/transactions",
      "/api/address/:address",
      "/api/contracts",
      "/api/tokens",
      "/api/payments",
      "/api/analytics",
      "/api/ai/chat",
    ],
    note: "KAURAX is a testnet. KAX has no monetary value.",
  }));

  registerHealthRoutes(app, ctx);
  registerFeatureRoutes(app, ctx);
  registerChainRoutes(app, ctx);
  registerAnalyticsRoutes(app, ctx);
  registerPaymentRoutes(app, ctx);
  registerAiRoutes(app, ctx);

  await app.listen({host: cfg.host, port: cfg.port});
  app.log.info(
    {
      chainId: cfg.chainId,
      rpc: cfg.rpcUrl,
      database: cfg.databaseUrl ? "configured" : "NOT configured",
      ai: cfg.ai.apiKey ? "configured (xkiro)" : "NOT configured",
      cors: cfg.corsOrigins,
    },
    "KAURAX API listening",
  );

  /**
   * Graceful shutdown, in the order that actually matters:
   *   1. Fail readiness, so the proxy stops sending new work.
   *   2. Wait a beat for it to notice — otherwise requests are dropped in flight.
   *   3. Close the server, letting in-flight requests finish.
   *   4. Release the database pool.
   * A hard timer guarantees the process still exits if a request hangs.
   */
  const drainDelayMs = Number(process.env.SHUTDOWN_DRAIN_MS ?? 3000);
  const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      app.log.warn(`received ${signal} again while shutting down; ignoring`);
      return;
    }
    shuttingDown = true;
    draining = true;
    app.log.info({drainDelayMs, shutdownTimeoutMs}, `received ${signal}, draining`);

    // If anything below hangs, exit anyway. A stuck process is worse than a dropped request.
    const hardExit = setTimeout(() => {
      app.log.error("graceful shutdown timed out; exiting");
      process.exit(1);
    }, shutdownTimeoutMs);
    hardExit.unref();

    await new Promise((resolve) => setTimeout(resolve, drainDelayMs));
    await app.close();
    await ctx.db?.end().catch(() => undefined);
    app.log.info("shutdown complete");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: Error) => {
  process.stderr.write(`KAURAX API failed to start: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
