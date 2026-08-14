-- =====================================================================
-- AFLDB 007 — Derived summaries
-- =====================================================================
-- Everything here is REPRODUCIBLE from the authoritative tables by
-- `python tools/migration/rebuild_derived.py`. Nothing in this file is
-- ever the only copy of a fact, and nothing here is hand-edited.
--
-- These exist so that common career filters never aggregate the whole
-- 694K-row fact table per request.
--
-- Sources:
--   player_match_stats   -> games, goals, era-limited statistics
--   matches              -> finals, premierships, results
--   brownlow_season_votes-> Brownlow votes (NOT player_match_stats)
-- =====================================================================

-- Player season statistics -------------------------------------------
-- Keyed by club as well as season: a player who changed clubs mid-season
-- gets one row per club.
CREATE TABLE player_season_stats (
  player_id        integer  NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season           smallint NOT NULL REFERENCES seasons(year),
  club_id          integer  NOT NULL REFERENCES clubs(id),

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

  -- Number of games in this season for which each era-limited statistic
  -- was actually recorded. A total of 0 with recorded_games 0 means
  -- "not recorded", not "did nothing".
  disposals_recorded_games smallint NOT NULL DEFAULT 0,
  tackles_recorded_games   smallint NOT NULL DEFAULT 0,
  hitouts_recorded_games   smallint NOT NULL DEFAULT 0,

  brownlow_votes   smallint,   -- from brownlow_season_votes; NULL = not recorded
  is_premier       boolean  NOT NULL DEFAULT false,

  PRIMARY KEY (player_id, season, club_id)
);
COMMENT ON TABLE player_season_stats IS
  'DERIVED. Rebuilt from player_match_stats + matches + brownlow_season_votes.';
COMMENT ON COLUMN player_season_stats.brownlow_votes IS
  'From brownlow_season_votes (authoritative). NULL means the season predates Brownlow or the player did not poll in a recorded season.';

CREATE INDEX ix_pss_season      ON player_season_stats (season, goals DESC);
CREATE INDEX ix_pss_club_season ON player_season_stats (club_id, season);
CREATE INDEX ix_pss_player      ON player_season_stats (player_id, season);

-- Player career statistics -------------------------------------------
-- The primary surface for Advanced Search.
CREATE TABLE player_career_stats (
  player_id        integer  PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,

  games            integer  NOT NULL,
  finals           integer  NOT NULL DEFAULT 0,
  premierships     integer  NOT NULL DEFAULT 0,
  wins             integer  NOT NULL DEFAULT 0,
  draws            integer  NOT NULL DEFAULT 0,
  losses           integer  NOT NULL DEFAULT 0,

  goals            integer  NOT NULL DEFAULT 0,   -- 100% recorded since 1897
  behinds          integer,
  kicks            integer,
  handballs        integer,
  disposals        integer,
  marks            integer,
  tackles          integer,
  hitouts          integer,

  -- Career games in which each era-limited statistic was recorded.
  behinds_recorded_games   integer NOT NULL DEFAULT 0,
  kicks_recorded_games     integer NOT NULL DEFAULT 0,
  handballs_recorded_games integer NOT NULL DEFAULT 0,
  disposals_recorded_games integer NOT NULL DEFAULT 0,
  marks_recorded_games     integer NOT NULL DEFAULT 0,
  tackles_recorded_games   integer NOT NULL DEFAULT 0,
  hitouts_recorded_games   integer NOT NULL DEFAULT 0,

  -- AUTHORITATIVE: summed from brownlow_season_votes, never from
  -- player_match_stats.brownlow_votes.
  brownlow_votes   integer  NOT NULL DEFAULT 0,
  brownlow_medals  smallint NOT NULL DEFAULT 0,

  clubs_played     smallint NOT NULL,
  seasons_played   smallint NOT NULL,
  debut_season     smallint,
  final_season     smallint,
  debut_date       date,
  last_match_date  date,

  best_goals_game     smallint,
  best_disposals_game smallint,

  rebuilt_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE player_career_stats IS
  'DERIVED. Primary surface for Advanced Search. Rebuilt wholesale by tools/migration/rebuild_derived.py.';
COMMENT ON COLUMN player_career_stats.brownlow_votes IS
  'Summed from brownlow_season_votes (authoritative, 79,113 total). Summing player_match_stats.brownlow_votes instead yields 46,979 and is wrong.';
COMMENT ON COLUMN player_career_stats.disposals IS
  'NULL when never recorded in the player''s era. Read together with disposals_recorded_games.';

-- Advanced Search workload.
CREATE INDEX ix_pcs_games        ON player_career_stats (games DESC);
CREATE INDEX ix_pcs_goals        ON player_career_stats (goals DESC);
CREATE INDEX ix_pcs_finals       ON player_career_stats (finals DESC);
CREATE INDEX ix_pcs_brownlow     ON player_career_stats (brownlow_votes DESC);
CREATE INDEX ix_pcs_premierships ON player_career_stats (premierships DESC) WHERE premierships > 0;
CREATE INDEX ix_pcs_debut        ON player_career_stats (debut_season);
CREATE INDEX ix_pcs_clubs        ON player_career_stats (clubs_played);
-- Common compound filter: games + goals.
CREATE INDEX ix_pcs_games_goals  ON player_career_stats (games, goals);

-- Player clubs --------------------------------------------------------
-- One row per player per club identity actually represented.
CREATE TABLE player_clubs (
  player_id      integer  NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  club_id        integer  NOT NULL REFERENCES clubs(id),
  games          integer  NOT NULL,
  goals          integer  NOT NULL DEFAULT 0,
  first_season   smallint NOT NULL,
  last_season    smallint NOT NULL,
  first_match_id integer  REFERENCES matches(id),
  last_match_id  integer  REFERENCES matches(id),
  PRIMARY KEY (player_id, club_id)
);
COMMENT ON TABLE player_clubs IS
  'DERIVED. Historical club identities represented by each player.';
CREATE INDEX ix_player_clubs_club ON player_clubs (club_id, games DESC);

-- Rebuild bookkeeping -------------------------------------------------
CREATE TABLE derived_rebuilds (
  id           bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  target       text        NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  row_count    bigint,
  status       import_status NOT NULL DEFAULT 'running',
  scope        text,
  error        text
);
COMMENT ON TABLE derived_rebuilds IS
  'Audit trail of derived-data rebuilds, so a stale summary can always be traced to its rebuild.';
