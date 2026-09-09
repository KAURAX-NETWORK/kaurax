# KAURAX — Reproducible Testnet Demo

**For an external engineer who wants to check the claims rather than read them.**

Every claim KAURAX makes is below, paired with the exact command that demonstrates it and the
output that command produces. Nothing here needs an account, a key, a faucet, or anything from
the KAURAX team. It runs entirely on your machine.

If a command below does not produce what this page says it produces, the page is wrong and
that is a bug — please [report it](../SECURITY.md).

---

## Prerequisites

| | |
|---|---|
| Node.js | 20 or newer |
| pnpm | 10.28.0 (`corepack enable`) |
| Foundry | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

Foundry supplies `anvil`, `forge` and `cast`. The devnet uses `anvil` as a local stand-in for
both Ethereum and the underlying L2 — those two layers are simulated; **KAURAX itself is not**.
The sequencer, derivation pipeline, batcher, proposer and settlement contracts are the real
implementations.

---

## The whole thing, in one command

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git && cd kaurax
pnpm install
./tests/reproduce.sh
```

`reproduce.sh` builds, starts a three-layer devnet, runs every suite in order, and stops the
devnet whether or not it succeeded. Expect **10–15 minutes**. It prints a summary table at the
end; a non-zero exit means something below is not true.

Prefer to drive it yourself? Everything it runs is in the table below, and each line is a
command you can run on its own once `./infra/scripts/devnet/start.sh` has completed.

---

## What each claim costs to verify

| # | Claim | Command | What proves it |
|---|---|---|---|
| 1 | Contracts behave as specified | `cd blockchain/contracts && forge test` | **385 passed**, 23 suites |
| 2 | Node and services behave as specified | `pnpm test` | **186 passed**, 29 tasks |
| 3 | The verifier agrees with the reference emulator | `./tests/check-kvs-fixtures.sh` | Fixtures regenerate byte-identically, so the 404 differential cases are checked against the *current* emulator |
| 4 | Documented numbers match reality | `./tests/check-doc-counts.sh` | Every count in every document equals what the suites report |
| 5 | The chain runs, end to end | `./tests/acceptance.sh` | **47 checks**: execution, batching, DA, withdrawal, replay protection |
| 6 | **Data is available** | (in `acceptance.sh`, step 8) | A sent transaction is rebuilt from L2 calldata alone and its hash matched |
| 7 | **The dispute game works** | `./tests/dispute.sh` | **23 checks** against deployed contracts on a live chain |
| 8 | Censorship halts settlement | `./tests/forced-inclusion.sh` | An ignored forced transaction makes the oracle reject proposals |
| 9 | The application contracts work | `./tests/apps-smoke.sh` | **45 checks** — AMM, names, launchpad |
| 10 | The node survives failure | `./tests/chaos.sh` | SIGSTOP/SIGKILL fault injection, 10 scenarios |
| 11 | The devnet is restartable | `stop.sh && start.sh` | A second run works, which is where most devnets break |

---

## The two claims worth checking first

If you have ten minutes rather than an hour, check these. They are the two properties KAURAX
rests on that do not depend on trusting the operator.

### Data availability — can anyone rebuild the chain?

```bash
./infra/scripts/devnet/start.sh
./tests/acceptance.sh
```

Step 8 does the only thing that settles the question. It takes **nothing but the L2**, pulls
the batch calldata out of the `submitBatch` transaction, decompresses it, decodes it into L3
blocks, recomputes `keccak256` of each raw transaction, and looks for the one it sent:

```
8. Data availability: recover the transaction from L2 calldata
  PASS  batch L2 transaction calls submitBatch
  PASS  on-chain commitment matches the published bytes
  PASS  batch payload carries the KAURAX format version version 0
  PASS  batch decodes to L3 blocks 6 blocks
  PASS  a batch covering the transaction's block exists on the L2
  PASS  the sent transaction is recoverable from L2 data alone  6 transactions recovered
```

The KAURAX node is not consulted. If the operator vanished, the data would still be there.

### The dispute game — can a stranger delete a bad root?

```bash
./tests/dispute.sh
```

A challenger holding no role opens a game against a real output root, the proposer answers,
the challenger bisects, and the disputed range halves. Then the clock runs out on a proposer
that will not defend its own claim:

```
3. Dispute progression — each move halves the disputed range
  PASS  the disputed range narrowed  11 -> 5 blocks

4. The finalization interlock — a live dispute outranks the clock
  PASS  the output is not finalized while the window is open
  PASS  it is STILL not finalized, because a game is live

5. Invalid state commitment rejection — the root is deleted
  PASS  the game resolves on the clock, with no guardian involved
  PASS  the disputed output root was deleted from the oracle  nextOutputIndex 6 -> 5

6. Bond settlement
  PASS  the game contract holds nothing afterwards  0 KAX
```

**No guardian is involved in that run**, and that is the point. The timeout path is the part
of this mechanism that is genuinely trustless today. Watch the node afterwards and it
re-proposes on its own — `nextOutputIndex` climbs back without anyone intervening.

---

## What this demo does **not** show

Read this section before quoting any of the above.

1. **It does not show that anything verified the root was wrong.** In the dispute run the
   proposer *conceded by walking away*. A claim that is actually contested reaches the
   guardian — a 2-of-3 multisig — and the guardian decides. Only a fault proof removes that,
   and KAURAX does not have one over its own execution.
   See [FAULT_PROOF_GAP_ANALYSIS.md](FAULT_PROOF_GAP_ANALYSIS.md).

2. **It does not show KAURAX is secure.** There has been no external audit. Passing tests are
   evidence of intent, not of correctness.

3. **The L1 and L2 are `anvil`, not real chains.** They have no consensus layer and their
   clocks can be advanced, which the tests do deliberately so a 120-second window can be
   crossed in seconds. KAURAX's own components are real; the layers underneath it, in this
   demo, are not.

4. **The one-step verifier that the fixtures check is not connected to settlement.** It covers
   a documented EVM subset, and KAURAX blocks do not execute on that subset. Check 3 above
   proves the Solidity verifier agrees with the reference emulator. It says nothing about
   KAURAX blocks.

5. **A passing `chaos.sh` is not an availability guarantee.** It injects the failures we
   thought of.

---

## If something fails

| Symptom | Cause |
|---|---|
| `port 8420 … is already held by pid N` | An orphaned node from a previous run. `stop.sh` only kills what its pid files name. The message prints the exact recovery commands |
| `forge: command not found` | Foundry is not installed, or not on `PATH` for this shell |
| `Cannot find module '@kaurax/…'` | A workspace dependency was not built. Use `pnpm turbo run build --filter=…`, never `pnpm --filter … build`, which builds only the named package |
| The acceptance test hangs at step 7 | The batcher has not published yet. It waits up to 120s; if it never arrives, check `.devnet/kaurax-node.log` |
| `dispute.sh` says the addresses are unset | The devnet was started before the dispute game was added. Re-run `start.sh` |

Logs for every component are in `.devnet/`.

---

## Reproducing on a clean machine

CI runs exactly this on every push to `main`, on a fresh `ubuntu-latest` runner with nothing
cached: `.github/workflows/ci.yml`, job **devnet end-to-end**. If you want to see the output
of a run you did not perform yourself, that is the place to look — and it is also the answer
to "does this only work on the author's laptop?".
