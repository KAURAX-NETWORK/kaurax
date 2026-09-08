# KAURAX — Impact

## Usage metrics

| Metric | Value |
|---|---|
| Total value locked | No data available |
| Unique users | No data available |
| Daily transactions | No data available |
| Bridged assets | No data available |
| Partners | No data available |
| Investors | No data available |
| External audits | None |

KAURAX is an experimental testnet with no production usage. Nothing above is withheld — the
numbers do not exist, and this project does not report numbers that do not exist.

**A funder evaluating KAURAX on adoption should stop here.** The case below is an engineering
one.

---

## What is actually verifiable today

| Claim | How to check it yourself |
|---|---|
| The chain produces blocks | `curl` the public RPC at https://kaurax.network/rpc |
| Data availability is real | `tests/acceptance.ts` rebuilds a signed transaction from L2 calldata alone |
| Forced inclusion works | Force a transaction; settlement halts until it is included, then resumes |
| The dispute game runs | Play one on the testnet; bonds, bisection and resolution execute |
| 499 tests pass | `forge test` (322), `pnpm test` (165), `tests/e2e-testnet.sh` (12) |
| Builds are reproducible | [../REPRODUCIBLE_BUILD.md](../REPRODUCIBLE_BUILD.md) |

Every row is a command, not an assertion.

---

## The output that outlives KAURAX

The deliverables are not KAURAX-specific:

**A second independent one-step verifier.** Very few exist. Cannon and WAVM are the
production examples, both from large well-funded teams. A third implementation, MIT-licensed
and independently derived, is worth something to the ecosystem regardless of whether KAURAX
itself sees usage — a bug class found in one implementation is checkable against the others.

**A differential test harness for EVM-equivalent STFs.** Reusable by any L2 or L3 that wants
to know whether its execution client agrees with a reference.

**A preimage oracle and trace commitment scheme.** Standard components with few open
reference implementations.

**A written record of a small team building this.** Existing fault proof work comes from teams
of a size most projects do not have. What is genuinely hard, what is merely tedious, and where
a smaller team hits a wall is not currently documented anywhere. It will be here — including
the parts that fail.

---

## Impact on how rollups describe themselves

There is a second, softer contribution, and it is deliberate.

KAURAX's README says, above its feature list, that it has no fault proof system. Its
`resolutionMechanism()` returns the string "guardian multisig; no on-chain one-step verifier
exists". Its own mainnet readiness assessment is **52/100**, published with per-row evidence.
Its `isFaultProof()` returns `false` — on chain, permanently, where a would-be integrator can
read it.

That is not the norm. Rollups with guardian-decided disputes routinely describe themselves as
having fault proofs. The gap between what a system's contracts do and what its landing page
says is a real user-safety problem, and the counter-example is cheap to produce: state the
limitation in the place a reader will actually hit it.

If KAURAX is useful for nothing else, it is a worked example of a rollup that documents its
own trust assumptions accurately while asking for money.

---

## Risks

**The verifier may not be completed.** M5 is 6–12 engineer-months of the hardest category of
smart contract work. It might overrun or fail. [MILESTONES.md](MILESTONES.md) is staged so a
funder is not exposed to that in one commitment, and [BUDGET.md](BUDGET.md) lists what remains
reusable at each stopping point.

**A verifier bug is worse than no verifier.** A wrong verifier lets an *honest* proposer lose
their bond and their correct output root. This is why M6 runs advisory beside the guardian
rather than cutting over, and why M7 is an audit before the guardian path is removed.

**KAURAX may never see adoption.** Entirely possible. The reusable outputs above do not depend
on it.
