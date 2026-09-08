# KAURAX — Security Closure Report

**Date:** 2026-09-08 · **Type:** INTERNAL REVIEW. **No external audit has been performed or
commissioned.** Canonical finding history: [SECURITY_STATUS.md](SECURITY_STATUS.md).

**No severity was reduced.** Three HIGH findings remain open and are listed as HIGH.

---

## 1. What was closed this round

Four operational findings, all reproduced before being fixed and all verified after.

### O-1 — `deploy.sh` would have taken the origin off the internet · HIGH (operational)

**Root cause.** The live host publishes nginx on **8880**, because UpCloud blocks inbound
80/443 on this account. That mapping lives in `docker-compose.devnet.yml`. A bare
`docker compose` reads only `docker-compose.yml`, so it rebinds nginx to 80/443 — and every
container still reports healthy while the origin is unreachable.

`infra/scripts/deploy.sh` runs a bare `docker compose`. **Running the documented deploy
script would have caused this.**

**How it was found.** By causing it. `docker compose up -d --force-recreate nginx`, run by
hand to apply an nginx change, dropped the override and took `/api` and `/rpc` down for about
four minutes.

**Fix.** `deploy.sh` now compares currently published ports against what the rendered
configuration would publish, and refuses a deploy that would drop one:

```
this deploy would stop publishing port(s): 8880
```

Logic verified against both cases. `COMPOSE_FILE` is documented in `.env.example` and set on
the host, so a bare `docker compose` there now composes both files.

**Residual risk.** The guard compares against what is running. On a host where the correct
ports are already missing, it has no baseline to protect.

---

### O-2 — `bootstrap` re-deployed settlement contracts over a live chain · HIGH (operational)

**Root cause.** `deploy-contracts.sh` deploys a *new* settlement deployment and re-runs
genesis. Its own header said it "does NOT attempt to reuse an existing deployment" — but
nothing enforced that it only ran against a fresh stack. The `bootstrap` service is a
`depends_on` of `kaurax-l3`, so **any compose command touching a dependant re-runs it**.

**Impact when it happened.** `docker compose up -d api` pulled `bootstrap` in. It deployed
four contracts to the live devnet L2, then failed genesis because the predeploys already
existed. `.env` was not overwritten — the script writes addresses only on success — so the
running chain's configuration survived. Chain state was intact throughout: balances and
transaction history verified afterwards.

**Fix.** The script now reads the engine's head and refuses when it is past genesis:

```
ERROR: the execution engine is already at block 332, so this is an existing chain.
  Re-deploying would orphan the contracts it settles to and re-run genesis over live state.
  If you genuinely mean to discard that chain, set KAURAX_FORCE_BOOTSTRAP=true.
```

Verified live against a running devnet. This is the same principle as `DeployGuard`: a safety
property must not depend on remembering a flag.

**Residual risk.** Four orphaned contracts on the devnet L2. Nothing references them and no
value is held in them.

---

### O-3 — the devnet started once and never again · MEDIUM

`start.sh` launches `anvil` without `--state`, so every run creates chains from block 0, but
it left `.devnet/derivation-cursor.json` and `.devnet/sequencer-wal.jsonl` behind. The node
then correctly refused:

```
Derivation checkpoint says L2 block 69, but the L2 head is only 4.
This node is pointed at a different or reset L2. Refusing to start.
```

**The check was correct and was kept.** `start.sh` now clears chain-instance state, and CI
stops and restarts the devnet — the only way a clean-machine runner can see what a returning
developer sees. Verified: `stop.sh` → `start.sh` → `status.sh`, then 47/47 acceptance checks.

---

### O-4 — the README quickstart was not runnable · MEDIUM

`pnpm --filter @kaurax/cli build` does not put `kaurax` on `PATH`, so the third line of the
quickstart was `command not found` for every new developer. Fixed with a `pnpm kaurax` script
and a corrected README. Whole flow then verified against the live testnet: wallet create →
faucet (100 KAX) → send (block 37422, status success).

---

## 2. Documentation defects closed

| Was | Now |
|---|---|
| `AnvilEngine.ts:11` claimed the testnet profile uses `op-geth` | No such engine exists. The comment now says so, and says why it matters for provability |
| `SECURITY_STATUS.md` H-1: "No verifier exists; no stub written" | A verifier exists for the KVS subset. H-1 stays **OPEN** — it does not cover KAURAX execution |
| `SECURITY_STATUS.md` I-1: "no differential tests" | 404 differential cases exist, for the KVS. KAURAX's own STF is still unpinned |

---

## 3. Areas reviewed with no new finding

Verified against source or against the live endpoint, not assumed.

| Area | Evidence |
|---|---|
| **Cheatcode exposure** | The public RPC refuses `anvil_*`, `evm_*`, `hardhat_*`, `debug_*` — probed live, 9/9 refused. It is an **allowlist** (`PROXIED_METHODS`) with a blocked-namespace list as a second layer |
| **Engine reachability** | Port 18420 is unreachable from the internet; only 22, 80, 443, 8880 listen |
| Replay protection | Acceptance test 11: a finalized withdrawal cannot finalize twice; an L2-signed transaction is rejected by KAURAX |
| Reentrancy | `DisputeGameAdversarial.t.sol` (11) uses real attacker contracts; the fault game settles by credit, not push |
| Access control | 27 governance tests; roles verified on chain; `DeployGuard` refuses codeless targets |
| Withdrawal proofs | 25 portal tests, 8 Merkle tests including fuzz; live round trip in acceptance |
| DA reconstruction | Acceptance rebuilds a signed transaction from L2 calldata alone |
| Forced inclusion | 21 tests; verified live halting and resuming settlement |
| Integer overflow | Solidity 0.8 checked arithmetic; `unchecked` used only in the KVS verifier, where EVM wrapping is the specified behaviour and is differentially tested |
| Secrets | gitleaks blocking in CI; no `.env` committed; bundle scan; `NEXT_PUBLIC_` smuggling check |

---

## 4. Still open — nothing here was downgraded

| ID | Finding | Why it cannot be closed here |
|---|---|---|
| **H-1** | No fault proof over KAURAX execution | The engine is `anvil` over JSON-RPC and cannot emit a trace. Requires replacing the execution engine |
| **H-2** | Guardian is the final arbiter of settlement disputes | Follows from H-1 |
| **H-3** | No external audit | Requires a budget and a code freeze |
| M-3 | Operator keys are local | The signing service is built and tested but not deployed |
| M-4 | No TLS on the public RPC | The host blocks 80/443 on this account — proven, not assumed |
| L-1 | One live game per output allows mild griefing | The alternative is worse |
| I-1 | KAURAX's STF is not pinned or differentially tested | Prerequisite for any verifier over KAURAX execution |

---

## 5. Honest note on method

Two of the four findings above were found by breaking the live testnet rather than by
reading. Both are real and both are now guarded, but the sequence was: change infrastructure
by hand → observe an outage → understand the cause → fix it. Total downtime across the
session was roughly six minutes of `/api` and `/rpc`, with the chain itself never stopping and
no state lost.

The correct process — reproduce on the devnet, then apply — would have surfaced O-1 and O-2
just as well without the outage. **The guards added in §1 are the durable part; the method
that found them is not one to repeat.**
