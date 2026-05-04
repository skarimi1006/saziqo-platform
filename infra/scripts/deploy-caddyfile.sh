#!/usr/bin/env bash
# deploy-caddyfile.sh — Phase 15B: Validate and reload Caddy with the
# repo's Caddyfile.
#
# Run on the VPS as root (or via sudo). Usage:
#   sudo bash infra/scripts/deploy-caddyfile.sh
#
# Behavior:
#   1. Resolve the source Caddyfile relative to this script's location
#      so the script works whether you cd into the repo or invoke it via
#      an absolute path.
#   2. Copy it to /etc/caddy/Caddyfile (mode 0644, root:root).
#   3. Run `caddy validate` — if it fails, the running Caddy is
#      untouched and we exit non-zero.
#   4. On valid: `systemctl reload caddy`. Reload is graceful (no
#      dropped connections); restart is avoided so existing TLS sessions
#      survive.
#   5. Log every step to /var/log/saziqo-caddy-deploy.log.

set -euo pipefail

LOG_FILE="/var/log/saziqo-caddy-deploy.log"
TARGET="/etc/caddy/Caddyfile"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${SCRIPT_DIR}/../caddy/Caddyfile"

mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"
chmod 0640 "${LOG_FILE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { printf '\n[deploy-caddyfile %s] %s\n' "$(date -Iseconds)" "$*"; }
die()  { printf '\n[deploy-caddyfile %s] ERROR: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

require_root() {
	if [[ $EUID -ne 0 ]]; then
		die "Must run as root. Try: sudo bash $0"
	fi
}

require_caddy() {
	if ! command -v caddy >/dev/null 2>&1; then
		die "caddy not installed. Run infra/scripts/provision.sh first."
	fi
	if ! systemctl list-unit-files | grep -q '^caddy\.service'; then
		die "caddy.service not registered with systemd."
	fi
}

require_source() {
	if [[ ! -f "${SOURCE}" ]]; then
		die "Source Caddyfile not found at ${SOURCE}"
	fi
}

stage_caddyfile() {
	log "Copying ${SOURCE} → ${TARGET}"
	install -o root -g root -m 0644 "${SOURCE}" "${TARGET}"
}

validate_caddyfile() {
	log "Validating ${TARGET}"
	if ! caddy validate --config "${TARGET}" --adapter caddyfile; then
		die "Caddy config failed validation; running config left untouched."
	fi
}

reload_caddy() {
	log "Reloading caddy via systemctl"
	systemctl reload caddy
	# A successful reload returns 0 instantly but the unit can transition
	# to failed shortly after if the new config errors out at runtime.
	# Wait a beat then re-check.
	sleep 1
	if ! systemctl is-active --quiet caddy; then
		die "caddy is not active after reload. Inspect: journalctl -u caddy -n 80"
	fi
	log "caddy reloaded; service is active"
}

main() {
	log "Starting Caddyfile deployment"
	require_root
	require_caddy
	require_source
	stage_caddyfile
	validate_caddyfile
	reload_caddy
	log "Deployment complete"
}

main "$@"
