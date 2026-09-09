# KAURAX — Testing Report

**Date:** 2026-09-08 · Every number was produced by running the command shown. Coverage
figures are from `forge coverage` and `vitest --coverage` on this commit.

---

## 1. Totals

| Suite | Command | Result |
|---|---|---|
| Solidity | `forge test` | **385 passed**, 0 failed, 23 suites |
| Node and services | `pnpm test` | **181 passed**, 29 turbo tasks |
| Fault-proof properties | `pnpm --filter @kaurax/tests test` | **10 passed** (400+ programs each) |
| Security + adversarial | `pnpm --filter @kaurax/tests test:integration` | **44 passed** (26 + 18) |
| Acceptance, end to end | `./tests/acceptance.sh` | **47 checks passed** |
| Live testnet | `./tests/e2e-testnet.sh` | 12 passed |
| Types | `pnpm typecheck` | 26/26 |
| Build | `pnpm build` | 20/20 |
| Format | `forge fmt --check` | clean |

**553 automated assertions** across unit, property, adversarial, integration and live paths.

---

## 2. Contract coverage — `forge coverage`

### Settlement and dispute — the security-critical set

| Contract | Lines | Branches | Funcs |
|---|---|---|---|
| `KauraxL2OutputOracle.sol` | **92.68%** | 56.41% | 90.91% |
| `KauraxPortal.sol` | **88.89%** | 61.76% | 84.21% |
| `KauraxDisputeGame.sol` | **85.99%** | 76.60% | 86.36% |
| `KauraxBatchInbox.sol` | 85.19% | 62.50% | 83.33% |
| `KauraxL2ERC20Bridge.sol` | 100.00% | 22.22% | 100.00% |
| `L3ToL2MessagePasser.sol` | 71.43% | 16.67% | 57.14% |

### Fault proofs

| Contract | Lines | Branches | Funcs |
|---|---|---|---|
| `KauraxOneStepVerifier.sol` | **97.35%** | 65.14% | **100.00%** |
| `KauraxFaultDisputeGame.sol` | **91.14%** | 70.21% | 79.17% |
| `KVSMerkle.sol` | **100.00%** | **100.00%** | **100.00%** |
| `KVSTypes.sol` / `KVSGas.sol` | **100.00%** | 100% | **100.00%** |

### Governance and libraries

| Contract | Lines | Branches |
|---|---|---|
| `KauraxMultisig.sol` | 84.38% | 40.00% |
| `KauraxTimelock.sol` | **88.24%** | 65.00% |
| `DeployGuard.sol` | **100.00%** | **100.00%** |
| `MerkleTree.sol` | 86.49% | 100.00% |
| `Hashing.sol` | 66.67% | — |
| `AddressAliasHelper.sol` | 71.43% | 100.00% |

CI enforces a floor of 80% lines on security-critical contracts. **When this was first
written `KauraxTimelock` was at 72.06% and that gate had been failing on every commit** — the
claim that every contract cleared it was wrong, and the workflow said so while this document
did not.

The gap was the timelock's self-administration path — `setDelay`, `setProposer`,
`setExecutor`, `setGuardian` and the `onlySelf` guard — which is how the timelock's own
parameters change and was entirely untested. `TimelockSelfAdmin.t.sol` covers it in 16 tests,
including that shortening the delay still costs the *current* delay: otherwise a captured
proposer's first move would be to make every later move free. Coverage is now **88.24%** and
all five gated contracts clear the floor.

**Branch coverage is the weak axis** — mostly 40–70%, and 16.67% on the message passer. Line
coverage says the code ran; branch coverage says whether the *alternative* was tried. A revert
path nobody exercises is a revert path nobody has checked.

---

## 3. Node coverage — `vitest --coverage`

**12.06% statements overall** for `@kaurax/l3`.

| Area | Statements |
|---|---|
| `src/signer` | 66.82% |
| `src/derivation` | 50.66% |
| `src/sequencer` | 18.43% |
| `src/batcher` | 13.85% |
| `src/settlement` | 8.35% |
| `src/da`, `src/engine`, `src/proposer`, `src/rpc` | **0%** |

### What that figure does and does not mean

It is a real number and it is low. Unit tests cover hashing, Merkle proofs, batch encoding,
derivation checkpointing and reorg handling, the WAL, and the signer — the pure, algorithmic
parts.

The 0% areas are **not untested**; they are not unit-tested. `src/proposer`, `src/rpc`,
`src/da` and `src/engine` are exercised end to end by `tests/acceptance.ts`, which sends a
real transaction, watches it batch, rebuilds it from L2 calldata, sees an output root
proposed, and completes a withdrawal round trip — 47 assertions against a running
three-layer stack. Coverage instrumentation does not see a separate process.

So the honest statement is: **algorithmic code is unit-tested, runtime code is
integration-tested, and no single number describes both.** Quoting 12% alone understates it;
quoting the acceptance suite alone overstates it.

### A defect found while measuring

CI's node-coverage step ran `… || true` and **`@vitest/coverage-v8` was never installed**, so
it printed nothing and passed for as long as it has existed. The dependency is now present and
the `|| true` is gone. No percentage gate was added: gating at a number the repository does
not meet would mean either a failing pipeline or a threshold set low enough to be meaningless.

---

## 4. Critical paths and their coverage

| Path | Covered by | Confidence |
|---|---|---|
| Deposit L2 → L3 | 21 forced-inclusion tests, derivation tests, acceptance | High |
| Withdrawal L3 → L2 | 25 portal tests, 8 Merkle (fuzzed), acceptance 10–11 | High |
| Data availability | Acceptance rebuilds a signed transaction from calldata alone | High |
| Forced inclusion | 21 tests, plus verified live halting and resuming settlement | High |
| Output proposal and bonds | 13 oracle tests | High |
| Dispute (guardian) | 41 + 11 adversarial | High |
| Dispute (verifier) | 35 + 404 differential + 2 fuzz (256 runs) | High |
| One-step verification | 97.35% lines, 100% functions, 404 differential cases | High |
| L2 reorg | 5 regression tests | Medium |
| Sequencer restart | WAL tests + `chaos.sh` | Medium |
| RPC hardening | 26 tests, 21 namespaces individually refused | High |
| Malformed input | 18 adversarial tests | Medium |
| **Key management in production** | Signer 66.82% unit — **not deployed** | **Low** |
| **Node failover** | **Nothing.** One sequencer, no failover | **None** |
| **Contract upgrade / migration** | **Nothing.** No upgrade mechanism exists | **N/A** |

---

## 5. Critical untested areas

1. **Branch coverage on revert paths**, particularly `L3ToL2MessagePasser` (16.67%) and the
   governance contracts (40%). Lines run; alternatives largely do not.
2. **`KauraxBridgedERC20` at 50%** — the L3 side of the ERC-20 bridge.
3. **Signer compromise.** Modelled in the threat model; no test simulates it.
4. **Sustained load.** `tests/load.ts` exists; no result is published — see
   [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md).
5. **Failure of the underlying L2 mid-batch.** Reorgs are covered; an L2 that stops is not.
6. **The containerised stack.** `docker-compose.yml` is exercised by deployment, not by CI.

---

## 6. Rules held

No test was deleted to make CI green. No assertion was weakened. Two tests were **changed**,
both because they were not testing what they claimed:

- `test_stepProofWithATamperedLeafIsRejected` tampered with the proof of a `PUSH`, whose
  destination-is-empty check the verifier hardcodes — so the tamper had no effect and the
  test passed vacuously. It now targets `ADD`, which reads the stack.
- The same test's sibling aimed at the last instruction, `STOP`, which consumes no proofs at
  all.

Both were found because they failed after a correct change, not before.

---

## 7. Reproducing

```bash
pnpm install
cd blockchain/contracts && forge test && forge coverage --report summary
cd ../.. && pnpm test && pnpm typecheck && pnpm build
pnpm --filter @kaurax/tests test
./infra/scripts/devnet/start.sh
./tests/acceptance.sh
pnpm --filter @kaurax/tests test:integration
```
