# Why KAURAX

## 1. The problem

Applications on shared blockspace compete with unrelated traffic. A mint raises your users'
fees; a popular game delays your settlement. You cannot price, schedule or reason about
blockspace you do not control.

An application-specific chain fixes that and usually creates a worse problem: it bootstraps
its own validator set and inherits nothing. You have traded contention for a security budget
you must fund yourself.

## 2. Why L3

A Layer-3 keeps its own blockspace while settling to a Layer-2 and publishing its data
there. Done properly you get application-specific execution without a new trust network.

"Done properly" is the load-bearing phrase. Many chains called L3s are a chain plus a bridge
plus a landing page: the settlement contract accepts whatever the operator sends, the data is
not really published, and the exit is a multisig. The label is architectural; the security is
not automatic.

## 3. Why Ethereum

Because the failure mode of an application chain is that its users cannot leave. Settling to
an L2 that settles to Ethereum means the exit path is anchored in something the operator does
not control — provided data availability and forced inclusion are real.

Those two are what KAURAX built first, and they are the two it verifies rather than asserts.

## 4. What is technically different

Not novelty. KAURAX's difference is that the unglamorous properties are actually finished
and tested:

- **Data availability is verified by reconstruction.** `tests/acceptance.ts` rebuilds a
  signed transaction from L2 calldata alone and checks its hash. Not "we post batches" — a
  test that fails if the claim stops being true.
- **Forced inclusion has teeth and they have been used.** On a live chain: a transaction was
  forced, ignored, the deadline passed, and every output proposal was rejected until it was
  included. Censoring one user halts settlement for everyone.
- **Disputes are permissionless and bonded.** Anyone can challenge a state commitment;
  bisection narrows to a single block on chain.
- **The gaps are documented as prominently as the features.** `isFaultProof()` returns
  `false` and there is a test asserting it.

## 5. What works today

EVM-equivalent execution. Real settlement contracts. Data availability verified by
reconstruction. Deposits derived from L2 events. Forced inclusion verified live.
Proof-based withdrawals. A bonded dispute game with bisection. Governance holding every
privileged role. Wallet, CLI, faucet, explorer, indexer, API. 499 automated tests.

## 6. What does not work today

**No fault proof system.** No one-step verifier, no proving VM, no trace commitments, no
preimage oracle. Output roots are accepted because the proposer signed them.

Also absent: decentralized sequencing, an external audit, TLS on the public RPC, and an
active production signing service.

## 7. Why fault proofs are the key next step

The honest summary of KAURAX's security is:

> Funds are safe if at least one honest party challenges a bad output root **and** the
> guardian rules correctly.

The first clause is already trustless — challenging is permissionless and bonded. The second
is a 2-of-3 multisig. A fault proof replaces that clause with a contract executing one
disputed instruction and deciding from the result.

Everything else on the roadmap is smaller than this, and most of it is worth less without it.
Decentralising the sequencer while nobody can prove a block wrong distributes the ability to
lie rather than removing it.

## 8. Why ecosystem funding

Fault proof systems are expensive, slow, and produce no user-visible feature. They are
exactly the kind of work that does not get funded by revenue and does get skipped by projects
under commercial pressure — which is why so many chains ship with a multisig exit and a
roadmap.

KAURAX is asking for the unglamorous half to be funded so it does not get skipped. The
estimate in this repository is 18–30 engineer-months before an audit, and it is labelled an
estimate because nobody knows precisely.

The work is also reusable. A verifier, trace commitments and a preimage oracle for an
EVM-equivalent L3 are not KAURAX-specific.

## 9. What becomes possible afterwards

Withdrawals that do not depend on anyone's honesty. A guardian reduced to pausing. Sequencer
decentralization that means something, because block production can be distributed once
blocks can be proven wrong. And an application-specific chain that a developer can adopt
without asking users to trust its operator.

## 10. Why this is public-goods infrastructure

MIT licensed, public repository, public testnet, no token sale and no tokenomics in any
document here. KAX is a testnet gas token with no monetary value.

The documentation is written so that someone can find the weaknesses without running the
code: three HIGH security findings are open and listed, the readiness score is 52/100 and
published, and two production outages caused by the team are written up in the security
review.

A project that maps its gaps is easier to build on, and easier to fund responsibly, than one
that hides them.
