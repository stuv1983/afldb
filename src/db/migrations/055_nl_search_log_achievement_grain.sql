-- =====================================================================
-- AFLDB 055 — nl_search_log.grain was missing 'achievement_summary'
-- =====================================================================
-- Migration 046 fixed nl_search_log.grain's CHECK to the five grains
-- NlGrain had at the time. Commit 67d0ca7 added a sixth, 'achievement_summary'
-- (src/search/nl/plan.ts), but nothing widened this constraint to match.
--
-- logNlSearch (src/db/queries/nl/log.ts) wraps its INSERT in try/catch and
-- schedules it via Next's after(), specifically so a logging failure never
-- turns into a failed search -- readers asking an achievement_summary
-- question ("which club has had the most first-kick-goal players") get a
-- correct answer either way. But that means the gap was silent: every
-- such row failed its CHECK and was dropped with only a console.error,
-- never surfacing as a user-visible bug or a failed test. Found while
-- reading the schema for an unrelated reason (sizing up nl_search_log
-- before a Playwright sweep), not by any failure report.
--
-- The cost is real even though nothing crashed: zero telemetry for this
-- grain since it shipped, which is exactly the vocabulary/confidence
-- tuning signal 046 built this table to capture (see its own header).
-- =====================================================================

ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'achievement_summary'));
