# Security — saziqo Platform

Operational security baseline and incident-response runbook for the production VPS. This file is owned long-term by Phase 24E; the hardening section here documents what `infra/scripts/harden.sh` (Phase 15D) does and how to verify it.

---

## What is hardened, and why

### SSH (`/etc/ssh/sshd_config`)

| Directive                      | Value    | Why                                                                                |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------- |
| `PasswordAuthentication`       | `no`     | Eliminates the entire credential-stuffing attack surface against the prod box.     |
| `PermitRootLogin`              | `no`     | Forces every administrator action to come through `deploy` first; preserves audit. |
| `AllowUsers`                   | `deploy` | Only the deploy user may even attempt SSH; everything else is rejected pre-auth.   |
| `MaxAuthTries`                 | `3`      | Three failed attempts close the connection — works hand-in-hand with fail2ban.     |
| `LoginGraceTime`               | `30`     | Half-minute to authenticate; defeats slowloris-style auth-stalling attacks.        |
| `ClientAliveInterval`          | `300`    | Keepalive every 5 min; idle holders get cut off in 10 min total.                   |
| `ClientAliveCountMax`          | `2`      | Two missed keepalives → disconnect.                                                |
| `KbdInteractiveAuthentication` | `no`     | Belt-and-suspenders against PAM-based interactive auth bypasses.                   |
| `UsePAM`                       | `yes`    | Required so login session limits and pam_motd still apply for the deploy user.     |

A backup of the original config lives at `/etc/ssh/sshd_config.bak`. Re-running `harden.sh` does NOT overwrite that backup — the original baseline is preserved across hardening runs.

### fail2ban (`/etc/fail2ban/jail.d/sshd.local`)

- SSH jail enabled
- `maxretry = 3` failed auths within `findtime = 10m` → ban
- `bantime = 1h` — short enough that a legitimate operator who locked themselves out can wait it out, long enough that bot scanners give up on this box

### unattended-upgrades

- Installed and enabled
- **Security pocket only** — no automatic feature/release upgrades that could break the prod stack
- Reboots automatically at **02:30 server time** _only_ if the kernel was upgraded
- Email reports OFF by default (no MTA on the box); uncomment `Unattended-Upgrade::Mail` in `/etc/apt/apt.conf.d/50unattended-upgrades` once an MTA is configured

### Log rotation (`/etc/logrotate.d/saziqo-{api,caddy}`)

- `/var/log/saziqo-api/*.log` — daily rotation, 14 days retention, gzip
- `/var/log/caddy/*.log` — daily safety net (Caddy's own `roll_size 100mb` is the primary mechanism)
- Rotated files owned by their respective service users (`deploy`, `caddy`)

### What's intentionally NOT changed

- The kernel module list — disabling rare modules is a long tail of false-positive reboots vs. negligible attack-surface reduction.
- IPv6 — left enabled. If your VPS provider gives you IPv6, you almost always want it routed.
- Firewall (`ufw`) — `provision.sh` already locked it down to 22/80/443; `harden.sh` does not re-touch it.
- Filesystem mounts (`noexec /tmp` etc.) — useful but breaks Docker's behavior in subtle ways. Skipped for v1.

---

## Post-hardening verification

Run these from outside the box (your laptop / a second host) wherever possible.

### 1. Port scan

```bash
nmap -Pn -p- app.saziqo.ir
# Expected: 22/tcp open ssh, 80/tcp open http, 443/tcp open https
# Anything else open = misconfiguration
```

### 2. SSH password auth is rejected

```bash
ssh -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    deploy@app.saziqo.ir
# Expected: "Permission denied (publickey)." after one prompt or none.
```

### 3. Root SSH is rejected

```bash
ssh root@app.saziqo.ir
# Expected: connection closes; sshd refuses pre-auth.
```

### 4. fail2ban is active

```bash
ssh deploy@app.saziqo.ir 'sudo fail2ban-client status'
ssh deploy@app.saziqo.ir 'sudo fail2ban-client status sshd'
# Expected: 'Jail list: sshd' and a non-empty currently-banned counter
# (or 0 if no attacks yet — that's still healthy).
```

### 5. unattended-upgrades is active

```bash
ssh deploy@app.saziqo.ir 'systemctl is-active unattended-upgrades'
# Expected: active

ssh deploy@app.saziqo.ir 'sudo unattended-upgrades --dry-run --debug 2>&1 | head -40'
# Expected: lists the security packages it would apply; no error.
```

### 6. Logrotate config is valid

```bash
ssh deploy@app.saziqo.ir 'sudo logrotate -d /etc/logrotate.d/saziqo-api'
ssh deploy@app.saziqo.ir 'sudo logrotate -d /etc/logrotate.d/saziqo-caddy'
# Expected: dry-run output, no parse errors.
```

### 7. TLS + headers grades

- <https://www.ssllabs.com/ssltest/analyze.html?d=app.saziqo.ir> — expect **A** or **A+**
- <https://securityheaders.com/?q=app.saziqo.ir> — expect **A**
- <https://hstspreload.org/?domain=app.saziqo.ir> — eligible once HSTS has been live a few weeks

---

## Incident response

### Manual ban / unban

```bash
sudo fail2ban-client set sshd banip <IP>
sudo fail2ban-client set sshd unbanip <IP>
sudo fail2ban-client status sshd          # see currently-banned list
```

### Read fail2ban activity

```bash
sudo journalctl -u fail2ban --since "1 hour ago"
sudo tail -F /var/log/fail2ban.log
```

### Read SSH auth attempts

```bash
sudo journalctl _SYSTEMD_UNIT=ssh.service --since "1 day ago"
# Or, if /var/log/auth.log is preserved:
sudo grep -E 'sshd.*(Invalid|Failed|Accepted)' /var/log/auth.log | tail -50
```

### Rollback the SSH hardening (emergency)

If for any reason you need to reopen password auth or root login:

```bash
sudo cp /etc/ssh/sshd_config.bak /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl reload ssh
```

This reverts to the snapshot taken on the very first run of `harden.sh`. Do not edit the backup file — it's your last-resort restore.

### Emergency SSH access via the VPS provider's console

Every reputable Iranian VPS provider exposes a web-based serial console (Arvan / Pars-Pack both call it "VNC Console"). If you're locked out via SSH, log in there, edit `/etc/ssh/sshd_config` directly, and `systemctl reload ssh`. Keep the provider's console URL bookmarked.

### Log file locations on the VPS

| File                                                     | What's in it                                |
| -------------------------------------------------------- | ------------------------------------------- |
| `/var/log/saziqo-provision.log`                          | Phase 15A provisioning run output           |
| `/var/log/saziqo-harden.log`                             | Phase 15D hardening run output              |
| `/var/log/saziqo-caddy-deploy.log`                       | Each Caddyfile reload                       |
| `/var/log/saziqo-api/api.log`                            | NestJS pino output (mounted from container) |
| `/var/log/caddy/access.log`                              | All HTTP requests, JSON-formatted           |
| `journalctl -u ssh / -u fail2ban / -u caddy / -u docker` | systemd unit logs                           |

---

## Vulnerability management

### Tooling

| Tool         | What it scans                    | Run via          |
| ------------ | -------------------------------- | ---------------- |
| `pnpm audit` | npm/pnpm dependency tree (CVEs)  | `pnpm scan:deps` |
| Trivy        | Docker image OS and library CVEs | `pnpm scan:deps` |

`pnpm scan:deps` runs both tools in sequence and saves the full report to `scan-report.txt` (git-ignored). `trivy` is installed on the VPS by `provision.sh`; running locally requires a local Trivy installation — missing Trivy skips image scans with a warning.

### When to run

- **Before every deploy** — `deploy.sh` calls `pnpm scan:deps` automatically (between the `pnpm audit` and `docker build` steps). Set `SKIP_SECURITY_SCAN=1` to bypass in exceptional cases.
- **Monthly** — run `pnpm update` to pull in patched versions, then re-run `pnpm scan:deps` to confirm the fixes landed.

### Triage policy

| Severity        | Action                                                       |
| --------------- | ------------------------------------------------------------ |
| Critical / High | Block the deploy. Fix or pin a safe version before shipping. |
| Moderate        | Open a GitHub issue; resolve within 2 weeks.                 |
| Low             | Log it; no action required.                                  |

### Updating dependencies

```bash
# Check what's outdated
pnpm outdated

# Update within declared semver ranges
pnpm update

# Update to latest majors (review changelogs first)
pnpm update --latest

# Re-run the scan after updating
pnpm scan:deps
```

---

## Threat model

A practical, MVP-scoped inventory of who might attack us, what they're after, and what stands in the way. Not a formal STRIDE document — meant to be read and remembered.

### Assets worth protecting

| Asset                                                                 | Sensitivity        | If compromised                                                  |
| --------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| User personal data (phone, name, national ID, email)                  | High — Iranian PII | Identity theft; legal exposure under emerging Iranian data laws |
| Session tokens (refresh tokens in particular)                         | High               | Account takeover until rotation revokes                         |
| Wallet balances + ledger entries                                      | High — financial   | Direct theft or fabrication of funds                            |
| Payment provider credentials (ZarinPal merchant ID + callback secret) | Critical           | Fraudulent transactions billed to us                            |
| SMS provider credentials (Kavenegar API key)                          | High               | OTP interception or spam at our cost                            |
| Database password + Redis password                                    | Critical           | Full data compromise                                            |
| JWT signing secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`)              | Critical           | Token forgery — bypass all auth                                 |
| OTP salt (`OTP_SALT`)                                                 | High               | Pre-compute OTP hashes from a leaked DB                         |
| Backup tarballs (object storage)                                      | High               | Same as DB compromise                                           |
| SSH key for `deploy@app.saziqo.ir`                                    | Critical           | Full server takeover                                            |

### Threat actors

- **Opportunistic scanners** — botnets sweeping for SSH credentials, exposed databases, common CMS bugs. By far the most frequent.
- **Targeted attackers** — anyone with a grudge against the platform, a competitor, or an interested state actor (Iran's regulatory environment makes this real).
- **Malicious insiders / compromised contributors** — anyone with `deploy` SSH access or merge access to `main`.
- **Compromised user accounts** — phished phone owners, SIM-swap victims. The OTP design limits blast radius but cannot prevent it.

### Mitigations and where they live

| Mitigation                                    | Defends against                          | Where                                            |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| Phone-only auth, no passwords                 | Credential stuffing, password DB leaks   | Schema design — no password column exists        |
| OTP rate-limit (60s lock + 5/24h DB cap)      | Brute-force OTP guessing                 | `apps/api/src/core/otp/otp.service.ts`           |
| Constant-time OTP verify                      | Timing oracle                            | `crypto.timingSafeEqual` in OTP service          |
| Refresh token rotation + replay detection     | Token theft                              | `SessionsService.rotateRefreshToken`             |
| TOTP for `super_admin`                        | Phone hijack of a privileged account     | `core/auth` TOTP enrollment / verify             |
| Rate-limit middleware (per-IP + per-user)     | Generic API abuse                        | `RateLimitGuard` (Redis sliding window)          |
| Idempotency interceptor                       | Duplicate destructive writes             | `IdempotencyInterceptor` (Redis 24h dedup)       |
| `X-Admin-Confirm` header (S6)                 | Accidental destructive admin actions     | `AdminConfirmGuard` on dangerous endpoints       |
| Audit log (append-only)                       | Repudiation, post-hoc forensics          | `audit_log` table; `AuditInterceptor`            |
| Append-only ledger                            | Financial repudiation                    | `ledger_entries` schema (no UPDATE/DELETE)       |
| UFW + fail2ban                                | SSH brute force                          | `provision.sh` + `harden.sh`                     |
| SSH key-only, root disabled                   | SSH credential attacks                   | `harden.sh`                                      |
| Caddy security headers                        | XSS, clickjacking, MIME sniffing         | `infra/caddy/Caddyfile`                          |
| HTTPS-only + HSTS preload                     | Network eavesdropping, downgrade attacks | Caddy + Caddyfile                                |
| Dependency + image scanning                   | Supply chain CVEs                        | `pnpm scan:deps` (Phase 16E)                     |
| Postgres + Redis bound to internal Docker net | Direct DB exposure                       | `docker-compose.prod.yml` (no host port mapping) |
| `unattended-upgrades` security pocket         | Unpatched OS CVEs                        | `harden.sh`                                      |
| Daily encrypted backups offsite               | Ransomware, data loss                    | `backup.sh` + rclone                             |

### Known gaps (accepted risk in MVP)

- **No WAF** beyond Caddy's basic protections — relying on application-level input validation. SQL injection blocked at Prisma layer; XSS at React+CSP layer.
- **No formal SBOM** for the runtime images — Trivy scans cover the practical case.
- **No HSTS preload yet** — submit to <https://hstspreload.org> after a stable period.
- **No external uptime probe** — track in `docs/operations.md` § Monitoring; ship before public launch.
- **No formal pen-test** — recommended pre-public-launch.
- **TOTP backup codes not yet implemented** — super_admin lock-out requires database surgery to reset `users.totpSecret = NULL`.

---

## Secret rotation

All secrets live in `/opt/saziqo-platform/current/.env.production` (mode 0600, owned by `deploy`). Rotation procedure varies by what you're rotating; the table below indexes them.

| Secret                            | Routine cadence       | Emergency trigger                                      |
| --------------------------------- | --------------------- | ------------------------------------------------------ |
| `JWT_SECRET`                      | Annually              | Suspected token forgery; secret in any logged location |
| `JWT_REFRESH_SECRET`              | Annually              | Same as `JWT_SECRET`                                   |
| `OTP_SALT`                        | Annually              | Database leak suspected                                |
| `POSTGRES_PASSWORD`               | Annually              | Any unauthorized DB access suspected                   |
| `REDIS_PASSWORD`                  | Annually              | Same                                                   |
| `MEILI_MASTER_KEY`                | Annually              | Same                                                   |
| `KAVENEGAR_API_KEY`               | On contact change     | Provider rotates it; suspected leak                    |
| `ZARINPAL_MERCHANT_ID`            | Provider-driven       | Suspected fraudulent transactions                      |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Annually              | Suspected backup leak                                  |
| Deploy `authorized_keys`          | On contributor change | Departed contributor; lost laptop                      |

### General rotation procedure

For any env-file secret:

```bash
# 1. Generate the new value locally
openssl rand -hex 32                       # JWT_*, OTP_SALT, MEILI_MASTER_KEY
openssl rand -base64 24                    # POSTGRES_PASSWORD, REDIS_PASSWORD

# 2. Edit the prod env file in place
ssh deploy@app.saziqo.ir
sudo -u deploy vi /opt/saziqo-platform/current/.env.production
# update the variable; for DB/Redis passwords also update the URL form
# (DATABASE_URL, REDIS_URL must contain the SAME password — keep in sync)

# 3. Restart the affected container
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production restart api

# 4. Verify
curl -sS https://app.saziqo.ir/api/v1/health
```

### Rotation specifics

#### `JWT_SECRET` / `JWT_REFRESH_SECRET`

Rotating either invalidates **every active session immediately**. All users must re-authenticate. Plan for a small login spike. Procedure as above.

#### `OTP_SALT`

Rotating invalidates any in-flight OTPs. Users mid-login must request a new OTP. Negligible impact in practice (OTPs live 120s).

#### `POSTGRES_PASSWORD`

Postgres reads `POSTGRES_PASSWORD` only at first initialization. To rotate after the cluster exists:

```bash
make prod-db-shell
ALTER ROLE saziqo WITH PASSWORD 'NEW_PASSWORD';
\q

# Update .env.production with the same value, both POSTGRES_PASSWORD
# and DATABASE_URL (which embeds the password)
docker compose -f ... restart api
```

#### `REDIS_PASSWORD`

Redis reads `--requirepass` from the compose command line. To rotate:

```bash
# Edit .env.production, then:
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production up -d --force-recreate redis api
```

`--force-recreate redis` is needed because the password is baked into the container's command-line.

#### `KAVENEGAR_API_KEY`

Generated in the Kavenegar console. Rotation has no in-flight impact (each SMS dispatch is one-shot).

```bash
# Update .env.production, then restart api
docker compose -f ... restart api

# Smoke test by triggering a real OTP request from your own phone
```

#### `ZARINPAL_MERCHANT_ID`

Rotating a merchant ID requires coordination with ZarinPal — the new ID must be active in their system before the change. Do not rotate without provider sign-off.

#### Deploy SSH key

To remove a contributor's access:

```bash
ssh deploy@app.saziqo.ir
sudo -u deploy vi /home/deploy/.ssh/authorized_keys
# delete the line; save
```

To rotate the active deploy key (e.g. you got a new laptop):

```bash
# 1. Generate new keypair locally
ssh-keygen -t ed25519 -C "deploy@<your-host>" -f ~/.ssh/saziqo_deploy

# 2. Append the public key on the VPS (use the VPS provider's web console
#    if you've already locked yourself out)
ssh deploy@app.saziqo.ir 'cat >> /home/deploy/.ssh/authorized_keys' < ~/.ssh/saziqo_deploy.pub

# 3. Verify new key works in a new terminal (DO NOT close the existing one)
ssh -i ~/.ssh/saziqo_deploy deploy@app.saziqo.ir whoami

# 4. Remove the old key from authorized_keys
```

### Post-rotation verification

After rotating any secret:

1. `curl https://app.saziqo.ir/api/v1/health` → 200
2. Tail `/var/log/saziqo-api/api.log` for 60s — no auth errors, no DB connection errors
3. Run through one user-facing flow manually (login, dashboard load) to catch anything the health endpoint doesn't probe

### What goes in the audit trail

Secret rotations are not auto-audit-logged (the secret was used to create the audit-logger itself). Record every rotation manually:

- Date, secret name, who did it, why
- Where: a private team document — never in the public repo, never in Slack, never in an issue tracker

---

## Audit log review

The `audit_log` table is append-only and captures every privileged action. Reading it regularly is the only way it earns its keep.

### What's logged

A non-exhaustive list — the canonical catalog lives in `apps/api/src/core/audit/actions.catalog.ts` and each module's `registerAuditActions()`:

- **Auth:** `OTP_REQUESTED`, `OTP_VERIFIED`, `OTP_FAILED`, `SESSION_REPLAY_DETECTED`, `TOTP_ENROLLED`, `LOGOUT`
- **User mutation:** `USER_STATUS_CHANGED`, `USER_ROLE_ASSIGNED`, `USER_ROLE_REMOVED`, `USER_PROFILE_COMPLETED`
- **Impersonation:** `IMPERSONATION_STARTED`, `IMPERSONATION_STOPPED`
- **Files:** `FILE_UPLOADED`, `FILE_DOWNLOADED`, `FILE_DELETED`
- **Money:** `PAYMENT_INITIATED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `PAYMENT_REFUNDED`, `PAYOUT_APPROVED`, `PAYOUT_REJECTED`, `PAYOUT_MARKED_PAID`, `LEDGER_ADJUSTED`
- **Module-defined:** every business module contributes its own action codes via `registerAuditActions()`

Each row records: `actor_user_id`, `acting_as_user_id` (set during impersonation), `action`, `resource`, `success`, `payload` (JSON), `ip_address`, `user_agent`, `created_at`. Reading: see `docs/operations.md` § Common admin tasks → Review the audit log.

### Review cadence

| Interval      | What to review                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Daily**     | `IMPERSONATION_STARTED` events from the previous day. Each one should match a known operational reason. Unknown impersonation = treat as P1. |
| **Weekly**    | All `failed` rows (any action where `success = false`). Cluster-by-IP suggests scanning; cluster-by-actor suggests a confused operator.      |
| **Weekly**    | `PAYMENT_REFUNDED` and `LEDGER_ADJUSTED` — every entry should have a reason that matches a known support case.                               |
| **Monthly**   | `USER_ROLE_ASSIGNED` for `admin` and `super_admin`. The admin set should match your team roster.                                             |
| **Quarterly** | Spot-check 50 random rows. Every action you cannot recognize is a documentation gap to close in this file.                                   |

### Quick queries

```bash
make prod-db-shell
```

```sql
-- Yesterday's impersonation events
SELECT created_at, actor_user_id, acting_as_user_id, payload->>'reason' AS reason
  FROM audit_log
 WHERE action IN ('IMPERSONATION_STARTED','IMPERSONATION_STOPPED')
   AND created_at >= now() - interval '1 day'
 ORDER BY created_at DESC;

-- Last week's failed actions
SELECT created_at, action, actor_user_id, ip_address, payload
  FROM audit_log
 WHERE success = false
   AND created_at >= now() - interval '7 days'
 ORDER BY created_at DESC;

-- Current admin roster
SELECT u.id, u.phone, u.first_name || ' ' || u.last_name AS name, r.name AS role
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
 WHERE r.name IN ('admin','super_admin')
 ORDER BY r.name, u.id;
```

### Append-only enforcement

The `audit_log` table has no UPDATE or DELETE permissions granted to any application role. The only way to alter it is via direct superuser SQL, which leaves a Postgres-level WAL trace. The application also writes the row in a transaction-after-success pattern (post-handler interceptor), so a rolled-back transaction does not produce an audit row — failures are logged with `success = false` only after the handler returned an error.

---

## Compliance

سازیکو Platform has **no formal compliance certifications** in MVP. The closest applicable regimes:

| Regime                                               | Status                         | What we'd need                                                                                                  |
| ---------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Iranian National Cyberspace Law (`قانون فضای مجازی`) | Best-effort                    | Data residency on Iranian infrastructure (already met); audit log retention; user data export/delete on request |
| GDPR                                                 | N/A — no EU user base targeted | DPA, DSR procedures, EU representative; defer until EU expansion                                                |
| PCI-DSS                                              | N/A — we never touch card data | Card data flows directly between user and ZarinPal; we receive only opaque payment IDs                          |
| SOC 2                                                | N/A — no enterprise B2B sales  | Continuous monitoring, formal access reviews, vendor audits                                                     |

### What we already do that helps a future audit

- Encrypted backups offsite (RPO 24h)
- Append-only audit log of every privileged action
- Append-only ledger of every financial event
- Role-based access control with documented permission catalog
- Annual secret rotation policy (this document)
- Vulnerability scanning before every deploy (`pnpm scan:deps`)
- TLS-only public surface; security headers grade A
- SSH key-only access; no shared credentials
- Documented incident response procedure (this doc + `docs/operations.md`)

### What we'd need to add for any formal certification

- Quarterly access reviews (who has `deploy` SSH; who has `admin` / `super_admin`)
- Documented vendor security reviews (ZarinPal, Kavenegar, VPS provider, object storage provider)
- Formal change-management log (deploy.sh runs are partial coverage; need PR+approval enforcement)
- Penetration test by an external firm
- Disaster recovery drill log (we have the script — record each run with date + result)

---

## When to re-run `harden.sh`

- After any manual edit to `/etc/ssh/sshd_config` to put it back in known-good state.
- After major Ubuntu point releases (e.g. 24.04 → 24.04.1) which sometimes ship updated default sshd configs.
- Periodically — quarterly is reasonable. The script is idempotent; a no-op run is the expected state.
