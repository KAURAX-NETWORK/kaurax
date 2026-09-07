/**
 * Where deposit derivation resumes after a restart.
 *
 * This file exists because of a real failure: derivation used to resume from the *current*
 * L2 head, so every deposit emitted while the node was down was skipped permanently. The
 * funds stayed escrowed on the L2 and never arrived on the L3, and a forced transaction —
 * the mechanism that is supposed to make censorship impossible — could be defeated by
 * simply restarting the sequencer.
 *
 * The cursor stored here is deliberately conservative: it is the next L2 block whose
 * deposits have NOT yet been sealed into an L3 block. It advances only after the sequencer
 * has written the including block to the write-ahead log. Resuming therefore re-derives
 * anything that was scanned but not yet included — which is correct, because those deposits
 * were never applied — and never re-derives anything that was, which would mint twice.
 */
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync} from "node:fs";
import {dirname} from "node:path";

interface CheckpointFile {
  /** Next L2 block to scan. Everything below it has been derived AND sealed. */
  cursor: string;
  updatedAt: string;
}

export class DerivationCheckpoint {
  private cursor: bigint | null = null;

  constructor(private readonly path: string) {}

  /** Returns the stored cursor, or null when this node has never checkpointed. */
  load(): bigint | null {
    if (!existsSync(this.path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as CheckpointFile;
      const cursor = BigInt(parsed.cursor);
      this.cursor = cursor;
      return cursor;
    } catch {
      // A corrupt checkpoint must not be silently treated as "no checkpoint": that would
      // resume from head and lose deposits, which is the exact bug this file prevents.
      throw new Error(
        `Derivation checkpoint at ${this.path} is unreadable. Refusing to guess where to ` +
          `resume: set KAURAX_DERIVATION_FROM_L2_BLOCK to the correct L2 block explicitly, ` +
          `or delete the file only if this node has never processed a deposit.`,
      );
    }
  }

  get current(): bigint | null {
    return this.cursor;
  }

  /**
   * Records that every deposit up to and including `throughL2Block` is sealed.
   * Written atomically and fsync'd: a crash leaves either the old cursor or the new one.
   */
  save(nextL2Block: bigint): void {
    if (this.cursor !== null && nextL2Block <= this.cursor) return; // never move backwards
    this.cursor = nextL2Block;

    mkdirSync(dirname(this.path), {recursive: true});
    const body: CheckpointFile = {cursor: nextL2Block.toString(), updatedAt: new Date().toISOString()};
    const tmp = `${this.path}.tmp`;

    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, `${JSON.stringify(body)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}
