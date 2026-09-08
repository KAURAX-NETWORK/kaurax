# KAURAX — Technical Proposal

## Problem

`KauraxL2OutputOracle.proposeL2Output` checks three things: the caller is the proposer, the
block number is the expected one, and the derived timestamp is in the past. **It does not
check that the output root corresponds to executing any transactions.**

A dishonest proposer can commit an arbitrary root. The dispute game makes that contestable —
anyone may challenge with a bond, and bisection narrows the disagreement to a single block on
chain — but the final decision belongs to a 2-of-3 multisig.

## What is proposed

Replace the multisig's decision with a contract that executes the one disputed instruction
and decides from the result.

### Components

**1. A pinned, specified state transition function.** KAURAX executes through revm, which is
deterministic in practice but not pinned by specification or checked against a second
implementation. A verifier must encode exactly one semantics.

*Deliverable:* a specification, a pinned EVM version committed on chain, and differential
tests against an independent implementation.

**2. A proving VM.** Execution must run somewhere the EVM can re-execute one step of it.
Recommended: **MIPS**, as used by OP Stack's Cannon — not because it is elegant but because a
verifier bug is unrecoverable and MIPS has the most adversarial review behind it.

*Deliverable:* KAURAX's state transition compiled to the proving VM, producing traces
reproducible by a third party.

**3. Execution trace commitments.** After every instruction, hash the machine's full state.
Those hashes form a Merkle tree committing to the whole execution, which is what lets
bisection descend below a block to an instruction.

*Deliverable:* trace roots committed alongside output roots.

**4. A preimage oracle.** The verifier holds hashes, not data. Anyone must be able to post
the preimage the verifier needs. KAURAX already publishes the underlying data to the L2; the
contract that serves it does not exist.

**5. The one-step verifier.**

```solidity
interface IOneStepVerifier {
    function step(bytes32 preState, bytes calldata proof, bytes calldata preimages)
        external view returns (bytes32 postState);
}
```

**No stub of this exists in the repository — deliberately.** A `step()` returning `true`
would let KAURAX claim a property it does not have, and a reviewer skimming the tree would
find a file named like a verifier.

## Integration

This is the part already done, and it was done on purpose.

`KauraxDisputeGame` bisects to one block and calls `resolve()`, which is `onlyGuardian`.
Integration means:

1. Extend bisection from block indices to trace indices — same loop, finer bounds
2. Add `resolveWithProof(gameId, proof, preimages)` calling the verifier
3. Keep `resolve()` through a transition period, then remove it

**Bonds, timeouts, abandonment, settlement and the finalization interlock are unchanged.**
They were built to hold a verifier's answer as readily as a guardian's.

## Migration

Deploy the verifier alongside the existing game and run both — guardian authoritative,
verifier advisory — comparing every outcome. The verifier becomes authoritative only after
they have agreed over a meaningful period.

Switching straight to an unproven verifier replaces a known trust assumption with an unknown
one. A verifier that disagrees with the real EVM lets an *honest* proposer lose.

## Constraints

| | Target |
|---|---|
| Proof calldata | < 100 KB |
| Verification gas | < 5,000,000 |
| Bisection rounds, 30M-gas block | ~25 |

If verification cannot be made to fit, the design is wrong and changes before implementation.

## Estimate

**18–30 engineer-months**, then a 3–6 month audit cycle. Labelled an estimate because it is
one: OP Stack's Cannon took years and repeated audits. No completion date is offered, and a
funder should treat one as a warning sign.

Full specification: [../FAULT_PROOF_SPEC.md](../FAULT_PROOF_SPEC.md) ·
[../FAULT_PROOF_ROADMAP.md](../FAULT_PROOF_ROADMAP.md)
