-- =====================================================================
-- AFLDB 062 — Player match period stats (quarter-by-quarter player stats)
-- =====================================================================

CREATE TABLE player_match_period_stats (
  id              bigint   PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  player_id       integer  NOT NULL REFERENCES players(id),
  match_id        integer  NOT NULL REFERENCES matches(id),
  club_id         integer  NOT NULL REFERENCES clubs(id),
  period          smallint NOT NULL, -- 1=Q1, 2=Q2, 3=Q3, 4=Q4, 5=ET1, etc.

  kicks           smallint,
  marks           smallint,
  handballs       smallint,
  disposals       smallint,
  goals           smallint,
  behinds         smallint,
  hitouts         smallint,
  tackles         smallint,
  rebounds        smallint,
  inside_50s      smallint,
  clearances      smallint,
  clangers        smallint,
  frees_for       smallint,
  frees_against   smallint,
  contested       smallint,
  uncontested     smallint,
  contested_marks smallint,
  marks_inside_50 smallint,
  one_percenters  smallint,
  bounces         smallint,
  goal_assists    smallint,

  source_id       smallint REFERENCES sources(id),
  import_batch_id bigint   REFERENCES import_batches(id),

  CONSTRAINT pmps_player_match_period_uq UNIQUE (player_id, match_id, period)
);

COMMENT ON TABLE player_match_period_stats IS 'Quarter-by-quarter statistics for players.';

CREATE INDEX ix_pmps_player ON player_match_period_stats (player_id);
CREATE INDEX ix_pmps_match ON player_match_period_stats (match_id);
CREATE INDEX ix_pmps_club ON player_match_period_stats (club_id);
