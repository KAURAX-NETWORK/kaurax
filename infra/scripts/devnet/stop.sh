#!/usr/bin/env bash
# Stop every process started by infra/scripts/devnet/start.sh. Safe to run when nothing is up.
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
RUN_DIR="$ROOT/.devnet"
QUIET="${1:-}"

say() { [ "$QUIET" = "--quiet" ] || printf "%s\n" "$1"; }

for name in kaurax-node l3-engine l2 l1; do
  pidfile="$RUN_DIR/$name.pid"
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
    say "stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done

say "KAURAX devnet stopped."
