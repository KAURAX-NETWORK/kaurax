#!/usr/bin/env bash
#
# KAURAX PostgreSQL backup.
#
# Takes a compressed custom-format dump, records a checksum, and — unless told not to —
# immediately restores it into a scratch database and verifies the restore. A backup that
# has never been restored is a hypothesis, not a backup.
#
# The chain itself is not backed up here and does not need to be: every block is
# reconstructible from L2 calldata (see docs/data-availability.md). What is *not*
# reconstructible cheaply is the indexer's derived state, which is what this protects.
#
# Usage:
#   infra/scripts/ops/backup.sh                  # dump + verify restore
#   infra/scripts/ops/backup.sh --no-verify      # dump only (faster; use sparingly)
#   infra/scripts/ops/backup.sh --dir /mnt/backups
#
# Environment:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB   from .env
#   BACKUP_DIR         default /var/backups/kaurax
#   BACKUP_RETAIN_DAYS default 14
#   PG_CONTAINER       default kaurax-postgres
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
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

VERIFY=1
BACKUP_DIR="${BACKUP_DIR:-/var/backups/kaurax}"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-verify) VERIFY=0; shift ;;
    --dir) BACKUP_DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# .env holds the credentials. It is never committed; see .gitignore.
[ -f .env ] && set -a && . ./.env && set +a
: "${POSTGRES_USER:?POSTGRES_USER is not set. Copy .env.example to .env and fill it in.}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set.}"
DB="${POSTGRES_DB:-kaurax}"
PG_CONTAINER="${PG_CONTAINER:-kaurax-postgres}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || die "container $PG_CONTAINER is not running"

mkdir -p "$BACKUP_DIR"
# The dump contains every indexed address and transaction. Not world-readable.
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/kaurax-$DB-$STAMP.dump"

say "${BOLD}KAURAX backup${RESET}  database=$DB  ->  $FILE"

# -Fc (custom format) so pg_restore can do selective restores and parallel loads later.
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$DB" -Fc --no-owner --no-privileges \
  > "$FILE" || die "pg_dump failed"

chmod 600 "$FILE"
SIZE="$(wc -c < "$FILE" | tr -d ' ')"
[ "$SIZE" -gt 1024 ] || die "dump is only ${SIZE} bytes — refusing to treat that as a backup"

# A checksum recorded at write time is the only way to tell later whether the file rotted.
if command -v sha256sum >/dev/null 2>&1; then SUM="$(sha256sum "$FILE" | cut -d' ' -f1)"
else SUM="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"; fi
printf '%s  %s\n' "$SUM" "$(basename "$FILE")" > "$FILE.sha256"
ok "dump written ($(printf '%s' "$SIZE" | awk '{printf "%.1f MB", $1/1048576}')), sha256 ${SUM:0:16}…"

# ------------------------------------------------------- restore verification --
if [ "$VERIFY" -eq 1 ]; then
  SCRATCH="kaurax_restore_check_$$"
  say "verifying by restoring into $SCRATCH"

  cleanup() {
    docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
      dropdb -U "$POSTGRES_USER" --if-exists "$SCRATCH" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
    createdb -U "$POSTGRES_USER" "$SCRATCH" || die "could not create scratch database"

  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
    pg_restore -U "$POSTGRES_USER" -d "$SCRATCH" --no-owner --no-privileges < "$FILE" \
    || die "pg_restore failed — THIS BACKUP IS NOT USABLE"

  # Restoring without error is not the same as restoring the data. Compare row counts.
  count_in() {
    docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CONTAINER" \
      psql -U "$POSTGRES_USER" -d "$1" -tAc "SELECT count(*) FROM $2" 2>/dev/null | tr -d ' \r'
  }

  FAILED=0
  for TABLE in blocks transactions logs; do
    SRC="$(count_in "$DB" "$TABLE")"
    DST="$(count_in "$SCRATCH" "$TABLE")"
    if [ -z "$SRC" ] || [ -z "$DST" ]; then
      warn "$TABLE: could not be counted in one of the databases (src='$SRC' restored='$DST')"
      FAILED=1
    elif [ "$SRC" != "$DST" ]; then
      # A live chain may add rows mid-dump, so the restore may legitimately lag slightly —
      # but it must never be ahead, and never dramatically behind.
      DIFF=$(( SRC - DST ))
      if [ "$DIFF" -lt 0 ] || [ "$DIFF" -gt 1000 ]; then
        printf '%s✗%s %s: source %s, restored %s\n' "$RED" "$RESET" "$TABLE" "$SRC" "$DST"
        FAILED=1
      else
        ok "$TABLE: $DST rows restored (source has $SRC; $DIFF written during the dump)"
      fi
    else
      ok "$TABLE: $DST rows restored, exact match"
    fi
  done

  cleanup
  trap - EXIT
  [ "$FAILED" -eq 0 ] || die "restore verification failed — do not rely on $FILE"
  ok "restore verified"
else
  warn "restore NOT verified (--no-verify). This backup is unproven."
fi

# ------------------------------------------------------------------ retention --
DELETED=0
while IFS= read -r old; do
  rm -f "$old" "$old.sha256"
  DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "kaurax-$DB-*.dump" -type f -mtime "+$RETAIN_DAYS" 2>/dev/null)
[ "$DELETED" -gt 0 ] && say "pruned $DELETED backup(s) older than $RETAIN_DAYS days"

REMAINING="$(find "$BACKUP_DIR" -maxdepth 1 -name "kaurax-$DB-*.dump" -type f 2>/dev/null | wc -l | tr -d ' ')"
ok "done — $REMAINING backup(s) retained in $BACKUP_DIR"
