/**
 * Naming the account that receives the priority component of KAURAX gas fees.
 *
 * There is no fee-vault contract here, and adding one would not work: native gas fees are
 * credited by the EVM to the block coinbase before any contract runs, so no Solidity can
 * intercept them. The coinbase is the only lever, and it lives in the execution engine.
 *
 * KAURAX's engine is `anvil`, which exposes the coinbase through `anvil_setCoinbase`. That
 * is an administrative method, which is why this runs against the internal engine endpoint
 * and never through the public RPC — `rpc/methods.ts` blocks the whole `anvil_` namespace,
 * and `tests/acceptance.sh` asserts that it does.
 *
 * What this is NOT:
 *   - It does not change what a transaction costs. The same wei leaves the same sender.
 *   - It does not recover the burned base fee. Nothing can.
 *   - It does not create a withdrawal path. The recipient is an ordinary account whose key
 *     is held outside this process; the node cannot spend from it.
 *   - It is engine-specific. A different execution client sets its coinbase its own way,
 *     usually at genesis. See docs/PROTOCOL_FEES.md.
 */
import type {ExecutionEngine, Hex} from "../engine/types.js";
import {createLogger} from "../log.js";

const log = createLogger("fees");

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface FeeRecipientStatus {
  /** The address configured through KAURAX_FEE_RECIPIENT, or null when unset. */
  configured: string | null;
  /** The coinbase the engine actually reports. Null when it could not be read. */
  active: string | null;
  /**
   * True only when a recipient was configured AND the engine confirms it. False with a
   * configured recipient means the priority fee is still going somewhere else — a
   * condition that must be visible, not inferred.
   */
  applied: boolean;
  /** Why `applied` is false, in a form an operator can act on. Null when it is true. */
  problem: string | null;
}

/**
 * Point the engine's coinbase at the configured recipient and verify it took effect.
 *
 * This never throws. A chain that cannot route its fees is still a working chain, and
 * refusing to start would turn a bookkeeping problem into an outage. The failure is
 * logged at error level and reported through `kaurax_feeStatus` and the
 * `kaurax_fee_recipient_applied` metric instead, so it is visible rather than silent.
 */
export async function applyFeeRecipient(
  engine: ExecutionEngine,
  recipient: string | undefined,
): Promise<FeeRecipientStatus> {
  const active = await readCoinbase(engine);

  if (recipient === undefined) {
    log.warn(
      "no fee recipient configured: the priority component of every gas fee is being burned " +
        "along with the base fee. Set KAURAX_FEE_RECIPIENT to collect it.",
      {coinbase: active},
    );
    return {configured: null, active, applied: false, problem: null};
  }

  try {
    await engine.request("anvil_setCoinbase", [recipient]);
  } catch (err) {
    const problem = `the engine refused anvil_setCoinbase: ${(err as Error).message}`;
    log.error("fee recipient NOT applied; priority fees are not reaching it", {
      recipient,
      coinbase: active,
      error: (err as Error).message,
    });
    return {configured: recipient, active, applied: false, problem};
  }

  // Trusting the write would be enough right up until an engine accepts the call and
  // ignores it, so read the coinbase back and compare.
  const confirmed = await readCoinbase(engine);
  if (confirmed === null || !sameAddress(confirmed, recipient)) {
    const problem =
      `the engine accepted anvil_setCoinbase but reports its coinbase as ` +
      `${confirmed ?? "unreadable"}, not ${recipient}`;
    log.error("fee recipient NOT applied; priority fees are not reaching it", {recipient, problem});
    return {configured: recipient, active: confirmed, applied: false, problem};
  }

  log.info("fee recipient applied: priority fees now accrue to it", {
    recipient,
    note: "the EIP-1559 base fee is still burned and cannot be routed anywhere",
  });
  return {configured: recipient, active: confirmed, applied: true, problem: null};
}

async function readCoinbase(engine: ExecutionEngine): Promise<string | null> {
  try {
    const value = await engine.request<Hex>("eth_coinbase", []);
    return typeof value === "string" ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
