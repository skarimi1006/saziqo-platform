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

## Disaster Recovery

Phase 15F. The drill script `infra/scripts/restore-drill.sh` exercises the backup pipeline end-to-end on a throwaway container, _without_ touching production. The full-restore procedures below use the same artifacts but target the production stack and require downtime.

### Recovery objectives

| Metric | Target   | What it means                                                                                                               |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| RTO    | 2 hours  | From "we decided to restore" to "stack is serving traffic again." Manual procedure; no auto-failover.                       |
| RPO    | 24 hours | Worst-case data loss = time since the last 02:00 backup ran. Reduce by triggering an ad-hoc backup before risky operations. |

### Restore drill (non-destructive — run anytime)

Smoke-tests the backup pipeline against a temporary Postgres on host port 5433. Production is not touched. Run at least monthly.

```bash
ssh deploy@app.saziqo.ir
sudo -u deploy /opt/saziqo-platform/current/infra/scripts/restore-drill.sh
```

Or from a workstation with the same rclone remote configured:

```bash
make restore-drill
```

The script:

1. Resolves the **most recent** `.sql.gz` on `<remote>:<bucket>/postgres/` via `rclone lsl` sorted by mtime.
2. Downloads it to a temp dir.
3. `docker run`s `postgres:16-alpine` as `saziqo-restore-test`, host port 5433, db `saziqo_restore`.
4. Polls `pg_isready` for up to 60s.
5. Pre-creates the `saziqo` role inside the test DB so the dump's GRANTs don't error.
6. `gunzip | docker exec -i ... psql -v ON_ERROR_STOP=1`.
7. Runs sanity queries: `SELECT COUNT(*) FROM users`, `SELECT COUNT(*) FROM payments WHERE status='SUCCEEDED'`, and the schemata list. Fails the drill if any return non-numeric or `public` is missing.
8. Tears down the container and temp dir on every exit path (success, error, or Ctrl-C).

A successful run ends with `Drill SUCCESS — backup pipeline is verified`. Treat any failure as a P1 — your backups aren't actually backups until this passes.

### Full DB restore (PRODUCTION — destructive)

When you need to roll the live database back to a backup, e.g. after data corruption that postdates the most recent good snapshot.

**Pre-flight:**

1. Decide which dump to restore. Use the local `/opt/saziqo-platform/backups/postgres/` first if recent enough (faster than re-downloading); otherwise pull from object storage.
2. Announce the maintenance window — set `MAINTENANCE_MODE=true` in `.env.production` and bounce the api container so the user-facing 503 banner appears (wired up in a future phase; until then, `docker compose stop web api`).
3. Take an immediate **pre-restore** backup of the current (corrupt or otherwise) state — you may need it for forensic analysis:

   ```bash
   sudo -u deploy /opt/saziqo-platform/current/infra/scripts/backup.sh
   ```

**Restore:**

```bash
cd /opt/saziqo-platform/current

# 1. Stop dependents so nothing writes during the restore.
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production stop api web

# 2. Drop and recreate the live database. THIS IS DESTRUCTIVE.
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production \
  exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};" \
  -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

# 3. Pipe the chosen dump into the live container's psql.
gunzip -c /opt/saziqo-platform/backups/postgres/saziqo-YYYY-MM-DD.sql.gz \
  | docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production \
      exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1

# 4. Bring the app back up.
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production up -d api web

# 5. Smoke test — health, login, a known-good page.
curl -sS https://app.saziqo.ir/api/v1/health
```

If step 3 fails partway, the database is in an inconsistent state — repeat steps 2 and 3 with a different dump (or the pre-restore one) before un-pausing.

### File restore from tarball

Uploads (user-submitted files, NID images, etc.) live in `/opt/saziqo-platform/shared/uploads`. The daily tarball captures it whole.

```bash
# Pull the dated tarball from remote (or use the local copy under backups/files/)
rclone copy "${RCLONE_REMOTE_NAME}:${S3_BUCKET}/files/files-YYYY-MM-DD.tar.gz" /tmp/

# Stop the api so nothing writes during the swap.
cd /opt/saziqo-platform/current
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production stop api

# Move the current dir aside (don't delete — keep until smoke test passes).
mv /opt/saziqo-platform/shared/uploads /opt/saziqo-platform/shared/uploads.broken.$(date +%s)
mkdir -p /opt/saziqo-platform/shared/uploads
chown deploy:deploy /opt/saziqo-platform/shared/uploads

# Extract.
tar -xzf /tmp/files-YYYY-MM-DD.tar.gz -C /opt/saziqo-platform/shared/uploads/

# Restart api.
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production start api
```

Verify by browsing a page that references a known file. After 24h with no complaints, delete the `.broken.<ts>/` directory.

### Release rollback (no data restore needed)

When the new deployment is bad but the data is fine — landed a regression, broken UI, etc. The atomic-symlink convention from Phase 15G makes this two commands:

```bash
ls -la /opt/saziqo-platform/current             # current → releases/<timestamp>
ls -lt /opt/saziqo-platform/releases | head     # find the previous good one
ln -snf /opt/saziqo-platform/releases/<previous-timestamp> /opt/saziqo-platform/current
docker compose -f /opt/saziqo-platform/current/infra/docker/docker-compose.prod.yml \
  --env-file /opt/saziqo-platform/current/.env.production up -d --build api web
```

(Until Phase 15G's `deploy.sh` lands and codifies the symlink convention, "previous release" means a fresh `git checkout <prior-sha>` + rebuild.)

### Practice schedule

- **Monthly:** Run `restore-drill.sh`. Log the result in your team's ops channel.
- **Quarterly:** Walk through the full DB restore on a staging VPS using the most recent production dump.
- **Before major launches:** Trigger an ad-hoc backup so the RPO clock resets to zero immediately before risk.

---

## (Sections to follow in later phases)

- **15G** manual deploy script
- Monitoring / alerting (Phase Group 23)
- On-call runbook (Phase 24F)
