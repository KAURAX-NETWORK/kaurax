import {getBalance, getCode, getNonce, getRecentTransactions, type Hex} from "@/lib/rpc";
import {formatUnits} from "@/lib/format";
import {Badge, Empty, Notice, Row} from "@/components/ui";
import {AddressLink, BlockLink, TxLink} from "@/components/links";
import {PREDEPLOYS} from "@/lib/config";

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

  const [balance, nonce, code, recent] = await Promise.all([
    getBalance(address as Hex),
    getNonce(address as Hex),
    getCode(address as Hex),
    getRecentTransactions(200),
  ]);

  const isContract = code !== null && code !== "0x";
  const label = KNOWN[address.toLowerCase()];

  const involved = recent.filter(
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
        <Notice kind="info">
          Scanned from the most recent blocks over JSON-RPC. This is not a complete transaction history for
          this address — KAURAX does not yet run an address index.
        </Notice>
        <div style={{marginTop: 14}}>
          {involved.length === 0 ? (
            <Empty>No transactions involving this address were found in the recent block window.</Empty>
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
