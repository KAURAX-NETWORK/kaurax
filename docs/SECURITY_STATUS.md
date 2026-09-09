# KAURAX — Security Status

**Current state, 2026-09-08.** Supersedes the finding lists in
[SECURITY_REVIEW.md](SECURITY_REVIEW.md), which is kept as a historical snapshot.

---

## Implemented and verified

| Property | Verified by |
|---|---|
| Data availability | A signed transaction rebuilt from L2 calldata alone, hash checked |
| Deposit derivation | Derived from L2 events; sequencer cannot censor without censoring the L2 |
| Forced inclusion | Live chain: overdue → proposals rejected → acknowledged → settlement resumed |
| Withdrawal proofs | Merkle proof required; no operator approval path; 8 Merkle tests incl. fuzz |
| Dispute game | Live: 12 blocks → 4 bisections → resolution → output deleted → node recovered |
| Bonded proposals | Escrow held at proposal time; forfeited on loss, refunded on finalization |
| Finalization interlock | A live dispute blocks finalization; the portal refuses unsettled outputs |
| Governance | 2-of-3 multisig and 1-hour timelock hold every privileged role, verified on chain |
| Deployment safety | Roles cannot be assigned to an address without code; proven by refusing an EOA guardian |
| Encrypted wallet | scrypt + AES-256-GCM, mode 600; verified encrypted at rest by the E2E suite |
| Recovery | Backup and restore rehearsed on the server: 7918/7919 rows |

## Trusted and centralized

| | Consequence if violated |
|---|---|
| **Output roots** | A dishonest proposer commits any root and, once final, withdraws against it |
| **Guardian arbitration** | A captured 2-of-3 rules for a liar, or against an honest challenger |
| **Single sequencer** | Reordering and delay. Not forgery; forced inclusion bounds censorship |
| **Local operator keys** | Compromising the node yields sequencer, batcher and proposer identities |

## Not implemented

One-step verifier · proving VM · execution trace commitments · preimage oracle ·
decentralized sequencing · external audit · TLS on the public RPC · bug bounty.

---

## Finding history

Every finding ever recorded, with its current state. Nothing is removed once written down.

| ID | Finding | Status | Evidence | Remaining risk |
|---|---|---|---|---|
| H-1 | No fault proof over KAURAX execution | **OPEN** | A real one-step verifier now exists for a documented EVM subset (`KauraxOneStepVerifier`), deliberately unwired from settlement. Nothing verifies KAURAX's own execution: the engine is `anvil` over JSON-RPC and cannot emit a trace | The security ceiling. Trust in the proposer and guardian |
| H-2 | Guardian is final arbiter | **OPEN — mitigated** | Now a 2-of-3 multisig, not a key; reasons on chain; silence refunds both sides | Follows from H-1; cannot close before a verifier |
| H-4 | L2 bridge escrow could be credited more than it received | **FIXED** | Reentrancy guard on `bridgeERC20To`; `BridgeReentrancy.t.sol` reproduced 200 escrowed / 300 credited before the fix | None known |
| H-5 | A batch could advertise a block whose transactions it did not carry | **FIXED** | The batcher published a block header-only when its write-ahead payload was not durable, while still advertising the range as covered. Caught in CI by the acceptance suite's data-availability check; `batcher-completeness.test.ts` | None known |
| H-3 | No external audit | **OPEN** | None commissioned | Unknown unknowns in contracts holding the bridge |
| M-1 | Dispute could outlive finalization | **FIXED** | `isOutputFinalized` consults the game; portal refuses unsettled outputs; 2 tests | None known |
| M-2 | Proposer bonded late | **FIXED** | Escrow at proposal time; forfeit, refund and collateral-refund paths tested | None known |
| M-3 | Operator keys local | **OPEN — fixable** | Signing service built and tested; not active in production | Node compromise yields three identities |
| M-4 | No TLS on public RPC | **OPEN — blocked externally** | Host blocks 80/443 on trial accounts; proven, not assumed | RPC traffic readable in transit |
| M-5 | CORS misconfiguration | **FIXED** | Both variable names accepted; preflight verified returning 204 | None known |
| L-1 | One live game per output allows mild griefing | **OPEN — accepted** | Alternative is worse: parallel games let one bond force many defences | Delay of one timeout; costs the griefer a bond |
| L-2 | Faucet used a published key | **FIXED** | Rotated to a dedicated key outside operator roles | Bounded by the faucet's balance |
| L-3 | `getGame` panicked on unknown id | **FIXED** | Returns `UnknownGame`; test | None |
| L-4 | Unquoted mnemonic broke `.env` sourcing | **FIXED** | Quoted | None |
| I-1 | Determinism assumed, not specified | **OPEN** | KAURAX's own STF is still unpinned and untested against a second implementation. 404 differential cases exist, but for the KVS subset, not for KAURAX execution | Prerequisite for any verifier |
| I-2 | Explorer reports `verified: false` | **BY DESIGN** | No source-verification service exists | None — correctly reported |
| I-3 | Single sequencer | **BY DESIGN** | Rollup architecture | See trusted table above |
| — | Roles assignable to a dead address | **FIXED** | `DeployGuard`; 8 tests; refused an EOA in a real deployment | Cannot detect the *wrong live* contract |
| — | L2 reorg handling untested | **FIXED** | 5 regression tests | None known |
| — | gitleaks was advisory | **FIXED** | Now a blocking CI gate | None |
| — | Key scanner mis-anchored exclusion | **FIXED** | Context-based; planted-secret test | None |
| O-1 | `deploy.sh` would unpublish the port the CDN reaches | **FIXED** | The live stack needs `docker-compose.devnet.yml` for the 8880 binding; a bare `docker compose` drops it. `deploy.sh` now refuses a deploy that would stop publishing a live port; `COMPOSE_FILE` documented | None known |
| O-2 | `bootstrap` re-deployed settlement contracts over a live chain | **FIXED** | Any compose command touching a dependant re-ran it. It now refuses when the engine is past genesis unless `KAURAX_FORCE_BOOTSTRAP=true`; verified refusing at block 332 | Four orphaned contracts remain on the devnet L2 from the incident; harmless, nothing references them |
| O-3 | Devnet unusable after the first run | **FIXED** | `start.sh` left the previous chain's derivation cursor and WAL; CI now restarts the devnet | None |
| O-4 | README CLI quickstart was not runnable | **FIXED** | `kaurax` was never on `PATH`; `pnpm kaurax` added | None |

**Open: 3 HIGH, 4 MEDIUM/LOW, 1 informational. Fixed: 13.**

No severity was reduced. H-1 and H-2 stay HIGH despite the verifier work, because that verifier
does not cover KAURAX execution.

---

## What this does not say

This document does not say KAURAX is secure enough to hold value. It is a testnet. KAX has
no monetary value. The three HIGH findings are open, and the first of them is structural.
