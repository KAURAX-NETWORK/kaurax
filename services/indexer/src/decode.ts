/**
 * Pure decoding helpers.
 *
 * Kept separate from the Indexer class so they can be tested without a database or a chain.
 * These are the functions most likely to be subtly wrong — topic layouts and word offsets —
 * so they are the ones worth pinning with tests.
 */
export type Hex = `0x${string}`;

/** Event topic0 for ERC-20 Transfer: keccak256("Transfer(address,address,uint256)"). */
export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex; // topic0, not a key

export interface TransferLog {
  topics: string[];
  data: string;
}

export interface DecodedTransfer {
  from: string;
  to: string;
  value: bigint;
}

/**
 * Decode an ERC-20 Transfer log, or return null.
 *
 * Returns null — rather than guessing — for anything that is not unambiguously an ERC-20
 * transfer:
 *   * a different event signature,
 *   * a 4-topic Transfer, which is ERC-721 (the third topic is a tokenId, not an amount,
 *     and counting it as a token transfer would report NFT IDs as balances),
 *   * malformed topics or a data field too short to hold a uint256.
 */
export function decodeTransferLog(log: TransferLog): DecodedTransfer | null {
  const topic0 = log.topics[0]?.toLowerCase();
  if (topic0 !== ERC20_TRANSFER_TOPIC) return null;

  // Exactly three topics: signature + two indexed addresses. Four means ERC-721.
  if (log.topics.length !== 3) return null;

  const fromTopic = log.topics[1];
  const toTopic = log.topics[2];
  if (!isTopic(fromTopic) || !isTopic(toTopic)) return null;

  // An indexed address is right-aligned in a 32-byte word: the low 20 bytes.
  const from = `0x${fromTopic.slice(26)}`.toLowerCase();
  const to = `0x${toTopic.slice(26)}`.toLowerCase();

  // The value is the first (and only) non-indexed word.
  const data = log.data ?? "0x";
  if (!/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const body = data.slice(2);
  if (body.length < 64) return null;

  let value: bigint;
  try {
    value = BigInt(`0x${body.slice(0, 64)}`);
  } catch {
    return null;
  }

  return {from, to, value};
}

function isTopic(v: string | undefined): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** Normalise an address for storage. Returns null if it is not one. */
export function normaliseAddress(v: unknown): string | null {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
}
