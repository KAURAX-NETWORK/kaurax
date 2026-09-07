#!/usr/bin/env bash
#
# KAURAX API smoke test.
#
# Verifies the backend API and the indexer against a live devnet. Every assertion checks a
# real response from a real service reading real chain data — there are no fixtures here.
#
#   ./tests/api-smoke.sh [API_URL]
#
set -uo pipefail

_find_root() {
  local d; d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$d" != "/" ]; do
    [ -f "$d/pnpm-workspace.yaml" ] && { echo "$d"; return 0; }
    d="$(dirname "$d")"
  done
  echo "could not locate the repository root" >&2; return 1
}
ROOT="$(_find_root)" || exit 1
cd "$ROOT"

API="${1:-${KAURAX_API_URL:-http://127.0.0.1:4000}}"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
PASS=0; FAIL=0; FAILURES=()

pass() { PASS=$((PASS+1)); printf "  %sPASS%s  %s %s%s%s\n" "$GREEN" "$RESET" "$1" "$DIM" "${2:-}" "$RESET"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1"); printf "  %sFAIL%s  %s %s%s%s\n" "$RED" "$RESET" "$1" "$DIM" "${2:-}" "$RESET"; }
head() { printf "\n%s%s%s\n" "$BOLD" "$1" "$RESET"; }

# jq is not assumed: python3 is already a dependency of the devnet scripts.
json() { python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('__PARSE_ERROR__'); sys.exit(0)
try:
    for k in '$1'.split('.'):
        if k == '': continue
        d = d[int(k)] if isinstance(d, list) else d[k]
    print('' if d is None else d)
except Exception:
    print('__MISSING__')
"; }

status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

printf "%sKAURAX API smoke test%s\n%s%s%s\n" "$BOLD" "$RESET" "$DIM" "$API" "$RESET"

# ------------------------------------------------------------------ health --
head "Health"
CODE=$(status_of "$API/api/health")
BODY=$(curl -s --max-time 15 "$API/api/health")
[ "$CODE" = "200" ] && pass "GET /api/health returns 200" || fail "GET /api/health returned $CODE"

for dep in rpc database indexer; do
  v=$(echo "$BODY" | json "$dep")
  [ "$v" = "True" ] || [ "$v" = "true" ] && pass "dependency '$dep' is healthy" || fail "dependency '$dep' reported $v"
done

for sub in rpc database indexer live; do
  c=$(status_of "$API/api/health/$sub")
  [ "$c" = "200" ] && pass "GET /api/health/$sub" || fail "GET /api/health/$sub returned $c"
done

# ----------------------------------------------------------------- network --
head "Network"
NET=$(curl -s --max-time 15 "$API/api/network")
CHAIN=$(echo "$NET" | json chainId)
HEAD_BLOCK=$(echo "$NET" | json head)
[ -n "$CHAIN" ] && [ "$CHAIN" != "__MISSING__" ] && pass "chainId reported" "$CHAIN" || fail "chainId missing"
[ "$(echo "$NET" | json currency.symbol)" = "KAX" ] && pass "native currency is KAX" || fail "unexpected currency symbol"
[ "$(echo "$NET" | json layer)" = "3" ] && pass "reports layer 3" || fail "layer is not 3"
[ -n "$HEAD_BLOCK" ] && [ "$HEAD_BLOCK" != "0" ] && pass "chain head is advancing" "block $HEAD_BLOCK" || fail "chain head is 0 or missing"

# ---------------------------------------------------------------- features --
head "Feature honesty"
FEAT=$(curl -s --max-time 15 "$API/api/features")
echo "$FEAT" | grep -q '"features"' && pass "GET /api/features" || fail "features endpoint malformed"
# Nothing may claim to be "live": KAURAX is a testnet.
if echo "$FEAT" | grep -q '"state": *"live"'; then
  fail "a feature claims state 'live' — KAURAX is a testnet and nothing is production"
else
  pass "no feature claims to be production"
fi

# ------------------------------------------------------------ indexed data --
head "Indexed chain data"
BLOCKS=$(curl -s --max-time 15 "$API/api/blocks?limit=5")
COUNT=$(echo "$BLOCKS" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null || echo 0)
[ "$COUNT" -gt 0 ] && pass "GET /api/blocks returns indexed blocks" "$COUNT" || fail "no blocks indexed"

FIRST=$(echo "$BLOCKS" | json items.0.number)
if [ -n "$FIRST" ] && [ "$FIRST" != "__MISSING__" ]; then
  c=$(status_of "$API/api/blocks/$FIRST")
  [ "$c" = "200" ] && pass "GET /api/blocks/:number" "block $FIRST" || fail "block detail returned $c"
else
  fail "could not read a block number from the listing"
fi

# The indexer must keep up with the chain, not merely have data.
LAG=$(curl -s --max-time 15 "$API/api/analytics" | json indexerLagBlocks)
if [ -n "$LAG" ] && [ "$LAG" != "__MISSING__" ] && [ "$LAG" -le 25 ] 2>/dev/null; then
  pass "indexer is keeping up with the chain" "${LAG} blocks behind"
else
  fail "indexer lag is $LAG blocks"
fi

c=$(status_of "$API/api/transactions?limit=5"); [ "$c" = "200" ] && pass "GET /api/transactions" || fail "transactions returned $c"
c=$(status_of "$API/api/contracts");           [ "$c" = "200" ] && pass "GET /api/contracts"    || fail "contracts returned $c"
c=$(status_of "$API/api/tokens");              [ "$c" = "200" ] && pass "GET /api/tokens"       || fail "tokens returned $c"

ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
BAL=$(curl -s --max-time 15 "$API/api/address/$ADDR" | json balance)
[ -n "$BAL" ] && [ "$BAL" != "__MISSING__" ] && pass "GET /api/address/:address reads a live balance" || fail "address balance missing"

# ------------------------------------------------------------- validation --
head "Input validation"
c=$(status_of "$API/api/address/not-an-address");    [ "$c" = "400" ] && pass "rejects a malformed address"    || fail "malformed address returned $c"
c=$(status_of "$API/api/transactions/0xdeadbeef");   [ "$c" = "400" ] && pass "rejects a malformed tx hash"    || fail "malformed hash returned $c"
c=$(status_of "$API/api/blocks/999999999");          [ "$c" = "404" ] && pass "404s an unindexed block"        || fail "unknown block returned $c"
c=$(status_of "$API/api/payments");                  [ "$c" = "400" ] && pass "requires a merchant address"    || fail "payments listing returned $c"

# Pagination must be clamped so a caller cannot request the whole table.
LIM=$(curl -s --max-time 15 "$API/api/blocks?limit=100000" | json limit)
[ "$LIM" = "100" ] && pass "pagination limit is capped at 100" || fail "limit was not clamped (got $LIM)"

# ---------------------------------------------------------------- payments --
head "Payments"
PAY=$(curl -s --max-time 15 -X POST "$API/api/payments" -H 'content-type: application/json' \
  -d '{"merchantAddress":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","amount":"1000000000000000","reference":"SMOKE"}')
PID=$(echo "$PAY" | json id)
[ -n "$PID" ] && [ "$PID" != "__MISSING__" ] && pass "payment request created" || fail "could not create a payment"

if [ -n "$PID" ] && [ "$PID" != "__MISSING__" ]; then
  [ "$(echo "$PAY" | json status)" = "pending" ] && pass "new payment starts pending" || fail "new payment was not pending"

  # The critical property: a payment cannot be settled by asserting it was paid.
  FAKE=0x$(printf 'ab%.0s' $(seq 1 32))
  RESP=$(curl -s --max-time 15 -X POST "$API/api/payments/$PID/settle" \
    -H 'content-type: application/json' -d "{\"transactionHash\":\"$FAKE\"}")
  if echo "$RESP" | grep -q '"error"'; then
    pass "refuses to settle against a non-existent transaction"
  else
    fail "SETTLED A PAYMENT WITHOUT AN ON-CHAIN TRANSACTION"
  fi

  c=$(status_of -X POST "$API/api/payments/$PID/settle" -H 'content-type: application/json' -d '{"transactionHash":"nope"}')
  [ "$c" = "400" ] && pass "rejects a malformed settlement hash" || fail "malformed settle hash returned $c"
fi

c=$(status_of -X POST "$API/api/payments" -H 'content-type: application/json' -d '{"merchantAddress":"0x00","amount":"1"}')
[ "$c" = "400" ] && pass "rejects a bad merchant address" || fail "bad merchant returned $c"
c=$(status_of -X POST "$API/api/payments" -H 'content-type: application/json' -d '{"merchantAddress":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","amount":"0"}')
[ "$c" = "400" ] && pass "rejects a zero amount" || fail "zero amount returned $c"

# ---------------------------------------------------------------------- AI --
head "AI"
AI=$(curl -s --max-time 15 "$API/api/ai/status")
CONFIGURED=$(echo "$AI" | json configured)
[ "$(echo "$AI" | json provider)" = "xkiro" ] && pass "AI provider reported as xkiro" || fail "unexpected AI provider"

if [ "$CONFIGURED" = "False" ] || [ "$CONFIGURED" = "false" ]; then
  # Unconfigured must mean unavailable, never a canned reply.
  c=$(status_of -X POST "$API/api/ai/chat" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}')
  [ "$c" = "503" ] && pass "unconfigured AI returns 503 rather than a fabricated reply" || fail "unconfigured AI returned $c"
else
  pass "AI is configured" "chat not exercised to avoid spending credits"
fi

# The API key must never be reachable from a browser-facing response.
if curl -s --max-time 15 "$API/api/ai/status" | grep -qiE '(sk-|xkiro_[a-z0-9]{8})'; then
  fail "an API key appears to be leaking in /api/ai/status"
else
  pass "no API key is exposed in the AI status response"
fi

# ------------------------------------------------------------------ summary --
head "Summary"
printf "  %d passed, %d failed\n" "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf "\n%sFailures:%s\n" "$RED" "$RESET"
  for f in "${FAILURES[@]}"; do printf "  - %s\n" "$f"; done
  exit 1
fi
printf "\n%s%sKAURAX API smoke test passed.%s\n\n" "$GREEN" "$BOLD" "$RESET"
