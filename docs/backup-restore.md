# AFLDB — Backup and Restore

**A backup is not proven until it has been restored.** Both halves are automated and both are run.

## 1. Backup

```bash
cd ~/projects/afldb
bash tools/maintenance/backup.sh              # default retention: 7
bash tools/maintenance/backup.sh --keep 14
bash tools/maintenance/backup.sh --dir /mnt/other/location
```

| | |
|---|---|
| Format | `pg_dump --format=custom --compress=6 --no-owner` |
| Location | `~/backups/afldb/` (mode 700) |
| Naming | `afldb_dev-YYYYmmdd-HHMMSS.dump` (mode 600) |
| Role | `afldb_backup` — `pg_read_all_data`, no write access |
| Measured | **16 MB in 6 s**, 560 objects |

Custom format is used rather than plain SQL because it compresses, restores in parallel (`--jobs`), and supports selective restore. `--no-owner` keeps the dump restorable under a different role name.

The script verifies the archive's table of contents with `pg_restore --list` before reporting success, so a truncated dump fails immediately rather than at restore time. Old backups beyond the retention count are pruned.

## 2. Restore verification

```bash
bash tools/maintenance/restore-test.sh                 # newest backup
bash tools/maintenance/restore-test.sh <file.dump>     # a specific one
```

```text
afldb_dev
    │  pg_dump
    ▼
afldb_dev-*.dump
    │  pg_restore --clean --if-exists --jobs=4
    ▼
afldb_restore_test          ← never afldb_dev
    │
    ▼
9 parity checks against the source
```

Restoring into `afldb_restore_test` means a verification run can never damage development data. The database is created once by `tools/maintenance/01_setup_service.sh`, which has been run: the restore path is verified end to end, not merely written down.

`pg_restore` emits "must be owner of extension" for `pg_trgm` and `unaccent` because the restoring role does not own them. Both messages are harmless — the extensions already exist in the target and must stay — and are filtered by exact message. Errors are never suppressed wholesale: the parity checks are what decide whether the restore worked, and they exit non-zero on any difference.

### Parity checks

Each value is read from both the source and the restored copy and compared:

| Check | Guards against |
|---|---|
| `player_match_stats` rows | truncated fact table |
| `players`, `matches`, `clubs` rows | missing tables |
| Career games total | partial row restore |
| Career goals total | numeric corruption |
| Brownlow votes total | missing awards data |
| **Unrecorded disposals count** | NULLs silently becoming 0 |
| `stat_availability` rows | missing era metadata |

The NULL check matters: a restore that converted "not recorded" into `0` would pass a row count but destroy the correctness rule the whole database is built on.

The script exits non-zero if any check differs.

## 3. Scheduling

Not yet scheduled — backups are run manually during development. For production, a `systemd` timer is preferred over cron (better logging, no mail dependency):

```ini
# /etc/systemd/system/afldb-backup.service
[Unit]
Description=AFLDB database backup
After=postgresql.service

[Service]
Type=oneshot
User=arm
WorkingDirectory=/home/arm/projects/afldb
ExecStart=/bin/bash tools/maintenance/backup.sh --keep 14
```

```ini
# /etc/systemd/system/afldb-backup.timer
[Unit]
Description=Nightly AFLDB backup

[Timer]
OnCalendar=daily
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true` runs a missed backup after downtime. Enable with `systemctl enable --now afldb-backup.timer`.

**Restore verification should be scheduled too** — weekly is reasonable. An unverified backup schedule is a false sense of security.

## 4. Off-host copies

Backups currently live on the same host as the database, which protects against data corruption but **not** against host loss. Before production, copy to separate storage. This is listed in the production readiness gate and is not yet done.

## 5. What is not backed up

| Item | Why | Recovery |
|---|---|---|
| `afldb_test` | reproducible | re-run import against the test DSN |
| `.next/` build output | reproducible | `npm run build` |
| `node_modules/` | reproducible | `npm ci` |
| Legacy `afl.db` | belongs to Sports Data Lab | that project's own backups |
| `.env` | contains secrets | regenerate via `00_install_postgres.sh`, or copy manually to protected storage |

`.env` is the one item with no automated recovery path. Losing it means regenerating role passwords, which the install script does idempotently.

## 6. Full disaster recovery

```bash
# 1. Rebuild the database layer
sudo bash tools/maintenance/00_install_postgres.sh

# 2. Restore the newest backup into afldb_dev
pg_restore --dbname="$AFLDB_OWNER_DATABASE_URL" --clean --if-exists \
           --no-owner --no-privileges --jobs=4 ~/backups/afldb/<newest>.dump

# 3. Re-apply role privileges — NOT optional, see below
npm run db:privileges

# 4. Verify
./.venv/bin/python tools/validation/validate_migration.py

# 5. Rebuild and restart the application
npm ci && npm run build
sudo bash tools/maintenance/01_setup_service.sh
```

**Step 3 is the one that is easy to skip and expensive to skip.** The dump is
taken with `--no-privileges`, so a restore recreates every table with no ACLs
at all: `afldb_app` can read nothing and the site serves errors on every page.
`npm run db:migrate` will not fix it — every migration is already recorded in
`afldb_meta.schema_migrations`, so the runner correctly reports nothing to
apply and the grants stay missing.

Before migration 039 the failure was quieter and worse. A schema-wide default
privilege granted `afldb_app` SELECT on every table `afldb_owner` created, so
a restore silently handed the public role read access to `auth_users` (password
hashes, TOTP secrets), the session and beta-code tables and `site_media` —
undoing migrations 031 and 038 with nothing to notice, because the site came
back up looking perfectly healthy. That default is now inverted: the public
role reads exactly what `afldb_meta.app_readable_tables` lists, and that
registry is an ordinary table, so the dump carries it and step 3 rebuilds the
grant model from the backup itself.

Migration 045 gave `afldb_import` the same treatment, for the same reason: the
identical default privilege had been re-granting the ETL role full write plus
`TRUNCATE` on every operational table on each restore. Its scope is now
`afldb_meta.import_writable_tables`, a second ordinary table the dump carries,
and step 3 reconciles both registries at once.

If no backup is usable, the database can be rebuilt from the legacy source in roughly 2.5 minutes:

```bash
./.venv/bin/python tools/migration/import_legacy_afl.py    # ~119s
./.venv/bin/python tools/migration/rebuild_derived.py      # ~18s
./.venv/bin/python tools/validation/validate_migration.py  # 88 checks
```

This is the ultimate safety net: while the legacy `afl.db` exists and the migration is idempotent, AFLDB is fully reconstructible from source.
