# AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent

**This file is the durable source of truth for ISSUE-090.** A fresh session must be able to
execute from `CLAUDE.md`, `WORKFLOW.md`, this file, `issues.md` and `IssuesIndex.md` alone.
Do not rely on chat history.

## Status / handoff (2026-08-25, current)

```
Planning:                  COMPLETE / APPROVED
Implementation:            IN PROGRESS
Step 0:                    PASS (2026-08-25, afldb_test)
Fixture cleanup fix:       APPLIED, VALIDATED GREEN (2026-08-25)
Python discovery fix:      APPLIED, VALIDATED GREEN (2026-08-25)
Pre-migration validation:  PASS (2026-08-25, afldb_test)
Migration 072:             APPLIED to afldb_test (2026-08-25) -- db:status: 72/72
                            applied, 0 pending
Post-migration validation: HALT (2026-08-25) -- dob-enrichment-issues.test.ts
                            now GREEN 23/23 (test 16 fixed, see below). But
                            release-gates.test.ts now shows 51 passed / 13
                            failed -- 2 NEW external_identities gates newly
                            red (were green pre-072). Diagnosed as a
                            pre-existing enrich_birth_dates.py population-
                            scoping defect (external_identities cleanup),
                            NOT caused by migration 072, first exercised by
                            dob-enrichment-issues.test.ts test 5 against
                            afldb_test. Not yet fixed. privileges.test.ts
                            NOT run. See "release-gates.test.ts -- unexpected
                            new failures, HALT" below for full evidence.
Production:                NOT TOUCHED
Parent release:            HALTED
D1-D5 design:              UNCHANGED
```

This is a fresh-session handoff point. A new session should execute from this
file, `CLAUDE.md`, `WORKFLOW.md`, `issues.md` and `IssuesIndex.md` alone —
do not rely on prior chat history.

### Implementation files currently changed

```
tools/migration/enrich_birth_dates_from_club_lists.py
tools/migration/enrich_birth_dates.py
src/db/migrations/072_dob_conflict_ownership.sql
tests/integration/dob-enrichment-issues.test.ts
tests/integration/draft-lock.ts
tests/integration/release-gates.test.ts
AFLDB-ISSUE-090.md
```

No other file has been touched. Nothing has been committed or staged.
No database mutation has occurred beyond the ongoing test-harness reads/
writes described below (all against `afldb_test`, all fixture-scoped except
where explicitly noted). Production untouched throughout.

**Recorded implementation-detail deviation (not a contract change):** §10
step 5 reads `INSERT ... ON CONFLICT (entity_type, entity_id, issue_type)
WHERE ... DO UPDATE # §11 index`. Both importers instead issue a **plain
`INSERT`** (no `ON CONFLICT`). Reason: `ON CONFLICT` against a partial
index target requires that index to already exist, but the approved
validation sequence runs the new test file's pre-migration subset *before*
migration 072 creates `uq_data_issues_open_dob_per_player` — an `ON
CONFLICT` insert would raise "no unique or exclusion constraint matching
the ON CONFLICT specification" on the very first pre-migration test.
Safety is unaffected: both reconciliation functions already `SELECT ...
FOR UPDATE` the owned population and decide INSERT-vs-UPDATE inside the
same transaction before writing, which is the mechanism §10's guarantees
table actually depends on; the migration's unique index remains a
structural backstop (§11) rather than the active write-path mechanism.
Not a HALT — no approved contract (§10 guarantees table, D1-D5, acceptance
criteria) is weakened.

Tests 15/16/17/17b/18 (migration-specific) are implemented by re-executing
verbatim slices of the real `072_dob_conflict_ownership.sql` file at test
time (sliced on its own section-banner comments via exact-string markers,
verified unique in the file), the same `tx.unsafe(fullSql)` pattern
`tools/db/migrate.ts:174` already uses to apply a migration — never a
re-implementation of its SQL. A future edit to 072 either keeps slicing
correct (content moves with its banner) or makes the slicer throw "marker
not found" at test-load time — it cannot silently execute stale/wrong SQL.

### Validation-harness corrections already made

1. Tests 15/16/17/17b/18 are migration-072-dependent: they assert
   normalise/merge/precondition/index behaviour that only means something
   once `uq_data_issues_open_dob_per_player` exists, and two of them
   (16, 17b) must temporarily manipulate that index around their own
   fixture rows to construct a duplicate-group scenario for testing.
2. They are now guarded by a read-only check of `afldb_meta.schema_migrations`
   (the same ledger `tools/db/migrate.ts` writes to), evaluated once at
   module load:
   ```ts
   const migration072Applied = await sql<{ applied: boolean }[]>`
     SELECT EXISTS (
       SELECT 1 FROM afldb_meta.schema_migrations
        WHERE name = '072_dob_conflict_ownership.sql'
     ) AS applied
   `.then((rows) => rows[0]?.applied ?? false);
   ```
   wrapping the whole block: `describe.skipIf(!migration072Applied)('migration 072', () => { ... })`.
3. Before migration 072 applies, that block is **skipped outright** — not
   run-and-expected-to-fail — so `withoutUniqueIndex()` (which does
   `DROP INDEX IF EXISTS` then, in `finally`, unconditional `CREATE UNIQUE
   INDEX IF NOT EXISTS`) is never invoked and cannot create/drop/recreate
   the unique index pre-migration. The original defect this fixed: a bare
   pre-migration run of the whole file would have let tests 16/17b create
   `uq_data_issues_open_dob_per_player` early as a side effect, which would
   then make migration 072's own (deliberately non-`IF NOT EXISTS`)
   `CREATE UNIQUE INDEX` fail "relation already exists" when actually
   applied — corrupting the approved sequence, not just failing a test.
4. After migration 072 applies, those tests run normally against the real
   migration state (the index already exists for real, so the
   drop/recreate dance in 16/17b operates on the genuine index as
   intended).
5. Test 22 is the real, global release-gate invariant — unresolved
   duplicate groups by `(issue_type, entity_type, entity_id)`, the exact
   query `release-gates.test.ts` → `gate: draft links` →
   *"does not stack duplicate issues when a pass is re-run"* uses, with no
   `WHERE entity_id = ...` fixture restriction. It remains deliberately
   global and unweakened — it must never be fixture-scoped, because that
   would hide the exact condition it exists to detect.
6. Test 22 is expected to remain red before migration 072, because
   `afldb_test` still contains the known duplicate `dob_conflict` rows for
   entity 4347 (rows 441/442/443, Step 0 evidence). It is therefore
   excluded from the pre-migration validation command only (not gated in
   code, since unlike 15-18 it never mutates schema) and must become green
   after migration 072 repairs that state.

### Environment discoveries during validation (harness/environment findings, not ISSUE-090 behavioural failures)

**Attempt 1** failed during module import with `ECONNREFUSED 127.0.0.1:5432`,
0 tests executed. Cause confirmed: the Windows-side PostgreSQL SSH
tunnel/listener was not running. The tunnel was subsequently started and
`127.0.0.1:5432` became reachable.

**Attempt 2** discovered the entire suite was skipped because
`describe.skipIf(!canRun)` (`canRun = hasPsycopg()`) found the Windows
system Python had no `psycopg` installed. A project-local Windows venv was
then created at `.venv/Scripts/python.exe` with Python 3.12 and psycopg
3.3.4. For validation, `AFLDB_PYTHON` was explicitly set to
`.venv/Scripts/python.exe`.

**Harness portability defect discovered (not yet repaired, next-session
task):** the python-resolution helper in
`tests/integration/dob-enrichment-issues.test.ts` (and the same pattern in
`tests/integration/draft-reload-links.test.ts`) auto-detects
`.venv/bin/python` (POSIX venv layout) but does not auto-detect the normal
Windows venv layout `.venv/Scripts/python.exe`.

Also recorded, not ISSUE-090 scope: sourcing the repository `.env` directly
in Git Bash produced a shell syntax error at the unquoted value
`AFLDB_EXTERNAL_API_USER_AGENT=AFLDB current-season refresh (contact:
data@afldb.com)` — but `AFLDB_TEST_DATABASE_URL` had already been exported
before that line and was available for the successful validation run. Do
not treat this as ISSUE-090 scope unless it directly blocks further
validation.

### First genuine pre-migration validation result (2026-08-25)

Exact command run:

```
npm test -- tests/integration/dob-enrichment-issues.test.ts -t "(tests 1/2:|test 3:|test 4:|test 5:|test 6:|test 7:|test 8:|test 9:|test 10:|test 11:|test 12:|test 13:|test 14:|test 15:|test 16:|test 17:|test 17b:|test 18:|test 19:|test 20:|test 21:|test 23:)"
```

Result: 23 tests discovered, 7 passed, 10 failed, 6 skipped, ~41.7s. Migration
tests 15/16/17/17b/18 were correctly skipped. Test 22 was correctly not
selected.

**The common failure affecting tests 5, 10-14 and 19-21 was the shared
`afterEach` cleanup hook, not a demonstrated behavioural assertion
failure:**

```
PostgresError: update or delete on table "players" violates foreign key
constraint "external_identities_player_id_fkey" on table
"external_identities"
```

raised from the `afterEach`'s `DELETE FROM players WHERE id = ANY(...)`.
Test 23 then failed independently because the failed cleanup left **9
stale `Issue090Fixture` players** where 0 were expected.

**Recorded explicitly:**

- The first genuine execution exposed a **fixture-cleanup defect** in
  `afterEach`, not incorrect D1/D5/importer behaviour.
- Tests affected by the failed `afterEach` (5, 10-14, 19-21) are **not yet
  evidence** of correct or incorrect behaviour — their status remains
  **unproven** until cleanup is repaired and the subset reruns clean.
- The 7 tests that passed (1/2, 3, 6, 7, 8, 9, and one other — see the raw
  run output for the exact list) are the only ones genuinely demonstrated
  so far.
- The **9 stale fixture players are intentionally left untouched** for now,
  so the repaired cleanup can be proven against them — i.e. the next
  session's cleanup fix must itself recover from this exact prior-failure
  state, not just work on a clean database.
- **Migration 072 must NOT be applied yet** — the pre-migration subset is
  not yet green.

### Fixture-cleanup and Python-discovery repair (2026-08-25)

**Schema inspection result — only one child table needed explicit cleanup,
confirmed by direct inspection of every migration declaring a foreign key
onto `players(id)` (`grep 'REFERENCES players\s*\(' src/db/migrations`),
cross-referenced against every table the two importers and the test
fixture actually write to:**

| Table | Written by | `player_id` FK behaviour | Needs explicit delete? |
|---|---|---|---|
| `player_clubs` | `createFixturePlayer` (test fixture) | `ON DELETE CASCADE` (`007_derived_stats.sql:129`) | No |
| `player_birth_evidence` | both importers (`enrich_birth_dates.py:488`, `..._from_club_lists.py:589`) | `ON DELETE CASCADE` (`018_player_birth_evidence.sql:29`) | No |
| `external_identities` | register pass only (`enrich_birth_dates.py:520-538`) | plain `REFERENCES players(id)`, no cascade (`002_core_entities.sql:184`) — deliberate, per the table comment: a stored third-party match must survive an unrelated player deletion | **Yes — this was the whole defect** |
| `data_issues` | both importers | no FK at all onto `players.id` (confirmed §3.4) | Deleted anyway, for cleanliness, not FK necessity |

No other FK onto `players(id)` is reachable from ISSUE-090 fixture or
importer activity (`player_achievements`, `draft_*`, `player_link_review`,
etc. are written by unrelated subsystems the fixtures never touch).
`external_identities` was correctly identified as the cause on the first
failure; inspection did not find a second undiscovered dependency.

**Fix — `tests/integration/dob-enrichment-issues.test.ts`:**

1. Added `cleanupIssue090Fixtures()` (module scope, beside
   `unresolvedDobConflict`): looks up fixture player ids by the
   `Issue090Fixture` display-name marker, then deletes in FK-safe order —
   `external_identities` (by `player_id`) → `data_issues` (by
   `entity_id`) → `players`. No-op when no fixture rows remain, so it is
   safe to call repeatedly.
2. `afterEach` now just calls `cleanupIssue090Fixtures()` — same per-test
   cleanup as before, now FK-safe.
3. `beforeAll` calls `cleanupIssue090Fixtures()` once, **before** the
   `issueSnapshot`/`playerSnapshot` blast-radius snapshot is taken. This
   is what recovers the 9 stale fixtures left by the interrupted prior
   run: the very next validation run's `beforeAll` deletes them (via the
   same FK-safe path) before anything else happens, with no manual SQL.
4. **Deliberately not added as a `beforeEach` on every test.** The
   next-session task as framed asked for recovery in "beforeEach/afterEach
   as appropriate". A recovery pass immediately before every test —
   including immediately before test 23 — would let a future silent
   cleanup gap be masked right before the one test whose entire purpose is
   to detect exactly that gap, which is the "do not weaken test 23"
   constraint this file already carries. `beforeAll` performs the same
   recovery exactly once, before any test body runs, which satisfies "a
   prior interrupted run cannot poison the next run" without sitting
   between test 22 and test 23. Recorded here as a deliberate interpretation
   of an ambiguous instruction, not a silent deviation.
5. Test 23 (`tests/integration/dob-enrichment-issues.test.ts:929-934`) is
   **unchanged** — still asserts a bare `count(*) = 0` with no cleanup call
   of its own in between.

**Fix — Windows Python discovery (`tests/integration/dob-enrichment-issues.test.ts:36-42`):**

`venvPython` is now platform-branched: `.venv/Scripts/python.exe` on
`win32`, `.venv/bin/python` otherwise. Priority order is unchanged and now
correct on both platforms: `AFLDB_PYTHON` override → platform-appropriate
project `.venv` interpreter if present → system `python`/`python3`.

**`tests/integration/draft-reload-links.test.ts` carries the identical
`.venv/bin/python`-only pattern (confirmed, line 60) and was deliberately
left untouched.** It is listed in this runbook's §20.1 as a file already
carrying unrelated, in-progress release work, and CLAUDE.md/§20 direct
narrow edits only to files ISSUE-090 actually owns. Fixing it is a
one-line, low-risk change if a future session wants it, but doing it here
would be an unrequested edit to a file outside this issue's ownership.

**Genuine-versus-broken-cleanup determination:** none of tests 5, 10-14,
19-21 represented a real behavioural failure. Each failed only because the
shared `afterEach` threw before its assertions could be considered
proven — the test bodies themselves never ran to a failing `expect()`. All
nine remain **unproven** (not "passing", not "failing on behaviour") until
this fix is validated end-to-end. This matches what was already recorded
above; nothing new contradicts it.

### Corrected pre-migration validation result — GREEN (2026-08-25)

Exact command run:

```
npm test -- tests/integration/dob-enrichment-issues.test.ts -t "(tests 1/2:|test 3:|test 4:|test 5:|test 6:|test 7:|test 8:|test 9:|test 10:|test 11:|test 12:|test 13:|test 14:|test 15:|test 16:|test 17:|test 17b:|test 18:|test 19:|test 20:|test 21:|test 23:)"
```

Exact result:

```
Test Files: 1 passed
Tests:      17 passed | 6 skipped (23)
Failures:   0
Duration:   42.68s
```

**Pre-migration validation status: PASS.**

Recorded observations from this run:

- Tests 1/2-14 passed — club-list reconciliation (§7), cross-pass isolation
  (test 5, 14), and D1 suppression/refiling semantics (tests 10-13) are now
  genuinely green, proven against the real importers with no optional skip.
- Tests 19-21 passed — the D5 `dob_disputed` recompute contract (§13) is
  genuinely green.
- **Test 23 passed with zero fixture residue**, which is direct proof the
  repaired `cleanupIssue090Fixtures()` (called from `beforeAll`, before the
  snapshot) successfully recovered the **9 stale `Issue090Fixture` players**
  left by the prior failed run, in addition to normal per-test cleanup via
  `afterEach` — no manual SQL cleanup was ever performed against
  `afldb_test`.
- Migration-specific tests 15/16/17/17b/18 were correctly skipped —
  migration 072 remains unapplied, so the `describe.skipIf(!migration072Applied)`
  gate held as designed.
- Test 22 was correctly not selected (excluded from this `-t` filter, as
  before) — it is expected to stay red until migration 072 repairs the
  known global duplicate at entity `4347`.
- **No behavioural ISSUE-090 failure remains in the pre-migration subset.**
  Every test that failed in the earlier run failed only because of the
  `afterEach` cleanup defect (now fixed), not because of D1-D5 or importer
  behaviour; this run proves that conclusively rather than merely asserting
  it.

### Migration-command correction (2026-08-25)

**§23 step 3 as written (`npm run db:migrate`) does not target `afldb_test`.**
Direct inspection of `tools/db/migrate.ts:64-72` and `package.json:12-14`
confirms `npm run db:migrate` resolves `AFLDB_MIGRATE_TARGET` from the
environment, **defaulting to `'dev'`** (`AFLDB_OWNER_DATABASE_URL`,
i.e. `afldb_dev`) when unset. The correct repository-approved path to
`afldb_test` is either `npm run db:migrate:test`
(`package.json:14` → `AFLDB_MIGRATE_TARGET=test tsx tools/db/migrate.ts`)
or `AFLDB_MIGRATE_TARGET=test npm run db:migrate`. The equivalent
read-only check is `AFLDB_MIGRATE_TARGET=test npm run db:status`
(`--status`, no mutation, `migrate.ts:155-161`).

This is a command-safety correction only — no change to §12 migration SQL,
§21-23 sequence intent, or any approved design decision. Recorded per the
"Workflow rule for future sessions" (unexpected evidence). Every command
given to the user from this point targets `afldb_test` explicitly via
`AFLDB_MIGRATE_TARGET=test`, never bare `npm run db:migrate`.

Also confirmed by direct inspection: `.env.example:65` binds
`AFLDB_BACKUP_DATABASE_URL` to the `afldb_backup` role against `afldb_dev`
by default; there is no dedicated backup-role DSN for `afldb_test`.
`tools/maintenance/backup.sh` reads only `AFLDB_BACKUP_DATABASE_URL` (no
DSN override flag), so it is not directly usable against `afldb_test`
without reconfiguring that variable. §26 only requires "a dump", not use
of `backup.sh` specifically, so the pre-072 dump uses `pg_dump` directly
against `AFLDB_TEST_DATABASE_URL`.

### HALT — historical migration checksum drift discovered (2026-08-25)

**Migration-072 application phase is HALTED.** This is a newly discovered
blocker, additional to and independent of the command-safety correction
above. Not caused by anything this session changed — no file listed below
was touched by this session (see "Implementation files currently changed"
above and "Working-tree state at handoff", §20.1; none of the six overlap).

**Exact command run (read-only status check, targeting `afldb_test`):**

```
AFLDB_MIGRATE_TARGET=test npm run db:status
```

**Exact output:**

```
AFLDB migrations -> test (afldb_owner@127.0.0.1:5432/afldb_test)
72 migration file(s), 71 already applied

ERROR: these applied migrations have been modified since they ran:
- 026_aflw_read_model.sql
- 053_player_achievements.sql
- 058_data_edits_editor_entities.sql
- 059_honour_team_member_identity.sql
- 060_wikipedia_22_under_22_source.sql
- 061_award_winner_sort_order.sql

Add a new migration instead of editing an applied one.
```

**Confirmed facts from this evidence:**

1. The command targeted `afldb_test` as `afldb_owner@127.0.0.1:5432/afldb_test`
   — correct target, confirming the §-above command correction is sound.
2. 72 migration files on disk, 71 recorded as applied in
   `afldb_meta.schema_migrations` on `afldb_test` (072 itself is the 72nd
   file and is not yet applied — consistent with "CREATED, NOT APPLIED").
3. Six **already-applied** migrations — 026, 053, 058, 059, 060, 061 — now
   hash (`tools/db/migrate.ts:113-116`, SHA-256 of the raw file content read
   via `readFileSync(..., 'utf8')`) to a value different from the checksum
   stored in `afldb_meta.schema_migrations` at the time each was applied.
   `migrate.ts:142-151` refuses to run **any** pending migration (including
   072) while such drift exists, regardless of whether the drifted files
   are otherwise unrelated to 072.
4. Migration 072 status is unchanged: **CREATED, NOT APPLIED.**
5. Pre-migration ISSUE-090 behavioural validation status is unchanged:
   **PASS** (2026-08-25, afldb_test) — this checksum drift was not present
   in, and does not retroactively affect, that result; it was only surfaced
   now because `db:status`/`db:migrate` are the first commands run against
   `afldb_test`'s full migration ledger this session.
6. Production remains **NOT TOUCHED.**
7. Parent release remains **HALTED.**
8. Migration-072 application is now blocked by two independent conditions:
   (a) the command-safety correction above, and (b) this checksum drift.
   Both must be resolved/understood before §23 step 3 can proceed. Neither
   has been bypassed, weakened, or worked around.

**Checksum mechanism, as confirmed by direct inspection (no file
modified):** `migrate.ts:113-116` computes `sha256(readFileSync(path,
'utf8'))` fresh from disk on every run, for every `.sql` file in
`src/db/migrations/`, and compares it against the `checksum` column
recorded in `afldb_meta.schema_migrations` at apply time
(`migrate.ts:133-136,176-178`). The comparison is byte-for-byte over
`utf8`-decoded content — it cannot distinguish a semantic SQL edit from a
line-ending change (CRLF vs LF), a trailing-whitespace change, a BOM, or
any other non-semantic byte difference. This is relevant because the
working environment is Windows (`CLAUDE.md` §11) and the six migrations
were presumably applied to `afldb_test` from a different checkout/session;
it does not by itself indicate which of hypotheses A/B/C/D (per the
instruction below) is correct.

**Not yet established, deliberately:** which of (A) uncommitted
working-tree edits, (B) committed changes made after these migrations were
applied to `afldb_test`, (C) a `schema_migrations` ledger/checksum
inconsistency, or (D) another deterministic explanation (e.g. a
line-ending/encoding difference introduced by checkout) is the actual
cause. No hypothesis is assumed. No SQL, dump, migration, checksum bypass,
or edit to any of the six files has been performed or proposed.

### Checksum diagnosis — hypothesis A ruled out, CRLF/LF isolated (2026-08-25)

**User-operated read-only evidence:**

1. `git status --porcelain` scoped to all six flagged files printed
   nothing. **Hypothesis A (ordinary uncommitted Git-visible edit) is
   ruled out** for all six.
2. Raw worktree SHA-256 (Windows checkout, CRLF) differed from the HEAD
   blob SHA-256 for every one of the six files.
3. After stripping CR bytes from the worktree content, SHA-256 matched
   the HEAD blob exactly for all six:

   | File | HEAD / worktree-LF SHA-256 |
   |---|---|
   | `026_aflw_read_model.sql` | `434b3f97b299cbdd7148169bc1582568620bc7c2868178066a6a5ea860c9b964` |
   | `053_player_achievements.sql` | `fcf7e15fdc67803c10dcf525583ae642f74fe285b49282ca8a9a2692b69ecd38` |
   | `058_data_edits_editor_entities.sql` | `66d8f6f01c96b0d3f8654256f8ebf46bca6fddd1ea9ee0ffbe7a42a876c6da09` |
   | `059_honour_team_member_identity.sql` | `041b6e6a8726c5eeb9e22f75f78ba6cb15fbd3855fa334197309d213b3f0f9b5` |
   | `060_wikipedia_22_under_22_source.sql` | `dcc7cd29a565ca15f118d47328536e751af73aff685fe58008b62eab47521339` |
   | `061_award_winner_sort_order.sql` | `e76db3161fe57757700f01502e6d079049153bfbaa59f2c989c32e39b398a657` |

   (Lengths as reported; not independently recomputed by this session —
   recorded as given.)

**Established:** for these six files, the worktree-vs-HEAD difference
that would otherwise feed `migrate.ts`'s checksum is entirely CRLF/LF
normalization, not a semantic content edit and not an uncommitted change.

**Explicitly NOT yet established:** whether `afldb_test`'s stored
`afldb_meta.schema_migrations.checksum` for each of the six equals the
HEAD/LF hash above. That is the next fact required before root cause
(B/C/D) can be distinguished — see the pending read-only query below.

**Checksum column schema, confirmed by inspection only (no file
modified), needed to write that query:**
`afldb_meta.schema_migrations (name text PRIMARY KEY, checksum text NOT
NULL, applied_at timestamptz NOT NULL DEFAULT now(), duration_ms integer
NOT NULL)` — `tools/db/migrate.ts:125-130`. `name` is the migration
filename (e.g. `026_aflw_read_model.sql`), matching the `name` values
`db:status` already printed. No further inspection of `migrate.ts` was
required beyond what was already read for the command-safety correction
above.

No SQL, dump, migration, checksum bypass, or edit to any of the six files
has been performed or proposed. No implementation change made.

### Checksum diagnosis — CONCLUSIVE, tracked as AFLDB-ISSUE-091 (2026-08-25)

**Read-only `afldb_test` ledger query result** (`afldb_meta.schema_migrations.checksum`
for the six flagged migrations):

```
026_aflw_read_model.sql              434b3f97b299cbdd7148169bc1582568620bc7c2868178066a6a5ea860c9b964
053_player_achievements.sql          fcf7e15fdc67803c10dcf525583ae642f74fe285b49282ca8a9a2692b69ecd38
058_data_edits_editor_entities.sql   66d8f6f01c96b0d3f8654256f8ebf46bca6fddd1ea9ee0ffbe7a42a876c6da09
059_honour_team_member_identity.sql  041b6e6a8726c5eeb9e22f75f78ba6cb15fbd3855fa334197309d213b3f0f9b5
060_wikipedia_22_under_22_source.sql dcc7cd29a565ca15f118d47328536e751af73aff685fe58008b62eab47521339
061_award_winner_sort_order.sql      e76db3161fe57757700f01502e6d079049153bfbaa59f2c989c32e39b398a657
```

Each exactly equals the corresponding HEAD/worktree-LF hash already recorded above.
Diagnosis is now conclusive:

- **A (uncommitted edit):** ruled out — `git status --porcelain` was clean for all six.
- **B (committed content changed after `afldb_test` application):** ruled out for all
  six — the stored ledger checksum equals HEAD, not some other historical content.
- **C (stale/incorrect ledger checksum):** ruled out for all six — the ledger checksum is
  exactly the LF-normalized hash of the current, unmodified, committed content.
- **D — CONFIRMED:** `tools/db/migrate.ts:113-116` hashes raw checked-out bytes with no
  line-ending normalization. These six migrations were originally applied to `afldb_test`
  from LF bytes; this Windows checkout materializes the same committed content as CRLF,
  producing a different, non-representative checksum. `db:status`/`db:migrate` therefore
  false-positive "modified since they ran" against **unchanged** migration content, and
  refuse to apply any pending migration (including 072) while that drift is reported.

**This is not an AFLDB-ISSUE-090 implementation defect.** It is a repeatable tooling
problem in the migration-checksum mechanism itself, independent of the DOB-conflict
domain, tracked separately as **`AFLDB-ISSUE-091`** (added to `issues.md` and
`IssuesIndex.md` this session, Open, not yet implemented). `AFLDB-ISSUE-090`'s migration
072 application is **blocked** on `AFLDB-ISSUE-091` until that tooling defect is resolved
without rewriting the six historical migrations or their `schema_migrations` checksums.

No migration, ledger, or checksum-validation change has been made. No historical
migration file has been edited. Migration 072 remains **CREATED, NOT APPLIED**.

### Next-session task

0. **Blocked** on `AFLDB-ISSUE-091` (migration-checksum tooling defect —
   confirmed cross-platform false-positive drift, not a real edit). Do not
   attempt migration 072 application until 091 is resolved or a session
   explicitly decides a different, non-workaround path forward.
1. Once unblocked: apply migration 072 to `afldb_test` using the
   repository-approved migration path (`AFLDB_MIGRATE_TARGET=test npm run
   db:migrate`, i.e. `npm run db:migrate:test`; take a dump first, per
   §26).
2. Run the post-migration ISSUE-090 validation sequence: rerun
   `tests/integration/dob-enrichment-issues.test.ts` including migration
   tests 15-18 and the real, unfiltered, global test 22 (§23 steps 4-5).
3. Run `tests/integration/privileges.test.ts` (§23 step 6).
4. Do not alter D1-D5, importer behaviour, migration 072 SQL, release-gate
   expected values, or test 22, unless new concrete evidence independently
   requires it.
5. This session did **not** apply migration 072 and made **no**
   implementation, test, importer, migration, ledger or expected-value
   edits beyond this runbook update — the working tree is exactly as the
   prior handoff left it, now with a validated-green pre-migration result
   recorded.

### Migration 072 applied — post-migration validation HALT (2026-08-25)

`AFLDB-ISSUE-091` was confirmed resolved and migration 072 was applied to
`afldb_test` per the approved sequence (§23 steps 3-4, dump-before-apply per
§26). Result: `db:status` — 72/72 applied, 0 pending. Production **NOT
TOUCHED**.

**Post-migration validation command run:**

```
npm test -- tests/integration/dob-enrichment-issues.test.ts
```

**Exact result:**

```
Test Files: 1 failed
Tests:      22 passed | 1 failed (23)
```

**Sole failure — `migration 072` → `test 16: merges duplicate unresolved
dob_conflict groups losslessly`:**

```
expect(rows[0].id).toBe(Math.min(row1.id, row2.id));
Expected: 520
Received: "520"
```

at `tests/integration/dob-enrichment-issues.test.ts:735`.

Every other test passed, including migration tests 15, 17, 17b, 18, the D1
suppression tests, D5 recomputation (19-21), the real global release-gate
invariant (test 22, now green against the real migrated data), and the
zero-residue fixture check (test 23).

Per §22/instruction: **HALT.** Did not proceed to `release-gates.test.ts` or
`privileges.test.ts` pending diagnosis.

**Diagnosis (read-only inspection, no mutation):**

1. `data_issues.id` is `bigint … GENERATED ALWAYS AS IDENTITY`
   (`src/db/migrations/001_foundations.sql:92`).
2. `src/db/client.ts` registers no custom `postgres.js` type parser for
   `int8`/bigint, and neither does the test file's own `postgres(...)`
   client — `postgres.js`'s documented default therefore applies: bigint
   columns are returned as JavaScript **strings**, not numbers, to avoid
   silent precision loss past `Number.MAX_SAFE_INTEGER`
   ([[postgres-js-int8-is-string]] memory, reconfirmed here).
3. `tests/integration/dob-enrichment-issues.test.ts:227` declares
   `type IssueRow = { id: number; ... }`, and the `row1`/`row2` inserts at
   `:718`/`:724` are separately typed `{ id: number }` — both are
   **compile-time-only** annotations; at runtime every one of `rows[0].id`,
   `row1.id`, `row2.id` is actually a `string` (e.g. `"520"`).
4. This mismatch is harmless everywhere else in the file (`expect(second[0].id).toBe(first[0].id)`
   at `:390`, and every other `.id` equality/usage) because both sides are
   always the same runtime type (string) and are never passed through a
   numeric operator. Test 16 alone applies `Math.min(row1.id, row2.id)`:
   `Math.min` coerces its string arguments to numbers per the JS spec,
   returning the **number** `520`, which is then compared via `toBe`
   (strict `===`, no coercion) against `rows[0].id`, the **string**
   `"520"`. `520 === "520"` is `false` — exactly the observed failure.
5. **Not a migration semantic defect.** The migration's own survivor
   selection (`min(id) AS survivor_id`, executed in PostgreSQL —
   `072_dob_conflict_ownership.sql:326-361`) is untouched by this and
   correctly preserved the lower-id row; the assertion trying to *verify*
   that fact was comparing two different JS runtime types. Confirmed
   purely a test-harness type/assertion defect.
6. **Repository convention, confirmed by inspection:** existing tests treat
   returned ids as opaque strings for comparison via `String(...)` —
   `tests/integration/awards-reload-links.test.ts:281,316,364`,
   `tests/integration/draft-reload-links.test.ts:435`,
   `tests/integration/grid-solver.test.ts:243`. No existing test performs
   arithmetic on a returned bigint id; test 16 is the first to do so.

**Fix applied — narrowest correction, `tests/integration/dob-enrichment-issues.test.ts:735` only:**

```ts
expect(rows[0].id).toBe(BigInt(row1.id) < BigInt(row2.id) ? row1.id : row2.id);
```

Replaces `Math.min(row1.id, row2.id)`. `BigInt(...)` is used only to decide
*which* original string is smaller — losslessly and without the
`Number.MAX_SAFE_INTEGER` risk `Math.min` carries for a `bigint` column —
and the expression's value is always the original string (`row1.id` or
`row2.id`), never a derived number, so the comparison against `rows[0].id`
(also a string) is a same-type `toBe`. The assertion still proves the exact
same thing it always intended to: the migration's survivor is the
lower-`id` (oldest-detected) row. No other line in test 16 changed; the
subsequent `disputed_by.club_list` lossless-merge assertions
(`:736-739`) are untouched. `IssueRow`'s `id: number` type annotation and
every other `{ id: number }` row-shape annotation in the file were
deliberately left as-is (they match this file's existing, harmless
convention everywhere else) rather than performing an unrelated type sweep.

**No migration, importer, or non-test file was touched.**
`src/db/migrations/072_dob_conflict_ownership.sql` is unedited (also
structurally guaranteed: `migrate.ts` refuses to run an edited applied
migration by checksum).

**Schema-safety check on the failed run (read-only inspection, not
re-executed):** `withoutUniqueIndex()` (`:94-105`) wraps `fn()` in
`try { await fn() } finally { CREATE UNIQUE INDEX IF NOT EXISTS ... }`. Test
16's assertion failure is a rejected promise thrown *inside* `fn()`; a
`finally` block runs regardless of whether the `try` body threw, so the
unique index was unconditionally recreated (`IF NOT EXISTS`, a no-op if it
was never dropped by another path) before the failure propagated. Test 23
(zero fixture residue) passing in the same run is corroborating evidence.
No schema was left altered by the failed test.

**Next action:** rerun `npm test -- tests/integration/dob-enrichment-issues.test.ts`
in full. Expect 23/23 passed, 0 failed. Only then proceed to
`release-gates.test.ts` and `privileges.test.ts` (§23 steps 5-6), per HALT
instruction — not yet run this session.

### dob-enrichment-issues.test.ts post-migration rerun — GREEN (2026-08-25)

```
npm test -- tests/integration/dob-enrichment-issues.test.ts
```

```
Test Files: 1 passed
Tests:      23 passed | 0 failed (23)
```

Confirms the `Math.min`/bigint-string fix above. Migration 072 remains
**APPLIED**; `db:status` — 72/72 applied, 0 pending. Production **NOT
TOUCHED**.

### release-gates.test.ts — unexpected new failures, HALT (2026-08-25)

```
npm test -- tests/integration/release-gates.test.ts
```

```
Test Files: 1 failed
Tests:      51 passed | 13 failed (64)
```

Comparison with the pre-090 baseline (§2.1, 52 passed / 12 failed: 2 draft
snapshot, 3 attendance snapshot, 5 birth-date snapshot/count, 1 global
duplicate-`data_issues`, 1 2026-snapshot-date):

- the intended duplicate-issue gate (`gate: draft links` → *"does not stack
  duplicate issues when a pass is re-run"*) is now **GREEN** — the one
  change ISSUE-090 set out to make;
- the other 11 pre-existing snapshot/data-drift failures are unchanged and
  are not ISSUE-090's to fix (parent-release scope);
- **two additional `gate: birth dates` failures are newly red that were
  green before migration 072**:
  1. *"matches players on the profile URL rather than the name"* —
     `external_identities` `match_method = 'afltables_profile_url' AND status = 'unique'`:
     expected 12,472, received 0.
  2. *"stores the profile URL it matched on, not a legacy row id"` —
     `external_identities WHERE match_method = 'afltables_profile_url'`:
     expected total > 0, received 0.
- net: 12 - 1 (duplicate gate fixed) + 2 (new) = 13, matching the observed
  result exactly.

**HALT declared. `privileges.test.ts` NOT run. Production NOT TOUCHED.
Parent release remains HALTED.**

**Root-cause inspection (read-only, no mutation) — see full diagnosis
recorded in this session's report; summary:**

Both newly-red gates query `external_identities`, a table **migration 072
never touches** (confirmed: no `player_birth_evidence`/`external_identities`
reference anywhere in `072_dob_conflict_ownership.sql` beyond a non-goals
comment). The actual cause is `tools/migration/enrich_birth_dates.py:515-525`
— pre-existing code, **not modified by ISSUE-090** (ISSUE-090 only touched
`:407-412`/`:414-446`, a disjoint range) — which deletes every
`external_identities` row with `match_method = 'afltables_profile_url'`
whose `external_id` is not in the current run's asserted set, on the
(production-correct) assumption that its caller always supplies the
**complete** register population. `tests/integration/dob-enrichment-issues.test.ts`
test 5 ("Seed disputed_by.club_list, run real register pass") invokes this
exact code path for real (`runRegister()` at `:216-224`, no `--dry-run`)
against `afldb_test` with a **tiny synthetic fixture SQLite register**
(one or two rows). The DELETE's population predicate treats every real,
non-fixture profile-URL row as stale and removes it — this is what emptied
the 12,472-row population the gate expects. This is the **first** time
`dob-enrichment-issues.test.ts` (a new file, §14) has ever run test 5
against `afldb_test`; the file's blast-radius snapshot/restore
(`beforeAll`/`afterAll`) covers only `data_issues` and specific `players`
columns and was never designed to cover `external_identities`, so nothing
restored it. **Not a migration 072 defect. Not an ISSUE-090 design defect
per se — a real, pre-existing, previously-latent population-scoping defect
in `enrich_birth_dates.py`'s external-identity cleanup, first exercised by
ISSUE-090's own new regression suite.** Full evidence and the exact
diagnostic read-only query are in this session's report; not yet acted on.
No repository file was mutated during this diagnosis. No backup was
restored. No migration was edited or rerun.

### external_identities confirmed EMPTY — blast radius larger than expected, HALT remains (2026-08-25)

**Read-only diagnostic query result** (`afldb_test`):

```sql
SELECT match_method, status, count(*) AS n
  FROM external_identities
 GROUP BY match_method, status
 ORDER BY match_method, status;
```

Result: **0 rows returned.** `afldb_test.external_identities` is currently
**completely empty** — not merely missing `afltables_profile_url` rows as
the release-gate failures alone would suggest.

**Important timeline correction, recorded before further action:**

- The ISSUE-090 integration-test runs that invoke the real register
  importer (test 5, `runRegister()` with a tiny synthetic fixture SQLite —
  see the diagnosis in the section above) ran during pre-migration
  validation in an **earlier session**, before this session began.
- This session's verified pre-072 dump of `afldb_test` was created at
  **2026-08-25 19:45**, i.e. chronologically **after** that pre-migration
  validation work.
- Therefore the pre-072 dump **cannot be assumed** to contain the original
  (pre-loss) `external_identities` population. It may already reflect the
  emptied state. **This dump must not be used for recovery without first
  proving what it actually contains.**

**HALT remains in effect.** No mutation of `afldb_test` performed. No
backup restored. No importer rerun. `privileges.test.ts` and further
release-gate runs not executed. Production not touched. Full inspection
(scope of `external_identities`, all normal writers, exact causal DELETE,
timeline reasoning, ranked recovery options, and defect classification) is
recorded in this session's report; nothing has been acted on yet.

### Step 0 result (2026-08-25, afldb_test)

**Initial failed attempt (no query or mutation occurred):** `AFLDB_TEST_DATABASE_URL` was
initially not loaded in the Linux shell, so `psql` fell back to the local Unix socket and
failed with `FATAL: role "arm" does not exist`. `.env` was then loaded and the guarded
read-only Step 0 query succeeded.

**Successful result:**

```
 issue_type   | unresolved | v2 | legacy_register | legacy_club_list | dates_type | rows | entities
--------------+------------+----+-----------------+------------------+------------+------+----------
 dob_conflict | t          | f  | f                | t                |            | 3    | 1
 dob_conflict | t          | f  | t                | f                |            | 2    | 2
(2 rows)
```

Interpretation:

- 3 unresolved legacy club-list `dob_conflict` rows across 1 entity (`4347`).
- 2 unresolved legacy register `dob_conflict` rows across 2 entities (`12949`, `13248`).
- No v2 (`disputed_by`) rows exist yet.
- No resolved `dob_conflict` rows were observed.
- No `dob_conflict` row has both legacy ownership keys.
- No `dob_conflict` row has neither legacy ownership key.
- Legacy `dob_conflict` attribution is deterministic.
- Step 0 therefore passes the approved HALT conditions (§21/§22).

**Recorded limitation (not a HALT):** the query returned **zero** `dob_internal_conflict`
rows. `afldb_test` currently contains zero `dob_internal_conflict` rows. Step 0 therefore
did **not** runtime-prove the `{"dates": [...]}` `dob_internal_conflict` payload shape or
its one-row-per-player contract — that contract remains **source-proven** (§9, from
`enrich_birth_dates.py:202-218`) rather than runtime-proven in `afldb_test`. This absence
is not a HALT and does not amend the approved architecture. Migration 072 must still fail
closed (§12.2 check 8) if another target database contains unsupported/duplicate
`dob_internal_conflict` state.

Step 0 = **PASS**. See "Status / handoff" above for current implementation
state, the recorded deviation, the validation-harness corrections, and the
next-session task — this Step 0 section is retained only for the detailed
query evidence.

Approved decisions:

```
D1   identical resolved recurrence is SUPPRESSED; materially changed may file anew
D1a  no recurrence_of field
D2   targeted partial unique index approved
D3   dob_internal_conflict structural invariant approved (contract proven, §9)
D4   external_identity_conflict is FOLLOW-UP, not ISSUE-090
D5   recompute players.dob_disputed — approved
```

Parent release state:

```
Release candidate ownership       understood
Repository reconciliation         complete
AFLDB-ISSUE-090                   Open / release blocker

Stage                             HALT
Commit                            HALT
Merge dev -> main                 HALT
Production preflight              HALT
Production deployment             HALT
```

The parent release must not resume until ISSUE-090 is implemented and validated **and** the
remaining release-gate snapshot/state differences are separately reconciled by the parent
release session. ISSUE-090 owns the confirmed DOB conflict lifecycle defect only.

## Workflow rule for future sessions

`AFLDB-ISSUE-090.md` is the durable source of truth. After every material

- rejected plan,
- amended plan,
- failed validation,
- unexpected evidence,
- design change,
- HALT,

**update this file before continuing or ending the session.** A fresh session must resume
solely from repository state and this runbook.

---

## 1. Problem statement

Two AFL Tables birth-date enrichment passes write unresolved `data_issues` rows of type
`dob_conflict` with contradictory lifecycle semantics. One stacks a duplicate copy on every
rerun; the other deletes unresolved rows it does not own. Neither can express which pass
owns a finding, because both passes use the same source key.

## 2. Proven evidence

### 2.1 The release gate

`tests/integration/release-gates.test.ts` → `gate: draft links` → *"does not stack duplicate
issues when a pass is re-run"* (`:486-497`) requires no unresolved
`(issue_type, entity_type, entity_id)` group to hold more than one row, across **all**
issue types. It returned `[{ issueType: 'dob_conflict', n: 1 }]` where `[]` is required.
The frozen suite currently reports 64 tests, 52 passed, 12 failed; eleven of those failures
are stale snapshot constants owned by the parent release session.

### 2.2 Runtime evidence (read-only, `afldb_test`)

```
 entity_id | id  |          detected_at          |  source   |  existing  |  asserted  |       external_id
-----------+-----+-------------------------------+-----------+------------+------------+-------------------------
      4347 | 441 | 2026-08-19 14:53:35.269158+10 | afltables | 1868-02-18 | 1868-02-20 | club-list:fitzroy:cap27
      4347 | 442 | 2026-08-19 14:55:07.511973+10 | afltables | 1868-02-18 | 1868-02-20 | club-list:fitzroy:cap27
      4347 | 443 | 2026-08-19 18:04:28.033987+10 | afltables | 1868-02-18 | 1868-02-20 | club-list:fitzroy:cap27
     12949 | 335 | 2026-08-15 02:36:41.741915+10 | afltables | 1997-03-06 | 1996-03-06 |
     13248 | 334 | 2026-08-15 02:36:41.741915+10 | afltables | 2002-09-19 | 2001-10-22 |
```

For entity `4347`: three rows, same `source`, same `existing`, same `asserted`, same
`external_id`, three different `detected_at`. Therefore **3 rows = 1 logical conflict =
repeated importer execution**.

Three disputed players, five rows, three logical conflicts.

This is **not** test residue, **not** a stale snapshot, and **not** three legitimate source
disagreements. The release gate is correct.

### 2.3 Source-side corroboration

The real AFL Tables *Fitzroy — All Time Player List* has been re-sourced and contains:

```
Cap:     27
Player:  Cleary, Bill
DOB:     1868-02-20
Games:   21 (11-1-9)
Goals:   6
Seasons: 1897-1899
```

This independently corroborates `external_id = club-list:fitzroy:cap27` and
`asserted = 1868-02-20`. The games figure sits inside `FACT_TOLERANCE = 2`
(`enrich_birth_dates_from_club_lists.py:99`, corroboration check `:268-278`), so the record
is expected to resolve to the same player under the current matcher.

All five datasets have been re-sourced — Fitzroy, University, Brisbane Bears,
Sydney/South Melbourne, North Melbourne. They are **optional real-source validation inputs
and are not CI dependencies** (§16). Some are current snapshots rather than byte-identical
copies of the historical 2026-08-19 import, Sydney especially. They are not added to Git as
part of ISSUE-090 unless repository data-retention policy separately justifies it.

## 3. Root cause, with causal precision

### 3.1 Club-list pass — caused the duplicates

`tools/migration/enrich_birth_dates_from_club_lists.py:412-432` writes unresolved
`dob_conflict` rows with an unconditional `executemany` INSERT. It does not replace its prior
findings, deduplicate them, upsert them, or scope issue ownership. Rerunning stacks another
copy of the same unresolved logical conflict. **This caused rows 441/442/443.** The comment
at `:405-406` claiming the "same shape as enrich_birth_dates.py" is inaccurate — the
sibling's clearing step is absent.

### 3.2 Register pass — a related cross-pass lifecycle defect, not the cause

`tools/migration/enrich_birth_dates.py:407-412`:

```sql
DELETE FROM data_issues
 WHERE entity_type = 'player'
   AND issue_type IN ('dob_conflict', 'dob_internal_conflict')
   AND resolved_at IS NULL
```

No ownership predicate, no population predicate. A register rerun erases unresolved
club-list findings it does not own — the `AFLDB-ISSUE-080` defect class.

**This did not cause rows 441/442/443.** Rows `334`/`335` are dated 2026-08-15, before all
three club-list runs on 2026-08-19; had the register pass run since, those three rows would
have been erased. The hazard is real, latent and unexercised, and it means run order
currently decides which unresolved findings survive.

### 3.3 Ownership cannot be expressed by source

Both passes set `SOURCE_KEY = "afltables"` (`enrich_birth_dates.py:77`,
`..._from_club_lists.py:79`) and both write `details->>'source' = 'afltables'`, confirmed by
all five retained rows. Ownership here is **pass-grained, not source-grained**; neither
`details->>'source'` nor a hypothetical `data_issues.source_id` column would discriminate.

### 3.4 Schema state

`data_issues` (`src/db/migrations/001_foundations.sql:91-104`) has no unique constraint;
`ix_data_issues_open (entity_type, issue_type) WHERE resolved_at IS NULL` is non-unique. No
later migration alters it. **Nothing has a foreign key to `data_issues.id`** (verified across
the full migration set), so row deletion has no referential consequence.

## 4. Non-goals

- The other eleven release-gate failures. No expected value is re-pinned here.
- `external_identity_conflict` (D4, §18).
- `player_birth_evidence` writes (§17 — already idempotent).
- Importer-side advisory locking.
- Any production mutation or production cleanup design.
- A generic refactor of all `data_issues` writers.

## 5. Ownership model (approved)

**One unresolved `dob_conflict` row per player**, with all current distinct assertions
aggregated inside an explicit `disputed_by` map keyed by pass.

`dob_conflict` is **not** split into per-pass issue types: it names the semantic issue, and
register-versus-club-list is provenance. The representation is versioned (`version = 2`) and
assertion provenance is explicit. `details ? 'register'` / `details ? 'club_list'` survive
**only** as backwards-compatible legacy-shape recognisers, never as the ongoing mechanism.

### 5.1 Payload

```json
{
  "version": 2,
  "disputed_by": {
    "club_list": [
      { "source": "afltables",
        "club": "fitzroy",
        "external_id": "club-list:fitzroy:cap27",
        "asserted": "1868-02-20",
        "existing_at_detection": "1868-02-18" }
    ],
    "register": [
      { "source": "afltables",
        "external_id": "players/C/Bill_Cleary.html",
        "asserted": "1938-06-19",
        "existing_at_detection": "1938-06-18" }
    ]
  },
  "resolution": "manual review required"
}
```

- `version` enables the "payload version I do not understand" precondition (§12).
- `source` sits **per assertion**, so a future pass on another source needs no shape change.
- **No top-level `existing`.** It was a mirror of `players.dob`, the single authoritative
  current value. Removing it means a merge group with divergent baselines has no field left
  to choose arbitrarily — the problem is structurally gone rather than handled. Each
  assertion keeps its own `existing_at_detection`, which is what history and fingerprinting
  need.
- **Determinism:** pass keys serialised sorted; assertion arrays sorted by
  `(club, external_id, asserted)` with absent `club` sorting first. A rerun writes a
  byte-identical payload.
- `description` is regenerated from the assertion set and names the current `players.dob`.

## 6. D1 — adjudication semantics (approved)

```
Identical previously resolved logical assertion
  -> remains adjudicated
  -> the importer must NOT create another unresolved copy.

Materially changed logical assertion
  -> may create a new unresolved issue.
```

`resolved_at` must carry durable operational meaning; if every routine run recreated the same
disagreement, resolution would mean nothing and the queue would be permanently noisy. There
is no resolution vocabulary today that can distinguish *"source was wrong"* from *"our DOB
was wrong"* from *"ignore"* from *"temporarily closed"*, so no behaviour is varied by reason.

**Suppression is assertion-specific.** Never implement "player has any resolved
`dob_conflict` → suppress everything". A resolved register conflict does not suppress an
unrelated club-list assertion, and vice versa.

**D1a: no `recurrence_of` field.** An identical recurrence is suppressed; a materially
changed condition is a new logical conflict. Lineage is out of scope.

### 6.1 Fingerprint

```
club_list :  (pass, club, external_id, asserted, existing_at_detection)
register  :  (pass,       external_id, asserted, existing_at_detection)
```

`entity_id` is implicit — fingerprints are only compared within one player. A pass suppresses
an assertion **iff** an identical fingerprint appears among that player's **resolved**
`dob_conflict` rows.

| Change | Field that differs | Result |
|---|---|---|
| Same source record asserts a different DOB | `asserted` | new unresolved issue |
| `players.dob` changed, so the old adjudication no longer describes the comparison | `existing_at_detection` | new unresolved issue |
| A different source record asserts another DOB | `external_id` (and `club`) | new unresolved issue |
| A different pass asserts a conflict | `pass` | new unresolved issue |

No mutable display text is used: `description` is regenerated prose and is excluded. `club`
is derived from `external_id` and retained only so §7's scope predicate need not string-parse.

**Why the baseline belongs in the identity.** An adjudication judges a *comparison*, not a
source record. "Our 1868-02-18 is right, the list's 1868-02-20 is wrong" says nothing about a
later comparison where the stored value has become 1868-02-19.

### 6.2 Resolved-history shapes (read, never rewritten)

| Shape | Recognition | Fingerprints produced |
|---|---|---|
| **A — legacy register** `{existing, register, source, resolution}` | has `register`, no `disputed_by` | one: `(register, ⊥, register, existing)` |
| **B — legacy club-list** `{existing, club_list, external_id, source, resolution}` | has `club_list`, no `disputed_by` | one: `(club_list, club←external_id prefix, external_id, club_list, existing)` |
| **C — v2 aggregate** | `details ? 'disputed_by'` | one per assertion in every pass key |

**Shape B is lossless** — `external_id`, `asserted` and `existing` are all present, and `club`
is deterministic from the `club-list:{file_key}:` prefix.

**Shape A omits `external_id`, and that loses no discriminating power — proven from source:**
`enrich_birth_dates.py:124-134` builds `profile_urls` with `setdefault` keyed by `legacy_id`
(one URL per legacy id); `:193-197` builds `players = {legacy_player_id: (pid, dob)}` (one
legacy id per AFLDB player); `:208-226` appends at most one entry per player to
`source_conflicts`. Therefore **a player holds at most one register assertion at any time**,
and `external_id` is functionally determined by `entity_id`. Matching shape-A rows on
`(register, asserted, existing)` within a player is exact.

Comparison against a shape-A row therefore **ignores `external_id` on both sides** rather than
treating an absent value as a mismatch. This is the one deliberate asymmetry in the reader —
recorded here so a later session does not "tidy" it into a bug.

## 7. Club-list processed population (approved)

`--csv-dir` processes whichever of the five `FILE_ORGS` filenames are present (`:88-94`), so a
run is legitimately partial. The scope key is the club file, already encoded in stored data:
`external_id = f"club-list:{file_key}:cap{…}"`, `file_key = org_name.lower().replace(" ","-")`
(`:240`, `:248`).

`external_id` is computed at `:248` **before** any parsing, matching or rejection, so the set
of records a file contains is known regardless of match outcome. That is what makes
evidence-based cleanup possible.

Per processed club file `C`:

| Existing assertion `a` with `a.club = C` | Evidence | Action |
|---|---|---|
| `a.external_id ∉ present(C)` | record gone from a file we authoritatively read | **DELETE** |
| `a.external_id ∈ conflicts(C)` | still disagrees | **REPLACE** with the fresh assertion |
| `a.external_id ∈ agreements(C)` | source now matches `players.dob` | **DELETE** — ceased |
| `a.external_id ∈ fills(C)` | baseline was NULL; no conflict possible | **DELETE** |
| `a.external_id ∈ rejected(C)` | unparseable date, no name match, ambiguous same-name, no corroborating fact | **RETAIN unchanged** |
| `a.club = C'`, `C'` not processed | no evidence at all | **RETAIN unchanged** |

**A failed match is not evidence that the source assertion ceased.** A Fitzroy run that can
no longer resolve cap27 leaves cap27's finding standing.

Source change this requires: `agreements` is currently a bare counter (`:333`); it becomes a
set of `external_id`s, as do fills and conflicts. `rejections` already carries `external_id`
(`:253`, `:258`, `:301`, `:306`, `:318`).

## 8. Register processed population (approved)

No partial mode: `argparse` offers only `--dry-run` and `--quiet` (`:167-170`) and the pass
always reads the whole `club_player_register` (`:142-144`). The authoritative population is
every AFLDB player it **resolved** — those reaching `:213` with `entry is not None`:

| Outcome at `:215-226` | Action on an existing `disputed_by.register` assertion |
|---|---|
| single date, disagrees (`source_conflicts`) | **REPLACE** |
| single date, agrees | **DELETE** — ceased |
| baseline NULL, filled (`to_fill`) | **DELETE** — no conflict possible |
| multiple dates (`internal_conflicts`) | **DELETE** — the register no longer asserts a single conflicting date; the finding moves to `dob_internal_conflict` |
| `entry is None` (`unknown_players`) | not applicable — no AFLDB player owns an assertion |
| player carries a register assertion but produced no evidence this run | **RETAIN unchanged** |

The last row is the documented trade-off: a player whose `legacy_player_id` link or
profile-URL index entry has broken produces no evidence, and the pass cannot distinguish that
from genuine source cessation. **Absence from the resolved population is not authoritative
cessation.** Retaining is fail-open and never destroys adjudicable state. Residual: such an
assertion persists until a human adjudicates it.

This is also what makes §14 test 5 safe — a small fixture register clears only the fixture
player, leaving the real `12949`/`13248` assertions untouched. A global sweep would destroy
them and break the release gate.

**Asymmetry justified, not stylistic:** the club-list source is re-capturable CSV where record
disappearance is realistic; the register is a frozen SQLite artefact where apparent
disappearance is almost certainly a broken link.

## 9. D3 — `dob_internal_conflict` contract proven

From `enrich_birth_dates.py:202-218`: `internal_conflicts` is built by iterating `evidence`
keyed by `legacy_id`; `players` maps `legacy_player_id → (pid, dob)`, so at most one legacy id
resolves to a given AFLDB player; the multi-date case appends a **single**
`(afldb_id, sorted(dates))` entry whose payload aggregates every date as `{"dates": [...]}`
(`:434-446`). **One row per player, multiplicity inside the payload** — the same shape as the
`dob_conflict` aggregate. Its intended model is therefore also one unresolved row per player,
and it receives equivalent structural protection (§11).

No duplicates exist in `afldb_test`: the release gate groups **all** unresolved `data_issues`
and reported `dob_conflict` alone, which is positive proof no other issue type has a duplicate
group. Other environments are unknown — that is what §12's precondition is for. **No merge
logic is written for `{"dates":[…]}`**: the migration aborts for deliberate review instead,
because this issue did not analyse that payload's merge semantics and must not invent them.
Its payload lifecycle is otherwise unchanged; it gains only the scoped delete-then-refile of
§10 step 6.

## 10. Reconciliation algorithm (approved)

Inside each pass's existing single transaction:

```
0. resolved fingerprints:
     read this player-set's resolved dob_conflict rows,
     expand shapes A/B/C (§6.2) into a fingerprint set  R

1. candidates := this run's conflicts for pass P
   mine := { a in candidates : fingerprint(a) not in R }        # D1 suppression

2. SELECT id, entity_id, details
      FROM data_issues
     WHERE entity_type='player' AND issue_type='dob_conflict'
       AND resolved_at IS NULL AND entity_id = ANY(owned population)
     FOR UPDATE

3. per row, per the §7 / §8 outcome table:
       disputed_by[P] := reconcile(existing entries, mine[entity_id])
       RETAIN cases leave the entry untouched

4. disputed_by empty  -> DELETE row
   otherwise          -> UPDATE details (+ regenerated description)

5. player in mine with no unresolved row
                      -> INSERT ... ON CONFLICT (entity_type, entity_id, issue_type)
                         WHERE ... DO UPDATE                     # §11 index

6. dob_internal_conflict: scoped delete-then-refile over the same
   population (single writer, no aggregation need) -- the
   tools/records/import-first-kick-goal.ts:1305-1312 idiom

7. D5: recompute players.dob_disputed for the affected population (§13)
```

| Clause | Guarantees |
|---|---|
| steps 0/1 | an adjudicated assertion is not refiled; a changed one is |
| `disputed_by[P]` only | one pass cannot erase another's findings |
| owned population, evidence-based | partial runs and failed matches never destroy state |
| `UPDATE` not delete+insert | `detected_at` survives — first detection stops being reset every run, an improvement on today's register behaviour |
| deterministic sort | byte-identical payload on rerun |
| `resolved_at IS NULL` throughout | history is read for fingerprints and never written |

**Privileges:** `data_issues` is absent from the exclusion list at
`045_import_write_is_fail_closed.sql:105-113`, so it is in
`afldb_meta.import_writable_tables` and `afldb_import` already holds full DML including
`UPDATE`. No privilege migration is needed. Verified, not assumed — this is the
`AFLDB-ISSUE-083` failure mode.

**Concurrency:** both passes already run the whole reconciliation in one transaction committed
once at the end, and `FOR UPDATE` covers the read-modify-write. Safe under the existing
one-pass-at-a-time assumption. `AFLDB-ISSUE-081`'s advisory locks are **test-file mutexes**
(`tests/integration/draft-lock.ts`), not importer-side; `tools/migration/common.py` takes no
lock. Importer-side locking is deliberately out of scope and stated rather than assumed away.

## 11. D2 — partial unique index (approved)

```sql
CREATE UNIQUE INDEX uq_data_issues_open_dob_per_player
  ON data_issues (entity_type, entity_id, issue_type)
  WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
    AND resolved_at IS NULL;
```

- **`entity_type` is a key column, not a predicate** — pinning it would silently
  over-constrain a future entity type; as a key column it is simply part of the identity.
- **`issue_type` sits in both key and predicate** — in the key it keeps the two types
  independent, so one open `dob_conflict` *and* one open `dob_internal_conflict` per player
  is legal, which is the model; in the predicate it bounds the blast radius to these two
  types, leaving every other `data_issues` writer unaffected.
- Key order also serves the §10 step-2 lookup.
- `entity_id` NULL rows never conflict in a unique index, so table-level findings are
  untouched.
- Resolved history is excluded by the predicate: unlimited resolved rows coexist with one
  open row.
- **Created only after merge and dedupe**, in the same transaction.

Precedent: `059_honour_team_member_identity.sql:14-38` — fail-closed `DO $$` precondition, then
predicated unique indexes.

The release gate remains valuable alongside it: the index prevents retained corruption, the
gate protects the higher-level contract across every issue type.

## 12. Migration 072 — `src/db/migrations/072_dob_conflict_ownership.sql`

`071_audit_link_fk_indexes.sql` already exists and is applied to `afldb_test`. **Do not edit,
reuse or renumber 071** — `tools/db/migrate.ts:13,144` refuses an edited applied migration by
checksum regardless.

`migrate.ts:172-173` runs each migration inside `sql.begin()` and rolls back on throw, so
`RAISE EXCEPTION` aborts with nothing applied.

### 12.1 Order

```
 1. fail-closed precondition checks
 2. accept only understood unresolved legacy / v2 shapes
 3. normalise safely attributable unresolved legacy dob_conflict rows to version 2
 4. group duplicate unresolved dob_conflict rows by player
 5. losslessly union distinct assertions
 6. deduplicate identical assertions
 7. preserve assertion-level existing_at_detection
 8. preserve oldest meaningful current issue identity / detected_at (survivor = MIN(id))
 9. fully UPDATE survivor before deleting losers
10. delete merged unresolved loser rows only
11. recompute dob_disputed for the affected player set only (§13)
12. add uq_data_issues_open_dob_per_player (§11)
13. leave resolved history untouched
```

### 12.2 Fail-closed preconditions

All evaluated over **unresolved** rows, before any destructive step, each raising with the
offending `entity_id` list:

1. `dob_conflict` carrying **both** `register` and `club_list` — ownership ambiguous.
2. `dob_conflict` carrying **neither**, and no `disputed_by` — unattributable.
3. `details ? 'version'` with a value other than `2` — payload version not understood.
4. `disputed_by` present but not an object; a pass key whose value is not an array of
   objects; or an assertion missing `asserted`.
5. `asserted` or `existing_at_detection` not parseable as a date.
6. A `club_list` assertion (legacy or v2) whose `external_id` does not match
   `^club-list:[a-z0-9-]+:` — `club` cannot be derived deterministically.
7. `entity_type <> 'player'` on any `dob_conflict` / `dob_internal_conflict` row.
8. Any duplicate unresolved `dob_internal_conflict` group (D3 — no merge logic exists).
9. Any top-level `details` key outside the known set for its shape — unknown keys may encode
   evidence and are never silently discarded.
10. Any duplicate group whose assertions cannot be unioned without information loss.
11. Any `dob_disputed` inconsistency **outside** the affected player set — report, do not
    sweep (§13).

Nothing is silently attributed, transformed or skipped. **The migration does not assume
production resembles `afldb_test`.**

### 12.3 Lossless merge rules

| Input | Rule |
|---|---|
| Identical assertions | dedupe on `(pass, club, external_id, asserted, existing_at_detection)` |
| Different `external_id` / `asserted` within `club_list` | retain all — legitimately distinct |
| `register` + `club_list` across duplicate rows | retain both pass keys in one row |
| Different `existing_at_detection` | preserved per assertion; never collapsed |
| Different `detected_at` | survivor `MIN(id)`, so issue-level first detection is kept |
| Different `description` | regenerated from the merged set — prose with no reader, and the merged text describes strictly more |
| Anything not representable in the §5.1 shape | **HALT** |

Never arbitrarily choose one DOB baseline merely to collapse rows. There is no top-level
`existing` left to choose (§5.1). The observed `4347` group is byte-identical, so all of this
is a no-op there; it exists for environments whose groups are not.

## 13. D5 — recompute `players.dob_disputed` (approved)

**Authoritative contract:**

```
players.dob_disputed = TRUE
  iff that player has at least one unresolved dob_conflict
      OR at least one unresolved dob_internal_conflict
```

This matches `018_player_birth_evidence.sql:70-71` — *"True when sources disagree. The
existing value is retained and an **open** data_issue records the conflict; it is not resolved
by guessing."*

**`dob_disputed` is public state**, which is why this is a recorded decision rather than an
implementation detail:

- `src/app/players/[slug]/page.tsx:233` renders a visible dispute marker.
- `src/lib/structured-data.ts:126` **omits `birthDate` from the schema.org JSON-LD** while
  disputed.

Repaired issue state and public dispute state must therefore stay consistent: without the
recompute, the repair would delete an unresolved row while leaving the player publicly marked
disputed, contradicting 018's stated contract.

**Importer behaviour** — after reconciliation, recompute for the exact population whose
relevant DOB issue state was affected. The calculation considers **all unresolved DOB issue
types**, not just the current pass:

```
club-list conflict removed, register/internal conflict remains -> dob_disputed stays TRUE
last unresolved DOB conflict removed                           -> dob_disputed becomes FALSE
new unresolved DOB conflict created                            -> dob_disputed becomes TRUE
```

**Migration behaviour** — 072 recomputes only for players whose relevant unresolved DOB issue
state the migration itself changes. It is **not** a global `dob_disputed` repair sweep. If
unrelated global inconsistency is discovered, **HALT and report** rather than broaden
ISSUE-090 silently (§12.2 check 11).

**Blast radius on first run is nil, and it is checkable rather than asserted:** `afldb_test`
holds zero resolved `dob_conflict` rows and three unresolved ones whose players are exactly
the three flagged disputed, so the equivalence already holds and no player page or JSON-LD
output changes. The behaviour manifests only when someone adjudicates or a conflict genuinely
ceases. Step 0 confirms the resolved-row count.

## 14. Deterministic regression suite

New file `tests/integration/dob-enrichment-issues.test.ts` — justified because no existing
suite covers DOB enrichment. Follows `tests/integration/draft-reload-links.test.ts`: real
importers via `spawnSync`, `hasPsycopg()` environment guard (`:68-75`), fixture players
created and removed, importer run under `AFLDB_TEST_DATABASE_URL`.

**Core correctness must not depend on the network, the real historical CSVs, or a
developer-owned `AFLDB_LEGACY_SQLITE`.** Fixtures:

- **Club-list** — tiny CSVs written to a temp dir, passed via `--csv-dir`.
- **Register** — a temp SQLite built with Python's stdlib `sqlite3` through `spawnSync`
  (`package.json` has no SQLite driver; Python is already required). The pass reads only
  `afltables_player_index(profile_url, player_id)` (`:124-128`) and
  `club_player_register(player_url, raw_row_json)` (`:142-144`), joining through
  `players.legacy_player_id` (`:193-196`) — a handful of rows suffices.

**Blast-radius guard:** `beforeAll` snapshots every `dob_conflict` / `dob_internal_conflict`
row and the affected `players` columns; `afterAll` restores them (`OVERRIDING SYSTEM VALUE`
preserves ids). With §15's lock, the file cannot leave residue for the gate.

| # | Test | Proves |
|---|---|---|
| 1 | Club-list run twice | one row, same `id`, same `detected_at`, identical payload |
| 2 | Stable issue identity across reruns | first-detection semantics hold |
| 3 | One player, two club files, different dates | both assertions retained in `disputed_by.club_list`, distinct `club` |
| 4 | Seed `disputed_by.register`, run club-list | register key survives byte-for-byte |
| 5 | Seed `disputed_by.club_list`, run **real register pass** | club-list key survives — **no optional skip** |
| 6 | Partial `--csv-dir`, one file of two | unprocessed file's scope untouched |
| 7 | Authoritative cessation (`agreements`) | only this pass's entry removed |
| 8 | Record present but unmatchable | **RETAINED** — failed match is not cessation |
| 9 | Record deleted from a processed file | file-scoped cleanup removes it |
| 10 | Legacy **resolved** club-list assertion, identical rerun | resolved row unchanged, **no** new unresolved row |
| 11 | v2 **resolved** assertion, identical rerun | same |
| 12 | Resolved, then `asserted` changes | resolved row remains, new unresolved row filed |
| 13 | Resolved, then `players.dob` changes | new unresolved row filed — baseline is in the fingerprint |
| 14 | Resolved **register** assertion + different club-list conflict | suppression is assertion-specific, not player-wide |
| 15 | Migration converts legacy unresolved rows | shapes A/B → v2 |
| 16 | Migration merges duplicates losslessly | incl. heterogeneous baselines and mixed provenance |
| 17 | Each §12.2 precondition | migration aborts, nothing applied |
| 18 | Second unresolved protected DOB row for one player | rejected by the index; resolved history still permitted |
| 19 | `dob_disputed` clears when no unresolved DOB issue remains | D5 |
| 20 | `dob_disputed` stays true when another unresolved DOB issue remains | D5 |
| 21 | `dob_disputed` becomes true when a new unresolved DOB issue appears | D5 |
| 22 | `release-gates.test.ts` duplicate invariant | passes unchanged |
| 23 | Snapshot/restore + lock | no residue, no race |

Source-text checks (neither importer contains an unscoped `DELETE FROM data_issues`)
supplement tests 1-18; they never substitute for them.

## 15. Test locking

Add `BIRTH_DATE_ENRICH_LOCK = 780_003` plus `lock/unlockBirthDateEnrichment` to
`tests/integration/draft-lock.ts` — the shared lock module, kept under its existing name (it
already hosts the honours lock; renaming is unjustified churn).

Revision 1 protected the wrong section. `release-gates.test.ts:582-671` — `gate: birth dates`
— reads `players.dob`, `dob_disputed`, `dob_evidence_id`, `dob_confidence`,
`player_birth_evidence` (count and `external_id` shape) and the unresolved `dob_conflict`
count. The duplicate-issue gate sits separately inside `gate: draft links` (`:486-497`). Two
describes, so the lock is taken **file-level** in the existing `beforeAll` at `:35`, beside
the honours lock, and file-level in the new file — covering the whole read/write window rather
than one describe block.

**Acquisition order, documented in the module comment:**

```
honours (780_002)  ->  birth dates (780_003)  ->  draft (780_001)
```

**No-cycle reasoning:** `release-gates.test.ts` is the **only** file holding more than one —
honours at `:35`, birth dates beside it, draft at `:393` — and it acquires them in that order.
`awards-reload-links.test.ts:68` takes honours alone; `draft-reload-links.test.ts:232` takes
draft alone; the new file takes birth dates alone. A deadlock requires two holders acquiring
two locks in opposite orders, so none is reachable.

No other test writes DOB `data_issues`, `players.dob_disputed` or `player_birth_evidence` —
searched. `first-kick-goal-reload-links.test.ts` writes `data_issues` under
`entity_type='player_achievements'`, a disjoint population; pre-existing and unlocked, out of
scope, not made worse.

## 16. Optional real-source validation

Only after the deterministic fixture suite passes, and only against a temporary directory
nominated at the time:

1. `--dry-run` first: rows read, fills, agreements, rejections, conflicts per club.
2. Confirm Fitzroy cap27 produces exactly one `club_list` assertion for entity `4347`.
3. Apply, then rerun unchanged: zero new rows, byte-identical payload.
4. Confirm distinct assertions across clubs are preserved and no source-shape incompatibility
   appears.
5. Report match / fill / conflict classifications.

**These files never define CI snapshots**, and a current snapshot is not assumed byte-identical
to the original historical import. Differences are evidence about the source, not regressions,
and must never be used to re-pin release-gate constants.

## 17. `player_birth_evidence` — out of scope, with a recorded limitation

`018_player_birth_evidence.sql:51`: `player_birth_evidence_uq UNIQUE (player_id, source_id,
dob)` — *"One row per distinct date per player per source: repeated agreement increments
occurrences rather than adding rows."* Both writers upsert on exactly that key
(`enrich_birth_dates.py:277-280`, `..._from_club_lists.py:376-378`), so **evidence-row
idempotency is already structurally protected.** Kept out of the repair unless implementation
disproves this.

**Limitation, recorded:** register and club-list share `source_id = afltables`, so identical
agreeing DOB evidence collapses onto one row and neither upsert updates `external_id` or
`evidence_type` — first writer wins. The club-list pass also hardcodes `occurrences = 1`.
Therefore **`player_birth_evidence` cannot encode pass ownership by itself**, which is exactly
why `disputed_by` must carry explicit provenance (§5.1).

## 18. D4 — `external_identity_conflict` is follow-up

`enrich_birth_dates.py:347-367` writes it by unconditional `executemany` with no clearing
step — same defect class, latent at zero rows, not responsible for the release blocker.

Excluded because the shared ISSUE-090 mechanism does **not** naturally cover it: different
`issue_type`, `entity_id` is the *stored* player rather than the disputed one, single writer,
no `disputed_by` aggregation. Its correct fix is the plain
`import-first-kick-goal.ts:1305-1312` idiom — a separate small change. Folding it in would
turn a release blocker into a generic `data_issues` writer refactor.

**No follow-up ID is allocated yet.** Whether it qualifies as a Low tracked issue is decided
at ISSUE-090's resolution, per `CLAUDE.md` §5.

## 19. Production implications

**Migration 072 is production-affecting if released.** This issue is not test-only.

Implementation must not touch production. No production cleanup is designed here — 072 must be
safe whether or not production holds duplicates.

The parent release runbook gains a separate **fail-closed, read-only production preflight**
before 072 is applied, establishing at minimum:

1. current unresolved `dob_conflict` shape distribution (legacy register / legacy club-list /
   v2 / unattributable);
2. whether duplicate unresolved groups exist, and their sizes;
3. whether any row would trip a §12.2 precondition — as a dry predicate, never by attempting
   the migration;
4. whether `dob_internal_conflict` satisfies its one-row invariant before it is indexed;
5. production identity and migration-ledger/checksum safety per the normal release process.

`afldb_dev` is audited the same way at deploy time. A green `afldb_test` proves nothing about
either — §12.2 is the actual safety mechanism.

## 20. Files expected to change (implementation session)

| File | Change | Already modified in the working tree? |
|---|---|---|
| `tools/migration/enrich_birth_dates_from_club_lists.py` | replace `:412-432` with §10; track processed `file_key`s and per-file `present`/`conflicts`/`agreements`/`fills`/`rejected` sets (`:333` counter → set) | no |
| `tools/migration/enrich_birth_dates.py` | replace unscoped delete `:407-412` and inserts `:414-446`; add `external_id` to register assertions; scoped refile for `dob_internal_conflict`; resolved-history fingerprint read. **`:347-367` NOT touched** | no |
| `src/db/migrations/072_dob_conflict_ownership.sql` | **new** | no |
| `tests/integration/dob-enrichment-issues.test.ts` | **new** | no |
| `tests/integration/draft-lock.ts` | **narrow** — third lock + documented order | **YES — make narrow edits only** |
| `tests/integration/release-gates.test.ts` | **narrow** — take the new lock file-level at `:35`. **No expected value changed** | **YES — make narrow edits only** |
| `issues.md` | status/resolution update at close | **YES — narrow edits only** |
| `IssuesIndex.md` | remove on resolution | **YES — narrow edits only** |
| `CHANGELOG.md` | `Unreleased` entry **on resolution only** | **YES — narrow edits only** |

### 20.1 Working-tree state at handoff

The `dev` working tree already contains completed release work unrelated to ISSUE-090.
**Do not restore, clean or overwrite any of it.** Known modified files:

```
CHANGELOG.md
IssuesIndex.md
issues.md
tests/integration/awards-reload-links.test.ts
tests/integration/draft-lock.ts
tests/integration/draft-reload-links.test.ts
tests/integration/email-intake.test.ts
tests/integration/release-gates.test.ts
tests/nl-ui-corpus.test.ts
tests/nl-ui/nl-stress.spec.ts
tests/site-settings.test.ts
tests/under-22-importer.test.ts
src/db/migrations/071_audit_link_fk_indexes.sql
```

plus untracked `issue-081.patch`, proven redundant but deliberately left untouched.

Five of those files overlap ISSUE-090's expected edits (marked above). Every edit to them must
be narrow and additive; none may be rewritten wholesale.

## 21. Step 0 — read-only, before the first implementation code edit

```bash
PGOPTIONS='-c default_transaction_read_only=on' \
psql -X "$AFLDB_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
-c "SELECT issue_type,
           resolved_at IS NULL            AS unresolved,
           details ? 'disputed_by'        AS v2,
           details ? 'register'           AS legacy_register,
           details ? 'club_list'          AS legacy_club_list,
           jsonb_typeof(details->'dates') AS dates_type,
           count(*)                       AS rows,
           count(DISTINCT entity_id)      AS entities
      FROM data_issues
     WHERE issue_type IN ('dob_conflict', 'dob_internal_conflict')
     GROUP BY 1,2,3,4,5,6
     ORDER BY 1,2,3,4,5,6;"
```

The columns are read per `issue_type` rather than assuming the two share a payload shape:
`dob_conflict` rows are expected to show `dates_type` NULL; `dob_internal_conflict` rows to
show all three booleans false with `dates_type = 'array'`.

**What it proves — for `afldb_test` only:**

- `register` and `club_list` are mutually exclusive across every `dob_conflict` row, resolved
  history included, so §6.2 shape recognition is deterministic;
- no `dob_conflict` row carries neither key, so none is unattributable;
- no v2 payload exists yet, so 072 has a clean starting point;
- `dob_internal_conflict` uses `{"dates": […]}` and carries no ownership keys, as §9 asserts
  from source;
- how many resolved rows exist, which sets the fixture baseline for tests 10-14 and the D5
  blast-radius statement in §13.

**What it does NOT prove:** anything about `afldb_dev` or production; that no future row will
differ; or that duplicate groups elsewhere are byte-identical. §12.2's assertions and §19's
preflight are the mechanisms for those. Duplicate-group extent is already established by the
gate itself, so this query deliberately does not re-derive it.

**HALT if** any row shows both keys, or a `dob_conflict` row shows neither: legacy attribution
is then not deterministic even on the development database, and §6.2 returns for revision.

## 22. Execution HALT conditions

Stop implementation immediately on any of:

```
unsupported unresolved legacy / current payload;
lossless ownership cannot be established;
legitimate requirement for multiple unresolved dob_conflict rows per player;
legitimate requirement for multiple unresolved dob_internal_conflict rows per player;
resolved recurrence semantics contradict the approved fingerprint;
migration would discard information;
partial-run ownership cannot be made safe;
register fixture disproves the source identity assumptions in 6.2;
unique index conflicts with valid domain state;
test lock ordering creates a cycle;
an applied migration would need editing;
production assumptions leak into implementation;
dob_disputed inconsistency outside the affected population;
any other evidence materially invalidating the approved design.
```

**Response to a material contradiction:**

```
1. stop implementation;
2. update AFLDB-ISSUE-090.md with the evidence;
3. record which assumption failed;
4. report HALT;
5. wait for review.
```

Do not redesign extensively inside a long execution session.

## 23. Validation sequence (each command run by the user, one at a time)

1. **Step 0** (§21) — before any code is written.
2. `npm test -- tests/integration/dob-enrichment-issues.test.ts` — pre-migration subset
   (tests 1-14, 19-21, 23).
3. `npm run db:migrate` — applies 072 to `afldb_test`. Take a dump first.
4. Rerun step 2 — tests 15-18 assert post-migration state and index behaviour.
5. `npm test -- tests/integration/release-gates.test.ts` — duplicate-issue gate green,
   failures 12 → 11. `gate: birth dates` stays red on `withDob`/`disputed`; those are the
   parent session's stale constants and are untouched here.
6. `npm test -- tests/integration/privileges.test.ts` — confirms the §10 grant conclusion.
7. *(optional, §16)* real five-club dry run, then apply, then rerun.

Typecheck only if the TypeScript changes warrant it. No full suite and no `npm run build` —
neither application nor framework behaviour changes beyond D5's `dob_disputed` contract, whose
first-run blast radius is nil (§13).

## 24. Rejected alternatives

| Rejected | Why |
|---|---|
| Split `dob_conflict` into per-pass issue types | `dob_conflict` names the semantic issue; pass is provenance. Splitting would dodge rather than satisfy the gate's contract |
| `details->>'source'` or a `data_issues.source_id` column as the discriminator | both passes are `afltables`; ownership is pass-grained, not source-grained (§3.3) |
| Permanent reliance on `details ? 'register'` / `? 'club_list'` | incidental payload data, not ownership markers, and not extensible to a third pass. Retained only as legacy recognisers |
| Copying the register pass's broad unscoped DELETE into the club-list pass | that delete is itself the §3.2 defect |
| `pids = every player resolved this run` as the owned population | a vanished source record would never be cleaned; a failed match would be misread as cessation (§7) |
| A global register sweep over every player carrying a register assertion | destroys valid state on a broken link, and would break the gate under a fixture register (§8) |
| Refiling a fresh unresolved row on every run (the original D1 proposal) | `resolved_at` would carry no durable meaning and the queue would be permanently noisy (§6) |
| Player-wide suppression on any resolved `dob_conflict` | over-suppresses genuinely new evidence (§6) |
| `recurrence_of` lineage marker | unnecessary once identical recurrences are suppressed (D1a) |
| Top-level `existing` in the v2 payload | a mirror of `players.dob` that forced an arbitrary choice when merging divergent groups (§5.1) |
| Normalising resolved rows for cosmetic uniformity | resolved history is immutable; nothing reads the payload (§12.1 step 13) |
| No unique index | the aggregate model makes the row-level invariant exactly expressible in PostgreSQL (§11) |
| Including `external_identity_conflict` | different semantics, not covered by the shared mechanism (§18) |
| Repairing `player_birth_evidence` | already idempotent by unique-key upsert (§17) |
| Historical CSVs or `AFLDB_LEGACY_SQLITE` as test prerequisites | core correctness must be self-contained (§14) |
| Locking only the `gate: draft links` describe | leaves `gate: birth dates` unprotected (§15) |

## 25. Acceptance criteria

1. Rerunning either pass leaves exactly one unresolved `dob_conflict` row per player, same
   `id`, unchanged `detected_at`, byte-identical payload.
2. Distinct assertions are all retained, each with its own source identity and
   `existing_at_detection`.
3. Cross-pass isolation holds in both directions, proven against the **real importers** in
   normal CI with no optional skip.
4. Cleanup is evidence-based: a processed file's vanished record is removed; a present but
   unmatchable record is retained; an unprocessed file scope is untouched.
5. An identical previously resolved assertion is **not** refiled; a materially changed one is;
   suppression is assertion-specific, never player-wide or cross-pass.
6. Resolved rows are never modified, deleted or reopened, and migration 072 never writes them.
7. `afldb_test` returns to one authoritative unresolved conflict for entity `4347`, with
   assertions unioned and deduped rather than discarded.
8. Migration 072 aborts with a reviewable message on every §12.2 shape.
9. The index rejects a second unresolved protected DOB row for one player while permitting
   resolved history and a coexisting `dob_internal_conflict`.
10. `players.dob_disputed` satisfies the §13 contract for every affected player, and no global
    sweep is performed.
11. `release-gates.test.ts` passes the duplicate-issue invariant, the invariant unchanged.
12. The new test file cannot race the release-gate DOB assertions.
13. No applied migration edited; no production mutation; no snapshot constant re-pinned; no
    unrelated working-tree change disturbed.

## 26. Rollback

Importer changes are code-only and revert cleanly. Migration 072 deletes rows and creates an
index; take an `afldb_test` dump before applying. There is no down migration, consistent with
repository convention.
