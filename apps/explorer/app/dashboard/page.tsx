import {getNetworkStatus, getSequencerStatus, getBatcherStatus, getRecentBlocks} from "@/lib/rpc";
import {bytes, gwei, hexToBigInt, timeAgo, withThousands} from "@/lib/format";
import {Badge, Empty, Notice, StackDiagram, Stat} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * dashboard.kaurax — operational view of the network.
 * Every tile is read live. A tile with no reading shows "No data available".
 */
export default async function DashboardPage() {
  const [status, sequencer, batcher, blocks] = await Promise.all([
    getNetworkStatus(),
    getSequencerStatus(),
    getBatcherStatus(),
    getRecentBlocks(20),
  ]);

  if (!status) {
    return <div className="container section"><Empty>KAURAX RPC is not reachable.</Empty></div>;
  }

  const seq = sequencer as
    | {producedBlocks: number; includedTransactions: number; appliedDeposits: number; mempoolSize: number; lastError: string | null; lastBlockAt: number | null}
    | null;
  const bat = batcher as
    | {pendingL3Blocks: number; nextL3BlockToBatch: string; lastError: string | null; lastSubmission: {compressedBytes: number; uncompressedBytes: number; submittedAt: number} | null}
    | null;

  const txsObserved = blocks.reduce((n, b) => n + b.transactions.length, 0);
  const span =
    blocks.length >= 2
      ? Number(BigInt(blocks[0]!.timestamp) - BigInt(blocks[blocks.length - 1]!.timestamp))
      : 0;
  const tps = span > 0 ? (txsObserved / span).toFixed(3) : null;
  const gasUsed = blocks.reduce((n, b) => n + BigInt(b.gasUsed), 0n);

  const batchLagSeconds =
    bat?.lastSubmission != null ? Math.floor((Date.now() - bat.lastSubmission.submittedAt) / 1000) : null;

  const compression =
    bat?.lastSubmission && bat.lastSubmission.uncompressedBytes > 0
      ? `${((1 - bat.lastSubmission.compressedBytes / bat.lastSubmission.uncompressedBytes) * 100).toFixed(1)}%`
      : null;

  return (
    <div className="container section">
      <div className="section-head">
        <h2>Network dashboard</h2>
        <Badge kind={status.sequencer.healthy ? "ok" : "err"}>
          {status.sequencer.healthy ? "operational" : "degraded"}
        </Badge>
      </div>

      <div className="grid cols-3">
        <Stat label="L1 block" value={status.l1 ? `#${status.l1.latestBlockNumber}` : null} sub={status.l1?.isLocalDevnetChain ? "local devnet chain" : "Ethereum"} />
        <Stat label="L2 block" value={status.l2 ? `#${status.l2.blockNumber}` : null} sub={status.l2?.name} />
        <Stat label="L3 block" value={`#${status.l3.blockNumber}`} sub={timeAgo(status.l3.timestamp)} />
      </div>

      <div className="grid cols-4" style={{marginTop: 14}}>
        <Stat label="Gas price" value={gwei(hexToBigInt(status.l3.gasPrice))} />
        <Stat label="Throughput" value={tps === null ? null : `${tps} TPS`} sub={`${blocks.length} blocks observed`} />
        <Stat label="Gas used (window)" value={withThousands(gasUsed)} sub={`${txsObserved} transactions`} />
        <Stat label="Mempool" value={seq ? String(seq.mempoolSize) : null} sub="queued in the sequencer" />
      </div>

      <div className="grid cols-2" style={{marginTop: 22}}>
        <div className="card">
          <h2>Sequencer</h2>
          <dl className="kv">
            <dt>Health</dt>
            <dd>
              <Badge kind={status.sequencer.healthy ? "ok" : "err"}>
                {status.sequencer.healthy ? "producing blocks" : "not producing"}
              </Badge>
            </dd>
            <dt>Mode</dt>
            <dd>single sequencer · <span className="dim">centralized</span></dd>
            <dt>Blocks produced</dt>
            <dd>{seq ? withThousands(seq.producedBlocks) : <span className="nodata">No data available</span>}</dd>
            <dt>Transactions sequenced</dt>
            <dd>{seq ? withThousands(seq.includedTransactions) : <span className="nodata">No data available</span>}</dd>
            <dt>Deposits applied</dt>
            <dd>{seq ? withThousands(seq.appliedDeposits) : <span className="nodata">No data available</span>}</dd>
            <dt>Last error</dt>
            <dd>{seq?.lastError ?? "none"}</dd>
          </dl>
        </div>

        <div className="card">
          <h2>Batcher</h2>
          <dl className="kv">
            <dt>Health</dt>
            <dd>
              <Badge kind={bat && bat.lastError === null ? "ok" : "warn"}>
                {bat && bat.lastError === null ? "submitting" : (bat?.lastError ?? "unknown")}
              </Badge>
            </dd>
            <dt>Unbatched L3 blocks</dt>
            <dd>{bat ? String(bat.pendingL3Blocks) : <span className="nodata">No data available</span>}</dd>
            <dt>Next block to batch</dt>
            <dd>{bat?.nextL3BlockToBatch ?? <span className="nodata">No data available</span>}</dd>
            <dt>Last batch age</dt>
            <dd>{batchLagSeconds === null ? <span className="nodata">No data available</span> : `${batchLagSeconds}s`}</dd>
            <dt>Last batch size</dt>
            <dd>
              {bat?.lastSubmission
                ? `${bytes(bat.lastSubmission.uncompressedBytes)} → ${bytes(bat.lastSubmission.compressedBytes)}`
                : <span className="nodata">No data available</span>}
            </dd>
            <dt>Compression</dt>
            <dd>{compression ?? <span className="nodata">No data available</span>}</dd>
          </dl>
        </div>
      </div>

      <div className="grid cols-2" style={{marginTop: 14}}>
        <div className="card">
          <h2>Settlement pipeline</h2>
          <StackDiagram
            l1={status.l1 ? {name: status.l1.isLocalDevnetChain ? "Local devnet chain" : "Ethereum", chainId: status.l1.chainId, head: status.l1.latestBlockNumber} : null}
            l2={status.l2 ? {name: status.l2.name, chainId: status.l2.chainId, head: status.l2.blockNumber} : null}
            l3={{name: status.network.name, chainId: status.l3.chainId, head: status.l3.blockNumber}}
          />
        </div>

        <div className="card">
          <h2>Bridge &amp; proofs</h2>
          <dl className="kv">
            <dt>Batches published</dt>
            <dd>{status.settlement.batchCountOnL2 ?? <span className="nodata">No data available</span>}</dd>
            <dt>Latest output root</dt>
            <dd style={{fontSize: 11}}>
              {status.settlement.latestOutputRoot?.outputRoot ?? <span className="nodata">No data available</span>}
            </dd>
            <dt>Committed L3 block</dt>
            <dd>{status.settlement.latestOutputRoot?.l3BlockNumber ?? <span className="nodata">No data available</span>}</dd>
            <dt>Fault proofs</dt>
            <dd><Badge kind="warn">not implemented</Badge></dd>
            <dt>Forced inclusion</dt>
            <dd><Badge kind="ok">implemented via the portal deposit path</Badge></dd>
          </dl>
        </div>
      </div>

      <div style={{marginTop: 18}}>
        <Notice>
          These are operational readings, not adoption metrics. KAURAX does not publish TVL, user counts or
          partner figures, because none of those exist for this network.
        </Notice>
      </div>
    </div>
  );
}
