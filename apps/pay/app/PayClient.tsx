"use client";

/**
 * KAURAX Pay.
 *
 * Three surfaces in one page: create a request, pay one, and a merchant's list.
 *
 * The important property is negative: this component cannot mark a payment as paid. It
 * submits a transaction hash to the API, and the API verifies it against the chain. If the
 * verification fails, the failure is shown verbatim.
 */
import {useCallback, useEffect, useState} from "react";
import {
  Badge,
  Banner,
  Empty,
  Row,
  Spinner,
  TestnetNotice,
  formatUnits,
  isAddress,
  parseUnits,
  shortHash,
  useWallet,
} from "@kaurax/ui";

interface Payment {
  id: string;
  merchantAddress: string;
  amount: string;
  currency: string;
  reference: string | null;
  description: string | null;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  transactionHash: string | null;
  payerAddress: string | null;
  confirmedAtBlock: string | null;
  createdAt: string;
  expiresAt: string;
}

type Tab = "create" | "pay" | "merchant";

export function PayClient({
  apiUrl,
  rpcUrl,
  chainId,
  explorerUrl,
}: {
  apiUrl: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
}) {
  const wallet = useWallet({chainId, chainName: "KAURAX", rpcUrl, explorerUrl});
  const [tab, setTab] = useState<Tab>("create");

  // --- create ---
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState<Payment | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // --- pay ---
  const [lookupId, setLookupId] = useState("");
  const [invoice, setInvoice] = useState<Payment | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // --- merchant ---
  const [merchantList, setMerchantList] = useState<Payment[] | null>(null);

  useEffect(() => {
    if (wallet.account && !merchant) setMerchant(wallet.account);
  }, [wallet.account, merchant]);

  // Deep link: /?id=<uuid> opens the payment directly.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      setTab("pay");
      setLookupId(id);
      void loadInvoice(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(async () => {
    setCreateError(null);
    setCreated(null);

    if (!isAddress(merchant)) {
      setCreateError("Enter a valid merchant address to be paid.");
      return;
    }
    const wei = parseUnits(amount);
    if (wei === null || wei <= 0n) {
      setCreateError("Enter a positive amount of KAX.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`${apiUrl}/api/payments`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          merchantAddress: merchant,
          amount: wei.toString(),
          reference: reference || null,
          description: description || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError((body as {message?: string}).message ?? `The API returned ${res.status}.`);
        return;
      }
      setCreated(body as Payment);
    } catch {
      setCreateError("Could not reach the KAURAX API.");
    } finally {
      setCreating(false);
    }
  }, [merchant, amount, reference, description, apiUrl]);

  const loadInvoice = useCallback(
    async (id: string) => {
      setPayError(null);
      setInvoice(null);
      if (!id.trim()) return;
      try {
        const res = await fetch(`${apiUrl}/api/payments/${id.trim()}`, {cache: "no-store"});
        if (!res.ok) {
          setPayError(res.status === 404 ? "No payment with that ID." : `The API returned ${res.status}.`);
          return;
        }
        setInvoice((await res.json()) as Payment);
      } catch {
        setPayError("Could not reach the KAURAX API.");
      }
    },
    [apiUrl],
  );

  /** Pay the loaded invoice, then hand the hash to the API for on-chain verification. */
  const pay = useCallback(async () => {
    if (!invoice) return;
    setPayError(null);
    setPaying(true);
    try {
      const hash = await wallet.request<string>("eth_sendTransaction", [
        {
          from: wallet.account,
          to: invoice.merchantAddress,
          value: `0x${BigInt(invoice.amount).toString(16)}`,
        },
      ]);

      // Wait for inclusion before asking the API to verify: settling an unmined hash just
      // produces a confusing rejection.
      const deadline = Date.now() + 90_000;
      let mined = false;
      while (Date.now() < deadline) {
        const r = await fetch(rpcUrl, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash]}),
        });
        if (((await r.json()) as {result?: unknown}).result) {
          mined = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!mined) {
        setPayError(`Transaction ${shortHash(hash)} has not been included yet. Retry the settle step shortly.`);
        return;
      }

      const settle = await fetch(`${apiUrl}/api/payments/${invoice.id}/settle`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({transactionHash: hash}),
      });
      const body = await settle.json();
      if (!settle.ok) {
        setPayError((body as {message?: string}).message ?? "Settlement was rejected.");
        return;
      }
      setInvoice(body as Payment);
    } catch (err) {
      const e = err as {code?: number; message?: string};
      setPayError(e.code === 4001 ? "Payment rejected in the wallet." : (e.message ?? "The payment failed."));
    } finally {
      setPaying(false);
    }
  }, [invoice, wallet, rpcUrl, apiUrl]);

  const loadMerchant = useCallback(async () => {
    setMerchantList(null);
    if (!isAddress(merchant)) return;
    try {
      const res = await fetch(`${apiUrl}/api/payments?merchant=${merchant}&limit=25`, {cache: "no-store"});
      setMerchantList(res.ok ? ((await res.json()) as {items: Payment[]}).items : null);
    } catch {
      setMerchantList(null);
    }
  }, [merchant, apiUrl]);

  useEffect(() => {
    if (tab === "merchant") void loadMerchant();
  }, [tab, loadMerchant]);

  const payLink = created ? `${typeof window !== "undefined" ? window.location.origin : ""}/?id=${created.id}` : "";

  return (
    <>
      <TestnetNotice />

      <div className="row-gap" style={{marginBottom: 18}}>
        {(["create", "pay", "merchant"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "primary" : undefined} onClick={() => setTab(t)}>
            {t === "create" ? "Create request" : t === "pay" ? "Pay a request" : "Merchant dashboard"}
          </button>
        ))}
        <span className="right" />
        {wallet.account ? (
          <Badge kind="ok">{shortHash(wallet.account, 8, 6)}</Badge>
        ) : (
          <button onClick={() => void wallet.connect()}>Connect wallet</button>
        )}
      </div>

      {/* ------------------------------------------------------ create -- */}
      {tab === "create" ? (
        <div className="grid cols-2">
          <div className="card">
            <h2>New payment request</h2>
            <div className="field">
              <label>Merchant address (paid to)</label>
              <input className="mono" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x…" />
            </div>
            <div className="field">
              <label>Amount (KAX)</label>
              <input className="mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" inputMode="decimal" />
            </div>
            <div className="field">
              <label>Reference (optional)</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-001" />
            </div>
            <div className="field">
              <label>Description (optional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this for?" />
            </div>
            <button className="primary" style={{width: "100%"}} onClick={() => void create()} disabled={creating}>
              {creating ? <Spinner /> : null} Create request
            </button>
            {createError ? <div className="error-text">{createError}</div> : null}
          </div>

          <div className="card">
            <h2>Request</h2>
            {!created ? (
              <Empty>No request created yet.</Empty>
            ) : (
              <>
                <dl className="kv">
                  <Row label="Payment ID">{created.id}</Row>
                  <Row label="Amount">{`${formatUnits(created.amount)} KAX`}</Row>
                  <Row label="Pay to">{created.merchantAddress}</Row>
                  <Row label="Reference">{created.reference}</Row>
                  <Row label="Status">
                    <Badge kind="warn">{created.status}</Badge>
                  </Row>
                  <Row label="Expires">{new Date(created.expiresAt).toLocaleString()}</Row>
                </dl>
                <div className="field" style={{marginTop: 14}}>
                  <label>Share this link with the payer</label>
                  <input readOnly value={payLink} className="mono" onFocus={(e) => e.currentTarget.select()} />
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- pay -- */}
      {tab === "pay" ? (
        <div className="grid cols-2">
          <div className="card">
            <h2>Find a payment</h2>
            <div className="field-row">
              <div className="field">
                <label>Payment ID</label>
                <input className="mono" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="uuid" />
              </div>
              <button onClick={() => void loadInvoice(lookupId)}>Look up</button>
            </div>
            {payError ? <div className="error-text">{payError}</div> : null}
          </div>

          <div className="card">
            <h2>Payment</h2>
            {!invoice ? (
              <Empty>Enter a payment ID to load a request.</Empty>
            ) : (
              <>
                <dl className="kv">
                  <Row label="Amount">{`${formatUnits(invoice.amount)} KAX`}</Row>
                  <Row label="Pay to">{invoice.merchantAddress}</Row>
                  <Row label="Description">{invoice.description}</Row>
                  <Row label="Status">
                    <Badge kind={invoice.status === "confirmed" ? "ok" : invoice.status === "pending" ? "warn" : "err"}>
                      {invoice.status}
                    </Badge>
                  </Row>
                  {invoice.transactionHash ? (
                    <Row label="Settled by">
                      <a href={`${explorerUrl}/tx/${invoice.transactionHash}`} target="_blank" rel="noreferrer">
                        {shortHash(invoice.transactionHash)}
                      </a>
                    </Row>
                  ) : null}
                  {invoice.confirmedAtBlock ? <Row label="Confirmed in block">{invoice.confirmedAtBlock}</Row> : null}
                </dl>

                {invoice.status === "pending" ? (
                  !wallet.account ? (
                    <button className="primary" style={{width: "100%", marginTop: 14}} onClick={() => void wallet.connect()}>
                      Connect wallet to pay
                    </button>
                  ) : !wallet.onKaurax ? (
                    <button style={{width: "100%", marginTop: 14}} onClick={() => void wallet.switchToKaurax()}>
                      Switch to KAURAX to pay
                    </button>
                  ) : (
                    <button className="primary" style={{width: "100%", marginTop: 14}} onClick={() => void pay()} disabled={paying}>
                      {paying ? <Spinner /> : null} Pay {formatUnits(invoice.amount)} KAX
                    </button>
                  )
                ) : null}

                {invoice.status === "confirmed" ? (
                  <Banner kind="ok">
                    <strong>Payment confirmed on chain.</strong> The KAURAX API verified the recipient,
                    the amount and the receipt before marking this paid.
                  </Banner>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------- merchant -- */}
      {tab === "merchant" ? (
        <>
          <div className="card" style={{marginBottom: 16}}>
            <div className="field-row">
              <div className="field">
                <label>Merchant address</label>
                <input className="mono" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x…" />
              </div>
              <button onClick={() => void loadMerchant()}>Load</button>
            </div>
          </div>

          {merchantList === null ? (
            <Empty>Enter a merchant address to list its payment requests.</Empty>
          ) : merchantList.length === 0 ? (
            <Empty>No payment requests for this address.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Payer</th>
                    <th>Transaction</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {merchantList.map((p) => (
                    <tr key={p.id}>
                      <td>{p.reference ?? <span className="faint">—</span>}</td>
                      <td className="mono">{formatUnits(p.amount)} KAX</td>
                      <td>
                        <Badge kind={p.status === "confirmed" ? "ok" : p.status === "pending" ? "warn" : "err"}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="mono dim">{p.payerAddress ? shortHash(p.payerAddress, 8, 6) : "—"}</td>
                      <td className="mono">
                        {p.transactionHash ? (
                          <a href={`${explorerUrl}/tx/${p.transactionHash}`} target="_blank" rel="noreferrer">
                            {shortHash(p.transactionHash)}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="dim">{new Date(p.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
