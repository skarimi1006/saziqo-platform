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

## When to re-run `harden.sh`

- After any manual edit to `/etc/ssh/sshd_config` to put it back in known-good state.
- After major Ubuntu point releases (e.g. 24.04 → 24.04.1) which sometimes ship updated default sshd configs.
- Periodically — quarterly is reasonable. The script is idempotent; a no-op run is the expected state.
