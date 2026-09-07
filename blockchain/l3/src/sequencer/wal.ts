/**
 * Write-ahead log for sequenced block payloads.
 *
 * The gap this closes: a block is sealed by the execution engine the moment it is produced,
 * but its transactions only become recoverable by anyone else once the batcher publishes
 * them to the L2. Between those two points the payload existed solely in the node's memory.
 * Losing the process meant losing those transactions — permanently, and silently.
 *
 * Every sealed block is now appended here **before** it is reported as produced, so a
 * restart replays from disk instead of shrugging. Entries are pruned only once the L2
 * confirms the batch containing them, so the log is bounded by the batching lag rather
 * than by chain length.
 *
 * Format: newline-delimited JSON, one record per block, appended with an fsync. Chosen over
 * a database because the recovery path must work when everything else is broken — a
 * corrupt tail can be truncated by hand, and a partial final line is simply discarded.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {dirname, resolve} from "node:path";
import type {BatchBlock} from "../batcher/encoding.js";
import type {Hex} from "../engine/types.js";
import {createLogger} from "../log.js";

interface WalRecord {
  n: string;
  t: string;
  txs: Hex[];
}

export class BlockWal {
  private readonly log = createLogger("wal");
  private readonly path: string;
  private fd: number | null = null;
  private entries = new Map<string, BatchBlock>();
  private appended = 0;

  constructor(path: string) {
    this.path = resolve(path);
  }

  /** Open the log, replaying whatever a previous run left behind. */
  open(): {recovered: number; from: bigint | null; to: bigint | null} {
    mkdirSync(dirname(this.path), {recursive: true});

    let recovered = 0;
    let from: bigint | null = null;
    let to: bigint | null = null;

    if (existsSync(this.path)) {
      const lines = readFileSync(this.path, "utf8").split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue;
        let record: WalRecord;
        try {
          record = JSON.parse(line) as WalRecord;
        } catch {
          // A partial final line is what a crash mid-append looks like. Everything before
          // it is intact, so discard just this one rather than failing to start.
          this.log.warn("discarding a truncated write-ahead log entry");
          continue;
        }
        const block: BatchBlock = {
          number: BigInt(record.n),
          timestamp: BigInt(record.t),
          transactions: record.txs,
        };
        this.entries.set(record.n, block);
        recovered++;
        if (from === null || block.number < from) from = block.number;
        if (to === null || block.number > to) to = block.number;
      }
    }

    this.fd = openSync(this.path, "a");

    if (recovered > 0) {
      this.log.info("recovered sequenced blocks from the write-ahead log", {
        blocks: recovered,
        range: `${from}-${to}`,
      });
    }
    return {recovered, from, to};
  }

  /**
   * Durably record a sealed block. Returns once the bytes are on disk.
   *
   * Called before the block is reported as produced, so a crash immediately afterwards
   * still leaves the payload recoverable.
   */
  append(block: BatchBlock): void {
    const record: WalRecord = {
      n: block.number.toString(),
      t: block.timestamp.toString(),
      txs: block.transactions,
    };
    const line = `${JSON.stringify(record)}\n`;

    if (this.fd === null) throw new Error("write-ahead log is not open");
    appendFileSync(this.fd, line);
    // Without the fsync the write sits in the page cache, and a power loss is exactly the
    // failure this log exists to survive.
    fsyncSync(this.fd);

    this.entries.set(record.n, block);
    this.appended++;
  }

  get(blockNumber: bigint): BatchBlock | null {
    return this.entries.get(blockNumber.toString()) ?? null;
  }

  /**
   * Drop everything at or below `throughBlock` — safe only once the L2 has confirmed the
   * batch containing those blocks, because until then this is the only copy.
   */
  prune(throughBlock: bigint): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (BigInt(key) <= throughBlock) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed === 0) return 0;

    // Rewrite atomically: a crash mid-prune must not leave a half-written log.
    const tmp = `${this.path}.tmp`;
    const body = [...this.entries.values()]
      .sort((a, b) => (a.number < b.number ? -1 : 1))
      .map((b) => JSON.stringify({n: b.number.toString(), t: b.timestamp.toString(), txs: b.transactions}))
      .join("\n");

    writeFileSync(tmp, body === "" ? "" : `${body}\n`);
    const tmpFd = openSync(tmp, "r+");
    fsyncSync(tmpFd);
    closeSync(tmpFd);

    if (this.fd !== null) closeSync(this.fd);
    renameSync(tmp, this.path);
    this.fd = openSync(this.path, "a");

    this.log.debug("pruned the write-ahead log", {through: throughBlock.toString(), removed});
    return removed;
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  status(): {pendingBlocks: number; appendedTotal: number; oldest: string | null; path: string} {
    let oldest: bigint | null = null;
    for (const key of this.entries.keys()) {
      const n = BigInt(key);
      if (oldest === null || n < oldest) oldest = n;
    }
    return {
      pendingBlocks: this.entries.size,
      appendedTotal: this.appended,
      oldest: oldest?.toString() ?? null,
      path: this.path,
    };
  }
}
