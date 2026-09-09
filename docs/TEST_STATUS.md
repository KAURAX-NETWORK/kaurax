# KAURAX — Test Status

**Verified:** 2026-09-09 · **Commit:** `aef00fe`

Every number below came from running the command shown, on this commit.

**`tests/check-doc-counts.sh` enforces this in CI.** These totals must equal what the suites
report, the per-suite table must name every suite and sum to the total, and no other document
may contradict them in prose either. The counts drifted four times before that
gate existed, each corrected by hand and each time only because someone happened to look. None is quoted from
an earlier report. When these drift, the fix is to re-run and update — not to adjust the
number.

---

## Solidity — `forge test`

**385 passed · 0 failed · 0 skipped · 23 suites**

| Suite | Tests | Covers |
|---|---|---|
| `KVSFaultDisputeGame.t.sol` | 35 | Multi-level bisection ending in the one-step verifier; the full adversarial matrix |
| `DisputeGame.t.sol` | 41 | Bonds, bisection, resolution, timeouts, finalization interlock |
| `KauraxSwap.t.sol` | 30 | Constant-product AMM |
| `KauraxNames.t.sol` | 29 | Registration, renewal, resolution |
| `Governance.t.sol` | 27 | Multisig owner epochs, timelock delays |
| `KauraxLaunchpad.t.sol` | 27 | Escrowed sales, soft-cap refunds |
| `KauraxPortal.t.sol` | 25 | Deposits, withdrawals, pause, forced transactions |
| `ForcedInclusion.t.sol` | 21 | Deadlines, acknowledgement, settlement halt |
| `TimelockSelfAdmin.t.sol` | 16 | The timelock governing its own delay, proposer and guardian |
| `AI.t.sol` | 15 | Agent and service registries, payments |
| `KauraxL2OutputOracle.t.sol` | 13 | Proposals, escrow, deletion, finalization |
| `KauraxBridgedERC20.t.sol` | 12 | Mint and burn authority, allowances, supply accounting |
| `DisputeGameAdversarial.t.sol` | 11 | Reentrancy, griefing, replay — real attacker contracts |
| `Hashing.t.sol` | 11 | Consensus-critical hashing, pinned to the same vectors as the TypeScript mirror |
| `KVSMerkle.t.sol` | 11 | Commitment primitive, including fuzz |
| `L3ToL2MessagePasser.t.sol` | 11 | Withdrawal recording, size and gas floors, value burn |
| `KauraxBatchInbox.t.sol` | 9 | Batch submission, authorisation |
| `AddressAliasHelper.t.sol` | 8 | Deposit sender aliasing — injective, round-trips, wraps safely |
| `DeployGuard.t.sol` | 8 | Refusing roles to addresses without code |
| `MerkleTree.t.sol` | 8 | Proofs, including fuzz |
| `Bridge.t.sol` | 6 | ERC-20 bridging |
| `KVSVerifier.t.sol` | 6 | **404 differential cases** against the TypeScript emulator |
| `BridgeReentrancy.t.sol` | 5 | H-4: escrow credit under a token that calls back during `transferFrom` |

## Node and services — `pnpm test`

**181 passed · 0 failed · 29 turbo tasks**

| Package | Tests | Covers |
|---|---|---|
| `@kaurax/l3` | 80 | WAL recovery, derivation checkpoint, L2 reorgs, signing seam, Merkle, batch encoding, settlement hashing |
| `@kaurax/api` | 35 | Config validation, route behaviour, bounded health probes |
| `@kaurax/kvs` | 29 | Reference emulator: machine semantics and commitment tree |
| `@kaurax/indexer` | 16 | Log decoding, token metadata |
| `@kaurax/signer` | 11 | Keystore: signature recovery, refusals, determinism |
| `@kaurax/tests` | 10 | KVS execution invariants as properties |

## End-to-end — `tests/e2e-testnet.sh`

**12 passed · 0 failed**, against the live testnet with real signatures.

Covers: key generation, encryption at rest, faucet, balance, signed transfer, inclusion in a
block, nonce and balance movement, receipt confirmation, settlement stage, and that the node
discloses its own trust assumptions.

## Static checks

| Check | Result |
|---|---|
| `pnpm typecheck` | 25/25 tasks |
| `pnpm build` | 19/19 tasks |
| `forge fmt --check` | clean |
| `forge build` | clean |

## Not run here

| Check | Why |
|---|---|
| **Slither** | Run for this report in an isolated Python 3.13 environment — **0 High findings**, down from 2. The system Python 3.15 still cannot run it (`cbor2`'s binary extension is built for an older ABI), which is why earlier reports could not. It remains a hard CI gate |
| `tests/acceptance.sh` | Requires a local devnet; the live testnet was exercised instead by the E2E suite |
| `tests/chaos.sh` | Destructive; devnet only |
| `tests/load.ts` | Reports measured throughput for a specific machine — not a portable number |

---

## Totals

| | |
|---|---|
| Solidity | **385** |
| Node and services | **181** |
| Live end-to-end | **12** |
| **Total automated** | **578** |

A count is evidence of coverage, not of correctness. The adversarial suites matter more than
the total: they use real attacker contracts rather than asserting intent.
