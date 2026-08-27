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
