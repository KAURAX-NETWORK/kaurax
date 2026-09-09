# KAURAX — Reproducibility

Every command here was run against this commit and produced the output shown. Where something
was broken, it is named rather than quietly fixed — the two failures in §7 were found by
running this document rather than writing it.

For build-output determinism (hashes, versions) see
[REPRODUCIBLE_BUILD.md](REPRODUCIBLE_BUILD.md); this file is about getting from a clean
machine to a running chain.

---

## 1. Prerequisites

| Tool | Version used | Why |
|---|---|---|
| Node | ≥ 20.9 | `engines` in `package.json` |
| pnpm | 10.28.0 | `packageManager`; a different major will not resolve the lockfile |
| Foundry | v1.5.1 (`anvil`, `forge`, `cast`) | Contracts, and `anvil` **is** the devnet execution engine |
| Docker | any recent | Only for the containerised stack; not needed for the local devnet |
| Python 3 | 3.9+ | Some infrastructure scripts |

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
corepack enable && corepack prepare pnpm@10.28.0 --activate
```

---

## 2. Install

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git
cd kaurax
pnpm install
```

`pnpm install` resolves 21 workspace packages. No postinstall step reaches the network beyond
the registry, and nothing needs credentials.

---

## 3. The local network

One command brings up three chains and the node:

```bash
./infra/scripts/devnet/start.sh
```

It starts an L1 stand-in (chain 8410, 12s blocks), an L2 stand-in (8415), deploys the
settlement contracts, starts the KAURAX execution engine (8420), runs genesis — funding five
accounts and installing the predeploys — and then starts `kaurax-node`: sequencer, derivation,
batcher, proposer, RPC and metrics.

Verify:

```bash
./infra/scripts/devnet/status.sh     # three-layer heights and settlement state
curl -s http://127.0.0.1:7300/metrics | head
```

**It is restartable.** `stop.sh` then `start.sh` works, and CI asserts it — see §7.

### Endpoints

| | |
|---|---|
| KAURAX RPC | `http://127.0.0.1:8420` (ws `:8421`) |
| L2 / L1 | `http://127.0.0.1:9545` / `:8545` |
| Metrics | `http://127.0.0.1:7300/metrics` |
| Engine | `http://127.0.0.1:18420` — internal, never exposed |

`start.sh` verifies the engine is not reachable through the public RPC and aborts if a
cheatcode like `anvil_setBalance` gets forwarded.

---

## 4. Prove it works

```bash
./tests/acceptance.sh
```

**47 passed, 0 failed** on this commit. It sends a real transaction, watches it batch to the
L2, **rebuilds it from L2 calldata alone**, sees an output root proposed, performs a
withdrawal round trip through `KauraxPortal`, and checks replay protection in both directions.

The data-availability step is the one worth reading: it decodes the batch and recovers the
signed transaction without asking KAURAX for anything.

---

## 5. Contracts

```bash
cd blockchain/contracts
forge build
forge test                    # 385 passed, 23 suites
forge fmt --check
```

Deployment against the running devnet is done by `start.sh`. To do it by hand:
`infra/scripts/deployment/deploy-contracts.sh`.

---

## 6. Using the chain

Against the local devnet or the public testnet — only the URLs differ.

```bash
pnpm --filter @kaurax/cli build

export KAURAX_RPC_URL=https://kaurax.network/rpc
export KAURAX_API_URL=https://kaurax.network
export KAURAX_PASSPHRASE='choose-something'

pnpm kaurax network status
pnpm kaurax wallet create mykey
pnpm kaurax faucet
pnpm kaurax wallet send 0xRecipient 1
```

Keys live in `$KAURAX_HOME/keys.json` (default `~/.kaurax`), encrypted with scrypt +
AES-256-GCM, written at mode 600 — verified: `-rw-------`.

**`pnpm kaurax`, not `kaurax`.** Building the package does not put its `bin` on your `PATH`;
`pnpm --filter @kaurax/cli exec npm link` does, if you want the bare command.

Faucet: 100 KAX, one grant per address and per client IP per 6 hours.

---

## 7. What was broken, and how it was found

Both were found by running this document rather than writing it.

### The CLI was never on `PATH`

The README said `pnpm --filter @kaurax/cli build`, then `kaurax wallet create mykey`. Building
a workspace package does not link its `bin`, so the third line was `command not found` for
every new developer. Fixed by adding a `pnpm kaurax` script and correcting the README.

### The devnet started once and never again

`start.sh` launches `anvil` without `--state`, so every run creates chains beginning at
block 0. Two files described a position in the *previous* chain — `.devnet/derivation-cursor.json`
and `.devnet/sequencer-wal.jsonl` — and the node refused to start:

```
Derivation checkpoint says L2 block 69, but the L2 head is only 4.
This node is pointed at a different or reset L2. Refusing to start.
```

**That check is correct and was kept.** The bug was `start.sh` creating a new chain while
leaving the old chain's bookmarks behind. It now clears them, and the reason is written at the
line that does it.

Why nobody noticed: CI runs on a clean machine, so the first `start.sh` always succeeded. CI
now stops and starts the devnet a second time, which is the only way it can see what a
returning developer sees.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `Derivation checkpoint says L2 block N…` | Stale devnet state. `rm -f .devnet/derivation-cursor.json .devnet/sequencer-wal.jsonl` — `start.sh` now does this |
| `KAURAX RPC did not become ready` | Read `.devnet/kaurax-node.log`; the node logs a specific reason and refuses to start rather than limping |
| `kaurax: command not found` | Use `pnpm kaurax`, or link the package |
| `command not found: anvil` | Foundry is not installed; `anvil` is the execution engine, not an optional extra |
| Faucet returns `cooldown` | One grant per address **and per client IP** per 6 hours |
| Ports already bound | `./infra/scripts/devnet/stop.sh` |

---

## 9. What CI reproduces on every push

Typecheck · unit tests · full build · devnet boot · acceptance · **devnet restart** · indexer
and API against the live chain · application contracts · contract coverage with a floor on
security-critical contracts · node coverage.

Not covered: a clean clone on a machine without Foundry, and the containerised stack under
`docker-compose.yml`, which is exercised by deployment rather than by CI.
