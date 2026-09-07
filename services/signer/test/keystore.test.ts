/**
 * The keystore is the only file in KAURAX that holds private keys. These tests pin the
 * behaviour that matters if it is ever reimplemented against a KMS or an HSM: what it
 * signs, what it refuses, and what it declines to say out loud.
 */
import {describe, expect, it} from "vitest";
import {recoverAddress, recoverMessageAddress, hashMessage, keccak256, toHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {InMemoryKeystore, ROLES} from "../src/keystore.js";

// A published Anvil test key. It secures nothing.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ACCOUNT = privateKeyToAccount(KEY);
const HASH = keccak256(toHex("kaurax"));

describe("InMemoryKeystore", () => {
  it("exposes only the roles it has keys for", () => {
    const ks = new InMemoryKeystore({batcher: KEY});
    expect(ks.roles()).toEqual(["batcher"]);
    expect(ks.address("batcher")).toBe(ACCOUNT.address);
    expect(ks.address("proposer")).toBeNull();
  });

  it("loads every role when given every key", () => {
    const ks = new InMemoryKeystore({sequencer: KEY, batcher: KEY, proposer: KEY});
    expect(new Set(ks.roles())).toEqual(new Set(ROLES));
  });

  /** The signature must recover to the address the service advertises, or it is useless. */
  it("produces a signature that recovers to the advertised address", async () => {
    const ks = new InMemoryKeystore({batcher: KEY});
    const signature = await ks.sign("batcher", HASH);

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect((await recoverAddress({hash: HASH, signature})).toLowerCase()).toBe(
      ACCOUNT.address.toLowerCase(),
    );
  });

  it("signs the hash it is given, without wrapping or prefixing it", async () => {
    // If the service secretly applied the EIP-191 message prefix, a transaction signed
    // through it would be invalid — and the failure would surface only on chain.
    const ks = new InMemoryKeystore({batcher: KEY});
    const raw = await ks.sign("batcher", HASH);
    const asMessage = await ks.sign("batcher", hashMessage({raw: HASH}));
    expect(raw).not.toBe(asMessage);

    expect(
      (await recoverMessageAddress({message: {raw: HASH}, signature: asMessage})).toLowerCase(),
    ).toBe(ACCOUNT.address.toLowerCase());
  });

  it("is deterministic, as RFC 6979 requires", async () => {
    const ks = new InMemoryKeystore({batcher: KEY});
    expect(await ks.sign("batcher", HASH)).toBe(await ks.sign("batcher", HASH));
  });

  it("gives different roles different identities", async () => {
    const other = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
    const ks = new InMemoryKeystore({batcher: KEY, proposer: other});
    expect(ks.address("batcher")).not.toBe(ks.address("proposer"));
    expect(await ks.sign("batcher", HASH)).not.toBe(await ks.sign("proposer", HASH));
  });

  it("refuses to sign for a role it holds no key for", async () => {
    const ks = new InMemoryKeystore({batcher: KEY});
    await expect(ks.sign("proposer", HASH)).rejects.toThrow(/No key configured for role proposer/);
  });

  it("rejects a malformed key without echoing it", () => {
    const bad = "0xdeadbeef" as `0x${string}`;
    expect(() => new InMemoryKeystore({sequencer: bad})).toThrow(/SEQUENCER_PRIVATE_KEY is not a valid/);
    // The whole point of the check is that the value never reaches a log or a stack trace.
    try {
      new InMemoryKeystore({sequencer: bad});
    } catch (error) {
      expect((error as Error).message).not.toContain("deadbeef");
    }
  });

  it("rejects a key of the wrong length", () => {
    expect(() => new InMemoryKeystore({batcher: `0x${"ab".repeat(31)}` as `0x${string}`})).toThrow();
    expect(() => new InMemoryKeystore({batcher: `0x${"ab".repeat(33)}` as `0x${string}`})).toThrow();
  });

  it("treats an empty configuration as empty, not as an error", () => {
    const ks = new InMemoryKeystore({});
    expect(ks.roles()).toEqual([]);
  });

  it("reads keys from an environment without touching the real one", () => {
    const ks = InMemoryKeystore.fromEnv({BATCHER_PRIVATE_KEY: KEY} as NodeJS.ProcessEnv);
    expect(ks.roles()).toEqual(["batcher"]);
    expect(ks.address("batcher")).toBe(ACCOUNT.address);
  });
});
