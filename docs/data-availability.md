# Data Availability

**Execution, settlement and data availability are three separate concerns.** On KAURAX
today all three terminate at the same underlying L2, but that is a deployment choice, not
a structural one, and the code keeps them apart.

| Concern | Where it happens on KAURAX | Interface |
|---|---|---|
| Execution | KAURAX L3, in the execution engine | `ExecutionEngineInterface` |
| Settlement | `KauraxL2OutputOracle` on the L2 | `SettlementInterface` |
| Data availability | `KauraxBatchInbox` on the L2 | `DataAvailabilityInterface` |

## Where L3 transaction data lives

Sequenced KAURAX transactions are published as **calldata of an L2 transaction** to
`KauraxBatchInbox`. The contract stores a commitment and metadata; it does **not** store
the bytes, because they are already permanently available as that transaction's calldata,
and paying for duplicate storage would be waste rather than safety.

The L2 in turn includes that calldata in its own batch to Ethereum. So:

```
KAURAX transaction
  → batch calldata on the L2
    → L2 batch on Ethereum
      → available from Ethereum
```

## What is deliberately NOT in a batch

**Deposits.** A deposit's authoritative record is the `TransactionDeposited` event on the
L2, which that chain already makes available. Re-publishing it inside a KAURAX batch would:

- pay twice for the same bytes, and
- create a second source of truth that could disagree with the first.

A node reconstructing KAURAX therefore does two things: replays batches **and** re-derives
deposits from the L2. This is the same split the OP Stack makes.

**Genesis.** Blocks at or below `KAURAX_GENESIS_BLOCK` are genesis state, distributed as a
config artifact (`blockchain/chain/genesis/`). They are not published through DA.

## Batch format, version 0

```
byte 0      format version (0x00)
bytes 1..n  zlib-deflated RLP
```

The RLP body is a list of blocks:

```
[ [blockNumber, timestamp, [rawTx, rawTx, ...]], ... ]
```

Transactions are the exact signed bytes the sequencer received, so a reconstructor can
verify every signature and recompute every hash independently. Implementation:
`blockchain/l3/src/batcher/encoding.ts`.

Batches are required to be **contiguous**: `KauraxBatchInbox.submitBatch` reverts on a gap
or an overlap. A gap would make history unreconstructable from L2 data alone, which is
exactly the failure this whole mechanism exists to prevent.

## How to reconstruct KAURAX from data availability alone

1. Read every `BatchSubmitted` event from `KauraxBatchInbox` on the L2, in order.
2. For each, fetch the L2 transaction and ABI-decode `submitBatch`'s third argument.
3. Verify `keccak256(data)` equals the event's `dataCommitment`.
4. Strip the version byte, inflate, RLP-decode.
5. Read every `TransactionDeposited` event from `KauraxPortal` over the same L2 range.
6. Replay: for each L3 block, apply that block's deposits (in L2 log order) followed by its
   batched transactions, against KAURAX genesis.
7. Compare the resulting state root against the `stateRoot` inside the output roots
   published to `KauraxL2OutputOracle`.

Step 7 is what turns reconstruction into verification. Today a mismatch can be *observed*
by anyone but cannot be *enforced* on chain, because there is no fault-proof system.

`tests/acceptance.ts` step 8 performs steps 1–4 for real and asserts that a specific
transaction is recoverable.

## How a node recovers

| Situation | Recovery |
|---|---|
| Node restart | The batcher reads `lastBatchL3Block` from the L2 and resumes from the next block, so nothing is re-posted or skipped. |
| Engine data loss | Replay from DA per the procedure above. |
| L2 reorg below a batch | The batch transaction may be dropped; the batcher's next submission fails the contiguity check and the operator must resubmit from `lastBatchL3Block + 1`. This is detected, not silently ignored. |
| Sequencer loss of unbatched blocks | **Data loss.** Blocks produced but not yet batched exist only in the engine. `kaurax_batcherStatus.pendingL3Blocks` is the size of that exposure at any moment. |

That last row is a real weakness of v0 and is listed in
[`threat-model.md`](./threat-model.md).

## Alternatives: configured, not operated

`DA_MODE` accepts `calldata`, `blob` and `altda`.

- `calldata` — **operational.**
- `blob` — EIP-4844 blobs on the L2. Cheaper, but blobs expire (~18 days), which changes
  the recovery story: after expiry, reconstruction depends on archival nodes. **Not
  implemented.**
- `altda` — an external DA layer via `DA_ALTDA_ENDPOINT`. Moves the availability trust
  assumption off Ethereum entirely. **Not implemented.**

Selecting an unimplemented mode raises an error rather than silently falling back to
calldata, because a caller who believes data went to a blob when it did not has a false
picture of the chain's recoverability (`blockchain/l3/src/da/calldata.ts`).

## Cost

Each byte of KAURAX data is paid for twice: once as L2 calldata gas, and again as the L2's
share of its own Ethereum posting. The chain config exposes an `l2DataFee` policy
(`blockchain/chain/config/*.json`) intended to charge users for that cost.

**It is not enforced on chain in v0.** The devnet execution engine does not implement an
L1-data-fee component in gas accounting, so KAURAX currently under-charges relative to what
the batcher spends. This is a known economic gap, not a design claim.
