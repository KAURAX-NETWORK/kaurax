#!/usr/bin/env bash
#
# Everything an external engineer needs to check KAURAX's claims, in one command.
#
#   ./tests/reproduce.sh              the full run, ~10-15 minutes
#   ./tests/reproduce.sh --with-chaos also inject faults (destructive, several minutes more)
#
# Each claim is paired with the suite that demonstrates it. The summary at the end says which
# held and which did not; a non-zero exit means at least one did not.
#
# The devnet is stopped on the way out whether or not the run succeeded — leaving a chain
# holding port 8420 is how the *next* run fails with an error about an orphan.
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

WITH_CHAOS=0
[ "${1:-}" = "--with-chaos" ] && WITH_CHAOS=1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
LOGDIR="$ROOT/.reproduce"
mkdir -p "$LOGDIR"

RESULTS=()
FAILED=0
DEVNET_UP=0

cleanup() {
  if [ "$DEVNET_UP" -eq 1 ]; then
    printf "\n${DIM}stopping the devnet${RESET}\n"
    ./infra/scripts/devnet/stop.sh >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

run() {
  # Separate statements on purpose: bash expands every argument to `local` before assigning
  # any of them, so a third initializer referring to the first sees it unset — which under
  # `set -u` wrote every suite's output to the same file named ".log".
  local claim="$1"
  local cmd="$2"
  local log
  log="$LOGDIR/$(printf '%s' "$claim" | tr ' /' '__').log"
  printf "\n${BOLD}==> %s${RESET}\n" "$claim"
  printf "${DIM}    %s${RESET}\n" "$cmd"
  if bash -c "$cmd" > "$log" 2>&1; then
    printf "    ${GREEN}held${RESET}  ${DIM}%s${RESET}\n" "$log"
    RESULTS+=("${GREEN}held${RESET}|$claim")
  else
    printf "    ${RED}FAILED${RESET}  ${DIM}%s${RESET}\n" "$log"
    printf "${DIM}%s${RESET}\n" "$(tail -20 "$log")"
    RESULTS+=("${RED}FAILED${RESET}|$claim")
    FAILED=1
  fi
}

printf "\n${BOLD}KAURAX — reproducing the claims${RESET}\n"
printf "${DIM}logs in %s${RESET}\n" "$LOGDIR"

# ------------------------------------------------------- no chain required --
run "Contracts behave as specified"            "cd blockchain/contracts && forge build --silent && forge test"
run "Node and services behave as specified"    "pnpm test"
run "The verifier agrees with the emulator"    "./tests/check-kvs-fixtures.sh"
run "Documented numbers match reality"         "./tests/check-doc-counts.sh"

# ------------------------------------------------------------ needs a chain --
printf "\n${BOLD}==> Starting the devnet${RESET}\n"
if ./infra/scripts/devnet/start.sh > "$LOGDIR/devnet-start.log" 2>&1; then
  DEVNET_UP=1
  printf "    ${GREEN}up${RESET}    ${DIM}%s${RESET}\n" "$LOGDIR/devnet-start.log"
else
  printf "    ${RED}FAILED${RESET}\n"
  printf "${DIM}%s${RESET}\n" "$(tail -25 "$LOGDIR/devnet-start.log")"
  RESULTS+=("${RED}FAILED${RESET}|The devnet starts")
  FAILED=1
fi

if [ "$DEVNET_UP" -eq 1 ]; then
  run "The chain runs end to end, and data is available" "./tests/acceptance.sh"
  run "A stranger can dispute and delete a bad root"     "./tests/dispute.sh"
  run "Censorship halts settlement"                      "./tests/forced-inclusion.sh"
  run "The application contracts work"                   "./tests/apps-smoke.sh"
  [ "$WITH_CHAOS" -eq 1 ] && run "The node survives injected failure" "./tests/chaos.sh"

  # Most devnets work once. This is the run that catches leftover state — a stale derivation
  # cursor, a sequencer WAL from a chain that no longer exists, an orphan holding a port.
  run "The devnet is restartable, not just startable" \
      "./infra/scripts/devnet/stop.sh && ./infra/scripts/devnet/start.sh && ./infra/scripts/devnet/status.sh"
fi

# ------------------------------------------------------------------ summary --
printf "\n${BOLD}Summary${RESET}\n"
for r in "${RESULTS[@]}"; do
  printf "  %b  %s\n" "${r%%|*}" "${r#*|}"
done

if [ "$WITH_CHAOS" -eq 0 ]; then
  printf "\n${DIM}Fault injection was not run. Add --with-chaos to include it.${RESET}\n"
fi

cat <<EOF

${BOLD}What a passing run does not establish${RESET}
  - Nothing verified that a disputed output root was wrong. In the dispute run the proposer
    conceded by walking away. A contested claim reaches the guardian, a 2-of-3 multisig.
  - KAURAX has no fault proof over its own execution, and no external audit.
  - The L1 and L2 here are anvil, not real chains.
  docs/REPRODUCIBLE_TESTNET_DEMO.md says this at length.
EOF

if [ "$FAILED" -ne 0 ]; then
  printf "\n${RED}${BOLD}At least one claim did not hold.${RESET}\n\n"
  exit 1
fi
printf "\n${GREEN}${BOLD}Every claim above held on this machine.${RESET}\n\n"
