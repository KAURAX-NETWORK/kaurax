# KAURAX

**An experimental Ethereum Layer-3 testnet.**

KAURAX gives an application its own EVM blockspace, settles to a Layer-2, and publishes
every block there as calldata — so anyone can rebuild the chain without asking KAURAX for
anything.

> ### Read this before anything else
>
> KAURAX is a **testnet**. KAX has no monetary value and none is planned in this repository.
>
> - **The sequencer is trusted.** One operator orders transactions.
> - **There is no fault proof over KAURAX execution.** Output roots are accepted because the
>   proposer key signed them, not because anything checked them. A working one-step verifier
>   does exist, for a documented EVM subset, and is deliberately **not** connected to
>   settlement — KAURAX blocks do not run on that subset.
>   [docs/FAULT_PROOFS.md](docs/FAULT_PROOFS.md) states the gap precisely.
> - **There has been no external audit.**
>
> A 2-of-3 multisig resolves disputes. Honest summary: *funds are safe if at least one
> honest party challenges a bad state commitment **and** the guardian rules correctly.*
> A fault proof would remove the second clause. Building one is
> [18–30 engineer-months](docs/FAULT_PROOF_ROADMAP.md).
>
> Self-assessed mainnet readiness: **52/100** ([scorecard](MAINNET_READINESS.md)).

---

## Status, by category

Nothing is listed as working unless a named command demonstrates it. Reproduce all of it in
about fifteen minutes: [docs/REPRODUCIBLE_TESTNET_DEMO.md](docs/REPRODUCIBLE_TESTNET_DEMO.md).

### ✅ WORKING — demonstrated, not asserted

| | | Shown by |
|---|---|---|
| **EVM execution** | Solidity, Foundry, Hardhat, MetaMask, viem and ethers work unchanged | `tests/acceptance.sh` |
| **Data availability** | Every block published as L2 calldata — and a signed transaction is rebuilt from it alone, hash matched | `tests/acceptance.sh` step 8 |
| **L2 settlement** | Real contracts; batches, output roots and bonds on chain | `tests/acceptance.sh` steps 7, 9 |
| **Proof-based withdrawals** | A Merkle proof against a published root. No operator approval step | `tests/acceptance.sh` step 10 |
| **Forced inclusion** | Miss the deadline and the oracle rejects every proposal — censoring one user halts settlement for everyone | `tests/forced-inclusion.sh` |
| **Dispute game** | A stranger challenges a root, bisection narrows it, finalization is blocked, the root is deleted — no guardian involved | `tests/dispute.sh`, 23 checks |
| **Governance** | Every privileged role held by a 2-of-3 multisig or a 1-hour timelock | `Governance.t.sol`, `TimelockSelfAdmin.t.sol` |
| **Wallet and CLI** | Real signing, encrypted keys, faucet, explorer, indexed history | `tests/e2e-testnet.sh` |
| **Alerting** | Rules route by severity to a real destination; a deploy without one is refused | `tests/check-alerting.sh` |
| **Tests** | 385 contract · 181 node · 12 live end-to-end | `forge test`, `pnpm test` |

### 🧪 EXPERIMENTAL — real code, deliberately not load-bearing

| | |
|---|---|
| **One-step verifier** | 544 lines of on-chain opcode execution for the documented KAURAX Verifiable Subset, agreeing with a reference emulator on 404 differential cases. **Not connected to settlement**, because KAURAX blocks run on the full EVM and not on that subset |
| **Multi-level fault dispute game** | Bisects block → transaction → instruction and ends in that verifier. Referenced by tests only; settlement still uses the guardian-resolved game |

### ❌ MISSING

- **Fault proofs over KAURAX execution** — the engine is `anvil` over JSON-RPC and cannot emit a trace, and output roots do not commit to one. 18–30 engineer-months ([the gap, measured against the code](docs/FAULT_PROOF_GAP_ANALYSIS.md))
- **Decentralized sequencing** — one sequencer; forced inclusion bounds the damage. Deliberately deferred until fault proofs exist
- **TLS on the public RPC** — the host blocks 80/443 on trial accounts
- **Operator keys on the signing service in production** — built and tested, not in use

### 🔍 NOT AUDITED

No external firm has read this code. 385 contract tests are evidence of intent, not of
correctness. "Audited" will not appear here until a report exists and is linked.

### 🚫 NOT MAINNET READY

Self-assessed **52/100**, with fault proofs and audit — 30 of the 100 — both at zero.
The full scorecard gives STATUS, EVIDENCE and REMAINING WORK per category:
[MAINNET_READINESS.md](MAINNET_READINESS.md).

---

## Try it

```bash
pnpm install
pnpm turbo run build --filter=@kaurax/cli

export KAURAX_RPC_URL=https://kaurax.network/rpc
export KAURAX_API_URL=https://kaurax.network
export KAURAX_PASSPHRASE='choose-something'

pnpm kaurax wallet create mykey
pnpm kaurax faucet
pnpm kaurax wallet send 0xRecipient 1
```

Building the CLI does not put `kaurax` on your `PATH` — this file used to say it did, and a
new developer following it hit `command not found` on the third line. `pnpm kaurax` runs the
built binary from anywhere in the repository. To get the bare command, link it once:

```bash
pnpm --filter @kaurax/cli exec npm link    # then: kaurax network status
```

### MetaMask

```
Network name     KAURAX Testnet
RPC URL          https://kaurax.network/rpc
Chain ID         8420
Currency symbol  KAX
Explorer         https://kaurax.network/explorer
```

### Run the whole thing locally

```bash
./infra/scripts/devnet/start.sh    # L1 + L2 stand-ins + KAURAX
./tests/acceptance.sh
```

Full instructions, including running against a real L2: [docs/TESTNET.md](docs/TESTNET.md).

---

## How it fits together

```
Ethereum (L1)        settlement, data availability
    ▲
Underlying L2        Portal · OutputOracle · BatchInbox · DisputeGame
    ▲   batches (calldata) · output roots · bonds
KAURAX (L3)          sequencer · derivation · batcher · proposer
```

There are **no validators and no consensus** — KAURAX is a rollup. Ordering is the
sequencer's; security comes from data availability, forced inclusion and settlement. The
explorer says the same where users see it.

---

## Repository

```
blockchain/contracts   Solidity: settlement, bridge, dispute game, governance, apps
blockchain/l3          The node: sequencer, derivation, batcher, proposer, signer
services/              API, indexer, reference signing service
apps/                  Ten Next.js frontends, served as zones under one domain
packages/              SDK, CLI, shared types and UI
infra/                 Docker, nginx, deployment and ops scripts
tests/                 Acceptance, end-to-end, chaos, load
docs/                  65 documents, rendered at kaurax.network/docs
```

---

## Documentation

| | |
|---|---|
| [**Reproduce every claim**](docs/REPRODUCIBLE_TESTNET_DEMO.md) | One command, from a clean clone, ~15 minutes |
| [Fault proof gap analysis](docs/FAULT_PROOF_GAP_ANALYSIS.md) | The distance to a real fault proof, measured against the code |
| [Technical brief for funders](docs/FUNDING_TECHNICAL_BRIEF.md) | What exists, what does not, and what the difference would cost |
| [Architecture audit](docs/ARCHITECTURE_AUDIT.md) | What exists, what is trusted, what is missing |
| [Mainnet readiness](MAINNET_READINESS.md) | Scorecard with evidence per row |
| [Dispute game](docs/DISPUTE_GAME.md) | Bonds, bisection, and why it is not a fault proof |
| [Fault proof roadmap](docs/FAULT_PROOF_ROADMAP.md) | The largest open problem |
| [Security review](docs/SECURITY_REVIEW.md) | Three HIGH findings, all open |
| [Running a node](docs/TESTNET.md) | Every command |
| [Roadmap](docs/ROADMAP.md) · [Funding](docs/FUNDING.md) | Where this goes next |

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). The rule that matters most: **never claim a property the
code does not have.** `KauraxDisputeGame.isFaultProof()` returns `false`, and there is a test
asserting it.

Security issues: [SECURITY.md](SECURITY.md). Not a public issue.

## Licence

MIT
