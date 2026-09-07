/**
 * Feature availability.
 *
 * This is the single source of truth every KAURAX frontend uses to decide whether to show a
 * feature as working. A feature whose contracts are not deployed reports `not-deployed`,
 * and the UI must render it that way — not as a working screen with nothing behind it.
 *
 * State is determined by asking the chain, not by a hardcoded list: an address with no code
 * is reported as not deployed even if someone configured an address for it.
 */
import type {FastifyInstance} from "fastify";
import type {FeatureStatus} from "@kaurax/types";
import {isAddress, type Context, type Hex} from "../context.js";

interface Candidate {
  key: string;
  name: string;
  /** Environment variable holding the feature's contract address, if it has one. */
  envVar: string | null;
  /**
   * Which chain the contract lives on. The bridge portal is deployed on the underlying
   * L2, not on KAURAX — checking it against the KAURAX RPC would find whatever unrelated
   * contract happens to occupy that address there.
   */
  chain: "l3" | "l2";
  liveDetail: string;
  missingDetail: string;
}

const CANDIDATES: Candidate[] = [
  {
    key: "explorer",
    name: "Explorer",
    envVar: null,
    chain: "l3",
    liveDetail: "Reads live chain data and indexed history.",
    missingDetail: "",
  },
  {
    key: "wallet",
    name: "Wallet",
    envVar: null,
    chain: "l3",
    liveDetail: "Connects any EIP-1193 wallet to KAURAX.",
    missingDetail: "",
  },
  {
    key: "bridge",
    name: "Bridge",
    envVar: "KAURAX_PORTAL_ADDRESS",
    // KauraxPortal is on the underlying L2, which is the whole point of a bridge.
    chain: "l2",
    liveDetail: "Deposits and proof-verified withdrawals through KauraxPortal on the L2.",
    missingDetail: "KauraxPortal is not deployed on the configured L2.",
  },
  {
    key: "pay",
    name: "KAURAX Pay",
    envVar: null,
    chain: "l3",
    liveDetail: "Payment requests settled by real KAX transfers, verified on chain.",
    missingDetail: "",
  },
  {
    key: "ai",
    name: "KAURAX AI",
    envVar: null,
    chain: "l3",
    liveDetail: "Routed server-side through the xKiro gateway.",
    missingDetail: "XKIRO_API_KEY is not set on the API server.",
  },
  {
    key: "names",
    name: "KAURAX Names",
    envVar: "KAURAX_NAMES_ADDRESS",
    chain: "l3",
    liveDetail: "Name registration, renewal and resolution on KAURAX.",
    missingDetail: "The KauraxNames registry is not deployed on this network.",
  },
  {
    key: "swap",
    name: "KAURAX Swap",
    envVar: "KAURAX_SWAP_ROUTER_ADDRESS",
    chain: "l3",
    liveDetail: "Constant-product AMM on KAURAX, 0.3% fee to liquidity providers.",
    missingDetail: "No AMM router is deployed on this network.",
  },
  {
    key: "launchpad",
    name: "KAURAX Launchpad",
    envVar: "KAURAX_LAUNCHPAD_ADDRESS",
    chain: "l3",
    liveDetail: "Escrowed token sales on KAURAX with soft-cap refunds.",
    missingDetail: "The launchpad is not deployed on this network.",
  },
];

/** True when there is contract code at the address — the only honest test of "deployed". */
async function hasCode(ctx: Context, address: string, chain: "l3" | "l2"): Promise<boolean> {
  try {
    if (chain === "l3") {
      const code = await ctx.rpc.call<string>("eth_getCode", [address.toLowerCase(), "latest"]);
      return typeof code === "string" && code.length > 2;
    }

    // The L2 has no shared client here, so query it directly.
    if (!ctx.cfg.l2.rpcUrl) return false;
    const res = await fetch(ctx.cfg.l2.rpcUrl, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address.toLowerCase(), "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as {result?: string};
    return typeof body.result === "string" && body.result.length > 2;
  } catch {
    return false;
  }
}

export function registerFeatureRoutes(app: FastifyInstance, ctx: Context): void {
  app.get("/api/features", async () => {
    const features: FeatureStatus[] = [];

    for (const c of CANDIDATES) {
      if (c.key === "ai") {
        features.push({
          key: c.key,
          name: c.name,
          state: ctx.cfg.ai.apiKey ? "testnet" : "not-deployed",
          contract: null,
          detail: ctx.cfg.ai.apiKey ? c.liveDetail : c.missingDetail,
        });
        continue;
      }

      if (c.envVar === null) {
        features.push({key: c.key, name: c.name, state: "testnet", contract: null, detail: c.liveDetail});
        continue;
      }

      const configured = process.env[c.envVar];
      if (!isAddress(configured)) {
        features.push({key: c.key, name: c.name, state: "not-deployed", contract: null, detail: c.missingDetail});
        continue;
      }

      const deployed = await hasCode(ctx, configured, c.chain);
      features.push({
        key: c.key,
        name: c.name,
        // `testnet`, never `live`: nothing about KAURAX is production.
        state: deployed ? "testnet" : "not-deployed",
        contract: deployed ? (configured.toLowerCase() as Hex) : null,
        detail: deployed
          ? c.liveDetail
          : `${c.envVar} is set to ${configured}, but there is no contract code at that address on the ${c.chain === "l2" ? "underlying L2" : "KAURAX"} chain.`,
      });
    }

    return {
      network: `kaurax-${process.env.KAURAX_PROFILE ?? "devnet"}`,
      // Addresses the frontends need beyond the single per-feature contract above.
      // Absent entries mean "not deployed", and the apps render that.
      contracts: {
        names: process.env.KAURAX_NAMES_ADDRESS ?? null,
        wkax: process.env.KAURAX_WKAX_ADDRESS ?? null,
        swapFactory: process.env.KAURAX_SWAP_FACTORY_ADDRESS ?? null,
        swapRouter: process.env.KAURAX_SWAP_ROUTER_ADDRESS ?? null,
        launchpad: process.env.KAURAX_LAUNCHPAD_ADDRESS ?? null,
      },
      note:
        "KAURAX is a testnet. No feature is production. Anything marked not-deployed has no " +
        "contracts behind it and must not be presented as working.",
      features,
    };
  });
}
