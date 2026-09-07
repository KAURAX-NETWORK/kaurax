"use client";

/**
 * KAURAX Launchpad.
 *
 * Every figure — raised, caps, allocation, status — is read from the contract. There is no
 * curated project list and no aggregate "total raised" statistic invented across sales;
 * what is shown is what the chain holds.
 */
import {useCallback, useEffect, useMemo, useState} from "react";
import {createPublicClient, defineChain, encodeFunctionData, http, type Abi} from "viem";
import {erc20Abi, launchpadAbi, SALE_STATUS} from "@kaurax/types";
import {Badge, Banner, Empty, Row, Spinner, formatUnits, parseUnits, shortHash, useWallet} from "@kaurax/ui";
import {CreateSalePanel} from "./CreateSalePanel";

interface Props {
  launchpad: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
}

interface Sale {
  id: number;
  creator: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokensPerKax: bigint;
  softCapWei: bigint;
  hardCapWei: bigint;
  minContributionWei: bigint;
  maxContributionWei: bigint;
  startsAt: bigint;
  endsAt: bigint;
  raisedWei: bigint;
  finalised: boolean;
  status: string;
  metadataURI: string;
  myContribution: bigint;
  myAllocation: bigint;
  myClaimed: boolean;
}

export function LaunchpadClient({launchpad, rpcUrl, chainId, explorerUrl}: Props) {
  const wallet = useWallet({chainId, chainName: "KAURAX", rpcUrl, explorerUrl});

  const client = useMemo(() => {
    const chain = defineChain({
      id: chainId,
      name: "KAURAX",
      nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
      rpcUrls: {default: {http: [rpcUrl]}},
    });
    return createPublicClient({chain, transport: http(rpcUrl)});
  }, [chainId, rpcUrl]);

  const [tab, setTab] = useState<"sales" | "create">("sales");
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const count = Number(
        await client.readContract({address: launchpad as `0x${string}`, abi: launchpadAbi, functionName: "saleCount"}),
      );

      const out: Sale[] = [];
      for (let i = 0; i < count; i++) {
        const raw = (await client.readContract({
          address: launchpad as `0x${string}`,
          abi: launchpadAbi,
          functionName: "getSale",
          args: [BigInt(i)],
        })) as {
          creator: string; token: string; tokensPerKax: bigint; tokensForSale: bigint;
          softCapWei: bigint; hardCapWei: bigint; minContributionWei: bigint; maxContributionWei: bigint;
          startsAt: bigint; endsAt: bigint; raisedWei: bigint; tokensSold: bigint;
          tokensDeposited: boolean; finalised: boolean; creatorPaid: boolean; cancelled: boolean;
          metadataURI: string;
        };

        const statusIndex = Number(
          await client.readContract({
            address: launchpad as `0x${string}`,
            abi: launchpadAbi,
            functionName: "statusOf",
            args: [BigInt(i)],
          }),
        );

        // Token metadata comes from the token itself; a token without it stays unnamed
        // rather than being given a made-up label.
        let symbol = shortHash(raw.token, 6, 4);
        let decimals = 18;
        try {
          symbol = (await client.readContract({
            address: raw.token as `0x${string}`,
            abi: erc20Abi,
            functionName: "symbol",
          })) as string;
          decimals = Number(
            await client.readContract({address: raw.token as `0x${string}`, abi: erc20Abi, functionName: "decimals"}),
          );
        } catch {
          // Leave the fallback in place.
        }

        let myContribution = 0n;
        let myAllocation = 0n;
        let myClaimed = false;
        if (wallet.account) {
          [myContribution, myAllocation, myClaimed] = (await Promise.all([
            client.readContract({address: launchpad as `0x${string}`, abi: launchpadAbi, functionName: "contributionOf", args: [BigInt(i), wallet.account]}),
            client.readContract({address: launchpad as `0x${string}`, abi: launchpadAbi, functionName: "allocationOf", args: [BigInt(i), wallet.account]}),
            client.readContract({address: launchpad as `0x${string}`, abi: launchpadAbi, functionName: "claimed", args: [BigInt(i), wallet.account]}),
          ])) as [bigint, bigint, boolean];
        }

        out.push({
          id: i,
          creator: raw.creator,
          token: raw.token,
          tokenSymbol: symbol,
          tokenDecimals: decimals,
          tokensPerKax: raw.tokensPerKax,
          softCapWei: raw.softCapWei,
          hardCapWei: raw.hardCapWei,
          minContributionWei: raw.minContributionWei,
          maxContributionWei: raw.maxContributionWei,
          startsAt: raw.startsAt,
          endsAt: raw.endsAt,
          raisedWei: raw.raisedWei,
          finalised: raw.finalised,
          status: SALE_STATUS[statusIndex] ?? "Unknown",
          metadataURI: raw.metadataURI,
          myContribution,
          myAllocation,
          myClaimed,
        });
      }
      setSales(out.reverse());
    } catch {
      setSales(null);
    } finally {
      setLoading(false);
    }
  }, [client, launchpad, wallet.account]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Send a contract call and wait for its receipt. Shared with the create panel. */
  const sendTx = useCallback(
    async (to: string, abi: Abi, fn: string, args: unknown[], value = 0n): Promise<string> => {
      const hash = await wallet.request<string>("eth_sendTransaction", [
        {from: wallet.account, to, data: encodeFunctionData({abi, functionName: fn, args}), value: `0x${value.toString(16)}`},
      ]);
      const receipt = await client.waitForTransactionReceipt({hash: hash as `0x${string}`, timeout: 90_000});
      if (receipt.status !== "success") throw new Error("The transaction was included but reverted.");
      return hash;
    },
    [wallet, client],
  );

  const act = useCallback(
    async (saleId: number, data: `0x${string}`, value: bigint, description: string) => {
      setError(null);
      setSuccess(null);
      setBusy(saleId);
      try {
        const hash = await wallet.request<string>("eth_sendTransaction", [
          {from: wallet.account, to: launchpad, data, value: `0x${value.toString(16)}`},
        ]);
        const receipt = await client.waitForTransactionReceipt({hash: hash as `0x${string}`, timeout: 90_000});
        if (receipt.status !== "success") {
          setError("The transaction was included but reverted.");
          return;
        }
        setSuccess(`${description} — ${shortHash(hash)}`);
        await load();
      } catch (err) {
        const e = err as {code?: number; message?: string};
        setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? "The transaction failed."));
      } finally {
        setBusy(null);
      }
    },
    [wallet, launchpad, client, load],
  );

  if (loading) return <div className="card center" style={{padding: 40}}><Spinner /> Loading sales…</div>;

  if (sales === null) {
    return <Banner kind="err">Could not read the launchpad contract at {launchpad}.</Banner>;
  }

  const tabs = (
    <div className="row-gap" style={{marginBottom: 16}}>
      <button className={tab === "sales" ? "primary" : undefined} onClick={() => setTab("sales")}>
        Sales {sales.length > 0 ? `(${sales.length})` : ""}
      </button>
      <button className={tab === "create" ? "primary" : undefined} onClick={() => setTab("create")}>
        Create a sale
      </button>
    </div>
  );

  return (
    <>
      <div className="wallet-bar" style={{marginBottom: 18}}>
        {wallet.account ? (
          <>
            <Badge kind="ok">connected</Badge>
            <span className="addr">{shortHash(wallet.account, 8, 6)}</span>
            <span className="spacer" />
            {!wallet.onKaurax ? <button onClick={() => void wallet.switchToKaurax()}>Switch to KAURAX</button> : null}
          </>
        ) : (
          <>
            <span className="dim">Connect a wallet to take part in a sale.</span>
            <span className="spacer" />
            <button className="primary" onClick={() => void wallet.connect()}>Connect wallet</button>
          </>
        )}
      </div>

      {tabs}

      {tab === "create" ? (
        <CreateSalePanel
          launchpad={launchpad}
          explorerUrl={explorerUrl}
          wallet={wallet}
          client={client}
          sendTx={sendTx}
          onChanged={() => void load()}
        />
      ) : (
      <>
      {error ? <div className="error-text">{error}</div> : null}
      {success ? <Banner kind="ok">{success}</Banner> : null}

      {sales.length === 0 ? (
        <Empty>
          No token sales have been created on KAURAX yet. Anyone can create one by calling{" "}
          <code>createSale</code> on the launchpad contract.
        </Empty>
      ) : (
        <div className="stack-gap">
          {sales.map((s) => {
            const progress = s.hardCapWei > 0n ? Number((s.raisedWei * 100n) / s.hardCapWei) : 0;
            const softMet = s.raisedWei >= s.softCapWei;
            const canContribute = s.status === "Live" && wallet.account !== null && wallet.onKaurax;
            const canClaim = s.status === "Succeeded" && s.finalised && s.myContribution > 0n && !s.myClaimed;
            const canRefund = s.status === "Failed" && s.finalised && s.myContribution > 0n && !s.myClaimed;
            const canFinalise = !s.finalised && (s.status === "Succeeded" || s.status === "Failed");

            return (
              <div className="card" key={s.id}>
                <div className="row-gap" style={{marginBottom: 12}}>
                  <h2 style={{margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 16, color: "var(--text)"}}>
                    Sale #{s.id} — {s.tokenSymbol}
                  </h2>
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
                  <a href={`${explorerUrl}/address/${s.token}`} target="_blank" rel="noreferrer" className="mono-sm">
                    {shortHash(s.token, 8, 6)}
                  </a>
                </div>

                <div className="progress" style={{marginBottom: 6}}>
                  <span style={{width: `${Math.min(progress, 100)}%`}} />
                </div>
                <div className="row-gap mono-sm dim" style={{marginBottom: 14}}>
                  <span>{formatUnits(s.raisedWei)} KAX raised</span>
                  <span>·</span>
                  <span>soft {formatUnits(s.softCapWei)} {softMet ? "(met)" : "(not met)"}</span>
                  <span>·</span>
                  <span>hard {formatUnits(s.hardCapWei)}</span>
                </div>

                <div className="grid cols-2">
                  <dl className="kv">
                    <Row label="Price">{`1 KAX = ${formatUnits(s.tokensPerKax, s.tokenDecimals, 4)} ${s.tokenSymbol}`}</Row>
                    <Row label="Contribution range">
                      {`${formatUnits(s.minContributionWei)} – ${formatUnits(s.maxContributionWei)} KAX`}
                    </Row>
                    <Row label="Opens">{new Date(Number(s.startsAt) * 1000).toLocaleString()}</Row>
                    <Row label="Closes">{new Date(Number(s.endsAt) * 1000).toLocaleString()}</Row>
                    <Row label="Creator">{shortHash(s.creator, 8, 6)}</Row>
                    <Row label="Details">{s.metadataURI || null}</Row>
                  </dl>

                  <div>
                    <dl className="kv">
                      <Row label="Your contribution">
                        {wallet.account ? `${formatUnits(s.myContribution)} KAX` : null}
                      </Row>
                      <Row label="Your allocation">
                        {wallet.account ? `${formatUnits(s.myAllocation, s.tokenDecimals)} ${s.tokenSymbol}` : null}
                      </Row>
                      <Row label="Settled">{wallet.account ? (s.myClaimed ? "yes" : "no") : null}</Row>
                    </dl>

                    {canContribute ? (
                      <div className="field-row" style={{marginTop: 12}}>
                        <div className="field">
                          <label>Contribute (KAX)</label>
                          <input
                            className="mono"
                            value={amounts[s.id] ?? ""}
                            onChange={(e) => setAmounts({...amounts, [s.id]: e.target.value})}
                            placeholder="0.0"
                            inputMode="decimal"
                          />
                        </div>
                        <button
                          className="primary"
                          disabled={busy === s.id}
                          onClick={() => {
                            const wei = parseUnits(amounts[s.id] ?? "");
                            if (wei === null || wei <= 0n) {
                              setError("Enter a positive amount of KAX.");
                              return;
                            }
                            void act(
                              s.id,
                              encodeFunctionData({abi: launchpadAbi, functionName: "contribute", args: [BigInt(s.id)]}),
                              wei,
                              `Contributed to sale #${s.id}`,
                            );
                          }}
                        >
                          {busy === s.id ? <Spinner /> : null} Contribute
                        </button>
                      </div>
                    ) : null}

                    <div className="row-gap" style={{marginTop: 12}}>
                      {canFinalise ? (
                        <button
                          disabled={busy === s.id}
                          onClick={() =>
                            void act(
                              s.id,
                              encodeFunctionData({abi: launchpadAbi, functionName: "finalise", args: [BigInt(s.id)]}),
                              0n,
                              `Finalised sale #${s.id}`,
                            )
                          }
                        >
                          Finalise
                        </button>
                      ) : null}

                      {canClaim ? (
                        <button
                          className="primary"
                          disabled={busy === s.id}
                          onClick={() =>
                            void act(
                              s.id,
                              encodeFunctionData({abi: launchpadAbi, functionName: "claimTokens", args: [BigInt(s.id)]}),
                              0n,
                              `Claimed ${formatUnits(s.myAllocation, s.tokenDecimals)} ${s.tokenSymbol}`,
                            )
                          }
                        >
                          {busy === s.id ? <Spinner /> : null} Claim {formatUnits(s.myAllocation, s.tokenDecimals, 4)} {s.tokenSymbol}
                        </button>
                      ) : null}

                      {canRefund ? (
                        <button
                          className="primary"
                          disabled={busy === s.id}
                          onClick={() =>
                            void act(
                              s.id,
                              encodeFunctionData({abi: launchpadAbi, functionName: "refund", args: [BigInt(s.id)]}),
                              0n,
                              `Refunded ${formatUnits(s.myContribution)} KAX`,
                            )
                          }
                        >
                          {busy === s.id ? <Spinner /> : null} Refund {formatUnits(s.myContribution)} KAX
                        </button>
                      ) : null}
                    </div>

                    {s.status === "Failed" ? (
                      <div className="hint" style={{marginTop: 10}}>
                        The soft cap was not met, so every contributor can withdraw in full and the
                        creator receives nothing.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Banner kind="info">
        Anyone may finalise a sale once it has ended — a creator who walks away cannot strand
        contributors&apos; refunds. Tokens are escrowed before a sale opens, so a sale can never
        raise KAX for tokens that do not exist.
      </Banner>
      </>
      )}
    </>
  );
}
