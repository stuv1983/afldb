# AFLDB — Promoting a rebuilt database to a live database

**Scope.** Replacing production's canonical football data with a clean rebuilt database
(`afldb_test`, from `npm run db:test:rebuild`) while every table that only ever existed on
production — administrator identities, beta access, operator settings, uploads, human data
authority, audit and telemetry — survives intact, and nothing from the test database becomes
production state. The procedure exists because the 2026-09-02 cutover (`AFLDB-ISSUE-122` §S8)
restored the rebuilt dump *over* `afldb_prod` and promoted a test fixture super admin into
production; recovery worked only because a dump had been taken first. `AFLDB-ISSUE-125`.

**Two environments, and production is the default.** Everything below is the **production**
contract. `AFLDB-ISSUE-141` added an explicit `--environment prod|dev` so the *same* supported
path can also converge `afldb_dev` (`AFLDB-ISSUE-139`) instead of hand-written per-table
dump/restore, which is the improvisation this procedure exists to prevent. The environment is
always stated on the command line and is **never inferred from a database name**. Read §13
before promoting a DEV database: DEV is not production authority, the two environments do not
have the same operational standing, and only two gates differ.

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
| `data_edits` | data editor | yes | reinstate (**dev: historical-only**) | Append-only audit of human canonical edits. `table_name` + `row_id` is a row id in `players`/`matches`/`coaches`/`draft_picks`, not a FK → **lineage-bound** (§7.4c). Withheld as a recorded gap on a DEV promotion (§7.4d). |
| `data_overrides` | data editor | yes | reinstate **+ replay** | Human overrides reloads replay; the rebuild never saw them (§8). Replay covers `players`, `matches`, `draft_picks`, `coaches`, `match_coaches`; the `coaches`, `players` and `draft_picks` replays re-create whole admin-created rows, not just field patches (§8). |
| `data_submissions` | uploads | yes | reinstate | `import_batch_id` may dangle → probed (§7.4). |
| `data_submission_rows` | uploads | yes | reinstate | After `data_submissions`. |
| `player_link_suggestions` | player links | yes | reinstate | Reader suggestions; `target_id` is deliberately not a FK. |
| `player_link_resolutions` | player links | yes | reinstate (**dev: historical-only**) | Append-only human decisions; `player_id` may dangle → probed (§7.4). Both `player_id` and `target_id` are ids of the replaced database → **lineage-bound** (§7.4c). Withheld as a recorded gap on a DEV promotion (§7.4d). |
| `player_link_match_candidates` | player links | no | **regenerate** | Rebuilt by `/admin/player-links` refresh; `player_id` is NOT NULL against rebuilt players. |
| `nl_search_log` | NL telemetry | yes | reinstate | Carries human review and reader feedback; clearable later via `nl_search_telemetry_clear()`, never reconstructible. |
| `nl_search_review` | NL telemetry | yes | reinstate | After `nl_search_log`. |
| `nl_search_feedback` | NL telemetry | yes | reinstate | After `nl_search_log`. |
| `app_health_events` | health telemetry | yes | reinstate | Conscious retention; FK is `ON DELETE SET NULL`. |
| `promotion_decisions` | observation spine | yes | **reset — recorded gap** | Decisions on `promotion_candidates`, which the rebuild replaces. Retained only in the pre-cutover dump and the kept database; named in the audit marker. |
| `canonical_applications` | settle ledger | no | rebuilt | Machine ledger of the rebuilt rows. Production's settle ledger is a recorded gap. |
| `external_grid_sources` | Grid Solver corpus | yes | reinstate (**staged**, first of three) | Seeded by migration 080 itself: the truncate removes the candidate's seed so the dump's row keeps its id. `ingest_source_id` → rebuilt `sources` is **NOT NULL and lineage-bound**, so the table is restored through `promotion_staging`, remapped there, then promoted under the FK (§7.4b, `AFLDB-ISSUE-151`). |
| `external_grids` | Grid Solver corpus | yes | reinstate | Captured Gridley boards with their raw payloads. **Immutable evidence, no rebuild stage** — a rebuilt candidate has this empty and the rescued legacy archive cannot be re-fetched. `import_batch_id` is NOT NULL into rebuilt `import_batches` → §7.4b. |
| `external_grid_axes` | Grid Solver corpus | yes | reinstate (last of three) | The six captured criteria per board revision. `ON DELETE CASCADE` from `external_grids`. |
| `player_match_period_stats` | quarter-by-quarter stats | no | rebuilt | Football schema (migration 062) with **no writer, no rebuild stage and no registry row** — see below. `compare = zero`. |
| `staging.*` | import / spine | no | rebuilt | Keyed to rebuilt `import_batches`. The current season is re-acquired (§9). |
| `staging_aflw.*` | AFLW | yes | reinstate (schema) | **Not produced by the rebuild**; a rebuilt database has it empty. |
| `afldb_meta.schema_migrations` | migrations | — | rebuilt, **parity-gated** | Must equal this checkout (§3, §6). |
| `afldb_meta.*_tables` registries | grants | — | rebuilt | The dump carries them; `privileges.sql` rebuilds grants from them. |
| everything in `import_writable_tables` | football | no | rebuilt | Canonical + derived (`player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats`, `club_seasons`). |

Reinstatement order is foreign-key order and is generated, not typed: `auth_users`, then
every table that references it and `external_grid_sources`, then `data_submission_rows`,
`nl_search_review`, `nl_search_feedback`, `app_health_events` and `external_grids`, then
`external_grid_axes` last. A table declared **historical-only** for the environment being
promoted (§7.4d) is absent from that generated order altogether — it is still truncated, but
it gets no `pg_restore` line and is expected to read zero rows at acceptance.

The dependencies behind that order are explicit contract data (`restoreAfter` for `public`,
`tableDependencies` for a reinstated schema), not an incidental alphabetic tie-break. Before a
plan is written, `assertContractCoherent()` validates that every declared parent is present and
earlier than its child in every environment, and that every schema table dependency is satisfied.
The test suite pins those schema dependencies against migration 025's actual FKs.

**Why the migration-080 tables are here.** They are deliberately **not** in
`afldb_meta.import_writable_tables` (`080_external_grids.sql`: `grant_import_write()` hands out
UPDATE, DELETE and TRUNCATE, and `privileges.sql` would restore them at every reconcile, which
would end the corpus's immutability). Until `AFLDB-ISSUE-141` they were in neither set, so the
classification gate refused every database carrying migration 080 — and, more seriously, a
generated plan named them in neither the truncate list nor the reinstate list. Because there is
no Gridley rebuild stage (`docs/deployment.md` §6a), the swap would have replaced an explicitly
immutable captured corpus with the candidate's empty tables, and no gate would have noticed.

**Why `player_match_period_stats` is here** (`AFLDB-ISSUE-142`). Migration 062 creates it and
registers it **nowhere**: it calls neither `afldb_meta.grant_import_write()` — as migrations 053,
074, 086, 087 and 089 all do for the tables the ETL reloads — nor `grant_app_read()`. It was
therefore the one public table in neither classification set, and the fail-closed gate refused
**every phase on every real database**, `--phase source` on a rebuilt `afldb_test` included. The
same shape as the migration-080 gap above, except that here the absence was an omission rather
than a decision.

It is decided as a **contract entry, not a registry row**, because `grant_import_write()`
registers *and grants* in one statement: registering it would hand `afldb_import` UPDATE, DELETE
and TRUNCATE — restored at every `privileges.sql` reconcile — for a writer that does not exist.
Nothing in the tree writes the table (the only references are reads:
`tools/current-season/repair-match-rekeys.ts` and the NL period-split queries in
`src/db/queries/nl/`), no rebuild stage produces it, and it held **0 rows** on `afldb_dev` and on
the rebuilt `afldb_test` when this was measured. `rebuilt` is therefore the honest treatment —
the candidate's copy stands, exactly as for a registry table — and `compare = zero` is the
tripwire: the day a writer exists, the `candidate`/`production` comparison fails and this entry
must be revisited, at which point registering it import-writable, with the grant it then
genuinely needs, is the right answer.

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

| Phase | Database (`--environment prod`, the default) | Database (`--environment dev`) | Gates |
|---|---|---|---|
| `source` | `afldb_test` | `afldb_test` | identity, classification, no leftover `promotion_staging` schema (every phase, `AFLDB-ISSUE-151`), migration parity, fixtures (info), optional `--expect-fingerprint` |
| `pre-cutover` | `afldb_prod` | `afldb_dev` | + fixtures must be absent, super admin present, every staged table holds rows (§7.2), `--snapshot <file>` of row counts |
| `restored` | `afldb_prod_candidate_<stamp>` | `afldb_dev_candidate_<stamp>` | + `--old-database` dangling-reference probe, + lineage identity of reinstated id-keyed rows (§7.4c, §7.4d), optional `--lineage-remap-out <file>` |
| `candidate` | `afldb_prod_candidate_<stamp>` | `afldb_dev_candidate_<stamp>` | full acceptance: fixtures absent, `--expect-super-admin`, `--compare <snapshot>`, privileges reconciled |
| `production` | `afldb_prod` | `afldb_dev` | same as `candidate`, on the live name |

`--old-database` is `afldb_prod` / `afldb_prod_pre_rebuild_<stamp>` under `prod` and
`afldb_dev` / `afldb_dev_pre_rebuild_<stamp>` under `dev`. `source` is `afldb_test` in both,
because `db:test:rebuild` refuses any other target by name. The matrix is fail-closed in **both
directions**: a `prod` name under `--environment dev` is refused, and a `dev` name under the
default is refused. `--environment` adds one accepted shape per phase; it never makes a phase
name-free, and it is never inferred from the name offered.

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

This runbook starts after the implementation branch has passed
`npm run merge:ready -- --issue NNN` and the operator has merged it. On main,
`npm run preflight -- --mode merge` is the compact merge-only guard; neither command performs the
merge or fetches remote state.

Run the shared fail-fast preflight before the phase-specific checker. It inspects the
worktree/branch/base, dirty state, migration reservations across relevant refs/worktrees,
`.env`/tool availability, database identity/role/reachability and migration parity without
printing a DSN or changing state:

```bash
# Workstation, DEV source example. Add --expect-role when the step requires an exact role.
npm run preflight -- --mode promotion --environment dev \
    --dsn-env AFLDB_TEST_DATABASE_URL --expect-database afldb_test \
    --ssh-host streamanator
```

Every `FAIL` is a stop. `WARN` is evidence to read, not an automatic waiver. The command does
not fetch, so an operator-required `git fetch` remains a separate explicit action.

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
npm run db:promotion:check -- --phase restored --database "$CAND" --old-database afldb_prod \
    --lineage-remap-out ~/backups/afldb/promotion-lineage-$STAMP.sql
```

This proves the candidate is the source (migration parity), reports the fixture rows the
restore brought in (expected, removed next), **proves the id lineage** of every reinstated
id-keyed column (§7.4c — on a same-lineage promotion this passes and the remap file is written
as an explicit no-op holding no `UPDATE`), and
**probes dangling references**: for each
production-owned row whose FK points into rebuilt data (`player_link_resolutions.player_id`,
`data_submissions.import_batch_id`, `external_grid_sources.ingest_source_id`), whether the
target still exists in the candidate. A
`WARN` here prints the exception SQL for §7.4, or names the table the plan **stages** (§7.4b);
a `FAIL` means the contract itself must be revisited before continuing. Always pass
`--lineage-remap-out`: the generated plan runs that file at a fixed step (§7.2, `AFLDB-ISSUE-151`),
and the file is what settles a staged table before its rows meet the FK.

## 7. Reinstate production-owned state into the candidate

Generate the plan (no database contact; refuses to overwrite):

```bash
# PROD: afldb-prod
npm run db:promotion:check -- --plan --database "$CAND" --old-database afldb_prod \
    --pre-cutover-dump "$PRE" --rebuilt-dump /home/arm/afldb_test_rebuilt_$STAMP.dump \
    --plan-dir ~/backups/afldb/promotion-$STAMP
```

When this command is launched from Git Bash, set `MSYS_NO_PATHCONV=1` and
`MSYS2_ARG_CONV_EXCL='*'` first. The checker also refuses any dump path that arrives as a
Windows drive/`Program Files` path, so `/home/arm/example.dump` cannot silently become
`C:/Program Files/Git/home/arm/example.dump` in a Linux-host plan.

Eight files, mode 600: `promotion-truncate.sql`, `promotion-stage.sql`,
`promotion-promote-staged.sql`, `promotion-resync-identity.sql`, `promotion-audit-marker.sql`,
`promotion-reinstate.sh`, `promotion-swap.sql` and `promotion-rollback.sql`. **Read all eight.**
The `.sh` is a transcript to follow line by line, not a script to pipe into a shell; it also
names `LINEAGE_REMAP_SQL`, the `--lineage-remap-out` file §6 wrote, and one further file it
generates itself on the host (`promotion-stage-<table>.sql`, §7.2).

The generator validates the assembled truncate, stage, restore, promotion, sequence and audit
artefacts before it creates the plan directory. It refuses DELETE/CASCADE substitution, an
incomplete or misordered rebuilt-side FK lifecycle, a per-table/TOC-ordered schema restore, a
restore order that differs from the contract, any write/restore/sequence action for a
historical-only table, a plain `pg_restore` of a staged table into `public`, a staged lifecycle
that is not ordered stage → remap → promote → dependants, and any constraint bypass
(`session_replication_role`, `DISABLE TRIGGER`, `DROP CONSTRAINT`, `SET CONSTRAINTS`,
`DEFERRABLE`, `NOT VALID`, `--disable-triggers`) in the stage, promotion or transcript files.

### 7.1 Empty every non-rebuilt table

`promotion-truncate.sql` — one `TRUNCATE … RESTART IDENTITY` over every table in §1 except
`canonical_applications`, plus every `staging_aflw` table. This is what removes the test
fixtures. No cascade is needed: every table that references one of these is in the list — with
one exception the first live run found (`AFLDB-ISSUE-139` Phase 4E-2): the **rebuilt**
`promotion_candidates` holds `resolved_decision_id → promotion_decisions(id)` (migration 074), and
PostgreSQL refuses to truncate a referenced table unless every referrer is in the same statement,
a structural check made even when both tables are empty. A rebuilt referrer can neither join the
`TRUNCATE` nor be cascaded, and `promotion_decisions` cannot leave the statement either (it
references `auth_users`). So the file is one transaction that drops exactly that constraint, runs
the one `TRUNCATE`, and re-adds the constraint by its original name (`REBUILT_REFERRER_FKS` in
`promotion-inventory.ts`) — the `ADD CONSTRAINT` re-validates every rebuilt row, so a row that
still pointed at a decision refuses the whole file, the same fail-closed shape as §7.4.

`promotion_decisions` is a reset/recorded-gap table, so there is no target data restoration to
wait for: the FK is recreated immediately after the truncate inside that transaction. The
contract validator refuses this lifecycle if a future entry changes the target to `reinstate`,
because that would recreate the FK before its referenced data was restored.

### 7.2 Restore the rows, one table at a time, in FK order

One `pg_restore --data-only --single-transaction --exit-on-error --table=<t>` per reinstated
table from the **pre-cutover dump**, in the generated order, then the eight `staging_aflw` tables
one per line with `--schema=staging_aflw --table=<t>` in the contract's FK order (`seasons` first).
A single `--schema=staging_aflw` line was the original shape and failed on the first live run
(`AFLDB-ISSUE-139` Phase 4E-2): `pg_restore --data-only` restores in TOC (alphabetical) order, so
`fixtures` arrived before `seasons` and the single transaction rolled back.
A failure names the table and leaves earlier tables committed and that table empty.

**Staged tables (`AFLDB-ISSUE-151`).** A reinstated table whose **NOT NULL** reference into
rebuilt data is lineage-bound with a stable identity — today exactly `external_grid_sources`,
`ingest_source_id` → `sources` through `sources.key` — is never restored straight into `public`.
The first production promotion (stamp `20260907-234124`) proved why: the dumped row carried
`ingest_source_id = 57` (old `sources` 57 = `gridley`), the candidate's gridley row is `sources`
7 and its id 57 does not exist, so a plain restore meets the immediate FK before any `UPDATE`
can run, and the evidenced remap of §7.4c came too late. The transcript therefore splits step 2
around such tables:

1. **2 — direct restores.** Every reinstated table that is neither staged nor an FK descendant of
   a staged table, in contract order, as above.
2. **2b — stage.** `promotion-stage.sql` creates `promotion_staging` and one bare copy per staged
   table (`CREATE TABLE promotion_staging.<t> (LIKE public.<t>)` — columns only: no identity, no
   key, no FK). Then, per staged table, `pg_restore --data-only --table=<t> -f -` writes the
   dump's restore script through a `sed` that redirects its one `COPY public.<t> (` header to
   `promotion_staging.<t>`, into `promotion-stage-<t>.sql`; a `grep` proves the redirect
   applied; `psql --single-transaction -f` loads it. The rows land with their **own ids and the
   old reference integers**, and nothing checks them yet. Read the small file before loading it.
3. **2c — remap.** `psql -f "$LINEAGE_REMAP_SQL"` — the §6 `--lineage-remap-out` file, once. At
   this moment every directly restored lineage-bound table is in `public` and every staged table
   is in `promotion_staging`, which is where its guarded `UPDATE … WHERE id = <row> AND <col> =
   <old>` lands. On a shared lineage the file holds no `UPDATE` and the step is a no-op; it is
   still run, so it is never silently skipped.
4. **2d — promote.** `promotion-promote-staged.sql`, one transaction: for each staged table it
   refuses — before any `INSERT` — an empty staging copy or a row whose reference still points
   at an id the candidate does not have, then `INSERT INTO public.<t> OVERRIDING SYSTEM VALUE
   SELECT * FROM promotion_staging.<t> ORDER BY id` (ids preserved; the FK checks every row as it
   is inserted), drops the staging table, and finally drops the schema without `CASCADE`.
5. **2e — dependants.** Tables whose `restoreAfter` chain reaches a staged table
   (`external_grids`, `external_grid_axes`), plain restores as in step 2, now that the rows they
   reference exist in `public`.

No constraint is dropped, deferred, disabled or validated later, no `sources` row is inserted,
and the id of every staged row is the dumped id. The staging schema exists only between 2b and
2d; if it is still there, an earlier attempt did not finish — inspect it, never reuse it.

**A staged table must hold rows in the database being replaced.** A data-only restore of an
empty table leaves no trace, so 2d cannot tell "restored zero rows" from "2b never ran" and
refuses an empty `promotion_staging.<t>` either way. `--phase pre-cutover` therefore refuses
when a staged table is empty (or absent) in the live database, before any plan exists: decide
that table's disposition then (it is not a case the staged path promotes past), not
mid-transcript. Today the one staged table is seeded by migration 080 and cannot be empty on a
migrated database; the gate keeps that true for any table the contract's shape rule selects.

**Interrupted staged reinstatement.** If anything stops between 2b and 2d — a refused
`COPY`, a refused promotion, a lost session — `promotion_staging` remains, and everything
fails closed around it: the checker refuses at every phase (`No leftover promotion_staging
schema`), `promotion-stage.sql`'s `CREATE SCHEMA` refuses while it exists, and no generated
file drops it (the plan validator refuses `IF NOT EXISTS`, `IF EXISTS` and any `DROP SCHEMA`
outside 2d). Before any cleanup or retry:

1. Inspect it and write the findings into the promotion record: which step stopped and why
   (the psql error is the evidence), what `promotion_staging.<t>` holds (`SELECT count(*)`,
   then the rows), whether the 2c `UPDATE` was applied (the reference column shows the
   candidate's id, not the replaced database's), and whether `public.<t>` already holds the
   rows (2d ran to its `INSERT` and failed on the FK — the transaction rolled back, so it
   should not; prove it).
2. Only after the inspection is recorded, drop the schema by hand — an operator statement,
   never a generated one — then regenerate the plan (the generator refuses to overwrite: move
   the old files aside) and start again at its step 1. Never load rows into a leftover copy,
   never run 2c or 2d against one, and never pass a `--phase` check that names it.

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

### 7.4b The captured grid corpus's NOT NULL references (`AFLDB-ISSUE-141`)

Two of the migration-080 references are **NOT NULL** into import-writable (rebuilt) tables, so
neither can take the §7.4 nullable path. The checker prints the contract's decision beside the
finding; both must be settled **before the rows meet their foreign keys**, and what was done
recorded in the promotion record.

* `external_grid_sources.ingest_source_id` → `sources`. `sources` is import-writable, so the
  candidate's id for key `gridley` need not equal the dumped one. The contract declares
  `sources.key` as the stable identity: `--phase restored --lineage-remap-out <file>` proves old
  id → key → candidate id and emits a guarded `UPDATE`. Because the column is NOT NULL against an
  immediate FK, that `UPDATE` cannot follow a plain restore — the restore itself would refuse
  the old integer (`AFLDB-ISSUE-151`). The plan therefore **stages** the table (§7.2): the
  `UPDATE` targets `promotion_staging.external_grid_sources` and runs at step 2c, and the rows
  are promoted into `public` under the FK at 2d with their ids preserved. Migration 080 seeds
  that source, so **never insert a `sources` row** and never assume either run's numeric id is
  stable.
* `external_grids.import_batch_id` → `import_batches`. The rebuilt candidate holds the
  *rebuild's* batches, not the batch that captured the corpus, so this reference dangles on any
  real promotion. Two supportable answers, and the choice is the operator's:
  1. reinstate the referenced `import_batches` row(s) from the pre-cutover dump **before** this
     table — the ids must not collide with the candidate's own and the identity sequence must
     be re-synced; or
  2. open **one** batch in the candidate for the reinstatement and set `import_batch_id` to it.
     This rewrites the corpus's ingest provenance, so it must be stated in the promotion record
     and in the `database.promoted` marker's recorded gaps.

  **Never drop the rows to make the FK pass.** The captured payload is the evidence, the
  rescued legacy archive cannot be re-fetched, and there is no rebuild stage that would
  recreate it.

### 7.4c Id-keyed human/admin rows across a lineage change (`AFLDB-ISSUE-142`)

§7.4 and §7.4b both ask whether a referenced id still **exists**. Existence is not identity.
When the candidate does not share the replaced database's id lineage, almost every id exists
and denotes a **different row** — so "0 missing" is precisely the answer a silent
misattribution produces.

This is not hypothetical. Measured read-only on `afldb_dev` on 2026-09-06: its 94
`player_link_resolutions` rows reference 36 distinct `player_id`s; 34 of them exist in the
rebuilt lineage and **all 34 name a different person** (151 Craig Bradley vs Alan McGowan; 318
Gary O'Donnell vs Alex Georgiou; 380 Doug Hawkins vs Alf Copsey). `data_edits.row_id` and
`player_link_resolutions.target_id` are in the same old id space. A production promotion has
never met this, because its candidate is a rebuild of the same lineage.

**The gate.** `--phase restored` now proves the lineage from evidence before anything is
reinstated:

1. it reads the **stable identity** of sampled ids on both databases — for a player, the AFL
   Tables profile url (`external_identities`, source `afltables`, `match_method`
   `afltables_profile_url`, status unique/resolved: the identity every `AFLDB-ISSUE-118` loader
   already resolves people through); for a match, `matches.match_key` (NOT NULL UNIQUE since
   migration 003); for a coach, `coaches.afltables_coach_path` (NOT NULL UNIQUE since
   migration 087 — the AFL Tables coach page path, or `manual:<token>` for an admin-created
   coach, `AFLDB-ISSUE-159`). **A display name is never used, in either direction** — two
   footballers share a name often enough that a name match would silently retarget a human
   decision, and `coaches.name_key` is a name, which is why it is not the coach identity;
2. identities equal on every comparable sample → one lineage → id-keyed reinstatement is sound
   and the gate PASSES, generating nothing. **Nothing comparable also counts as a change**, so
   a missing identity layer can never read as "safe";
3. otherwise every lineage-bound column declared in the contract is resolved per row, old id →
   identity → new id. An id is mapped **only** when exactly one identity is read for it in the
   replaced database and exactly one candidate row carries that same identity string. Every
   other shape — no identity, two identities, an identity absent from the candidate, an
   identity resolving to two rows — is unresolved, and **unresolved REFUSES**.

`--lineage-remap-out <file>` writes the result as SQL: one `UPDATE` per row, guarded by the
value it was proved against (so re-running it is a no-op), each preceded by the evidence
comment `old id -> identity -> new id`; `-- UNRESOLVED` lines naming the reason for everything
that could not be evidenced; `-- MERGE` lines where two old rows fold onto one candidate row
(an `AFLDB-ISSUE-136` identity merge); and a trailing verification query that must return zero
rows. Run it on the candidate at the transcript's **remap step 2c** (§7.2): after every direct
restore, before the staged tables are promoted, and **before** `--phase candidate`. A staged
column's `UPDATE` targets its `promotion_staging` copy (`AFLDB-ISSUE-151`); every other column's
targets `public`. It touches one column per statement and never inserts, deletes or truncates:
the ledgers stay append-only and every audit field is untouched.

**Where no remap is possible.** `player_link_resolutions.target_id` points into seven
import-writable honours tables whose ids the rebuild assigns, and the repository carries **no
external key for one of their rows**, so the contract declares its identity as `none` and the
gate refuses. Remapping `player_id` alone is *not* an answer: it produces a row that looks
resolved, names the right person and points at the wrong honours row. Two answers are
supportable, and the choice must be recorded in the promotion record and the
`database.promoted` marker:

1. reinstate it as a **historical audit ledger of the replaced database**, stating in the
   record that its links are not live; or
2. **do not reinstate it into the candidate at all** and keep it as a recorded gap — the
   `promotion_decisions` treatment, on the same reasoning: a decision cannot outlive the row it
   is about. The rows survive in the pre-cutover dump and in the kept pre-rebuild database
   either way.

**Never** drop the rows to make the gate pass, and never leave a lineage-bound column on its
old integer. One further case is normal rather than exceptional: a `data_edits` row about a
**current-season match** cannot resolve at candidate time, because the rebuild carries seasons
only to the accepted baseline and the season is re-acquired *after* the swap (§9). Where the
table is reinstated, apply that part of the remap after the post-promotion settle and say so
in the record; where it is withheld under §7.4d, that row is part of the same recorded gap and
there is nothing pending.

### 7.4d The historical-only / recorded-gap disposition (`AFLDB-ISSUE-143`)

§7.4c names two supportable answers and, until `AFLDB-ISSUE-143`, the checker and the plan
could execute **neither** — so a promotion that met a real lineage change could not pass
`--phase restored` at all, whichever answer the operator chose. Answer (2) is now executable,
and it is a **contract declaration, not a flag**.

`tools/db/promotion-inventory.ts` gives the table a `historicalOnly` entry naming the
environments it applies to, **every** lineage-bound column of that table, the deciding issue,
a one-line summary and the full reason. One declaration then drives four things at once, so
the gate, the plan and the comparison cannot disagree:

1. **the plan** omits the table's `pg_restore` line and prints an `INTENTIONALLY NOT
   REINSTATED` block naming the table, the withheld columns and the reason, before the restore
   lines it is missing from;
2. **the candidate is still truncated**, so it holds none of the rebuilt copy either, and
   `--phase candidate --compare` expects **0** rows rather than the snapshot's count;
3. **`--phase restored`** reports the column as `hist` instead of `FAIL`, prints the count, the
   per-id reasons and the decision, and generates **no** statement for it in
   `--lineage-remap-out`;
4. **the `database.promoted` marker** carries a `historical_only` array and one recorded-gap
   sentence per table, so the promoted database records what it was not given.

Everything the declaration does not name still refuses, exactly as before: another table,
another column of the *same* table, or the same table under an environment the declaration
does not list. There is no command-line override, no verdict-level relaxation and no way to
express this outside the tracked contract; `assertContractCoherent()` runs before the first
query and refuses a declaration that is partial (it must name every lineage-bound column of
its table), sits on a table that is not reinstated, names an unknown environment, has an empty
reason — or that the generated plan would still reinstate.

**What is *not* implemented, deliberately.** §7.4c answer (1) — reinstate the table as a
historical, not-live ledger — has **no** executable path and still refuses. It would mean
writing ids that denote different rows into the promoted database and trusting a note to say
so; the operator decisions this mechanism serves (`AFLDB-ISSUE-139` D1/D2) both chose answer
(2). If answer (1) is ever wanted it is a new decision, not a flag on this one.

**Nothing is deleted, ever.** The withheld rows are in the mandatory pre-cutover dump (§4) and
in the retained `<live>_pre_rebuild_<stamp>` database (§8), both of which are kept until the
promotion record is closed. Record in the promotion record which tables were withheld and why;
the acceptance checklist has a line for it.

**Declared today** (`--environment dev` only; production declares nothing and its behaviour is
byte-identical to before this issue):

| Table | Columns | Decision |
|---|---|---|
| `player_link_resolutions` | `player_id`, `target_id` | `AFLDB-ISSUE-139` D1. `target_id`'s seven honours tables carry no external key, so not one row can be evidenced; remapping `player_id` alone is explicitly not an answer (§7.4c). |
| `data_edits` | `row_id` | `AFLDB-ISSUE-139` D2. Every lineage-bound row is in the bootstrap id space: its `players` ids carry no external identity at all, and two of its matches were created and then deleted on `afldb_dev` itself. `AFLDB-ISSUE-160` D-3 adds a `draft_picks` target on the same column; the disposition is unchanged, because it withholds the column, not one kind. |

One consequence to state in the DEV promotion record: `player_link_match_candidates` is
regenerated from rebuilt players **plus reinstated resolutions** (§8), so with none reinstated
the admin link queue re-surfaces the previously-decided suggestions for a fresh decision
against the new lineage. That is the honest outcome of a lineage change, not a defect.

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
sudo -u postgres psql -d postgres -f ~/backups/afldb/promotion-$STAMP/promotion-swap.sql
sudo systemctl start afldb
npm run db:promotion:check -- --phase production --database afldb_prod \
    --compare ~/backups/afldb/promotion-$STAMP.json \
    --expect-super-admin <the real production super admin's email>
```

The kept database is named `afldb_prod_pre_rebuild_<stamp>` on purpose: `tools/db/rebuild-test.ts`
refuses to touch any `pre_rebuild` name, and the checker accepts it as `--old-database`. **Quote every
stamped name inside SQL**: the stamp's hyphen makes `afldb_prod_pre_rebuild_$STAMP` an invalid bare identifier, so an
unquoted `RENAME TO` refuses at parse time (met on the first DEV swap, `AFLDB-ISSUE-139` Phase 4E-3 — it failed safely
before any rename; the quoted form succeeded).

The plan now makes that rule executable rather than dependent on memory: `promotion-swap.sql`
and its exact `promotion-rollback.sql` reverse quote every database identifier through one
generator, with the hyphenated `afldb_*_pre_rebuild_20260906-112500` shape pinned by tests.

**Post-promotion state, in this order:**

1. **Replay human overrides.** The rebuild ran on `afldb_test`, which had no
   `data_overrides`; the reinstated rows are authority that has not yet been applied to the
   promoted canonical rows. Replay them with the importer's own function, as the import role.

   Replay **every** entity type the `data_overrides.entity_type` CHECK admits, in this
   order. The order is **binding**, not cosmetic, and for one reason in two places: a
   record that names its subject by IDENTITY cannot resolve until that identity exists.
   `players` before `draft_picks`, because a manual selection names its player by an AFL
   Tables path or a `manual_admin_edit` token; `coaches` before `match_coaches`, because
   an assignment resolves its coach by path; `players` before `season_list_members`, because
   a playing-list membership names its player by that same identity; `players` before
   `club_leadership`, because a leadership appointment names its player by it too. `matches` is
   independent and may go anywhere, and so is `fixtures`: a fixture names its clubs and its venue by
   **slug** — tracked reference data loaded long before any replay — and names no player, no
   match and no selection, so it depends on no other branch. `club_leadership` depends on
   `players` and on nothing else — in particular **not** on `season_list_members`, so the two
   have no ordering cycle:

   ```bash
   cd ~/projects/afldb && ./.venv/bin/python - <<'PY'
   import sys; sys.path.insert(0, 'tools/migration')
   from common import load_env, connect_pg, replay_admin_overrides
   load_env()
   with connect_pg() as pg:
       for table in ('players', 'matches', 'draft_picks', 'season_list_members',
                     'club_leadership', 'coaches', 'match_coaches', 'fixtures'):
           replay_admin_overrides(pg, table)
       pg.commit()
   PY
   ```

   `coaches` and `match_coaches` are `AFLDB-ISSUE-159` (migration 095); `players` and
   `draft_picks` gained the same shape in `AFLDB-ISSUE-160`; `season_list_members` is
   `AFLDB-ISSUE-161` (migration 096) and is the only branch that also acts on INACTIVE
   overrides — an inactive membership override is a **tombstone**, the decision that a
   player is deliberately not on a list, so the replay deletes any row it finds for that
   key before it re-creates the active ones. `fixtures` is `AFLDB-ISSUE-162` (migration
   097): every fixture override is ACTIVE and carries a whole row, because the lifecycle
   lives in the payload's `status` and a **cancelled** or **void** fixture must be
   re-created rather than suppressed — a fixture is never deleted precisely so its
   `data_edits` rows stay resolvable, and dropping the void rows here would break that. An
   unresolvable **club** slug stops the replay; an unresolvable **venue** slug degrades to
   the stored venue name and is reported, because venue is enrichment and a promotion must
   not be stopped by a venue rename. `club_leadership` is `AFLDB-ISSUE-163` (migration 098)
   and has the same whole-row, always-active shape: an **ended** or **void** appointment must
   be re-created rather than suppressed, for the same reason — an appointment is never deleted
   so its `data_edits` rows stay resolvable, and dropping the void rows here would break that.
   It deliberately does **not** re-check season-list membership: holding the list place is a
   precondition of *making* an appointment, not a property of a recorded one, so a list
   corrected after the fact must never erase valid leadership history. An unresolvable club
   slug, an identity that resolves to zero or to more than one player, an invalid role or
   status, an impossible interval or an active row carrying an end date all stop the replay.
   For `matches`, and for a
   source-owned player or selection, an override patches fields of a row the rebuild
   already produced. For a manual one it carries an **entire row**: an administrator can
   create a footballer and their draft selection before any source has published either,
   so the rebuilt source database has never heard of them, and this replay is the only
   thing that puts them back.

   Between the swap and this step a manual coach, a manual player and their manual
   selections do not exist in the promoted database at all — every `/coaches/<slug>-<id>`
   and `/players/<slug>-<id>` URL for one 404s, and the ids change across the window.
   Every administered playing list is likewise absent for that window; no public surface
   reads lists yet (`AFLDB-ISSUE-161` §10), so it is visible only in `/admin/season-lists`,
   which shows a season with no members rather than an error. Club leadership IS publicly
   visible (`AFLDB-ISSUE-163` §19): for that window a club page shows no current leadership
   block and its Captains history stops at the last pre-2027 season. After the replay,
   revalidate `/clubs/<slug>` for every current identity, or accept the page's own ISR window
   and state the choice in the promotion record. Run
   this step promptly, and run it **before** the `data_edits.row_id` remap: its
   `'coaches'` rows resolve through `coaches.afltables_coach_path`, its `'draft_picks'`
   rows through the selection's `<source key>|<player_url>|<draft_year>|<draft_kind>`, and
   its `'players'` rows through an AFL Tables profile path *or* a `manual_admin_edit`
   token — none of which a candidate carries until this replay has run.

   One case is worth knowing about because it looks like a bug and is not. When a manual
   player has since debuted and an administrator attached their AFL Tables profile
   (`/admin/draft`, `AFLDB-ISSUE-160` §6.5), the candidate ALREADY holds that footballer,
   created by the source under that path. The `players` replay then **binds** the manual
   token onto that existing row rather than inserting a second one — which is why a
   promotion after the debut produces one player, not twins.

   The function refuses rather than skipping: an override whose match key, club slug,
   coach path or player profile path does not resolve raises and rolls the replay back,
   with the offending `entity_key`s named. That is a real stop — resolve it, do not
   re-run past it.

   If it changed player or match rows, recompute the derived tables:
   `./.venv/bin/python tools/migration/rebuild_derived.py`. If it changed coach rows or
   assignments, the derived club/coach records recompute from `match_coaches` the same way.
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
sudo -u postgres psql -d postgres -f ~/backups/afldb/promotion-$STAMP/promotion-rollback.sql
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

A `promotion_staging` schema is never part of cleanup: it does not exist after a finished
promotion, and one that does exist is an interrupted attempt handled by §7.2 (inspect and record
first, then drop by hand), not something to tidy.

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
- `AFLDB-ISSUE-139` — converging `afldb_dev` through this procedure; the reason §13 exists.
- `AFLDB-ISSUE-141` — the migration-080 treatments and the `--environment` descriptor.

---

## 13. Promoting a DEV database (`--environment dev`)

**DEV is not production authority.** `afldb_dev` is the development database on
`streamanator`; nothing on it is a production record, no reader depends on it, and a bad
promotion there costs a rebuild rather than an incident. That is exactly why the relaxations
below exist *only* here, and why nothing in this section may be carried back to `prod`.

Everything else is identical, deliberately: the same contract, the same five phases, the same
truncate/reinstate plan, the same FK order, the same fail-closed classification. `dev` is one
more accepted **name shape** per phase, not a different procedure. §§0–12 apply as written,
with `afldb_dev` for `afldb_prod`, `afldb_dev_candidate_<stamp>` for the candidate,
`afldb_dev_pre_rebuild_<stamp>` for the database renamed aside, and `DEV: streamanator` on
every command line where §§3–10 say `PROD: afldb-prod`.

**What differs — and only these three things.** The first two are command-line flags; the
third is a tracked contract declaration with no flag at all.

| Gate | `--environment prod` | `--environment dev` |
|---|---|---|
| Test-fixture identities | Refusal in `pre-cutover`, `candidate`, `production`. No override exists. | **Still a refusal by default.** `--allow-fixture-identities` accepts them consciously: the scan still runs, the verdict becomes WARN instead of FAIL, and the ten-row sample cap is **lifted** so every offending address is printed. Never silent, never partial. |
| `--expect-super-admin` | Required in those phases: a database nobody can administer is not promoted. | Enforced exactly as on production **when the flag is given**. Omitted, the gate WARNs and says it is not enforced — optional, never silently dropped. |
| Lineage-unresolvable ledgers (§7.4d) | Nothing is declared, so an unresolved id refuses in every case — unchanged by `AFLDB-ISSUE-143`. | `player_link_resolutions` and `data_edits` are declared **historical-only** in the contract: not reinstated, still truncated, expected empty at `candidate`, and named in the audit marker. Any *other* table or column still refuses. |

`--allow-fixture-identities` is refused outright under `--environment prod`, including the
implicit `prod` of no `--environment` at all, and including modes that never consult it. A
reserved-domain address can never be a production identity, and no flag changes that.

**What is still real on DEV, and must not be lost.** A DEV promotion has no production human
authority to protect, but it is not stateless:

* the **captured Gridley corpus** (migration 080) — immutable evidence with no rebuild stage
  and no re-fetch, and the reason `AFLDB-ISSUE-141` exists (§1, §7.4b);
* admin and beta access state, `site_settings`, uploads and `data_overrides` — real operator
  choices, reinstated by the same contract;
* `data_edits` and `player_link_resolutions` — equally real, but **not reinstated on DEV**
  (§7.4d): they are bound to the bootstrap id lineage the promotion replaces, so they are kept
  as historical evidence in the pre-cutover dump and the retained
  `afldb_dev_pre_rebuild_<stamp>` rather than written into the candidate. Withheld is not
  discarded, and it is a recorded decision, not an omission;
* the current season, which is **re-acquired** by a settle run (§9), not copied.

**Before every DEV promotion**, take the same mandatory backup (§4) and the same
pre-cutover snapshot (§5). The relaxations above concern identity gates, not evidence: a DEV
database is still restored into a *new* candidate and swapped by rename, never restored over.

**Historical DEV reconciliation (completed 2026-09-06).** These were conditions of the first
`afldb_dev` promotion, not assumptions for a future run:

* The old bootstrap database did not share the rebuilt candidate's player or match ids. The
  completed promotion exercised §7.4c/§7.4d: `player_link_resolutions` and `data_edits` were
  withheld under the tracked DEV-only historical disposition, and every other lineage-bound
  column still required evidence. Current `afldb_dev` is the promoted rebuilt lineage; a future
  promotion must let the `restored` gate measure lineage again rather than assume either outcome.
* The replaced database's ledger carried the obsolete branch-only name
  `079_access_code_delete.sql`, while main owned `079_nl_search_log_head_to_head_grain.sql` and
  the reconciled access-code migration was pending as `091_access_code_delete.sql`. The truthful
  pre-cutover parity refusal was recorded, and the candidate swap removed the orphan ledger row.
  `091_access_code_delete.sql` is now on main (provenance commit `0378180`); the stale
  `claude/issue-116` refs were removed. Do not reserve or renumber either migration from this
  historical note, and never weaken parity checks to accommodate an obsolete ledger name.

```bash
# DEV: streamanator — the same five phases, with the environment stated every time
npm run db:promotion:check -- --environment dev --phase source      --database afldb_test
npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev \
    --snapshot ~/backups/afldb/promotion-dev-$STAMP.json
npm run db:promotion:check -- --environment dev --plan --database "$CAND" \
    --old-database afldb_dev --pre-cutover-dump <file> --rebuilt-dump <file> --plan-dir <dir>
npm run db:promotion:check -- --environment dev --phase restored    --database "$CAND" \
    --old-database afldb_dev --lineage-remap-out ~/backups/afldb/promotion-dev-lineage-$STAMP.sql
npm run db:promotion:check -- --environment dev --phase candidate   --database "$CAND" \
    --compare ~/backups/afldb/promotion-dev-$STAMP.json
npm run db:promotion:check -- --environment dev --phase production  --database afldb_dev \
    --compare ~/backups/afldb/promotion-dev-$STAMP.json
```

The generated plan names `DEV (streamanator)` as the host, carries `--environment dev` into its
own acceptance command, and writes `'environment', 'dev'` into the `database.promoted` audit
marker — so the audit trail records which environment was promoted, not merely that one was.
