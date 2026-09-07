import {getRecentTransactions} from "@/lib/rpc";
import {formatUnits, timeAgo, withThousands} from "@/lib/format";
import {Empty, Notice} from "@/components/ui";
import {AddressLink, BlockLink, TxLink} from "@/components/links";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const txs = await getRecentTransactions(50);

  return (
    <div className="container section">
      <div className="section-head"><h2>KAURAX transactions</h2></div>

      <Notice kind="info">
        This view scans recent blocks directly over JSON-RPC. It shows the most recent transactions found in
        that window, not a complete historical index — KAURAX does not yet run a separate indexer service.
      </Notice>

      <div style={{marginTop: 16}}>
        {txs.length === 0 ? (
          <Empty>No transactions were found in the recent block window.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Hash</th><th>Block</th><th>Age</th><th>From</th><th>To</th><th>Value</th><th>Gas</th></tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.hash}>
                    <td><TxLink hash={t.hash} /></td>
                    <td>{t.blockNumber ? <BlockLink number={BigInt(t.blockNumber)} /> : <span className="faint">pending</span>}</td>
                    <td className="dim">{timeAgo(BigInt(t.timestamp))}</td>
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
    </div>
  );
}
