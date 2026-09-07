import type {Metadata} from "next";
import "./globals.css";
import {AppShell} from "@kaurax/ui";
import {config} from "@/lib/config";

export const metadata: Metadata = {
  title: "KAURAX Docs",
  description: "Documentation for the KAURAX Layer-3",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <AppShell current="docs" title="KAURAX Docs" chainId={config.chainId} rpcUrl={config.rpcUrl}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
