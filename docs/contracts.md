# Contracts

All contracts are MIT-licensed Solidity 0.8.28, built with Foundry.

```bash
cd blockchain/contracts
forge build
forge test          # 162 tests
forge test -vvv     # with traces
forge fmt
```

## Layout

```
blockchain/contracts/src/
├── L2/                          deployed on the underlying L2
│   ├── KauraxPortal.sol         deposits, withdrawal prove/finalize, pause
│   ├── KauraxL2OutputOracle.sol KAURAX state commitments
│   ├── KauraxBatchInbox.sol     KAURAX transaction data anchor
│   └── KauraxL2ERC20Bridge.sol  ERC-20 escrow
├── L3/                          deployed on KAURAX (predeploys)
│   ├── L3ToL2MessagePasser.sol  withdrawal origination + Merkle tree
│   ├── KauraxL3ERC20Bridge.sol  mint/burn counterpart
│   └── KauraxBridgedERC20.sol   bridged token representation
├── libraries/
│   ├── Hashing.sol              output root and withdrawal hashing
│   ├── MerkleTree.sol           append-only tree + proof verification
│   ├── AddressAliasHelper.sol   cross-domain sender aliasing
│   └── Types.sol
├── interfaces/
└── examples/                    HelloKaurax, Counter, SimpleStorage, KauraxToken
```

## Predeploy addresses

| Address | Contract |
|---|---|
| `0x4200000000000000000000000000000000000016` | `L3ToL2MessagePasser` |
| `0x4200000000000000000000000000000000000010` | `KauraxL3ERC20Bridge` |

Installed at genesis by `infra/scripts/devnet/genesis.ts`, which places the compiled runtime
bytecode at those addresses — the same state a production `op-geth` would load from
`genesis.json`.

## Consensus-critical hashing

```solidity
outputRoot     = keccak256(abi.encode(version, stateRoot, withdrawalTreeRoot, latestBlockHash))
withdrawalHash = keccak256(abi.encode(nonce, sender, target, value, gasLimit, keccak256(data)))
```

Mirrored in `blockchain/l3/src/settlement/hashing.ts`. **These two implementations must
agree.** A divergence would either block every withdrawal or admit one that was never made.

## Test coverage

| Suite | Tests | Covers |
|---|---|---|
| `MerkleTree.t.sol` | 8 | Incremental root equals full rebuild (fuzzed), proof round-trip, forged leaf, wrong index, malformed proof |
| `KauraxL2OutputOracle.t.sol` | 13 | Schedule, access control, future-block bound, L2 reorg pin, challenger deletes, finalized-delete ban, binary search |
| `KauraxPortal.t.sol` | 23 | Deposits, aliasing, pause, full withdrawal lifecycle, forged withdrawals, leaf substitution, re-prove semantics, double finalization, reentrancy, `l3Sender` |
| `KauraxBatchInbox.t.sol` | 10 | Contiguity, gaps, overlaps, access control, key rotation |
| `Bridge.t.sol` | 6 | ERC-20 round trip, alias enforcement, escrow drain attempts, token mismatch |
| `KauraxNames.t.sol` | 29 | Label validation, pricing, expiry, grace period, primary-name spoofing |
| `KauraxSwap.t.sol` | 30 | Pools, liquidity, swaps, native KAX, k-invariant fuzz, underpayment |
| `KauraxLaunchpad.t.sol` | 27 | Escrow, caps, refunds, claim/refund exclusivity, no stranded KAX |

The security-relevant tests assert what must **fail**, not only what must succeed: a forged
withdrawal, a substituted leaf index, a tampered output-root preimage, a direct escrow
drain, and an unaliased deposit finalization all revert with specific errors.

## Deployment

```bash
# Settlement contracts, on the L2
forge script script/DeploySettlement.s.sol:DeploySettlement \
  --rpc-url $L2_RPC_URL --broadcast

# Example contracts, on KAURAX
forge script script/DeployExamples.s.sol:DeployExamples \
  --rpc-url $KAURAX_RPC_URL --broadcast
```

Every parameter comes from the environment. Nothing is hardcoded, and no key is committed.

## Audit status

**None.** No contract here has been audited. Do not deposit anything of value.
