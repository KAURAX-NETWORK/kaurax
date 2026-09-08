# KAURAX — Test Status

**Verified:** 2026-09-08 · **Commit:** `40b4aee`

Every number below came from running the command shown, on this commit. None is quoted from
an earlier report. When these drift, the fix is to re-run and update — not to adjust the
number.

---

## Solidity — `forge test`

**322 passed · 0 failed · 0 skipped · 17 suites**

| Suite | Tests | Covers |
|---|---|---|
| `KVSFaultDisputeGame.t.sol` | 35 | Multi-level bisection ending in the one-step verifier; the full adversarial matrix |
| `KVSMerkle.t.sol` | 11 | Commitment primitive, including fuzz |
| `KVSVerifier.t.sol` | 6 | **404 differential cases** against the TypeScript emulator |
| `DisputeGame.t.sol` | 41 | Bonds, bisection, resolution, timeouts, finalization interlock |
| `KauraxSwap.t.sol` | 30 | Constant-product AMM |
| `KauraxNames.t.sol` | 29 | Registration, renewal, resolution |
| `Governance.t.sol` | 27 | Multisig owner epochs, timelock delays |
| `KauraxLaunchpad.t.sol` | 27 | Escrowed sales, soft-cap refunds |
| `KauraxPortal.t.sol` | 25 | Deposits, withdrawals, pause, forced transactions |
| `ForcedInclusion.t.sol` | 21 | Deadlines, acknowledgement, settlement halt |
| `AI.t.sol` | 15 | Agent and service registries, payments |
| `DisputeGameAdversarial.t.sol` | 11 | Reentrancy, griefing, replay — real attacker contracts |
| `KauraxBatchInbox.t.sol` | 9 | Batch submission, authorisation |
| `MerkleTree.t.sol` | 8 | Proofs, including fuzz |
| `DeployGuard.t.sol` | 8 | Refusing roles to addresses without code |
| `Bridge.t.sol` | 6 | ERC-20 bridging |
| `KauraxL2OutputOracle.t.sol` | 13 | Proposals, escrow, deletion, finalization |

## Node and services — `pnpm test`

**126 passed · 0 failed · 25 packages**

| Package | Tests | Covers |
|---|---|---|
| `@kaurax/l3` | 78 | WAL recovery, derivation checkpoint, L2 reorgs, signing seam, Merkle, batch encoding |
| `@kaurax/api` | 21 | Config validation, route behaviour |
| `@kaurax/indexer` | 16 | Log decoding, token metadata |
| `@kaurax/signer` | 11 | Keystore: signature recovery, refusals, determinism |

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
| **Slither** | Configured as a hard CI gate. Cannot execute on this machine: `cbor2`'s binary extension is incompatible with the local Python 3.15 build, so `crytic-compile` fails to import. It runs on `ubuntu-latest` in CI |
| `tests/acceptance.sh` | Requires a local devnet; the live testnet was exercised instead by the E2E suite |
| `tests/chaos.sh` | Destructive; devnet only |
| `tests/load.ts` | Reports measured throughput for a specific machine — not a portable number |

---

## Totals

| | |
|---|---|
| Solidity | **322** |
| Node and services | **165** |
| Live end-to-end | **12** |
| **Total automated** | **499** |

A count is evidence of coverage, not of correctness. The adversarial suites matter more than
the total: they use real attacker contracts rather than asserting intent.
