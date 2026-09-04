# AFLDB — Promoting a rebuilt database to production

**Scope.** Replacing production's canonical football data with a clean rebuilt database
(`afldb_test`, from `npm run db:test:rebuild`) while every table that only ever existed on
production — administrator identities, beta access, operator settings, uploads, human data
authority, audit and telemetry — survives intact, and nothing from the test database becomes
production state. The procedure exists because the 2026-09-02 cutover (`AFLDB-ISSUE-122` §S8)
restored the rebuilt dump *over* `afldb_prod` and promoted a test fixture super admin into
production; recovery worked only because a dump had been taken first. `AFLDB-ISSUE-125`.

**Two hosts, named on every command.**

| Label | Host | Database |
|---|---|---|
| `DEV:` | `streamanator` (`arm@10.0.40.100`) | `afldb_dev`, `afldb_test` |
| `PROD:` | `afldb-prod` | `afldb_prod` |

Print `hostname` before any command that can destroy or rename a database, and read it.

**Never in a tracked file or a transcript:** a DSN, a password, a password hash, a TOTP
secret, a beta access code. The checker prints none of these; do not paste them either.

---

## 0. The model in one paragraph

Production is never restored over. The rebuilt dump is restored into a **new candidate
database** on the production host, every production-owned table in that candidate is emptied
and then **reinstated from the mandatory pre-cutover production backup**, the candidate is
checked by a read-only tool that refuses on any test-fixture identity, and only then is the
old `afldb_prod` **renamed aside** and the candidate renamed to `afldb_prod`. Rollback is the
two renames in reverse. The old database is kept, online, until the promotion is closed.

Why this and not "import only the football tables into the live production database": see
§11. Short version: the rebuilt registry-driven schema, migration state, sequences and the
observation spine all belong together, `pg_restore` of a whole database is the path this
repository already proves nightly, and a candidate can be accepted or thrown away without
production having changed.

## 1. The contract — what happens to every table

The authority for "rebuilt data" is the database itself: every `public` table in
`afldb_meta.import_writable_tables` (migration 045) is canonical or derived football data and
**arrives with the rebuild**. Everything else in `public`, and the two acquisition schemas,
has an explicit treatment in `tools/db/promotion-inventory.ts`. The checker refuses a
database with a public table in neither set or in both, so a new operational table cannot be
promoted by accident.

| Table | Subsystem | Production-only | Treatment | Why |
|---|---|---|---|---|
| `auth_users` | auth | yes | **reinstate** (first) | Identities, hashes, TOTP secrets, roles. The authentication boundary. |
| `admin_invites` | auth | yes | reinstate | Outstanding invites keep working. FK → `auth_users`. |
| `auth_sessions` | auth | yes | **reset** | Never crosses a database identity. Everyone logs in again. |
| `auth_audit_log` | auth | yes | reinstate **+ marker** | Full history, then a `database.promoted` row so the log records the cutover itself. |
| `beta_access_codes` | beta | yes | reinstate | Live credential material; revoke deliberately, never lose. |
| `beta_allowed_emails` | beta | yes | reinstate | Allowlist. Fixture-domain rows are refused. |
| `beta_join_requests` | beta | yes | reinstate | Reader-supplied, unrecoverable. |
| `beta_login_tokens` | beta | yes | reset | Short-lived single-use magic links. |
| `site_settings` | admin | yes | reinstate | Deliberate super-admin choices; the app silently falls back to defaults without them. |
| `site_media` | admin | yes | reinstate | Uploaded images. Not in the original issue list — found in the schema. |
| `data_edits` | data editor | yes | reinstate | Append-only audit of human canonical edits. |
| `data_overrides` | data editor | yes | reinstate **+ replay** | Human overrides reloads replay; the rebuild never saw them (§8). |
| `data_submissions` | uploads | yes | reinstate | `import_batch_id` may dangle → probed (§7.4). |
| `data_submission_rows` | uploads | yes | reinstate | After `data_submissions`. |
| `player_link_suggestions` | player links | yes | reinstate | Reader suggestions; `target_id` is deliberately not a FK. |
| `player_link_resolutions` | player links | yes | reinstate | Append-only human decisions; `player_id` may dangle → probed (§7.4). |
| `player_link_match_candidates` | player links | no | **regenerate** | Rebuilt by `/admin/player-links` refresh; `player_id` is NOT NULL against rebuilt players. |
| `nl_search_log` | NL telemetry | yes | reinstate | Carries human review and reader feedback; clearable later via `nl_search_telemetry_clear()`, never reconstructible. |
| `nl_search_review` | NL telemetry | yes | reinstate | After `nl_search_log`. |
| `nl_search_feedback` | NL telemetry | yes | reinstate | After `nl_search_log`. |
| `app_health_events` | health telemetry | yes | reinstate | Conscious retention; FK is `ON DELETE SET NULL`. |
| `promotion_decisions` | observation spine | yes | **reset — recorded gap** | Decisions on `promotion_candidates`, which the rebuild replaces. Retained only in the pre-cutover dump and the kept database; named in the audit marker. |
| `canonical_applications` | settle ledger | no | rebuilt | Machine ledger of the rebuilt rows. Production's settle ledger is a recorded gap. |
| `staging.*` | import / spine | no | rebuilt | Keyed to rebuilt `import_batches`. The current season is re-acquired (§9). |
| `staging_aflw.*` | AFLW | yes | reinstate (schema) | **Not produced by the rebuild**; a rebuilt database has it empty. |
| `afldb_meta.schema_migrations` | migrations | — | rebuilt, **parity-gated** | Must equal this checkout (§3, §6). |
| `afldb_meta.*_tables` registries | grants | — | rebuilt | The dump carries them; `privileges.sql` rebuilds grants from them. |
| everything in `import_writable_tables` | football | no | rebuilt | Canonical + derived (`player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats`, `club_seasons`). |

Reinstatement order is foreign-key order and is generated, not typed: `auth_users`, then
every table that references it, then `data_submission_rows`, `nl_search_review`,
`nl_search_feedback`, `app_health_events`.

## 2. The checker

```bash
npm run db:promotion:check -- --checklist                 # the acceptance list, no database
npm run db:promotion:check -- --phase <phase> --database <name> [flags]
```

Read-only by construction (`SET default_transaction_read_only = on` on every session; no
psql, no spawn; a unit test asserts both from the source). It takes the **name** of the DSN
environment variable (`--dsn-env`, default `AFLDB_OWNER_DATABASE_URL`) and replaces the
database name in it, so the same `.env` reaches `afldb_test`, `afldb_prod` or a candidate
without a DSN ever appearing on a command line. Each phase is bound to one database shape
and refuses any other by name:

| Phase | Database | Gates |
|---|---|---|
| `source` | `afldb_test` | identity, classification, migration parity, fixtures (info), optional `--expect-fingerprint` |
| `pre-cutover` | `afldb_prod` | + fixtures must be absent, super admin present, `--snapshot <file>` of row counts |
| `restored` | `afldb_prod_candidate_<stamp>` | + `--old-database` dangling-reference probe |
| `candidate` | `afldb_prod_candidate_<stamp>` | full acceptance: fixtures absent, `--expect-super-admin`, `--compare <snapshot>`, privileges reconciled |
| `production` | `afldb_prod` | same as `candidate`, on the live name |

Exit 0 is PASS; anything else is REFUSED with the failing gates named. A refusal at any
phase stops the procedure at that phase.

**The test-fixture gate.** An email address whose domain is under a reserved top-level
domain (`.test`, `.example`, `.invalid`, `.localhost`) or is `example.com`/`.net`/`.org`
cannot belong to a real person — the repository's own fixtures use exactly these
(`email-intake-test-fixture@afldb.test`, `super@example.test`). The gate checks every table
that stores an access-granting address (`auth_users`, `admin_invites`,
`beta_allowed_emails`, `beta_login_tokens`, `beta_join_requests`) with one SQL predicate
generated from the same lists as the TypeScript predicate. In `pre-cutover`, `candidate` and
`production` a single such row is a refusal. It is not a list of historic fixture addresses,
so a new fixture is caught without editing anything.

---

## 3. Preflight (DEV and PROD, nothing destructive)

```bash
# DEV: streamanator — the rebuilt source must be exactly what the checkout expects
cd ~/projects/afldb && hostname
git log -1 --oneline                                  # the revision PROD will run
npm run db:promotion:check -- --phase source --database afldb_test \
    --dsn-env AFLDB_TEST_DATABASE_URL [--expect-fingerprint <sha256 from db:test:fingerprint>]
```

Passes only when `afldb_test`'s migration ledger equals this checkout (no pending, no
unknown, no drift). Fixture rows are reported as information here — they are expected on a
test database and are removed in §7 — but a **PROD** checkout that is not at the same
migration set as the source is a stop: promote the code first (`AFLDB-ISSUE-027` order:
migration and `db:privileges` before the code) or rebuild from the matching revision.

```bash
# PROD: afldb-prod — same checkout, same migrations, state as it stands today
cd ~/projects/afldb && hostname
git log -1 --oneline                                  # must match DEV's
npm run db:status                                     # AFLDB_OWNER_DATABASE_URL names afldb_prod here
sudo systemctl status afldb afldb-settle-afltables.timer --no-pager
```

Decide the stamp now and use it everywhere: `STAMP=$(date +%Y%m%d-%H%M%S)`.

## 4. Mandatory production backup, proven

```bash
# PROD: afldb-prod
hostname
bash tools/maintenance/backup.sh --keep 14            # ~/backups/afldb/afldb_prod-<stamp>.dump
PRE=$(ls -1t ~/backups/afldb/afldb_prod-*.dump | head -1); echo "$PRE"
sha256sum "$PRE" | tee ~/backups/afldb/promotion-$STAMP.sha256
pg_restore --list "$PRE" | grep -c '^[0-9]'           # objects, non-zero
bash tools/maintenance/restore-test.sh "$PRE"        # parity checks into afldb_restore_test
```

`restore-test.sh` needs `afldb_restore_test` (created by `01_setup_service.sh`). If the host
lacks it, restore into a throwaway `afldb_restore_test` created with
`sudo -u postgres createdb -O afldb_owner afldb_restore_test` and run the script; never
"prove" the dump by restoring it anywhere else. Copy the dump and its `.sha256` off the host
before continuing (`docs/backup-restore.md` §4).

## 5. Production-owned state snapshot

```bash
# PROD: afldb-prod
npm run db:promotion:check -- --phase pre-cutover --database afldb_prod \
    --snapshot ~/backups/afldb/promotion-$STAMP.json \
    --expect-super-admin <the real production super admin's email>
```

Refuses if production already holds a fixture identity or lacks an enabled, enrolled super
admin — either is an existing problem to fix before promotion, not something to carry
through it. The snapshot is row counts only (mode 600) and is what §7's acceptance compares
against.

## 6. Source validation and candidate restore

```bash
# DEV: streamanator — dump the rebuilt source, hash it
pg_dump "$AFLDB_TEST_DATABASE_URL" --format=custom --compress=6 --no-owner \
        --file=/home/arm/afldb_test_rebuilt_$STAMP.dump
sha256sum /home/arm/afldb_test_rebuilt_$STAMP.dump
# transfer to PROD (scp), then on PROD: sha256sum must match before anything else
```

```bash
# PROD: afldb-prod — a NEW database, never afldb_prod
hostname
CAND=afldb_prod_candidate_$STAMP
sudo -u postgres createdb -O afldb_owner "$CAND"
sudo -u postgres psql -d "$CAND" -v ON_ERROR_STOP=1 -c \
  'CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; ALTER SCHEMA public OWNER TO afldb_owner;'
# CANDIDATE_DSN: the owner DSN with the database name replaced. Build it in the shell from
# .env (e.g. with the same "replace the NAME, not a substring" rule restore-test.sh uses);
# do not echo it.
pg_restore --dbname="$CANDIDATE_DSN" --no-owner --no-privileges --jobs=4 \
           /home/arm/afldb_test_rebuilt_$STAMP.dump
```

The two "must be owner of extension" messages are the only tolerated errors
(`docs/backup-restore.md` §2). Then:

```bash
npm run db:promotion:check -- --phase restored --database "$CAND" --old-database afldb_prod
```

This proves the candidate is the source (migration parity), reports the fixture rows the
restore brought in (expected, removed next), and **probes dangling references**: for each
production-owned row whose FK points into rebuilt data (`player_link_resolutions.player_id`,
`data_submissions.import_batch_id`), whether the target still exists in the candidate. A
`WARN` here prints the exception SQL for §7.4; a `FAIL` means the contract itself must be
revisited before continuing.

## 7. Reinstate production-owned state into the candidate

Generate the plan (no database contact; refuses to overwrite):

```bash
# PROD: afldb-prod
npm run db:promotion:check -- --plan --database "$CAND" --old-database afldb_prod \
    --pre-cutover-dump "$PRE" --rebuilt-dump /home/arm/afldb_test_rebuilt_$STAMP.dump \
    --plan-dir ~/backups/afldb/promotion-$STAMP
```

Four files, mode 600: `promotion-truncate.sql`, `promotion-resync-identity.sql`,
`promotion-audit-marker.sql` and `promotion-reinstate.sh`. **Read all four.** The `.sh` is a
transcript to follow line by line, not a script to pipe into a shell.

### 7.1 Empty every non-rebuilt table

`promotion-truncate.sql` — one `TRUNCATE … RESTART IDENTITY` over every table in §1 except
`canonical_applications`, plus every `staging_aflw` table. This is what removes the test
fixtures. No cascade is needed: every table that references one of these is in the list.

### 7.2 Restore the rows, one table at a time, in FK order

One `pg_restore --data-only --single-transaction --exit-on-error --table=<t>` per reinstated
table from the **pre-cutover dump**, in the generated order, then `--schema=staging_aflw`.
A failure names the table and leaves earlier tables committed and that table empty.

### 7.3 Identity sequences, audit marker, privileges

`promotion-resync-identity.sql` advances every identity sequence of the reinstated tables
past the reinstated maximum (a data-only table restore does not carry `SEQUENCE SET`).
`promotion-audit-marker.sql` inserts the `database.promoted` row with the candidate, the
replaced database, both dump names and the reinstated/reset/regenerated/gap lists. Then
**`tools/maintenance/privileges.sql` on the candidate** — mandatory after any restore
(`docs/backup-restore.md` §6); the acceptance gate checks it was run.

### 7.4 The dangling-reference exception (only if §6 said `WARN`)

A reinstated table with a nullable FK into rebuilt data cannot be restored while a row
points at a vanished target. The checker prints the exact three statements for that table
and constraint: drop the FK, run that table's `pg_restore` line, `UPDATE … SET <col> = NULL`
for rows whose target is absent, re-add the FK with its original name. Record the affected
row count in the promotion record. No other table gets this treatment; `player_link_match_candidates`
is regenerated instead (§8) and `promotion_decisions` is a recorded gap (§1).

### 7.5 Accept the candidate

```bash
npm run db:promotion:check -- --phase candidate --database "$CAND" \
    --compare ~/backups/afldb/promotion-$STAMP.json \
    --expect-super-admin <the real production super admin's email>
```

Every gate must PASS: no fixture identity in any email-bearing table; the named super admin
present, enabled, with password and TOTP; reinstated counts equal to the snapshot
(`auth_audit_log` ≥ snapshot, `auth_sessions`/`beta_login_tokens`/`promotion_decisions` = 0);
migration parity; grants reconciled. **Nothing has touched `afldb_prod` yet.** A refusal here
costs a `dropdb "$CAND"` and nothing else.

## 8. Swap, post-promotion state, health, admin login

```bash
# PROD: afldb-prod
hostname
sudo systemctl stop afldb-settle-afltables.timer afldb-settle-afltables.service afldb
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN ('afldb_prod', '$CAND') AND pid <> pg_backend_pid();
ALTER DATABASE afldb_prod RENAME TO afldb_prod_pre_rebuild_$STAMP;
ALTER DATABASE "$CAND" RENAME TO afldb_prod;
SQL
sudo systemctl start afldb
npm run db:promotion:check -- --phase production --database afldb_prod \
    --compare ~/backups/afldb/promotion-$STAMP.json \
    --expect-super-admin <the real production super admin's email>
```

The kept database is named `afldb_prod_pre_rebuild_<stamp>` on purpose: `tools/db/rebuild-test.ts`
refuses to touch any `pre_rebuild` name, and the checker accepts it as `--old-database`.

**Post-promotion state, in this order:**

1. **Replay human overrides.** The rebuild ran on `afldb_test`, which had no
   `data_overrides`; the reinstated rows are authority that has not yet been applied to the
   promoted canonical rows. Replay them with the importer's own function, as the import role:

   ```bash
   cd ~/projects/afldb && ./.venv/bin/python - <<'PY'
   import sys; sys.path.insert(0, 'tools/migration')
   from common import load_env, connect_pg, replay_admin_overrides
   load_env()
   with connect_pg() as pg:
       for table in ('players', 'matches'):
           replay_admin_overrides(pg, table)
       pg.commit()
   PY
   ```

   If it changed player or match rows, recompute the derived tables:
   `./.venv/bin/python tools/migration/rebuild_derived.py`.
2. **Regenerate `player_link_match_candidates`** from `/admin/player-links` (refresh) once
   signed in — the table was reset because its `player_id` is NOT NULL against rebuilt players.
3. **Health:** `curl -fsS http://127.0.0.1:3100/api/health`, then a season page, a player
   page, an AFLW page and `/search` in a browser. AFLW proves `staging_aflw` came back.
4. **Real admin login:** the production super admin signs in with password and TOTP. Old
   sessions are gone by design, so this is a genuine new login, and it writes the first
   post-marker audit row. Check `/admin/settings` shows the reinstated choices, not defaults.

## 9. Current season

The rebuild carries the seasons it was built from; production's in-season rows, settle
ledger and acquisition history were replaced (§1). Re-acquire with the standard supervised
ladder in `docs/deployment.md` §7b — `--dry-run --auto-apply` first, then `--apply` — and
only then `sudo systemctl start afldb-settle-afltables.timer`. `AFLDB-ISSUE-137` applies:
after a rebuild that carries the ISSUE-136 identity fix, the settle resolves the renumbered
identities correctly, which is the point of promoting rather than repairing in place.

## 10. Rollback and cleanup

**Rollback** (any time until cleanup; seconds, no data movement):

```bash
# PROD: afldb-prod
hostname
sudo systemctl stop afldb-settle-afltables.timer afldb-settle-afltables.service afldb
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN ('afldb_prod', 'afldb_prod_pre_rebuild_$STAMP') AND pid <> pg_backend_pid();
ALTER DATABASE afldb_prod RENAME TO $CAND;
ALTER DATABASE afldb_prod_pre_rebuild_$STAMP RENAME TO afldb_prod;
SQL
sudo systemctl start afldb
```

Anything written to the promoted database between swap and rollback (a new audit row, a
settle) is left in the candidate, not merged back; say so in the promotion record. If the
cluster itself is lost, the pre-cutover dump plus `docs/backup-restore.md` §6 is the path.

**Cleanup** — not the same day. When the promotion record is closed:

```bash
sudo -u postgres dropdb afldb_prod_pre_rebuild_$STAMP     # only after the record is closed
rm ~/backups/afldb/promotion-$STAMP/promotion-*.sql ~/backups/afldb/promotion-$STAMP/promotion-reinstate.sh
```

Keep the pre-cutover dump under normal backup retention and keep the off-host copy.

## 11. Why restore-then-reinstate, not football-data-only import

| Concern | Import football tables into live `afldb_prod` | Restore rebuilt dump into a candidate, reinstate production-owned state |
|---|---|---|
| FK dependencies | ~60 tables truncated and reloaded in place inside FK constraints; production-owned tables that point into them (`player_link_resolutions`, `data_submissions`, `promotion_decisions`) block the truncate or need `session_replication_role` (superuser, bypasses FKs) | The rebuilt schema and data arrive consistent; only the handful of production-owned FKs into rebuilt data are probed, and those are exactly the ones the checker names |
| Sequences | every reloaded identity sequence must be set by hand | carried by the dump; only the 18 reinstated tables need a re-sync, generated |
| Grants / ownership | grants survive but registries in `afldb_meta` must be reconciled with the rebuilt schema | `--no-privileges` restore + `privileges.sql`, the path proven by `restore-test.sh` nightly |
| Migration state | the ledger is not replaced; a schema difference between source and production is silent | the ledger is replaced and **parity-gated** against the checkout |
| Audit continuity | in-place; no natural cutover marker | reinstated in full plus an explicit marker; gaps recorded |
| Transaction size | one enormous multi-table transaction on the live database, or partial states | per-table single transactions on a database nobody is using |
| Rollback | a restore from backup | two `ALTER DATABASE … RENAME` |
| Test state leaking in | only if a football table is polluted | every non-rebuilt table is truncated before reinstatement; the fixture gate refuses leftovers |
| Production changes during the work | from the first truncate | none until the swap |

The in-place model is more complex and its failure modes land on the live database. The
candidate model is the existing backup/restore machinery plus a list, a probe and a rename.

## 12. Relationship to other records

- `AFLDB-ISSUE-126` — the production-only rows still held only in `afldb_prod_auth_recovery`
  from the 2026-09-02 incident. Unaffected by this procedure; resolve it on its own terms.
  Until it is resolved, its recovery database must not be dropped.
- `AFLDB-ISSUE-137` — the four split player identities on production. Path (a) of that
  issue is this procedure.
- `docs/backup-restore.md` — backup, proof and full disaster recovery.
- `docs/deployment.md` §6a (clean rebuild), §7b (settle), §11 (code rollback).
