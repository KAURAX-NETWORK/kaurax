# KAURAX — Stack Decision

**Status:** Accepted
**Date:** 2026-09-07
**Scope:** Rollup framework selection for the KAURAX Ethereum Layer-3.

---

## 1. Position in the stack

```
Ethereum (L1)          settlement + data availability root of trust
      ▲
      │  (L2 posts batches + proofs to L1)
      │
Underlying rollup (L2) settlement layer for KAURAX
      ▲
      │  (KAURAX posts batches + output roots to L2)
      │
KAURAX (L3)            execution layer for applications
```

KAURAX is **not** an independent Layer-1. It has no independent validator set and no
independent consensus security. Its security derives from the underlying L2, which in turn
derives from Ethereum.

---

## 2. Decision

**KAURAX adopts the OP Stack (Bedrock architecture) as its rollup framework**, deployed as
an L3 whose settlement and data-availability target is a configurable OP Stack Layer-2.

Two run profiles are shipped:

| Profile | Execution client | Consensus/derivation | Settlement target | Runs today |
|---|---|---|---|---|
| `devnet` | `anvil` (revm) driven through an Engine adapter | `kaurax-node` (this repo) | Local L2 (anvil) with real KAURAX settlement contracts | **Yes**, no Docker/Go required |
| `testnet` | `op-geth` | `op-node` + `op-batcher` + `op-proposer` | Configurable public OP Stack L2 (default Base Sepolia) | Requires Docker; config generated, not yet operated |

Both profiles implement the **same component split** and the **same on-chain settlement
contracts**. `devnet` is not a simulation of settlement — it performs real contract calls
against a real EVM chain acting as the L2. What it does not have is a *public* L2 and
Ethereum underneath it. See [Limitations](#8-limitations).

---

## 3. Why OP Stack

1. **L3 support is first-class.** OP Stack chains can be configured with an arbitrary
   `l1` endpoint. Pointing that "L1" at an L2 (Base, OP Mainnet, Mode, …) is the standard
   way OP Stack L3s are deployed today. No fork of the derivation pipeline is required.
2. **EVM equivalence, not merely compatibility.** `op-geth` is a minimal diff on top of
   upstream `go-ethereum`. Solidity, `forge`, `hardhat`, MetaMask, and every standard
   JSON-RPC method work without adaptation.
3. **Canonical bridge exists and is audited.** `OptimismPortal` / `L1StandardBridge` /
   `L2StandardBridge` / `L2ToL1MessagePasser` are widely reviewed, heavily used
   production contracts. Rule: do not hand-roll a bridge. KAURAX uses this design.
4. **Permissive licensing.** OP Stack is MIT. Arbitrum Nitro is BUSL-1.1 with an Orbit
   licensing regime that constrains where and how a chain may be deployed.
5. **Modular DA.** The batcher target is an interface (`altda` / EIP-4844 / calldata),
   which lets KAURAX move DA without re-architecting execution.
6. **Operational maturity.** Pinned, versioned release artifacts exist for every component
   (verified against the live registries on 2026-09-07):
   - `op-node` **v1.19.5**
   - `op-batcher` **v1.16.13**
   - `op-proposer` **v1.16.4**
   - `op-geth` **v1.101702.3**

---

## 4. Alternatives considered

### Arbitrum Orbit
- **Pros:** Purpose-built for L3s ("Orbit chains settle to Arbitrum One/Nova"), mature
  Nitro stack, Stylus (Rust/WASM) contracts, native AnyTrust DA option.
- **Cons:** Nitro core is **BUSL-1.1**; Orbit deployment is governed by the Arbitrum
  Expansion Program, which imposes conditions on chains settling outside the Arbitrum
  ecosystem. Tooling is less portable, and the node is a single large Go binary that is
  harder to decompose for a staged, honest rollout.
- **Verdict:** Technically strong; rejected on licensing and operational-flexibility grounds.

### Polygon CDK
- **Pros:** ZK validity proofs, no 7-day withdrawal delay, AggLayer interoperability.
- **Cons:** L3/"layer-on-layer" deployments are less exercised than OP Stack's; prover
  infrastructure is a heavy operational and cost burden that is not justifiable for an
  early testnet; the contract surface changes faster.
- **Verdict:** Revisit for a future validity-proof migration, not for v0.

### zkSync ZK Stack (Hyperchains)
- **Pros:** Native AA, strong ZK story.
- **Cons:** Not EVM-equivalent (EVM-*compatible* via a different VM); some Solidity/tooling
  edge cases diverge. Conflicts with the EVM-equivalence requirement.
- **Verdict:** Rejected.

### Build a bespoke chain / fork go-ethereum
- **Verdict:** Rejected outright. That produces an L1 fork, not an L3. It has no settlement
  path to Ethereum and no credible security story.

---

## 5. Settlement architecture

KAURAX L3 → underlying L2:

| Concern | Mechanism | Contract (on L2) |
|---|---|---|
| Transaction data | Batcher posts compressed span batches | `KauraxBatchInbox` (EOA-style inbox + event log) |
| State commitments | Proposer posts output roots on an interval | `KauraxL2OutputOracle` |
| Deposits (L2→L3) | Deposit event derived by the node into an L3 system tx | `KauraxPortal` |
| Withdrawals (L3→L2) | Message on L3 → output root → prove → finalize after challenge window | `KauraxPortal` |

L2 → Ethereum settlement is performed by the underlying L2's own stack. KAURAX does not
duplicate it, and does not claim it.

Interfaces defined in `blockchain/l3/src/settlement` and `blockchain/contracts/src/interfaces`:
`SettlementInterface`, `BatcherInterface`, `DataAvailabilityInterface`.

---

## 6. Data availability

Default: **L3 batch data is posted as calldata to the underlying L2**, which itself posts
that data to Ethereum as part of its own batches. Therefore KAURAX transaction data is
ultimately reconstructible from Ethereum, at the cost of L2 data fees.

Alternatives wired as configuration, **not yet operated**: EIP-4844 blobs on the L2 (when
the L2 supports blob transactions), and an external DA layer via the `altda` interface.

Full detail: [`docs/data-availability.md`](./data-availability.md).

---

## 7. Operational requirements

**devnet (works today):** Foundry (`anvil`, `forge`, `cast`), Node.js ≥ 20, pnpm.

**testnet:** Docker + Compose; funded batcher and proposer keys on the underlying L2;
an archive-capable L2 RPC endpoint; persistent volumes for `op-geth`; Prometheus + Grafana;
KMS or hardware-backed signing for the sequencer, batcher and proposer keys.

---

## 8. Limitations

These are the honest gaps in v0. None of them are worked around by faking data.

1. **No fault proofs.** Output roots posted by the proposer are trusted. The dispute game
   is not deployed. `docs/decentralization.md` tracks this.
2. **Centralized sequencer.** One sequencer, no forced-inclusion escape hatch operating
   yet (the `KauraxPortal` deposit path is the designed escape hatch and is implemented,
   but has not been adversarially tested).
3. **Withdrawal proof verification is simplified in `devnet`.** The L3→L2 withdrawal flow
   implements the correct *shape* (message → output root → prove → challenge window →
   finalize) but the `devnet` portal verifies inclusion against the proposed output root
   without a full Merkle-Patricia proof. This is marked in code and in
   `docs/bridge.md`. The `testnet` profile uses the canonical OP Stack portal, which does
   verify proofs.
4. **`testnet` profile is configured, not operated.** The Docker daemon is unavailable in
   the build environment (`colima` not running) and no Go toolchain is present, so
   `op-geth`/`op-node` were **not** executed during this build. The compose files and
   configs are generated and version-pinned; they are unverified until someone runs them.
5. **No audits.** No component of KAURAX has been audited.
6. **KAX has no monetary value.** It is a testnet gas asset.
