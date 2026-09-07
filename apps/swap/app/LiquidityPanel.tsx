"use client";

/**
 * Liquidity provision.
 *
 * Two things make this safe to use rather than merely functional:
 *
 *   * **The second amount is derived from the pool, not typed by the user.** For an
 *     existing pool the router only accepts a deposit at the current reserve ratio, so a
 *     mismatched pair would silently return the excess. Quoting the counterpart here means
 *     what you see deposited is what is deposited.
 *   * **Minimums are enforced on chain.** Both add and remove pass amountMin values derived
 *     from the slippage tolerance, so a pool that moves between quoting and execution
 *     reverts rather than filling at a worse ratio.
 */
import {useCallback, useEffect, useState} from "react";
import type {Abi} from "viem";
import {swapFactoryAbi, swapPairAbi, swapRouterAbi, erc20Abi} from "@kaurax/types";
import {Badge, Banner, Empty, Row, Spinner, formatUnits, parseUnits, shortHash, type WalletState} from "@kaurax/ui";
import {NATIVE, readableError, type TokenInfo} from "./useSwapChain";

const ZERO = "0x0000000000000000000000000000000000000000";

interface Position {
  pair: string;
  token: TokenInfo;
  lpBalance: bigint;
  lpTotalSupply: bigint;
  /** The caller's share of each side, at current reserves. */
  shareKax: bigint;
  shareToken: bigint;
  sharePercent: number;
}

interface Props {
  router: string;
  factory: string;
  wkax: string;
  explorerUrl: string;
  wallet: WalletState;
  tokens: TokenInfo[];
  tokenOf: (v: string) => TokenInfo;
  client: ReturnType<typeof import("viem").createPublicClient>;
  chainDeadline: (seconds?: number) => Promise<bigint>;
  ensureAllowance: (wallet: WalletState, token: string, spender: string, amount: bigint) => Promise<void>;
  sendTx: (
    wallet: WalletState,
    to: string,
    abi: Abi,
    fn: string,
    args: unknown[],
    value?: bigint,
  ) => Promise<string>;
}

export function LiquidityPanel(props: Props) {
  const {router, factory, wkax, explorerUrl, wallet, tokens, tokenOf, client, chainDeadline, ensureAllowance, sendTx} =
    props;

  const [mode, setMode] = useState<"add" | "remove">("add");
  const [token, setToken] = useState<string>(tokens[0]?.address ?? "");
  const [amountKax, setAmountKax] = useState("");
  const [amountToken, setAmountToken] = useState("");
  const [removePercent, setRemovePercent] = useState(100);
  const [slippage, setSlippage] = useState(0.5);

  const [positions, setPositions] = useState<Position[] | null>(null);
  const [reserves, setReserves] = useState<{kax: bigint; token: bigint} | null>(null);
  const [poolExists, setPoolExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token && tokens.length > 0) setToken(tokens[0]!.address);
  }, [tokens, token]);

  // ------------------------------------------------------------ reading --

  /** Every pool the connected account holds LP tokens in. */
  const loadPositions = useCallback(async () => {
    if (!wallet.account) {
      setPositions(null);
      return;
    }
    try {
      const found: Position[] = [];
      for (const t of tokens) {
        const pair = (await client.readContract({
          address: factory as `0x${string}`,
          abi: swapFactoryAbi,
          functionName: "getPair",
          args: [wkax as `0x${string}`, t.address as `0x${string}`],
        })) as string;
        if (pair === ZERO) continue;

        const [lp, supply, r] = (await Promise.all([
          client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "balanceOf", args: [wallet.account]}),
          client.readContract({address: pair as `0x${string}`, abi: swapPairAbi, functionName: "totalSupply"}),
          client.readContract({
            address: router as `0x${string}`,
            abi: swapRouterAbi,
            functionName: "getReserves",
            args: [wkax as `0x${string}`, t.address as `0x${string}`],
          }),
        ])) as [bigint, bigint, readonly [bigint, bigint]];

        if (lp === 0n) continue;

        found.push({
          pair,
          token: t,
          lpBalance: lp,
          lpTotalSupply: supply,
          shareKax: supply > 0n ? (r[0] * lp) / supply : 0n,
          shareToken: supply > 0n ? (r[1] * lp) / supply : 0n,
          sharePercent: supply > 0n ? Number((lp * 10_000n) / supply) / 100 : 0,
        });
      }
      setPositions(found);
    } catch {
      setPositions(null);
    }
  }, [wallet.account, tokens, client, factory, router, wkax]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  /** Reserves for the selected pool, and whether it exists at all. */
  const loadReserves = useCallback(async () => {
    if (!token) return;
    try {
      const pair = (await client.readContract({
        address: factory as `0x${string}`,
        abi: swapFactoryAbi,
        functionName: "getPair",
        args: [wkax as `0x${string}`, token as `0x${string}`],
      })) as string;

      if (pair === ZERO) {
        setPoolExists(false);
        setReserves(null);
        return;
      }
      setPoolExists(true);

      const r = (await client.readContract({
        address: router as `0x${string}`,
        abi: swapRouterAbi,
        functionName: "getReserves",
        args: [wkax as `0x${string}`, token as `0x${string}`],
      })) as readonly [bigint, bigint];
      setReserves({kax: r[0], token: r[1]});
    } catch {
      setReserves(null);
      setPoolExists(null);
    }
  }, [token, client, factory, router, wkax]);

  useEffect(() => {
    void loadReserves();
  }, [loadReserves]);

  // For an existing pool the ratio is fixed, so quote the counterpart rather than letting
  // the user type a pair the router would only partially accept.
  useEffect(() => {
    if (!reserves || reserves.kax === 0n) return;
    const t = tokenOf(token);
    const kaxWei = parseUnits(amountKax);
    if (kaxWei === null || kaxWei <= 0n) return;
    const needed = (kaxWei * reserves.token) / reserves.kax;
    setAmountToken(formatUnits(needed, t.decimals, 8).replace(/,/g, ""));
    // Only recompute when the KAX side or the pool changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountKax, reserves, token]);

  // ------------------------------------------------------------ writing --

  const addLiquidity = useCallback(async () => {
    setError(null);
    setSuccess(null);
    const t = tokenOf(token);
    const kaxWei = parseUnits(amountKax);
    const tokenWei = parseUnits(amountToken, t.decimals);

    if (kaxWei === null || kaxWei <= 0n || tokenWei === null || tokenWei <= 0n) {
      setError("Enter positive amounts for both sides.");
      return;
    }

    setBusy(true);
    try {
      await ensureAllowance(wallet, t.address, router, tokenWei);

      const bps = BigInt(Math.round((100 - slippage) * 100));
      const hash = await sendTx(
        wallet,
        router,
        swapRouterAbi as unknown as Abi,
        "addLiquidityKAX",
        [
          t.address as `0x${string}`,
          tokenWei,
          (tokenWei * bps) / 10_000n,
          (kaxWei * bps) / 10_000n,
          wallet.account,
          await chainDeadline(),
        ],
        kaxWei,
      );

      setSuccess(`Liquidity added — ${shortHash(hash)}`);
      setAmountKax("");
      setAmountToken("");
      await loadPositions();
      await loadReserves();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }, [token, amountKax, amountToken, slippage, wallet, router, tokenOf, ensureAllowance, sendTx, chainDeadline, loadPositions, loadReserves]);

  const removeLiquidity = useCallback(
    async (position: Position) => {
      setError(null);
      setSuccess(null);
      setBusy(true);
      try {
        const lp = (position.lpBalance * BigInt(removePercent)) / 100n;
        if (lp === 0n) {
          setError("Nothing to remove at that percentage.");
          return;
        }

        // The router pulls the LP tokens, so it needs an allowance on the pair itself.
        const allowance = (await client.readContract({
          address: position.pair as `0x${string}`,
          abi: swapPairAbi,
          functionName: "allowance",
          args: [wallet.account!, router as `0x${string}`],
        })) as bigint;

        if (allowance < lp) {
          await sendTx(wallet, position.pair, swapPairAbi as unknown as Abi, "approve", [router as `0x${string}`, lp]);
        }

        const bps = BigInt(Math.round((100 - slippage) * 100));
        const hash = await sendTx(wallet, router, swapRouterAbi as unknown as Abi, "removeLiquidityKAX", [
          position.token.address as `0x${string}`,
          lp,
          (position.shareToken * BigInt(removePercent) * bps) / (100n * 10_000n),
          (position.shareKax * BigInt(removePercent) * bps) / (100n * 10_000n),
          wallet.account,
          await chainDeadline(),
        ]);

        setSuccess(`Liquidity removed — ${shortHash(hash)}`);
        await loadPositions();
        await loadReserves();
      } catch (err) {
        setError(readableError(err));
      } finally {
        setBusy(false);
      }
    },
    [removePercent, slippage, wallet, router, client, sendTx, chainDeadline, loadPositions, loadReserves],
  );

  // --------------------------------------------------------------- view --

  const selected = token ? tokenOf(token) : null;

  if (tokens.length === 0) {
    return (
      <Empty>
        No ERC-20 tokens have been seen on KAURAX yet, so there is nothing to pair with KAX.
      </Empty>
    );
  }

  return (
    <>
      <div className="row-gap" style={{marginBottom: 16}}>
        <button className={mode === "add" ? "primary" : undefined} onClick={() => setMode("add")}>
          Add liquidity
        </button>
        <button className={mode === "remove" ? "primary" : undefined} onClick={() => setMode("remove")}>
          My positions {positions ? `(${positions.length})` : ""}
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
      {success ? <Banner kind="ok">{success}</Banner> : null}

      {mode === "add" ? (
        <div className="grid cols-2">
          <div className="card">
            <h2>Add liquidity</h2>

            <div className="field">
              <label>Pair</label>
              <div className="field-row">
                <input readOnly value="KAX" className="mono" style={{maxWidth: 90}} />
                <select value={token} onChange={(e) => setToken(e.target.value)}>
                  {tokens.map((t) => (
                    <option key={t.address} value={t.address}>{t.symbol}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>KAX amount</label>
              <input
                className="mono"
                value={amountKax}
                onChange={(e) => setAmountKax(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
              />
            </div>

            <div className="field">
              <label>{selected?.symbol ?? "Token"} amount</label>
              <input
                className="mono"
                value={amountToken}
                onChange={(e) => setAmountToken(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                readOnly={poolExists === true}
              />
              <div className="hint">
                {poolExists === false
                  ? "This pool does not exist yet. The amounts you choose set its starting price."
                  : "Fixed by the pool's current ratio — a mismatched deposit would be partly refunded."}
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
            </div>

            <button
              className="primary"
              style={{width: "100%"}}
              disabled={!wallet.account || !wallet.onKaurax || busy}
              onClick={() => void addLiquidity()}
            >
              {busy ? <Spinner /> : null}{" "}
              {!wallet.account ? "Connect a wallet" : !wallet.onKaurax ? "Switch to KAURAX" : "Add liquidity"}
            </button>
          </div>

          <div className="card">
            <h2>Pool</h2>
            <dl className="kv">
              <Row label="Status">
                {poolExists === null ? null : poolExists ? (
                  <Badge kind="ok">exists</Badge>
                ) : (
                  <Badge kind="warn">will be created</Badge>
                )}
              </Row>
              <Row label="KAX reserve">{reserves ? `${formatUnits(reserves.kax)} KAX` : null}</Row>
              <Row label={`${selected?.symbol ?? "Token"} reserve`}>
                {reserves && selected ? `${formatUnits(reserves.token, selected.decimals)} ${selected.symbol}` : null}
              </Row>
              <Row label="Current ratio">
                {reserves && reserves.kax > 0n && selected
                  ? `1 KAX = ${formatUnits((reserves.token * 10n ** 18n) / reserves.kax, selected.decimals, 6)} ${selected.symbol}`
                  : null}
              </Row>
            </dl>

            <Banner kind="info">
              Liquidity providers earn 0.3% of every trade through the pool, accrued into the
              reserves. Providing liquidity also exposes you to divergence loss when the price
              moves — that is inherent to a constant-product AMM, not a fault.
            </Banner>
          </div>
        </div>
      ) : (
        <>
          {!wallet.account ? (
            <Empty>Connect a wallet to see your liquidity positions.</Empty>
          ) : positions === null ? (
            <Empty>Could not read positions from the chain.</Empty>
          ) : positions.length === 0 ? (
            <Empty>This address holds no liquidity in any KAURAX pool.</Empty>
          ) : (
            <>
              <div className="card" style={{marginBottom: 14}}>
                <div className="field">
                  <label>Remove</label>
                  <div className="row-gap">
                    {[25, 50, 75, 100].map((p) => (
                      <button key={p} className={removePercent === p ? "primary" : undefined} onClick={() => setRemovePercent(p)}>
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="stack-gap">
                {positions.map((p) => (
                  <div className="card" key={p.pair}>
                    <div className="row-gap" style={{marginBottom: 12}}>
                      <h2 style={{margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 15, color: "var(--text)"}}>
                        KAX / {p.token.symbol}
                      </h2>
                      <Badge kind="accent">{p.sharePercent.toFixed(4)}% of pool</Badge>
                      <span className="right" />
                      <a href={`${explorerUrl}/address/${p.pair}`} target="_blank" rel="noreferrer" className="mono-sm">
                        {shortHash(p.pair, 8, 6)}
                      </a>
                    </div>

                    <div className="grid cols-2">
                      <dl className="kv">
                        <Row label="LP tokens">{formatUnits(p.lpBalance)}</Row>
                        <Row label="Your KAX">{`${formatUnits(p.shareKax)} KAX`}</Row>
                        <Row label={`Your ${p.token.symbol}`}>
                          {`${formatUnits(p.shareToken, p.token.decimals)} ${p.token.symbol}`}
                        </Row>
                      </dl>

                      <div>
                        <dl className="kv">
                          <Row label={`Removing ${removePercent}%`}>
                            {`${formatUnits((p.shareKax * BigInt(removePercent)) / 100n)} KAX + ${formatUnits((p.shareToken * BigInt(removePercent)) / 100n, p.token.decimals)} ${p.token.symbol}`}
                          </Row>
                        </dl>
                        <button
                          className="primary"
                          style={{width: "100%", marginTop: 12}}
                          disabled={!wallet.onKaurax || busy}
                          onClick={() => void removeLiquidity(p)}
                        >
                          {busy ? <Spinner /> : null} Remove {removePercent}%
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
