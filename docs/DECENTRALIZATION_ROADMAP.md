# KAURAX — Decentralization Roadmap

**Current state: Stage 1.** One sequencer, one proposer, a 2-of-3 multisig deciding disputes.
Nothing below is implemented beyond Stage 1, and no stage is marked complete because a
document says so.

Companion: [decentralization.md](decentralization.md) (what is centralized today, and the
order to fix it) and [THREAT_MODEL.md](THREAT_MODEL.md) (what each adversary can do).

---

## The ordering constraint

Decentralizing sequencing **before** fault proofs makes the system worse, not better.

With no fault proof, output roots are accepted because a key signed them. Adding more
sequencers adds more parties who can produce blocks, but changes nothing about who can commit
a bad state root — while adding leader election, slashing and liveness failure modes. The
result looks decentralized and is not.

**So: fault proofs first.** [FAULT_PROOFS.md](FAULT_PROOFS.md) §9 is the prerequisite list for
everything past Stage 2.

---

## Stage 1 — Trusted sequencer · **CURRENT**

**Implemented.** One operator orders transactions and one proposer commits roots.

| | |
|---|---|
| Trust | Sequencer for ordering and liveness; proposer for correctness; guardian for disputes |
| Mitigated | Censorship — forced inclusion halts settlement past a deadline (21 tests, verified live). Data availability — every block is L2 calldata |
| Unmitigated | Reordering, MEV, liveness. One host holds all three operator keys (M-3) |
| Evidence | `docs/SECURITY_MODEL.md`; live testnet |

**Open work inside this stage**, none of which needs new architecture:

1. Deploy `services/signer` so keys leave the node host. Built and tested; not deployed.
2. TLS on the public RPC — blocked by the host, proven not assumed (M-4).
3. Sequencer runbook for planned downtime. There is no failover, so the honest procedure is
   "announce, stop, restart" — write it down.

---

## Stage 2 — Sequencer failover

**NOT IMPLEMENTED.**

One sequencer produces; a second is ready and can take over. Not decentralization — it
removes a single point of *failure*, not a single point of *trust*.

| | |
|---|---|
| Requires | Shared or replicated WAL; a leader lock with fencing; derivation checkpoint consistency; identical genesis and config |
| Trust after | **Unchanged.** Both sequencers are operated by the same party |
| Risk | Split brain. Two sequencers sealing different blocks at the same height is worse than downtime, because it can produce two histories the L2 might batch |
| Testing | Failover under load; the standby must refuse to lead while the primary holds the lock; recovery when both believe they are leader |
| Honest framing | Availability engineering. **Do not describe it as decentralization** |

---

## Stage 3 — Permissionless sequencing research

**NOT IMPLEMENTED. Research, not engineering.**

| | |
|---|---|
| Requires | A written comparison of shared sequencing, rotating leaders and based sequencing, against KAURAX's actual constraints — an L3 settling to a configurable L2 |
| Must preserve | Forced inclusion. It is KAURAX's only censorship guarantee and any scheme that weakens it is a regression, whatever else it adds |
| Depends on | **Fault proofs.** Without them, multiple sequencers still cannot verify each other |
| Output | A design document with trade-offs stated. Implementation is a separate stage |
| Prohibited | A validator set or a consensus layer. A rollup does not need them, and adding them changes nothing about who can commit a bad root — see [validators.md](validators.md) |

---

## Stage 4 — Multiple sequencers

**NOT IMPLEMENTED.** Depends on Stage 3 and on fault proofs.

| | |
|---|---|
| Requires | Leader election or rotation; a shared mempool or explicit ordering rules; DA guarantees across operators; a defined fork-choice rule |
| Trust after | Ordering no longer depends on one party. **Correctness still depends on fault proofs, not on the number of sequencers** |
| Risk | Liveness under disagreement; MEV moving from one extractor to an auction; operational complexity multiplying failure modes |
| Testing | Adversarial: a sequencer that equivocates, one that stalls, one that censors while others do not |

---

## Stage 5 — Economic security

**NOT IMPLEMENTED.** Depends on Stage 4 and on a completed audit.

| | |
|---|---|
| Requires | Bonded sequencers with slashing conditions that are provable on chain; an economic analysis of griefing; permissionless proposing once roots are verifiable |
| Trust after | Operators are required for liveness, not for correctness |
| Risk | Bond sizing is not analysed anywhere in this repository. A bond that does not deter is theatre |
| **Not proposed** | Any token with monetary value. **KAX is a testnet gas token and this roadmap does not propose changing that** |

---

## Honest summary

| Stage | Status | Blocked on |
|---|---|---|
| 1 — Trusted sequencer | **Current** | Signer deployment, TLS, a runbook |
| 2 — Failover | Not implemented | Engineering only |
| 3 — Research | Not implemented | Fault proofs |
| 4 — Multiple sequencers | Not implemented | Stage 3 |
| 5 — Economic security | Not implemented | Stage 4, external audit |

KAURAX is at Stage 1 and the most valuable next step is **not** on this page — it is an
execution engine that can emit a trace, because everything from Stage 3 onward depends on it.

Nothing here may be described as decentralized, permissionless or trustless until the code
makes it so.
