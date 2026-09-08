# KAURAX — Security Model (grant reviewer's summary)

**The canonical document is [../SECURITY_MODEL.md](../SECURITY_MODEL.md).** It is kept in one
place on purpose; this page summarises it for a reviewer and adds the framing a funder needs.
If the two ever disagree, the canonical one is correct and this one is a bug.

---

## The one line that matters

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

The first clause is trustless today. **The second clause is a 2-of-3 multisig, and removing it
is what this grant funds.**

---

## Trust status, condensed

| | TRUSTLESS | TRUSTED | CENTRALIZED | NOT IMPLEMENTED |
|---|---|---|---|---|
| Data availability | ✅ | | | |
| Deposits | ✅ | | | |
| Forced inclusion | ✅ | | | |
| Withdrawal proofs | ✅ *(given a correct root)* | | | |
| Dispute initiation | ✅ | | | |
| Execution | | ⚠️ | | |
| **Output roots** | | ⚠️ | | |
| **Dispute resolution** | | ⚠️ | | |
| Governance | | ⚠️ | | |
| Key management | | ⚠️ | | |
| Sequencing / ordering | | | ⚠️ | |
| **Fault proofs** | | | | ❌ |
| Sequencer decentralization | | | | ❌ |
| External audit | | | | ❌ |

Vocabulary is used strictly: **TRUSTLESS** holds even if every KAURAX operator is dishonest;
**TRUSTED** holds only while a named party behaves; **NOT IMPLEMENTED** means it does not
exist. Per-row evidence is in the canonical document.

---

## What a reviewer should verify before believing any of this

None of the above requires taking the project's word for it.

| Row | Command |
|---|---|
| Data availability | `pnpm --filter @kaurax/l3 test` — `tests/acceptance.ts` rebuilds a signed transaction from L2 calldata alone |
| Forced inclusion | 21 tests, plus a live run: overdue → `proposeL2Output` reverts → acknowledged → resumes |
| Withdrawal proofs | 25 portal tests, 8 Merkle tests including fuzz |
| Dispute game | 41 + 11 tests; a game played to resolution on the live testnet |
| Fault proofs absent | `grep -r "OneStepVerifier" blockchain/contracts/src/` returns nothing |
| The contract says so itself | `KauraxDisputeGame.isFaultProof()` returns `false` on chain |

The fifth and sixth rows are the ones worth running. A project claiming a limitation is easy;
a project that made the limitation machine-readable is checkable.

---

## What this grant changes

| | Today | After M7 |
|---|---|---|
| Who decides a dispute | 2-of-3 multisig | A contract executing one instruction |
| Bad root, passive guardian | Can finalize | Cannot |
| Trust in operators | Required for **correctness** | Required only for **liveness** |

Nothing in M1–M6 lets KAURAX call its output roots trustless. Only the completed and audited
cutover in M7 does, and [MILESTONES.md](MILESTONES.md) states that explicitly so a partially
funded project cannot quietly start using the word.

---

## Open findings

3 HIGH-severity findings are open, 9 fixed. All are listed with status and evidence in
[../SECURITY_STATUS.md](../SECURITY_STATUS.md). The open ones are the trust assumptions above,
not undisclosed bugs — they are open because they require the work this grant funds.

Mainnet readiness self-assessment: **52/100**
([MAINNET_READINESS.md](../../MAINNET_READINESS.md)).

---

**KAURAX is a testnet. KAX has no monetary value.** Nothing here says KAURAX is safe to hold
value on — it says the opposite.
