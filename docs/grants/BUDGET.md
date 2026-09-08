# KAURAX — Budget

## Note on figures

**This budget is denominated in engineer-months, not currency.**

A currency total would require quoting rates for a team that is not yet hired. Any number put
here would be invented, and inventing numbers is exactly what the rest of this repository
tries not to do. Effort is estimable from the work; cost is a function of the funder's
region, rate assumptions and duration, and is best filled in jointly.

Effort figures trace to [../FAULT_PROOF_ROADMAP.md §6](../FAULT_PROOF_ROADMAP.md).

---

## Engineering effort

| Milestone | Work | Effort (eng-months) | Risk |
|---|---|---|---|
| M1 | Pin and specify the STF; differential tests | 1–2 | Low |
| M2 | Proving VM; trace generation | 3–6 | Medium |
| M3 | Trace commitments | *(within M2)* | Medium |
| M4 | Preimage oracle | 1 | Low |
| M5 | One-step verifier | 6–12 | **High** |
| M6 | Trace bisection; challenger agent; advisory run | 3–5 | Medium |
| M7 | Audit remediation *(engineering side)* | 2–4 | Medium |
| | **Total engineering** | **16–30** | |

M5 is over a third of the work and carries most of the risk. A proposal that sized it below
6 engineer-months would not be credible.

---

## Non-engineering

| Item | Basis |
|---|---|
| External security audit | Quoted by the auditor once M6 code is frozen. Firms doing fault proof work are few and quote per engagement; a figure invented now would be wrong |
| Testnet infrastructure | One VPS today (~€20–40/month observed). Trace generation and a challenger agent raise this; the increase is not yet measurable |
| Differential fuzzing compute | Continuous during M5. Scales with campaign length; not yet measured |

**No figure is given for any of these**, for the same reason as above.

---

## Not requested

- Token launch, listing, or market making — **KAX has no monetary value and none is proposed**
- Marketing, growth, incentives, or user acquisition
- Business development or partnerships
- Salaries for roles not on the milestone list

---

## Staging

Funding by milestone rather than in one tranche, releasing on the acceptance tests in
[MILESTONES.md](MILESTONES.md). Two reasons, both in the funder's interest:

1. **M1 can fail informatively.** If differential testing finds the STF diverges, the correct
   response is to fix that first — and a funder should not be committed to M5 at that point.
2. **The verifier's scope is not fully known until M2 ships.** Sizing M5 precisely before the
   proving VM exists would be guesswork presented as a plan.

## What a funder gets if the work stops early

| Stopping after | Reusable output |
|---|---|
| M1 | An STF specification and differential harness — useful to any EVM-equivalent L2/L3 |
| M2 | An EVM state transition running on a proving VM, reproducibly |
| M4 | A preimage oracle, not KAURAX-specific |
| M5 | A one-step verifier — the piece the ecosystem has the fewest independent implementations of |

Every milestone is MIT-licensed and published on completion, including partial work.
