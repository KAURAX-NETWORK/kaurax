# Contributing to KAURAX

## Getting set up

Requires [Foundry](https://getfoundry.sh), Node.js ≥ 20, pnpm 10, and PostgreSQL 16 if you
want the indexer and API.

```bash
git clone <repo> && cd kaurax
pnpm install

./infra/scripts/devnet/start.sh     # L1 + L2 + settlement contracts + KAURAX
./tests/acceptance.sh               # 47 end-to-end checks
```

Optional, for the API and indexer:

```bash
createdb kaurax_dev
export DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/kaurax_dev"
pnpm --filter @kaurax/indexer dev &
pnpm --filter @kaurax/api dev &
./tests/api-smoke.sh
```

Frontends:

```bash
pnpm dev                                  # every app, each on its own port
pnpm --filter @kaurax/explorer dev        # or just one
```

---

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Build everything, in dependency order |
| `pnpm typecheck` | Typecheck everything (builds dependencies first) |
| `pnpm test` | Unit tests across all packages |
| `pnpm test:contracts` | `forge test` |
| `pnpm test:acceptance` | End-to-end, needs a running devnet |
| `pnpm sweep` | Scan for TODOs, mock data and hardcoded secrets |
| `pnpm devnet` / `devnet:stop` / `devnet:status` | Local chain |

---

## The rules that matter here

These are not style preferences. They are what keeps KAURAX honest.

### 1. Never fabricate data

No mock balances, no placeholder transaction counts, no invented TVL, no fake TPS. If a
value cannot be read, it is `null`, and the UI renders **No data available**.

```ts
// wrong — a zero is a claim
const balance = await fetchBalance(addr) ?? 0n;

// right — unknown stays unknown
const balance = await fetchBalance(addr);   // bigint | null
```

### 2. Never present an unbuilt feature as working

If contracts are not deployed, use `<NotDeployed>` from `@kaurax/ui`. Feature state comes
from `/api/features`, which decides by calling `eth_getCode` — not from a flag someone can
set optimistically.

### 3. Never put a secret in a `NEXT_PUBLIC_` variable

Everything `NEXT_PUBLIC_` is compiled into a public bundle. Secrets belong in
`services/api`. CI fails the build on violations, and also scans built bundles for
key-shaped literals.

### 4. Never claim something is verified when it is not

If you could not run it, say so. `KAURAX_DEPLOYMENT_STATUS.md` distinguishes ✅ working
(verified), ⚠️ needs configuration, and ❌ not implemented. Keep it accurate.

### 5. Preserve uint256 precision

`NUMERIC(78,0)` in PostgreSQL, `bigint` in TypeScript, decimal strings over JSON. Never
route a wei value through a JavaScript `number`.

---

## Making a change

1. Branch from `main`.
2. Make the change, with tests. Security-relevant code needs tests for what must **fail**,
   not only what must succeed — see `blockchain/contracts/test/KauraxPortal.t.sol`.
3. `pnpm typecheck && pnpm test && pnpm test:contracts`
4. If you touched the chain, node, API or indexer: run the devnet and both
   `./tests/acceptance.sh` and `./tests/api-smoke.sh`.
5. `cd blockchain/contracts && forge fmt` for Solidity.
6. Open a PR describing what you verified, and what you could not.

CI runs typecheck, unit tests, contract tests, a full devnet with the acceptance and API
smoke suites, all 10 frontend builds, secret scanning and Slither.

---

## Where things live

| Change | Directory |
|---|---|
| Sequencer, batcher, proposer, RPC | `blockchain/l3/src/` |
| Contracts | `blockchain/contracts/src/` |
| API endpoints | `services/api/src/routes/` |
| Indexing | `services/indexer/src/` |
| A frontend | `apps/<name>/` |
| Shared components or styles | `packages/ui/src/` |
| Shared types | `packages/types/src/` |
| Server, Docker, Nginx | `infra/` |

**Consensus-critical:** `blockchain/contracts/src/libraries/Hashing.sol` and
`blockchain/l3/src/settlement/hashing.ts` define the same values and must agree. Change one
without the other and withdrawals break. The same applies to `MerkleTree.sol` and
`merkle.ts`.

---

## Style

TypeScript strict, ESM, no default exports. Solidity 0.8.28, `forge fmt`, custom errors
rather than revert strings.

Comment **why**, not what. `// increment i` is noise; `// null, not false, when settlement
state could not be read` is the reason a reviewer needs.

---

## Please don't

- Add a paid service without discussing it. KAURAX runs on free tiers and one VPS.
- Commit a `.env`, a key, or a keystore.
- Change the chain ID or the KAX symbol without discussion — it breaks genesis, the SDK, the
  explorer and every document.
- Rewrite `kaurax-node`, the contracts or the explorer wholesale. They work and are tested.
- Weaken an honesty guarantee to make a screen look better.
