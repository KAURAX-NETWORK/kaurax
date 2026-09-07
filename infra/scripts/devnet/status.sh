#!/usr/bin/env bash
# Three-layer status, read live from RPC. Values that cannot be read are reported as such.
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
[ -f "$ROOT/.env" ] || { echo "No .env — run infra/scripts/devnet/start.sh first."; exit 1; }
set -a; . "$ROOT/.env"; set +a

BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

read_or_na() { local v; v="$($@ 2>/dev/null)" && [ -n "$v" ] && echo "$v" || echo "No data available"; }

echo
echo "${BOLD}KAURAX — Ethereum → L2 → L3${RESET}"
echo
printf "  %-22s %s\n" "Ethereum (L1)"       "$(read_or_na cast block-number --rpc-url "$L1_RPC_URL")"
printf "  %-22s %s\n" "  chain id"          "$(read_or_na cast chain-id --rpc-url "$L1_RPC_URL")"
echo "         ${DIM}│${RESET}"
printf "  %-22s %s\n" "Underlying L2"       "$(read_or_na cast block-number --rpc-url "$L2_RPC_URL")"
printf "  %-22s %s\n" "  chain id"          "$(read_or_na cast chain-id --rpc-url "$L2_RPC_URL")"
echo "         ${DIM}│${RESET}"
printf "  %-22s %s\n" "KAURAX (L3)"         "$(read_or_na cast block-number --rpc-url "$KAURAX_RPC_URL")"
printf "  %-22s %s\n" "  chain id"          "$(read_or_na cast chain-id --rpc-url "$KAURAX_RPC_URL")"
echo

if command -v node >/dev/null && curl -s --max-time 3 "$KAURAX_RPC_URL" >/dev/null 2>&1; then
  curl -s --max-time 5 -X POST "$KAURAX_RPC_URL" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"kaurax_networkStatus","params":[]}' \
  | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let body;
      try { body = JSON.parse(raw); } catch { console.log("  kaurax_networkStatus: unreadable response"); return; }
      if (body.error) { console.log("  kaurax_networkStatus: " + body.error.message); return; }
      const s = body.result;
      const na = (v) => (v === null || v === undefined ? "No data available" : v);
      const b = s.settlement.lastBatch;
      console.log("  Settlement");
      console.log("    batches on L2        " + na(s.settlement.batchCountOnL2));
      console.log("    last batched L3 block" + " " + na(s.settlement.lastBatchedL3Block));
      console.log("    unbatched L3 blocks  " + na(s.settlement.unbatchedL3Blocks));
      console.log("    last batch tx        " + (b ? b.l2TxHash : "No data available"));
      console.log("    latest output root   " + (s.settlement.latestOutputRoot ? s.settlement.latestOutputRoot.outputRoot : "No data available"));
      console.log("    output at L3 block   " + (s.settlement.latestOutputRoot ? s.settlement.latestOutputRoot.l3BlockNumber : "No data available"));
      console.log("    fault proofs         " + s.settlement.faultProofs.status);
      console.log("    data availability    " + s.settlement.dataAvailability.mode + " -> " + s.settlement.dataAvailability.target);
      console.log("  Sequencer");
      console.log("    mode                 " + s.sequencer.mode + " (decentralized: " + s.sequencer.decentralized + ")");
      console.log("    healthy              " + s.sequencer.healthy);
      console.log("    last error           " + (s.sequencer.lastError ?? "none"));
      console.log("  Ethereum finality      " + (!s.l1 ? "No data available" : s.l1.isLocalDevnetChain ? "No data available (L1 is a local devnet chain, not Ethereum)" : "finalized " + s.l1.finalizedBlockNumber));
      console.log("");
    });
  '
else
  echo "  KAURAX RPC is not reachable at $KAURAX_RPC_URL"
  echo
fi
