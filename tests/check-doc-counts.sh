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

# stderr is kept, not discarded. Swallowing it turned "forge-std is missing" into a blank
# variable and a generic "is the toolchain installed?", which says nothing a reader can act
# on — the same failure this whole gate exists to prevent, in the gate itself.
# Colour codes are stripped before matching. A terminal-less local run is plain text, but CI
# forces colour, so vitest writes "Tests \e[1m\e[32m10 passed" and a pattern expecting
# "Tests  10 passed" finds nothing — which is how this gate failed only on CI while passing
# on every machine it was written on.
strip_ansi() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'; }

FORGE_OUT="$( (cd blockchain/contracts && forge test 2>&1) | strip_ansi )"
SOL="$(printf '%s' "$FORGE_OUT" | grep -oE '[0-9]+ tests passed' | grep -oE '^[0-9]+' | tail -1)"
SUITES="$(printf '%s' "$FORGE_OUT" | grep -oE 'Ran [0-9]+ test suites' | grep -oE '[0-9]+' | tail -1)"

NODE_OUT="$(pnpm test 2>&1 | strip_ansi)"
NODE="$(printf '%s' "$NODE_OUT" | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s}')"

if [ -z "$SOL" ]; then
  printf "${RED}could not read a solidity count from \`forge test\`${RESET}\n"
  printf "${DIM}%s${RESET}\n" "$(printf '%s' "$FORGE_OUT" | tail -15)"
  exit 1
fi
if [ -z "$NODE" ]; then
  printf "${RED}could not read a node count from \`pnpm test\`${RESET}\n"
  printf "${DIM}%s${RESET}\n" "$(printf '%s' "$NODE_OUT" | tail -15)"
  exit 1
fi
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
SNAPSHOTS="KAURAX_DEPLOYMENT_STATUS.md|KAURAX_INFRA_AUDIT.md|SECURITY_REVIEW.md|PUBLIC_RELEASE_AUDIT.md|FINAL_TESTNET_REPORT.md|FAULT_PROOF_AUDIT.md|PUBLIC_RELEASE_CHECKLIST.md|KAURAX_COMPLETION_REPORT.md|FINAL_READINESS_REPORT.md"
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

printf "\n${BOLD}The canonical per-suite table must reconcile${RESET}\n"
# The grand total can be right while the table under it is wrong: TimelockSelfAdmin.t.sol was
# missing for sixteen tests and the rows summed to 322 against a stated 338. A table that does
# not add up is worse than no table, because it looks like evidence.
FORGE_SUITES="$(printf '%s' "$FORGE_OUT" | grep -oE 'Ran [0-9]+ tests for test/[A-Za-z0-9_]+\.t\.sol' \
  | sed -E 's|Ran ([0-9]+) tests for test/([A-Za-z0-9_]+)\.t\.sol|\2 \1|' | sort -u)"
TABLE="$(awk '/^## Solidity/{f=1;next} /^## Node and services/{f=0} f' "$CANON" \
  | grep -oE '^\| `[A-Za-z0-9_]+\.t\.sol` \| [0-9]+' \
  | sed -E 's@^\| `([A-Za-z0-9_]+)\.t\.sol` \| ([0-9]+)@\1 \2@' | sort -u)"

TABLE_BAD=0
while read -r sname scount; do
  [ -n "$sname" ] || continue
  row="$(printf '%s\n' "$TABLE" | awk -v n="$sname" '$1==n {print $2}')"
  if [ -z "$row" ]; then
    bad "$CANON has no row for ${sname}.t.sol, which ran $scount tests"; TABLE_BAD=1
  elif [ "$row" != "$scount" ]; then
    bad "$CANON says ${sname}.t.sol has $row tests; forge ran $scount"; TABLE_BAD=1
  fi
done < <(printf '%s\n' "$FORGE_SUITES")

SUM="$(printf '%s\n' "$TABLE" | awk '{s+=$2} END {print s+0}')"
[ "$SUM" = "$SOL" ] || { bad "$CANON per-suite rows sum to $SUM, but the suite total is $SOL"; TABLE_BAD=1; }
[ "$TABLE_BAD" -eq 0 ] && ok "every suite has a row, and the rows sum to $SOL"

printf "\n${BOLD}Prose counts must agree as well as totals${RESET}\n"
# The README said "262 contract · 121 node" for two rounds while this gate passed, because it
# only ever looked at lines mentioning `forge test` or `pnpm test`.
#
# The pattern is deliberately narrow. "46 contract-level" is a per-suite figure, "34 Solidity
# SPDX headers" is not a test count, and "6,072 Solidity" is a line count — none may be
# flagged. So the number must not follow a digit or comma, and what comes after the language
# word must be a tests word or a separator, never another noun.
PROSE_RE='(^|[^0-9,])([0-9]{2,4}) (contract|node|Solidity)( tests?[^-A-Za-z]| ·| \||,|$)'
PROSE_BAD=0
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; text="${rest#*:}"
  printf '%s' "$file" | grep -qE "$SNAPSHOTS" && continue
  while read -r pnum pword; do
    [ -n "$pnum" ] || continue
    case "$pword" in
      contract|Solidity) [ "$pnum" = "$SOL" ]  || { bad "$file:$line says $pnum $pword tests, actual $SOL"; PROSE_BAD=1; } ;;
      node)              [ "$pnum" = "$NODE" ] || { bad "$file:$line says $pnum node tests, actual $NODE"; PROSE_BAD=1; } ;;
    esac
  done < <(printf '%s' "$text" | grep -oE "$PROSE_RE" \
             | sed -E 's/^[^0-9]*//; s/^([0-9]+) (contract|node|Solidity).*/\1 \2/')
done < <(grep -rnE "$PROSE_RE" --include='*.md' --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null)
[ "$PROSE_BAD" -eq 0 ] && ok "no prose count contradicts the suites"

printf "\n${BOLD}The readiness score is stated in one place${RESET}\n"
# The score had drifted into thirteen documents with nothing checking them against each
# other, which is how the test counts got out of hand. MAINNET_READINESS.md is canonical.
SCORE="$(grep -oE '^## Score: [0-9]{1,3}/100' MAINNET_READINESS.md | grep -oE '[0-9]{1,3}/100' | head -1)"
if [ -z "$SCORE" ]; then
  bad "MAINNET_READINESS.md has no '## Score: N/100' heading to be canonical"
else
  ok "MAINNET_READINESS.md scores" "$SCORE"
  SCORE_BAD=0
  while IFS= read -r hit; do
    file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; text="${rest#*:}"
    printf '%s' "$file" | grep -qE "$SNAPSHOTS" && continue
    found="$(printf '%s' "$text" | grep -oE '[0-9]{1,3}/100' | head -1)"
    [ -n "$found" ] || continue
    [ "$found" = "$SCORE" ] || { bad "$file:$line says $found, the scorecard says $SCORE"; SCORE_BAD=1; }
  done < <(grep -rnE '[0-9]{1,3}/100' --include='*.md' --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null)
  [ "$SCORE_BAD" -eq 0 ] && ok "no document contradicts the scorecard"
fi

printf "\n"
if [ "$fail" -ne 0 ]; then
  printf "${RED}${BOLD}Documented test counts do not match reality.${RESET}\n"
  printf "Re-run the suites and update the numbers. Do not adjust the check.\n\n"
  exit 1
fi
printf "${GREEN}${BOLD}Documented test counts match the suites.${RESET}\n\n"
