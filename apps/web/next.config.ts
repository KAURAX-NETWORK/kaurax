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
 * The destinations are the team-scoped per-project aliases, not per-deployment URLs, so
 * these rules keep working after a zone redeploys. The shorter kaurax-<zone>.vercel.app
 * form is deliberately NOT used: Vercel allocates it globally first-come, and
 * kaurax-docs.vercel.app already belonged to someone else's project.
 */
const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@kaurax/ui", "@kaurax/types"],

  async rewrites() {
    return [
    {source: "/explorer", destination: "https://kaurax-explorer-kmks-projects.vercel.app/explorer"},
    {source: "/explorer/:path*", destination: "https://kaurax-explorer-kmks-projects.vercel.app/explorer/:path*"},
    {source: "/wallet", destination: "https://kaurax-wallet-kmks-projects.vercel.app/wallet"},
    {source: "/wallet/:path*", destination: "https://kaurax-wallet-kmks-projects.vercel.app/wallet/:path*"},
    {source: "/bridge", destination: "https://kaurax-bridge-kmks-projects.vercel.app/bridge"},
    {source: "/bridge/:path*", destination: "https://kaurax-bridge-kmks-projects.vercel.app/bridge/:path*"},
    {source: "/pay", destination: "https://kaurax-pay-kmks-projects.vercel.app/pay"},
    {source: "/pay/:path*", destination: "https://kaurax-pay-kmks-projects.vercel.app/pay/:path*"},
    {source: "/ai", destination: "https://kaurax-ai-kmks-projects.vercel.app/ai"},
    {source: "/ai/:path*", destination: "https://kaurax-ai-kmks-projects.vercel.app/ai/:path*"},
    {source: "/swap", destination: "https://kaurax-swap-kmks-projects.vercel.app/swap"},
    {source: "/swap/:path*", destination: "https://kaurax-swap-kmks-projects.vercel.app/swap/:path*"},
    {source: "/names", destination: "https://kaurax-names-kmks-projects.vercel.app/names"},
    {source: "/names/:path*", destination: "https://kaurax-names-kmks-projects.vercel.app/names/:path*"},
    {source: "/launchpad", destination: "https://kaurax-launchpad-kmks-projects.vercel.app/launchpad"},
    {source: "/launchpad/:path*", destination: "https://kaurax-launchpad-kmks-projects.vercel.app/launchpad/:path*"},
    {source: "/docs", destination: "https://kaurax-docs-kmks-projects.vercel.app/docs"},
    {source: "/docs/:path*", destination: "https://kaurax-docs-kmks-projects.vercel.app/docs/:path*"},
    ];
  },
};

export default config;
