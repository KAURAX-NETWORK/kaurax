import {getTransaction, getReceipt, getNetworkStatus, getBlock, type Hex} from "@/lib/rpc";
import {formatUnits, gwei, isoTime, withThousands} from "@/lib/format";
import {Badge, Empty, Row} from "@/components/ui";
import {AddressLink, BlockLink} from "@/components/links";

export const dynamic = "force-dynamic";

export default async function TxPage({params}: {params: Promise<{hash: string}>}) {
  const {hash} = await params;
  const tx = await getTransaction(hash as Hex);

  if (!tx) {
    return (
      <div className="container section">
        <Empty>
          Transaction {hash} was not found. It may still be in the sequencer&apos;s mempool, or it may never
          have been submitted to KAURAX.
        </Empty>
      </div>
    );
  }

  const [receipt, status] = await Promise.all([getReceipt(hash as Hex), getNetworkStatus()]);
  const block = tx.blockNumber ? await getBlock(BigInt(tx.blockNumber)) : null;
  const blockNumber = tx.blockNumber ? BigInt(tx.blockNumber) : null;

  const batched =
    blockNumber !== null && status?.settlement.lastBatchedL3Block
      ? BigInt(status.settlement.lastBatchedL3Block) >= blockNumber
      : null;
  const committed =
    blockNumber !== null && status?.settlement.latestOutputRoot
      ? BigInt(status.settlement.latestOutputRoot.l3BlockNumber) >= blockNumber
      : null;

  const feePaid =
    receipt !== null ? BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) : null;

  return (
    <div className="container section">
      <div className="section-head">
        <h2>Transaction</h2>
        {receipt ? (
          <Badge kind={BigInt(receipt.status) === 1n ? "ok" : "err"}>
            {BigInt(receipt.status) === 1n ? "success" : "reverted"}
          </Badge>
        ) : (
          <Badge kind="warn">pending</Badge>
        )}
      </div>

      <div className="card">
        <dl className="kv">
          <Row label="Hash">{tx.hash}</Row>
          <Row label="Block">{blockNumber ? <BlockLink number={blockNumber} /> : null}</Row>
          <Row label="Timestamp">{block ? isoTime(BigInt(block.timestamp)) : null}</Row>
          <Row label="From"><AddressLink address={tx.from} short={false} /></Row>
          <Row label="To">
            {tx.to ? (
              <AddressLink address={tx.to} short={false} />
            ) : receipt?.contractAddress ? (
              <>contract created: <AddressLink address={receipt.contractAddress} short={false} /></>
            ) : (
              "contract creation"
            )}
          </Row>
          <Row label="Value">{`${formatUnits(BigInt(tx.value))} KAX`}</Row>
          <Row label="Nonce">{Number(BigInt(tx.nonce)).toString()}</Row>
          <Row label="Gas limit">{withThousands(BigInt(tx.gas))}</Row>
          <Row label="Gas used">{receipt ? withThousands(BigInt(receipt.gasUsed)) : null}</Row>
          <Row label="Effective gas price">{receipt ? gwei(BigInt(receipt.effectiveGasPrice)) : null}</Row>
          <Row label="Fee paid">{feePaid === null ? null : `${formatUnits(feePaid)} KAX`}</Row>
          <Row label="Input data">
            {tx.input === "0x" ? "0x (plain transfer)" : `${tx.input.slice(0, 66)}… (${(tx.input.length - 2) / 2} bytes)`}
          </Row>
        </dl>
      </div>

      <div className="card" style={{marginTop: 14}}>
        <h2>Settlement pipeline</h2>
        <dl className="kv">
          <dt>1. Sequenced into an L3 block</dt>
          <dd>{blockNumber !== null ? <Badge kind="ok">block {blockNumber.toString()}</Badge> : <Badge kind="warn">pending</Badge>}</dd>
          <dt>2. Data published to the L2</dt>
          <dd>
            {batched === null ? (
              <span className="nodata">No data available</span>
            ) : batched ? (
              <Badge kind="ok">included in a batch on {status?.l2?.name ?? "the L2"}</Badge>
            ) : (
              <Badge kind="warn">awaiting the next batch</Badge>
            )}
          </dd>
          <dt>3. State committed by an output root</dt>
          <dd>
            {committed === null ? (
              <span className="nodata">No data available</span>
            ) : committed ? (
              <Badge kind="ok">covered by output at L3 block {status?.settlement.latestOutputRoot?.l3BlockNumber}</Badge>
            ) : (
              <Badge kind="warn">awaiting the next output proposal</Badge>
            )}
          </dd>
          <dt>4. Fault proven</dt>
          <dd><Badge kind="warn">not implemented</Badge></dd>
        </dl>
      </div>

      {receipt && receipt.logs.length > 0 ? (
        <div className="card" style={{marginTop: 14}}>
          <h2>Logs ({receipt.logs.length})</h2>
          {receipt.logs.map((log, i) => (
            <div key={i} style={{borderTop: i > 0 ? "1px solid var(--border)" : "none", paddingTop: i > 0 ? 12 : 0, marginTop: i > 0 ? 12 : 0}}>
              <div className="dim" style={{fontSize: 12, marginBottom: 6}}>
                #{Number(BigInt(log.logIndex))} · <AddressLink address={log.address} short={false} />
              </div>
              {log.topics.map((t, j) => (
                <div key={j} className="mono faint" style={{fontSize: 11.5, wordBreak: "break-all"}}>
                  topic{j}: {t}
                </div>
              ))}
              <div className="mono faint" style={{fontSize: 11.5, wordBreak: "break-all", marginTop: 4}}>
                data: {log.data}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
