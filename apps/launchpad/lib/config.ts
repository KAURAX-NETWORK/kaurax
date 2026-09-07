/**
 * Client-visible configuration.
 *
 * Only NEXT_PUBLIC_* variables appear here, and none of them are secrets: endpoints and a
 * chain ID. Anything sensitive stays server-side in the KAURAX API.
 */
export const config = {
  apiUrl: process.env.NEXT_PUBLIC_KAURAX_API_URL ?? "http://127.0.0.1:4000",
  rpcUrl: process.env.NEXT_PUBLIC_KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
  wsUrl: process.env.NEXT_PUBLIC_KAURAX_WS_URL ?? "ws://127.0.0.1:8421",
  chainId: Number(process.env.NEXT_PUBLIC_KAURAX_CHAIN_ID ?? 8420),
  explorerUrl: process.env.NEXT_PUBLIC_KAURAX_EXPLORER_URL ?? "http://127.0.0.1:3000",
  domain: process.env.NEXT_PUBLIC_KAURAX_DOMAIN ?? "",
} as const;

/** Fetch from the KAURAX API. Returns null on any failure — callers render "No data available". */
export async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Like `api`, but surfaces the API's error body so a form can show why it failed. */
export async function apiOrError<T>(
  path: string,
  init?: RequestInit,
): Promise<{ok: true; data: T} | {ok: false; message: string}> {
  try {
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(65_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        (body as {message?: string} | null)?.message ?? `The KAURAX API returned ${res.status}.`;
      return {ok: false, message};
    }
    return {ok: true, data: body as T};
  } catch (err) {
    return {
      ok: false,
      message:
        (err as Error).name === "TimeoutError"
          ? "The KAURAX API did not respond in time."
          : "Could not reach the KAURAX API.",
    };
  }
}
