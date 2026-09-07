/** Batch encoding must round-trip exactly: a reconstructor gets the bytes the sequencer sent. */
import {describe, expect, it} from "vitest";
import {encodeBatch, decodeBatch, BATCH_FORMAT_VERSION, type BatchBlock} from "../src/batcher/encoding.js";
import type {Hex} from "../src/engine/types.js";

const RAW_TX_A =
  "0x02f8748220e4808405f5e1008502540be400825208941234567890123456789012345678901234567890880de0b6b3a764000080c001a0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const RAW_TX_B =
  "0x02f8748220e4018405f5e1008502540be400825208949876543210987654321098765432109876543210880de0b6b3a764000080c001a0cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccca0dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex;

describe("batch encoding", () => {
  it("stamps the format version in the first byte", () => {
    const payload = encodeBatch([{number: 1n, timestamp: 100n, transactions: []}]);
    expect(payload[0]).toBe(BATCH_FORMAT_VERSION);
  });

  it("round-trips block numbers, timestamps and raw transactions", () => {
    const blocks: BatchBlock[] = [
      {number: 42n, timestamp: 1_700_000_000n, transactions: [RAW_TX_A, RAW_TX_B]},
      {number: 43n, timestamp: 1_700_000_002n, transactions: []},
      {number: 44n, timestamp: 1_700_000_004n, transactions: [RAW_TX_A]},
    ];

    const decoded = decodeBatch(encodeBatch(blocks));

    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.number).toBe(42n);
    expect(decoded[0]!.timestamp).toBe(1_700_000_000n);
    expect(decoded[0]!.transactions).toEqual([RAW_TX_A, RAW_TX_B]);
    expect(decoded[1]!.transactions).toEqual([]);
    expect(decoded[2]!.number).toBe(44n);
  });

  it("handles a zero block number and zero timestamp", () => {
    const decoded = decodeBatch(encodeBatch([{number: 0n, timestamp: 0n, transactions: []}]));
    expect(decoded[0]!.number).toBe(0n);
    expect(decoded[0]!.timestamp).toBe(0n);
  });

  it("compresses repetitive payloads", () => {
    const many: BatchBlock[] = Array.from({length: 40}, (_, i) => ({
      number: BigInt(i),
      timestamp: BigInt(1_700_000_000 + i * 2),
      transactions: [RAW_TX_A],
    }));
    const payload = encodeBatch(many);
    const rawSize = many.reduce((n, b) => n + b.transactions.join("").length / 2, 0);
    expect(payload.length).toBeLessThan(rawSize);
  });

  it("rejects an unknown format version", () => {
    const payload = encodeBatch([{number: 1n, timestamp: 1n, transactions: []}]);
    payload[0] = 9;
    expect(() => decodeBatch(payload)).toThrow(/unsupported KAURAX batch format version 9/);
  });

  it("rejects a truncated payload", () => {
    expect(() => decodeBatch(new Uint8Array([0]))).toThrow(/too short/);
  });

  it("rejects corrupted compressed data rather than returning partial blocks", () => {
    const payload = encodeBatch([{number: 1n, timestamp: 1n, transactions: [RAW_TX_A]}]);
    payload[payload.length - 3] ^= 0xff;
    expect(() => decodeBatch(payload)).toThrow();
  });
});
