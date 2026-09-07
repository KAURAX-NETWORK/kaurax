/**
 * KauraxNode — assembles the KAURAX Layer-3.
 *
 *   Ethereum (L1)
 *        ▲   settlement + DA for the L2
 *   underlying rollup (L2) ──── KauraxPortal / KauraxL2OutputOracle / KauraxBatchInbox
 *        ▲   batches + output roots        ▲ deposits
 *   KAURAX (L3) ── sequencer ── execution engine ── RPC
 *
 * Startup order matters: verify the settlement target before producing a single block, so
 * a misconfigured chain ID or a missing contract fails immediately rather than after the
 * chain has advanced.
 */
import {formatEther} from "viem";
import {loadConfig, networkDescriptor, type KauraxConfig} from "@kaurax/config";
import {AnvilEngine} from "./engine/AnvilEngine.js";
import type {ExecutionEngine, Hex} from "./engine/types.js";
import {Sequencer} from "./sequencer/Sequencer.js";
import {Derivation} from "./derivation/Derivation.js";
import {Batcher} from "./batcher/Batcher.js";
import {Proposer} from "./proposer/Proposer.js";
import {L2SettlementAdapter} from "./settlement/L2SettlementAdapter.js";
import {CalldataDA, UnimplementedDA} from "./da/calldata.js";
import type {DataAvailabilityInterface} from "./settlement/types.js";
import {RpcServer, type KauraxRpcHandlers} from "./rpc/server.js";
import {WithdrawalIndex} from "./withdrawals.js";
import {ForcedInclusion} from "./forced.js";
import {MetricsServer} from "./metrics.js";
import {createLogger, setLogLevel} from "./log.js";

export * from "./engine/types.js";
export * from "./settlement/types.js";
export {hashOutputRoot, hashWithdrawal, OUTPUT_ROOT_VERSION} from "./settlement/hashing.js";
export {computeProof, computeRoot, verifyProof, TREE_DEPTH} from "./settlement/merkle.js";
export {encodeBatch, decodeBatch, BATCH_FORMAT_VERSION} from "./batcher/encoding.js";

export class KauraxNode {
  private readonly log = createLogger("node");

  readonly cfg: KauraxConfig;
  readonly engine: ExecutionEngine;
  readonly settlement: L2SettlementAdapter;
  readonly da: DataAvailabilityInterface;
  readonly derivation: Derivation;
  readonly sequencer: Sequencer;
  readonly batcher: Batcher;
  readonly proposer: Proposer;
  readonly withdrawals: WithdrawalIndex;
  readonly forced: ForcedInclusion;

  private rpc: RpcServer | null = null;
  private metrics: MetricsServer | null = null;
  private startedAt = 0;

  constructor(cfg?: KauraxConfig) {
    this.cfg = cfg ?? loadConfig();
    setLogLevel(this.cfg.logLevel);

    this.engine = new AnvilEngine(this.cfg.l3.engineRpcUrl);
    this.settlement = new L2SettlementAdapter(this.cfg);
    this.da =
      this.cfg.da.mode === "calldata" ? new CalldataDA(this.settlement) : new UnimplementedDA(this.cfg.da.mode);

    this.derivation = new Derivation(this.cfg, this.settlement);
    this.sequencer = new Sequencer(this.cfg, this.engine, this.derivation, () => this.settlement.batcherAddress);
    this.batcher = new Batcher(this.cfg, this.engine, this.da, this.settlement, this.sequencer);
    this.proposer = new Proposer(this.cfg, this.engine, this.settlement);
    this.withdrawals = new WithdrawalIndex(this.cfg, this.engine, this.settlement);
    this.forced = new ForcedInclusion(this.cfg, this.settlement, this.derivation, this.engine);
  }

  async start(): Promise<void> {
    this.startedAt = Date.now();

    this.log.info("starting KAURAX L3 node", {
      profile: this.cfg.profile,
      l3ChainId: this.cfg.l3.chainId,
      settlesTo: `${this.cfg.l2.name} (chainId ${this.cfg.l2.chainId})`,
      localDevSettlement: this.cfg.localDevSettlement,
    });

    // 1. Execution engine.
    await this.engine.start();
    const engineChainId = await this.engine.chainId();
    if (engineChainId !== this.cfg.l3.chainId) {
      throw new Error(
        `Execution engine reports chain ID ${engineChainId} but KAURAX is configured as ` +
          `${this.cfg.l3.chainId}. Refusing to start: signed transactions would be replayable.`,
      );
    }

    // 2. Operator identities. Resolved before anything that might need to sign, so a
    //    missing key or an unreachable signing service stops startup rather than a batch.
    await this.settlement.connectSigners();

    // 3. Settlement target. Verified before any block is produced.
    await this.settlement.verify();
    await this.assertPredeploys();

    // 4. Deposit derivation, so the first block can already carry deposits.
    await this.derivation.init(this.cfg.derivationFromL2Block);
    this.derivation.start();

    // 5. Sequencing.
    await this.sequencer.start();

    // 6. Forced-inclusion acknowledgement. Started right after sequencing, because while
    // an overdue forced transaction goes unacknowledged the output oracle rejects every
    // proposal — a correctly behaving sequencer must not halt its own settlement.
    await this.forced.init();
    this.forced.start();

    // 7. Batching and proposing.
    await this.batcher.init();
    this.batcher.start();
    this.proposer.start();

    // 8. Public interfaces.
    this.rpc = new RpcServer({
      cfg: this.cfg,
      engine: this.engine,
      submitTransaction: (raw) => this.sequencer.submitTransaction(raw),
      kauraxMethods: this.rpcMethods(),
    });
    await this.rpc.listen();

    if (this.cfg.metrics.enabled) {
      this.metrics = new MetricsServer(this.cfg.metrics.port, () => this.metricSeries());
      await this.metrics.listen();
    }

    this.log.info("KAURAX is live", {
      rpc: this.cfg.l3.rpcUrl,
      ws: this.cfg.l3.wsUrl,
      chainId: this.cfg.l3.chainId,
      currency: this.cfg.l3.nativeCurrency.symbol,
    });
  }

  async stop(): Promise<void> {
    this.log.info("stopping KAURAX node");
    this.sequencer.stop();
    this.forced.stop();
    this.batcher.stop();
    this.proposer.stop();
    this.derivation.stop();
    await this.rpc?.close();
    await this.metrics?.close();
    await this.engine.stop();
  }

  /** The withdrawal predeploy must exist, or withdrawals silently cannot be proven. */
  private async assertPredeploys(): Promise<void> {
    const code = await this.engine.request<Hex>("eth_getCode", [this.cfg.predeploys.messagePasser, "latest"]);
    if (!code || code === "0x") {
      throw new Error(
        `L3ToL2MessagePasser is not deployed at ${this.cfg.predeploys.messagePasser}. ` +
          `KAURAX genesis is incomplete; run infra/scripts/devnet/start.sh, which installs the predeploys.`,
      );
    }
    this.log.info("predeploys verified", {messagePasser: this.cfg.predeploys.messagePasser});
  }

  // ------------------------------------------------------- kaurax_* RPC //

  private rpcMethods(): KauraxRpcHandlers {
    return {
      kaurax_networkStatus: async () => this.networkStatus(),
      kaurax_sequencerStatus: async () => serialize(this.sequencer.status()),
      kaurax_batcherStatus: async () => serialize(this.batcher.status()),
      kaurax_proposerStatus: async () => serialize(this.proposer.status()),
      kaurax_derivationStatus: async () => serialize(this.derivation.status()),
      kaurax_forcedInclusionStatus: async () => this.forcedInclusionStatus(),
      kaurax_settlementStatus: async () => this.settlementStatus(),
      kaurax_networkDescriptor: async () => networkDescriptor(this.cfg),
      kaurax_withdrawalProof: async (params) => {
        const hash = params[0];
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new Error("kaurax_withdrawalProof expects a 32-byte withdrawal hash");
        }
        return serialize(await this.withdrawals.buildProof(hash as Hex));
      },
      kaurax_listWithdrawals: async () => {
        const head = await this.engine.getBlockNumber();
        return serialize(await this.withdrawals.listWithdrawals(head));
      },
    };
  }

  /**
   * The full three-layer picture, as the explorer and dashboard render it.
   * Unknown values are `null`, never a placeholder.
   */
  async networkStatus(): Promise<unknown> {
    const [head, gasPrice, l2, l1, latestOutput, batchCount, lastBatchBlock] = await Promise.all([
      this.engine.getBlockNumber(),
      this.engine.request<Hex>("eth_gasPrice", []).catch(() => null),
      this.settlement.getL2Block().catch(() => null),
      this.settlement.getL1Finality(),
      this.settlement.latestOutput().catch(() => null),
      this.settlement.batchCount().catch(() => null),
      this.settlement.lastBatchL3Block().catch(() => null),
    ]);

    const block = await this.engine.getBlock(head);
    const batcher = this.batcher.status();
    const seq = this.sequencer.status();

    return serialize({
      network: {
        name: this.cfg.profile === "devnet" ? "KAURAX Devnet" : "KAURAX Testnet",
        layer: 3,
        profile: this.cfg.profile,
        uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      },
      l3: {
        chainId: this.cfg.l3.chainId,
        blockNumber: head,
        blockHash: block?.hash ?? null,
        stateRoot: block?.stateRoot ?? null,
        timestamp: block?.timestamp ?? null,
        blockTimeSeconds: this.cfg.l3.blockTimeSeconds,
        gasLimit: this.cfg.l3.gasLimit,
        gasPrice,
        baseFeePerGas: block?.baseFeePerGas ?? null,
        nativeCurrency: this.cfg.l3.nativeCurrency,
        mempoolSize: seq.mempoolSize,
      },
      l2: l2
        ? {
            chainId: this.cfg.l2.chainId,
            name: this.cfg.l2.name,
            blockNumber: l2.number,
            blockHash: l2.hash,
            timestamp: l2.timestamp,
            isLocalDevnet: this.cfg.localDevSettlement,
          }
        : null,
      // null when the configured L1 cannot answer, e.g. a local chain with no consensus
      // layer. The UI must render this as "No data available".
      l1: l1,
      settlement: {
        lastBatch:
          batcher.lastSubmission === null
            ? null
            : {
                batchIndex: batcher.lastSubmission.batchIndex,
                l3StartBlock: batcher.lastSubmission.l3StartBlock,
                l3EndBlock: batcher.lastSubmission.l3EndBlock,
                l2TxHash: batcher.lastSubmission.commitment.txHash,
                l2BlockNumber: batcher.lastSubmission.commitment.blockNumber,
                compressedBytes: batcher.lastSubmission.compressedBytes,
                uncompressedBytes: batcher.lastSubmission.uncompressedBytes,
              },
        batchCountOnL2: batchCount,
        lastBatchedL3Block: lastBatchBlock,
        unbatchedL3Blocks: batcher.pendingL3Blocks,
        latestOutputRoot: latestOutput,
        faultProofs: {implemented: false, status: "not-implemented"},
        forcedInclusion: {
          implemented: true,
          pending: this.forced.status().pending,
          overdue: this.forced.status().overdue,
          note: "An overdue forced transaction blocks output proposals on the L2.",
        },
        dataAvailability: {mode: this.cfg.da.mode, target: "underlying-l2"},
      },
      sequencer: {
        mode: seq.mode,
        decentralized: false,
        healthy: seq.running && seq.lastError === null,
        headBlock: seq.headBlock,
        lastBlockAt: seq.lastBlockAt,
        lastError: seq.lastError,
      },
    });
  }

  /**
   * Forced-inclusion state, from both sides: what this node has seen and acknowledged, and
   * what the portal itself reports. A disagreement between the two is worth noticing.
   */
  async forcedInclusionStatus(): Promise<unknown> {
    const local = this.forced.status();
    const onChain = await this.settlement.forcedInclusionState();
    const l2Head = await this.settlement
      .getL2Block()
      .then((b) => b.number)
      .catch(() => null);

    return serialize({
      node: local,
      portal: onChain,
      l2Head,
      blocksUntilOverdue:
        onChain && onChain.oldestDeadline > 0n && l2Head !== null
          ? Number(onChain.oldestDeadline - l2Head)
          : null,
      note:
        "An overdue forced transaction blocks all output proposals. Acknowledgement is the " +
        "sequencer's own assertion of inclusion; it is detectable but not provable on chain.",
    });
  }

  async settlementStatus(): Promise<unknown> {
    const [l2, finalization, latestOutput, nextOutputBlock, batchCount] = await Promise.all([
      this.settlement.getL2Block().catch(() => null),
      this.settlement.finalizationPeriodSeconds().catch(() => null),
      this.settlement.latestOutput().catch(() => null),
      this.settlement.nextOutputBlockNumber().catch(() => null),
      this.settlement.batchCount().catch(() => null),
    ]);

    return serialize({
      l2: {
        chainId: this.cfg.l2.chainId,
        name: this.cfg.l2.name,
        rpcConfigured: Boolean(this.cfg.l2.rpcUrl),
        head: l2,
        isLocalDevnet: this.cfg.localDevSettlement,
      },
      contracts: this.cfg.contracts,
      predeploys: this.cfg.predeploys,
      outputOracle: {
        latestOutput,
        nextProposalAtL3Block: nextOutputBlock,
        finalizationPeriodSeconds: finalization,
        faultProofs: {implemented: false},
      },
      batchInbox: {batchCount, daMode: this.cfg.da.mode},
      // Where each operator key lives. Addresses are public; nothing here reveals key
      // material, and `mode` lets an observer see whether this node holds raw keys.
      signers: {mode: this.cfg.signer.mode, roles: this.settlement.signerStatus()},
      escrow: null,
    });
  }

  private async metricSeries(): Promise<Array<{name: string; help: string; type: string; value: number}>> {
    const seq = this.sequencer.status();
    const batch = this.batcher.status();
    const derivation = this.derivation.status();
    const forced = this.forced.status();
    const rpcStats = this.rpc?.stats() ?? {requests: 0, errors: 0};

    const series = [
      {name: "kaurax_l3_block_height", help: "KAURAX L3 head block", type: "gauge", value: Number(seq.headBlock)},
      {name: "kaurax_mempool_size", help: "Transactions queued in the sequencer", type: "gauge", value: seq.mempoolSize},
      {name: "kaurax_blocks_produced_total", help: "L3 blocks produced since start", type: "counter", value: seq.producedBlocks},
      {name: "kaurax_transactions_included_total", help: "User transactions sequenced", type: "counter", value: seq.includedTransactions},
      {name: "kaurax_deposits_applied_total", help: "Deposits derived from the L2 and applied", type: "counter", value: seq.appliedDeposits},
      {name: "kaurax_sequencer_healthy", help: "1 when the sequencer is producing without error", type: "gauge", value: seq.running && seq.lastError === null ? 1 : 0},
      {name: "kaurax_batcher_healthy", help: "1 when the batcher last submitted without error", type: "gauge", value: batch.running && batch.lastError === null ? 1 : 0},
      {name: "kaurax_unbatched_l3_blocks", help: "L3 blocks not yet published to the L2", type: "gauge", value: batch.pendingL3Blocks},
      {name: "kaurax_derivation_queued", help: "Deposits derived but not yet included", type: "gauge", value: derivation.queued},
      {name: "kaurax_rpc_requests_total", help: "JSON-RPC requests served", type: "counter", value: rpcStats.requests},
      {name: "kaurax_rpc_errors_total", help: "JSON-RPC requests answered with an error", type: "counter", value: rpcStats.errors},
      {name: "kaurax_wal_pending_blocks", help: "Sealed blocks durably logged but not yet confirmed on the L2", type: "gauge", value: seq.walPendingBlocks},
      {name: "kaurax_forced_pending", help: "Forced transactions seen but not yet acknowledged", type: "gauge", value: forced.pending},
      {name: "kaurax_forced_overdue", help: "1 when a forced transaction is overdue and output proposals are blocked", type: "gauge", value: forced.overdue ? 1 : 0},
    ];

    if (batch.lastSubmission) {
      series.push({
        name: "kaurax_last_batch_age_seconds",
        help: "Seconds since the last batch reached the L2",
        type: "gauge",
        value: Math.floor((Date.now() - batch.lastSubmission.submittedAt) / 1000),
      });
      series.push({
        name: "kaurax_last_batch_compressed_bytes",
        help: "Compressed size of the last batch",
        type: "gauge",
        value: batch.lastSubmission.compressedBytes,
      });
    }

    // L2 head, when reachable. Omitted rather than zeroed when it is not.
    const l2 = await this.settlement.getL2Block().catch(() => null);
    if (l2) {
      series.push({
        name: "kaurax_l2_block_height",
        help: "Head block of the underlying L2",
        type: "gauge",
        value: Number(l2.number),
      });
    }

    const l1 = await this.settlement.getL1Finality();
    if (l1) {
      series.push({
        name: "kaurax_l1_block_height",
        help: "Head block of Ethereum",
        type: "gauge",
        value: Number(l1.latestBlockNumber),
      });
      series.push({
        name: "kaurax_l1_finalized_block",
        help: "Finalized Ethereum block beneath the L2",
        type: "gauge",
        value: Number(l1.finalizedBlockNumber),
      });
    }

    return series;
  }
}

/** JSON-safe rendering: bigints become decimal strings rather than throwing. */
function serialize<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as unknown;
}

export {formatEther};
