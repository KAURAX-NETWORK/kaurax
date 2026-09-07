/**
 * @kaurax/ui — shared components for the KAURAX application suite.
 *
 * Two rules run through everything here:
 *
 *   1. A value that is genuinely unknown renders as "No data available", never as a zero
 *      or a plausible-looking placeholder. `<Value>` and `<Stat>` enforce this.
 *   2. A feature with nothing behind it renders as `<NotDeployed>`, which is deliberately
 *      unmissable. A user must never mistake an unbuilt screen for a working one.
 */
export const NO_DATA = "No data available";

export {AppShell, APPS} from "./AppShell";
export type {AppKey} from "./AppShell";
export {useWallet} from "./useWallet";
export type {WalletState, KauraxNetwork, Eip1193Provider} from "./useWallet";

// ------------------------------------------------------------- primitives --

export function Value({children}: {children: React.ReactNode}) {
  if (children === null || children === undefined || children === "") {
    return <span className="nodata">{NO_DATA}</span>;
  }
  return <>{children}</>;
}

export function Stat({
  label,
  value,
  sub,
  small,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  small?: boolean;
}) {
  const absent = value === null || value === undefined || value === "";
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value${small || absent ? " small" : ""}`}>
        {absent ? <span className="nodata">{NO_DATA}</span> : value}
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <Value>{children}</Value>
      </dd>
    </>
  );
}

export function Badge({
  kind = "default",
  children,
}: {
  kind?: "default" | "ok" | "warn" | "err" | "accent";
  children: React.ReactNode;
}) {
  return <span className={`badge${kind === "default" ? "" : ` ${kind}`}`}>{children}</span>;
}

export function Empty({children}: {children: React.ReactNode}) {
  return <div className="empty">{children}</div>;
}

export function Banner({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn" | "err" | "ok";
  children: React.ReactNode;
}) {
  const icon = {info: "i", warn: "!", err: "×", ok: "✓"}[kind];
  return (
    <div className={`status-banner ${kind}`}>
      <span className="icon">[{icon}]</span>
      <div className="body">{children}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

/**
 * Rendered wherever a feature has no contracts or no configuration behind it.
 *
 * This is the honest alternative to a mock screen: it says plainly that the thing is not
 * built, and why, instead of showing an interface that appears to work.
 */
export function NotDeployed({
  title,
  what,
  detail,
}: {
  title: string;
  what: string;
  detail?: string | null;
}) {
  return (
    <div className="not-deployed">
      <div className="tag">Not deployed</div>
      <h3>{title}</h3>
      <p>{what}</p>
      {detail ? <div className="detail">{detail}</div> : null}
    </div>
  );
}

/** The disclaimer every KAURAX surface carries. */
export function TestnetNotice() {
  return (
    <Banner kind="warn">
      <strong>KAURAX is a testnet.</strong> KAX has no monetary value. There is no fault
      proof system — state commitments are trusted — the sequencer is centralized, and
      nothing has been audited. Do not deposit anything you care about.
    </Banner>
  );
}

// ------------------------------------------------------------- formatting --

/** Format wei as a decimal string. No floating point, so no rounding surprises. */
export function formatUnits(wei: bigint | string, decimals = 18, maxFractionDigits = 6): string {
  const value = typeof wei === "string" ? BigInt(wei) : wei;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** Parse a decimal KAX amount into wei. Returns null on anything unparseable. */
export function parseUnits(input: string, decimals = 18): bigint | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  } catch {
    return null;
  }
}

export function shortHash(hash: string, lead = 10, tail = 8): string {
  if (hash.length <= lead + tail + 2) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function shortAddress(address: string): string {
  return shortHash(address, 8, 6);
}

export function timeAgo(seconds: bigint | number | string | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds === "") return NO_DATA;
  const delta = Math.floor(Date.now() / 1000) - Number(seconds);
  if (delta < 0) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function isAddress(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function isHash(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
