# KAURAX — Fault Proof Specification

> **SUPERSEDED IN PART — read this first.** This document was written **before** the KAURAX
> Verifiable Subset was built, and its statement that no verifier exists is no longer true. A
> real one-step verifier now exists for the KVS (`src/kvs/KauraxOneStepVerifier.sol`) and is
> deliberately not connected to settlement.
>
> The conclusion is unchanged and still correct: **KAURAX has no fault proof over its own
> execution.** For the current position, read
> [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md), which measures the remaining
> distance against the code. This file is kept because its engineering reasoning is still
> sound and because quietly rewriting it would remove the trail.

**This is a design document. KAURAX has no fault proof system.**

Nothing described here is implemented unless a line says so. The status column is the most
important part of this document; if you read nothing else, read §2.

Related: [DISPUTE_GAME.md](DISPUTE_GAME.md) describes what exists today — a permissionless
dispute game whose final arbiter is the guardian.

---

## 1. What a fault proof actually requires

A fault proof lets a contract decide, from evidence alone, whether a claimed state
transition was correct — with no trusted party. Three things are needed:

1. **A deterministic state transition function.** Given the same pre-state and inputs, every
   honest node computes the same post-state, bit for bit.
2. **A commitment to the execution trace**, not just the endpoints, so a disagreement can be
   narrowed below one block to one instruction.
3. **An on-chain verifier** that can execute that single instruction and compare the result.

KAURAX has (1) in practice and neither (2) nor (3). The dispute game bisects over blocks
because block boundaries are the only commitments that exist.

---

## 2. Status of every component

| # | Component | Status |
|---|---|---|
| 1 | Deterministic state transition | PARTIAL — anvil/revm is deterministic in practice; not pinned by spec or differential test |
| 2 | Canonical L2 state definition | IMPLEMENTED — output root over state root, withdrawal root, block hash |
| 3 | Output roots | IMPLEMENTED and TESTED |
| 4 | Execution traces | NOT STARTED |
| 5 | State commitments | IMPLEMENTED (block granularity only) |
| 6 | Trace commitments | NOT STARTED |
| 7 | Binary bisection protocol | IMPLEMENTED over blocks; DESIGNED over traces |
| 8 | Single-step execution proof | NOT STARTED |
| 9 | One-step verifier | **NOT STARTED** |
| 10 | On-chain execution environment | NOT STARTED |
| 11 | Gas limits for verification | DESIGNED — §6 |
| 12 | Deterministic execution guarantees | PARTIAL |
| 13 | Invalid transition detection | NOT STARTED (requires 9) |
| 14 | Proof serialization | NOT STARTED |
| 15 | Merkle proofs | IMPLEMENTED for withdrawals; not for execution |
| 16 | Instruction verification | NOT STARTED |
| 17 | Preimage / data availability | PARTIAL — batches are on the L2; no preimage oracle |
| 18 | Bond and slashing | IMPLEMENTED and TESTED |
| 19 | Timeout rules | IMPLEMENTED and TESTED |
| 20 | Security assumptions | DOCUMENTED — §8 |
| 21 | Upgrade mechanism | PARTIAL — governance exists, holds no roles yet |
| 22 | Formal verification | NOT STARTED |
| 23 | Audit | NOT STARTED |
| 24 | Test vectors | NOT STARTED |
| 25 | Mainnet migration plan | DESIGNED — §10 |

**Nine is the one that matters.** Without it everything else is scaffolding.

---

## 3. The state transition function

KAURAX executes EVM blocks. The transition is:

```
STF(pre_state, block) -> post_state
```

Determinism requires pinning every input that execution can observe: block number,
timestamp, base fee, chain ID, and the ordered transaction list. KAURAX derives all of these
from data already published to the L2, so a verifier has everything it needs *in principle*.

**The gap:** "deterministic in practice" is not a specification. Two revm builds could
diverge on an edge case and nothing would catch it. Required before implementation:

- a pinned EVM version and hardfork configuration, committed on chain
- differential testing against a second implementation
- a documented policy for what happens when the underlying EVM upgrades

---

## 4. Execution traces

To narrow below a block, the prover must commit to intermediate states *within* execution.
The standard construction:

- execution is compiled to a simple deterministic machine (OP Stack uses MIPS; Arbitrum uses
  WAVM)
- after every instruction, the machine's entire state — registers, memory, program counter —
  is hashed
- those hashes form a Merkle tree whose root commits to the whole trace

Bisection then runs over trace indices instead of block numbers, converging on a single
instruction.

**Why KAURAX cannot do this today:** it executes through anvil, which produces no trace
commitments and cannot be run inside the EVM. Adopting this means adopting a proving VM.
That is the decision, and it is a large one.

---

## 5. The one-step verifier

The contract that ends the game:

```solidity
/// NOT IMPLEMENTED. Specified here; deliberately absent from the codebase.
interface IOneStepVerifier {
    /// @return postState The state hash after executing exactly one instruction.
    function step(
        bytes32 preState,
        bytes calldata proof,      // Merkle proofs for touched memory and registers
        bytes calldata preimages   // data the instruction reads
    ) external view returns (bytes32 postState);
}
```

The game calls `step` with the agreed pre-state at the narrowed index. Whoever's claimed
post-state matches the return value wins. No guardian, no discretion.

> **Deliberately not implemented.** A `step()` that returned `true`, or consulted an
> operator, would let KAURAX claim a fault proof it does not have. Per the project's rules,
> no placeholder verifier exists — not even a stub that compiles. The interface above lives
> in this document, not in `src/`.

---

## 6. Gas and proof size

A one-step proof must fit in a block and be affordable, or the mechanism exists but nobody
can use it.

| Item | Target |
|---|---|
| Proof calldata | < 100 KB |
| Verification gas | < 5,000,000 |
| Bisection rounds for a 30M-gas block | ~25 (2²⁵ instructions) |
| Total game duration | bounded by `MAX_GAME_DURATION` |

If verification cannot be made to fit, the design is wrong and must change before
implementation — not after.

---

## 7. Preimage oracle

The verifier needs data the instruction reads: contract code, storage, transaction bytes. It
cannot hold these, so it accepts hashes and requires a preimage oracle where anyone can post
the data matching a hash.

KAURAX's data availability already publishes what is needed to the L2 — verified by
`tests/acceptance.ts`, which rebuilds a transaction from calldata alone. The oracle contract
itself does not exist.

---

## 8. Security assumptions after implementation

Even a complete fault proof does not make a chain trustless. It would still assume:

- at least one honest party watches and is willing to bond
- the L2 does not censor a challenge for the full window
- bonds exceed what a successful lie is worth
- the verifier is correct — which is why an audit is mandatory, not optional
- the EVM implementation matches the one the verifier encodes

The fifth is the subtlest: a bug that makes the verifier disagree with the real EVM would
let an honest proposer lose.

---

## 9. What to build, in order

1. Pin and specify the state transition function; add differential tests
2. Choose a proving VM and commit to it
3. Build the preimage oracle
4. Build the one-step verifier for a subset of opcodes; test against real traces
5. Extend to the full instruction set
6. Extend bisection from blocks to trace indices
7. Replace `resolve` with the verifier; the rest of the dispute game is unchanged
8. Audit
9. Only then describe KAURAX as fault proven

Step 7 is small **because** the dispute game was built with it in mind: bonds, timeouts,
bisection and settlement all stay as they are, and one call changes.

---

## 10. Migration

Deploy the verifier alongside the existing game. Run both — guardian resolution authoritative,
verifier advisory — and compare every outcome. Only when they agree over a meaningful period
does the verifier become authoritative and the guardian's role shrink to pausing.

Switching straight to an unproven verifier would replace a known trust assumption with an
unknown one.

---

## 11. Test vectors

NOT STARTED. Will require: known-good traces for each opcode class, adversarial traces that
must be rejected, and cross-implementation agreement. Listed here so its absence is visible.
