import {getBalance, getCode, getNonce, getRecentTransactions, type Hex} from "@/lib/rpc";
import {formatUnits} from "@/lib/format";
import {Badge, Empty, Notice, Row} from "@/components/ui";
import {AddressLink, BlockLink, TxLink} from "@/components/links";
import {PREDEPLOYS, config} from "@/lib/config";

export const dynamic = "force-dynamic";

const KNOWN: Record<string, string> = {
  [PREDEPLOYS.messagePasser.toLowerCase()]: "L3ToL2MessagePasser (KAURAX predeploy)",
  [PREDEPLOYS.l3ERC20Bridge.toLowerCase()]: "KauraxL3ERC20Bridge (KAURAX predeploy)",
};

export default async function AddressPage({params}: {params: Promise<{address: string}>}) {
  const {address} = await params;

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return <div className="container section"><Empty>{address} is not a valid address.</Empty></div>;
  }

  const [balance, nonce, code, indexed] = await Promise.all([
    getBalance(address as Hex),
    getNonce(address as Hex),
    getCode(address as Hex),
    indexedHistory(address),
  ]);

  const isContract = code !== null && code !== "0x";
  const label = KNOWN[address.toLowerCase()];

  // The indexer is the source of truth for history. Only if it cannot be reached does this
  // fall back to scanning recent blocks — and then it says so, because a partial list that
  // looks complete is worse than an obviously partial one.
  const involved = indexed
    ? indexed.items
    : (await getRecentTransactions(200)).filter(
        (t) =>
          t.from.toLowerCase() === address.toLowerCase() ||
          (t.to !== null && t.to.toLowerCase() === address.toLowerCase()),
      );

  return (
    <div className="container section">
      <div className="section-head">
        <h2>{isContract ? "Contract" : "Account"}</h2>
        {label ? <Badge kind="accent">{label}</Badge> : null}
      </div>

      <div className="card">
        <dl className="kv">
          <Row label="Address">{address}</Row>
          <Row label="Balance">{balance === null ? null : `${formatUnits(balance)} KAX`}</Row>
          <Row label="Transaction count">{nonce === null ? null : nonce.toString()}</Row>
          <Row label="Type">{isContract ? "contract" : "externally owned account"}</Row>
          {isContract ? <Row label="Bytecode size">{`${(code!.length - 2) / 2} bytes`}</Row> : null}
        </dl>
      </div>

      <div style={{marginTop: 22}}>
        <div className="section-head"><h2>Recent activity</h2></div>
        {indexed ? (
          <Notice kind="info">
            Complete history from the KAURAX address index
            {indexed.total > indexed.items.length
              ? ` — showing the ${indexed.items.length} most recent of ${indexed.total}.`
              : ` — ${indexed.total} transaction${indexed.total === 1 ? "" : "s"}, all of them.`}
          </Notice>
        ) : (
          <Notice kind="warn">
            The address index could not be reached, so this was scanned from the most recent blocks over
            JSON-RPC. It is not a complete history.
          </Notice>
        )}
        <div style={{marginTop: 14}}>
          {involved.length === 0 ? (
            <Empty>
              {indexed
                ? "This address has never been involved in a transaction."
                : "No transactions involving this address were found in the recent block window."}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Hash</th><th>Block</th><th>Direction</th><th>Counterparty</th><th>Value</th></tr></thead>
                <tbody>
                  {involved.map((t) => {
                    const outgoing = t.from.toLowerCase() === address.toLowerCase();
                    return (
                      <tr key={t.hash}>
                        <td><TxLink hash={t.hash} /></td>
                        <td>{t.blockNumber ? <BlockLink number={BigInt(t.blockNumber)} /> : null}</td>
                        <td><Badge kind={outgoing ? "warn" : "ok"}>{outgoing ? "out" : "in"}</Badge></td>
                        <td><AddressLink address={outgoing ? t.to : t.from} /></td>
                        <td className="mono">{formatUnits(BigInt(t.value))} KAX</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface IndexedTx {
  hash: string;
  blockNumber: string | null;
  from: string;
  to: string | null;
  value: string;
}

/**
 * Complete transaction history, from the indexer rather than a scan of recent blocks.
 *
 * The database has had from_address and to_address indexed since the first migration; this
 * page simply was not asking. Scanning the last 200 blocks over JSON-RPC missed anything
 * older, which on a chain producing a block every two seconds is most of an address's life.
 *
 * Returns null when the index cannot be reached, so the caller can fall back and say so.
 */
async function indexedHistory(
  address: string,
): Promise<{items: IndexedTx[]; total: number} | null> {
  try {
    const res = await fetch(
      `${config.apiFetchUrl}/api/address/${address.toLowerCase()}/transactions?limit=50`,
      {cache: "no-store", signal: AbortSignal.timeout(10_000)},
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {items?: IndexedTx[]; total?: number};
    if (!Array.isArray(body.items)) return null;
    return {items: body.items, total: body.total ?? body.items.length};
  } catch {
    return null;
  }
}
