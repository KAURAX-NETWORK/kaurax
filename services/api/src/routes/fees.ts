/**
 * Protocol fee accounting.
 *
 *   GET /api/fees        totals, split into what was burned and what a recipient received
 *   GET /api/fees/daily  the same split per day, for charting
 *
 * Every figure is a SUM over indexed receipts and block headers. Nothing is projected,
 * annualised or converted to a currency. Two properties hold by construction:
 *
 *   - No double counting. A transaction contributes to exactly one row, and the query
 *     aggregates rows; there is no second source to reconcile against.
 *   - Burned and received are never conflated. The EIP-1559 base fee is destroyed, and on
 *     a typical KAURAX block it is the larger half. A "total fees" number that includes it
 *     overstates what the network collected, usually by a lot.
 *
 * One limitation is structural and worth stating early: the indexer does not record a
 * per-block coinbase, so a priority-fee total cannot be attributed to any particular
 * recipient retrospectively. The endpoint reports the total and says so rather than
 * implying the current recipient received all of it.
 *
 * What this is NOT: revenue. KAX is a testnet gas asset with no monetary value, there is
 * no price, and no conversion to one is offered here or anywhere else in this repository.
 * Operating costs are real money and are tracked separately, by hand, in
 * docs/OPERATING_COSTS.md — they are not on chain and this endpoint does not invent them.
 *
 * See docs/PROTOCOL_FEES.md.
 */
import type {FastifyInstance} from "fastify";
import {requireDb, type Context} from "../context.js";

/**
 * The split, in SQL, mirroring splitTransactionFee() in blockchain/l3/src/fees/accounting.ts.
 *
 * LEAST(base_fee, effective_gas_price) is the same clamp the node applies: a receipt below
 * its block's base fee cannot happen on a correct chain, and arithmetic that trusts it
 * would silently understate what the recipient received. COALESCE handles a pre-1559
 * block, where nothing is burned.
 */
const PAID = "COALESCE(t.gas_used, 0) * COALESCE(t.effective_gas_price, 0)";
const BURNED =
  "COALESCE(t.gas_used, 0) * LEAST(COALESCE(b.base_fee_per_gas, 0), COALESCE(t.effective_gas_price, 0))";

export function registerFeeRoutes(app: FastifyInstance, ctx: Context): void {
  app.get("/api/fees", async () => {
    const db = requireDb(ctx);

    const [totals, coverage] = await Promise.all([
      db.query<{paid: string; burned: string; txs: string}>(`
        SELECT COALESCE(SUM(${PAID}), 0)::text   AS paid,
               COALESCE(SUM(${BURNED}), 0)::text AS burned,
               count(*)::text                    AS txs
        FROM transactions t
        JOIN blocks b ON b.number = t.block_number`),
      // Fees can only be summed over what was indexed. Reporting the window alongside the
      // total is the difference between a figure and a quotable figure.
      db.query<{first: string | null; last: string | null; blocks: string}>(`
        SELECT MIN(number)::text AS first, MAX(number)::text AS last, count(*)::text AS blocks
        FROM blocks`),
    ]);

    const paid = BigInt(totals.rows[0]?.paid ?? "0");
    const burned = BigInt(totals.rows[0]?.burned ?? "0");

    // Read live rather than cached: a stale recipient here would be a misleading one.
    const recipient = await feeRecipient(ctx);

    return {
      unit: "wei",
      nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
      totals: {
        paidByUsersWei: paid.toString(),
        burnedWei: burned.toString(),
        /**
         * The priority component — the only part any account can receive.
         *
         * Deliberately NOT named "received by the current recipient". A block credits
         * whatever its own coinbase was, and the indexer does not record that per block,
         * so this total cannot be attributed to the address in `recipient` for any block
         * produced before that address was configured. See `attribution` below.
         */
        priorityFeesWei: (paid - burned).toString(),
        transactions: totals.rows[0]?.txs ?? "0",
      },
      recipient,
      attribution: {
        perBlockCoinbaseRecorded: false,
        note:
          "priorityFeesWei is the total credited to each block's own coinbase. The indexer " +
          "does not store a per-block coinbase, so this total is attributable to the address " +
          "in `recipient` only for blocks produced while that address was configured. For " +
          "earlier blocks the credit went wherever the coinbase pointed then — including the " +
          "zero address, where it was destroyed.",
      },
      coverage: {
        indexedBlocks: coverage.rows[0]?.blocks ?? "0",
        firstBlock: coverage.rows[0]?.first,
        lastBlock: coverage.rows[0]?.last,
        note: "Totals cover indexed blocks only. Blocks before firstBlock are not included.",
      },
      disclaimers: [
        "burnedWei is destroyed by EIP-1559. No account receives it and no setting can redirect it.",
        "priorityFeesWei is what each block's coinbase was credited. It is not profit: operating costs are off chain and are not netted off here.",
        "KAX is a testnet gas asset with no monetary value. These amounts do not convert to any currency.",
      ],
    };
  });

  app.get("/api/fees/daily", async (req) => {
    const db = requireDb(ctx);
    const days = Math.min(Math.max(Number((req.query as {days?: string}).days ?? 30), 1), 365);

    const {rows} = await db.query<{
      day: string;
      paid: string;
      burned: string;
      txs: string;
    }>(
      `SELECT to_char(to_timestamp(b.timestamp)::date, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(${PAID}), 0)::text   AS paid,
              COALESCE(SUM(${BURNED}), 0)::text AS burned,
              count(*)::text                    AS txs
       FROM transactions t
       JOIN blocks b ON b.number = t.block_number
       WHERE to_timestamp(b.timestamp) >= NOW() - ($1 || ' days')::interval
       GROUP BY day
       ORDER BY day`,
      [days],
    );

    return {
      days,
      unit: "wei",
      series: rows.map((r) => ({
        day: r.day,
        paidByUsersWei: r.paid,
        burnedWei: r.burned,
        priorityFeesWei: (BigInt(r.paid) - BigInt(r.burned)).toString(),
        transactions: r.txs,
      })),
      note: "Days with no indexed transactions are absent rather than reported as zero.",
    };
  });
}

/**
 * Who the node says is receiving fees, and what that account currently holds.
 *
 * `balanceWei` is the account's balance, which is NOT the same as fees received: anyone
 * can send to it and whoever holds the key can spend from it. Both numbers are given so a
 * reader can see them diverge rather than assume they agree.
 */
async function feeRecipient(ctx: Context): Promise<Record<string, unknown>> {
  try {
    const status = await ctx.rpc.call<{
      recipient: {configured: string | null; active: string | null; applied: boolean; problem: string | null};
    }>("kaurax_feeStatus");

    const address = status.recipient.active ?? status.recipient.configured;
    const balanceWei =
      address === null
        ? null
        : await ctx.rpc
            .call<string>("eth_getBalance", [address, "latest"])
            .then((hex) => BigInt(hex).toString())
            .catch(() => null);

    return {
      address,
      applied: status.recipient.applied,
      problem: status.recipient.problem,
      balanceWei,
      note:
        address === null
          ? "No fee recipient is configured: the priority fee is burned with the base fee."
          : "balanceWei is this account's balance, not its fee income. They differ whenever it is funded or spent from.",
    };
  } catch {
    // The node being unreachable must not turn a fee total into a guess.
    return {address: null, applied: null, problem: null, balanceWei: null, note: "The node did not answer kaurax_feeStatus."};
  }
}
