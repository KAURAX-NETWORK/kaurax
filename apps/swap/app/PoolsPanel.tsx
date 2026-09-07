"use client";

/**
 * Every pool the factory has created, read from the chain.
 *
 * There is no curated list and no "featured" ordering — the factory is permissionless, so
 * a pool appearing here means only that someone created it.
 */
import {useCallback, useEffect, useState} from "react";
import {erc20Abi, swapFactoryAbi, swapPairAbi} from "@kaurax/types";
import {Badge, Empty, Spinner, formatUnits, shortHash} from "@kaurax/ui";

interface Pool {
  address: string;
  token0: {address: string; symbol: string; decimals: number};
  token1: {address: string; symbol: string; decimals: number};
  reserve0: bigint;
  reserve1: bigint;
  lpSupply: bigint;
}

export function PoolsPanel({
  factory,
  wkax,
  explorerUrl,
  client,
}: {
  factory: string;
  wkax: string;
  explorerUrl: string;
  client: ReturnType<typeof import("viem").createPublicClient>;
}) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [loading, setLoading] = useState(true);

  const meta = useCallback(
    async (address: string) => {
      if (address.toLowerCase() === wkax.toLowerCase()) {
        return {address, symbol: "WKAX", decimals: 18};
      }
      try {
        const [symbol, decimals] = (await Promise.all([
          client.readContract({address: address as `0x${string}`, abi: erc20Abi, functionName: "symbol"}),
          client.readContract({address: address as `0x${string}`, abi: erc20Abi, functionName: "decimals"}),
        ])) as [string, number];
        return {address, symbol, decimals: Number(decimals)};
      } catch {
        // A token without metadata stays unnamed rather than getting an invented label.
        return {address, symbol: shortHash(address, 6, 4), decimals: 18};
      }
    },
    [client, wkax],
  );

  useEffect(() => {
    void (async () => {
      try {
        const count = Number(
          await client.readContract({address: factory as `0x${string}`, abi: swapFactoryAbi, functionName: "allPairsLength"}),
        );

        const found: Pool[] = [];
        for (let i = 0; i < count; i++) {
          const pair = (await client.readContract({
            address: factory as `0x${string}`,
            abi: swapFactoryAbi,
            functionName: "allPairs",
            args: [BigInt(i)],
          })) as string;

          const [t0, t1, reserves, supply] = (await Promise.all([
            client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "token0"}),
            client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "token1"}),
            client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "getReserves"}),
            client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "totalSupply"}),
          ])) as [string, string, readonly [bigint, bigint, number], bigint];

          found.push({
            address: pair,
            token0: await meta(t0),
            token1: await meta(t1),
            reserve0: reserves[0],
            reserve1: reserves[1],
            lpSupply: supply,
          });
        }
        setPools(found);
      } catch {
        setPools(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [client, factory, meta]);

  if (loading) return <div className="card center" style={{padding: 40}}><Spinner /> Loading pools…</div>;
  if (pools === null) return <Empty>Could not read the factory at {factory}.</Empty>;
  if (pools.length === 0) {
    return <Empty>No liquidity pools have been created on KAURAX yet. Add liquidity to create the first.</Empty>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pool</th>
            <th>Reserves</th>
            <th>Price</th>
            <th>LP supply</th>
            <th>Pair</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((p) => (
            <tr key={p.address}>
              <td>
                <Badge kind="accent">{p.token0.symbol} / {p.token1.symbol}</Badge>
              </td>
              <td className="mono dim">
                {formatUnits(p.reserve0, p.token0.decimals, 4)} {p.token0.symbol}
                <br />
                {formatUnits(p.reserve1, p.token1.decimals, 4)} {p.token1.symbol}
              </td>
              <td className="mono">
                {p.reserve0 > 0n
                  ? `1 ${p.token0.symbol} = ${formatUnits((p.reserve1 * 10n ** BigInt(p.token0.decimals)) / p.reserve0, p.token1.decimals, 6)} ${p.token1.symbol}`
                  : <span className="nodata">No data available</span>}
              </td>
              <td className="mono dim">{formatUnits(p.lpSupply, 18, 4)}</td>
              <td>
                <a className="mono" href={`${explorerUrl}/address/${p.address}`} target="_blank" rel="noreferrer">
                  {shortHash(p.address, 8, 6)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
