-- ---------------------------------------------------------------------
-- 057 — manual data edits by a super admin
-- ---------------------------------------------------------------------
-- The editable-field allowlist lives in src/lib/edit/spec.ts; the write
-- itself runs as afldb_import on a short-lived connection, the same
-- single path every statistical write takes (promoteSubmission,
-- resolveLink). This migration adds only the audit: one append-only row
-- per saved edit, with the old and new values snapshotted, following
-- 056's player_link_resolutions exactly.
--
-- table_name is CHECKed against the entities the editor currently
-- serves; widen the CHECK in the migration that registers a new entity.
-- ---------------------------------------------------------------------

CREATE TABLE data_edits (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  table_name      text   NOT NULL CHECK (table_name IN ('players', 'matches')),
  row_id          bigint NOT NULL CHECK (row_id > 0),
  -- A field key ('dob', 'attendance') or a coupled-group key ('score').
  field_group     text   NOT NULL,
  old_values      jsonb  NOT NULL,
  new_values      jsonb  NOT NULL,
  admin_user_id   integer NOT NULL REFERENCES auth_users(id),
  note            text    CHECK (note IS NULL OR length(note) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE data_edits IS
  'One row per manual super-admin edit, with old and new values snapshotted. Append-only by grant: a wrong edit gets a correcting edit, never a rewrite of this log.';

CREATE INDEX ix_data_edits_target ON data_edits (table_name, row_id);

-- The citation for values a super admin enters by hand — most notably a
-- confirmed zero-crowd attendance, which matches_zero_attendance_ck (020)
-- refuses without a source.
INSERT INTO sources (key, name, kind, description) VALUES (
  'manual_admin_edit',
  'Manual super-admin edit',
  'manual',
  'Values entered by hand through /admin/data-editor after external verification. '
  || 'The per-edit provenance (who, when, old and new values, note) is in data_edits.'
) ON CONFLICT (key) DO NOTHING;

-- afldb_auth: INSERT for the editor's audit write, SELECT for review.
-- No UPDATE, no DELETE — append-only by grant. Mirrored in
-- tools/maintenance/privileges.sql, whose afldb_auth list is subtractive.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT ON data_edits TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE data_edits_id_seq TO afldb_auth;
  END IF;
END
$$;
