/** JSON-RPC client used by the indexer. Batched where the RPC supports it. */
export type Hex = `0x${string}`;

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcBlock {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  gasLimit: Hex;
  baseFeePerGas?: Hex;
  transactions: RpcTransaction[];
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
  transactionIndex: Hex;
}

export interface RpcReceipt {
  transactionHash: Hex;
  gasUsed: Hex;
  effectiveGasPrice: Hex;
  status: Hex;
  contractAddress: Hex | null;
  logs: RpcLog[];
}

export interface RpcLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  logIndex: Hex;
  transactionHash: Hex;
  blockNumber: Hex;
}

export class RpcClient {
  private id = 1;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: this.id++, method, params}),
        signal: controller.signal,
      });
      if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as {result?: T; error?: {message: string}};
      if (body.error) throw new RpcError(`${method}: ${body.error.message}`);
      return body.result as T;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new RpcError(`${method}: timed out after ${this.timeoutMs}ms`);
      }
      throw new RpcError(`${method}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Batched request. Falls back to sequential calls if the endpoint rejects the batch,
   * so the indexer works against RPCs that do not implement JSON-RPC batching.
   */
  async batch<T>(requests: Array<{method: string; params: unknown[]}>): Promise<Array<T | null>> {
    if (requests.length === 0) return [];

    const payload = requests.map((r, i) => ({jsonrpc: "2.0", id: i, method: r.method, params: r.params}));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new RpcError(`batch: HTTP ${res.status}`);

      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) throw new RpcError("endpoint did not return a batch response");

      const out: Array<T | null> = new Array(requests.length).fill(null);
      for (const entry of body as Array<{id: number; result?: T; error?: unknown}>) {
        if (typeof entry.id === "number" && entry.error === undefined) {
          out[entry.id] = (entry.result ?? null) as T | null;
        }
      }
      return out;
    } catch {
      const out: Array<T | null> = [];
      for (const r of requests) {
        out.push(await this.call<T>(r.method, r.params).catch(() => null));
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  async blockNumber(): Promise<bigint> {
    return BigInt(await this.call<Hex>("eth_blockNumber"));
  }

  async chainId(): Promise<number> {
    return Number(BigInt(await this.call<Hex>("eth_chainId")));
  }

  async getBlock(n: bigint): Promise<RpcBlock | null> {
    return this.call<RpcBlock | null>("eth_getBlockByNumber", [`0x${n.toString(16)}`, true]);
  }

  async getReceipts(hashes: Hex[]): Promise<Array<RpcReceipt | null>> {
    return this.batch<RpcReceipt>(hashes.map((h) => ({method: "eth_getTransactionReceipt", params: [h]})));
  }

  async getCode(address: Hex): Promise<Hex> {
    return this.call<Hex>("eth_getCode", [address, "latest"]);
  }

  async waitReady(attempts = 60, delayMs = 1000): Promise<void> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.chainId();
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new RpcError(`RPC ${this.url} did not become ready: ${(last as Error)?.message}`);
  }
}
