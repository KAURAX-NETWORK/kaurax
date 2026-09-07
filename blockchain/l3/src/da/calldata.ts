/**
 * Calldata data availability.
 *
 * KAURAX batch bytes are carried as calldata of a transaction to `KauraxBatchInbox` on the
 * underlying L2. The L2 in turn includes that calldata in its own batch to Ethereum, so
 * KAURAX transaction data is ultimately reconstructible from Ethereum. That chain of
 * custody is the whole point; see docs/data-availability.md.
 */
import {decodeFunctionData, fromHex} from "viem";
import type {DaCommitment, DataAvailabilityInterface} from "../settlement/types.js";
import type {L2SettlementAdapter} from "../settlement/L2SettlementAdapter.js";
import {batchInboxAbi} from "../settlement/abi.js";
import type {Hex} from "../engine/types.js";

export class CalldataDA implements DataAvailabilityInterface {
  readonly mode = "calldata" as const;

  constructor(private readonly settlement: L2SettlementAdapter) {}

  async publish(
    payload: Uint8Array,
    meta: {l3StartBlock: bigint; l3EndBlock: bigint},
  ): Promise<DaCommitment> {
    return this.settlement.submitBatch(meta.l3StartBlock, meta.l3EndBlock, payload);
  }

  /**
   * Recover the original bytes from the L2 transaction that carried them. This is the
   * operation a fresh KAURAX node performs to rebuild the chain from data availability
   * alone, and it is why the inbox stores a commitment rather than the bytes.
   */
  async retrieve(commitment: DaCommitment): Promise<Uint8Array | null> {
    const tx = await this.settlement.publicClient
      .getTransaction({hash: commitment.txHash})
      .catch(() => null);
    if (!tx) return null;

    try {
      const decoded = decodeFunctionData({abi: batchInboxAbi, data: tx.input});
      if (decoded.functionName !== "submitBatch") return null;
      const data = decoded.args[2] as Hex;
      return fromHex(data, "bytes");
    } catch {
      return null;
    }
  }
}

/**
 * Blob and external-DA targets.
 *
 * These are declared so the batcher can be pointed at them without restructuring, but
 * neither is implemented in v0 and neither is operated. Selecting them fails loudly rather
 * than silently degrading to calldata, because a caller that believes data went to a blob
 * when it did not has a false picture of the chain's recoverability.
 */
export class UnimplementedDA implements DataAvailabilityInterface {
  constructor(readonly mode: "blob" | "altda") {}

  async publish(): Promise<DaCommitment> {
    throw new Error(
      `DA_MODE=${this.mode} is not implemented in KAURAX v0. ` +
        `Only "calldata" is operational. See docs/data-availability.md.`,
    );
  }

  async retrieve(): Promise<Uint8Array | null> {
    throw new Error(`DA_MODE=${this.mode} is not implemented in KAURAX v0.`);
  }
}
