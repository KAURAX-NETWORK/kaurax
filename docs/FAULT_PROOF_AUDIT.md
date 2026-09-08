# KAURAX — Pre-Implementation Audit

**Date:** 2026-09-08 · **Method:** every claim below was checked against source, not against
documentation. File and line references are the evidence.

---

## 1. Execution engine

**What the docs said:** "KAURAX executes through revm."
**What the code does:** `kaurax-node` drives **`anvil` over JSON-RPC**.

| Fact | Evidence |
|---|---|
| One engine implementation exists | `blockchain/l3/src/engine/` contains only `AnvilEngine.ts`, `rpc.ts`, `types.ts` |
| It is selected unconditionally | `blockchain/l3/src/index.ts:59` — `new AnvilEngine(...)`, no branch on profile |
| The live testnet runs it | node log: `execution engine ready client="anvil (revm)"`; container image `ghcr.io/foundry-rs/foundry:v1.5.1` |
| Blocks are produced by an RPC call | `AnvilEngine.produceBlock()` → `evm_mine` |
| Deposits use test-only cheatcodes | `applyDeposit()` → `anvil_setBalance`, `anvil_impersonateAccount` |

### FINDING A-1 — a false claim in the codebase (HIGH for credibility)

`AnvilEngine.ts:11` states: *"the `testnet` profile uses `op-geth` for that."*

**No op-geth engine exists.** `grep -rn "op-geth" blockchain/l3/src` returns four hits, all
comments. There is no second `ExecutionEngine` implementation, and the profile is never
consulted when constructing one. The interface in `engine/types.ts` is genuinely written to
allow one — but the sentence describes a deployment that does not exist.

### FINDING A-2 — the state transition function is not in this repository (CRITICAL for fault proofs)

The state root is **only ever read**, never computed:

```
Proposer.ts:101   stateRoot: block.stateRoot        // from eth_getBlockByNumber
withdrawals.ts:178 stateRoot: block.stateRoot        // same source
```

`grep` finds no component that computes a state root, re-executes a transaction, or replays a
block. There is exactly one implementation of the KAURAX STF, it is an external binary, and
it is reached over JSON-RPC.

**This is the decisive constraint on this entire brief**, and section 6 returns to it.

---

## 2. Output roots — verified correct

`outputRoot = keccak256(abi.encode(version, stateRoot, withdrawalTreeRoot, latestBlockHash))`

Implemented twice and pinned against each other: `libraries/Hashing.sol:17` and
`l3/src/settlement/hashing.ts:33`, with `blockchain/l3/test/hashing.test.ts` asserting the
TypeScript output equals values produced by the Solidity implementation. Version constant is
`bytes32(0)` on both sides.

The withdrawal tree root is read **at the block being committed to**, not at head
(`Proposer.ts:141`), which is correct — the alternative admits a withdrawal provable against a
state that never existed together.

---

## 3. Output proposal — confirmed unverified

`KauraxL2OutputOracle.proposeL2Output` (line 140) checks, in order: non-zero root; correct
bond; no overdue forced transaction; expected block number; derived timestamp is in the past;
pinned L2 block still canonical.

**It performs no check that the root corresponds to executing anything.** The claim in
`SECURITY_MODEL.md` is accurate.

---

## 4. Dispute game — real, and honestly labelled

`KauraxDisputeGame.sol`, 542 lines. Verified by reading, not by its comments:

| Property | Verified |
|---|---|
| Challenging is permissionless | `challenge()` is `external payable`, gated only on bond |
| The proposer is read from the oracle, not supplied | `ORACLE.proposalProposer(_outputIndex)` |
| Both sides are bonded | challenger at `challenge()`, proposer escrowed at proposal time |
| Bisection halves a block range | `defend()` / `bisect()`, ⌈log₂N⌉ exchanges |
| One live game per output | `liveGameOfOutput`, prevents parallel-defence griefing |
| Finalization is held open by a live game | oracle line 202 consults `hasLiveGame` |
| Settlement is re-entrancy safe | `bondsSettled` set before transfer; `_deleteAndRecover` runs before `_settle` |
| Timeout is permissionless | `resolveTimeout()`, winner determined by whose turn it was |
| Guardian inaction refunds both | rather than letting silence decide an outcome |

**It does not claim to be a fault proof.** `isFaultProof()` returns `false`;
`resolutionMechanism()` returns a string naming the guardian. The header comment states the
limitation before describing the feature.

### FINDING A-3 — bisection carries no binding claim structure (HIGH)

`defend(gameId, midClaim)` records the proposer's claimed state root at the midpoint, and
`bisect(gameId, takeLowerHalf)` lets the challenger pick a half. But:

- the challenger never commits to a **counter-claim**, so nothing on chain says what it
  believes the state root is;
- `midClaim` is overwritten each round and never checked against the endpoints;
- at the leaf, `NarrowedToBlock` carries `g.midClaim`, which for a single-block proposal is
  whatever was last written — possibly `bytes32(0)`.

For a guardian this is tolerable: a human reads the range and decides. **For a verifier it is
not.** A one-step verifier needs an agreed pre-state and a disputed post-state at the leaf,
and this game produces neither. Any verifier work must replace the claim structure, not just
append a call.

### FINDING A-4 — a game can outlive finalization (MEDIUM, already documented)

`_deleteAndRecover` catches the oracle's refusal and emits `DisputeOutlivedFinalization`. The
challenger is paid but the bad root stands. Documented in the contract and in
`docs/DISPUTE_GAME.md`. Not introduced by this work; not fixed by it either.

---

## 5. Derivation, batcher, withdrawals

| Component | What it actually does |
|---|---|
| `Derivation.ts` | Watches L2 `TransactionDeposited`, queues deposits in (block, logIndex) order, exactly once. **Does not re-execute anything.** |
| `Batcher.ts` + `da/calldata.ts` | RLP + zlib of L3 blocks to `KauraxBatchInbox` as calldata |
| `KauraxPortal` | `finalizeWithdrawalTransaction` requires a Merkle proof against a published root **and** `OUTPUT_ORACLE.isOutputFinalized(...)` |
| `MerkleTree.sol` | `verify(root, leaf, index, proof)` — reusable for trace commitments |

Data availability is genuine: `tests/acceptance.ts` rebuilds a signed transaction from L2
calldata alone.

---

## 6. Verifier, trace, preimage oracle — confirmed absent

```
grep -rlniE "onestep|traceRoot|traceCommit|stepProof|preimageOracle|provingVM" .
```

Six hits, **all in documentation**, all describing the components as unimplemented. No
Solidity, no TypeScript. The repository's claim that these do not exist is accurate.

---

## 7. Tests — counted, not quoted

`forge test`: **270 passed**, 14 suites. Relevant suites: `DisputeGame.t.sol` 41,
`KauraxPortal.t.sol` 25, `ForcedInclusion.t.sol` 21, `KauraxL2OutputOracle.t.sol` 13,
`MerkleTree.t.sol` 8, plus `DisputeGameAdversarial.t.sol`.

`pnpm test`: **126 passed** across 25 packages. L3 suites: hashing, merkle, batch encoding,
derivation checkpoint, derivation reorg, WAL, signer.

**No test executes an EVM instruction, commits to a trace, or verifies a step.** There is
nothing to regress in that area because nothing exists.

---

## 8. The conclusion that governs the implementation

Requirement 8 of the brief says to state plainly if production-grade fault proofs cannot be
completed here. **They cannot, and finding A-2 is why.**

A fault proof requires a state transition function that can be (a) instrumented to emit a
per-instruction trace, and (b) re-executed one step at a time on chain. KAURAX's STF is
`anvil`, an external binary driven over JSON-RPC. It can do neither. Proving *real KAURAX
blocks* therefore requires first replacing or reimplementing the execution engine — the
18–30 engineer-month path already documented in `FAULT_PROOF_ROADMAP.md`.

What can be built here, honestly, is the **entire fault proof machine except the part that
consumes real KAURAX execution**: a specified deterministic execution model, an off-chain
emulator that emits traces, a commitment scheme, a genuine on-chain one-step verifier that
executes an instruction and decides from the result, and a dispute game that narrows to one
step and resolves through that verifier.

That is what the plan implements, and the resulting claim is bounded accordingly:

> KAURAX has a working one-step verifier and a dispute protocol that resolves genuine
> execution disagreements through it — **for the KAURAX Verifiable Subset (KVS)**. KAURAX
> blocks are executed by anvil over the full EVM, which the verifier does not cover.
> **KAURAX therefore does not have fault proofs for its own state transitions.**

Nothing in the implementation may be described in stronger terms than that sentence.
