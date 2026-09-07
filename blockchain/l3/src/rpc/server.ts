/**
 * The public KAURAX JSON-RPC endpoint.
 *
 * Standard `eth_*` calls are forwarded to the execution engine, `eth_sendRawTransaction`
 * is intercepted so the sequencer owns ordering, and a `kaurax_*` namespace exposes the
 * L3-specific state that no Ethereum method can express: which batch a block landed in,
 * what the last output root was, where settlement currently stands.
 *
 * Every `kaurax_*` response is computed from live RPC and contract reads. Where a value is
 * genuinely unknown the field is `null` and the caller is expected to render that as
 * "No data available", never as a zero.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {WebSocketServer, WebSocket} from "ws";
import type {KauraxConfig} from "@kaurax/config";
import type {ExecutionEngine, Hex} from "../engine/types.js";
import {isBlocked, JSON_RPC_ERRORS, PROXIED_METHODS} from "./methods.js";
import {createLogger} from "../log.js";
import {RpcError} from "../engine/rpc.js";

export type KauraxRpcHandlers = Record<string, (params: unknown[]) => Promise<unknown>>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown[];
}

export interface RpcServerOptions {
  cfg: KauraxConfig;
  engine: ExecutionEngine;
  /** Called for eth_sendRawTransaction. Returns the transaction hash. */
  submitTransaction: (raw: Hex) => Promise<Hex>;
  /** kaurax_* namespace handlers. */
  kauraxMethods: KauraxRpcHandlers;
}

export class RpcServer {
  private readonly log = createLogger("rpc");
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private requestCount = 0;
  private errorCount = 0;

  constructor(private readonly opts: RpcServerOptions) {}

  async listen(): Promise<void> {
    const httpPort = portOf(this.opts.cfg.l3.rpcUrl, 8420);
    const wsPort = portOf(this.opts.cfg.l3.wsUrl, 8421);

    this.http = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(httpPort, "0.0.0.0", resolve);
    });
    this.log.info("JSON-RPC listening", {url: `http://0.0.0.0:${httpPort}`, chainId: this.opts.cfg.l3.chainId});

    this.wss = new WebSocketServer({port: wsPort});
    this.wss.on("connection", (socket) => this.handleWs(socket));
    this.log.info("WebSocket RPC listening", {url: `ws://0.0.0.0:${wsPort}`});
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
  }

  stats(): {requests: number; errors: number} {
    return {requests: this.requestCount, errors: this.errorCount};
  }

  // ---------------------------------------------------------------- HTTP //

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === "GET") {
      // A plain browser hit gets the network descriptor rather than a confusing error.
      res.writeHead(200, {...cors, "content-type": "application/json"});
      res.end(
        JSON.stringify(
          {
            name: "KAURAX",
            layer: 3,
            chainId: this.opts.cfg.l3.chainId,
            nativeCurrency: this.opts.cfg.l3.nativeCurrency,
            settlesTo: {layer: 2, chainId: this.opts.cfg.l2.chainId, name: this.opts.cfg.l2.name},
            note: "POST JSON-RPC to this endpoint.",
          },
          null,
          2,
        ),
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, cors);
      res.end();
      return;
    }

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      // Cap the request body: an unbounded POST is a trivial memory exhaustion vector.
      if (body.length > 10_000_000) {
        tooLarge = true;
        req.destroy();
      }
    });

    await new Promise<void>((resolve) => req.on("end", resolve).on("close", resolve));
    if (tooLarge) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.send(res, cors, {
        jsonrpc: "2.0",
        id: null,
        error: {code: JSON_RPC_ERRORS.parse, message: "Parse error"},
      });
      return;
    }

    const responses = Array.isArray(parsed)
      ? await Promise.all(parsed.map((r) => this.dispatch(r as JsonRpcRequest)))
      : await this.dispatch(parsed as JsonRpcRequest);

    this.send(res, cors, responses);
  }

  private send(res: ServerResponse, cors: Record<string, string>, payload: unknown): void {
    res.writeHead(200, {...cors, "content-type": "application/json"});
    res.end(JSON.stringify(payload, bigintReplacer));
  }

  // ------------------------------------------------------------ dispatch //

  private async dispatch(req: JsonRpcRequest): Promise<unknown> {
    const id = req.id ?? null;
    const method = req.method;
    const params = req.params ?? [];
    this.requestCount++;

    if (!method || typeof method !== "string") {
      this.errorCount++;
      return {jsonrpc: "2.0", id, error: {code: JSON_RPC_ERRORS.invalidRequest, message: "Invalid request"}};
    }

    try {
      const result = await this.route(method, params);
      return {jsonrpc: "2.0", id, result};
    } catch (err) {
      this.errorCount++;
      const code = err instanceof RpcError ? err.code : JSON_RPC_ERRORS.server;
      const message = (err as Error).message ?? "internal error";
      this.log.debug("rpc error", {method, message});
      return {jsonrpc: "2.0", id, error: {code, message}};
    }
  }

  private async route(method: string, params: unknown[]): Promise<unknown> {
    const {cfg, engine, submitTransaction, kauraxMethods} = this.opts;

    // Administrative namespaces are never reachable from the public endpoint.
    if (isBlocked(method)) {
      throw new RpcError(
        JSON_RPC_ERRORS.methodNotFound,
        `${method} is not available on the public KAURAX endpoint`,
      );
    }

    if (method === "eth_sendRawTransaction") {
      const raw = params[0];
      if (typeof raw !== "string" || !raw.startsWith("0x")) {
        throw new RpcError(JSON_RPC_ERRORS.invalidParams, "expected a 0x-prefixed raw transaction");
      }
      return submitTransaction(raw as Hex);
    }

    if (method === "eth_chainId") return `0x${cfg.l3.chainId.toString(16)}`;
    if (method === "net_version") return String(cfg.l3.chainId);
    if (method === "web3_clientVersion") return `kaurax-node/0.1.0 (engine: ${engine.clientName})`;

    // eth_accounts must be empty: the node holds sequencer keys, not user keys, and must
    // never appear to offer signing on a user's behalf.
    if (method === "eth_accounts") return [];

    if (method.startsWith("kaurax_")) {
      const handler = kauraxMethods[method];
      if (!handler) throw new RpcError(JSON_RPC_ERRORS.methodNotFound, `unknown method ${method}`);
      return handler(params);
    }

    if (PROXIED_METHODS.has(method)) return engine.request(method, params);

    throw new RpcError(JSON_RPC_ERRORS.methodNotFound, `unsupported method ${method}`);
  }

  // ------------------------------------------------------------------ WS //

  /**
   * WebSocket clients are bridged to the engine's own socket so that `eth_subscribe`
   * works end to end. Requests are still routed through `route`, so the same method
   * allowlist applies; only subscription traffic is passed straight through.
   */
  private handleWs(client: WebSocket): void {
    const engineWs = this.opts.cfg.l3.engineRpcUrl.replace(/^http/, "ws");
    const upstream = new WebSocket(engineWs);
    const queued: string[] = [];
    let upstreamReady = false;

    upstream.on("open", () => {
      upstreamReady = true;
      for (const m of queued.splice(0)) upstream.send(m);
    });
    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data.toString());
    });
    upstream.on("error", (err) => {
      this.log.warn("engine websocket error", {error: err.message});
      client.close(1011, "upstream unavailable");
    });
    upstream.on("close", () => client.close());

    client.on("message", async (data) => {
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(data.toString()) as JsonRpcRequest;
      } catch {
        client.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {code: JSON_RPC_ERRORS.parse, message: "Parse error"},
          }),
        );
        return;
      }

      const method = req.method ?? "";

      if (isBlocked(method)) {
        client.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id ?? null,
            error: {
              code: JSON_RPC_ERRORS.methodNotFound,
              message: `${method} is not available on the public KAURAX endpoint`,
            },
          }),
        );
        return;
      }

      // Subscriptions are stateful on the engine socket, so they go straight through.
      if (method === "eth_subscribe" || method === "eth_unsubscribe") {
        const payload = JSON.stringify(req);
        if (upstreamReady) upstream.send(payload);
        else queued.push(payload);
        return;
      }

      client.send(JSON.stringify(await this.dispatch(req), bigintReplacer));
    });

    client.on("close", () => upstream.close());
    client.on("error", () => upstream.close());
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}

function portOf(url: string, fallback: number): number {
  try {
    const parsed = new URL(url);
    return parsed.port ? Number(parsed.port) : fallback;
  } catch {
    return fallback;
  }
}
