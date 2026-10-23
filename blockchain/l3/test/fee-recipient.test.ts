/**
 * The fee recipient is applied through an administrative engine method, and the failure
 * mode that matters is the quiet one: the call is accepted, the coinbase does not change,
 * and an operator believes fees are being collected while they are being burned. These
 * tests exist mostly to pin that case.
 */
import {describe, expect, it} from "vitest";
import {applyFeeRecipient, ZERO_ADDRESS} from "../src/fees/recipient.js";
import type {ExecutionEngine} from "../src/engine/types.js";

const RECIPIENT = "0x00000000000000000000000000000000000000be";

/** An engine stub that records what it was asked and answers from a settable coinbase. */
function stubEngine(opts: {
  coinbase?: string | null;
  onSet?: (addr: string) => void;
  setThrows?: string;
  coinbaseThrows?: boolean;
} = {}): {engine: ExecutionEngine; calls: Array<{method: string; params: unknown[]}>} {
  let coinbase = opts.coinbase === undefined ? ZERO_ADDRESS : opts.coinbase;
  const calls: Array<{method: string; params: unknown[]}> = [];

  const engine = {
    clientName: "stub",
    async request<T>(method: string, params: unknown[]): Promise<T> {
      calls.push({method, params});
      if (method === "anvil_setCoinbase") {
        if (opts.setThrows) throw new Error(opts.setThrows);
        const addr = params[0] as string;
        if (opts.onSet) opts.onSet(addr);
        else coinbase = addr;
        return null as T;
      }
      if (method === "eth_coinbase") {
        if (opts.coinbaseThrows) throw new Error("method not supported");
        return coinbase as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  } as unknown as ExecutionEngine;

  return {engine, calls};
}

describe("applyFeeRecipient", () => {
  it("sets the coinbase and confirms it by reading it back", async () => {
    const {engine, calls} = stubEngine();
    const status = await applyFeeRecipient(engine, RECIPIENT);

    expect(status.applied).toBe(true);
    expect(status.configured).toBe(RECIPIENT);
    expect(status.active).toBe(RECIPIENT.toLowerCase());
    expect(status.problem).toBeNull();

    // Written once, then verified — not assumed.
    expect(calls.filter((c) => c.method === "anvil_setCoinbase")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "eth_coinbase").length).toBeGreaterThanOrEqual(2);
  });

  it("reports not-applied, without throwing, when the engine accepts the call and ignores it", async () => {
    // The silent failure. The node must keep running and must not claim success.
    const {engine} = stubEngine({onSet: () => {}});
    const status = await applyFeeRecipient(engine, RECIPIENT);

    expect(status.applied).toBe(false);
    expect(status.configured).toBe(RECIPIENT);
    expect(status.active).toBe(ZERO_ADDRESS);
    expect(status.problem).toMatch(/reports its coinbase as/);
  });

  it("reports not-applied when the engine refuses the method", async () => {
    const {engine} = stubEngine({setThrows: "method anvil_setCoinbase does not exist"});
    const status = await applyFeeRecipient(engine, RECIPIENT);

    expect(status.applied).toBe(false);
    expect(status.problem).toMatch(/anvil_setCoinbase/);
  });

  it("reports not-applied when the coinbase cannot be read back", async () => {
    const {engine} = stubEngine({coinbaseThrows: true});
    const status = await applyFeeRecipient(engine, RECIPIENT);

    expect(status.applied).toBe(false);
    expect(status.active).toBeNull();
  });

  it("does not touch the coinbase when no recipient is configured", async () => {
    const {engine, calls} = stubEngine();
    const status = await applyFeeRecipient(engine, undefined);

    expect(status.configured).toBeNull();
    expect(status.applied).toBe(false);
    // Nothing is "wrong" — burning fees is a valid, deliberate choice.
    expect(status.problem).toBeNull();
    expect(calls.some((c) => c.method === "anvil_setCoinbase")).toBe(false);
  });

  it("treats a checksummed address as a match for the lowercase coinbase", async () => {
    const mixed = "0x00000000000000000000000000000000000000BE";
    const {engine} = stubEngine();
    const status = await applyFeeRecipient(engine, mixed);

    expect(status.applied).toBe(true);
  });
});
