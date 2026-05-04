# Deployment — saziqo Platform

Operational runbook for the production deployment. Read end-to-end before the first production deploy; thereafter use the section headings as a jump table.

Cross-references:

- `docs/operations.md` — day-2 procedures (backups, restore, common admin tasks, incident response)
- `docs/security.md` — hardening, vulnerability management, secret rotation
- `docs/server-setup.md` — VPS rental, DNS, initial root → deploy SSH

---

## Quick reference

```bash
# Routine deploy from your workstation, on main, clean tree
./infra/scripts/deploy.sh                          # or: make deploy

# Tail prod logs
make prod-logs                                     # api + web + caddy

# Health
curl -sS https://app.saziqo.ir/api/v1/health       # → {"data":{"status":"ok"}}

# Open a shell into the api container
make prod-shell-api

# Rollback (atomic symlink swap)
ssh deploy@app.saziqo.ir
ln -sfn /opt/saziqo-platform/releases/<previous-ts> /opt/saziqo-platform/current
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production up -d --force-recreate
```

---

## Pre-deploy checklist

Run through this list **before every production deploy**. Items 1–6 are local; 7–9 are remote.

1. **Branch + tree clean**
   ```bash
   git rev-parse --abbrev-ref HEAD     # → main
   git status                          # → nothing to commit
   ```
2. **Lockfile in sync**
   ```bash
   pnpm install --frozen-lockfile      # exits 0
   ```
3. **All checks green**
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
4. **Security scan clean**
   ```bash
   pnpm scan:deps                      # exits 0; report at scan-report.txt
   ```
5. **Audit clean** (deploy.sh runs `--audit-level=high`; you can pre-check with stricter)
   ```bash
   pnpm audit --audit-level=moderate
   ```
6. **Docker daemon up**
   ```bash
   docker info >/dev/null              # exits 0
   ```
7. **SSH to VPS works without prompt**
   ```bash
   ssh deploy@app.saziqo.ir whoami     # → deploy
   ```
8. **`.env.production` staged on VPS, no `CHANGE_ME` placeholders**
   ```bash
   ssh deploy@app.saziqo.ir 'grep -c CHANGE_ME /opt/saziqo-platform/current/.env.production || true'
   # → 0
   ```
9. **Migrations reviewed** — open `apps/api/prisma/migrations/` and confirm any new SQL is reversible-in-spirit (no DROP COLUMN on a populated column without a follow-up)

If any item fails, **do not deploy**. Fix the cause, then re-run the list from the top.

---

## TLS and Caddy

Phase 15B. The Caddyfile lives at `infra/caddy/Caddyfile` in the repo and is deployed to `/etc/caddy/Caddyfile` on the VPS by `infra/scripts/deploy-caddyfile.sh`.

### What Caddy does

- Terminates TLS for `app.saziqo.ir` (and 308-redirects `www.app.saziqo.ir` to the apex).
- Reverse-proxies `/api/*` to the NestJS container on `localhost:3001`.
- Reverse-proxies everything else to the Next.js container on `localhost:3000`.
- Sets HSTS, CSP, frame-deny, no-sniff, referrer-policy, permissions-policy, and removes the `Server` header.
- Compresses responses with gzip/zstd.
- Logs JSON access lines to `/var/log/caddy/access.log` with size-based rotation (100 MB × 10 files).

### First boot — automatic certificate provisioning

Once `app.saziqo.ir` resolves to the VPS public IP and ports 80/443 are open (UFW from Phase 15A already allows both), Caddy provisions a Let's Encrypt certificate on the first inbound HTTPS request. No manual steps:

1. DNS for `app.saziqo.ir` → VPS IP (set up in `docs/server-setup.md` §1.2).
2. UFW allows 80 and 443 (`provision.sh` already did this).
3. The Caddyfile is in place (`deploy-caddyfile.sh`).
4. Hit `https://app.saziqo.ir` from any browser. Caddy completes the ACME HTTP-01 challenge over port 80 and serves the cert from then on.

If the first hit fails with a TLS error, check:

- `journalctl -u caddy -n 100` for ACME errors (rate limits, DNS not propagated, etc.)
- `dig +short app.saziqo.ir` resolves to the VPS IP from the open internet
- Ports 80 + 443 are reachable: `curl -v https://app.saziqo.ir` from another network

### Renewal

Caddy renews certificates automatically — typically 30 days before expiry, in the background, with no service interruption. There is nothing to schedule and no cron job to maintain. Renewals are logged to the systemd journal (`journalctl -u caddy`).

### Manual reload after a Caddyfile change

After editing `infra/caddy/Caddyfile` in the repo and pushing/pulling onto the VPS:

```bash
sudo bash ./infra/scripts/deploy-caddyfile.sh
```

The script:

1. Stages `infra/caddy/Caddyfile` to `/etc/caddy/Caddyfile` (mode 0644, root-owned).
2. Runs `caddy validate --config /etc/caddy/Caddyfile`. If it fails, the running config is left untouched and the script exits non-zero.
3. On valid: `systemctl reload caddy` (graceful, zero-downtime). Existing TLS sessions survive.
4. Re-checks `systemctl is-active caddy` after a 1-second pause to catch reload-time errors that surface in the unit state rather than in `validate`.
5. Logs every step to `/var/log/saziqo-caddy-deploy.log`.

### Content-Security-Policy notes

- `script-src 'self' 'unsafe-inline'` is required for Next.js's inline runtime. We can tighten this with nonces in v1.5.
- `connect-src 'self' https://api.zarinpal.com` is defense in depth. Today, server-to-server calls to ZarinPal originate from the NestJS container and don't traverse the browser, so this directive is only relevant if a future frontend ever calls ZarinPal directly via `fetch`/XHR.
- `form-action 'self' https://www.zarinpal.com` permits the payment hand-off POST that redirects the user from our checkout page to ZarinPal's hosted form.
- `frame-ancestors 'none'` plus `X-Frame-Options: DENY` give belt-and-suspenders clickjacking protection.
- HSTS is set to 1 year with `includeSubDomains; preload` — once the deployment is stable, submit the apex to <https://hstspreload.org> for browser preload inclusion.

### Verifying the deployment

After the first successful TLS handshake:

```bash
# Frontend serves
curl -sSI https://app.saziqo.ir | head -n 1
# → HTTP/2 200

# API health
curl -sS https://app.saziqo.ir/api/v1/health
# → {"data":{"status":"ok"}}

# Security headers grade
# Test at https://securityheaders.com/?q=app.saziqo.ir → expect A or higher
# Test at https://www.ssllabs.com/ssltest/ → expect A or A+
```

### Known caveat to address before the first production hit

The Caddyfile uses `handle_path /api/*`, which **strips** the `/api` prefix before proxying to upstream. Our NestJS app sets `setGlobalPrefix('api/v1')`, so it expects the full `/api/v1/...` path. This means the API request routing will need either:

- The Caddyfile changed to `handle /api/*` (no strip), **or**
- The NestJS prefix changed to just `v1` and the Caddyfile updated accordingly.

Decide before hitting the API in production. The Caddyfile in this repo follows the locked plan literally; the fix should land as a small follow-up commit once the team confirms the preferred direction.

---

## Production stack — first deploy walkthrough

Phase 15C. Assumes you've completed Phase 15A (`provision.sh`) and 15B (Caddyfile in place, TLS reachable).

### 1. Get the repo onto the VPS

The `releases/` directory under `/opt/saziqo-platform/` is owned by `deploy`. Each release is a checkout pinned by a git SHA; `current/` is a symlink to the active one (the symlink convention lands fully in 15G).

For the very first manual deploy:

```bash
ssh deploy@app.saziqo.ir
cd /opt/saziqo-platform/releases
git clone https://github.com/<your-org>/saziqo-platform.git "$(date -u +%Y%m%dT%H%M%S)"
ln -snf "$(date -u +%Y%m%dT%H%M%S)" /opt/saziqo-platform/current
```

(15G's `deploy.sh` will replace this with `rsync` + atomic symlink swap.)

### 2. Stage the production env file

```bash
cd /opt/saziqo-platform/current
cp infra/.env.production.template /opt/saziqo-platform/current/.env.production
chmod 600 /opt/saziqo-platform/current/.env.production
```

Open the file and replace **every** `CHANGE_ME` placeholder. For each secret:

```bash
openssl rand -hex 32        # use for JWT_SECRET, JWT_REFRESH_SECRET, OTP_SALT, MEILI_MASTER_KEY
openssl rand -base64 24     # use for POSTGRES_PASSWORD, REDIS_PASSWORD
```

`REDIS_URL` and `DATABASE_URL` must contain the same passwords you set in `REDIS_PASSWORD` / `POSTGRES_PASSWORD` — keep them in sync.

`SUPER_ADMIN_PHONE` must match `^\+989\d{9}$` (Iranian E.164). Boot will refuse to start otherwise.

### 3. Build and start the stack

```bash
cd /opt/saziqo-platform/current
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production build
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d
```

Or once you've sourced `.env.production` into your shell:

```bash
make prod-build
```

The stack:

- **api** → bound to `127.0.0.1:3001`, healthchecked via `/api/v1/health`
- **web** → bound to `127.0.0.1:3000`, healthchecked via `/`
- **postgres** → no host port; reachable on the `internal` bridge as `postgres:5432`
- **redis** → no host port; reachable as `redis:6379`, `--requirepass` enforced
- **meilisearch** → no host port; reachable as `meilisearch:7700`

Caddy (running on the host, configured in 15B) reverse-proxies the public 80/443 to the localhost-bound api/web. Postgres/Redis/Meili are reachable only from inside the docker network — that's the security boundary.

### 4. Run migrations

The first boot of the api container does NOT auto-migrate (the entrypoint is `node dist/main.js`). Run migrations explicitly:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production \
  exec api npx prisma migrate deploy
```

After this, `BootstrapService` seeds the super-admin role and user on the next API restart (or it already ran during the initial boot if the schema was fresh enough).

### 5. Verify

```bash
make prod-logs                  # tails caddy + api + web logs

# from anywhere on the public internet:
curl -sS https://app.saziqo.ir/api/v1/health      # → {"data":{"status":"ok"}}
curl -sSI https://app.saziqo.ir/ | head -n 1      # → HTTP/2 200

# inside the api container:
make prod-shell-api
node -e "console.log(process.versions.node)"

# inside the postgres container:
make prod-db-shell
\dt                              # tables present
\du                              # roles present
```

### 6. Updates

For subsequent releases, until 15G's `deploy.sh` lands:

```bash
cd /opt/saziqo-platform/current
git pull
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production build api web
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d api web
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production \
  exec api npx prisma migrate deploy
```

Caddy, postgres, redis, meilisearch should not need restarts during a normal app update.

### Troubleshooting

| Symptom                                       | Cause / Fix                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| api healthcheck failing                       | `docker compose logs api` — most often the env file has a missing required var or wrong DATABASE_URL.     |
| `MEILI_URL` missing error at boot             | The `meilisearch` service didn't come up; check `docker compose ps` and its logs.                         |
| `POSTGRES_PASSWORD` mismatch error            | The DB volume already has data from a different password. Either restore the password or wipe the volume. |
| `502 Bad Gateway` from Caddy                  | api or web container is down; Caddy is up but the upstream is unreachable.                                |
| Web bundle still hits old API URL after build | `NEXT_PUBLIC_API_BASE_URL` is inlined at build time; rebuild the `web` image after changing it.           |
| Prisma `P3018` migration applied error        | A previous migration partially applied. Resolve with `prisma migrate resolve --applied <name>`.           |

---

## Deploying releases — `deploy.sh`

Phase 15G. Run from your **local workstation** — not on the VPS. The script builds Docker images locally, ships them to the VPS, swaps the `current` symlink atomically, and rolls back automatically if the health check fails.

### Pre-deploy checklist

Before running `deploy.sh`, confirm:

- [ ] You are on the `main` branch with a clean working tree (`git status` shows nothing)
- [ ] `pnpm install --frozen-lockfile` succeeds (no lock-file drift)
- [ ] `/opt/saziqo-platform/current/.env.production` is in place on the VPS with no remaining `CHANGE_ME` placeholders
- [ ] `rclone config` has been run on the VPS as the deploy user (needed by the backup cron, not deploy itself, but good to confirm once)
- [ ] SSH key auth works: `ssh deploy@app.saziqo.ir whoami` returns `deploy` without a password prompt
- [ ] Docker daemon is running locally and `docker images` succeeds
- [ ] `rsync` is available locally (`rsync --version`)

### How to deploy

```bash
# From the repo root, default target is app.saziqo.ir
./infra/scripts/deploy.sh

# Or via Make
make deploy

# Override target host
DEPLOY_HOST=staging.saziqo.ir ./infra/scripts/deploy.sh

# Bypass a failing audit (use with caution)
FORCE_DEPLOY=1 ./infra/scripts/deploy.sh
```

The script runs through these steps automatically:

| Step | What happens                                                            |
| ---- | ----------------------------------------------------------------------- | --------------------------------------- |
| 1    | Verify `main` branch, clean tree                                        |
| 2    | `pnpm install --frozen-lockfile`                                        |
| 3    | `pnpm typecheck && pnpm lint && pnpm test`                              |
| 4    | `pnpm audit --audit-level=high`                                         |
| 5    | `docker compose build api web` (local)                                  |
| 6    | `docker save …                                                          | gzip`→`/tmp/saziqo-release-<ts>.tar.gz` |
| 7    | `rsync` repo + tarball to `releases/<ts>/` on VPS                       |
| 8    | Remote: `docker load`, Prisma migrations, symlink swap, `compose up -d` |
| 9    | Health loop (30 × 2 s). On failure: auto-rollback to previous release   |
| 10   | Prune releases — keeps the 5 most recent                                |

On success, the script prints the release timestamp and exits 0. On health-check failure, it rolls back, prints the error, and exits 1.

### Release layout on the VPS

```
/opt/saziqo-platform/
  current/              → releases/20260504-142301/   (symlink)
  releases/
    20260504-142301/    ← active (most recent)
    20260503-091512/
    20260502-180045/
    20260501-070022/
    20260430-150010/    ← oldest kept (5th)
```

Releases older than the 5th are deleted by the prune step.

### Manual rollback

Use this when the auto-rollback didn't trigger (e.g. you decided to roll back _after_ the health check passed, because you found a regression later):

```bash
ssh deploy@app.saziqo.ir

# 1. See available releases (most recent first)
ls -lt /opt/saziqo-platform/releases/

# 2. Pick the target and swap the symlink
PREV=/opt/saziqo-platform/releases/<previous-timestamp>
ln -sfn "${PREV}" /opt/saziqo-platform/current

# 3. Force-recreate the containers from the rolled-back release
cd "${PREV}"
docker compose -f infra/docker/docker-compose.prod.yml \
  --env-file .env.production up -d --force-recreate

# 4. Verify
curl -sS http://localhost:3001/api/v1/health
```

### Viewing logs after a deploy

```bash
# Live tail of all containers + Caddy access log
make prod-logs

# api only
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production logs -f api

# Caddy system journal
journalctl -u caddy -f

# Backup log
tail -F /var/log/saziqo-backup.log
```

### Emergency hotfix procedure

For a critical production fix that must ship faster than the normal deploy can run (audit blocked, test flaking, etc.). Use sparingly — every shortcut here is a safety net you removed.

1. **Confirm the fix is correct** — write the patch on a branch, run the affected unit tests locally, manually exercise the broken path against a local stack.
2. **Open the smallest possible PR** — single-purpose, no incidental refactors. Get a second pair of eyes if anyone is around. The PR exists for the audit trail even if you merge yourself.
3. **Merge to main**:
   ```bash
   git checkout main
   git pull --ff-only
   git merge --no-ff hotfix/<short-name>
   git push
   ```
4. **Skip-flag the deploy** only for the gates that would otherwise block:

   ```bash
   # Failing audit (already known, triaged elsewhere)
   FORCE_DEPLOY=1 ./infra/scripts/deploy.sh

   # Trivy/pnpm-audit blocked (rare — only if vuln is unrelated to the fix)
   SKIP_SECURITY_SCAN=1 ./infra/scripts/deploy.sh

   # Both
   FORCE_DEPLOY=1 SKIP_SECURITY_SCAN=1 ./infra/scripts/deploy.sh
   ```

   Document the reason in the team channel before kicking it off.

5. **Watch the deploy live** — don't walk away:
   ```bash
   ssh deploy@app.saziqo.ir 'tail -F /var/log/saziqo-api/api.log'
   ```
   The script auto-rolls-back on health failure, but a hotfix that subtly worsens behaviour without breaking `/health` will only be caught by you.
6. **Smoke test the fix in production**:
   ```bash
   curl -sS https://app.saziqo.ir/api/v1/health
   # then exercise the actual broken path manually
   ```
7. **File the post-incident debt** — every skipped check creates a follow-up: re-run the failing audit, restore the test that was flaking, etc. Track these in your issue tracker before closing the incident.

If the hotfix itself goes bad, **rollback**:

```bash
ssh deploy@app.saziqo.ir
ln -sfn /opt/saziqo-platform/releases/<previous-ts> /opt/saziqo-platform/current
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production up -d --force-recreate
curl -sS http://localhost:3001/api/v1/health
```

If the rollback target itself was the bug, restore from backup — see `docs/operations.md` § Disaster Recovery.

---

### Troubleshooting deploy failures

| Symptom                                  | Fix                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Not on main branch`                     | `git checkout main`                                                                      |
| `Unstaged changes`                       | `git stash` or commit before deploying                                                   |
| `pnpm audit` blocks                      | Fix the vulnerability or `FORCE_DEPLOY=1` (document why in Slack)                        |
| `docker save saziqo-api` — no such image | Images weren't tagged; check `infra/docker/docker-compose.prod.yml` service names        |
| `rsync` permission denied                | SSH key not in deploy's `authorized_keys`; re-run `provision.sh` or add key manually     |
| `.env.production not found` on remote    | Stage the env file at `/opt/saziqo-platform/current/.env.production` before first deploy |
| Health check fails, rollback triggered   | `make prod-logs` to diagnose; check api container logs for startup errors                |
| Rollback target not found                | First deploy ever had no previous release; restore manually from backup or re-deploy     |
