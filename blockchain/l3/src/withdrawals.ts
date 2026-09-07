/**
 * Withdrawal proof construction.
 *
 * A user who withdrew on KAURAX needs four things to call `KauraxPortal`:
 *   1. the withdrawal transaction fields,
 *   2. the index of an output proposal that commits to a state at or after their block,
 *   3. the preimage of that proposal's output root,
 *   4. a Merkle proof that their withdrawal is in the tree that root commits to.
 *
 * All four are derived here from chain data alone — nothing is cached or asserted. If the
 * proposal that would cover the withdrawal has not been published yet, this reports that
 * plainly instead of returning a proof that cannot be used.
 */
import {decodeEventLog, encodeFunctionData} from "viem";
import type {KauraxConfig} from "@kaurax/config";
import type {ExecutionEngine, Hex} from "./engine/types.js";
import type {L2SettlementAdapter} from "./settlement/L2SettlementAdapter.js";
import {messagePasserAbi, outputOracleAbi} from "./settlement/abi.js";
import {hashOutputRoot, hashWithdrawal, OUTPUT_ROOT_VERSION} from "./settlement/hashing.js";
import {computeProof, verifyProof} from "./settlement/merkle.js";

export interface WithdrawalRecord {
  nonce: bigint;
  sender: Hex;
  target: Hex;
  value: bigint;
  gasLimit: bigint;
  data: Hex;
  withdrawalHash: Hex;
  leafIndex: number;
  l3BlockNumber: bigint;
  l3TxHash: Hex;
}

export type WithdrawalProofResult =
  | {
      status: "ready";
      withdrawal: WithdrawalRecord;
      l2OutputIndex: string;
      outputRootProof: {
        version: Hex;
        stateRoot: Hex;
        withdrawalTreeRoot: Hex;
        latestBlockHash: Hex;
      };
      withdrawalIndex: number;
      withdrawalProof: Hex[];
      /** Unix seconds after which finalization becomes possible, once proven. */
      challengeWindowSeconds: number;
    }
  | {
      status: "awaiting-proposal";
      withdrawal: WithdrawalRecord;
      /** Next L3 height the oracle expects a proposal for. */
      nextProposalAtL3Block: string;
      reason: string;
    }
  | {status: "unknown"; reason: string};

export class WithdrawalIndex {
  constructor(
    private readonly cfg: KauraxConfig,
    private readonly engine: ExecutionEngine,
    private readonly settlement: L2SettlementAdapter,
  ) {}

  /** Every withdrawal originated on or before `upToBlock`, ordered by leaf index. */
  async listWithdrawals(upToBlock: bigint): Promise<WithdrawalRecord[]> {
    const logs = await this.engine.request<
      Array<{topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex}>
    >("eth_getLogs", [
      {
        address: this.cfg.predeploys.messagePasser,
        fromBlock: "0x0",
        toBlock: `0x${upToBlock.toString(16)}`,
      },
    ]);

    const records: WithdrawalRecord[] = [];
    for (const entry of logs) {
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: messagePasserAbi,
          topics: entry.topics as [Hex, ...Hex[]],
          data: entry.data,
        });
      } catch {
        continue; // Not a MessagePassed log (the passer also emits root updates).
      }
      if (decoded.eventName !== "MessagePassed") continue;

      const a = decoded.args as unknown as {
        nonce: bigint;
        sender: Hex;
        target: Hex;
        value: bigint;
        gasLimit: bigint;
        data: Hex;
        withdrawalHash: Hex;
        leafIndex: bigint;
      };

      records.push({
        nonce: a.nonce,
        sender: a.sender.toLowerCase() as Hex,
        target: a.target.toLowerCase() as Hex,
        value: a.value,
        gasLimit: a.gasLimit,
        data: a.data,
        withdrawalHash: a.withdrawalHash,
        leafIndex: Number(a.leafIndex),
        l3BlockNumber: BigInt(entry.blockNumber),
        l3TxHash: entry.transactionHash,
      });
    }

    records.sort((x, y) => x.leafIndex - y.leafIndex);
    return records;
  }

  async buildProof(withdrawalHash: Hex): Promise<WithdrawalProofResult> {
    const head = await this.engine.getBlockNumber();
    const all = await this.listWithdrawals(head);
    const target = all.find((w) => w.withdrawalHash.toLowerCase() === withdrawalHash.toLowerCase());

    if (!target) {
      return {
        status: "unknown",
        reason: `No withdrawal with hash ${withdrawalHash} was found on KAURAX up to block ${head}.`,
      };
    }

    // Which published proposal covers this withdrawal's block?
    let outputIndex: bigint;
    try {
      outputIndex = await this.settlement.publicClient.readContract({
        address: this.cfg.contracts.outputOracle!,
        abi: outputOracleAbi,
        functionName: "getL2OutputIndexAfter",
        args: [target.l3BlockNumber],
      });
    } catch {
      const next = await this.settlement.nextOutputBlockNumber();
      return {
        status: "awaiting-proposal",
        withdrawal: target,
        nextProposalAtL3Block: next.toString(),
        reason:
          `No output root covering KAURAX block ${target.l3BlockNumber} has been published to ` +
          `${this.settlement.l2Name} yet. The proposer publishes next at L3 block ${next}.`,
      };
    }

    const proposal = await this.settlement.publicClient.readContract({
      address: this.cfg.contracts.outputOracle!,
      abi: outputOracleAbi,
      functionName: "getL2Output",
      args: [outputIndex],
    });

    const committedBlock = BigInt(proposal.l3BlockNumber);

    // Rebuild the exact preimage of that proposal.
    const block = await this.engine.getBlock(committedBlock);
    if (!block) {
      return {status: "unknown", reason: `KAURAX block ${committedBlock} is not available from this node.`};
    }

    const treeRoot = await this.engine.call(
      this.cfg.predeploys.messagePasser,
      encodeFunctionData({abi: messagePasserAbi, functionName: "withdrawalTreeRoot"}),
      committedBlock,
    );

    const outputRootProof = {
      version: OUTPUT_ROOT_VERSION,
      stateRoot: block.stateRoot,
      withdrawalTreeRoot: treeRoot,
      latestBlockHash: block.hash,
    };

    const recomputed = hashOutputRoot(outputRootProof);
    if (recomputed.toLowerCase() !== (proposal.outputRoot as string).toLowerCase()) {
      return {
        status: "unknown",
        reason:
          `The published output root at index ${outputIndex} does not match this node's view of ` +
          `KAURAX block ${committedBlock}. Refusing to emit a proof that would not verify.`,
      };
    }

    // Leaves as they stood at the committed block.
    const leaves = all
      .filter((w) => w.l3BlockNumber <= committedBlock)
      .sort((x, y) => x.leafIndex - y.leafIndex)
      .map((w) => w.withdrawalHash);

    const proof = computeProof(leaves, target.leafIndex);

    if (!verifyProof(treeRoot, target.withdrawalHash, target.leafIndex, proof)) {
      return {
        status: "unknown",
        reason: "Locally constructed proof did not verify against the committed tree root.",
      };
    }

    // Sanity: the hash the caller asked for must be the hash of the fields being returned.
    const rehashed = hashWithdrawal({
      nonce: target.nonce,
      sender: target.sender,
      target: target.target,
      value: target.value,
      gasLimit: target.gasLimit,
      data: target.data,
    });
    if (rehashed.toLowerCase() !== target.withdrawalHash.toLowerCase()) {
      return {status: "unknown", reason: "Withdrawal fields do not rehash to the recorded hash."};
    }

    return {
      status: "ready",
      withdrawal: target,
      l2OutputIndex: outputIndex.toString(),
      outputRootProof,
      withdrawalIndex: target.leafIndex,
      withdrawalProof: proof,
      challengeWindowSeconds: this.cfg.bridge.challengeWindowSeconds,
    };
  }
}
