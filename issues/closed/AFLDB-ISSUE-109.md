# AFLDB-ISSUE-109 — Data Editor override write-role mismatch

## Status

- **State:** **Resolved — 2026-08-30.** Automated, database-backed, restricted-role, atomic-audit, typecheck, and authenticated development runtime acceptance all passed.
- **Resolved:** 2026-08-30
- **Severity:** Medium
- **Area:** Admin / Privileges / Data integrity
- **Scope:** The generic Data Editor `saveEdit()` path only. Public/core reads are not implicated.
- **Constraints:** No frozen-migration edits, hand grants, broad grants, production work, destructive database commands, or ISSUE-102/104 work.

## Problem

`saveEdit()` applies an allowlisted statistical edit, persists the durable human override, and appends the required audit row in one transaction opened with `AFLDB_IMPORT_DATABASE_URL`. The transaction fails when it reaches the `data_overrides` upsert because migration 073 and `tools/maintenance/privileges.sql` grant `afldb_import` only `SELECT` on that table.

Known live evidence from the originating report:

| Role | `SELECT` | `INSERT` | `UPDATE` |
|---|---:|---:|---:|
| `afldb_app` | false | false | false |
| `afldb_import` | true | false | false |

Before migration 073 existed in the development database the same path failed because the relation was absent. Applying 073 exposed the already-committed permission contradiction; it did not create a public/core regression.

## Data flow

```text
/admin/data-editor
  -> saveDataEdit server action
  -> saveEdit validation / smart diff
  -> one afldb_import transaction
       -> update allowlisted canonical statistical row
       -> resolve stable natural key
       -> read and upsert data_overrides       [permission failure]
       -> insert append-only data_edits audit
       -> recompute affected derived data
  -> route revalidation
```

The transaction boundary is material: migration 066 (`AFLDB-ISSUE-027`) explicitly moved required audit writes onto the mutation transaction so an audit failure rolls the canonical mutation back.

## Evidence — iteration 1

### Source and schema

- `src/db/queries/data-edits.ts:161-270`: `saveEdit()` creates a short-lived `postgres(AFLDB_IMPORT_DATABASE_URL)` client and performs the canonical edit, `data_overrides` read/upsert, and `recordDataEdit()` inside one `begin()` callback.
- `src/db/migrations/073_data_overrides.sql:29-36`: grants `SELECT` only to `afldb_import`; states that human overrides are not importer-owned and must not enter `afldb_meta.import_writable_tables`.
- `tools/maintenance/privileges.sql:295-300`: the reconciler restores only `SELECT` on `data_overrides` after its fail-closed importer revoke loop.
- `src/db/migrations/057_data_edits.sql`: defines the Data Editor statistical write as running on `afldb_import`; grants the separate `afldb_auth` role access to the append-only audit table.
- `src/db/migrations/066_atomic_audit_import_grants.sql`: deliberately gives `afldb_import` only `INSERT` plus sequence use on `data_edits` and `player_link_resolutions`, outside `import_writable_tables`, so required audit and statistical writes commit atomically without handing the importer broad operational-table DML.
- `src/db/migrations/045_import_write_is_fail_closed.sql`: the importer registry grants full DML and `TRUNCATE`; therefore registering `data_overrides` would violate the human-ownership boundary.

### Historical intent

`issues/closed/AFLDB-ISSUE-086.md` defines:

- external sources as canonical for unedited fields;
- `data_overrides` as authoritative human-override state keyed by stable natural identity;
- importer access as read/replay access;
- importer validation as `SELECT`-only and outside the broad writable registry.

### Existing mutation paths

Initial graph/source inspection shows successful Data Editor statistical mutations such as match creation, player creation, match-sheet save, and awards administration also use `AFLDB_IMPORT_DATABASE_URL`, then append their required audit within the same transaction. The ordinary application role is read-only. `afldb_auth` owns operational admin/audit tables but is read-only on the statistical tables `saveEdit()` must update.

## Hypotheses

1. **Wrong connection / use an existing admin writer.** Rejected. Direct inspection of `.env.example`, `src/db/client.ts`, `src/db/authClient.ts`, and all application `*DATABASE_URL` uses found only these runtime boundaries: `afldb_app` (public read), `afldb_auth` (operational auth/admin writes), and `afldb_import` (statistical mutations). `afldb_auth` deliberately has no write privilege on the canonical statistical tables, while the owner credential is reserved for migrations/maintenance. No existing separate role can perform all three required writes in one transaction.
2. **Narrow exceptional grant to the existing mutation role.** Accepted. Migration 057 explicitly assigns Data Editor statistical writes to `afldb_import`; migration 066 calls it the mutation role and establishes exact, out-of-registry operational grants when atomicity requires them. `saveEdit()` is another instance of that proven pattern.

## Rejected approaches

- **Hand-granting the development database:** rejected; the reconciler would remove an unmodelled grant and schema state would diverge.
- **Editing migration 073:** rejected; it is applied/checksum-frozen and the repair must be forward-only.
- **Registering `data_overrides` with `afldb_meta.grant_import_write()`:** rejected; that grants `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` plus broad sequence rights, contradicting ISSUE-086's human-ownership boundary.
- **Splitting canonical, override, and audit writes across independent role connections:** rejected unless an existing atomic database abstraction is found; it would recreate ISSUE-027's partial-commit defect.
- **Moving the transaction to `afldb_auth`:** rejected; that would require widening the auth/session credential across the editable statistical tables and derived-write dependencies, weakening the separation that protects historical data from an auth-path compromise.
- **Using `AFLDB_OWNER_DATABASE_URL` in the served application:** rejected; it would expose the schema-owner credential to a request path and collapse all database privilege boundaries.
- **Creating a new admin-writer role for this repair:** rejected as the immediate fix. It could be a future defence-in-depth redesign, but it is not an existing authorised path and would require new role provisioning, environment/config/deployment work, and a carefully enumerated cross-table grant set. ISSUE-109 has a smaller correct repair consistent with the established mutation-role architecture.

## Architectural decision

Keep the complete `saveEdit()` transaction on `afldb_import`, the repository's existing statistical mutation role, and add a forward-only exceptional grant modelled on migration 066.

The grant is **capability for the Data Editor transaction**, not ownership transfer:

- `data_overrides` remains human-admin-owned and outside `afldb_meta.import_writable_tables`;
- retain the existing table-wide `SELECT` needed by importer replay and the editor's smart merge;
- grant `INSERT` only on the columns named by the upsert: `entity_type`, `entity_key`, `field_group`, `override_values`, `admin_user_id`, `is_active`, `updated_at`;
- grant `UPDATE` only on the conflict-update columns: `override_values`, `admin_user_id`, `is_active`, `updated_at`;
- grant `USAGE` only on `data_overrides_id_seq`, sufficient for the identity default;
- grant no `DELETE`, `TRUNCATE`, table-wide `INSERT`/`UPDATE`, sequence `SELECT`/`UPDATE`, or schema/default privilege;
- mirror the exception after the reconciler's fail-closed revoke loop so reconciliation preserves exactly this shape.

This retains canonical edit + durable override + required audit atomicity and preserves least privilege within the current role model.

## Implementation — iteration 2

Implemented the planned patch without changing `saveEdit()` itself:

1. `src/db/migrations/078_data_overrides_admin_write.sql` adds the forward-only column/sequence grants decided above.
2. `tools/maintenance/privileges.sql` restores the identical exception after its fail-closed importer revoke loop.
3. `tests/data-overrides-source-contract.test.ts` pins the exact migration/reconciler grant shape and rejects registry/broad/sequence-reset grants.
4. `tests/integration/privileges.test.ts` checks table-wide privileges remain absent, the exact insert/update columns, usage-only sequence access, and absence from `import_writable_tables`.
5. `tests/integration/data-editor.test.ts` runs `saveEdit()` through the restricted importer-role harness on a match with no pre-existing notes override. It verifies canonical value, inserted override, audit, conflict-update restoration, and cleans the exact canonical/override/audit state in `finally`.
6. `tests/reference-data.test.ts` now describes the unregistered table's narrow ISSUE-109 exception accurately; the existing registry assertion remains unchanged.

## Validation

### Performed

- Confirmed Codebase Memory project `D-dev-afldb-issue-109` is ready at root `D:/dev/afldb-issue-109` (10,949 nodes / 37,280 edges).
- Tier 2 graph discovery and call tracing located `saveEdit()` and its only application caller, `saveDataEdit`.
- Material graph findings above were checked directly in the named source, migrations, privilege reconciler, and ISSUE-086 record.
- Dependency-free source assertion passed: migration/reconciler grant parity, forbidden broad-grant scan, regression markers, and migration order (`078` last).
- User-run migration 078 application to `afldb_test`: **PASS**.
- Post-application migration status: **78/78 applied, 0 pending**.
- `db:privileges:test`: **PASS**.
- `tests/data-overrides-source-contract.test.ts`: **PASS, 7/7**.
- `tests/integration/privileges.test.ts`: **PASS, 30/30**.
- `tests/integration/data-editor.test.ts`: **PASS, 9/9, 0 skipped**.
- Restricted `afldb_import` match-sheet mutation + required audit: **PASS**.
- Restricted `afldb_import` durable override insert + conflict-update: **PASS**.
- Required canonical mutation + durable override + `data_edits` audit atomicity: **PASS**.
- Typecheck: **PASS**.

### Final authenticated development runtime gate — PASS

The authenticated development-only procedure below is retained as the acceptance runbook. It
completed successfully on 2026-08-30. The executed fixture identity and audit sequence in
**Final execution evidence** are authoritative; they supersede the initially planned 2100
fixture values where the two differ. No production environment was used.

#### Prerequisite/runtime setup

1. Confirm the worktree's `DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`,
   `AFLDB_AUTH_DATABASE_URL`, and `AFLDB_OWNER_DATABASE_URL` all target the intended
   non-production development database (`afldb_dev` in the repository examples). Do not use
   `afldb_test` for this browser gate and do not set a production migration target.
2. From `D:\dev\afldb-issue-109` in PowerShell, apply/reconcile the already-validated change
   to the development database and start this worktree's development runtime:

   ```powershell
   Set-Location D:\dev\afldb-issue-109
   npm.cmd run db:status
   npm.cmd run db:migrate
   npm.cmd run db:status
   npm.cmd run db:privileges
   npm.cmd run dev
   ```

   The second status must report 78/78 applied and 0 pending, privilege reconciliation must
   finish without error, and the runtime must listen on port 3100. Run the browser and
   read-only evidence checks while `npm.cmd run dev` remains active.
3. Open `http://localhost:3100/admin/data-editor`, authenticate through the normal development
   login flow as a real super admin, and keep the browser console plus development-server log
   visible for the save/reload/restore interval.

#### Preflight result and fixture-lifecycle decision

The user-run development preflight returned zero active `matches` / `notes` overrides whose
payload contains `notes`. No arbitrary historical match may be adopted.

Direct source verification establishes the lifecycle that follows:

- the first changed Notes save on a row with no override inserts one active
  `data_overrides` row;
- the restoring save reads that row, replaces `override_values.notes` with the baseline, and
  explicitly sets `is_active = true` again;
- the supported Delete Match transaction deletes `player_achievements`,
  `player_match_stats`, `match_period_scores`, and `matches`, but does not read, deactivate, or
  delete `data_overrides`;
- `data_overrides` is keyed by natural identity and has no foreign key to `matches`, so deleting
  a post-test match would strand an active override;
- the integration test's owner-role deletion of its temporary override and audit rows is
  test-database teardown, not an application-supported `afldb_dev` cleanup procedure;
- a bounded direct search of the application found no override-release/deactivation action.

Therefore the safe supported strategy is a clearly synthetic, future-dated development-only
match that is intentionally **retained** as the ISSUE-109 runtime fixture. Restore its Notes
through the Data Editor, preserve its append-only audits, and retain its one active baseline
override. Do not use Delete Match for this fixture. If zero retained fixture data is required,
do not run the browser gate until a separately approved, audited application action for
releasing/deactivating an override exists.

#### Planned fixture identity and creation — superseded by the executed fixture

The pre-execution plan specified these constants. The final accepted run used the dedicated
retained 2026 fixture recorded below instead:

- season: `2100`;
- round type: `Regular Season (Home & Away)`;
- round number/code: `30` / generated `R30`;
- match date: `2100-12-31`;
- home club: `Collingwood`;
- away club: `Carlton`;
- venue: `Melbourne Cricket Ground`;
- home and away goals, behinds, and total scores: `0`;
- attendance, time, quarter scores, and match event: blank;
- baseline Notes and creation marker:
  `AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN`;
- temporary Notes:
  `AFLDB-ISSUE-109 AUTHENTICATED RUNTIME CHECK — TEMPORARY`;
- validation audit note: `AFLDB-ISSUE-109 authenticated runtime validation`;
- restoration audit note: `AFLDB-ISSUE-109 authenticated runtime restore`.

Before creation, run this read-only preflight against `afldb_dev`:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT c.id,
       c.name,
       afldb_identity_for_season(c.organization_id, 2100) AS active_identity_id
  FROM clubs c
 WHERE c.name IN ('Collingwood', 'Carlton')
 ORDER BY c.name;

SELECT id, canonical_name
  FROM venues
 WHERE canonical_name = 'Melbourne Cricket Ground';

SELECT m.id,
       m.match_key,
       m.notes,
       hc.name AS home_club,
       ac.name AS away_club,
       (SELECT count(*)
          FROM data_overrides o
         WHERE o.entity_type = 'matches'
           AND o.entity_key = m.match_key
           AND o.field_group = 'notes') AS notes_override_rows,
       (SELECT count(*)
          FROM data_edits de
         WHERE de.table_name = 'matches'
           AND de.row_id = m.id
           AND de.field_group = 'match_creation'
           AND de.note =
             'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN')
         AS matching_creation_audits
  FROM matches m
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
 WHERE m.season = 2100
   AND m.round_code = 'R30'
   AND m.round_number = 30
   AND m.match_date = DATE '2100-12-31'
   AND hc.name = 'Collingwood'
   AND ac.name = 'Carlton';

COMMIT;
```

The two club rows must each report their own ID as `active_identity_id`, the venue query must
return exactly one row, and the match query determines the branch:

1. If it returns exactly one row with the exact baseline Notes, one matching creation audit,
   and `notes_override_rows = 0`, that row is the intentionally disposable-before-use fixture;
   record and use its ID.
2. If it returns zero rows, create the fixture once through `/admin/data-editor` →
   **+ Add new match**, using every exact value above. Record the `Created match #<ID>` result.
3. If it returns a row with different values/ownership, more than one row, or any override row,
   stop. Do not adopt, overwrite, delete, or work around that state.

Creation is itself application-supported and audited. It creates/retains the future development
season and its derived rows, so the fixture is intentionally persistent rather than pretending
to be ephemeral. After creation, open its generic editor directly at
`/admin/data-editor?entity=matches&id=<MATCH_ID>`.

#### Read-only baseline capture before the Notes save

Run the following after selecting/creating the fixture and before changing Notes:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT m.id,
       m.match_key,
       m.season,
       m.round_code,
       m.round_number,
       m.match_date,
       hc.name AS home_club,
       ac.name AS away_club,
       m.home_goals,
       m.home_behinds,
       m.home_score,
       m.away_goals,
       m.away_behinds,
       m.away_score,
       m.notes,
       (m.notes IS NULL) AS notes_is_null
  FROM matches m
  JOIN clubs hc ON hc.id = m.home_club_id
  JOIN clubs ac ON ac.id = m.away_club_id
 WHERE m.id = <MATCH_ID>;

SELECT o.id,
       o.entity_key,
       o.override_values,
       o.is_active,
       o.admin_user_id,
       o.created_at,
       o.updated_at
  FROM data_overrides o
  JOIN matches m ON m.match_key = o.entity_key
 WHERE m.id = <MATCH_ID>
   AND o.entity_type = 'matches'
   AND o.field_group = 'notes'
 ORDER BY o.id;

SELECT de.id,
       de.field_group,
       de.old_values,
       de.new_values,
       de.admin_user_id,
       de.note,
       de.created_at
  FROM data_edits de
 WHERE de.table_name = 'matches'
   AND de.row_id = <MATCH_ID>
   AND de.note IN (
     'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN',
     'AFLDB-ISSUE-109 authenticated runtime validation',
     'AFLDB-ISSUE-109 authenticated runtime restore'
   )
 ORDER BY de.id;

COMMIT;
```

For a fresh fixture, PASS baseline is the exact match row, zero Notes override rows, exactly one
`match_creation` audit with the creation marker, and no validation/restoration audits.

#### Save and reload

1. Open `/admin/data-editor` in the development deployment and confirm the authenticated super-admin UI loads normally.
2. Open `/admin/data-editor?entity=matches&id=<MATCH_ID>`, open **Notes**, and replace the
   baseline marker with the temporary marker.
3. Enter the first audit note and press **Save** once.
4. Confirm the pending state clears and the UI reports `Saved` with the Notes old → new summary; there must be no permission-denied or generic save error.
5. Hard reload the page, then navigate away and reopen the same match/group through `/admin/data-editor`. Confirm the temporary marker remains visible without an application restart.
6. Confirm the database state with the read-only final-state queries below:
   - `matches.notes` equals the temporary marker;
   - a new active `data_overrides` row has `override_values.notes` equal to the marker and names the signed-in admin;
   - one `data_edits` row exists for table `matches`, the match ID, field group `notes`, and the first audit note, with the recorded baseline in `old_values.notes` and the marker in `new_values.notes`.
7. Confirm the browser console and server logs contain no page error, Server Action failure, PostgreSQL permission error, or unhandled rejection for the save/reload interval.

#### Restore and recheck

1. Through the same authenticated UI, set Notes back to the exact dedicated baseline marker.
2. Enter the restore audit note and press **Save** once.
3. Confirm the pending state clears and the UI reports `Saved` with marker → baseline.
4. Hard reload, navigate away, reopen the same match/group, and confirm the original value is displayed.
5. Confirm with read-only database inspection:
   - `matches.notes` equals the exact dedicated baseline marker;
   - the newly inserted `data_overrides` row still exists, remains active, and
     `override_values.notes` equals the baseline marker;
   - a second `data_edits` row records marker → baseline under the restore audit note;
   - no duplicate override row or unexpected audit row was created.
6. Recheck console/server logs for the restoration interval; there must be no permission or runtime error.

Use this exact final-state query after the restoration reload:

```sql
BEGIN TRANSACTION READ ONLY;

SELECT m.id,
       m.match_key,
       m.notes,
       (m.notes IS NULL) AS notes_is_null,
       o.id AS override_id,
       o.override_values,
       o.is_active,
       o.admin_user_id,
       o.created_at,
       o.updated_at
  FROM matches m
  LEFT JOIN data_overrides o
    ON o.entity_type = 'matches'
   AND o.entity_key = m.match_key
   AND o.field_group = 'notes'
 WHERE m.id = <MATCH_ID>;

SELECT count(*) AS override_rows,
       count(*) FILTER (WHERE o.is_active) AS active_override_rows
  FROM data_overrides o
  JOIN matches m ON m.match_key = o.entity_key
 WHERE m.id = <MATCH_ID>
   AND o.entity_type = 'matches'
   AND o.field_group = 'notes';

SELECT de.id,
       de.field_group,
       de.old_values,
       de.new_values,
       de.admin_user_id,
       de.note,
       de.created_at
  FROM data_edits de
 WHERE de.table_name = 'matches'
   AND de.row_id = <MATCH_ID>
   AND de.note IN (
     'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN',
     'AFLDB-ISSUE-109 authenticated runtime validation',
     'AFLDB-ISSUE-109 authenticated runtime restore'
   )
 ORDER BY de.id;

COMMIT;
```

The pre-execution target was the exact baseline Notes, `{ "notes": <exact baseline marker> }`
in one active override row, and a coherent append-only audit chain. The accepted run included
one additional, explained correction save; see **Final execution evidence**.

#### PASS evidence

PASS requires all of the following in one recorded run:

- authenticated super-admin route and editor loaded;
- first save completed and pending state cleared;
- success summary showed the correct baseline → marker change;
- hard reload plus normal navigation/reopen showed the marker;
- canonical `matches.notes`, active override payload, admin identity, and first audit row agreed;
- restoration save completed and pending state cleared;
- hard reload plus normal navigation/reopen returned to the exact baseline;
- canonical value and active override payload returned to the exact dedicated baseline marker;
- the append-only creation and Notes audit rows form a complete sequence whose final state agrees
  with the canonical row and active override;
- no duplicate override, permission error, Server Action error, console/page error, or restart/manual rebuild requirement.

Screenshots or a concise transcript should record the two success summaries and the post-reload values. Read-only query/log output should record the override/audit agreement without exposing credentials or DSNs.

Successful completion of every PASS condition, including the verified restoration below, was
sufficient to mark ISSUE-109 **Resolved**. No additional database-backed, migration,
privilege, integration, typecheck, or authenticated runtime gate remains. Both ledgers and the
changelog are updated, and this runbook is retained in `issues/closed/`.

#### Cleanup and restoration — complete

- The canonical Notes field was restored through the authenticated Data Editor and verified
  after reload/navigation; no manual SQL mutation was used for validation or restoration.
- Preserve audit rows 22–25. They are append-only records of the actual admin actions and must
  not be deleted or rewritten.
- Retain match `17059` and its one active baseline override. The active override remaining after
  restoration is the durable-authority contract for this dedicated development fixture, not
  failed cleanup.
- Do **not** use Delete Match: it would remove the match but leave an active natural-key override.
- Do not run owner-role `DELETE`/`UPDATE` cleanup against `data_overrides`, `data_edits`, or the
  fixture. Full fixture removal remains unsupported without a separately approved application
  action that releases/deactivates the override with its own audit before supported match
  deletion; direct SQL is not a substitute.

#### Final execution evidence — PASS (2026-08-30)

The final `afldb_dev` acceptance used this intentionally retained development-only fixture:

- match ID: `17059`;
- match key: `2026|R30|2026-12-31|104|103`;
- match: Collingwood v Carlton, `2026-12-31`;
- exact baseline Notes:
  `AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN`.

Development migration 078 applied successfully, migration status reported **78/78 applied,
0 pending**, and privilege reconciliation completed successfully. An authenticated super-admin
then completed the Data Editor flow:

- the initial save succeeded without a permission-denied, Server Action, page, or server error;
- the saved value survived hard reload and navigation/reopen;
- the first durable override `INSERT` succeeded;
- the subsequent conflict-path override `UPDATE` succeeded;
- restoration to the exact baseline through the same UI succeeded;
- no manual SQL mutation was used for the runtime validation or restoration.

Read-only final-state evidence reported:

- `canonical_restored = true`;
- `override_rows = 1`;
- `active_override_rows = 1`;
- `override_restored = true`.

The retained active override is intentional for the dedicated development fixture. The actual
append-only audit history, all under `admin_user_id = 4`, is:

| Audit row | Field/change | Audit-note evidence |
|---|---|---|
| `22` | `match_creation` | Dedicated fixture creation audit. |
| `23` | Baseline Notes → `AFLDB-ISSUE-109 authenticated runtime validation` | The intended audit text was entered into the Notes value on the first runtime save. |
| `24` | That value → `AFLDB-ISSUE-109 AUTHENTICATED RUNTIME CHECK — TEMPORARY` | Source/audit note is blank because this was the correction save. |
| `25` | Temporary marker → exact retained baseline | Note: `AFLDB-ISSUE-109 authenticated runtime restore`. |

The extra intermediate edit is an accurately retained operator-input correction, not an
application defect: throughout the sequence the canonical Notes value, durable override, and
append-only audit remained consistent. The final canonical value and override payload both
equal the exact retained baseline.

All ISSUE-109 acceptance gates are therefore complete. This evidence is sufficient to resolve
the issue; no database, migration, privilege, integration, typecheck, or authenticated runtime
gate remains.

## Remaining risk

- The existing architecture intentionally reuses the importer credential as the statistical mutation credential. A dedicated admin-writer role could reduce credential blast radius, but introducing it is broader than this repair and is not required to restore the established transaction safely.
- The application has no supported action to release/deactivate a durable override. This does
  not block the retained development-fixture strategy, but it means full fixture removal would
  require separately approved application work; Delete Match alone is unsafe after the Notes
  override exists.
- No acceptance uncertainty remains. Automated, database-backed, catalogue, restricted-role
  integration, atomic-audit, typecheck, and authenticated development runtime gates are green.
- The retained development fixture and active baseline override are intentional durable test
  state. Their unsupported full-removal lifecycle is documented above and is non-blocking for
  ISSUE-109's resolution.
