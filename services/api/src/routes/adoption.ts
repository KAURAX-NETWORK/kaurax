/**
 * Adoption, counted in a way that cannot flatter the network.
 *
 *   GET /api/adoption
 *
 * /api/analytics already reports raw totals — every block, every transaction, every
 * address the indexer has seen. Those are the right numbers for an explorer and the wrong
 * numbers for answering "is anyone using this?", because on a testnet with a faucet the
 * cheapest way to raise all three is to run a loop.
 *
 * This endpoint reports a deliberately smaller number. A transaction is QUALIFYING only
 * when all of the following hold:
 *
 *   - it succeeded (status = 1);
 *   - it is not a faucet grant (the faucet's own transactions are excluded by hash);
 *   - it is not a self-transfer (from = to), which costs gas and moves nothing;
 *   - it is not the sender's only ever transaction when that transaction merely returns
 *     funds — see `excluded` below for exactly what is dropped and why.
 *
 * Addresses are counted as ACTIVE only when they sent a qualifying transaction, and as
 * RETURNING only when they did so on two or more distinct days — one session of clicking
 * through a tutorial is not retention.
 *
 * The `excluded` block reports what was removed and how much of it there was, so the gap
 * between this and /api/analytics is visible rather than something a reader has to take on
 * trust. If the honest number is small, the honest thing is to publish the small number.
 *
 * Nothing here is weighted, modelled or smoothed, and no figure is a target.
 */
import type {FastifyInstance} from "fastify";
import {requireDb, type Context} from "../context.js";

/**
 * Qualifying-transaction SQL, built against the faucet table only when it exists.
 *
 * The table is created lazily by the faucet route on its first grant, so a deployment that
 * has never run one does not have it. Guarding with `to_regclass` inside a WHERE clause
 * does NOT work — PostgreSQL resolves every relation in the statement at parse time, so a
 * query naming a missing table fails before any predicate runs. (It failed exactly that
 * way the first time this endpoint was called against a real database.) The table is
 * therefore probed first and the SQL is composed from the answer.
 *
 * Faucet grants are excluded by recorded transaction hash rather than by sender address:
 * matching on the address would also drop an operator funding a contract from the same
 * account, which is not a faucet grant.
 */
function qualifyingSql(faucetTracked: boolean): string {
  const notAFaucetGrant = faucetTracked
    ? "AND NOT EXISTS (SELECT 1 FROM faucet_grants f WHERE f.tx_hash = t.hash)"
    : "";

  return `
    SELECT t.*
    FROM transactions t
    WHERE t.status = 1
      AND (t.to_address IS NULL OR t.to_address <> t.from_address)
      ${notAFaucetGrant}`;
}

export function registerAdoptionRoutes(app: FastifyInstance, ctx: Context): void {
  app.get("/api/adoption", async (req) => {
    const db = requireDb(ctx);
    const days = Math.min(Math.max(Number((req.query as {days?: string}).days ?? 30), 1), 365);

    // The faucet table may not exist yet. Asking the catalogue once is cheaper than
    // guarding every subquery, and makes the answer explicit in the response.
    const {rows: faucetTable} = await db.query<{present: string | null}>(
      "SELECT to_regclass('public.faucet_grants')::text AS present",
    );
    const faucetTracked = faucetTable[0]?.present !== null;
    const QUALIFYING = qualifyingSql(faucetTracked);

    const [qualifying, returning, deployers, excluded, raw] = await Promise.all([
      db.query<{txs: string; senders: string; days_active: string}>(`
        WITH q AS (${QUALIFYING})
        SELECT count(*)::text                                        AS txs,
               count(DISTINCT from_address)::text                    AS senders,
               count(DISTINCT to_timestamp(timestamp)::date)::text   AS days_active
        FROM q`),

      // Two or more distinct days. A burst inside one day is one session, not a return.
      db.query<{returning: string}>(`
        WITH q AS (${QUALIFYING}),
             per_address AS (
               SELECT from_address, count(DISTINCT to_timestamp(timestamp)::date) AS active_days
               FROM q GROUP BY from_address
             )
        SELECT count(*)::text AS returning FROM per_address WHERE active_days >= 2`),

      db.query<{deployers: string; contracts: string}>(`
        SELECT count(DISTINCT deployer_address)::text AS deployers,
               count(*)::text                         AS contracts
        FROM contracts`),

      db.query<{self_transfers: string; failed: string; faucet_grants: string}>(`
        SELECT
          (SELECT count(*)::text FROM transactions
            WHERE to_address IS NOT NULL AND to_address = from_address)  AS self_transfers,
          (SELECT count(*)::text FROM transactions WHERE status = 0)     AS failed,
          ${
            faucetTracked
              ? "(SELECT count(*)::text FROM faucet_grants f JOIN transactions t ON t.hash = f.tx_hash)"
              : "'0'::text"
          }                                                              AS faucet_grants`),

      db.query<{txs: string; senders: string}>(`
        SELECT count(*)::text AS txs, count(DISTINCT from_address)::text AS senders
        FROM transactions`),
    ]);

    // Per-day qualifying activity, for a chart that cannot be inflated by faucet traffic.
    const {rows: series} = await db.query<{day: string; txs: string; senders: string}>(
      `WITH q AS (${QUALIFYING})
       SELECT to_char(to_timestamp(timestamp)::date, 'YYYY-MM-DD') AS day,
              count(*)::text                                       AS txs,
              count(DISTINCT from_address)::text                   AS senders
       FROM q
       WHERE to_timestamp(timestamp) >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day`,
      [days],
    );

    const q = qualifying.rows[0];
    const r = raw.rows[0];

    return {
      window: {days, note: "Totals are all-time; `series` covers the requested window."},

      qualifying: {
        transactions: q?.txs ?? "0",
        activeAddresses: q?.senders ?? "0",
        returningAddresses: returning.rows[0]?.returning ?? "0",
        distinctActiveDays: q?.days_active ?? "0",
        contractsDeployed: deployers.rows[0]?.contracts ?? "0",
        distinctDeployers: deployers.rows[0]?.deployers ?? "0",
      },

      raw: {
        transactions: r?.txs ?? "0",
        sendingAddresses: r?.senders ?? "0",
        note: "What /api/analytics reports. The difference from `qualifying` is itemised below.",
      },

      excluded: {
        selfTransfers: excluded.rows[0]?.self_transfers ?? "0",
        failedTransactions: excluded.rows[0]?.failed ?? "0",
        faucetGrants: faucetTracked ? (excluded.rows[0]?.faucet_grants ?? "0") : null,
        faucetTracked,
        note: faucetTracked
          ? "Faucet grants are excluded by recorded transaction hash, not by sender address."
          : "No faucet_grants table exists on this deployment, so no faucet traffic could be excluded. Any that occurred is still counted.",
      },

      series,

      limitations: [
        "A sender is an address, not a person. One developer with ten addresses counts as ten.",
        "Nothing here distinguishes a human from a script. A patient bot that varies addresses and days is indistinguishable from adoption in this data.",
        "Counts cover indexed blocks only, and stop at the indexer's head.",
        "These are activity counts on a testnet whose gas token has no value. They are not demand, revenue, or users.",
      ],
    };
  });
}
