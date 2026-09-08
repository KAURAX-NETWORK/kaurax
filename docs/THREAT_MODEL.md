# KAURAX — Threat Model

Two lenses on the same system. This file models **adversaries**: what each one can do, what
stops them, and what does not. [threat-model.md](threat-model.md) catalogues **threats**
T1–T13 by asset. Neither supersedes the other; where they overlap, this file is the more
recent.

**KAURAX is a testnet. KAX has no monetary value.** Nothing here should be read as a claim
that KAURAX is safe to hold value on.

---

## 1. Assumptions

### Honest assumptions

- The underlying L2 orders and finalizes its own transactions correctly.
- keccak256 is collision-resistant; secp256k1 signatures are unforgeable.
- At least one party watches output roots and is willing to bond a challenge.
- A challenger can get a transaction included on the L2 before a deadline.

### Malicious assumptions — assumed hostile

- Any user, including one who is also the sequencer's operator.
- Anyone able to submit a batch, propose an output, or open a dispute.
- Anyone with network position between a user and the RPC.

### Trust classification

| Component | Class | Consequence if it misbehaves |
|---|---|---|
| Sequencer | **CENTRALIZED** | Reordering, delay, MEV. Cannot forge. Censorship bounded by forced inclusion |
| Proposer | **TRUSTED** | Can commit a state root matching no execution |
| Guardian (2-of-3) | **TRUSTED** | Decides every settlement dispute |
| Governance (2-of-3 + 1h timelock) | **TRUSTED** | Holds every privileged role |
| Operator keys | **TRUSTED** | Local in the current deployment (finding M-3) |
| Challenger | **PERMISSIONLESS** | Anyone, bonded |
| Data availability | **TRUSTLESS** | Published as L2 calldata; reconstructible by anyone |
| Deposits | **TRUSTLESS** | Derived from L2 events |
| Forced inclusion | **TRUSTLESS** | An ignored forced transaction halts settlement for everyone |
| Withdrawal proofs | **TRUSTLESS** *given a correct root* | Merkle proof; no operator approval step |

The one-line summary the whole model reduces to:

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

---

## 2. Adversaries

### A — Malicious sequencer

**Can:** reorder transactions, extract MEV, delay any user, refuse to include a transaction
submitted directly to it, stop producing blocks.

**Cannot:** forge a signature, hide transaction data (batches are L2 calldata), censor a
deposit (derived from L2 events, not from its mempool), or censor indefinitely — an
unacknowledged forced transaction makes `proposeL2Output` revert, halting settlement for
everyone including the operator.

**Evidence:** 21 forced-inclusion tests; verified live — overdue → proposals rejected →
acknowledged → resumed.

**Residual:** reordering and MEV are unmitigated (T11). One operator, no failover.

---

### B — Malicious proposer

**Can:** commit an output root corresponding to no execution. `proposeL2Output` checks the
caller, the block number, the derived timestamp and the pinned L2 hash — **not the state.**

**Stopped by:** a bonded permissionless challenge, bisection to a single block, and then a
2-of-3 multisig decision. Its bond is escrowed at proposal time, so a root carries risk from
the moment it is committed.

**Residual — the ceiling of the whole model.** If the guardian is captured or mistaken, a
bad root finalizes and can be withdrawn against. This is finding H-1, and closing it requires
a fault proof over KAURAX execution, which requires an execution engine that can emit a
trace. `anvil` over JSON-RPC cannot.

---

### C — Malicious challenger

**Can:** open a baseless game, forcing the proposer to defend; stall by answering at the last
moment of each round; occupy the single game slot for one output.

**Stopped by:** a bond it loses when wrong; one live game per output, so it cannot force
parallel defences with one bond; and a proposer cannot challenge its own claim to occupy the
slot itself.

**Residual (L-1, accepted):** a delay of roughly `rounds × RESPONSE_TIMEOUT` at the cost of
one bond. The alternative — allowing parallel games — is worse.

---

### D — Malicious user

**Can:** spam the mempool, submit malformed calldata, attempt replays across chains, attempt
to finalize a withdrawal twice, attempt to withdraw against a root it invented.

**Stopped by:** chain-ID domain separation (an L2-signed transaction is rejected by KAURAX —
acceptance test 11); a finalized-withdrawal set (the same withdrawal cannot finalize twice —
same test); Merkle inclusion against a published root; RPC rate limits.

**Residual:** mempool DoS is only partially mitigated (T13).

---

### E — Malicious node

A third party running KAURAX software and lying to its own users.

**Can:** serve wrong state to anyone who trusts it.

**Stopped by:** nothing at the protocol level, and nothing needs to be. Every block is L2
calldata, so a user who does not trust a node can rebuild the chain from the L2 —
`tests/acceptance.ts` does exactly that, recovering a signed transaction from batch data
alone.

---

### F — Compromised signer

**Can:** with the sequencer key, produce blocks. With the proposer key, commit roots — see B.
With the batcher key, submit batches. **In the current deployment, compromising the node host
yields all three**, because keys are local (finding M-3).

**Stopped by:** nothing yet. A signing service with a scrypt+AES-256-GCM keystore is built
and tested (`services/signer`, 11 + 19 tests) but **is not deployed**.

**Residual:** HIGH in practice. This is the single most valuable operational fix available
that does not require protocol work.

---

### G — Compromised governance participant

**Can:** with one of three signers, nothing alone. With two, everything: change the
challenger, the guardian, batch-inbox ownership, and by extension dispute outcomes.

**Stopped by:** the 2-of-3 threshold, owner epochs that invalidate stale approvals, and a
1-hour timelock on batch-inbox ownership that makes one class of change observable before it
takes effect.

**Residual:** a 1-hour timelock is short. Two compromised signers is a full compromise, and
`DeployGovernance` is skipped when `disputeGameEnforced()` precisely so a routine governance
transfer cannot silently undo the dispute game.

---

### H — Unavailable data availability

**Can:** if the L2 is unreachable, prevent reconstruction and stall derivation.

**Stopped by:** the data being on the L2 in the first place — KAURAX inherits the L2's
availability rather than asserting its own. Deposits resume from a durable checkpoint; the
node refuses to start against a chain that does not match that checkpoint rather than
deriving nonsense.

**Residual:** KAURAX cannot be more available than its L2. If the L2 loses data, KAURAX
history is unreconstructible. 5 reorg regression tests cover the L2-moves-underneath case.

---

### I — Censorship attacker

Including the operator, or someone able to coerce it.

**Can:** refuse a user's transaction at the RPC.

**Stopped by:** forced inclusion. The user submits through the L2 portal; if the sequencer
does not acknowledge it before the deadline, settlement halts for everyone. Censoring one
user costs the operator its ability to settle.

**Residual:** the escape hatch requires the user to reach the **L2**. It bounds censorship;
it does not make transactions unstoppable.

---

### J — Reorganization attacker

**Can:** cause the L2 to reorg beneath a proposal.

**Stopped by:** proposals pinning the L2 block hash they were built against — a reorg makes
the proposal fail rather than land against a different history. Derivation detects a shorter
or different L2 and refuses to continue.

**Residual (T8, partial):** a deep L2 reorg after finalization is not recoverable by KAURAX.

---

### K — Denial-of-service attacker

**Can:** flood the RPC, the faucet, or the mempool; open disputes to consume attention.

**Stopped by:** RPC rate limits and connection caps at nginx; faucet limits per address **and
per client IP** (which caught its own operator this session); bonds on every dispute action.

**Residual:** a single node has no failover. RPC exhaustion stops new transactions being
accepted, though it does not affect what is already settled.

---

## 3. What KAURAX can and cannot guarantee

**Can guarantee, without trusting any operator:**

- Every transaction's data is recoverable from the L2.
- A deposit cannot be censored without censoring the L2.
- Censorship of a user halts settlement for everyone.
- A withdrawal requires a Merkle proof against a published root — no operator approval.
- Anyone may challenge an output root; nobody can be prevented from doing so.

**Cannot guarantee:**

- That an output root corresponds to any execution. **Nothing verifies this.**
- That a dispute is decided correctly — a multisig decides.
- Transaction ordering fairness, or freedom from MEV.
- Liveness. One sequencer, no failover.
- That operator keys are not all on one host today.
- That the contracts are free of bugs. **No external audit has been performed.**

---

## 4. Attack cost

Bond values are set at deployment; no figure here is claimed correct for any deployment.

| Attack | Cost to attacker | Cost to KAURAX |
|---|---|---|
| Bad output root, honest challenger, correct guardian | Proposer bond | A dispute's duration |
| Bad output root, captured guardian | Cost of capturing 2 of 3 signers | **Unbounded** — the ceiling |
| Baseless challenge | Challenger bond | One dispute's delay |
| Censoring one user | Settlement halts for everyone | Bounded by the forced-inclusion deadline |
| Node host compromise | One host | All three operator identities (M-3) |

---

## 5. Where this model is weakest

1. **The guardian.** Every path where a proposer lies terminates in a human decision.
2. **Key custody.** The signing service exists and is not deployed.
3. **No external audit.** The contracts have been reviewed only by their authors.
4. **Single sequencer.** No failover, and none planned before fault proofs.
