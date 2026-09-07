# Ethereum — the Layer 1

Ethereum is KAURAX's root of trust. KAURAX never talks to it directly.

```
KAURAX ──posts to──► underlying L2 ──posts to──► Ethereum
```

## What Ethereum provides

- **Data availability.** KAURAX batches are calldata on the L2; the L2 publishes its own
  data to Ethereum. KAURAX transaction data is therefore ultimately reconstructible from
  Ethereum.
- **Settlement for the L2**, and through it, the ordering guarantee that KAURAX's batches
  and output roots exist in a canonical sequence.

## What Ethereum does not provide

- **Any verification of KAURAX state.** Ethereum has never heard of KAURAX. It sees only
  the L2's data, inside which KAURAX bytes are indistinguishable from any other payload.
- **Withdrawal safety.** That depends on the output roots on the L2 being correct, which no
  proof system currently enforces.

## Configuration

```bash
L1_RPC_URL=https://ethereum-sepolia-rpc.example
L1_CHAIN_ID=11155111
```

The L1 endpoint is **read-only** for KAURAX. It is used for one thing: reporting Ethereum
finality beneath the L2. KAURAX never signs an L1 transaction.

## Finality reporting

`getL1Finality()` returns `latest`, `safe` and `finalized` heights, or `null` when the
endpoint is absent or cannot answer those tags.

On the devnet the L1 is a local chain with no consensus layer. It will answer `finalized`
with a number, but that number means nothing. The response therefore carries
`isLocalDevnetChain: true`, and every consumer renders:

> No data available (L1 is a local devnet chain, not Ethereum)

rather than presenting a meaningless height as finality.

## Latency stack

A KAURAX transaction reaches Ethereum-backed finality through three hops:

| Hop | Typical duration |
|---|---|
| KAURAX block | `KAURAX_BLOCK_TIME` (2s on the devnet) |
| Batch reaches the L2 | `BATCH_SUBMISSION_INTERVAL` |
| L2 batch reaches Ethereum, then finalizes | the L2's own cadence, plus ~13 minutes for Ethereum finality |

Withdrawal latency is separate and longer: an output root must be published, then the
KAURAX challenge window must elapse, then the L2's own withdrawal delay applies on top.
Delays stack across layers — that is an inherent cost of being an L3, not an implementation
shortcoming.
