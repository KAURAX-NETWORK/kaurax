/**
 * KAURAX CLI wallet.
 *
 * Real keys, real signatures, real transactions. There is no simulated mode: every command
 * here either produces a transaction the chain accepted or an error explaining why it did
 * not.
 *
 * Key storage is deliberately modest and says so. Keys live in a JSON file under
 * ~/.kaurax, encrypted with a passphrase via scrypt + AES-256-GCM. That is appropriate for
 * a testnet whose token has no value and is not appropriate for anything else — a hardware
 * wallet or the signing service in docs/key-management.md is what a real balance deserves.
 * The CLI repeats this where a user will see it rather than burying it here.
 */
import {randomBytes, scryptSync, createCipheriv, createDecipheriv} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {createPublicClient, createWalletClient, defineChain, http, parseEther, formatEther, isAddress, type Hex} from "viem";
import {privateKeyToAccount, generatePrivateKey} from "viem/accounts";

export interface StoredKey {
  address: string;
  /** scrypt salt, hex. */
  salt: string;
  /** AES-GCM nonce, hex. */
  iv: string;
  /** AES-GCM auth tag, hex. */
  tag: string;
  /** Encrypted private key, hex. */
  ciphertext: string;
  createdAt: string;
}

interface KeyFile {
  version: 1;
  keys: Record<string, StoredKey>;
  default?: string;
}

const DIR = process.env.KAURAX_HOME ?? join(homedir(), ".kaurax");
const FILE = join(DIR, "keys.json");

// Cost parameters. High enough that a stolen file is not trivially brute-forced, low enough
// that unlocking a key does not feel broken on a laptop.
// N=2^15 needs 128*N*r = 32 MiB, which is exactly Node's default scrypt limit, so it
// refuses. maxmem is raised rather than the cost lowered: the whole point of the parameter
// is to make an offline guess expensive.
const SCRYPT = {N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024};

function load(): KeyFile {
  if (!existsSync(FILE)) return {version: 1, keys: {}};
  return JSON.parse(readFileSync(FILE, "utf8")) as KeyFile;
}

function save(data: KeyFile): void {
  mkdirSync(dirname(FILE), {recursive: true});
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
  // Owner-only. The file holds encrypted keys, but a passphrase is only as good as the
  // number of people who can attempt it offline.
  chmodSync(FILE, 0o600);
}

function encrypt(privateKey: Hex, passphrase: string): Omit<StoredKey, "address" | "createdAt"> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, SCRYPT.keylen, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey.slice(2), "hex"), cipher.final()]);
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decrypt(stored: StoredKey, passphrase: string): Hex {
  const key = scryptSync(passphrase, Buffer.from(stored.salt, "hex"), SCRYPT.keylen, SCRYPT);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "hex"));
  decipher.setAuthTag(Buffer.from(stored.tag, "hex"));
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, "hex")), decipher.final()]);
    return `0x${plain.toString("hex")}` as Hex;
  } catch {
    // GCM authentication failed. The overwhelmingly likely cause is a wrong passphrase;
    // the alternative is a tampered file, and the user should consider both.
    throw new Error("Could not decrypt the key. The passphrase is wrong, or the key file has been altered.");
  }
}

function passphraseFrom(explicit?: string): string {
  const p = explicit ?? process.env.KAURAX_PASSPHRASE;
  if (!p) {
    throw new Error(
      "A passphrase is required. Pass --passphrase, or set KAURAX_PASSPHRASE.\n" +
        "Prefer the environment variable: an argument is visible in your shell history and in ps.",
    );
  }
  return p;
}

// --------------------------------------------------------------- commands --

export function walletCreate(passphrase?: string, label = "default"): void {
  const pass = passphraseFrom(passphrase);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const data = load();
  if (data.keys[label]) throw new Error(`A key labelled "${label}" already exists. Choose another label.`);

  data.keys[label] = {address: account.address, createdAt: new Date().toISOString(), ...encrypt(privateKey, pass)};
  data.default ??= label;
  save(data);

  console.log(`created  ${label}`);
  console.log(`address  ${account.address}`);
  console.log(`stored   ${FILE} (mode 600)`);
  console.log("");
  console.log("This key is encrypted with your passphrase and nothing else. Lose the");
  console.log("passphrase and the key is gone; there is no recovery. KAX is a testnet token");
  console.log("with no monetary value, so this file is not worth protecting like a real one.");
}

export function walletImport(privateKey: string, passphrase?: string, label = "imported"): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Not a 32-byte hex private key.");
  const pass = passphraseFrom(passphrase);
  const account = privateKeyToAccount(privateKey as Hex);

  const data = load();
  if (data.keys[label]) throw new Error(`A key labelled "${label}" already exists.`);
  data.keys[label] = {address: account.address, createdAt: new Date().toISOString(), ...encrypt(privateKey as Hex, pass)};
  data.default ??= label;
  save(data);

  console.log(`imported ${label}`);
  console.log(`address  ${account.address}`);
}

export function walletList(): void {
  const data = load();
  const labels = Object.keys(data.keys);
  if (labels.length === 0) {
    console.log("No keys. Create one with:  kaurax wallet create");
    return;
  }
  for (const label of labels) {
    const mark = label === data.default ? "*" : " ";
    console.log(`${mark} ${label.padEnd(16)} ${data.keys[label]!.address}`);
  }
  if (data.default) console.log("\n* default");
}

function resolveKey(label?: string): StoredKey {
  const data = load();
  const chosen = label ?? data.default;
  if (!chosen) throw new Error("No keys exist. Create one with:  kaurax wallet create");
  const key = data.keys[chosen];
  if (!key) throw new Error(`No key labelled "${chosen}". List them with:  kaurax wallet list`);
  return key;
}

function chainFor(rpcUrl: string, chainId: number) {
  return defineChain({
    id: chainId,
    name: "KAURAX",
    nativeCurrency: {name: "KAURAX", symbol: "KAX", decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}},
  });
}

export async function walletBalance(rpcUrl: string, chainId: number, addressOrLabel?: string): Promise<void> {
  let address: string;
  if (addressOrLabel && isAddress(addressOrLabel, {strict: false})) {
    address = addressOrLabel;
  } else {
    address = resolveKey(addressOrLabel).address;
  }

  const client = createPublicClient({chain: chainFor(rpcUrl, chainId), transport: http(rpcUrl)});
  const [balance, nonce] = await Promise.all([
    client.getBalance({address: address as Hex}),
    client.getTransactionCount({address: address as Hex}),
  ]);

  console.log(`address  ${address}`);
  console.log(`balance  ${formatEther(balance)} KAX`);
  console.log(`nonce    ${nonce}`);
}

/**
 * Sign and broadcast a transfer, then wait for it to be included.
 *
 * Waits for the receipt rather than returning on submission: a hash is not a confirmation,
 * and reporting one as if it were is how a CLI ends up claiming a transfer that reverted.
 */
export async function walletSend(opts: {
  rpcUrl: string;
  chainId: number;
  to: string;
  amount: string;
  label?: string;
  passphrase?: string;
}): Promise<void> {
  if (!isAddress(opts.to, {strict: false})) throw new Error(`"${opts.to}" is not a valid address.`);

  const stored = resolveKey(opts.label);
  const privateKey = decrypt(stored, passphraseFrom(opts.passphrase));
  const account = privateKeyToAccount(privateKey);

  const chain = chainFor(opts.rpcUrl, opts.chainId);
  const publicClient = createPublicClient({chain, transport: http(opts.rpcUrl)});
  const wallet = createWalletClient({account, chain, transport: http(opts.rpcUrl)});

  // Fail on the wrong chain before signing anything. A signature is only replayable on the
  // chain it names, but a user who thinks they are on KAURAX and is not should be told.
  const observed = await publicClient.getChainId();
  if (observed !== opts.chainId) {
    throw new Error(`${opts.rpcUrl} reports chain ${observed}, expected ${opts.chainId}. Refusing to sign.`);
  }

  const value = parseEther(opts.amount);
  const balance = await publicClient.getBalance({address: account.address});
  if (balance < value) {
    throw new Error(
      `Insufficient balance: have ${formatEther(balance)} KAX, need ${opts.amount} KAX plus gas.\n` +
        `Fund it from the faucet:  kaurax faucet ${account.address}`,
    );
  }

  console.log(`from     ${account.address}`);
  console.log(`to       ${opts.to}`);
  console.log(`amount   ${opts.amount} KAX`);
  console.log("sending…");

  const hash = await wallet.sendTransaction({to: opts.to as Hex, value});
  console.log(`hash     ${hash}`);
  console.log("waiting for inclusion…");

  const receipt = await publicClient.waitForTransactionReceipt({hash, timeout: 120_000});
  console.log(`block    ${receipt.blockNumber}`);
  console.log(`gas used ${receipt.gasUsed}`);
  console.log(`status   ${receipt.status === "success" ? "success" : "REVERTED"}`);

  if (receipt.status !== "success") {
    throw new Error("The transaction was included but reverted. The balance was not transferred.");
  }
}

/** Ask the network's faucet for testnet KAX. */
export async function faucet(apiUrl: string, address?: string, label?: string): Promise<void> {
  const target = address ?? resolveKey(label).address;
  if (!isAddress(target, {strict: false})) throw new Error(`"${target}" is not a valid address.`);

  const res = await fetch(`${apiUrl}/api/faucet`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({address: target}),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    throw new Error((body?.message as string) ?? `The faucet returned ${res.status}.`);
  }
  console.log(`funded   ${target}`);
  console.log(`amount   ${String(body?.amountKax)} KAX`);
  console.log(`tx       ${String(body?.txHash)}`);
  console.log(`block    ${String(body?.blockNumber)}`);
}

export const WALLET_FILE = FILE;
