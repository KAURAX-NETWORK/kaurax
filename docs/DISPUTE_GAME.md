# KAURAX — Permissionless Dispute Game

**Status: IMPLEMENTED and TESTED.** 52 tests — 41 in `test/DisputeGame.t.sol` and 11 in
`test/DisputeGameAdversarial.t.sol`.

**This is not a fault proof.** It narrows a disagreement to one block and hands that block
to the guardian. The guardian decides. There is no on-chain verifier, and
`isFaultProof()` on the contract returns `false` so that anything reading it on chain gets
the same answer this document gives.

---

## What it changes

Before: `deleteL2Outputs` was `onlyChallenger`, a single key. If that key was absent,
captured, or simply not watching, a wrong output root went unchallenged. If it was
malicious, it could delete honest ones.

After:

| | Before | After |
|---|---|---|
| Who can object | one key | anyone with a bond |
| Cost of a false objection | none | the challenger's bond |
| Cost of defending a lie | none | the proposer's bond |
| What the arbiter examines | an entire range, on trust | one block, on chain |
| Record of the disagreement | none | every move, with events |

The guardian is still the final arbiter. What shrank is its job: from "believe someone about
a range of blocks" to "check one block", which is small enough to be checked in public and —
this is the point — small enough to be replaced by a verifier for exactly that step.

---

## The game

```
        challenge()                 defend()                bisect()
NONE ───────────────► PROPOSER_TURN ────────► CHALLENGER_TURN ────────┐
                            ▲                                          │
                            └──────────────────────────────────────────┘
                                    range still > 1 block

                            range == 1 block
                                    │
                                    ▼
                          AWAITING_RESOLUTION
                                    │
              ┌─────────────────────┼─────────────────────┐
    resolve() │                     │ resolveTimeout()    │ resolveTimeout()
              ▼                     ▼                     ▼
  RESOLVED_PROPOSER_WINS   RESOLVED_TIMEOUT           CANCELLED
  RESOLVED_CHALLENGER_WINS                     (guardian did not act)
```

**Opening.** Anyone calls `challenge(outputIndex, proposer)` with the challenger bond. The
disputed range is the blocks that proposal commits to: from the block after the previous
proposal through this one's block.

**Bisection.** The proposer answers with its claimed state root at the midpoint. The
challenger says which half it still disputes. Repeat. A range of N blocks resolves in
⌈log₂ N⌉ exchanges — a 1000-block range takes 10.

**Resolution.** At one block, the guardian calls `resolve(gameId, challengerWasRight,
reason)`. The winner takes both bonds. A challenger win deletes the output root and
everything after it.

---

## Bond economics

| Parameter | Meaning |
|---|---|
| `CHALLENGER_BOND` | Staked to open a game. Lost if the challenge was wrong or abandoned |
| `PROPOSER_BOND` | Staked on the first defence. Lost if the claim was wrong or abandoned |
| `RESPONSE_TIMEOUT` | Time each side has to move. Must be shorter than the finalization period; the constructor enforces this |
| `MAX_GAME_DURATION` | Upper bound on a game's life |

The winner takes both bonds. That is the whole rule, and it is deliberately symmetric:
frivolous challenges cost the challenger, and indefensible proposals cost the proposer.

**Sizing.** The proposer bond should exceed what a proposer gains from a false root — in
practice, the value withdrawable against it. The challenger bond should be high enough that
spamming games is expensive and low enough that an ordinary user can object. These are
deployment parameters, not constants, because the right values depend on what the chain
carries.

**Accounting.** Verified by test, not assertion:

- the contract holds nothing after any terminal state (four tests, one per path)
- no value is created or destroyed across arbitrary sequences (`testFuzz_bondsConserved`)
- the settled flag is written before any transfer, so a re-entrant winner cannot settle
  twice (`test_reentrantWinnerCannotSettleTwice`, using a contract that actually tries)
- a payout that cannot be delivered reverts rather than being swallowed
  (`test_failedPayoutRevertsRatherThanStrandingFunds`)

---

## Abandonment and timeouts

`resolveTimeout` is permissionless on purpose. If only the winner could call it, an
abandoning proposer could leave the challenger's bond locked forever by never touching the
game again. Who wins is decided by whose turn had lapsed, not by who made the call —
`test_timeoutWinnerDoesNotDependOnCaller`.

| Whose turn lapsed | Outcome |
|---|---|
| Proposer | Challenger wins; the output root is deleted. A proposer that will not defend its own claim has conceded it |
| Challenger | Proposer wins; the claim stands |
| Guardian | **Both bonds returned.** Nobody is slashed |

That last row matters. Slashing a party for the guardian's inaction would punish someone
for something outside their control, and awarding a win on the same basis would let the
guardian decide outcomes by staying silent — which is worse than deciding them openly.

---

## Known limitations

Stated plainly, because each is a real weakness.

**1. The guardian is trusted.** It decides every narrowed game. It cannot rewrite history —
the oracle refuses to delete a finalized output — but within the window it decides who was
right. This is the fault-proof gap and nothing here closes it.

**2. Bisection reaches a block, not an instruction.** A real fault proof narrows to one
instruction and executes it on chain. Doing that needs execution trace commitments, which do
not exist. See [FAULT_PROOF_SPEC.md](FAULT_PROOF_SPEC.md).

**3. ~~A dispute can outlive the finalization window.~~ FIXED.** `isOutputFinalized` now asks
the game whether a dispute is live, and the portal refuses to finalize a withdrawal against
an output that is not settled. So the window cannot close underneath a game being played,
and a challenger who wins does not find the funds already gone. Verified by
`test_liveGameHoldsFinalizationOpenPastTheTimer` and
`test_settlingTheGameReleasesFinalization` — both halves, because holding the window open
without releasing it would freeze an output forever.

The `DisputeOutlivedFinalization` path remains for deployments where the oracle has no game
wired in, where finalization is still the timer alone.

**4. ~~The proposer bonds on its first move.~~ FIXED.** The oracle escrows `PROPOSER_BOND`
at proposal time, so a root carries risk from the moment it is committed. On a challenger
win the escrow is forfeited to them; proposals deleted as collateral are refunded to their
proposers, because they were never adjudicated. The proposer reclaims its escrow once the
output finalizes.

A consequence worth naming: the challenger no longer names the proposer. It is read from the
oracle, which recorded it. Previously a challenger could bind an arbitrary address to a game
it had no reason to watch.

**5. One live game per output.** Necessary — otherwise one attacker bond forces the proposer
to defend many games at once and lose on whichever it cannot reach
(`test_cannotOpenParallelGamesOnOneOutput`). The cost is that a challenger who opens a game
and abandons it delays the next challenger by one timeout period.

---

## Roadmap

1. ~~Oracle refuses to finalize an output with a live dispute~~ — done
2. ~~Proposer bond escrowed at proposal time~~ — done
3. Trace commitments, so bisection reaches an instruction (limitation 2)
4. One-step verifier, replacing `resolve` (limitation 1)

Step 4 is the only one that makes KAURAX trustless, and it is the largest.
