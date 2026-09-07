#!/usr/bin/env bash
# Verify the KAURAX application contracts (Names, Swap, Launchpad) against a running devnet,
# through the same ABIs the frontends use.
set -euo pipefail
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
[ -f .env ] || { echo "No .env — run infra/scripts/devnet/start.sh first."; exit 1; }
exec pnpm -s exec tsx tests/apps-smoke.ts
