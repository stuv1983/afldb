-- =====================================================================
-- AFLDB 005 — Brownlow votes, awards and honours
-- =====================================================================

-- Brownlow season votes ----------------------------------------------
-- AUTHORITATIVE source for season and career Brownlow totals (1924-2025,
-- 79,113 votes). The legacy players.career_brownlow column was derived
-- by summing per-game votes and is short by 32,134 votes (40.6%),
-- because per-game votes do not exist for 1935-1983. Career totals must
-- be built from this table.
CREATE TABLE brownlow_season_votes (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  season            smallint NOT NULL REFERENCES seasons(year),
  player_id         integer  NOT NULL REFERENCES players(id),
  club_id           integer  REFERENCES clubs(id),

  votes             smallint NOT NULL,
  vote_rank         smallint,
  eligible_rank     smallint,
  is_ineligible     boolean  NOT NULL DEFAULT false,
  is_winner         boolean  NOT NULL DEFAULT false,

  games             smallint,
  three_vote_games  smallint,
  two_vote_games    smallint,
  one_vote_games    smallint,
  polling_games     smallint,

  -- Link confidence carried through from the source scrape.
  link_status_value link_status NOT NULL DEFAULT 'unique',

  source_id         smallint REFERENCES sources(id),
  source_record_id  text,
  import_batch_id   bigint   REFERENCES import_batches(id),

  CONSTRAINT brownlow_season_uq    UNIQUE (season, player_id),
  CONSTRAINT brownlow_votes_ck     CHECK (votes >= 0)
);
COMMENT ON TABLE brownlow_season_votes IS
  'Authoritative season Brownlow totals, 1924-2025. The only valid basis for career Brownlow totals.';

CREATE INDEX ix_brownlow_season   ON brownlow_season_votes (season, votes DESC);
CREATE INDEX ix_brownlow_player   ON brownlow_season_votes (player_id);
CREATE INDEX ix_brownlow_winners  ON brownlow_season_votes (season) WHERE is_winner;

-- Brownlow round votes ------------------------------------------------
-- Round-level detail, 1984-2025 only.
CREATE TABLE brownlow_round_votes (
  id             bigint   PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  season         smallint NOT NULL REFERENCES seasons(year),
  player_id      integer  NOT NULL REFERENCES players(id),
  round_number   smallint NOT NULL,
  played         boolean  NOT NULL,
  votes          smallint,
  CONSTRAINT brownlow_round_uq   UNIQUE (season, player_id, round_number),
  CONSTRAINT brownlow_round_ck   CHECK (votes IS NULL OR votes BETWEEN 0 AND 3)
);
COMMENT ON TABLE brownlow_round_votes IS
  'Round-by-round Brownlow votes. Coverage is 1984-2025 only; absence outside that range is not zero.';
CREATE INDEX ix_brownlow_round_player ON brownlow_round_votes (player_id, season);

-- Awards --------------------------------------------------------------
CREATE TABLE awards (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  slug          text    NOT NULL UNIQUE,
  name          text    NOT NULL,
  category      text    NOT NULL,
  competition   text,
  club_id       integer REFERENCES clubs(id),   -- set for club best-and-fairest
  description   text,
  first_season  smallint REFERENCES seasons(year),
  last_season   smallint REFERENCES seasons(year),
  CONSTRAINT awards_category_ck CHECK (category IN
    ('award','club_best_and_fairest','draft_pick','honour_team','hall_of_fame'))
);
COMMENT ON TABLE awards IS 'Award definitions, separated from their winners.';

CREATE TABLE award_winners (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  award_id          integer  NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  season            smallint REFERENCES seasons(year),

  -- player_id is NULL when the source name could not be linked with
  -- confidence. The source name is always retained so nothing is lost.
  player_id         integer  REFERENCES players(id),
  player_name_raw   text     NOT NULL,
  link_status_value link_status NOT NULL,
  candidate_count   smallint NOT NULL DEFAULT 0,

  club_id           integer  REFERENCES clubs(id),
  club_name_raw     text,

  votes             numeric(8,2),
  position          text,
  is_captain        boolean NOT NULL DEFAULT false,
  is_vice_captain   boolean NOT NULL DEFAULT false,
  note              text,

  source_id         smallint REFERENCES sources(id),
  source_record_id  text,
  import_batch_id   bigint   REFERENCES import_batches(id)
);
COMMENT ON COLUMN award_winners.player_id IS
  'NULL when the source name could not be confidently linked. player_name_raw always retains the source value.';

CREATE INDEX ix_award_winners_award  ON award_winners (award_id, season);
CREATE INDEX ix_award_winners_player ON award_winners (player_id)
  WHERE link_status_value IN ('unique','resolved');
CREATE INDEX ix_award_winners_unlinked ON award_winners (award_id)
  WHERE player_id IS NULL;

-- Award nominations (Rising Star) -------------------------------------
CREATE TABLE award_nominations (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  award_id          integer  NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  season            smallint NOT NULL REFERENCES seasons(year),
  round_number      smallint,
  player_id         integer  REFERENCES players(id),
  player_name_raw   text     NOT NULL,
  link_status_value link_status NOT NULL,
  club_id           integer  REFERENCES clubs(id),
  opponent_club_id  integer  REFERENCES clubs(id),
  is_winner         boolean  NOT NULL DEFAULT false,
  is_ineligible     boolean  NOT NULL DEFAULT false,
  ineligible_reason text,
  votes             smallint,
  stat_line         jsonb,
  source_id         smallint REFERENCES sources(id),
  source_record_id  text,
  import_batch_id   bigint   REFERENCES import_batches(id)
);
CREATE INDEX ix_award_nominations_season ON award_nominations (award_id, season, round_number);
CREATE INDEX ix_award_nominations_player ON award_nominations (player_id);

-- Hall of Fame --------------------------------------------------------
-- 102 of 343 inductees are coaches, administrators or state-league
-- figures with no VFL/AFL playing record. They are kept as name-only
-- rows rather than being force-matched to a player.
CREATE TABLE hall_of_fame (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name              text     NOT NULL,
  player_id         integer  REFERENCES players(id),
  link_status_value link_status NOT NULL,
  category          text,
  inducted_year     smallint,
  is_legend         boolean  NOT NULL DEFAULT false,
  legend_year       smallint,
  club_name_raw     text,
  state             text,
  playing_career    text,
  removed_year      smallint,
  notes             text,
  source_id         smallint REFERENCES sources(id),
  import_batch_id   bigint   REFERENCES import_batches(id)
);
CREATE INDEX ix_hof_player ON hall_of_fame (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX ix_hof_legend ON hall_of_fame (inducted_year) WHERE is_legend;

-- Honour teams (Teams of the Century etc.) ----------------------------
CREATE TABLE honour_team_members (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  team_name         text     NOT NULL,
  player_id         integer  REFERENCES players(id),
  player_name_raw   text     NOT NULL,
  link_status_value link_status NOT NULL,
  position          text,
  role              text,
  club_name_raw     text,
  sort_order        smallint NOT NULL DEFAULT 0,
  note              text,
  source_id         smallint REFERENCES sources(id),
  import_batch_id   bigint   REFERENCES import_batches(id),
  CONSTRAINT honour_team_uq UNIQUE (team_name, player_name_raw)
);
CREATE INDEX ix_honour_team ON honour_team_members (team_name, sort_order);

-- Captaincies ---------------------------------------------------------
CREATE TABLE captaincies (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  season            smallint NOT NULL REFERENCES seasons(year),
  club_id           integer  NOT NULL REFERENCES clubs(id),
  player_id         integer  REFERENCES players(id),
  player_name_raw   text     NOT NULL,
  link_status_value link_status NOT NULL,
  role              text     NOT NULL DEFAULT 'Captain',
  period            text,
  notes             text,
  source_id         smallint REFERENCES sources(id),
  source_record_id  text,
  import_batch_id   bigint   REFERENCES import_batches(id)
);
CREATE INDEX ix_captaincies_club   ON captaincies (club_id, season);
CREATE INDEX ix_captaincies_player ON captaincies (player_id)
  WHERE link_status_value IN ('unique','resolved');
