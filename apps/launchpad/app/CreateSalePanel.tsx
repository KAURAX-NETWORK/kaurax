"use client";

/**
 * Sale creation, and the creator's own management view.
 *
 * The two-step shape — create, then escrow the tokens — is the contract's, not a UI
 * choice: a sale cannot accept KAX until its full allocation is held by the launchpad. The
 * form makes that explicit rather than hiding it behind one button, because a creator who
 * does not understand that their tokens are locked will be surprised later.
 *
 * Every derived figure below (tokens required, what a buyer receives) is computed with the
 * same integer arithmetic the contract uses, so the preview cannot disagree with reality.
 */
import {useCallback, useEffect, useState} from "react";
import type {Abi} from "viem";
import {erc20Abi, launchpadAbi, SALE_STATUS} from "@kaurax/types";
import {Badge, Banner, Empty, Row, Spinner, formatUnits, isAddress, parseUnits, shortHash, type WalletState} from "@kaurax/ui";

interface Props {
  launchpad: string;
  explorerUrl: string;
  wallet: WalletState;
  client: ReturnType<typeof import("viem").createPublicClient>;
  sendTx: (to: string, abi: Abi, fn: string, args: unknown[], value?: bigint) => Promise<string>;
  onChanged: () => void;
}

interface MySale {
  id: number;
  token: string;
  symbol: string;
  decimals: number;
  tokensForSale: bigint;
  raisedWei: bigint;
  softCapWei: bigint;
  status: string;
  tokensDeposited: boolean;
  finalised: boolean;
  creatorPaid: boolean;
  cancelled: boolean;
  startsAt: bigint;
}

export function CreateSalePanel({launchpad, explorerUrl, wallet, client, sendTx, onChanged}: Props) {
  const [token, setToken] = useState("");
  const [tokenMeta, setTokenMeta] = useState<{symbol: string; decimals: number; balance: bigint} | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [rate, setRate] = useState("1000");
  const [softCap, setSoftCap] = useState("2");
  const [hardCap, setHardCap] = useState("10");
  const [minContribution, setMinContribution] = useState("0.1");
  const [maxContribution, setMaxContribution] = useState("5");
  const [startsInMinutes, setStartsInMinutes] = useState(10);
  const [durationHours, setDurationHours] = useState(24);
  const [metadataURI, setMetadataURI] = useState("");

  const [mySales, setMySales] = useState<MySale[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ------------------------------------------------------- token lookup --
  useEffect(() => {
    setTokenMeta(null);
    setTokenError(null);
    if (!isAddress(token)) return;

    void (async () => {
      try {
        const [symbol, decimals] = (await Promise.all([
          client.readContract({address: token as `0x${string}`, abi: erc20Abi, functionName: "symbol"}),
          client.readContract({address: token as `0x${string}`, abi: erc20Abi, functionName: "decimals"}),
        ])) as [string, number];

        const balance = wallet.account
          ? ((await client.readContract({
              address: token as `0x${string}`,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [wallet.account],
            })) as bigint)
          : 0n;

        setTokenMeta({symbol, decimals: Number(decimals), balance});
      } catch {
        setTokenError("No ERC-20 token responds at that address on KAURAX.");
      }
    })();
  }, [token, client, wallet.account]);

  // --------------------------------------------------------- my sales --
  const loadMine = useCallback(async () => {
    if (!wallet.account) {
      setMySales(null);
      return;
    }
    try {
      const count = Number(
        await client.readContract({address: launchpad as `0x${string}`, abi: launchpadAbi, functionName: "saleCount"}),
      );

      const mine: MySale[] = [];
      for (let i = count - 1; i >= 0; i--) {
        const sale = (await client.readContract({
          address: launchpad as `0x${string}`,
          abi: launchpadAbi,
          functionName: "getSale",
          args: [BigInt(i)],
        })) as {
          creator: string; token: string; tokensForSale: bigint; raisedWei: bigint; softCapWei: bigint;
          tokensDeposited: boolean; finalised: boolean; creatorPaid: boolean; cancelled: boolean; startsAt: bigint;
        };
        if (sale.creator.toLowerCase() !== wallet.account.toLowerCase()) continue;

        const statusIndex = Number(
          await client.readContract({
            address: launchpad as `0x${string}`,
            abi: launchpadAbi,
            functionName: "statusOf",
            args: [BigInt(i)],
          }),
        );

        let symbol = shortHash(sale.token, 6, 4);
        let decimals = 18;
        try {
          symbol = (await client.readContract({address: sale.token as `0x${string}`, abi: erc20Abi, functionName: "symbol"})) as string;
          decimals = Number(await client.readContract({address: sale.token as `0x${string}`, abi: erc20Abi, functionName: "decimals"}));
        } catch {
          // Leave the fallback: a token without metadata is not given an invented name.
        }

        mine.push({
          id: i,
          token: sale.token,
          symbol,
          decimals,
          tokensForSale: sale.tokensForSale,
          raisedWei: sale.raisedWei,
          softCapWei: sale.softCapWei,
          status: SALE_STATUS[statusIndex] ?? "Unknown",
          tokensDeposited: sale.tokensDeposited,
          finalised: sale.finalised,
          creatorPaid: sale.creatorPaid,
          cancelled: sale.cancelled,
          startsAt: sale.startsAt,
        });
      }
      setMySales(mine);
    } catch {
      setMySales(null);
    }
  }, [wallet.account, client, launchpad]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // ------------------------------------------------------- derived form --
  const rateWei = tokenMeta ? parseUnits(rate, tokenMeta.decimals) : null;
  const hardCapWei = parseUnits(hardCap);
  const softCapWei = parseUnits(softCap);

  // Mirrors the contract exactly: tokensForSale must cover (hardCap * rate) / 1e18.
  const tokensRequired =
    rateWei !== null && hardCapWei !== null ? (hardCapWei * rateWei) / 10n ** 18n : null;

  const enoughTokens =
    tokensRequired !== null && tokenMeta !== null && tokenMeta.balance >= tokensRequired;

  const formIssue = (): string | null => {
    if (!isAddress(token)) return "Enter the address of the ERC-20 being sold.";
    if (tokenError) return tokenError;
    if (!tokenMeta) return "Waiting for token details…";
    if (rateWei === null || rateWei <= 0n) return "Enter how many tokens 1 KAX buys.";
    if (softCapWei === null || softCapWei <= 0n) return "Enter a soft cap greater than zero.";
    if (hardCapWei === null || hardCapWei < softCapWei) return "The hard cap must be at least the soft cap.";
    const minW = parseUnits(minContribution);
    const maxW = parseUnits(maxContribution);
    if (maxW === null || maxW <= 0n) return "Enter a maximum contribution.";
    if (minW === null || maxW < minW) return "The maximum contribution must be at least the minimum.";
    if (!enoughTokens) {
      return `This address holds ${formatUnits(tokenMeta.balance, tokenMeta.decimals)} ${tokenMeta.symbol}, but the sale needs ${formatUnits(tokensRequired!, tokenMeta.decimals)} to cover the hard cap.`;
    }
    return null;
  };
  const issue = formIssue();

  // ------------------------------------------------------------ actions --
  const create = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    try {
      // Timing is anchored to the chain's clock, not the browser's — the contract compares
      // against block.timestamp, and drift would make a valid start time look like the past.
      const latest = await client.getBlock({blockTag: "latest"});
      const startsAt = latest.timestamp + BigInt(startsInMinutes * 60);
      const endsAt = startsAt + BigInt(durationHours * 3600);

      const hash = await sendTx(launchpad, launchpadAbi as unknown as Abi, "createSale", [
        token as `0x${string}`,
        rateWei!,
        tokensRequired!,
        softCapWei!,
        hardCapWei!,
        parseUnits(minContribution)!,
        parseUnits(maxContribution)!,
        startsAt,
        endsAt,
        metadataURI,
      ]);

      setSuccess(`Sale created — ${shortHash(hash)}. Escrow the tokens below to open it.`);
      await loadMine();
      onChanged();
    } catch (err) {
      const e = err as {code?: number; message?: string};
      setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? "Creating the sale failed."));
    } finally {
      setBusy(false);
    }
  }, [issue, client, startsInMinutes, durationHours, sendTx, launchpad, token, rateWei, tokensRequired, softCapWei, hardCapWei, minContribution, maxContribution, metadataURI, loadMine, onChanged]);

  const deposit = useCallback(
    async (sale: MySale) => {
      setError(null);
      setSuccess(null);
      setBusy(true);
      try {
        const allowance = (await client.readContract({
          address: sale.token as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.account!, launchpad as `0x${string}`],
        })) as bigint;

        if (allowance < sale.tokensForSale) {
          await sendTx(sale.token, erc20Abi as unknown as Abi, "approve", [launchpad as `0x${string}`, sale.tokensForSale]);
        }

        const hash = await sendTx(launchpad, launchpadAbi as unknown as Abi, "depositTokens", [BigInt(sale.id)]);
        setSuccess(`Tokens escrowed for sale #${sale.id} — ${shortHash(hash)}`);
        await loadMine();
        onChanged();
      } catch (err) {
        const e = err as {code?: number; message?: string};
        setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? "The deposit failed."));
      } finally {
        setBusy(false);
      }
    },
    [client, wallet.account, launchpad, sendTx, loadMine, onChanged],
  );

  const simpleAction = useCallback(
    async (saleId: number, fn: "cancelSale" | "withdrawRaise" | "finalise", label: string) => {
      setError(null);
      setSuccess(null);
      setBusy(true);
      try {
        const hash = await sendTx(launchpad, launchpadAbi as unknown as Abi, fn, [BigInt(saleId)]);
        setSuccess(`${label} — ${shortHash(hash)}`);
        await loadMine();
        onChanged();
      } catch (err) {
        const e = err as {code?: number; message?: string};
        setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? `${label} failed.`));
      } finally {
        setBusy(false);
      }
    },
    [sendTx, launchpad, loadMine, onChanged],
  );

  // --------------------------------------------------------------- view --
  if (!wallet.account) {
    return <Empty>Connect a wallet to create a token sale.</Empty>;
  }

  return (
    <>
      {error ? <div className="error-text">{error}</div> : null}
      {success ? <Banner kind="ok">{success}</Banner> : null}

      <div className="grid cols-2">
        <div className="card">
          <h2>Create a sale</h2>

          <div className="field">
            <label>Token being sold</label>
            <input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x…" spellCheck={false} />
            {tokenMeta ? (
              <div className="hint">
                {tokenMeta.symbol} · {tokenMeta.decimals} decimals · you hold{" "}
                {formatUnits(tokenMeta.balance, tokenMeta.decimals)}
              </div>
            ) : tokenError ? (
              <div className="error-text">{tokenError}</div>
            ) : null}
          </div>

          <div className="field">
            <label>Price — tokens per 1 KAX</label>
            <input className="mono" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field-row">
            <div className="field">
              <label>Soft cap (KAX)</label>
              <input className="mono" value={softCap} onChange={(e) => setSoftCap(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label>Hard cap (KAX)</label>
              <input className="mono" value={hardCap} onChange={(e) => setHardCap(e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Min per buyer (KAX)</label>
              <input className="mono" value={minContribution} onChange={(e) => setMinContribution(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label>Max per buyer (KAX)</label>
              <input className="mono" value={maxContribution} onChange={(e) => setMaxContribution(e.target.value)} inputMode="decimal" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Opens in (minutes)</label>
              <input
                className="mono"
                type="number"
                min={1}
                value={startsInMinutes}
                onChange={(e) => setStartsInMinutes(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="field">
              <label>Runs for (hours)</label>
              <input
                className="mono"
                type="number"
                min={1}
                value={durationHours}
                onChange={(e) => setDurationHours(Math.max(1, Number(e.target.value)))}
              />
            </div>
          </div>

          <div className="field">
            <label>Details URI (optional)</label>
            <input value={metadataURI} onChange={(e) => setMetadataURI(e.target.value)} placeholder="ipfs://… or https://…" />
          </div>

          <button
            className="primary"
            style={{width: "100%"}}
            disabled={busy || issue !== null || !wallet.onKaurax}
            onClick={() => void create()}
          >
            {busy ? <Spinner /> : null} {wallet.onKaurax ? "Create sale" : "Switch to KAURAX"}
          </button>

          {issue && isAddress(token) ? <div className="hint" style={{marginTop: 8}}>{issue}</div> : null}
        </div>

        <div className="card">
          <h2>What this sale will do</h2>
          <dl className="kv">
            <Row label="Tokens to escrow">
              {tokensRequired !== null && tokenMeta
                ? `${formatUnits(tokensRequired, tokenMeta.decimals)} ${tokenMeta.symbol}`
                : null}
            </Row>
            <Row label="A 1 KAX buyer receives">
              {rateWei !== null && tokenMeta ? `${formatUnits(rateWei, tokenMeta.decimals)} ${tokenMeta.symbol}` : null}
            </Row>
            <Row label="Succeeds at">{softCapWei !== null ? `${formatUnits(softCapWei)} KAX raised` : null}</Row>
            <Row label="Closes early at">{hardCapWei !== null ? `${formatUnits(hardCapWei)} KAX raised` : null}</Row>
          </dl>

          <Banner kind="warn">
            <strong>Two steps.</strong> Creating the sale does not open it — the full allocation
            must be escrowed first, and until then the sale accepts nothing. Once escrowed, you
            cannot cancel after the opening time, cannot change the terms, and cannot touch the
            KAX until the sale ends and is finalised.
          </Banner>

          <Banner kind="info">
            If the soft cap is missed, every contributor withdraws in full and you receive
            nothing — your tokens come back instead. That is enforced by the contract, not by
            this page.
          </Banner>
        </div>
      </div>

      <div style={{marginTop: 26}}>
        <div className="section-head"><h2>Your sales</h2></div>
        {mySales === null ? (
          <Empty>Could not read your sales from the chain.</Empty>
        ) : mySales.length === 0 ? (
          <Empty>You have not created any sales on KAURAX.</Empty>
        ) : (
          <div className="stack-gap">
            {mySales.map((s) => {
              const succeeded = s.raisedWei >= s.softCapWei;
              return (
                <div className="card" key={s.id}>
                  <div className="row-gap" style={{marginBottom: 10}}>
                    <strong>Sale #{s.id} — {s.symbol}</strong>
                    <Badge
                      kind={
                        s.status === "Live" ? "accent"
                          : s.status === "Succeeded" ? "ok"
                          : s.status === "Failed" || s.status === "Cancelled" ? "err"
                          : "warn"
                      }
                    >
                      {s.status}
                    </Badge>
                    <span className="right" />
                    <a className="mono-sm" href={`${explorerUrl}/address/${s.token}`} target="_blank" rel="noreferrer">
                      {shortHash(s.token, 8, 6)}
                    </a>
                  </div>

                  <div className="row-gap mono-sm dim" style={{marginBottom: 12}}>
                    <span>{formatUnits(s.raisedWei)} KAX raised</span>
                    <span>·</span>
                    <span>soft cap {formatUnits(s.softCapWei)} {succeeded ? "(met)" : "(not met)"}</span>
                    <span>·</span>
                    <span>{formatUnits(s.tokensForSale, s.decimals)} {s.symbol} allocated</span>
                  </div>

                  <div className="row-gap">
                    {!s.tokensDeposited && !s.cancelled ? (
                      <button className="primary" disabled={busy} onClick={() => void deposit(s)}>
                        {busy ? <Spinner /> : null} Escrow {formatUnits(s.tokensForSale, s.decimals, 4)} {s.symbol}
                      </button>
                    ) : null}

                    {!s.cancelled && !s.finalised && s.status === "Pending" ? (
                      <button disabled={busy} onClick={() => void simpleAction(s.id, "cancelSale", `Cancelled sale #${s.id}`)}>
                        Cancel
                      </button>
                    ) : null}

                    {!s.cancelled && !s.finalised && s.tokensDeposited && s.status === "Funded" ? (
                      <button disabled={busy} onClick={() => void simpleAction(s.id, "cancelSale", `Cancelled sale #${s.id}`)}>
                        Cancel before it opens
                      </button>
                    ) : null}

                    {!s.finalised && !s.cancelled && (s.status === "Succeeded" || s.status === "Failed") ? (
                      <button disabled={busy} onClick={() => void simpleAction(s.id, "finalise", `Finalised sale #${s.id}`)}>
                        Finalise
                      </button>
                    ) : null}

                    {s.finalised && succeeded && !s.creatorPaid ? (
                      <button className="primary" disabled={busy} onClick={() => void simpleAction(s.id, "withdrawRaise", `Withdrew ${formatUnits(s.raisedWei)} KAX`)}>
                        {busy ? <Spinner /> : null} Withdraw {formatUnits(s.raisedWei)} KAX
                      </button>
                    ) : null}

                    {s.creatorPaid ? <span className="dim mono-sm">raise withdrawn</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
