/**
 * Public JSON-RPC surface of KAURAX.
 *
 * The execution engine exposes administrative namespaces (`anvil_*`, `evm_*`, `debug_*`,
 * `hardhat_*`, `personal_*`, `miner_*`, `txpool_*`, `admin_*`) that can rewrite state,
 * mint balances and impersonate accounts. The public RPC MUST NOT forward those. The
 * engine endpoint is bound to loopback and is not the endpoint users talk to; this
 * allowlist is the second layer of that same control.
 */
export const BLOCKED_NAMESPACES = [
  "anvil_",
  "evm_",
  "hardhat_",
  "debug_",
  "admin_",
  "miner_",
  "personal_",
  "txpool_",
  "engine_",
  "ots_",
] as const;

/** Standard Ethereum methods forwarded to the execution engine unchanged. */
export const PROXIED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockReceipts",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_syncing",
  "net_listening",
  "net_peerCount",
  "web3_sha3",
  // Filters and subscriptions.
  "eth_newFilter",
  "eth_newBlockFilter",
  "eth_newPendingTransactionFilter",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_uninstallFilter",
  "eth_subscribe",
  "eth_unsubscribe",
]);

export function isBlocked(method: string): boolean {
  return BLOCKED_NAMESPACES.some((ns) => method.startsWith(ns));
}

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  server: -32000,
} as const;
