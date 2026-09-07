import type {Metadata} from "next";
import "./globals.css";
import {AppShell} from "@kaurax/ui";
import {config} from "@/lib/config";

export const metadata: Metadata = {
  title: "KAURAX",
  description: "An application-focused Ethereum Layer-3",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <AppShell current="web" title="KAURAX" chainId={config.chainId} rpcUrl={config.rpcUrl}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
