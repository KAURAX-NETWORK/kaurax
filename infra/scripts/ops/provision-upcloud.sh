#!/usr/bin/env bash
#
# Provision the KAURAX server on UpCloud.
#
# Creates one Ubuntu 24.04 VPS, locks down its firewall to 22/80/443, and prints the
# next steps. It does NOT install anything on the server — infra/scripts/bootstrap.sh
# does that, over SSH, once the machine exists.
#
# Credentials: upctl reads UPCLOUD_USERNAME and UPCLOUD_PASSWORD from the environment.
# These are UpCloud *API* credentials — created under Account -> API in the control panel,
# with API access enabled and, ideally, this machine's IP allow-listed. They are not your
# UpCloud login. This script never writes them anywhere.
#
#   export UPCLOUD_USERNAME=...
#   export UPCLOUD_PASSWORD=...
#   infra/scripts/ops/provision-upcloud.sh --plan 4xCPU-8GB --zone de-fra1
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

[ -n "${UPCLOUD_USERNAME:-}" ] || die "UPCLOUD_USERNAME is not set (UpCloud API credentials, not your login)."
[ -n "${UPCLOUD_PASSWORD:-}" ] || die "UPCLOUD_PASSWORD is not set."

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

upctl account show >/dev/null 2>&1 || die "UpCloud rejected these credentials. Check API access is enabled for this user."
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

IP="$(upctl server show "$HOSTNAME_" --output json 2>/dev/null \
  | grep -oE '"address": "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -oE '[0-9.]+')"
[ -n "$IP" ] || die "could not read the server's public IP"
ok "public IP: $IP"

# ------------------------------------------------------------------ firewall --
# Default deny. Only SSH, HTTP and HTTPS reach this machine; everything the stack runs —
# PostgreSQL, the L3 execution engine's admin RPC, Grafana, the signing service — stays on
# the Docker network where a misconfigured container cannot expose it to the internet.
printf '\n%sFirewall%s\n' "$BOLD" "$RESET"
upctl server firewall configure "$HOSTNAME_" --enable >/dev/null 2>&1 || true

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
