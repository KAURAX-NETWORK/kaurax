# Mainnet Readiness

See [`../MAINNET_READINESS.md`](../MAINNET_READINESS.md) for the authoritative checklist.

Short version: **KAURAX is not ready for mainnet, and is not close.** The blocking items
are, in order:

1. No fault-proof system — output roots are trusted (`threat-model.md` T1).
2. No audits of any component.
3. Single sequencer with no failover and no forced-exit hatch.
4. Every privileged role is a single EOA; no multisig, no timelock.
5. Unbatched blocks are not durably persisted.
6. The testnet profile has been configured but never operated.
