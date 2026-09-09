/**
 * A published batch must contain every transaction in the range it advertises.
 *
 * This is the property KAURAX leads with: "publishes every block to the L2 as calldata, so
 * anyone can rebuild the chain without asking KAURAX for anything". If a batch says it covers
 * blocks 2-7 and block 7's transactions are not in the payload, that sentence is false, and
 * nothing on chain says so — the commitment still matches the bytes that were published.
 *
 * Observed in CI, which is why these tests exist:
 *
 *   WARN [batcher] block payload unavailable; batching header only block="7" txCount=1
 *   INFO [batcher] batch submitted to L2 batchIndex=0 l3Blocks="2-7" txCount=5
 *
 * Block 7 held the transaction the acceptance suite had just sent. Its write-ahead log entry
 * was not durable yet, so the batcher published an empty block 7 and advertised it as covered.
 */
import {describe, expect, it, vi} from "vitest";
import {Batcher} from "../src/batcher/Batcher.js";
import {decodeBatch} from "../src/batcher/encoding.js";
import type {BatchBlock} from "../src/batcher/encoding.js";

type Raw = `0x${string}`;

const TX_IN_BLOCK_7: Raw = "0xdeadbeef";

function blockWith(number: bigint, txs: Raw[]): BatchBlock {
  return {number, timestamp: 1_000n + number, transactions: txs};
}

/** Blocks 2..7; only block 7 carries a transaction, and only block 7's payload is missing. */
function harness(opts: {durableThrough: bigint; head: bigint}) {
  const published: {payload: Uint8Array; l3StartBlock: bigint; l3EndBlock: bigint}[] = [];

  const engine = {
    getBlockNumber: async () => opts.head,
    getBlock: async (n: bigint) => ({
      number: n,
      timestamp: 1_000n + n,
      // The engine always knows the truth, even when the write-ahead log lags.
      transactions: n === 7n ? [TX_IN_BLOCK_7] : [],
    }),
  };

  const payloads = {
    getBlockPayload: async (n: bigint): Promise<BatchBlock | null> =>
      n <= opts.durableThrough ? blockWith(n, n === 7n ? [TX_IN_BLOCK_7] : []) : null,
    pruneWal: vi.fn(),
  };

  const da = {
    mode: "calldata" as const,
    publish: async (payload: Uint8Array, meta: {l3StartBlock: bigint; l3EndBlock: bigint}) => {
      published.push({payload, ...meta});
      return {txHash: "0xbatch" as Raw, blockNumber: 1n};
    },
    resolve: async () => null,
  };

  // init() resumes from what the L2 already has. Nothing has been batched here, so it
  // starts just after the genesis block — the same arithmetic the devnet uses.
  const settlement = {
    batchCount: async () => BigInt(published.length),
    lastBatchL3Block: async () => 0n,
  };

  const cfg = {
    genesisBlock: 1,
    batcher: {maxL3BlocksPerBatch: 10},
    da: {maxBatchBytes: 1_000_000},
  };

  const batcher = new Batcher(
    cfg as never,
    engine as never,
    da as never,
    settlement as never,
    payloads as never,
  );
  return {batcher, published, payloads};
}

describe("a batch never advertises a block it does not carry", () => {
  it("stops before a block whose transactions are not durable yet", async () => {
    // Blocks 2-6 are durable, block 7 is not — the exact CI failure.
    const {batcher, published} = harness({durableThrough: 6n, head: 7n});
    await batcher.init();

    const submission = await batcher.flush();

    expect(submission).not.toBeNull();
    expect(submission!.l3EndBlock).toBe(6n);
    expect(published[0]!.l3EndBlock).toBe(6n);

    // And the payload really does stop at 6, rather than the advertised range alone.
    const decoded = decodeBatch(published[0]!.payload);
    expect(decoded.map((b) => b.number)).toEqual([2n, 3n, 4n, 5n, 6n]);
  });

  it("carries the block once its payload becomes durable", async () => {
    const {batcher, published} = harness({durableThrough: 7n, head: 7n});
    await batcher.init();

    const submission = await batcher.flush();

    expect(submission!.l3EndBlock).toBe(7n);
    const decoded = decodeBatch(published[0]!.payload);
    expect(decoded.map((b) => b.number)).toEqual([2n, 3n, 4n, 5n, 6n, 7n]);

    // The property the whole thing exists for: every advertised block's transactions are in
    // the bytes that were published.
    const recovered = decoded.flatMap((b) => b.transactions);
    expect(recovered).toContain(TX_IN_BLOCK_7);
  });

  it("resumes from the truncation point rather than skipping the block", async () => {
    const {batcher} = harness({durableThrough: 6n, head: 7n});
    await batcher.init();

    await batcher.flush();
    expect(batcher.status().nextL3BlockToBatch).toBe(7n);

    // The log catches up; block 7 goes out next, complete.
    const caughtUp = harness({durableThrough: 7n, head: 7n});
    await caughtUp.batcher.init();
    await caughtUp.batcher.flush();
    const decoded = decodeBatch(caughtUp.published[0]!.payload);
    expect(decoded.flatMap((b) => b.transactions)).toContain(TX_IN_BLOCK_7);
  });

  it("never prunes the write-ahead log past what was published", async () => {
    const {batcher, payloads} = harness({durableThrough: 6n, head: 7n});
    await batcher.init();
    await batcher.flush();
    // Pruning through 7 would destroy the only copy of block 7's transaction.
    expect(payloads.pruneWal).toHaveBeenCalledWith(6n);
  });

  it("an empty block with no durable payload is still batched, because nothing is lost", async () => {
    // Head 6: every block in range is empty, and none of them is durable.
    const {batcher, published} = harness({durableThrough: 1n, head: 6n});
    await batcher.init();

    const submission = await batcher.flush();

    expect(submission!.l3EndBlock).toBe(6n);
    expect(decodeBatch(published[0]!.payload).map((b) => b.number)).toEqual([2n, 3n, 4n, 5n, 6n]);
  });
});
