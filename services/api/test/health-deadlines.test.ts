/**
 * A health probe must fail, not hang.
 *
 * Both the database and the RPC probes were unbounded. A suspended PostgreSQL accepts the
 * connection and never answers; a node being restarted does the same. `/api/health` then
 * produced no response at all — `curl` reported 000 rather than 503 — which is strictly
 * worse than reporting "down", because an orchestrator sees a request in flight instead of
 * a service to restart. The chaos suite found the database case, and then the RPC case only
 * after the first was fixed.
 */
import {describe, expect, it} from "vitest";
import {withDeadline, PROBE_TIMEOUT_MS} from "../src/routes/health.js";

describe("withDeadline", () => {
  it("passes a value through untouched when the work finishes", async () => {
    await expect(withDeadline("x", Promise.resolve(42))).resolves.toBe(42);
  });

  it("propagates the underlying failure rather than masking it as a timeout", async () => {
    await expect(withDeadline("x", Promise.reject(new Error("connection refused")))).rejects.toThrow(
      "connection refused",
    );
  });

  it("rejects rather than hanging when the work never settles", async () => {
    const never = new Promise<never>(() => {});
    const started = Date.now();
    await expect(withDeadline("the database", never)).rejects.toThrow(/did not respond within/);
    // It must actually be bounded, not merely eventually rejected.
    expect(Date.now() - started).toBeLessThan(PROBE_TIMEOUT_MS + 2000);
  }, 20_000);

  it("names the subsystem, so a failing probe says which one", async () => {
    await expect(withDeadline("the RPC", new Promise<never>(() => {}))).rejects.toThrow(/the RPC/);
  }, 20_000);
});
