/**
 * A key held in this process's memory, read from the environment.
 *
 * Correct for a devnet and for nothing else: anything that can read the process
 * environment, a core dump, or the deployment manifest has the key. `validateConfig`
 * refuses this mode on a public profile unless the operator opts in explicitly.
 */
import {privateKeyToAccount} from "viem/accounts";
import type {Account} from "viem";
import type {KauraxSigner, SignerRole} from "./types.js";
import {SignerError} from "./types.js";

export class LocalSigner implements KauraxSigner {
  readonly kind = "local" as const;
  readonly account: Account;
  readonly address: `0x${string}`;

  constructor(
    readonly role: SignerRole,
    privateKey: `0x${string}`,
    expectedAddress?: `0x${string}`,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;

    // If the operator stated which address this role should be, hold the config to it.
    if (expectedAddress && expectedAddress.toLowerCase() !== this.address.toLowerCase()) {
      throw new SignerError(
        `${role.toUpperCase()}_ADDRESS is ${expectedAddress} but the configured private key ` +
          `belongs to ${this.address}. Refusing to start with a mismatched key.`,
      );
    }
  }

  async verify(): Promise<void> {
    // Nothing to reach out to; the constructor already derived the address from the key.
  }

  describe(): string {
    return `local key (${this.address})`;
  }
}
