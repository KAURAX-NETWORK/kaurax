import type {NextConfig} from "next";
import {join} from "node:path";

/**
 * This app is a Next.js *zone*: it is deployed on its own but served to the public under
 * https://kaurax.network/docs, behind the rewrites in apps/web/next.config.ts.
 *
 * `basePath` is what makes that work. Without it every page link and every /_next/ asset
 * request would be issued at the domain root, collide with the other zones, and 404.
 *
 * The same prefix therefore applies in local development: this app answers on
 * http://127.0.0.1:<port>/docs, not on /.
 */
const config: NextConfig = {
  reactStrictMode: true,
  basePath: "/docs",

  /**
   * The markdown lives in the repository, not in this app, and it is read at request time
   * by a path built at runtime. Next's tracer follows static imports, so it cannot see
   * those files and the deployed function shipped without them — the site rendered its
   * shell and listed nothing, which looks like a broken build rather than a missing asset.
   *
   * Naming the files here puts them in the bundle. The alternative, copying them into the
   * app, would let the published docs drift from the ones engineers maintain.
   */
  outputFileTracingRoot: join(__dirname, "..", ".."),
  outputFileTracingIncludes: {
    "/**": [
      "../../docs/**/*.md",
      "../../*.md",
    ],
  },
  // @kaurax/ui ships TypeScript source rather than a build step, so Next compiles it
  // as part of this app. One less build to keep in sync.
  transpilePackages: ["@kaurax/ui", "@kaurax/types"],
};

export default config;
