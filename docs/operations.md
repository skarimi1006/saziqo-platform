# Operations — saziqo Platform

Day-2 operational runbook: backups, restore drills, monitoring, on-call. This file is owned long-term by Phase 24F; the backup section here documents Phase 15E.

---

## Backups

Daily snapshot: Postgres dump + uploads tarball, both pushed to S3-compatible object storage. Implemented in `infra/scripts/backup.sh`.

### What gets backed up

| Source                                           | Output (local)                                                   | Where it ends up remotely     |
| ------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------- |
| `pg_dump` of the `saziqo` database               | `/opt/saziqo-platform/backups/postgres/saziqo-YYYY-MM-DD.sql.gz` | `<remote>:<bucket>/postgres/` |
| Tarball of `/opt/saziqo-platform/shared/uploads` | `/opt/saziqo-platform/backups/files/files-YYYY-MM-DD.tar.gz`     | `<remote>:<bucket>/files/`    |

Retention:

- **Local:** 14 days (then `find -mtime +14 -delete`)
- **Remote:** 30 days (`rclone delete --min-age 30d`)

### Schedule

Cron job installed by `harden.sh` (Phase 15D):

```
0 2 * * * deploy /opt/saziqo-platform/current/infra/scripts/backup.sh
```

Lives at `/etc/cron.d/saziqo-backup` — root:root, mode 0644 (cron silently ignores looser perms). Override the schedule by editing that file directly.

A manual run is always safe — `flock` guards against concurrent execution. If a cron-triggered run is already in progress when you trigger one by hand, the manual run exits immediately with a "another instance is already running" log line.

### One-time setup: `rclone config`

The backup script reads its remote name from `RCLONE_REMOTE_NAME` in `.env.production`, but the actual S3 credentials live in rclone's own config so they never appear in environment variables or process listings. Set this up once as the deploy user:

```bash
ssh deploy@app.saziqo.ir
rclone config
```

Walk through the interactive wizard:

```
n) New remote
name> arvan                                  # must match RCLONE_REMOTE_NAME
Storage> 4                                    # "Amazon S3 Compliant Storage Providers"
provider> Other                               # for Arvan / Pars-Pack / etc.
env_auth> false                               # we'll enter keys here
access_key_id> <S3_ACCESS_KEY>
secret_access_key> <S3_SECRET_KEY>
region>                                       # blank, or your provider's region
endpoint> https://s3.ir-thr-at1.arvanstorage.ir
location_constraint>                          # blank
acl> private
y) Yes, this is OK
q) Quit config
```

The config lands at `~/.config/rclone/rclone.conf` (mode 0600, owned by deploy).

### Verifying the remote

```bash
# List the remote's buckets (proves auth works)
rclone lsd arvan:

# List what's already in the backup bucket
rclone ls arvan:saziqo-backups/

# Push a test file
echo hello > /tmp/rclone-smoke
rclone copy /tmp/rclone-smoke arvan:saziqo-backups/
rclone delete arvan:saziqo-backups/rclone-smoke
```

### First manual backup run

```bash
ssh deploy@app.saziqo.ir
sudo -u deploy /opt/saziqo-platform/current/infra/scripts/backup.sh
tail -F /var/log/saziqo-backup.log    # in another window
```

Expected output:

- pg_dump line with the byte size
- tar line with the byte size
- Two `rclone copy` lines (postgres + files)
- "Pruning local backups..." (no-op on day 1)
- "Pruning remote backups..." (no-op on day 1)
- "Backup run complete"

Then verify the artifacts:

```bash
ls -la /opt/saziqo-platform/backups/postgres/
ls -la /opt/saziqo-platform/backups/files/
rclone ls arvan:saziqo-backups/
```

### Reading the dump

The Postgres dump is plain SQL inside gzip. To peek without restoring:

```bash
zcat /opt/saziqo-platform/backups/postgres/saziqo-YYYY-MM-DD.sql.gz | head -200
zgrep -c '^CREATE TABLE' /opt/saziqo-platform/backups/postgres/saziqo-YYYY-MM-DD.sql.gz
```

The full restore drill ships in Phase 15F.

### Troubleshooting

| Symptom                                                          | Cause / Fix                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "Postgres container 'saziqo-platform-postgres-1' is not running" | Either compose isn't up, or you used a different project name. `PG_CONTAINER=<name> backup.sh`.         |
| "RCLONE_REMOTE_NAME unset"                                       | `.env.production` not staged, or var missing. Re-copy from `infra/.env.production.template`.            |
| `rclone copy` fails with `403 SignatureDoesNotMatch`             | Wrong access key or wrong endpoint. Re-run `rclone config` with the credentials your provider gave you. |
| `rclone copy` fails with `BucketNotFound`                        | Create the bucket in the provider's web console first; rclone won't auto-create.                        |
| Cron entry never fires                                           | Check `sudo grep CRON /var/log/syslog` — usually a perms issue on `/etc/cron.d/saziqo-backup`.          |
| Local pg_dump file is suspiciously small (<1KB)                  | `pg_dump` itself failed inside the container. Check `docker logs saziqo-platform-postgres-1`.           |

---

## (Sections to follow in later phases)

- **15F** restore drill script + verification procedure
- **15G** manual deploy script
- Monitoring / alerting (Phase Group 23)
- On-call runbook (Phase 24F)
