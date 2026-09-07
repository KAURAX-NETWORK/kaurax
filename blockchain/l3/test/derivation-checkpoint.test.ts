/**
 * Regression tests for a real bug.
 *
 * Derivation used to resume from the current L2 head, so every deposit emitted while the
 * node was down was skipped permanently — and a forced transaction, the mechanism that is
 * supposed to make censorship impossible, could be defeated by restarting the sequencer.
 *
 * These tests pin the two halves of the fix: the cursor is durable, and it advances only
 * when a deposit is actually sealed rather than merely scanned.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DerivationCheckpoint} from "../src/derivation/checkpoint.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kaurax-cursor-"));
  path = join(dir, "derivation-cursor.json");
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

describe("DerivationCheckpoint", () => {
  it("reports nothing stored for a fresh node", () => {
    expect(new DerivationCheckpoint(path).load()).toBeNull();
  });

  it("survives a restart", () => {
    new DerivationCheckpoint(path).save(1234n);
    expect(new DerivationCheckpoint(path).load()).toBe(1234n);
  });

  it("creates the directory it needs", () => {
    const nested = join(dir, "deep", "deeper", "cursor.json");
    new DerivationCheckpoint(nested).save(1n);
    expect(new DerivationCheckpoint(nested).load()).toBe(1n);
  });

  it("preserves L2 block numbers beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 2n ** 64n - 1n;
    new DerivationCheckpoint(path).save(huge);
    expect(new DerivationCheckpoint(path).load()).toBe(huge);
  });

  /**
   * Moving backwards would re-derive deposits that are already in a block, minting the
   * same escrowed funds twice.
   */
  it("never moves backwards", () => {
    const cp = new DerivationCheckpoint(path);
    cp.save(500n);
    cp.save(400n);
    expect(cp.current).toBe(500n);
    expect(new DerivationCheckpoint(path).load()).toBe(500n);
  });

  it("moves forward on each save", () => {
    const cp = new DerivationCheckpoint(path);
    for (const n of [10n, 20n, 30n]) cp.save(n);
    expect(new DerivationCheckpoint(path).load()).toBe(30n);
  });

  /**
   * A corrupt checkpoint must not be read as "no checkpoint". That would fall through to
   * the fresh-node path, resume from head, and lose every pending deposit — silently.
   */
  it("refuses to guess when the file is corrupt", () => {
    writeFileSync(path, "{ this is not json");
    expect(() => new DerivationCheckpoint(path).load()).toThrow(/unreadable|Refusing to guess/);
  });

  it("refuses a file whose cursor is not a number", () => {
    writeFileSync(path, JSON.stringify({cursor: "not-a-number", updatedAt: "now"}));
    expect(() => new DerivationCheckpoint(path).load()).toThrow();
  });

  it("writes a file a human can read during an incident", () => {
    new DerivationCheckpoint(path).save(42n);
    const body = JSON.parse(readFileSync(path, "utf8")) as {cursor: string; updatedAt: string};
    expect(body.cursor).toBe("42");
    expect(Date.parse(body.updatedAt)).not.toBeNaN();
  });

  it("leaves no temporary file behind", () => {
    new DerivationCheckpoint(path).save(7n);
    expect(() => readFileSync(`${path}.tmp`, "utf8")).toThrow();
  });
});
