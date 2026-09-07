/**
 * Bridge helpers.
 *
 * These build the calldata for the canonical bridge path and read back real progress.
 * They deliberately do not sign anything: the SDK never handles a private key. The caller
 * signs with their own wallet.
 *
 * Asset flow:
 *
 *   L2 --KauraxPortal.depositTransaction--> derived by the node --> KAURAX
 *   KAURAX --L3ToL2MessagePasser.initiateWithdrawal--> output root --> prove --> wait --> finalize --> L2
 */
import {encodeFunctionData, type Abi} from "viem";
import type {Address, Hex} from "./types.js";
import type {KauraxClient} from "./client.js";

export const PREDEPLOYS = {
  messagePasser: "0x4200000000000000000000000000000000000016" as Address,
  l3ERC20Bridge: "0x4200000000000000000000000000000000000010" as Address,
} as const;

const portalAbi = [
  {
    type: "function",
    name: "depositTransaction",
    stateMutability: "payable",
    inputs: [
      {name: "_to", type: "address"},
      {name: "_value", type: "uint256"},
      {name: "_gasLimit", type: "uint64"},
      {name: "_isCreation", type: "bool"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
] as const satisfies Abi;

const messagePasserAbi = [
  {
    type: "function",
    name: "initiateWithdrawal",
    stateMutability: "payable",
    inputs: [
      {name: "_target", type: "address"},
      {name: "_gasLimit", type: "uint256"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
] as const satisfies Abi;

/** Minimum gas the portal accepts for a deposit. */
export const MIN_DEPOSIT_GAS_LIMIT = 21_000n;

export interface DepositCall {
  to: Address;
  data: Hex;
  value: bigint;
  description: string;
}

/**
 * Build the L2 transaction that deposits native value onto KAURAX.
 * Send this on the underlying L2, not on KAURAX.
 */
export function buildDeposit(args: {
  portal: Address;
  recipient: Address;
  amount: bigint;
  gasLimit?: bigint;
}): DepositCall {
  const gasLimit = args.gasLimit ?? MIN_DEPOSIT_GAS_LIMIT;
  if (gasLimit < MIN_DEPOSIT_GAS_LIMIT) {
    throw new Error(`deposit gasLimit must be at least ${MIN_DEPOSIT_GAS_LIMIT}`);
  }
  if (args.amount <= 0n) throw new Error("deposit amount must be positive");

  return {
    to: args.portal,
    value: args.amount,
    data: encodeFunctionData({
      abi: portalAbi,
      functionName: "depositTransaction",
      args: [args.recipient, args.amount, gasLimit, false, "0x"],
    }),
    description: `Deposit ${args.amount} wei to ${args.recipient} on KAURAX`,
  };
}

/**
 * Build the KAURAX transaction that begins a withdrawal to the underlying L2.
 * Send this on KAURAX.
 */
export function buildWithdrawal(args: {recipient: Address; amount: bigint; gasLimit?: bigint}): DepositCall {
  const gasLimit = args.gasLimit ?? 100_000n;
  if (args.amount <= 0n) throw new Error("withdrawal amount must be positive");

  return {
    to: PREDEPLOYS.messagePasser,
    value: args.amount,
    data: encodeFunctionData({
      abi: messagePasserAbi,
      functionName: "initiateWithdrawal",
      args: [args.recipient, gasLimit, "0x"],
    }),
    description: `Withdraw ${args.amount} wei to ${args.recipient} on the underlying L2`,
  };
}

/** The stage a withdrawal has reached. Derived from chain state, never assumed. */
export type WithdrawalStage =
  | {stage: "unknown"; reason: string}
  | {stage: "awaiting-output-root"; reason: string; nextProposalAtL3Block: string}
  | {stage: "provable"; proof: WithdrawalProof};

export interface WithdrawalProof {
  status: "ready";
  withdrawal: {
    nonce: string;
    sender: Address;
    target: Address;
    value: string;
    gasLimit: string;
    data: Hex;
    withdrawalHash: Hex;
    leafIndex: number;
    l3BlockNumber: string;
    l3TxHash: Hex;
  };
  l2OutputIndex: string;
  outputRootProof: {version: Hex; stateRoot: Hex; withdrawalTreeRoot: Hex; latestBlockHash: Hex};
  withdrawalIndex: number;
  withdrawalProof: Hex[];
  challengeWindowSeconds: number;
}

/**
 * Ask the node for everything needed to prove a withdrawal on the L2.
 *
 * A withdrawal only becomes provable once the proposer has published an output root
 * covering its block. Until then this reports `awaiting-output-root` — it does not
 * fabricate a proof or estimate when one will appear beyond what the oracle schedules.
 */
export async function getWithdrawalStatus(
  client: KauraxClient,
  withdrawalHash: Hex,
): Promise<WithdrawalStage> {
  const result = await client.request<
    | WithdrawalProof
    | {status: "awaiting-proposal"; reason: string; nextProposalAtL3Block: string}
    | {status: "unknown"; reason: string}
  >("kaurax_withdrawalProof", [withdrawalHash]);

  if (result.status === "ready") return {stage: "provable", proof: result};
  if (result.status === "awaiting-proposal") {
    return {
      stage: "awaiting-output-root",
      reason: result.reason,
      nextProposalAtL3Block: result.nextProposalAtL3Block,
    };
  }
  return {stage: "unknown", reason: result.reason};
}

/** Every withdrawal this node knows about. */
export async function listWithdrawals(client: KauraxClient): Promise<WithdrawalProof["withdrawal"][]> {
  return client.request<WithdrawalProof["withdrawal"][]>("kaurax_listWithdrawals");
}
