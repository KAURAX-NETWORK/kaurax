/**
 * Where the keys actually are.
 *
 * This reference implementation keeps them in the service's own memory, loaded from its
 * environment. That is a real improvement over keys in the node — the blast radius of a
 * compromised sequencer no longer includes the ability to sign — but it is not an HSM.
 *
 * To back a role with a KMS or HSM instead, implement `Keystore` against that provider and
 * hand it to `createSignerServer`. Nothing else in the service changes; this is the only
 * file that ever touches key material.
 */
import {privateKeyToAccount, sign} from "viem/accounts";
import {serializeSignature, type Hex} from "viem";

export type Role = "sequencer" | "batcher" | "proposer";
export const ROLES: readonly Role[] = ["sequencer", "batcher", "proposer"];

export interface Keystore {
  /** Roles this service can sign for. */
  roles(): Role[];
  address(role: Role): Hex | null;
  /** Signs a 32-byte hash, returning 65 bytes: r ‖ s ‖ yParity. */
  sign(role: Role, hash: Hex): Promise<Hex>;
}

export class InMemoryKeystore implements Keystore {
  private readonly keys = new Map<Role, Hex>();
  private readonly addresses = new Map<Role, Hex>();

  constructor(keys: Partial<Record<Role, Hex>>) {
    for (const role of ROLES) {
      const key = keys[role];
      if (!key) continue;
      if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
        // Deliberately does not echo the value.
        throw new Error(`${role.toUpperCase()}_PRIVATE_KEY is not a valid 32-byte hex private key`);
      }
      this.keys.set(role, key);
      this.addresses.set(role, privateKeyToAccount(key).address);
    }
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): InMemoryKeystore {
    return new InMemoryKeystore({
      sequencer: env.SEQUENCER_PRIVATE_KEY as Hex | undefined,
      batcher: env.BATCHER_PRIVATE_KEY as Hex | undefined,
      proposer: env.PROPOSER_PRIVATE_KEY as Hex | undefined,
    });
  }

  roles(): Role[] {
    return [...this.keys.keys()];
  }

  address(role: Role): Hex | null {
    return this.addresses.get(role) ?? null;
  }

  async sign(role: Role, hash: Hex): Promise<Hex> {
    const key = this.keys.get(role);
    if (!key) throw new Error(`No key configured for role ${role}`);

    // Sign the hash as-is. The service never prefixes, wraps or reinterprets what it is
    // given: the caller is responsible for what those 32 bytes mean, and a signer that
    // second-guesses its input is a signer that can be tricked into signing something else.
    const signature = await sign({hash, privateKey: key});
    return serializeSignature(signature);
  }
}
