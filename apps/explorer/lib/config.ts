/**
 * Explorer configuration.
 *
 * Endpoints come from the environment so the same build serves a devnet or a testnet.
 * Nothing about the chain is hardcoded here.
 */
export const config = {
  l3RpcUrl: process.env.NEXT_PUBLIC_KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
  l3WsUrl: process.env.NEXT_PUBLIC_KAURAX_WS_URL ?? "ws://127.0.0.1:8421",
  l3ChainId: Number(process.env.NEXT_PUBLIC_KAURAX_CHAIN_ID ?? 8420),
  l2RpcUrl: process.env.NEXT_PUBLIC_L2_RPC_URL ?? "http://127.0.0.1:9545",
  l1RpcUrl: process.env.NEXT_PUBLIC_L1_RPC_URL ?? "http://127.0.0.1:8545",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "http://127.0.0.1:3000",
} as const;

export const PREDEPLOYS = {
  messagePasser: "0x4200000000000000000000000000000000000016",
  l3ERC20Bridge: "0x4200000000000000000000000000000000000010",
} as const;

/** Rendered wherever a value genuinely cannot be read. Never substitute a number. */
export const NO_DATA = "No data available";
