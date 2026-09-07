"use client";

/**
 * EIP-1193 wallet connection, shared by every KAURAX app that needs one.
 *
 * Deliberately thin: no wallet SDK, no connector registry, no custom cryptography. KAURAX
 * is EVM-equivalent, so the browser provider is all that is required, and anything that
 * speaks EIP-1193 (MetaMask, Rabby, Frame, a WalletConnect-injected provider) works.
 *
 * The hook never signs anything on its own and never stores a key. Every state transition
 * comes from the provider, so the UI cannot drift from what the wallet actually did.
 */
import {useCallback, useEffect, useState} from "react";

export interface Eip1193Provider {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface WalletState {
  available: boolean;
  account: `0x${string}` | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  onKaurax: boolean;
  connect: () => Promise<void>;
  switchToKaurax: () => Promise<void>;
  addKaurax: () => Promise<void>;
  request: <T>(method: string, params?: unknown[]) => Promise<T>;
}

export interface KauraxNetwork {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl?: string;
}

export function useWallet(network: KauraxNetwork): WalletState {
  const [available, setAvailable] = useState(false);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  // Reflect whatever the wallet reports, including changes made outside this page.
  useEffect(() => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider?.on) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAccount((accounts?.[0] as `0x${string}`) ?? null);
    };
    const onChain = (...args: unknown[]) => {
      try {
        setChainId(Number(BigInt(args[0] as string)));
      } catch {
        setChainId(null);
      }
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  // Pick up an already-authorised account without prompting.
  useEffect(() => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) return;
    void (async () => {
      try {
        const accounts = (await provider.request({method: "eth_accounts"})) as string[];
        if (accounts.length > 0) setAccount(accounts[0] as `0x${string}`);
        const hex = (await provider.request({method: "eth_chainId"})) as string;
        setChainId(Number(BigInt(hex)));
      } catch {
        // A provider that refuses these is simply treated as not connected.
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const provider = window.ethereum;
    if (!provider) {
      setError("No Ethereum wallet was detected in this browser.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await provider.request({method: "eth_requestAccounts"})) as string[];
      setAccount((accounts[0] as `0x${string}`) ?? null);
      const hex = (await provider.request({method: "eth_chainId"})) as string;
      setChainId(Number(BigInt(hex)));
    } catch (err) {
      setError(readableError(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const addKaurax = useCallback(async () => {
    setError(null);
    const provider = window.ethereum;
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${network.chainId.toString(16)}`,
            chainName: network.chainName,
            nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: network.explorerUrl ? [network.explorerUrl] : [],
          },
        ],
      });
    } catch (err) {
      setError(readableError(err));
    }
  }, [network]);

  const switchToKaurax = useCallback(async () => {
    setError(null);
    const provider = window.ethereum;
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{chainId: `0x${network.chainId.toString(16)}`}],
      });
    } catch (err) {
      // 4902 means the wallet has never heard of this chain; adding it is the right recovery.
      if ((err as {code?: number}).code === 4902) {
        await addKaurax();
        return;
      }
      setError(readableError(err));
    }
  }, [network, addKaurax]);

  const request = useCallback(async <T,>(method: string, params: unknown[] = []): Promise<T> => {
    const provider = window.ethereum;
    if (!provider) throw new Error("No wallet is connected.");
    return (await provider.request({method, params})) as T;
  }, []);

  return {
    available,
    account,
    chainId,
    connecting,
    error,
    onKaurax: chainId === network.chainId,
    connect,
    switchToKaurax,
    addKaurax,
    request,
  };
}

/** Turn a provider rejection into something worth showing a user. */
function readableError(err: unknown): string {
  const e = err as {code?: number; message?: string};
  if (e.code === 4001) return "Request rejected in the wallet.";
  if (e.code === -32002) return "A wallet request is already pending. Open your wallet to continue.";
  return e.message ?? "The wallet request failed.";
}
