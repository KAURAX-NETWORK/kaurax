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

## What works today

| | |
|---|---|
| **EVM execution** | Solidity, Foundry, Hardhat, MetaMask, viem and ethers work unchanged |
| **L2 settlement** | Real contracts; batches, output roots and bonds on chain |
| **Data availability** | Every block published as L2 calldata — and `tests/acceptance.ts` rebuilds a signed transaction from it alone |
| **Forced inclusion** | Submit on the L2 and start a clock. Miss it and the oracle rejects every proposal — censoring one user halts settlement for everyone. Verified on a live chain |
| **Proof-based withdrawals** | A Merkle proof against a published root. No operator approval step |
| **Dispute game** | Anyone can challenge a state commitment with a bond; bisection narrows to one block on chain |
| **Governance** | Every privileged role held by a 2-of-3 multisig or a 1-hour timelock |
| **Wallet and CLI** | Real signing, encrypted keys, faucet, explorer, indexed history |
| **Tests** | 262 contract · 121 node · 12 live end-to-end |

## What does not

- **Fault proofs** — not started; no verifier and no stub ([roadmap](docs/FAULT_PROOF_ROADMAP.md))
- **Decentralized sequencing** — one sequencer; forced inclusion bounds the damage
- **External audit** — none
- **Bisection to an instruction** — reaches a block; no trace commitments exist

---

## Try it

```bash
pnpm install
pnpm --filter @kaurax/cli build

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
docs/                  39 documents, rendered at kaurax.network/docs
```

---

## Documentation

| | |
|---|---|
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
