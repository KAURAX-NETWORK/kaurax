#!/usr/bin/env bash
#
# Deploy KAURAX as a public testnet, settling to a real L2.
#
# ============================================================================
# THIS HAS NEVER BEEN RUN. No KAURAX testnet exists.
#
# The script is written against the real components and real contracts, and its
# preflight checks are real, but it has not been executed end to end. Treat it as a
# reviewed procedure, not a proven one. Read docs/security.md and MAINNET_READINESS.md
# before using it.
# ============================================================================
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

BOLD=$'\033[1m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
step() { printf "\n%s==>%s %s%s%s\n" "$GREEN" "$RESET" "$BOLD" "$1" "$RESET"; }
warn() { printf "    %s%s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "\n%sERROR:%s %s\n\n" "$RED" "$RESET" "$1" >&2; exit 1; }

[ -f "$ROOT/.env" ] || die "No .env. Copy .env.example and configure it for your L2."
set -a; . "$ROOT/.env"; set +a

step "Preflight"

[ "${KAURAX_PROFILE}" = "testnet" ] || die "KAURAX_PROFILE must be 'testnet' (got '${KAURAX_PROFILE}')."
[ "${LOCAL_DEV_SETTLEMENT}" = "false" ] || \
  die "LOCAL_DEV_SETTLEMENT must be false for a public testnet: it must settle to a real L2."

command -v forge >/dev/null || die "Foundry is required."
command -v cast  >/dev/null || die "Foundry is required."

for var in L2_RPC_URL L2_CHAIN_ID L1_RPC_URL KAURAX_CHAIN_ID \
           SEQUENCER_PRIVATE_KEY BATCHER_PRIVATE_KEY PROPOSER_PRIVATE_KEY DEPLOYER_PRIVATE_KEY; do
  [ -n "${!var:-}" ] || die "$var is not set."
done

# The published Anvil devnet keys must never reach a public network. Compared by derived
# address rather than by key, so no key literal lives in this repository.
ANVIL_ADDRESSES="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
0x70997970c51812dc3a010c7d01b50e0d17dc79c8
0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
0x90f79bf6eb2c4f870365e785982e1f101e93b906
0x15d34aaf54267db7d7c367839aaf71a00a2c6a65"

for role in SEQUENCER BATCHER PROPOSER DEPLOYER; do
  key_var="${role}_PRIVATE_KEY"
  addr=$(cast wallet address --private-key "${!key_var}" 2>/dev/null | tr '[:upper:]' '[:lower:]') \
    || die "$key_var is not a valid private key."
  if echo "$ANVIL_ADDRESSES" | grep -qx "$addr"; then
    die "$role is configured with a public Anvil devnet key ($addr). Those keys are published in Foundry's documentation and anyone can spend from them. Generate real keys — ideally in a KMS. See docs/security.md."
  fi
done

step "Verifying the underlying L2"
ACTUAL_L2=$(cast chain-id --rpc-url "$L2_RPC_URL") || die "Cannot reach L2_RPC_URL"
[ "$ACTUAL_L2" = "$L2_CHAIN_ID" ] || die "L2 reports chain id $ACTUAL_L2, .env says $L2_CHAIN_ID"
echo "    L2 chain $ACTUAL_L2 at block $(cast block-number --rpc-url "$L2_RPC_URL")"

step "Checking operator balances on the L2"
for role in BATCHER PROPOSER DEPLOYER; do
  key_var="${role}_PRIVATE_KEY"
  addr=$(cast wallet address --private-key "${!key_var}")
  bal=$(cast balance "$addr" --rpc-url "$L2_RPC_URL")
  echo "    $role $addr  $(cast to-unit "$bal" ether) ETH"
  [ "$bal" != "0" ] || warn "$role has a zero balance. It cannot submit transactions."
done

step "Acknowledgement"
cat <<EOF

  ${YELLOW}Before continuing, understand what you are deploying:${RESET}

    - There is ${BOLD}no fault proof system${RESET}. Output roots are trusted. A compromised
      or faulty proposer can drain KauraxPortal after the challenge window.
    - The sequencer is ${BOLD}centralized${RESET} with no failover. If it stops, the chain stops.
    - There is ${BOLD}no forced exit${RESET}. Deposits cannot be censored; withdrawals can.
    - ${BOLD}Nothing has been audited.${RESET}
    - Guardian and challenger will be single EOAs unless you set GUARDIAN_ADDRESS and
      CHALLENGER_ADDRESS to multisigs.

  Do not invite anyone to deposit anything of value.

EOF
read -r -p "  Type 'I understand' to continue: " ack
[ "$ack" = "I understand" ] || die "Aborted."

step "Deploying settlement contracts to chain $L2_CHAIN_ID"
./infra/scripts/deployment/deploy-contracts.sh

step "Next steps"
cat <<EOF

  1. Start the execution engine (op-geth for this profile) and kaurax-node:
       docker compose -f docker-compose.testnet.yml up -d

  2. Verify the settlement contracts on the L2's block explorer.

  3. Transfer GUARDIAN_ADDRESS and CHALLENGER_ADDRESS to multisigs.

  4. Monitor:
       kaurax network status
       curl http://127.0.0.1:${METRICS_PORT}/metrics

  5. Run the acceptance test against the deployment before announcing it.

EOF
