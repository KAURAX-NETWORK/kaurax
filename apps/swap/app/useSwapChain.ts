"use client";

/**
 * Shared chain plumbing for the Swap app: a public client, a token list, and a helper that
 * sends a transaction and waits for its receipt.
 *
 * Kept in one place so the swap and liquidity panels cannot drift apart on how they read
 * the chain — a discrepancy there shows up as a quote that does not match execution.
 */
import {useCallback, useEffect, useMemo, useState} from "react";
import {createPublicClient, defineChain, encodeFunctionData, http, type Abi, type Hex} from "viem";
import {erc20Abi} from "@kaurax/types";
import {shortHash, type WalletState} from "@kaurax/ui";

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

export const NATIVE = "NATIVE";

export function useSwapChain(chainId: number, rpcUrl: string, apiUrl: string, wkax: string) {
  const client = useMemo(() => {
    const chain = defineChain({
      id: chainId,
      name: "KAURAX",
      nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
      rpcUrls: {default: {http: [rpcUrl]}},
    });
    return createPublicClient({chain, transport: http(rpcUrl)});
  }, [chainId, rpcUrl]);

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Tokens come from the indexer, not a curated list, so nothing here implies endorsement.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/tokens?limit=50`, {cache: "no-store"});
        const body = res.ok
          ? ((await res.json()) as {
              items: Array<{address: string; symbol: string | null; decimals: number | null}>;
            })
          : {items: []};

        setTokens(
          body.items
            .filter((t) => t.address.toLowerCase() !== wkax.toLowerCase())
            .map((t) => ({
              address: t.address,
              symbol: t.symbol ?? shortHash(t.address, 6, 4),
              decimals: t.decimals ?? 18,
            })),
        );
      } catch {
        setTokens([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [apiUrl, wkax]);

  const tokenOf = useCallback(
    (v: string): TokenInfo =>
      v === NATIVE
        ? {address: wkax, symbol: "KAX", decimals: 18}
        : (tokens.find((t) => t.address.toLowerCase() === v.toLowerCase()) ?? {
            address: v,
            symbol: "?",
            decimals: 18,
          }),
    [tokens, wkax],
  );

  /**
   * Deadline derived from the chain's own clock, not the browser's. A sequencer sets block
   * timestamps, and drift would make a wall-clock deadline revert valid transactions.
   */
  const chainDeadline = useCallback(
    async (seconds = 1200): Promise<bigint> => {
      const latest = await client.getBlock({blockTag: "latest"});
      return latest.timestamp + BigInt(seconds);
    },
    [client],
  );

  /** Ensure `spender` can move `amount` of `token` on the caller's behalf. */
  const ensureAllowance = useCallback(
    async (wallet: WalletState, token: string, spender: string, amount: bigint): Promise<void> => {
      const current = (await client.readContract({
        address: token as Hex,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet.account!, spender as Hex],
      })) as bigint;
      if (current >= amount) return;

      const hash = await wallet.request<string>("eth_sendTransaction", [
        {
          from: wallet.account,
          to: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [spender as Hex, amount],
          }),
        },
      ]);
      await client.waitForTransactionReceipt({hash: hash as Hex, timeout: 90_000});
    },
    [client],
  );

  /** Send a contract call and wait for its receipt. Returns the hash, or throws. */
  const sendTx = useCallback(
    async (
      wallet: WalletState,
      to: string,
      abi: Abi,
      functionName: string,
      args: unknown[],
      value = 0n,
    ): Promise<string> => {
      const hash = await wallet.request<string>("eth_sendTransaction", [
        {
          from: wallet.account,
          to,
          data: encodeFunctionData({abi, functionName, args}),
          value: `0x${value.toString(16)}`,
        },
      ]);
      const receipt = await client.waitForTransactionReceipt({hash: hash as Hex, timeout: 90_000});
      if (receipt.status !== "success") {
        throw new Error("The transaction was included but reverted.");
      }
      return hash;
    },
    [client],
  );

  return {client, tokens, loading, tokenOf, chainDeadline, ensureAllowance, sendTx};
}

/** Turn a wallet rejection into something worth showing a user. */
export function readableError(err: unknown): string {
  const e = err as {code?: number; message?: string};
  if (e.code === 4001) return "Rejected in the wallet.";
  if (e.code === -32002) return "A wallet request is already pending. Open your wallet to continue.";
  return e.message ?? "The transaction failed.";
}
