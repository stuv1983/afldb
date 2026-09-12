-- =====================================================================
-- AFLDB 100 — nl_search_log.grain was missing 'family'
-- =====================================================================
-- AFLDB-ISSUE-153 Stage 6 (decision D6) adds the eleventh NlGrain,
-- 'family' (src/search/nl/plan.ts): a sibling family grouped by
-- player_relationships.family_key, generalising getFamilyRecords
-- (db/queries/family-records.ts). Migration 093 pinned this CHECK to the
-- ten grains that existed then, and its own header repeats 079's/092's
-- instruction to keep the list aligned with NlGrain. This is the fifth
-- time that alignment has had to be repaired (046 -> 055 -> 079 -> 092 ->
-- 093 -> here), and the requirement was proven by a failing test before
-- this file was written, not assumed: with the eleventh grain added to
-- the type-derived contract list, the database rejects it with
--   new row for relation "nl_search_log" violates check constraint
--   "nl_search_log_grain_check"
--
-- The failure mode this repairs is silent by design. logNlSearch
-- (src/db/queries/nl/log.ts) schedules its INSERT via after() and
-- swallows any failure, precisely so a telemetry problem can never turn
-- a correct answer into a failed search. Without this migration every
-- family question would render correctly -- right rows, right wording,
-- HTTP 200 -- while its telemetry row was rejected by this CHECK and
-- dropped with only a console.error. Zero family rows in nl_search_log is
-- exactly the vocabulary/confidence signal migration 046 built the table
-- to capture.
--
-- DEPLOY ORDER: this migration must reach afldb_dev and production BEFORE
-- the Stage 6 code, or it reproduces the silent-drop window it exists to
-- close. It joins 092/093 in that constraint.
--
-- Forward-only and strictly widening. Every grain 093 accepted is
-- retained verbatim; the constraint is not weakened, made NOT VALID, or
-- dropped without replacement, and no existing row can fail the new
-- predicate. No other schema, data, privilege or index change is made
-- here: player_relationships (migration 006) already carries every
-- column the grain reads and already grants app read.
--
-- The exhaustive contract test is
-- tests/integration/database.test.ts -> "accepts every supported NL
-- telemetry grain and rejects an unsupported one", which drives the
-- accepted list from Record<NlGrain, true> and names 'family' explicitly,
-- so reverting this file fails that test by name.
-- =====================================================================

ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'team_streak',
   'head_to_head', 'achievement_summary', 'coach_record', 'after_siren', 'family'));
