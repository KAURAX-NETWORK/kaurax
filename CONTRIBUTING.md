# Contributing to KAURAX

Thanks for looking. This document gets you a running chain in a few minutes and explains
what a good contribution looks like here.

---

## Run it locally

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git
cd kaurax
pnpm install
```

You need **Node 20+**, **pnpm 10+**, **Docker**, and **Foundry** (`curl -L
https://foundry.paradigm.xyz | bash && foundryup`).

Bring up all three layers — an L1 stand-in, an L2 stand-in, and KAURAX:

```bash
./infra/scripts/devnet/start.sh
```

That deploys the settlement contracts, installs the predeploys, and starts the node. Then:

```bash
./infra/scripts/devnet/status.sh     # three-layer view, read from RPC
./tests/acceptance.sh                # rebuilds a transaction from L2 calldata
./infra/scripts/devnet/stop.sh
```

`docs/TESTNET.md` covers running against a real L2, the signing service, and every failure
mode.

---

## Tests

```bash
cd blockchain/contracts && forge test     # 262
pnpm test                                 # 121, 25 packages
./tests/e2e-testnet.sh                    # wallet → transaction → confirmation
./tests/live-check.sh                     # a deployed site, by content
```

All of these must pass before a pull request is reviewed.

---

## What makes a good contribution

**Tests that would fail without your change.** A test asserting what the code already does
is not evidence. The adversarial tests are the model: they use real attacker contracts
rather than asserting intent.

**Comments that explain why.** The codebase is deliberately heavy on reasoning and light on
description. `// increment counter` is noise; a note saying that bonds are credited rather
than pushed because a reverting proposer would otherwise block deletion is the point.

**Honest naming.** If something is not verified, it does not get a name implying it is. This
matters more here than in most projects — see below.

---

## The rule this project cares about most

**Never claim a property the code does not have.**

Concretely, and these are not hypothetical:

- No function called `verifyProof` that returns `true`
- No "validators" that are one process in a loop
- No metric that is not measured — where a number is unknown, the UI says
  `No data available`
- No "trustless", "decentralized" or "fault-proven" in documentation or UI unless the
  implementation supports it

`KauraxDisputeGame.isFaultProof()` returns `false` and is tested. That is the standard.

If you find a place where KAURAX overstates itself, that is a bug report we want.

---

## Style

- TypeScript strict; no `any` escape hatches
- Solidity 0.8.28, custom errors over string reverts
- `pnpm typecheck` and `forge fmt --check` must pass
- Conventional commit subjects are not required; clear ones are

---

## Pull requests

1. Branch from `main`
2. Make the change, with tests
3. Run the suites above
4. Open a PR describing what changed and **what you verified**, not what you intended
5. CI runs lint, typecheck, unit tests, contract tests, a devnet end-to-end run, and Slither

If a test is flaky, say so rather than re-running until it passes.

---

## Security

Do not open a public issue for a vulnerability. See `SECURITY.md`.

---

## Where to start

- `docs/ARCHITECTURE_AUDIT.md` — what exists, what is trusted, what is missing
- `docs/DISPUTE_GAME.md` — the most interesting contract
- `docs/FAULT_PROOF_ROADMAP.md` — the largest open problem
- `MAINNET_READINESS.md` — an honest scorecard, currently 51/100

Good first issues tend to be in the frontends, the CLI, or test coverage. The settlement
contracts and the node are where mistakes are expensive; changes there need a clear argument
and thorough tests.
