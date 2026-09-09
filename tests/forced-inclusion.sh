#!/usr/bin/env bash
#
# KAURAX forced inclusion — end to end, against a running devnet.
#
# This is the censorship-resistance test. It proves the property that matters:
#
#   A user whose transaction the sequencer refuses to include can force it from the L2,
#   and if the sequencer keeps refusing, the sequencer cannot settle *anything* — the
#   output oracle rejects every proposal while a forced transaction is overdue.
#
# Sequence:
#   1. Force a transaction from the L2 and watch it appear on the L3.
#   2. Stop the node, force another, and let its deadline pass.
#   3. Prove an output proposal is now rejected on chain.
#   4. Restart the node, watch it acknowledge, and prove proposals work again.
#
# Destructive to the devnet's timing (it mines L2 blocks). Devnet only.
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

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
PASS=0; FAIL=0
step() { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RESET"; }
note() { printf '  %s· %s%s\n' "$DIM" "$1" "$RESET"; }
pass() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; FAIL=$((FAIL+1)); }

# The devnet funds the documented Anvil accounts. DEV_FUNDED_KEY lets an operator point
# these tests at a different funded account without editing them; it is never required.
: "${DEV_FUNDED_KEY:=${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}}"

: "${KAURAX_PORTAL_ADDRESS:?portal address missing from .env}"
: "${KAURAX_OUTPUT_ORACLE_ADDRESS:?oracle address missing from .env}"

L2="$L2_RPC_URL"; L3="$KAURAX_RPC_URL"
RECIPIENT="0x00000000000000000000000000000000000fC0DE"
FORCE_VALUE=1000000000000000   # 0.001 ether

l2_call() { cast call "$KAURAX_PORTAL_ADDRESS" "$1" --rpc-url "$L2" 2>/dev/null | tr -d '\n'; }
node_up() { cast block-number --rpc-url "$L3" >/dev/null 2>&1; }

wait_until() { local deadline=$(( $(date +%s) + $1 )); shift
  while [ "$(date +%s)" -lt "$deadline" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

printf '%sKAURAX forced inclusion (end to end)%s\n' "$BOLD" "$RESET"
note "portal $KAURAX_PORTAL_ADDRESS on the L2"
WINDOW="$(cast call "$KAURAX_PORTAL_ADDRESS" "forcedInclusionWindow()(uint256)" --rpc-url "$L2")"
note "inclusion window: $WINDOW L2 blocks"

# ============================================================ 1. happy path --
step "A forced transaction reaches the L3 without the sequencer's cooperation"

BEFORE="$(cast balance "$RECIPIENT" --rpc-url "$L3" 2>/dev/null || echo 0)"
note "recipient balance on L3 before: $BEFORE"

TX="$(cast send "$KAURAX_PORTAL_ADDRESS" \
  "forceTransaction(address,uint256,uint64,bytes)" \
  "$RECIPIENT" "$FORCE_VALUE" 200000 "0x" \
  --value "$FORCE_VALUE" --private-key "$DEV_FUNDED_KEY" --rpc-url "$L2" --json 2>&1)" || {
    fail "forceTransaction reverted: $(printf '%s' "$TX" | head -c 200)"; exit 1; }
pass "forceTransaction accepted on the L2"

PENDING="$(cast call "$KAURAX_PORTAL_ADDRESS" "pendingForcedCount()(uint256)" --rpc-url "$L2")"
note "portal reports $PENDING pending"

balance_grew() { [ "$(cast balance "$RECIPIENT" --rpc-url "$L3")" != "$BEFORE" ]; }
if wait_until 60 balance_grew; then
  AFTER="$(cast balance "$RECIPIENT" --rpc-url "$L3")"
  pass "the forced transaction was applied on the L3 (balance $BEFORE -> $AFTER)"
else
  fail "the forced transaction never appeared on the L3 within 60s"
fi

acknowledged() { [ "$(cast call "$KAURAX_PORTAL_ADDRESS" "pendingForcedCount()(uint256)" --rpc-url "$L2")" = "0" ]; }
if wait_until 90 acknowledged; then
  pass "the sequencer acknowledged it on the L2 (pending back to 0)"
else
  fail "still pending after 90s — the sequencer did not acknowledge"
fi

# ================================================== 2. censorship, enforced --
step "A censored forced transaction halts settlement for everyone"

NODE_PID="$(cat "$RUN_DIR/kaurax-node.pid" 2>/dev/null || true)"
[ -n "$NODE_PID" ] || { fail "no node pid file"; exit 1; }
kill "$NODE_PID" 2>/dev/null
for _ in $(seq 1 20); do kill -0 "$NODE_PID" 2>/dev/null || break; sleep 0.5; done
pass "sequencer stopped — it is now censoring by omission"

cast send "$KAURAX_PORTAL_ADDRESS" \
  "forceTransaction(address,uint256,uint64,bytes)" \
  "$RECIPIENT" 1 200000 "0x" \
  --value 1 --private-key "$DEV_FUNDED_KEY" --rpc-url "$L2" >/dev/null 2>&1 \
  || { fail "second forceTransaction reverted"; exit 1; }
PENDING="$(cast call "$KAURAX_PORTAL_ADDRESS" "pendingForcedCount()(uint256)" --rpc-url "$L2")"
pass "a second transaction was forced while the sequencer was down (pending=$PENDING)"

OVERDUE="$(cast call "$KAURAX_PORTAL_ADDRESS" "hasOverdueForcedTransactions()(bool)" --rpc-url "$L2")"
note "overdue before the deadline: $OVERDUE (expected false)"
[ "$OVERDUE" = "false" ] && pass "not yet overdue — the window is still open" \
  || fail "reported overdue before the window elapsed"

# Fast-forward past the deadline. anvil_mine is an L2 devnet convenience; on a real L2 this
# is simply the passage of time.
note "mining $((WINDOW + 2)) L2 blocks to pass the deadline"
cast rpc anvil_mine "$(printf '0x%x' $((WINDOW + 2)))" --rpc-url "$L2" >/dev/null 2>&1 \
  || for _ in $(seq 1 $((WINDOW + 2))); do cast rpc anvil_mine --rpc-url "$L2" >/dev/null 2>&1; done

OVERDUE="$(cast call "$KAURAX_PORTAL_ADDRESS" "hasOverdueForcedTransactions()(bool)" --rpc-url "$L2")"
[ "$OVERDUE" = "true" ] && pass "portal now reports the transaction overdue" \
  || { fail "portal still reports not overdue after the deadline"; }

# The point of the whole mechanism: the oracle refuses to record any new state.
step "The output oracle refuses to settle while a user is being censored"

NEXT_BLOCK="$(cast call "$KAURAX_OUTPUT_ORACLE_ADDRESS" "nextBlockNumber()(uint256)" --rpc-url "$L2" 2>/dev/null || echo "")"
note "oracle expects an output for L3 block ${NEXT_BLOCK:-unknown}"

PROPOSE_OUT="$(cast send "$KAURAX_OUTPUT_ORACLE_ADDRESS" \
  "proposeL2Output(bytes32,uint256,bytes32,uint256)" \
  "0x$(printf 'a%.0s' {1..64})" "${NEXT_BLOCK:-1}" \
  "$(cast block latest --rpc-url "$L2" --field hash)" \
  "$(cast block-number --rpc-url "$L2")" \
  --private-key "${PROPOSER_PRIVATE_KEY:-$DEV_FUNDED_KEY}" --rpc-url "$L2" 2>&1)" && PROPOSED=1 || PROPOSED=0

if [ "$PROPOSED" -eq 0 ] && printf '%s' "$PROPOSE_OUT" | grep -qi "ForcedTransactionOverdue"; then
  pass "proposeL2Output reverted with ForcedTransactionOverdue — settlement is halted"
elif [ "$PROPOSED" -eq 0 ]; then
  note "reverted, but with: $(printf '%s' "$PROPOSE_OUT" | grep -oE '(0x[0-9a-f]{8}|[A-Za-z]+\(\))' | head -3 | tr '\n' ' ')"
  fail "proposal was rejected for a different reason than forced-transaction overdue"
else
  fail "an output was ACCEPTED while a forced transaction was overdue — censorship is not enforced"
fi

# ========================================================= 3. recovery path --
step "Settlement resumes once the sequencer includes what it was avoiding"

( set -a; . "$ROOT/.env"; set +a
  cd "$ROOT/blockchain/l3" && nohup node dist/cli.js >> "$RUN_DIR/kaurax-node.log" 2>&1 &
  echo $! > "$RUN_DIR/kaurax-node.pid" )
if wait_until 60 node_up; then pass "sequencer restarted"; else fail "sequencer did not restart"; exit 1; fi

# `cd ... && nohup node ... &` backgrounds the whole `&&` list, so `$!` is the subshell that
# runs it and the node is that subshell's child. stop.sh kills what the pid file names, so the
# recorded pid died and the node kept running — an orphan holding port 8420 that every later
# start.sh then refused to start against. Record whoever actually holds the port.
_recorded="$(cat "$RUN_DIR/kaurax-node.pid" 2>/dev/null || true)"
_listening="$(lsof -nP -iTCP:"${KAURAX_RPC_PORT:-8420}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2}' || true)"
if [ -n "$_listening" ] && [ "$_recorded" != "$_listening" ]; then
  echo "$_listening" > "$RUN_DIR/kaurax-node.pid"
  note "recorded pid $_recorded was not the listener; corrected to $_listening"
fi

not_overdue() { [ "$(cast call "$KAURAX_PORTAL_ADDRESS" "hasOverdueForcedTransactions()(bool)" --rpc-url "$L2")" = "false" ]; }
if wait_until 120 not_overdue; then
  pass "the sequencer included and acknowledged the forced transaction; nothing is overdue"
else
  fail "still overdue after 120s — the node did not catch up"
fi

# Settlement must actually resume, not merely be permitted to.
BATCHES_BEFORE="$(cast call "${KAURAX_BATCH_INBOX_ADDRESS}" "batchCount()(uint256)" --rpc-url "$L2" 2>/dev/null || echo 0)"
note "batches on the L2: $BATCHES_BEFORE — waiting for the next one"
batch_grew() { [ "$(cast call "${KAURAX_BATCH_INBOX_ADDRESS}" "batchCount()(uint256)" --rpc-url "$L2" 2>/dev/null || echo 0)" -gt "$BATCHES_BEFORE" ]; }
if wait_until 90 batch_grew; then
  pass "batches are being submitted again — settlement resumed on its own"
else
  fail "no new batch within 90s of recovery"
fi

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$RESET"
[ "$FAIL" -eq 0 ] || exit 1
