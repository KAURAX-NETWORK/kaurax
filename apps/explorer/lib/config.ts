/**
 * Explorer configuration.
 *
 * Endpoints come from the environment so the same build serves a devnet or a testnet.
 * Nothing about the chain is hardcoded here.
 */
/**
 * The node's own origin, used for fetching on the server only.
 *
 * The public RPC URL is proxied through this site so a browser can reach it over HTTPS.
 * Server-side that proxy is a loopback — a Vercel function calling its own public domain,
 * back through the edge and the rewrite before reaching the node — which is slow and is
 * one more thing that can fail. Server code has no mixed-content restriction, so it talks
 * to the node directly.
 */
const SERVER_RPC_ORIGIN = process.env.KAURAX_UPSTREAM_ORIGIN ?? "http://87.58.152.42:8880";

export const config = {
  /** The public URL. Shown to users and given to wallets; must stay HTTPS. */
  l3RpcUrl: process.env.NEXT_PUBLIC_KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
  /** The URL this app fetches through. Same thing, without the round trip. */
  l3FetchUrl:
    typeof window === "undefined"
      ? SERVER_RPC_ORIGIN
      : (process.env.NEXT_PUBLIC_KAURAX_RPC_URL ?? "http://127.0.0.1:8420"),
  l3WsUrl: process.env.NEXT_PUBLIC_KAURAX_WS_URL ?? "ws://127.0.0.1:8421",
  l3ChainId: Number(process.env.NEXT_PUBLIC_KAURAX_CHAIN_ID ?? 8420),
  l2RpcUrl: process.env.NEXT_PUBLIC_L2_RPC_URL ?? "http://127.0.0.1:9545",
  l1RpcUrl: process.env.NEXT_PUBLIC_L1_RPC_URL ?? "http://127.0.0.1:8545",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "http://127.0.0.1:3000",
  /**
   * Where this app reaches the KAURAX API. Server-side it goes straight to the node rather
   * than back out through this site's own domain; see the note on l3FetchUrl.
   */
  apiFetchUrl:
    typeof window === "undefined"
      ? SERVER_RPC_ORIGIN
      : (process.env.NEXT_PUBLIC_KAURAX_API_URL ?? "http://127.0.0.1:4000"),
} as const;

export const PREDEPLOYS = {
  messagePasser: "0x4200000000000000000000000000000000000016",
  l3ERC20Bridge: "0x4200000000000000000000000000000000000010",
} as const;

/** Rendered wherever a value genuinely cannot be read. Never substitute a number. */
export const NO_DATA = "No data available";
