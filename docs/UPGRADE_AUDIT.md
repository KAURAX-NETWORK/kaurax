# KAURAX — upgrade audit

**Date:** 2026-10-19
**Scope:** the repository as it stood at commit `379842e`, read before anything was changed.
**Method:** source and configuration were read directly; behavioural claims were measured
against a running engine rather than inferred. Where a claim here is measured, the
measurement is given.

This document records what was found. What was changed in response is §6.

---

## 1. What KAURAX is, as built

An application-focused Ethereum **Layer-3**. It sequences its own EVM blocks, publishes
each as calldata to an underlying Layer-2, and commits output roots to contracts there.

- **Not** a fork, **not** a frontend over someone else's chain.
- **No validators and no consensus.** It is a rollup; ordering is one sequencer's.
- Current reality: a **local devnet and a single-operator public testnet**. KAX has no
  monetary value.

Component inventory, with per-contract status, is already accurate in
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md); this audit did not find it overstated and
does not restate it.

### Verified at the start of this work

| | |
|---|---|
| Contract tests | **385 passing**, 0 failed (`forge test`) |
| Node/app tests | **29 turbo tasks passing** (`pnpm turbo run test --force`) |
| Devnet | Starts clean and reaches "KAURAX is live" (`infra/scripts/devnet/start.sh`) |

Both suites were green **before** any change, and no test was modified, skipped or
weakened to keep them that way.

---

## 2. The repository's documentation is unusually honest

This matters to an audit, because the usual job — finding the gap between what a project
claims and what it has — was largely already done, in public, by the project itself.

Verified rather than assumed:

- `README.md` leads with "the sequencer is trusted", "there is no fault proof over KAURAX
  execution", "there has been no external audit", and a self-assessed **52/100**.
- `KauraxDisputeGame.isFaultProof()` returns `false`, and a test asserts it.
- `/api/analytics` returns `null` for values it cannot measure, and its header comment
  lists what KAURAX does not have — "TVL, user counts, partner counts, revenue".
- `blockchain/chain/config/testnet.json` carries `"status": "not-deployed"`.
- The faucet refuses to run on any profile that is not a devnet.

**No invented capability was found.** The instruction to distinguish implemented
functionality from placeholders found far less to correct than expected.

---

## 3. Findings

### 3.1 Gas fees were being destroyed, and nothing said so — CORRECTED

The most substantive finding.

KAURAX had **no fee accounting of any kind**. Grepping `treasury|feeVault|feeRecipient|coinbase`
across the whole tree returned five files: `KauraxNames.sol` (an application fee, §3.2), its
test, a deploy script, and two documents. Nothing in the node, the engine adapter, the
config package or the API touched gas fees.

The consequence was not neutral. Measured against `anvil 1.5.1` under the devnet's own
launch flags:

- the engine's default coinbase is **the zero address**;
- the EIP-1559 base fee is burned, as on Ethereum;
- the priority fee is credited to the coinbase — so it was **also destroyed**.

Measured directly: one 21,000-gas transfer at a 2 gwei priority fee over a 1 gwei base fee
credited exactly `42,000,000,000,000` wei to the coinbase and burned `21,000,000,000,000`.
With the coinbase at zero, both figures went nowhere.

On a testnet with a valueless token this cost nothing. As an architecture it meant the
project could not have said where its fees went, and there was no surface that would have
revealed it.

**Corrected** — see §6.1 and [PROTOCOL_FEES.md](PROTOCOL_FEES.md).

### 3.2 Application fees exist and are sound — NO CHANGE

`KauraxNames` charges for registration and forwards to a `treasury` address held in
contract state, with `setTreasury` access-controlled and 29 tests covering it including the
access control. `KauraxSwapPair` retains 0.3% of swap input **in the reserves for liquidity
providers** — no protocol cut.

Both were read and neither was changed. They are unrelated to gas fees and are not
aggregated with them.

### 3.3 A fee configuration block that nothing reads — DOCUMENTED, NOT WIRED

`blockchain/chain/config/testnet.json` contains a `fees` object specifying
`initialBaseFeeWei`, `minimumBaseFeeWei`, `baseFeeMaxChangeDenominator`,
`elasticityMultiplier` and an `l2DataFee` with a scalar and overhead.

Grepping each key across all TypeScript and Solidity returns **zero consumers**. The base
fee actually in force comes from `anvil --base-fee 1000000000` in the devnet start script.
The `l2DataFee` — the L1/L2 data cost that OP Stack chains charge users — is **not charged
at all**; the operator absorbs the entire cost of posting batches.

This is a placeholder in a file whose sibling keys are live, which is the kind of thing that
is read as implemented. It was **not wired up**: charging an L2 data fee changes what every
user pays and belongs behind its own design and test work, not inside a fee-accounting
change. It is recorded in the roadmap instead.

### 3.4 Rate limiting and abuse protection — ALREADY PRESENT

Checked against the instruction to add them; they were already there.

| Surface | Control |
|---|---|
| Nginx | `limit_req` 20 r/s RPC, 30 r/s API, per source address; `limit_conn` 24/32 |
| API | `@fastify/rate-limit`, 120/min default, health checks exempt |
| RPC body | capped at 10 MB, connection destroyed above it |
| Faucet | per-address **and** per-IP cooldown, in PostgreSQL so a restart does not reset it; fixed amount; refuses when low; devnet-only |
| CORS | explicit allowlist; `loadApiConfig` rejects `"*"` |

The faucet's serialisation of concurrent grants and its "record only after the transaction
succeeded" ordering are both correct and were left alone.

### 3.5 Administrative RPC exposure — ALREADY CONTROLLED

`anvil_`, `evm_`, `debug_`, `hardhat_`, `personal_`, `miner_`, `txpool_`, `admin_`,
`engine_` and `ots_` are blocked on both HTTP and WebSocket, the engine is bound to
loopback, and `infra/scripts/devnet/start.sh` **aborts the whole devnet** if the public RPC
is observed forwarding `anvil_setBalance`.

This mattered to §6.1: fee routing uses `anvil_setCoinbase`, an administrative method. It
is called on the internal engine endpoint only, and the existing block list already covers
it on the public one.

### 3.6 Adoption could only be measured in a way that flatters it — CORRECTED

`/api/analytics` reports total blocks, transactions, addresses and contracts. Each is
honestly counted and each is trivially inflated on a network with a faucet: a loop raises
all four.

Nothing excluded faucet grants, self-transfers or failed transactions, and nothing measured
whether an address came back on a second day. The brief for this work is explicit that
faucet claims and self-transfers must never count as adoption, and the data to exclude them
was already indexed — it simply was not being used.

**Corrected** — see §6.3.

### 3.7 Known gaps, re-verified and unchanged

Each was checked against the code and each is already disclosed in the README. None was
closed by this work, and none is newly introduced:

- **No fault proof over KAURAX execution.** The engine is `anvil` over JSON-RPC and cannot
  emit a per-instruction trace. Estimated 18–30 engineer-months.
- **Single sequencer.** Forced inclusion bounds the damage; it does not remove the trust.
- **No external audit.**
- **No TLS on the public RPC** — documented as a host restriction.
- **Operator keys** on the signing service built and tested, not in use in production.

---

## 4. What was deliberately not changed

- **The L2 data fee** (§3.3). It changes what users pay.
- **Anything in the dispute game, settlement or bridge.** Out of scope, well tested, and
  the kind of code where an unmotivated change is a net loss.
- **The existing analytics endpoint.** Its numbers are correct for an explorer. A second
  endpoint was added beside it rather than redefining what the first one means.
- **The 65 existing documents.** Several names the brief asked for already exist under
  different ones (`docs/grants/TECHNICAL_PROPOSAL.md`, `docs/grants/BUDGET.md`,
  `docs/SECURITY_MODEL.md`, `docs/NODE_OPERATOR_GUIDE.md`). Writing near-duplicates under
  the requested filenames would have made the documentation worse. [UPGRADE_ROADMAP.md](UPGRADE_ROADMAP.md)
  maps requested topics to the documents that already cover them.

---

## 5. Not done, and not safe to claim

- **No contract was deployed** and **no funds were moved**.
- **No external audit happened.** None is implied by any of this.
- **Nothing here makes KAURAX mainnet-ready.** The 52/100 self-assessment is unaffected:
  fault proofs and audit remain at zero, and they are 30 of the 100.
- The fee recipient is a **single externally-owned account**, not a multisig. It is not a
  treasury suitable for funds that matter. See [PROTOCOL_FEES.md](PROTOCOL_FEES.md) §7.

---

## 6. Changes made

### 6.1 Gas fees now have a named destination

- `KAURAX_FEE_RECIPIENT` (config, validated; the zero address is **rejected** because it is
  the default and would read as "collecting" while burning).
- `kaurax-node` sets the engine coinbase at startup, **before the first block is sealed**,
  then reads it back and compares — an engine that accepts the write and ignores it is the
  failure this guards against.
- Failure is loud and non-fatal: `error` log, `kaurax_feeStatus.recipient.applied: false`
  with a `problem` string, and metric `kaurax_fee_recipient_applied` = 0. **Alert on
  `configured == 1 && applied == 0`.**
- Unset preserves the previous behaviour exactly, with a warning saying fees are burned.

### 6.2 Fee accounting that cannot conflate burned with received

- `splitTransactionFee()` — base fee clamped to the effective gas price, so the two halves
  always sum to what was paid and neither can go negative.
- `GET /api/fees` and `/api/fees/daily` — `SUM` over indexed receipts joined to block
  headers. A transaction contributes to exactly one row, so double counting is structurally
  impossible rather than merely avoided. Indexed-block coverage is returned with the totals.
- **Net revenue is not computed anywhere.** Gross receipts are on chain; operating costs are
  invoices. Subtracting a hand-maintained number from an indexed one would lend the first
  the authority of the second. Both halves are published and labelled.

### 6.3 Adoption measured so it cannot be inflated

`GET /api/adoption` counts only transactions that **succeeded**, are **not faucet grants**
(excluded by recorded hash, not by sender address — which would also catch an operator
funding a contract) and are **not self-transfers**. An address is *returning* only if it
transacted on **two or more distinct days**.

It reports the raw totals alongside, and itemises exactly what was excluded, so the gap is
visible rather than taken on trust. It states in its own payload that an address is not a
person and that a patient bot is indistinguishable from adoption in this data.

### 6.4 Tests

- 17 new unit tests (`fee-accounting.test.ts`, `fee-recipient.test.ts`), including the
  silent-failure case where the engine accepts `anvil_setCoinbase` and ignores it.
- Acceptance step 12: on a running devnet, measures that the recipient gained **at least**
  this transaction's priority fee and **not** the burned base fee. Steps 1–11 were not
  renumbered, so existing references to "step 8" and "step 10" still resolve.
- The arithmetic constants in the unit tests were **measured** from a real anvil block, not
  derived from the implementation.

### 6.5 Documentation

[PROTOCOL_FEES.md](PROTOCOL_FEES.md) · [OPERATING_COSTS.md](OPERATING_COSTS.md) ·
[SUSTAINABILITY.md](SUSTAINABILITY.md) · [UPGRADE_ROADMAP.md](UPGRADE_ROADMAP.md) · this file.
