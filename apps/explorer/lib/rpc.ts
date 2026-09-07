/**
 * Server-side RPC access for the explorer.
 *
 * Every read is live — there is no cache layer, because a cached chain head is simply a
 * wrong chain head. When a call fails, the caller receives `null` and renders
 * "No data available". The explorer never invents a value.
 */
import {config} from "./config";

export type Hex = `0x${string}`;

async function call<T>(url: string, method: string, params: unknown[] = []): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {result?: T; error?: {message: string}};
    if (body.error) return null;
    return (body.result ?? null) as T | null;
  } catch {
    return null;
  }
}

export const l3 = <T>(method: string, params: unknown[] = []) => call<T>(config.l3RpcUrl, method, params);
export const l2 = <T>(method: string, params: unknown[] = []) => call<T>(config.l2RpcUrl, method, params);
export const l1 = <T>(method: string, params: unknown[] = []) => call<T>(config.l1RpcUrl, method, params);

// --------------------------------------------------------------- shapes --

export interface RpcBlock {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  gasLimit: Hex;
  baseFeePerGas?: Hex;
  transactions: RpcTransaction[] | Hex[];
}

export interface RpcTransaction {
  hash: Hex;
  from: Hex;
  to: Hex | null;
  value: Hex;
  nonce: Hex;
  gas: Hex;
  gasPrice?: Hex;
  maxFeePerGas?: Hex;
  maxPriorityFeePerGas?: Hex;
  input: Hex;
  blockNumber: Hex | null;
  blockHash: Hex | null;
  transactionIndex: Hex | null;
}

export interface RpcReceipt {
  transactionHash: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  from: Hex;
  to: Hex | null;
  contractAddress: Hex | null;
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  status: Hex;
  logs: RpcLog[];
}

export interface RpcLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

export interface NetworkStatus {
  network: {name: string; layer: number; profile: string; uptimeSeconds: number};
  l3: {
    chainId: number;
    blockNumber: string;
    blockHash: string | null;
    stateRoot: string | null;
    timestamp: string | null;
    blockTimeSeconds: number;
    gasLimit: number;
    gasPrice: string | null;
    baseFeePerGas: string | null;
    nativeCurrency: {name: string; symbol: string; decimals: number};
    mempoolSize: number;
  };
  l2: {
    chainId: number;
    name: string;
    blockNumber: string;
    blockHash: string;
    timestamp: string;
    isLocalDevnet: boolean;
  } | null;
  l1: {
    latestBlockNumber: string;
    safeBlockNumber: string;
    finalizedBlockNumber: string;
    chainId: number;
    isLocalDevnetChain: boolean;
  } | null;
  settlement: {
    lastBatch: {
      batchIndex: number | null;
      l3StartBlock: string;
      l3EndBlock: string;
      l2TxHash: string;
      l2BlockNumber: string | null;
      compressedBytes: number;
      uncompressedBytes: number;
    } | null;
    batchCountOnL2: string | null;
    lastBatchedL3Block: string | null;
    unbatchedL3Blocks: number;
    latestOutputRoot: {index: string; outputRoot: string; timestamp: string; l3BlockNumber: string} | null;
    faultProofs: {implemented: boolean; status: string};
    dataAvailability: {mode: string; target: string};
  };
  sequencer: {
    mode: string;
    decentralized: boolean;
    healthy: boolean;
    headBlock: string;
    lastBlockAt: number | null;
    lastError: string | null;
  };
}

// -------------------------------------------------------------- helpers --

export async function getNetworkStatus(): Promise<NetworkStatus | null> {
  return l3<NetworkStatus>("kaurax_networkStatus");
}

export async function getBlockNumber(): Promise<bigint | null> {
  const hex = await l3<Hex>("eth_blockNumber");
  return hex === null ? null : BigInt(hex);
}

export async function getBlock(
  numberOrTag: bigint | "latest",
  withTransactions = false,
): Promise<RpcBlock | null> {
  const tag = numberOrTag === "latest" ? "latest" : `0x${numberOrTag.toString(16)}`;
  return l3<RpcBlock>("eth_getBlockByNumber", [tag, withTransactions]);
}

export async function getBlockByHash(hash: Hex, withTransactions = false): Promise<RpcBlock | null> {
  return l3<RpcBlock>("eth_getBlockByHash", [hash, withTransactions]);
}

/** The most recent `count` blocks, newest first. Missing blocks are dropped, not faked. */
export async function getRecentBlocks(count: number, from?: bigint): Promise<RpcBlock[]> {
  const head = from ?? (await getBlockNumber());
  if (head === null) return [];

  const numbers: bigint[] = [];
  for (let i = 0; i < count && head - BigInt(i) >= 0n; i++) numbers.push(head - BigInt(i));

  const blocks = await Promise.all(numbers.map((n) => getBlock(n, true)));
  return blocks.filter((b): b is RpcBlock => b !== null);
}

/** Transactions from the most recent blocks, newest first. */
export async function getRecentTransactions(
  limit: number,
): Promise<Array<RpcTransaction & {timestamp: Hex}>> {
  const head = await getBlockNumber();
  if (head === null) return [];

  const out: Array<RpcTransaction & {timestamp: Hex}> = [];
  // Walk back until enough transactions are found or the scan window is exhausted.
  const WINDOW = 200;
  for (let i = 0; i < WINDOW && out.length < limit; i++) {
    const n = head - BigInt(i);
    if (n < 0n) break;
    const block = await getBlock(n, true);
    if (!block) continue;
    for (const tx of block.transactions as RpcTransaction[]) {
      if (typeof tx === "string") continue;
      out.push({...tx, timestamp: block.timestamp});
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function getTransaction(hash: Hex): Promise<RpcTransaction | null> {
  return l3<RpcTransaction>("eth_getTransactionByHash", [hash]);
}

export async function getReceipt(hash: Hex): Promise<RpcReceipt | null> {
  return l3<RpcReceipt>("eth_getTransactionReceipt", [hash]);
}

export async function getBalance(address: Hex): Promise<bigint | null> {
  const hex = await l3<Hex>("eth_getBalance", [address, "latest"]);
  return hex === null ? null : BigInt(hex);
}

export async function getNonce(address: Hex): Promise<number | null> {
  const hex = await l3<Hex>("eth_getTransactionCount", [address, "latest"]);
  return hex === null ? null : Number(BigInt(hex));
}

export async function getCode(address: Hex): Promise<Hex | null> {
  return l3<Hex>("eth_getCode", [address, "latest"]);
}

export async function getLogs(filter: Record<string, unknown>): Promise<RpcLog[] | null> {
  return l3<RpcLog[]>("eth_getLogs", [filter]);
}

export async function getSequencerStatus(): Promise<Record<string, unknown> | null> {
  return l3<Record<string, unknown>>("kaurax_sequencerStatus");
}

export async function getBatcherStatus(): Promise<Record<string, unknown> | null> {
  return l3<Record<string, unknown>>("kaurax_batcherStatus");
}

export async function getSettlementStatus(): Promise<Record<string, unknown> | null> {
  return l3<Record<string, unknown>>("kaurax_settlementStatus");
}
