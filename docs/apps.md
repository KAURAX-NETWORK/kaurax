# KAURAX Application Contracts

Three applications with real contracts on KAURAX: **Names**, **Swap** and **Launchpad**.
All are deployed by `blockchain/contracts/script/DeployApps.s.sol` and exercised end to end
by `tests/apps-smoke.sh` against a live chain.

They are ordinary application contracts. Nothing in the L3 protocol depends on them, and
they are not privileged.

**None of them has been audited. KAX has no monetary value.**

---

## KauraxNames

A name registry: `label` → address, registered for a term.

| | |
|---|---|
| Term | 28 days to 10 years, renewable at any time |
| Grace period | 30 days after expiry, during which **only the owner** may renew |
| Labels | 3–63 characters of `a–z`, `0–9`, `-`; not starting or ending with `-` |
| Pricing | By length — 3, 4, and 5+ characters are separate tiers, priced per year |
| Storage | Only `keccak256(label)`, so cost does not depend on length |

### Decisions that matter

**Uppercase is rejected, not folded.** Silently lowercasing would make `Alice` and `alice`
the same registration, which is a phishing surface. An invalid label fails loudly.

**Resolution and ownership are separate.** A name resolves to an address that may differ
from its owner, which is what makes a name usable as a payment target controlled by someone
else.

**Reverse records are verified.** `setPrimaryName` requires the caller to be the address the
name *currently resolves to*. Without that check, anyone could point a name at your address
and control how you are labelled. A primary name also stops displaying the moment it expires
or is re-pointed away.

**The grace period is exclusive.** After expiry the name stops resolving but is not
available to anyone else for 30 days, so a missed renewal is recoverable rather than
instantly sniped.

**Renewal is permissionless.** Anyone may pay to renew a name they do not own; it extends
the current owner's registration and does not transfer it.

Contract: `blockchain/contracts/src/apps/KauraxNames.sol` · 29 tests.

---

## KauraxSwap

A constant-product automated market maker — `x · y ≥ k` — with a 0.3% fee retained for
liquidity providers.

| Contract | Role |
|---|---|
| `WKAX` | ERC-20 wrapper for native KAX, backed 1:1 |
| `KauraxSwapFactory` | Creates pools, one per token pair, at a CREATE2-derivable address |
| `KauraxSwapPair` | Holds reserves, mints and burns LP tokens, enforces the invariant |
| `KauraxSwapRouter` | Slippage bounds, deadlines, multi-hop paths, native KAX wrapping |

### Where the safety actually lives

Everything that protects the pool is enforced in the **pair**, not the router. The router is
a convenience and anyone may bypass it, so it cannot be where the guarantees live.

**The k invariant is checked on every swap**, against balances read *after* the transfer,
with the fee included. A swap that would reduce k reverts.

**Amounts are derived from balance deltas**, never from caller-supplied numbers. A caller
cannot claim to have sent tokens it did not send.

**A minimum liquidity is burned on the first mint**, so total supply can never return to
zero and have its share price manipulated.

**Reentrancy is locked** across every state-changing entry point.

What the **router** adds is what a raw pair call lacks: a minimum output or maximum input
enforced on chain, and a deadline so a transaction stuck in the mempool cannot execute later
at a price the sender never agreed to.

> **Deadlines come from chain time, not the browser's clock.** A sequencer sets block
> timestamps, and any drift would make a wall-clock deadline revert valid transactions with
> `Expired()`. The frontend reads the latest block timestamp instead — a bug found by
> `tests/apps-smoke.sh` on a devnet whose clock had been advanced.

### Liquidity provision

The Swap app has three tabs: **Swap**, **Liquidity** and **Pools**.

**The counterpart amount is quoted from the pool, not typed.** For an existing pool the
router only accepts a deposit at the current reserve ratio; a mismatched pair would be
partly refunded. Quoting it means what the form shows deposited is what is deposited.

**Minimums are enforced on chain for both add and remove.** A pool that moves between
quoting and execution reverts rather than filling at a worse ratio.

**Removing liquidity needs an allowance on the pair itself**, because the router pulls the
LP tokens. The UI handles that, but it is worth knowing if you call the router directly.

`tests/apps-smoke.sh` verifies that a ratio-matched deposit leaves the price unchanged —
observed drift was 8 wei on a price of ~907×10¹⁸ — that LP tokens are minted and burned,
that native KAX comes back, and that removing more than you hold reverts.

Contracts: `blockchain/contracts/src/apps/{WKAX,KauraxSwapFactory,KauraxSwapPair,KauraxSwapRouter}.sol` · 30 tests including a k-invariant fuzz.

---

## KauraxLaunchpad

Token sales paid for in KAX, with escrow and a soft cap.

```
create → escrow tokens → sale opens → contributions → ends → finalise
                                                              ├─ at/above soft cap: buyers claim, creator withdraws
                                                              └─ below soft cap:     buyers refund, creator gets nothing
```

### The property that matters

**A buyer's funds are never at the creator's discretion.**

**Tokens are escrowed before the sale opens**, and the escrow must cover the hard cap. A
sale cannot raise KAX for tokens that do not exist.

**The soft cap decides who gets what.** Below it, every buyer withdraws in full and the
creator receives nothing. At or above it, buyers claim and the creator claims the raise.
There is no path where the creator takes the KAX and buyers are left holding nothing.

**The creator cannot touch the KAX before finalisation**, cannot cancel a sale that has
begun, and cannot change its terms.

**Finalisation is permissionless.** A creator who walks away cannot strand refunds by never
finalising.

**Claims are pull-based and guarded**, so one buyer's reverting fallback cannot block
everyone else.

Deliberately absent: vesting, whitelists, tiers, referral bonuses. They are not implemented,
so they are not implied.

### Creating a sale

The Launchpad app has two tabs: **Sales** and **Create a sale**.

Creation is deliberately **two steps**, because the contract is: `createSale` records the
terms, and `depositTokens` escrows the allocation. Until the tokens are escrowed the sale
accepts nothing. Presenting that as one button would hide the moment a creator's tokens
become locked.

The form computes the required allocation with the same integer arithmetic the contract
uses — `(hardCap × rate) / 1e18` — so the preview cannot disagree with what the contract
will demand. It refuses to submit when the creator's balance would not cover it.

Timing is anchored to the **chain's clock**: the contract compares against
`block.timestamp`, so a browser-derived start time can look like the past on a chain whose
clock has drifted.

The creator's own view exposes escrow, cancel-before-open, finalise and withdraw. Cancel
disappears once the sale opens, because the contract rejects it from then on.

`tests/apps-smoke.sh` verifies the whole path: a sale starts `Pending`, contributing before
escrow reverts, escrowing moves it to `Funded`, and cancelling before it opens returns the
allocation exactly.

Contract: `blockchain/contracts/src/apps/KauraxLaunchpad.sol` · 27 tests.

---

## Deploying them

```bash
export KAURAX_PRIVATE_KEY=0x...            # export at the shell; never commit
cd blockchain/contracts
forge script script/DeployApps.s.sol:DeployApps --rpc-url $KAURAX_RPC_URL --broadcast
```

Addresses are written to `deployments/apps-<chainid>.json` and into `.env`. The devnet
script does this automatically.

The frontends do **not** trust those addresses: `/api/features` calls `eth_getCode` on each
one, and an app renders as *not deployed* when the chain says there is no contract there —
even if an address is configured.

## Verifying them

```bash
cd blockchain/contracts && forge test    # 270 tests, all suites
./tests/apps-smoke.sh                     # 43 checks against a live chain
```

`apps-smoke.sh` uses the **same ABIs the frontends use**, so a pass means the data path each
app depends on works.
