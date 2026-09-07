# Decentralization

This document states what KAURAX is, not what it aspires to be. Everything in the roadmap
section is **unimplemented**.

## Where KAURAX stands today

| Property | State | Consequence |
|---|---|---|
| Sequencing | **Single operator** | One key decides inclusion and order. It can halt the chain. |
| Block production | **Single operator** | No failover. |
| Batch submission | **Single operator** | If it stops, KAURAX data stops reaching the L2. |
| Output proposals | **Single operator** | State commitments are trusted, not proven. |
| Fault proofs | **Not implemented** | An incorrect root that survives the window is final. |
| Challenger | **Single key** | Trusted human backstop, not a proof system. |
| Guardian (pause) | **Single key** | Can halt the bridge. |
| Permissionless validation | **Read-only** | Anyone can reconstruct and detect fraud; nobody can enforce a correction on chain. |
| Forced inclusion | **Entry only** | Deposits cannot be censored. Exits can. |
| Upgrade keys | **Single key on devnet** | No timelock, no multisig. |

Using the L2Beat framing, KAURAX today is a **Stage 0** system, and would not qualify even
for that on a public network without a multisig, a timelock and a security council.

## What *is* decentralized

Two properties, and they are real:

1. **Data availability.** Every sequenced transaction is published to the L2 and from there
   to Ethereum. Reconstructing KAURAX requires nobody's permission.
2. **Entry.** A deposit originates as an L2 event. Censoring it requires censoring the L2.

Together these mean the operator cannot rewrite history secretly — fraud is *detectable*.
It is not yet *preventable*.

## Roadmap — none of this is built

### 1. Fault proofs (highest priority)

Without these, everything else is cosmetic. Requires a dispute game over KAURAX state
transitions, played on the L2: `OutputRoot → dispute game → bisection → single-step
execution`. The OP Stack's `FaultDisputeGame` plus a KAURAX-specific fault-proof VM is the
intended path, and it is the reason the output root construction already matches OP's shape.

### 2. Multisig and timelock

Replace every single key — guardian, challenger, proposer owner, batch inbox owner — with a
multisig, and put contract upgrades behind a timelock long enough for users to exit. This is
the cheapest meaningful improvement available and should not wait for proofs.

### 3. Forced exit

Today, forced inclusion covers deposits only. A user with KAX on KAURAX and a censoring
sequencer has no on-chain way out. The mechanism needed is a portal-initiated transaction
that the node **must** include within a bounded number of L2 blocks, with the sequencer
losing its right to propose if it does not.

### 4. Sequencer failover, then shared sequencing

A standby sequencer with a documented, tested handover, then participation in a shared
sequencer network (Espresso, Astria, or the L2's own, once such a thing exists for L3s).

### 5. Permissionless proposing

Anyone able to post an output root, backed by a bond and adjudicated by the dispute game
from step 1. Meaningless before fault proofs exist.

### 6. Validity proofs (optional)

A ZK path would remove the challenge window entirely, at the cost of prover infrastructure.
This is a possible replacement for steps 1 and 5, not an addition to them.

## Honest framing

The order above is not negotiable in practice: steps 3–6 provide little real safety while
step 1 is missing, and step 2 provides some safety immediately and cheaply. Any claim that
KAURAX is "decentralized" before step 1 ships would be false.

See [`../MAINNET_READINESS.md`](../MAINNET_READINESS.md) for the full gate list.
