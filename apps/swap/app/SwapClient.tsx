"use client";

/**
 * KAURAX Swap.
 *
 * The quote shown is the router's own `getAmountsOut`, which is the same calculation the
 * pair performs when the swap executes — so the number on screen is the number you get,
 * absent a state change between quoting and executing. That gap is exactly what the
 * slippage tolerance covers, and it is applied as a real on-chain minimum.
 *
 * Tokens are discovered from the indexer via the KAURAX API, not from a curated list, so
 * nothing here implies a token is endorsed.
 */
import {useCallback, useEffect, useMemo, useState} from "react";
import {encodeFunctionData} from "viem";
import {erc20Abi, swapFactoryAbi, swapRouterAbi} from "@kaurax/types";
import {Badge, Banner, Empty, Row, Spinner, formatUnits, parseUnits, shortHash, useWallet} from "@kaurax/ui";
import {LiquidityPanel} from "./LiquidityPanel";
import {PoolsPanel} from "./PoolsPanel";
import {NATIVE, useSwapChain} from "./useSwapChain";

interface Props {
  router: string;
  factory: string;
  wkax: string;
  rpcUrl: string;
  apiUrl: string;
  chainId: number;
  explorerUrl: string;
}

type Tab = "swap" | "liquidity" | "pools";

export function SwapClient({router, factory, wkax, rpcUrl, apiUrl, chainId, explorerUrl}: Props) {
  const wallet = useWallet({chainId, chainName: "KAURAX", rpcUrl, explorerUrl});
  const {client, tokens, loading: loadingTokens, tokenOf, chainDeadline, ensureAllowance, sendTx} =
    useSwapChain(chainId, rpcUrl, apiUrl, wkax);

  const [tab, setTab] = useState<Tab>("swap");
  const [fromToken, setFromToken] = useState<string>(NATIVE);
  const [toToken, setToToken] = useState<string>("");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState(0.5);

  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [reserves, setReserves] = useState<{a: bigint; b: bigint} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!toToken && tokens.length > 0) setToToken(tokens[0]!.address);
  }, [tokens, toToken]);

  const path = useMemo(() => {
    if (!toToken) return null;
    const a = fromToken === NATIVE ? wkax : fromToken;
    const b = toToken === NATIVE ? wkax : toToken;
    if (a.toLowerCase() === b.toLowerCase()) return null;
    return [a as `0x${string}`, b as `0x${string}`];
  }, [fromToken, toToken, wkax]);

  // ------------------------------------------------------------- quote --
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setQuote(null);
      setQuoteError(null);
      setReserves(null);

      const decimals = tokenOf(fromToken).decimals;
      const wei = parseUnits(amountIn, decimals);
      if (!path || wei === null || wei <= 0n) return;

      setQuoting(true);
      try {
        const pair = (await client.readContract({
          address: factory as `0x${string}`,
          abi: swapFactoryAbi,
          functionName: "getPair",
          args: [path[0], path[1]],
        })) as string;

        if (pair === "0x0000000000000000000000000000000000000000") {
          if (!cancelled) setQuoteError("No liquidity pool exists for this pair yet.");
          return;
        }

        const [amounts, r] = await Promise.all([
          client.readContract({
            address: router as `0x${string}`,
            abi: swapRouterAbi,
            functionName: "getAmountsOut",
            args: [wei, path],
          }) as Promise<readonly bigint[]>,
          client.readContract({
            address: router as `0x${string}`,
            abi: swapRouterAbi,
            functionName: "getReserves",
            args: [path[0], path[1]],
          }) as Promise<readonly [bigint, bigint]>,
        ]);

        if (!cancelled) {
          setQuote(amounts[amounts.length - 1]!);
          setReserves({a: r[0], b: r[1]});
        }
      } catch (err) {
        // A revert here usually means the pool is too shallow for this size.
        if (!cancelled) setQuoteError(`No quote available: ${(err as Error).message.split("\n")[0]}`);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amountIn, path, client, factory, router, fromToken, tokenOf]);

  const minOut = useMemo(() => {
    if (quote === null) return null;
    // Basis points, so the tolerance is applied exactly rather than through a float.
    const bps = BigInt(Math.round((100 - slippage) * 100));
    return (quote * bps) / 10_000n;
  }, [quote, slippage]);

  // -------------------------------------------------------------- swap --
  const swap = useCallback(async () => {
    setError(null);
    setSuccess(null);

    const from = tokenOf(fromToken);
    const wei = parseUnits(amountIn, from.decimals);
    if (!path || wei === null || wei <= 0n || quote === null || minOut === null) return;

    setBusy(true);
    try {
      const deadline = await chainDeadline();
      const to = wallet.account!;

      // An ERC-20 input needs an allowance first; native KAX does not.
      if (fromToken !== NATIVE) {
        const allowance = (await client.readContract({
          address: from.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [to, router as `0x${string}`],
        })) as bigint;

        if (allowance < wei) {
          const approveHash = await wallet.request<string>("eth_sendTransaction", [
            {
              from: to,
              to: from.address,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [router as `0x${string}`, wei],
              }),
            },
          ]);
          await client.waitForTransactionReceipt({hash: approveHash as `0x${string}`, timeout: 90_000});
        }
      }

      let data: `0x${string}`;
      let value = 0n;

      if (fromToken === NATIVE) {
        data = encodeFunctionData({
          abi: swapRouterAbi,
          functionName: "swapExactKAXForTokens",
          args: [minOut, path, to, deadline],
        });
        value = wei;
      } else if (toToken === NATIVE) {
        data = encodeFunctionData({
          abi: swapRouterAbi,
          functionName: "swapExactTokensForKAX",
          args: [wei, minOut, path, to, deadline],
        });
      } else {
        data = encodeFunctionData({
          abi: swapRouterAbi,
          functionName: "swapExactTokensForTokens",
          args: [wei, minOut, path, to, deadline],
        });
      }

      const hash = await wallet.request<string>("eth_sendTransaction", [
        {from: to, to: router, data, value: `0x${value.toString(16)}`},
      ]);
      const receipt = await client.waitForTransactionReceipt({hash: hash as `0x${string}`, timeout: 90_000});

      if (receipt.status !== "success") {
        setError("The swap was included but reverted. The price may have moved past your slippage tolerance.");
        return;
      }
      setSuccess(`Swapped — ${shortHash(hash)}`);
      setAmountIn("");
    } catch (err) {
      const e = err as {code?: number; message?: string};
      setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? "The swap failed."));
    } finally {
      setBusy(false);
    }
  }, [amountIn, fromToken, toToken, path, quote, minOut, wallet, client, router, tokenOf]);

  const from = tokenOf(fromToken);
  const to = toToken ? tokenOf(toToken) : null;
  const canSwap =
    wallet.account !== null && wallet.onKaurax && quote !== null && !busy && !quoting && path !== null;

  // -------------------------------------------------------------- view --
  if (loadingTokens) {
    return <div className="card center" style={{padding: 40}}><Spinner /> Loading tokens…</div>;
  }

  const walletBar = (
    <div className="wallet-bar" style={{marginBottom: 18}}>
      {wallet.account ? (
        <>
          <Badge kind="ok">connected</Badge>
          <span className="addr">{shortHash(wallet.account, 8, 6)}</span>
          <span className="spacer" />
          {!wallet.onKaurax ? (
            <button onClick={() => void wallet.switchToKaurax()}>Switch to KAURAX</button>
          ) : null}
        </>
      ) : (
        <>
          <span className="dim">Connect a wallet to trade or provide liquidity.</span>
          <span className="spacer" />
          <button className="primary" onClick={() => void wallet.connect()}>Connect wallet</button>
        </>
      )}
    </div>
  );

  const tabs = (
    <div className="row-gap" style={{marginBottom: 16}}>
      {(["swap", "liquidity", "pools"] as Tab[]).map((t) => (
        <button key={t} className={tab === t ? "primary" : undefined} onClick={() => setTab(t)}>
          {t === "swap" ? "Swap" : t === "liquidity" ? "Liquidity" : "Pools"}
        </button>
      ))}
    </div>
  );

  if (tab === "pools") {
    return (
      <>
        {walletBar}
        {tabs}
        <PoolsPanel factory={factory} wkax={wkax} explorerUrl={explorerUrl} client={client} />
      </>
    );
  }

  if (tab === "liquidity") {
    return (
      <>
        {walletBar}
        {tabs}
        <LiquidityPanel
          router={router}
          factory={factory}
          wkax={wkax}
          explorerUrl={explorerUrl}
          wallet={wallet}
          tokens={tokens}
          tokenOf={tokenOf}
          client={client}
          chainDeadline={chainDeadline}
          ensureAllowance={ensureAllowance}
          sendTx={sendTx}
        />
      </>
    );
  }

  if (tokens.length === 0) {
    return (
      <>
        {walletBar}
        {tabs}
        <Empty>
          No ERC-20 tokens have been seen on KAURAX yet, so there is nothing to trade against KAX.
          Deploy a token and make a transfer, and the indexer will pick it up.
        </Empty>
      </>
    );
  }

  return (
    <>
      {walletBar}
      {tabs}
      <div className="grid cols-2">
        <div className="card">
          <h2>Swap</h2>

          <div className="field">
            <label>From</label>
            <div className="field-row">
              <input
                className="mono"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
              />
              <select value={fromToken} onChange={(e) => setFromToken(e.target.value)}>
                <option value={NATIVE}>KAX</option>
                {tokens.map((t) => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="center" style={{margin: "8px 0"}}>
            <button
              onClick={() => {
                setFromToken(toToken || NATIVE);
                setToToken(fromToken);
                setAmountIn("");
              }}
              title="Reverse"
            >
              ↓
            </button>
          </div>

          <div className="field">
            <label>To (estimated)</label>
            <div className="field-row">
              <input
                className="mono"
                readOnly
                value={quote !== null && to ? formatUnits(quote, to.decimals) : ""}
                placeholder={quoting ? "quoting…" : "0.0"}
              />
              <select value={toToken} onChange={(e) => setToToken(e.target.value)}>
                <option value={NATIVE}>KAX</option>
                {tokens.map((t) => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Slippage tolerance</label>
            <div className="row-gap">
              {[0.1, 0.5, 1, 3].map((s) => (
                <button key={s} className={slippage === s ? "primary" : undefined} onClick={() => setSlippage(s)}>
                  {s}%
                </button>
              ))}
            </div>
            <div className="hint">
              Enforced on chain as a minimum output. If the price moves beyond it, the swap reverts
              rather than filling at a worse rate.
            </div>
          </div>

          <button className="primary" style={{width: "100%", marginTop: 6}} disabled={!canSwap} onClick={() => void swap()}>
            {busy ? <Spinner /> : null}{" "}
            {!wallet.account
              ? "Connect a wallet"
              : !wallet.onKaurax
                ? "Switch to KAURAX"
                : quoteError
                  ? "No route"
                  : quote === null
                    ? "Enter an amount"
                    : `Swap ${from.symbol} for ${to?.symbol ?? ""}`}
          </button>

          {quoteError ? <Banner kind="warn">{quoteError}</Banner> : null}
          {error ? <div className="error-text">{error}</div> : null}
          {success ? <Banner kind="ok">{success}</Banner> : null}
        </div>

        <div className="card">
          <h2>Trade details</h2>
          <dl className="kv">
            <Row label="Rate">
              {quote !== null && to && parseUnits(amountIn, from.decimals)
                ? `1 ${from.symbol} ≈ ${formatUnits(
                    (quote * 10n ** BigInt(from.decimals)) / parseUnits(amountIn, from.decimals)!,
                    to.decimals,
                    6,
                  )} ${to.symbol}`
                : null}
            </Row>
            <Row label="Minimum received">
              {minOut !== null && to ? `${formatUnits(minOut, to.decimals)} ${to.symbol}` : null}
            </Row>
            <Row label="Liquidity provider fee">0.3% of the input</Row>
            <Row label="Pool reserves">
              {reserves && to ? `${formatUnits(reserves.a, from.decimals, 4)} ${from.symbol} / ${formatUnits(reserves.b, to.decimals, 4)} ${to.symbol}` : null}
            </Row>
            <Row label="Router">
              <a href={`${explorerUrl}/address/${router}`} target="_blank" rel="noreferrer" style={{fontSize: 11}}>
                {router}
              </a>
            </Row>
          </dl>

          <Banner kind="info">
            Prices come from pool reserves alone. A large trade moves the price against you — that
            is how a constant-product AMM works, not a fault. The quote above already includes it.
          </Banner>
        </div>
      </div>
    </>
  );
}
