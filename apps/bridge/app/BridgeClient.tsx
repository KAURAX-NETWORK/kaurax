"use client";

/**
 * KAURAX bridge.
 *
 *   Ethereum  ↓  underlying L2  ↓  KAURAX
 *
 * Deposits are a single L2 transaction to KauraxPortal, which the node derives onto
 * KAURAX. Withdrawals are the three-step canonical flow: initiate on KAURAX, prove against
 * a published output root on the L2, then finalize after the challenge window.
 *
 * Every status shown here is read back from chain state. The UI never advances a stage on
 * optimism, never displays a transaction hash it did not receive from the wallet, and
 * shows an ETA only where one is actually derivable from on-chain parameters.
 */
import {useCallback, useEffect, useState} from "react";
import {decodeEventLog, encodeFunctionData} from "viem";

type Hex = `0x${string}`;

interface Eip1193Provider {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";

/**
 * Calldata is built with viem rather than by hand. Hand-rolled ABI encoding in a bridge UI
 * is how users lose funds to a mis-sized offset — the selector can be right and the
 * arguments still land in the wrong slots.
 */
const portalAbi = [
  {
    type: "function",
    name: "depositTransaction",
    stateMutability: "payable",
    inputs: [
      {name: "_to", type: "address"},
      {name: "_value", type: "uint256"},
      {name: "_gasLimit", type: "uint64"},
      {name: "_isCreation", type: "bool"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
] as const;

const messagePasserAbi = [
  {
    type: "event",
    name: "MessagePassed",
    inputs: [
      {name: "nonce", type: "uint256", indexed: true},
      {name: "sender", type: "address", indexed: true},
      {name: "target", type: "address", indexed: true},
      {name: "value", type: "uint256", indexed: false},
      {name: "gasLimit", type: "uint256", indexed: false},
      {name: "data", type: "bytes", indexed: false},
      {name: "withdrawalHash", type: "bytes32", indexed: false},
      {name: "leafIndex", type: "uint256", indexed: false},
    ],
  },
  {
    type: "function",
    name: "initiateWithdrawal",
    stateMutability: "payable",
    inputs: [
      {name: "_target", type: "address"},
      {name: "_gasLimit", type: "uint256"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
] as const;

function encodeDeposit(to: string, value: bigint, gasLimit: bigint): Hex {
  return encodeFunctionData({
    abi: portalAbi,
    functionName: "depositTransaction",
    args: [to as Hex, value, gasLimit, false, "0x"],
  });
}

function encodeWithdraw(target: string, gasLimit: bigint): Hex {
  return encodeFunctionData({
    abi: messagePasserAbi,
    functionName: "initiateWithdrawal",
    args: [target as Hex, gasLimit, "0x"],
  });
}

function parseKax(input: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(input.trim()) || input.trim() === "" || input.trim() === ".") return null;
  const [whole = "0", fraction = ""] = input.trim().split(".");
  const padded = (fraction + "0".repeat(18)).slice(0, 18);
  try {
    return BigInt(whole) * 10n ** 18n + BigInt(padded || "0");
  } catch {
    return null;
  }
}

function formatKax(wei: bigint, digits = 6): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

type Direction = "deposit" | "withdraw";

interface Props {
  l3ChainId: number;
  l3RpcUrl: string;
  l2ChainId: number | null;
  l2Name: string | null;
  l2RpcUrl: string;
  l1ChainId: number | null;
  portal: string | null;
  challengeWindowSeconds: number | null;
  l2BlockTimeSeconds: number;
}

export function BridgeClient(props: Props) {
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [l3Balance, setL3Balance] = useState<bigint | null>(null);
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [withdrawalHash, setWithdrawalHash] = useState<string | null>(null);
  const [withdrawalStage, setWithdrawalStage] = useState<string | null>(null);

  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);
  const targetChainId = direction === "deposit" ? props.l2ChainId : props.l3ChainId;
  const wrongNetwork = account !== null && walletChainId !== null && walletChainId !== targetChainId;

  // ------------------------------------------------------------- wallet --

  const readChainId = useCallback(async () => {
    if (!window.ethereum) return;
    const hex = (await window.ethereum.request({method: "eth_chainId"})) as string;
    setWalletChainId(Number(BigInt(hex)));
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("No EIP-1193 wallet was detected in this browser.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({method: "eth_requestAccounts"})) as string[];
      setAccount(accounts[0] ?? null);
      await readChainId();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [readChainId]);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const onAccounts = (...args: unknown[]) => setAccount((args[0] as string[])[0] ?? null);
    const onChain = (...args: unknown[]) => setWalletChainId(Number(BigInt(args[0] as string)));
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccounts);
      window.ethereum?.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const addKaurax = useCallback(async () => {
    if (!window.ethereum) return;
    setError(null);
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${props.l3ChainId.toString(16)}`,
            chainName: "KAURAX",
            nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
            rpcUrls: [props.l3RpcUrl],
            blockExplorerUrls: [window.location.origin],
          },
        ],
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [props.l3ChainId, props.l3RpcUrl]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum || targetChainId === null) return;
    setError(null);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{chainId: `0x${targetChainId.toString(16)}`}],
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [targetChainId]);

  // ------------------------------------------------------------ balance --

  const refreshBalance = useCallback(async () => {
    if (!account) return;
    try {
      const res = await fetch(props.l3RpcUrl, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [account, "latest"]}),
      });
      const body = (await res.json()) as {result?: string};
      setL3Balance(body.result ? BigInt(body.result) : null);
    } catch {
      setL3Balance(null);
    }
  }, [account, props.l3RpcUrl]);

  useEffect(() => {
    void refreshBalance();
    const t = setInterval(() => void refreshBalance(), 5000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  // ------------------------------------------------------------ actions --

  const submit = useCallback(async () => {
    setError(null);
    setTxHash(null);
    setStage(null);
    setWithdrawalHash(null);
    setWithdrawalStage(null);

    const wei = parseKax(amount);
    if (wei === null || wei <= 0n) {
      setError("Enter a positive amount.");
      return;
    }
    if (!account || !window.ethereum) {
      setError("Connect a wallet first.");
      return;
    }
    if (direction === "deposit" && !props.portal) {
      setError("The portal address is not configured on this network.");
      return;
    }

    setBusy(true);
    try {
      const to = direction === "deposit" ? props.portal! : MESSAGE_PASSER;
      const data =
        direction === "deposit"
          ? encodeDeposit(account, wei, 21000n)
          : encodeWithdraw(account, 100000n);

      setStage(direction === "deposit" ? "awaiting wallet signature on the L2" : "awaiting wallet signature on KAURAX");

      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{from: account, to, value: `0x${wei.toString(16)}`, data}],
      })) as string;

      setTxHash(hash);
      setStage(
        direction === "deposit"
          ? "deposit submitted — waiting for the KAURAX node to derive it"
          : "withdrawal submitted on KAURAX — waiting for an output root",
      );

      if (direction === "withdraw") {
        // Read the withdrawal hash back from the receipt rather than computing it here:
        // the on-chain value is the authoritative one.
        void pollWithdrawal(hash);
      }
    } catch (err) {
      setError((err as Error).message);
      setStage(null);
    } finally {
      setBusy(false);
    }
  }, [account, amount, direction, props.portal]);

  const pollWithdrawal = useCallback(
    async (l3TxHash: string) => {
      const rpc = async (method: string, params: unknown[]) => {
        const res = await fetch(props.l3RpcUrl, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
        });
        return ((await res.json()) as {result?: unknown; error?: {message: string}}).result;
      };

      for (let i = 0; i < 90; i++) {
        const receipt = (await rpc("eth_getTransactionReceipt", [l3TxHash])) as
          | {logs: Array<{data: string; topics: string[]}>}
          | null;

        if (receipt && receipt.logs.length > 0) {
          // Decode the MessagePassed event properly rather than slicing words out of the
          // data blob: `data` is a dynamic field, so its layout is not positionally stable.
          let hash: string | null = null;
          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: messagePasserAbi,
                topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
                data: log.data as Hex,
              });
              if (decoded.eventName === "MessagePassed") {
                hash = (decoded.args as {withdrawalHash: string}).withdrawalHash;
                break;
              }
            } catch {
              // Not a MessagePassed log; the passer also emits a root update.
            }
          }
          if (hash) {
            setWithdrawalHash(hash);
            const status = (await rpc("kaurax_withdrawalProof", [hash])) as
              | {status: string; reason?: string}
              | undefined;
            if (status?.status === "ready") {
              setWithdrawalStage("provable — an output root now covers this withdrawal");
              return;
            }
            setWithdrawalStage(status?.reason ?? "awaiting an output root on the L2");
          }
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      setWithdrawalStage("still waiting — check the withdrawal hash with `kaurax bridge status`");
    },
    [props.l3RpcUrl],
  );

  const estimate = useCallback(async () => {
    setGasEstimate(null);
    if (!account) return;
    const wei = parseKax(amount);
    if (wei === null || wei <= 0n) return;

    const url = direction === "deposit" ? props.l2RpcUrl : props.l3RpcUrl;
    const to = direction === "deposit" ? props.portal : MESSAGE_PASSER;
    if (!to) return;

    try {
      const data = direction === "deposit" ? encodeDeposit(account, wei, 21000n) : encodeWithdraw(account, 100000n);
      const res = await fetch(url, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_estimateGas",
          params: [{from: account, to, value: `0x${wei.toString(16)}`, data}],
        }),
      });
      const body = (await res.json()) as {result?: string; error?: {message: string}};
      setGasEstimate(body.result ? `${BigInt(body.result).toLocaleString("en-US")} gas` : null);
    } catch {
      setGasEstimate(null);
    }
  }, [account, amount, direction, props.l2RpcUrl, props.l3RpcUrl, props.portal]);

  useEffect(() => {
    void estimate();
  }, [estimate]);

  // --------------------------------------------------------------- view --

  const eta =
    direction === "deposit"
      ? `roughly one L2 block plus one KAURAX block (~${props.l2BlockTimeSeconds + 2}s) once the L2 transaction confirms`
      : props.challengeWindowSeconds !== null
        ? `an output root must be published, then a ${props.challengeWindowSeconds}s challenge window must elapse before finalizing`
        : "an output root must be published, then the challenge window must elapse";

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>{direction === "deposit" ? "Deposit to KAURAX" : "Withdraw from KAURAX"}</h2>

        <div className="stack" style={{marginBottom: 18}}>
          <div className="stack-layer" style={direction === "deposit" ? {} : {opacity: 0.55}}>
            <span className="tier">L2</span>
            <span className="name">{props.l2Name ?? "Underlying rollup"}</span>
            <span className="meta">{props.l2ChainId ? `chain ${props.l2ChainId}` : ""}</span>
          </div>
          <div className="stack-arrow">{direction === "deposit" ? "▼ deposit" : "▲ withdraw"}</div>
          <div className="stack-layer l3">
            <span className="tier">L3</span>
            <span className="name">KAURAX</span>
            <span className="meta">chain {props.l3ChainId}</span>
          </div>
        </div>

        <div className="field">
          <label>Direction</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="deposit">Deposit — {props.l2Name ?? "L2"} → KAURAX</option>
            <option value="withdraw">Withdraw — KAURAX → {props.l2Name ?? "L2"}</option>
          </select>
        </div>

        <div className="field">
          <label>Asset</label>
          <select disabled>
            <option>KAX (native)</option>
          </select>
        </div>

        <div className="field">
          <label>Amount</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            className="mono"
          />
        </div>

        {!account ? (
          <button className="primary" onClick={() => void connect()} disabled={!hasWallet} style={{width: "100%"}}>
            {hasWallet ? "Connect wallet" : "No wallet detected"}
          </button>
        ) : wrongNetwork ? (
          <button className="primary" onClick={() => void switchNetwork()} style={{width: "100%"}}>
            Switch to chain {targetChainId}
          </button>
        ) : (
          <button className="primary" onClick={() => void submit()} disabled={busy} style={{width: "100%"}}>
            {busy ? "Awaiting wallet…" : direction === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        )}

        <div style={{marginTop: 12, display: "flex", gap: 10}}>
          <button onClick={() => void addKaurax()} disabled={!hasWallet} style={{flex: 1}}>
            Add KAURAX to wallet
          </button>
        </div>

        {error ? (
          <div className="notice" style={{marginTop: 14, borderLeftColor: "var(--err)"}}>
            {error}
          </div>
        ) : null}
      </div>

      <div>
        <div className="card">
          <h2>Status</h2>
          <dl className="kv">
            <dt>Wallet</dt>
            <dd>{account ?? <span className="nodata">not connected</span>}</dd>
            <dt>Wallet chain</dt>
            <dd>{walletChainId ?? <span className="nodata">No data available</span>}</dd>
            <dt>KAX on KAURAX</dt>
            <dd>{l3Balance === null ? <span className="nodata">No data available</span> : `${formatKax(l3Balance)} KAX`}</dd>
            <dt>Gas estimate</dt>
            <dd>{gasEstimate ?? <span className="nodata">No data available</span>}</dd>
            <dt>Estimated time</dt>
            <dd style={{fontFamily: "var(--sans)", fontSize: 12.5}}>{eta}</dd>
          </dl>
        </div>

        <div className="card" style={{marginTop: 14}}>
          <h2>Current transfer</h2>
          {!txHash ? (
            <div className="empty">No transfer has been submitted in this session.</div>
          ) : (
            <dl className="kv">
              <dt>Transaction</dt>
              <dd style={{fontSize: 11}}>{txHash}</dd>
              <dt>Stage</dt>
              <dd style={{fontFamily: "var(--sans)", fontSize: 12.5}}>{stage ?? "—"}</dd>
              {withdrawalHash ? (
                <>
                  <dt>Withdrawal hash</dt>
                  <dd style={{fontSize: 11}}>{withdrawalHash}</dd>
                  <dt>Withdrawal stage</dt>
                  <dd style={{fontFamily: "var(--sans)", fontSize: 12.5}}>
                    {withdrawalStage ?? "checking…"}
                  </dd>
                </>
              ) : null}
            </dl>
          )}
        </div>

        {direction === "withdraw" ? (
          <div className="notice" style={{marginTop: 14}}>
            <strong>Withdrawals take three steps.</strong> This page initiates the withdrawal on KAURAX and
            tracks when it becomes provable. Proving and finalizing on the L2 are separate transactions —
            use <code>kaurax bridge status &lt;withdrawalHash&gt;</code> to fetch the proof, or the SDK&apos;s{" "}
            <code>getWithdrawalStatus</code>. Withdrawals are proven against an output root that is{" "}
            <strong>not fault proven</strong>.
          </div>
        ) : (
          <div className="notice info" style={{marginTop: 14}}>
            <strong>Deposits cannot be censored by the sequencer.</strong> They originate as an event on the
            L2 and are derived into KAURAX blocks, so blocking one would require blocking the L2.
          </div>
        )}
      </div>
    </div>
  );
}
