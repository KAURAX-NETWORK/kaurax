#!/usr/bin/env bash
# Exercise the deployed dispute game against a running devnet.
set -euo pipefail
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
[ -f .env ] || { echo "No .env — run infra/scripts/devnet/start.sh first."; exit 1; }
exec pnpm -s exec tsx tests/dispute.ts
