# Protocol fees and treasury

Where a KAURAX transaction fee goes, what can be collected, what cannot, and what the
figures do and do not mean.

**KAX is a testnet gas asset with no monetary value.** Nothing in this document describes
revenue. It describes a mechanism that would account for revenue on a network whose gas
token had a price, implemented now so that the accounting is correct before there is
anything to account for.

---

## 1. The fee has two halves and they go to different places

KAURAX runs an unmodified EIP-1559 fee market. Every transaction fee splits:

| Component | Amount | Destination |
|---|---|---|
| Base fee | `gasUsed × baseFeePerGas` | **Burned.** No account receives it. No setting can redirect it. |
| Priority fee | `gasUsed × (effectiveGasPrice − baseFeePerGas)` | Credited to the **block coinbase**. |

This is measured, not asserted. With `anvil --base-fee 1000000000` and one 21,000-gas
transfer at a 2 gwei priority fee:

```
paid by sender   63,000,000,000,000 wei
burned           21,000,000,000,000 wei   (1 gwei × 21,000)
to coinbase      42,000,000,000,000 wei   (2 gwei × 21,000)
```

The coinbase balance was read before and after and gained exactly the third figure. Those
constants are pinned in [`blockchain/l3/test/fee-accounting.test.ts`](../blockchain/l3/test/fee-accounting.test.ts).

**The burned half is usually the larger one.** A "total fees collected" figure that
includes it overstates what the network received, often by more than half. Every surface
in this repository keeps the two apart.

---

## 2. Why there is no fee-vault contract

The obvious design — deploy a `FeeVault` contract and route fees to it — does not work for
native gas fees, and it is worth being precise about why.

The EVM credits the priority fee to `block.coinbase` during block finalisation, before and
outside any contract execution. No Solidity can intercept it. A contract can receive
*application* fees (KauraxNames already does this, see §5), but it cannot receive gas.

The only lever is the coinbase, and the coinbase belongs to the execution engine.

---

## 3. What is implemented

`KAURAX_FEE_RECIPIENT` names an account; `kaurax-node` sets the engine's coinbase to it at
startup, before the sequencer produces its first block.

```
KAURAX_FEE_RECIPIENT=0x...
```

Mechanism: [`blockchain/l3/src/fees/recipient.ts`](../blockchain/l3/src/fees/recipient.ts).
The node calls `anvil_setCoinbase` on the **internal** engine endpoint, then reads
`eth_coinbase` back and compares. The write alone is not trusted — an engine that accepts
the call and ignores it would otherwise leave an operator believing fees are collected
while they are burned.

What this changes: nothing a user pays, nothing about how a block executes, no transaction
semantics, no historical block. It names the account that was already being credited.

What it does not do:

- It does not recover the base fee. Nothing can.
- It does not create a withdrawal path. The recipient is an ordinary externally-owned
  account whose key is held outside the node process; `kaurax-node` cannot spend from it.
- It does not work on an arbitrary execution client. `anvil_setCoinbase` is anvil's. See
  §6.

### Failure is visible, not fatal

If the coinbase cannot be set, the node logs at `error` and keeps running — a chain that
cannot route its fees is still a working chain, and refusing to start would turn a
bookkeeping problem into an outage. The condition is exposed three ways:

- `kaurax_feeStatus` → `recipient.applied: false` with a `problem` string
- metric `kaurax_fee_recipient_applied` = 0
- metric `kaurax_fee_recipient_configured` = 1

**Alert on `configured == 1 && applied == 0`.** No other signal makes this visible.

### Before this existed

The coinbase was the zero address. Both halves of every fee were destroyed. Leaving
`KAURAX_FEE_RECIPIENT` unset preserves exactly that behaviour, and the node logs a warning
saying so. Configuring the zero address explicitly is **rejected** by config validation: it
is the default, so setting it would read as "fees are routed" while burning them.

---

## 4. Reading the numbers

| Surface | Gives |
|---|---|
| `kaurax_feeStatus` (JSON-RPC) | recipient, whether it was applied, its live balance, the current base fee |
| `GET /api/fees` | all-time split: paid by users / burned / received, with indexed-block coverage |
| `GET /api/fees/daily?days=30` | the same split per day |

Both API figures are `SUM` over indexed receipts joined to block headers
([`services/api/src/routes/fees.ts`](../services/api/src/routes/fees.ts)). A transaction
contributes to exactly one row and there is no second source to reconcile, so double
counting is structurally impossible rather than merely avoided.

Totals cover **indexed blocks only**, and the covered range is returned alongside them.

### A priority-fee total cannot be attributed retrospectively

The indexer does not record a per-block coinbase. A block credits whatever its own
coinbase was, so `priorityFeesWei` is the total credited **across indexed blocks**, not a
figure the address currently in `recipient` received. For blocks produced before that
address was configured the credit went wherever the coinbase pointed then — including the
zero address, where it was destroyed.

The field is named `priorityFeesWei` rather than anything implying a recipient, and the
response carries an `attribution` block saying this. Recording a per-block coinbase in the
indexer would fix it and has not been done.

### Balance is not income

`recipient.balanceWei` is an account balance. Anyone can send to that address and whoever
holds the key can spend from it. It will diverge from cumulative fees received the first
time either happens. Both numbers are published so the divergence is visible.

### Net revenue is not computed

Gross receipts are on chain. Operating costs are not — they are invoices, and they are
tracked by hand in [OPERATING_COSTS.md](OPERATING_COSTS.md). No endpoint subtracts one from
the other, because doing so would present a hand-maintained number with the authority of an
indexed one. A reader who wants net has both halves and is told which is which.

---

## 5. Application fees, which are a different thing

`KauraxNames` charges for registration and renewal and forwards the payment to a `treasury`
address it holds in state
([`blockchain/contracts/src/apps/KauraxNames.sol`](../blockchain/contracts/src/apps/KauraxNames.sol)).
That is an ordinary contract transfer, unrelated to gas, and it is covered by
`KauraxNames.t.sol` (29 tests) including the access control on `setTreasury`.

`KauraxSwapPair` retains 0.3% of each swap input **in the reserves, for liquidity
providers**. No protocol cut is taken.

Neither is aggregated into `/api/fees`, which is gas only.

---

## 6. Limitations, stated plainly

1. **Engine-coupled.** Fee routing works because the engine is anvil. A different client
   sets its coinbase at genesis or through its own flag. This is one more consequence of
   the engine choice documented in [FAULT_PROOFS.md](FAULT_PROOFS.md) §1.
2. **The recipient is a single externally-owned account.** It is not a multisig. KAURAX
   has an audited-shape 2-of-3 (`KauraxMultisig`, 27 tests) deployed on the **L2** for
   settlement governance; pointing the L3 coinbase at an L3 multisig would work, and is not
   done today because nothing of value accrues to it. Do not treat the current setup as a
   treasury suitable for funds that matter.
3. **No automated disbursement.** There is no payout logic, no splitter, no schedule.
   Spending is a manual transaction by whoever holds the key.
4. **No price.** KAX has none. Every figure is in wei of a valueless asset, and nothing
   converts it.
5. **Nothing has been audited.** Consistent with the rest of the repository.

---

## 7. What would have to change for this to be a real treasury

In the order the work depends on itself:

1. Point the coinbase at a multisig deployed on KAURAX rather than an EOA.
2. Write a disbursement policy — who may spend, for what, with what approval — and the
   test suite that enforces it.
3. Get the multisig and the disbursement path audited.
4. Only then let anything of value accrue.

Steps 1–3 are not done. Step 4 must not happen before them.
