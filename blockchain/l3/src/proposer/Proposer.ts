/**
 * The KAURAX proposer.
 *
 * On an interval it snapshots KAURAX state and publishes a commitment to the underlying
 * L2's output oracle:
 *
 *   outputRoot = keccak(version, stateRoot, withdrawalTreeRoot, blockHash)
 *
 * The withdrawal tree root is read from the L3 message-passer predeploy *at the block being
 * committed to*, not at head — committing to a root the L3 had already moved past would let
 * a withdrawal be provable against a state that never existed together.
 *
 * There is no fault-proof system in v0. Nothing verifies that this root is correct beyond
 * the proposer key having signed it. That is stated in the contract, in the docs, and here.
 */
import type {KauraxConfig} from "@kaurax/config";
import {encodeFunctionData} from "viem";
import type {ExecutionEngine, Hex} from "../engine/types.js";
import type {L2SettlementAdapter} from "../settlement/L2SettlementAdapter.js";
import {messagePasserAbi} from "../settlement/abi.js";
import {hashOutputRoot, OUTPUT_ROOT_VERSION} from "../settlement/hashing.js";
import {createLogger} from "../log.js";

export interface ProposalRecord {
  outputRoot: Hex;
  l3BlockNumber: bigint;
  l3BlockHash: Hex;
  l3StateRoot: Hex;
  withdrawalTreeRoot: Hex;
  l2TxHash: Hex;
  proposedAt: number;
}

export class Proposer {
  private readonly log = createLogger("proposer");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;

  private lastProposal: ProposalRecord | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly cfg: KauraxConfig,
    private readonly engine: ExecutionEngine,
    private readonly settlement: L2SettlementAdapter,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.cfg.proposer.intervalSeconds * 1000);
    this.log.info("proposer started", {
      intervalSeconds: this.cfg.proposer.intervalSeconds,
      faultProofs: "not implemented — output roots are trusted",
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.propose();
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log.error("output proposal failed", {error: this.lastError});
    } finally {
      this.busy = false;
    }
  }

  /** Publish the next scheduled output root, if KAURAX has reached that height. */
  async propose(): Promise<ProposalRecord | null> {
    const target = await this.settlement.nextOutputBlockNumber();
    const head = await this.engine.getBlockNumber();

    if (head < target) {
      this.log.debug("not yet at the next proposal height", {
        head: head.toString(),
        target: target.toString(),
      });
      return null;
    }

    const block = await this.engine.getBlock(target);
    if (!block) throw new Error(`KAURAX has no block ${target}`);

    const withdrawalTreeRoot = await this.readWithdrawalTreeRoot(target);

    const proof = {
      version: OUTPUT_ROOT_VERSION,
      stateRoot: block.stateRoot,
      withdrawalTreeRoot,
      latestBlockHash: block.hash,
    };
    const outputRoot = hashOutputRoot(proof);

    // Pin the proposal to the L2 view it was built against, so an L2 reorg makes it fail
    // rather than land against a different history.
    const l2 = await this.settlement.getL2Block();

    const l2TxHash = await this.settlement.proposeOutput({
      outputRoot,
      l3BlockNumber: target,
      l2BlockHash: l2.hash,
      l2BlockNumber: l2.number,
    });

    const record: ProposalRecord = {
      outputRoot,
      l3BlockNumber: target,
      l3BlockHash: block.hash,
      l3StateRoot: block.stateRoot,
      withdrawalTreeRoot,
      l2TxHash,
      proposedAt: Date.now(),
    };
    this.lastProposal = record;

    this.log.info("output root proposed to L2", {
      l3Block: target.toString(),
      outputRoot,
      withdrawalTreeRoot,
      l2Tx: l2TxHash,
    });
    return record;
  }

  /** Read the message passer's tree root as of a specific L3 block. */
  private async readWithdrawalTreeRoot(blockNumber: bigint): Promise<Hex> {
    const data = encodeFunctionData({abi: messagePasserAbi, functionName: "withdrawalTreeRoot"});
    const result = await this.engine.call(this.cfg.predeploys.messagePasser, data, blockNumber);
    if (!result || result === "0x") {
      throw new Error(
        `L3ToL2MessagePasser predeploy at ${this.cfg.predeploys.messagePasser} returned no data at block ` +
          `${blockNumber}. KAURAX genesis is incomplete.`,
      );
    }
    return result;
  }

  status(): {running: boolean; lastProposal: ProposalRecord | null; lastError: string | null} {
    return {running: this.running, lastProposal: this.lastProposal, lastError: this.lastError};
  }
}
