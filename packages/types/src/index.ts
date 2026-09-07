/**
 * Shared domain types for KAURAX.
 *
 * Used by the indexer (which writes them), the API (which serves them) and the frontends
 * (which render them), so a change to the shape breaks compilation rather than producing a
 * silently wrong page.
 *
 * Convention: a field that could not be determined is `null`. It is never a zero, an empty
 * string standing in for a value, or a plausible default. Consumers render `null` as
 * "No data available".
 */
export * from "./abis.js";

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

/** Numeric chain quantities cross the wire as decimal strings — JSON has no bigint. */
export type Quantity = string;

// ---------------------------------------------------------------- chain --

export interface NetworkInfo {
  name: string;
  chainId: number;
  layer: 3;
  currency: {name: string; symbol: string; decimals: number};
  rpcUrl: string;
  explorerUrl: string;
  /** The rollup KAURAX settles to. */
  settlesTo: {chainId: number; name: string} | null;
}

export interface IndexedBlock {
  number: Quantity;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Quantity;
  gasUsed: Quantity;
  gasLimit: Quantity;
  baseFeePerGas: Quantity | null;
  transactionCount: number;
  /** Whether this block's data has reached the underlying L2. `null` when unknown. */
  batched: boolean | null;
}

export type TransactionStatus = "success" | "reverted" | "pending";

export interface IndexedTransaction {
  hash: Hex;
  blockNumber: Quantity | null;
  blockHash: Hex | null;
  transactionIndex: number | null;
  from: Address;
  to: Address | null;
  value: Quantity;
  nonce: number;
  gas: Quantity;
  gasUsed: Quantity | null;
  gasPrice: Quantity | null;
  effectiveGasPrice: Quantity | null;
  maxFeePerGas: Quantity | null;
  maxPriorityFeePerGas: Quantity | null;
  input: Hex;
  status: TransactionStatus;
  contractAddress: Address | null;
  timestamp: Quantity | null;
  logCount: number;
}

export interface IndexedLog {
  blockNumber: Quantity;
  transactionHash: Hex;
  logIndex: number;
  address: Address;
  topics: Hex[];
  data: Hex;
}

export interface IndexedAddress {
  address: Address;
  balance: Quantity;
  nonce: number;
  isContract: boolean;
  /** First block this address was seen in. `null` if it has no indexed activity. */
  firstSeenBlock: Quantity | null;
  lastSeenBlock: Quantity | null;
  transactionCount: number;
}

export interface IndexedContract {
  address: Address;
  deployerAddress: Address;
  deploymentTxHash: Hex;
  deploymentBlock: Quantity;
  bytecodeSize: number;
  /** KAURAX has no source-verification service, so this is always false in v0. */
  verified: false;
}

export interface IndexedToken {
  address: Address;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: Quantity | null;
  transferCount: number;
  firstSeenBlock: Quantity;
}

export interface IndexedTokenTransfer {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: Quantity;
  tokenAddress: Address;
  from: Address;
  to: Address;
  value: Quantity;
  timestamp: Quantity | null;
}

// ----------------------------------------------------------- settlement --

export interface SettlementSnapshot {
  batchCountOnL2: Quantity | null;
  lastBatchedL3Block: Quantity | null;
  unbatchedL3Blocks: number;
  latestOutputRoot: {
    index: Quantity;
    outputRoot: Hex;
    l3BlockNumber: Quantity;
    timestamp: Quantity;
  } | null;
  faultProofs: {implemented: false; status: "not-implemented"};
  dataAvailability: {mode: string; target: string};
}

// --------------------------------------------------------------- health --

export type HealthState = "ok" | "degraded" | "down";

export interface HealthCheck {
  name: string;
  status: HealthState;
  /** Round-trip latency in milliseconds, or `null` if the check could not run. */
  latencyMs: number | null;
  detail: string | null;
}

export interface HealthResponse {
  status: HealthState;
  network: string;
  rpc: boolean;
  database: boolean;
  indexer: boolean;
  checks: HealthCheck[];
  timestamp: string;
  /** Seconds this API process has been up. */
  uptimeSeconds: number;
  version: string;
}

// -------------------------------------------------------------- payments --

/**
 * KAURAX Pay. A payment request is an off-chain intent; settlement is an ordinary
 * KAX transfer on KAURAX, which the indexer observes. The API never marks a payment paid
 * without a confirmed on-chain transaction.
 */
export type PaymentStatus = "pending" | "confirmed" | "expired" | "cancelled";

export interface Payment {
  id: string;
  merchantAddress: Address;
  /** Amount in wei. */
  amount: Quantity;
  currency: "KAX";
  reference: string | null;
  description: string | null;
  status: PaymentStatus;
  /** Set only once a matching on-chain transaction has been confirmed. */
  transactionHash: Hex | null;
  payerAddress: Address | null;
  confirmedAtBlock: Quantity | null;
  createdAt: string;
  expiresAt: string;
}

// ------------------------------------------------------------- analytics --

export interface AnalyticsSummary {
  /** All values are measured, never estimated. `null` means the indexer has no data yet. */
  totalBlocks: Quantity | null;
  totalTransactions: Quantity | null;
  totalAddresses: Quantity | null;
  totalContracts: Quantity | null;
  /** Transactions per second over the sampled window, with the window stated. */
  throughput: {tps: number; windowSeconds: number; sampledBlocks: number} | null;
  averageGasPrice: Quantity | null;
  latestBlock: Quantity | null;
  indexerLagBlocks: number | null;
}

// ------------------------------------------------------------ API shapes --

export interface Paginated<T> {
  items: T[];
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Feature availability, served by the API and rendered by every frontend.
 *
 * This is how the apps know what is real. A feature marked `not-deployed` must be shown as
 * such — never as working functionality with placeholder data behind it.
 */
export type FeatureState = "live" | "testnet" | "not-deployed" | "coming-soon";

export interface FeatureStatus {
  key: string;
  name: string;
  state: FeatureState;
  /** Contract address on KAURAX, when the feature has one deployed. */
  contract: Address | null;
  detail: string;
}
