## What this changes

<!-- One or two sentences. What behaviour is different afterwards? -->

## Why

<!-- The problem. Link an issue if there is one. -->

## How it was verified

<!-- Commands and their output. "Tests pass" is not evidence; the output is. -->

```
```

## Checklist

- [ ] `forge test` and `pnpm test` pass
- [ ] `forge fmt --check` and `pnpm typecheck` pass
- [ ] New behaviour has a test; a fixed bug has a regression test
- [ ] No test was deleted or weakened to make CI green
- [ ] Documentation matches the code after this change
- [ ] No secrets, keys or credentials added
- [ ] No claim strengthened beyond what the code does

## Claims

KAURAX documents its limitations precisely, and PRs are held to the same line.

- [ ] This does not describe anything as **trustless**, **permissionless**, **fault-proven**,
      **decentralized** or **audited** unless the code makes it so
- [ ] If it changes a trust assumption, [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and
      [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) are updated to match

<!--
Reminders about the current state, so a PR does not accidentally contradict it:
  - There is no fault proof over KAURAX execution. The verifier covers a documented EVM
    subset and is deliberately not wired to settlement.
  - Disputes are decided by a 2-of-3 multisig.
  - There has been no external audit.
-->
