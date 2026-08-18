-- ---------------------------------------------------------------------
-- 056 — manual review of unresolved player links
-- ---------------------------------------------------------------------
-- The honours tables carry link_status_value with player_id NULL when a
-- source name could not be tied to a player with confidence. Until now
-- those rows could only be looked at: linking is automatic at import
-- time and nothing ever writes 'resolved'. This migration adds the two
-- tables a manual review needs, following 049's three-way separation:
--
--   the honours row            what the SOURCE said.   Fixed by import.
--   player_link_suggestions    what a READER said.     Immutable content.
--   player_link_resolutions    what an ADMIN did.      Append-only audit.
--
-- The statistical UPDATE itself (player_id + link_status_value on the
-- honours row) is NOT granted to any role here. It runs on a short-lived
-- afldb_import connection, exactly as promoteSubmission does — there is
-- one way into the statistical tables, not two — and afldb_import
-- already holds that write through the 045 registry.
--
-- target_table/target_id point into seven different tables, so they
-- cannot be a foreign key. A suggestion against an id that does not
-- exist is a harmless dead row the admin queue simply never surfaces —
-- the same accept-don't-join reasoning as 049's client_ref.
-- ---------------------------------------------------------------------

CREATE TABLE player_link_suggestions (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  target_table    text   NOT NULL CHECK (target_table IN (
                    'award_winners', 'award_nominations', 'hall_of_fame',
                    'honour_team_members', 'captaincies',
                    'player_achievements', 'draft_picks')),
  target_id       bigint NOT NULL CHECK (target_id > 0),
  -- Free text on purpose: the person a reader recognises is often a
  -- state-league footballer with no AFLDB player row to pick.
  suggested_name  text   NOT NULL CHECK (
                    length(suggested_name) > 0 AND length(suggested_name) <= 120),
  note            text   CHECK (
                    note IS NULL OR (length(note) > 0 AND length(note) <= 1000)),
  status          text   NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'accepted', 'dismissed')),
  resolved_by     integer REFERENCES auth_users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE player_link_suggestions IS
  'A reader''s "I know who this is" tip against one unlinked honours row. The tip''s own words are immutable by grant: afldb_auth may update only the workflow columns (status, resolved_by, resolved_at).';
COMMENT ON COLUMN player_link_suggestions.target_id IS
  'The id in target_table. Not a foreign key — it points into seven different tables, and a dead id is a harmless unsurfaced row, not an error.';

CREATE INDEX ix_pls_status  ON player_link_suggestions (status, created_at DESC);
CREATE INDEX ix_pls_target  ON player_link_suggestions (target_table, target_id);

CREATE TABLE player_link_resolutions (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  target_table    text   NOT NULL CHECK (target_table IN (
                    'award_winners', 'award_nominations', 'hall_of_fame',
                    'honour_team_members', 'captaincies',
                    'player_achievements', 'draft_picks')),
  target_id       bigint NOT NULL CHECK (target_id > 0),
  action          text   NOT NULL CHECK (action IN ('linked', 'confirmed_unlinked')),
  player_id       integer REFERENCES players(id),
  previous_status link_status NOT NULL,
  admin_user_id   integer NOT NULL REFERENCES auth_users(id),
  note            text    CHECK (note IS NULL OR length(note) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 'linked' names a player; 'confirmed_unlinked' deliberately does not.
  CONSTRAINT plr_action_player_ck CHECK ((action = 'linked') = (player_id IS NOT NULL))
);

COMMENT ON TABLE player_link_resolutions IS
  'What an admin concluded about one unlinked honours row, one row per decision. Append-only by grant: a decision that turns out wrong gets a new row, never an edit.';
COMMENT ON COLUMN player_link_resolutions.action IS
  '''linked'' set the target row''s player_id (via the import role); ''confirmed_unlinked'' recorded that the row was vetted and is genuinely not an AFLDB player, leaving it unmatched.';

CREATE INDEX ix_plr_target ON player_link_resolutions (target_table, target_id);

-- ---------------------------------------------------------------------
-- Grants. Neither table is app-readable (nothing public renders them)
-- nor import-writable (the ETL never reloads them), so neither registry
-- is touched and the fail-closed defaults leave afldb_app and
-- afldb_import with nothing.
--
-- afldb_auth: INSERT for the public suggestion form and the admin's
-- resolution record; SELECT for the admin queue. On suggestions the
-- UPDATE is column-scoped to the workflow fields, so the reader's words
-- are immutable by grant rather than by convention (the same shape as
-- 045's data_submissions grant to afldb_import). Resolutions get no
-- UPDATE and no DELETE at all.
--
-- Mirrored in tools/maintenance/privileges.sql, whose afldb_auth section
-- is subtractive — a grant absent from that file is revoked on the next
-- reconcile.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT, INSERT ON player_link_suggestions TO afldb_auth;
    GRANT UPDATE (status, resolved_by, resolved_at)
      ON player_link_suggestions TO afldb_auth;
    GRANT SELECT, INSERT ON player_link_resolutions TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE player_link_suggestions_id_seq TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE player_link_resolutions_id_seq TO afldb_auth;
  END IF;
END
$$;
