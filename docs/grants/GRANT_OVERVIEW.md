# KAURAX — Grant Overview

| | |
|---|---|
| **Project** | KAURAX Network |
| **Category** | Ethereum L3 / rollup infrastructure |
| **Status** | Live experimental **testnet** |
| **Repository** | https://github.com/KAURAX-NETWORK/kaurax (MIT) |
| **Testnet** | https://kaurax.network |
| **Ask** | Fund the move from guardian-dependent dispute resolution to trustless fault proofs |

## In one paragraph

KAURAX is an Ethereum Layer-3 rollup with working data availability, forced inclusion,
proof-based withdrawals and a permissionless bonded dispute game. It has **no fault proof
system**, so a 2-of-3 multisig decides every dispute. This request funds the engineering
that removes that multisig from the security model.

## What exists

578 automated tests: 385 Solidity, 181 node and services, 12 live end-to-end.

Verified rather than asserted — data availability by rebuilding a signed transaction from L2
calldata alone; forced inclusion by forcing a transaction on a live chain, watching
settlement halt, and watching it resume; the dispute game by playing one to resolution.

## What does not exist

No one-step verifier. No proving VM. No trace commitments. No preimage oracle. No
decentralized sequencing. No external audit.

These are stated in the repository's README before its feature list, and the project's own
mainnet readiness assessment is **52/100**, published with per-row evidence.

## Why fund this

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

The first clause is already trustless. The second is a multisig. Fault proofs replace it with
arithmetic.

That work is expensive, slow, and produces no user-visible feature — which is why it gets
skipped by projects under commercial pressure, and why it is a reasonable thing for ecosystem
funding to carry. The output is reusable: a verifier, trace commitments and a preimage oracle
for an EVM-equivalent L3 are not KAURAX-specific.

## Not part of this request

No token sale. No tokenomics. No returns, equity or future allocation. KAX is a testnet gas
token with **no monetary value** and none is proposed.

## Documents

[TECHNICAL_PROPOSAL.md](TECHNICAL_PROPOSAL.md) · [MILESTONES.md](MILESTONES.md) ·
[BUDGET.md](BUDGET.md) · [IMPACT.md](IMPACT.md) · [SECURITY_MODEL.md](SECURITY_MODEL.md) ·
[FAQ.md](FAQ.md) · [ISSUE_BACKLOG.md](ISSUE_BACKLOG.md)
