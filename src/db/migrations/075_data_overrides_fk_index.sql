-- =====================================================================
-- AFLDB 075 — Index the foreign key migration 073 left uncovered
-- =====================================================================
-- Migration 073 (AFLDB-ISSUE-086) declared
--
--   data_overrides.admin_user_id → auth_users   (NOT NULL)
--
-- and created only ix_data_overrides_entity, which leads with
-- (entity_type, entity_key). No index leads with admin_user_id, so the
-- referential probe behind a parent-side auth_users delete sequentially
-- scans data_overrides. tests/integration/fk-indexes.test.ts reports it.
--
-- auth_users is explicitly deletable and deliberately absent from that
-- test's DELETE_FREE_PARENTS; migration 071 indexed
-- data_edits.admin_user_id on exactly those grounds. This is the same
-- miss, one table later, and is caught up here on the same terms.
--
-- NOT NULL column, so an unconditional index — the shape migrations 041
-- and 071 established. No predicate: every row names an acting admin,
-- so the partial WHERE col IS NOT NULL form would exclude nothing.
--
-- Migration 073 is applied and checksum-baselined and is NOT edited;
-- this repair is forward-only.
-- =====================================================================

-- data_overrides.admin_user_id — NOT NULL; every durable override names
-- the admin who authored it. Deleting an auth_users row scans
-- data_overrides without this index.
CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);
