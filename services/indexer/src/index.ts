#!/usr/bin/env node
/**
 * KAURAX indexer entry point.
 *
 * Applies migrations, then indexes continuously. Exposes a small HTTP endpoint on
 * INDEXER_METRICS_PORT for health and Prometheus scraping — deliberately separate from the
 * public API so the indexer can be probed even when the API is down.
 */
import {createServer} from "node:http";
import {loadIndexerConfig} from "./config.js";
import {createPool, waitForDatabase} from "./db.js";
import {migrate} from "./migrate.js";
import {Indexer} from "./indexer.js";
import {createLogger, setLogLevel} from "./log.js";

const log = createLogger("main");

async function main(): Promise<void> {
  const cfg = loadIndexerConfig();
  setLogLevel(cfg.logLevel);

  log.info("starting KAURAX indexer", {chainId: cfg.chainId, rpc: cfg.rpcUrl});

  const applied = await migrate(cfg.databaseUrl);
  if (applied > 0) log.info("migrations applied", {count: applied});

  const pool = createPool(cfg.databaseUrl);
  await waitForDatabase(pool);

  const indexer = new Indexer(cfg, pool);
  await indexer.start();

  const server = createServer((req, res) => {
    const status = indexer.status();

    if (req.url === "/health") {
      const healthy = status.running && status.lastError === null;
      res.writeHead(healthy ? 200 : 503, {"content-type": "application/json"});
      res.end(JSON.stringify({status: healthy ? "ok" : "degraded", ...status}, null, 2));
      return;
    }

    if (req.url === "/metrics") {
      const lines = [
        "# HELP kaurax_indexer_last_block Last block written to the database",
        "# TYPE kaurax_indexer_last_block gauge",
        `kaurax_indexer_last_block ${status.lastIndexedBlock}`,
        "# HELP kaurax_indexer_blocks_total Blocks indexed since start",
        "# TYPE kaurax_indexer_blocks_total counter",
        `kaurax_indexer_blocks_total ${status.blocksIndexed}`,
        "# HELP kaurax_indexer_transactions_total Transactions indexed since start",
        "# TYPE kaurax_indexer_transactions_total counter",
        `kaurax_indexer_transactions_total ${status.transactionsIndexed}`,
        "# HELP kaurax_indexer_healthy 1 when indexing without error",
        "# TYPE kaurax_indexer_healthy gauge",
        `kaurax_indexer_healthy ${status.running && status.lastError === null ? 1 : 0}`,
      ];
      // Lag is only emitted when the chain head is actually known. An absent series means
      // "not measured", which is different from zero lag.
      if (status.lagBlocks !== null) {
        lines.push(
          "# HELP kaurax_indexer_lag_blocks Blocks behind the chain head",
          "# TYPE kaurax_indexer_lag_blocks gauge",
          `kaurax_indexer_lag_blocks ${status.lagBlocks}`,
        );
      }
      res.writeHead(200, {"content-type": "text/plain; version=0.0.4"});
      res.end(lines.join("\n") + "\n");
      return;
    }

    res.writeHead(404, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "not found", endpoints: ["/health", "/metrics"]}));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.metricsPort, "0.0.0.0", resolve);
  });
  log.info("indexer health/metrics listening", {port: cfg.metricsPort});

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    indexer.stop();
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: Error) => {
  log.error("indexer failed to start", {error: err.message});
  process.stderr.write(`\n${err.stack ?? err.message}\n`);
  process.exit(1);
});
