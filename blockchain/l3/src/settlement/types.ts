/**
 * The three interfaces that keep KAURAX's execution, settlement and data-availability
 * concerns separable. They are deliberately not merged: on KAURAX today all three happen
 * to terminate at the same underlying L2, but that is a deployment choice, not a
 * structural one. See docs/data-availability.md.
 */
import type {Hex} from "../engine/types.js";

/** Where L3 transaction data is published so the chain can be reconstructed. */
export interface DataAvailabilityInterface {
  readonly mode: "calldata" | "blob" | "altda";

  /**
   * Publish batch bytes and return a commitment that a node can later resolve back to the
   * original bytes.
   */
  publish(payload: Uint8Array, meta: {l3StartBlock: bigint; l3EndBlock: bigint}): Promise<DaCommitment>;

  /** Resolve a commitment back to the bytes, for chain reconstruction. */
  retrieve(commitment: DaCommitment): Promise<Uint8Array | null>;
}

export interface DaCommitment {
  /** keccak256 of the published bytes. */
  hash: Hex;
  /** Transaction on the DA target that carries the bytes. */
  txHash: Hex;
  /** Block on the DA target that included it, once known. */
  blockNumber: bigint | null;
  byteLength: number;
}

/** Collects L3 blocks and hands compressed batches to the DA layer. */
export interface BatcherInterface {
  start(): void;
  stop(): void;
  /** Force a submission now rather than at the next interval. */
  flush(): Promise<BatchSubmission | null>;
  status(): BatcherStatus;
}

export interface BatchSubmission {
  batchIndex: number | null;
  l3StartBlock: bigint;
  l3EndBlock: bigint;
  uncompressedBytes: number;
  compressedBytes: number;
  commitment: DaCommitment;
  submittedAt: number;
}

export interface BatcherStatus {
  running: boolean;
  lastSubmission: BatchSubmission | null;
  lastError: string | null;
  nextL3BlockToBatch: bigint;
  pendingL3Blocks: number;
}

/**
 * The KAURAX -> underlying-L2 settlement boundary.
 *
 * Every method here is a real call against real contracts on a real chain. In the devnet
 * that chain is local; nothing is stubbed or faked. There is no mode in which these
 * methods invent a result.
 */
export interface SettlementInterface {
  readonly l2ChainId: number;
  readonly l2Name: string;

  /** Publish L3 transaction data to the L2. */
  submitBatch(l3StartBlock: bigint, l3EndBlock: bigint, data: Uint8Array): Promise<DaCommitment>;

  /** Inclusion status of a previously submitted batch. */
  getBatchStatus(txHash: Hex): Promise<BatchStatus>;

  /** Current head of the underlying L2. */
  getL2Block(): Promise<{number: bigint; hash: Hex; timestamp: bigint}>;

  /**
   * How far Ethereum has finalized beneath the L2.
   *
   * `null` when the configured L1 endpoint cannot answer, or when the L2 is a local
   * devnet chain that does not post to an L1 at all. KAURAX never guesses this value.
   */
  getL1Finality(): Promise<L1Finality | null>;

  /** Publish a KAURAX state commitment. */
  proposeOutput(args: {
    outputRoot: Hex;
    l3BlockNumber: bigint;
    l2BlockHash: Hex;
    l2BlockNumber: bigint;
  }): Promise<Hex>;

  /** Next L3 block height the output oracle expects a proposal for. */
  nextOutputBlockNumber(): Promise<bigint>;

  latestOutput(): Promise<{index: bigint; outputRoot: Hex; timestamp: bigint; l3BlockNumber: bigint} | null>;

  lastBatchL3Block(): Promise<bigint>;
  batchCount(): Promise<bigint>;
}

export interface BatchStatus {
  txHash: Hex;
  included: boolean;
  l2BlockNumber: bigint | null;
  confirmations: bigint | null;
  reverted: boolean | null;
}

export interface L1Finality {
  finalizedBlockNumber: bigint;
  safeBlockNumber: bigint;
  latestBlockNumber: bigint;
  chainId: number;
  /**
   * true when the configured L1 is a local development chain rather than Ethereum. Such a
   * chain answers the `finalized` and `safe` tags, but those answers carry no consensus
   * meaning. Consumers MUST NOT present these numbers as Ethereum finality.
   */
  isLocalDevnetChain: boolean;
}
