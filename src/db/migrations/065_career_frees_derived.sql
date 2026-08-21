-- =====================================================================
-- AFLDB 065 - Derived stats frees
-- =====================================================================
-- Add frees_for, frees_against, and frees_recorded_games to derived
-- tables so they are available for global records and career totals.
-- =====================================================================

ALTER TABLE player_season_stats
  ADD COLUMN frees_for integer,
  ADD COLUMN frees_against integer,
  ADD COLUMN frees_recorded_games smallint NOT NULL DEFAULT 0;

ALTER TABLE player_club_season_stats
  ADD COLUMN frees_for integer,
  ADD COLUMN frees_against integer,
  ADD COLUMN frees_recorded_games smallint NOT NULL DEFAULT 0;

ALTER TABLE player_career_stats
  ADD COLUMN frees_for integer,
  ADD COLUMN frees_against integer,
  ADD COLUMN frees_recorded_games integer NOT NULL DEFAULT 0;
