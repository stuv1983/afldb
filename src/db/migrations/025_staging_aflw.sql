-- =====================================================================
-- AFLDB 025 — AFLW staging: source rows as published, before resolution
-- =====================================================================
-- Loaded by tools/aflw/load_staging.py from data/aflw/parsed/*.csv,
-- produced by tools/aflw/parse_aflw.py from the aflwstats.com scrape.
-- See tools/aflw/README.md for the source's shape and its traps.
--
-- This schema deliberately has NO foreign key into the normalised model.
-- The whole reason AFLW cannot be added under the current keys is that
-- seasons.year is the season primary key and AFLW has two seasons inside
-- calendar 2022 (Season Six and Season Seven), so staging must be
-- loadable BEFORE that is fixed. Season is text here ('2022', '7') exactly
-- as the source keys it.
--
-- Every table follows the staging convention from 014_staging_schema.sql:
-- the source string is kept, the resolved AFLDB key sits beside it and is
-- NULL until a resolution pass fills it. Unresolved rows are reported,
-- never dropped.
--
-- Statistics are signed. Metres gained reaches -52 and fantasy points -5
-- in real rows, so no non-negative CHECK belongs on them.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS staging_aflw;

GRANT USAGE ON SCHEMA staging_aflw TO afldb_import, afldb_app;

ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging_aflw
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging_aflw
  GRANT SELECT ON TABLES TO afldb_app;

-- Seasons -------------------------------------------------------------
-- season_key is the source's own key and the only stable season handle.
-- calendar_year is for display and must never identify a season: 2022 and
-- 7 are both calendar 2022.
CREATE TABLE staging_aflw.seasons (
  season_key          text     PRIMARY KEY,
  ordinal             smallint NOT NULL,
  calendar_year       smallint NOT NULL,
  display_label       text     NOT NULL,
  first_fixture_date  date,
  last_fixture_date   date,
  fixture_count       smallint NOT NULL,
  played_count        smallint NOT NULL,
  ladder_group_count  smallint NOT NULL,
  has_grand_final     boolean  NOT NULL,
  season_id           integer,      -- resolution target, NULL until mapped
  CONSTRAINT saflw_seasons_ordinal_uq UNIQUE (ordinal)
);
COMMENT ON TABLE staging_aflw.seasons IS
  '11 AFLW seasons, 2017-2026. Keyed by the source key because calendar year is not unique.';
COMMENT ON COLUMN staging_aflw.seasons.has_grand_final IS
  'false for 2020, abandoned at the semi-finals with no premier, and for 2026, still being played. Season completion and premiership award are separate facts.';

-- Ladders -------------------------------------------------------------
-- conference is '' in every season except 2020, the only season played as
-- two conferences. It is part of the key, not an attribute.
CREATE TABLE staging_aflw.ladders (
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  conference          text     NOT NULL DEFAULT '',
  team_code           text     NOT NULL,
  team_name_raw       text     NOT NULL,
  ladder_rank         smallint NOT NULL,
  played              smallint NOT NULL,
  premiership_points  smallint NOT NULL,
  percentage          numeric(9,4),
  wins                smallint NOT NULL,
  draws               smallint NOT NULL,
  losses              smallint NOT NULL,
  points_for          integer  NOT NULL,
  points_against      integer  NOT NULL,
  club_id             integer,      -- resolution target
  source_page         text     NOT NULL,
  PRIMARY KEY (season_key, conference, team_code)
);
COMMENT ON COLUMN staging_aflw.ladders.conference IS
  '2020 only, as A and B. Empty string elsewhere. A single ladder per season cannot be assumed.';

-- Fixtures ------------------------------------------------------------
-- The complete published fixture list, including matches that were never
-- played. The source renders an unplayed fixture as a 0-0 draw with an
-- empty score cell, so scores here are NULL and fixture_status carries
-- the meaning.
CREATE TABLE staging_aflw.fixtures (
  match_key           text     PRIMARY KEY,
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  round_code          text     NOT NULL,
  round_number        smallint,
  round_type          text     NOT NULL,
  is_final            boolean  NOT NULL,
  match_date          date,
  match_time          text,
  venue_raw           text     NOT NULL,
  home_team_code      text     NOT NULL,
  home_team_name_raw  text     NOT NULL,
  away_team_code      text     NOT NULL,
  away_team_name_raw  text     NOT NULL,
  home_goals          smallint,
  home_behinds        smallint,
  home_score          smallint,
  away_goals          smallint,
  away_behinds        smallint,
  away_score          smallint,
  is_played           boolean  NOT NULL,
  fixture_status      text     NOT NULL,
  home_club_id        integer,      -- resolution targets
  away_club_id        integer,
  venue_id            integer,
  source_page         text     NOT NULL,
  CONSTRAINT saflw_fixtures_status_ck CHECK
    (fixture_status IN ('played', 'scheduled', 'cancelled')),
  CONSTRAINT saflw_fixtures_played_ck CHECK
    (is_played = (fixture_status = 'played')),
  -- An unplayed fixture must not carry a score, or it becomes a 0-0 draw.
  CONSTRAINT saflw_fixtures_score_ck CHECK (
    (fixture_status = 'played' AND home_score IS NOT NULL AND away_score IS NOT NULL)
    OR (fixture_status <> 'played' AND home_score IS NULL AND away_score IS NULL)),
  CONSTRAINT saflw_fixtures_round_ck CHECK
    (is_final = (round_type <> 'home_and_away')),
  CONSTRAINT saflw_fixtures_teams_ck CHECK (home_team_code <> away_team_code)
);
COMMENT ON COLUMN staging_aflw.fixtures.fixture_status IS
  'played, cancelled (2 abandoned Season Six matches) or scheduled (106 in the 2026 season still being played).';
CREATE INDEX ix_saflw_fixtures_season ON staging_aflw.fixtures (season_key, round_number);

-- Matches -------------------------------------------------------------
-- The match detail pages. One row per played fixture; the scores are
-- cross-checked against fixtures on load.
CREATE TABLE staging_aflw.matches (
  match_key           text     PRIMARY KEY REFERENCES staging_aflw.fixtures(match_key),
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  round_code          text     NOT NULL,
  round_number        smallint,
  round_type          text     NOT NULL,
  is_final            boolean  NOT NULL,
  match_date          date     NOT NULL,
  match_time          text,
  venue_raw           text     NOT NULL,
  weather_raw         text     NOT NULL DEFAULT '',
  home_team_code      text     NOT NULL,
  home_team_name_raw  text     NOT NULL,
  away_team_code      text     NOT NULL,
  away_team_name_raw  text     NOT NULL,
  home_goals          smallint NOT NULL,
  home_behinds        smallint NOT NULL,
  home_score          smallint NOT NULL,
  away_goals          smallint NOT NULL,
  away_behinds        smallint NOT NULL,
  away_score          smallint NOT NULL,
  source_page         text     NOT NULL,
  CONSTRAINT saflw_matches_home_score_ck CHECK (home_goals * 6 + home_behinds = home_score),
  CONSTRAINT saflw_matches_away_score_ck CHECK (away_goals * 6 + away_behinds = away_score)
);
COMMENT ON TABLE staging_aflw.matches IS
  'Match detail pages. Attendance and umpires are not published by this source and are absent by omission, not recorded as zero.';

-- Player match statistics ---------------------------------------------
-- player_slug is the source's only handle on a person. It is name-derived
-- and disambiguates same-named players only sometimes, so player_id stays
-- NULL until a reconciliation pass resolves it deliberately.
CREATE TABLE staging_aflw.player_match_stats (
  match_key           text     NOT NULL REFERENCES staging_aflw.matches(match_key),
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  team_code           text     NOT NULL,
  player_slug         text     NOT NULL,
  player_name_raw     text     NOT NULL,
  jumper_number       text     NOT NULL,
  position            text     NOT NULL,

  kicks               smallint NOT NULL,
  handballs           smallint NOT NULL,
  disposals           smallint NOT NULL,
  contested           smallint NOT NULL,
  metres_gained       integer  NOT NULL,
  marks               smallint NOT NULL,
  hitouts             smallint NOT NULL,
  tackles             smallint NOT NULL,
  fantasy_points      smallint NOT NULL,

  -- NULL means the player did not score. The source prints an empty cell
  -- rather than 0.0, and the scoring worm independently confirms the
  -- absence, so this is a true zero that is simply not written down.
  goals               smallint,
  behinds             smallint,
  score_points        smallint,

  player_id           integer,      -- resolution target
  club_id             integer,
  source_page         text     NOT NULL,
  PRIMARY KEY (match_key, player_slug),
  CONSTRAINT saflw_pms_disposals_ck CHECK (kicks + handballs = disposals),
  CONSTRAINT saflw_pms_score_ck CHECK (
    (goals IS NULL AND behinds IS NULL AND score_points IS NULL)
    OR (goals * 6 + behinds = score_points))
);
COMMENT ON COLUMN staging_aflw.player_match_stats.metres_gained IS
  'Signed: a player can finish a match on negative metres gained (minimum observed -52). Not available in the AFL side of the database at all.';
COMMENT ON COLUMN staging_aflw.player_match_stats.jumper_number IS
  'Text because it identifies rather than counts.';
CREATE INDEX ix_saflw_pms_player ON staging_aflw.player_match_stats (player_slug);
CREATE INDEX ix_saflw_pms_season ON staging_aflw.player_match_stats (season_key, team_code);

-- Scoring progression -------------------------------------------------
-- Every score in all 710 matches, with quarter, clock and team. The
-- scorer is named only in 2017-2021 and never from Season Six onward, so
-- player_name_raw is empty for 80% of rows — and it is a display name
-- with no slug, resolvable only within the match's two squads.
CREATE TABLE staging_aflw.scoring_events (
  match_key           text     NOT NULL REFERENCES staging_aflw.matches(match_key),
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  event_seq           smallint NOT NULL,
  period              smallint NOT NULL,
  clock               text     NOT NULL,
  team_code           text     NOT NULL,
  event_type          text     NOT NULL,
  player_name_raw     text     NOT NULL DEFAULT '',
  points              smallint NOT NULL,
  home_goals          smallint NOT NULL,
  home_behinds        smallint NOT NULL,
  away_goals          smallint NOT NULL,
  away_behinds        smallint NOT NULL,
  player_id           integer,      -- resolution target
  club_id             integer,
  source_page         text     NOT NULL,
  PRIMARY KEY (match_key, event_seq),
  CONSTRAINT saflw_events_type_ck CHECK
    (event_type IN ('GOAL', 'BEHIND', 'RUSHED BEHIND')),
  CONSTRAINT saflw_events_points_ck CHECK
    (points = CASE WHEN event_type = 'GOAL' THEN 6 ELSE 1 END),
  CONSTRAINT saflw_events_period_ck CHECK (period BETWEEN 1 AND 4),
  -- A rushed behind has no scorer by definition.
  CONSTRAINT saflw_events_rushed_ck CHECK
    (event_type <> 'RUSHED BEHIND' OR player_name_raw = '')
);
COMMENT ON TABLE staging_aflw.scoring_events IS
  'Score-by-score progression. AFLDB has no equivalent for the AFL competition; this is richer than anything on that side.';
CREATE INDEX ix_saflw_events_match ON staging_aflw.scoring_events (match_key, period, event_seq);

-- Player season totals ------------------------------------------------
-- The source's own per-season aggregates, kept solely to reconcile
-- against the sum of match rows. They are not a fact to import.
CREATE TABLE staging_aflw.player_seasons (
  season_key          text     NOT NULL REFERENCES staging_aflw.seasons(season_key),
  player_slug         text     NOT NULL,
  player_name_raw     text     NOT NULL,
  team_code           text     NOT NULL,
  games               smallint NOT NULL,
  kicks               integer  NOT NULL,
  handballs           integer  NOT NULL,
  disposals           integer  NOT NULL,
  contested           integer  NOT NULL,
  metres_gained       integer  NOT NULL,
  marks               integer  NOT NULL,
  tackles             integer  NOT NULL,
  hitouts             integer  NOT NULL,
  fantasy_points      integer  NOT NULL,
  goals               smallint,
  behinds             smallint,
  score_points        smallint,
  source_page         text     NOT NULL,
  PRIMARY KEY (season_key, player_slug)
);
COMMENT ON TABLE staging_aflw.player_seasons IS
  'DERIVED BY THE SOURCE, kept as a check only. All 12 totals reconcile exactly against player_match_stats across 3,972 player-seasons.';

-- Parse issues --------------------------------------------------------
CREATE TABLE staging_aflw.issues (
  id                  integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_page         text     NOT NULL,
  kind                text     NOT NULL,
  detail              text     NOT NULL
);
COMMENT ON TABLE staging_aflw.issues IS
  'Anything the parser could not handle cleanly. Empty apart from the two abandoned Season Six fixtures.';

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA staging_aflw TO afldb_import;
GRANT SELECT ON ALL TABLES IN SCHEMA staging_aflw TO afldb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA staging_aflw TO afldb_import;
