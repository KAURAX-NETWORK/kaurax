import Link from "next/link";
import {getRecentBlocks, getBlockNumber} from "@/lib/rpc";
import {timeAgo, withThousands, isoTime} from "@/lib/format";
import {Empty} from "@/components/ui";
import {BlockLink} from "@/components/links";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function BlocksPage({searchParams}: {searchParams: Promise<{before?: string}>}) {
  const params = await searchParams;
  const head = await getBlockNumber();
  if (head === null) {
    return <div className="container section"><Empty>KAURAX RPC is not reachable.</Empty></div>;
  }

  const from = params.before ? BigInt(params.before) : head;
  const blocks = await getRecentBlocks(PAGE_SIZE, from);
  const oldest = blocks.length > 0 ? BigInt(blocks[blocks.length - 1]!.number) : 0n;
  const hasMore = oldest > 0n;

  return (
    <div className="container section">
      <div className="section-head">
        <h2>KAURAX blocks</h2>
        <span className="dim">head #{head.toString()}</span>
      </div>

      {blocks.length === 0 ? (
        <Empty>No blocks in this range.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Block</th>
                <th>Age</th>
                <th>Timestamp</th>
                <th>Txs</th>
                <th>Gas used</th>
                <th>Gas limit</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.hash}>
                  <td><BlockLink number={BigInt(b.number)} /></td>
                  <td className="dim">{timeAgo(BigInt(b.timestamp))}</td>
                  <td className="dim mono">{isoTime(BigInt(b.timestamp))}</td>
                  <td className="mono">{b.transactions.length}</td>
                  <td className="mono dim">{withThousands(BigInt(b.gasUsed))}</td>
                  <td className="mono faint">{withThousands(BigInt(b.gasLimit))}</td>
                  <td className="mono faint">{b.hash.slice(0, 18)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <div style={{marginTop: 16}}>
          <Link href={`/blocks?before=${(oldest - 1n).toString()}`}>← Older blocks</Link>
        </div>
      ) : null}
    </div>
  );
}
