import WebSocket from "ws";
import {
  KauraxRpcError,
  type BatcherStatus,
  type Block,
  type Hex,
  type Address,
  type KauraxClientOptions,
  type Log,
  type LogFilter,
  type NetworkDescriptor,
  type NetworkStatus,
  type SequencerStatus,
  type Transaction,
  type TransactionReceipt,
} from "./types.js";

/** Connect to a KAURAX endpoint and verify it is actually KAURAX. */
export async function connect(options: KauraxClientOptions): Promise<KauraxClient> {
  const client = new KauraxClient(options);
  await client.ready();
  return client;
}

export class KauraxClient {
  private id = 1;
  private chainIdCache: number | null = null;
  private readonly timeoutMs: number;

  constructor(private readonly options: KauraxClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Resolve once the endpoint answers, caching the chain ID. */
  async ready(): Promise<void> {
    this.chainIdCache = await this.getChainId();
  }

  // ------------------------------------------------------------ transport //

  async request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.options.rpcUrl, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: this.id++, method, params}),
        signal: controller.signal,
      });
      if (!res.ok) throw new KauraxRpcError(-32000, `${method}: HTTP ${res.status}`);

      const body = (await res.json()) as {result?: T; error?: {code: number; message: string}};
      if (body.error) throw new KauraxRpcError(body.error.code, body.error.message);
      return body.result as T;
    } catch (err) {
      if (err instanceof KauraxRpcError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new KauraxRpcError(-32000, `${method} timed out after ${this.timeoutMs}ms`);
      }
      throw new KauraxRpcError(-32000, `${method}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------- chain //

  async getChainId(): Promise<number> {
    if (this.chainIdCache !== null) return this.chainIdCache;
    const hex = await this.request<Hex>("eth_chainId");
    this.chainIdCache = Number(BigInt(hex));
    return this.chainIdCache;
  }

  async getBlockNumber(): Promise<bigint> {
    return BigInt(await this.request<Hex>("eth_blockNumber"));
  }

  async getBlock(numberOrTag: bigint | "latest" | "earliest" = "latest"): Promise<Block | null> {
    const tag = typeof numberOrTag === "bigint" ? toHex(numberOrTag) : numberOrTag;
    const raw = await this.request<RawBlock | null>("eth_getBlockByNumber", [tag, false]);
    return raw ? decodeBlock(raw) : null;
  }

  async getBlockByHash(hash: Hex): Promise<Block | null> {
    const raw = await this.request<RawBlock | null>("eth_getBlockByHash", [hash, false]);
    return raw ? decodeBlock(raw) : null;
  }

  async getBalance(address: Address, blockTag: bigint | "latest" = "latest"): Promise<bigint> {
    const tag = typeof blockTag === "bigint" ? toHex(blockTag) : blockTag;
    return BigInt(await this.request<Hex>("eth_getBalance", [address, tag]));
  }

  async getTransactionCount(address: Address, blockTag: "latest" | "pending" = "latest"): Promise<number> {
    return Number(BigInt(await this.request<Hex>("eth_getTransactionCount", [address, blockTag])));
  }

  async getCode(address: Address): Promise<Hex> {
    return this.request<Hex>("eth_getCode", [address, "latest"]);
  }

  async getTransaction(hash: Hex): Promise<Transaction | null> {
    const raw = await this.request<RawTransaction | null>("eth_getTransactionByHash", [hash]);
    return raw ? decodeTransaction(raw) : null;
  }

  async getTransactionReceipt(hash: Hex): Promise<TransactionReceipt | null> {
    const raw = await this.request<RawReceipt | null>("eth_getTransactionReceipt", [hash]);
    return raw ? decodeReceipt(raw) : null;
  }

  /** Poll until the transaction is mined. Throws on timeout rather than returning null. */
  async waitForTransaction(hash: Hex, timeoutMs = 60_000, intervalMs = 500): Promise<TransactionReceipt> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await this.getTransactionReceipt(hash);
      if (receipt) return receipt;
      await sleep(intervalMs);
    }
    throw new KauraxRpcError(-32000, `transaction ${hash} was not mined within ${timeoutMs}ms`);
  }

  /** Submit an already-signed transaction. The SDK never holds or asks for a key. */
  async sendTransaction(signedRawTransaction: Hex): Promise<Hex> {
    return this.request<Hex>("eth_sendRawTransaction", [signedRawTransaction]);
  }

  async estimateGas(tx: {
    from?: Address;
    to?: Address;
    value?: bigint;
    data?: Hex;
  }): Promise<bigint> {
    const params: Record<string, string> = {};
    if (tx.from) params.from = tx.from;
    if (tx.to) params.to = tx.to;
    if (tx.value !== undefined) params.value = toHex(tx.value);
    if (tx.data) params.data = tx.data;
    return BigInt(await this.request<Hex>("eth_estimateGas", [params]));
  }

  async call(tx: {to: Address; data: Hex; from?: Address}, blockTag: bigint | "latest" = "latest"): Promise<Hex> {
    const tag = typeof blockTag === "bigint" ? toHex(blockTag) : blockTag;
    return this.request<Hex>("eth_call", [tx, tag]);
  }

  async getGasPrice(): Promise<bigint> {
    return BigInt(await this.request<Hex>("eth_gasPrice"));
  }

  async getLogs(filter: LogFilter): Promise<Log[]> {
    const params: Record<string, unknown> = {};
    if (filter.address) params.address = filter.address;
    if (filter.topics) params.topics = filter.topics;
    params.fromBlock =
      filter.fromBlock === undefined
        ? "earliest"
        : typeof filter.fromBlock === "bigint"
          ? toHex(filter.fromBlock)
          : filter.fromBlock;
    params.toBlock =
      filter.toBlock === undefined
        ? "latest"
        : typeof filter.toBlock === "bigint"
          ? toHex(filter.toBlock)
          : filter.toBlock;

    const raw = await this.request<RawLog[]>("eth_getLogs", [params]);
    return raw.map(decodeLog);
  }

  // ------------------------------------------------------- KAURAX methods //

  /** The full Ethereum -> L2 -> KAURAX picture. */
  async getNetworkStatus(): Promise<NetworkStatus> {
    return this.request<NetworkStatus>("kaurax_networkStatus");
  }

  async getSequencerStatus(): Promise<SequencerStatus> {
    return this.request<SequencerStatus>("kaurax_sequencerStatus");
  }

  async getBatcherStatus(): Promise<BatcherStatus> {
    return this.request<BatcherStatus>("kaurax_batcherStatus");
  }

  async getSettlementStatus(): Promise<unknown> {
    return this.request("kaurax_settlementStatus");
  }

  /** Everything a wallet needs for wallet_addEthereumChain. */
  async getNetworkDescriptor(): Promise<NetworkDescriptor> {
    return this.request<NetworkDescriptor>("kaurax_networkDescriptor");
  }

  /**
   * Whether a given L3 block has been published to the underlying L2 yet.
   * Returns `null` when the settlement state cannot be read.
   */
  async isBlockSettled(blockNumber: bigint): Promise<boolean | null> {
    const status = await this.getNetworkStatus();
    if (status.settlement.lastBatchedL3Block === null) return null;
    return BigInt(status.settlement.lastBatchedL3Block) >= blockNumber;
  }

  // ------------------------------------------------------- subscriptions //

  /**
   * Subscribe to new KAURAX blocks over WebSocket.
   * Returns an unsubscribe function. Requires `wsUrl`.
   */
  subscribeBlocks(onBlock: (block: NewHead) => void, onError?: (err: Error) => void): () => void {
    if (!this.options.wsUrl) {
      throw new Error("subscribeBlocks requires wsUrl in KauraxClientOptions");
    }

    const socket = new WebSocket(this.options.wsUrl);
    let subscriptionId: string | null = null;
    let closed = false;

    socket.on("open", () => {
      socket.send(JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"]}));
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          id?: number;
          result?: string;
          method?: string;
          params?: {subscription: string; result: RawNewHead};
        };
        if (msg.id === 1 && typeof msg.result === "string") {
          subscriptionId = msg.result;
          return;
        }
        if (msg.method === "eth_subscription" && msg.params?.subscription === subscriptionId) {
          onBlock(decodeNewHead(msg.params.result));
        }
      } catch (err) {
        onError?.(err as Error);
      }
    });

    socket.on("error", (err) => onError?.(err));

    return () => {
      if (closed) return;
      closed = true;
      try {
        if (subscriptionId) {
          socket.send(
            JSON.stringify({jsonrpc: "2.0", id: 2, method: "eth_unsubscribe", params: [subscriptionId]}),
          );
        }
      } catch {
        // The socket may already be gone; closing is what matters.
      }
      socket.close();
    };
  }
}

export interface NewHead {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
}

// ------------------------------------------------------------- decoding --

interface RawBlock {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  gasLimit: Hex;
  baseFeePerGas?: Hex;
  transactions: Hex[];
}

interface RawNewHead {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  gasLimit: Hex;
  baseFeePerGas?: Hex;
}

interface RawTransaction {
  hash: Hex;
  from: Address;
  to: Address | null;
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

interface RawReceipt {
  transactionHash: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  from: Address;
  to: Address | null;
  contractAddress: Address | null;
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  status: Hex;
  logs: RawLog[];
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  removed?: boolean;
}

function decodeBlock(raw: RawBlock): Block {
  return {
    number: BigInt(raw.number),
    hash: raw.hash,
    parentHash: raw.parentHash,
    stateRoot: raw.stateRoot,
    timestamp: BigInt(raw.timestamp),
    gasUsed: BigInt(raw.gasUsed),
    gasLimit: BigInt(raw.gasLimit),
    baseFeePerGas: raw.baseFeePerGas ? BigInt(raw.baseFeePerGas) : null,
    transactions: raw.transactions,
    transactionCount: raw.transactions.length,
  };
}

function decodeNewHead(raw: RawNewHead): NewHead {
  return {
    number: BigInt(raw.number),
    hash: raw.hash,
    parentHash: raw.parentHash,
    stateRoot: raw.stateRoot,
    timestamp: BigInt(raw.timestamp),
    gasUsed: BigInt(raw.gasUsed),
    gasLimit: BigInt(raw.gasLimit),
    baseFeePerGas: raw.baseFeePerGas ? BigInt(raw.baseFeePerGas) : null,
  };
}

function decodeTransaction(raw: RawTransaction): Transaction {
  return {
    hash: raw.hash,
    from: raw.from,
    to: raw.to,
    value: BigInt(raw.value),
    nonce: Number(BigInt(raw.nonce)),
    gas: BigInt(raw.gas),
    gasPrice: raw.gasPrice ? BigInt(raw.gasPrice) : null,
    maxFeePerGas: raw.maxFeePerGas ? BigInt(raw.maxFeePerGas) : null,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas ? BigInt(raw.maxPriorityFeePerGas) : null,
    input: raw.input,
    blockNumber: raw.blockNumber ? BigInt(raw.blockNumber) : null,
    blockHash: raw.blockHash,
    transactionIndex: raw.transactionIndex ? Number(BigInt(raw.transactionIndex)) : null,
  };
}

function decodeReceipt(raw: RawReceipt): TransactionReceipt {
  return {
    transactionHash: raw.transactionHash,
    blockNumber: BigInt(raw.blockNumber),
    blockHash: raw.blockHash,
    from: raw.from,
    to: raw.to,
    contractAddress: raw.contractAddress,
    gasUsed: BigInt(raw.gasUsed),
    effectiveGasPrice: BigInt(raw.effectiveGasPrice),
    status: BigInt(raw.status) === 1n ? "success" : "reverted",
    logs: raw.logs.map(decodeLog),
  };
}

function decodeLog(raw: RawLog): Log {
  return {
    address: raw.address,
    topics: raw.topics,
    data: raw.data,
    blockNumber: BigInt(raw.blockNumber),
    transactionHash: raw.transactionHash,
    logIndex: Number(BigInt(raw.logIndex)),
    removed: raw.removed ?? false,
  };
}

function toHex(v: bigint): Hex {
  return `0x${v.toString(16)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
