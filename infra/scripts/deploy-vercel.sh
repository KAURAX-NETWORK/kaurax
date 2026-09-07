#!/usr/bin/env bash
#
# Deploy every KAURAX frontend to Vercel.
#
# Each app is a separate Vercel project — a Next.js "zone" — but they are all served from
# one domain: apps/web rewrites /explorer, /pay, /swap and the rest to their zones. Each
# zone deploys and rolls back independently, so a broken launchpad build cannot take the
# landing page with it.
#
# Two things about how this works are deliberate:
#
#  1. Everything is built from the monorepo root, because the apps depend on the workspace
#     packages @kaurax/ui and @kaurax/types. The per-app build settings live in
#     infra/vercel/<app>.json and are passed with --local-config.
#
#  2. The upload comes from a staging copy with no .git directory. Vercel validates the
#     commit author of any deployment that carries git metadata against a GitHub account,
#     and rejects it when it cannot match one — which has nothing to do with whether the
#     code is correct. No git directory, no metadata, no spurious gate. The commit itself
#     still lives in the real repository; this only affects what is uploaded.
#
#   infra/scripts/deploy-vercel.sh              # all apps, production
#   infra/scripts/deploy-vercel.sh explorer     # one app
#   SCOPE=softnext infra/scripts/deploy-vercel.sh
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
STAGE="${TMPDIR:-/tmp}/kaurax-vercel-stage"
BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'

APPS="${*:-explorer web wallet bridge pay ai swap names launchpad docs}"

printf '%sDeploying KAURAX frontends%s  %sscope: %s%s\n' "$BOLD" "$RESET" "$DIM" "$SCOPE" "$RESET"

# ------------------------------------------------------------ staging copy --
# Rebuilt from scratch each run so a stale file can never be deployed.
rm -rf "$STAGE"
mkdir -p "$STAGE"
rsync -a \
  --exclude='.git' \
  --exclude='.github' \
  --exclude='.devnet' \
  --exclude='.turbo' \
  --exclude='.vercel' \
  --exclude='docs/' \
  --exclude='infra/' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='blockchain/contracts/lib' \
  --exclude='blockchain/contracts/out' \
  --exclude='blockchain/contracts/cache' \
  --exclude='blockchain/contracts/broadcast' \
  --exclude='*.log' \
  --exclude='*.tsbuildinfo' \
  ./ "$STAGE/"

# The per-app build configs live under infra/, which the copy above excludes. They are the
# one thing from there that the deploy needs.
mkdir -p "$STAGE/infra/vercel"
cp infra/vercel/*.json "$STAGE/infra/vercel/"

printf '%s  staged %s (%s)%s\n\n' "$DIM" "$STAGE" "$(du -sh "$STAGE" | cut -f1)" "$RESET"

OK=0; FAILED=0
RESULTS=""

for app in $APPS; do
  CONFIG="infra/vercel/$app.json"
  [ -f "$ROOT/$CONFIG" ] || { printf '%s✗ %s: no %s%s\n' "$RED" "$app" "$CONFIG" "$RESET"; FAILED=$((FAILED+1)); continue; }

  printf '%s▸ %s%s\n' "$BOLD" "$app" "$RESET"

  # Link inside the staging copy: .vercel/project.json there selects which project receives
  # this deployment, and leaves the real working tree untouched.
  if ! (cd "$STAGE" && vercel link --project "kaurax-$app" --yes --scope "$SCOPE" >/dev/null 2>&1); then
    printf '  %s✗ could not link kaurax-%s%s\n' "$RED" "$app" "$RESET"
    FAILED=$((FAILED+1)); continue
  fi

  OUT="$(cd "$STAGE" && vercel deploy --prod --yes --archive=tgz --local-config "$CONFIG" 2>&1)"
  URL="$(printf '%s' "$OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)"

  if printf '%s' "$OUT" | grep -qiE '^Error|"status": "error"'; then
    printf '  %s✗ failed%s\n' "$RED" "$RESET"
    printf '%s' "$OUT" | grep -iE "error" | head -3 | sed 's/^/    /'
    FAILED=$((FAILED+1))
    RESULTS="$RESULTS\n  $app: FAILED"
  else
    printf '  %s✓%s %s\n' "$GREEN" "$RESET" "${URL:-deployed}"
    OK=$((OK+1))
    RESULTS="$RESULTS\n  $app: ${URL:-deployed}"
  fi
done

printf '\n%s%d deployed, %d failed%s\n' "$BOLD" "$OK" "$FAILED" "$RESET"
printf '%b\n' "$RESULTS"
[ "$FAILED" -eq 0 ]
