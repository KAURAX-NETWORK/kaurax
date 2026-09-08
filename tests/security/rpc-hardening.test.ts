/**
 * The public RPC is the only part of KAURAX an attacker can reach without a bond, a key or a
 * transaction. It fronts `anvil`, whose administrative namespaces can mint balances,
 * impersonate any account and rewrite state — so what it forwards is a security boundary,
 * not a convenience.
 *
 * Runs against KAURAX_RPC_URL (default: the local devnet). Started by CI after the devnet is
 * up; not part of the default `pnpm test`, which must not require a running chain.
 */
import {beforeAll, describe, expect, it} from "vitest";

const RPC = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";

async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  const text = await res.text();
  try {
    return {status: res.status, body: JSON.parse(text)};
  } catch {
    return {status: res.status, body: null, text};
  }
}

beforeAll(async () => {
  const r = await rpc("eth_chainId").catch(() => null);
  if (!r?.body?.result) {
    throw new Error(
      `no KAURAX node at ${RPC}. Start one with ./infra/scripts/devnet/start.sh, ` +
        `or point KAURAX_RPC_URL at a running node.`,
    );
  }
}, 30_000);

describe("administrative namespaces are not forwarded", () => {
  const forbidden = [
    ["anvil_setBalance", ["0x0000000000000000000000000000000000000001", "0xffffffff"]],
    ["anvil_setCode", ["0x0000000000000000000000000000000000000001", "0x60006000"]],
    ["anvil_impersonateAccount", ["0x0000000000000000000000000000000000000001"]],
    ["anvil_mine", []],
    ["evm_mine", []],
    ["evm_setAutomine", [true]],
    ["evm_setNextBlockTimestamp", [99999999999]],
    ["evm_snapshot", []],
    ["evm_revert", ["0x1"]],
    ["hardhat_setBalance", ["0x0000000000000000000000000000000000000001", "0xffffffff"]],
    ["hardhat_impersonateAccount", ["0x0000000000000000000000000000000000000001"]],
    ["debug_traceTransaction", ["0x" + "00".repeat(32)]],
    ["debug_traceCall", [{}, "latest"]],
    ["admin_nodeInfo", []],
    ["admin_peers", []],
    ["miner_start", []],
    ["personal_unlockAccount", ["0x0000000000000000000000000000000000000001", "", 0]],
    ["personal_listAccounts", []],
    ["txpool_content", []],
    ["engine_forkchoiceUpdatedV1", [{}, {}]],
    ["ots_getApiLevel", []],
  ] as const;

  for (const [method, params] of forbidden) {
    it(`refuses ${method}`, async () => {
      const {body} = await rpc(method, params as unknown[]);
      expect(body?.error, `${method} returned a result instead of an error`).toBeTruthy();
      expect(body?.result).toBeUndefined();
    });
  }

  it("mints nothing: a balance is unchanged after an attempted setBalance", async () => {
    const victim = "0x0000000000000000000000000000000000000042";
    const before = (await rpc("eth_getBalance", [victim, "latest"])).body.result;
    await rpc("anvil_setBalance", [victim, "0xde0b6b3a7640000"]);
    const after = (await rpc("eth_getBalance", [victim, "latest"])).body.result;
    expect(after).toBe(before);
  });
});

describe("the surface is an allowlist, not a denylist", () => {
  it("refuses a method that exists upstream but was never allowlisted", async () => {
    // eth_sendTransaction asks the node to sign. A KAURAX node holds operator keys; a public
    // endpoint that forwarded this would let anyone spend them.
    const {body} = await rpc("eth_sendTransaction", [{from: "0x" + "11".repeat(20), value: "0x1"}]);
    expect(body?.error).toBeTruthy();
  });

  it("refuses an invented namespace, so a new upstream method cannot leak in by default", async () => {
    const {body} = await rpc("kaurax_thisMethodDoesNotExist", []);
    expect(body?.error).toBeTruthy();
  });

  it("still serves the methods a wallet needs", async () => {
    for (const m of ["eth_chainId", "eth_blockNumber", "eth_gasPrice"]) {
      const {body} = await rpc(m);
      expect(body?.result, `${m} should be served`).toBeTruthy();
    }
  });
});

describe("errors do not leak internals", () => {
  it("an error message names no internal host, port or file path", async () => {
    const {body} = await rpc("anvil_setBalance", []);
    const message = JSON.stringify(body?.error ?? {});
    expect(message).not.toMatch(/127\.0\.0\.1:18420|l3-engine|\/repo\/|\/opt\/kaurax/);
  });
});
