#!/usr/bin/env bash
# Start (or stop) the whole KAURAX frontend suite locally, one app per port.
#   infra/scripts/devnet/apps.sh start|stop
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
RUN_DIR="$ROOT/.devnet"; mkdir -p "$RUN_DIR"

APPS="explorer:3000 web:3010 wallet:3011 bridge:3012 pay:3013 ai:3014 swap:3015 names:3016 launchpad:3017 docs:3018"

case "${1:-start}" in
  start)
    set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
    for entry in $APPS; do
      name="${entry%%:*}"; port="${entry##*:}"
      ( cd "apps/$name" && PORT="$port" exec npx next start -p "$port" > "$RUN_DIR/app-$name.log" 2>&1 & echo $! > "$RUN_DIR/app-$name.pid" )
      printf "  started %-10s http://127.0.0.1:%s\n" "$name" "$port"
    done
    echo "  (logs in .devnet/app-*.log)"
    ;;
  stop)
    for entry in $APPS; do
      name="${entry%%:*}"; port="${entry##*:}"
      # Kill whatever actually holds the port: `next start` re-execs, so the recorded PID
      # is not reliably the listening process.
      holder="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
      if [ -n "$holder" ]; then
        kill $holder 2>/dev/null
        sleep 0.2
        kill -9 $holder 2>/dev/null
        echo "  stopped $name (:$port)"
      fi
      rm -f "$RUN_DIR/app-$name.pid"
    done
    ;;
  *) echo "usage: apps.sh start|stop" >&2; exit 1 ;;
esac
