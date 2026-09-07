import {NO_DATA} from "./config";

/** Format wei as a decimal string with no floating point involved. */
export function formatUnits(wei: bigint, decimals = 18, maxFractionDigits = 6): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  let fraction = (value % base).toString().padStart(decimals, "0");
  fraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return `${negative ? "-" : ""}${withThousands(whole)}${fraction ? `.${fraction}` : ""}`;
}

export function withThousands(n: bigint | number): string {
  return n.toLocaleString("en-US");
}

export function shortHash(hash: string, lead = 10, tail = 8): string {
  if (hash.length <= lead + tail + 2) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function shortAddress(address: string): string {
  return shortHash(address, 8, 6);
}

/** Human-readable age. Returns NO_DATA rather than guessing when the input is absent. */
export function timeAgo(timestampSeconds: bigint | number | string | null | undefined): string {
  if (timestampSeconds === null || timestampSeconds === undefined || timestampSeconds === "") return NO_DATA;
  const then = Number(timestampSeconds) * 1000;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function isoTime(timestampSeconds: bigint | number | string | null | undefined): string {
  if (timestampSeconds === null || timestampSeconds === undefined || timestampSeconds === "") return NO_DATA;
  return new Date(Number(timestampSeconds) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function hexToBigInt(hex: string | null | undefined): bigint | null {
  if (!hex) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

export function gwei(wei: bigint | null): string {
  if (wei === null) return NO_DATA;
  return `${formatUnits(wei, 9, 4)} gwei`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return NO_DATA;
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
