/**
 * Account abstraction — interface layer.
 *
 * ============================================================================
 * NOT IMPLEMENTED. Read this before using anything in this file.
 * ============================================================================
 *
 * KAURAX is EVM-equivalent, so ERC-4337 works here exactly as it works on any EVM chain:
 * the EntryPoint is an ordinary contract and nothing about KAURAX prevents deploying it.
 *
 * What KAURAX does NOT operate today:
 *   - an EntryPoint deployment
 *   - a bundler
 *   - a paymaster
 *   - session key infrastructure
 *
 * This module exists so that application code can be written against a stable shape now,
 * and so that the absence is visible in the type system rather than discovered at runtime.
 * Every operation throws `AccountAbstractionNotAvailable`. None of them silently degrades
 * to an EOA path, because a caller who believes a transaction was sponsored when it was not
 * has a false picture of who paid.
 *
 * Do not describe KAURAX as supporting account abstraction. It has an EVM that would.
 */
import type {Address, Hex} from "./types.js";

export class AccountAbstractionNotAvailable extends Error {
  constructor(what: string) {
    super(
      `${what} is not available on KAURAX. ERC-4337 infrastructure (EntryPoint, bundler, ` +
        `paymaster) is not deployed or operated on this network. See docs/wallet.md.`,
    );
    this.name = "AccountAbstractionNotAvailable";
  }
}

/** ERC-4337 v0.7 packed user operation. */
export interface UserOperation {
  sender: Address;
  nonce: bigint;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Address;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  signature: Hex;
}

export interface SmartAccount {
  readonly address: Address;
  readonly owner: Address;
  getNonce(): Promise<bigint>;
  encodeCall(to: Address, value: bigint, data: Hex): Hex;
  encodeBatch(calls: Array<{to: Address; value: bigint; data: Hex}>): Hex;
}

/** A key delegated limited authority for a bounded time. */
export interface SessionKey {
  readonly publicKey: Address;
  readonly validUntil: number;
  readonly allowedTargets: Address[];
  readonly spendingCap: bigint;
}

export interface Bundler {
  sendUserOperation(op: UserOperation): Promise<Hex>;
  estimateUserOperationGas(
    op: Partial<UserOperation>,
  ): Promise<{callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint}>;
  getUserOperationReceipt(hash: Hex): Promise<unknown | null>;
  supportedEntryPoints(): Promise<Address[]>;
}

export interface Paymaster {
  sponsorUserOperation(op: UserOperation): Promise<UserOperation>;
}

/** What the network actually supports right now. Check this before building on the above. */
export interface AccountAbstractionCapabilities {
  entryPointDeployed: boolean;
  bundlerAvailable: boolean;
  paymasterAvailable: boolean;
  sessionKeysAvailable: boolean;
  entryPointAddress: Address | null;
  note: string;
}

/**
 * Report AA capabilities. Returns the truth, which is currently that none exist.
 *
 * When ERC-4337 infrastructure is deployed on KAURAX this function should query it rather
 * than return a constant — and until then it must not claim otherwise.
 */
export async function getAccountAbstractionCapabilities(): Promise<AccountAbstractionCapabilities> {
  return {
    entryPointDeployed: false,
    bundlerAvailable: false,
    paymasterAvailable: false,
    sessionKeysAvailable: false,
    entryPointAddress: null,
    note:
      "KAURAX operates no ERC-4337 infrastructure. The EVM would support it; nothing is deployed. " +
      "Use ordinary EOA transactions.",
  };
}

export function createSmartAccount(): Promise<SmartAccount> {
  throw new AccountAbstractionNotAvailable("createSmartAccount");
}

export function connectBundler(): Bundler {
  throw new AccountAbstractionNotAvailable("connectBundler");
}

export function connectPaymaster(): Paymaster {
  throw new AccountAbstractionNotAvailable("connectPaymaster");
}

export function createSessionKey(): Promise<SessionKey> {
  throw new AccountAbstractionNotAvailable("createSessionKey");
}
