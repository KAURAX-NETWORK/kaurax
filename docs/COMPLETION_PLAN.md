# KAURAX — Completion Plan

Derived from [COMPLETE_SYSTEM_AUDIT.md](COMPLETE_SYSTEM_AUDIT.md). Written before any code
was changed.

## Two constraints that shape the whole plan

**The state transition function is `anvil`** (finding A-2). No amount of work in this
repository makes KAURAX's own execution provable. Phases 4 and 5 were completed in a previous
session against a documented EVM subset and are deliberately unwired from settlement; they
will be verified, not redone, and no phase may upgrade the claim.

**`docs/` already holds 47 files** and test counts have drifted three times (A-6). Where a
target document has an existing equivalent, the plan **extends that file** rather than adding
a near-duplicate, and adds CI gates so the drift stops.

## Order and content

| Phase | Work | Kind |
|---|---|---|
| 1 | Verify every documented command from a clean state; fix what is broken | Code + docs |
| 2 | Fix A-1 (false `op-geth` claim), A-5 (nginx protocol), correct stale finding evidence. No severity downgrades | Code |
| 3 | Replace the 6-line `THREAT_MODEL.md` pointer with a real threat model covering the 11 adversaries the brief names | Docs |
| 4–5 | Verify the existing fault-proof work still holds; **no new claims** | Verify |
| 6 | Adversarial coverage map; add the missing cases; keep suites where they are rather than fragmenting into new directories | Code |
| 7 | Run everything; report what is untested | Code + docs |
| 8 | Deploy monitoring (A-4); run the chaos suite against the live stack | Infra |
| 9 | `CODE_OF_CONDUCT.md`, operator and developer guides | Docs |
| 10 | `examples/` — runnable, tested against the live chain | Code |
| 11 | Issue templates, PR template | Docs |
| 12 | Decentralization roadmap with honest stage gates | Docs |
| 13 | `MONITORING.md` — thresholds tied to metrics that actually exist | Docs |
| 14 | **Measure** TPS, latency, DA cost, gas. No figure that was not observed | Code + docs |
| 15–16 | Grant and funding packages — extend, do not duplicate | Docs |
| 17–18 | Mainnet checklist with hard gates; audit package | Docs |
| 19–20 | Scored readiness with evidence per row; clean-clone release gate | Verify |

## CI gates added along the way

- documented test counts compared against actual output (A-6)
- KVS fixture determinism (A-7)
- example projects built and run

## Rules held throughout

No severity is reduced to improve a score. No component is called trustless, permissionless
or fault-proven unless the code makes it so. Anything that cannot be safely implemented is
marked **NOT IMPLEMENTED** with the reason, the dependency and the risk.
