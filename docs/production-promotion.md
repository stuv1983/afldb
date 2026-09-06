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
| `data_edits` | data editor | yes | reinstate (**dev: historical-only**) | Append-only audit of human canonical edits. `table_name` + `row_id` is a row id in `players`/`matches`, not a FK → **lineage-bound** (§7.4c). Withheld as a recorded gap on a DEV promotion (§7.4d). |
| `data_overrides` | data editor | yes | reinstate **+ replay** | Human overrides reloads replay; the rebuild never saw them (§8). |
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
| `external_grid_sources` | Grid Solver corpus | yes | reinstate (first of three) | Seeded by migration 080 itself: the truncate removes the candidate's seed so the dump's row keeps its id. `ingest_source_id` → rebuilt `sources` → probed (§7.4b). |
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
| `source` | `afldb_test` | `afldb_test` | identity, classification, migration parity, fixtures (info), optional `--expect-fingerprint` |
| `pre-cutover` | `afldb_prod` | `afldb_dev` | + fixtures must be absent, super admin present, `--snapshot <file>` of row counts |
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
    [--lineage-remap-out ~/backups/afldb/promotion-lineage-$STAMP.sql]
```

This proves the candidate is the source (migration parity), reports the fixture rows the
restore brought in (expected, removed next), **proves the id lineage** of every reinstated
id-keyed column (§7.4c — on a same-lineage promotion this passes and generates nothing), and
**probes dangling references**: for each
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

### 7.4b The captured grid corpus's NOT NULL references (`AFLDB-ISSUE-141`)

Two of the migration-080 references are **NOT NULL** into import-writable (rebuilt) tables, so
neither can take the §7.4 nullable path. The checker prints the contract's decision beside the
finding; both must be settled **before** the corpus's `pg_restore` line, and what was done
recorded in the promotion record.

* `external_grid_sources.ingest_source_id` → `sources`. `sources` is import-writable, so the
  candidate's id for key `gridley` need not equal the dumped one. Migration 080 seeds that
  `sources` row, so the candidate already has one: read it
  (`SELECT id FROM sources WHERE key = 'gridley'`) and restore the table with
  `ingest_source_id` set to it, or reinstate and then `UPDATE` the column. **Never insert a
  `sources` row for this.**
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
   migration 003). **A display name is never used, in either direction** — two footballers
   share a name often enough that a name match would silently retarget a human decision;
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
rows. Run it on the candidate **after** the reinstate and **before** `--phase candidate`. It
touches one column per statement and never inserts, deletes or truncates: the ledgers stay
append-only and every audit field is untouched.

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
| `data_edits` | `row_id` | `AFLDB-ISSUE-139` D2. Every lineage-bound row is in the bootstrap id space: its `players` ids carry no external identity at all, and two of its matches were created and then deleted on `afldb_dev` itself. |

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

**Before the first DEV promotion**, take the same mandatory backup (§4) and the same
pre-cutover snapshot (§5). The relaxations above concern identity gates, not evidence: a DEV
database is still restored into a *new* candidate and swapped by rename, never restored over.

**Two conditions specific to `afldb_dev` today.** Neither is a relaxation and neither has a
flag; both are stated here because a DEV operator meets them and a production operator does
not.

* **The id lineage really does change.** `afldb_dev` is the pre-rebuild bootstrap database, so
  a candidate restored from a rebuilt `afldb_test` does **not** share its player or match ids.
  §7.4c and §7.4d are therefore mandatory reading for a DEV promotion rather than a rare case:
  expect the `restored` phase to report a lineage change and to refuse until every
  lineage-bound column is either evidenced or covered by a declared historical-only
  disposition. As the contract stands, `player_link_resolutions` and `data_edits` are declared
  (§7.4d) and everything else must be evidenced. Production has never met this because its
  candidate is a rebuild of its own lineage.
* **Migration parity refuses at `pre-cutover`, truthfully.** `afldb_dev`'s ledger carries
  `079_access_code_delete.sql`, which is committed only on the unmerged branch
  `claude/issue-116` and which **cannot merge at that number** — `main` owns a different
  `079_nl_search_log_head_to_head_grain.sql`, applied everywhere including production. The
  gate reports `UNKNOWN 079_access_code_delete.sql`: the live database is ahead of every
  tracked checkout by a migration no checkout can reproduce, which is exactly what that gate
  exists to say. Do not delete the ledger row, do not reverse the migration and do not
  special-case the checker. The promotion **is** the reconciliation: the candidate is built
  from this checkout's migrations, so `restored`, `candidate` and `production` all read parity
  clean and the orphan row is gone at the swap. The `pre-cutover` phase still writes its
  snapshot, which is what the later phases compare against; record the refusal and its reason
  in the promotion record before continuing. (The branch must claim the next free migration
  number before it can ever merge — `091` as this checkout stands.)

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
