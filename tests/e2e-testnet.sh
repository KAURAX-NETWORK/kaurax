#!/usr/bin/env bash
#
# KAURAX end-to-end: wallet -> transaction -> mempool -> block -> state -> confirmation.
#
# Every step uses the real CLI against a real chain. Nothing is mocked, and no step is
# reported as passing on the strength of a status code — each assertion reads a value back
# from the chain.
#
# What this test does NOT cover, because KAURAX does not have it: consensus among
# validators. KAURAX is a rollup. Ordering is decided by a single sequencer, and its
# security comes from data availability, forced inclusion and settlement on the L2 rather
# than from a validator set. docs/ARCHITECTURE_AUDIT.md §3 is explicit about this, and the
# explorer's validators page says the same to users.
#
#   tests/e2e-testnet.sh
#   KAURAX_RPC_URL=https://kaurax.network/rpc tests/e2e-testnet.sh
set -uo pipefail

_find_root() {
  local d; d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$d" != "/" ]; do
    [ -f "$d/pnpm-workspace.yaml" ] && { echo "$d"; return 0; }
    d="$(dirname "$d")"
  done
  echo "could not locate the KAURAX repository root" >&2; return 1
}
ROOT="$(_find_root)" || exit 1
cd "$ROOT"

export KAURAX_RPC_URL="${KAURAX_RPC_URL:-http://127.0.0.1:8420}"
export KAURAX_API_URL="${KAURAX_API_URL:-http://127.0.0.1:4000}"
export KAURAX_CHAIN_ID="${KAURAX_CHAIN_ID:-8420}"
export KAURAX_HOME="${KAURAX_HOME:-$(mktemp -d)/kaurax}"
export KAURAX_PASSPHRASE="${KAURAX_PASSPHRASE:-e2e-$(date +%s)}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
PASS=0; FAIL=0
step() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; FAIL=$((FAIL+1)); }

# A function, not a string: the repository path may contain spaces, and an unquoted command
# string splits on them.
cli() { node "$ROOT/packages/cli/dist/index.js" "$@"; }
[ -f "$ROOT/packages/cli/dist/index.js" ] || { echo "build the CLI first: pnpm turbo run build --filter=@kaurax/cli"; exit 1; }

printf '%sKAURAX end-to-end%s %s%s%s\n' "$BOLD" "$RESET" "$DIM" "$KAURAX_RPC_URL" "$DIM$RESET"

# ------------------------------------------------------------------ 1. key --
step "Wallet: generate a key"
OUT="$(cli wallet create e2e 2>&1)" || { bad "key generation failed: $OUT"; exit 1; }
ADDR="$(printf '%s' "$OUT" | awk '/^address/{print $2}')"
[ -n "$ADDR" ] && ok "generated $ADDR" || { bad "no address returned"; exit 1; }

# The key must be encrypted at rest, not merely stored.
if grep -q '"ciphertext"' "$KAURAX_HOME/keys.json" && ! grep -qE '"privateKey"|0x[0-9a-f]{64}' "$KAURAX_HOME/keys.json"; then
  ok "private key is encrypted at rest, not stored in the clear"
else
  bad "key file contains something that looks like a plaintext key"
fi

# --------------------------------------------------------------- 2. faucet --
step "Faucet: fund the new account"
OUT="$(cli faucet 2>&1)"
if printf '%s' "$OUT" | grep -q "^funded"; then
  FUND_TX="$(printf '%s' "$OUT" | awk '/^tx /{print $2}')"
  ok "funded, tx $FUND_TX"
elif printf '%s' "$OUT" | grep -qi "recently\|cooldown"; then
  # Not a failure. The cooldown is the faucet's abuse protection doing its job, and a test
  # that reported it as broken would be pressure to weaken it. Fall back to a funded key so
  # the rest of the pipeline can still be exercised.
  ok "faucet enforced its cooldown (abuse protection works)"
  if [ -n "${E2E_FUNDING_KEY:-}" ]; then
    cli wallet import "$E2E_FUNDING_KEY" funder --passphrase "$KAURAX_PASSPHRASE" >/dev/null 2>&1
    SEND="$(cli wallet send "$ADDR" 5 --label funder 2>&1)"
    printf '%s' "$SEND" | grep -q "status   success" \
      && ok "funded from E2E_FUNDING_KEY instead" \
      || { bad "fallback funding failed: $(printf '%s' "$SEND" | tail -2)"; exit 1; }
  else
    bad "on cooldown and no E2E_FUNDING_KEY set; cannot continue"
    exit 1
  fi
else
  bad "faucet failed: $(printf '%s' "$OUT" | tail -2)"
  exit 1
fi

# ------------------------------------------------------------- 3. balance --
step "State: the funding is visible on chain"
BAL="$(cli wallet balance 2>&1 | awk '/^balance/{print $2}')"
awk -v b="$BAL" 'BEGIN{exit !(b+0 > 0)}' && ok "balance $BAL KAX" || bad "balance is $BAL after funding"

# ------------------------------------------------------- 4. sign and send --
step "Transaction: sign, broadcast, wait for inclusion"
BEFORE_NONCE="$(cli wallet balance 2>&1 | awk '/^nonce/{print $2}')"
OUT="$(cli wallet send 0x000000000000000000000000000000000000dEaD 1 2>&1)"
if printf '%s' "$OUT" | grep -q "status   success"; then
  TX="$(printf '%s' "$OUT" | awk '/^hash/{print $2}')"
  BLK="$(printf '%s' "$OUT" | awk '/^block/{print $2}')"
  ok "included in block $BLK, tx $TX"
else
  bad "send failed: $(printf '%s' "$OUT" | tail -3)"
  TX=""
fi

# ----------------------------------------------------- 5. state and nonce --
step "State update: balance and nonce moved"
AFTER_NONCE="$(cli wallet balance 2>&1 | awk '/^nonce/{print $2}')"
[ "$AFTER_NONCE" -gt "$BEFORE_NONCE" ] 2>/dev/null \
  && ok "nonce advanced $BEFORE_NONCE -> $AFTER_NONCE" \
  || bad "nonce did not advance ($BEFORE_NONCE -> $AFTER_NONCE)"

AFTER_BAL="$(cli wallet balance 2>&1 | awk '/^balance/{print $2}')"
awk -v a="$AFTER_BAL" -v b="$BAL" 'BEGIN{exit !(a+0 < b+0)}' \
  && ok "balance fell $BAL -> $AFTER_BAL (transfer plus gas)" \
  || bad "balance did not fall"

# ------------------------------------------------------- 6. confirmation --
step "Confirmation: the chain agrees, independently of the sender"
if [ -n "$TX" ]; then
  OUT="$(cli tx status "$TX" 2>&1)"
  printf '%s' "$OUT" | grep -q "success" && ok "receipt confirms success" || bad "receipt does not confirm success"
  printf '%s' "$OUT" | grep -qE "published to L2|last batched" && ok "settlement stage reported" || bad "no settlement information"
else
  bad "no transaction to confirm"
fi

# ------------------------------------------------------------ 7. honesty --
step "The network does not claim what it does not have"
STATUS="$(curl -s --max-time 20 -X POST "$KAURAX_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"kaurax_networkStatus","params":[]}' 2>/dev/null)"
printf '%s' "$STATUS" | grep -q '"faultProofs"' && ok "fault proof status is published" || bad "fault proof status missing"
printf '%s' "$STATUS" | grep -qiE '"decentralized":\s*false|not implemented' \
  && ok "centralisation is reported, not hidden" \
  || bad "the node does not disclose its trust assumptions"

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$RESET"
printf '%s%s%s\n' "$DIM" "keys used for this run: $KAURAX_HOME" "$RESET"
[ "$FAIL" -eq 0 ]
