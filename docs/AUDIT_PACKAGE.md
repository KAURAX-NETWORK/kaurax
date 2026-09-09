# KAURAX — External Audit Package

**No external audit has been performed or commissioned.** Everything in this repository
labelled a review is an **INTERNAL REVIEW** by the authors of the code. This document is what
an external auditor would be given.

---

## 1. Scope, in priority order

### Tier 1 — value at risk

| Contract | Lines | Why |
|---|---|---|
| `src/L2/KauraxPortal.sol` | 432 | Holds bridged value. Deposits and withdrawal finalization |
| `src/L2/KauraxL2OutputOracle.sol` | 368 | Output roots, proposer bonds, the finalization interlock |
| `src/dispute/KauraxDisputeGame.sol` | 542 | Bonds, bisection, deletion of output roots |
| `src/L3/L3ToL2MessagePasser.sol` | 123 | The withdrawal tree the portal proves against |
| `src/libraries/MerkleTree.sol` | 102 | Every withdrawal proof depends on it |
| `src/libraries/Hashing.sol` | 40 | Output roots. Mirrored in TypeScript — **check both** |

### Tier 2 — fault proofs

| Contract | Lines | Why |
|---|---|---|
| `src/kvs/KauraxOneStepVerifier.sol` | 544 | Decides disputes arithmetically. A bug here lets an honest party lose |
| `src/kvs/KVSMerkle.sol` | 74 | The commitment primitive everything above rests on |
| `src/dispute/KauraxFaultDisputeGame.sol` | 475 | Bisection, bonds, settlement |
| `src/kvs/KVSTypes.sol`, `KVSGas.sol` | 146 | State commitment and gas schedule |

**Not deployed and not wired to settlement.** Auditing it protects future users, not current
ones.

### Tier 3

`src/governance/` (521) · `src/L2/KauraxBatchInbox.sol` · `src/L2/KauraxL2ERC20Bridge.sol` ·
`src/libraries/DeployGuard.sol`.

### Out of scope

`src/apps/`, `src/ai/`, `src/examples/` — testnet applications, no settlement role.

### Off-chain, worth review

`blockchain/l3/src/` (4,571 lines): derivation, sequencer WAL, proposer, batcher. A
correctness bug here produces a bad output root that nothing on chain will catch — see §5.

---

## 2. Invariants

**Settlement**

1. A withdrawal finalizes only with a Merkle proof against a published root **and** an
   output the oracle reports finalized.
2. The same withdrawal cannot finalize twice.
3. An output with a live dispute game never reports finalized.
4. A finalized output cannot be deleted.
5. A proposal is refused while a forced transaction is past its deadline.
6. `deleteL2Outputs` credits bonds; it never pushes value.

**Dispute (guardian)**

7. One live game per output index.
8. Bonds are paid exactly once; the contract holds nothing after settlement.
9. A game can be resolved by exactly one of: guardian, timeout, orphan cancellation.
10. Guardian silence refunds both sides — it never awards a win.

**Fault proof**

11. `step()` is a pure function of `(preHash, proof)`.
12. A committed structure changes only through `KVSMerkle.update`, which proves the prior leaf.
13. Every stack slot at or above `stackSize` is zero.
14. A terminal state is its own successor.
15. An exceptional halt commits the roots the step began with.
16. At the leaf, `loClaim` is agreed and `hiClaim` disputed.

**Governance**

17. Privileged operations need 2 of 3.
18. An owner change invalidates outstanding approvals.
19. Batch-inbox ownership passes only through a 1-hour timelock.

---

## 3. Known issues — please verify rather than rediscover

| ID | Finding | State |
|---|---|---|
| H-1 | No fault proof over KAURAX execution | **OPEN**, structural |
| H-2 | Guardian is the final arbiter | **OPEN**, follows from H-1 |
| H-3 | No external audit | **OPEN** — this document |
| M-3 | Operator keys local | **OPEN**, signer built not deployed |
| M-4 | No TLS on the public RPC | **OPEN**, host-blocked |
| L-1 | One live game per output allows mild griefing | **OPEN**, accepted |
| I-1 | KAURAX's STF is unpinned and undifferentiated | **OPEN** |
| M-1 | Dispute could outlive finalization | FIXED — interlock, 2 tests |
| M-2 | Proposer bonded late | FIXED — escrow at proposal |
| — | Roles assignable to a codeless address | FIXED — `DeployGuard` |
| — | Verifier priced SSTORE from an unproven value | FIXED — proves before pricing |
| — | Settlement pushed value to the winner | FIXED — pull payments |

Full history: [SECURITY_STATUS.md](SECURITY_STATUS.md).

---

## 4. Where to look hardest

1. **`KauraxPortal.finalizeWithdrawalTransaction`** — two independent conditions (proof age,
   `isOutputFinalized`). The portal-side half was nearly missed once.
2. **`KauraxOneStepVerifier` gas accounting** — the one real soundness bug found in this work
   was pricing `SSTORE` from an unproven prior value. Look for the same shape elsewhere.
3. **`_deleteAndRecover` ordering** in the guardian game — it must run before `_settle` or the
   winner is underpaid.
4. **The stack-clearing invariant** — if a pop ever failed to clear its slot, a later push
   could resurrect a discarded value **and the Merkle proof would still verify**.
5. **`Hashing.sol` vs `l3/src/settlement/hashing.ts`** — a divergence blocks every withdrawal
   or admits one that was never made.
6. **Derivation checkpoint handling** — three bugs where a restart could lose a deposit were
   found here by inspection, not by tests.

---

## 5. Attack scenarios worth pricing

| Scenario | Current outcome |
|---|---|
| Proposer commits a root matching no execution, guardian captured | **Unbounded loss.** The ceiling |
| Proposer lies, honest challenger, honest guardian | Proposer loses both bonds |
| Challenger stalls every round | Delay ≈ rounds × timeout, costs one bond |
| Nobody submits the step proof at the leaf | The claim stands. A censored challenger loses |
| Node host compromised | Sequencer, batcher and proposer identities together (M-3) |
| Two governance signers compromised | Full compromise |
| L2 reorg beneath a proposal | Proposal fails; deep post-finalization reorg is unrecoverable |

---

## 6. Building and testing

```bash
pnpm install
cd blockchain/contracts && forge build && forge test && forge coverage --report summary
cd ../.. && pnpm test && pnpm typecheck
./infra/scripts/devnet/start.sh && ./tests/acceptance.sh
pnpm --filter @kaurax/tests test:integration
```

Solidity 0.8.28, `evm_version = cancun`, optimizer on at 999,999 runs, `via_ir = false`.

**385 Solidity tests, 181 node, 47 acceptance, 44 adversarial, 10 chaos.** Coverage per
contract: [TESTING_REPORT.md](TESTING_REPORT.md).

---

## 7. Deployment

Live testnet: `87.58.152.42`, ten containers, `devnet` profile. Addresses are in
`blockchain/contracts/deployments/`. Governance holds every privileged role; a 1-hour timelock
guards batch-inbox ownership.

The public testnet runs the **`devnet`** profile — `anvil` engine, local L1 and L2 stand-ins.
The `testnet` profile is configured and **has never been operated**.

---

## 8. What an auditor should be told before starting

- The state transition function **is not in this repository**. It is `anvil`, reached over
  JSON-RPC. Nothing here computes a state root.
- The one-step verifier covers a documented **EVM subset**, not the EVM, and is not connected
  to settlement.
- Every security claim in the documentation is meant to be checkable. Documentation that
  overstates the code is treated as a bug, and finding one is a valid audit finding.
