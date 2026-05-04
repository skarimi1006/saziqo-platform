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

## (Other sections to follow in Phases 15C–15G)

- **15C** docker-compose.prod.yml + `.env.production` template
- **15D** server hardening (UFW final rules, fail2ban jails, unattended-upgrades)
- **15E** backup script (pg_dump + file snapshot)
- **15F** restore drill
- **15G** manual deploy script (no CI/CD)
