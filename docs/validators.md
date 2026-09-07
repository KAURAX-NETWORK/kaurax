# Validators

**KAURAX has no validator set.**

This document exists because the question is asked, and the honest answer is worth stating
clearly rather than filling a page with numbers that do not describe anything.

## Why there are none

KAURAX is a Layer-3. Its security comes from the underlying L2, which gets it from
Ethereum. There is no independent consensus to validate, no stake to weight it by, and no
set of nodes voting on anything. A validator count, a staking APR or an uptime leaderboard
for KAURAX would be fabrication.

The explorer's `/validators` page says exactly this.

## The roles that do exist

| Role | Count | What it does | If it misbehaves |
|---|---|---|---|
| Sequencer | 1 | Orders transactions, produces blocks | Censorship, reordering, or a halt |
| Batcher | 1 | Publishes L3 data to the L2 | Data availability failure |
| Proposer | 1 | Publishes output roots to the L2 | **Funds at risk** — nothing verifies the roots |
| Challenger | 1 | May delete unfinalized proposals | Loses the only backstop, or griefs by deleting good roots |
| Guardian | 1 | May pause the portal | Halts the bridge |

Each is a single key. None is a validator.

## What anyone can do without permission

**Reconstruct and verify KAURAX.** Every sequenced transaction is published to the L2 and
every deposit originates as an L2 event, so an independent party can replay the chain and
check the sequencer's work — see
[`data-availability.md`](./data-availability.md#how-to-reconstruct-kaurax-from-data-availability-alone).

That makes fraud **detectable by anyone**. What it does not do is make fraud **preventable**:
enforcing a correction on chain requires a fault-proof system, which KAURAX does not have.

## Future

Permissionless validation with economic enforcement is described in
[`decentralization.md`](./decentralization.md). It depends on fault proofs, which come
first. Nothing in that roadmap is built.
