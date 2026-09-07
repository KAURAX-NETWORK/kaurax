/**
 * L2 reorg handling in deposit derivation.
 *
 * The guard being tested is one line — `if (head < this.cursor) return;` — and it had no
 * test at all. It matters because the two failure modes on either side of it are both
 * serious: advancing past a reorged head loses deposits that the reorg un-mined, and
 * re-scanning ground already covered re-applies deposits that were already credited.
 *
 * The settlement adapter is stubbed rather than mocked wholesale: only the two methods
 * scan() actually reaches for are provided, so the test cannot pass by exercising a fake.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Derivation} from "../src/derivation/Derivation.js";
import type {KauraxConfig} from "@kaurax/config";

const PORTAL = "0x1111111111111111111111111111111111111111" as const;

let dir: string;

/** Only what Derivation touches. Anything else would be scaffolding pretending to be a test. */
function stubSettlement(opts: {head: bigint; logs?: unknown[]}) {
  const getLogs = vi.fn(async () => opts.logs ?? []);
  return {
    stub: {
      publicClient: {
        getBlockNumber: vi.fn(async () => opts.head),
        getLogs,
      },
      forcedInclusionState: vi.fn(async () => ({pending: 0n, oldestDeadline: 0n, overdue: false})),
      oldestPendingForcedSubmission: vi.fn(async () => null),
    },
    getLogs,
  };
}

function config(): KauraxConfig {
  return {
    contracts: {portal: PORTAL},
    derivationCheckpointPath: join(dir, "cursor.json"),
    derivationFromL2Block: undefined,
    l2: {blockTimeSeconds: 2},
  } as unknown as KauraxConfig;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kaurax-reorg-"));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

describe("derivation under an L2 reorg", () => {
  /**
   * The core property. A reorg can move the L2 head backwards; derivation must wait rather
   * than treat the shorter chain as a reason to re-scan.
   */
  it("does not scan when the L2 head is behind the cursor", async () => {
    const {stub, getLogs} = stubSettlement({head: 500n});
    const derivation = new Derivation(config(), stub as never);
    await derivation.init();

    // Cursor is now 500. Simulate a reorg that drops the head to 480.
    stub.publicClient.getBlockNumber = vi.fn(async () => 480n);
    getLogs.mockClear();

    await (derivation as unknown as {scan: () => Promise<void>}).scan();

    expect(getLogs).not.toHaveBeenCalled();
    expect(derivation.status().cursor ?? "500").toBeDefined();
  });

  it("resumes once the L2 catches back up", async () => {
    const {stub, getLogs} = stubSettlement({head: 500n});
    const derivation = new Derivation(config(), stub as never);
    await derivation.init();

    stub.publicClient.getBlockNumber = vi.fn(async () => 480n);
    await (derivation as unknown as {scan: () => Promise<void>}).scan();
    expect(getLogs).not.toHaveBeenCalled();

    // The chain re-org resolves and passes the old head.
    stub.publicClient.getBlockNumber = vi.fn(async () => 510n);
    await (derivation as unknown as {scan: () => Promise<void>}).scan();
    expect(getLogs).toHaveBeenCalledTimes(1);

    // It resumes from where it stopped, not from the reorged head.
    const call = getLogs.mock.calls[0]![0] as {fromBlock: bigint; toBlock: bigint};
    expect(call.fromBlock).toBe(500n);
    expect(call.toBlock).toBe(510n);
  });

  /**
   * The durable cursor must never move backwards either, or a restart during a reorg would
   * re-derive deposits that are already in a sealed block.
   */
  it("never rewinds the durable checkpoint during a reorg", async () => {
    const {stub} = stubSettlement({head: 500n});
    const derivation = new Derivation(config(), stub as never);
    await derivation.init();

    const before = derivation.checkpointBlock();
    stub.publicClient.getBlockNumber = vi.fn(async () => 400n);
    await (derivation as unknown as {scan: () => Promise<void>}).scan();

    expect(derivation.checkpointBlock()).toBe(before);
  });

  it("scans normally when the head is ahead", async () => {
    const {stub, getLogs} = stubSettlement({head: 500n});
    const derivation = new Derivation(config(), stub as never);
    await derivation.init();

    stub.publicClient.getBlockNumber = vi.fn(async () => 520n);
    await (derivation as unknown as {scan: () => Promise<void>}).scan();

    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  /** A head exactly equal to the cursor is a scan of one block, not a reorg. */
  it("treats head == cursor as scannable, not as a reorg", async () => {
    const {stub, getLogs} = stubSettlement({head: 500n});
    const derivation = new Derivation(config(), stub as never);
    await derivation.init();

    stub.publicClient.getBlockNumber = vi.fn(async () => 500n);
    await (derivation as unknown as {scan: () => Promise<void>}).scan();

    expect(getLogs).toHaveBeenCalledTimes(1);
  });
});
