-- ---------------------------------------------------------------------
-- 078 — atomic Data Editor writes to durable admin overrides
--       (AFLDB-ISSUE-109)
-- ---------------------------------------------------------------------
-- saveEdit() applies the statistical mutation, durable override, and
-- required data_edits audit in one afldb_import transaction. Migration
-- 073 granted the mutation role SELECT for importer replay but omitted
-- the narrowly scoped write capability that this admin transaction also
-- needs.
--
-- data_overrides remains human-admin-owned and deliberately stays out of
-- afldb_meta.import_writable_tables: that registry would grant full DML
-- and TRUNCATE. Grant only the columns used by saveEdit's INSERT ... ON
-- CONFLICT DO UPDATE, plus nextval() access to the identity sequence.
-- Mirrored after the fail-closed revoke loop in privileges.sql.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT INSERT (
      entity_type, entity_key, field_group, override_values,
      admin_user_id, is_active, updated_at
    ) ON data_overrides TO afldb_import;

    GRANT UPDATE (
      override_values, admin_user_id, is_active, updated_at
    ) ON data_overrides TO afldb_import;

    GRANT USAGE ON SEQUENCE data_overrides_id_seq TO afldb_import;
  END IF;
END
$$;
