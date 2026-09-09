# KAURAX — Grant Readiness

**What this is:** an experimental Ethereum Layer-3 testnet with a working permissionless
dispute game and **no fault proof system**. That absence is stated first because it
determines what KAURAX can honestly claim.

> **This is the project-wide overview.** The funding request itself — proposal, milestones,
> budget, impact, FAQ and proposed issues — is the package in
> [`docs/grants/`](grants/GRANT_OVERVIEW.md). Where the two describe the same thing, the
> grants package is the more detailed and more recent.

---

## 1. The problem

Applications on shared blockspace contend with unrelated traffic: an NFT mint raises your
users' fees and delays their transactions. Application-specific chains fix that by giving an
application its own blockspace.

The usual cost is security. A new chain bootstraps its own validator set and inherits
nothing. A Layer-3 avoids that — it settles to a Layer-2 and publishes its data there — but
only if the settlement is real rather than decorative. Many "L3s" are a chain with a bridge
and a marketing page.

KAURAX's position: build the settlement path properly and be explicit about the part that is
not finished.

---

## 2. Architecture

```
Ethereum (L1)        settlement, data availability
    ▲
Underlying L2        KauraxPortal · KauraxL2OutputOracle · KauraxBatchInbox · KauraxDisputeGame
    ▲   batches as calldata · output roots · bonds
KAURAX (L3)          sequencer · derivation · batcher · proposer
```

The L2 is configuration, not architecture. No validators and no consensus: it is a rollup.

---

## 3. Technical status

| Component | Status | Evidence |
|---|---|---|
| Execution (EVM-equivalent) | Working | Live chain, blocks every 2s |
| Data availability | **Verified** | A transaction is rebuilt from L2 calldata alone |
| Deposits | Verified | Derived from L2 events |
| Forced inclusion | **Verified live** | An ignored forced tx halts settlement |
| Withdrawals | Verified | Merkle proof; no operator approval |
| Dispute game | **Working** | 12 blocks → 4 bisections → resolution → deletion, on chain |
| Bonds and escrow | Working | Escrow held at proposal time |
| Governance | Working | 2-of-3 multisig, 1h timelock, holds every role |
| Wallet, CLI, faucet, explorer, API | Working | 12 live E2E checks |
| **Fault proofs** | **Not started** | No verifier exists; no stub written |
| External audit | Not started | — |

---

## 4. Live capabilities

Anyone can, today: add the network to MetaMask; get testnet KAX from a rate-limited faucet;
deploy Solidity with Foundry or Hardhat unchanged; send transactions; browse blocks,
transactions and complete address history; deposit and withdraw across the bridge; **open a
bonded dispute against a state commitment**; and rebuild any transaction from L2 calldata
without asking KAURAX for anything.

---

## 5. Testing

| Suite | Count | What it covers |
|---|---|---|
| Contract tests | **262** | Settlement, bridge, Merkle proofs, forced inclusion, governance, dispute game, apps |
| Node tests | **121** | WAL recovery, derivation checkpoint, signing seam, indexer, API |
| Live E2E | **12** | Wallet → transaction → block → state → confirmation, real signatures |

Adversarial coverage uses real attacker contracts — a challenger that re-enters during
payout, a proposer whose fallback reverts — not assertions about intent. Bond conservation
is fuzzed.

---

## 6. Trust assumptions

**Trustless:** data availability, deposits, forced inclusion, withdrawal proofs.

**Trusted:** output roots (nothing verifies them), dispute resolution (a 2-of-3 multisig
decides), transaction ordering (one sequencer).

The honest one-line summary: *funds are safe if at least one honest party challenges a bad
output root **and** the guardian rules correctly.* A fault proof removes the second clause.

---

## 7. Limitations

1. No fault proofs — the binding constraint
2. Bisection reaches a block, not an instruction; no trace commitments exist
3. Single sequencer
4. No external audit
5. Operator keys local in the current deployment, though the signing seam is built and tested
6. No TLS on the public RPC (host restriction, not a code issue)

---

## 8. What fault proofs require

A proving VM, execution trace commitments, a preimage oracle, and a one-step verifier.
**18–30 engineer-months**, then an audit. [FAULT_PROOF_ROADMAP.md](FAULT_PROOF_ROADMAP.md)
has the detail.

The dispute game was built so integration replaces one call: bonds, timeouts, bisection and
settlement are unchanged.

---

## 9. What sequencer decentralization requires

6–12 engineer-months for a permissioned rotating set; longer for permissionless staking.
Sequenced **after** fault proofs on purpose — distributing block production while nobody can
prove a block wrong spreads the ability to lie rather than removing it.

---

## 10. Roadmap

[ROADMAP.md](ROADMAP.md). Six phases: public testnet (largely done), security hardening,
fault proofs, audit, sequencer decentralization, mainnet.

---

## 11. Funding

[FUNDING.md](FUNDING.md). Five milestones, each with a deliverable that can be checked by
someone outside the project. No token sale, no returns offered, no tokenomics.

---

## 12. Milestones

These five are **project phases**, not the grant's milestones. The funding request covers
phase 2 only, broken into M1–M7 with acceptance tests in
[`docs/grants/MILESTONES.md`](grants/MILESTONES.md).

| # | Deliverable | Verifiable by |
|---|---|---|
| 1 | Security and infrastructure hardening | TLS live; keys on the signing service; recovery rehearsal published; bug bounty open |
| 2 | Fault proof research and implementation | Verifier repository, test vectors, traces reproducible by a third party |
| 3 | Independent audit | Published reports and remediation |
| 4 | Sequencer decentralization | Multiple operators producing blocks; rotation observable on chain |
| 5 | Mainnet preparation | Every checklist item in MAINNET_READINESS.md §J closed |

Every milestone is verifiable without trusting the team's word. That is deliberate: a grant
report that can only be checked by its author is not a report.

---

## 13. Why fund this

Not because KAURAX is finished — it scores **52/100** on its own mainnet readiness
assessment, and that number is in the repository.

Because the parts that are built are built correctly and tested adversarially; because the
dispute game is designed to accept a verifier rather than to substitute for one; and because
the project documents what it cannot do as prominently as what it can. The security review
lists three HIGH findings, all open, and two live outages caused by the team.

A project that hides its gaps is a worse bet than one that maps them.
