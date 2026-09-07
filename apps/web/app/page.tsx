import {Badge, Banner} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Network {
  name: string;
  chainId: number;
  head: string;
  currency: {symbol: string};
  settlesTo: {chainId: number; name: string} | null;
}

interface FeatureStatus {
  key: string;
  name: string;
  state: "live" | "testnet" | "not-deployed" | "coming-soon";
  detail: string;
}

const CAPABILITIES: Array<[string, string]> = [
  ["EVM equivalence", "Solidity, Foundry, Hardhat, MetaMask, viem and ethers work unchanged. Point them at a different RPC URL and chain ID."],
  ["Real data availability", "Every sequenced transaction is published as calldata to the underlying L2. The acceptance test proves it by rebuilding a transaction from L2 data alone."],
  ["Canonical bridge", "Deposits derived from L2 events, so the sequencer cannot censor them. Withdrawals proven by Merkle inclusion under a published state commitment."],
  ["Application blockspace", "Your own block gas limit, block time and fee policy, not contended by unrelated applications."],
  ["Indexed history", "A PostgreSQL indexer behind the explorer and the API, so address history and token transfers are queryable rather than re-scanned per request."],
  ["Full developer surface", "JSON-RPC and WebSocket, an SDK, a CLI, an explorer, a bridge, a wallet and a backend API — all reading live chain state."],
];

export default async function Home() {
  const [network, features] = await Promise.all([
    api<Network>("/api/network"),
    api<{features: FeatureStatus[]}>("/api/features"),
  ]);

  const deployed = features?.features.filter((f) => f.state === "testnet" || f.state === "live") ?? [];
  const pending = features?.features.filter((f) => f.state === "not-deployed" || f.state === "coming-soon") ?? [];

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 style={{fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.08}}>Build faster on Ethereum.</h1>
          <p style={{fontSize: 18, maxWidth: "64ch"}}>
            KAURAX is an application-focused Ethereum Layer-3 designed for scalable Web3, AI,
            payments and next-generation applications. It executes transactions, publishes its
            data to an underlying Layer-2, and inherits settlement from Ethereum through it.
          </p>
          <div className="row-gap" style={{marginTop: 26}}>
            <a className="badge accent" href={`https://docs.${config.domain || "kaurax.com"}`} style={{padding: "10px 18px", fontSize: 13}}>
              Read the docs
            </a>
            <a className="badge" href={config.explorerUrl} style={{padding: "10px 18px", fontSize: 13}}>
              Open the explorer
            </a>
          </div>
        </div>
      </section>

      <div className="container section">
        <div className="grid cols-4">
          <div className="card stat">
            <div className="label">Network</div>
            <div className="value small">{network?.name ?? <span className="nodata">No data available</span>}</div>
          </div>
          <div className="card stat">
            <div className="label">Chain ID</div>
            <div className="value small">{network?.chainId ?? <span className="nodata">No data available</span>}</div>
          </div>
          <div className="card stat">
            <div className="label">Latest block</div>
            <div className="value small">{network?.head ? `#${network.head}` : <span className="nodata">No data available</span>}</div>
          </div>
          <div className="card stat">
            <div className="label">Settles to</div>
            <div className="value small">{network?.settlesTo?.name ?? <span className="nodata">No data available</span>}</div>
          </div>
        </div>
      </div>

      <div className="container section">
        <div className="section-head"><h2>Where KAURAX sits</h2></div>
        <div className="stack" style={{maxWidth: 640}}>
          <div className="stack-layer">
            <span className="tier">L1</span><span className="name">Ethereum</span>
            <span className="meta">settlement &amp; data availability</span>
          </div>
          <div className="stack-arrow">▲<br />│</div>
          <div className="stack-layer">
            <span className="tier">L2</span>
            <span className="name">{network?.settlesTo?.name ?? "Underlying rollup"}</span>
            <span className="meta">{network?.settlesTo ? `chain ${network.settlesTo.chainId}` : "configurable"}</span>
          </div>
          <div className="stack-arrow">▲ batches + output roots<br />│</div>
          <div className="stack-layer l3">
            <span className="tier">L3</span><span className="name">KAURAX</span>
            <span className="meta">{network ? `chain ${network.chainId} · KAX` : "KAX"}</span>
          </div>
        </div>
      </div>

      <div className="container section">
        <div className="section-head"><h2>What it gives you</h2></div>
        <div className="grid cols-3">
          {CAPABILITIES.map(([title, body]) => (
            <div className="card" key={title}>
              <h3 style={{fontSize: 15, margin: "0 0 8px", textTransform: "none", letterSpacing: 0, color: "var(--text)"}}>
                {title}
              </h3>
              <p className="dim" style={{margin: 0, fontSize: 13.5}}>{body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="container section">
        <div className="section-head"><h2>What is and isn&apos;t built</h2></div>
        {features === null ? (
          <Banner kind="err">
            The KAURAX API is not reachable, so feature availability cannot be shown. Nothing is
            listed rather than guessed.
          </Banner>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Application</th><th>State</th><th>Detail</th></tr></thead>
              <tbody>
                {[...deployed, ...pending].map((f) => (
                  <tr key={f.key}>
                    <td>{f.name}</td>
                    <td>
                      <Badge kind={f.state === "testnet" || f.state === "live" ? "ok" : "warn"}>{f.state}</Badge>
                    </td>
                    <td className="dim">{f.detail || "—"}</td>
                  </tr>
                ))}
                <tr><td>Fault proofs</td><td><Badge kind="warn">not implemented</Badge></td><td className="dim">Output roots are trusted, not proven.</td></tr>
                <tr><td>Decentralized sequencing</td><td><Badge kind="warn">not implemented</Badge></td><td className="dim">One sequencer, no failover.</td></tr>
                <tr><td>Security audits</td><td><Badge kind="warn">none</Badge></td><td className="dim">Nothing here has been audited.</td></tr>
                <tr><td>Mainnet</td><td><Badge kind="warn">no</Badge></td><td className="dim">See MAINNET_READINESS.md.</td></tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{marginTop: 22}}>
          <Banner kind="warn">
            <strong>KAX is a testnet gas asset with no monetary value.</strong> KAURAX publishes
            no TVL, user count, throughput claim, validator statistic, partner list or audit,
            because none of those exist for this network. Anything the interface cannot measure
            is shown as <em>No data available</em>.
          </Banner>
        </div>
      </div>
    </>
  );
}
