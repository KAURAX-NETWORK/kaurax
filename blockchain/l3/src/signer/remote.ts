/**
 * A key this process never holds.
 *
 * The node builds a transaction, serializes it, hashes it, and asks a signing service for
 * a signature over those 32 bytes. The service — Web3Signer, a KMS-backed sidecar, an HSM
 * proxy, or the reference implementation in services/signer — returns 65 bytes. The
 * private key never crosses the boundary, so compromising the node does not hand an
 * attacker the sequencer or proposer identity.
 *
 * Protocol (three endpoints, deliberately small enough to reimplement in an afternoon):
 *
 *   GET  {url}/health                      -> 200
 *   GET  {url}/address/{role}              -> {"address":"0x…20 bytes"}
 *   POST {url}/sign/{role}  {"hash":"0x…"} -> {"signature":"0x…65 bytes"}
 *
 * All requests carry `Authorization: Bearer <token>`. See docs/key-management.md.
 */
import {hashMessage, hashTypedData, keccak256, serializeTransaction, type Account} from "viem";
import {toAccount} from "viem/accounts";
import type {KauraxSigner, SignerRole} from "./types.js";
import {SignerError} from "./types.js";
import {createLogger} from "../log.js";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface RemoteSignerOptions {
  url: string;
  token: string;
  role: SignerRole;
  /** The address this role is expected to sign as. Startup fails if the service disagrees. */
  expectedAddress?: `0x${string}`;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class RemoteSigner implements KauraxSigner {
  readonly kind = "remote" as const;
  readonly role: SignerRole;
  readonly account: Account;
  readonly address: `0x${string}`;

  private readonly log = createLogger("signer");
  private readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  private constructor(opts: Required<Omit<RemoteSignerOptions, "expectedAddress">>, address: `0x${string}`) {
    this.role = opts.role;
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl;
    this.address = address;

    // viem's custom-account shape. Each hook reduces its input to a 32-byte hash and hands
    // that to the service — exactly what a local account does, with a network hop in the
    // middle of it.
    this.account = toAccount({
      address,
      signMessage: async ({message}) => this.signHash(hashMessage(message)),
      signTypedData: async (typedData) => this.signHash(hashTypedData(typedData as never)),
      signTransaction: async (transaction, options) => {
        // viem allows a custom serializer, which may itself be async.
        const serializer = options?.serializer ?? serializeTransaction;
        const unsigned = await serializer(transaction as never);
        const signature = await this.signHash(keccak256(unsigned));
        return serializer(transaction as never, parseSignature(signature)) as Promise<`0x${string}`>;
      },
    });
  }

  /**
   * Builds a signer and, in doing so, proves the service is reachable and owns the
   * expected address. Construction is async on purpose: a signer that cannot be
   * interrogated is a signer that will fail at the worst possible moment instead.
   */
  static async connect(opts: RemoteSignerOptions): Promise<RemoteSigner> {
    const resolved = {
      url: opts.url,
      token: opts.token,
      role: opts.role,
      timeoutMs: opts.timeoutMs ?? 10_000,
      fetchImpl: opts.fetchImpl ?? fetch,
    };

    const probe = new RemoteSigner(resolved, "0x0000000000000000000000000000000000000000");
    const address = await probe.fetchAddress();

    if (opts.expectedAddress && opts.expectedAddress.toLowerCase() !== address.toLowerCase()) {
      throw new SignerError(
        `${opts.role.toUpperCase()}_ADDRESS is ${opts.expectedAddress} but the signing service ` +
          `holds ${address} for this role. Refusing to start: settling from an unexpected ` +
          `account is worse than not settling.`,
      );
    }

    const signer = new RemoteSigner(resolved, address);
    signer.log.info("remote signer connected", {role: opts.role, address, url: resolved.url});
    return signer;
  }

  async verify(): Promise<void> {
    const address = await this.fetchAddress();
    if (address.toLowerCase() !== this.address.toLowerCase()) {
      throw new SignerError(
        `Signing service changed the address for role ${this.role}: was ${this.address}, now ${address}.`,
      );
    }
  }

  describe(): string {
    return `remote signer at ${this.url} (${this.address})`;
  }

  private async fetchAddress(): Promise<`0x${string}`> {
    const body = await this.request<{address?: string}>("GET", `/address/${this.role}`);
    const address = body.address;
    if (typeof address !== "string" || !ADDRESS.test(address)) {
      throw new SignerError(
        `Signing service returned an invalid address for role ${this.role}: ${JSON.stringify(address)}`,
      );
    }
    return address as `0x${string}`;
  }

  private async signHash(hash: `0x${string}`): Promise<`0x${string}`> {
    if (!HASH.test(hash)) throw new SignerError(`Refusing to send a non-32-byte hash to the signer: ${hash}`);

    const body = await this.request<{signature?: string}>("POST", `/sign/${this.role}`, {hash});
    const signature = body.signature;
    if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
      throw new SignerError(
        `Signing service returned an invalid signature for role ${this.role}: ` +
          `expected 65 bytes, got ${typeof signature === "string" ? `${signature.length} chars` : typeof signature}`,
      );
    }
    return signature as `0x${string}`;
  }

  private async request<T>(method: "GET" | "POST", path: string, payload?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(payload === undefined ? {} : {"Content-Type": "application/json"}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body may explain the refusal; it must never be assumed to contain a signature.
        const detail = await response.text().catch(() => "");
        throw new SignerError(
          `Signing service ${method} ${path} failed: ${response.status} ${response.statusText}` +
            (detail ? ` — ${detail.slice(0, 200)}` : ""),
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SignerError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new SignerError(`Signing service did not answer ${method} ${path} within ${this.timeoutMs}ms`);
      }
      throw new SignerError(`Signing service unreachable at ${this.url}${path}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Splits a 65-byte compact signature into the form viem's serializer expects. */
function parseSignature(signature: `0x${string}`): {r: `0x${string}`; s: `0x${string}`; v: bigint; yParity: number} {
  const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  const raw = Number.parseInt(signature.slice(130, 132), 16);

  // Services differ: some return v ∈ {27,28}, others yParity ∈ {0,1}. Accept both rather
  // than producing a silently invalid signature.
  const yParity = raw === 0 || raw === 1 ? raw : raw === 27 || raw === 28 ? raw - 27 : -1;
  if (yParity === -1) {
    throw new SignerError(`Signing service returned an unusable recovery byte: 0x${signature.slice(130, 132)}`);
  }
  return {r, s, v: BigInt(yParity + 27), yParity};
}
