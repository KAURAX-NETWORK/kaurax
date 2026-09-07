# KAURAX — Architecture Audit

**Date:** 2026-09-08
**Method:** every claim below was checked against the source, not inferred from a filename
or a document. Where something is listed as working, the verification is named.

**Status vocabulary**, used consistently in this document and the others it links to:

| Term | Meaning |
|---|---|
| IMPLEMENTED | The code exists and does what its name says |
| TESTED | Implemented, and exercised by an automated test that would fail if it broke |
| PARTIAL | Exists but does not cover the cases its name implies |
| DESIGNED | Written down, no code |
| NOT IMPLEMENTED | Neither |

---

## 1. What KAURAX is

An application-focused Layer-3. It sequences its own EVM blocks, publishes them as calldata
to a Layer-2, and commits state roots to a contract on that L2. The L2 is configuration, not
architecture — the devnet runs an L2 stand-in on the same host; a public deployment would
point at a real rollup.

It is **not** an Ethereum fork and **not** a frontend over someone else's chain. The
settlement path is real: `tests/acceptance.ts` reconstructs a signed transaction from L2
calldata alone and checks its hash matches.

---

## 2. Component inventory

### 2.1 Contracts on the L2 (`blockchain/contracts/src/L2/`)

| Contract | Status | Notes |
|---|---|---|
| `KauraxPortal` | TESTED | Deposits, forced inclusion, withdrawal proving and finalization, guardian pause |
| `KauraxL2OutputOracle` | TESTED | Stores output roots. **Accepts them because the proposer key signed, not because anything verified them** |
| `KauraxBatchInbox` | TESTED | Receives batches; `onlyBatcher` |
| `KauraxL2ERC20Bridge` | TESTED | Token bridge counterpart |

### 2.2 Contracts on KAURAX (`blockchain/contracts/src/L3/`)

`L3ToL2MessagePasser` and `KauraxL3ERC20Bridge` are installed as predeploys at genesis at
fixed addresses; `KauraxBridgedERC20` is the minted representation. TESTED.

### 2.3 Governance (`governance/`)

`KauraxMultisig` (m-of-n, owner-epoch invalidation of stale proposals) and `KauraxTimelock`
(immutable `MINIMUM_DELAY`, self-admin only). Both TESTED — 27 tests. **Deployed by
`DeployGovernance.s.sol` but not yet holding any role on the running devnet.**

### 2.4 Node (`blockchain/l3/src/`)

| Component | Status | Notes |
|---|---|---|
| Sequencer | TESTED | Block production, mempool, fsync'd write-ahead log |
| Derivation | TESTED | L2 deposits → L3 transactions, with a durable checkpoint |
| Batcher | TESTED | RLP + zlib, calldata to the inbox |
| Proposer | IMPLEMENTED | Posts output roots on an interval |
| Forced inclusion | TESTED | Watches the portal, acknowledges only what derivation applied |
| Signer | TESTED | Local key or remote signing service; the node need never hold a key |
| Execution engine | IMPLEMENTED | anvil (revm), driven with `--no-mining --order fifo` |

### 2.5 Services

`api` (Fastify), `indexer` (PostgreSQL), `signer` (reference signing service). All
IMPLEMENTED and running on the devnet.

### 2.6 Frontends

Ten Next.js apps served as zones under one domain. IMPLEMENTED and deployed.

---

## 3. What is trusted today

This section is the point of the audit. Everything here is a place where KAURAX asks you to
trust an operator rather than verify a fact.

| # | Assumption | Consequence if violated |
|---|---|---|
| T1 | **Output roots are not proven.** `proposeL2Output` checks the caller is the proposer, the block number is the expected one, and the timestamp is not in the future. It does not check the root corresponds to any execution | A dishonest proposer can commit any root and, after the finalization period, withdraw against it |
| T2 | **The challenger is a single key.** `deleteL2Outputs` is `onlyChallenger` | A passive or captured challenger means T1 goes unchecked; a malicious one can delete honest proposals |
| T3 | **The sequencer is one operator.** No consensus, no rotation | It can reorder or delay transactions. It cannot forge signatures, and forced inclusion bounds censorship |
| T4 | **The guardian can pause the portal** | Withdrawals stop |
| T5 | **Acknowledgement of forced transactions is the sequencer's own assertion** | Detectable by anyone comparing chain data, but not proven on chain |
| T6 | **Operator keys are local on the devnet** | Compromising the node yields the sequencer, batcher and proposer identities. The signing seam exists and is tested; the devnet does not use it |

**T1 and T2 together are the fault-proof gap.** Everything else is ordinary operational
centralisation that a testnet may reasonably have.

---

## 4. What is genuinely not trusted

Worth stating, because it is the part that already works:

- **Data availability.** Every batched block is reconstructible from L2 calldata by anyone.
  Verified end to end in `tests/acceptance.ts`.
- **Deposits.** Derived from L2 events, so the sequencer cannot censor them without
  censoring the L2.
- **Forced inclusion.** A user can force a transaction from the L2; if it goes unacknowledged
  past its deadline the output oracle rejects every proposal, halting settlement for
  everyone. Verified on a live chain, not only in unit tests.
- **Withdrawal proofs.** A withdrawal needs a Merkle proof against a published root. There is
  no operator approval step.

---

## 5. Incomplete or missing

| Gap | Status | Blocks |
|---|---|---|
| One-step verifier | NOT IMPLEMENTED | Mainnet. This is the fault-proof gap |
| Dispute game | NOT IMPLEMENTED at audit time | Public testnet credibility |
| Bonds | NOT IMPLEMENTED | Dispute game |
| Governance holding roles | IMPLEMENTED, not deployed | Mainnet |
| Remote signing in production | TESTED, not deployed | Public testnet |
| TLS on the public endpoint | NOT IMPLEMENTED | Public testnet |
| Automated backups | IMPLEMENTED, unverified on the server | Mainnet |
| Contract audit | NOT STARTED | Mainnet |
| Source verification in the explorer | NOT IMPLEMENTED | Reports `verified: false` honestly |

---

## 6. Testnet blockers

1. TLS on the RPC endpoint. Currently plain HTTP on a non-standard port because UpCloud
   blocks 80/443 on trial accounts.
2. Operator keys should move to the signing service.
3. Dispute game, so that challenging is not one key.

## 7. Mainnet blockers

1. **A real one-step verifier.** Nothing else on this list matters without it.
2. External audit of the settlement and bridge contracts.
3. Governance holding the guardian, challenger and owner roles.
4. Sequencer decentralisation or a credible escape hatch beyond forced inclusion.
5. Disaster recovery rehearsed, not just scripted.

---

## 8. Recommended order

1. Permissionless dispute game with bonds and bisection, guardian as final arbiter — this
   removes T2 (single challenger key) without pretending to solve T1.
2. Hand the guardian and challenger roles to the multisig and timelock.
3. Move operator keys to the signing service.
4. TLS.
5. Fault-proof specification, then implementation, then audit.

Step 1 is worth doing precisely because it is honest about what it is not: it makes
challenging permissionless and lying expensive, while the final decision still rests with
the guardian. See [DISPUTE_GAME.md](DISPUTE_GAME.md) and
[FAULT_PROOF_SPEC.md](FAULT_PROOF_SPEC.md).
