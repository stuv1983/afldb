-- =====================================================================
-- AFLDB 004 — Player match statistics (primary fact table, ~694,210 rows)
-- =====================================================================
-- NULL vs 0 is the central rule of this table. Most statistics were not
-- collected before the 1960s-2000s; a NULL means "not recorded in this
-- era" and must never be rendered as 0. Per-season availability is in
-- stat_availability.
--
-- Deliberately NOT stored here (all derivable from matches via match_id,
-- which has zero orphans): venue, opponent club, is_home, result,
-- points for/against, is_final. Storing them would create the
-- possibility of a fact table that disagrees with its own matches.
-- =====================================================================

CREATE TABLE player_match_stats (
  id              bigint   PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  player_id       integer  NOT NULL REFERENCES players(id),
  match_id        integer  NOT NULL REFERENCES matches(id),
  -- The club identity the player represented on the day (historical,
  -- e.g. Footscray rather than Western Bulldogs). The modern identity
  -- resolves through clubs.current_identity_id.
  club_id         integer  NOT NULL REFERENCES clubs(id),

  career_game_no  smallint,
  jumper_number   text,

  -- Statistics. All nullable: NULL = not recorded.
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

  -- Per-game Brownlow votes exist ONLY for 1931-1934 and 1984-2025.
  -- Outside those windows this is NULL and means "not recorded" — the
  -- authoritative season/career totals live in brownlow_season_votes.
  brownlow_votes  smallint,

  source_id       smallint REFERENCES sources(id),
  import_batch_id bigint   REFERENCES import_batches(id),

  CONSTRAINT pms_player_match_uq   UNIQUE (player_id, match_id),
  CONSTRAINT pms_brownlow_range_ck CHECK (brownlow_votes IS NULL OR brownlow_votes BETWEEN 0 AND 3)
);
COMMENT ON TABLE player_match_stats IS
  'One row per player per match. A NULL statistic means not recorded in that era, never zero.';
COMMENT ON COLUMN player_match_stats.club_id IS
  'Historical club identity on the day. Modern identity via clubs.current_identity_id.';
COMMENT ON COLUMN player_match_stats.brownlow_votes IS
  'Per-game votes, available only 1931-1934 and 1984-2025. NULL elsewhere means not recorded. Never sum this for career totals.';

-- Indexes sized to the real workload. Built after bulk COPY by the
-- migration tool, then ANALYZEd.
CREATE INDEX ix_pms_player          ON player_match_stats (player_id);
CREATE INDEX ix_pms_match           ON player_match_stats (match_id);
CREATE INDEX ix_pms_club            ON player_match_stats (club_id);
CREATE INDEX ix_pms_player_club     ON player_match_stats (player_id, club_id);
CREATE INDEX ix_pms_club_player     ON player_match_stats (club_id, player_id);
-- Single-game record leaderboards.
CREATE INDEX ix_pms_goals           ON player_match_stats (goals DESC)     WHERE goals     IS NOT NULL;
CREATE INDEX ix_pms_disposals       ON player_match_stats (disposals DESC) WHERE disposals IS NOT NULL;
CREATE INDEX ix_pms_brownlow        ON player_match_stats (brownlow_votes) WHERE brownlow_votes IS NOT NULL AND brownlow_votes > 0;
