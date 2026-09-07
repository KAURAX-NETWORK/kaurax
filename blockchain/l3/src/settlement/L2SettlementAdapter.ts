/**
 * L2SettlementAdapter — KAURAX's connection to the underlying rollup.
 *
 * Every method performs a real transaction or a real read against real contracts. There is
 * no simulated mode: if the contracts are not deployed, construction fails loudly rather
 * than returning plausible-looking values.
 *
 * `LOCAL_DEV_SETTLEMENT=true` changes *which chain* the contracts live on (a local L2
 * instead of a public one). It does not change what any of this code does.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toHex,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import type {KauraxConfig} from "@kaurax/config";
import type {Hex} from "../engine/types.js";
import {batchInboxAbi, outputOracleAbi, portalAbi} from "./abi.js";
import {createSigners} from "../signer/index.js";
import type {KauraxSigner, SignerRole} from "../signer/index.js";
import type {BatchStatus, DaCommitment, L1Finality, SettlementInterface} from "./types.js";
import {createLogger} from "../log.js";

export class SettlementNotDeployedError extends Error {
  constructor(what: string) {
    super(
      `${what} address is not configured. Deploy the settlement contracts to the L2 first ` +
        `(infra/scripts/deployment/deploy-settlement.sh) and set the address in .env.`,
    );
    this.name = "SettlementNotDeployedError";
  }
}

export class L2SettlementAdapter implements SettlementInterface {
  readonly l2ChainId: number;
  readonly l2Name: string;

  private readonly log = createLogger("settlement");
  private readonly l2: PublicClient;
  private readonly l1: PublicClient | null;
  // Wallets are built once the signers connect, which for a remote signer means a network
  // round trip. Until then the node has no signing capability and says so.
  private batcherWallet: WalletClient | null = null;
  private proposerWallet: WalletClient | null = null;
  private sequencerWallet: WalletClient | null = null;
  private batcherAccount: Account | null = null;
  private proposerAccount: Account | null = null;
  private sequencerAccount: Account | null = null;
  private signers: Record<SignerRole, KauraxSigner | null> = {sequencer: null, batcher: null, proposer: null};
  private readonly l2Chain: ReturnType<typeof defineChain>;

  private readonly batchInbox: Hex;
  private readonly outputOracle: Hex;

  constructor(private readonly cfg: KauraxConfig) {
    this.l2ChainId = cfg.l2.chainId;
    this.l2Name = cfg.l2.name;

    if (!cfg.contracts.batchInbox) throw new SettlementNotDeployedError("KAURAX_BATCH_INBOX_ADDRESS");
    if (!cfg.contracts.outputOracle) throw new SettlementNotDeployedError("KAURAX_OUTPUT_ORACLE_ADDRESS");
    this.batchInbox = cfg.contracts.batchInbox;
    this.outputOracle = cfg.contracts.outputOracle;

    const l2Chain = defineChain({
      id: cfg.l2.chainId,
      name: cfg.l2.name,
      nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
      rpcUrls: {default: {http: [cfg.l2.rpcUrl]}},
    });

    this.l2 = createPublicClient({chain: l2Chain, transport: http(cfg.l2.rpcUrl)});

    this.l1 = cfg.l1.rpcUrl
      ? createPublicClient({
          chain: defineChain({
            id: cfg.l1.chainId,
            name: "l1",
            nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
            rpcUrls: {default: {http: [cfg.l1.rpcUrl]}},
          }),
          transport: http(cfg.l1.rpcUrl),
        })
      : null;

    this.l2Chain = l2Chain;
  }

  /**
   * Resolves every operator identity through the signer abstraction.
   *
   * In `local` mode this derives addresses from keys in the environment. In `remote` mode
   * it contacts the signing service, which is why it is async and why it runs before
   * `verify()` — a node that cannot sign should discover that at startup, not when the
   * first batch is due.
   */
  async connectSigners(): Promise<void> {
    this.signers = await createSigners(this.cfg);

    const wallet = (signer: KauraxSigner | null): WalletClient | null =>
      signer
        ? createWalletClient({account: signer.account, chain: this.l2Chain, transport: http(this.cfg.l2.rpcUrl)})
        : null;

    this.batcherAccount = this.signers.batcher?.account ?? null;
    this.proposerAccount = this.signers.proposer?.account ?? null;
    this.sequencerAccount = this.signers.sequencer?.account ?? null;

    this.batcherWallet = wallet(this.signers.batcher);
    this.proposerWallet = wallet(this.signers.proposer);
    // The sequencer signs forced-transaction acknowledgements on the L2.
    this.sequencerWallet = wallet(this.signers.sequencer);

    for (const role of ["sequencer", "batcher", "proposer"] as const) {
      const signer = this.signers[role];
      this.log.info(`${role} signer`, {source: signer ? signer.describe() : "not configured"});
    }
  }

  /** Provenance of each operator key, for status endpoints. Never includes key material. */
  signerStatus(): Record<SignerRole, {kind: string; address: Hex} | null> {
    const describe = (s: KauraxSigner | null) => (s ? {kind: s.kind, address: s.address as Hex} : null);
    return {
      sequencer: describe(this.signers.sequencer),
      batcher: describe(this.signers.batcher),
      proposer: describe(this.signers.proposer),
    };
  }

  get batcherAddress(): Hex | null {
    return (this.batcherAccount?.address ?? null) as Hex | null;
  }

  get proposerAddress(): Hex | null {
    return (this.proposerAccount?.address ?? null) as Hex | null;
  }

  /** Fail fast at startup if the settlement target is not what the config claims. */
  async verify(): Promise<void> {
    const chainId = await this.l2.getChainId();
    if (chainId !== this.cfg.l2.chainId) {
      throw new Error(
        `L2 chain ID mismatch: configured ${this.cfg.l2.chainId}, endpoint ${this.cfg.l2.rpcUrl} reports ${chainId}`,
      );
    }
    for (const [name, address] of [
      ["batch inbox", this.batchInbox],
      ["output oracle", this.outputOracle],
    ] as const) {
      const code = await this.l2.getCode({address});
      if (!code || code === "0x") {
        throw new Error(`No contract deployed at the configured ${name} address ${address} on ${this.l2Name}`);
      }
    }
    this.log.info("settlement target verified", {
      l2: this.l2Name,
      chainId,
      batchInbox: this.batchInbox,
      outputOracle: this.outputOracle,
      localDev: this.cfg.localDevSettlement,
    });
  }

  async submitBatch(l3StartBlock: bigint, l3EndBlock: bigint, data: Uint8Array): Promise<DaCommitment> {
    if (!this.batcherWallet || !this.batcherAccount) {
      throw new Error("Batcher key is not configured; the batcher cannot submit.");
    }

    const hex = toHex(data);
    const txHash = await this.batcherWallet.writeContract({
      account: this.batcherAccount,
      chain: this.batcherWallet.chain,
      address: this.batchInbox,
      abi: batchInboxAbi,
      functionName: "submitBatch",
      args: [l3StartBlock, l3EndBlock, hex],
    });

    const receipt = await this.l2.waitForTransactionReceipt({hash: txHash});
    if (receipt.status !== "success") {
      throw new Error(`Batch submission reverted on ${this.l2Name} (tx ${txHash})`);
    }

    return {
      hash: keccak256(hex),
      txHash: txHash as Hex,
      blockNumber: receipt.blockNumber,
      byteLength: data.length,
    };
  }

  async getBatchStatus(txHash: Hex): Promise<BatchStatus> {
    try {
      const receipt = await this.l2.getTransactionReceipt({hash: txHash});
      const head = await this.l2.getBlockNumber();
      return {
        txHash,
        included: true,
        l2BlockNumber: receipt.blockNumber,
        confirmations: head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n,
        reverted: receipt.status !== "success",
      };
    } catch {
      // Not yet mined, or unknown to this endpoint. Report that, do not guess.
      return {txHash, included: false, l2BlockNumber: null, confirmations: null, reverted: null};
    }
  }

  async getL2Block(): Promise<{number: bigint; hash: Hex; timestamp: bigint}> {
    const block = await this.l2.getBlock({blockTag: "latest"});
    return {number: block.number!, hash: block.hash! as Hex, timestamp: block.timestamp};
  }

  /**
   * Ethereum finality beneath the L2.
   *
   * Returns `null` rather than a fabricated value when the L1 endpoint is absent or does
   * not implement the finalized/safe tags — which is the case for a local devnet chain
   * that has no consensus layer. Callers surface that as "No data available".
   */
  async getL1Finality(): Promise<L1Finality | null> {
    if (!this.l1) return null;
    try {
      const [latest, safe, finalized, chainId] = await Promise.all([
        this.l1.getBlock({blockTag: "latest"}),
        this.l1.getBlock({blockTag: "safe"}).catch(() => null),
        this.l1.getBlock({blockTag: "finalized"}).catch(() => null),
        this.l1.getChainId(),
      ]);
      if (!safe || !finalized) return null;
      return {
        latestBlockNumber: latest.number!,
        safeBlockNumber: safe.number!,
        finalizedBlockNumber: finalized.number!,
        chainId,
        isLocalDevnetChain: this.cfg.localDevSettlement,
      };
    } catch {
      return null;
    }
  }

  async proposeOutput(args: {
    outputRoot: Hex;
    l3BlockNumber: bigint;
    l2BlockHash: Hex;
    l2BlockNumber: bigint;
  }): Promise<Hex> {
    if (!this.proposerWallet || !this.proposerAccount) {
      throw new Error("Proposer key is not configured; the proposer cannot submit.");
    }

    const txHash = await this.proposerWallet.writeContract({
      account: this.proposerAccount,
      chain: this.proposerWallet.chain,
      address: this.outputOracle,
      abi: outputOracleAbi,
      functionName: "proposeL2Output",
      args: [args.outputRoot, args.l3BlockNumber, args.l2BlockHash, args.l2BlockNumber],
    });

    const receipt = await this.l2.waitForTransactionReceipt({hash: txHash});
    if (receipt.status !== "success") {
      throw new Error(`Output proposal reverted on ${this.l2Name} (tx ${txHash})`);
    }
    return txHash as Hex;
  }

  /**
   * Tell the portal which forced transactions have been included, up to `throughId`.
   *
   * Signed with the sequencer key, because the portal only accepts this from the sequencer
   * — anyone else clearing the backlog would dissolve the guarantee.
   */
  async acknowledgeForced(throughId: bigint, l3BlockNumber: bigint): Promise<Hex> {
    if (!this.sequencerWallet || !this.sequencerAccount) {
      throw new Error(
        "Sequencer key is not configured; forced transactions cannot be acknowledged and " +
          "output proposals will be blocked once one is overdue.",
      );
    }
    if (!this.cfg.contracts.portal) throw new SettlementNotDeployedError("KAURAX_PORTAL_ADDRESS");

    const txHash = await this.sequencerWallet.writeContract({
      account: this.sequencerAccount,
      chain: this.sequencerWallet.chain,
      address: this.cfg.contracts.portal,
      abi: portalAbi,
      functionName: "acknowledgeForcedTransactions",
      args: [throughId, l3BlockNumber],
    });

    const receipt = await this.l2.waitForTransactionReceipt({hash: txHash});
    if (receipt.status !== "success") {
      throw new Error(`Forced-transaction acknowledgement reverted on ${this.l2Name} (tx ${txHash})`);
    }
    return txHash as Hex;
  }

  /** Forced-inclusion state as the portal reports it. */
  async forcedInclusionState(): Promise<{pending: bigint; oldestDeadline: bigint; overdue: boolean} | null> {
    if (!this.cfg.contracts.portal) return null;
    try {
      const [pending, oldestDeadline, overdue] = await Promise.all([
        this.l2.readContract({address: this.cfg.contracts.portal, abi: portalAbi, functionName: "pendingForcedCount"}),
        this.l2.readContract({address: this.cfg.contracts.portal, abi: portalAbi, functionName: "oldestForcedDeadline"}),
        this.l2.readContract({
          address: this.cfg.contracts.portal,
          abi: portalAbi,
          functionName: "hasOverdueForcedTransactions",
        }),
      ]);
      return {pending: pending as bigint, oldestDeadline: oldestDeadline as bigint, overdue: overdue as boolean};
    } catch {
      return null;
    }
  }

  /**
   * The L2 block at which the oldest unacknowledged forced transaction was submitted.
   * Returns null when there is none. Used when derivation has lost its checkpoint and
   * needs to know how far back a user's forced transaction is waiting.
   */
  async oldestPendingForcedSubmission(): Promise<bigint | null> {
    if (!this.cfg.contracts.portal) return null;
    const portal = this.cfg.contracts.portal;
    const cursor = (await this.l2.readContract({
      address: portal,
      abi: portalAbi,
      functionName: "forcedCursor",
    })) as bigint;
    const total = (await this.l2.readContract({
      address: portal,
      abi: portalAbi,
      functionName: "forcedTransactionCount",
    })) as bigint;
    if (cursor >= total) return null;

    const forced = (await this.l2.readContract({
      address: portal,
      abi: portalAbi,
      functionName: "getForcedTransaction",
      args: [cursor],
    })) as {submittedAtL2Block: bigint};
    return BigInt(forced.submittedAtL2Block);
  }

  async nextOutputBlockNumber(): Promise<bigint> {
    return this.l2.readContract({
      address: this.outputOracle,
      abi: outputOracleAbi,
      functionName: "nextBlockNumber",
    });
  }

  async latestOutput(): Promise<
    {index: bigint; outputRoot: Hex; timestamp: bigint; l3BlockNumber: bigint} | null
  > {
    const count = await this.l2.readContract({
      address: this.outputOracle,
      abi: outputOracleAbi,
      functionName: "outputCount",
    });
    if (count === 0n) return null;

    const index = count - 1n;
    const out = await this.l2.readContract({
      address: this.outputOracle,
      abi: outputOracleAbi,
      functionName: "getL2Output",
      args: [index],
    });
    return {
      index,
      outputRoot: out.outputRoot as Hex,
      timestamp: BigInt(out.timestamp),
      l3BlockNumber: BigInt(out.l3BlockNumber),
    };
  }

  async finalizationPeriodSeconds(): Promise<bigint> {
    return this.l2.readContract({
      address: this.outputOracle,
      abi: outputOracleAbi,
      functionName: "finalizationPeriodSeconds",
    });
  }

  async lastBatchL3Block(): Promise<bigint> {
    return this.l2.readContract({
      address: this.batchInbox,
      abi: batchInboxAbi,
      functionName: "lastBatchL3Block",
    });
  }

  async batchCount(): Promise<bigint> {
    return this.l2.readContract({
      address: this.batchInbox,
      abi: batchInboxAbi,
      functionName: "batchCount",
    });
  }

  /** Escape hatch for components that need arbitrary reads of the L2. */
  get publicClient(): PublicClient {
    return this.l2;
  }
}
