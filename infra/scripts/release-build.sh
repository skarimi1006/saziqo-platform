#!/usr/bin/env bash
# release-build.sh — Phase 16A: Compile both apps for production, then strip
# CLAUDE.md files from the build output so internal Claude context never
# ships to production.
#
# Why this matters:
#   CLAUDE.md files live in the source tree to guide Claude during dev
#   sessions. They contain implementation notes, decision history, and
#   sometimes hints about internal services or threat models. They are
#   not secrets in the credential sense, but they are *not* documentation
#   meant for end users — and an exfiltrated CLAUDE.md is an information
#   disclosure. We strip every one from the build artifact.
#
# Scope:
#   - apps/api/dist        (NestJS compiled JS)
#   - apps/web/.next       (Next.js build output, including standalone)
#   We do NOT recurse into node_modules — third-party CLAUDE.md files in
#   vendor packages are not ours to delete and don't leak our context.
#
# Output:
#   - release-strip-log.txt at the repo root listing every deleted path,
#     for audit. Truncated at the start of each run, so the log reflects
#     this run only.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_FILE="${REPO_ROOT}/release-strip-log.txt"

cd "${REPO_ROOT}"

log() { printf '[release-build %s] %s\n' "$(date -Iseconds)" "$*"; }

# ──────────────────────────────────────────────────────────────────────────────
# Step 1 — Build both apps
# ──────────────────────────────────────────────────────────────────────────────
log "Building api (nest build)"
pnpm --filter api build

log "Building web (next build)"
pnpm --filter web build

# ──────────────────────────────────────────────────────────────────────────────
# Step 2 — Strip CLAUDE.md from build outputs
# Truncate the log first so it reflects only this run.
# ──────────────────────────────────────────────────────────────────────────────
log "Stripping CLAUDE.md files from build outputs"
: > "${LOG_FILE}"

if [[ -d apps/api/dist ]]; then
	find apps/api/dist -name 'CLAUDE.md' -type f -print -delete >> "${LOG_FILE}"
fi

if [[ -d apps/web/.next ]]; then
	find apps/web/.next -name 'CLAUDE.md' -type f -print -delete >> "${LOG_FILE}"
fi

STRIPPED_COUNT="$(wc -l < "${LOG_FILE}" | tr -d '[:space:]')"
log "Stripped ${STRIPPED_COUNT} CLAUDE.md file(s) — see ${LOG_FILE}"
