/**
 * Analytics.
 *
 * Every number here is counted from indexed rows or measured from observed blocks. Nothing
 * is projected, extrapolated or rounded up. A value the indexer cannot supply is `null`,
 * and the frontend renders that as "No data available".
 *
 * Notably absent, because KAURAX has none of them: TVL, user counts, partner counts,
 * revenue.
 */
import type {FastifyInstance} from "fastify";
import type {AnalyticsSummary} from "@kaurax/types";
import {requireDb, type Context} from "../context.js";

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: Context): void {
  app.get("/api/analytics", async () => {
    const db = requireDb(ctx);

    const [counts, gas, latest] = await Promise.all([
      db.query<{blocks: string; txs: string; addrs: string; contracts: string}>(`
        SELECT
          (SELECT count(*)::text FROM blocks)       AS blocks,
          (SELECT count(*)::text FROM transactions) AS txs,
          (SELECT count(*)::text FROM addresses)    AS addrs,
          (SELECT count(*)::text FROM contracts)    AS contracts`),
      db.query<{avg: string | null}>(
        "SELECT AVG(effective_gas_price)::text AS avg FROM transactions WHERE effective_gas_price IS NOT NULL",
      ),
      db.query<{number: string; timestamp: string}>(
        "SELECT number, timestamp FROM blocks ORDER BY number DESC LIMIT 1",
      ),
    ]);

    // Throughput is measured over the most recent 100 indexed blocks, and the window is
    // reported alongside it so the number cannot be quoted without its basis.
    const {rows: window} = await db.query<{
      span: string | null;
      txs: string;
      blocks: string;
    }>(`
      WITH recent AS (SELECT * FROM blocks ORDER BY number DESC LIMIT 100)
      SELECT (MAX(timestamp) - MIN(timestamp))::text AS span,
             COALESCE(SUM(transaction_count), 0)::text AS txs,
             count(*)::text AS blocks
      FROM recent`);

    const span = window[0]?.span ? Number(window[0].span) : 0;
    const txs = Number(window[0]?.txs ?? 0);
    const sampled = Number(window[0]?.blocks ?? 0);

    let head: bigint | null = null;
    try {
      head = BigInt(await ctx.rpc.call<string>("eth_blockNumber"));
    } catch {
      head = null;
    }
    const indexed = latest.rows[0]?.number ? BigInt(latest.rows[0].number) : null;

    const summary: AnalyticsSummary = {
      totalBlocks: counts.rows[0]?.blocks ?? null,
      totalTransactions: counts.rows[0]?.txs ?? null,
      totalAddresses: counts.rows[0]?.addrs ?? null,
      totalContracts: counts.rows[0]?.contracts ?? null,
      // Only report throughput when a real time span was observed.
      throughput:
        span > 0 ? {tps: Number((txs / span).toFixed(4)), windowSeconds: span, sampledBlocks: sampled} : null,
      averageGasPrice: gas.rows[0]?.avg ? String(Math.round(Number(gas.rows[0].avg))) : null,
      latestBlock: latest.rows[0]?.number ?? null,
      indexerLagBlocks: head !== null && indexed !== null ? Number(head - indexed) : null,
    };
    return summary;
  });

  /** Per-day block and transaction counts, for charting. Measured, not smoothed. */
  app.get("/api/analytics/daily", async (req) => {
    const db = requireDb(ctx);
    const days = Math.min(Math.max(Number((req.query as {days?: string}).days ?? 14), 1), 90);

    const {rows} = await db.query<{day: string; blocks: string; txs: string; gas_used: string}>(
      `SELECT to_char(to_timestamp(timestamp)::date, 'YYYY-MM-DD') AS day,
              count(*)::text                       AS blocks,
              COALESCE(SUM(transaction_count),0)::text AS txs,
              COALESCE(SUM(gas_used),0)::text      AS gas_used
       FROM blocks
       WHERE to_timestamp(timestamp) >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day`,
      [days],
    );
    return {days, series: rows};
  });
}
