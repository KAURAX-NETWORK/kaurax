# Treasury policy

Who may move KAURAX's protocol fees, how, and what is deliberately not possible.

**KAX has no monetary value.** The treasury currently holds a valueless testnet asset. This
policy exists so the controls are in place and tested *before* anything of value accrues,
which is the only order in which that can be done honestly.

---

## 1. What the treasury is

A `KauraxMultisig` deployed on KAURAX (the L3), configured **2-of-3** by default. It is the
account named by `KAURAX_FEE_RECIPIENT`, so the execution engine's coinbase points at it and
the priority component of every gas fee accrues there.

| | |
|---|---|
| Contract | [`blockchain/contracts/src/governance/KauraxMultisig.sol`](../blockchain/contracts/src/governance/KauraxMultisig.sol) |
| Deployed by | [`infra/scripts/devnet/genesis.ts`](../infra/scripts/devnet/genesis.ts), before the node starts |
| Address | written to `.env` as `KAURAX_TREASURY_ADDRESS`; reported by `kaurax_feeStatus` |
| Owners | `KAURAX_TREASURY_OWNERS` (comma-separated) |
| Threshold | `KAURAX_TREASURY_THRESHOLD`, default 2 |
| Tests | [`test/Treasury.t.sol`](../blockchain/contracts/test/Treasury.t.sol), 20 tests |

It is deployed at genesis rather than alongside the other application contracts because the
node reads `KAURAX_FEE_RECIPIENT` **once, at startup**. A treasury deployed later would leave
every block until then crediting a different account.

It is **not** installed at a fixed predeploy address, unlike the message passer and the L3
bridge. Those carry their configuration in immutables, so their runtime code can be copied
to a chosen address. The multisig keeps its owner set and threshold in *storage*, and
copying runtime code does not copy storage — the result would be a treasury with no owners
and no threshold, able to receive fees and never able to spend them.

---

## 2. How money arrives, and why no event fires

Gas fees arrive as a **coinbase credit**: the EVM increases the account's balance directly
in the state trie during block finalisation. It does not call the account.

**Therefore `receive()` never runs and no `Deposit` event is emitted for fee income.**

This was measured before it was written down. With the treasury set as coinbase on a real
`anvil` block, one 21,000-gas transfer at a 2 gwei priority fee raised its balance by
exactly 42,000,000,000,000 wei and emitted nothing; the only logs in the deployment block
were the constructor's three `OwnerAdded` and one `ThresholdChanged`. Both facts are pinned
by `test_accruesFeesWithoutBeingCalled` and `test_feeIncomeEmitsNoDepositEvent`.

> **An indexer watching `Deposit` will report zero fee income, forever.** That is not a bug
> to be fixed in the contract — no contract can observe its own coinbase credit. Fee income
> is computed from receipts instead, by `GET /api/fees`
> ([PROTOCOL_FEES.md](PROTOCOL_FEES.md) §4).

An ordinary transfer *does* call `receive()` and *does* emit `Deposit`
(`test_ordinaryTransferDoesEmitDeposit`). So the two funding paths look different in the
logs while crediting the same balance, and **balance cannot be derived from events**.

---

## 3. How money leaves

Every disbursement is a proposal, confirmed by a threshold of owners, then executed:

1. **Submit** — an owner calls `submit(to, value, data, description)`. `description` is
   free text stored on chain, and it is the only record of *why*. Fill it in properly.
   Submitting also confirms, so one signature is already counted.
2. **Confirm** — a second owner calls `confirm(txId)`.
3. **Execute** — any owner calls `execute(txId)`.

`isExecutable(txId)` reports whether a proposal would succeed right now.

### What the tests guarantee

| Guarantee | Test |
|---|---|
| A non-owner cannot propose | `test_nonOwnerCannotProposeADisbursement` |
| A non-owner cannot execute even a fully confirmed proposal | `test_nonOwnerCannotExecuteAConfirmedDisbursement` |
| One owner cannot pay themselves | `test_oneOwnerCannotDisburseAlone` |
| An owner cannot reach the threshold by confirming twice | `test_theSameOwnerCannotConfirmTwiceToReachTheThreshold` |
| A payee cannot re-enter to be paid twice | `test_payeeCannotReenterToBePaidTwice` |
| A proposal cannot be executed twice | `test_aDisbursementCannotBeExecutedTwice` |
| Rotating owners invalidates proposals confirmed under the old set | `test_removingAnOwnerInvalidatesAPendingDisbursement` |
| A removed owner loses all authority immediately | `test_aRemovedOwnerCannotDisburse` |
| An owner can withdraw consent before execution | `test_revokingAConfirmationStopsADisbursement` |
| The entire balance can leave — funds are never trapped | `test_theEntireBalanceCanBeDisbursed` |
| Overdrawing reverts and changes nothing | `test_disbursingMoreThanTheBalanceRevertsAndChangesNothing` |
| A payee that rejects payment cannot strand the treasury | `test_aPayeeThatRejectsPaymentCannotStrandTheTreasury` |
| Balance always equals accruals minus disbursements | `testFuzz_balanceIsAccrualsMinusDisbursements` (256 runs) |

Reentrancy is prevented by ordering, not by a guard: `execute` marks the proposal executed
*before* making the call, so a reentrant target finds it already spent.

A failed call reverts the whole of `execute`, which rolls back that write — so a
disbursement that fails for a transient reason (insufficient balance at the time) can be
retried later without re-proposing (`test_aFailedDisbursementCanBeRetriedAfterTheCauseIsFixed`).

---

## 4. What the policy is

The contract enforces *who*. It cannot enforce *what for*. These are the rules the owners
hold themselves to, and a reader can check compliance against the chain because every
proposal carries a `description`.

1. **Operating costs first.** Hosting, domains, and the L2 gas the batcher and proposer
   spend ([OPERATING_COSTS.md](OPERATING_COSTS.md)) have first claim.
2. **Every disbursement states its purpose** in `description`, specifically enough that
   someone reading the chain a year later can tell what it paid for.
3. **No disbursement to an owner without the other two agreeing** — which the 2-of-3
   already enforces for any single owner, and which owners should not route around by
   paying an address they control without saying so in the description.
4. **No discretionary spending while the network is testnet-only.** There is nothing of
   value to spend, and establishing a habit now that would be wrong later is a bad trade.
5. **Grant funds are not protocol funds.** If a grant is ever received it is tracked
   separately, per [SUSTAINABILITY.md](SUSTAINABILITY.md) — a grant has conditions attached
   that fee income does not.

---

## 5. Emergency procedure

There is no pause, no freeze and no recovery key, deliberately: each would be a privileged
capability that an attacker could also reach.

**If one owner key is compromised:** the remaining two retain control, because 2-of-3 still
holds without the third. Rotate immediately — propose `removeOwner(compromised)` and then
`addOwner(replacement)` through the multisig itself. Removing an owner increments
`ownerEpoch`, which invalidates every proposal the old set had confirmed, including anything
the attacker had queued.

**If two of three keys are compromised:** the attacker controls the treasury. There is no
recovery. The honest mitigation is prevention: owners must be three different people holding
keys on three different machines, which is the one property no contract can verify.

**If all keys are lost:** the funds are unrecoverable. Again by design — a recovery
mechanism is an attack surface.

---

## 6. Limitations, stated plainly

1. **No external audit.** `KauraxMultisig` has 27 governance tests and 20 treasury tests
   and has been read by nobody outside this project. Consistent with the rest of the
   repository, and the reason §4.4 says not to let anything of value accrue yet.
2. **The devnet owner set is public.** `start.sh` defaults to Foundry's published devnet
   accounts, whose private keys are in Foundry's documentation. That is correct for a
   devnet and catastrophic anywhere else. A real deployment **must** set
   `KAURAX_TREASURY_OWNERS` to keys three different people control.
3. **Three owners is thin.** 2-of-3 tolerates one lost key or one compromised key, not one
   of each.
4. **No timelock on disbursement.** `KauraxTimelock` exists and guards settlement roles on
   the L2; the treasury does not use it, so a 2-of-3 can move funds immediately. For a
   treasury holding real value, a delay on large disbursements would be worth the
   inconvenience.
5. **No spending limits, no allowlist, no recurring payments.** Every disbursement is a
   manual proposal. §4 is a policy owners follow, not a rule the contract enforces.
6. **Fee income is not visible on chain as an event** (§2). It must be computed from
   receipts, and the treasury's balance is not the same figure — anyone can send to the
   address, and owners can spend from it.

---

## 7. Before this holds anything of value

In order, none of them done:

1. Replace the devnet owner set with keys three different people control, on three
   different machines.
2. Get `KauraxMultisig` audited. It is 300 lines and the cheapest audit this project will
   ever commission.
3. Decide whether large disbursements need a timelock, and implement it if so.
4. Only then let value accrue.

Steps 1–3 are not done. Step 4 must not happen before them.
