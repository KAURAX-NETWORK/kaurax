export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export interface KauraxClientOptions {
  /** KAURAX JSON-RPC endpoint. */
  rpcUrl: string;
  /** KAURAX WebSocket endpoint. Required only for subscriptions. */
  wsUrl?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface Block {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  transactions: Hex[];
  transactionCount: number;
}

export interface Transaction {
  hash: Hex;
  from: Address;
  to: Address | null;
  value: bigint;
  nonce: number;
  gas: bigint;
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  input: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionIndex: number | null;
}

export interface TransactionReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  from: Address;
  to: Address | null;
  contractAddress: Address | null;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  status: "success" | "reverted";
  logs: Log[];
}

export interface Log {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  removed: boolean;
}

export interface LogFilter {
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock?: bigint | "earliest" | "latest";
  toBlock?: bigint | "latest";
}

/**
 * KAURAX's own view of the three-layer stack. `null` fields mean the value could not be
 * read, not that it is zero.
 */
export interface NetworkStatus {
  network: {name: string; layer: 3; profile: string; uptimeSeconds: number};
  l3: {
    chainId: number;
    blockNumber: string;
    blockHash: Hex | null;
    stateRoot: Hex | null;
    timestamp: string | null;
    blockTimeSeconds: number;
    gasLimit: number;
    gasPrice: Hex | null;
    baseFeePerGas: string | null;
    nativeCurrency: {name: string; symbol: string; decimals: number};
    mempoolSize: number;
  };
  l2: {
    chainId: number;
    name: string;
    blockNumber: string;
    blockHash: Hex;
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
      l2TxHash: Hex;
      l2BlockNumber: string | null;
      compressedBytes: number;
      uncompressedBytes: number;
    } | null;
    batchCountOnL2: string | null;
    lastBatchedL3Block: string | null;
    unbatchedL3Blocks: number;
    latestOutputRoot: {index: string; outputRoot: Hex; timestamp: string; l3BlockNumber: string} | null;
    faultProofs: {implemented: false; status: "not-implemented"};
    dataAvailability: {mode: string; target: string};
  };
  sequencer: {
    mode: "single";
    decentralized: false;
    healthy: boolean;
    headBlock: string;
    lastBlockAt: number | null;
    lastError: string | null;
  };
}

export interface SequencerStatus {
  running: boolean;
  mode: "single";
  decentralized: false;
  address: Address | null;
  headBlock: string;
  blockTimeSeconds: number;
  mempoolSize: number;
  producedBlocks: number;
  includedTransactions: number;
  appliedDeposits: number;
  lastBlockAt: number | null;
  lastError: string | null;
}

export interface BatcherStatus {
  running: boolean;
  lastSubmission: {
    batchIndex: number | null;
    l3StartBlock: string;
    l3EndBlock: string;
    uncompressedBytes: number;
    compressedBytes: number;
    commitment: {hash: Hex; txHash: Hex; blockNumber: string | null; byteLength: number};
    submittedAt: number;
  } | null;
  lastError: string | null;
  nextL3BlockToBatch: string;
  pendingL3Blocks: number;
}

export interface NetworkDescriptor {
  chainId: Hex;
  chainIdDecimal: number;
  chainName: string;
  nativeCurrency: {name: string; symbol: string; decimals: number};
  rpcUrls: string[];
  wsUrls: string[];
  blockExplorerUrls: string[];
}

export class KauraxRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "KauraxRpcError";
  }
}
