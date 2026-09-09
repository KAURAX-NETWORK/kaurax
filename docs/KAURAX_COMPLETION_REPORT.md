# KAURAX — Completion Report

**Date:** 2026-09-09 · **Scope:** Phases 0–20 · **Committed:** nothing · **Deployed:**
monitoring, an nginx configuration fix, and a compose correction on the live testnet

---

## Executive summary

KAURAX is a working public testnet with honest documentation and no fault proof over its own
execution. That last clause is the whole story, and nothing in this work changed it.

What this work did change: a quick-start that was not runnable, a devnet that started exactly
once per machine, monitoring that had never scraped anything, a load test that could not
finish its own setup, a health endpoint that hung instead of reporting failure, and a deploy
script that would have taken the origin off the internet. All six were real, all six are
fixed, and every one was found by **running** something rather than reading it.

**Mainnet readiness: 52/100** — effectively unchanged, and correctly so. Removing operational
failure modes does not raise a security ceiling set by the absence of fault proofs.

---

## What was already working

Verified, not assumed:

- **Data availability.** Every block is L2 calldata; the acceptance suite rebuilds a signed
  transaction from it alone.
- **Forced inclusion.** An unacknowledged forced transaction halts settlement for everyone —
  21 tests plus live verification.
- **Withdrawals.** Merkle proof against a published root *and* `isOutputFinalized`; full round
  trip in acceptance.
- **The dispute game.** Bonded, permissionless, bisecting — and honest that a guardian
  decides.
- **The one-step verifier.** Built in a previous session: 404 differential cases, 97% line
  coverage, deliberately unwired from settlement.
- **The public testnet.** ~49,500 blocks, ten containers, ten Next.js zones under one domain.

---

## What was implemented

### Phase 0 — audit

[COMPLETE_SYSTEM_AUDIT.md](COMPLETE_SYSTEM_AUDIT.md): 31,600 lines across 21 packages,
dependency map, per-component table. Seven findings, including that the state transition
function is not in this repository.

### Phase 1 — reproducibility

Ran every documented command. Two were broken:

- **The CLI was never on `PATH`.** `pnpm --filter @kaurax/cli build` does not link a `bin`, so
  the third line of the README quick-start was `command not found` for every new developer.
- **The devnet started once and never again.** `start.sh` creates fresh chains but left the
  previous chain's derivation cursor and WAL, so the node correctly refused. **The check was
  right; the script was wrong.** CI now stops and restarts the devnet — the only way a
  clean-machine runner sees what a returning developer sees.

### Phase 2 — security

Corrected a false `op-geth` claim in `AnvilEngine.ts`, and two stale evidence lines in
`SECURITY_STATUS.md`. Closed four operational findings (O-1…O-4). **No severity was reduced.**

### Phase 3 — threat model

[THREAT_MODEL.md](THREAT_MODEL.md) replaced a six-line pointer: eleven adversaries A–K, what
each can and cannot do, and where the model is weakest.

### Phases 4–5 — fault proofs

[FAULT_PROOF_DESIGN.md](FAULT_PROOF_DESIGN.md): all 31 required design elements with status —
**24 implemented, 5 not, 2 partial**. Verified the existing implementation still holds. **No
claim was strengthened.**

### Phase 6 — adversarial testing

`tests/fault-proofs/` (10 property tests over 400+ random programs each),
`tests/security/` (26 tests, 21 admin namespaces individually refused),
`tests/adversarial/` (18 tests). All wired into CI.

### Phase 7 — coverage

Measured for the first time. Settlement contracts 86–93% lines; verifier 97%/100% functions;
**node 12% statements**. Found that CI's node-coverage step had been silently doing nothing —
`@vitest/coverage-v8` was never installed, and `|| true` hid it.

### Phase 8 — testnet hardening

Chaos: **10 scenarios, 10 passed**, after fixing five defects in the harness itself (§"Six
real defects"). [TESTNET_OPERATIONS.md](TESTNET_OPERATIONS.md) documents both outages and
their guards.

### Phases 9, 11–12 — documentation and contribution

`CODE_OF_CONDUCT.md`, [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md),
[NODE_OPERATOR_GUIDE.md](NODE_OPERATOR_GUIDE.md),
[DECENTRALIZATION_ROADMAP.md](DECENTRALIZATION_ROADMAP.md), five issue templates and a PR
template that requires claims to match the code.

### Phase 10 — examples

Three, all executed against a live chain: `hello-world` (deploy and call in ~60 lines),
`basic-contract` (a standalone Foundry project with a re-entrancy attack and a fuzz property),
`basic-frontend` (no build step, no dependencies). `tests/examples-smoke.sh` runs them in CI.

### Phase 13 — observability

**Monitoring deployed and scraping.** It had never worked: Prometheus targeted `kaurax-node`,
a service that does not exist. Added an alert for unscrapeable targets — the one that would
have caught it.

### Phase 14 — performance

First measured figures: **204.3 tx/s, 8,000/8,000, zero failures**, with latency, DA cost and
verifier gas. [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) states what bounded each run.

### Phases 15–18 — funding, mainnet, audit

[FUNDING_PLAN.md](FUNDING_PLAN.md), [MAINNET_CHECKLIST.md](MAINNET_CHECKLIST.md) with hard
seven-part gates, [AUDIT_PACKAGE.md](AUDIT_PACKAGE.md) with scope, 19 invariants and known
issues.

### Phases 19–20

[FINAL_READINESS_REPORT.md](FINAL_READINESS_REPORT.md) — 18 categories scored with evidence.
This document.

---

## Six real defects, and how each was found

| | Defect | Found by |
|---|---|---|
| 1 | README quick-start not runnable | Running it |
| 2 | Devnet unusable after the first run | Running it twice |
| 3 | Prometheus scraped a service that does not exist | Checking targets instead of trusting config |
| 4 | Load test could not complete its own setup — no explicit nonces | Running it |
| 5 | **`/api/health` probes were unbounded** — a suspended database or a restarting node made the endpoint hang instead of reporting down. `curl` got 000, not 503 | The chaos suite, twice: the database probe first, the RPC probe only after that was fixed |
| 6 | **`deploy.sh` would have unpublished the port the CDN reaches** | Causing the outage by hand |

Number 5 is the most valuable. A health endpoint that hangs is the exact failure it exists to
report: an orchestrator sees a request in flight rather than a service to restart. Fixed with
a shared deadline on every probe and four regression tests.

---

## Security fixes

| ID | Fix |
|---|---|
| O-1 | `deploy.sh` refuses a deploy that would stop publishing a currently-published port |
| O-2 | `deploy-contracts.sh` refuses to run when the engine is past genesis — verified refusing at block 332 |
| O-3 | `start.sh` clears chain-instance state; CI restarts the devnet |
| O-4 | `pnpm kaurax` added; README corrected |
| O-5 | `start.sh` refuses to start when a port is held by a process it did not start |
| A-1 | The false `op-geth` claim corrected, with why it matters for provability |
| A-4 | Monitoring target fixed; unscrapeable-target alert added |
| A-5 | nginx preserves the client protocol instead of overwriting it |
| — | `/api/health` probes bounded (§6 above) |

**Nothing was downgraded.** H-1, H-2 and H-3 remain HIGH.

---

## Fault-proof status

**KAURAX has no fault proof over its own state transitions.**

A real one-step verifier exists for the KAURAX Verifiable Subset — a documented EVM subset. It
executes a disputed instruction on chain and decides from the result: no oracle, no signature,
no privileged caller. It is **deliberately not connected to `KauraxL2OutputOracle`**, because
KAURAX output roots commit to no execution trace, and wiring them would produce a contract
that looked like a fault proof while proving something unrelated.

Settlement disputes remain guardian-resolved.

---

## Test results

| Suite | Result |
|---|---|
| `forge test` | **385 passed**, 0 failed, 23 suites |
| `pnpm test` | **181 passed**, 29 turbo tasks |
| Fault-proof properties | **10 passed** |
| Security + adversarial | **44 passed** |
| Acceptance, end to end | **47 checks passed** |
| Chaos | **10 scenarios, 10 passed** |
| Examples | **5 checks passed** |
| `pnpm typecheck` | 28/28 |
| `pnpm build` | **21/21** |
| `forge fmt --check` | clean |

**612 automated assertions.** No test was deleted or weakened. Two were *changed* because they
passed vacuously — one tampered with a proof the verifier hardcodes, one targeted `STOP`,
which consumes no proofs at all.

---

## Testnet status

Live at `https://kaurax.network`, head ~49,500, chain 8420. Ten containers healthy.
Prometheus scraping three targets. Chain state and history verified intact after both outages.

**Two outages, both mine**, totalling about six minutes of `/api` and `/rpc`. The chain never
stopped and nothing was lost. Both causes were real latent defects — running the documented
`deploy.sh` would have caused the first — and both are now guarded. The method that found
them is not one to repeat.

---

## Remaining risks

| | |
|---|---|
| **H-1** No fault proof over KAURAX execution | The ceiling. Requires replacing the execution engine |
| **H-2** Guardian decides settlement disputes | Follows from H-1 |
| **H-3** No external audit | Requires budget and code freeze |
| **M-3** Operator keys local | Signer built and tested, not deployed |
| **M-4** No TLS on the public RPC | Host blocks 80/443 on this account |
| Branch coverage 16–70% | Revert paths largely unexercised |
| Node unit coverage 12% | Runtime paths are integration-tested only |
| Bond sizing unanalysed | A bond that does not deter is theatre |
| Alert thresholds uncalibrated | No alert has ever fired in production |
| One sequencer | No failover |

---

## Recommended next steps

1. **An execution engine that can emit a per-instruction trace.** Everything queues behind it.
2. Deploy `services/signer` — the highest-value fix needing no protocol work.
3. A CI gate comparing documented test counts against actual output. Counts drifted three
   times and were corrected by hand each time.
4. Raise branch coverage on `L3ToL2MessagePasser` (16.67%) and the governance contracts (40%).
5. Commission the audit **after** the verifier exists, not before.

---

## Files changed

**85 paths.** New: `packages/kvs/`, `blockchain/contracts/src/kvs/`,
`KauraxFaultDisputeGame.sol`, three KVS test suites and fixtures, `tests/security/`,
`tests/fault-proofs/`, `tests/adversarial/`, `tests/examples-smoke.sh`, `examples/` (three),
`.github/ISSUE_TEMPLATE/` (five), `.github/PULL_REQUEST_TEMPLATE.md`, `.github/profile/`,
`CODE_OF_CONDUCT.md`, and 20 documents.

Modified: `AnvilEngine.ts`, `engine/types.ts`, `services/api/src/routes/health.ts` and
`chain.ts`, `infra/scripts/devnet/start.sh`, `infra/scripts/deploy.sh`,
`infra/scripts/deployment/deploy-contracts.sh`, `tests/chaos.sh`, `tests/load.ts`,
`infra/nginx/*`, `infra/monitoring/*`, `.github/workflows/ci.yml`, `.env.example`, `README.md`
and eleven documents.

**Nothing is committed.** All work is in the working tree.

---

## Commands used

```bash
pnpm install && pnpm build && pnpm test && pnpm typecheck
cd blockchain/contracts && forge test && forge coverage --report summary && forge fmt --check
./infra/scripts/devnet/start.sh && ./tests/acceptance.sh
./infra/scripts/devnet/stop.sh && ./infra/scripts/devnet/start.sh   # restartability
pnpm --filter @kaurax/tests test && pnpm --filter @kaurax/tests test:integration
./tests/examples-smoke.sh && ./tests/chaos.sh
LOAD_TX=8000 LOAD_SENDERS=150 LOAD_CONCURRENCY=900 pnpm --filter @kaurax/tests load
```

---

## Final readiness

| | |
|---|---|
| **PUBLIC TESTNET** | ✅ Ready — and running |
| **GRANT READY** | ✅ Ready |
| **MAINNET** | ❌ Not ready — B1, B2, B3 |

**Weighted score: 52/100.** Unchanged, and that is the honest result. This work made KAURAX
more reliable, better measured and better documented. It did not make it safer to hold value
on, because that requires a fault proof over KAURAX execution, and building one requires an
execution engine this repository does not have.
