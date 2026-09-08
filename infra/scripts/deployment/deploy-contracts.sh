#!/usr/bin/env bash
#
# Deploy the KAURAX settlement contracts to the configured L2 and install the L3
# predeploys into the execution engine. Safe to re-run against a FRESH stack; it does NOT
# reuse an existing deployment, and it refuses to run against an engine that already has a
# chain — see the safety block below.
#
# Used by the Docker bootstrap service and by infra/scripts/testnet/deploy.sh.
#
set -euo pipefail

# Walk upward to the repository root rather than counting "..", so moving this script
# does not silently point it at the wrong directory.
_find_root() {
  local d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$d" != "/" ]; do
    [ -f "$d/pnpm-workspace.yaml" ] && { echo "$d"; return 0; }
    d="$(dirname "$d")"
  done
  echo "could not locate the KAURAX repository root" >&2
  return 1
}
ROOT="$(_find_root)" || exit 1
cd "$ROOT"

die() { echo "ERROR: $1" >&2; exit 1; }

: "${L2_RPC_URL:?L2_RPC_URL must be set}"
: "${L2_CHAIN_ID:?L2_CHAIN_ID must be set}"
: "${KAURAX_ENGINE_RPC_URL:?KAURAX_ENGINE_RPC_URL must be set}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY must be set}"

# ---------------------------------------------------------------- safety --
#
# This script deploys a NEW settlement deployment and re-runs genesis. Run against a chain
# that is already producing blocks, it deploys a second set of contracts that nothing points
# at, then fails genesis because the predeploys already exist — leaving orphaned contracts on
# the L2 and, if the operator is unlucky about ordering, a node configured against a
# deployment with no history.
#
# That happened: `docker compose up -d api` pulled `bootstrap` in as a dependency on a live
# testnet and deployed four orphaned contracts before failing. The service is declared with
# `restart: "no"` and other services `depends_on` it, so any compose command touching them
# re-runs it. `--no-deps` avoids that, but a safety property should not depend on remembering
# a flag.
#
# So: if the execution engine already has a chain, refuse. Genesis leaves the engine at
# block 1, so anything beyond that is a chain somebody is using.
ENGINE_HEAD="$(cast block-number --rpc-url "$KAURAX_ENGINE_RPC_URL" 2>/dev/null || echo "")"
if [ -n "$ENGINE_HEAD" ] && [ "$ENGINE_HEAD" -gt "${KAURAX_BOOTSTRAP_MAX_HEAD:-1}" ]; then
  if [ "${KAURAX_FORCE_BOOTSTRAP:-}" != "true" ]; then
    die "the execution engine is already at block $ENGINE_HEAD, so this is an existing chain.
  Re-deploying would orphan the contracts it settles to and re-run genesis over live state.
  If you genuinely mean to discard that chain, set KAURAX_FORCE_BOOTSTRAP=true."
  fi
  echo "==> KAURAX_FORCE_BOOTSTRAP=true — re-deploying over a chain at block $ENGINE_HEAD"
fi

echo "==> Waiting for the L2 at $L2_RPC_URL"
for _ in $(seq 1 60); do
  cast chain-id --rpc-url "$L2_RPC_URL" >/dev/null 2>&1 && break
  sleep 1
done
ACTUAL_L2=$(cast chain-id --rpc-url "$L2_RPC_URL") || die "L2 unreachable"
[ "$ACTUAL_L2" = "$L2_CHAIN_ID" ] || die "L2 reports chain id $ACTUAL_L2, expected $L2_CHAIN_ID"

echo "==> Deploying settlement contracts to chain $L2_CHAIN_ID"
( cd blockchain/contracts && forge script script/DeploySettlement.s.sol:DeploySettlement \
    --rpc-url "$L2_RPC_URL" --broadcast --silent ) || die "settlement deployment failed"

DEPLOYMENT="blockchain/contracts/deployments/${L2_CHAIN_ID}.json"
[ -f "$DEPLOYMENT" ] || die "deployment did not write $DEPLOYMENT"

export KAURAX_PORTAL_ADDRESS=$(node -p "require('./$DEPLOYMENT').portal")
export KAURAX_OUTPUT_ORACLE_ADDRESS=$(node -p "require('./$DEPLOYMENT').outputOracle")
export KAURAX_BATCH_INBOX_ADDRESS=$(node -p "require('./$DEPLOYMENT').batchInbox")
export KAURAX_L2_BRIDGE_ADDRESS=$(node -p "require('./$DEPLOYMENT').l2ERC20Bridge")

echo "    portal        $KAURAX_PORTAL_ADDRESS"
echo "    output oracle $KAURAX_OUTPUT_ORACLE_ADDRESS"
echo "    batch inbox   $KAURAX_BATCH_INBOX_ADDRESS"
echo "    l2 bridge     $KAURAX_L2_BRIDGE_ADDRESS"

if [ -f "$ROOT/.env" ]; then
  node "$ROOT/infra/scripts/lib/write-env.mjs" \
    KAURAX_PORTAL_ADDRESS="$KAURAX_PORTAL_ADDRESS" \
    KAURAX_OUTPUT_ORACLE_ADDRESS="$KAURAX_OUTPUT_ORACLE_ADDRESS" \
    KAURAX_BATCH_INBOX_ADDRESS="$KAURAX_BATCH_INBOX_ADDRESS" \
    KAURAX_L2_BRIDGE_ADDRESS="$KAURAX_L2_BRIDGE_ADDRESS"
fi

echo "==> Installing KAURAX L3 predeploys"
pnpm -s exec tsx infra/scripts/devnet/genesis.ts || die "genesis failed"

echo "==> Bootstrap complete"
