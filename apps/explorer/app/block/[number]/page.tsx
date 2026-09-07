import Link from "next/link";
import {getBlock, getBlockByHash, getNetworkStatus, type RpcTransaction, type Hex} from "@/lib/rpc";
import {formatUnits, isoTime, timeAgo, withThousands, gwei} from "@/lib/format";
import {Badge, Empty, Row} from "@/components/ui";
import {AddressLink, TxLink} from "@/components/links";

export const dynamic = "force-dynamic";

export default async function BlockPage({params}: {params: Promise<{number: string}>}) {
  const {number} = await params;

  const block = number.startsWith("0x")
    ? await getBlockByHash(number as Hex, true)
    : await getBlock(BigInt(number), true);

  if (!block) {
    return (
      <div className="container section">
        <Empty>Block {number} was not found on KAURAX.</Empty>
      </div>
    );
  }

  const status = await getNetworkStatus();
  const blockNumber = BigInt(block.number);

  const batched =
    status?.settlement.lastBatchedL3Block !== null && status?.settlement.lastBatchedL3Block !== undefined
      ? BigInt(status.settlement.lastBatchedL3Block) >= blockNumber
      : null;

  const committed =
    status?.settlement.latestOutputRoot != null
      ? BigInt(status.settlement.latestOutputRoot.l3BlockNumber) >= blockNumber
      : null;

  const txs = block.transactions.filter((t): t is RpcTransaction => typeof t !== "string");

  return (
    <div className="container section">
      <div className="section-head">
        <h2>Block #{blockNumber.toString()}</h2>
        <span className="dim">{timeAgo(BigInt(block.timestamp))}</span>
      </div>

      <div className="card">
        <dl className="kv">
          <Row label="Block height">{blockNumber.toString()}</Row>
          <Row label="Hash">{block.hash}</Row>
          <Row label="Parent hash">{block.parentHash}</Row>
          <Row label="State root">{block.stateRoot}</Row>
          <Row label="Timestamp">{isoTime(BigInt(block.timestamp))}</Row>
          <Row label="Transactions">{txs.length.toString()}</Row>
          <Row label="Gas used">
            {`${withThousands(BigInt(block.gasUsed))} / ${withThousands(BigInt(block.gasLimit))}`}
          </Row>
          <Row label="Base fee">{block.baseFeePerGas ? gwei(BigInt(block.baseFeePerGas)) : null}</Row>
        </dl>
      </div>

      <div className="card" style={{marginTop: 14}}>
        <h2>Settlement</h2>
        <dl className="kv">
          <dt>Published to the L2</dt>
          <dd>
            {batched === null ? (
              <span className="nodata">No data available</span>
            ) : batched ? (
              <Badge kind="ok">yes — data is on {status?.l2?.name ?? "the L2"}</Badge>
            ) : (
              <Badge kind="warn">not yet batched</Badge>
            )}
          </dd>
          <dt>Committed by an output root</dt>
          <dd>
            {committed === null ? (
              <span className="nodata">No data available</span>
            ) : committed ? (
              <Badge kind="ok">yes — output at L3 block {status?.settlement.latestOutputRoot?.l3BlockNumber}</Badge>
            ) : (
              <Badge kind="warn">no output root covers this block yet</Badge>
            )}
          </dd>
          <dt>Fault proof</dt>
          <dd><Badge kind="warn">not implemented — the output root is trusted</Badge></dd>
        </dl>
      </div>

      <div style={{marginTop: 22}}>
        <div className="section-head"><h2>Transactions in this block</h2></div>
        {txs.length === 0 ? (
          <Empty>This block contains no transactions.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Hash</th><th>From</th><th>To</th><th>Value</th><th>Gas</th></tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.hash}>
                    <td><TxLink hash={t.hash} /></td>
                    <td><AddressLink address={t.from} /></td>
                    <td><AddressLink address={t.to} /></td>
                    <td className="mono">{formatUnits(BigInt(t.value))} KAX</td>
                    <td className="mono dim">{withThousands(BigInt(t.gas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{marginTop: 18, display: "flex", gap: 16}}>
        {blockNumber > 0n ? <Link href={`/block/${(blockNumber - 1n).toString()}`}>← Previous block</Link> : null}
        <Link href={`/block/${(blockNumber + 1n).toString()}`}>Next block →</Link>
      </div>
    </div>
  );
}
