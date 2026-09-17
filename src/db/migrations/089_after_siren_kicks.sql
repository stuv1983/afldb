-- =====================================================================
-- AFLDB 089 — After-the-siren kicks: curated match events (AFLDB-ISSUE-118 §23.33)
-- =====================================================================
-- A kick after the final siren that won, drew, or failed to change a
-- match is a discrete event AFLDB cannot recompute: player_match_stats
-- (004) is whole-match totals and there is no play-by-play anywhere in
-- the schema. It is therefore a curated, cited external fact in exactly
-- the sense migration 053 gave player_achievements, and this table
-- follows 053's discipline: nullable player link with the source's own
-- spelling retained, link_status_value + candidate_count, club, season,
-- verbatim round, nullable match, provenance, (source_id,
-- source_record_id) uniqueness.
--
-- It is NOT a player_achievement_type value. That table's shape is a
-- single-player fact keyed on the player's own career: its match_id is
-- documented as "resolved by career game position, never by
-- season/round/club lookup", and its typed columns (consecutive_goal_kicks,
-- no_further_career_*, kickless_matches_before_first_kick) are legend
-- decodings of one source. An after-the-siren event is a MATCH event
-- with an opponent, what the kick scored, what it did to the result,
-- which siren it followed, the competition (pre-season and night-series
-- tables exist and cannot resolve to a premiership-season match), and
-- the source's own final score. Carrying that on player_achievements
-- would mean five nullable columns meaningful to one type, a match_id
-- whose resolution rule contradicts the column comment, and inert
-- first-kick columns on every row. A small dedicated table models the
-- fact cleanly; nothing here is specific to any Grid Solver criterion
-- (Gridley's "win after siren" is later a filter over these columns:
-- premiership_season AND kick_scored <> 'none' AND kick_effect = 'won').
--
-- Categorical columns are enums, as every categorical column in this
-- schema is (link_status, round_type, player_achievement_type, ...).
-- =====================================================================

CREATE TYPE after_siren_score  AS ENUM ('goal', 'behind', 'none');
CREATE TYPE after_siren_effect AS ENUM ('won', 'drew', 'none');
CREATE TYPE after_siren_result AS ENUM ('win', 'draw', 'loss');
CREATE TYPE after_siren_siren  AS ENUM ('final', 'end_of_regulation', 'end_of_extra_time');

CREATE TABLE after_siren_kicks (
  id                  integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- The kicker. Source spelling retained even when unlinked (053 / 005).
  player_id           integer  REFERENCES players(id),
  player_name_raw     text     NOT NULL,
  player_name_clean   text     NOT NULL,
  link_status_value   link_status NOT NULL,
  candidate_count     smallint NOT NULL DEFAULT 0,

  -- The kicker's club and the opponent, both as the source wrote them.
  club_id             integer  REFERENCES clubs(id),
  club_name_raw       text     NOT NULL,
  opponent_club_id    integer  REFERENCES clubs(id),
  opponent_name_raw   text     NOT NULL,

  -- Competition. premiership_season rows are VFL/AFL home-and-away or
  -- finals matches and are the only rows that can carry a match_id;
  -- pre-season / night-series rows (Escort Championships, NAB Cup, JLT
  -- Community Series) keep their competition name and never resolve to
  -- a matches row, because matches (003) holds premiership seasons only.
  competition         text     NOT NULL,
  premiership_season  boolean  NOT NULL,
  season              smallint NOT NULL REFERENCES seasons(year),
  round_raw           text     NOT NULL,
  match_id            integer  REFERENCES matches(id),

  -- The event. kick_scored is what the kick registered; kick_effect is
  -- what it did to the result; kicker_result is the match result from
  -- the kicker's side; siren is which siren the kick followed. A miss
  -- that scored a behind is ('behind', 'none'): the score is a fact, the
  -- result was unchanged. shot_detail carries the source's qualifier
  -- for a miss ('fell short', 'out on the full', 'hit the goal post').
  kick_scored         after_siren_score  NOT NULL,
  kick_effect         after_siren_effect NOT NULL,
  shot_detail         text,
  kicker_result       after_siren_result NOT NULL,
  siren               after_siren_siren  NOT NULL DEFAULT 'final',

  -- The source's own final score, kicker's side first, and the points
  -- it states. Kept verbatim: the kicker's goals.behinds in one 1944 row
  -- do not add to the stated points, and the artefact records that
  -- rather than correcting either figure.
  kicker_score_raw    text     NOT NULL,
  opponent_score_raw  text     NOT NULL,
  kicker_points       smallint NOT NULL,
  opponent_points     smallint NOT NULL,
  supergoal_scoring   boolean  NOT NULL DEFAULT false,

  cited               boolean  NOT NULL DEFAULT true,
  source_annotation   text,
  notes               text,

  -- link_status's own rule (053): trusted statuses carry a player, nothing else does.
  CONSTRAINT after_siren_kicks_link_ck CHECK (
    (link_status_value IN ('unique', 'resolved')) = (player_id IS NOT NULL)
  ),
  -- A kick that won the match was a win by at most a goal (a behind: by one point);
  -- a kick that drew it left the scores level; a kick that changed nothing could
  -- not have followed the siren that preceded extra time's result being decided.
  CONSTRAINT after_siren_kicks_effect_ck CHECK (
    (kick_effect = 'won'  AND kicker_result = 'win'  AND kick_scored <> 'none'
       AND kicker_points - opponent_points BETWEEN 1 AND CASE kick_scored WHEN 'goal' THEN 6 ELSE 1 END)
    OR (kick_effect = 'drew' AND kicker_result = 'draw' AND kick_scored <> 'none'
       AND kicker_points = opponent_points)
    OR (kick_effect = 'none' AND (kicker_result <> 'win' OR siren = 'end_of_regulation'))
  ),
  CONSTRAINT after_siren_kicks_regulation_ck CHECK (siren <> 'end_of_regulation' OR kick_effect = 'none'),
  CONSTRAINT after_siren_kicks_match_ck CHECK (premiership_season OR match_id IS NULL),
  CONSTRAINT after_siren_kicks_points_ck CHECK (kicker_points >= 0 AND opponent_points >= 0)
);

COMMENT ON TABLE after_siren_kicks IS
  'Curated, cited kicks after the siren (won, drew, or missed), one row per source event, '
  'from Wikipedia''s "List of kicks after the siren in the VFL/AFL". Modelled on '
  'player_achievements (053): AFLDB has no play-by-play data to recompute these from.';
COMMENT ON COLUMN after_siren_kicks.kick_scored IS
  'What the kick registered: goal, behind, or none (fell short / out on the full).';
COMMENT ON COLUMN after_siren_kicks.kick_effect IS
  'What the kick did to the result: won, drew, or none (a missed opportunity, including a '
  'behind that left the kicker''s side behind or level).';
COMMENT ON COLUMN after_siren_kicks.kicker_result IS
  'The match result from the kicker''s side, read from the source''s final score.';
COMMENT ON COLUMN after_siren_kicks.siren IS
  'Which siren the kick followed: final (the ordinary case), end_of_extra_time (the final '
  'siren of a match that went to extra time), end_of_regulation (a kick before extra time '
  'was played; can only be a miss, since a score there would have decided the match).';
COMMENT ON COLUMN after_siren_kicks.competition IS
  'VFL/AFL for premiership-season matches; otherwise the source''s competition name '
  '(Escort Championships, NAB Cup, JLT Community Series).';
COMMENT ON COLUMN after_siren_kicks.match_id IS
  'The premiership-season match, resolved by (season, round, kicker''s club, opponent) with '
  'the source''s final score as an independent check. NULL for other competitions.';
COMMENT ON COLUMN after_siren_kicks.cited IS
  'false when the source row carried no reference; recorded as an evidence gap, not dropped.';

SELECT add_provenance_columns('after_siren_kicks');

ALTER TABLE after_siren_kicks
  ADD CONSTRAINT after_siren_kicks_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

CREATE INDEX ix_after_siren_kicks_player   ON after_siren_kicks (player_id) WHERE player_id IS NOT NULL;
CREATE INDEX ix_after_siren_kicks_club     ON after_siren_kicks (club_id, season);
CREATE INDEX ix_after_siren_kicks_opponent ON after_siren_kicks (opponent_club_id) WHERE opponent_club_id IS NOT NULL;
CREATE INDEX ix_after_siren_kicks_match    ON after_siren_kicks (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX ix_after_siren_kicks_effect   ON after_siren_kicks (kick_effect, kick_scored) WHERE premiership_season;

INSERT INTO sources (key, name, url, kind, description) VALUES (
  'wikipedia_after_siren_kicks',
  'List of kicks after the siren in the VFL/AFL',
  'https://en.wikipedia.org/wiki/List_of_kicks_after_the_siren_in_the_VFL/AFL',
  'upstream_dataset',
  'Curated Wikipedia list: goal / behind to win, goal / behind to draw, missed opportunity, '
  || 'each with an "other competitions" table for pre-season and night-series matches. '
  || 'Normalised by tools/migration/after_siren.py into data/records/after-siren-events.csv; '
  || 'the operator export''s revision is unrecorded, live revision 1371785656 inspected 2026-09-05.'
) ON CONFLICT (key) DO NOTHING;

SELECT afldb_meta.grant_app_read('after_siren_kicks');
SELECT afldb_meta.grant_import_write('after_siren_kicks');
