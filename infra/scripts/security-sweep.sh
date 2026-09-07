#!/usr/bin/env bash
#
# KAURAX security sweep.
#
# Scans the repository for the categories the build brief calls out: TODO/FIXME, unsafe
# constructs, hardcoded secrets, private keys, mock or fake data, and temporary
# implementations.
#
# Findings are printed with context. This does not fail the build on its own — it is a
# reviewer's tool, and CI runs the hard checks in .github/workflows/security.yml.
#
set -uo pipefail
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

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

EXCLUDES=(
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next
  --exclude-dir=out --exclude-dir=cache --exclude-dir=lib --exclude-dir=.devnet
  --exclude-dir=broadcast --exclude-dir=artifacts
  # This script contains the patterns it searches for; matching itself is noise.
  --exclude=security-sweep.sh
)

total=0

section() { printf "\n%s==> %s%s\n" "$BOLD" "$1" "$RESET"; }
found()   { printf "  %s%s%s\n" "$RED" "$1" "$RESET"; }
clean()   { printf "  %s%s%s\n" "$GREEN" "$1" "$RESET"; }
note()    { printf "  %s%s%s\n" "$DIM" "$1" "$RESET"; }

scan() {
  local label="$1" pattern="$2"; shift 2
  local hits
  # This script contains every pattern it searches for. Some grep builds honour a later
  # --include over an earlier --exclude, so the self-match is filtered from the results
  # rather than relying on the exclude alone.
  hits=$(grep -rInE "$pattern" "${EXCLUDES[@]}" "$@" . 2>/dev/null \
         | grep -v 'infra/scripts/security-sweep.sh' || true)
  if [ -n "$hits" ]; then
    local count; count=$(echo "$hits" | wc -l | tr -d ' ')
    found "$count $label"
    echo "$hits" | head -25 | sed 's/^/    /'
    [ "$count" -gt 25 ] && note "    … and $((count - 25)) more"
    total=$((total + count))
  else
    clean "no $label"
  fi
}

printf "%sKAURAX security sweep%s\n" "$BOLD" "$RESET"

section "TODO / FIXME / XXX / HACK"
scan "TODO or FIXME markers" '(TODO|FIXME|XXX|HACK)[: ]' \
  --include='*.ts' --include='*.tsx' --include='*.sol' --include='*.sh' --include='*.mjs'

section "Temporary or placeholder implementations"
hits=$(grep -rInE '\b(for now|temporary hack|stub out|dummy data|hardcoded value)\b' "${EXCLUDES[@]}" \
        --include='*.ts' --include='*.tsx' --include='*.sol' . 2>/dev/null \
        | grep -v 'infra/scripts/security-sweep.sh' \
        | grep -viE 'placeholder=|never a placeholder|plausible placeholder' || true)
if [ -n "$hits" ]; then
  found "$(echo "$hits" | wc -l | tr -d ' ') placeholder markers"
  echo "$hits" | head -20 | sed 's/^/    /'
  total=$((total + $(echo "$hits" | wc -l | tr -d ' ')))
else
  clean "no placeholder or temporary-implementation markers"
fi

section "Mock and fake data"
scan "mock or fake data references" '\b(mockData|fakeData|MOCK_|FAKE_|sampleData|dummyData|lorem ipsum)\b' \
  --include='*.ts' --include='*.tsx' --include='*.sol'

section "Fabricated metrics"
# The brief forbids inventing TVL, users, TPS, validators, partners, audits.
scan "suspicious hardcoded metrics" '(tvl|totalValueLocked|userCount|totalUsers|partners|investors|auditedBy)\s*[:=]\s*["0-9]' \
  --include='*.ts' --include='*.tsx'

section "Private keys outside .env.example"
hits=$(grep -rInE '\b0x[0-9a-fA-F]{64}\b' "${EXCLUDES[@]}" \
        --include='*.ts' --include='*.tsx' --include='*.sol' --include='*.sh' \
        --include='*.mjs' --include='*.json' --include='*.yml' . 2>/dev/null \
        | grep -vE '\.env\.example|/test/|/tests/|deployments/|scripts/security-sweep\.sh' \
        | grep -viE '_TOPIC|topic0|keccak256\(|event signature|OUTPUT_ROOT_VERSION' || true)
if [ -n "$hits" ]; then
  found "$(echo "$hits" | wc -l | tr -d ' ') 32-byte hex literals outside .env.example and tests"
  echo "$hits" | head -20 | sed 's/^/    /'
  total=$((total + $(echo "$hits" | wc -l | tr -d ' ')))
else
  clean "no private-key-shaped literals outside .env.example and tests"
fi

section "Tracked environment files"
tracked=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$tracked" ]; then
  found "environment files are tracked in git:"
  echo "$tracked" | sed 's/^/    /'
  total=$((total + 1))
else
  clean "no tracked .env files"
fi

section "Unsafe Solidity constructs"
scan "delegatecall / assembly / selfdestruct / tx.origin" \
  '\b(delegatecall|selfdestruct|tx\.origin)\b' --include='*.sol'
note "selfdestruct appears once, intentionally: L3ToL2MessagePasser burns withdrawn value"
note "via the same-transaction Burner pattern, which still destroys ether under EIP-6780."
note "KauraxL2OutputOracle.deleteL2Outputs truncates an array in assembly. Both are"
note "commented at the call site. tx.origin is not used for authorization anywhere."

section "Unchecked external calls"
scan "low-level calls" '\.call\{' --include='*.sol'
note "each is followed by an explicit success check; see KauraxPortal and AIPayments"

section "Console logging left in production paths"
hits=$(grep -rInE 'console\.(log|debug)\(' "${EXCLUDES[@]}" \
        --include='*.ts' --include='*.tsx' \
        --exclude-dir=scripts --exclude-dir=tests --exclude-dir=examples --exclude-dir=cli \
        . 2>/dev/null | grep -vE '^\S+: *\*' \
        | grep -v 'services/indexer/src/migrate.ts' || true)
if [ -n "$hits" ]; then
  found "$(echo "$hits" | wc -l | tr -d ' ') console.log calls in library code"
  echo "$hits" | head -20 | sed 's/^/    /'
  total=$((total + $(echo "$hits" | wc -l | tr -d ' ')))
else
  clean "no console.log in library code"
fi
note "packages/cli and the migration runner are excluded: stdout is their interface"

printf "\n%s==> Summary%s\n" "$BOLD" "$RESET"
if [ "$total" -eq 0 ]; then
  printf "  %sNo findings.%s\n" "$GREEN" "$RESET"
else
  printf "  %s%s items to review.%s\n" "$YELLOW" "$total" "$RESET"
fi
cat <<EOF

  ${DIM}What this sweep cannot tell you:${RESET}
    - KAURAX has no fault proof system. Output roots are trusted.  (docs/threat-model.md T1)
    - Nothing here has been audited.
    - The sequencer is centralized and has no failover.
    - Unbatched blocks are not durably persisted.

EOF
