# Testnet scripts

**No KAURAX testnet is running.** These scripts are written and reviewed, but have never
been executed. They are a procedure, not a proven path.

| Script | Purpose |
|---|---|
| `deploy.sh` | Preflight checks, then deploy the settlement contracts to a real L2 |

## Preconditions

- `KAURAX_PROFILE=testnet` and `LOCAL_DEV_SETTLEMENT=false`
- A funded batcher and proposer key on the target L2 — **not** the public Anvil devnet keys,
  which `deploy.sh` refuses outright
- An archive-capable L2 RPC endpoint (deposit derivation needs `eth_getLogs` over a range)
- `GUARDIAN_ADDRESS` and `CHALLENGER_ADDRESS` set to multisigs

## Why this has not been run

The build environment had no Go toolchain and no running Docker daemon, so `op-geth` and
`op-node` — the execution and consensus clients for the testnet profile — could not be
started. Rather than pretend otherwise, the profile is configured and version-pinned and
the limitation is recorded in `docs/STACK_DECISION.md` and `MAINNET_READINESS.md`.

The devnet path (`infra/scripts/devnet/start.sh`) is the one that has actually been run and
verified end to end.
