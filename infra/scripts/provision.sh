#!/usr/bin/env bash
# provision.sh — Phase 15A: Initial VPS provisioning for the saziqo platform
#
# Target: Ubuntu 24.04 LTS, fresh root login.
# Idempotent: safe to re-run after partial failures or to apply updates.
#
# What this does:
#   1. Updates the OS and installs base utilities
#   2. Installs Docker Engine + compose plugin (official Docker apt repo)
#   3. Installs Caddy (official Cloudsmith apt repo)
#   4. Creates the `deploy` user with docker-group access and SSH-only auth
#   5. Lays out /opt/saziqo-platform/{releases,shared/...}
#   6. Configures UFW with a minimal allow-list (22, 80, 443)
#   7. Enables docker, caddy, fail2ban systemd services
#
# What this does NOT do (deferred to later phases):
#   - Disable root SSH / password auth        (15D — server hardening)
#   - Install fail2ban jails / unattended-upgrades (15D)
#   - Lay down Caddyfile or app .env          (15B / 15C)
#   - Pull or run application containers      (15G — deploy.sh)

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
LOG_FILE="/var/log/saziqo-provision.log"
DEPLOY_USER="deploy"
APP_ROOT="/opt/saziqo-platform"
SHARED_DIRS=(
  "shared/logs"
  "shared/uploads"
  "shared/postgres-data"
  "shared/redis-data"
)

# ──────────────────────────────────────────────────────────────────────
# Logging — tee everything (stdout + stderr) to the log file from the
# very first byte. Using `exec` redirects all subsequent output without
# wrapping every command. The `setpriv` / `tee` combo also keeps stderr
# interleaved correctly so an apt failure message lands in the log.
# ──────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"
chmod 0640 "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { printf '\n[provision %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[provision %s] WARNING: %s\n' "$(date -Iseconds)" "$*" >&2; }
die()  { printf '\n[provision %s] ERROR: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────────
require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "Must run as root. Try: sudo bash $0"
  fi
}

require_ubuntu() {
  if ! command -v lsb_release >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y --no-install-recommends lsb-release
  fi
  local distro release
  distro="$(lsb_release -is)"
  release="$(lsb_release -rs)"
  if [[ "${distro}" != "Ubuntu" ]]; then
    die "Expected Ubuntu, found ${distro}. This script is Ubuntu-only."
  fi
  case "${release}" in
    24.04|24.10|22.04) ;;  # 22.04 acceptable for testing; 24.04 is target
    *) warn "Untested Ubuntu release ${release}. Continuing anyway." ;;
  esac
  log "Detected ${distro} ${release}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 1 + 2 — OS update + base utilities
# Use DEBIAN_FRONTEND=noninteractive so apt never prompts (would deadlock
# the redirected stdin under `exec`). Pin Dpkg options to silently accept
# default config during dist-upgrades on already-customized systems.
# ──────────────────────────────────────────────────────────────────────
install_base_packages() {
  log "Updating apt index and upgrading installed packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold"

  log "Installing base utilities"
  apt-get install -y --no-install-recommends \
    curl \
    rsync \
    unzip \
    ufw \
    fail2ban \
    git \
    make \
    jq \
    htop \
    rclone \
    ca-certificates \
    gnupg \
    lsb-release
}

# ──────────────────────────────────────────────────────────────────────
# Step 3 — Docker Engine + Compose plugin
# Official Docker apt repo. Idempotent: GPG import and apt source write
# both check-then-act so re-runs are no-ops.
# ──────────────────────────────────────────────────────────────────────
install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker + compose plugin already installed — skipping repo setup"
    return
  fi

  log "Installing Docker Engine via official apt repo"
  install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
}

# ──────────────────────────────────────────────────────────────────────
# Step 4 — Caddy via Cloudsmith apt repo (the path documented on
# caddyserver.com/docs/install#debian-ubuntu-raspbian).
# ──────────────────────────────────────────────────────────────────────
install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy already installed — skipping repo setup"
    return
  fi

  log "Installing Caddy via official apt repo"
  install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
    curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  fi

  curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" \
    > /etc/apt/sources.list.d/caddy-stable.list

  apt-get update -y
  apt-get install -y caddy
}

# ──────────────────────────────────────────────────────────────────────
# Step 5 — Deploy user
# - useradd is wrapped in `id` check so re-runs don't fail
# - usermod -aG is idempotent (re-adding to a group is a no-op)
# - SSH directory perms: 700 on .ssh, 600 on authorized_keys
# - We do NOT seed an authorized_key — that's the operator's job. The
#   warning at the end of the run reminds them.
# ──────────────────────────────────────────────────────────────────────
create_deploy_user() {
  if id "${DEPLOY_USER}" >/dev/null 2>&1; then
    log "User ${DEPLOY_USER} already exists"
  else
    log "Creating user ${DEPLOY_USER}"
    useradd -m -s /bin/bash "${DEPLOY_USER}"
  fi

  log "Adding ${DEPLOY_USER} to docker group"
  usermod -aG docker "${DEPLOY_USER}"

  local ssh_dir="/home/${DEPLOY_USER}/.ssh"
  local auth_keys="${ssh_dir}/authorized_keys"
  mkdir -p "${ssh_dir}"
  touch "${auth_keys}"
  chmod 700 "${ssh_dir}"
  chmod 600 "${auth_keys}"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${ssh_dir}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 6 — Directory tree
# Owned by deploy so the unprivileged user can write release artifacts,
# logs, and uploads without sudo. Postgres / Redis data dirs are also
# deploy-owned because the prod compose stack runs as the deploy uid.
# ──────────────────────────────────────────────────────────────────────
create_app_directories() {
  log "Creating ${APP_ROOT} layout"
  mkdir -p "${APP_ROOT}/releases"
  for sub in "${SHARED_DIRS[@]}"; do
    mkdir -p "${APP_ROOT}/${sub}"
  done
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_ROOT}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 7 — UFW initial config
# - default deny incoming / allow outgoing
# - allow 22 (SSH), 80 (HTTP), 443 (HTTPS)
# - `ufw --force enable` skips the y/N prompt
# Re-running is safe: ufw treats duplicate `allow` rules as no-ops.
# ──────────────────────────────────────────────────────────────────────
configure_ufw() {
  log "Configuring UFW (allow 22/80/443, deny everything else)"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  ufw allow 80/tcp comment 'HTTP'
  ufw allow 443/tcp comment 'HTTPS'
  ufw --force enable
  ufw status verbose
}

# ──────────────────────────────────────────────────────────────────────
# Step 8 — Enable services
# `systemctl enable --now` both starts the unit and enables it for
# subsequent boots. Safe on already-running units.
# ──────────────────────────────────────────────────────────────────────
enable_services() {
  log "Enabling docker, caddy, fail2ban for boot"
  systemctl enable --now docker
  systemctl enable --now caddy
  systemctl enable --now fail2ban
}

# ──────────────────────────────────────────────────────────────────────
# Final report
# ──────────────────────────────────────────────────────────────────────
print_summary() {
  cat <<EOF

================================================================
saziqo platform — provisioning complete
================================================================

Versions installed:
  - docker:         $(docker --version 2>/dev/null || echo 'not found')
  - docker compose: $(docker compose version --short 2>/dev/null || echo 'not found')
  - caddy:          $(caddy version 2>/dev/null | head -n1 || echo 'not found')
  - ufw:            $(ufw status | head -n1)

Layout created at: ${APP_ROOT}
Deploy user:       ${DEPLOY_USER} (member of docker group)
Provisioning log:  ${LOG_FILE}

NEXT STEPS — DO BEFORE LEAVING THE CONSOLE:

  1. Add your SSH public key to /home/${DEPLOY_USER}/.ssh/authorized_keys
     before disabling root login. Verify you can SSH in as
     '${DEPLOY_USER}@<host>' from a NEW terminal — keep the current root
     session open until you confirm.

  2. After confirming, run Phase 15D's harden.sh to:
       - Disable root SSH and password auth
       - Configure fail2ban jails
       - Enable unattended-upgrades

  3. Drop the Caddyfile (Phase 15B) and prod compose stack (Phase 15C)
     into ${APP_ROOT} before running deploy.sh (Phase 15G).

================================================================
EOF
}

main() {
  log "Starting saziqo-platform provisioning"
  require_root
  require_ubuntu
  install_base_packages
  install_docker
  install_caddy
  create_deploy_user
  create_app_directories
  configure_ufw
  enable_services
  print_summary
  log "Provisioning finished successfully"
}

main "$@"
