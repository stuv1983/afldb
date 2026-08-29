-- ---------------------------------------------------------------------
-- 076 — AFLDB-ISSUE-099 T5: typed AFL Tables settle projections, and
--       deduplication support for recurring data_issues
-- ---------------------------------------------------------------------
-- The in-season settle pass observes AFL Tables into migration 074's
-- generic spine and proposes reviewed promotion candidates from it. This
-- migration adds the two things that pass needs and nothing else.
--
-- WHY TYPED PROJECTIONS AT ALL. AFLDB-ISSUE-096 Decision B is binding:
-- "the jsonb spine never feeds a promotion. Resolution and diffing read
-- the typed projection; only history and absence read the spine. A family
-- with no typed projection cannot be promoted at all." ISSUE-099 v1
-- produces promotion candidates, so v1 requires these tables. They are
-- NOT preparation for the later acceptance transaction.
--
-- WHAT THESE TABLES ARE NOT. They are not a second canonical fact store.
-- Nothing reads them as a fact; they hold ONE source's proposal for a
-- canonical row, keyed by the exact observation version it came from, so
-- a reviewer can see what would be written and acceptance can detect that
-- the source has since moved on. There is no trigger, no rule and no
-- default here that touches a canonical table.
--
-- ZERO CANONICAL WRITES. AFLDB-ISSUE-099 v1 performs no canonical INSERT,
-- UPDATE or DELETE and writes no 'accept' promotion_decisions row. This
-- migration modifies exactly ONE existing public table — data_issues —
-- and only by adding a nullable column and a partial unique index.
--
-- DELIBERATELY ABSENT (AFLDB-ISSUE-099 §10.3), because v1 writes nothing
-- canonical and therefore needs none of it:
--   * add_provenance_columns('match_period_scores')
--   * add_provenance_columns('brownlow_round_votes')
--   * player_match_stats.source_record_id
--   * any widening of migration 073's data_overrides.entity_type CHECK
-- Each is a prerequisite of the FUTURE canonical acceptance stage
-- (AFLDB-ISSUE-099 §16 A1-A4) and belongs to whichever issue builds it.
--
-- Migrations 073, 074 and 075 are applied and checksum-frozen. Nothing
-- here edits them.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1 — staging.afltables_match
-- =====================================================================
-- One row per `afltables.match` observation whose identity is FULLY
-- resolved. An unresolved club, season or match gets NO row here: it
-- still gets a complete spine observation and an import_rejections row,
-- because presence and projection are separate facts (§19).
--
-- The real foreign keys are the point. They make resolved identity a
-- database-enforced fact rather than an application claim, so a defect in
-- the emitter cannot land a projection whose club does not exist. venue_id
-- is the one deliberate exception: an unmapped venue is normal and keeps
-- venue_id NULL while venue_raw carries the real source string. No venues
-- or venue_aliases row is ever created by this pass.
--
-- NULL SEMANTICS, throughout: NULL is "not recorded", never 0.
--   attendance      NULL = not recorded. A recorded 0 is a real crowd and
--                   cites its source, exactly as migration 020 requires.
--   match_time      NULL = not published.
--   quarter columns NULL = not recorded. A side/period whose goals,
--                   behinds AND points are all NULL is absent, not 0-0-0.
CREATE TABLE staging.afltables_match (
  -- The observation this projection was derived from. version_seq is part
  -- of the key relationship, not of the grain: one CURRENT projection per
  -- record, always naming the exact version it came from.
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  season               smallint    NOT NULL REFERENCES seasons(year),
  round_code           text        NOT NULL,
  round_number         smallint,
  round_type           round_type  NOT NULL,
  is_final             boolean     NOT NULL,
  match_date           date        NOT NULL,
  match_time           text,

  venue_id             integer     REFERENCES venues(id),
  venue_raw            text        NOT NULL,

  home_club_id         integer     NOT NULL REFERENCES clubs(id),
  away_club_id         integer     NOT NULL REFERENCES clubs(id),

  home_goals           smallint,
  home_behinds         smallint,
  home_score           smallint    NOT NULL,
  away_goals           smallint,
  away_behinds         smallint,
  away_score           smallint    NOT NULL,

  result               match_result NOT NULL,
  winner_club_id       integer     REFERENCES clubs(id),   -- NULL on a draw
  margin               smallint    NOT NULL,

  attendance           integer,
  attendance_status    coverage_status NOT NULL,
  attendance_source_id smallint    REFERENCES sources(id),

  -- The match_period_scores proposal: cumulative-to-date, as published.
  -- Periods 1-4 only. fitzRoy carries extra-time columns and the
  -- historical importer deliberately does not import them; this pass
  -- preserves that exactly and invents no extra-time handling.
  home_q1_goals smallint, home_q1_behinds smallint, home_q1_points smallint,
  home_q2_goals smallint, home_q2_behinds smallint, home_q2_points smallint,
  home_q3_goals smallint, home_q3_behinds smallint, home_q3_points smallint,
  home_q4_goals smallint, home_q4_behinds smallint, home_q4_points smallint,
  away_q1_goals smallint, away_q1_behinds smallint, away_q1_points smallint,
  away_q2_goals smallint, away_q2_behinds smallint, away_q2_points smallint,
  away_q3_goals smallint, away_q3_behinds smallint, away_q3_points smallint,
  away_q4_goals smallint, away_q4_behinds smallint, away_q4_points smallint,

  projected_by_batch_id bigint     NOT NULL REFERENCES import_batches(id),
  projected_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (source_id, family, external_record_id),
  FOREIGN KEY (source_id, family, external_record_id, version_seq)
    REFERENCES staging.source_record_versions
      (source_id, family, external_record_id, version_seq),

  CONSTRAINT afltables_match_clubs_differ_ck CHECK (home_club_id <> away_club_id),
  CONSTRAINT afltables_match_margin_ck       CHECK (margin = abs(home_score - away_score)),
  CONSTRAINT afltables_match_result_ck CHECK (
    (result = 'home_win' AND home_score > away_score) OR
    (result = 'away_win' AND away_score > home_score) OR
    (result = 'draw'     AND home_score = away_score)
  ),
  -- The winner is a restatement of the scores and of the two clubs.
  CONSTRAINT afltables_match_winner_ck CHECK (
    (result = 'draw' AND winner_club_id IS NULL)
    OR (result = 'home_win' AND winner_club_id = home_club_id)
    OR (result = 'away_win' AND winner_club_id = away_club_id)
  ),
  CONSTRAINT afltables_match_final_ck CHECK (is_final = (round_type <> 'home_and_away')),
  -- Scores are counts. A negative one is not a low score, it is a bug.
  CONSTRAINT afltables_match_nonnegative_ck CHECK (
    home_score >= 0 AND away_score >= 0
    AND (home_goals   IS NULL OR home_goals   >= 0)
    AND (home_behinds IS NULL OR home_behinds >= 0)
    AND (away_goals   IS NULL OR away_goals   >= 0)
    AND (away_behinds IS NULL OR away_behinds >= 0)
    AND (attendance   IS NULL OR attendance   >= 0)
  ),
  -- A goal is six points and a behind is one, wherever the breakdown is
  -- recorded. Mirrors matches_score_components_ck (migration 022).
  CONSTRAINT afltables_match_components_ck CHECK (
    (home_goals IS NULL OR home_behinds IS NULL
     OR home_score = 6 * home_goals + home_behinds)
    AND
    (away_goals IS NULL OR away_behinds IS NULL
     OR away_score = 6 * away_goals + away_behinds)
  ),
  -- The same reconciliation per period, mirroring
  -- match_period_components_ck. Cumulative totals reconcile exactly as
  -- running totals do, and the 1897-2025 canonical rebuild wrote 134,704
  -- rows through the equivalent constraint, so this is proven against
  -- this source rather than assumed.
  CONSTRAINT afltables_match_period_components_ck CHECK (
    (home_q1_goals IS NULL OR home_q1_behinds IS NULL OR home_q1_points IS NULL
     OR home_q1_points = 6 * home_q1_goals + home_q1_behinds)
    AND (home_q2_goals IS NULL OR home_q2_behinds IS NULL OR home_q2_points IS NULL
     OR home_q2_points = 6 * home_q2_goals + home_q2_behinds)
    AND (home_q3_goals IS NULL OR home_q3_behinds IS NULL OR home_q3_points IS NULL
     OR home_q3_points = 6 * home_q3_goals + home_q3_behinds)
    AND (home_q4_goals IS NULL OR home_q4_behinds IS NULL OR home_q4_points IS NULL
     OR home_q4_points = 6 * home_q4_goals + home_q4_behinds)
    AND (away_q1_goals IS NULL OR away_q1_behinds IS NULL OR away_q1_points IS NULL
     OR away_q1_points = 6 * away_q1_goals + away_q1_behinds)
    AND (away_q2_goals IS NULL OR away_q2_behinds IS NULL OR away_q2_points IS NULL
     OR away_q2_points = 6 * away_q2_goals + away_q2_behinds)
    AND (away_q3_goals IS NULL OR away_q3_behinds IS NULL OR away_q3_points IS NULL
     OR away_q3_points = 6 * away_q3_goals + away_q3_behinds)
    AND (away_q4_goals IS NULL OR away_q4_behinds IS NULL OR away_q4_points IS NULL
     OR away_q4_points = 6 * away_q4_goals + away_q4_behinds)
  ),
  CONSTRAINT afltables_match_period_nonnegative_ck CHECK (
    (home_q1_goals IS NULL OR home_q1_goals >= 0)
    AND (home_q1_behinds IS NULL OR home_q1_behinds >= 0)
    AND (home_q1_points  IS NULL OR home_q1_points  >= 0)
    AND (home_q2_goals   IS NULL OR home_q2_goals   >= 0)
    AND (home_q2_behinds IS NULL OR home_q2_behinds >= 0)
    AND (home_q2_points  IS NULL OR home_q2_points  >= 0)
    AND (home_q3_goals   IS NULL OR home_q3_goals   >= 0)
    AND (home_q3_behinds IS NULL OR home_q3_behinds >= 0)
    AND (home_q3_points  IS NULL OR home_q3_points  >= 0)
    AND (home_q4_goals   IS NULL OR home_q4_goals   >= 0)
    AND (home_q4_behinds IS NULL OR home_q4_behinds >= 0)
    AND (home_q4_points  IS NULL OR home_q4_points  >= 0)
    AND (away_q1_goals   IS NULL OR away_q1_goals   >= 0)
    AND (away_q1_behinds IS NULL OR away_q1_behinds >= 0)
    AND (away_q1_points  IS NULL OR away_q1_points  >= 0)
    AND (away_q2_goals   IS NULL OR away_q2_goals   >= 0)
    AND (away_q2_behinds IS NULL OR away_q2_behinds >= 0)
    AND (away_q2_points  IS NULL OR away_q2_points  >= 0)
    AND (away_q3_goals   IS NULL OR away_q3_goals   >= 0)
    AND (away_q3_behinds IS NULL OR away_q3_behinds >= 0)
    AND (away_q3_points  IS NULL OR away_q3_points  >= 0)
    AND (away_q4_goals   IS NULL OR away_q4_goals   >= 0)
    AND (away_q4_behinds IS NULL OR away_q4_behinds >= 0)
    AND (away_q4_points  IS NULL OR away_q4_points  >= 0)
  ),
  -- Migration 020's rules, held at this store so the proposal cannot be
  -- one a canonical write would have to reject: a figure and its status
  -- agree in both directions, and a zero crowd must cite a source.
  CONSTRAINT afltables_match_attendance_status_ck CHECK (
    (attendance_status = 'complete' AND attendance IS NOT NULL)
    OR (attendance_status <> 'complete' AND attendance IS NULL)
  ),
  CONSTRAINT afltables_match_zero_attendance_ck CHECK (
    attendance IS NULL OR attendance > 0 OR attendance_source_id IS NOT NULL
  )
);

COMMENT ON TABLE staging.afltables_match IS
  'One AFL Tables match observation projected to fully resolved identity: what this source PROPOSES for matches and match_period_scores. Not a canonical fact store, and never read as a fact — a reviewer reads it, and acceptance re-checks it against the source version it names.';
COMMENT ON COLUMN staging.afltables_match.version_seq IS
  'The exact source observation version this projection was derived from, so evidence can never be conflated and acceptance can detect that the source has moved on.';
COMMENT ON COLUMN staging.afltables_match.venue_id IS
  'NULL means the source venue string maps to no known venue. venue_raw always carries the real string; no venues or venue_aliases row is ever created by this pass.';
COMMENT ON COLUMN staging.afltables_match.attendance IS
  'NULL means not recorded, NEVER zero. A recorded 0 is a real crowd and must cite attendance_source_id, exactly as migration 020 requires of the canonical column.';

-- The composite FK to the version grain. The primary key covers the first
-- three columns but not the fourth, so the referential probe needs this.
CREATE INDEX ix_afltables_match_version
  ON staging.afltables_match (source_id, family, external_record_id, version_seq);
-- FK-covering, and the review queue reads by season and by club.
CREATE INDEX ix_afltables_match_season     ON staging.afltables_match (season);
CREATE INDEX ix_afltables_match_home_club  ON staging.afltables_match (home_club_id);
CREATE INDEX ix_afltables_match_away_club  ON staging.afltables_match (away_club_id);
CREATE INDEX ix_afltables_match_venue      ON staging.afltables_match (venue_id)
  WHERE venue_id IS NOT NULL;

-- winner_club_id -> clubs, attendance_source_id -> sources and
-- projected_by_batch_id -> import_batches are deliberately unindexed, on
-- exactly the grounds tests/integration/fk-indexes.test.ts already accepts
-- for these parents: sources and import_batches are append-only and
-- nothing deletes a row from either, and a club identity is never deleted
-- row-by-row (a rename becomes a second identity, a merger a link). An
-- index maintained for a delete that never happens costs writes and buys
-- nothing. winner_club_id is additionally covered in practice by the two
-- club indexes above, since it always equals one of them.

-- =====================================================================
-- 2 — staging.afltables_player_match
-- =====================================================================
-- One row per `afltables.player_match_stats` observation whose identity is
-- FULLY resolved. A profile url unknown to AFLDB is `unresolved_identity`:
-- no row here, no player created, an import_rejections row and a refusal
-- candidate for a human. A player is always a human decision.
--
-- There is deliberately NO match_id column. On a canonically rebuilt
-- database the 2026 season has zero matches, so requiring a resolved
-- canonical match would make every in-season player projection
-- unwritable. match_key carries the link at the natural-key level, which
-- is the same key matches.match_key uses.
--
-- NULL SEMANTICS: every statistic is nullable and NULL means NOT RECORDED,
-- never 0. brownlow_votes NULL is NA, never 0. afltables_id is nullable
-- because probe P5 measured 82 in-season rows carrying no fitzRoy ID at
-- all; identity is the profile url, which is inside external_record_id.
CREATE TABLE staging.afltables_player_match (
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  season               smallint    NOT NULL REFERENCES seasons(year),
  match_key            text        NOT NULL,
  round_code           text        NOT NULL,
  is_final             boolean     NOT NULL,

  player_id            integer     NOT NULL REFERENCES players(id),
  club_id              integer     NOT NULL REFERENCES clubs(id),
  -- Enrichment only (P5). Never required, never an identity key.
  afltables_id         text,

  career_game_no       smallint,
  jumper_number        text,

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
  brownlow_votes  smallint,

  -- The brownlow_round_votes proposal, carried rather than re-derived.
  -- NULL means NO round-vote row is proposed for this observation — an NA
  -- vote, a final, or a season the coverage authority does not gate for
  -- round votes. Non-NULL is the round number the vote would be filed
  -- under. Carrying it keeps the season-gating decision in the one place
  -- that owns the source semantics instead of duplicating it downstream.
  brownlow_round_number smallint,

  projected_by_batch_id bigint     NOT NULL REFERENCES import_batches(id),
  projected_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (source_id, family, external_record_id),
  FOREIGN KEY (source_id, family, external_record_id, version_seq)
    REFERENCES staging.source_record_versions
      (source_id, family, external_record_id, version_seq),

  -- One player appears once in one match, at this source's grain.
  CONSTRAINT afltables_player_match_grain_uq UNIQUE (source_id, player_id, match_key),

  CONSTRAINT afltables_player_match_brownlow_range_ck CHECK (
    brownlow_votes IS NULL OR brownlow_votes BETWEEN 0 AND 3
  ),
  -- NA is never a row, and finals are never polled. Both are made
  -- unrepresentable rather than merely documented.
  CONSTRAINT afltables_player_match_brownlow_row_ck CHECK (
    brownlow_round_number IS NULL
    OR (brownlow_votes IS NOT NULL AND is_final = false AND brownlow_round_number >= 1)
  ),
  -- Every statistic is a count. NULL is not recorded; a negative is a bug.
  CONSTRAINT afltables_player_match_nonnegative_ck CHECK (
    (career_game_no  IS NULL OR career_game_no  >= 0)
    AND (kicks           IS NULL OR kicks           >= 0)
    AND (marks           IS NULL OR marks           >= 0)
    AND (handballs       IS NULL OR handballs       >= 0)
    AND (disposals       IS NULL OR disposals       >= 0)
    AND (goals           IS NULL OR goals           >= 0)
    AND (behinds         IS NULL OR behinds         >= 0)
    AND (hitouts         IS NULL OR hitouts         >= 0)
    AND (tackles         IS NULL OR tackles         >= 0)
    AND (rebounds        IS NULL OR rebounds        >= 0)
    AND (inside_50s      IS NULL OR inside_50s      >= 0)
    AND (clearances      IS NULL OR clearances      >= 0)
    AND (clangers        IS NULL OR clangers        >= 0)
    AND (frees_for       IS NULL OR frees_for       >= 0)
    AND (frees_against   IS NULL OR frees_against   >= 0)
    AND (contested       IS NULL OR contested       >= 0)
    AND (uncontested     IS NULL OR uncontested     >= 0)
    AND (contested_marks IS NULL OR contested_marks >= 0)
    AND (marks_inside_50 IS NULL OR marks_inside_50 >= 0)
    AND (one_percenters  IS NULL OR one_percenters  >= 0)
    AND (bounces         IS NULL OR bounces         >= 0)
    AND (goal_assists    IS NULL OR goal_assists    >= 0)
  )
);

COMMENT ON TABLE staging.afltables_player_match IS
  'One AFL Tables player-match observation projected to fully resolved identity: what this source PROPOSES for player_match_stats and, where a vote was actually published, brownlow_round_votes. Not a canonical fact store.';
COMMENT ON COLUMN staging.afltables_player_match.afltables_id IS
  'The fitzRoy numeric ID, enrichment only. 82 in-season rows carry none (probe P5), so it is never required and never an identity key. Identity is the profile url inside external_record_id.';
COMMENT ON COLUMN staging.afltables_player_match.brownlow_votes IS
  'NULL is NA, NEVER zero. A published 0 is a real vote. No round-vote row is ever manufactured from an absent value.';
COMMENT ON COLUMN staging.afltables_player_match.brownlow_round_number IS
  'The round a brownlow_round_votes row would be filed under, or NULL when no row is proposed at all (NA vote, a final, or an ungated season).';

CREATE INDEX ix_afltables_player_match_version
  ON staging.afltables_player_match
     (source_id, family, external_record_id, version_seq);
CREATE INDEX ix_afltables_player_match_player ON staging.afltables_player_match (player_id);
CREATE INDEX ix_afltables_player_match_club   ON staging.afltables_player_match (club_id);
CREATE INDEX ix_afltables_player_match_season ON staging.afltables_player_match (season);
-- The match-grain join to staging.afltables_match, and the report's
-- per-match grouping. Not a foreign key: the canonical match may not
-- exist yet, and the projection must not depend on it.
CREATE INDEX ix_afltables_player_match_key    ON staging.afltables_player_match (match_key);

-- =====================================================================
-- 3 — grants
-- =====================================================================
-- The minimum the v1 persistence path needs: it upserts projections and
-- reads them back inside one transaction. It never truncates, so no
-- TRUNCATE is granted here. afldb_app gets SELECT for the pre-reconcile
-- catch-up, exactly as migration 074 did for the three spine tables.
--
-- NOT registered in tools/maintenance/privileges.sql, and deliberately:
-- that file already grants afldb_import SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE and afldb_app SELECT on ALL TABLES IN SCHEMA staging, so a
-- reconcile keeps these two without naming them. Adding them would be a
-- redundant second declaration of the same grant. Nothing here widens
-- afldb_import, and migration 074's append-only promotion_decisions
-- boundary is untouched.
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afltables_match        TO afldb_import;
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afltables_player_match TO afldb_import;
GRANT SELECT ON staging.afltables_match        TO afldb_app;
GRANT SELECT ON staging.afltables_player_match TO afldb_app;

-- =====================================================================
-- 4 — data_issues deduplication support
-- =====================================================================
-- AFLDB-ISSUE-096 Decision C names data_issues for exactly one case,
-- `source_disagreement`, and AFLDB-ISSUE-099 implements exactly that.
--
-- The problem this solves is the ISSUE-090 failure mode in its other
-- form. Migration 072 gave the DOB passes a partial unique index over
-- (entity_type, entity_id, issue_type), which works because a DOB finding
-- always has a player. A settle disagreement often has NO canonical row
-- yet — on a canonically rebuilt database the 2026 season has zero
-- matches — so entity_id is NULL, and NULL never conflicts in a unique
-- index. Without a stable natural key, every nightly rerun would stack
-- another open row for the same logical disagreement.
--
-- issue_key is that natural key. A repeated detection UPDATEs the one open
-- row (its detected_at stays at first detection); a disagreement that
-- stops reproducing is RESOLVED, never deleted; and only rows the pass can
-- prove it owns — details->>'owner' — may be auto-resolved.
--
-- Chosen over a jsonb expression index on (details->>'issue_key') plus a
-- shape CHECK: a plain nullable column is self-documenting, indexes
-- better, and needs no CHECK touching every existing data_issues writer.
-- A nullable added column rewrites no rows and changes no grant.
ALTER TABLE data_issues ADD COLUMN issue_key text;

COMMENT ON COLUMN data_issues.issue_key IS
  'Deterministic natural identity of a recurring issue, so a repeated detection refreshes one open row instead of stacking duplicates. NULL for writers that do not use it. Resolved history is unconstrained.';

-- Migration 072's convention: a partial unique index over unresolved rows
-- only, on plain columns. issue_type is a key column so two different
-- issue types never collide on one key, and the predicate is generic so a
-- future writer can opt in without ISSUE-099 owning a per-type list.
-- Rows with a NULL issue_key are excluded entirely, so every existing
-- writer is unaffected.
CREATE UNIQUE INDEX uq_data_issues_open_by_key
  ON data_issues (issue_type, issue_key)
  WHERE issue_key IS NOT NULL AND resolved_at IS NULL;

COMMENT ON INDEX uq_data_issues_open_by_key IS
  'One unresolved data_issues row per (issue_type, issue_key). Makes a duplicate open finding unrepresentable rather than merely discouraged; resolved history is unconstrained (AFLDB-ISSUE-099).';
