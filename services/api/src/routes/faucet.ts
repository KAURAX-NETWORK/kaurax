/**
 * Devnet faucet.
 *
 *   browser ──► KAURAX API ──► a real transaction on KAURAX
 *
 * This exists because a testnet nobody can pay gas on is a testnet nobody can use. It
 * sends real KAX in a real transaction; there is no simulated mode and no pretend receipt.
 *
 * It is deliberately restricted, because an open faucet with no limits is a script away
 * from being drained:
 *
 *   - one grant per address per cooldown window, recorded in PostgreSQL so a restart does
 *     not reset the clock;
 *   - one grant per client IP per window as well, so a thousand fresh addresses from one
 *     machine do not defeat the first rule;
 *   - a fixed amount the caller cannot influence;
 *   - refuses outright when the faucet account is running low, rather than emitting
 *     failing transactions.
 *
 * It refuses to run at all on a profile that is not a devnet. Handing out a token that has
 * value is not a faucet.
 */
import type {FastifyInstance} from "fastify";
import {createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther, isAddress} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import type {Context} from "../context.js";

interface FaucetBody {
  address?: unknown;
}

export function registerFaucetRoutes(app: FastifyInstance, ctx: Context): void {
  const {faucet, rpcUrl, chainId} = ctx.cfg;
  const profile = process.env.KAURAX_PROFILE ?? "devnet";

  const chain = defineChain({
    id: chainId,
    name: "KAURAX",
    nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}},
  });

  const account = faucet.privateKey ? privateKeyToAccount(faucet.privateKey as `0x${string}`) : null;
  const enabled = Boolean(account) && profile === "devnet";
  const amount = parseEther(faucet.amountKax);

  const publicClient = createPublicClient({chain, transport: http(rpcUrl)});
  const wallet = account ? createWalletClient({account, chain, transport: http(rpcUrl)}) : null;

  /** Serialises grants: two requests arriving together must not both pass the balance check. */
  let inFlight: Promise<unknown> = Promise.resolve();

  app.get("/api/faucet", async () => ({
    enabled,
    reason: enabled
      ? null
      : !account
        ? "No faucet account is configured on this API."
        : `The faucet is only available on a devnet (this is ${profile}).`,
    amountKax: faucet.amountKax,
    cooldownHours: faucet.cooldownHours,
    from: account?.address ?? null,
    balance: enabled ? formatEther(await publicClient.getBalance({address: account!.address})) : null,
    note: "KAX is a devnet gas token. It has no monetary value.",
  }));

  app.post("/api/faucet", async (req, reply) => {
    if (!enabled || !wallet || !account) {
      return reply.code(503).send({
        error: "faucet_unavailable",
        message: !account
          ? "No faucet account is configured on this API."
          : `The faucet is only available on a devnet (this is ${profile}).`,
        statusCode: 503,
      });
    }

    const address = (req.body as FaucetBody | null)?.address;
    // strict:false accepts an address whose casing is not a valid EIP-55 checksum. People
    // paste addresses from all sorts of places, and rejecting "0xAbC..." because its
    // capitalisation is not a checksum reads as "invalid address", which is wrong and
    // unhelpful. The hex shape is still enforced.
    if (typeof address !== "string" || !isAddress(address, {strict: false})) {
      return reply.code(400).send({
        error: "invalid_address",
        message: "Provide a 20-byte hex address.",
        statusCode: 400,
      });
    }
    const to = address.toLowerCase() as `0x${string}`;
    const ip = req.ip;

    if (!ctx.db) {
      return reply.code(503).send({
        error: "database_unavailable",
        message: "The faucet needs the database to enforce its cooldown, and it is not reachable.",
        statusCode: 503,
      });
    }

    // Serialise: without this, two concurrent requests both read the same empty history.
    const run = inFlight.then(async () => {
      await ctx.db!.query(`
        CREATE TABLE IF NOT EXISTS faucet_grants (
          id          BIGSERIAL PRIMARY KEY,
          address     TEXT        NOT NULL,
          ip          TEXT        NOT NULL,
          amount_wei  NUMERIC(78,0) NOT NULL,
          tx_hash     TEXT        NOT NULL,
          granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await ctx.db!.query(`CREATE INDEX IF NOT EXISTS faucet_grants_address_idx ON faucet_grants (address, granted_at DESC)`);
      await ctx.db!.query(`CREATE INDEX IF NOT EXISTS faucet_grants_ip_idx ON faucet_grants (ip, granted_at DESC)`);

      const window = `${faucet.cooldownHours} hours`;
      const recent = await ctx.db!.query<{address: string; granted_at: string}>(
        `SELECT address, granted_at FROM faucet_grants
          WHERE (address = $1 OR ip = $2) AND granted_at > now() - $3::interval
          ORDER BY granted_at DESC LIMIT 1`,
        [to, ip, window],
      );

      if (recent.rows.length > 0) {
        const next = new Date(new Date(recent.rows[0]!.granted_at).getTime() + faucet.cooldownHours * 3600_000);
        return {
          code: 429,
          body: {
            error: "cooldown",
            message:
              recent.rows[0]!.address === to
                ? `This address was funded recently. Try again after ${next.toISOString()}.`
                : `This client funded an address recently. Try again after ${next.toISOString()}.`,
            retryAfter: next.toISOString(),
            statusCode: 429,
          },
        };
      }

      // Keep a working float rather than emitting transactions that will fail.
      const balance = await publicClient.getBalance({address: account.address});
      if (balance < amount * 2n) {
        req.log.error({balance: balance.toString()}, "faucet account is running low");
        return {
          code: 503,
          body: {
            error: "faucet_empty",
            message: "The faucet account is out of funds. An operator has to top it up.",
            statusCode: 503,
          },
        };
      }

      const hash = await wallet.sendTransaction({to, value: amount});
      const receipt = await publicClient.waitForTransactionReceipt({hash, timeout: 60_000});

      if (receipt.status !== "success") {
        return {
          code: 502,
          body: {error: "transfer_failed", message: `The transaction reverted (${hash}).`, statusCode: 502},
        };
      }

      // Recorded only after the transaction succeeded, so a failed send does not burn the
      // caller's cooldown.
      await ctx.db!.query(
        `INSERT INTO faucet_grants (address, ip, amount_wei, tx_hash) VALUES ($1, $2, $3, $4)`,
        [to, ip, amount.toString(), hash],
      );

      req.log.info({to, hash, amount: faucet.amountKax}, "faucet grant");
      return {
        code: 200,
        body: {
          address: to,
          amountKax: faucet.amountKax,
          txHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          note: "KAX is a devnet gas token. It has no monetary value.",
        },
      };
    });

    inFlight = run.catch(() => undefined);

    try {
      const {code, body} = (await run) as {code: number; body: unknown};
      return reply.code(code).send(body);
    } catch (err) {
      req.log.error({err}, "faucet request failed");
      return reply.code(502).send({
        error: "faucet_error",
        message: "The faucet could not complete the transfer.",
        statusCode: 502,
      });
    }
  });
}
