/**
 * Hostile input at the protocol edge: malformed requests, replays, and transactions that
 * should be impossible. Every case here is something an attacker sends without needing a
 * bond, a role or a peer.
 *
 * Runs against KAURAX_RPC_URL (default: the local devnet).
 */
import {beforeAll, describe, expect, it} from "vitest";

const RPC = process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420";

async function raw(body: string, headers: Record<string, string> = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json", ...headers},
    body,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* left null on purpose: a non-JSON body is itself the finding */
  }
  return {status: res.status, body: parsed, text};
}

const call = (method: string, params: unknown[] = []) =>
  raw(JSON.stringify({jsonrpc: "2.0", id: 1, method, params}));

beforeAll(async () => {
  const r = await call("eth_chainId");
  if (!r.body?.result) {
    throw new Error(`no KAURAX node at ${RPC}. Start one with ./infra/scripts/devnet/start.sh`);
  }
}, 30_000);

describe("malformed requests are answered, not crashed on", () => {
  const cases: [string, string][] = [
    ["not JSON at all", "this is not json"],
    ["empty body", ""],
    ["JSON that is not an object", '"a string"'],
    ["missing method", '{"jsonrpc":"2.0","id":1}'],
    ["method is a number", '{"jsonrpc":"2.0","id":1,"method":42}'],
    ["params is not an array", '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":{}}'],
    ["null id", '{"jsonrpc":"2.0","id":null,"method":"eth_chainId"}'],
    ["deeply nested params", `{"jsonrpc":"2.0","id":1,"method":"eth_call","params":${"[".repeat(60)}${"]".repeat(60)}}`],
    ["wrong jsonrpc version", '{"jsonrpc":"1.0","id":1,"method":"eth_chainId"}'],
  ];

  for (const [name, payload] of cases) {
    it(`survives: ${name}`, async () => {
      const r = await raw(payload);
      // The requirement is that the node answers and stays up — not that it accepts.
      expect(r.status).toBeLessThan(600);
      const after = await call("eth_chainId");
      expect(after.body?.result, "the node stopped answering after a malformed request").toBeTruthy();
    });
  }

  it("survives a large payload without dropping the connection", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{to: "0x" + "11".repeat(20), data: "0x" + "ab".repeat(60_000)}, "latest"],
    });
    const r = await raw(big);
    expect(r.status).toBeLessThan(600);
    const after = await call("eth_chainId");
    expect(after.body?.result).toBeTruthy();
  });
});

describe("garbage transactions are rejected", () => {
  const bad = [
    ["empty", "0x"],
    ["not a transaction", "0xdeadbeef"],
    ["truncated legacy envelope", "0xf86c808504a817c800"],
    ["a type byte with nothing after it", "0x02"],
    ["odd-length hex", "0xabc"],
    ["not hex at all", "hello"],
  ] as const;

  for (const [name, payload] of bad) {
    it(`rejects ${name}`, async () => {
      const r = await call("eth_sendRawTransaction", [payload]);
      expect(r.body?.error, `${name} was accepted`).toBeTruthy();
      expect(r.body?.result).toBeUndefined();
    });
  }
});

describe("cross-chain replay", () => {
  it("reports the chain id the wallet must sign for", async () => {
    // Domain separation is the defence; the acceptance suite proves a transaction signed for
    // the L2 is rejected here. This asserts the value a signer is told to use is the value
    // the chain reports, since a mismatch would make every signature invalid or, worse,
    // valid somewhere else.
    const {body} = await call("eth_chainId");
    const declared = Number(process.env.KAURAX_CHAIN_ID ?? 8420);
    expect(Number(BigInt(body.result))).toBe(declared);
  });
});

describe("state is not writable through read methods", () => {
  it("eth_call cannot persist a change", async () => {
    const target = "0x0000000000000000000000000000000000000043";
    const before = (await call("eth_getBalance", [target, "latest"])).body.result;
    await call("eth_call", [{to: target, value: "0xde0b6b3a7640000", data: "0x"}, "latest"]);
    const after = (await call("eth_getBalance", [target, "latest"])).body.result;
    expect(after).toBe(before);
  });
});
