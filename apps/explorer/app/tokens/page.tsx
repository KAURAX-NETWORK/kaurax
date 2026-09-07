import {getLogs, getCode, type Hex} from "@/lib/rpc";
import {Empty, Notice} from "@/components/ui";
import {AddressLink} from "@/components/links";
import {PREDEPLOYS} from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Tokens bridged onto KAURAX.
 *
 * The list is derived from the L3 bridge's own events. If nothing has been bridged, this
 * page says so — it does not display a curated or aspirational token list.
 */
export default async function TokensPage() {
  const bridgeCode = await getCode(PREDEPLOYS.l3ERC20Bridge as Hex);
  const bridgeInstalled = bridgeCode !== null && bridgeCode !== "0x";

  const logs = bridgeInstalled
    ? await getLogs({address: PREDEPLOYS.l3ERC20Bridge, fromBlock: "0x0", toBlock: "latest"})
    : null;

  // Topic 2 of DepositFinalized is the indexed l3Token address.
  const tokens = new Map<string, {l2Token: string; count: number}>();
  for (const log of logs ?? []) {
    if (log.topics.length < 3) continue;
    const l2Token = `0x${log.topics[1]!.slice(26)}`;
    const l3Token = `0x${log.topics[2]!.slice(26)}`;
    const existing = tokens.get(l3Token);
    tokens.set(l3Token, {l2Token, count: (existing?.count ?? 0) + 1});
  }

  return (
    <div className="container section">
      <div className="section-head"><h2>Tokens</h2></div>

      <Notice kind="info">
        KAX is the <strong>native</strong> currency of KAURAX and is not an ERC-20, so it does not appear in
        this list. It is a testnet gas asset with no monetary value. The tokens listed here are ERC-20s that
        have actually been bridged from the underlying L2 through <code>KauraxL3ERC20Bridge</code>.
      </Notice>

      <div style={{marginTop: 16}}>
        {!bridgeInstalled ? (
          <Empty>The KAURAX ERC-20 bridge predeploy is not installed on this network.</Empty>
        ) : tokens.size === 0 ? (
          <Empty>No tokens have been bridged onto KAURAX yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>KAURAX token</th><th>Escrowed L2 token</th><th>Bridge deposits observed</th></tr></thead>
              <tbody>
                {[...tokens.entries()].map(([l3Token, info]) => (
                  <tr key={l3Token}>
                    <td><AddressLink address={l3Token} short={false} /></td>
                    <td className="mono dim">{info.l2Token}</td>
                    <td className="mono">{info.count}</td>
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
