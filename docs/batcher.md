# Batcher

The batcher moves KAURAX transaction data to the underlying L2, making the chain
reconstructible by anyone.

```
L3 blocks ──► collect ──► RLP ──► zlib ──► KauraxBatchInbox (on the L2)
```

## Behaviour

- Runs on `BATCH_SUBMISSION_INTERVAL` (seconds).
- Takes up to `BATCH_MAX_L3_BLOCKS` blocks per submission.
- Refuses to submit a payload larger than `DA_MAX_BATCH_BYTES`, raising an error that names
  the setting to lower.
- Uses the **raw transaction bytes the sequencer actually included**, so a reconstructor
  can verify every signature independently.
- On start, reads `lastBatchL3Block` from the L2 and resumes at the next block. A restart
  never re-posts and never skips.

Source: `blockchain/l3/src/batcher/`.

## Contiguity is enforced on chain

`KauraxBatchInbox.submitBatch` reverts with `NonContiguousBatch` on a gap or an overlap.
A gap would make L3 history unreconstructable from L2 data — the exact failure the batcher
exists to prevent — so it is rejected at the contract, not merely avoided in the client.

## What is excluded

Deposits and genesis blocks. See [`data-availability.md`](./data-availability.md#what-is-deliberately-not-in-a-batch).

## Known gap: unbatched blocks are not durable

Blocks produced but not yet batched exist only in the execution engine and in the
sequencer's in-memory payload map. If the node is lost before those blocks are batched,
their user transactions are not recoverable from the L2.

`kaurax_batcherStatus.pendingL3Blocks` and the `kaurax_unbatched_l3_blocks` metric report
the size of that exposure at any moment. Reducing `BATCH_SUBMISSION_INTERVAL` reduces the
window at the cost of more L2 fees. A durable write-ahead log for sequenced payloads is
required before mainnet and is listed in [`../MAINNET_READINESS.md`](../MAINNET_READINESS.md).

## Interfaces

`BatcherInterface` and `DataAvailabilityInterface` in
`blockchain/l3/src/settlement/types.ts`. The batcher never talks to a DA target directly —
it talks to the interface, which is what makes blob or external DA a substitution rather
than a rewrite.

## Operations

```bash
kaurax batcher status     # health, pending blocks, last error
kaurax batch latest       # the most recent batch published to the L2
```

Monitor `kaurax_batcher_healthy`, `kaurax_unbatched_l3_blocks` and
`kaurax_last_batch_age_seconds`. A rising unbatched count with a healthy sequencer means
the batcher is failing to land transactions on the L2 — usually an unfunded batcher key.
