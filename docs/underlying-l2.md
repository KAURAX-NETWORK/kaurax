# The Underlying Layer-2

KAURAX settles to a Layer-2. **Which** L2 is configuration, not architecture.

## Configuration

```bash
L2_RPC_URL=https://sepolia.base.org
L2_CHAIN_ID=84532
L2_NAME=base-sepolia
L2_BLOCK_TIME=2
```

Nothing in the KAURAX codebase hardcodes an L2. The settlement adapter verifies at startup
that the endpoint actually reports `L2_CHAIN_ID` and refuses to run on a mismatch.

## Requirements for a candidate L2

1. **EVM-compatible**, so the KAURAX settlement contracts deploy unchanged.
2. **Reasonable calldata cost** — KAURAX pays for every byte it publishes.
3. **`eth_getLogs` over a usable range**, for deposit derivation.
4. **`blockhash` availability** for recent blocks, used to pin output proposals against an
   L2 reorg.
5. **Its own credible settlement to Ethereum.** KAURAX's security ceiling is the L2's.

## Candidates

| L2 | Chain ID (testnet) | Notes |
|---|---|---|
| Base Sepolia | 84532 | Default for the testnet profile. OP Stack, mature, cheap. |
| OP Sepolia | 11155420 | Reference OP Stack deployment. |
| Arbitrum Sepolia | 421614 | Works; the settlement contracts are stack-agnostic. |
| Mode / Zora / other OP chains | various | Work identically. |
| Local `anvil` | 8415 | The devnet profile. |

The default is a default, not a dependency.

## What KAURAX deploys there

| Contract | Purpose |
|---|---|
| `KauraxPortal` | Deposits, withdrawal prove/finalize, pause |
| `KauraxL2OutputOracle` | KAURAX state commitments |
| `KauraxBatchInbox` | KAURAX transaction data |
| `KauraxL2ERC20Bridge` | ERC-20 escrow |

Deploy with:

```bash
cd blockchain/contracts
forge script script/DeploySettlement.s.sol:DeploySettlement \
  --rpc-url $L2_RPC_URL --broadcast
```

Addresses are written to `blockchain/contracts/deployments/<chainId>.json`, which the node, CLI and
explorer all read.

## Operational cost

Two recurring L2 costs, both paid from operator keys:

- **Batcher** — one transaction per `BATCH_SUBMISSION_INTERVAL`, sized by KAURAX activity.
- **Proposer** — one transaction per `OUTPUT_PROPOSAL_INTERVAL`, constant and small.

Both keys must stay funded. A batcher that runs dry stops publishing data, which is a data
availability failure (T4 in the threat model), not merely a stalled job. Alert on balance.

## The devnet L2

The devnet runs a local `anvil` as the L2. This is a **real EVM chain** with the **real**
KAURAX settlement contracts on it — batches and output roots are genuine transactions
against genuine contracts.

What it is not is a public rollup posting to Ethereum. So the devnet exercises every
KAURAX-side mechanism honestly, while the L2→L1 hop beneath it is absent. That boundary is
stated wherever it could mislead: `isLocalDevnet` in the RPC responses, and
"local devnet chain, not Ethereum" in the CLI and explorer.
