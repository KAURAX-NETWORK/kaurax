# KAURAX — Adversarial Test Report

**Date:** 2026-09-08 · Every figure below came from running the suite named beside it.

## Where the adversarial tests live

| Suite | Location | Count | Needs a chain? |
|---|---|---|---|
| Fault-proof properties | `tests/fault-proofs/` | 10 | No |
| RPC hardening | `tests/security/` | 26 | Yes |
| Protocol abuse | `tests/adversarial/` | 18 | Yes |
| Dispute game, adversarial | `blockchain/contracts/test/DisputeGameAdversarial.t.sol` | 11 | No |
| Fault dispute game | `blockchain/contracts/test/KVSFaultDisputeGame.t.sol` | 35 | No |
| Verifier differential | `blockchain/contracts/test/KVSVerifier.t.sol` | 6 (404 cases) | No |
| Acceptance, end to end | `tests/acceptance.ts` | 47 checks | Yes |

The Solidity suites stay where they are. Moving them under `tests/` to match a directory
layout would have split the contract tests across two build systems for no gain; what the
brief asked for is coverage of the adversary, and the table above is that map.

---

## Coverage against the brief's matrix

| Required | Where | Result |
|---|---|---|
| Honest proposer | `test_honestProposerBeatsABaselessChallenge` | Proposer wins; verifier confirms |
| Dishonest proposer | 5 "…Loses" tests | Challenger wins on every field |
| Honest challenger | `testFuzz_honestProposerWinsWhateverTheChallengerAnswers` (256 runs) | Converges correctly on every path |
| Dishonest challenger | `test_aProposerCannotChallengeItsOwnClaim`, `test_aClaimCannotBeChallengedTwice` | Refused |
| Wrong output root / state root | `test_incorrectStateRootLoses` | Challenger wins |
| Wrong transaction result / opcode | `test_incorrectOpcodeResultLoses` | Wrong stack root loses |
| Wrong stack | same | — |
| Wrong memory | `random-*` differential cases with MLOAD/MSTORE | Emulator and verifier agree |
| Wrong storage | `test_incorrectStorageTransitionLoses` | Challenger wins |
| Wrong gas | `test_invalidGasAccountingLoses` | +1 gas loses |
| Wrong account state | **NOT APPLICABLE** — the subset has no account model | Documented, not tested |
| Malformed trace | `test_stepProofWithTruncatedSiblingsIsRejected` | Reverts |
| Malformed Merkle proof | `test_stepProofWithATamperedLeafIsRejected`, `test_verifierItselfRejectsTamperedProofs` | Reverts |
| Invalid one-step proof | `test_stepProofForTheWrongStepIsRejected` | `PreStateMismatch` |
| Timeout | 4 tests across every game status | Correct winner in each |
| Replay | `test_aResolvedGameCannotBeProvenAgain`, `…CannotBeTimedOut`, acceptance test 11 | Refused |
| Griefing | `test_aWinnerThatRejectsEtherCannotFreezeTheGame`, bond and length bounds | Cannot freeze |
| Censorship | `ForcedInclusion.t.sol` (21) + live verification | Settlement halts |
| Forced-inclusion abuse | same suite | Deadlines enforced |
| Bridge abuse | `KauraxPortal.t.sol` (25), `Bridge.t.sol` (6) | Proof required |
| Withdrawal abuse | acceptance 10–11 | Double-finalize refused |
| Governance abuse | `Governance.t.sol` (27) | Threshold and epochs hold |
| Signer compromise | **NOT TESTED** — modelled in `THREAT_MODEL.md` §F | Keys are local (M-3) |
| DA failure | `derivation-reorg.test.ts` (5), `chaos.sh` | Node refuses to derive against a mismatched chain |
| Sequencer failure | `chaos.sh` | Restart-safe; see §4 |
| Fuzz / property | 10 KVS properties, 2 game fuzz (256 runs each), 5 Merkle fuzz | Pass |

---

## What the new suites actually assert

### RPC hardening — 26 tests

Twenty-one administrative methods are individually refused: the whole of `anvil_*`, `evm_*`,
`hardhat_*`, `debug_*`, `admin_*`, `miner_*`, `personal_*`, `txpool_*`, `engine_*`, `ots_*`.

Three tests matter more than the list:

- **`anvil_setBalance` does not mint.** The balance is read before and after; it is unchanged.
  A refusal that still had an effect would pass a naive test.
- **It is an allowlist.** `eth_sendTransaction` — which exists upstream and would ask a node
  holding operator keys to sign — is refused, as is an invented namespace. A denylist would
  leak every method a future `anvil` adds.
- **Errors leak nothing.** No internal host, port or path appears in an error message.

### Protocol abuse — 18 tests

Nine malformed payloads (non-JSON, empty, method as a number, 60-deep nesting, wrong JSON-RPC
version) and a 120 KB request. Each asserts the node **answers and is still answering
afterwards** — the failure mode worth catching is a node that dies, not one that rejects.

Six garbage transactions are rejected. Read methods cannot write: `eth_call` with a value
transfer leaves the balance unchanged.

### Fault-proof properties — 10 tests, 400+ random programs each

Not differential — these hold the KVS to invariants without reference to the Solidity side,
because two implementations can agree on nonsense.

- Gas never increases and never goes negative.
- A halted state has exactly zero gas and a reason; a non-halted state has no reason.
- The stack never exceeds 1024.
- **Every slot at or above `stackSize` is empty** — the invariant the verifier's push rule
  rests on. If a pop ever failed to clear its slot, a later push could resurrect a discarded
  value and the Merkle proof would still verify, because the value really would be in the tree.
- A terminal machine is its own successor, repeatedly.
- **An exceptional halt discards the step's work** — the committed roots equal those the step
  began with. Asserted on 40+ real halts, not assumed.
- Determinism, and sensitivity to a single changed byte.
- Step count bounded by the gas budget.
- Trace padding is a power of two filled with the final state.

---

## Findings

**No new vulnerability was found by these suites.** Everything they probe was already
defended. That is the honest result and it is worth stating plainly: the suites are a
regression barrier, not a discovery.

The two real defects of this session came from elsewhere — running the documented commands
(Phase 1) and changing live infrastructure (Phase 2), both recorded in
[SECURITY_CLOSURE_REPORT.md](SECURITY_CLOSURE_REPORT.md).

## Unresolved, and not fixed by any test here

| | Why |
|---|---|
| **H-1** No fault proof over KAURAX execution | The engine cannot emit a trace |
| **H-2** Guardian decides settlement disputes | Follows from H-1 |
| **M-3** Operator keys local | The signing service is built and not deployed |
| Unproven leaf resolves to the proposer | Submission is permissionless, but an absent challenger loses a dispute it should have won |
| Challenger stalling | ~`rounds × timeout`, at the cost of a bond |
| Bond sizing | No economic analysis; depends on deployment values |

## Running them

```bash
pnpm --filter @kaurax/tests test              # properties, no chain needed
./infra/scripts/devnet/start.sh
pnpm --filter @kaurax/tests test:integration  # security + adversarial
cd blockchain/contracts && forge test
```

CI runs all of these on every push, the integration suites after the devnet is up.
