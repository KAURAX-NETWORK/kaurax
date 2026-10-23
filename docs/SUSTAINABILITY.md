# Sustainability

How KAURAX intends to keep existing, stated without the parts that are not true yet.

---

## 1. The honest position

KAURAX has **no revenue**. Its gas token has no monetary value, by design and by
declaration, so the fee accounting added in [PROTOCOL_FEES.md](PROTOCOL_FEES.md) measures a
quantity that is currently worth nothing.

It also has **no users to speak of**, and [`/api/adoption`](../services/api/src/routes/adoption.ts)
exists specifically so that this stays visible rather than being obscured by faucet traffic.

The project is **one operator's unpaid work plus roughly €20–40/month of hosting**
([OPERATING_COSTS.md](OPERATING_COSTS.md)). That is the whole current model, and it is a
model with an obvious failure mode: it ends when the operator stops.

Everything below is about reducing that fragility. None of it is in place.

---

## 2. What sustainability does not mean here

Ruled out explicitly, because each is the usual answer and each would be worse than the
problem:

**A token sale.** KAX has no monetary value and none is planned in this repository. A
project that funds itself by selling a token for a network that does not work yet has
inverted the order of its obligations. No milestone in
[`docs/grants/MILESTONES.md`](grants/MILESTONES.md) depends on a token existing.

**Paid access to basic developer functionality.** The RPC, explorer, faucet, SDK, CLI and
documentation stay free. Rate limits and abuse protection are the correct tool for cost
control; a paywall on the chain's own RPC would defeat the point of building a chain.

**Transaction incentives.** Paying for transactions buys activity that stops the day the
payment stops, and in the interim it destroys the only signal that would tell you whether
anyone wants the thing. `/api/adoption` is built to exclude exactly this kind of traffic;
generating it would be lying to the project's own instruments.

**Claiming decentralisation that is not implemented.** One sequencer, no fault proof. Both
are in the README, and neither will quietly disappear from it.

---

## 3. What could actually fund it

In descending order of how plausible it is.

### Grants — the realistic path

Public-goods infrastructure with no revenue model is what ecosystem grant programmes are
for. The material exists:
[`docs/grants/TECHNICAL_PROPOSAL.md`](grants/TECHNICAL_PROPOSAL.md),
[`BUDGET.md`](grants/BUDGET.md), [`MILESTONES.md`](grants/MILESTONES.md),
[`IMPACT.md`](grants/IMPACT.md).

The strongest case is not KAURAX itself. It is that the **fault-proof gap is documented
with unusual precision** ([FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md)),
including a working one-step verifier that is deliberately *not* wired to settlement
because the chain does not run on the subset it verifies. That honesty is reusable by
anyone building an L3, and is worth more to the ecosystem than another testnet.

**No grant has been applied for, offered or received.** No application is implied to
succeed.

### Protocol fees — real mechanism, no value behind it

The mechanism now exists and is tested. What it collects is denominated in a valueless
asset. If KAURAX ever carried real economic activity, this is the path — but the ordering
matters and is not negotiable: a treasury holding value needs a multisig and an audit
*first* ([PROTOCOL_FEES.md](PROTOCOL_FEES.md) §7).

### Application fees — exists, earns nothing

`KauraxNames` charges for registration and forwards to a treasury address. Working,
tested, and earning nothing, for the same reason.

### Shared operation — reduces cost rather than raising money

Community-run RPC replicas would cut bandwidth and improve availability.
[NODE_OPERATOR_GUIDE.md](NODE_OPERATOR_GUIDE.md) documents the procedure.

**An RPC replica is not a validator.** It serves reads. It does not participate in
consensus, because there is no consensus to participate in — KAURAX is a rollup with one
sequencer. The guide says this where an operator will read it.

---

## 4. Cost discipline

The cheapest infrastructure is the infrastructure that is not needed:

- Static frontends on free hosting, which they genuinely fit.
- Caching and rate limiting at nginx, before any request reaches the node.
- One VPS, not a cluster. KAURAX's load does not justify a second machine, and running one
  for appearances would be a cost with no corresponding benefit.
- No paid observability: Prometheus and Grafana self-hosted.
- No paid RPC provider: KAURAX *is* the RPC provider.

The limits of this are in [OPERATING_COSTS.md](OPERATING_COSTS.md) §5. The largest
recurring cost — L2 gas for batches and output roots — is **not currently measured**, so
the discipline above is applied to the costs that are visible, not necessarily to the
largest ones.

---

## 5. If funding does not arrive

The failure mode should be stated, because projects that have not thought about it tend to
fail messily:

- **The code outlives the deployment.** MIT licensed, reproducible build
  ([REPRODUCIBILITY.md](REPRODUCIBILITY.md)), devnet in one command. The work is not lost
  if the server is switched off.
- **The honest documentation is itself the artefact.** The gap analysis and the dispute
  game write-up are useful to other projects whether or not KAURAX continues.
- **Shutdown would be announced**, not silent. A testnet that stops answering without
  notice is worse than one that stops.

---

## 6. What would have to be true to call this sustainable

None of these hold today:

1. More than one person can operate the network. *(Not true — one operator, undocumented
   bus factor.)*
2. Costs are measured rather than estimated. *(Not true — L2 gas is unmetered.)*
3. There is activity that did not come from the faucet. *(Measurable now via
   `/api/adoption`; currently near zero.)*
4. Funding covers at least the hosting. *(Not true — it is personally absorbed.)*
5. The security model does not require trusting one key. *(Not true — no fault proof.)*

Item 5 is 18–30 engineer-months and is the one that matters most.
