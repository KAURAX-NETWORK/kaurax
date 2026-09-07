# KAURAX — Mainnet Readiness

**Date:** 2026-09-08 · **Score: 47/100** · **Verdict: not ready, and one reason dominates.**

There is no fault proof system. Everything else on this page is secondary to that, and no
amount of operational polish substitutes for it.

Nothing is marked done unless it was verified. Where evidence is a test, the test is named.

---

## A. Architecture

An application-focused Layer-3 rollup.

```
Ethereum (L1)          settlement and data availability
    ▲
Underlying L2          KauraxPortal · KauraxL2OutputOracle · KauraxBatchInbox
    ▲   batches (calldata) + output roots + bonds
KAURAX (L3)            sequencer · derivation · batcher · proposer
```

There are no validators and no consensus. Ordering is one sequencer's. Security comes from
data availability, forced inclusion, and settlement — not from a quorum. The explorer says
so where users see it.

---

## B. Trust assumptions

| # | Assumption | If violated |
|---|---|---|
| T1 | **Output roots are unverified** | A dishonest proposer commits any root and, once final, withdraws against it |
| T2 | **The guardian decides disputes** | A captured 2-of-3 rules for a liar or against an honest challenger |
| T3 | Single sequencer | Reordering and delay. Not forgery; forced inclusion bounds censorship |
| T4 | Guardian can pause the portal | Withdrawals stop |
| T5 | Forced-inclusion acknowledgement is the sequencer's assertion | Detectable off chain, not proven on it |
| T6 | Operator keys are local on the devnet | Compromising the node yields all three identities |

T1 and T2 are the fault-proof gap. The rest is ordinary operational centralisation.

---

## C. Security model

**Trustless today:** data availability, deposit derivation, forced inclusion, withdrawal
proofs.

**Trusted today:** output roots, dispute resolution, ordering.

Honest summary: *funds are safe if at least one honest party challenges a bad root **and**
the guardian rules correctly.* A fault proof would remove the second clause.

---

## D. Known limitations

1. No fault proofs. No one-step verifier exists and no stub was written.
2. Bisection reaches a block, not an instruction — no trace commitments exist.
3. Single sequencer; no rotation.
4. Devnet operator keys are local, though the signing seam is implemented and tested.
5. No TLS on the public RPC (host blocks 80/443 on trial accounts).
6. No external audit.
7. No source verification in the explorer — reported as `verified: false`, not hidden.

---

## E. Attack surface

| Surface | Mitigation | Residual |
|---|---|---|
| Malicious proposer | Bonded; anyone may challenge; bisection narrows to one block | **Guardian must rule correctly** |
| Malicious challenger | Bond slashed on a wrong challenge; one live game per output | Griefing costs a bond |
| Sequencer censorship | Forced inclusion halts settlement past the deadline | Sequencer can still delay within the window |
| Sequencer key theft | Signing service available | Not used on the devnet |
| Withdrawal forgery | Merkle proof against a published root | Rests on unverified roots |
| Double withdrawal | `finalizedWithdrawals` mapping | Tested |
| Reentrancy in bonds | Settled flag before transfer | Tested with a real attacker contract |
| Dispute outliving finalization | Live game blocks finalization; portal refuses unsettled outputs | Fixed and tested |
| Bricking a role by misconfiguration | — | **Real. See §J** |
| Public RPC abuse | Rate limiting; admin namespaces blocked | Verified externally |
| Faucet drain | Per-address and per-IP cooldowns; isolated key | Devnet key is published |

---

## F. Security tests executed

Executed for this report, not quoted from memory.

| Suite | Result |
|---|---|
| `forge test` | **262 passed**, 0 failed, 13 suites |
| `pnpm test` | **121 passed**, 0 failed, 25 packages |
| `tests/e2e-testnet.sh` | **12 passed**, 0 failed, against the live chain |
| Dispute game | 41 tests |
| Adversarial dispute | 11 tests, real attacker contracts |
| Governance | 27 tests |
| Forced inclusion | 21 tests, plus a live-chain run |
| Bridge and portal | 55 tests |
| Merkle proofs | 21 tests including fuzz |
| WAL recovery | 15 tests |
| Derivation checkpoint | 10 tests |
| Signer | 19 tests over a real socket |

Verified live: dispute opened → 4 bisections → guardian resolution → output deleted → node
recovered unaided; proposer escrow held on chain; faucet cooldown enforced.

---

## G. Remaining blockers

**Critical**
1. One-step verifier — not started

**High**
2. External audit — not started
3. Guardian is the final arbiter (follows from 1)

**Medium**
4. Sequencer decentralisation
5. Operator keys to the signing service in production
6. TLS on the public RPC
7. Disaster recovery rehearsed, not just scripted

---

## H. Operational requirements

| | Status |
|---|---|
| Persistent sequencer with restart | ✅ `restart: unless-stopped`; WAL survives SIGKILL |
| Health endpoints | ✅ `/api/health`, `/api/health/ready`, per-dependency |
| Graceful shutdown | ✅ readiness flips, drains, hard timer |
| Structured logging | ✅ JSON with request ids |
| Metrics | ✅ Prometheus on 7300 |
| Backups | ✅ script verifies by restoring and comparing rows |
| Recovery rehearsal | ❌ not performed on the server |
| Alerting | ❌ metrics exist, nothing pages anyone |

Documented failure behaviour for every component: `docs/TESTNET.md`.

---

## I. Fault proof roadmap

`docs/FAULT_PROOF_ROADMAP.md`. Summary: a proving VM, trace commitments, a preimage oracle
and a one-step verifier — **18–30 engineer-months**, then an audit. The dispute game was
built so integration replaces one call and leaves bonds, timeouts and settlement untouched.

---

## J. Launch checklist

**Done**
- [x] Contracts deploy reproducibly
- [x] Node syncs, produces, batches, proposes
- [x] Data availability verified by reconstruction
- [x] Forced inclusion verified on a live chain
- [x] Withdrawal proofs verified
- [x] Dispute game with bonds and bisection
- [x] Proposer escrow at proposal time
- [x] Finalization blocked during a dispute
- [x] **Governance holds portal guardian, inbox owner and dispute guardian** (2-of-3, 1h timelock)
- [x] Wallet with real signing; keys encrypted at rest
- [x] Faucet with cooldowns
- [x] Health, metrics, structured logs
- [x] Backups that verify by restoring
- [x] 262 + 121 + 12 tests passing

**Not done**
- [ ] One-step verifier
- [ ] External audit
- [ ] Sequencer decentralisation
- [ ] TLS on the public RPC
- [ ] Operator keys on the signing service in production
- [ ] Recovery rehearsal
- [ ] Alerting

### An incident worth recording

While handing roles to governance, `forge script` printed contract addresses from a run that
**reverted**. Those are simulated addresses; nothing was deployed at them. Pointing live
roles at one bricked the portal guardian, inbox owner and dispute guardian — unrecoverable,
because only the current holder may rotate a role.

Recovered by redeploying on the devnet, which a mainnet would not permit. The wiring script
now refuses to assign a role to an address with no code, and governance is set at
construction rather than transferred afterwards.

**Any mainnet role handover must verify code at the target address first, and rehearse the
whole sequence on a fork.**

---

## Score: 47/100

| | Weight | Score | |
|---|---|---|---|
| Execution and DA | 15 | 15 | Verified by reconstruction |
| Settlement mechanics | 10 | 9 | Works; roots unverified |
| Censorship resistance | 10 | 9 | Forced inclusion verified live |
| Bridge and withdrawals | 10 | 8 | Tested; rests on unverified roots |
| Dispute game | 10 | 8 | Real, but guardian-resolved |
| **Fault proofs** | **25** | **0** | Not started |
| Governance | 5 | 4 | Holds roles; one incident |
| Key management | 5 | 2 | Built, not used in production |
| Operations | 5 | 4 | No rehearsal, no alerting |
| **Audit** | **5** | **0** | Not started |
| **Total** | **100** | **47** | |

Fault proofs and the audit are 30 of the 100 and both are zero. That is the honest position:
a well-built rollup with a real dispute game and no fault proof system.
