-- =====================================================================
-- AFLDB 054 — Correct two player_achievements column comments
-- =====================================================================
-- Migration 053's comments on round_raw and match_id described an
-- earlier design, not the shipped importer: they claimed the match is
-- resolved by career game position and that round_raw is never used to
-- locate it, which is the exact inverse of what
-- tools/records/import-first-kick-goal.ts does (and of why it does it --
-- career position is unreliable because the "#" markers are incomplete;
-- Brent Harvey's debut, 1996 R22, recorded no kick at all, and his first
-- kick came in 1997 R5, exactly the game the source's season+round
-- names). A schema comment that prescribes the forbidden approach is
-- worse than none, so both are restated here. Comments only; no grants,
-- no data.
-- =====================================================================

COMMENT ON COLUMN player_achievements.round_raw IS
  'Verbatim source round code, including non-numeric codes such as SF. For first_kick_goal '
  'this is the round of the FIRST KICK, which is the debut match only when '
  'kickless_matches_before_first_kick = 0. Together with season, this is what locates '
  'match_id: the player''s recorded game in the stated season and round.';

COMMENT ON COLUMN player_achievements.match_id IS
  'The match in which the achievement occurred: the player''s game in the source-stated '
  'season and round (the importer absorbs the Opening Round off-by-one for seasons that '
  'have one). NEVER inferred from career game position -- the "#" markers that would make '
  'position reliable are incomplete (Brent Harvey: debut 1996 R22 with no recorded kick, '
  'first kick 1997 R5). NULL when the player has no recorded game in that round.';
