/**
 * The descriptor /api/network serves is the thing a wallet acts on: the "add network"
 * button feeds it straight to wallet_addEthereumChain. It once carried the API's own
 * internal dial address, so MetaMask added a network it could not reach and displayed a
 * zero balance for a funded account — a wrong address that looks like an empty wallet.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {browserFacing, publicOrigin} from "../src/routes/chain.js";

type Req = Parameters<typeof publicOrigin>[0];
const req = (headers: Record<string, string>, protocol = "http") =>
  ({headers, protocol} as unknown as Req);

const ctx = (explorerUrl = "") =>
  ({cfg: {explorerUrl}} as unknown as Parameters<typeof browserFacing>[1]);

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = {...process.env};
  delete process.env.KAURAX_PUBLIC_RPC_URL;
});
afterEach(() => {
  process.env = saved;
});

describe("publicOrigin", () => {
  it("prefers the forwarded host and protocol over the proxy's own", () => {
    expect(
      publicOrigin(req({host: "127.0.0.1:4000", "x-forwarded-host": "kaurax.network", "x-forwarded-proto": "https"})),
    ).toBe("https://kaurax.network");
  });

  it("takes the first protocol when a chain of proxies appends more", () => {
    expect(
      publicOrigin(req({"x-forwarded-host": "kaurax.network", "x-forwarded-proto": "https, http"})),
    ).toBe("https://kaurax.network");
  });

  it("returns null when no host is known, rather than inventing one", () => {
    expect(publicOrigin(req({}))).toBeNull();
  });

  it("assumes https for a public host when the proxy states no protocol", () => {
    // TLS terminates at the CDN and nginx is reached over plain http, so the last hop's
    // scheme is http even though the user is on https. Advertising http:// there produced
    // an RPC URL browsers block as mixed content.
    expect(publicOrigin(req({host: "kaurax.network"}, "http"))).toBe("https://kaurax.network");
  });

  it("still trusts the last hop for a loopback host, so local dev is not forced to https", () => {
    expect(publicOrigin(req({host: "127.0.0.1:4000"}, "http"))).toBe("http://127.0.0.1:4000");
    expect(publicOrigin(req({host: "localhost:4000"}, "http"))).toBe("http://localhost:4000");
  });
});

describe("browserFacing", () => {
  it("derives an externally reachable RPC URL from the request origin", () => {
    const {rpcUrl} = browserFacing(
      req({"x-forwarded-host": "kaurax.network", "x-forwarded-proto": "https"}),
      ctx(),
    );
    expect(rpcUrl).toBe("https://kaurax.network/rpc");
  });

  it("never leaks an internal dial address, even with none configured", () => {
    // The regression: KAURAX_RPC_URL is http://kaurax-l3:8420 in the deployed stack.
    process.env.KAURAX_RPC_URL = "http://kaurax-l3:8420";
    const {rpcUrl} = browserFacing(req({"x-forwarded-host": "kaurax.network"}), ctx());
    expect(rpcUrl).not.toContain("kaurax-l3");
  });

  it("prefers an explicitly configured public RPC URL", () => {
    process.env.KAURAX_PUBLIC_RPC_URL = "https://rpc.example.test";
    const {rpcUrl} = browserFacing(req({"x-forwarded-host": "kaurax.network"}), ctx());
    expect(rpcUrl).toBe("https://rpc.example.test");
  });

  it("falls back to empty rather than to something unreachable", () => {
    expect(browserFacing(req({}), ctx()).rpcUrl).toBe("");
  });

  it("keeps a configured explorer URL and derives one otherwise", () => {
    expect(browserFacing(req({"x-forwarded-host": "k.test"}), ctx("https://ex.test")).explorerUrl).toBe(
      "https://ex.test",
    );
    expect(browserFacing(req({"x-forwarded-host": "k.test"}), ctx()).explorerUrl).toBe("https://k.test/explorer");
  });
});
