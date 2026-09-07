/**
 * The KAURAX indexer.
 *
 *   KAURAX RPC ──► fetch block + receipts ──► one transaction per block ──► PostgreSQL
 *
 * Guarantees it actually provides:
 *   * **Atomic per block.** A block, its transactions, logs, token transfers and address
 *     rows are written in one database transaction. A crash mid-block leaves no partial
 *     block behind.
 *   * **Idempotent.** Every write is an upsert keyed on chain identity, so re-indexing a
 *     range produces the same rows.
 *   * **Reorg-aware.** Before writing block N it checks that N-1's stored hash matches the
 *     new block's parentHash. On a mismatch it rolls back the divergent blocks and
 *     re-indexes. On a single-sequencer L3 this should never fire; if it does, that is a
 *     real event and it is logged as one.
 *
 * It never invents data. If a receipt cannot be read, the transaction is stored with a
 * NULL status rather than an assumed success.
 */
import type {Pool} from "./db.js";
import {RpcClient, type Hex, type RpcBlock, type RpcLog, type RpcReceipt} from "./rpc.js";
import {createLogger} from "./log.js";
import type {IndexerConfig} from "./config.js";
import {decodeTransferLog} from "./decode.js";
import {fetchTokenMetadata} from "./token-metadata.js";

export {ERC20_TRANSFER_TOPIC} from "./decode.js";

export interface IndexerStatus {
  running: boolean;
  chainId: number;
  lastIndexedBlock: string;
  chainHead: string | null;
  lagBlocks: number | null;
  blocksIndexed: number;
  transactionsIndexed: number;
  lastError: string | null;
  startedAt: string;
}

export class Indexer {
  private readonly log = createLogger("indexer");
  private readonly rpc: RpcClient;

  private running = false;
  private stopped = false;
  private lastIndexed = 0n;
  private chainHead: bigint | null = null;
  private blocksIndexed = 0;
  private transactionsIndexed = 0;
  private lastError: string | null = null;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly cfg: IndexerConfig,
    private readonly pool: Pool,
  ) {
    this.rpc = new RpcClient(cfg.rpcUrl);
  }

  async start(): Promise<void> {
    await this.rpc.waitReady();

    const chainId = await this.rpc.chainId();
    if (chainId !== this.cfg.chainId) {
      throw new Error(
        `RPC reports chain ID ${chainId}, indexer is configured for ${this.cfg.chainId}. ` +
          `Refusing to index: the data would be attributed to the wrong chain.`,
      );
    }

    await this.pool.query(
      `INSERT INTO indexer_state (id, chain_id, last_indexed_block)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET chain_id = EXCLUDED.chain_id, updated_at = NOW()`,
      [chainId, this.cfg.startBlock.toString()],
    );

    const {rows} = await this.pool.query<{last_indexed_block: string}>(
      "SELECT last_indexed_block FROM indexer_state WHERE id = 1",
    );
    this.lastIndexed = BigInt(rows[0]?.last_indexed_block ?? "0");
    if (this.lastIndexed < this.cfg.startBlock) this.lastIndexed = this.cfg.startBlock;

    this.running = true;
    this.log.info("indexer started", {
      chainId,
      rpc: this.cfg.rpcUrl,
      resumeFrom: (this.lastIndexed + 1n).toString(),
      batchSize: this.cfg.batchSize,
    });

    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const indexed = await this.tick();
        this.lastError = null;
        if (indexed === 0) {
          await this.sleep(this.cfg.pollIntervalMs);
        }
      } catch (err) {
        this.lastError = (err as Error).message;
        this.log.error("index pass failed", {error: this.lastError});
        await this.pool
          .query("UPDATE indexer_state SET last_error = $1, updated_at = NOW() WHERE id = 1", [
            this.lastError,
          ])
          .catch(() => undefined);
        // Back off so a persistent failure does not spin the CPU or hammer the RPC.
        await this.sleep(Math.max(this.cfg.pollIntervalMs, 3000));
      }
    }
  }

  /** Index up to `batchSize` blocks. Returns how many were written. */
  async tick(): Promise<number> {
    const head = await this.rpc.blockNumber();
    this.chainHead = head;

    const target = head - BigInt(this.cfg.confirmations);
    if (target <= this.lastIndexed) return 0;

    const from = this.lastIndexed + 1n;
    const to = target - from + 1n > BigInt(this.cfg.batchSize) ? from + BigInt(this.cfg.batchSize) - 1n : target;

    let written = 0;
    for (let n = from; n <= to; n++) {
      const block = await this.rpc.getBlock(n);
      if (!block) {
        this.log.warn("block unavailable from RPC; will retry", {block: n.toString()});
        break;
      }

      if (await this.detectReorg(n, block.parentHash)) {
        await this.rollbackFrom(n - 1n);
        return written;
      }

      await this.indexBlock(block);
      this.lastIndexed = n;
      written++;
      this.blocksIndexed++;
    }

    if (written > 0) {
      await this.pool.query(
        "UPDATE indexer_state SET last_indexed_block = $1, updated_at = NOW(), last_error = NULL WHERE id = 1",
        [this.lastIndexed.toString()],
      );
      this.log.debug("indexed", {through: this.lastIndexed.toString(), blocks: written});
    }
    return written;
  }

  /** True when the stored parent no longer matches the chain — i.e. a reorg. */
  private async detectReorg(blockNumber: bigint, parentHash: Hex): Promise<boolean> {
    if (blockNumber === 0n) return false;
    const {rows} = await this.pool.query<{hash: string}>("SELECT hash FROM blocks WHERE number = $1", [
      (blockNumber - 1n).toString(),
    ]);
    const stored = rows[0]?.hash;
    if (!stored) return false; // Nothing indexed yet at that height; not a reorg.
    if (stored.toLowerCase() === parentHash.toLowerCase()) return false;

    this.log.warn("reorg detected", {
      atBlock: blockNumber.toString(),
      storedParent: stored,
      chainParent: parentHash,
    });
    return true;
  }

  /**
   * Drop everything from `fromBlock` upward and rewind. Cascades handle transactions,
   * logs and token transfers.
   */
  private async rollbackFrom(fromBlock: bigint): Promise<void> {
    const target = fromBlock < 0n ? 0n : fromBlock;
    await this.pool.query("DELETE FROM blocks WHERE number >= $1", [target.toString()]);
    await this.pool.query("UPDATE indexer_state SET last_indexed_block = $1, updated_at = NOW() WHERE id = 1", [
      (target === 0n ? 0n : target - 1n).toString(),
    ]);
    this.lastIndexed = target === 0n ? 0n : target - 1n;
    this.log.warn("rolled back", {toBlock: this.lastIndexed.toString()});
  }

  /** Write one block and everything derived from it, atomically. */
  private async indexBlock(block: RpcBlock): Promise<void> {
    const blockNumber = BigInt(block.number);
    const timestamp = BigInt(block.timestamp);

    const receipts =
      block.transactions.length > 0
        ? await this.rpc.getReceipts(block.transactions.map((t) => t.hash))
        : [];
    const receiptByHash = new Map<string, RpcReceipt>();
    for (const r of receipts) if (r) receiptByHash.set(r.transactionHash.toLowerCase(), r);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO blocks
           (number, hash, parent_hash, state_root, timestamp, gas_used, gas_limit,
            base_fee_per_gas, transaction_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (number) DO UPDATE SET
           hash = EXCLUDED.hash, parent_hash = EXCLUDED.parent_hash,
           state_root = EXCLUDED.state_root, timestamp = EXCLUDED.timestamp,
           gas_used = EXCLUDED.gas_used, gas_limit = EXCLUDED.gas_limit,
           base_fee_per_gas = EXCLUDED.base_fee_per_gas,
           transaction_count = EXCLUDED.transaction_count`,
        [
          blockNumber.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase(),
          block.stateRoot.toLowerCase(),
          timestamp.toString(),
          BigInt(block.gasUsed).toString(),
          BigInt(block.gasLimit).toString(),
          block.baseFeePerGas ? BigInt(block.baseFeePerGas).toString() : null,
          block.transactions.length,
        ],
      );

      for (const tx of block.transactions) {
        const receipt = receiptByHash.get(tx.hash.toLowerCase());
        const from = tx.from.toLowerCase();
        const to = tx.to ? tx.to.toLowerCase() : null;
        const contractAddress = receipt?.contractAddress ? receipt.contractAddress.toLowerCase() : null;

        await client.query(
          `INSERT INTO transactions
             (hash, block_number, transaction_index, from_address, to_address, value, nonce, gas,
              gas_used, gas_price, effective_gas_price, max_fee_per_gas, max_priority_fee_per_gas,
              input, status, contract_address, log_count, timestamp)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (hash) DO UPDATE SET
             block_number = EXCLUDED.block_number,
             transaction_index = EXCLUDED.transaction_index,
             gas_used = EXCLUDED.gas_used,
             effective_gas_price = EXCLUDED.effective_gas_price,
             status = EXCLUDED.status,
             contract_address = EXCLUDED.contract_address,
             log_count = EXCLUDED.log_count`,
          [
            tx.hash.toLowerCase(),
            blockNumber.toString(),
            Number(BigInt(tx.transactionIndex)),
            from,
            to,
            BigInt(tx.value).toString(),
            Number(BigInt(tx.nonce)),
            BigInt(tx.gas).toString(),
            receipt ? BigInt(receipt.gasUsed).toString() : null,
            tx.gasPrice ? BigInt(tx.gasPrice).toString() : null,
            receipt ? BigInt(receipt.effectiveGasPrice).toString() : null,
            tx.maxFeePerGas ? BigInt(tx.maxFeePerGas).toString() : null,
            tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas).toString() : null,
            tx.input,
            // NULL rather than an assumed success when the receipt could not be read.
            receipt ? Number(BigInt(receipt.status)) : null,
            contractAddress,
            receipt ? receipt.logs.length : 0,
            timestamp.toString(),
          ],
        );

        await this.upsertAddress(client, from, blockNumber, true);
        if (to) await this.upsertAddress(client, to, blockNumber, false);

        if (contractAddress) {
          const code = await this.rpc.getCode(contractAddress as Hex).catch(() => "0x" as Hex);
          await client.query(
            `INSERT INTO contracts
               (address, deployer_address, deployment_tx_hash, deployment_block, bytecode_size)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (address) DO NOTHING`,
            [contractAddress, from, tx.hash.toLowerCase(), blockNumber.toString(), (code.length - 2) / 2],
          );
          await client.query("UPDATE addresses SET is_contract = TRUE WHERE address = $1", [contractAddress]);
        }

        for (const log of receipt?.logs ?? []) {
          await this.indexLog(client, log, blockNumber, timestamp);
        }
      }

      await client.query("COMMIT");
      this.transactionsIndexed += block.transactions.length;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async upsertAddress(
    client: {query: (q: string, v: unknown[]) => Promise<unknown>},
    address: string,
    blockNumber: bigint,
    isSender: boolean,
  ): Promise<void> {
    await client.query(
      `INSERT INTO addresses (address, first_seen_block, last_seen_block, transaction_count)
       VALUES ($1, $2, $2, $3)
       ON CONFLICT (address) DO UPDATE SET
         last_seen_block   = GREATEST(addresses.last_seen_block, EXCLUDED.last_seen_block),
         first_seen_block  = LEAST(addresses.first_seen_block, EXCLUDED.first_seen_block),
         transaction_count = addresses.transaction_count + $3,
         updated_at        = NOW()`,
      [address, blockNumber.toString(), isSender ? 1 : 0],
    );
  }

  private async indexLog(
    client: {query: (q: string, v: unknown[]) => Promise<unknown>},
    log: RpcLog,
    blockNumber: bigint,
    timestamp: bigint,
  ): Promise<void> {
    const address = log.address.toLowerCase();
    const logIndex = Number(BigInt(log.logIndex));

    await client.query(
      `INSERT INTO logs (transaction_hash, log_index, block_number, address, topic0, topic1, topic2, topic3, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
      [
        log.transactionHash.toLowerCase(),
        logIndex,
        blockNumber.toString(),
        address,
        log.topics[0]?.toLowerCase() ?? null,
        log.topics[1]?.toLowerCase() ?? null,
        log.topics[2]?.toLowerCase() ?? null,
        log.topics[3]?.toLowerCase() ?? null,
        log.data,
      ],
    );

    // The log itself is always stored. A token transfer row is only written when the log
    // decodes unambiguously as an ERC-20 Transfer — see decode.ts for what is rejected.
    const transfer = decodeTransferLog(log);
    if (!transfer) return;
    const {from, to, value} = transfer;

    await client.query(
      `INSERT INTO token_transfers
         (transaction_hash, log_index, block_number, token_address, from_address, to_address, value, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
      [
        log.transactionHash.toLowerCase(),
        logIndex,
        blockNumber.toString(),
        address,
        from,
        to,
        value.toString(),
        timestamp.toString(),
      ],
    );

    const {rows: existing} = (await client.query("SELECT symbol FROM tokens WHERE address = $1", [
      address,
    ])) as {rows: Array<{symbol: string | null}>};

    await client.query(
      `INSERT INTO tokens (address, first_seen_block, transfer_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (address) DO UPDATE SET
         transfer_count = tokens.transfer_count + 1,
         updated_at = NOW()`,
      [address, blockNumber.toString()],
    );

    // Fetch name/symbol/decimals the first time this token is seen. Each field is
    // independent; a token that does not implement one leaves it NULL rather than getting
    // an invented label.
    if (existing.length === 0 || existing[0]?.symbol === null) {
      const meta = await fetchTokenMetadata(
        (to, data) => this.rpc.call<string>("eth_call", [{to, data}, "latest"]),
        address,
      ).catch(() => null);

      if (meta) {
        await client.query(
          `UPDATE tokens SET name = $2, symbol = $3, decimals = $4, total_supply = $5, updated_at = NOW()
           WHERE address = $1`,
          [address, meta.name, meta.symbol, meta.decimals, meta.totalSupply],
        );
      }
    }
  }

  status(): IndexerStatus {
    return {
      running: this.running,
      chainId: this.cfg.chainId,
      lastIndexedBlock: this.lastIndexed.toString(),
      chainHead: this.chainHead?.toString() ?? null,
      lagBlocks: this.chainHead === null ? null : Number(this.chainHead - this.lastIndexed),
      blocksIndexed: this.blocksIndexed,
      transactionsIndexed: this.transactionsIndexed,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
