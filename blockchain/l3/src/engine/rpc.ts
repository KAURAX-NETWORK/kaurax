/** Minimal JSON-RPC client with request ids, batching-free semantics and typed errors. */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class JsonRpcClient {
  private nextId = 1;

  constructor(
    public readonly url: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id, method, params}),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new RpcError(-32000, `${method}: HTTP ${res.status} from ${this.url}`);
      }

      const body = (await res.json()) as {
        result?: T;
        error?: {code: number; message: string; data?: unknown};
      };

      if (body.error) throw new RpcError(body.error.code, `${method}: ${body.error.message}`, body.error.data);
      return body.result as T;
    } catch (err) {
      if (err instanceof RpcError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new RpcError(-32000, `${method}: timed out after ${this.timeoutMs}ms against ${this.url}`);
      }
      throw new RpcError(-32000, `${method}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Poll until the endpoint answers, or give up. Used at devnet startup. */
  async waitReady(attempts = 60, delayMs = 500): Promise<void> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.request("eth_chainId");
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new Error(
      `Endpoint ${this.url} did not become ready after ${attempts} attempts: ${(last as Error)?.message}`,
    );
  }
}
