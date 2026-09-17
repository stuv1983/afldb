-- =====================================================================
-- AFLDB 093 — nl_search_log.grain was missing 'after_siren'
-- =====================================================================
-- AFLDB-ISSUE-152 Phase C adds the tenth NlGrain, 'after_siren'
-- (src/search/nl/plan.ts) — the first EVENT grain in the NL vocabulary:
-- a curated, cited kick after the siren (migration 089), neither a
-- person nor a per-match statistic. Migration 092 pinned this CHECK to
-- the nine grains that existed then, and its own header repeats 079's
-- instruction to keep the list aligned with NlGrain. This is the fourth
-- time that alignment has had to be repaired (046 -> 055 -> 079 -> 092 ->
-- here), and the requirement was proven by a failing test before this
-- file was written, not assumed: with the tenth grain added to the
-- type-derived contract list, the database rejected it with
--   new row for relation "nl_search_log" violates check constraint
--   "nl_search_log_grain_check"
--
-- The failure mode this repairs is silent by design. logNlSearch
-- (src/db/queries/nl/log.ts) schedules its INSERT via after() and
-- swallows any failure, precisely so a telemetry problem can never turn
-- a correct answer into a failed search. Without this migration every
-- after-the-siren question would render correctly — right rows, right
-- wording, HTTP 200 — while its telemetry row was rejected by this CHECK
-- and dropped with only a console.error. Zero after-siren rows in
-- nl_search_log is exactly the vocabulary/confidence signal migration 046
-- built the table to capture.
--
-- DEPLOY ORDER: this migration must reach afldb_dev and production
-- BEFORE the Phase C code, or it reproduces the silent-drop window it
-- exists to close. It joins 092 in that constraint.
--
-- Forward-only and strictly widening. Every grain 092 accepted is
-- retained verbatim; the constraint is not weakened, made NOT VALID, or
-- dropped without replacement, and no existing row can fail the new
-- predicate. No other schema, data, privilege or index change is made
-- here: after_siren_kicks (089) already carries every column the grain
-- reads and already grants app read.
--
-- The exhaustive contract test is
-- tests/integration/database.test.ts -> "accepts every supported NL
-- telemetry grain and rejects an unsupported one", which drives the
-- accepted list from Record<NlGrain, true> and names 'after_siren'
-- explicitly, so reverting this file fails that test by name.
-- =====================================================================

ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'team_streak',
   'head_to_head', 'achievement_summary', 'coach_record', 'after_siren'));
