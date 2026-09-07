/**
 * Builds the signer for a role from configuration.
 *
 * Returns `null` when a role has no key at all — that is a legitimate state (a node can run
 * as a read-only follower with no batcher), and the components that need the key already
 * fail loudly when it is missing.
 */
import type {KauraxConfig} from "@kaurax/config";
import type {KauraxSigner, SignerRole} from "./types.js";
import {SignerError} from "./types.js";
import {LocalSigner} from "./local.js";
import {RemoteSigner} from "./remote.js";

export type {KauraxSigner, SignerRole} from "./types.js";
export {SignerError} from "./types.js";
export {LocalSigner} from "./local.js";
export {RemoteSigner} from "./remote.js";

export async function createSigner(role: SignerRole, cfg: KauraxConfig): Promise<KauraxSigner | null> {
  const expected = cfg.signer.addresses[role];

  if (cfg.signer.mode === "remote") {
    // validateConfig already rejected remote mode without a URL and token; this keeps the
    // types honest and turns any future config regression into a clear message.
    if (!cfg.signer.remoteUrl || !cfg.signer.remoteToken) {
      throw new SignerError("Remote signing is enabled but KAURAX_SIGNER_URL/KAURAX_SIGNER_TOKEN are missing.");
    }
    return RemoteSigner.connect({
      url: cfg.signer.remoteUrl,
      token: cfg.signer.remoteToken,
      role,
      expectedAddress: expected,
      timeoutMs: cfg.signer.timeoutMs,
    });
  }

  const key = cfg.keys[role];
  if (!key) return null;
  return new LocalSigner(role, key, expected);
}

/** Builds every role at once, so a misconfiguration surfaces during startup, not mid-batch. */
export async function createSigners(
  cfg: KauraxConfig,
): Promise<Record<SignerRole, KauraxSigner | null>> {
  const [sequencer, batcher, proposer] = await Promise.all([
    createSigner("sequencer", cfg),
    createSigner("batcher", cfg),
    createSigner("proposer", cfg),
  ]);
  return {sequencer, batcher, proposer};
}
