# KAURAX — Testnet Engineering Report

**Date:** 2026-09-08

---

## 1. Headline

A permissionless dispute game with bonds and bisection is implemented, tested, deployed, and
was played end to end on the running chain. **KAURAX still has no fault proof system**, and
this report does not describe one.

---

## 2. Already working before this task

Verified, not assumed:

- Three-layer devnet: L1 (8410) → L2 (8415) → KAURAX (8420), real EVM chains throughout
- Sequencing, batching, output proposals; settlement contracts really deployed
- Data availability — a transaction is reconstructible from L2 calldata alone
- Forced inclusion — an ignored forced transaction halts settlement, verified live
- Bridge with proof-verified withdrawals
- Multisig and timelock (27 tests), deployed by script, holding no roles
- Indexer, API, explorer, ten frontends, faucet

---

## 3. Implemented in this task

| Item | Status |
|---|---|
| `KauraxDisputeGame` | IMPLEMENTED, TESTED, DEPLOYED |
| Bonds with slashing and refunds | IMPLEMENTED, TESTED |
| Bisection over block ranges | IMPLEMENTED, TESTED |
| Guardian resolution | IMPLEMENTED, TESTED |
| Timeout and abandonment handling | IMPLEMENTED, TESTED |
| `DeployDisputeGame.s.sol` | IMPLEMENTED, used |
| 44 dispute tests, incl. adversarial | TESTED |
| `docs/ARCHITECTURE_AUDIT.md` | Written |
| `docs/DISPUTE_GAME.md` | Written |
| `docs/FAULT_PROOF_SPEC.md` | Written — a design, not a claim |
| `docs/SECURITY_REVIEW.md` | Written |
| `MAINNET_READINESS.md` | Rewritten as an evidence matrix |
| One-step verifier | **NOT STARTED — deliberately** |

---

## 4. Fixed along the way

| Problem | How it was found |
|---|---|
| Single-block ranges could not be bisected | Test failure |
| Disputes can outlive finalization | Test failure — now handled and documented |
| `getGame` panicked instead of erroring | Adversarial test |
| CORS variable name mismatch broke every browser call | User report; `curl` had masked it |
| Server-side fetches looped through the public domain | User report |
| Explorer links ignored `basePath` — whole nav 404'd | User report |
| Explorer scanned 200 blocks instead of using the index | User report |
| Docs shipped with no documents | User report |
| WAL and checkpoint had no writable volume under Docker | Live deploy |
| ufw blocked every Docker-published port | Live deploy |

---

## 5. End-to-end test

Run against the live devnet on 2026-09-07.

```
Deploy:   forge script script/DeployDisputeGame.s.sol:DeployDisputeGame \
            --rpc-url http://l2:9545 --broadcast
          DISPUTE_TRANSFER_CHALLENGER=true
```

Result:

```
dispute game        0x94F78d4b8B637D2C56cb5e3Ac38d448abD8ba76f
oracle.challenger   0x94F78d4b8B637D2C56cb5e3Ac38d448abD8ba76f
isFaultProof()      false

challenged output index 506, range [6062, 6073]   (12 blocks)
  bisected -> [6062, 6067]
  bisected -> [6062, 6064]
  bisected -> [6062, 6063]
  bisected -> [6062, 6062]
  narrowed to a single block

outputs before resolution   508
guardian resolved for the challenger
outputs after  resolution   506      <- disputed root and successors deleted
game balance                0        <- bonds fully settled

node recovered unaided: re-proposed block 6073, index back to 507
```

⌈log₂12⌉ = 4, and it took exactly 4 bisections.

**Checklist status** — only items actually exercised are ticked:

- [x] Contracts deploy · [x] Node syncs · [x] Blocks produced · [x] Transactions execute
- [x] RPC works · [x] Explorer works · [x] Faucet works · [x] Output roots posted
- [x] Challenge can be opened · [x] Bonds work · [x] Bisection works
- [x] Guardian resolution works · [x] No secrets committed · [x] Documentation
- [x] Internal security review · [x] Recovery after deletion
- [ ] Timeout path on the live chain (tested in unit tests only)
- [ ] Bridge deposit/withdrawal re-run since the dispute game landed
- [ ] External audit · [ ] TLS · [ ] Governance holding roles

---

## 6. Test results

```
forge test          254 passed, 0 failed   (13 suites)
  DisputeGame            33
  DisputeGameAdversarial 11
pnpm test           121 passed, 0 failed   (25 packages)
```

Adversarial coverage uses real attacker contracts, not assertions about intent: a challenger
that re-enters during payout, and a proposer whose fallback reverts.

---

## 7. Trust model today

Trustless: data availability, deposits, forced inclusion, withdrawal proofs.

Trusted: **output roots** (nothing verifies them), **the guardian** (decides every dispute),
the sequencer (ordering), operator keys (local on the devnet).

---

## 8. Fault proof status

**NOT STARTED.** No verifier exists, and no stub was written — a `step()` returning `true`
would let KAURAX claim a property it does not have.

`docs/FAULT_PROOF_SPEC.md` specifies the system and marks nine components NOT STARTED. The
dispute game was built so that adopting it is a small change: replace `resolve()` with a
verifier call on the already-narrowed block. Bonds, timeouts, bisection and settlement stay
as they are.

---

## 9. Next steps

1. Oracle refuses to finalize an output with a live dispute (M-1)
2. Escrow the proposer bond at proposal time (M-2)
3. Hand guardian, challenger and owner roles to the multisig and timelock
4. Operator keys to the signing service; TLS on the RPC
5. Then: trace commitments, verifier, audit
