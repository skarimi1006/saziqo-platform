#!/usr/bin/env bash
# scan-deps.sh — Phase 16E: dependency and container image vulnerability scanner.
#
# What this does:
#   1. pnpm audit --audit-level=moderate  (fails if moderate+ unfixed CVEs found)
#   2. trivy image scans for saziqo-api and saziqo-web (if images exist locally)
#   3. Saves the full report to scan-report.txt in the repo root
#
# Usage:
#   pnpm scan:deps                  (via root package.json)
#   bash infra/scripts/scan-deps.sh
#
# trivy is installed on the VPS by provision.sh; running locally requires
# a local trivy installation. Missing trivy skips image scans with a warning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORT_FILE="${REPO_ROOT}/scan-report.txt"

# Redirect all output (stdout + stderr) to both the terminal and the report file.
# Using exec avoids subshell issues — variable mutations below are visible in main.
exec > >(tee "${REPORT_FILE}") 2>&1

log()  { printf '\n[scan %s] %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\n[scan %s] WARN: %s\n' "$(date -Iseconds)" "$*" >&2; }

echo "================================================================"
echo " saziqo-platform security scan — $(date -Iseconds)"
echo "================================================================"

# ── pnpm audit ──────────────────────────────────────────────────────────────
log "pnpm audit --audit-level=moderate"
cd "${REPO_ROOT}"
AUDIT_EXIT=0
pnpm audit --audit-level=moderate || AUDIT_EXIT=$?

# ── Trivy image scans ────────────────────────────────────────────────────────
if command -v trivy >/dev/null 2>&1; then
  for image in saziqo-api saziqo-web; do
    if docker image inspect "${image}" >/dev/null 2>&1; then
      log "trivy image: ${image}"
      trivy image --exit-code 0 --severity HIGH,CRITICAL "${image}"
    else
      log "trivy image: ${image} — not found locally, skipping"
    fi
  done
else
  warn "trivy not installed — image scans skipped (provision.sh installs it on the VPS)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo " Full report: ${REPORT_FILE}"
if [[ "${AUDIT_EXIT}" -ne 0 ]]; then
  echo " RESULT: FAILED — moderate-or-higher vulnerabilities detected"
  echo "================================================================"
  exit "${AUDIT_EXIT}"
else
  echo " RESULT: PASSED"
  echo "================================================================"
fi
