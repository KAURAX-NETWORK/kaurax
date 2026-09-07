import {NO_DATA} from "@/lib/config";

/** Renders a value, or an explicit "No data available" when it is genuinely absent. */
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

export function Empty({children}: {children: React.ReactNode}) {
  return <div className="empty">{children}</div>;
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

export function Notice({
  kind = "warn",
  children,
}: {
  kind?: "warn" | "info";
  children: React.ReactNode;
}) {
  return <div className={`notice${kind === "info" ? " info" : ""}`}>{children}</div>;
}

/**
 * The three-layer stack, rendered from real heights.
 * A layer whose height could not be read shows "No data available" rather than a zero.
 */
export function StackDiagram({
  l1,
  l2,
  l3,
}: {
  l1: {name: string; chainId: number | null; head: string | null; note?: string} | null;
  l2: {name: string; chainId: number | null; head: string | null} | null;
  l3: {name: string; chainId: number; head: string | null};
}) {
  return (
    <div className="stack">
      <div className="stack-layer">
        <span className="tier">L1</span>
        <span className="name">{l1?.name ?? "Ethereum"}</span>
        <span className="meta">
          {l1?.head ? `#${l1.head}` : <span className="nodata">{NO_DATA}</span>}
          {l1?.chainId ? <span className="faint"> · chain {l1.chainId}</span> : null}
        </span>
      </div>
      <div className="stack-arrow">
        ▲ settlement + data availability
        <br />│
      </div>
      <div className="stack-layer">
        <span className="tier">L2</span>
        <span className="name">{l2?.name ?? "Underlying rollup"}</span>
        <span className="meta">
          {l2?.head ? `#${l2.head}` : <span className="nodata">{NO_DATA}</span>}
          {l2?.chainId ? <span className="faint"> · chain {l2.chainId}</span> : null}
        </span>
      </div>
      <div className="stack-arrow">
        ▲ batches + output roots
        <br />│
      </div>
      <div className="stack-layer l3">
        <span className="tier">L3</span>
        <span className="name">{l3.name}</span>
        <span className="meta">
          {l3.head ? `#${l3.head}` : <span className="nodata">{NO_DATA}</span>}
          <span className="faint"> · chain {l3.chainId}</span>
        </span>
      </div>
    </div>
  );
}
