/** Re-exports so the CLI depends on one module rather than reaching into the SDK's shape. */
export {connect, KauraxClient} from "@kaurax/sdk";
export {getWithdrawalStatus, listWithdrawals, buildDeposit, buildWithdrawal} from "@kaurax/sdk";
export type {NetworkStatus, SequencerStatus, BatcherStatus} from "@kaurax/sdk";

/** Format wei as a decimal KAX string without floating point rounding. */
export function formatWei(wei: bigint, decimals = 18): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
