/**
 * The KAURAX application shell — one header and footer across every app in the suite.
 *
 * Each app is a separate Vercel deployment on its own subdomain, so cross-app navigation
 * is absolute URLs built from NEXT_PUBLIC_KAURAX_DOMAIN. Locally, where every app runs on
 * a different localhost port, the same map falls back to those ports so the suite is
 * navigable in development too.
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
  // No domain configured means local development: address each app by its port.
  if (!domain) return `http://localhost:${app.devPort}`;
  return app.subdomain ? `https://${app.subdomain}.${domain}` : `https://${domain}`;
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
