/**
 * The KAURAX batcher.
 *
 *   L3 blocks -> RLP -> zlib -> DA target (calldata on the underlying L2)
 *
 * It is deliberately decoupled from the sequencer: it reads sealed blocks and their
 * payloads, and never influences what goes into one. If the batcher stalls, KAURAX keeps
 * producing blocks — they simply are not yet available to anyone reconstructing the chain
 * from the L2, which is exactly the liveness/DA distinction the architecture is meant to
 * make visible rather than hide.
 */
import type {KauraxConfig} from "@kaurax/config";
import type {ExecutionEngine, Hex} from "../engine/types.js";
import type {
  BatchSubmission,
  BatcherInterface,
  BatcherStatus,
  DataAvailabilityInterface,
} from "../settlement/types.js";
import type {L2SettlementAdapter} from "../settlement/L2SettlementAdapter.js";
import {encodeBatch, rlpSize, type BatchBlock} from "./encoding.js";
import {createLogger} from "../log.js";

/** Supplies the raw transaction bytes the sequencer put into each block. */
export interface BlockPayloadSource {
  getBlockPayload(blockNumber: bigint): Promise<BatchBlock | null>;
  /**
   * Release the durable copy of blocks up to and including this height. Called only after
   * the L2 has mined the batch containing them — until that point the write-ahead log is
   * the only copy those transactions have.
   */
  pruneWal(throughBlock: bigint): void;
}

export class Batcher implements BatcherInterface {
  private readonly log = createLogger("batcher");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;

  private nextBlock = 1n;
  private lastSubmission: BatchSubmission | null = null;
  private lastError: string | null = null;
  private head = 0n;

  constructor(
    private readonly cfg: KauraxConfig,
    private readonly engine: ExecutionEngine,
    private readonly da: DataAvailabilityInterface,
    private readonly settlement: L2SettlementAdapter,
    private readonly payloads: BlockPayloadSource,
  ) {}

  /**
   * Resume from whatever the L2 already has, so a restart never re-posts or skips.
   *
   * When nothing has been batched yet, start just after the genesis block. Genesis state
   * is distributed as a config artifact rather than through data availability, so posting
   * it would be paying to publish something every node already has.
   */
  async init(): Promise<void> {
    const lastOnL2 = await this.settlement.lastBatchL3Block();
    const count = await this.settlement.batchCount();
    this.nextBlock = count === 0n ? BigInt(this.cfg.genesisBlock) + 1n : lastOnL2 + 1n;
    this.log.info("batcher initialised", {
      batchesOnL2: count.toString(),
      genesisBlock: this.cfg.genesisBlock,
      resumeFromL3Block: this.nextBlock.toString(),
      daMode: this.da.mode,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const period = this.cfg.batcher.intervalSeconds * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, period);
    this.log.info("batcher started", {intervalSeconds: this.cfg.batcher.intervalSeconds});
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flush();
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error("batch submission failed", {error: this.lastError});
    } finally {
      this.busy = false;
    }
  }

  /** Collect, compress and publish everything sealed since the last submission. */
  async flush(): Promise<BatchSubmission | null> {
    this.head = await this.engine.getBlockNumber();
    if (this.head < this.nextBlock) return null;

    const end =
      this.head - this.nextBlock + 1n > BigInt(this.cfg.batcher.maxL3BlocksPerBatch)
        ? this.nextBlock + BigInt(this.cfg.batcher.maxL3BlocksPerBatch) - 1n
        : this.head;

    const blocks: BatchBlock[] = [];
    for (let n = this.nextBlock; n <= end; n++) {
      const payload = await this.payloads.getBlockPayload(n);
      if (payload) {
        blocks.push(payload);
        continue;
      }
      // No recorded payload. With the write-ahead log this should only happen for blocks
      // produced before the log existed, or for genesis. It is still handled rather than
      // fatal, and logged loudly when the block was not empty.
      const block = await this.engine.getBlock(n);
      if (!block) throw new Error(`engine has no block ${n}`);
      if (block.transactions.length > 0) {
        this.log.warn("block payload unavailable; batching header only", {
          block: n.toString(),
          txCount: block.transactions.length,
        });
      }
      blocks.push({number: block.number, timestamp: block.timestamp, transactions: []});
    }

    if (blocks.length === 0) return null;

    const uncompressed = rlpSize(blocks);
    const payload = encodeBatch(blocks);

    if (payload.length > this.cfg.da.maxBatchBytes) {
      throw new Error(
        `compressed batch is ${payload.length} bytes, over the ${this.cfg.da.maxBatchBytes} byte limit; ` +
          `lower BATCH_MAX_L3_BLOCKS`,
      );
    }

    const commitment = await this.da.publish(payload, {l3StartBlock: this.nextBlock, l3EndBlock: end});
    const batchCount = await this.settlement.batchCount();

    const submission: BatchSubmission = {
      batchIndex: Number(batchCount - 1n),
      l3StartBlock: this.nextBlock,
      l3EndBlock: end,
      uncompressedBytes: uncompressed,
      compressedBytes: payload.length,
      commitment,
      submittedAt: Date.now(),
    };

    const txCount = blocks.reduce((n, b) => n + b.transactions.length, 0);
    this.log.info("batch submitted to L2", {
      batchIndex: submission.batchIndex,
      l3Blocks: `${this.nextBlock}-${end}`,
      txCount,
      bytes: `${uncompressed}->${payload.length}`,
      l2Tx: commitment.txHash,
      l2Block: commitment.blockNumber?.toString() ?? "pending",
    });

    this.nextBlock = end + 1n;
    this.lastSubmission = submission;

    // The L2 has the data now, so the local copy can go. Only here — pruning before the
    // batch was mined would discard the only copy of something not yet published.
    this.payloads.pruneWal(end);

    return submission;
  }

  status(): BatcherStatus {
    const pending = this.head >= this.nextBlock ? Number(this.head - this.nextBlock + 1n) : 0;
    return {
      running: this.running,
      lastSubmission: this.lastSubmission,
      lastError: this.lastError,
      nextL3BlockToBatch: this.nextBlock,
      pendingL3Blocks: pending,
    };
  }
}
