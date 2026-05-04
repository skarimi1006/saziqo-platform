#!/usr/bin/env bash
# backup.sh — Phase 15E: Daily Postgres + uploads snapshot, pushed to
# remote object storage (Arvan S3-compatible by default).
#
# Triggered by /etc/cron.d/saziqo-backup at 02:00 server time. Safe to
# run manually as the deploy user any time:
#
#   /opt/saziqo-platform/current/infra/scripts/backup.sh
#
# Behavior:
#   - flock-guarded against concurrent runs (cron + manual = no overlap)
#   - Sources .env.production for the remote name and S3 hints (rclone
#     reads its own credentials from rclone.conf — see docs/operations.md)
#   - Streams pg_dump through gzip into a dated file
#   - Tars the uploads dir into a dated tarball
#   - rclone copies both directories to remote:saziqo-backups/{postgres,files}
#   - Local retention 14d, remote retention 30d
#   - Tee'd to /var/log/saziqo-backup.log
#   - Best-effort email summary via `mail` if it's installed; otherwise
#     just logged. Don't fail the backup just because email isn't wired up.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
LOG_FILE="/var/log/saziqo-backup.log"
LOCK_FILE="/var/run/saziqo-backup.lock"
ENV_FILE="/opt/saziqo-platform/current/.env.production"

BACKUP_ROOT="/opt/saziqo-platform/backups"
PG_DIR="${BACKUP_ROOT}/postgres"
FILES_DIR="${BACKUP_ROOT}/files"
UPLOADS_SRC="/opt/saziqo-platform/shared/uploads"

# Compose project name → container name. docker-compose.prod.yml sets
# `name: saziqo-platform`, which yields container "saziqo-platform-postgres-1".
# Override via env if the operator has used a different project name.
PG_CONTAINER="${PG_CONTAINER:-saziqo-platform-postgres-1}"

LOCAL_RETENTION_DAYS=14
REMOTE_RETENTION="30d"

DATE_TAG="$(date +%F)"
PG_OUT="${PG_DIR}/saziqo-${DATE_TAG}.sql.gz"
FILES_OUT="${FILES_DIR}/files-${DATE_TAG}.tar.gz"

# ──────────────────────────────────────────────────────────────────────
# Logging — tee everything to the log file
# ──────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}"
chmod 0640 "${LOG_FILE}" 2>/dev/null || true

log()  { printf '\n[backup %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[backup %s] WARN: %s\n' "$(date -Iseconds)" "$*" >&2; }
die()  { printf '\n[backup %s] ERROR: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────
# Flock guard. The leading `[ "${FLOCKER:-}" = "$0" ]` test is the
# canonical idiom for self-flocking: if we don't hold the lock yet,
# re-exec ourselves under flock with FLOCKER set so the inner instance
# skips the re-exec. -n = non-blocking, exit 1 if already held.
# Doing this before tee + log setup keeps the second-run output minimal.
# ──────────────────────────────────────────────────────────────────────
if [ "${FLOCKER:-}" != "$0" ]; then
	exec env FLOCKER="$0" flock -n "${LOCK_FILE}" "$0" "$@" || {
		echo "[backup $(date -Iseconds)] another instance is already running; skipping" >> "${LOG_FILE}"
		exit 0
	}
fi

# Now safe to tee — only the locking instance reaches this point.
exec > >(tee -a "${LOG_FILE}") 2>&1

# ──────────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────────
require_tools() {
	for tool in docker gzip tar rclone find; do
		if ! command -v "${tool}" >/dev/null 2>&1; then
			die "Required tool not on PATH: ${tool}"
		fi
	done
}

require_env() {
	if [[ ! -f "${ENV_FILE}" ]]; then
		die "${ENV_FILE} not found. Stage .env.production before running backups."
	fi
	# shellcheck disable=SC1090
	set -a; source "${ENV_FILE}"; set +a

	: "${RCLONE_REMOTE_NAME:?RCLONE_REMOTE_NAME unset in ${ENV_FILE}}"
	: "${S3_BUCKET:?S3_BUCKET unset in ${ENV_FILE}}"
}

require_dirs() {
	mkdir -p "${PG_DIR}" "${FILES_DIR}"
}

require_postgres_container() {
	if ! docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
		die "Postgres container '${PG_CONTAINER}' is not running.
Override with PG_CONTAINER=<name> if you renamed the compose project."
	fi
}

# ──────────────────────────────────────────────────────────────────────
# Step 1 — pg_dump (streamed through gzip; never lands raw on disk)
# ──────────────────────────────────────────────────────────────────────
dump_postgres() {
	log "pg_dump → ${PG_OUT}"
	# `set -o pipefail` (already on) ensures pg_dump failure trips the
	# whole pipeline. -Fc would give a smaller custom-format dump but
	# plain SQL+gzip is friendlier for ad-hoc inspection during a drill.
	docker exec "${PG_CONTAINER}" \
		pg_dump -U "${POSTGRES_USER:-saziqo}" -d "${POSTGRES_DB:-saziqo}" \
	| gzip -9 > "${PG_OUT}"

	local size
	size="$(stat -c '%s' "${PG_OUT}" 2>/dev/null || stat -f '%z' "${PG_OUT}")"
	if [[ "${size}" -lt 1024 ]]; then
		die "pg_dump output suspiciously small (${size} bytes). Aborting."
	fi
	log "pg_dump complete (${size} bytes)"
}

# ──────────────────────────────────────────────────────────────────────
# Step 2 — tar uploads dir
# ──────────────────────────────────────────────────────────────────────
tar_uploads() {
	if [[ ! -d "${UPLOADS_SRC}" ]]; then
		warn "${UPLOADS_SRC} missing — creating empty placeholder so the tarball isn't a hard error"
		mkdir -p "${UPLOADS_SRC}"
	fi
	log "tar → ${FILES_OUT}"
	tar -czf "${FILES_OUT}" -C "${UPLOADS_SRC}" .

	local size
	size="$(stat -c '%s' "${FILES_OUT}" 2>/dev/null || stat -f '%z' "${FILES_OUT}")"
	log "tar complete (${size} bytes)"
}

# ──────────────────────────────────────────────────────────────────────
# Step 3 — rclone copy. `copy` is one-way and skips already-uploaded
# files (idempotent across re-runs of the same day). We push each dir
# separately so the remote layout mirrors local exactly.
# ──────────────────────────────────────────────────────────────────────
upload_to_remote() {
	local remote="${RCLONE_REMOTE_NAME}:${S3_BUCKET}"
	log "rclone copy ${PG_DIR} → ${remote}/postgres"
	rclone copy "${PG_DIR}" "${remote}/postgres" --transfers=2 --checkers=4

	log "rclone copy ${FILES_DIR} → ${remote}/files"
	rclone copy "${FILES_DIR}" "${remote}/files" --transfers=2 --checkers=4
}

# ──────────────────────────────────────────────────────────────────────
# Step 4 — local retention (14 days)
# Find both files and (now-empty) dirs untouched for >14d.
# ──────────────────────────────────────────────────────────────────────
prune_local() {
	log "Pruning local backups older than ${LOCAL_RETENTION_DAYS}d"
	find "${PG_DIR}" -type f -name '*.sql.gz' -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete || true
	find "${FILES_DIR}" -type f -name '*.tar.gz' -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete || true
}

# ──────────────────────────────────────────────────────────────────────
# Step 5 — remote retention (30 days). `rclone delete --min-age` is
# non-destructive against newer files. We scope to subpaths so a typo
# in S3_BUCKET can't reach unrelated remote data.
# ──────────────────────────────────────────────────────────────────────
prune_remote() {
	local remote="${RCLONE_REMOTE_NAME}:${S3_BUCKET}"
	log "Pruning remote backups older than ${REMOTE_RETENTION}"
	rclone delete --min-age "${REMOTE_RETENTION}" "${remote}/postgres" || warn "remote prune (postgres) failed; continuing"
	rclone delete --min-age "${REMOTE_RETENTION}" "${remote}/files"    || warn "remote prune (files) failed; continuing"
}

# ──────────────────────────────────────────────────────────────────────
# Optional: best-effort email summary. v1 has no MTA on the box, so
# this is a soft no-op when `mail` isn't installed.
# ──────────────────────────────────────────────────────────────────────
mail_summary() {
	local subject="$1" body="$2"
	if ! command -v mail >/dev/null 2>&1; then
		log "mail(1) not installed; skipping email summary"
		return 0
	fi
	local recipient="${BACKUP_EMAIL:-deploy@localhost}"
	printf '%s\n' "${body}" | mail -s "${subject}" "${recipient}" || warn "mail send failed (non-fatal)"
}

# ──────────────────────────────────────────────────────────────────────
# Orchestration. Trap any failure to email a "FAILED" summary before the
# process exits, then re-raise the original status code.
# ──────────────────────────────────────────────────────────────────────
on_failure() {
	local rc=$?
	mail_summary "[saziqo backup FAILED] ${DATE_TAG}" \
"Backup run on $(hostname) at $(date -Iseconds) failed with exit ${rc}.
See ${LOG_FILE} for details."
	exit "${rc}"
}
trap on_failure ERR

main() {
	log "Starting saziqo-platform backup run for ${DATE_TAG}"
	require_tools
	require_env
	require_dirs
	require_postgres_container

	dump_postgres
	tar_uploads
	upload_to_remote
	prune_local
	prune_remote

	# Disarm the failure trap before the success summary so a failed
	# `mail` call doesn't trigger on_failure recursively.
	trap - ERR

	mail_summary "[saziqo backup OK] ${DATE_TAG}" \
"Backup run on $(hostname) at $(date -Iseconds) succeeded.
  Postgres dump: ${PG_OUT}
  Files tarball: ${FILES_OUT}
  Remote target: ${RCLONE_REMOTE_NAME}:${S3_BUCKET}
  See ${LOG_FILE} for full output."

	log "Backup run complete"
}

main "$@"
