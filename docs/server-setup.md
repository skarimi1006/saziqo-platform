# Server Setup — saziqo Platform

End-to-end runbook for taking a fresh Iranian VPS from "rented" to "ready to deploy". Pairs with `infra/scripts/provision.sh` (Phase 15A) and the hardening / TLS / compose phases that follow.

---

## 1. Prerequisites

### 1.1 Rent the VPS

| Spec     | Minimum                                       |
| -------- | --------------------------------------------- |
| Provider | Iranian provider — Arvan, Pars-Pack, Asiatech |
| OS       | Ubuntu 24.04 LTS                              |
| CPU      | 4 vCPU                                        |
| RAM      | 4 GB                                          |
| Disk     | 80 GB SSD                                     |
| Network  | Public IPv4, ports 22/80/443 reachable        |

The script will refuse to run on non-Ubuntu and warn (but continue) on releases other than 24.04 / 24.10 / 22.04.

### 1.2 DNS

Before running `provision.sh`, point your apex domain at the VPS so Caddy can later issue Let's Encrypt certs without a manual cutover:

```
A     app.saziqo.ir          → <VPS public IPv4>
AAAA  app.saziqo.ir          → <VPS public IPv6, if assigned>
```

DNS does not need to be propagated for `provision.sh` itself — only for the TLS step in Phase 15B.

### 1.3 SSH access

You should have:

- The provider's initial root password OR a root SSH key
- An SSH key on **your local machine** (the public half will be added to `deploy@` after provisioning)

If you don't have a key yet:

```bash
ssh-keygen -t ed25519 -C "saziqo-deploy"
```

---

## 2. Run the provisioning script

### 2.1 Copy the script to the VPS

From your local working copy of this repo:

```bash
scp infra/scripts/provision.sh root@<VPS_IP>:/root/provision.sh
```

### 2.2 Execute as root

```bash
ssh root@<VPS_IP>
chmod +x /root/provision.sh
bash /root/provision.sh
```

The script will:

1. Update the OS (`apt-get upgrade -y`, no-prompt config defaults)
2. Install base utilities — curl, rsync, unzip, ufw, fail2ban, git, make, jq, htop, ca-certificates, gnupg, lsb-release
3. Install Docker Engine + compose plugin from the official Docker apt repo
4. Install Caddy from the official Cloudsmith apt repo
5. Create the `deploy` user, add to the `docker` group, prepare `~/.ssh` (perms 700/600), but **leave `authorized_keys` empty**
6. Create `/opt/saziqo-platform/{releases,shared/{logs,uploads,postgres-data,redis-data}}` owned by `deploy`
7. Configure UFW: deny incoming, allow outgoing, open 22/80/443
8. Enable & start docker, caddy, fail2ban systemd units
9. Append every line of stdout + stderr to `/var/log/saziqo-provision.log`

The script is **idempotent**. Re-running on an already-provisioned host should produce no errors and no destructive changes (it will, however, run `apt-get upgrade -y` again).

Expect a 5–15 minute runtime depending on the VPS network speed and how many security updates have queued up.

### 2.3 Watch the log live (optional)

In a second SSH session:

```bash
tail -f /var/log/saziqo-provision.log
```

---

## 3. Post-script verification

The summary block printed at the end of the run lists the installed versions. Spot-check each one:

```bash
docker --version
docker compose version
caddy version
ufw status verbose
systemctl is-enabled docker caddy fail2ban
systemctl is-active  docker caddy fail2ban
id deploy
ls -la /home/deploy/.ssh
ls -la /opt/saziqo-platform
```

Expected results:

- All three services: `enabled` and `active`
- `deploy` is a member of `docker` (visible in `id deploy` output)
- `/home/deploy/.ssh` is `700`, `authorized_keys` is `600`
- `/opt/saziqo-platform` and all subdirs are owned by `deploy:deploy`
- UFW shows `Status: active` with rules for 22/80/443

---

## 4. Add your SSH key — DO THIS BEFORE LEAVING THE ROOT SESSION

```bash
# From your local machine
cat ~/.ssh/id_ed25519.pub | ssh root@<VPS_IP> \
  'cat >> /home/deploy/.ssh/authorized_keys'
```

Then, **from a new local terminal**, confirm the key works:

```bash
ssh deploy@<VPS_IP> 'whoami && id'
```

You should see `deploy` and the docker group in the output. Do **not** close the original root session until this succeeds — if the key didn't take, you still need a way back in.

---

## 5. Hand-off to the next phase

Once the verification above passes, the VPS is ready for:

- **Phase 15B** — drop a Caddyfile in place; Caddy will provision LE certs on first request once DNS resolves.
- **Phase 15C** — copy `docker-compose.prod.yml` and `.env.production` into `/opt/saziqo-platform/current/`.
- **Phase 15D** — run `harden.sh` to disable root SSH, password auth, and configure fail2ban jails + unattended-upgrades.
- **Phase 15G** — deploy the application via `deploy.sh`.

---

## 6. Testing on a disposable VPS first

Before running this against the production VPS, validate on a throwaway:

1. Spin up a 1-hour Ubuntu 24.04 box on any provider you can quickly destroy (Hetzner CX22, DigitalOcean basic droplet, or a local VM via multipass / lima).
2. Note the IP and SSH in as root.
3. Copy `provision.sh` over and run it exactly as documented above.
4. Verify the post-script checklist passes.
5. Run the script a second time — it must succeed with no errors and no unexpected diffs in `ufw status`, `systemctl is-enabled`, or `/etc/passwd`.
6. SSH in as `deploy` (after seeding `authorized_keys`) and run `docker run --rm hello-world` to confirm docker-group membership took effect (you may need to log out and back in, or run `newgrp docker`, the first time).
7. Destroy the box.

A local multipass alternative if you prefer:

```bash
multipass launch 24.04 --name saziqo-test --cpus 2 --memory 2G --disk 20G
multipass transfer infra/scripts/provision.sh saziqo-test:/home/ubuntu/
multipass exec saziqo-test -- sudo bash /home/ubuntu/provision.sh
multipass delete saziqo-test && multipass purge
```

---

## 7. Troubleshooting

| Symptom                                             | Cause / Fix                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `E: Could not get lock /var/lib/dpkg/lock-frontend` | Another apt process is running (e.g. unattended-upgrades). Wait, then re-run.              |
| `gpg: cannot open '/dev/tty'`                       | TTY is detached — confirm you're SSHed in normally, not through a hook or non-tty wrapper. |
| `Failed to start docker.service`                    | Check `journalctl -u docker --no-pager -n 80`. Often a kernel-module or cgroup mismatch.   |
| `caddy: command not found` after install            | Cloudsmith apt list was malformed — re-run; the script is idempotent.                      |
| Cannot SSH as `deploy` after seeding the key        | Verify `chmod 600 authorized_keys` and `chown deploy:deploy`. Check `/var/log/auth.log`.   |
| UFW blocks an inbound port you actually need        | `ufw allow <port>/tcp comment '<reason>'`. Avoid disabling UFW.                            |

---

## 8. Why these defaults

- **Idempotent script** — provisioning is run-once in theory, run-many in practice (dist upgrades, recovery, parallel staging hosts). Every step here is safe to repeat.
- **`deploy` user, no password** — every interactive login should be key-authed; root login will be locked down in 15D. Adding to the `docker` group is what lets `deploy` run the prod compose stack without sudo.
- **UFW allow-list of three ports** — SSH for ops, 80/443 for Caddy. Postgres and Redis are reachable only on the docker bridge network; never publish their ports.
- **Caddy + Docker enabled but unconfigured** — both daemons run with stock configs after this script. The Caddyfile and compose stack arrive in 15B / 15C; running them now would just produce a default Caddy welcome page on port 80, which is harmless.
- **Log file at `/var/log/saziqo-provision.log`** — chmod 0640, root-owned. Rotated by the system's existing `logrotate` defaults; no extra config needed.
