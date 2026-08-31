-- =====================================================================
-- 073 - Durable Admin Overrides
-- =====================================================================
-- Resolves AFLDB-ISSUE-086 by separating the state of an active human
-- override from the append-only data_edits audit log.
--
-- Overrides are bound to the natural key of the entity, not the surrogate
-- ID, so they survive source reloads even if the row is rekeyed.
-- =====================================================================

CREATE TABLE data_overrides (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entity_type     text   NOT NULL CHECK (entity_type IN ('players', 'matches', 'draft_picks')),
  entity_key      text   NOT NULL,
  field_group     text   NOT NULL,
  override_values jsonb  NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  admin_user_id   integer NOT NULL REFERENCES auth_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_overrides_uq UNIQUE (entity_type, entity_key, field_group)
);

COMMENT ON TABLE data_overrides IS
  'Durable human-admin overrides for source-owned fields. Resolves AFLDB-ISSUE-086.';

CREATE INDEX ix_data_overrides_entity ON data_overrides (entity_type, entity_key) WHERE is_active = true;

-- Importers must be able to read active human override authority during reloads.
-- SELECT only: data_overrides is not importer-owned and must not enter
-- afldb_meta.import_writable_tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT ON data_overrides TO afldb_import;
  END IF;
END
$$;
