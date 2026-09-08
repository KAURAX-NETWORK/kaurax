# KAURAX — Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│  ETHEREUM  (L1)                                          TRUSTLESS    │
│  Settlement and data availability for the L2 beneath KAURAX           │
└───────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │  the L2's own settlement
                                   │
┌───────────────────────────────────────────────────────────────────────┐
│  UNDERLYING L2                                                        │
│                                                                       │
│   KauraxBatchInbox        every KAURAX block, as calldata  TRUSTLESS  │
│   KauraxL2OutputOracle    state commitments + proposer escrow TRUSTED │
│   KauraxDisputeGame       bonds, bisection, resolution       MIXED    │
│   KauraxPortal            deposits, forced inclusion, exits  TRUSTLESS│
│   KauraxL2ERC20Bridge     token bridge counterpart                    │
│   Multisig (2-of-3) + Timelock   holds every privileged role TRUSTED  │
└───────────────────────────────────────────────────────────────────────┘
        ▲                    ▲                        │
        │ batches            │ output roots           │ deposits and
        │ (calldata)         │ (+ bond)               ▼ forced transactions
┌───────────────────────────────────────────────────────────────────────┐
│  KAURAX  (L3)                                                         │
│                                                                       │
│   Sequencer     orders transactions, seals blocks       CENTRALIZED   │
│                 └─ write-ahead log (fsync) survives a hard kill       │
│   Derivation    L2 events → L3 transactions             TRUSTLESS     │
│                 └─ durable checkpoint; refuses to guess after loss    │
│   Batcher       RLP + zlib → calldata on the L2         TRUSTLESS     │
│   Proposer      output roots + escrow → the oracle      TRUSTED       │
│   Engine        anvil (revm), EVM-equivalent execution                │
│                                                                       │
│   Predeploys    L3ToL2MessagePasser · KauraxL3ERC20Bridge             │
└───────────────────────────────────────────────────────────────────────┘
```

**There are no validators and no consensus in this diagram, because a rollup has neither.**
Ordering is decided by one sequencer. What a validator set would normally provide —
"nobody can quietly rewrite history" — comes instead from the middle layer: every block is
published as calldata, so anyone can rebuild the chain and check it.

---

## The pieces

**Sequencer.** Accepts transactions, orders them, seals blocks. Centralized. Before a block
is visible it goes to an fsync'd write-ahead log, so a hard kill loses nothing that was
sealed.

**Derivation.** Watches the portal on the L2 and turns `TransactionDeposited` events into L3
transactions the sequencer must include. Because the source is an L2 event rather than the
KAURAX mempool, the sequencer cannot censor a deposit without censoring the L2. A durable
checkpoint records how far it has got; if that is lost while a forced transaction is
pending, the node refuses to start rather than guess between dropping a deposit and applying
one twice.

**Batcher.** Compresses sealed blocks and submits them as calldata to `KauraxBatchInbox`.
This is the data availability guarantee, and it is the one property verified by
reconstruction rather than asserted.

**Proposer.** Posts an output root — `keccak(version, stateRoot, withdrawalTreeRoot,
blockHash)` — to `KauraxL2OutputOracle`, escrowing a bond with each. **Nothing verifies the
root corresponds to any execution.** This is the trust assumption everything else sits on.

**Dispute game.** Anyone may challenge a root with a bond. The proposer answers with its
claimed state at the midpoint; the challenger picks the half it still disputes; repeating
halves the range until one block remains. A 2-of-3 multisig then decides. Bisection is
trustless; resolution is not.

**Forced inclusion.** Submit a transaction to the portal on the L2 and a deadline starts. If
the sequencer has not acknowledged inclusion by then, the output oracle rejects every
proposal — censoring one user halts settlement for everyone, including the operator's own
withdrawals.

**Withdrawals.** Prove a Merkle inclusion against a published withdrawal root, wait out the
challenge period, then finalize. No signature and no operator approval. The proof is only as
good as the root it is proven against, which returns to the proposer assumption.

**Governance.** A 2-of-3 multisig holds the portal guardian and the dispute guardian; a
1-hour timelock holds the batch inbox owner; the dispute game holds the oracle's challenger
role, so deleting a commitment requires a played game rather than an act of authority.

---

## Reading the labels

**TRUSTLESS** holds even if every KAURAX operator is dishonest. **TRUSTED** holds while a
named party behaves. **CENTRALIZED** means one party with no redundancy.

Detail per property: [../SECURITY_MODEL.md](../SECURITY_MODEL.md).

KAURAX is a testnet. KAX has no monetary value.
