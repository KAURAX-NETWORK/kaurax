# KAURAX

**An experimental Ethereum Layer-3 testnet.**

KAURAX gives an application its own EVM blockspace, settles to a Layer-2, and publishes every
block there as calldata — so anyone can rebuild the chain without asking KAURAX for anything.

> ### Read this before anything else
>
> KAURAX is a **testnet**. KAX has no monetary value, there is no token sale, and none is
> planned.
>
> - **The sequencer is trusted.** One operator orders transactions.
> - **There is no fault proof over KAURAX execution.** Output roots are accepted because the
>   proposer key signed them, not because anything checked them. A working one-step verifier
>   does exist, for a documented EVM subset, and is deliberately **not** connected to
>   settlement — KAURAX blocks do not run on that subset.
> - **There has been no external audit.**
>
> A 2-of-3 multisig resolves disputes. Honest summary: *funds are safe if at least one honest
> party challenges a bad state commitment **and** the guardian rules correctly.* A fault proof
> would remove the second clause — and that is the project's next priority.
>
> Self-assessed mainnet readiness: **52/100**, published with per-row evidence.

---

## Repositories

| | |
|---|---|
| **[kaurax](https://github.com/KAURAX-NETWORK/kaurax)** | The monorepo — contracts, node, apps, infrastructure. MIT |

---

## What works today

- **Data availability** — verified by rebuilding a signed transaction from L2 calldata alone
- **Forced inclusion** — an ignored forced transaction halts settlement for everyone
- **Proof-based withdrawals** — a Merkle proof against a published root; no operator approval
- **Permissionless dispute games** — bonds, bisection to a single block, then a guardian rules

529 automated tests: 338 Solidity, 179 node and services, 12 live end-to-end.

## What does not

No one-step verifier. No proving VM. No trace commitments. No preimage oracle. No
decentralized sequencing. No external audit.

These are listed above the feature list rather than below it, on purpose.

---

## Usage

| Metric | Value |
|---|---|
| Total value locked | No data available |
| Users | No data available |
| Transactions | No data available |
| Partners / investors | No data available |

Experimental testnet. Nothing is withheld — the numbers do not exist, and this project does
not report numbers that do not exist.

---

## Live

[kaurax.network](https://kaurax.network) — explorer, docs, wallet, bridge, and the JSON-RPC
endpoint at `/rpc`. The faucet is API-only: `POST /api/faucet` with `{"address": "0x…"}`.
There is no faucet page.

---

## Contributing

Fault proof work is the priority. Proposed issues, each with acceptance criteria a stranger
can judge, are in
[`docs/grants/ISSUE_BACKLOG.md`](https://github.com/KAURAX-NETWORK/kaurax/blob/main/docs/grants/ISSUE_BACKLOG.md).

One rule above the rest: **never claim a property KAURAX does not have.** A verifier stub, a
`verifyProof() => true`, or a document calling guardian arbitration a fault proof will be
closed.
