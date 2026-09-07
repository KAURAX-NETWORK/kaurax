import Link from "next/link";
/**
 * KAURAX overview.
 *
 * Everything on this page is read live from the KAURAX RPC and the settlement contracts on
 * the underlying L2. There are no decentralization statistics here, because KAURAX has a
 * single sequencer and no validator set — inventing a number for those would be a lie.
 */
import {getNetworkStatus, getRecentBlocks, getRecentTransactions} from "@/lib/rpc";
import {formatUnits, gwei, hexToBigInt, timeAgo, withThousands, bytes} from "@/lib/format";
import {Badge, Empty, Notice, StackDiagram, Stat, Value} from "@/components/ui";
import {AddressLink, BlockLink, TxLink} from "@/components/links";
import {NO_DATA} from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [status, blocks, txs] = await Promise.all([
    getNetworkStatus(),
    getRecentBlocks(8),
    getRecentTransactions(8),
  ]);

  if (!status) {
    return (
      <div className="container section">
        <Empty>
          KAURAX RPC is not reachable. Start the devnet with <code>./infra/scripts/devnet/start.sh</code>.
        </Empty>
      </div>
    );
  }

  // Throughput measured from the blocks actually observed, not assumed.
  const observed = blocks.length >= 2 ? blocks : [];
  let tps: string | null = null;
  if (observed.length >= 2) {
    const newest = observed[0]!;
    const oldest = observed[observed.length - 1]!;
    const span = Number(BigInt(newest.timestamp) - BigInt(oldest.timestamp));
    const count = observed.reduce((n, b) => n + b.transactions.length, 0);
    tps = span > 0 ? (count / span).toFixed(3) : null;
  }

  const gasPrice = hexToBigInt(status.l3.gasPrice);
  const settlement = status.settlement;

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{status.network.name}</h1>
          <p>
            An application-focused Ethereum Layer-3. KAURAX executes transactions, publishes its data to{" "}
            {status.l2 ? status.l2.name : "the underlying Layer-2"}, and inherits settlement from Ethereum
            through it.
          </p>
        </div>
      </section>

      <div className="container section">
        <div className="grid cols-4">
          <Stat label="Latest L3 block" value={`#${status.l3.blockNumber}`} sub={timeAgo(status.l3.timestamp)} />
          <Stat
            label="Transactions (last 8 blocks)"
            value={withThousands(observed.reduce((n, b) => n + b.transactions.length, 0))}
            sub={`${observed.length} blocks observed`}
          />
          <Stat
            label="Throughput"
            value={tps === null ? null : `${tps} TPS`}
            sub="measured over the observed window"
          />
          <Stat label="Gas price" value={gwei(gasPrice)} sub={`block time ${status.l3.blockTimeSeconds}s`} />
        </div>

        <div className="grid cols-4" style={{marginTop: 14}}>
          <Stat
            label="Sequencer"
            value={
              status.sequencer.healthy ? (
                <Badge kind="ok">healthy</Badge>
              ) : (
                <Badge kind="err">unhealthy</Badge>
              )
            }
            sub={`${status.sequencer.mode} · centralized`}
            small
          />
          <Stat
            label="L2 settlement block"
            value={status.l2 ? `#${status.l2.blockNumber}` : null}
            sub={status.l2 ? `${status.l2.name} · chain ${status.l2.chainId}` : undefined}
            small
          />
          <Stat
            label="Last batch"
            value={settlement.lastBatch ? `L3 ${settlement.lastBatch.l3StartBlock}–${settlement.lastBatch.l3EndBlock}` : null}
            sub={
              settlement.lastBatch
                ? `${bytes(settlement.lastBatch.uncompressedBytes)} → ${bytes(settlement.lastBatch.compressedBytes)}`
                : undefined
            }
            small
          />
          <Stat
            label="Network status"
            value={<Badge kind={status.sequencer.healthy ? "ok" : "err"}>{status.sequencer.healthy ? "operational" : "degraded"}</Badge>}
            sub={`uptime ${status.network.uptimeSeconds}s`}
            small
          />
        </div>

        <div style={{marginTop: 20}}>
          <Notice>
            <strong>KAURAX has no fault-proof system and a single sequencer.</strong> Output roots posted to{" "}
            {status.l2?.name ?? "the L2"} are trusted, not proven. Withdrawals are cryptographically included
            under those roots, but the roots themselves are not verified on chain. KAX is a testnet gas asset
            with no monetary value.
          </Notice>
        </div>
      </div>

      <div className="container section">
        <div className="grid cols-2">
          <div className="card">
            <h2>Architecture</h2>
            <StackDiagram
              l1={
                status.l1
                  ? {
                      name: status.l1.isLocalDevnetChain ? "Local devnet chain (Ethereum stand-in)" : "Ethereum",
                      chainId: status.l1.chainId,
                      head: status.l1.latestBlockNumber,
                    }
                  : null
              }
              l2={status.l2 ? {name: status.l2.name, chainId: status.l2.chainId, head: status.l2.blockNumber} : null}
              l3={{name: status.network.name, chainId: status.l3.chainId, head: status.l3.blockNumber}}
            />
          </div>

          <div className="card">
            <h2>Settlement</h2>
            <dl className="kv">
              <dt>Batches on L2</dt>
              <dd><Value>{settlement.batchCountOnL2}</Value></dd>
              <dt>Last batched L3 block</dt>
              <dd><Value>{settlement.lastBatchedL3Block}</Value></dd>
              <dt>Unbatched L3 blocks</dt>
              <dd>{settlement.unbatchedL3Blocks}</dd>
              <dt>Latest output root</dt>
              <dd style={{fontSize: 11}}><Value>{settlement.latestOutputRoot?.outputRoot}</Value></dd>
              <dt>Output at L3 block</dt>
              <dd><Value>{settlement.latestOutputRoot?.l3BlockNumber}</Value></dd>
              <dt>Data availability</dt>
              <dd>{settlement.dataAvailability.mode} → {settlement.dataAvailability.target}</dd>
              <dt>Fault proofs</dt>
              <dd><Badge kind="warn">{settlement.faultProofs.status}</Badge></dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="container section">
        <div className="grid cols-2">
          <div>
            <div className="section-head">
              <h2>Latest blocks</h2>
              <Link href="/blocks">View all →</Link>
            </div>
            {blocks.length === 0 ? (
              <Empty>{NO_DATA}</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Block</th>
                      <th>Age</th>
                      <th>Txs</th>
                      <th>Gas used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((b) => (
                      <tr key={b.hash}>
                        <td><BlockLink number={BigInt(b.number)} /></td>
                        <td className="dim">{timeAgo(BigInt(b.timestamp))}</td>
                        <td className="mono">{b.transactions.length}</td>
                        <td className="mono dim">{withThousands(BigInt(b.gasUsed))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="section-head">
              <h2>Latest transactions</h2>
              <Link href="/transactions">View all →</Link>
            </div>
            {txs.length === 0 ? (
              <Empty>No transactions in the recent block window.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Hash</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map((t) => (
                      <tr key={t.hash}>
                        <td><TxLink hash={t.hash} /></td>
                        <td><AddressLink address={t.from} /></td>
                        <td><AddressLink address={t.to} /></td>
                        <td className="mono">{formatUnits(BigInt(t.value))} KAX</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
