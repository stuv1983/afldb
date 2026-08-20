-- ---------------------------------------------------------------------
-- 058 — audit support for every entity registered in the data editor
-- ---------------------------------------------------------------------
-- Migration 057 intentionally made table_name an allowlist. Awards,
-- honours and draft-pick editing were registered afterward, so widen
-- only that CHECK; the table's existing append-only role grants remain
-- unchanged.
-- ---------------------------------------------------------------------

ALTER TABLE data_edits
  DROP CONSTRAINT data_edits_table_name_check,
  ADD CONSTRAINT data_edits_table_name_check CHECK (table_name IN (
    'players',
    'matches',
    'draft_picks',
    'award_winners',
    'hall_of_fame',
    'honour_team_members'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted statistical entities whose manual mutations are recorded in this append-only audit log.';
