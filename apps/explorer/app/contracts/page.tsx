import {getRecentTransactions, getReceipt, getCode, type Hex} from "@/lib/rpc";
import {Empty, Notice} from "@/components/ui";
import {AddressLink, BlockLink, TxLink} from "@/components/links";
import {PREDEPLOYS} from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Contracts discovered by scanning recent blocks for deployments, plus the KAURAX
 * predeploys. There is no verified-source registry yet, so nothing here claims to be
 * verified.
 */
export default async function ContractsPage() {
  const recent = await getRecentTransactions(200);
  const creations = recent.filter((t) => t.to === null);

  const deployed = await Promise.all(
    creations.map(async (t) => {
      const receipt = await getReceipt(t.hash);
      return receipt?.contractAddress ? {address: receipt.contractAddress, tx: t.hash, block: t.blockNumber} : null;
    }),
  );
  const found = deployed.filter((d): d is NonNullable<typeof d> => d !== null);

  const predeploys = await Promise.all(
    Object.entries(PREDEPLOYS).map(async ([name, address]) => {
      const code = await getCode(address as Hex);
      return {name, address, deployed: code !== null && code !== "0x", size: code ? (code.length - 2) / 2 : 0};
    }),
  );

  return (
    <div className="container section">
      <div className="section-head"><h2>Contracts</h2></div>

      <div className="card">
        <h2>KAURAX predeploys</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Address</th><th>Status</th><th>Bytecode</th></tr></thead>
            <tbody>
              {predeploys.map((p) => (
                <tr key={p.address}>
                  <td>{p.name}</td>
                  <td><AddressLink address={p.address} short={false} /></td>
                  <td>{p.deployed ? "installed" : <span className="nodata">not installed</span>}</td>
                  <td className="mono dim">{p.deployed ? `${p.size} bytes` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{marginTop: 22}}>
        <div className="section-head"><h2>Recently deployed</h2></div>
        <Notice kind="info">
          Discovered by scanning recent blocks for contract creations. KAURAX has no source-verification
          service, so no contract here is marked verified.
        </Notice>
        <div style={{marginTop: 14}}>
          {found.length === 0 ? (
            <Empty>No contract deployments were found in the recent block window.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Contract</th><th>Deployment tx</th><th>Block</th><th>Source</th></tr></thead>
                <tbody>
                  {found.map((d) => (
                    <tr key={d.address}>
                      <td><AddressLink address={d.address} short={false} /></td>
                      <td><TxLink hash={d.tx} /></td>
                      <td>{d.block ? <BlockLink number={BigInt(d.block)} /> : null}</td>
                      <td className="nodata">not verified</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
