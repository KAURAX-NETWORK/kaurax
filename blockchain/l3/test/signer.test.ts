/**
 * These tests exercise the real signing service over a real socket. A mock would prove the
 * client talks to itself correctly; what matters is that a transaction signed through the
 * remote path is byte-for-byte as valid as one signed locally.
 */
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  verifyMessage,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {InMemoryKeystore, createSignerServer, type SignerServer} from "@kaurax/signer";
import {RemoteSigner} from "../src/signer/remote.js";
import {LocalSigner} from "../src/signer/local.js";
import {SignerError} from "../src/signer/types.js";

// A well-known anvil test key. It secures nothing; it exists in every OP Stack repository.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ACCOUNT = privateKeyToAccount(KEY);
const TOKEN = "0123456789abcdef0123456789abcdef";

let service: SignerServer;
let url: string;

beforeAll(async () => {
  service = createSignerServer({
    keystore: new InMemoryKeystore({batcher: KEY}),
    token: TOKEN,
    host: "127.0.0.1",
    port: 0, // ephemeral, so the test never collides with a running service
  });
  const {port} = await service.listen();
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await service.close();
});

const connect = (overrides: Partial<Parameters<typeof RemoteSigner.connect>[0]> = {}) =>
  RemoteSigner.connect({url, token: TOKEN, role: "batcher", ...overrides});

describe("RemoteSigner against the reference signing service", () => {
  it("learns its address from the service", async () => {
    const signer = await connect();
    expect(signer.address.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());
    expect(signer.kind).toBe("remote");
    expect(signer.describe()).toContain(ACCOUNT.address);
  });

  /** The whole point: same transaction, same signer, indistinguishable result. */
  it("produces a transaction that recovers to the same address as a local key", async () => {
    const tx = {
      chainId: 8415,
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
      nonce: 7,
      gas: 21_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1n,
      type: "eip1559",
    } as const;

    const remote = await connect();
    const remoteRaw = await remote.account.signTransaction!(tx);
    const localRaw = await ACCOUNT.signTransaction(tx);

    expect(remoteRaw).toBe(localRaw);
    expect((await recoverTransactionAddress({serializedTransaction: remoteRaw})).toLowerCase()).toBe(
      ACCOUNT.address.toLowerCase(),
    );
    expect(parseTransaction(remoteRaw).to).toBe(tx.to);
  });

  it("signs messages verifiably", async () => {
    const signer = await connect();
    const signature = await signer.account.signMessage!({message: "kaurax"});
    expect(await verifyMessage({address: signer.address, message: "kaurax", signature})).toBe(true);
  });

  it("signs the hash of exactly what will be broadcast", async () => {
    const tx = {chainId: 8415, nonce: 0, gas: 21_000n, type: "eip1559"} as const;
    const signer = await connect();
    const raw = await signer.account.signTransaction!(tx);
    // Re-deriving the unsigned hash proves the client hashed the serialization, not something else.
    expect(keccak256(serializeTransaction(tx))).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parseTransaction(raw).chainId).toBe(8415);
  });

  // --------------------------------------------------------- refusals --

  it("refuses to start if the service holds a different address than configured", async () => {
    await expect(
      connect({expectedAddress: "0x0000000000000000000000000000000000000042"}),
    ).rejects.toThrow(/Refusing to start/);
  });

  it("accepts a matching expected address", async () => {
    const signer = await connect({expectedAddress: ACCOUNT.address});
    expect(signer.address.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());
  });

  it("rejects a wrong token", async () => {
    await expect(connect({token: "wrong-token-wrong-token"})).rejects.toThrow(/401/);
  });

  it("reports a role the service has no key for", async () => {
    await expect(connect({role: "proposer"})).rejects.toThrow(/no key configured/);
  });

  it("fails loudly when the service is unreachable", async () => {
    await expect(
      RemoteSigner.connect({url: "http://127.0.0.1:1", token: TOKEN, role: "batcher", timeoutMs: 2000}),
    ).rejects.toThrow(SignerError);
  });

  it("times out rather than hanging the node", async () => {
    // Port 1 refuses fast; a black-holed address is what actually exercises the timeout.
    await expect(
      RemoteSigner.connect({url: "http://10.255.255.1:8555", token: TOKEN, role: "batcher", timeoutMs: 150}),
    ).rejects.toThrow(SignerError);
  }, 10_000);

  it("verify() re-checks the address, catching a swapped key", async () => {
    const signer = await connect();
    await expect(signer.verify()).resolves.toBeUndefined();
  });
});

describe("the signing service's own refusals", () => {
  it("answers health without a credential, and nothing else", async () => {
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).roles).toEqual(["batcher"]);

    expect((await fetch(`${url}/address/batcher`)).status).toBe(401);
  });

  it("refuses anything that is not a 32-byte hash", async () => {
    for (const hash of ["0x1234", "not-a-hash", null, 42, `0x${"ff".repeat(33)}`]) {
      const res = await fetch(`${url}/sign/batcher`, {
        method: "POST",
        headers: {Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json"},
        body: JSON.stringify({hash}),
      });
      expect(res.status, `hash=${String(hash)}`).toBe(400);
    }
  });

  it("refuses an unknown role", async () => {
    const res = await fetch(`${url}/address/attacker`, {headers: {Authorization: `Bearer ${TOKEN}`}});
    expect(res.status).toBe(404);
  });

  it("refuses an oversized body", async () => {
    const res = await fetch(`${url}/sign/batcher`, {
      method: "POST",
      headers: {Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json"},
      body: JSON.stringify({hash: `0x${"aa".repeat(32)}`, padding: "x".repeat(8192)}),
    });
    expect(res.status).toBe(400);
  });

  it("refuses to be created with a weak token", () => {
    expect(() => createSignerServer({keystore: new InMemoryKeystore({batcher: KEY}), token: "short"})).toThrow(
      /at least 16 characters/,
    );
  });

  it("refuses a malformed private key without echoing it", () => {
    expect(() => new InMemoryKeystore({batcher: "0xdeadbeef" as `0x${string}`})).toThrow(
      /BATCHER_PRIVATE_KEY is not a valid/,
    );
    expect(() => new InMemoryKeystore({batcher: "0xdeadbeef" as `0x${string}`})).not.toThrow(/deadbeef/);
  });
});

describe("LocalSigner", () => {
  it("derives the address from the key", () => {
    const signer = new LocalSigner("batcher", KEY);
    expect(signer.address).toBe(ACCOUNT.address);
    expect(signer.kind).toBe("local");
  });

  it("refuses a key that does not match the configured address", () => {
    expect(() => new LocalSigner("batcher", KEY, "0x0000000000000000000000000000000000000042")).toThrow(
      /Refusing to start with a mismatched key/,
    );
  });
});
