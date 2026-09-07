"use client";

/**
 * KAURAX Names.
 *
 * Every value on this page is read from the registry contract. Availability, price, owner
 * and expiry are contract calls — none of it is assumed, and a name is never shown as
 * available without asking the chain.
 */
import {useCallback, useEffect, useState} from "react";
import {createPublicClient, defineChain, encodeFunctionData, http} from "viem";
import {kauraxNamesAbi} from "@kaurax/types";
import {Badge, Banner, Empty, Row, Spinner, formatUnits, isAddress, shortHash, useWallet} from "@kaurax/ui";

interface Props {
  registry: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
}

interface Lookup {
  label: string;
  valid: boolean;
  available: boolean;
  owner: string;
  resolved: string;
  expiresAt: bigint;
  inGrace: boolean;
  priceForYear: bigint;
}

const YEAR = 365 * 24 * 60 * 60;
const ZERO = "0x0000000000000000000000000000000000000000";

export function NamesClient({registry, rpcUrl, chainId, explorerUrl}: Props) {
  const wallet = useWallet({chainId, chainName: "KAURAX", rpcUrl, explorerUrl});

  const chain = defineChain({
    id: chainId,
    name: "KAURAX",
    nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}},
  });
  const client = createPublicClient({chain, transport: http(rpcUrl)});

  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [years, setYears] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [primary, setPrimary] = useState<string>("");

  const readPrimary = useCallback(async () => {
    if (!wallet.account) return setPrimary("");
    try {
      const name = await client.readContract({
        address: registry as `0x${string}`,
        abi: kauraxNamesAbi,
        functionName: "primaryName",
        args: [wallet.account],
      });
      setPrimary(name as string);
    } catch {
      setPrimary("");
    }
  }, [wallet.account, registry, client]);

  useEffect(() => {
    void readPrimary();
  }, [readPrimary]);

  const search = useCallback(
    async (raw: string) => {
      const label = raw.trim().toLowerCase().replace(/\.kaurax$/, "");
      if (!label) return;

      setSearching(true);
      setError(null);
      setSuccess(null);
      try {
        const valid = (await client.readContract({
          address: registry as `0x${string}`,
          abi: kauraxNamesAbi,
          functionName: "isValidLabel",
          args: [label],
        })) as boolean;

        if (!valid) {
          setLookup({
            label,
            valid: false,
            available: false,
            owner: ZERO,
            resolved: ZERO,
            expiresAt: 0n,
            inGrace: false,
            priceForYear: 0n,
          });
          return;
        }

        const [record, price] = await Promise.all([
          client.readContract({
            address: registry as `0x${string}`,
            abi: kauraxNamesAbi,
            functionName: "recordOf",
            args: [label],
          }) as Promise<readonly [string, string, bigint, boolean, boolean]>,
          client.readContract({
            address: registry as `0x${string}`,
            abi: kauraxNamesAbi,
            functionName: "priceFor",
            args: [label, BigInt(YEAR)],
          }) as Promise<bigint>,
        ]);

        setLookup({
          label,
          valid: true,
          owner: record[0],
          resolved: record[1],
          expiresAt: record[2],
          available: record[3],
          inGrace: record[4],
          priceForYear: price,
        });
      } catch (err) {
        setError(`Could not read the registry: ${(err as Error).message}`);
      } finally {
        setSearching(false);
      }
    },
    [client, registry],
  );

  /** Send a registry transaction through the wallet and wait for a receipt. */
  const send = useCallback(
    async (data: `0x${string}`, value: bigint, description: string) => {
      setError(null);
      setSuccess(null);
      setBusy(true);
      try {
        const hash = await wallet.request<string>("eth_sendTransaction", [
          {from: wallet.account, to: registry, data, value: `0x${value.toString(16)}`},
        ]);

        const receipt = await client.waitForTransactionReceipt({
          hash: hash as `0x${string}`,
          timeout: 90_000,
        });
        if (receipt.status !== "success") {
          setError("The transaction was included but reverted.");
          return;
        }
        setSuccess(`${description} — ${shortHash(hash)}`);
        await search(lookup?.label ?? query);
        await readPrimary();
      } catch (err) {
        const e = err as {code?: number; message?: string};
        setError(e.code === 4001 ? "Rejected in the wallet." : (e.message ?? "The transaction failed."));
      } finally {
        setBusy(false);
      }
    },
    [wallet, registry, client, search, lookup, query, readPrimary],
  );

  const register = useCallback(() => {
    if (!lookup) return;
    const duration = BigInt(YEAR * years);
    const price = (lookup.priceForYear * BigInt(years));
    void send(
      encodeFunctionData({abi: kauraxNamesAbi, functionName: "register", args: [lookup.label, duration]}),
      price,
      `Registered ${lookup.label} for ${years} year${years > 1 ? "s" : ""}`,
    );
  }, [lookup, years, send]);

  const renew = useCallback(() => {
    if (!lookup) return;
    const duration = BigInt(YEAR * years);
    const price = lookup.priceForYear * BigInt(years);
    void send(
      encodeFunctionData({abi: kauraxNamesAbi, functionName: "renew", args: [lookup.label, duration]}),
      price,
      `Renewed ${lookup.label}`,
    );
  }, [lookup, years, send]);

  const setAsPrimary = useCallback(() => {
    if (!lookup) return;
    void send(
      encodeFunctionData({abi: kauraxNamesAbi, functionName: "setPrimaryName", args: [lookup.label]}),
      0n,
      `${lookup.label} is now your primary name`,
    );
  }, [lookup, send]);

  const isOwner = lookup !== null && wallet.account !== null && lookup.owner.toLowerCase() === wallet.account.toLowerCase();
  const resolvesToMe =
    lookup !== null && wallet.account !== null && lookup.resolved.toLowerCase() === wallet.account.toLowerCase();

  return (
    <>
      <div className="wallet-bar" style={{marginBottom: 18}}>
        {wallet.account ? (
          <>
            <Badge kind="ok">connected</Badge>
            <span className="addr">{primary ? `${primary}.kaurax` : shortHash(wallet.account, 8, 6)}</span>
            <span className="spacer" />
            {!wallet.onKaurax ? (
              <button onClick={() => void wallet.switchToKaurax()}>Switch to KAURAX</button>
            ) : null}
          </>
        ) : (
          <>
            <span className="dim">Connect a wallet to register a name.</span>
            <span className="spacer" />
            <button className="primary" onClick={() => void wallet.connect()}>Connect wallet</button>
          </>
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Search</h2>
          <form
            className="field-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <div className="field">
              <label>Name</label>
              <input
                className="mono"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="yourname"
                spellCheck={false}
              />
              <div className="hint">3–63 characters, a–z, 0–9 and hyphens. Uppercase is rejected.</div>
            </div>
            <button type="submit" disabled={searching}>{searching ? <Spinner /> : null} Search</button>
          </form>

          {lookup && !lookup.valid ? (
            <Banner kind="err">
              <strong>{lookup.label}</strong> is not a valid name. Use 3–63 characters of a–z, 0–9 and
              hyphens, not starting or ending with a hyphen.
            </Banner>
          ) : null}

          {lookup?.valid ? (
            <>
              <dl className="kv" style={{marginTop: 14}}>
                <dt>Name</dt>
                <dd>{lookup.label}.kaurax</dd>
                <dt>Status</dt>
                <dd>
                  {lookup.available ? (
                    <Badge kind="ok">available</Badge>
                  ) : lookup.inGrace ? (
                    <Badge kind="warn">expired — in grace period</Badge>
                  ) : (
                    <Badge kind="err">taken</Badge>
                  )}
                </dd>
                <Row label="Owner">{lookup.owner === ZERO ? null : lookup.owner}</Row>
                <Row label="Resolves to">{lookup.resolved === ZERO ? null : lookup.resolved}</Row>
                <Row label="Expires">
                  {lookup.expiresAt === 0n ? null : new Date(Number(lookup.expiresAt) * 1000).toLocaleString()}
                </Row>
                <Row label="Price per year">{`${formatUnits(lookup.priceForYear)} KAX`}</Row>
              </dl>

              <div className="field" style={{marginTop: 14}}>
                <label>Duration</label>
                <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                  {[1, 2, 3, 5, 10].map((y) => (
                    <option key={y} value={y}>
                      {y} year{y > 1 ? "s" : ""} — {formatUnits(lookup.priceForYear * BigInt(y))} KAX
                    </option>
                  ))}
                </select>
              </div>

              <div className="row-gap" style={{marginTop: 12}}>
                {lookup.available ? (
                  <button
                    className="primary"
                    style={{flex: 1}}
                    disabled={!wallet.account || !wallet.onKaurax || busy}
                    onClick={register}
                  >
                    {busy ? <Spinner /> : null} Register for {formatUnits(lookup.priceForYear * BigInt(years))} KAX
                  </button>
                ) : (
                  <button style={{flex: 1}} disabled={!wallet.account || !wallet.onKaurax || busy} onClick={renew}>
                    {busy ? <Spinner /> : null} Renew for {formatUnits(lookup.priceForYear * BigInt(years))} KAX
                  </button>
                )}
              </div>

              {resolvesToMe && primary !== lookup.label ? (
                <button style={{width: "100%", marginTop: 10}} disabled={busy} onClick={setAsPrimary}>
                  Set as my primary name
                </button>
              ) : null}

              {!lookup.available && !isOwner && !lookup.inGrace ? (
                <div className="hint" style={{marginTop: 10}}>
                  Anyone may renew a name they do not own — it extends the current owner&apos;s
                  registration and does not transfer it.
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <div className="error-text">{error}</div> : null}
          {success ? <Banner kind="ok">{success}</Banner> : null}
        </div>

        <div className="card">
          <h2>Your name</h2>
          {!wallet.account ? (
            <Empty>Connect a wallet to see the name registered to your address.</Empty>
          ) : primary ? (
            <>
              <dl className="kv">
                <Row label="Primary name">{`${primary}.kaurax`}</Row>
                <Row label="Address">{wallet.account}</Row>
              </dl>
              <div className="hint" style={{marginTop: 12}}>
                A primary name only displays while it still resolves to your address and has not
                expired — so it cannot go stale without you noticing.
              </div>
            </>
          ) : (
            <Empty>
              No primary name set for this address. Register a name, then set it as your primary.
            </Empty>
          )}

          <h2 style={{marginTop: 26}}>How it works</h2>
          <dl className="kv">
            <dt>Term</dt>
            <dd>28 days to 10 years, renewable at any time</dd>
            <dt>Grace period</dt>
            <dd>30 days after expiry, during which only the owner may renew</dd>
            <dt>Pricing</dt>
            <dd>By length — shorter names cost more</dd>
            <dt>Registry</dt>
            <dd style={{fontSize: 11}}>
              <a href={`${explorerUrl}/address/${registry}`} target="_blank" rel="noreferrer">
                {registry}
              </a>
            </dd>
          </dl>
        </div>
      </div>
    </>
  );
}
