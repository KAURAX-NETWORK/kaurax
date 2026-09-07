import Link from "next/link";
import type {Metadata} from "next";
import "./globals.css";
import {config} from "@/lib/config";

export const metadata: Metadata = {
  title: "KAURAX Explorer — Ethereum Layer-3",
  description:
    "Block explorer, bridge and network dashboard for KAURAX, an application-focused Ethereum Layer-3 that settles through an underlying Layer-2.",
};

const NAV = [
  ["/", "Overview"],
  ["/blocks", "Blocks"],
  ["/transactions", "Transactions"],
  ["/contracts", "Contracts"],
  ["/tokens", "Tokens"],
  ["/validators", "Validators"],
  ["/network", "Network"],
  ["/dashboard", "Dashboard"],
] as const;

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container inner">
            <div className="brand">
              {/* Deliberately a raw anchor: this leaves the explorer for the KAURAX
                  home page at the domain root, so it must NOT take the basePath. */}
              <a className="mark" href="/">KAURAX</a>
              <span className="layer">L3</span>
            </div>
            <nav className="nav">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href}>{label}</Link>
              ))}
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="container">
            <div className="row">
              <span>KAURAX — an Ethereum Layer-3 settling through an underlying Layer-2.</span>
            </div>
            <div className="row" style={{marginTop: 8}}>
              <span>Chain ID {config.l3ChainId}</span>
              <span>RPC {config.l3RpcUrl}</span>
              <span>KAX is a testnet gas asset with no monetary value.</span>
            </div>
            <div className="row" style={{marginTop: 8}}>
              <span>No fault proof system. Output roots are trusted. Sequencing is centralized.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
