#!/usr/bin/env bash
#
# Test counts appear in a dozen documents and have drifted four separate times, each caught by
# hand and each time only because someone happened to look. This is the check that stops it.
#
# docs/TEST_STATUS.md is canonical. Its totals must equal what the suites actually report, and
# no other document may state a different total for the same suite.
#
#   ./tests/check-doc-counts.sh
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

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
fail=0
bad()  { printf "  ${RED}FAIL${RESET}  %s\n" "$1"; fail=1; }
ok()   { printf "  ${GREEN}OK${RESET}    %s ${DIM}%s${RESET}\n" "$1" "${2:-}"; }

printf "\n${BOLD}Counting what the suites actually report${RESET}\n"

SOL="$( (cd blockchain/contracts && forge test 2>/dev/null) | grep -oE '[0-9]+ tests passed' | grep -oE '^[0-9]+' | tail -1)"
SUITES="$( (cd blockchain/contracts && forge test 2>/dev/null) | grep -oE 'Ran [0-9]+ test suites' | grep -oE '[0-9]+' | tail -1)"
NODE="$(pnpm test 2>/dev/null | grep -oE 'Tests  [0-9]+ passed' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s}')"

[ -n "$SOL" ] && [ -n "$NODE" ] || { printf "${RED}could not read counts — is the toolchain installed?${RESET}\n"; exit 1; }
ok "forge test" "$SOL tests in $SUITES suites"
ok "pnpm test" "$NODE tests"

printf "\n${BOLD}docs/TEST_STATUS.md is canonical${RESET}\n"
CANON="docs/TEST_STATUS.md"
grep -q "\*\*${SOL} passed" "$CANON" && ok "solidity total" || bad "$CANON does not say ${SOL} passed"
grep -qE "\| Solidity \| \*\*${SOL}\*\* \|" "$CANON" && ok "solidity in the totals table" \
  || bad "$CANON totals table does not say **${SOL}**"
grep -qE "\| Node and services \| \*\*${NODE}\*\* \|" "$CANON" && ok "node in the totals table" \
  || bad "$CANON totals table does not say **${NODE}**"

printf "\n${BOLD}No document may state a different total${RESET}\n"
# Only lines that actually claim a `forge test` or `pnpm test` total. Per-suite figures ("47
# acceptance checks", "12 live end-to-end") are legitimate and must not be flagged, and an
# earlier version of this check did flag them — a gate that cries wolf gets switched off.
#
# Historical snapshots are excluded by name: they record what was true on a date and are
# supposed to differ from today.
SNAPSHOTS="KAURAX_DEPLOYMENT_STATUS.md|KAURAX_INFRA_AUDIT.md|SECURITY_REVIEW.md|PUBLIC_RELEASE_AUDIT.md|FINAL_TESTNET_REPORT.md|FAULT_PROOF_AUDIT.md"
STALE=0
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; text="${rest#*:}"
  printf '%s' "$file" | grep -qE "$SNAPSHOTS" && continue

  num="$(printf '%s' "$text" | grep -oE '[0-9]{2,4} passed' | grep -oE '^[0-9]+' | head -1)"
  [ -n "$num" ] || continue

  if printf '%s' "$text" | grep -q 'forge test'; then
    [ "$num" = "$SOL" ] || { bad "$file:$line claims forge test = $num, actual $SOL"; STALE=1; }
  elif printf '%s' "$text" | grep -q 'pnpm test'; then
    [ "$num" = "$NODE" ] || { bad "$file:$line claims pnpm test = $num, actual $NODE"; STALE=1; }
  fi
done < <(grep -rnE '(forge test|pnpm test)' --include='*.md' --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null)
[ "$STALE" -eq 0 ] && ok "no document contradicts the suites"

printf "\n"
if [ "$fail" -ne 0 ]; then
  printf "${RED}${BOLD}Documented test counts do not match reality.${RESET}\n"
  printf "Re-run the suites and update the numbers. Do not adjust the check.\n\n"
  exit 1
fi
printf "${GREEN}${BOLD}Documented test counts match the suites.${RESET}\n\n"
