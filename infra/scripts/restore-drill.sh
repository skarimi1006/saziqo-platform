#!/usr/bin/env bash
# restore-drill.sh — Phase 15F: Pull the latest pg_dump from object
# storage, restore it into a throwaway Postgres container, run sanity
# queries, then tear everything down.
#
# Run as the deploy user on the VPS:
#   /opt/saziqo-platform/current/infra/scripts/restore-drill.sh
#
# Or locally if rclone + docker are configured against the same remote.
#
# This is the *only* way we know the backup pipeline actually works.
# Schedule it monthly (manually for v1; cron candidate for v2).
#
# Side-effects on the host:
#   - Pulls one .sql.gz to a temp dir (cleaned up on exit)
#   - Spins up `saziqo-restore-test` container on host port 5433
#   - Tears down the container at the end (success OR failure)
#
# Production data is never touched. The drill container has its own
# data dir under docker's anonymous volume which is removed with the
# container.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
LOG_FILE="/var/log/saziqo-restore-drill.log"
ENV_FILE="/opt/saziqo-platform/current/.env.production"

CONTAINER_NAME="saziqo-restore-test"
PG_IMAGE="postgres:16-alpine"
HOST_PORT="5433"
TEST_USER="postgres"
TEST_PASSWORD="test"
TEST_DB="saziqo_restore"

WORK_DIR="$(mktemp -d -t saziqo-restore-drill.XXXXXX)"

# ──────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
touch "${LOG_FILE}" 2>/dev/null || LOG_FILE="${WORK_DIR}/drill.log"

log()  { printf '\n[restore-drill %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[restore-drill %s] WARN: %s\n' "$(date -Iseconds)" "$*" >&2; }
die()  { printf '\n[restore-drill %s] ERROR: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

exec > >(tee -a "${LOG_FILE}") 2>&1

# ──────────────────────────────────────────────────────────────────────
# Cleanup — runs on every exit path so we never leak the test container
# or the temp directory. Stop+rm is best-effort; if the container was
# never created, both calls succeed silently because of the `|| true`.
# ──────────────────────────────────────────────────────────────────────
cleanup() {
	local rc=$?
	log "Cleanup: removing ${CONTAINER_NAME} and ${WORK_DIR}"
	docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
	docker rm   "${CONTAINER_NAME}" >/dev/null 2>&1 || true
	rm -rf "${WORK_DIR}"
	if [[ "${rc}" -ne 0 ]]; then
		warn "Drill exited non-zero (${rc})"
	fi
	exit "${rc}"
}
trap cleanup EXIT INT TERM

# ──────────────────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────────────────
require_tools() {
	for tool in docker rclone gunzip; do
		command -v "${tool}" >/dev/null 2>&1 || die "Required tool not on PATH: ${tool}"
	done
}

require_env() {
	if [[ ! -f "${ENV_FILE}" ]]; then
		die "${ENV_FILE} not found. Stage .env.production before running the drill."
	fi
	# shellcheck disable=SC1090
	set -a; source "${ENV_FILE}"; set +a
	: "${RCLONE_REMOTE_NAME:?RCLONE_REMOTE_NAME unset in ${ENV_FILE}}"
	: "${S3_BUCKET:?S3_BUCKET unset in ${ENV_FILE}}"
}

require_rclone_remote() {
	# `rclone listremotes` prints "name:" per configured remote.
	if ! rclone listremotes | grep -qx "${RCLONE_REMOTE_NAME}:"; then
		die "rclone remote '${RCLONE_REMOTE_NAME}:' not configured.
Run: rclone config — see docs/operations.md."
	fi
}

require_port_free() {
	if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${HOST_PORT}\$"; then
		die "Host port ${HOST_PORT} already in use. Stop the holder or pick a different port."
	fi
}

# ──────────────────────────────────────────────────────────────────────
# Step 1 — fetch the most recent pg_dump from the remote
# ──────────────────────────────────────────────────────────────────────
fetch_latest_dump() {
	local remote="${RCLONE_REMOTE_NAME}:${S3_BUCKET}/postgres"
	log "Looking up most recent backup on ${remote}"

	# `rclone lsl` columns: size, date YYYY-MM-DD, time HH:MM:SS.fff, hash?, name
	# Sort by mtime (col 2 + 3) descending and take the first .sql.gz.
	local newest
	newest="$(rclone lsl "${remote}" \
		| awk '{ printf "%s %s %s\n", $2, $3, $4 }' \
		| sort -r \
		| awk 'NR==1 { print $3 }')"

	if [[ -z "${newest}" ]]; then
		die "No files found on ${remote}. Has any backup ever run?"
	fi
	log "Newest backup: ${newest}"

	rclone copy "${remote}/${newest}" "${WORK_DIR}/" --progress
	DUMP_FILE="${WORK_DIR}/${newest}"
	if [[ ! -s "${DUMP_FILE}" ]]; then
		die "Downloaded dump is empty: ${DUMP_FILE}"
	fi
	log "Fetched $(stat -c '%s' "${DUMP_FILE}" 2>/dev/null || stat -f '%z' "${DUMP_FILE}") bytes → ${DUMP_FILE}"
}

# ──────────────────────────────────────────────────────────────────────
# Step 2 — spin up the throwaway Postgres
# ──────────────────────────────────────────────────────────────────────
start_test_postgres() {
	# Defensive: clean up an orphan from a previous failed run.
	docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

	log "Starting ${CONTAINER_NAME} on host port ${HOST_PORT}"
	docker run -d \
		--name "${CONTAINER_NAME}" \
		-e POSTGRES_PASSWORD="${TEST_PASSWORD}" \
		-e POSTGRES_DB="${TEST_DB}" \
		-p "${HOST_PORT}:5432" \
		"${PG_IMAGE}" >/dev/null
}

# ──────────────────────────────────────────────────────────────────────
# Step 3 — wait until the test postgres is accepting connections.
# pg_isready is shipped inside postgres:16-alpine, so we exec it there
# rather than requiring the host to have psql/pg_isready installed.
# ──────────────────────────────────────────────────────────────────────
wait_for_postgres() {
	log "Waiting for ${CONTAINER_NAME} to accept connections (max 60s)"
	local i=0
	while ((i < 60)); do
		if docker exec "${CONTAINER_NAME}" pg_isready -U "${TEST_USER}" -d "${TEST_DB}" >/dev/null 2>&1; then
			log "  ready after ${i}s"
			return
		fi
		sleep 1
		i=$((i + 1))
	done
	docker logs --tail 80 "${CONTAINER_NAME}"
	die "Postgres did not become ready within 60s"
}

# ──────────────────────────────────────────────────────────────────────
# Step 4 — gunzip the dump into psql inside the container
# ──────────────────────────────────────────────────────────────────────
restore_dump() {
	log "Restoring dump → ${TEST_DB}"
	# pg_dump output references its origin database role (saziqo).
	# Suppress 'role does not exist' / 'must be member of' noise by
	# pre-creating the role; harmless on a fresh container.
	docker exec -e PGPASSWORD="${TEST_PASSWORD}" "${CONTAINER_NAME}" \
		psql -U "${TEST_USER}" -d "${TEST_DB}" -v ON_ERROR_STOP=0 \
		-c "CREATE ROLE saziqo WITH LOGIN SUPERUSER PASSWORD 'restore_drill';" >/dev/null 2>&1 || true

	# Pipe the dump into the container's psql.
	gunzip -c "${DUMP_FILE}" \
		| docker exec -i -e PGPASSWORD="${TEST_PASSWORD}" "${CONTAINER_NAME}" \
		    psql -U "${TEST_USER}" -d "${TEST_DB}" -v ON_ERROR_STOP=1 \
		>/dev/null
	log "Restore complete"
}

# ──────────────────────────────────────────────────────────────────────
# Step 5 — sanity queries. Plan calls for users, payments-by-status,
# and schemata. Tables are quoted as the pg_dump emits them (lower-case,
# unquoted in the schema).
# ──────────────────────────────────────────────────────────────────────
psql_query() {
	docker exec -e PGPASSWORD="${TEST_PASSWORD}" "${CONTAINER_NAME}" \
		psql -U "${TEST_USER}" -d "${TEST_DB}" -tAX -c "$1"
}

run_sanity_queries() {
	local users_count payments_succeeded schemas

	users_count="$(psql_query 'SELECT COUNT(*) FROM users;')"
	payments_succeeded="$(psql_query "SELECT COUNT(*) FROM payments WHERE status = 'SUCCEEDED';")"
	schemas="$(psql_query 'SELECT string_agg(schema_name, ',' ORDER BY schema_name) FROM information_schema.schemata;')"

	cat <<EOF

============== Restore Drill — Sanity Report ==============
  source dump:           $(basename "${DUMP_FILE}")
  users count:           ${users_count}
  payments (SUCCEEDED):  ${payments_succeeded}
  schemas present:       ${schemas}
===========================================================
EOF

	# Hard checks — fail the drill if the dump looks broken.
	if ! [[ "${users_count}" =~ ^[0-9]+$ ]]; then
		die "users count was non-numeric: '${users_count}'"
	fi
	if ! [[ "${payments_succeeded}" =~ ^[0-9]+$ ]]; then
		die "payments-succeeded count was non-numeric: '${payments_succeeded}'"
	fi
	# `public` must exist in every legitimate Postgres restore.
	if [[ "${schemas}" != *public* ]]; then
		die "'public' schema missing from restored DB"
	fi

	log "Sanity queries passed"
}

main() {
	log "Starting restore drill"
	require_tools
	require_env
	require_rclone_remote
	require_port_free

	fetch_latest_dump
	start_test_postgres
	wait_for_postgres
	restore_dump
	run_sanity_queries

	log "Drill SUCCESS — backup pipeline is verified"
}

main "$@"
