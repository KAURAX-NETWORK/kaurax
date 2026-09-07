import type {Metadata} from "next";
import "./globals.css";
import {AppShell} from "@kaurax/ui";
import {config} from "@/lib/config";

export const metadata: Metadata = {
  title: "KAURAX Swap",
  description: "Token swaps on KAURAX",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <AppShell current="swap" title="KAURAX Swap" chainId={config.chainId} rpcUrl={config.rpcUrl}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
