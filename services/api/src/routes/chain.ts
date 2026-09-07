/**
 * Chain data endpoints, served from the indexer database.
 *
 * Where a value is only available live (balances, code), it is read from the RPC at
 * request time. Nothing here is cached in a way that could return a stale head.
 */
import type {FastifyInstance} from "fastify";
import type {
  IndexedBlock,
  IndexedTransaction,
  IndexedAddress,
  IndexedContract,
  IndexedToken,
  IndexedTokenTransfer,
  NetworkInfo,
  Paginated,
} from "@kaurax/types";
import {pagination, requireDb, isAddress, isHash, type Context, type Hex} from "../context.js";

interface BlockRow {
  number: string;
  hash: string;
  parent_hash: string;
  state_root: string;
  timestamp: string;
  gas_used: string;
  gas_limit: string;
  base_fee_per_gas: string | null;
  transaction_count: number;
}

interface TxRow {
  hash: string;
  block_number: string | null;
  transaction_index: number | null;
  from_address: string;
  to_address: string | null;
  value: string;
  nonce: string;
  gas: string;
  gas_used: string | null;
  gas_price: string | null;
  effective_gas_price: string | null;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  input: string;
  status: number | null;
  contract_address: string | null;
  log_count: number;
  timestamp: string | null;
}

function toBlock(r: BlockRow, lastBatched: bigint | null): IndexedBlock {
  return {
    number: r.number,
    hash: r.hash as Hex,
    parentHash: r.parent_hash as Hex,
    stateRoot: r.state_root as Hex,
    timestamp: r.timestamp,
    gasUsed: r.gas_used,
    gasLimit: r.gas_limit,
    baseFeePerGas: r.base_fee_per_gas,
    transactionCount: r.transaction_count,
    // null, not false, when settlement state could not be read.
    batched: lastBatched === null ? null : lastBatched >= BigInt(r.number),
  };
}

function toTx(r: TxRow): IndexedTransaction {
  return {
    hash: r.hash as Hex,
    blockNumber: r.block_number,
    blockHash: null,
    transactionIndex: r.transaction_index,
    from: r.from_address as Hex,
    to: r.to_address as Hex | null,
    value: r.value,
    nonce: Number(r.nonce),
    gas: r.gas,
    gasUsed: r.gas_used,
    gasPrice: r.gas_price,
    effectiveGasPrice: r.effective_gas_price,
    maxFeePerGas: r.max_fee_per_gas,
    maxPriorityFeePerGas: r.max_priority_fee_per_gas,
    input: r.input as Hex,
    // A NULL status means the receipt could not be read — reported as pending, never
    // upgraded to success.
    status: r.status === null ? "pending" : r.status === 1 ? "success" : "reverted",
    contractAddress: r.contract_address as Hex | null,
    timestamp: r.timestamp,
    logCount: r.log_count,
  };
}

/** Last L3 block whose data has reached the L2, or null if the node cannot say. */
async function lastBatchedBlock(ctx: Context): Promise<bigint | null> {
  try {
    const status = await ctx.rpc.call<{settlement?: {lastBatchedL3Block?: string | null}}>(
      "kaurax_networkStatus",
    );
    const v = status.settlement?.lastBatchedL3Block;
    return v === null || v === undefined ? null : BigInt(v);
  } catch {
    return null;
  }
}

export function registerChainRoutes(app: FastifyInstance, ctx: Context): void {
  // ------------------------------------------------------------- network --
  app.get("/api/network", async () => {
    const [chainIdHex, headHex, gasPriceHex] = await Promise.all([
      ctx.rpc.call<string>("eth_chainId"),
      ctx.rpc.call<string>("eth_blockNumber"),
      ctx.rpc.call<string>("eth_gasPrice").catch(() => null),
    ]);

    const info: NetworkInfo & {head: string; gasPrice: string | null} = {
      name: `KAURAX ${process.env.KAURAX_PROFILE === "testnet" ? "Testnet" : "Devnet"}`,
      chainId: Number(BigInt(chainIdHex)),
      layer: 3,
      currency: {name: "KAURAX", symbol: "KAX", decimals: 18},
      rpcUrl: ctx.cfg.rpcUrl,
      explorerUrl: ctx.cfg.explorerUrl,
      settlesTo:
        ctx.cfg.l2.chainId !== null && ctx.cfg.l2.name !== null
          ? {chainId: ctx.cfg.l2.chainId, name: ctx.cfg.l2.name}
          : null,
      head: BigInt(headHex).toString(),
      gasPrice: gasPriceHex === null ? null : BigInt(gasPriceHex).toString(),
    };
    return info;
  });

  /** Full settlement picture, proxied from the node so frontends need only one origin. */
  app.get("/api/network/settlement", async (_req, reply) => {
    try {
      return await ctx.rpc.call("kaurax_networkStatus");
    } catch (err) {
      return reply.code(503).send({
        error: "rpc_unavailable",
        message: `Could not read settlement status from the KAURAX node: ${(err as Error).message}`,
        statusCode: 503,
      });
    }
  });

  // -------------------------------------------------------------- blocks --
  app.get("/api/blocks", async (req) => {
    const db = requireDb(ctx);
    const {limit, offset} = pagination(req.query as Record<string, unknown>);
    const batched = await lastBatchedBlock(ctx);

    const {rows} = await db.query<BlockRow>(
      "SELECT * FROM blocks ORDER BY number DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    const {rows: countRows} = await db.query<{n: string}>("SELECT count(*)::text AS n FROM blocks");
    const total = Number(countRows[0]?.n ?? 0);

    const page: Paginated<IndexedBlock> = {
      items: rows.map((r) => toBlock(r, batched)),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
    return page;
  });

  app.get("/api/blocks/:number", async (req, reply) => {
    const db = requireDb(ctx);
    const {number} = req.params as {number: string};

    const isNumeric = /^\d+$/.test(number);
    const {rows} = isNumeric
      ? await db.query<BlockRow>("SELECT * FROM blocks WHERE number = $1", [number])
      : await db.query<BlockRow>("SELECT * FROM blocks WHERE hash = $1", [number.toLowerCase()]);

    if (rows.length === 0) {
      return reply.code(404).send({
        error: "not_found",
        message: `Block ${number} has not been indexed.`,
        statusCode: 404,
      });
    }

    const batched = await lastBatchedBlock(ctx);
    const {rows: txs} = await db.query<TxRow>(
      "SELECT * FROM transactions WHERE block_number = $1 ORDER BY transaction_index",
      [rows[0]!.number],
    );
    return {...toBlock(rows[0]!, batched), transactions: txs.map(toTx)};
  });

  // -------------------------------------------------------- transactions --
  app.get("/api/transactions", async (req) => {
    const db = requireDb(ctx);
    const {limit, offset} = pagination(req.query as Record<string, unknown>);
    const {rows} = await db.query<TxRow>(
      "SELECT * FROM transactions ORDER BY block_number DESC, transaction_index DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    const {rows: countRows} = await db.query<{n: string}>("SELECT count(*)::text AS n FROM transactions");
    const total = Number(countRows[0]?.n ?? 0);

    const page: Paginated<IndexedTransaction> = {
      items: rows.map(toTx),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
    return page;
  });

  app.get("/api/transactions/:hash", async (req, reply) => {
    const db = requireDb(ctx);
    const {hash} = req.params as {hash: string};
    if (!isHash(hash)) {
      return reply.code(400).send({error: "bad_request", message: "Not a 32-byte hash.", statusCode: 400});
    }

    const {rows} = await db.query<TxRow>("SELECT * FROM transactions WHERE hash = $1", [hash.toLowerCase()]);
    if (rows.length === 0) {
      return reply.code(404).send({
        error: "not_found",
        message: `Transaction ${hash} has not been indexed. It may still be in the mempool.`,
        statusCode: 404,
      });
    }

    const {rows: logs} = await db.query(
      "SELECT log_index, address, topic0, topic1, topic2, topic3, data FROM logs WHERE transaction_hash = $1 ORDER BY log_index",
      [hash.toLowerCase()],
    );
    return {...toTx(rows[0]!), logs};
  });

  // ------------------------------------------------------------ address --
  app.get("/api/address/:address", async (req, reply) => {
    const {address} = req.params as {address: string};
    if (!isAddress(address)) {
      return reply.code(400).send({error: "bad_request", message: "Not a valid address.", statusCode: 400});
    }
    const lower = address.toLowerCase();

    // Balance, nonce and code are read live: an indexed balance is a wrong balance.
    const [balanceHex, nonceHex, code] = await Promise.all([
      ctx.rpc.call<string>("eth_getBalance", [lower, "latest"]),
      ctx.rpc.call<string>("eth_getTransactionCount", [lower, "latest"]),
      ctx.rpc.call<string>("eth_getCode", [lower, "latest"]),
    ]);

    interface AddressRow {
      first_seen_block: string | null;
      last_seen_block: string | null;
      transaction_count: number;
    }

    let indexed: AddressRow | null = null;
    if (ctx.db) {
      const {rows} = await ctx.db.query<AddressRow>(
        "SELECT first_seen_block, last_seen_block, transaction_count FROM addresses WHERE address = $1",
        [lower],
      );
      indexed = rows[0] ?? null;
    }

    const result: IndexedAddress & {indexedHistoryAvailable: boolean} = {
      address: lower as Hex,
      balance: BigInt(balanceHex).toString(),
      nonce: Number(BigInt(nonceHex)),
      isContract: code !== "0x",
      firstSeenBlock: indexed?.first_seen_block ?? null,
      lastSeenBlock: indexed?.last_seen_block ?? null,
      transactionCount: indexed?.transaction_count ?? 0,
      indexedHistoryAvailable: ctx.db !== null,
    };
    return result;
  });

  app.get("/api/address/:address/transactions", async (req, reply) => {
    const db = requireDb(ctx);
    const {address} = req.params as {address: string};
    if (!isAddress(address)) {
      return reply.code(400).send({error: "bad_request", message: "Not a valid address.", statusCode: 400});
    }
    const lower = address.toLowerCase();
    const {limit, offset} = pagination(req.query as Record<string, unknown>);

    const {rows} = await db.query<TxRow>(
      `SELECT * FROM transactions
       WHERE from_address = $1 OR to_address = $1
       ORDER BY block_number DESC, transaction_index DESC
       LIMIT $2 OFFSET $3`,
      [lower, limit, offset],
    );
    const {rows: countRows} = await db.query<{n: string}>(
      "SELECT count(*)::text AS n FROM transactions WHERE from_address = $1 OR to_address = $1",
      [lower],
    );
    const total = Number(countRows[0]?.n ?? 0);

    const page: Paginated<IndexedTransaction> = {
      items: rows.map(toTx),
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
    return page;
  });

  // ----------------------------------------------------------- contracts --
  app.get("/api/contracts", async (req) => {
    const db = requireDb(ctx);
    const {limit, offset} = pagination(req.query as Record<string, unknown>);
    const {rows} = await db.query(
      "SELECT * FROM contracts ORDER BY deployment_block DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    const items: IndexedContract[] = rows.map((r) => ({
      address: r.address as Hex,
      deployerAddress: r.deployer_address as Hex,
      deploymentTxHash: r.deployment_tx_hash as Hex,
      deploymentBlock: r.deployment_block as string,
      bytecodeSize: r.bytecode_size as number,
      // KAURAX runs no source-verification service. This is always false.
      verified: false,
    }));
    return {items, total: items.length, limit, offset, hasMore: items.length === limit};
  });

  // -------------------------------------------------------------- tokens --
  app.get("/api/tokens", async (req) => {
    const db = requireDb(ctx);
    const {limit, offset} = pagination(req.query as Record<string, unknown>);
    const {rows} = await db.query(
      "SELECT * FROM tokens ORDER BY transfer_count DESC, first_seen_block DESC LIMIT $1 OFFSET $2",
      [limit, offset],
    );
    const items: IndexedToken[] = rows.map((r) => ({
      address: r.address as Hex,
      name: r.name as string | null,
      symbol: r.symbol as string | null,
      decimals: r.decimals as number | null,
      totalSupply: r.total_supply as string | null,
      transferCount: r.transfer_count as number,
      firstSeenBlock: r.first_seen_block as string,
    }));
    return {items, total: items.length, limit, offset, hasMore: items.length === limit};
  });

  app.get("/api/tokens/:address/transfers", async (req, reply) => {
    const db = requireDb(ctx);
    const {address} = req.params as {address: string};
    if (!isAddress(address)) {
      return reply.code(400).send({error: "bad_request", message: "Not a valid address.", statusCode: 400});
    }
    const {limit, offset} = pagination(req.query as Record<string, unknown>);
    const {rows} = await db.query(
      `SELECT * FROM token_transfers WHERE token_address = $1
       ORDER BY block_number DESC, log_index DESC LIMIT $2 OFFSET $3`,
      [address.toLowerCase(), limit, offset],
    );
    const items: IndexedTokenTransfer[] = rows.map((r) => ({
      transactionHash: r.transaction_hash as Hex,
      logIndex: r.log_index as number,
      blockNumber: r.block_number as string,
      tokenAddress: r.token_address as Hex,
      from: r.from_address as Hex,
      to: r.to_address as Hex,
      value: r.value as string,
      timestamp: r.timestamp as string,
    }));
    return {items, total: items.length, limit, offset, hasMore: items.length === limit};
  });

  // ------------------------------------------------------------- search --
  /** One box, three kinds of input. Returns what it found, or nothing. */
  app.get("/api/search", async (req) => {
    const q = String((req.query as {q?: string}).q ?? "").trim();
    if (!q) return {type: null, result: null};

    if (isAddress(q)) return {type: "address", result: q.toLowerCase()};
    if (isHash(q)) {
      if (ctx.db) {
        const {rows} = await ctx.db.query("SELECT 1 FROM blocks WHERE hash = $1", [q.toLowerCase()]);
        if (rows.length > 0) return {type: "block", result: q.toLowerCase()};
      }
      return {type: "transaction", result: q.toLowerCase()};
    }
    if (/^\d+$/.test(q)) return {type: "block", result: q};

    return {type: null, result: null};
  });
}
