# KAURAX — Mainnet Readiness

**Verdict: NOT READY. Not close.**

This document exists to be honest about that rather than to project confidence. Every line
is marked with what is actually true today.

Legend: **DONE** · **PARTIAL** · **NOT STARTED** · **BLOCKER**

---

## Blocking items

These prevent a mainnet launch outright. Nothing below this section matters until they are
resolved.

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | **Fault proof system** | **BLOCKER — NOT STARTED** | `KauraxL2OutputOracle` accepts a proposal because the proposer key signed it. An incorrect output root surviving the challenge window is final and can drain `KauraxPortal`. See threat model T1. |
| B2 | **Security audits** | **BLOCKER — NOT STARTED** | No contract, no node component, no bridge path has been audited by anyone. |
| B3 | **Privileged roles are single EOAs** | **BLOCKER — NOT STARTED** | Guardian, challenger, proposer, batcher owner and deployer are all single keys. No multisig, no timelock. |
| B4 | **No forced exit** | **BLOCKER — NOT STARTED** | Forced inclusion covers deposits only. A user holding KAX with a censoring sequencer has no on-chain way out. |
| B5 | **Key management** | **BLOCKER — NOT STARTED** | Keys are read from environment variables. No KMS, no hardware signing, no rotation procedure. |
| B6 | **Testnet never operated** | **BLOCKER — PARTIAL** | The `testnet` profile is configured and version-pinned but has never been run. A mainnet cannot precede a testnet that has run under load for a sustained period. |

---

## 1. L3 architecture

| Item | Status | Notes |
|---|---|---|
| Three-layer architecture (Ethereum → L2 → KAURAX) | **DONE** | Implemented and verified end to end on the devnet |
| EVM equivalence | **DONE** | Solidity, Foundry, Hardhat, MetaMask, viem, ethers all work unmodified |
| Configurable underlying L2 | **DONE** | No L2 is hardcoded anywhere |
| Chain ID collision check | **DONE** | 8420 / 8421 verified free against the public registry; **not registered** |
| Genesis reproducibility | **PARTIAL** | Devnet genesis is scripted and deterministic; no signed, published genesis artifact exists |

## 2. Sequencer

| Item | Status | Notes |
|---|---|---|
| Block production | **DONE** | Fixed interval, deposits first |
| Nonce-aware ordering, replacement rules | **DONE** | |
| Chain-ID and EIP-155 enforcement | **DONE** | |
| Failover / standby | **NOT STARTED** | A sequencer stop halts the chain |
| Decentralized or shared sequencing | **NOT STARTED** | |
| MEV policy | **NOT STARTED** | The operator can reorder freely |
| Rate limiting / DoS protection on the public RPC | **NOT STARTED** | Must be fronted by a reverse proxy |

## 3. Batcher & data availability

| Item | Status | Notes |
|---|---|---|
| Compression and publication to the L2 | **DONE** | RLP + zlib as calldata |
| On-chain contiguity enforcement | **DONE** | `NonContiguousBatch` |
| Restart resumption from L2 state | **DONE** | Never re-posts, never skips |
| **Reconstruction verified from L2 data alone** | **DONE** | Acceptance test step 8 |
| Durable write-ahead log for unbatched blocks | **NOT STARTED** | Node loss before batching loses those transactions |
| Blob (EIP-4844) DA | **NOT STARTED** | Interface exists; selecting it errors |
| External DA | **NOT STARTED** | Same |
| L2 reorg handling for batches | **PARTIAL** | Detected by the contiguity check; recovery is manual |

## 4. Proposer & settlement

| Item | Status | Notes |
|---|---|---|
| Output root construction | **DONE** | Defined identically in Solidity and TypeScript, cross-tested |
| Committed at the correct historical block | **DONE** | Tree root read at the committed block, not at head |
| L2 reorg pinning | **DONE** | `L2BlockHashMismatch` |
| Proposal schedule enforcement | **DONE** | |
| Challenger backstop | **PARTIAL** | Exists, but is a trusted human with a delete button |
| Fault proofs | **BLOCKER** | See B1 |
| Permissionless proposing | **NOT STARTED** | Meaningless before fault proofs |

## 5. Bridge

| Item | Status | Notes |
|---|---|---|
| Deposits (L2 → L3) | **DONE** | Derived from L2 events |
| Address aliasing | **DONE** | Tested both directions |
| Withdrawals with on-chain proof verification | **DONE** | Merkle inclusion under a committed root |
| Challenge window and re-prove semantics | **DONE** | Including proposal-replacement handling |
| Reentrancy and double-finalization protection | **DONE** | |
| ERC-20 bridging | **DONE** | Escrow ↔ mint/burn, fee-on-transfer safe |
| Canonical OP Stack MPT proof format | **NOT STARTED** | Deliberate documented deviation; see `docs/bridge.md` |
| Pause guardian | **PARTIAL** | Implemented, but a single EOA |
| Bridge audit | **BLOCKER** | See B2 |

## 6. Node & operations

| Item | Status | Notes |
|---|---|---|
| Startup validation (chain ID, contracts, predeploys) | **DONE** | Refuses to start on a mismatch |
| Admin RPC namespaces blocked publicly | **DONE** | Asserted by the devnet script at startup |
| Prometheus metrics | **DONE** | |
| Grafana dashboard | **DONE** | |
| Structured logging | **DONE** | |
| Alerting rules | **PARTIAL** | Rules provided; no on-call routing |
| Disaster recovery runbook | **NOT STARTED** | |
| Chaos / failure testing | **NOT STARTED** | |
| Load testing | **NOT STARTED** | No throughput figure has been measured under load, and none is claimed |
| High-availability deployment | **NOT STARTED** | |

## 7. Developer surface

| Item | Status |
|---|---|
| Foundry + Hardhat configuration | **DONE** |
| `@kaurax/sdk` | **DONE** |
| `kaurax` CLI | **DONE** |
| Example contracts | **DONE** |
| Explorer, bridge UI, dashboard | **DONE** |
| Source verification service | **NOT STARTED** — no contract is marked verified |
| Historical indexer | **NOT STARTED** — the explorer scans recent blocks and says so |
| Public RPC infrastructure | **NOT STARTED** |
| Faucet | **NOT STARTED** |

## 8. Governance & legal

| Item | Status |
|---|---|
| Upgrade process and timelock | **NOT STARTED** |
| Security council | **NOT STARTED** |
| Incident response and disclosure policy | **NOT STARTED** |
| Bug bounty | **NOT STARTED** |
| Legal review | **NOT STARTED** |
| Token economics | **NOT APPLICABLE** — KAX is a testnet gas asset with no monetary value and no issuance plan |

## 9. Claims KAURAX does not make

Stated explicitly so that nobody has to infer it:

- No TVL, user count, transaction total or partner list is published, because none exists.
- No throughput figure is claimed. The explorer computes TPS from the blocks it actually
  observed and labels it as such.
- No validator, staking or decentralization statistic is published, because KAURAX has no
  validator set.
- No audit, investor or partnership is claimed.
- Neither chain ID is claimed to be registered.
- The `testnet` profile is described as configured, never as running.

---

## Ordered path to a credible testnet

1. Multisig + timelock on every privileged role (B3) — cheapest meaningful improvement.
2. KMS or hardware signing for proposer, batcher and sequencer (B5).
3. Durable write-ahead log for sequenced-but-unbatched blocks.
4. Actually operate the `testnet` profile against a public L2 (B6), under monitoring.
5. Load and failure testing; publish measured numbers, not projected ones.
6. External audit of the bridge and settlement contracts (B2).

## Path to mainnet

Everything above, plus:

7. Fault proof system, with a dispute game on the L2 (B1).
8. Forced-exit mechanism with a bounded inclusion deadline (B4).
9. Sequencer failover, then decentralized sequencing.
10. Permissionless proposing backed by bonds.
11. Security council, disclosure policy, bug bounty, legal review.

Items 7 and 8 are not optional refinements. Until they exist, KAURAX is a chain whose users
trust its operator, and the only honest way to describe it is exactly that.
