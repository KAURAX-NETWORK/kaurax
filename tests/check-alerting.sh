#!/usr/bin/env bash
#
# Prove the alerting pipeline delivers, rather than assuming it.
#
# Alert rules existed and evaluated for as long as this repository has had monitoring, and
# reached nobody: prometheus.yml had no `alerting:` block and no Alertmanager was deployed.
# Rules fired into Prometheus's own UI and stopped there, which looks like alerting.
#
# This checks four things, in order of how easily each fails silently:
#
#   1. Prometheus config is valid and names an Alertmanager      promtool check config
#   2. The alert rules are valid                                 promtool check rules
#   3. The routing tree is valid                                 amtool check-config
#   4. A real alert reaches a real receiver                      end to end, over HTTP
#
#   ./tests/check-alerting.sh
#
# Needs Docker. Everything runs on a throwaway network and is removed on exit, including
# when a step fails.
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

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
PROM_IMAGE="prom/prometheus:v3.1.0"
AM_IMAGE="prom/alertmanager:v0.28.0"
NET="kaurax-alerting-check"
SINK="kaurax-alert-sink"
AM="kaurax-alertmanager-check"

fail=0
ok()  { printf "  ${GREEN}OK${RESET}    %s ${DIM}%s${RESET}\n" "$1" "${2:-}"; }
bad() { printf "  ${RED}FAIL${RESET}  %s ${DIM}%s${RESET}\n" "$1" "${2:-}"; fail=1; }

# Created inside the repository on purpose. Docker Desktop and Colima only share certain
# host paths with the VM, and macOS mktemp returns /var/folders/... which is not one of them.
# A bind mount of an unshared path does not fail — the daemon creates an empty directory at
# the destination instead, and Alertmanager then reports "read url_file: is a directory".
TMP="$(mktemp -d "$ROOT/.alerting-check.XXXXXX")"
cleanup() {
  docker rm -f "$AM" "$SINK" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  printf "\n${RED}Docker is not available; this check cannot run.${RESET}\n\n"
  exit 1
fi

printf "\n${BOLD}Static configuration${RESET}\n"

# promtool resolves rule_files relative to the config, so both are mounted at the paths the
# real container uses.
if OUT="$(docker run --rm \
      -v "$ROOT/infra/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
      -v "$ROOT/infra/monitoring/alerts.yml:/etc/prometheus/alerts.yml:ro" \
      --entrypoint promtool "$PROM_IMAGE" check config /etc/prometheus/prometheus.yml 2>&1)"; then
  ok "prometheus.yml is valid" "$(printf '%s' "$OUT" | grep -cE 'SUCCESS' | tr -d ' ') checks passed"
else
  bad "prometheus.yml is not valid"; printf "${DIM}%s${RESET}\n" "$OUT"
fi

# The block whose absence caused this whole problem. A config can be perfectly valid and
# deliver nothing.
if grep -qE '^alerting:' "$ROOT/infra/monitoring/prometheus.yml" \
   && grep -q 'alertmanager:9093' "$ROOT/infra/monitoring/prometheus.yml"; then
  ok "prometheus.yml names an Alertmanager"
else
  bad "prometheus.yml has no alerting: block — rules would evaluate and go nowhere"
fi

if OUT="$(docker run --rm -v "$ROOT/infra/monitoring/alerts.yml:/alerts.yml:ro" \
      --entrypoint promtool "$PROM_IMAGE" check rules /alerts.yml 2>&1)"; then
  ok "alert rules are valid" "$(printf '%s' "$OUT" | grep -oE '[0-9]+ rules found' | head -1)"
else
  bad "alert rules are not valid"; printf "${DIM}%s${RESET}\n" "$OUT"
fi

# amtool reads url_file at check time, so give it a placeholder rather than requiring the
# operator's real destination to run this.
printf 'http://%s:8080/' "$SINK" > "$TMP/webhook-url"
if OUT="$(docker run --rm \
      -v "$ROOT/infra/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
      -v "$TMP/webhook-url:/etc/alertmanager/webhook-url:ro" \
      --entrypoint amtool "$AM_IMAGE" check-config /etc/alertmanager/alertmanager.yml 2>&1)"; then
  ok "alertmanager.yml is valid" "$(printf '%s' "$OUT" | grep -oE 'Found:.*' | head -1)"
else
  bad "alertmanager.yml is not valid"; printf "${DIM}%s${RESET}\n" "$OUT"
fi

printf "\n${BOLD}Routing${RESET}\n"
route_goes_to() {
  local labels="$1" expected="$2"
  local got
  got="$(docker run --rm \
      -v "$ROOT/infra/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
      -v "$TMP/webhook-url:/etc/alertmanager/webhook-url:ro" \
      --entrypoint amtool "$AM_IMAGE" config routes test \
      --config.file=/etc/alertmanager/alertmanager.yml "$labels" 2>&1 | tr -d '\r')"
  if [ "$got" = "$expected" ]; then ok "$labels routes to $expected"
  else bad "$labels routed to '$got', expected '$expected'"; fi
}
route_goes_to "severity=critical" "kaurax-critical"
route_goes_to "severity=warning" "kaurax-warning"

printf "\n${BOLD}End to end${RESET}\n"
docker network create "$NET" >/dev/null 2>&1

# A receiver that records what it is sent. Deliberately not a mock inside Alertmanager: the
# point is that something outside the process actually received an HTTP request.
docker run -d --name "$SINK" --network "$NET" python:3.12-alpine python -c '
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        print(body.decode(), flush=True)
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(("", 8080), H).serve_forever()
' >/dev/null 2>&1

docker run -d --name "$AM" --network "$NET" \
  -v "$ROOT/infra/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" \
  -v "$TMP/webhook-url:/etc/alertmanager/webhook-url:ro" \
  "$AM_IMAGE" --config.file=/etc/alertmanager/alertmanager.yml --storage.path=/alertmanager \
  >/dev/null 2>&1

up=0
for _ in $(seq 1 30); do
  if docker run --rm --network "$NET" "$AM_IMAGE" --version >/dev/null 2>&1 \
     && docker exec "$AM" wget -q -O- http://localhost:9093/-/ready >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
[ "$up" -eq 1 ] && ok "alertmanager started and is ready" || bad "alertmanager did not become ready"

# A real alert, with the labels a real rule produces, through the real routing tree.
docker exec "$AM" wget -q -O- --header='Content-Type: application/json' \
  --post-data='[{"labels":{"alertname":"KauraxSequencerDown","severity":"critical","component":"kaurax-node","job":"kaurax-node"},"annotations":{"summary":"pipeline check"}}]' \
  http://localhost:9093/api/v2/alerts >/dev/null 2>&1 \
  && ok "alert accepted by alertmanager" || bad "alertmanager rejected the alert"

# group_wait for critical is 10s.
delivered=0
for _ in $(seq 1 40); do
  if docker logs "$SINK" 2>/dev/null | grep -q "KauraxSequencerDown"; then delivered=1; break; fi
  sleep 1
done
if [ "$delivered" -eq 1 ]; then
  ok "the receiver was actually called" "KauraxSequencerDown arrived over HTTP"
else
  bad "nothing reached the receiver within 40s"
  printf "${DIM}%s${RESET}\n" "$(docker logs "$AM" 2>&1 | tail -15)"
fi

printf "\n"
if [ "$fail" -ne 0 ]; then
  printf "${RED}${BOLD}Alerts would not reach anyone.${RESET}\n\n"
  exit 1
fi
printf "${GREEN}${BOLD}Alerts are routed and delivered.${RESET}\n"
printf "${DIM}A real deployment still needs infra/monitoring/alert-webhook-url to point somewhere real.${RESET}\n\n"
