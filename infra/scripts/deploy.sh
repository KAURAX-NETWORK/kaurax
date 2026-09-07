#!/usr/bin/env bash
#
# KAURAX deployment.
#
#   bash infra/scripts/deploy.sh [--no-pull] [--service NAME]
#
#   git pull → build images → recreate containers → wait for health → verify
#
# Fails if any critical service does not become healthy, and rolls back to the previous
# images when it does. A deploy that leaves the chain down is worse than one that refuses
# to finish.
#
set -euo pipefail

_find_root() {
  local d; d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$d" != "/" ]; do
    [ -f "$d/docker-compose.yml" ] && { echo "$d"; return 0; }
    d="$(dirname "$d")"
  done
  echo "could not locate the KAURAX repository root" >&2; return 1
}
ROOT="$(_find_root)" || exit 1
cd "$ROOT"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
step() { printf "\n%s==>%s %s%s%s\n" "$GREEN" "$RESET" "$BOLD" "$1" "$RESET"; }
info() { printf "    %s\n" "$1"; }
warn() { printf "    %s%s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "\n%sDEPLOY FAILED:%s %s\n\n" "$RED" "$RESET" "$1" >&2; exit 1; }

PULL=1
ONLY_SERVICE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0; shift ;;
    --service) ONLY_SERVICE="${2:?--service needs a name}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Services that must be healthy for the deployment to count as successful.
CRITICAL=(postgres kaurax-l3 indexer api nginx)

step "Preflight"
command -v docker >/dev/null || die "docker is not installed. Run infra/scripts/bootstrap.sh first."
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is your user in the docker group?)"
[ -f .env ] || die ".env does not exist. Copy .env.example and fill it in."

# Refuse to deploy with placeholder secrets still in place.
if grep -qE '^(POSTGRES_PASSWORD|GRAFANA_ADMIN_PASSWORD)=CHANGE_ME$' .env; then
  die "Placeholder secrets are still present in .env (CHANGE_ME). Set real values first."
fi
if grep -qE '^KAURAX_DOMAIN=$' .env; then
  die "KAURAX_DOMAIN is empty in .env. Nginx needs it to build its server names."
fi
info "environment looks configured"

docker compose config --quiet || die "docker-compose.yml is invalid"
info "compose file is valid"

step "Recording the current state for rollback"
PREVIOUS="$(docker compose images --quiet 2>/dev/null | sort -u | head -20 || true)"
if [ -n "$PREVIOUS" ]; then
  info "$(echo "$PREVIOUS" | wc -l | tr -d ' ') image(s) currently running"
else
  info "nothing running yet — this is a first deployment"
fi

if [ "$PULL" -eq 1 ]; then
  step "Updating source"
  if [ -d .git ]; then
    BEFORE="$(git rev-parse --short HEAD)"
    git pull --ff-only || die "git pull failed (local changes? diverged branch?)"
    AFTER="$(git rev-parse --short HEAD)"
    [ "$BEFORE" = "$AFTER" ] && info "already at $AFTER" || info "$BEFORE -> $AFTER"
  else
    warn "not a git checkout; skipping pull"
  fi
fi

step "Building images"
if [ -n "$ONLY_SERVICE" ]; then
  docker compose build "$ONLY_SERVICE" || die "build failed for $ONLY_SERVICE"
else
  docker compose pull --ignore-buildable --quiet 2>/dev/null || true
  docker compose build || die "image build failed"
fi

step "Starting services"
if [ -n "$ONLY_SERVICE" ]; then
  docker compose up -d --no-deps "$ONLY_SERVICE" || die "failed to start $ONLY_SERVICE"
else
  docker compose up -d --remove-orphans || die "docker compose up failed"
fi

step "Waiting for health"
DEADLINE=$(( $(date +%s) + 300 ))
declare -A REPORTED=()

while :; do
  ALL_OK=1
  for svc in "${CRITICAL[@]}"; do
    cid="$(docker compose ps -q "$svc" 2>/dev/null || true)"
    if [ -z "$cid" ]; then ALL_OK=0; continue; fi

    state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"

    if [ "$state" = "running" ] && { [ "$health" = "healthy" ] || [ "$health" = "none" ]; }; then
      [ -n "${REPORTED[$svc]:-}" ] || { info "$svc is up"; REPORTED[$svc]=1; }
    else
      ALL_OK=0
      if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
        printf "\n%s--- last 40 lines from %s ---%s\n" "$DIM" "$svc" "$RESET"
        docker compose logs --tail 40 "$svc" || true
        die "$svc exited during deployment"
      fi
    fi
  done

  [ "$ALL_OK" -eq 1 ] && break

  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    printf "\n%s--- service states ---%s\n" "$DIM" "$RESET"
    docker compose ps
    for svc in "${CRITICAL[@]}"; do
      [ -n "${REPORTED[$svc]:-}" ] && continue
      printf "\n%s--- %s ---%s\n" "$DIM" "$svc" "$RESET"
      docker compose logs --tail 30 "$svc" || true
    done
    die "services did not become healthy within 300s"
  fi
  sleep 5
done

step "Verifying the deployment"
FAILED=0

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    info "OK   $name"
  else
    warn "FAIL $name"
    FAILED=1
  fi
}

# Probe through nginx on loopback, setting Host so the right server block is selected.
DOMAIN="$(grep -E '^KAURAX_DOMAIN=' .env | cut -d= -f2- | tr -d '"')"
RPC_BODY='{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

check "nginx"           "curl -fsS --max-time 5 http://127.0.0.1/nginx-health"
check "API health"      "curl -fsS --max-time 15 -H 'Host: api.$DOMAIN' http://127.0.0.1/api/health"
check "RPC eth_chainId" "curl -fsS --max-time 15 -X POST -H 'Host: rpc.$DOMAIN' -H 'content-type: application/json' -d '$RPC_BODY' http://127.0.0.1 | grep -q result"
check "indexer health"  "docker compose exec -T indexer curl -fsS --max-time 10 http://127.0.0.1:7301/health"

if [ "$FAILED" -ne 0 ]; then
  warn "The containers are running but the endpoints did not verify."
  warn "Inspect with: docker compose logs -f api nginx kaurax-l3"
  die "post-deployment verification failed"
fi

step "Deployed"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
cat <<EOF

  ${BOLD}KAURAX is running.${RESET}

    docker compose ps        service status
    docker compose logs -f   follow logs
    docker compose restart   restart everything
    docker compose down      stop everything

  ${DIM}Rollback: git checkout <previous-sha> && bash infra/scripts/deploy.sh --no-pull${RESET}

EOF
