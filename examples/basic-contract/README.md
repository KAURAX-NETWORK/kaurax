# basic-contract

A standalone Foundry project targeting KAURAX: a contract that holds value, tests that attack
it, and a deployment script.

```bash
forge test          # 6 tests, including a re-entrancy attack and a fuzz property
```

## Deploy

```bash
export KAURAX_RPC_URL=https://kaurax.network/rpc      # or http://127.0.0.1:8420
export PRIVATE_KEY=0xyour-key
forge script script/Deploy.s.sol --rpc-url $KAURAX_RPC_URL --broadcast
```

Get gas first: `curl -s -X POST https://kaurax.network/api/faucet -H 'content-type: application/json' -d '{"address":"0xYou"}'`

## What `Vault` is for

Small, but not toy-small: it holds value and it can be attacked. `withdraw` writes state
before transferring, so a re-entrant caller finds a zero balance —
`test_reentrancyCannotDrainTheVault` proves that with **an actual attacker contract**, not an
assertion about intent. Swap the two lines in `withdraw` and watch it fail.

`testFuzz_depositThenWithdrawIsAlwaysNeutral` runs 256 random amounts and asserts a deposit
followed by a withdrawal leaves the depositor exactly where they started.

## Copying this out of the repository

`foundry.toml` remaps `forge-std` to the copy already in this repository so the example runs
from a fresh clone with no network. In your own project, delete the `remappings` and
`allow_paths` lines and run:

```bash
forge install foundry-rs/forge-std
```
