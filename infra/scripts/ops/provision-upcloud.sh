#!/usr/bin/env bash
#
# Provision the KAURAX server on UpCloud.
#
# Creates one Ubuntu 24.04 VPS, locks down its firewall to 22/80/443, and prints the
# next steps. It does NOT install anything on the server — infra/scripts/bootstrap.sh
# does that, over SSH, once the machine exists.
#
# Credentials come from the environment and are never written anywhere by this script.
#
#   export UPCLOUD_TOKEN=ucat_...          # Account -> Tokens in the control panel
#   infra/scripts/ops/provision-upcloud.sh --plan 4xCPU-8GB --zone de-fra1
#
# Username/password API credentials also work, but are subject to a source-IP allow-list:
#   export UPCLOUD_USERNAME=... UPCLOUD_PASSWORD=...
#
#   --dry-run   show what would be created and stop
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

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

HOSTNAME_="${KAURAX_HOSTNAME:-kaurax-node-1}"
PLAN="${UPCLOUD_PLAN:-4xCPU-8GB}"
ZONE="${UPCLOUD_ZONE:-de-fra1}"
OS="${UPCLOUD_OS:-Ubuntu Server 24.04 LTS (Noble Numbat)}"
DISK_GB="${UPCLOUD_DISK_GB:-160}"
SSH_KEY="${UPCLOUD_SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --plan) PLAN="${2:?}"; shift 2 ;;
    --zone) ZONE="${2:?}"; shift 2 ;;
    --hostname) HOSTNAME_="${2:?}"; shift 2 ;;
    --ssh-key) SSH_KEY="${2:?}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v upctl >/dev/null 2>&1 || die "upctl is not installed. See https://github.com/UpCloudLtd/upcloud-cli"

# Two ways to authenticate. A token is preferred: it is scoped, revocable from the control
# panel without changing a password, and not subject to the API's source-IP allow-list that
# username/password auth enforces.
if [ -n "${UPCLOUD_TOKEN:-}" ]; then
  :
elif [ -n "${UPCLOUD_USERNAME:-}" ] && [ -n "${UPCLOUD_PASSWORD:-}" ]; then
  :
else
  die "Set UPCLOUD_TOKEN (preferred), or UPCLOUD_USERNAME and UPCLOUD_PASSWORD."
fi

# An SSH key is not optional: the server is created with password auth disabled, because a
# public IP running a blockchain node will see credential-stuffing within the hour.
[ -f "$SSH_KEY" ] || die "No SSH public key at $SSH_KEY. Create one with: ssh-keygen -t ed25519"

printf '%sProvisioning KAURAX server%s\n' "$BOLD" "$RESET"
printf '  hostname : %s\n' "$HOSTNAME_"
printf '  plan     : %s\n' "$PLAN"
printf '  zone     : %s\n' "$ZONE"
printf '  os       : %s (%s GB)\n' "$OS" "$DISK_GB"
printf '  ssh key  : %s\n' "$SSH_KEY"
echo

if [ "$DRY" -eq 1 ]; then warn "dry run — nothing created"; exit 0; fi

upctl account show >/dev/null 2>&1 || die "UpCloud rejected these credentials."
ok "credentials accepted"

if upctl server list --output json 2>/dev/null | grep -q "\"hostname\": \"$HOSTNAME_\""; then
  warn "a server named $HOSTNAME_ already exists; not creating another"
else
  upctl server create \
    --hostname "$HOSTNAME_" \
    --title "KAURAX L3 node" \
    --plan "$PLAN" \
    --zone "$ZONE" \
    --os "$OS" \
    --os-storage-size "$DISK_GB" \
    --ssh-keys "$SSH_KEY" \
    --enable-metadata \
    --wait || die "server creation failed"
  ok "server created"
fi

# A server has several addresses: a public IPv4, a public IPv6, and a *utility* IPv4 on
# UpCloud's private network. Taking the first match returns the utility address (10.x),
# which is not reachable from anywhere you care about — so select on access == "public".
IP="$(upctl server show "$HOSTNAME_" --output json 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
def walk(node):
    if isinstance(node, dict):
        if node.get("access") == "public" and node.get("family") == "IPv4" and node.get("address"):
            print(node["address"]); raise SystemExit(0)
        for v in node.values(): walk(v)
    elif isinstance(node, list):
        for v in node: walk(v)
walk(data)
')"
[ -n "$IP" ] || die "could not read the server public IPv4 address"
ok "public IP: $IP"

# ------------------------------------------------------------------ firewall --
# Default deny. Only SSH, HTTP and HTTPS reach this machine; everything the stack runs —
# PostgreSQL, the L3 execution engine's admin RPC, Grafana, the signing service — stays on
# the Docker network where a misconfigured container cannot expose it to the internet.
printf '\n%sFirewall%s\n' "$BOLD" "$RESET"

# UpCloud creates servers with a default rule template that opens more than KAURAX needs
# (3389/RDP, 8443, 8880). On a trial account that template CANNOT be modified — the API
# returns TRIAL_FIREWALL. That is survivable but must not pass silently, because the
# documented posture is 22/80/443 only.
#
# The host firewall is the authoritative layer either way: bootstrap.sh configures ufw with
# default-deny incoming and exactly three ports open. A port left open upstream reaches a
# host that refuses it.
if upctl server firewall show "$HOSTNAME_" 2>/dev/null | grep -qE "port: (3389|8880)"; then
  warn "UpCloud's default rule template is in place; it opens 3389, 8443 and 8880"
  if ! upctl server firewall delete "$HOSTNAME_" --position 1 --dry-run >/dev/null 2>&1; then
    warn "this account cannot modify the cloud firewall (trial mode)"
    warn "ufw on the host is what actually closes those ports — run bootstrap.sh"
  fi
fi

add_rule() { # add_rule <port> <comment>
  upctl server firewall add "$HOSTNAME_" \
    --direction in --family IPv4 --protocol tcp \
    --destination-port-start "$1" --destination-port-end "$1" \
    --action accept --comment "$2" >/dev/null 2>&1 \
    && ok "allow tcp/$1 — $2" || warn "could not add rule for tcp/$1 (may already exist)"
}
add_rule 22  "ssh"
add_rule 80  "http — ACME and redirect"
add_rule 443 "https — rpc, ws, api"

upctl server firewall add "$HOSTNAME_" \
  --direction in --family IPv4 --action drop --comment "default deny" >/dev/null 2>&1 \
  && ok "default deny for everything else" || warn "could not add the default-deny rule — CHECK THIS MANUALLY"

# ---------------------------------------------------------------- next steps --
cat <<EOF

${BOLD}Server is up at $IP${RESET}

${BOLD}1. DNS${RESET} — point the chain endpoints at it (the frontends stay on Vercel):
     rpc.kaurax.network   A   $IP
     ws.kaurax.network    A   $IP
     api.kaurax.network   A   $IP

${BOLD}2. Bootstrap${RESET} — installs Docker, creates the deploy user, hardens sshd:
     ssh root@$IP 'bash -s' < infra/scripts/bootstrap.sh

${BOLD}3. Configure${RESET} — copy .env.example to the server and fill it in there.
   ${DIM}Do not copy your local .env: it holds devnet keys and a local database URL.${RESET}

${BOLD}4. Deploy${RESET}:
     infra/scripts/deploy.sh $IP

${BOLD}5. TLS${RESET} — only after DNS has propagated:
     ssh kaurax@$IP 'cd /opt/kaurax && ./infra/scripts/enable-tls.sh'

${YELLOW}Before exposing anything publicly${RESET}, read docs/key-management.md: the sequencer,
batcher and proposer keys should be held by the signing service, not by the node.
EOF
