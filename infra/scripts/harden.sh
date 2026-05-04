#!/usr/bin/env bash
# harden.sh — Phase 15D: Lock down the VPS after provision.sh has run.
#
# What this does:
#   1. SAFETY GATE: confirm the deploy user has at least one SSH key in
#      authorized_keys. We refuse to proceed otherwise — disabling
#      password auth without a working key is the classic way to lock
#      yourself out of a freshly-provisioned box.
#   2. Back up /etc/ssh/sshd_config → .bak (only on the first run; never
#      overwrites an existing backup, so the original baseline is
#      preserved across re-runs).
#   3. Apply the SSH hardening edits idempotently via `sed` with anchored
#      regexes — each setting is either updated in place or appended.
#   4. `sshd -t` to validate the new config; on failure, restore from
#      backup so the server is never left with broken sshd.
#   5. systemctl reload (not restart) sshd — reload reloads config
#      without dropping the current connection. The active session
#      survives.
#   6. fail2ban: drop a sshd jail at /etc/fail2ban/jail.d/sshd.local
#      with bantime 1h, maxretry 3, then restart fail2ban.
#   7. unattended-upgrades: install the package, enable security-only
#      auto-updates non-interactively (no curses prompt).
#   8. Logrotate: drop /etc/logrotate.d/saziqo-{api,caddy} configs.
#   9. Summary block + reminder to verify from a NEW terminal before
#      closing the existing root/deploy session.
#
# Re-runnable: every step checks-then-acts so a second invocation should
# produce no diff (apt may install pending security updates, however).

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
LOG_FILE="/var/log/saziqo-harden.log"
DEPLOY_USER="deploy"
SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_BACKUP="${SSHD_CONFIG}.bak"
F2B_JAIL="/etc/fail2ban/jail.d/sshd.local"
LOGROTATE_API="/etc/logrotate.d/saziqo-api"
LOGROTATE_CADDY="/etc/logrotate.d/saziqo-caddy"
BACKUP_CRON="/etc/cron.d/saziqo-backup"
BACKUP_SCRIPT="/opt/saziqo-platform/current/infra/scripts/backup.sh"

# SSH directives we enforce. Order matters — kept identical to the plan.
declare -A SSH_DIRECTIVES=(
	[PasswordAuthentication]="no"
	[PermitRootLogin]="no"
	[AllowUsers]="${DEPLOY_USER}"
	[MaxAuthTries]="3"
	[LoginGraceTime]="30"
	[ClientAliveInterval]="300"
	[ClientAliveCountMax]="2"
	[KbdInteractiveAuthentication]="no"
	[ChallengeResponseAuthentication]="no"
	[UsePAM]="yes"
)

# ──────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"
chmod 0640 "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { printf '\n[harden %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[harden %s] WARNING: %s\n' "$(date -Iseconds)" "$*" >&2; }
die()  { printf '\n[harden %s] ABORT: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────────
require_root() {
	if [[ $EUID -ne 0 ]]; then
		die "Must run as root. Try: sudo bash $0"
	fi
}

# Step 1 — SAFETY GATE. The single most common way to brick a fresh box
# is disabling PasswordAuthentication before a working key is in place.
# We refuse to proceed if authorized_keys is empty *or* contains only
# blanks/comments.
verify_deploy_ssh_key() {
	local auth_keys="/home/${DEPLOY_USER}/.ssh/authorized_keys"

	if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
		die "User '${DEPLOY_USER}' does not exist. Run provision.sh first."
	fi

	if [[ ! -f "${auth_keys}" ]]; then
		die "${auth_keys} not found. Add an SSH key for '${DEPLOY_USER}' before running this script."
	fi

	# Strip comments + blank lines, then count remaining non-empty lines.
	local key_count
	key_count="$(grep -cvE '^\s*(#|$)' "${auth_keys}" || true)"
	if [[ "${key_count}" -eq 0 ]]; then
		die "Add SSH key first. ${auth_keys} contains no usable keys.

Run from your local machine:
  cat ~/.ssh/id_ed25519.pub | ssh root@<host> 'cat >> ${auth_keys}'

Then verify from a NEW terminal:
  ssh ${DEPLOY_USER}@<host> 'whoami'

Once that succeeds, re-run this script."
	fi
	log "Found ${key_count} SSH key(s) for ${DEPLOY_USER}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 2 + 3 — back up sshd_config, apply directives idempotently
# ──────────────────────────────────────────────────────────────────────
backup_sshd_config() {
	if [[ ! -f "${SSHD_BACKUP}" ]]; then
		log "Backing up ${SSHD_CONFIG} → ${SSHD_BACKUP}"
		cp -p "${SSHD_CONFIG}" "${SSHD_BACKUP}"
	else
		log "${SSHD_BACKUP} already exists — preserving original baseline"
	fi
}

# set_sshd_directive <Key> <Value>
# - If a non-commented line exists for the key: replace its value
# - Else if a commented line exists: uncomment + set
# - Else: append a new line
# Anchored to start-of-line + optional whitespace, case-insensitive on
# the key (sshd treats keys as case-insensitive).
set_sshd_directive() {
	local key="$1" value="$2"
	local file="${SSHD_CONFIG}"

	# Active line (`^Key value`)
	if grep -qiE "^[[:space:]]*${key}[[:space:]]" "${file}"; then
		sed -i -E "s|^[[:space:]]*${key}[[:space:]].*|${key} ${value}|I" "${file}"
		log "  ${key}: updated to '${value}'"
		return
	fi
	# Commented line (`#Key value`)
	if grep -qiE "^[[:space:]]*#[[:space:]]*${key}[[:space:]]" "${file}"; then
		sed -i -E "s|^[[:space:]]*#[[:space:]]*${key}[[:space:]].*|${key} ${value}|I" "${file}"
		log "  ${key}: uncommented and set to '${value}'"
		return
	fi
	# Not present
	printf '\n%s %s\n' "${key}" "${value}" >> "${file}"
	log "  ${key}: appended as '${value}'"
}

apply_sshd_hardening() {
	log "Applying SSH hardening directives"
	for key in "${!SSH_DIRECTIVES[@]}"; do
		set_sshd_directive "${key}" "${SSH_DIRECTIVES[${key}]}"
	done
}

# Step 4 — validate the new config. On failure, restore the backup so
# we don't leave the server with a broken sshd.
test_sshd_config() {
	log "Validating sshd config with sshd -t"
	if ! sshd -t; then
		warn "sshd -t failed; restoring backup ${SSHD_BACKUP} → ${SSHD_CONFIG}"
		cp -p "${SSHD_BACKUP}" "${SSHD_CONFIG}"
		die "sshd_config validation failed; original restored. Inspect /etc/ssh/sshd_config diff."
	fi
}

# Step 5 — reload sshd. `reload` (vs restart) re-reads config without
# dropping the current connection, so an admin SSHed in stays connected
# even if the new config would have rejected their original auth.
reload_sshd() {
	log "Reloading sshd"
	if systemctl list-unit-files | grep -q '^ssh\.service'; then
		systemctl reload ssh
	else
		systemctl reload sshd
	fi
}

# ──────────────────────────────────────────────────────────────────────
# Step 6 — fail2ban
# ──────────────────────────────────────────────────────────────────────
configure_fail2ban() {
	log "Writing ${F2B_JAIL}"
	cat > "${F2B_JAIL}" <<'EOF'
# Managed by infra/scripts/harden.sh — Phase 15D
[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s
backend  = %(sshd_backend)s
maxretry = 3
findtime = 10m
bantime  = 1h
EOF
	chmod 0644 "${F2B_JAIL}"

	log "Restarting fail2ban"
	systemctl enable --now fail2ban
	systemctl restart fail2ban
}

# ──────────────────────────────────────────────────────────────────────
# Step 7 — unattended-upgrades, security-only
# ──────────────────────────────────────────────────────────────────────
configure_unattended_upgrades() {
	log "Installing unattended-upgrades"
	export DEBIAN_FRONTEND=noninteractive
	apt-get install -y --no-install-recommends unattended-upgrades apt-listchanges

	# Non-interactive equivalent of `dpkg-reconfigure -plow unattended-upgrades`.
	# Writes the two debconf files that ship with the package.
	cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
# Managed by infra/scripts/harden.sh — Phase 15D
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

	# Restrict to the security pocket only — feature/release upgrades
	# stay manual to avoid surprise breakages on a long-running prod box.
	# Email is OFF by default; uncomment Unattended-Upgrade::Mail line
	# and configure a working MTA to enable.
	cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
// Managed by infra/scripts/harden.sh — Phase 15D
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

Unattended-Upgrade::Package-Blacklist { };

Unattended-Upgrade::DevRelease "auto";

// Auto-fix interrupted dpkg runs after a reboot/crash.
Unattended-Upgrade::AutoFixInterruptedDpkg "true";

// Reboot only if the kernel was upgraded. 02:30 server time is the
// quiet window for an Iranian audience.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Automatic-Reboot-Time "02:30";

// Uncomment + set a real MTA to receive upgrade reports:
// Unattended-Upgrade::Mail "deploy@app.saziqo.ir";
// Unattended-Upgrade::MailReport "on-change";
EOF

	systemctl enable --now unattended-upgrades
	log "unattended-upgrades enabled (security-pocket only, auto-reboot 02:30)"
}

# ──────────────────────────────────────────────────────────────────────
# Step 8 — logrotate
# ──────────────────────────────────────────────────────────────────────
configure_logrotate() {
	log "Writing ${LOGROTATE_API}"
	cat > "${LOGROTATE_API}" <<'EOF'
# Managed by infra/scripts/harden.sh — Phase 15D
/var/log/saziqo-api/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 deploy deploy
    sharedscripts
    postrotate
        # The api container writes via pino to a mounted file. There's
        # no in-process signal to reopen — the next pino chunk creates a
        # fresh file post-rotate. If the volume of in-flight logs at
        # rotation time is non-trivial, switch to copytruncate instead.
        true
    endscript
}
EOF
	chmod 0644 "${LOGROTATE_API}"

	# Caddy already rotates by size via its own log directive (100MB × 10),
	# but a daily safety net guards against a runaway burst that would
	# blow past the size limit before Caddy's internal rotator catches up.
	log "Writing ${LOGROTATE_CADDY}"
	cat > "${LOGROTATE_CADDY}" <<'EOF'
# Managed by infra/scripts/harden.sh — Phase 15D
# Belt-and-suspenders: Caddy's own roll_size handles the primary case.
/var/log/caddy/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 caddy caddy
    sharedscripts
    postrotate
        systemctl reload caddy >/dev/null 2>&1 || true
    endscript
}
EOF
	chmod 0644 "${LOGROTATE_CADDY}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 9 — install daily backup cron entry (Phase 15E)
# Runs as deploy at 02:00 server time. Cron drops jobs from /etc/cron.d
# silently if file perms are too loose, so we set them tight.
# ──────────────────────────────────────────────────────────────────────
install_backup_cron() {
	log "Installing ${BACKUP_CRON}"
	cat > "${BACKUP_CRON}" <<EOF
# Managed by infra/scripts/harden.sh — Phase 15E
# Daily backup: pg_dump + uploads tarball + rclone push to S3.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * * ${DEPLOY_USER} ${BACKUP_SCRIPT}
EOF
	# /etc/cron.d files MUST be 0644 root:root or cron ignores them.
	chmod 0644 "${BACKUP_CRON}"
	chown root:root "${BACKUP_CRON}"
}

# ──────────────────────────────────────────────────────────────────────
# Final summary
# ──────────────────────────────────────────────────────────────────────
print_summary() {
	cat <<EOF

================================================================
saziqo platform — server hardening complete
================================================================

What changed:
  - sshd: PasswordAuthentication=no, PermitRootLogin=no,
          AllowUsers=${DEPLOY_USER}, MaxAuthTries=3, LoginGraceTime=30s,
          ClientAlive 300s × 2
  - sshd backup at ${SSHD_BACKUP} (preserved across re-runs)
  - fail2ban: ssh jail enabled (maxretry 3, bantime 1h, findtime 10m)
  - unattended-upgrades: security-only, auto-reboot at 02:30 if needed
  - logrotate: /var/log/saziqo-api/*.log + /var/log/caddy/*.log,
               daily × 14, compressed
  - cron: ${BACKUP_CRON} (daily 02:00 UTC, runs as ${DEPLOY_USER})
  - hardening log: ${LOG_FILE}

DO THIS NOW (before closing your existing session):

  1. From a brand-new local terminal, confirm key auth still works:

       ssh ${DEPLOY_USER}@<host> 'whoami'

  2. Confirm root login is rejected:

       ssh root@<host>          # should hang/fail; that's correct

  3. Confirm fail2ban is watching SSH:

       sudo fail2ban-client status sshd

  4. Run the full verification list in docs/security.md.

If step 1 fails — you can still recover via the existing session that
ran this script (do NOT close it). Restore with:
  cp ${SSHD_BACKUP} ${SSHD_CONFIG} && systemctl reload ssh

================================================================
EOF
}

main() {
	log "Starting saziqo-platform server hardening"
	require_root
	verify_deploy_ssh_key   # safety gate FIRST
	backup_sshd_config
	apply_sshd_hardening
	test_sshd_config
	reload_sshd
	configure_fail2ban
	configure_unattended_upgrades
	configure_logrotate
	install_backup_cron
	print_summary
	log "Hardening finished successfully"
}

main "$@"
