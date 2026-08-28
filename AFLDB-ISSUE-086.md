# AFLDB-ISSUE-086

## Findings
- **Data edits to source-owned rows are silently reverted** when the owning source is reloaded.
- `data_edits` is currently a ledger of audit events (old vs new values), unsuitable for serving as a durable override state. Surrogate IDs like `row_id` would fail to reattach to rows if the source data is temporarily lost and recreated.
- `players.id` is a surrogate ID and not a safe natural identity.
- ISSUE-093 retired legacy `import_draft.py`; durable override replay is integrated into the supported canonical DraftGuru importer `tools/rebuild/draftguru/import_draftguru.py`.

## Plan / Architecture
- **Durable Source of Truth (`data_overrides`)**: Introduced `073_data_overrides.sql` containing `data_overrides` mapping an `entity_type`, `entity_key` (natural key), and `field_group` to an `override_values` JSONB payload.
- **Natural Key Resolution (`saveEdit`)**:
  - Matches: `match_key`
  - Players: Uses `afltables:<external_id>` from `external_identities` (status unique/resolved). Missing/ambiguous identity fails closed (not durably stored, since they aren't source-owned).
  - Draft Picks: `source_id|player_url|draft_year|draft_kind`
- **Smart Diffing**: `saveEdit` diffs incoming fields against `before` and merges only changed values into `override_values`, preventing accidental freezing of sibling fields.
- **Replay at Import**: Added `replay_admin_overrides` in `tools/migration/common.py`. It uses the importer's existing `psycopg.Connection` and does NOT commit independently.

## Semantic Rules
1. **Authoritative source**: External sources remain canonical for unedited fields. If an override exists, it masks the source value without permanently deleting it from the raw staging tables.
2. **Authoritative human override**: Stored in `data_overrides`, bound to the entity's natural key.
3. **NULL/Absent Semantics**:
   - Absent key (missing from JSONB): Returns source value.
   - Present key + JSON null: Forces SQL `NULL` for fields where domain permits explicit NULL.
   - Used `jsonb_exists(o.override_values, 'field')` in replay SQL to distinguish absent vs explicit JSON null.
   - Fields allowing NULL: `given_name`, `surname`, `dob`, `height_cm`, `weight_kg`, `attendance`, `match_time`, `match_event`, `notes`, `original_club_raw`, `draft_age`, `pick_note`, `detail`.
   - Fields forbidding NULL (NOT NULL): `display_name`, `home_goals`, `away_goals`, `player_name_raw`. These safely use `COALESCE`.
4. **DraftGuru Integration**: The supported canonical DraftGuru importer calls `replay_admin_overrides(pg, "draft_picks")` after source reconciliation and before reload reporting/transaction completion.

## Validation
- DB-free source-contract suite passed: `tests/data-overrides-source-contract.test.ts` — **6/6**.
- Migration `073_data_overrides.sql` applied successfully to `afldb_test`.
- Restricted importer role `afldb_import` can read `data_overrides`; access is SELECT-only and remains outside `afldb_meta.import_writable_tables`.
- Direct restricted-role replay proof succeeded: `replay_admin_overrides(..., "draft_picks")` restored the durable `pick_note` override.
- Canonical DraftGuru destructive-reload acceptance test passed:
  `replays a durable admin override after a destructive DraftGuru reload`.
- Privilege reconciliation explicitly re-grants SELECT-only access to `data_overrides` for `afldb_import`.

- **Status**: Resolved — implementation and DB-backed acceptance validated 2026-08-28.
  *(Reopened 2026-08-28 for a separate schema defect only — see "Reopened
  2026-08-28" below — and **re-resolved the same day**; see "Re-resolution
  2026-08-28" at the end of this document. The original resolution evidence and
  implementation record above stand unchanged: the reopening was never about the
  override behaviour.)*

## Reopened 2026-08-28 — `data_overrides(admin_user_id)` has no covering index

### Post-resolution validation (all passed)
- Migration checksum-baseline repair completed successfully.
- Clean rebuild through migration 073 passed final validation **13/13**.
- Migration status **73/73, 0 pending, no drift**.
- DB-free source contract: **6/6**.
- Restricted-role DraftGuru integration: **19/19**.

### New proven defect
`tests/integration/fk-indexes.test.ts` is **1/2**: the coverage case reports
`data_overrides(admin_user_id) -> auth_users` as having no index the referential
check can use. Migration 073 declares
`admin_user_id integer NOT NULL REFERENCES auth_users(id)` and creates only
`ix_data_overrides_entity ON data_overrides (entity_type, entity_key) WHERE is_active = true`,
which does not lead with `admin_user_id`. `auth_users` is deliberately absent
from that test's `DELETE_FREE_PARENTS` — migration 071 says so outright and
indexed `data_edits.admin_user_id` on exactly those grounds — so a parent-side
`auth_users` delete sequentially scans `data_overrides`.

The suite's second case (`keeps the exemption list free of entries that no
longer apply`) is unaffected and passes.

### Forward repair
`src/db/migrations/075_data_overrides_fk_index.sql`:

```sql
CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);
```

Unconditional, non-unique, non-partial, no `CONCURRENTLY` — the shape
migrations 041 and 071 established for a NOT NULL foreign-key column.
Migration 073 is **not** edited: it is applied and checksum-baselined, so the
repair is forward-only.

### Application order — 074 then 075, both applied 2026-08-28
Migration 075 was deliberately **held** until `AFLDB-ISSUE-096`'s migration 074
could apply first, so the two pending migrations would land in normal filename
order rather than 075 jumping ahead of a lower-numbered pending file. Once 074
was ready the ordered run succeeded:

```text
074_source_observation_spine.sql ... ok
075_data_overrides_fk_index.sql ... ok
Applied 2 migration(s).
```

Post-apply ledger state, `afldb_test`:

```text
75 migration file(s), 75 already applied
0 pending.
```

**No checksum drift.** Migration 073 was **not edited after application** at any
point: the repair is forward-only, which is why it is a new migration rather
than a change to 073.

### Validation of the repair
- `tests/data-overrides-source-contract.test.ts` extended (still one suite, the
  existing `Migration/schema contract` test) to prove migration 075 exists,
  creates `ix_data_overrides_admin_user_id`, targets `data_overrides`, indexes
  `admin_user_id` as the leading/only key, uses `IF NOT EXISTS`, and is not
  unique, not partial and not `CONCURRENTLY`. Command:
  `npm test -- tests/data-overrides-source-contract.test.ts`.
- **DB-backed catalogue validation now GREEN: `tests/integration/fk-indexes.test.ts`
  2/2 passed** against `afldb_test`. That suite interrogates `pg_catalog` rather
  than asserting index names, so both of its cases carry weight: every foreign
  key whose parent can be deleted from has a usable leading-column index, and no
  stale `DELETE_FREE_PARENTS` exemption remains. The suite itself was never
  modified to obtain the pass.
- Privilege reconciliation completed successfully.
- Post-migration fingerprint, `afldb_test`:
  `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.

### Re-resolution 2026-08-28
- **Status**: **Resolved 2026-08-28.**
- **What was reopened, and what was not.** The reopening was **solely** the
  missing supporting index on `data_overrides(admin_user_id) -> auth_users(id)` —
  a schema-coverage omission in migration 073. It was **never** a defect in the
  durable admin-override behaviour. That behaviour was validated at the original
  resolution and **remains validated**: `tests/data-overrides-source-contract.test.ts`
  **6/6** and `tests/integration/draftguru-import.test.ts` **19/19**, the latter
  proving under the restricted importer role that an admin override survives a
  destructive source reload. Nothing above supersedes that record.
- **How it was repaired.** Forward-only in
  `src/db/migrations/075_data_overrides_fk_index.sql`, with 073 left untouched
  after application; 075 held until 074 could apply first; 074 then 075 applied
  cleanly; ledger now **75/75, 0 pending, no drift**; FK catalogue gate **2/2**.
- **Scope of the evidence.** All of it is from **`afldb_test`**. No production
  or `afldb_dev` application is claimed by this record.
