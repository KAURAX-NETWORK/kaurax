/**
 * The signing service's HTTP surface — three endpoints and nothing else.
 *
 * Design rules, all of them deliberate:
 *
 *  - It binds to 127.0.0.1 by default. A signing service reachable from the internet is a
 *    private key reachable from the internet.
 *  - Every request needs a bearer token, compared in constant time.
 *  - It signs a hash, never a transaction. It cannot be argued into signing "just this
 *    one" payload it does not understand, because it does not understand any of them.
 *  - It logs which role signed and when, but never the key, never the token.
 *
 * Implemented on node:http rather than a framework so it has almost no dependency surface
 * of its own. This is the process holding the keys; it should be small enough to read.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {timingSafeEqual} from "node:crypto";
import {ROLES, type Keystore, type Role} from "./keystore.js";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_BODY_BYTES = 4096;

export interface SignerServerOptions {
  keystore: Keystore;
  token: string;
  host?: string;
  port?: number;
  /** Called for every signature produced. Wire it to your audit log. */
  onSigned?: (role: Role, hash: string) => void;
}

export interface SignerServer {
  readonly server: Server;
  listen(): Promise<{host: string; port: number}>;
  close(): Promise<void>;
}

export function createSignerServer(opts: SignerServerOptions): SignerServer {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8555;

  if (!opts.token || opts.token.length < 16) {
    throw new Error(
      "KAURAX_SIGNER_TOKEN must be at least 16 characters. Generate one with `openssl rand -hex 32`.",
    );
  }
  const expectedToken = Buffer.from(opts.token);

  const server = createServer((req, res) => {
    handle(req, res, opts, expectedToken).catch((error: unknown) => {
      // A failure while signing must never leak a stack trace to the caller.
      send(res, 500, {error: "internal error"});
      process.stderr.write(`signer: unhandled error: ${(error as Error).message}\n`);
    });
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          const bound = typeof address === "object" && address ? address.port : port;
          process.stdout.write(
            `signer: listening on http://${host}:${bound} for roles [${opts.keystore.roles().join(", ") || "none"}]\n`,
          );
          resolve({host, port: bound});
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SignerServerOptions,
  expectedToken: Buffer,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Health is unauthenticated on purpose so a load balancer or systemd check does not need
  // the signing credential. It reveals nothing but liveness.
  if (path === "/health" && req.method === "GET") {
    return send(res, 200, {status: "ok", roles: opts.keystore.roles()});
  }

  if (!authorized(req, expectedToken)) {
    return send(res, 401, {error: "unauthorized"});
  }

  const addressMatch = /^\/address\/([a-z]+)$/.exec(path);
  if (addressMatch && req.method === "GET") {
    const role = parseRole(addressMatch[1] ?? "");
    if (!role) return send(res, 404, {error: "unknown role"});
    const address = opts.keystore.address(role);
    if (!address) return send(res, 404, {error: `no key configured for role ${role}`});
    return send(res, 200, {address});
  }

  const signMatch = /^\/sign\/([a-z]+)$/.exec(path);
  if (signMatch && req.method === "POST") {
    const role = parseRole(signMatch[1] ?? "");
    if (!role) return send(res, 404, {error: "unknown role"});
    if (!opts.keystore.address(role)) return send(res, 404, {error: `no key configured for role ${role}`});

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      return send(res, 400, {error: (error as Error).message});
    }

    const hash = (body as {hash?: unknown} | null)?.hash;
    if (typeof hash !== "string" || !HASH.test(hash)) {
      // The single most important check in this file: only 32 bytes, nothing else.
      return send(res, 400, {error: "hash must be a 0x-prefixed 32-byte hex string"});
    }

    const signature = await opts.keystore.sign(role, hash as `0x${string}`);
    opts.onSigned?.(role, hash);
    process.stdout.write(`signer: signed for ${role} hash=${hash}\n`);
    return send(res, 200, {signature});
  }

  send(res, 404, {error: "not found"});
}

function parseRole(value: string): Role | null {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

function authorized(req: IncomingMessage, expected: Buffer): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  // Compare in constant time, and only when lengths match — timingSafeEqual throws otherwise.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A signing request is a few hundred bytes. Anything larger is not a signing request.
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)});
  res.end(payload);
}
