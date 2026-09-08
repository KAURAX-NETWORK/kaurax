# KAURAX — Security Model

What each property rests on, and what breaks if that assumption fails.

**Vocabulary, used strictly:**

| Term | Meaning |
|---|---|
| **TRUSTLESS** | Holds even if every KAURAX operator is dishonest |
| **TRUSTED** | Holds only while a named party behaves |
| **CENTRALIZED** | One party, no redundancy |
| **NOT IMPLEMENTED** | Does not exist |

---

## The table

| Property | Status | Trust assumption | Evidence |
|---|---|---|---|
| **Execution** | TRUSTED | The sequencer executes honestly; nothing verifies the result on chain | Live chain; EVM-equivalent |
| **Data availability** | **TRUSTLESS** | None. Every block is L2 calldata | `tests/acceptance.ts` rebuilds a signed transaction from calldata alone and checks its hash |
| **Deposits** | **TRUSTLESS** | None. Derived from L2 events | 21 forced-inclusion tests; live verification |
| **Forced inclusion** | **TRUSTLESS** | None. An ignored forced transaction halts settlement for everyone | Verified on a live chain: overdue → `proposeL2Output` reverted → acknowledged → resumed |
| **Withdrawal proofs** | **TRUSTLESS** *(given a correct root)* | Merkle proof against a published root; no operator approval | 25 portal tests, 8 Merkle tests incl. fuzz |
| **Output roots** | **TRUSTED** | The proposer commits honestly. **Nothing verifies the root matches any execution** | `proposeL2Output` checks caller, block number, timestamp — not state |
| **Dispute resolution** | **TRUSTED** | A 2-of-3 multisig rules correctly | 41 + 11 tests; live game played to resolution |
| **Dispute initiation** | **TRUSTLESS** | None. Anyone may challenge with a bond | Permissionless by construction |
| **Sequencing / ordering** | **CENTRALIZED** | One sequencer. It can reorder and delay; forced inclusion bounds censorship | Single operator by design |
| **Governance** | TRUSTED | 2-of-3 multisig; 1-hour timelock on the batch inbox | 27 tests; roles verified on chain |
| **Key management** | TRUSTED | Operator keys are local in the current deployment | Signing seam built and tested (11 + 19 tests); **not active in production** |
| **Fault proofs over KAURAX execution** | **NOT IMPLEMENTED** | — | Output roots commit to no execution trace, and the engine (`anvil` over JSON-RPC) cannot emit one. A one-step verifier, trace commitments and a dispute game that resolves through them **do** exist for a documented EVM subset, deliberately unwired from settlement: [FAULT_PROOFS.md](FAULT_PROOFS.md) |
| **Sequencer decentralization** | **NOT IMPLEMENTED** | — | Roadmap Phase 5 |
| **External audit** | **NOT IMPLEMENTED** | — | None commissioned |

---

## The honest one-line summary

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

A fault proof would remove the second clause. That is the entire difference between KAURAX
today and a trust-minimised rollup, and it is why fault-proof work is the project's next
priority rather than features.

---

## What an attacker can and cannot do

**Cannot**, regardless of who they are:

- Hide transaction data — it is on the L2 and reconstructible by anyone
- Censor a user indefinitely — forced inclusion halts settlement past the deadline
- Forge a withdrawal — it requires a Merkle proof against a published root
- Delete a state commitment unilaterally — that now requires a played dispute game
- Prevent a challenge — challenging is permissionless and bonded

**Can**, if they are the proposer *and* the guardian is captured or mistaken:

- Commit a state root that does not match execution, and withdraw against it once final

That single row is the security model's ceiling.

---

## What would change with fault proofs

| | Today | With a verifier |
|---|---|---|
| Who decides a dispute | 2-of-3 multisig | A contract executing one instruction |
| Bad root with a passive guardian | Can finalize | Cannot |
| Trust in operators | Required for correctness | Required only for liveness |

See [FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md). Estimated 18–30 engineer-months, then
an audit.

---

**KAURAX is a testnet. KAX has no monetary value.** Nothing in this document should be read
as a claim that KAURAX is safe to hold value on.
