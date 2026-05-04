#!/usr/bin/env bash
# deploy.sh — Phase 15G: Run from your local workstation to ship a release.
#
# What this does (in order):
#   1. Pre-flight: must be on main, clean working tree, all checks pass.
#   2. pnpm install --frozen-lockfile
#   3. pnpm typecheck && pnpm lint && pnpm test
#   4. pnpm audit --audit-level=high   (set FORCE_DEPLOY=1 to skip on fail)
#   5. Build Docker images locally.
#   6. Save images to a gzip tarball.
#   7. rsync the repo + tarball to a timestamped release dir on the VPS.
#   8. Remote: load images, run migrations, atomic symlink swap, compose up.
#   9. Health-check loop (30 × 2 s = 60 s max); auto-rollback on failure.
#  10. Prune releases: keep the 5 most recent on the VPS.
#
# Prerequisites:
#   - Key-based SSH to deploy@${DEPLOY_HOST} (no password prompt)
#   - docker, pnpm, rsync available on the local machine
#   - infra/.env.production.template filled in and placed on the VPS as
#     /opt/saziqo-platform/current/.env.production BEFORE the first run
#
# Environment variables (all have defaults):
#   DEPLOY_HOST   — target VPS hostname/IP   (default: app.saziqo.ir)
#   DEPLOY_USER   — SSH user                 (default: deploy)
#   DEPLOY_BASE   — release root on VPS      (default: /opt/saziqo-platform)
#   FORCE_DEPLOY  — set to 1 to bypass audit failures (default: 0)

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────
DEPLOY_HOST="${DEPLOY_HOST:-app.saziqo.ir}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/saziqo-platform}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"

RELEASE_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASES_DIR="${DEPLOY_BASE}/releases"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_TIMESTAMP}"
CURRENT_LINK="${DEPLOY_BASE}/current"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TARBALL="/tmp/saziqo-release-${RELEASE_TIMESTAMP}.tar.gz"

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────
log()  { printf '\n[deploy %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[deploy %s] WARN: %s\n' "$(date -Iseconds)" "$*" >&2; }
die()  { printf '\n[deploy %s] ERROR: %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }

# ──────────────────────────────────────────────────────────────────────────────
# Cleanup — remove local tarball on every exit path
# ──────────────────────────────────────────────────────────────────────────────
cleanup() {
	rm -f "${TARBALL}"
}
trap cleanup EXIT

# ──────────────────────────────────────────────────────────────────────────────
# Step 1 — Pre-flight: git hygiene
# ──────────────────────────────────────────────────────────────────────────────
preflight_git() {
	log "Checking git state"
	local branch
	branch="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
	if [[ "${branch}" != "main" ]]; then
		die "Not on main branch (current: ${branch}). Checkout main before deploying."
	fi

	if ! git -C "${REPO_ROOT}" diff --quiet; then
		die "Unstaged changes detected. Commit or stash before deploying."
	fi

	if ! git -C "${REPO_ROOT}" diff --cached --quiet; then
		die "Staged but uncommitted changes detected. Commit before deploying."
	fi

	local sha
	sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
	log "Branch: main @ ${sha}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 2 — Install dependencies
# ──────────────────────────────────────────────────────────────────────────────
install_deps() {
	log "pnpm install --frozen-lockfile"
	cd "${REPO_ROOT}"
	pnpm install --frozen-lockfile
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 3 — Typecheck, lint, test
# ──────────────────────────────────────────────────────────────────────────────
run_checks() {
	log "Running typecheck, lint, and tests"
	cd "${REPO_ROOT}"
	pnpm typecheck
	pnpm lint
	pnpm test
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 4 — Security audit
# ──────────────────────────────────────────────────────────────────────────────
run_audit() {
	log "Running pnpm audit --audit-level=high"
	cd "${REPO_ROOT}"
	if ! pnpm audit --audit-level=high; then
		if [[ "${FORCE_DEPLOY}" == "1" ]]; then
			warn "Audit found high-severity vulnerabilities — proceeding because FORCE_DEPLOY=1"
		else
			die "Audit failed. Fix vulnerabilities or set FORCE_DEPLOY=1 to override."
		fi
	fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 5 — Build Docker images locally
# ──────────────────────────────────────────────────────────────────────────────
build_images() {
	log "Building Docker images"
	cd "${REPO_ROOT}"
	docker compose -f infra/docker/docker-compose.prod.yml build api web
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 6 — Save images to a gzip tarball
# ──────────────────────────────────────────────────────────────────────────────
save_images() {
	log "Saving images → ${TARBALL}"
	docker save saziqo-api saziqo-web | gzip > "${TARBALL}"
	local size
	size="$(du -sh "${TARBALL}" | awk '{print $1}')"
	log "  tarball size: ${size}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 7 — rsync repo + tarball to the VPS release directory
# ──────────────────────────────────────────────────────────────────────────────
rsync_release() {
	log "Creating release directory on ${DEPLOY_USER}@${DEPLOY_HOST}:${RELEASE_DIR}"
	ssh "${DEPLOY_USER}@${DEPLOY_HOST}" "mkdir -p '${RELEASE_DIR}'"

	log "rsyncing repo source"
	rsync -az --delete \
		--exclude='.git' \
		--exclude='node_modules' \
		--exclude='.next' \
		--exclude='dist' \
		--exclude='.env*' \
		"${REPO_ROOT}/" \
		"${DEPLOY_USER}@${DEPLOY_HOST}:${RELEASE_DIR}/"

	log "Uploading release tarball"
	rsync -az "${TARBALL}" \
		"${DEPLOY_USER}@${DEPLOY_HOST}:${RELEASE_DIR}/release.tar.gz"
}

# ──────────────────────────────────────────────────────────────────────────────
# Step 8 + 9 — Remote: load images, migrate, swap symlink, compose up,
#              health-check, rollback on failure
# ──────────────────────────────────────────────────────────────────────────────
remote_deploy() {
	log "Running remote deploy on ${DEPLOY_USER}@${DEPLOY_HOST}"

	# All remote variables are expanded HERE (double-quoted), not on the remote,
	# because the remote user has no access to our local vars. Exception: the
	# heredoc body uses \$ / single-quotes for vars that must expand remotely.
	ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<ENDSSH
set -euo pipefail

log()  { printf '\n[remote-deploy %s] %s\n' "\$(date -Iseconds)" "\$*"; }
warn() { printf '\n[remote-deploy %s] WARN: %s\n' "\$(date -Iseconds)" "\$*" >&2; }
die()  { printf '\n[remote-deploy %s] ERROR: %s\n' "\$(date -Iseconds)" "\$*" >&2; exit 1; }

RELEASE_DIR="${RELEASE_DIR}"
RELEASES_DIR="${RELEASES_DIR}"
CURRENT_LINK="${CURRENT_LINK}"
COMPOSE_FILE="\${RELEASE_DIR}/infra/docker/docker-compose.prod.yml"

# ── 8a. Load Docker images ────────────────────────────────────────────────────
log "Loading Docker images from release.tar.gz"
gunzip < "\${RELEASE_DIR}/release.tar.gz" | docker load
rm -f "\${RELEASE_DIR}/release.tar.gz"

# ── 8b. Copy .env.production from current to new release ─────────────────────
if [[ -f "\${CURRENT_LINK}/.env.production" ]]; then
	log "Copying .env.production from current release"
	cp "\${CURRENT_LINK}/.env.production" "\${RELEASE_DIR}/.env.production"
	chmod 600 "\${RELEASE_DIR}/.env.production"
else
	die ".env.production not found at \${CURRENT_LINK}/.env.production"
fi

# ── 8c. Run Prisma migrations in the new api image ───────────────────────────
log "Running Prisma migrations"
docker compose -f "\${COMPOSE_FILE}" --env-file "\${RELEASE_DIR}/.env.production" \
	run --rm api npx prisma migrate deploy

# ── 8d. Atomic symlink swap ───────────────────────────────────────────────────
PREVIOUS_RELEASE="\$(readlink -f "\${CURRENT_LINK}" 2>/dev/null || true)"
log "Switching current symlink → \${RELEASE_DIR}"
ln -sfn "\${RELEASE_DIR}" "\${CURRENT_LINK}"

# ── 8e. Bring compose stack up ────────────────────────────────────────────────
log "Starting compose stack"
docker compose -f "\${COMPOSE_FILE}" --env-file "\${RELEASE_DIR}/.env.production" \
	up -d

# ── 8f. Health-check loop (30 × 2 s = 60 s max) ──────────────────────────────
log "Waiting for API health check (max 60s)"
HEALTHY=0
for i in \$(seq 1 30); do
	if curl -sf http://localhost:3001/api/v1/health >/dev/null 2>&1; then
		log "  healthy after \$((i * 2))s"
		HEALTHY=1
		break
	fi
	sleep 2
done

if [[ "\${HEALTHY}" -eq 0 ]]; then
	warn "Health check failed — rolling back to \${PREVIOUS_RELEASE}"

	if [[ -z "\${PREVIOUS_RELEASE}" || ! -d "\${PREVIOUS_RELEASE}" ]]; then
		die "Rollback target not found: '\${PREVIOUS_RELEASE}'. Manual intervention required."
	fi

	ln -sfn "\${PREVIOUS_RELEASE}" "\${CURRENT_LINK}"

	PREV_COMPOSE="\${PREVIOUS_RELEASE}/infra/docker/docker-compose.prod.yml"
	PREV_ENV="\${PREVIOUS_RELEASE}/.env.production"
	docker compose -f "\${PREV_COMPOSE}" --env-file "\${PREV_ENV}" \
		up -d --force-recreate

	die "Deployment of \${RELEASE_DIR} failed. Rolled back to \${PREVIOUS_RELEASE}."
fi

# ── 8g. Prune old releases — keep 5 most recent ──────────────────────────────
log "Pruning old releases (keep 5)"
RELEASES="\$(ls -1dt "\${RELEASES_DIR}"/*/ 2>/dev/null | tail -n +6)"
if [[ -n "\${RELEASES}" ]]; then
	echo "\${RELEASES}" | xargs rm -rf
	log "  removed: \$(echo "\${RELEASES}" | wc -l) old release(s)"
else
	log "  nothing to prune"
fi

log "Release \${RELEASE_DIR} deployed successfully"
ENDSSH
}

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
main() {
	log "Starting deploy — release ${RELEASE_TIMESTAMP} → ${DEPLOY_USER}@${DEPLOY_HOST}"

	preflight_git
	install_deps
	run_checks
	run_audit
	build_images
	save_images
	rsync_release
	remote_deploy

	log "Deploy complete — release ${RELEASE_TIMESTAMP}"
	echo ""
	echo "================================================================"
	echo " Deployed: ${RELEASE_TIMESTAMP}"
	echo " Host:     ${DEPLOY_USER}@${DEPLOY_HOST}"
	echo " Release:  ${RELEASE_DIR}"
	echo "================================================================"
}

main "$@"
