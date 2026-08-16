-- =====================================================================
-- AFLDB 041 — Index the foreign keys that are actually queried, and drop
--             two that never were
-- =====================================================================
-- PostgreSQL indexes a PRIMARY KEY and a UNIQUE constraint for you. It
-- does NOT index a foreign key's referencing column: that is always
-- manual, and it matters twice over — once for the joins and filters the
-- application runs, and once for the parent-side DELETE, which without an
-- index sequentially scans the child table to prove no row references the
-- row going away.
--
-- Everything added here is a column some query already filters or joins
-- on, or the child side of a delete that would otherwise scan. Nothing is
-- speculative: each index below names its caller.
--
-- These are all small tables (hundreds to low thousands of rows), so none
-- of this is a rescue from a slow page today. It is the difference between
-- "small enough that a sequential scan is free" holding by accident and
-- holding by design, on the tables most likely to grow.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Queried foreign keys
-- --------------------------------------------------------------------

-- getPlayerHonours() reads this per player page (db/queries/awards.ts).
-- Partial, matching ix_hof_player next door: an unlinked member is a name
-- with no player, and no query looks those up by player_id.
CREATE INDEX IF NOT EXISTS ix_honour_team_player
  ON honour_team_members (player_id) WHERE player_id IS NOT NULL;

-- getClubAwards / getClubBestAndFairest / getClubCaptains all filter
-- `w.club_id IN (<lineage>)`. ix_award_winners_player covers the player
-- side of this table; the club side had nothing.
CREATE INDEX IF NOT EXISTS ix_award_winners_club
  ON award_winners (club_id) WHERE club_id IS NOT NULL;

-- getNominationsByClub(), plus the grid solver's four
-- rising_star_nominee_for_club* builders.
CREATE INDEX IF NOT EXISTS ix_award_nominations_club
  ON award_nominations (club_id) WHERE club_id IS NOT NULL;

-- No query filters on the opponent today, but it is the second FK to
-- clubs on this table and so the second sequential scan on any club
-- delete. Indexed for the delete path rather than for a read.
CREATE INDEX IF NOT EXISTS ix_award_nominations_opponent
  ON award_nominations (opponent_club_id) WHERE opponent_club_id IS NOT NULL;

-- captaincies.club_id is already covered by ix_captaincies_club
-- (club_id, season) — a composite index serves a leading-column lookup,
-- so nothing is needed here.

-- --------------------------------------------------------------------
-- 2. The circular players <-> player_birth_evidence pair
-- --------------------------------------------------------------------
-- players.dob_evidence_id references player_birth_evidence(id), and
-- player_birth_evidence.player_id references players(id) ON DELETE
-- CASCADE. The cycle is deliberate (migration 018: the evidence is kept
-- so the decision can be revisited) and the importer copes with it —
-- truncate() uses CASCADE and set_reload_scope() refuses a partial run
-- that would empty a table it will not refill.
--
-- What was missing is the index on the players side. Deleting one
-- evidence row scanned all 13,361 players to check nothing pointed at it.
CREATE INDEX IF NOT EXISTS ix_players_dob_evidence
  ON players (dob_evidence_id) WHERE dob_evidence_id IS NOT NULL;

-- --------------------------------------------------------------------
-- 3. Operational bookkeeping foreign keys
-- --------------------------------------------------------------------
-- Every one of these points at auth_users. None is read by a query; all
-- of them are scanned when an administrator's row is deleted. Small
-- tables, small indexes, and they turn "delete an admin" from a handful
-- of sequential scans into index probes.
CREATE INDEX IF NOT EXISTS ix_beta_access_codes_created_by
  ON beta_access_codes (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_beta_allowed_emails_added_by
  ON beta_allowed_emails (added_by) WHERE added_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_beta_join_requests_reviewed_by
  ON beta_join_requests (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_auth_audit_actor
  ON auth_audit_log (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_admin_invites_invited_by
  ON admin_invites (invited_by);
CREATE INDEX IF NOT EXISTS ix_data_submissions_uploaded_by
  ON data_submissions (uploaded_by);
CREATE INDEX IF NOT EXISTS ix_data_submissions_reviewed_by
  ON data_submissions (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_settings_updated_by
  ON site_settings (updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_media_uploaded_by
  ON site_media (uploaded_by) WHERE uploaded_by IS NOT NULL;

-- data_submission_rows.submission_id leads its PRIMARY KEY
-- (submission_id, row_no), so the ON DELETE CASCADE is already indexed.

-- --------------------------------------------------------------------
-- 4. Two indexes nothing has ever used
-- --------------------------------------------------------------------
-- Migration 002 indexed lower(alias) on both alias tables for a
-- case-insensitive lookup. Migration 008 then introduced
-- afldb_normalise_name() and trigram indexes over it, and every alias
-- lookup in the application went through those instead:
-- searchClubs/searchVenues match afldb_normalise_name(a.alias), served by
-- ix_club_aliases_trgm and ix_venue_aliases_trgm.
--
-- An expression index is only ever used by a query whose WHERE clause
-- repeats the expression exactly. Nothing does: the sole remaining
-- lower(alias) in the codebase is a SELECT projection in
-- tools/migration/import_draft.py, which reads the whole table into a
-- Python dict and cannot use an index for it.
--
-- So both have been costing every alias insert and every vacuum since
-- migration 002, for a lookup that moved away six migrations later.
DROP INDEX IF EXISTS ix_club_aliases_lookup;
DROP INDEX IF EXISTS ix_venue_aliases_lookup;

-- ix_player_aliases_trgm (migration 008) is deliberately KEPT despite
-- having no caller either. It is the alias half of player search, whose
-- other half (ix_players_search_trgm) is very much in use, and the
-- table's own uniqueness is on (player_id, alias) rather than on the
-- normalised form — so an alias search is a feature waiting for a query,
-- not an index left behind by one that moved.
