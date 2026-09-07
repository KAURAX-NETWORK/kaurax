/**
 * ERC-20 metadata enrichment.
 *
 * `name()`, `symbol()` and `decimals()` are optional in ERC-20, and plenty of real tokens
 * implement them oddly (bytes32 instead of string, or not at all). So every field is
 * fetched independently and a failure leaves that field NULL rather than blocking the row
 * or substituting a placeholder like "Unknown Token".
 */
export type Hex = `0x${string}`;

/** Function selectors: name(), symbol(), decimals(), totalSupply() */
const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
} as const;

export interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
}

/** Decode an ABI-encoded `string` return value, or a bytes32 one, or give up. */
export function decodeStringReturn(data: string): string | null {
  if (typeof data !== "string" || !data.startsWith("0x")) return null;
  const body = data.slice(2);
  if (body.length === 0) return null;

  // Standard dynamic string: offset word, length word, then the bytes.
  if (body.length >= 128) {
    try {
      const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
      if (offset === 32) {
        const length = Number(BigInt(`0x${body.slice(64, 128)}`));
        if (length > 0 && length <= 1024 && body.length >= 128 + length * 2) {
          const text = hexToUtf8(body.slice(128, 128 + length * 2));
          if (text !== null) return text;
        }
      }
    } catch {
      // Fall through to the bytes32 interpretation.
    }
  }

  // Non-standard bytes32 name/symbol, as used by some early tokens.
  if (body.length === 64) {
    const text = hexToUtf8(body.replace(/(00)+$/, ""));
    if (text !== null && text.length > 0) return text;
  }

  return null;
}

/**
 * Control characters, including DEL. A token whose name decodes to control bytes is
 * reported as having no name rather than being given a garbled one.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const TRAILING_NULS = /\u0000+$/;

function hexToUtf8(hex: string): string | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      if (Number.isNaN(byte)) return null;
      bytes[i] = byte;
    }
    const text = new TextDecoder("utf-8", {fatal: false}).decode(bytes).replace(TRAILING_NULS, "").trim();
    return text.length > 0 && !CONTROL_CHARS.test(text) ? text : null;
  } catch {
    return null;
  }
}

export function decodeUintReturn(data: string): bigint | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]+$/.test(data)) return null;
  const body = data.slice(2);
  if (body.length < 64) return null;
  try {
    return BigInt(`0x${body.slice(0, 64)}`);
  } catch {
    return null;
  }
}

export interface EthCall {
  (to: string, data: string): Promise<string>;
}

/** Read ERC-20 metadata. Every field is independent; failures yield null. */
export async function fetchTokenMetadata(call: EthCall, address: string): Promise<TokenMetadata> {
  const read = async (selector: string): Promise<string | null> => call(address, selector).catch(() => null);

  const [nameRaw, symbolRaw, decimalsRaw, supplyRaw] = await Promise.all([
    read(SELECTORS.name),
    read(SELECTORS.symbol),
    read(SELECTORS.decimals),
    read(SELECTORS.totalSupply),
  ]);

  const decimals = decimalsRaw === null ? null : decodeUintReturn(decimalsRaw);
  const supply = supplyRaw === null ? null : decodeUintReturn(supplyRaw);

  return {
    name: nameRaw === null ? null : decodeStringReturn(nameRaw),
    symbol: symbolRaw === null ? null : decodeStringReturn(symbolRaw),
    // A decimals value outside 0..255 is not a real ERC-20 answer.
    decimals: decimals !== null && decimals >= 0n && decimals <= 255n ? Number(decimals) : null,
    totalSupply: supply === null ? null : supply.toString(),
  };
}
