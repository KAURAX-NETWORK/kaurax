/**
 * The signing seam.
 *
 * Every transaction KAURAX sends to the L2 — batches, output proposals, forced-inclusion
 * acknowledgements — is signed through this interface. Nothing above it knows whether the
 * private key is a hex string in the environment or material inside an HSM that this
 * process will never see.
 *
 * The interface deliberately takes a *hash*, not a transaction. A signing service that
 * only ever receives 32 bytes cannot be asked to interpret a payload it does not
 * understand, and the node keeps full responsibility for what it constructs.
 */
import type {Account} from "viem";

export type SignerRole = "sequencer" | "batcher" | "proposer";

export interface KauraxSigner {
  readonly role: SignerRole;
  /** `local` = key in this process. `remote` = key in a signing service. */
  readonly kind: "local" | "remote";
  readonly address: `0x${string}`;
  /** A viem account usable anywhere a wallet client is built. */
  readonly account: Account;
  /**
   * Confirms the signer can actually produce signatures for `address`.
   * Called at startup so a misconfigured signer fails before it is needed.
   */
  verify(): Promise<void>;
  /** Human-readable provenance for logs and status endpoints. Never includes key material. */
  describe(): string;
}

export class SignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerError";
  }
}
