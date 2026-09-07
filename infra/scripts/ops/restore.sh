#!/usr/bin/env bash
#
# KAURAX PostgreSQL restore.
#
# Restores a dump produced by backup.sh. Deliberately awkward to run against the live
# database: it verifies the checksum first, tells you exactly what it is about to
# overwrite, and requires you to type the database name to confirm.
#
# Usage:
#   infra/scripts/ops/restore.sh /var/backups/kaurax/kaurax-kaurax-2026….dump
#   infra/scripts/ops/restore.sh --latest
#   infra/scripts/ops/restore.sh --latest --into kaurax_dryrun   # rehearse without risk
set -euo pipefail

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

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

[ -f .env ] && set -a && . ./.env && set +a
: "${POSTGRES_USER:?POSTGRES_USER is not set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set}"
LIVE_DB="${POSTGRES_DB:-kaurax}"
PG_CONTAINER="${PG_CONTAINER:-kaurax-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/kaurax}"

FILE=""; TARGET="$LIVE_DB"; ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --latest) FILE="$(ls -1t "$BACKUP_DIR"/kaurax-*.dump 2>/dev/null | head -1)"; shift ;;
    --into)   TARGET="${2:?--into needs a database name}"; shift 2 ;;
    --yes)    ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) FILE="$1"; shift ;;
  esac
done

[ -n "$FILE" ] || die "no dump given. Pass a path or --latest."
[ -f "$FILE" ] || die "no such file: $FILE"
docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || die "container $PG_CONTAINER is not running"

# Verify the checksum before trusting the file. A silently corrupted dump restored over a
# live database is the worst outcome available here.
if [ -f "$FILE.sha256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$FILE" | cut -d' ' -f1)"
  else ACTUAL="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"; fi
  EXPECTED="$(cut -d' ' -f1 < "$FILE.sha256")"
  [ "$ACTUAL" = "$EXPECTED" ] || die "checksum mismatch: this dump is corrupt. Do not restore it."
  ok "checksum verified"
else
  warn "no .sha256 alongside this dump — integrity cannot be confirmed"
fi

printf '%sAbout to restore%s\n' "$BOLD" "$RESET"
printf '  dump   : %s (%s)\n' "$FILE" "$(date -r "$FILE" -u '+%Y-%m-%d %H:%M UTC' 2>/dev/null || echo 'unknown date')"
printf '  into   : %s on %s\n' "$TARGET" "$PG_CONTAINER"

if [ "$TARGET" = "$LIVE_DB" ]; then
  printf '  %sthis is the LIVE database — its current contents will be replaced%s\n' "$RED" "$RESET"
  if [ "$ASSUME_YES" -ne 1 ]; then
    printf 'Type the database name (%s) to continue: ' "$TARGET"
    read -r CONFIRM
    [ "$CONFIRM" = "$TARGET" ] || die "aborted"
  fi
  # Stop the writers first. Restoring underneath a running indexer produces a database
  # that is neither the backup nor the present.
  warn "stopping indexer and api so nothing writes during the restore"
  docker compose stop indexer api >/dev/null 2>&1 || true
fi

exec_pg() { docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" "$@"; }

exec_pg psql -U "$POSTGRES_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$TARGET'" | grep -q 1 && EXISTS=1 || EXISTS=0

if [ "$EXISTS" -eq 1 ]; then
  # Terminate stragglers, or dropdb blocks forever on one idle connection.
  exec_pg psql -U "$POSTGRES_USER" -d postgres -tAc \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET' AND pid <> pg_backend_pid()" >/dev/null
  exec_pg dropdb -U "$POSTGRES_USER" "$TARGET"
fi
exec_pg createdb -U "$POSTGRES_USER" "$TARGET"

docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  pg_restore -U "$POSTGRES_USER" -d "$TARGET" --no-owner --no-privileges < "$FILE" \
  || die "pg_restore failed"

for TABLE in blocks transactions logs; do
  N="$(exec_pg psql -U "$POSTGRES_USER" -d "$TARGET" -tAc "SELECT count(*) FROM $TABLE" 2>/dev/null | tr -d ' \r')"
  ok "$TABLE: ${N:-?} rows"
done

if [ "$TARGET" = "$LIVE_DB" ]; then
  docker compose start indexer api >/dev/null 2>&1 || true
  ok "indexer and api restarted"
  # The indexer resumes from the restored head and catches up from chain; it does not need
  # to be told where it was.
  printf 'Watch it catch up:  curl -s localhost/api/health | jq .checks\n'
fi
ok "restore complete into $TARGET"
