import type {NextConfig} from "next";

/**
 * This app is a Next.js *zone*: it is deployed on its own but served to the public under
 * https://kaurax.network/wallet, behind the rewrites in apps/web/next.config.ts.
 *
 * `basePath` is what makes that work. Without it every page link and every /_next/ asset
 * request would be issued at the domain root, collide with the other zones, and 404.
 *
 * The same prefix therefore applies in local development: this app answers on
 * http://127.0.0.1:<port>/wallet, not on /.
 */
const config: NextConfig = {
  reactStrictMode: true,
  basePath: "/wallet",
  // @kaurax/ui ships TypeScript source rather than a build step, so Next compiles it
  // as part of this app. One less build to keep in sync.
  transpilePackages: ["@kaurax/ui", "@kaurax/types"],
};

export default config;
