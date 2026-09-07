import type {NextConfig} from "next";

/**
 * The public entry point. https://kaurax.network is this app; every other KAURAX frontend
 * is a separate deployment served underneath it as a Next.js zone.
 *
 * Why zones rather than one giant app: each frontend has different dependencies and a
 * different release cadence, and a broken build in the launchpad should not be able to
 * take the landing page down with it. Each zone deploys, fails and rolls back on its own.
 *
 * Each zone sets a matching `basePath`, so its pages AND its /_next/ assets already live
 * under the same prefix these rules forward. The bare `/name` rule is needed alongside
 * `/name/:path*` because the latter does not match the prefix on its own.
 *
 * The destinations are Vercel's stable per-project aliases, not per-deployment URLs, so
 * these rules keep working after the zone redeploys.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@kaurax/ui", "@kaurax/types"],

  async rewrites() {
    return [
    {source: "/explorer", destination: "https://kaurax-explorer.vercel.app/explorer"},
    {source: "/explorer/:path*", destination: "https://kaurax-explorer.vercel.app/explorer/:path*"},
    {source: "/wallet", destination: "https://kaurax-wallet.vercel.app/wallet"},
    {source: "/wallet/:path*", destination: "https://kaurax-wallet.vercel.app/wallet/:path*"},
    {source: "/bridge", destination: "https://kaurax-bridge.vercel.app/bridge"},
    {source: "/bridge/:path*", destination: "https://kaurax-bridge.vercel.app/bridge/:path*"},
    {source: "/pay", destination: "https://kaurax-pay.vercel.app/pay"},
    {source: "/pay/:path*", destination: "https://kaurax-pay.vercel.app/pay/:path*"},
    {source: "/ai", destination: "https://kaurax-ai.vercel.app/ai"},
    {source: "/ai/:path*", destination: "https://kaurax-ai.vercel.app/ai/:path*"},
    {source: "/swap", destination: "https://kaurax-swap.vercel.app/swap"},
    {source: "/swap/:path*", destination: "https://kaurax-swap.vercel.app/swap/:path*"},
    {source: "/names", destination: "https://kaurax-names.vercel.app/names"},
    {source: "/names/:path*", destination: "https://kaurax-names.vercel.app/names/:path*"},
    {source: "/launchpad", destination: "https://kaurax-launchpad.vercel.app/launchpad"},
    {source: "/launchpad/:path*", destination: "https://kaurax-launchpad.vercel.app/launchpad/:path*"},
    {source: "/docs", destination: "https://kaurax-docs.vercel.app/docs"},
    {source: "/docs/:path*", destination: "https://kaurax-docs.vercel.app/docs/:path*"},
    ];
  },
};

export default config;
