# KAURAX — Fault Proof Roadmap

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

**KAURAX has no fault proof system.** This document explains precisely what is missing, why
the current design is what it is, and what building the real thing would take.

It is a roadmap, not a claim. `docs/FAULT_PROOF_SPEC.md` holds the technical specification;
this is the engineering plan around it.

---

## 1. Current trust model

| Property | Trustless? | Why |
|---|---|---|
| Data availability | **Yes** | Every block is published to the L2 as calldata. `tests/acceptance.ts` rebuilds a signed transaction from that calldata alone |
| Deposits | **Yes** | Derived from L2 events. The sequencer cannot censor one without censoring the L2 |
| Forced inclusion | **Yes** | An ignored forced transaction makes the output oracle reject every proposal. Censoring one user halts settlement for everyone |
| Withdrawal proofs | **Yes** | A Merkle proof against a published root. No operator approval step exists |
| **Output roots** | **No** | Accepted because the proposer key signed them. Nothing verifies they match any execution |
| **Dispute outcomes** | **No** | A 2-of-3 multisig decides |
| Transaction ordering | No | One sequencer |

The first four are real and tested. The last three are the gap.

---

## 2. The exact limitation

`KauraxL2OutputOracle.proposeL2Output` checks three things: the caller is the proposer, the
block number is the expected one, and the derived timestamp is in the past. **It does not
check that the output root corresponds to executing any transactions.**

A dishonest proposer can commit an arbitrary root. The dispute game makes that expensive and
contestable — anyone can challenge, both sides are bonded, and the disagreement narrows to a
single block on chain — but the final decision is the guardian's.

So the honest statement of KAURAX's security is:

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

A fault proof replaces the second clause with arithmetic. That is the entire difference.

---

## 3. What must exist

### 3.1 A proving VM

Execution must run somewhere the EVM can re-execute one step of it. Neither anvil nor revm
can. The options, with the trade-off that decides it:

| | Maturity | Cost |
|---|---|---|
| MIPS (OP Stack Cannon) | Production, audited | Compile the state transition to MIPS; large toolchain |
| WASM (Arbitrum WAVM) | Production | Similar; different toolchain |
| RISC-V (zk projects) | Emerging | Smaller instruction set, less battle-tested |
| Custom | — | Do not |

**Recommendation: MIPS.** Not because it is elegant — it is not — but because a verifier bug
is unrecoverable and MIPS has the most adversarial review behind it.

### 3.2 Trace commitments

After every instruction, hash the machine's whole state — registers, memory, program
counter. Those hashes form a Merkle tree whose root commits to the entire execution.

KAURAX's *node* produces nothing of the kind today, and that remains the largest single
piece of work. A commitment scheme and an emulator that produces such traces now exist for a
documented EVM subset — `packages/kvs`, `docs/FAULT_PROOFS.md` — but nothing connects them to
KAURAX block production.

### 3.3 A one-step verifier

```solidity
/// Implemented for the KVS subset as `KauraxOneStepVerifier`, NOT for KAURAX execution.
interface IOneStepVerifier {
    function step(bytes32 preState, bytes calldata proof, bytes calldata preimages)
        external view returns (bytes32 postState);
}
```

Given a pre-state and proofs for the memory it touches, execute one instruction and return
the resulting state hash. Whoever's claim matches wins. No guardian.

> No stub exists in the codebase — not even one that compiles. A `step()` returning `true`
> would let KAURAX claim a property it does not have, and a reviewer skimming the repository
> would find a file named like a verifier.

### 3.4 A preimage oracle

The verifier holds hashes, not data. Anyone must be able to post the preimage for a hash the
verifier needs. KAURAX already publishes the underlying data to the L2; the contract that
serves it does not exist.

---

## 4. How it attaches to what exists

This is the part that is already done, and it was done deliberately.

`KauraxDisputeGame` bisects to a single block and then calls `resolve()`, which is
`onlyGuardian`. Integrating a verifier means:

1. Extend bisection from block indices to trace indices — the loop is unchanged, the bounds
   are finer
2. Add `resolveWithProof(gameId, proof, preimages)` calling `IOneStepVerifier.step`
3. Keep `resolve()` for a transition period, then remove it

**Bonds, timeouts, abandonment, settlement and the finalization interlock stay exactly as
they are.** They were built to hold a verifier's answer rather than a guardian's, and
nothing about them assumes which it is.

---

## 5. What must be replaced or extended

| Component | Action |
|---|---|
| Execution engine | Replaced or wrapped so it emits a trace |
| State transition function | Pinned and specified; differential-tested |
| `KauraxL2OutputOracle` | Extended to commit to a trace root, not only a state root |
| `KauraxDisputeGame` | Extended: trace bisection, `resolveWithProof` |
| Guardian | Reduced to pausing |
| Node | Emits and serves traces; a challenger agent |
| Preimage oracle | New |
| One-step verifier | New |

---

## 6. Complexity

Rough, and rough on purpose — anyone quoting a precise figure for this has not built one.

| Phase | Scale |
|---|---|
| Pin and specify the STF, differential tests | 1–2 engineer-months |
| Adopt a proving VM, produce traces | 3–6 |
| Preimage oracle | 1 |
| One-step verifier, full instruction set | 6–12 |
| Trace bisection in the dispute game | 1–2 |
| Challenger agent | 2–3 |
| Audit and remediation | 3–6 elapsed |
| **Total** | **18–30 engineer-months, 12+ elapsed with a specialist team** |

For scale: OP Stack's Cannon took years and multiple audits. Treating this as a quarter's
work is the most likely way to ship a verifier with a bug in it, which is worse than shipping
none — a wrong verifier lets an honest proposer lose.

---

## 7. Sequence

1. **Now** — dispute game with bonds, bisection and multisig resolution ✅ done
2. **Next** — pin the STF; differential-test against a second EVM
3. **Then** — proving VM; traces alongside blocks, verified off chain
4. **Then** — preimage oracle and verifier for one opcode class; extend
5. **Then** — trace bisection; run the verifier advisory beside the guardian
6. **Then** — audit
7. **Only then** — the verifier becomes authoritative, and the word "trustless" becomes
   available

Step 5 matters: run both, compare every outcome, and switch only when they have agreed for
a meaningful period. Replacing a known trust assumption with an unproven one is not progress.

---

## 8. Until then

KAURAX should describe itself as:

- "An experimental Ethereum Layer-3 testnet"
- "Permissionless dispute games with bonds and bisection"
- "Data availability verified by reconstruction"
- "Fault proofs on the roadmap; the guardian is currently the final arbiter"

and not as trustless, fault-proven, or fully decentralised.
