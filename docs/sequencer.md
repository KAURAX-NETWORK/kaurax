# Sequencer

KAURAX runs a **single, centralized sequencer**. This is the largest trust assumption in
the system after the absence of fault proofs.

## What it does

```
user tx ──► RPC ──► mempool ──► ordering ──► execution engine ──► L3 block
L2 deposit ─────────────────────► (ahead of every user transaction)
```

The sequencer decides **inclusion** and **order**. The execution engine decides only what
those transactions *do*. This is the same division `op-node` and `op-geth` draw, and it is
why the engine is run with mining disabled — it must never choose block contents itself.

## Ordering policy (v0)

Applied per block, in `blockchain/l3/src/sequencer/mempool.ts`:

1. **Deposits first**, in L2 log order. They do not pass through the mempool and cannot be
   dropped by the sequencer.
2. **Per sender, ascending nonce.** A nonce gap stops that sender's queue for the block;
   later transactions stay queued rather than being dropped.
3. **Between senders, higher effective priority fee first**, ties broken by arrival time.
4. Fill until the block gas limit is reached.

### What this policy does not provide

- **No MEV protection.** The sequencer can see every pending transaction and could
  reorder, insert or drop at will. Nothing in the protocol prevents it.
- **No fair ordering guarantee.** First-come-first-served is not enforced across senders;
  fee priority explicitly overrides arrival order.
- **No private mempool.** Anything submitted is visible to the operator immediately.

## Mempool rules

| Rule | Reason |
|---|---|
| Reject wrong `chainId` | A transaction signed for another chain must never execute here |
| Reject pre-EIP-155 (unprotected) transactions | Cross-chain replay |
| Replacement requires a strictly higher priority fee | Standard; prevents free re-queuing |
| 64 queued transactions per sender, 20 000 total | Memory exhaustion |
| Drop below the on-chain nonce | Already mined or permanently invalid |

## Failure modes

| Failure | Effect | Mitigation today |
|---|---|---|
| Sequencer stops | No new blocks; the chain halts | None. There is no failover and no forced-inclusion timeout. |
| Sequencer censors an address | That address cannot transact on KAURAX | The address can still deposit through `KauraxPortal`, which the sequencer must include. It cannot be used to move existing KAX out. |
| Sequencer reorders for profit | Value extraction from users | None |
| Sequencer key compromise | Attacker controls ordering and liveness | Key handling only (`docs/security.md`) |
| Sequencer produces an invalid state | Withdrawals could be proven against a bad root | The challenger may delete an unfinalized output within the window. This is a trusted human backstop, not a proof. |

## Forced inclusion

Implemented, via `KauraxPortal.depositTransaction`. A deposit becomes an L3 transaction
because the node derives it from an L2 event, so censoring it requires censoring the L2.

**Caveats stated honestly:**

- There is no *timeout* forcing the sequencer to include a deposit within N L2 blocks. A
  sequencer that simply stops running includes nothing at all.
- The path has not been adversarially tested.
- It provides an entry hatch, not an exit hatch. A user with KAX already on KAURAX and a
  censoring sequencer cannot force a withdrawal today.

## Metrics

Exposed at `METRICS_PORT/metrics`:

`kaurax_sequencer_healthy`, `kaurax_blocks_produced_total`,
`kaurax_transactions_included_total`, `kaurax_deposits_applied_total`,
`kaurax_mempool_size`, `kaurax_l3_block_height`.

## Path to decentralization

See [`decentralization.md`](./decentralization.md). Nothing in this section is implemented.
