# KAURAX — Technical Brief for Funders

**Date:** 2026-09-09 · **Audience:** a technical reviewer at an Ethereum or L2 grants
programme.

**Not an investment offering.** KAX is a testnet gas asset with no monetary value, no sale
and no tokenomics. This document offers no returns, equity or tokens. It describes
engineering that exists, engineering that does not, and what the difference would cost.

Everything below is reproducible from the repository in about fifteen minutes:
[REPRODUCIBLE_TESTNET_DEMO.md](REPRODUCIBLE_TESTNET_DEMO.md). Where a number appears, the
command that produced it is named.

---

## 1. What KAURAX is

An **application-specific Layer-3 optimistic rollup**. It gives an application its own EVM
blockspace, settles to a Layer-2, and publishes every block to that L2 as calldata so anyone
can rebuild the chain without asking KAURAX for anything.

It is a **testnet**. One operator sequences. There is no fault proof over its execution and
no external audit.

What makes it worth a reviewer's time is not the feature list — it is that the repository's
claims and its code agree, and that disagreements are gated in CI rather than corrected when
someone notices.

---

## 2. Why an application-specific L3

The case is narrow and does not require believing anything about L3s in general:

- **Blockspace that one application does not have to bid for.** Fee spikes caused by
  unrelated activity do not reach it.
- **Parameters chosen for one workload.** Block time, gas limit and the predeploy set are
  the application's to pick, not a compromise across every tenant.
- **The security budget is inherited, not rebuilt.** Settlement, data availability and
  finality come from the layers beneath. KAURAX supplies ordering and execution, and its own
  failure modes are bounded by forced inclusion and by the published data.
- **Withdrawal remains permissionless.** A user leaves with a Merkle proof against a
  published root. There is no operator approval step, and that is tested on every CI run.

The honest counterweight: an L3 inherits its L2's assumptions *and adds its own*. KAURAX's
additions are a trusted sequencer and unverified output roots. §6 states exactly what that
costs.

---

## 3. Architecture

```
Ethereum (L1)        settlement and data availability
    ▲
Underlying L2        KauraxPortal · KauraxL2OutputOracle · KauraxBatchInbox
    ▲                KauraxL2ERC20Bridge · KauraxDisputeGame
    │   batches (calldata) · output roots · bonds
KAURAX (L3)          sequencer · derivation · batcher · proposer · signer
```

There are **no validators and no consensus.** KAURAX is a rollup: ordering is the
sequencer's, and security comes from data availability, forced inclusion and settlement. The
explorer says so where users see it.

~6,100 lines of Solidity, ~4,600 lines of node TypeScript, plus SDK, CLI, indexer, API and
ten frontends in one pnpm workspace.

---

## 4. Current working components

Each row is verified by a named command, not by assertion.

| Component | Evidence |
|---|---|
| EVM execution — Solidity, Foundry, Hardhat, MetaMask, viem, ethers unchanged | `tests/acceptance.sh` steps 5–6 |
| Batching and publication to the L2 | step 7 |
| **Data availability** — a signed transaction rebuilt from L2 calldata alone | step 8 |
| **Proof-based withdrawal** — Merkle proof, no operator approval | step 10 |
| Replay protection across both directions | step 11 |
| **Forced inclusion** — ignoring a forced transaction halts settlement for everyone | `tests/forced-inclusion.sh` |
| **Bonded dispute game** — challenge, bisection, deletion, bond settlement | `tests/dispute.sh`, 23 checks against deployed contracts |
| Finalization interlock — a live dispute outranks the finalization timer | `tests/dispute.sh` step 4 |
| Governance — 2-of-3 multisig and 1-hour timelock hold every privileged role | `Governance.t.sol`, `TimelockSelfAdmin.t.sol` |
| One-step verifier over a documented EVM subset | `KVSVerifier.t.sol`, 404 differential cases |
| Failure behaviour under fault injection | `tests/chaos.sh` |
| Wallet, CLI, faucet, explorer, indexed history | `tests/e2e-testnet.sh` |

**Totals:** `forge test` → 385 passed, 23 suites. `pnpm test` → 186 passed. Acceptance → 47
checks. Dispute → 23. Apps → 45. Live end-to-end → 12.

---

## 5. Technical differentiation

Not "we are faster". Four things that are unusual and checkable:

1. **Data availability is demonstrated, not asserted.** The acceptance suite reconstructs a
   transaction from L2 calldata and matches its hash. Most rollup repositories describe DA;
   this one rebuilds a transaction from it on every push.

2. **A dispute game that runs against a live chain in CI.** Bonds, bisection, the
   finalization interlock and output deletion are exercised on deployed contracts, not only
   in unit tests — and the run needs no privileged party.

3. **A real one-step verifier, deliberately left unwired.** 544 lines of on-chain opcode
   execution for the KAURAX Verifiable Subset, agreeing with a reference emulator on 404
   generated cases. It is **not** connected to settlement, because KAURAX blocks execute on
   the full EVM and not on that subset. Building it and *not* claiming it is the point:
   `isFaultProof()` returns `false` and a test asserts it.

4. **Claims are gated in CI.** Documented test counts must equal what the suites report, in
   totals and in prose. The KVS fixtures must regenerate byte-identically, so the verifier is
   checked against the current emulator rather than a frozen artefact. Contracts holding value
   must clear a coverage floor. Every one of those gates was added after the corresponding
   drift was found, and each is verified to fail when it should.

---

## 6. Current limitations

Stated first, in full, because a reviewer will find them anyway.

1. **No fault proof over KAURAX execution.** Output roots are accepted because the proposer
   key signed them. Nothing verifies they correspond to any execution.
2. **The guardian is the final arbiter.** A contested dispute is decided by a 2-of-3
   multisig. It cannot be removed before a verifier exists — something must decide.
3. **No external audit.** An internal review by the author of the code is the weakest kind.
4. **One sequencer, no rotation.** Reordering and delay, bounded by forced inclusion.
5. **Operator keys are local on the devnet.** The signing service is built and tested; it is
   not in use.
6. **No TLS on the public RPC.** The host blocks 80/443 on trial accounts — proven, not
   assumed.
7. **The verifier covers a subset no real contract stays inside.** No `CALL`, `CREATE`, `LOG`
   or environment opcodes.

Self-assessed mainnet readiness: **52/100** ([scorecard](../MAINNET_READINESS.md)), with
fault proofs and audit — 30 of the 100 — both at zero.

---

## 7. Security model

**Trustless today:** data availability, deposit derivation, forced inclusion, withdrawal
proofs.

**Trusted today:** output roots, dispute resolution, transaction ordering.

The honest formulation, which should be quoted rather than paraphrased:

> *Funds are safe if at least one honest party challenges a bad state commitment **and** the
> guardian rules correctly.*

A fault proof would remove the second clause. That is the entire security argument for
funding this work.

Full model: [SECURITY_STATUS.md](SECURITY_STATUS.md) ·
[THREAT_MODEL.md](THREAT_MODEL.md) · [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md)

---

## 8. Testnet evidence

One command, from a clean clone, ~15 minutes:

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git && cd kaurax
pnpm install && ./tests/reproduce.sh
```

It builds, starts a three-layer devnet, runs every suite, stops the devnet, and prints which
claims held. CI runs the same thing on a fresh `ubuntu-latest` runner on every push, which is
the answer to "does this only work on the author's machine?".

What it does **not** establish is set out in the same document: nothing verified a disputed
root was *wrong* — the proposer conceded by walking away — and the L1 and L2 underneath are
`anvil`, not real chains.

---

## 9. Roadmap

Milestones, dependencies and per-milestone acceptance criteria:
[grants/MILESTONES.md](grants/MILESTONES.md). The engineering distance is measured against
the code in [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md).

| | Milestone | Effort |
|---|---|---|
| M1 | Pin and specify the state transition function; differential tests | 1–2 |
| M2 | Adopt a proving VM; generate traces | 3–6 |
| M3 | Trace commitments | within M2 |
| M4 | Preimage oracle | 1 |
| M5 | **One-step verifier over the full EVM** | 6–12 |
| M6 | Trace bisection; challenger agent; advisory operation | 1–2 |
| M7 | Audit remediation (engineering side) | 2–4 |
| | **Total engineering** | **18–30 engineer-months** |

M5 is over a third of the work and carries most of the risk. A proposal sizing it below six
engineer-months would not be credible.

The blocker is **M2**, and it is structural rather than laborious: KAURAX's state transition
function is `anvil` reached over JSON-RPC. It cannot emit a per-instruction trace and cannot
be re-executed one step at a time, so there is nothing for a verifier to check. Every later
milestone waits on replacing it.

---

## 10. Required engineering resources

| Role | Commitment | Why |
|---|---|---|
| Protocol engineer (proof systems) | 1 FTE, 18–24 months | M2 and M5. The scarce skill |
| Protocol engineer (contracts, node) | 1 FTE, 12–18 months | M3, M4, M6, and keeping the chain running |
| Part-time security review | ~0.25 FTE | Adversarial tests written by someone who did not write the code |
| External audit | fixed engagement | M7 |

Effort is stated in engineer-months rather than currency deliberately. A currency total would
require quoting rates for a team that is not yet hired; that number would be invented, and
inventing numbers is what the rest of this repository exists not to do. Cost is a function of
the funder's region and rate assumptions and is best filled in jointly.
[grants/BUDGET.md](grants/BUDGET.md) holds the breakdown.

---

## 11. What funding would specifically pay for

In priority order. Each has an acceptance criterion a third party can check without trusting
us — that constraint is what shaped the list.

1. **Replacing the execution engine with something provable (M2).** The single blocker.
   *Done when:* a KAURAX block re-executes deterministically inside an instrumentable VM and
   emits a trace whose commitment a third party can reproduce from published data.

2. **A one-step verifier over the full EVM (M5).** Calls, creates, logs, environment
   opcodes, precompiles, dynamic gas.
   *Done when:* the differential rig covers the full instruction set against a second
   implementation, and the fixtures regenerate byte-identically — the gate that already
   exists for the subset.

3. **Preimage oracle (M4)**, with its own timeout and griefing analysis.
   *Done when:* a step proof for a large contract resolves without exceeding the block gas
   limit.

4. **Wiring the verifier to settlement (M6, M7).** Commit a trace root in the output root and
   replace `resolve` with `proveStep`.
   *Done when:* `isFaultProof()` returns `true` **and** a dispute is decided on chain with no
   guardian transaction — demonstrated the way `tests/dispute.sh` demonstrates the current
   game.

5. **An external audit**, ring-fenced so it is not reallocated when engineering runs long —
   which is exactly when it gets reallocated.
   *Done when:* a published report exists and its findings are closed or accepted in writing.

6. **The operational gap**: operator keys onto the signing service, TLS, and an Alertmanager
   so the alert rules that already exist reach a human.

**What funding would not pay for.** Sequencer decentralisation is deliberately excluded until
fault proofs exist. Distributing block production while nobody can prove a block wrong spreads
the ability to lie rather than removing it, and it would produce the appearance of
decentralisation, which is worse than its acknowledged absence.

---

## 12. What we will not claim

Binding, and the reason this document can be checked against the repository:

- Never that KAURAX has fault proofs, or that the dispute game is one.
- Never that KAURAX is production or mainnet secure without an external audit.
- No invented users, TVL, revenue, uptime, partnerships, investors or audits.
- No tokenomics, and no monetary value for KAX.
- No test count that has not just been produced by running the suite — enforced by
  `tests/check-doc-counts.sh` in CI.
