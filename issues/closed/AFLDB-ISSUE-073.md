# AFLDB-ISSUE-073 — Audit/link foreign-key indexes

## Status

**IMPLEMENTED / DATABASE VALIDATION BLOCKED BY ISSUE-093**

The bounded schema repair already exists as migration
`071_audit_link_fk_indexes.sql`. This runbook records the source proof and the
new DB-free contract added on 2026-08-27. The final PostgreSQL catalogue gate
must be rerun after `afldb_test` is available again; this task must not create,
rebuild, migrate, or connect to that database while ISSUE-093 owns it.

## Scope and constraints

Only these four pre-066 foreign keys are in scope:

1. `data_edits.admin_user_id`
2. `player_link_resolutions.admin_user_id`
3. `player_link_resolutions.player_id`
4. `player_link_suggestions.resolved_by`

No exception-list expansion, unrelated index work, privilege change, database
operation, importer execution, or historical-migration rewrite is part of this
repair.

## Migration history and conventions

- Migrations are loaded by `tools/db/migrate.ts` in filename order and each is
  applied inside `postgres.js` `begin()`. Applied migration checksums are
  recorded and later edits are refused.
- The current source sequence is `070_import_reads_link_suggestions.sql`,
  `071_audit_link_fk_indexes.sql`, then `072_dob_conflict_ownership.sql`.
  Migration 071 is therefore an existing historical migration and must not be
  renamed, edited, or duplicated at 073.
- Migrations 041 and 050 establish `CREATE INDEX IF NOT EXISTS` as the local FK
  index convention. Migration 071 follows it. A same-name, wrong-shape index
  could cause PostgreSQL to skip creation, but the database-backed catalogue
  acceptance test would still report the FK as uncovered; this is why that
  final gate remains mandatory.
- The runner is transaction-managed, so migration 071 correctly uses ordinary
  `CREATE INDEX`, never `CREATE INDEX CONCURRENTLY`.
- Indexes do not introduce a table, view, sequence, or new data-access surface.
  No grant or privilege-reconciliation step is required.

## Finding-by-finding evidence

### 1. `data_edits.admin_user_id -> auth_users.id`

- Definition: migration 057 declares
  `admin_user_id integer NOT NULL REFERENCES auth_users(id)`.
- Actions: neither `ON DELETE` nor `ON UPDATE` is specified, so PostgreSQL uses
  `NO ACTION` for both.
- Write/read paths: `recordDataEdit()` in `src/db/queries/audit-log.ts` inserts
  this required audit in the same import-role transaction as the mutation.
  Data-editor integration cleanup deletes `data_edits` rows and then deletes
  its test `auth_users` row.
- Pre-071 indexes: only `ix_data_edits_target(table_name, row_id)` existed. Its
  leading column is `table_name`, so it cannot support an equality probe on
  `admin_user_id`.
- Finding: genuinely missing before migration 071.
- Chosen shape: full B-tree
  `ix_data_edits_admin_user_id ON data_edits(admin_user_id)`. The FK column is
  `NOT NULL`; a partial predicate would exclude nothing and add no value.

### 2. `player_link_resolutions.admin_user_id -> auth_users.id`

- Definition: migration 056 declares
  `admin_user_id integer NOT NULL REFERENCES auth_users(id)`.
- Actions: default `NO ACTION` on delete and update.
- Write/read paths: linked and confirmed-unlinked decisions are appended in
  `src/db/queries/player-links.ts`. Integration cleanup removes resolution rows
  before deleting its test `auth_users` row.
- Pre-071 indexes: only `ix_plr_target(target_table, target_id)` existed. It
  does not lead with `admin_user_id`.
- Finding: genuinely missing before migration 071.
- Chosen shape: full B-tree
  `ix_plr_admin_user_id ON player_link_resolutions(admin_user_id)`. The column
  is `NOT NULL`, so excluding NULL rows would be meaningless.

### 3. `player_link_resolutions.player_id -> players.id`

- Definition: migration 056 declares nullable
  `player_id integer REFERENCES players(id)`.
- Actions: default `NO ACTION` on delete and update.
- Null semantics: `plr_action_player_ck` enforces that `linked` decisions name
  a player and `confirmed_unlinked` decisions store `player_id IS NULL`.
- Write/read paths: link resolution inserts a real `player_id`; confirmed-
  unlinked inserts NULL. Resolution/reload paths read the recorded player link.
  Integration cleanup contains row-by-row `DELETE FROM players` paths, so
  `players` is not a delete-free parent for this repository contract.
- Pre-071 indexes: `ix_plr_target(target_table, target_id)` does not lead with
  `player_id`; there was no equivalent covering index.
- Finding: genuinely missing before migration 071.
- Chosen shape: partial B-tree
  `ix_plr_player_id ON player_link_resolutions(player_id) WHERE player_id IS NOT NULL`.
  NULL means “this decision deliberately names no player” and those rows cannot
  match a parent-key referential probe.

### 4. `player_link_suggestions.resolved_by -> auth_users.id`

- Definition: migration 056 declares nullable
  `resolved_by integer REFERENCES auth_users(id)`.
- Actions: default `NO ACTION` on delete and update.
- Null semantics and paths: new suggestions are inserted with `resolved_by`
  NULL. `setSuggestionStatus()` fills it only when an admin accepts or dismisses
  the open suggestion. Integration cleanup deletes its test `auth_users` row.
- Pre-071 indexes: `ix_pls_status(status, created_at DESC)` and
  `ix_pls_target(target_table, target_id)` lead with other columns and cannot
  support a `resolved_by` probe.
- Finding: genuinely missing before migration 071.
- Chosen shape: partial B-tree
  `ix_pls_resolved_by ON player_link_suggestions(resolved_by) WHERE resolved_by IS NOT NULL`.
  Open, unresolved suggestions do not name a parent row and need no index entry.

## Why the nullable partial indexes are valid

For a parent-side delete or referenced-key update, PostgreSQL checks for child
rows equal to the non-NULL parent key. Equality to that key implies the child FK
is not NULL. PostgreSQL's predicate implication can therefore use a partial
index whose predicate is exactly `fk_column IS NOT NULL` for the referential
equality probe. Rows with a NULL FK are exempt from the ordinary single-column
FK match and cannot block the parent operation, so excluding them is complete,
not approximate coverage.

This is also the exact rule encoded by
`tests/integration/fk-indexes.test.ts`: it accepts a partial index only when its
predicate is the FK column(s) `IS NOT NULL`; it rejects unrelated partial
predicates. Migrations 041 and 050 use the same shape.

## Rejected exception-list rationale

No `DELETE_FREE_PARENTS` entry was added for either parent:

- `auth_users` is deleted row-by-row by integration cleanup paths and is not
  declared immutable by the schema or application contract.
- `players` also has row-by-row integration cleanup paths. Bulk importer
  `TRUNCATE ... CASCADE` behaviour does not make those row deletes disappear and
  is not a reason to silence every present and future FK to `players`.
- An exception is parent-wide in the existing test. Adding either parent would
  exempt future foreign keys as well as these four and would weaken the gate
  beyond the evidence.

The appropriate repair is the four small indexes, not a broad exemption.

## Implemented migration

`src/db/migrations/071_audit_link_fk_indexes.sql` contains exactly:

1. `ix_data_edits_admin_user_id` — full index.
2. `ix_plr_admin_user_id` — full index.
3. `ix_plr_player_id` — partial `WHERE player_id IS NOT NULL`.
4. `ix_pls_resolved_by` — partial `WHERE resolved_by IS NOT NULL`.

There are no unrelated indexes, DDL changes, grants, data changes, exception
entries, or concurrent index builds in the migration.

## DB-free validation

`tests/audit-link-fk-indexes.test.ts` proves from source that:

- migration 071 is unique and ordered between 070 and 072;
- migrations 056/057 still define the four expected FKs, parents, nullability,
  and no explicit action override;
- migration 071 contains exactly the four deterministic index names and shapes;
- no unrelated statement or index is present;
- nullable columns use only the safe `IS NOT NULL` predicate;
- the transaction-incompatible `CONCURRENTLY` keyword is absent;
- all four statements follow the repository's `IF NOT EXISTS` convention; and
- neither `auth_users` nor `players` is silenced in `DELETE_FREE_PARENTS`.

Focused result: **NOT RUN**. `node_modules`, `node_modules/.bin/vitest.cmd`, and
`node_modules/.bin/tsc.cmd` are absent in this worktree. Per the task boundary,
no dependency installation or registry-capable `npx` fallback was attempted.
The exact focused DB-free command to run once repository-local dependencies
are present is `npm test -- tests/audit-link-fk-indexes.test.ts`.

## Historical and remaining database validation

The issue ledger records a historical 2026-08-25 PostgreSQL run in which
migration 071 applied and `tests/integration/fk-indexes.test.ts` passed 2/2.
That evidence is preserved, but the current acceptance proof cannot be rerun
while ISSUE-093 owns the empty/reset `afldb_test` state.

After `afldb_test` is rebuilt and available, the exact outstanding acceptance
command is:

```bash
npm test -- tests/integration/fk-indexes.test.ts
```

Do not run migrations as part of this ISSUE-073 handoff. The rebuilt test
database must already include the current migration sequence before the test is
accepted.

## Remaining risk

- Current PostgreSQL catalogue state and actual planner eligibility have not
  been re-proven after the ISSUE-093 reset.
- `IF NOT EXISTS` follows repository precedent but can skip a conflicting
  same-name object; the outstanding catalogue test is the backstop for that
  case.
- Windows DB-free source validation is not a substitute for the Linux/
  PostgreSQL acceptance test.

No application query semantics, data, privileges, or unrelated issue work are
changed by this repair.
