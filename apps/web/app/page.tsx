import {Badge} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Network {
  name: string;
  chainId: number;
  head: string;
  gasPrice?: string;
  currency: {symbol: string};
  settlesTo: {chainId: number; name: string} | null;
}

interface FeatureStatus {
  key: string;
  name: string;
  state: "live" | "testnet" | "not-deployed" | "coming-soon";
  detail: string;
  contract?: string | null;
}

/**
 * The three claims worth making, and the mechanism behind each one.
 *
 * Every line here describes something the repository actually implements and tests. No
 * throughput figure, no adoption number, no comparison to another chain — those would be
 * the easiest thing to write and the fastest thing to be caught inventing.
 */
const GUARANTEES: Array<{title: string; lede: string; how: string}> = [
  {
    title: "Your transactions outlive the sequencer",
    lede: "Every block is published to the Layer-2 below as calldata before it counts as settled.",
    how: "The acceptance test rebuilds a signed transaction from that calldata alone and checks its hash — so this is a property under test, not an intention.",
  },
  {
    title: "Censorship costs the sequencer more than it costs you",
    lede: "If it refuses your transaction, submit it on the L2 instead and start a clock.",
    how: "Miss the deadline and the output oracle rejects every proposal from that point on. One censored user halts settlement for the whole chain.",
  },
  {
    title: "Withdrawals are proven, never approved",
    lede: "Getting funds out needs a Merkle proof against a published state commitment.",
    how: "No signature, no multisig, no operator discretion. The proof either verifies against the root on the L2 or the withdrawal does not happen.",
  },
];

const CAPABILITIES: Array<[string, string]> = [
  ["EVM equivalence", "Solidity, Foundry, Hardhat, MetaMask, viem and ethers work unchanged. Change the RPC URL and the chain ID; change nothing else."],
  ["Blockspace you control", "Your own gas limit, block time and fee policy — not contended by an unrelated mint three blocks ahead of you."],
  ["Indexed history", "A PostgreSQL indexer behind the explorer and API, so address history and token transfers are queried, not re-scanned."],
  ["A real developer surface", "JSON-RPC and WebSocket, an SDK, a CLI, an explorer, a bridge, a wallet and a backend API — every one reading live chain state."],
];

const APPS: Array<{href: string; name: string; blurb: string}> = [
  {href: "/explorer", name: "Explorer", blurb: "Blocks, transactions and addresses, with settlement status per block."},
  {href: "/wallet", name: "Wallet", blurb: "Connect any EIP-1193 wallet and move KAX."},
  {href: "/bridge", name: "Bridge", blurb: "Deposit from the L2, withdraw with a Merkle proof."},
  {href: "/swap", name: "Swap", blurb: "Constant-product AMM with real pools and real liquidity."},
  {href: "/names", name: "Names", blurb: "Register a human-readable name on KAURAX."},
  {href: "/launchpad", name: "Launchpad", blurb: "Escrowed token sales with soft-cap refunds."},
  {href: "/pay", name: "Pay", blurb: "Payment requests settled by verified on-chain transfers."},
  {href: "/ai", name: "AI", blurb: "Ask about the network. Answers routed server-side."},
];

function Figure({label, value, sub}: {label: string; value: React.ReactNode; sub?: string}) {
  return (
    <div className="figure">
      <div className="figure-label">{label}</div>
      <div className="figure-value">{value}</div>
      {sub ? <div className="figure-sub">{sub}</div> : null}
    </div>
  );
}

const NoData = () => <span className="nodata">No data available</span>;

export default async function Home() {
  const [network, features] = await Promise.all([
    api<Network>("/api/network"),
    api<{features: FeatureStatus[]}>("/api/features"),
  ]);

  const live = features?.features.filter((f) => f.state === "testnet" || f.state === "live") ?? [];
  const withContracts = live.filter((f) => f.contract).length;

  return (
    <>
      {/* ------------------------------------------------------------ hero -- */}
      <section className="hero-lg">
        <div className="hero-glow" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="eyebrow">
            <span className="pip" /> Ethereum → Layer-2 → KAURAX
          </div>

          <h1 className="display">
            An Ethereum Layer-3
            <br />
            you can <span className="grad">check</span>.
          </h1>

          <p className="lede">
            Every block KAURAX produces is published to the Layer-2 beneath it as calldata.
            If the sequencer vanished tonight, your transactions would still be there — and
            you could rebuild them yourself, without asking anyone.
          </p>

          <div className="cta-row">
            <a className="btn-primary" href="/docs">
              Read the docs
            </a>
            <a className="btn-ghost" href="/explorer">
              Open the explorer
            </a>
          </div>

          <div className="figures">
            <Figure
              label="Network"
              value={network?.name ?? <NoData />}
              sub={network ? `chain ${network.chainId}` : undefined}
            />
            <Figure label="Latest block" value={network?.head ? `#${network.head}` : <NoData />} sub="read live" />
            <Figure
              label="Settles to"
              value={network?.settlesTo?.name ?? <NoData />}
              sub={network?.settlesTo ? `chain ${network.settlesTo.chainId}` : undefined}
            />
            <Figure
              label="Gas token"
              value={network?.currency.symbol ?? <NoData />}
              sub="no monetary value"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ guarantees -- */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Three things that are mechanisms, not promises</h2>
            <p className="section-sub">
              Anyone can claim decentralisation. These are the specific places where KAURAX
              takes the choice away from its own operators.
            </p>
          </div>

          <div className="guarantee-grid">
            {GUARANTEES.map((g, i) => (
              <article key={g.title} className="guarantee">
                <div className="guarantee-num">{String(i + 1).padStart(2, "0")}</div>
                <h3>{g.title}</h3>
                <p className="guarantee-lede">{g.lede}</p>
                <p className="guarantee-how">{g.how}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- stack -- */}
      <section className="section section-alt">
        <div className="container split">
          <div>
            <div className="section-head">
              <h2>Where KAURAX sits</h2>
              <p className="section-sub">
                KAURAX is not a fork of Ethereum and not a frontend in front of one. It is a
                rollup: it sequences its own blocks, batches them downward, and inherits its
                security from the layers beneath.
              </p>
            </div>

            <dl className="facts">
              <div>
                <dt>Execution</dt>
                <dd>Its own chain, its own blockspace, EVM-equivalent</dd>
              </div>
              <div>
                <dt>Data availability</dt>
                <dd>Calldata on the underlying L2</dd>
              </div>
              <div>
                <dt>Settlement</dt>
                <dd>Output roots proposed to a contract on the L2</dd>
              </div>
              <div>
                <dt>Fault proofs</dt>
                <dd className="warn-text">Not implemented — output roots are trusted</dd>
              </div>
            </dl>
          </div>

          <div className="stack">
            <div className="stack-layer">
              <span className="tier">L1</span>
              <span className="name">Ethereum</span>
              <span className="meta">settlement &amp; data availability</span>
            </div>
            <div className="stack-arrow">▲<br />│</div>
            <div className="stack-layer">
              <span className="tier">L2</span>
              <span className="name">{network?.settlesTo?.name ?? "Underlying rollup"}</span>
              <span className="meta">
                {network?.settlesTo ? `chain ${network.settlesTo.chainId}` : "configurable"}
              </span>
            </div>
            <div className="stack-arrow">▲ batches + output roots<br />│</div>
            <div className="stack-layer current">
              <span className="tier">L3</span>
              <span className="name">KAURAX</span>
              <span className="meta">
                {network ? `chain ${network.chainId} · ${network.currency.symbol} gas` : "your application"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ capabilities -- */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>What you get</h2>
          </div>
          <div className="cap-grid">
            {CAPABILITIES.map(([title, body]) => (
              <div key={title} className="cap">
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ apps -- */}
      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>Built and running</h2>
            <p className="section-sub">
              {withContracts > 0
                ? `${withContracts} of these have contracts deployed on this network right now. The rest read live chain state directly.`
                : "Each of these reads live chain state. Nothing here is a mockup."}
            </p>
          </div>
          <div className="app-grid">
            {APPS.map((a) => (
              <a key={a.href} className="app-card" href={a.href}>
                <span className="app-name">
                  {a.name}
                  <span className="app-arrow">→</span>
                </span>
                <span className="app-blurb">{a.blurb}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ build -- */}
      <section className="section">
        <div className="container split">
          <div>
            <div className="section-head">
              <h2>Start in one minute</h2>
              <p className="section-sub">
                No SDK to learn and no proprietary client. If it speaks Ethereum JSON-RPC, it
                already speaks KAURAX.
              </p>
            </div>
            <div className="cta-row">
              <a className="btn-primary" href="/docs">
                Full documentation
              </a>
              <a className="btn-ghost" href="/wallet">
                Connect a wallet
              </a>
            </div>
          </div>

          <div className="code-card">
            <div className="code-head">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="code-title">Add the network</span>
            </div>
            <pre className="code">
              <code>{`Network name    ${network?.name ?? "KAURAX"}
RPC URL         ${config.rpcUrl}
Chain ID        ${network?.chainId ?? config.chainId}
Currency        ${network?.currency.symbol ?? "KAX"}

# or from a script
cast block-number --rpc-url ${config.rpcUrl}`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- honest -- */}
      <section className="section">
        <div className="container">
          <div className="honesty">
            <Badge kind="warn">Testnet</Badge>
            <div>
              <h3>What this network is not</h3>
              <p>
                KAURAX is a testnet. KAX has no monetary value and never will on this
                network. There are no fault proofs, so output roots are trusted rather than
                challenged. The sequencer is a single operator. No contract here has been
                audited.
              </p>
              <p className="honesty-close">
                Everything above describes what the code does today. Where a figure is not
                known, this site says <span className="nodata">No data available</span> rather
                than showing a plausible number.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
