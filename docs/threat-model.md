# Threat Model

Scope: the KAURAX L3, its node components, and its settlement and bridge contracts on the
underlying L2. Out of scope: the security of Ethereum and of the underlying L2 themselves,
which KAURAX depends on and does not attempt to improve.

**No component of KAURAX has been audited.** Assume every finding below is live.

## Assets at risk

1. Value escrowed in `KauraxPortal` on the L2 (backs all KAX in circulation).
2. Tokens escrowed in `KauraxL2ERC20Bridge`.
3. KAURAX chain state and liveness.
4. User transaction ordering (MEV).

## Trust assumptions

| Party | Trusted for |
|---|---|
| Sequencer operator | Liveness, honest ordering, not withholding data |
| Proposer operator | Publishing **correct** output roots — nothing verifies them |
| Challenger key | Deleting bad proposals within the window |
| Guardian key | Pausing the portal in an emergency, and not pausing it maliciously |
| Underlying L2 | Data availability, censorship resistance, its own settlement |

## Threats

### T1 — Incorrect output root  ·  Severity: **critical**  ·  Unmitigated

An attacker with the proposer key (or a compromised proposer) publishes a root committing
to a withdrawal tree containing withdrawals that never happened. After the challenge
window, those withdrawals finalize and drain `KauraxPortal`.

- **Detection:** anyone replaying from data availability sees the mismatch.
- **Prevention:** none on chain. The challenger may delete the proposal *if a human notices
  in time*.
- **Fix:** fault proofs. This is the top mainnet blocker.

### T2 — Sequencer failure  ·  Severity: high  ·  Unmitigated

The single sequencer stops. No blocks are produced; KAURAX halts. Funds are not lost —
they remain escrowed and recoverable from DA — but nothing moves and no withdrawal can be
initiated.

- **Fix:** failover, then decentralized sequencing.

### T3 — Sequencer censorship  ·  Severity: high  ·  Partially mitigated

The sequencer refuses a user's transactions.

- **Mitigated for entry:** deposits are derived from L2 events and cannot be dropped.
- **Not mitigated for exit:** a user holding KAX on KAURAX cannot force a withdrawal.
- **Fix:** forced-exit transactions with a bounded inclusion deadline.

### T4 — Data availability failure  ·  Severity: high  ·  Partially mitigated

The batcher stops, or the node is lost before pending blocks are batched.

- Batched blocks are permanently recoverable from the L2.
- **Unbatched blocks exist only in the node.** `kaurax_unbatched_l3_blocks` is the live size
  of this exposure.
- **Fix:** a durable write-ahead log for sequenced payloads before mainnet.

### T5 — Bridge exploit  ·  Severity: critical  ·  Mitigated at the contract level

Attempts to withdraw value that was never deposited.

Mitigations, all tested in `blockchain/contracts/test/`:
- Output-root preimage must hash to the stored proposal (`InvalidOutputRootProof`).
- Merkle inclusion is verified (`InvalidWithdrawalInclusionProof`); forged withdrawals and
  leaf-index substitution both fail.
- Double finalization rejected (`WithdrawalAlreadyFinalized`).
- Re-prove against the same root rejected (`AlreadyProvenAtSameRoot`) — otherwise the
  challenge clock could be reset indefinitely.
- Withdrawals targeting the portal rejected (`TargetIsPortal`).
- Reentrancy guarded by `l3Sender`; effects written before the external call.
- Escrow release requires `msg.sender == portal` **and** `portal.l3Sender() == counterpart`.
- Fee-on-transfer tokens handled by measuring the actual balance delta.

**Residual:** all of this rests on the output root being correct. See T1.

### T6 — Address impersonation across the bridge  ·  Severity: high  ·  Mitigated

An L2 contract at address X acts as the KAURAX EOA at address X.

- **Mitigation:** `AddressAliasHelper` offsets contract senders by
  `0x1111...1111`. EOAs pass through unaliased. Tested both ways.

### T7 — Replay attacks  ·  Severity: high  ·  Mitigated

- The mempool rejects any transaction whose `chainId` is not KAURAX's, and rejects
  pre-EIP-155 unprotected transactions outright.
- The node refuses to start if the execution engine reports a different chain ID than
  configured — a mismatch would make every signed transaction replayable elsewhere.
- The config validator rejects duplicate chain IDs across L1/L2/L3.
- Withdrawals carry a monotonic nonce; each hash finalizes once.

### T8 — L2 reorg  ·  Severity: medium  ·  Partially mitigated

The L2 reorgs beneath a batch or an output proposal.

- Output proposals are pinned to an L2 block hash and revert on mismatch
  (`L2BlockHashMismatch`).
- A dropped batch transaction is caught by the contiguity check on the next submission.
- **Not mitigated:** deposits already derived from a reorged-away L2 block are not
  automatically reverted on KAURAX. The derivation cursor moves forward only. On a deep L2
  reorg, KAURAX could contain a deposit whose L2 escrow no longer exists.
- **Fix:** derive only from L2 blocks past a confirmation depth, and handle reorgs by
  re-deriving.

### T9 — RPC abuse  ·  Severity: medium  ·  Partially mitigated

- Administrative namespaces (`anvil_`, `evm_`, `debug_`, `hardhat_`, `admin_`, `miner_`,
  `personal_`, `txpool_`, `engine_`) are blocked on the public endpoint, over both HTTP and
  WebSocket. The devnet script asserts this at startup and aborts if it ever regresses.
- The execution engine is bound to loopback and is not the endpoint users talk to.
- `eth_accounts` returns empty: the node holds operational keys, not user keys, and must
  never appear to offer signing.
- Request bodies are capped at 10 MB.
- **Not mitigated:** no rate limiting, no authentication, no per-IP quotas. A public
  deployment must front the RPC with a reverse proxy that provides them.

### T10 — Key compromise  ·  Severity: critical  ·  Partially mitigated

| Key | If compromised |
|---|---|
| Sequencer | Ordering and liveness controlled |
| Batcher | Data availability halted or spammed |
| Proposer | **See T1 — funds at risk** |
| Guardian | Bridge paused indefinitely |
| Challenger | Bad proposals can no longer be deleted; also can grief by deleting good ones |

- Keys are loaded from the environment, never committed; `.env` is gitignored and
  `.env.example` carries only the publicly documented Anvil test keys.
- The config loader validates key format without ever echoing a value in an error.
- **Not mitigated:** no KMS integration, no hardware signing, no key rotation procedure,
  no multisig. Required before any public deployment.

### T11 — MEV extraction by the sequencer  ·  Severity: medium  ·  Unmitigated

The single sequencer sees the full mempool and can reorder, insert or drop transactions.
Nothing prevents it. See [`sequencer.md`](./sequencer.md).

### T12 — Malicious batch submission  ·  Severity: low  ·  Mitigated

Only the configured batcher address may call `submitBatch`. Batches must be contiguous.
Garbage bytes from the legitimate batcher would corrupt reconstruction, but the on-chain
commitment makes that detectable and attributable.

### T13 — Denial of service on the mempool  ·  Severity: medium  ·  Partially mitigated

Per-sender queue caps (64) and a global cap (20 000); replacements must strictly outbid.
Transactions must be signed and correctly nonced to occupy space. **Not mitigated:** no
account-based rate limiting or minimum-balance requirement.

## Summary of unmitigated critical risk

**T1 is the whole story.** KAURAX's bridge contracts are individually sound and tested, but
they protect a root that nothing verifies. Until fault proofs exist, the honest statement is:
*KAURAX users trust the proposer, and can prove after the fact if that trust was misplaced.*
