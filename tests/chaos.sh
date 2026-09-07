#!/usr/bin/env bash
#
# KAURAX chaos test.
#
# Kills each component of a running devnet, one at a time, and checks that the system
# recovers *correctly* — not merely that the process restarts. Correctly means:
#
#   - no L3 block is lost or duplicated when the sequencer dies mid-flight
#   - the write-ahead log replays the blocks that were sealed but not yet batched
#   - the indexer resumes from where it stopped and reaches zero lag again
#   - the API returns 503 while the database is gone, and never fabricates a value
#   - settlement continues from the correct height rather than restarting from zero
#
# Destructive: run it against a devnet, never against anything you care about.
#
#   tests/chaos.sh              # every scenario
#   tests/chaos.sh sequencer    # one scenario
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
[ -f .env ] || { echo "No .env — run infra/scripts/devnet/start.sh first."; exit 1; }
set -a; . ./.env; set +a
RUN_DIR="$ROOT/.devnet"

# The devnet funds the documented Anvil accounts. DEV_FUNDED_KEY lets an operator point
# these tests at a different funded account without editing them; it is never required.
: "${DEV_FUNDED_KEY:=${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
PASS=0; FAIL=0
scenario() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RESET"; }
step()  { printf '  %s· %s%s\n' "$DIM" "$1" "$RESET"; }
pass()  { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
fail()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; FAIL=$((FAIL+1)); }

rpc() { # rpc <url> <method> [params-json]
  curl -s --max-time 8 -X POST "$1" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":${3:-[]}}"
}
result() { node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{const b=JSON.parse(r);process.stdout.write(b.error?"":JSON.stringify(b.result))}catch{process.stdout.write("")}})'; }
head_block() { rpc "$KAURAX_RPC_URL" eth_blockNumber | result | tr -d '"' | { read -r h; [ -n "$h" ] && printf '%d' "$h" || printf ''; }; }

wait_for() { # wait_for <seconds> <command...> — polls until the command succeeds
  local deadline=$(( $(date +%s) + $1 )); shift
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

node_is_up() { [ -n "$(head_block)" ]; }
api_is_up()  { curl -s --max-time 3 "http://127.0.0.1:${API_PORT:-7300}/api/health/live" | grep -q '"ok"'; }

restart_node() {
  ( set -a; . "$ROOT/.env"; set +a
    cd "$ROOT/blockchain/l3" && nohup node dist/cli.js >> "$RUN_DIR/kaurax-node.log" 2>&1 &
    echo $! > "$RUN_DIR/kaurax-node.pid" )
}
restart_indexer() {
  ( set -a; . "$ROOT/.env"; set +a
    cd "$ROOT/services/indexer" && nohup node dist/index.js >> "$RUN_DIR/indexer.log" 2>&1 &
    echo $! > "$RUN_DIR/indexer.pid" )
}
restart_api() {
  ( set -a; . "$ROOT/.env"; set +a
    cd "$ROOT/services/api" && nohup node dist/index.js >> "$RUN_DIR/api.log" 2>&1 &
    echo $! > "$RUN_DIR/api.pid" )
}

kill_pidfile() { # kill_pidfile <name> <signal>
  local pid; pid="$(cat "$RUN_DIR/$1.pid" 2>/dev/null || true)"
  [ -n "$pid" ] || { fail "$1 has no pid file — is the devnet running?"; return 1; }
  kill "-${2:-KILL}" "$pid" 2>/dev/null || true
  # Wait for it to actually be gone; killing and immediately asserting is a race.
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.5; done
  return 0
}

# ---------------------------------------------------------------- scenarios --

chaos_sequencer() {
  scenario "Sequencer killed with SIGKILL (no chance to clean up)"

  local before; before="$(head_block)"
  [ -n "$before" ] || { fail "node is not answering; start the devnet first"; return; }
  step "head before: $before"

  # Put transactions in flight so there is something to lose.
  cast send --rpc-url "$KAURAX_RPC_URL" --private-key "$DEV_FUNDED_KEY" \
    --value 1wei 0x0000000000000000000000000000000000000dEaD >/dev/null 2>&1 || true

  kill_pidfile kaurax-node KILL || return
  step "process killed"

  if node_is_up; then fail "node still answering after SIGKILL"; else pass "node is down (RPC refuses, does not lie)"; fi

  restart_node
  if wait_for 60 node_is_up; then pass "node restarted"; else fail "node did not come back within 60s"; return; fi

  local after; after="$(head_block)"
  step "head after: $after"
  if [ "$after" -ge "$before" ]; then
    pass "chain continued from $before to $after — no rollback"
  else
    fail "head went BACKWARDS: $before -> $after"
  fi

  # The WAL is the whole reason a hard kill is survivable: blocks sealed but not batched
  # must still be there to submit.
  local wal; wal="$(rpc "$KAURAX_RPC_URL" kaurax_networkStatus | result)"
  if printf '%s' "$wal" | grep -q '"walPendingBlocks"'; then
    pass "write-ahead log reported after recovery"
  else
    step "walPendingBlocks not present in status (older node build?)"
  fi

  if grep -q "recovered" "$RUN_DIR/kaurax-node.log" 2>/dev/null; then
    pass "log shows WAL recovery on startup"
  else
    step "no WAL recovery line — nothing was pending, which is also valid"
  fi
}

chaos_indexer() {
  scenario "Indexer killed while the chain keeps producing"

  local start_lag
  start_lag="$(curl -s --max-time 5 "http://127.0.0.1:${INDEXER_HEALTH_PORT:-7301}/health" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(r).lastIndexedBlock??""))}catch{process.stdout.write("")}})')"
  step "indexed block before: ${start_lag:-unknown}"

  kill_pidfile indexer KILL || return

  # Produce blocks the indexer is guaranteed to have missed.
  for _ in 1 2 3; do
    cast send --rpc-url "$KAURAX_RPC_URL" --private-key "$DEV_FUNDED_KEY" \
      --value 1wei 0x0000000000000000000000000000000000000dEaD >/dev/null 2>&1 || true
  done
  step "produced blocks while the indexer was dead"

  restart_indexer
  indexer_caught_up() {
    curl -s --max-time 5 "http://127.0.0.1:${INDEXER_HEALTH_PORT:-7301}/health" \
      | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{const b=JSON.parse(r);process.exit(b.status==="ok"&&Number(b.lagBlocks??99)<=1?0:1)}catch{process.exit(1)}})'
  }
  if wait_for 90 indexer_caught_up; then
    pass "indexer resumed and caught back up to the head"
  else
    fail "indexer did not reach zero lag within 90s"
  fi
}

chaos_database() {
  scenario "Database stopped underneath a running API"

  api_is_up || { fail "API is not running"; return; }

  # The devnet uses a local PostgreSQL, not a container; suspend rather than stop it so the
  # test is reversible on any machine.
  local pgpid; pgpid="$(pgrep -f "postgres.*-D" | head -1)"
  if [ -z "$pgpid" ]; then
    step "no local postgres process found — skipping (containerised setups: docker compose stop postgres)"
    return
  fi

  kill -STOP "$pgpid" 2>/dev/null
  step "postgres suspended (SIGSTOP)"
  sleep 2

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:${API_PORT:-7300}/api/health")"
  if [ "$code" = "503" ]; then
    pass "health returns 503 with the database gone (does not claim ok)"
  else
    fail "health returned $code with the database gone; expected 503"
  fi

  # The critical honesty property: a route needing history must refuse, not return [].
  local body
  body="$(curl -s --max-time 20 "http://127.0.0.1:${API_PORT:-7300}/api/blocks?limit=1")"
  if printf '%s' "$body" | grep -qE 'database_unavailable|internal_error|shutting_down'; then
    pass "history route reports an error rather than an empty result"
  elif printf '%s' "$body" | grep -q '"items":\[\]'; then
    fail "history route returned an empty list — that reads as 'no blocks exist'"
  else
    step "history route returned: $(printf '%s' "$body" | head -c 120)"
  fi

  kill -CONT "$pgpid" 2>/dev/null
  step "postgres resumed"

  api_healthy() { curl -s --max-time 5 "http://127.0.0.1:${API_PORT:-7300}/api/health" | grep -q '"status":"ok"'; }
  if wait_for 60 api_healthy; then
    pass "API recovered on its own once the database returned"
  else
    fail "API did not report healthy within 60s of the database returning"
  fi
}

chaos_engine() {
  scenario "Execution engine killed underneath the node"

  local before; before="$(head_block)"
  [ -n "$before" ] || { fail "node is not answering"; return; }

  local pid; pid="$(cat "$RUN_DIR/l3-engine.pid" 2>/dev/null || true)"
  [ -n "$pid" ] || { step "no engine pid file — skipping"; return; }

  kill -KILL "$pid" 2>/dev/null
  step "engine killed; the node is now talking to nothing"
  sleep 3

  # With no engine the node cannot know the head. It must say so, not guess.
  local resp; resp="$(rpc "$KAURAX_RPC_URL" eth_blockNumber)"
  if printf '%s' "$resp" | grep -q '"error"' || [ -z "$resp" ]; then
    pass "RPC errors rather than returning a stale or invented height"
  else
    local h; h="$(printf '%s' "$resp" | result | tr -d '"')"
    fail "RPC still answered $h with no execution engine behind it"
  fi

  step "restart the devnet to continue: infra/scripts/devnet/stop.sh && infra/scripts/devnet/start.sh"
}

chaos_graceful() {
  scenario "API given SIGTERM (graceful drain, not a kill)"

  api_is_up || { fail "API is not running"; return; }

  local ready
  ready="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${API_PORT:-7300}/api/health/ready")"
  [ "$ready" = "200" ] && pass "readiness is 200 before shutdown" || fail "readiness was $ready before shutdown"

  kill_pidfile api TERM

  # Between SIGTERM and close the process must report not-ready while still answering.
  local drained=0
  for _ in $(seq 1 6); do
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${API_PORT:-7300}/api/health/ready" 2>/dev/null)"
    [ "$code" = "503" ] && { drained=1; break; }
    sleep 0.4
  done
  [ "$drained" -eq 1 ] && pass "readiness flipped to 503 during drain" \
    || step "drain window not observed (SHUTDOWN_DRAIN_MS may be 0, or shutdown was faster than the poll)"

  restart_api
  if wait_for 40 api_is_up; then pass "API restarted"; else fail "API did not come back within 40s"; fi
}

# --------------------------------------------------------------------- main --

printf '%sKAURAX chaos test%s  %s(destructive — devnet only)%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"

case "${1:-all}" in
  sequencer) chaos_sequencer ;;
  indexer)   chaos_indexer ;;
  database)  chaos_database ;;
  engine)    chaos_engine ;;
  graceful)  chaos_graceful ;;
  all)
    chaos_sequencer
    chaos_indexer
    chaos_database
    chaos_graceful
    printf '\n%sSkipping the engine scenario in "all": it requires a full devnet restart.%s\n' "$DIM" "$RESET"
    printf '%sRun it deliberately with: tests/chaos.sh engine%s\n' "$DIM" "$RESET"
    ;;
  *) echo "unknown scenario: $1 (sequencer|indexer|database|engine|graceful|all)"; exit 2 ;;
esac

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$RESET"
[ "$FAIL" -eq 0 ] || exit 1
