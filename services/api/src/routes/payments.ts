/**
 * KAURAX Pay.
 *
 * A payment is an off-chain *intent*: a merchant asks for an amount, the payer sends KAX on
 * KAURAX, and the API confirms it **only after verifying the transaction on chain**.
 *
 * Rules this implements, which is what separates it from a demo:
 *   * A payment can never be marked confirmed by a client asserting it was paid.
 *   * Confirmation requires a real receipt, with a successful status, from the claimed
 *     payer, to the merchant, for at least the requested amount.
 *   * A transaction hash can settle only one payment (enforced by a unique constraint).
 */
import {randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";
import type {Payment} from "@kaurax/types";
import {isAddress, isHash, pagination, requireDb, type Context, type Hex} from "../context.js";

interface PaymentRow {
  id: string;
  merchant_address: string;
  amount: string;
  reference: string | null;
  description: string | null;
  status: Payment["status"];
  transaction_hash: string | null;
  payer_address: string | null;
  confirmed_at_block: string | null;
  created_at: Date;
  expires_at: Date;
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    merchantAddress: r.merchant_address as Hex,
    amount: r.amount,
    currency: "KAX",
    reference: r.reference,
    description: r.description,
    status: r.status,
    transactionHash: r.transaction_hash as Hex | null,
    payerAddress: r.payer_address as Hex | null,
    confirmedAtBlock: r.confirmed_at_block,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
  };
}

export function registerPaymentRoutes(app: FastifyInstance, ctx: Context): void {
  /** Create a payment request. */
  app.post("/api/payments", async (req, reply) => {
    const db = requireDb(ctx);
    const body = req.body as {
      merchantAddress?: string;
      amount?: string;
      reference?: string;
      description?: string;
      expiresInSeconds?: number;
    };

    if (!isAddress(body.merchantAddress)) {
      return reply.code(400).send({
        error: "bad_request",
        message: "merchantAddress must be a valid address.",
        statusCode: 400,
      });
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount ?? "0");
    } catch {
      return reply
        .code(400)
        .send({error: "bad_request", message: "amount must be an integer string in wei.", statusCode: 400});
    }
    if (amount <= 0n) {
      return reply.code(400).send({error: "bad_request", message: "amount must be positive.", statusCode: 400});
    }

    const ttl = Math.min(Math.max(Number(body.expiresInSeconds ?? 3600), 60), 86_400);
    const id = randomUUID();

    const {rows} = await db.query<PaymentRow>(
      `INSERT INTO payments (id, merchant_address, amount, reference, description, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
       RETURNING *`,
      [
        id,
        body.merchantAddress.toLowerCase(),
        amount.toString(),
        body.reference ?? null,
        body.description ?? null,
        ttl,
      ],
    );

    return reply.code(201).send(toPayment(rows[0]!));
  });

  app.get("/api/payments/:id", async (req, reply) => {
    const db = requireDb(ctx);
    const {id} = req.params as {id: string};

    const {rows} = await db.query<PaymentRow>("SELECT * FROM payments WHERE id = $1", [id]);
    if (rows.length === 0) {
      return reply.code(404).send({error: "not_found", message: "No such payment.", statusCode: 404});
    }

    // Expire lazily rather than running a sweeper: a request is the only moment anyone
    // cares whether it lapsed.
    const p = rows[0]!;
    if (p.status === "pending" && p.expires_at.getTime() < Date.now()) {
      const {rows: updated} = await db.query<PaymentRow>(
        "UPDATE payments SET status = 'expired' WHERE id = $1 AND status = 'pending' RETURNING *",
        [id],
      );
      return toPayment(updated[0] ?? p);
    }
    return toPayment(p);
  });

  /**
   * Submit a transaction hash as settlement for a payment.
   *
   * The hash is verified against the chain before anything is written. A caller cannot
   * mark a payment paid by asserting it.
   */
  app.post("/api/payments/:id/settle", async (req, reply) => {
    const db = requireDb(ctx);
    const {id} = req.params as {id: string};
    const {transactionHash} = (req.body ?? {}) as {transactionHash?: string};

    if (!isHash(transactionHash)) {
      return reply.code(400).send({
        error: "bad_request",
        message: "transactionHash must be a 32-byte hash.",
        statusCode: 400,
      });
    }

    const {rows} = await db.query<PaymentRow>("SELECT * FROM payments WHERE id = $1", [id]);
    if (rows.length === 0) {
      return reply.code(404).send({error: "not_found", message: "No such payment.", statusCode: 404});
    }
    const payment = rows[0]!;

    if (payment.status === "confirmed") return toPayment(payment);
    if (payment.status !== "pending") {
      return reply.code(409).send({
        error: "conflict",
        message: `Payment is ${payment.status} and cannot be settled.`,
        statusCode: 409,
      });
    }

    // --- verify on chain ---
    const [receipt, tx] = await Promise.all([
      ctx.rpc
        .call<{status: string; blockNumber: string; from: string; to: string | null} | null>(
          "eth_getTransactionReceipt",
          [transactionHash.toLowerCase()],
        )
        .catch(() => null),
      ctx.rpc
        .call<{value: string; to: string | null; from: string} | null>("eth_getTransactionByHash", [
          transactionHash.toLowerCase(),
        ])
        .catch(() => null),
    ]);

    if (!receipt || !tx) {
      return reply.code(409).send({
        error: "not_confirmed",
        message: "That transaction is not yet mined on KAURAX. Try again once it is included in a block.",
        statusCode: 409,
      });
    }
    if (BigInt(receipt.status) !== 1n) {
      return reply
        .code(409)
        .send({error: "reverted", message: "That transaction reverted.", statusCode: 409});
    }
    if ((tx.to ?? "").toLowerCase() !== payment.merchant_address) {
      return reply.code(409).send({
        error: "wrong_recipient",
        message: "That transaction did not pay the merchant address for this payment.",
        statusCode: 409,
      });
    }
    if (BigInt(tx.value) < BigInt(payment.amount)) {
      return reply.code(409).send({
        error: "insufficient_amount",
        message: `That transaction sent ${BigInt(tx.value)} wei; this payment requires ${payment.amount}.`,
        statusCode: 409,
      });
    }

    try {
      const {rows: updated} = await db.query<PaymentRow>(
        `UPDATE payments
         SET status = 'confirmed', transaction_hash = $2, payer_address = $3, confirmed_at_block = $4
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, transactionHash.toLowerCase(), tx.from.toLowerCase(), BigInt(receipt.blockNumber).toString()],
      );
      if (updated.length === 0) {
        return reply
          .code(409)
          .send({error: "conflict", message: "Payment is no longer pending.", statusCode: 409});
      }
      return toPayment(updated[0]!);
    } catch (err) {
      // Unique index on transaction_hash: one transaction settles one payment.
      if ((err as {code?: string}).code === "23505") {
        return reply.code(409).send({
          error: "already_used",
          message: "That transaction has already settled another payment.",
          statusCode: 409,
        });
      }
      throw err;
    }
  });

  /** Merchant dashboard listing. */
  app.get("/api/payments", async (req, reply) => {
    const db = requireDb(ctx);
    const {merchant} = req.query as {merchant?: string};
    if (!isAddress(merchant)) {
      return reply.code(400).send({
        error: "bad_request",
        message: "A merchant address is required: /api/payments?merchant=0x…",
        statusCode: 400,
      });
    }
    const {limit, offset} = pagination(req.query as Record<string, unknown>);

    const {rows} = await db.query<PaymentRow>(
      "SELECT * FROM payments WHERE merchant_address = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [merchant.toLowerCase(), limit, offset],
    );
    const {rows: countRows} = await db.query<{n: string}>(
      "SELECT count(*)::text AS n FROM payments WHERE merchant_address = $1",
      [merchant.toLowerCase()],
    );
    const total = Number(countRows[0]?.n ?? 0);

    return {
      items: rows.map(toPayment),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  });
}
