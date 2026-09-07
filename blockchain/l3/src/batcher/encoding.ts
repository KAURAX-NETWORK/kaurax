/**
 * KAURAX batch payload format, version 0.
 *
 *   byte 0        : format version (0x00)
 *   bytes 1..n    : zlib-deflated RLP
 *
 * The RLP body is a list of blocks:
 *
 *   [ [blockNumber, timestamp, [rawTx, rawTx, ...]], ... ]
 *
 * Deposits are deliberately absent. A deposit's authoritative record is the
 * `TransactionDeposited` event on the underlying L2, which is already covered by that
 * chain's own data availability. Re-posting it inside a KAURAX batch would pay twice for
 * the same bytes and create a second, divergeable source of truth. A node reconstructing
 * KAURAX therefore replays batches *and* re-derives deposits from the L2 — the same split
 * the OP Stack makes.
 */
import {deflateSync, inflateSync} from "node:zlib";
import {fromRlp, toRlp, numberToHex, type Hex} from "viem";

export const BATCH_FORMAT_VERSION = 0;

export interface BatchBlock {
  number: bigint;
  timestamp: bigint;
  transactions: Hex[];
}

export function encodeBatch(blocks: BatchBlock[]): Uint8Array {
  const rlp = toRlp(
    blocks.map((b) => [
      numberToHex(b.number),
      numberToHex(b.timestamp),
      b.transactions as readonly Hex[],
    ]) as never,
    "bytes",
  );

  const compressed = deflateSync(Buffer.from(rlp), {level: 9});
  const out = new Uint8Array(compressed.length + 1);
  out[0] = BATCH_FORMAT_VERSION;
  out.set(compressed, 1);
  return out;
}

export function decodeBatch(payload: Uint8Array): BatchBlock[] {
  if (payload.length < 2) throw new Error("batch payload is too short");
  const version = payload[0];
  if (version !== BATCH_FORMAT_VERSION) {
    throw new Error(`unsupported KAURAX batch format version ${version}`);
  }

  const rlp = inflateSync(Buffer.from(payload.subarray(1)));
  const decoded = fromRlp(new Uint8Array(rlp), "hex") as unknown as Array<[Hex, Hex, Hex[]]>;

  return decoded.map(([number, timestamp, transactions]) => ({
    number: BigInt(number === "0x" ? 0 : number),
    timestamp: BigInt(timestamp === "0x" ? 0 : timestamp),
    transactions,
  }));
}

/** Uncompressed size of the RLP body, for compression-ratio reporting. */
export function rlpSize(blocks: BatchBlock[]): number {
  const rlp = toRlp(
    blocks.map((b) => [
      numberToHex(b.number),
      numberToHex(b.timestamp),
      b.transactions as readonly Hex[],
    ]) as never,
    "bytes",
  );
  return rlp.length;
}
