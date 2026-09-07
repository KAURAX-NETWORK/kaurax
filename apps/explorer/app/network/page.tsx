import {getNetworkStatus, getSettlementStatus, getBatcherStatus} from "@/lib/rpc";
import {bytes, gwei, hexToBigInt, isoTime, timeAgo} from "@/lib/format";
import {Badge, Empty, Notice, Row, StackDiagram, Stat} from "@/components/ui";
import {config, NO_DATA} from "@/lib/config";

export const dynamic = "force-dynamic";

interface SettlementShape {
  l2?: {chainId: number; name: string; isLocalDevnet: boolean; head: {number: string; hash: string} | null};
  contracts?: Record<string, string | null>;
  predeploys?: Record<string, string>;
  outputOracle?: {
    latestOutput: {index: string; outputRoot: string; timestamp: string; l3BlockNumber: string} | null;
    nextProposalAtL3Block: string | null;
    finalizationPeriodSeconds: string | null;
    faultProofs: {implemented: boolean};
  };
  batchInbox?: {batchCount: string | null; daMode: string};
}

export default async function NetworkPage() {
  const [status, settlementRaw, batcher] = await Promise.all([
    getNetworkStatus(),
    getSettlementStatus(),
    getBatcherStatus(),
  ]);

  if (!status) {
    return <div className="container section"><Empty>KAURAX RPC is not reachable.</Empty></div>;
  }

  const settlement = (settlementRaw ?? {}) as SettlementShape;
  const lastSubmission = batcher?.lastSubmission as
    | {l3StartBlock: string; l3EndBlock: string; compressedBytes: number; uncompressedBytes: number; commitment: {txHash: string; blockNumber: string | null}; submittedAt: number}
    | null
    | undefined;

  return (
    <div className="container section">
      <div className="section-head"><h2>Network</h2></div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Layer status</h2>
          <StackDiagram
            l1={
              status.l1
                ? {
                    name: status.l1.isLocalDevnetChain ? "Local devnet chain (Ethereum stand-in)" : "Ethereum",
                    chainId: status.l1.chainId,
                    head: status.l1.latestBlockNumber,
                  }
                : null
            }
            l2={status.l2 ? {name: status.l2.name, chainId: status.l2.chainId, head: status.l2.blockNumber} : null}
            l3={{name: status.network.name, chainId: status.l3.chainId, head: status.l3.blockNumber}}
          />
          <div style={{marginTop: 16}}>
            {status.l1?.isLocalDevnetChain ? (
              <Notice>
                The Layer-1 in this deployment is a <strong>local development chain</strong>, not Ethereum. It
                has no consensus layer, so its <code>finalized</code> and <code>safe</code> heights carry no
                meaning and are not presented as Ethereum finality.
              </Notice>
            ) : status.l1 ? (
              <div className="card" style={{background: "var(--bg-inset)"}}>
                <dl className="kv">
                  <Row label="Ethereum head">{status.l1.latestBlockNumber}</Row>
                  <Row label="Safe">{status.l1.safeBlockNumber}</Row>
                  <Row label="Finalized">{status.l1.finalizedBlockNumber}</Row>
                </dl>
              </div>
            ) : (
              <Notice>Ethereum finality is {NO_DATA.toLowerCase()} — no L1 endpoint answered.</Notice>
            )}
          </div>
        </div>

        <div className="card">
          <h2>KAURAX parameters</h2>
          <dl className="kv">
            <Row label="Chain ID">{status.l3.chainId.toString()}</Row>
            <Row label="Native currency">
              {`${status.l3.nativeCurrency.name} (${status.l3.nativeCurrency.symbol}, ${status.l3.nativeCurrency.decimals} decimals)`}
            </Row>
            <Row label="Block time">{`${status.l3.blockTimeSeconds}s`}</Row>
            <Row label="Block gas limit">{status.l3.gasLimit.toLocaleString("en-US")}</Row>
            <Row label="Gas price">{gwei(hexToBigInt(status.l3.gasPrice))}</Row>
            <Row label="Base fee">{status.l3.baseFeePerGas ? gwei(BigInt(status.l3.baseFeePerGas)) : null}</Row>
            <Row label="Mempool">{status.l3.mempoolSize.toString()}</Row>
            <Row label="RPC">{config.l3RpcUrl}</Row>
            <Row label="WebSocket">{config.l3WsUrl}</Row>
            <Row label="Head state root">{status.l3.stateRoot}</Row>
          </dl>
        </div>
      </div>

      <div className="grid cols-3" style={{marginTop: 14}}>
        <Stat label="L3 block" value={`#${status.l3.blockNumber}`} sub={timeAgo(status.l3.timestamp)} />
        <Stat label="L2 settlement block" value={status.l2 ? `#${status.l2.blockNumber}` : null} sub={status.l2?.name} />
        <Stat
          label="L1 block"
          value={status.l1 ? `#${status.l1.latestBlockNumber}` : null}
          sub={status.l1?.isLocalDevnetChain ? "local devnet chain" : "Ethereum"}
        />
      </div>

      <div className="grid cols-2" style={{marginTop: 14}}>
        <div className="card">
          <h2>Settlement contracts on the L2</h2>
          <dl className="kv">
            <Row label="Portal">{settlement.contracts?.portal}</Row>
            <Row label="Output oracle">{settlement.contracts?.outputOracle}</Row>
            <Row label="Batch inbox">{settlement.contracts?.batchInbox}</Row>
            <Row label="ERC-20 bridge">{settlement.contracts?.l2Bridge}</Row>
            <Row label="Challenge window">
              {settlement.outputOracle?.finalizationPeriodSeconds
                ? `${settlement.outputOracle.finalizationPeriodSeconds}s`
                : null}
            </Row>
            <dt>Fault proofs</dt>
            <dd><Badge kind="warn">not implemented</Badge></dd>
          </dl>
        </div>

        <div className="card">
          <h2>Data availability &amp; batching</h2>
          <dl className="kv">
            <Row label="Mode">{`${status.settlement.dataAvailability.mode} → ${status.settlement.dataAvailability.target}`}</Row>
            <Row label="Batches on L2">{status.settlement.batchCountOnL2}</Row>
            <Row label="Last batched L3 block">{status.settlement.lastBatchedL3Block}</Row>
            <Row label="Unbatched L3 blocks">{status.settlement.unbatchedL3Blocks.toString()}</Row>
            <Row label="Last batch range">
              {lastSubmission ? `${lastSubmission.l3StartBlock} – ${lastSubmission.l3EndBlock}` : null}
            </Row>
            <Row label="Last batch size">
              {lastSubmission
                ? `${bytes(lastSubmission.uncompressedBytes)} → ${bytes(lastSubmission.compressedBytes)}`
                : null}
            </Row>
            <Row label="Last batch L2 tx">{lastSubmission?.commitment.txHash}</Row>
            <Row label="Submitted">
              {lastSubmission ? isoTime(BigInt(Math.floor(lastSubmission.submittedAt / 1000))) : null}
            </Row>
          </dl>
        </div>
      </div>

      <div className="card" style={{marginTop: 14}}>
        <h2>Output roots</h2>
        <dl className="kv">
          <Row label="Latest output root">{status.settlement.latestOutputRoot?.outputRoot}</Row>
          <Row label="Committed L3 block">{status.settlement.latestOutputRoot?.l3BlockNumber}</Row>
          <Row label="Output index">{status.settlement.latestOutputRoot?.index}</Row>
          <Row label="Next proposal at L3 block">{settlement.outputOracle?.nextProposalAtL3Block}</Row>
        </dl>
        <div style={{marginTop: 14}}>
          <Notice>
            An output root is a commitment to KAURAX state:{" "}
            <code>keccak(version, stateRoot, withdrawalTreeRoot, blockHash)</code>. Withdrawals are proven
            against it. Nothing on chain verifies that the root itself is correct — only the proposer key
            signed it.
          </Notice>
        </div>
      </div>
    </div>
  );
}
