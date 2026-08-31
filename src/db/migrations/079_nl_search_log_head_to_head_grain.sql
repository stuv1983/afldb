-- =====================================================================
-- AFLDB 079 — nl_search_log.grain was missing current NL grains
-- =====================================================================
-- Migration 055 widened nl_search_log.grain after achievement_summary
-- was added to NlGrain, but the schema contract drifted again when
-- team_streak and head_to_head became supported grains.
--
-- logNlSearch (src/db/queries/nl/log.ts) deliberately catches INSERT
-- failures so telemetry can never turn a successful search into an error.
-- The stale CHECK therefore dropped head-to-head telemetry silently while
-- the underlying searches still returned correct HTTP 200 responses.
--
-- Keep this list aligned with NlGrain in src/search/nl/plan.ts. Retain all
-- previously accepted grains while adding both current missing grains.
-- =====================================================================

ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'team_streak',
   'head_to_head', 'achievement_summary'));
