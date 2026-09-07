#!/usr/bin/env bash
#
# Verify the deployed site by what it actually serves.
#
# Written after a mistake worth not repeating: every path returned HTTP 200 while the body
# was Vercel's login page, and reporting those 200s as success was wrong. A status code says
# a response arrived, not that it is the right response. Everything here asserts on content.
#
#   tests/live-check.sh                      # against kaurax.network
#   BASE=https://staging.example tests/live-check.sh
set -uo pipefail

BASE="${BASE:-https://kaurax.network}"
BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
PASS=0; FAIL=0
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; FAIL=$((FAIL+1)); }

printf '%sKAURAX live check%s %s%s%s\n\n' "$BOLD" "$RESET" "$DIM" "$BASE" "$RESET"

# --------------------------------------------------------------- the apps --
printf '%sApps serve their own content%s\n' "$BOLD" "$RESET"
for entry in "/:KAURAX" "/explorer:Explorer" "/wallet:Wallet" "/bridge:Bridge" \
             "/pay:Pay" "/ai:AI" "/swap:Swap" "/names:Names" \
             "/launchpad:Launchpad" "/docs:Docs"; do
  path="${entry%%:*}"; want="${entry##*:}"
  body="$(curl -sL --max-time 30 "$BASE$path" 2>/dev/null)"
  title="$(printf '%s' "$body" | grep -oE '<title>[^<]*' | head -1 | sed 's/<title>//')"

  if printf '%s' "$title" | grep -qi "Login"; then
    bad "$path is behind Vercel authentication (title: $title)"
  elif printf '%s' "$title" | grep -q "$want"; then
    ok "$path -> $title"
  else
    bad "$path served '$title', expected something containing '$want'"
  fi
done

# ------------------------------------------------------------- live data --
printf '\n%sPages read the chain%s\n' "$BOLD" "$RESET"
home="$(curl -sL --max-time 30 "$BASE/" 2>/dev/null)"
printf '%s' "$home" | grep -q "KAURAX Devnet" \
  && ok "home shows the network name from the API" \
  || bad "home does not show a network name"
printf '%s' "$home" | grep -qE 'figure-value">#[0-9]+' \
  && ok "home shows a live block height" \
  || bad "home shows no block height"

# One deliberate "No data available" lives in the honesty copy. More than that means a
# figure the page expected to have is missing.
n="$(printf '%s' "$home" | grep -o 'class="nodata"' | wc -l | tr -d ' ')"
[ "$n" -le 2 ] && ok "home has no unexpected empty figures ($n nodata markers)" \
                || bad "home has $n nodata markers; a live figure is missing"

# ------------------------------------------------------------- endpoints --
printf '\n%sEndpoints answer on this origin%s\n' "$BOLD" "$RESET"
rpc="$(curl -s --max-time 25 -X POST "$BASE/rpc" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null)"
printf '%s' "$rpc" | grep -q '"result"' \
  && ok "RPC answers: $(printf '%s' "$rpc" | grep -oE '"result":"[^"]*"')" \
  || bad "RPC did not answer with a result: $(printf '%s' "$rpc" | head -c 80)"

# A redirect here is not cosmetic: a CORS preflight is not allowed to follow one, so the
# browser would fail every call the page makes even though curl -L succeeds.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST "$BASE/rpc" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')"
[ "$code" = "200" ] && ok "RPC answers without a redirect (needed for CORS preflight)" \
                    || bad "RPC returned $code before any redirect; preflight would fail"

api="$(curl -s --max-time 25 "$BASE/api/network" 2>/dev/null)"
printf '%s' "$api" | grep -q '"chainId"' \
  && ok "API answers: chain $(printf '%s' "$api" | grep -oE '"chainId":[0-9]+' | cut -d: -f2)" \
  || bad "API did not answer: $(printf '%s' "$api" | head -c 80)"

# ----------------------------------------------------------------- docs --
printf '\n%sDocumentation is present%s\n' "$BOLD" "$RESET"
docs="$(curl -sL --max-time 30 "$BASE/docs" 2>/dev/null)"
count="$(printf '%s' "$docs" | grep -oE 'href="/docs/[a-z0-9._-]+"' | sort -u | wc -l | tr -d ' ')"
[ "$count" -ge 5 ] && ok "docs lists $count documents" \
                   || bad "docs lists only $count documents — markdown may not be in the bundle"

# ------------------------------------------------------------- no leaks --
printf '\n%sNothing points at a developer machine%s\n' "$BOLD" "$RESET"
leak=0
for path in / /explorer /swap /wallet; do
  printf '%s' "$(curl -sL --max-time 25 "$BASE$path")" | grep -qE "localhost:[0-9]|127\.0\.0\.1:[0-9]" && {
    bad "$path references localhost"; leak=1; }
done
[ "$leak" -eq 0 ] && ok "no localhost references in any page checked"

# ------------------------------------------------- server-rendered errors --
# The check that was missing. Fetching a URL from a laptop exercises the edge; it does not
# exercise the server-to-server path a deployed function takes. When that path broke, every
# page still returned 200 with a polite error rendered inside it — so the only way to see
# the failure is to read what the page says.
printf '\n%sPages rendered data, not an error%s\n' "$BOLD" "$RESET"
for path in / /explorer /wallet /swap /names /launchpad /pay /bridge; do
  body="$(curl -sL --max-time 30 "$BASE$path" 2>/dev/null)"
  if printf '%s' "$body" | grep -qiE "could not reach the kaurax api|not reachable"; then
    bad "$path rendered an API-unreachable message"
  elif printf '%s' "$body" | grep -oE '<title>[^<]*' | head -1 | grep -q "404"; then
    bad "$path rendered a 404 inside the app"
  else
    ok "$path rendered without an error message"
  fi
done

# ------------------------------------------------------- explorer routing --
printf '\n%sExplorer navigation resolves%s\n' "$BOLD" "$RESET"
for path in /explorer /explorer/blocks /explorer/transactions /explorer/contracts \
            /explorer/tokens /explorer/validators /explorer/network /explorer/dashboard; do
  body="$(curl -sL --max-time 30 "$BASE$path" 2>/dev/null)"
  printf '%s' "$body" | grep -oE '<title>[^<]*' | head -1 | grep -q "404" \
    && bad "$path is a 404" \
    || ok "$path resolves"
done

# Links must carry the basePath, or every click from a listing lands at the domain root.
nav="$(curl -sL --max-time 30 "$BASE/explorer" 2>/dev/null | grep -oE 'href="/[a-z]+"' | sort -u)"
printf '%s' "$nav" | grep -qE 'href="/(blocks|transactions|tokens)"' \
  && bad "explorer emits unprefixed links; they will 404" \
  || ok "explorer links carry the /explorer prefix"

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$RESET"
[ "$FAIL" -eq 0 ]
