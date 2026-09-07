/**
 * The write-ahead log exists for one reason: a block sealed but not yet batched must
 * survive losing the process. These tests are about that, not about happy-path storage.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BlockWal} from "../src/sequencer/wal.js";
import type {Hex} from "../src/engine/types.js";

const RAW_A = "0x02f8748220e480840001" as Hex;
const RAW_B = "0x02f8748220e401840002" as Hex;

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kaurax-wal-"));
  path = join(dir, "wal.jsonl");
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

describe("BlockWal", () => {
  it("starts empty when no log exists", () => {
    const wal = new BlockWal(path);
    const result = wal.open();
    expect(result.recovered).toBe(0);
    expect(result.from).toBeNull();
    wal.close();
  });

  it("creates the directory it needs", () => {
    const nested = join(dir, "a", "b", "wal.jsonl");
    const wal = new BlockWal(nested);
    wal.open();
    wal.append({number: 1n, timestamp: 100n, transactions: []});
    expect(existsSync(nested)).toBe(true);
    wal.close();
  });

  it("returns what it stored", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 7n, timestamp: 1700n, transactions: [RAW_A, RAW_B]});

    const got = wal.get(7n);
    expect(got).not.toBeNull();
    expect(got!.number).toBe(7n);
    expect(got!.timestamp).toBe(1700n);
    expect(got!.transactions).toEqual([RAW_A, RAW_B]);
    wal.close();
  });

  it("returns null for a block it never saw", () => {
    const wal = new BlockWal(path);
    wal.open();
    expect(wal.get(99n)).toBeNull();
    wal.close();
  });

  /** The core property: a new process recovers what the old one sealed. */
  it("recovers every entry after a restart", () => {
    const first = new BlockWal(path);
    first.open();
    first.append({number: 1n, timestamp: 100n, transactions: [RAW_A]});
    first.append({number: 2n, timestamp: 102n, transactions: []});
    first.append({number: 3n, timestamp: 104n, transactions: [RAW_B, RAW_A]});
    first.close();

    const second = new BlockWal(path);
    const result = second.open();

    expect(result.recovered).toBe(3);
    expect(result.from).toBe(1n);
    expect(result.to).toBe(3n);
    expect(second.get(3n)!.transactions).toEqual([RAW_B, RAW_A]);
    second.close();
  });

  /**
   * A crash mid-append leaves a partial final line. Everything before it is intact, so the
   * node must start and keep those blocks rather than refusing to run.
   */
  it("discards a truncated final line and keeps the rest", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 1n, timestamp: 100n, transactions: [RAW_A]});
    wal.append({number: 2n, timestamp: 102n, transactions: [RAW_B]});
    wal.close();

    // Simulate a crash part-way through writing a third record.
    appendFileSync(path, '{"n":"3","t":"104","tx');

    const recovered = new BlockWal(path);
    const result = recovered.open();

    expect(result.recovered).toBe(2);
    expect(recovered.get(1n)).not.toBeNull();
    expect(recovered.get(2n)).not.toBeNull();
    expect(recovered.get(3n)).toBeNull();
    recovered.close();
  });

  it("survives a completely corrupt log without losing valid lines", () => {
    writeFileSync(
      path,
      ['{"n":"1","t":"1","txs":[]}', "not json at all", "", '{"n":"2","t":"2","txs":[]}'].join("\n"),
    );
    const wal = new BlockWal(path);
    expect(wal.open().recovered).toBe(2);
    wal.close();
  });

  it("preserves exact uint256 values through a restart", () => {
    const huge = 2n ** 200n;
    const first = new BlockWal(path);
    first.open();
    first.append({number: huge, timestamp: huge - 1n, transactions: []});
    first.close();

    const second = new BlockWal(path);
    second.open();
    expect(second.get(huge)!.number).toBe(huge);
    expect(second.get(huge)!.timestamp).toBe(huge - 1n);
    second.close();
  });

  // ------------------------------------------------------------ pruning --

  it("prunes through a height and keeps the rest", () => {
    const wal = new BlockWal(path);
    wal.open();
    for (let i = 1n; i <= 5n; i++) wal.append({number: i, timestamp: 100n + i, transactions: []});

    expect(wal.prune(3n)).toBe(3);
    expect(wal.get(3n)).toBeNull();
    expect(wal.get(4n)).not.toBeNull();
    expect(wal.status().pendingBlocks).toBe(2);
    wal.close();
  });

  it("makes pruning durable, not just in memory", () => {
    const first = new BlockWal(path);
    first.open();
    for (let i = 1n; i <= 5n; i++) first.append({number: i, timestamp: 100n + i, transactions: [RAW_A]});
    first.prune(3n);
    first.close();

    const second = new BlockWal(path);
    expect(second.open().recovered).toBe(2);
    expect(second.get(1n)).toBeNull();
    expect(second.get(5n)).not.toBeNull();
    second.close();
  });

  it("can still append after pruning", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 1n, timestamp: 1n, transactions: []});
    wal.prune(1n);
    wal.append({number: 2n, timestamp: 2n, transactions: [RAW_A]});
    wal.close();

    const reopened = new BlockWal(path);
    expect(reopened.open().recovered).toBe(1);
    expect(reopened.get(2n)!.transactions).toEqual([RAW_A]);
    reopened.close();
  });

  it("pruning everything leaves an empty but usable log", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 1n, timestamp: 1n, transactions: []});
    wal.prune(10n);
    expect(wal.status().pendingBlocks).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("");
    wal.close();

    const reopened = new BlockWal(path);
    expect(reopened.open().recovered).toBe(0);
    reopened.close();
  });

  it("pruning below the oldest entry changes nothing", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 10n, timestamp: 1n, transactions: []});
    expect(wal.prune(5n)).toBe(0);
    expect(wal.status().pendingBlocks).toBe(1);
    wal.close();
  });

  it("reports the oldest unbatched block, which is the data-loss window", () => {
    const wal = new BlockWal(path);
    wal.open();
    wal.append({number: 42n, timestamp: 1n, transactions: []});
    wal.append({number: 43n, timestamp: 2n, transactions: []});

    const status = wal.status();
    expect(status.oldest).toBe("42");
    expect(status.pendingBlocks).toBe(2);
    expect(status.appendedTotal).toBe(2);
    wal.close();
  });

  it("refuses to append when not open", () => {
    const wal = new BlockWal(path);
    expect(() => wal.append({number: 1n, timestamp: 1n, transactions: []})).toThrow(/not open/);
  });
});
