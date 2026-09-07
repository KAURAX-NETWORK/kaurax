#!/usr/bin/env node
/** Entry point for the KAURAX L3 node. */
import {KauraxNode} from "./index.js";
import {createLogger} from "./log.js";

const log = createLogger("main");

async function main(): Promise<void> {
  const node = new KauraxNode();
  await node.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    try {
      await node.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", {reason: String(reason)});
  });
}

main().catch((err: Error) => {
  log.error("KAURAX node failed to start", {error: err.message});
  process.stderr.write(`\n${err.stack ?? err.message}\n`);
  process.exit(1);
});
