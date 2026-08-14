-- =====================================================================
-- AFLDB 015 — Brownlow grain, coverage semantics, season provisionality
-- =====================================================================
-- Three coupled corrections. They are in one migration because splitting
-- them would leave an intermediate state in which season Brownlow totals
-- are neither club-grained nor player-grained.
--
-- 1. GRAIN.  player_season_stats was keyed (player_id, season, club_id)
--    and carried the whole season's Brownlow total on EVERY club row.
--    Summing the table returned 79,280 votes against an authoritative
--    79,113: 44 polling player-seasons across two clubs duplicated 167
--    votes. The source cannot allocate a season total between clubs, and
--    AFLDB does not invent an allocation. Brownlow is therefore stored
--    exactly once, at player-season grain.
--
--      player_club_season_stats  (player_id, season, club_id)  59,092 rows
--          club-grained playing record. NO Brownlow column.
--      player_season_stats       (player_id, season)           58,843 rows
--          player-season totals. The only season-grain Brownlow.
--
-- 2. COVERAGE.  A single is_recorded boolean cannot express the four
--    different reasons a statistic may be absent. Brownlow in particular
--    has three independent grains with different coverage:
--      brownlow_match_votes   1931-1934, 1984-2025, partial even inside
--                             that window, and never for finals
--      brownlow_round_votes   1984-2025
--      brownlow_season_total  1924-2025 except 1942-1945
--    Conflating them is what produced the original 40.6% shortfall.
--
-- 3. PROVISIONALITY.  is_complete cannot say how complete. 2026 is loaded
--    to 9 August with no finals and no medal awarded; the ladder must not
--    read as final and an absent Brownlow must not read as zero.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Coverage vocabulary
-- --------------------------------------------------------------------
CREATE TYPE coverage_status AS ENUM (
  'complete',        -- collected for every eligible row
  'partial',         -- collected for some eligible rows; absence is unknown
  'not_collected',   -- the competition existed, the statistic was not kept
  'not_applicable',  -- there was nothing to collect (no medal, no finals)
  'pending'          -- expected to exist, not yet published
);
COMMENT ON TYPE coverage_status IS
  'Why a statistic is absent. Distinguishes "nobody recorded it" from "it did not happen" from "not yet known" — never conflated with zero.';

CREATE TYPE season_status AS ENUM ('in_progress', 'complete');

-- --------------------------------------------------------------------
-- 2. Season provenance and provisionality
-- --------------------------------------------------------------------
ALTER TABLE seasons
  ADD COLUMN status            season_status NOT NULL DEFAULT 'complete',
  ADD COLUMN data_through_date date,
  ADD COLUMN source_built_at   timestamptz,
  ADD COLUMN last_loaded_round text,
  ADD COLUMN completed_at      date;

COMMENT ON COLUMN seasons.status IS
  'in_progress means every derived figure for this season is provisional: ladder, leaders, career totals.';
COMMENT ON COLUMN seasons.data_through_date IS
  'Last match date actually loaded. For an in-progress season this is the honest "as at" date for every figure.';
COMMENT ON COLUMN seasons.source_built_at IS
  'When the upstream source snapshot was built. Two seasons loaded from different snapshots are not comparable.';
COMMENT ON COLUMN seasons.last_loaded_round IS
  'Human-readable last round loaded, for display alongside provisional figures.';
COMMENT ON COLUMN seasons.completed_at IS
  'Date the season finished. NULL while in progress.';

-- is_complete is retained as a generated mirror so existing readers keep
-- working, but status is the authority.
ALTER TABLE seasons DROP COLUMN is_complete;
ALTER TABLE seasons
  ADD COLUMN is_complete boolean
  GENERATED ALWAYS AS (status = 'complete') STORED;
COMMENT ON COLUMN seasons.is_complete IS
  'Derived from status. Kept for compatibility; read status for the real answer.';

-- --------------------------------------------------------------------
-- 3. Club-grained playing record
-- --------------------------------------------------------------------
ALTER TABLE player_season_stats RENAME TO player_club_season_stats;

ALTER INDEX ix_pss_season      RENAME TO ix_pcss_season;
ALTER INDEX ix_pss_club_season RENAME TO ix_pcss_club_season;
ALTER INDEX ix_pss_player      RENAME TO ix_pcss_player;

-- The whole point of the migration: a club row cannot carry a season
-- award total.
ALTER TABLE player_club_season_stats DROP COLUMN brownlow_votes;

COMMENT ON TABLE player_club_season_stats IS
  'DERIVED. One row per player, season and CLUB. A mid-season transfer produces two rows. Carries no award totals: awards are decided at season grain and the source cannot split them by club.';

-- --------------------------------------------------------------------
-- 4. True player-season grain
-- --------------------------------------------------------------------
CREATE TABLE player_season_stats (
  player_id        integer  NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season           smallint NOT NULL REFERENCES seasons(year),

  -- Club context, for display only. A player at two clubs has
  -- club_count = 2 and primary_club_id = the club of most games.
  primary_club_id  integer  REFERENCES clubs(id),
  club_count       smallint NOT NULL DEFAULT 1,

  games            smallint NOT NULL,
  finals           smallint NOT NULL DEFAULT 0,
  wins             smallint NOT NULL DEFAULT 0,
  draws            smallint NOT NULL DEFAULT 0,
  losses           smallint NOT NULL DEFAULT 0,

  goals            integer,
  behinds          integer,
  kicks            integer,
  handballs        integer,
  disposals        integer,
  marks            integer,
  tackles          integer,
  hitouts          integer,

  disposals_recorded_games smallint NOT NULL DEFAULT 0,
  tackles_recorded_games   smallint NOT NULL DEFAULT 0,
  hitouts_recorded_games   smallint NOT NULL DEFAULT 0,

  -- The single season-grain Brownlow figure.
  --   status = 'complete'        -> votes is 0..n, and 0 genuinely means
  --                                 the player polled no votes
  --   status = 'not_applicable'  -> votes IS NULL, no medal that season
  --   status = 'pending'         -> votes IS NULL, medal not yet awarded
  brownlow_votes   smallint,
  brownlow_status  coverage_status NOT NULL DEFAULT 'not_applicable',

  is_premier       boolean  NOT NULL DEFAULT false,

  PRIMARY KEY (player_id, season),

  -- A vote count is only meaningful when the award was actually decided.
  CONSTRAINT pss_brownlow_grain_ck CHECK (
    (brownlow_status = 'complete' AND brownlow_votes IS NOT NULL)
    OR (brownlow_status <> 'complete' AND brownlow_votes IS NULL)
  )
);
COMMENT ON TABLE player_season_stats IS
  'DERIVED. One row per player and season, regardless of club. The only season-grain source of Brownlow votes; summing brownlow_votes here must equal the authoritative brownlow_season_votes total exactly.';
COMMENT ON COLUMN player_season_stats.brownlow_votes IS
  'Season total from brownlow_season_votes. 0 means polled none in a season that was decided. NULL means the question does not apply — read brownlow_status.';
COMMENT ON COLUMN player_season_stats.primary_club_id IS
  'Club of most games that season. Display convenience only; never use it to attribute a season total to one club.';

CREATE INDEX ix_pss_season         ON player_season_stats (season, goals DESC);
CREATE INDEX ix_pss_player         ON player_season_stats (player_id, season);
CREATE INDEX ix_pss_season_brownlow ON player_season_stats (season, brownlow_votes DESC)
  WHERE brownlow_votes IS NOT NULL;

-- --------------------------------------------------------------------
-- 5. Grain-aware statistic availability
-- --------------------------------------------------------------------
ALTER TABLE stat_availability
  ADD COLUMN coverage coverage_status;

COMMENT ON COLUMN stat_availability.coverage IS
  'Why the statistic is present or absent for this season. is_recorded is the coarse boolean; coverage is the real answer.';

-- Backfill from the existing boolean, then tighten.
UPDATE stat_availability
   SET coverage = CASE
     WHEN NOT is_recorded                       THEN 'not_collected'
     WHEN populated_rows IS NULL                THEN 'complete'
     WHEN total_rows IS NULL OR total_rows = 0  THEN 'not_collected'
     WHEN populated_rows >= total_rows          THEN 'complete'
     WHEN populated_rows = 0                    THEN 'not_collected'
     ELSE 'partial'
   END::coverage_status;

ALTER TABLE stat_availability ALTER COLUMN coverage SET NOT NULL;

-- Three grains of Brownlow, each with its own coverage. The old single
-- 'brownlow' key claimed one answer for three different questions.
INSERT INTO stat_definitions (key, label, short_label, description, display_order)
VALUES
  ('brownlow_match_votes',  'Brownlow Votes (per match)',   'BV/match',
   'Umpire votes recorded against an individual match. Home-and-away only; finals are never polled.', 90),
  ('brownlow_round_votes',  'Brownlow Votes (per round)',   'BV/round',
   'Umpire votes aggregated to a round.', 91),
  ('brownlow_season_total', 'Brownlow Votes (season total)', 'BV',
   'Official season vote total. The authoritative figure for career and season aggregates.', 92)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE stat_availability IS
  'Per-season, per-statistic coverage. Rows exist per season rather than as a min/max range because collection was not continuous.';

-- --------------------------------------------------------------------
-- 6. Privileges
-- --------------------------------------------------------------------
GRANT SELECT ON player_season_stats, player_club_season_stats TO afldb_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON player_season_stats, player_club_season_stats TO afldb_import;
