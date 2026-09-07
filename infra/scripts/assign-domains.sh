#!/usr/bin/env bash
#
# Assign *.kaurax.network to the Vercel projects that serve them.
#
# Only the frontends live on Vercel. The chain itself does not and cannot: rpc, ws and api
# are long-lived stateful services on the VPS, so those records point at the server's IP
# and are configured at the DNS provider, not here. This script prints them rather than
# pretending to own them.
#
#   infra/scripts/assign-domains.sh            # assign everything
#   infra/scripts/assign-domains.sh --dry-run  # show what would be assigned
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

SCOPE="${SCOPE:-kmks-projects}"
DOMAIN="${KAURAX_DOMAIN:-kaurax.network}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

# project        host
MAP="
web:@
web:www
explorer:explorer
wallet:wallet
bridge:bridge
pay:pay
ai:ai
swap:swap
names:names
launchpad:launchpad
docs:docs
"

printf '%sAssigning %s subdomains%s  %sscope: %s%s\n\n' "$BOLD" "$DOMAIN" "$RESET" "$DIM" "$SCOPE" "$RESET"

OK=0; FAILED=0
for entry in $MAP; do
  app="${entry%%:*}"; host="${entry##*:}"
  if [ "$host" = "@" ]; then FQDN="$DOMAIN"; else FQDN="$host.$DOMAIN"; fi

  if [ "$DRY" -eq 1 ]; then
    printf '  %-34s -> kaurax-%s\n' "$FQDN" "$app"
    continue
  fi

  OUT="$(vercel domains add "$FQDN" "kaurax-$app" --scope "$SCOPE" 2>&1)"
  if printf '%s' "$OUT" | grep -qiE "success|assigned|already"; then
    printf '  %s✓%s %-34s -> kaurax-%s\n' "$GREEN" "$RESET" "$FQDN" "$app"
    OK=$((OK+1))
  else
    printf '  %s✗%s %-34s %s\n' "$RED" "$RESET" "$FQDN" "$(printf '%s' "$OUT" | grep -iE 'error' | head -1)"
    FAILED=$((FAILED+1))
  fi
done

[ "$DRY" -eq 1 ] && exit 0

printf '\n%s%d assigned, %d failed%s\n' "$BOLD" "$OK" "$FAILED" "$RESET"

cat <<EOF

${BOLD}Records that are NOT Vercel's to serve${RESET}
${DIM}The chain endpoints are stateful services on the VPS. Point them at the server:${RESET}

  rpc.$DOMAIN        A     <vps-ip>     KAURAX JSON-RPC   (nginx -> kaurax-l3:8420)
  ws.$DOMAIN         A     <vps-ip>     KAURAX WebSocket  (nginx -> kaurax-l3:8421)
  api.$DOMAIN        A     <vps-ip>     backend API       (nginx -> api:7300)

${DIM}Never expose: the L3 execution engine, PostgreSQL, Grafana, or the signing service.
See infra/upcloud/README.md.${RESET}
EOF
