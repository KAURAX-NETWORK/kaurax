#!/usr/bin/env bash
#
# KAURAX local devnet.
#
#   Ethereum stand-in (L1)  ->  underlying rollup stand-in (L2)  ->  KAURAX (L3)
#
# Brings up the full three-layer stack with real EVM chains at every layer and the real
# KAURAX settlement contracts deployed on the L2. Nothing about settlement is simulated:
# the batcher posts real transactions to a real KauraxBatchInbox, and the proposer posts
# real output roots to a real KauraxL2OutputOracle. What is local, and only local, is the
# L2 and the L1 beneath it.
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
RUN_DIR="$ROOT/.devnet"
cd "$ROOT"

# ---------------------------------------------------------------- helpers --
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
step() { printf "\n%s==>%s %s%s%s\n" "$GREEN" "$RESET" "$BOLD" "$1" "$RESET"; }
info() { printf "    %s\n" "$1"; }
warn() { printf "    %s%s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "\n%sERROR:%s %s\n\n" "$RED" "$RESET" "$1" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed. $2"; }

wait_for_rpc() {
  local url="$1" name="$2" attempts="${3:-60}"
  for _ in $(seq 1 "$attempts"); do
    if cast chain-id --rpc-url "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  die "$name did not become ready at $url"
}

# --------------------------------------------------------------- preflight --
step "Preflight"
require anvil "Install Foundry: https://getfoundry.sh"
require cast  "Install Foundry: https://getfoundry.sh"
require forge "Install Foundry: https://getfoundry.sh"
require node  "Install Node.js 20 or newer."
require pnpm  "Install pnpm: npm i -g pnpm"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))."

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  info "created .env from .env.example"
fi

set -a; . "$ROOT/.env"; set +a
info "profile=${KAURAX_PROFILE}  L1=${L1_CHAIN_ID}  L2=${L2_CHAIN_ID}  L3=${KAURAX_CHAIN_ID}"

[ "${LOCAL_DEV_SETTLEMENT}" = "true" ] || \
  die "infra/scripts/devnet/start.sh requires LOCAL_DEV_SETTLEMENT=true. For a public L2, use infra/scripts/testnet/."

# Free the ports we are about to bind, but only ours.
"$ROOT/infra/scripts/devnet/stop.sh" --quiet 2>/dev/null || true
mkdir -p "$RUN_DIR"

L1_PORT="$(node -p "new URL('${L1_RPC_URL}').port || 8545")"
L2_PORT="$(node -p "new URL('${L2_RPC_URL}').port || 9545")"
L3_ENGINE_PORT="$(node -p "new URL('${KAURAX_ENGINE_RPC_URL}').port || 18420")"

# ------------------------------------------------------------------ layer 1 --
step "Layer 1 — Ethereum (local stand-in, chain id ${L1_CHAIN_ID})"
anvil --port "$L1_PORT" --chain-id "$L1_CHAIN_ID" --block-time 12 --silent \
  > "$RUN_DIR/l1.log" 2>&1 &
echo $! > "$RUN_DIR/l1.pid"
wait_for_rpc "$L1_RPC_URL" "L1"
info "L1 ready at $L1_RPC_URL  (12s blocks)"
warn "This is a local chain, not Ethereum. It has no consensus layer, so finality data is reported as unavailable."

# ------------------------------------------------------------------ layer 2 --
step "Layer 2 — underlying rollup (local stand-in, chain id ${L2_CHAIN_ID})"
anvil --port "$L2_PORT" --chain-id "$L2_CHAIN_ID" --block-time "${L2_BLOCK_TIME}" --silent \
  > "$RUN_DIR/l2.log" 2>&1 &
echo $! > "$RUN_DIR/l2.pid"
wait_for_rpc "$L2_RPC_URL" "L2"
info "L2 ready at $L2_RPC_URL  (${L2_BLOCK_TIME}s blocks)"

# ------------------------------------------------------- settlement contracts --
step "Settlement contracts on the L2"
( cd "$ROOT/blockchain/contracts" && forge build --silent ) || die "forge build failed"

DEPLOY_LOG="$RUN_DIR/deploy-settlement.log"
( cd "$ROOT/blockchain/contracts" && \
  OUTPUT_SUBMISSION_INTERVAL_BLOCKS="${OUTPUT_SUBMISSION_INTERVAL_BLOCKS:-12}" \
  forge script script/DeploySettlement.s.sol:DeploySettlement \
    --rpc-url "$L2_RPC_URL" --broadcast --silent ) > "$DEPLOY_LOG" 2>&1 \
  || { cat "$DEPLOY_LOG"; die "settlement deployment failed"; }

DEPLOYMENT_JSON="$ROOT/blockchain/contracts/deployments/${L2_CHAIN_ID}.json"
[ -f "$DEPLOYMENT_JSON" ] || die "deployment did not write $DEPLOYMENT_JSON"

PORTAL=$(node -p "require('$DEPLOYMENT_JSON').portal")
ORACLE=$(node -p "require('$DEPLOYMENT_JSON').outputOracle")
INBOX=$(node -p "require('$DEPLOYMENT_JSON').batchInbox")
L2_BRIDGE=$(node -p "require('$DEPLOYMENT_JSON').l2ERC20Bridge")

info "KauraxPortal          $PORTAL"
info "KauraxL2OutputOracle  $ORACLE"
info "KauraxBatchInbox      $INBOX"
info "KauraxL2ERC20Bridge   $L2_BRIDGE"

# Persist so the node, explorer and CLI all read the same addresses.
node "$ROOT/infra/scripts/lib/write-env.mjs" \
  KAURAX_PORTAL_ADDRESS="$PORTAL" \
  KAURAX_OUTPUT_ORACLE_ADDRESS="$ORACLE" \
  KAURAX_BATCH_INBOX_ADDRESS="$INBOX" \
  KAURAX_L2_BRIDGE_ADDRESS="$L2_BRIDGE"

set -a; . "$ROOT/.env"; set +a

# ------------------------------------------------------------------ layer 3 --
step "Layer 3 — KAURAX execution engine (chain id ${KAURAX_CHAIN_ID})"
# --no-mining is essential: the engine must never decide block contents on its own.
# kaurax-node orders transactions and seals every block explicitly.
anvil --port "$L3_ENGINE_PORT" --chain-id "$KAURAX_CHAIN_ID" \
  --no-mining --order fifo \
  --gas-limit "${KAURAX_GAS_LIMIT}" --base-fee 1000000000 --silent \
  > "$RUN_DIR/l3-engine.log" 2>&1 &
echo $! > "$RUN_DIR/l3-engine.pid"
wait_for_rpc "$KAURAX_ENGINE_RPC_URL" "L3 execution engine"
info "execution engine ready at $KAURAX_ENGINE_RPC_URL (internal only, not the public RPC)"

step "KAURAX genesis"
GENESIS_LOG="$RUN_DIR/genesis.log"
pnpm -s exec tsx "$ROOT/infra/scripts/devnet/genesis.ts" 2>&1 | tee "$GENESIS_LOG"
grep -q "KAURAX_GENESIS_BLOCK=" "$GENESIS_LOG" || die "genesis did not complete"
GENESIS_BLOCK=$(grep "KAURAX_GENESIS_BLOCK=" "$GENESIS_LOG" | tail -1 | cut -d= -f2)
node "$ROOT/infra/scripts/lib/write-env.mjs" KAURAX_GENESIS_BLOCK="$GENESIS_BLOCK"
set -a; . "$ROOT/.env"; set +a
info "genesis complete at L3 block $GENESIS_BLOCK; sequencing starts at $((GENESIS_BLOCK + 1))"

# --------------------------------------------------------------- kaurax-node --
step "kaurax-node — sequencer, derivation, batcher, proposer, RPC"
pnpm -s --filter @kaurax/config build >/dev/null
pnpm -s --filter @kaurax/l3 build  >/dev/null

node "$ROOT/blockchain/l3/dist/cli.js" > "$RUN_DIR/kaurax-node.log" 2>&1 &
echo $! > "$RUN_DIR/kaurax-node.pid"

wait_for_rpc "$KAURAX_RPC_URL" "KAURAX RPC" 80
info "KAURAX RPC ready at $KAURAX_RPC_URL"

step "KAURAX application contracts (Names, Swap, Launchpad)"
APPS_LOG="$RUN_DIR/deploy-apps.log"
( cd "$ROOT/blockchain/contracts" && \
  KAURAX_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY" \
  forge script script/DeployApps.s.sol:DeployApps \
    --rpc-url "$KAURAX_RPC_URL" --broadcast --silent ) > "$APPS_LOG" 2>&1 \
  || { cat "$APPS_LOG"; die "application contract deployment failed"; }

APPS_JSON="$ROOT/blockchain/contracts/deployments/apps-${KAURAX_CHAIN_ID}.json"
[ -f "$APPS_JSON" ] || die "app deployment did not write $APPS_JSON"

NAMES=$(node -p "require('$APPS_JSON').names")
WKAX_ADDR=$(node -p "require('$APPS_JSON').wkax")
SWAP_FACTORY=$(node -p "require('$APPS_JSON').swapFactory")
SWAP_ROUTER=$(node -p "require('$APPS_JSON').swapRouter")
LAUNCHPAD=$(node -p "require('$APPS_JSON').launchpad")

info "KauraxNames        $NAMES"
info "WKAX               $WKAX_ADDR"
info "KauraxSwapFactory  $SWAP_FACTORY"
info "KauraxSwapRouter   $SWAP_ROUTER"
info "KauraxLaunchpad    $LAUNCHPAD"

node "$ROOT/infra/scripts/lib/write-env.mjs" \
  KAURAX_NAMES_ADDRESS="$NAMES" \
  KAURAX_WKAX_ADDRESS="$WKAX_ADDR" \
  KAURAX_SWAP_FACTORY_ADDRESS="$SWAP_FACTORY" \
  KAURAX_SWAP_ROUTER_ADDRESS="$SWAP_ROUTER" \
  KAURAX_LAUNCHPAD_ADDRESS="$LAUNCHPAD"

set -a; . "$ROOT/.env"; set +a

# The explorer receives public endpoints only — never a key.
node "$ROOT/infra/scripts/lib/write-explorer-env.mjs"

# --------------------------------------------------------------- health check --
step "Health check"
L3_CHAIN=$(cast chain-id --rpc-url "$KAURAX_RPC_URL")
[ "$L3_CHAIN" = "$KAURAX_CHAIN_ID" ] || die "KAURAX RPC reports chain id $L3_CHAIN, expected $KAURAX_CHAIN_ID"
info "chain id            $L3_CHAIN"
info "L1 head             $(cast block-number --rpc-url "$L1_RPC_URL")"
info "L2 head             $(cast block-number --rpc-url "$L2_RPC_URL")"
info "L3 head             $(cast block-number --rpc-url "$KAURAX_RPC_URL")"

# Administrative methods must not be reachable from the public endpoint.
if cast rpc anvil_setBalance "0x0000000000000000000000000000000000000001" "0x1" \
     --rpc-url "$KAURAX_RPC_URL" >/dev/null 2>&1; then
  die "SECURITY: the public KAURAX RPC forwarded anvil_setBalance. Aborting."
fi
info "admin RPC namespaces are blocked on the public endpoint"

cat <<EOF

${BOLD}KAURAX devnet is running.${RESET}

  ${BOLD}Add to MetaMask${RESET}
    Network name     KAURAX Devnet
    RPC URL          ${KAURAX_RPC_URL}
    Chain ID         ${KAURAX_CHAIN_ID}
    Currency symbol  KAX
    Explorer         ${NEXT_PUBLIC_EXPLORER_URL}

  ${BOLD}Endpoints${RESET}
    KAURAX  (L3)     ${KAURAX_RPC_URL}   ws ${KAURAX_WS_URL}
    L2               ${L2_RPC_URL}
    L1               ${L1_RPC_URL}
    metrics          http://127.0.0.1:${METRICS_PORT}/metrics

  ${BOLD}Next${RESET}
    ./infra/scripts/devnet/status.sh            three-layer status
    pnpm explorer:dev                     block explorer + bridge UI
    ./tests/acceptance.sh                 end-to-end acceptance test
    ./infra/scripts/devnet/stop.sh              shut everything down

  ${DIM}Logs in .devnet/ — l1.log l2.log l3-engine.log kaurax-node.log${RESET}
  ${DIM}KAX is a testnet gas asset. It has no monetary value.${RESET}

EOF
