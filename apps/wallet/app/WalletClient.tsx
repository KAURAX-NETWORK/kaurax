"use client";

/**
 * The KAURAX wallet surface.
 *
 * Everything shown is read from the chain or the KAURAX API at request time. Balances are
 * never cached, and a send is only reported as successful once the transaction has a
 * receipt — the UI does not advance a step on optimism.
 */
import {useCallback, useEffect, useState} from "react";
import {
  Badge,
  Banner,
  Empty,
  NO_DATA,
  Row,
  Spinner,
  Stat,
  TestnetNotice,
  formatUnits,
  isAddress,
  parseUnits,
  shortHash,
  timeAgo,
  useWallet,
} from "@kaurax/ui";

interface Props {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  apiUrl: string;
  head: string | null;
}

interface TxRow {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  status: string;
  blockNumber: string | null;
  timestamp: string | null;
}

type SendStage =
  | {kind: "idle"}
  | {kind: "signing"}
  | {kind: "pending"; hash: string}
  | {kind: "confirmed"; hash: string; block: string}
  | {kind: "failed"; message: string};

export function WalletClient(props: Props) {
  const wallet = useWallet({
    chainId: props.chainId,
    chainName: props.networkName,
    rpcUrl: props.rpcUrl,
    explorerUrl: props.explorerUrl,
  });

  const [balance, setBalance] = useState<string | null>(null);
  const [nonce, setNonce] = useState<number | null>(null);
  const [history, setHistory] = useState<TxRow[] | null>(null);
  const [historyAvailable, setHistoryAvailable] = useState(true);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<SendStage>({kind: "idle"});

  // -------------------------------------------------------------- reads --
  const refresh = useCallback(async () => {
    if (!wallet.account) {
      setBalance(null);
      setNonce(null);
      setHistory(null);
      return;
    }
    try {
      const res = await fetch(`${props.apiUrl}/api/address/${wallet.account}`, {cache: "no-store"});
      if (res.ok) {
        const data = (await res.json()) as {balance: string; nonce: number; indexedHistoryAvailable: boolean};
        setBalance(data.balance);
        setNonce(data.nonce);
        setHistoryAvailable(data.indexedHistoryAvailable);
      }
    } catch {
      setBalance(null);
    }

    try {
      const res = await fetch(`${props.apiUrl}/api/address/${wallet.account}/transactions?limit=10`, {
        cache: "no-store",
      });
      setHistory(res.ok ? ((await res.json()) as {items: TxRow[]}).items : null);
    } catch {
      setHistory(null);
    }
  }, [wallet.account, props.apiUrl]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
  }, [refresh]);

  // -------------------------------------------------------------- send --
  const send = useCallback(async () => {
    setStage({kind: "idle"});

    if (!isAddress(to)) {
      setStage({kind: "failed", message: "Enter a valid recipient address."});
      return;
    }
    const wei = parseUnits(amount);
    if (wei === null || wei <= 0n) {
      setStage({kind: "failed", message: "Enter a positive amount of KAX."});
      return;
    }
    if (balance !== null && wei > BigInt(balance)) {
      setStage({kind: "failed", message: "That is more KAX than this account holds."});
      return;
    }

    setStage({kind: "signing"});
    try {
      const hash = await wallet.request<string>("eth_sendTransaction", [
        {from: wallet.account, to, value: `0x${wei.toString(16)}`},
      ]);
      setStage({kind: "pending", hash});

      // Poll for the receipt. The send is not reported as successful until one exists.
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const res = await fetch(props.rpcUrl, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionReceipt",
            params: [hash],
          }),
        });
        const body = (await res.json()) as {result?: {status: string; blockNumber: string} | null};
        if (body.result) {
          if (BigInt(body.result.status) === 1n) {
            setStage({kind: "confirmed", hash, block: BigInt(body.result.blockNumber).toString()});
          } else {
            setStage({kind: "failed", message: "The transaction was included but reverted."});
          }
          void refresh();
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      // Still pending is not the same as failed, and is reported as such.
      setStage({kind: "pending", hash});
    } catch (err) {
      const e = err as {code?: number; message?: string};
      setStage({
        kind: "failed",
        message: e.code === 4001 ? "Transaction rejected in the wallet." : (e.message ?? "The transaction failed."),
      });
    }
  }, [to, amount, balance, wallet, props.rpcUrl, refresh]);

  // -------------------------------------------------------------- view --
  if (!wallet.available) {
    return (
      <>
        <TestnetNotice />
        <Banner kind="err">
          <strong>No Ethereum wallet detected.</strong> Install MetaMask, Rabby or any other
          EIP-1193 wallet, then reload this page. KAURAX needs no special wallet software.
        </Banner>
        <div className="card" style={{marginTop: 16}}>
          <h2>Network details</h2>
          <dl className="kv">
            <Row label="Network name">{props.networkName}</Row>
            <Row label="RPC URL">{props.rpcUrl}</Row>
            <Row label="Chain ID">{props.chainId}</Row>
            <Row label="Currency symbol">KAX</Row>
            <Row label="Explorer">{props.explorerUrl}</Row>
          </dl>
        </div>
      </>
    );
  }

  return (
    <>
      <TestnetNotice />

      <div className="wallet-bar" style={{marginBottom: 18}}>
        {wallet.account ? (
          <>
            <Badge kind="ok">connected</Badge>
            <span className="addr">{wallet.account}</span>
            <span className="spacer" />
            {wallet.onKaurax ? (
              <Badge kind="accent">chain {wallet.chainId}</Badge>
            ) : (
              <button onClick={() => void wallet.switchToKaurax()}>
                Switch to KAURAX (chain {props.chainId})
              </button>
            )}
          </>
        ) : (
          <>
            <span className="dim">No account connected.</span>
            <span className="spacer" />
            <button className="primary" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.connecting ? <Spinner /> : null} Connect wallet
            </button>
          </>
        )}
        <button onClick={() => void wallet.addKaurax()}>Add KAURAX network</button>
      </div>

      {wallet.error ? <Banner kind="err">{wallet.error}</Banner> : null}

      {!wallet.onKaurax && wallet.account ? (
        <Banner kind="warn">
          Your wallet is on chain {wallet.chainId ?? NO_DATA}, not KAURAX (chain {props.chainId}).
          Balances and sends below apply to KAURAX only.
        </Banner>
      ) : null}

      <div className="grid cols-3" style={{marginBottom: 18}}>
        <Stat
          label="KAX balance"
          value={balance === null ? null : `${formatUnits(balance)} KAX`}
          sub={wallet.account ? "read live from the chain" : "connect a wallet"}
        />
        <Stat label="Transaction count" value={nonce === null ? null : String(nonce)} small />
        <Stat label="Network head" value={props.head ? `#${props.head}` : null} sub={props.networkName} small />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Send KAX</h2>
          <div className="field">
            <label>Recipient</label>
            <input
              className="mono"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Amount (KAX)</label>
            <input
              className="mono"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
            />
            {balance !== null ? (
              <div className="hint">Available: {formatUnits(balance)} KAX</div>
            ) : null}
          </div>

          <button
            className="primary"
            style={{width: "100%"}}
            disabled={!wallet.account || !wallet.onKaurax || stage.kind === "signing" || stage.kind === "pending"}
            onClick={() => void send()}
          >
            {stage.kind === "signing" ? "Awaiting wallet…" : stage.kind === "pending" ? "Waiting for a block…" : "Send"}
          </button>

          {stage.kind === "failed" ? <div className="error-text">{stage.message}</div> : null}

          {stage.kind === "pending" ? (
            <Banner kind="info">
              <Spinner /> Submitted. Waiting for KAURAX to include it.
              <div className="mono-sm" style={{marginTop: 6, wordBreak: "break-all"}}>{stage.hash}</div>
            </Banner>
          ) : null}

          {stage.kind === "confirmed" ? (
            <Banner kind="ok">
              <strong>Confirmed in block {stage.block}.</strong>
              <div className="mono-sm" style={{marginTop: 6, wordBreak: "break-all"}}>
                <a href={`${props.explorerUrl}/tx/${stage.hash}`} target="_blank" rel="noreferrer">
                  {stage.hash}
                </a>
              </div>
            </Banner>
          ) : null}
        </div>

        <div className="card">
          <h2>Network details</h2>
          <dl className="kv">
            <Row label="Network name">{props.networkName}</Row>
            <Row label="RPC URL">{props.rpcUrl}</Row>
            <Row label="Chain ID">{props.chainId}</Row>
            <Row label="Currency">KAX (18 decimals)</Row>
            <Row label="Explorer">{props.explorerUrl}</Row>
            <Row label="Layer">3 — settles through an underlying L2</Row>
          </dl>
        </div>
      </div>

      <div style={{marginTop: 24}}>
        <div className="section-head">
          <h2>Recent transactions</h2>
          {wallet.account ? (
            <a href={`${props.explorerUrl}/address/${wallet.account}`} target="_blank" rel="noreferrer">
              View in the explorer →
            </a>
          ) : null}
        </div>

        {!wallet.account ? (
          <Empty>Connect a wallet to see its KAURAX activity.</Empty>
        ) : !historyAvailable ? (
          <Empty>
            Transaction history requires the KAURAX indexer, which is not configured on this
            deployment.
          </Empty>
        ) : history === null ? (
          <Empty>Could not reach the KAURAX API.</Empty>
        ) : history.length === 0 ? (
          <Empty>No transactions found for this address on KAURAX.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Direction</th>
                  <th>Counterparty</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx) => {
                  const outgoing = tx.from.toLowerCase() === wallet.account?.toLowerCase();
                  const other = outgoing ? tx.to : tx.from;
                  return (
                    <tr key={tx.hash}>
                      <td>
                        <a className="mono" href={`${props.explorerUrl}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                          {shortHash(tx.hash)}
                        </a>
                      </td>
                      <td>
                        <Badge kind={outgoing ? "warn" : "ok"}>{outgoing ? "out" : "in"}</Badge>
                      </td>
                      <td className="mono dim">{other ? shortHash(other, 8, 6) : "contract creation"}</td>
                      <td className="mono">{formatUnits(tx.value)} KAX</td>
                      <td>
                        <Badge kind={tx.status === "success" ? "ok" : tx.status === "reverted" ? "err" : "warn"}>
                          {tx.status}
                        </Badge>
                      </td>
                      <td className="dim">{timeAgo(tx.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
