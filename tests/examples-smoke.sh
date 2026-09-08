#!/usr/bin/env bash
#
# Runs every example against a live chain and fails if one of them does not work.
#
# Examples rot faster than anything else in a repository: they are read constantly and run
# almost never. This is the check that they still do what their README says.
#
#   ./tests/examples-smoke.sh                       # against the local devnet
#   KAURAX_RPC_URL=https://kaurax.network/rpc ./tests/examples-smoke.sh
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

RPC="${KAURAX_RPC_URL:-http://127.0.0.1:8420}"
BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
pass=0; fail=0
ok()   { printf "  ${GREEN}PASS${RESET}  %s ${DIM}%s${RESET}\n" "$1" "${2:-}"; pass=$((pass+1)); }
bad()  { printf "  ${RED}FAIL${RESET}  %s ${DIM}%s${RESET}\n" "$1" "${2:-}"; fail=$((fail+1)); }
step() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

step "0. A chain to run against"
CHAIN=$(curl -s -m 15 -X POST "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | sed 's/.*"result":"//;s/".*//')
if [ -z "$CHAIN" ]; then
  printf "${RED}no node at %s${RESET}  start one with ./infra/scripts/devnet/start.sh\n" "$RPC"
  exit 1
fi
ok "node reachable" "chain $((CHAIN)) at $RPC"

step "1. examples/basic-contract — tests"
if (cd examples/basic-contract && forge test >/dev/null 2>&1); then
  ok "forge test" "6 tests including a re-entrancy attack"
else
  bad "forge test" "run it in examples/basic-contract for the output"
fi

step "2. examples/hello-world — deploy and call"
if [ ! -f blockchain/contracts/out/HelloKaurax.sol/HelloKaurax.json ]; then
  (cd blockchain/contracts && forge build >/dev/null 2>&1) || true
fi
OUT=$(KAURAX_RPC_URL="$RPC" node examples/hello-world/deploy.mjs 2>&1)
if echo "$OUT" | grep -q "Hello from examples/hello-world"; then
  ADDR=$(echo "$OUT" | awk '/^deployed/ {print $2}')
  ok "deployed and wrote state" "$ADDR"
else
  bad "hello-world" "$(echo "$OUT" | tail -2 | tr '\n' ' ')"
fi

step "3. examples/basic-frontend — no build, no dependencies"
# An assignment, not the word. The page's own explanatory text mentions innerHTML, and a
# substring match flagged that — a check that fires on documentation about the rule is worse
# than no check, because the fix is to stop documenting it.
if grep -qE '\.(innerHTML|outerHTML)[[:space:]]*=|insertAdjacentHTML' examples/basic-frontend/index.html; then
  bad "assigns chain data into HTML" "chain data is attacker-controlled"
else
  ok "renders with textContent only" "no XSS surface from chain data"
fi
if grep -qE '<script[^>]+src=' examples/basic-frontend/index.html; then
  bad "loads an external script" "the README claims no dependencies"
else
  ok "no external scripts" "matches the README"
fi

printf "\n${BOLD}Summary${RESET}\n  %d passed, %d failed\n" "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
printf "\n${GREEN}${BOLD}Examples work.${RESET}\n"
