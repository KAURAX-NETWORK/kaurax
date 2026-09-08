# KAURAX — Reproducible Build

Every command below was run on 2026-09-08. The expected output is what actually appeared,
not what should appear.

## Prerequisites

| | Version | Check |
|---|---|---|
| Node.js | 20+ | `node -v` |
| pnpm | 10+ | `pnpm -v` |
| Foundry | stable | `forge --version` |
| Docker | any recent | `docker --version` |

Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

## 1. Clone and install

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git
cd kaurax
pnpm install
```

## 2. Contracts

```bash
cd blockchain/contracts
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test
```

```
Ran 14 test suites: 270 tests passed, 0 failed, 0 skipped (270 total tests)
```

```bash
forge fmt --check     # no output, exit 0
```

## 3. Packages and node

```bash
cd ../..
pnpm test
```

```
@kaurax/l3:test        Tests  78 passed (78)
@kaurax/api:test       Tests  21 passed (21)
@kaurax/indexer:test   Tests  16 passed (16)
@kaurax/signer:test    Tests  11 passed (11)
 Tasks:    25 successful, 25 total
```

```bash
pnpm typecheck        # Tasks: 25 successful, 25 total
pnpm build            # Tasks: 19 successful, 19 total
```

## 4. Local devnet

Brings up an L1 stand-in, an L2 stand-in and KAURAX, deploys the settlement contracts and
installs the predeploys.

```bash
./infra/scripts/devnet/start.sh
```

Expect: chain id 8420, an L1 head, an L2 head, and *"admin RPC namespaces are blocked on the
public endpoint"*.

```bash
./infra/scripts/devnet/status.sh    # three-layer view, read from RPC
./infra/scripts/devnet/stop.sh
```

The script writes `.env` from `.env.example` and injects the published Anvil keys itself.
`.env.example` ships **no keys** — copying it does not hand you world-known credentials.

## 5. Acceptance test

With the devnet running:

```bash
./tests/acceptance.sh
```

Exercises deposit → sequence → batch → **rebuild the transaction from L2 calldata alone** →
output root → proven withdrawal. That reconstruction step is the data availability guarantee,
tested rather than asserted.

## 6. End-to-end against the live testnet

```bash
pnpm --filter @kaurax/cli build
export KAURAX_RPC_URL=https://kaurax.network/rpc
export KAURAX_API_URL=https://kaurax.network
./tests/e2e-testnet.sh
```

```
12 passed, 0 failed
```

The faucet enforces a per-address and per-IP cooldown; if you hit it, the test says so and
falls back to `E2E_FUNDING_KEY` if you set one. A cooldown is the abuse protection working,
not a failure.

## 7. What will not reproduce here

| | Why |
|---|---|
| **Slither** | Runs in CI on `ubuntu-latest`. It cannot run on a machine whose Python build is incompatible with `cbor2`'s binary extension — Python 3.15 currently is |
| `tests/chaos.sh` | Destructive. Devnet only |
| `tests/load.ts` | Reports numbers measured on one machine; not comparable across hosts |
| Deployment scripts | Need an L2 RPC and funded accounts |

## 8. Totals

| | |
|---|---|
| Solidity | 270 |
| Node and services | 126 |
| Live end-to-end | 12 |
| **Total** | **529** |

If your numbers differ, the documentation is stale — please open an issue rather than
assuming your environment is wrong. Current status: [TEST_STATUS.md](TEST_STATUS.md).
