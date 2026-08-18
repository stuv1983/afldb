-- =====================================================================
-- AFLDB 053 — Player achievements: curated, source-only facts
-- =====================================================================
-- A player_achievements row is a claim that exists ONLY because a
-- curated source says so. There is no play-by-play or event-sequence
-- data anywhere in AFLDB -- no sequence_in_game, kick_number or
-- event_order column exists in any migration, and player_match_stats
-- (004) is whole-match aggregate totals -- so "kicked a goal with their
-- first kick" can never be recomputed or independently verified from
-- AFLDB's own tables the way most of this schema can. It is a cited
-- external fact, and the schema says so rather than implying otherwise.
--
-- That places it alongside hall_of_fame, honour_team_members and
-- captaincies (005): player_id nullable, the source's own spelling
-- always retained, link_status_value recording how confident the link
-- is. It deliberately does NOT extend src/db/queries/records.ts's
-- RECORD_CATEGORIES, which is rank() OVER (...) windows over an
-- existing numeric column and is structurally incapable of
-- representing a discrete external fact with no backing column.
--
-- The table is named for achievements rather than "records" because
-- /records already means something specific and different in this
-- codebase (computed leaderboards, nothing stored).
--
-- achievement_type is an enum, matching link_status, club_succession,
-- round_type, import_status and issue_severity -- every categorical
-- column in this schema so far. A future type is one
-- ALTER TYPE player_achievement_type ADD VALUE in its own migration.
-- On PG12+ that may run inside a transaction block, but the new value
-- cannot be USED in the same transaction that added it; that never
-- collides with this codebase's workflow, where a migration changes
-- schema and a separate later import writes rows.
-- =====================================================================

CREATE TYPE player_achievement_type AS ENUM ('first_kick_goal');

CREATE TABLE player_achievements (
  id                  integer  PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  achievement_type    player_achievement_type NOT NULL,

  -- Player identity. The source spelling is retained even when the row
  -- cannot be linked -- the same rule hall_of_fame and captaincies
  -- follow, so an unmatched row is still evidence rather than a gap.
  player_id           integer  REFERENCES players(id),
  player_name_raw     text     NOT NULL,
  player_name_clean   text     NOT NULL,
  source_annotation   text,
  link_status_value   link_status NOT NULL,
  candidate_count     smallint NOT NULL DEFAULT 0,

  club_id             integer  REFERENCES clubs(id),
  club_name_raw       text     NOT NULL,

  season              smallint NOT NULL REFERENCES seasons(year),
  season_footnote_raw text,
  round_raw           text     NOT NULL,

  -- Decoded from the source's own legend, not inferred. The raw marker
  -- substring stays in source_annotation above: the evidence and the
  -- decision made from it stay separately visible, the same way
  -- player_birth_evidence (018) keeps evidence beside the chosen value.
  consecutive_goal_kicks              smallint NOT NULL DEFAULT 1
    CONSTRAINT player_achievements_consecutive_ck CHECK (consecutive_goal_kicks >= 1),
  no_further_career_goals             boolean  NOT NULL DEFAULT false,
  no_further_career_kicks             boolean  NOT NULL DEFAULT false,
  kickless_matches_before_first_kick  smallint NOT NULL DEFAULT 0
    CONSTRAINT player_achievements_kickless_ck CHECK (kickless_matches_before_first_kick >= 0),

  match_id            integer  REFERENCES matches(id),
  notes               text,

  -- link_status's own rule, enforced rather than trusted: only 'unique'
  -- and 'resolved' are confirmed links, and exactly those carry a
  -- player_id. An 'ambiguous' row with a player_id would be a silent
  -- guess, which is the failure this column exists to prevent.
  CONSTRAINT player_achievements_link_ck CHECK (
    (link_status_value IN ('unique', 'resolved')) = (player_id IS NOT NULL)
  )
);

COMMENT ON TABLE player_achievements IS
  'Curated, source-only facts about a player that AFLDB cannot recompute from its own '
  'match data. Modelled on hall_of_fame/captaincies (005), not on records.ts.';
COMMENT ON COLUMN player_achievements.source_annotation IS
  'The trailing marker substring exactly as the source wrote it, e.g. "(6)", "## *". '
  'Kept as the audit trail for the typed columns decoded from it.';
-- (Comment wording corrected by migration 054 -- kept identical here so a
-- from-scratch database reads the same as a migrated one.)
COMMENT ON COLUMN player_achievements.round_raw IS
  'Verbatim source round code, including non-numeric codes such as SF. For first_kick_goal '
  'this is the round of the FIRST KICK, which is the debut match only when '
  'kickless_matches_before_first_kick = 0. Together with season, this is what locates '
  'match_id: the player''s recorded game in the stated season and round.';
COMMENT ON COLUMN player_achievements.consecutive_goal_kicks IS
  'first_kick_goal legend "(n)": the player scored a goal with EACH of their first n kicks. '
  '1 (the default) means the plain achievement: the first kick only.';
COMMENT ON COLUMN player_achievements.no_further_career_goals IS
  'first_kick_goal legend "*": the player never scored another goal. Unlike the achievement '
  'itself this is checkable against player_career_stats.goals, and the importer does check it.';
COMMENT ON COLUMN player_achievements.no_further_career_kicks IS
  'first_kick_goal legend "†": the player never recorded another kick of any kind. '
  'Also checkable against player_career_stats.kicks.';
COMMENT ON COLUMN player_achievements.kickless_matches_before_first_kick IS
  'first_kick_goal legend "#" / "##": the player played 1 or 2 earlier matches without '
  'recording a kick, so the achievement occurred after their senior debut, not in it.';
COMMENT ON COLUMN player_achievements.match_id IS
  'The match in which the achievement occurred: the player''s game in the source-stated '
  'season and round (the importer absorbs the Opening Round off-by-one for seasons that '
  'have one). NEVER inferred from career game position -- the "#" markers that would make '
  'position reliable are incomplete (Brent Harvey: debut 1996 R22 with no recorded kick, '
  'first kick 1997 R5). NULL when the player has no recorded game in that round.';

SELECT add_provenance_columns('player_achievements');

-- The source's own record identity, the same discipline migration 042
-- established for award_winners/award_nominations/captaincies -- and for
-- the same reason: a name is not a safe key on its own. NULLS NOT
-- DISTINCT (PG15+; this is 16.14) so a row without a source key is not
-- silently exempt from the constraint.
ALTER TABLE player_achievements
  ADD CONSTRAINT player_achievements_source_uq
  UNIQUE NULLS NOT DISTINCT (source_id, source_record_id);

CREATE INDEX ix_player_achievements_type   ON player_achievements (achievement_type);
-- Partial on player_id IS NOT NULL, not on the link_status values that
-- imply it: the CHECK above makes the two cover identical rows, but only
-- this form is one the FK's own referential check can use when a player
-- row is deleted (the shape migration 041 established, and what
-- tests/integration/fk-indexes.test.ts enforces).
CREATE INDEX ix_player_achievements_player ON player_achievements (player_id)
  WHERE player_id IS NOT NULL;
CREATE INDEX ix_player_achievements_club   ON player_achievements (club_id, season);
CREATE INDEX ix_player_achievements_season ON player_achievements (achievement_type, season);
CREATE INDEX ix_player_achievements_match  ON player_achievements (match_id);

-- The source's prose claims "332 players recognised"; the supplied
-- extract actually carries 334 rows and runs to round 19, 2026, so that
-- sentence is stale rather than the extract being short. Recorded here
-- as a dated claim ABOUT the source. Nothing validates against it: the
-- importer writes the real imported/matched/ambiguous/unmatched counts
-- to data_issues every run, where they can be read as live facts.
INSERT INTO sources (key, name, url, kind, description) VALUES (
  'wikipedia_first_kick_goal',
  'VFL/AFL players to have scored a goal with their first kick',
  'https://en.wikipedia.org/wiki/List_of_VFL/AFL_players_to_have_scored_a_goal_with_their_first_kick',
  'upstream_dataset',
  'Curated Wikipedia list. Claimed "332 players recognised" as of the extract taken '
  || '2026-08-18, which carried 334 rows; treat the figure as a dated claim about the '
  || 'source, never as a completeness target. Legend: (n) goals with each of the first n '
  || 'kicks; * no further career goals; † no further career kicks; # / ## one or two '
  || 'kickless matches preceded the first kick.'
) ON CONFLICT (key) DO NOTHING;

-- A public record page and player profiles read this table, so it must
-- be registered readable: since migration 039 afldb_app's default is
-- fail-closed and a new table is invisible until this call.
SELECT afldb_meta.grant_app_read('player_achievements');
SELECT afldb_meta.grant_import_write('player_achievements');
