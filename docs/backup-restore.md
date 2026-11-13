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

**`backup.sh` prunes** every `<db>-*.dump` in its directory down to `--keep`, and it sources the checkout's `.env`, which
wins over the caller's environment. Never point it at a directory holding dumps you want to keep (on production,
`~/backups/afldb` holds per-operation dumps that release and promotion packets bind by hash); scheduled runs use the
dedicated directory in §3.

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

When every check passes, the script records the restored dump's sha256 (computed before the
restore) as `afldb_restore_test`'s database comment, `afldb.restore_test.v1 sha256=<hex>`, after
clearing any earlier one at the start of the run. `db:promotion:check --phase freeze-dump` reads it
back to prove a production promotion reinstates from exactly the frozen dump
(`AFLDB-ISSUE-250`, `docs/production-promotion.md` §4.1). The comment changes nothing else.

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

## 3. Scheduling (`AFLDB-ISSUE-352`)

Production has **no** scheduled backup today: the only dumps are per-operation ones in `~/backups/afldb`, taken by
release and promotion packets (newest 2026-11-12). Everything below is **prepared, not installed**; installing it is an
owner action (procedure below). DEV keeps manual backups.

`tools/maintenance/scheduled-backup.sh` wraps `backup.sh` and `restore-test.sh` (it edits neither: their text is pinned by
`tests/restore-test.test.sh` and the promotion-check suite) and adds what a schedule needs:

| Piece | What it does |
|---|---|
| `scheduled-backup.sh backup` | one `backup.sh` run into a **dedicated** directory, a `sha256sum -c` sidecar per dump, state under `<dir>/.state/`, an optional off-host copy, a `FAILED` marker on any failure |
| `scheduled-backup.sh verify` | a **fresh** dump, then `restore-test.sh` on exactly that dump (identity-guarded, exit-status decided, nine parity checks, sha256 recorded as the database comment). A failed parity check is retried once after 60 s: a live write between dump and comparison is the only benign cause |
| `scheduled-backup.sh status` | read-only monitor probe: exit 1 if the newest backup is older than 30 h, the newest verification older than 9 days, a run failed, or the last off-host copy failed |
| `deploy/afldb-backup.{service,timer}` | nightly at 02:20 (+ up to 10 min), `Persistent=true` |
| `deploy/afldb-backup-verify.{service,timer}` | Wednesday 03:30 (+ up to 10 min); not Sunday (`e2scrub_all` 03:10) |
| `deploy/afldb-backup-failed.service` | `OnFailure=` target: an error-priority journal line `AFLDB_BACKUP_FAILURE` and a marker (no outbound channel exists yet; point it at the ISSUE-332 notifier when that lands) |

Timing is chosen against the production timers read on 2026-11-14: the settle runs 05:00-05:15 (+ run time, ends by 05:30),
`apt-daily-upgrade` 06:00-07:00 (ISSUE-351), logrotate and `dpkg-db-backup` at 00:00. The nightly dump precedes the settle,
so the settle's writes (re-derivable from the AFL API source) are the only data newer than the newest dump.

**Why a dedicated directory.** `backup.sh` prunes every `<db>-*.dump` it finds in its directory down to `--keep`. The
per-operation dumps in `~/backups/afldb` (`afldb_prod-*.dump`, including the promotion pre-cutover dumps that ISSUE-250
binds by hash) match that pattern; the units therefore use `/home/arm/backups/afldb-scheduled` and the wrapper **refuses to
run without an explicit absolute `AFLDB_BACKUP_DIR`**.

**Credentials.** The units carry no `EnvironmentFile=`: `backup.sh` and `restore-test.sh` read the checkout's `.env`
themselves (`afldb_backup` for the dump, `afldb_owner` for `afldb_restore_test`). `afldb_restore_test` exists on production
(probed read-only 2026-11-14, about 0.4 GB, carrying an older `afldb.restore_test.v1` marker). Root-owned configuration
(sudoers, existing units, the real `.env` contents) was not readable and is not claimed here.

**Proposed RPO and RTO** (the figures from the rehearsal are in the evidence README):

- **RPO:** 24 h for the non-derivable data (auth, audit, `data_edits`, overrides, settings, curated rows) with the nightly
  dump and an off-host copy made in the same run; up to about 29 h in the worst case (a dump at 02:20, a loss just before
  the next). Settle writes are re-derivable. An extra dump after each settle would cut the window for the nightly writes; that is an
  owner choice (a second timer), not proposed by default.
- **RTO, database only (host intact):** target 1 hour from decision to a gated site. Measured on the isolated rehearsal host (DEV-class, a 407 MB database, 30 MB dump): fresh dump 9 s, `restore-test.sh` end to end 17 s, procedure A steps 3-5 (candidate restore 7 s, `db:privileges` 1 s, verification queries 1 s) about 10 s. The production droplet is smaller and the production dump is the same order of size (30.1 MB for 518 MB, 2026-11-12), so expect minutes for the restore itself; the hour is dominated by stopping writers, choosing and hash-checking the dump, the checks and the swap. Not measured on the production host. **Host loss:** unrehearsed; dominated by re-provisioning (§6, procedure B).

**Install (owner, root; nothing here is run by this repository):**

```bash
# 0. the serving checkout must hold these files and a restore-test.sh at or after ISSUE-342 (the checkout probed on
#    2026-11-14, c1c4b22e, still has the 2026-09-26 restore-test.sh and no wrapper): update it first, verify the hashes.
sudo -u arm install -d -m 700 /home/arm/backups/afldb-scheduled
cd /home/arm/projects/afldb
sudo install -m 0644 deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-verify.service \
  deploy/afldb-backup-verify.timer deploy/afldb-backup-failed.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup-verify.service
sudo systemctl daemon-reload
sudo systemctl start afldb-backup.service          # attended first run; journalctl -u afldb-backup
sudo systemctl start afldb-backup-verify.service   # attended; proves restore-test.sh end to end on this host
sudo -u arm env AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled bash tools/maintenance/scheduled-backup.sh status   # expect exit 0
sudo systemctl enable --now afldb-backup.timer afldb-backup-verify.timer
systemctl list-timers 'afldb-backup*'
# undo: sudo systemctl disable --now afldb-backup.timer afldb-backup-verify.timer; sudo rm /etc/systemd/system/afldb-backup*; sudo systemctl daemon-reload
```

Monitoring until an alert channel exists: run `scheduled-backup.sh status` from any existing check (exit 1 = act) and
look for `AFLDB_BACKUP_FAILURE` in `journalctl -u afldb-backup -u afldb-backup-verify`. **A failed run is not a retry loop:** the
next timer firing is the retry; a failed verification leaves the previous `last-verify.json` in place, so `status` turns red
after 9 days at the latest and immediately while `FAILED` exists.

## 4. Off-host copies

A copy on the database host does not survive loss of that host (the DigitalOcean droplet). The copy must live elsewhere and
must not be deletable by the host it protects.

| Option | Shape | Assessment |
|---|---|---|
| **A. Pull to streamanator (recommended)** | `tools/maintenance/offhost-pull.sh` runs **on the other host** (cron/user timer), `rsync`s only `*.dump` and `*.sha256`, never overwrites, verifies every new dump (sha256 sidecar + `pg_restore --list`), quarantines a failure, keeps the newest 30 | no credential on production can delete the copies; the second site proves on every pull that its copy is intact (hash and archive table of contents); needs an SSH key limited (forced command `rsync --server --sender` on the dedicated directory) on production, and the other host to be treated as holding production secrets (dumps contain auth data) |
| B. Object storage (for example DigitalOcean Spaces) | push from production with a write-only key; client-side encryption (`gpg` is installed; `rclone`/`age` are not) | independent failure domain, no home-network dependency; adds a vendor, a key on production, and an encryption key to look after |
| C. Mounted volume via `AFLDB_OFFHOST_DEST` | the wrapper copies, re-hashes, lists and prunes into a mounted directory (`AFLDB_OFFHOST_REQUIRE_MOUNT=1` refuses an unmounted path) | simplest; a block volume attached to the same droplet does **not** survive droplet loss unless it is detached and re-attachable elsewhere |

**Recommendation: A**, with C as a convenience copy. Retention: 14 local, 30 off-host (newest by name), plus the owner's
per-operation dumps kept as before. Copies are encrypted at rest by the destination's disk encryption or, for B, by
`gpg` before upload; this repository does not choose the key. Rehearsed on a local stand-in (copy, re-hash, prune,
quarantine of a corrupted dump, no-op second pull): see the evidence README. Not rehearsed: the SSH transport itself
(`rsync` over a forced-command key) and any object store.

## 5. What is not backed up

| Item | Why | Recovery |
|---|---|---|
| `afldb_test` | reproducible | re-run import against the test DSN |
| `.next/` build output, `releases/` | reproducible | `release.mjs build` / `adopt` (§3a of `deployment.md`) |
| `node_modules/` | reproducible | `npm ci` |
| Legacy `afl.db` | belongs to Sports Data Lab | that project's own backups |
| `.env` | contains secrets | no automated recovery path: keep a copy in protected storage. Losing it means regenerating role passwords (`00_install_postgres_prod.sh` does so idempotently) and the session secrets |
| Role definitions | `pg_dump` of one database does not carry roles | `00_install_postgres_prod.sh` recreates the five roles; passwords come from the recovered `.env` |
| `/etc` (Caddy, systemd units, sudoers) | host configuration | the repository's `deploy/` files plus `docs/production-cutover.md`; root-only files are the owner's |

## 5a. Restoring a rebuilt database over production is not a restore

Replacing production's football data with a clean rebuilt `afldb_test` is a **promotion**,
not a disaster recovery, and §6 below must not be used for it: a whole-database restore
replaces `auth_users`, `site_settings`, `auth_audit_log`, `site_media`, `staging_aflw` and
every other production-only table with the test database's content (the 2026-09-02
incident, `AFLDB-ISSUE-122` §S8). Use [production-promotion.md](production-promotion.md),
which restores into a candidate, reinstates production-owned state from the pre-cutover
backup, and checks for test-fixture identities before anything is renamed.

## 6. Full disaster recovery (V2)

**There is no rebuild safety net for production-only state.** The sealed historical rebuild (`tools/db/rebuild-test.ts`,
`docs/v2/legacy-disposition.md` L8/L9) reconstructs the historical baseline into `afldb_test`; it does not reconstruct
authentication and audit data, `data_edits`, `data_overrides`, settings, the D-336-2 curated draft rows, or any nightly
settle written since. The legacy SQLite import is not a recovery path (an earlier version of this section said it was).
A verified dump is the only recovery, which is why §3 and §4 exist.

What a dump holds: the whole database including privileges (ACLs) and the `afldb_meta.app_readable_tables` /
`import_writable_tables` registries (ordinary tables). `backup.sh` uses `--no-owner` only; **it does not use
`--no-privileges`** (an earlier version of this section said it did). What it does not hold: roles, `.env`, the release tree,
Caddy and systemd configuration (§5).

**Procedure A: the database is lost or corrupt, the host is intact.** Never `pg_restore --clean` over the live name.

```bash
# 1. Stop every writer and prove none runs.
sudo systemctl stop afldb afldb-settle-afl-api.timer
systemctl is-active afldb-settle-afl-api.service afldb-backup.service afldb-backup-verify.service   # all inactive
# 2. Choose the dump: the one last-verify.json names, hash-checked.
D=/home/arm/backups/afldb-scheduled; cat $D/.state/last-verify.json; (cd $D && sha256sum -c <file>.dump.sha256)
# 3. Restore into a NEW candidate database (superuser creates it with the extensions, owned by afldb_owner).
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE afldb_prod_restore_<stamp> OWNER afldb_owner"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d afldb_prod_restore_<stamp> -c "CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent"
pg_restore --dbname="<owner DSN, candidate database>" --no-owner --no-comments --jobs=4 --exit-on-error $D/<file>.dump
# 4. Reconcile grants from the restored registries (idempotent; NOT optional: the app role must read exactly the registry).
AFLDB_OWNER_DATABASE_URL="<owner DSN, candidate>" npm run db:privileges
# 5. Verify against the incident record: ledger head (SELECT max(name) FROM afldb_meta.schema_migrations equals the
#    pre-incident head), row counts of players, matches, player_match_stats, auth_users, data_edits; and that afldb_app
#    cannot read auth_users (has_table_privilege('afldb_app','auth_users','SELECT') = false).
# 6. Swap (the app is stopped; terminate stragglers), then start and gate.
sudo -u postgres psql -c "ALTER DATABASE afldb_prod RENAME TO afldb_prod_broken_<stamp>"
sudo -u postgres psql -c "ALTER DATABASE afldb_prod_restore_<stamp> RENAME TO afldb_prod"
sudo systemctl start afldb && node deploy/release.mjs status --expect <current id>
# 7. Re-enable the settle timer; the next nightly re-acquires what was lost since the dump.
sudo systemctl start afldb-settle-afl-api.timer
```

The renamed-away database is kept until the owner has accepted the result. The candidate-first order is the one the
promotion procedure uses (`production-promotion.md`), so a failed restore leaves production's old name untouched.

**Step 4 is the one that is easy to skip and expensive to skip.** If a restore is run with `--no-privileges` (as the
pre-2026-11-14 version of this section did), every table comes back with no ACLs: `afldb_app` can read nothing and the site
serves errors on every page. Even with ACLs restored from the dump, reconcile them: `npm run db:migrate` will not do it,
because every migration is already recorded in `afldb_meta.schema_migrations`, so the runner reports nothing to apply.

Before migration 039 the failure was quieter and worse. A schema-wide default privilege granted `afldb_app` SELECT on every
table `afldb_owner` created, so a restore silently handed the public role read access to `auth_users` (password hashes, TOTP
secrets), the session and beta-code tables and `site_media`. That default is now inverted: the public role reads exactly
what `afldb_meta.app_readable_tables` lists. Migration 045 did the same for `afldb_import` with
`afldb_meta.import_writable_tables`. Both registries are ordinary tables, so the dump carries them and step 4 rebuilds the
grant model from the backup itself.

**Procedure B: the host is lost.** Provision a host, then `00_install_postgres_prod.sh` (roles, cluster), restore the newest
**off-host** copy as in procedure A (steps 3-5, no swap needed), place the `.env` from protected storage, build or adopt
a release (`deployment.md` §3a), install Caddy and the units from `deploy/`, move DNS. This path is not rehearsed end to end;
treat its duration as the provisioning time plus the restore time measured in §3.
