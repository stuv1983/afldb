-- =====================================================================
-- AFLDB 002 — Core entities: seasons, clubs, venues, players
-- =====================================================================

-- Seasons -------------------------------------------------------------
CREATE TABLE seasons (
  year              smallint    PRIMARY KEY,
  competition       text        NOT NULL DEFAULT 'VFL/AFL',
  -- The league was the VFL until 1989 and the AFL from 1990.
  league            text        NOT NULL,
  is_complete       boolean     NOT NULL DEFAULT true,
  first_match_date  date,
  last_match_date   date,
  match_count       integer,
  club_count        smallint,
  premier_club_id   integer,   -- FK added after clubs exists
  notes             text,
  CONSTRAINT seasons_year_ck   CHECK (year BETWEEN 1897 AND 2100),
  CONSTRAINT seasons_league_ck CHECK (league IN ('VFL', 'AFL'))
);
COMMENT ON COLUMN seasons.is_complete IS
  'false while a season is still being played. The 2026 season is in progress and must not be presented as final.';

-- Clubs ---------------------------------------------------------------
-- All 24 historical identities, not just the 18 current clubs.
CREATE TYPE club_succession AS ENUM (
  'current',    -- still competing under this identity
  'renamed',    -- same club, later name (Footscray -> Western Bulldogs)
  'relocated',  -- club moved (South Melbourne -> Sydney)
  'merged',     -- merged into another club
  'defunct'     -- ceased (University)
);

CREATE TABLE clubs (
  id                  integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  slug                text     NOT NULL UNIQUE,
  name                text     NOT NULL UNIQUE,
  short_name          text     NOT NULL,
  abbreviation        text     NOT NULL,

  -- Modern successor identity. Self-referencing for clubs that never
  -- changed, and for defunct clubs kept distinct in the source data.
  -- Reproduces the legacy club_now semantics exactly.
  current_identity_id integer  NOT NULL REFERENCES clubs(id),
  succession          club_succession NOT NULL DEFAULT 'current',

  is_current_afl_club boolean  NOT NULL DEFAULT false,
  first_season        smallint REFERENCES seasons(year),
  last_season         smallint REFERENCES seasons(year),

  home_state          text,
  wikipedia_url       text,
  afltables_slug      text,
  legacy_club_key     text,     -- legacy clubs.club_id, where one existed
  legacy_club_hist    text     NOT NULL UNIQUE,  -- legacy games.club_hist value
  notes               text
);
COMMENT ON TABLE clubs IS
  '24 historical club identities. Historical identity is never destroyed by modern renaming.';
COMMENT ON COLUMN clubs.current_identity_id IS
  'Modern successor identity, equal to id for clubs that never changed. Reproduces legacy games.club_now.';
COMMENT ON COLUMN clubs.legacy_club_hist IS
  'The legacy games.club_hist string this identity was migrated from. Migration key.';

CREATE INDEX ix_clubs_current_identity ON clubs (current_identity_id);
CREATE INDEX ix_clubs_is_current       ON clubs (is_current_afl_club) WHERE is_current_afl_club;

ALTER TABLE seasons
  ADD CONSTRAINT seasons_premier_fk FOREIGN KEY (premier_club_id) REFERENCES clubs(id);

-- Club aliases --------------------------------------------------------
CREATE TABLE club_aliases (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  club_id    integer NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  alias      text    NOT NULL,
  alias_type text    NOT NULL DEFAULT 'alternate',
  source_id  smallint REFERENCES sources(id),
  CONSTRAINT club_aliases_type_ck CHECK (alias_type IN
    ('alternate','historical','abbreviation','nickname','source_string')),
  CONSTRAINT club_aliases_uq UNIQUE (club_id, alias)
);
CREATE INDEX ix_club_aliases_lookup ON club_aliases (lower(alias));

-- Venues --------------------------------------------------------------
-- Venue names arrive as free text. Canonicalisation is a later
-- enrichment pass, so venue_id is nullable everywhere it is referenced
-- and the raw string is always preserved alongside it.
CREATE TABLE venues (
  id             integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  slug           text     NOT NULL UNIQUE,
  canonical_name text     NOT NULL UNIQUE,
  legacy_name    text     UNIQUE,   -- legacy games.venue string
  city           text,
  state          text,
  country        text     NOT NULL DEFAULT 'Australia',
  first_season   smallint REFERENCES seasons(year),
  last_season    smallint REFERENCES seasons(year),
  notes          text
);
COMMENT ON TABLE venues IS
  'Venue entities derived from free-text names. Canonical naming is an enrichment pass; raw strings are never discarded.';

CREATE TABLE venue_aliases (
  id        integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  venue_id  integer  NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  alias     text     NOT NULL,
  source_id smallint REFERENCES sources(id),
  CONSTRAINT venue_aliases_uq UNIQUE (venue_id, alias)
);
CREATE INDEX ix_venue_aliases_lookup ON venue_aliases (lower(alias));

-- Players -------------------------------------------------------------
CREATE TABLE players (
  id                integer  PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,

  -- Legacy identifier, retained so parity checks against the legacy
  -- database are exact. The migration seeds id = legacy_player_id.
  legacy_player_id  integer  UNIQUE,

  display_name      text     NOT NULL,
  sort_name         text     NOT NULL,
  -- Normalised for search: lowercase, unaccented, punctuation stripped.
  -- Canonical display_name is never altered.
  search_name       text     NOT NULL,
  slug              text     NOT NULL,

  given_name        text,
  surname           text,

  -- Date of birth is missing for ~93% of players. NULL means unknown,
  -- never a default date.
  dob               date,
  dob_confidence    value_confidence NOT NULL DEFAULT 'unknown',
  birth_year        smallint,
  birth_year_min    smallint,
  birth_year_max    smallint,
  birth_year_confidence value_confidence NOT NULL DEFAULT 'unknown',

  height_cm         smallint,
  weight_kg         smallint,

  -- Career span. Derived from player_match_stats and rebuilt by the
  -- derived-data pass; stored here for cheap listing queries.
  debut_season      smallint REFERENCES seasons(year),
  final_season      smallint REFERENCES seasons(year),

  notes             text,
  CONSTRAINT players_birth_range_ck CHECK (
    birth_year_min IS NULL OR birth_year_max IS NULL OR birth_year_min <= birth_year_max)
);
COMMENT ON TABLE players IS
  'Player identity only. Career totals live in player_career_stats and are always derived.';
COMMENT ON COLUMN players.dob IS
  'NULL means unknown. ~93% of historical players have no recorded DOB; enrichment is a later pass.';
COMMENT ON COLUMN players.search_name IS
  'Normalised search form. Never displayed; display_name is canonical.';

CREATE INDEX ix_players_search_name ON players (search_name);
CREATE INDEX ix_players_sort_name   ON players (sort_name);
CREATE INDEX ix_players_slug        ON players (slug);
CREATE INDEX ix_players_debut       ON players (debut_season);

-- Player name aliases (maiden/alternate spellings, source variants).
CREATE TABLE player_name_aliases (
  id         integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  player_id  integer  NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  alias      text     NOT NULL,
  search_alias text   NOT NULL,
  alias_type text     NOT NULL DEFAULT 'source_string',
  source_id  smallint REFERENCES sources(id),
  CONSTRAINT player_name_aliases_uq UNIQUE (player_id, alias)
);
CREATE INDEX ix_player_name_aliases_search ON player_name_aliases (search_alias);

-- External identities -------------------------------------------------
-- Bridges third-party person IDs (e.g. DraftGuru) to AFLDB players,
-- preserving the link confidence rather than assuming a match.
CREATE TABLE external_identities (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id         smallint NOT NULL REFERENCES sources(id),
  external_id       text     NOT NULL,
  external_name     text,
  external_url      text,
  player_id         integer  REFERENCES players(id),
  status            link_status NOT NULL,
  candidate_count   smallint NOT NULL DEFAULT 0,
  match_method      text,
  notes             text,
  CONSTRAINT external_identities_uq UNIQUE (source_id, external_id)
);
COMMENT ON TABLE external_identities IS
  'Third-party person IDs. player_id is NULL unless status is unique/resolved.';
CREATE INDEX ix_external_identities_player ON external_identities (player_id)
  WHERE status IN ('unique','resolved');

-- Statistic availability ---------------------------------------------
-- Per-season presence, NOT a min/max range. The legacy stat_coverage
-- table reports Brownlow as "1931-2025", which conceals the fact that
-- per-game votes do not exist between 1935 and 1983. Storing presence
-- per season is what lets the UI distinguish a true 0 from "not recorded".
CREATE TABLE stat_definitions (
  key           text PRIMARY KEY,
  label         text NOT NULL,
  short_label   text NOT NULL,
  description   text,
  unit          text NOT NULL DEFAULT 'count',
  is_cumulative boolean NOT NULL DEFAULT true,
  display_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE stat_availability (
  stat_key        text     NOT NULL REFERENCES stat_definitions(key) ON DELETE CASCADE,
  season          smallint NOT NULL REFERENCES seasons(year),
  is_recorded     boolean  NOT NULL,
  populated_rows  integer,
  total_rows      integer,
  PRIMARY KEY (stat_key, season)
);
COMMENT ON TABLE stat_availability IS
  'Per-season presence of each statistic. is_recorded=false means the statistic was not collected: the UI must show "not recorded", never 0.';

CREATE INDEX ix_stat_availability_season ON stat_availability (season) WHERE is_recorded;
