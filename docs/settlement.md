# Settlement

KAURAX settles to the underlying L2. The L2 settles to Ethereum. KAURAX does not duplicate
the second hop and does not claim it.

## The settlement interface

`SettlementInterface` (`blockchain/l3/src/settlement/types.ts`):

```ts
submitBatch(l3StartBlock, l3EndBlock, data)  // publish L3 data to the L2
getBatchStatus(txHash)                        // inclusion status of a submission
getL2Block()                                  // head of the underlying L2
getL1Finality()                               // Ethereum finality beneath the L2, or null
proposeOutput({outputRoot, l3BlockNumber, l2BlockHash, l2BlockNumber})
nextOutputBlockNumber()
latestOutput()
```

Implemented once, in `L2SettlementAdapter`, against real contracts on a real chain.

### There is no simulated settlement

`LOCAL_DEV_SETTLEMENT=true` changes **which chain** the settlement contracts live on — a
local L2 instead of a public one. It does not change what any of this code does. Every call
is a real transaction or a real contract read. If the contracts are not deployed,
construction fails loudly rather than returning plausible values.

The configuration validator rejects `LOCAL_DEV_SETTLEMENT=true` together with
`KAURAX_PROFILE=testnet`, because a public network must settle against real contracts on a
real L2.

## Output roots

```
outputRoot = keccak256(abi.encode(
    version,             // 0x00..00 for v0
    stateRoot,           // KAURAX block state root
    withdrawalTreeRoot,  // root of L3ToL2MessagePasser's withdrawal tree
    latestBlockHash      // KAURAX block hash
))
```

Defined twice, deliberately: `blockchain/contracts/src/libraries/Hashing.sol` and
`blockchain/l3/src/settlement/hashing.ts`. They are consensus-critical and must agree; a
divergence would either block every withdrawal or admit one that was never made.

The proposer reads `withdrawalTreeRoot` **at the block being committed to**, not at head.
Committing to a root the chain had already moved past would let a withdrawal be proven
against a state that never existed together.

Each proposal is pinned to a recent L2 block hash. If the L2 reorgs beneath it, the
proposal reverts with `L2BlockHashMismatch` rather than landing against a different history.

## Trust assumption, stated plainly

`KauraxL2OutputOracle` accepts a proposal **because it came from the proposer key**, not
because anything verified it. There is no fault-proof system.

The only backstop is the `challenger` role, which may delete proposals that have not yet
passed the finalization period. That is a trusted human operator with a delete button, not
a proof system. Concretely:

- An incorrect output root that survives `WITHDRAWAL_CHALLENGE_WINDOW` is final.
- A withdrawal finalized against it drains real value from `KauraxPortal`.
- Anyone can *detect* this by replaying from data availability. Nobody can *stop* it
  on chain.

This is the single largest blocker to mainnet.

## Guards that do exist

| Guard | Contract | What it stops |
|---|---|---|
| Proposal schedule | `UnexpectedBlockNumber` | Out-of-order or duplicate proposals |
| Future-block bound | `BlockNumberInFuture` | Committing to blocks that cannot exist yet |
| L2 reorg pin | `L2BlockHashMismatch` | Proposals landing on a different L2 history |
| Finalized-delete ban | `CannotDeleteFinalized` | Retroactively invalidating a settled withdrawal |
| Batch contiguity | `NonContiguousBatch` | Unreconstructable history |
| Portal pause | `guardian` | Emergency halt of deposits and withdrawals |

## Ethereum finality

`getL1Finality()` returns `null` when the L1 endpoint is absent or cannot answer the
`finalized`/`safe` tags. When the configured L1 is a **local devnet chain**, the response
carries `isLocalDevnetChain: true` and every consumer — CLI, explorer, dashboard — renders
"No data available (L1 is a local devnet chain, not Ethereum)".

A local chain will happily answer `finalized`. Presenting that number as Ethereum finality
would be false, so KAURAX does not.
