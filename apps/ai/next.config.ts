import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @kaurax/ui ships TypeScript source rather than a build step, so Next compiles it
  // as part of this app. One less build to keep in sync.
  transpilePackages: ["@kaurax/ui", "@kaurax/types"],
};

export default config;
