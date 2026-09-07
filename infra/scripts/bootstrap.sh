#!/usr/bin/env bash
#
# KAURAX one-command server setup — Ubuntu LTS.
#
#   bash bootstrap.sh
#
# Installs Docker, Compose, Git, Node.js, UFW and Fail2ban, creates a non-root deploy
# user, and hardens SSH.
#
# Every step checks before it acts: re-running this on a configured server changes nothing.
# It never overwrites an existing SSH config without backing it up, and it never locks you
# out — the SSH hardening step refuses to run if the deploy user has no authorized key.
#
set -euo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
step() { printf "\n%s==>%s %s%s%s\n" "$GREEN" "$RESET" "$BOLD" "$1" "$RESET"; }
info() { printf "    %s\n" "$1"; }
warn() { printf "    %s%s%s\n" "$YELLOW" "$1" "$RESET"; }
die()  { printf "\n%sERROR:%s %s\n\n" "$RED" "$RESET" "$1" >&2; exit 1; }

DEPLOY_USER="${DEPLOY_USER:-kaurax}"
SSH_PORT="${SSH_PORT:-22}"

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash bootstrap.sh"
command -v apt-get >/dev/null || die "This script targets Ubuntu/Debian (apt-get not found)."

if [ -r /etc/os-release ]; then
  . /etc/os-release
  info "detected ${PRETTY_NAME:-unknown}"
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) warn "This is tested on Ubuntu LTS. Continuing on ${ID:-unknown}." ;;
  esac
fi

step "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg git ufw fail2ban jq unattended-upgrades \
  apt-transport-https software-properties-common >/dev/null
info "base packages installed"

step "Docker"
if command -v docker >/dev/null 2>&1; then
  info "docker already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null
  info "installed $(docker --version)"
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "docker compose plugin is not working"
info "$(docker compose version)"

step "Node.js 20 (for local tooling; services run in containers)"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  info "node already present: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  info "installed $(node -v)"
fi
corepack enable >/dev/null 2>&1 || true

step "Deploy user"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  info "user '$DEPLOY_USER' already exists"
else
  adduser --disabled-password --gecos "KAURAX deploy" "$DEPLOY_USER" >/dev/null
  info "created user '$DEPLOY_USER'"
fi
usermod -aG docker "$DEPLOY_USER"
info "'$DEPLOY_USER' added to the docker group"

# Copy root's authorized_keys across so the operator is not locked out.
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
if [ -f /root/.ssh/authorized_keys ] && [ ! -s "$DEPLOY_HOME/.ssh/authorized_keys" ]; then
  cp /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
  chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
  info "copied root's authorized_keys to '$DEPLOY_USER'"
fi

step "Firewall (UFW)"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "$SSH_PORT"/tcp comment 'SSH'   >/dev/null
ufw allow 80/tcp            comment 'HTTP'  >/dev/null
ufw allow 443/tcp           comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
info "only $SSH_PORT, 80 and 443 are open"
warn "PostgreSQL, the L3 execution engine, the indexer and Grafana are NOT exposed."
warn "Reach Grafana over an SSH tunnel: ssh -L 3001:127.0.0.1:3001 $DEPLOY_USER@<server>"

step "Fail2ban"
cat > /etc/fail2ban/jail.local <<'CONF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true

[nginx-http-auth]
enabled = false
CONF
systemctl enable --now fail2ban >/dev/null 2>&1 || true
info "fail2ban enabled for sshd"

step "SSH hardening"
# Refuse to disable password auth unless a key is actually installed — otherwise this
# step is how you lock yourself out of a fresh server.
if [ -s "$DEPLOY_HOME/.ssh/authorized_keys" ]; then
  SSHD_CONF=/etc/ssh/sshd_config.d/60-kaurax.conf
  install -d -m 755 /etc/ssh/sshd_config.d
  cat > "$SSHD_CONF" <<'CONF'
# Installed by KAURAX infra/scripts/bootstrap.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
CONF
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    info "password SSH disabled, root login disabled"
  else
    rm -f "$SSHD_CONF"
    warn "sshd rejected the hardened config; left SSH unchanged"
  fi
else
  warn "SKIPPED: no authorized_keys for '$DEPLOY_USER'."
  warn "Password SSH left ENABLED so you are not locked out. Install a key, then re-run."
fi

step "Unattended security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
info "security updates will install automatically"

step "Done"
cat <<EOF

  ${BOLD}The server is ready for KAURAX.${RESET}

  Next, as '${DEPLOY_USER}':

    ssh ${DEPLOY_USER}@<server-ip>
    git clone <your-repo-url> ~/kaurax && cd ~/kaurax
    cp .env.example .env && \$EDITOR .env     # set real secrets — see docs/SECURITY.md
    bash infra/scripts/deploy.sh

  Then, once DNS points at this server:

    bash infra/scripts/enable-tls.sh

  ${YELLOW}Before going further, read SECURITY.md.${RESET}
  KAURAX has no fault proof system and a centralized sequencer. Nothing is audited.

EOF
