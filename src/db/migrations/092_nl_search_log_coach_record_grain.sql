-- =====================================================================
-- AFLDB 092 — nl_search_log.grain was missing 'coach_record'
-- =====================================================================
-- AFLDB-ISSUE-152 Phase B added the ninth NlGrain, 'coach_record'
-- (src/search/nl/plan.ts) — the first person-grain in the NL vocabulary
-- that is not a player. Migration 079 pinned this CHECK to the eight
-- grains that existed then, and its own header says "Keep this list
-- aligned with NlGrain in src/search/nl/plan.ts". Nothing did, so the
-- schema contract drifted for the third time (046 -> 055 -> 079 -> here).
--
-- The failure mode is the same one 055 and 079 were written to repair,
-- and it is silent by design: logNlSearch (src/db/queries/nl/log.ts)
-- schedules its INSERT via after() and swallows any failure, precisely
-- so a telemetry problem can never turn a correct answer into a failed
-- search. A coaching question would therefore render correctly — right
-- rows, right description, HTTP 200 — while its telemetry row was
-- rejected by this CHECK and dropped with only a console.error. Zero
-- coaching rows in nl_search_log is exactly the vocabulary/confidence
-- signal migration 046 built the table to capture.
--
-- Phase B's Stage-0 plan (issues/open/AFLDB-ISSUE-152.md §13.16) assumed
-- no migration was needed. Implementation evidence superseded that: the
-- ninth grain cannot be admitted without extending this constraint.
--
-- Forward-only and strictly widening. Every grain 079 accepted is
-- retained verbatim; the constraint is not weakened, made NOT VALID, or
-- dropped, and no existing row can fail the new predicate.
-- The exhaustive contract test is
-- tests/integration/database.test.ts -> "accepts every supported NL
-- telemetry grain and rejects an unsupported one", which drives the
-- accepted list from Record<NlGrain, true> so the next grain fails
-- loudly here instead of silently in production telemetry.
-- =====================================================================

ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'team_streak',
   'head_to_head', 'achievement_summary', 'coach_record'));
