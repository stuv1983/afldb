-- =====================================================================
-- AFLDB 006 — Drafts, ladders and player relationships
-- =====================================================================

-- Draft picks ---------------------------------------------------------
-- 1,664 of 6,810 legacy draft rows (24%) could not be linked to a
-- player, and 154 more were rejected as implausible or ambiguous. Those
-- rows are still imported: player_id is NULL and link_status_value
-- records why. Re-running a better matching rule later only needs to
-- update these columns.
CREATE TABLE draft_picks (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  draft_year        smallint NOT NULL,
  draft_type        text     NOT NULL,
  draft_kind        text,
  pick_number       smallint,
  pick_note         text,

  player_id         integer  REFERENCES players(id),
  player_name_raw   text     NOT NULL,
  link_status_value link_status NOT NULL,
  candidate_count   smallint NOT NULL DEFAULT 0,
  match_method      text,
  confidence_notes  text,

  club_id           integer  REFERENCES clubs(id),
  club_name_raw     text,
  original_club_raw text,

  draft_age         smallint,
  height_cm         smallint,
  weight_kg         smallint,
  grade             text,
  competition       text,
  signing           text,
  signing_kind      text,
  detail            text,

  source_id         smallint REFERENCES sources(id),
  source_record_id  text,
  import_batch_id   bigint   REFERENCES import_batches(id)
);
COMMENT ON TABLE draft_picks IS
  'Draft and recruitment history from 1981. Unlinked picks are retained with player_id NULL rather than dropped.';
COMMENT ON COLUMN draft_picks.link_status_value IS
  'Only unique/resolved are trusted. Roughly 27% of legacy rows are unmatched, implausible or ambiguous.';

CREATE INDEX ix_draft_year   ON draft_picks (draft_year, pick_number);
CREATE INDEX ix_draft_player ON draft_picks (player_id)
  WHERE link_status_value IN ('unique','resolved');
CREATE INDEX ix_draft_club   ON draft_picks (club_id, draft_year);
CREATE INDEX ix_draft_unlinked ON draft_picks (draft_year) WHERE player_id IS NULL;

-- Club seasons / ladder ----------------------------------------------
CREATE TABLE club_seasons (
  id                 integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  season             smallint NOT NULL REFERENCES seasons(year),
  club_id            integer  NOT NULL REFERENCES clubs(id),

  played             smallint NOT NULL,
  wins               smallint NOT NULL,
  draws              smallint NOT NULL,
  losses             smallint NOT NULL,
  points_for         integer  NOT NULL,
  points_against     integer  NOT NULL,
  premiership_points integer,
  percentage         numeric(9,4),
  ladder_rank        smallint,
  wooden_spoon       boolean  NOT NULL DEFAULT false,
  is_premier         boolean  NOT NULL DEFAULT false,
  finals_played      smallint,

  source_id          smallint REFERENCES sources(id),
  import_batch_id    bigint   REFERENCES import_batches(id),

  CONSTRAINT club_seasons_uq       UNIQUE (season, club_id),
  CONSTRAINT club_seasons_games_ck CHECK (played = wins + draws + losses)
);
CREATE INDEX ix_club_seasons_club   ON club_seasons (club_id, season);
CREATE INDEX ix_club_seasons_ladder ON club_seasons (season, ladder_rank);

-- Player relationships ------------------------------------------------
CREATE TYPE relationship_type AS ENUM (
  'parent_child',
  'sibling',
  'grandparent_grandchild',
  'aunt_uncle_niece_nephew',
  'cousin',
  'spouse',
  'in_law',
  'other'
);

-- Both sides are nullable: many recorded family members never played
-- VFL/AFL, so the raw names are the durable record and the player links
-- are best-effort.
CREATE TABLE player_relationships (
  id                integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  family_key        text,
  family_name       text,

  person_a_player_id integer REFERENCES players(id),
  person_a_name      text    NOT NULL,
  person_a_role      text,
  person_b_player_id integer REFERENCES players(id),
  person_b_name      text    NOT NULL,
  person_b_role      text,

  relationship       relationship_type NOT NULL,
  relationship_label text     NOT NULL,
  confidence         text,
  evidence           text,
  extraction_method  text,

  source_id          smallint REFERENCES sources(id),
  source_record_id   text     UNIQUE,
  import_batch_id    bigint   REFERENCES import_batches(id)
);
COMMENT ON TABLE player_relationships IS
  'Football family relationships. Either side may be unlinked: many relatives never played VFL/AFL.';

CREATE INDEX ix_relationships_a      ON player_relationships (person_a_player_id)
  WHERE person_a_player_id IS NOT NULL;
CREATE INDEX ix_relationships_b      ON player_relationships (person_b_player_id)
  WHERE person_b_player_id IS NOT NULL;
CREATE INDEX ix_relationships_family ON player_relationships (family_key);
CREATE INDEX ix_relationships_type   ON player_relationships (relationship);

-- Father-son draft selections ----------------------------------------
CREATE TABLE father_son_selections (
  id                     integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  draft_year             smallint NOT NULL,
  rule                   text     NOT NULL,
  competition            text,
  drafted_player_id      integer  REFERENCES players(id),
  drafted_player_name    text     NOT NULL,
  drafted_link_status    link_status NOT NULL,
  father_player_id       integer  REFERENCES players(id),
  father_name            text     NOT NULL,
  father_link_status     link_status NOT NULL,
  club_id                integer  REFERENCES clubs(id),
  club_name_raw          text,
  selection_pick         smallint,
  selection_note         text,
  source_id              smallint REFERENCES sources(id),
  source_record_id       text     UNIQUE,
  import_batch_id        bigint   REFERENCES import_batches(id)
);
CREATE INDEX ix_father_son_child  ON father_son_selections (drafted_player_id);
CREATE INDEX ix_father_son_father ON father_son_selections (father_player_id);
