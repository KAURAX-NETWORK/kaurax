/**
 * The KAURAX application shell — one header and footer across every app in the suite.
 *
 * Each app is a separate deployment, but they are served to the public as Next.js zones
 * under one domain — kaurax.network/explorer, /pay, /swap and so on. Cross-app navigation
 * is therefore a plain path, which keeps the links working no matter which zone rendered
 * the page and survives the domain changing.
 *
 * Locally each app runs on its own port, so the same map falls back to an absolute
 * localhost URL including the zone's basePath.
 */
export type AppKey =
  | "web"
  | "explorer"
  | "wallet"
  | "bridge"
  | "pay"
  | "ai"
  | "swap"
  | "names"
  | "launchpad"
  | "docs";

interface AppDef {
  key: AppKey;
  label: string;
  subdomain: string;
  /** Port used when running the suite locally with `pnpm dev`. */
  devPort: number;
}

export const APPS: AppDef[] = [
  {key: "web", label: "KAURAX", subdomain: "", devPort: 3010},
  {key: "explorer", label: "Explorer", subdomain: "explorer", devPort: 3000},
  {key: "wallet", label: "Wallet", subdomain: "wallet", devPort: 3011},
  {key: "bridge", label: "Bridge", subdomain: "bridge", devPort: 3012},
  {key: "pay", label: "Pay", subdomain: "pay", devPort: 3013},
  {key: "ai", label: "AI", subdomain: "ai", devPort: 3014},
  {key: "swap", label: "Swap", subdomain: "swap", devPort: 3015},
  {key: "names", label: "Names", subdomain: "names", devPort: 3016},
  {key: "launchpad", label: "Launchpad", subdomain: "launchpad", devPort: 3017},
  {key: "docs", label: "Docs", subdomain: "docs", devPort: 3018},
];

function urlFor(app: AppDef, domain: string | undefined): string {
  const path = app.subdomain ? `/${app.subdomain}` : "/";
  // No domain configured means local development: each app is on its own port, and still
  // behind its basePath, so the prefix belongs in the URL there too.
  if (!domain) return `http://localhost:${app.devPort}${app.subdomain ? path : ""}`;
  return path;
}

export function AppShell({
  current,
  title,
  children,
  chainId,
  rpcUrl,
}: {
  current: AppKey;
  title: string;
  children: React.ReactNode;
  chainId?: number | string;
  rpcUrl?: string;
}) {
  const domain = process.env.NEXT_PUBLIC_KAURAX_DOMAIN;

  return (
    <>
      <header className="site-header">
        <div className="container inner">
          <div className="brand">
            <a className="mark" href={urlFor(APPS[0]!, domain)}>
              KAURAX
            </a>
            <span className="layer">L3</span>
          </div>
          <nav className="app-switch">
            {APPS.filter((a) => a.key !== "web").map((a) => (
              <a
                key={a.key}
                href={urlFor(a, domain)}
                className={a.key === current ? "current" : undefined}
              >
                {a.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="site-footer">
        <div className="container">
          <div className="row">
            <span>{title} — part of KAURAX, an Ethereum Layer-3 settling through an underlying Layer-2.</span>
          </div>
          <div className="row" style={{marginTop: 8}}>
            {chainId ? <span>Chain ID {chainId}</span> : null}
            {rpcUrl ? <span>RPC {rpcUrl}</span> : null}
            <span>KAX is a testnet gas asset with no monetary value.</span>
          </div>
          <div className="row" style={{marginTop: 8}}>
            <span>No fault proof system. Output roots are trusted. Sequencing is centralized. Unaudited.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
