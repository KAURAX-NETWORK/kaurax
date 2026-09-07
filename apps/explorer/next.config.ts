import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The explorer reads live chain state on every request. Nothing here is safe to
  // statically prerender: a cached block height is a wrong block height.
  experimental: {},
};

export default config;
