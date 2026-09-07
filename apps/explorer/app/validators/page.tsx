import {getNetworkStatus, getSequencerStatus} from "@/lib/rpc";
import {Badge, Empty, Notice, Row} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * KAURAX has no validator set.
 *
 * It is a Layer-3, not a Layer-1: there is no consensus among independent validators to
 * report. Presenting a validator count, stake figure or uptime table here would be
 * fabrication. What exists instead is a single sequencer and a single proposer, and that
 * is what this page shows.
 */
export default async function ValidatorsPage() {
  const [status, sequencer] = await Promise.all([getNetworkStatus(), getSequencerStatus()]);

  return (
    <div className="container section">
      <div className="section-head"><h2>Validators</h2></div>

      <Notice>
        <strong>KAURAX has no validator set.</strong> It is a Layer-3 that derives its security from the
        underlying Layer-2, which in turn derives it from Ethereum. There is no independent consensus, no
        staking, and nothing to report as validator uptime or stake distribution. The roles that do exist —
        sequencer, batcher, proposer — are each operated by a single key today.
      </Notice>

      <div className="card" style={{marginTop: 18}}>
        <h2>Operational roles</h2>
        <dl className="kv">
          <dt>Sequencer</dt>
          <dd>
            {status ? (
              <>
                <Badge kind={status.sequencer.healthy ? "ok" : "err"}>
                  {status.sequencer.healthy ? "healthy" : "unhealthy"}
                </Badge>{" "}
                <span className="dim">single, centralized</span>
              </>
            ) : (
              <span className="nodata">No data available</span>
            )}
          </dd>
          <Row label="Blocks produced">
            {sequencer && typeof sequencer.producedBlocks === "number" ? String(sequencer.producedBlocks) : null}
          </Row>
          <Row label="Transactions sequenced">
            {sequencer && typeof sequencer.includedTransactions === "number"
              ? String(sequencer.includedTransactions)
              : null}
          </Row>
          <Row label="Deposits applied">
            {sequencer && typeof sequencer.appliedDeposits === "number" ? String(sequencer.appliedDeposits) : null}
          </Row>
          <dt>Proposer</dt>
          <dd>
            <span className="dim">single key, publishes output roots to the L2</span>
          </dd>
          <dt>Fault proof system</dt>
          <dd><Badge kind="warn">not implemented</Badge></dd>
          <dt>Permissionless validation</dt>
          <dd><Badge kind="warn">not implemented</Badge></dd>
        </dl>
      </div>

      <div className="card" style={{marginTop: 14}}>
        <h2>What replaces validators here</h2>
        <p className="dim" style={{margin: 0}}>
          Anyone can reconstruct KAURAX independently: every sequenced transaction is published as calldata to
          the underlying L2, and every deposit originates as an event on that L2. A third party can therefore
          replay the chain and check the sequencer&apos;s work. What they cannot yet do is <em>enforce</em> the
          result on chain — that requires a fault proof system, which does not exist.
        </p>
      </div>

      <div style={{marginTop: 14}}>
        <Empty>No validator data exists for this network.</Empty>
      </div>
    </div>
  );
}
