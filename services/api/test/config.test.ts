import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {loadApiConfig, ConfigError} from "../src/config.js";

const BASE = {
  KAURAX_RPC_URL: "http://127.0.0.1:8420",
  KAURAX_CHAIN_ID: "8420",
  API_CORS_ORIGINS: "http://127.0.0.1:3000",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = {...process.env};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("KAURAX_") || k.startsWith("API_") || k.startsWith("XKIRO_") || k === "DATABASE_URL") {
      delete process.env[k];
    }
  }
  Object.assign(process.env, BASE);
});

afterEach(() => {
  process.env = saved;
});

describe("loadApiConfig", () => {
  it("loads a minimal valid configuration", () => {
    const cfg = loadApiConfig();
    expect(cfg.chainId).toBe(8420);
    expect(cfg.rpcUrl).toBe("http://127.0.0.1:8420");
    expect(cfg.corsOrigins).toEqual(["http://127.0.0.1:3000"]);
  });

  it("fails loudly when the RPC URL is missing", () => {
    delete process.env.KAURAX_RPC_URL;
    expect(() => loadApiConfig()).toThrow(ConfigError);
  });

  /**
   * A wildcard CORS origin on an API that fronts a chain and a database is a real problem,
   * so it is rejected at startup rather than left to a reviewer to notice.
   */
  it("refuses a wildcard CORS origin", () => {
    process.env.API_CORS_ORIGINS = "*";
    expect(() => loadApiConfig()).toThrow(/must not be "\*"/);
  });

  it("refuses a wildcard hidden in a list", () => {
    process.env.API_CORS_ORIGINS = "http://a.example, *";
    expect(() => loadApiConfig()).toThrow(/must not be "\*"/);
  });

  it("parses several origins and trims whitespace", () => {
    process.env.API_CORS_ORIGINS = " http://a.example , http://b.example ";
    expect(loadApiConfig().corsOrigins).toEqual(["http://a.example", "http://b.example"]);
  });

  it("treats a missing database as absent rather than defaulting to one", () => {
    expect(loadApiConfig().databaseUrl).toBeNull();
    process.env.DATABASE_URL = "postgresql://u@h/db";
    expect(loadApiConfig().databaseUrl).toBe("postgresql://u@h/db");
  });

  /** No key means the AI endpoints report themselves unconfigured — never a canned reply. */
  it("reports the AI key as absent when unset", () => {
    expect(loadApiConfig().ai.apiKey).toBeNull();
    expect(loadApiConfig().ai.baseUrl).toBe("https://api.xkiro.com/v1");
  });

  it("picks up the xKiro configuration when provided", () => {
    process.env.XKIRO_API_KEY = "test-key-not-a-real-secret";
    process.env.XKIRO_MODEL = "anthropic/claude-x";
    const cfg = loadApiConfig();
    expect(cfg.ai.apiKey).toBe("test-key-not-a-real-secret");
    expect(cfg.ai.model).toBe("anthropic/claude-x");
  });

  it("rejects a non-numeric port", () => {
    process.env.API_PORT = "not-a-port";
    expect(() => loadApiConfig()).toThrow(/must be a number/);
  });
});
