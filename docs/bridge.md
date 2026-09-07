# Bridge

Assets move `Ethereum ↕ L2 ↕ KAURAX`. KAURAX implements the **L2 ↕ KAURAX** hop; the
Ethereum ↕ L2 hop is the underlying rollup's own canonical bridge and is not reimplemented
here.

No custom, operator-signed bridge exists anywhere in this system. Deposits are derived from
L2 events; withdrawals are proven by Merkle inclusion under a committed root.

## Deposit: L2 → KAURAX

```
user ──► KauraxPortal.depositTransaction (on the L2)
             │ escrows native value
             │ emits TransactionDeposited
             ▼
     kaurax-node derivation
             │ mints to the L3 sender, then executes
             ▼
        KAURAX transaction
```

- **One transaction.** No proof, no waiting period.
- **Censorship resistant.** The source of truth is an L2 event, so the sequencer cannot
  drop it without the L2 dropping it.
- **Contract senders are aliased** by `0x1111000000000000000000000000000000001111`
  (`AddressAliasHelper`). Without this, an L2 contract at address X could act as the L3 EOA
  at address X, whose key someone may hold.
- Value escrowed in `KauraxPortal` backs KAX in circulation on KAURAX.

## Withdrawal: KAURAX → L2

Three steps, in the canonical rollup shape.

```
1. INITIATE   L3ToL2MessagePasser.initiateWithdrawal (on KAURAX)
                  burns the value, appends to the withdrawal Merkle tree
2. PROVE      KauraxPortal.proveWithdrawalTransaction (on the L2)
                  verifies the output-root preimage and Merkle inclusion
   ── wait WITHDRAWAL_CHALLENGE_WINDOW ──
3. FINALIZE   KauraxPortal.finalizeWithdrawalTransaction (on the L2)
                  releases escrowed value
```

Between 1 and 2 the proposer must publish an output root covering the withdrawal's block.
Until it does, `kaurax_withdrawalProof` reports `awaiting-proposal` — it does not fabricate
a proof or invent an ETA beyond the oracle's own schedule.

### What is verified at step 2

1. `keccak(version, stateRoot, withdrawalTreeRoot, blockHash)` equals the output root
   actually stored at the given index. The caller cannot supply a preimage of their choosing.
2. The withdrawal hash is included in `withdrawalTreeRoot` at the claimed leaf index, by
   Merkle proof.

A forged withdrawal fails (2). A withdrawal proven at someone else's leaf index fails (2).
A tampered preimage fails (1). All three are covered by `blockchain/contracts/test/KauraxPortal.t.sol`.

### Re-proving and challenger deletes

Re-proving against the **same** root is rejected (`AlreadyProvenAtSameRoot`) — otherwise
anyone could reset another user's challenge clock indefinitely. Re-proving against a
**different** root is allowed, which is the case where the challenger deleted a proposal
and the proposer republished.

At finalization the portal re-reads the proposal and requires it to still match what was
proven against (`ProposalReplaced`). A withdrawal proven against a deleted proposal cannot
be finalized.

## Deviation from the canonical OP Stack proof

The OP Stack proves withdrawals with a **Merkle-Patricia storage proof** against
`L2ToL1MessagePasser`. KAURAX's own node instead commits withdrawals to an **append-only
binary Merkle tree** whose root is carried in the output root.

| | OP Stack | KAURAX v0 |
|---|---|---|
| Commitment | MPT storage root | Binary Merkle root |
| Proof | RLP node path | 32 sibling hashes |
| Verified on chain | Yes | Yes |
| Forgery resistance | keccak preimage resistance | keccak preimage resistance |

**The security property is the same** — a withdrawal finalizes only if it is
cryptographically included under a committed root. The **proof format** differs, and that
is a deliberate, documented deviation: a hand-written MPT verifier is a large, subtle piece
of consensus-critical code, and shipping a wrong one would be worse than shipping a simpler
correct one.

Consequence: KAURAX's `devnet` profile is **not** wire-compatible with the canonical
`OptimismPortal`. The `testnet` profile, which runs `op-node` and `op-geth`, uses the
canonical portal and the canonical MPT proof. Migrating is a contract swap plus a
proposer change, not a redesign, because the output-root construction is otherwise
identical.

Implementation: `blockchain/contracts/src/libraries/MerkleTree.sol`,
`blockchain/l3/src/settlement/merkle.ts`. The two are cross-checked in
`blockchain/contracts/test/MerkleTree.t.sol` (including fuzz tests that compare the on-chain
incremental root against a full rebuild) and used end to end in `tests/acceptance.ts`.

## ERC-20 bridging

`KauraxL2ERC20Bridge` (escrow on the L2) ↔ `KauraxL3ERC20Bridge` (mint/burn on KAURAX,
predeploy `0x4200000000000000000000000000000000000010`).

- Deposits arrive at the L3 bridge from the **aliased** L2 bridge address, which no key
  holder can produce.
- Withdrawals release escrow only when the portal is finalizing a message whose L3 sender
  is the counterpart bridge.
- The L2 bridge measures the **actual** balance delta on `transferFrom`, so a
  fee-on-transfer token cannot mint more on KAURAX than was escrowed.

Covered by `blockchain/contracts/test/Bridge.t.sol`, including a full round trip and both
escrow-drain attempts.

## Getting a withdrawal proof

```bash
kaurax bridge status <withdrawalHash>
kaurax bridge withdrawals
```

Or over RPC / the SDK:

```ts
import {getWithdrawalStatus} from "@kaurax/sdk";
const status = await getWithdrawalStatus(client, withdrawalHash);
// {stage: "provable", proof: {...}} | {stage: "awaiting-output-root", ...}
```

The node rebuilds the tree from `MessagePassed` events, constructs the proof, and
**verifies it locally against the committed root before returning it**. If it does not
verify, the node returns an explanation rather than an unusable proof.

## Risks

| Risk | Status |
|---|---|
| Incorrect output root drains the portal | **Live risk.** No fault proofs. |
| Sequencer censors a withdrawal *initiation* | Possible. No forced-exit hatch exists. |
| Proposer stops | Withdrawals cannot be proven; deposits still work. |
| Guardian pause | Halts deposits and withdrawals. Centralized. |
| Portal key compromise | Guardian and challenger are single keys on the devnet. Production requires a multisig. |
| Withdrawal call reverts on the target | The withdrawal is consumed; value stays escrowed. Mirrors OP Stack behaviour. Bridge withdrawals should target the bridge, not arbitrary contracts. |
