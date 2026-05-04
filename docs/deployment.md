# Deployment — saziqo Platform

Operational runbook for the production deployment. Sections are added as each phase in Group 15 lands. The full document is owned by Phase 24F.

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

## (Sections to follow in Phases 15D–15G)

- **15D** server hardening (UFW final rules, fail2ban jails, unattended-upgrades)
- **15E** backup script (pg_dump + file snapshot)
- **15F** restore drill
- **15G** manual deploy script (no CI/CD)
