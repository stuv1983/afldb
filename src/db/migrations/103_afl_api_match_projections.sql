-- ---------------------------------------------------------------------
-- 103 — AFLDB-ISSUE-228 S4: typed AFL API match-family projections, and
--       the afl_api source description update
-- ---------------------------------------------------------------------
-- ISSUE-228 generalises the existing current-season pipeline (source
-- observation spine (074) -> typed projection -> reconcile() -> promotion
-- candidates -> applyCanonicalUnit()) over a second source, afl_api,
-- already registered by migration 077. This migration adds the three
-- typed projections its promotable families need and nothing else, per
-- the same Decision B (AFLDB-ISSUE-096) migrations 076 and 077 already
-- apply: "the jsonb spine never feeds a promotion; a family with no typed
-- projection cannot be promoted at all."
--
-- SCOPE, STATED PLAINLY. Three tables:
--   1. staging.afl_api_match         (family: match)
--   2. staging.afl_api_player_match  (family: player_match_stats)
--   3. staging.afl_api_brownlow_vote (family: brownlow_match_votes)
-- `afl_api.brownlow_leaderboard` gets NO typed projection: its
-- promotion_policy is 'never' (S3 registry), so Decision B requires
-- nothing here — it is an artefact-builder input only (ISSUE-228 S7).
-- `afl_api.lineup` / `afl_api.roster` already have their own projection
-- (077) or none (roster, staging-only, not promotable); neither is
-- touched here.
--
-- ADDITIVE ONLY, NO CANONICAL COLUMN CHANGES. This migration modifies
-- exactly one existing row (the `sources` prose description for
-- 'afl_api') and creates three new `staging` tables. Explicitly NOT
-- touched, because ISSUE-228 S4 needs none of it: `matches`,
-- `player_match_stats`, `match_period_scores`, `brownlow_round_votes`,
-- the `canonical_applications_target_table_ck` (the four existing
-- targets already admit everything this source proposes),
-- `data_overrides`, `external_identities` (rows are data, `match_method`
-- is free text — the S5 bridge writes rows, not schema). The fixture
-- successor's `canonical_applications` CHECK widening (§13.2) is a later
-- issue's migration, not this one.
--
-- WHY staging.afl_api_match CARRIES BOTH `match`-FAMILY AND
-- `match_roster`-FAMILY FACTS (KNOWN LIMITATION, read before touching
-- S6). Per the runbook (§11.1, §11.2, §12.1), one afl_api_match row is
-- the combined matches + match_period_scores proposal for one real-world
-- match, exactly mirroring migration 076's staging.afltables_match
-- shape column-for-column. For AFL Tables both aspects come from one
-- page scrape (one family). For afl_api they come from TWO separate
-- registry families fetched separately (`match` = the season matches
-- feed; `match_roster` = `matchRoster/full/<CD_M>`, which alone carries
-- `periodScore[]` and the local match date/time `venueLocalStartTime`
-- the roster emitter reads — see `emitAflApiMatchRoster` /
-- `afl-api-bundle.ts`). This table's identity and its ONE `version_seq`
-- FK track only the `match` family's own spine observation (`family =
-- 'match'`, enforced below); the period-score and match-time columns are
-- populated by joining in the companion `match_roster` observation for
-- the same `providerMatchId`, which is a Stage S6 settle-writer concern,
-- not a schema concern this table's FK can express (`match_roster` is
-- registered as its own scope_key `season=<year>;match=<CD_M>`, not
-- swept or versioned together with `match`). S6 must keep this row
-- current with respect to BOTH families' latest versions; this migration
-- does not and cannot enforce that at the schema level, and the gap is
-- recorded here deliberately rather than silently.
--
-- NULL SEMANTICS, throughout, exactly as 076 states them: NULL is "not
-- recorded", never 0. The one addition afl_api makes to that rule:
-- `attendance` is NEVER recorded by this source at all (§4.3, §7.5) — not
-- "sometimes missing" but structurally absent from every feed this
-- family reads — so its CHECK below pins a single fixed state rather
-- than 076's "complete xor non-complete" range. AFL Tables' or Super
-- Admin's later field-scoped enrichment (§7.5) writes the CANONICAL
-- `matches` row directly; it never touches this staging proposal.
--
-- Migrations 073-102 are applied and checksum-frozen. Nothing here edits
-- them; 076 and 077 are the shape and grant precedents this migration
-- follows.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 1 — staging.afl_api_match
-- =====================================================================
-- One row per `afl_api.match` observation (one real-world match), fully
-- resolved: an unresolved club, season or venue-required-strictly case
-- gets no row here (team resolution is a closed, complete 18-entry map —
-- §6.2 — so home/away club identity is always resolvable or the emitter
-- already refused the record; venue is the one deliberate exception,
-- exactly as 076 documents for AFL Tables).
CREATE TABLE staging.afl_api_match (
  -- The observation this projection was derived from. Tracks ONLY the
  -- `match` family's spine version — see the header's KNOWN LIMITATION.
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  -- Provider identity, carried alongside the resolved facts below exactly
  -- as afltables_id is enrichment evidence in 076 and provider_* is
  -- identity in 077. provider_match_id duplicates external_record_id by
  -- construction (the match family's external_key is providerId alone,
  -- not a composite) — the CHECK below pins that equality as a structural
  -- invariant rather than an assumption.
  provider_match_id       text     NOT NULL,
  provider_season_id      text     NOT NULL,
  -- The AFL fixture status as observed (CONCLUDED, POSTGAME, ...). Free
  -- text, deliberately no CHECK IN (...): §6.4/§15 Q4 record that the
  -- pre-match vocabulary is unmeasured, and 077's own precedent ("declares
  -- no closed enum for any measured vocabulary") applies here too. The
  -- POSTGAME/CONCLUDED deferral DECISION belongs to the S6 settle
  -- (bundle contract v2 `deferral`, §7.3); this column only ever RECORDS
  -- what was observed.
  provider_status          text     NOT NULL,
  provider_home_team_id    text     NOT NULL,
  provider_away_team_id    text     NOT NULL,
  provider_venue_id        text     NOT NULL,

  season               smallint    NOT NULL REFERENCES seasons(year),
  round_code           text        NOT NULL,
  round_number         smallint,
  round_type           round_type  NOT NULL,
  is_final             boolean     NOT NULL,
  -- Sourced from the companion match_roster observation's
  -- venueLocalStartTime (§11.1) — see the header's KNOWN LIMITATION.
  match_date           date        NOT NULL,
  match_time           text,

  venue_id             integer     REFERENCES venues(id),
  venue_raw            text        NOT NULL,

  home_club_id         integer     NOT NULL REFERENCES clubs(id),
  away_club_id         integer     NOT NULL REFERENCES clubs(id),

  -- Unlike 076: the AFL API always publishes goals AND behinds alongside
  -- the total for every sampled match (§2.1, §4.4; emitAflApiMatch reads
  -- them with num(), which refuses a missing/non-numeric value), so these
  -- are NOT NULL here rather than 076's nullable breakdown.
  home_goals           smallint    NOT NULL,
  home_behinds         smallint    NOT NULL,
  home_score           smallint    NOT NULL,
  away_goals           smallint    NOT NULL,
  away_behinds         smallint    NOT NULL,
  away_score           smallint    NOT NULL,

  result               match_result NOT NULL,
  winner_club_id       integer     REFERENCES clubs(id),   -- NULL on a draw
  margin                smallint    NOT NULL,

  -- Never sourced by afl_api (§4.3, §7.5) — see the header. Pinned to a
  -- single fixed state, not merely a non-complete range, per the runbook's
  -- explicit instruction to "decide at S4 and pin it in the projection
  -- CHECK" (§7.5 consequences). DECISION: 'not_collected', not 'pending',
  -- because this source structurally never collects attendance on any
  -- path — it is not "expected soon" from afl_api's own perspective. This
  -- is an S4 implementation decision, flagged for operator review before
  -- S6 depends on it.
  attendance            integer,
  attendance_status     coverage_status NOT NULL,
  attendance_source_id  smallint    REFERENCES sources(id),

  -- The match_period_scores proposal, cumulative-to-date, sourced from
  -- match_roster's periodScore[] after cumulative conversion (§7.2,
  -- §11.2). Mirrors 076 column-for-column, including its NULL semantics:
  -- a side/period whose goals, behinds AND points are all NULL is absent,
  -- not 0-0-0 (e.g. `roster.periodScores === null`, §9 assertion 4).
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

  CONSTRAINT afl_api_match_family_ck CHECK (family = 'match'),

  CONSTRAINT afl_api_match_provider_ids_ck CHECK (
    btrim(provider_match_id)      <> '' AND provider_match_id      NOT LIKE '%|%'
    AND btrim(provider_season_id)     <> '' AND provider_season_id     NOT LIKE '%|%'
    AND btrim(provider_status)        <> ''
    AND btrim(provider_home_team_id)  <> '' AND provider_home_team_id  NOT LIKE '%|%'
    AND btrim(provider_away_team_id)  <> '' AND provider_away_team_id  NOT LIKE '%|%'
    AND btrim(provider_venue_id)      <> '' AND provider_venue_id      NOT LIKE '%|%'
  ),
  -- The match family's external_key is providerId alone (§5.2), so the
  -- staging identity and the provider identity are the same value.
  CONSTRAINT afl_api_match_external_record_id_ck CHECK (
    external_record_id = provider_match_id
  ),

  CONSTRAINT afl_api_match_clubs_differ_ck CHECK (home_club_id <> away_club_id),
  CONSTRAINT afl_api_match_margin_ck       CHECK (margin = abs(home_score - away_score)),
  CONSTRAINT afl_api_match_result_ck CHECK (
    (result = 'home_win' AND home_score > away_score) OR
    (result = 'away_win' AND away_score > home_score) OR
    (result = 'draw'     AND home_score = away_score)
  ),
  CONSTRAINT afl_api_match_winner_ck CHECK (
    (result = 'draw' AND winner_club_id IS NULL)
    OR (result = 'home_win' AND winner_club_id = home_club_id)
    OR (result = 'away_win' AND winner_club_id = away_club_id)
  ),
  CONSTRAINT afl_api_match_final_ck CHECK (is_final = (round_type <> 'home_and_away')),
  CONSTRAINT afl_api_match_nonnegative_ck CHECK (
    home_score >= 0 AND away_score >= 0
    AND home_goals >= 0 AND home_behinds >= 0
    AND away_goals >= 0 AND away_behinds >= 0
  ),
  -- Always required here (unlike 076's OR-NULL form), because the AFL API
  -- always publishes both components (§4.4).
  CONSTRAINT afl_api_match_components_ck CHECK (
    home_score = 6 * home_goals + home_behinds
    AND away_score = 6 * away_goals + away_behinds
  ),
  CONSTRAINT afl_api_match_period_components_ck CHECK (
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
  CONSTRAINT afl_api_match_period_nonnegative_ck CHECK (
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
  -- §4.3, §7.5: afl_api never sources attendance. Pinned to a single fixed
  -- state (see the column comment above), stronger than 076's "complete
  -- xor non-complete" range because this source has no complete branch at
  -- all.
  CONSTRAINT afl_api_match_attendance_ck CHECK (
    attendance IS NULL
    AND attendance_source_id IS NULL
    AND attendance_status = 'not_collected'
  )
);

COMMENT ON TABLE staging.afl_api_match IS
  'One afl_api match observation projected to fully resolved identity: what this source PROPOSES for matches and match_period_scores. Not a canonical fact store. version_seq tracks only the match family''s own spine observation; period-score and match-time columns are joined in from the companion match_roster observation by the S6 writer (AFLDB-ISSUE-228) — see the migration header KNOWN LIMITATION.';
COMMENT ON COLUMN staging.afl_api_match.venue_id IS
  'NULL means the source venue string maps to no known venue (afl-api-identities.json). venue_raw always carries the real string; no venues or venue_aliases row is ever created by this pass.';
COMMENT ON COLUMN staging.afl_api_match.attendance_status IS
  'Pinned to not_collected: afl_api never sources attendance on any path (AFLDB-ISSUE-228 §4.3/§7.5). AFL Tables or Super Admin field-scoped enrichment writes the canonical matches row directly and never touches this staging proposal.';
COMMENT ON COLUMN staging.afl_api_match.provider_status IS
  'The AFL fixture status as observed (e.g. CONCLUDED, POSTGAME). No closed vocabulary is declared (AFLDB-ISSUE-228 §6.4/§15 Q4: the pre-match vocabulary is unmeasured); the POSTGAME/CONCLUDED promotion-deferral decision is a Stage S6 settle concern, not a constraint on this column.';

CREATE INDEX ix_afl_api_match_version
  ON staging.afl_api_match (source_id, family, external_record_id, version_seq);
CREATE INDEX ix_afl_api_match_season     ON staging.afl_api_match (season);
CREATE INDEX ix_afl_api_match_home_club  ON staging.afl_api_match (home_club_id);
CREATE INDEX ix_afl_api_match_away_club  ON staging.afl_api_match (away_club_id);
CREATE INDEX ix_afl_api_match_venue      ON staging.afl_api_match (venue_id)
  WHERE venue_id IS NOT NULL;

-- winner_club_id, attendance_source_id and projected_by_batch_id are
-- deliberately unindexed, on exactly the grounds 076 already documents:
-- sources and import_batches are append-only, clubs are never deleted
-- row-by-row, and winner_club_id is covered in practice by the two club
-- indexes above.

-- =====================================================================
-- 2 — staging.afl_api_player_match
-- =====================================================================
-- One row per `afl_api.player_match_stats` observation whose player
-- identity is fully resolved via the T1 bridge (§6.3). Mirrors
-- staging.afltables_player_match (076) column-for-column, minus
-- afltables_id (no fitzRoy enrichment ID exists for this source) and
-- minus brownlow_votes / brownlow_round_number (Brownlow is a fully
-- separate family and table here — staging.afl_api_brownlow_vote below —
-- never carried on the stat row, matching §10's "the match path never
-- writes votes").
--
-- Unlike 076, there is no match_key-without-match_id ambiguity to
-- restate: the same reasoning applies identically (a canonical match may
-- not exist yet on a canonically rebuilt database), so match_key again
-- carries the link at the natural-key level and there is deliberately no
-- match_id column here either.
CREATE TABLE staging.afl_api_player_match (
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  -- The 077 lineup encoding (§5.2): matchId|teamId|player.playerId.
  provider_match_id    text        NOT NULL,
  provider_team_id     text        NOT NULL,
  provider_player_id   text        NOT NULL,

  season               smallint    NOT NULL REFERENCES seasons(year),
  match_key            text        NOT NULL,

  player_id            integer     NOT NULL REFERENCES players(id),
  club_id              integer     NOT NULL REFERENCES clubs(id),

  -- Always NULL: playerStats.gamesPlayed is measured null on every row of
  -- every corpus sample, 2022-2026 (§4.3, S3 registry evidence). Kept as a
  -- column for the same recompute-owned-candidate reason 076 keeps it.
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

  projected_by_batch_id bigint     NOT NULL REFERENCES import_batches(id),
  projected_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (source_id, family, external_record_id),
  FOREIGN KEY (source_id, family, external_record_id, version_seq)
    REFERENCES staging.source_record_versions
      (source_id, family, external_record_id, version_seq),

  -- One provider player-row appears once in one match, at this source's
  -- grain — keyed on the PROVIDER identity rather than the resolved
  -- player_id (AFLDB-ISSUE-228 §12.2), consistent with §6.1's "provider id
  -- first" discipline: identity is the source observation.
  CONSTRAINT afl_api_player_match_grain_uq UNIQUE (source_id, provider_player_id, match_key),

  CONSTRAINT afl_api_player_match_family_ck CHECK (family = 'player_match_stats'),

  CONSTRAINT afl_api_player_match_provider_ids_ck CHECK (
    btrim(provider_match_id)  <> '' AND provider_match_id  NOT LIKE '%|%'
    AND btrim(provider_team_id)   <> '' AND provider_team_id   NOT LIKE '%|%'
    AND btrim(provider_player_id) <> '' AND provider_player_id NOT LIKE '%|%'
  ),
  CONSTRAINT afl_api_player_match_external_record_id_ck CHECK (
    external_record_id =
        provider_match_id || '|' || provider_team_id || '|' || provider_player_id
  ),

  CONSTRAINT afl_api_player_match_jumper_ck CHECK (
    jumper_number IS NULL OR jumper_number ~ '^[1-9][0-9]*$'
  ),

  CONSTRAINT afl_api_player_match_nonnegative_ck CHECK (
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

COMMENT ON TABLE staging.afl_api_player_match IS
  'One afl_api player-match observation projected to fully resolved identity (T1 bridge, AFLDB-ISSUE-228 S5): what this source PROPOSES for player_match_stats. Not a canonical fact store. brownlow_votes is never carried here — Brownlow is a fully separate family and table (staging.afl_api_brownlow_vote).';
COMMENT ON COLUMN staging.afl_api_player_match.career_game_no IS
  'Measured NULL on every sampled row, 2022-2026 (playerStats.gamesPlayed). Never sourced; a recompute-owned candidate, exactly as the equivalent afltables column documents.';
COMMENT ON COLUMN staging.afl_api_player_match.match_key IS
  'The natural-key level link matches.match_key uses. Deliberately no match_id column: a canonically rebuilt database has zero 2026 matches, so requiring a resolved canonical match would make every in-season player projection unwritable (mirrors staging.afltables_player_match, migration 076).';

CREATE INDEX ix_afl_api_player_match_version
  ON staging.afl_api_player_match
     (source_id, family, external_record_id, version_seq);
CREATE INDEX ix_afl_api_player_match_player ON staging.afl_api_player_match (player_id);
CREATE INDEX ix_afl_api_player_match_club   ON staging.afl_api_player_match (club_id);
CREATE INDEX ix_afl_api_player_match_season ON staging.afl_api_player_match (season);
CREATE INDEX ix_afl_api_player_match_key    ON staging.afl_api_player_match (match_key);
-- The provider-grain read (mirrors 077's ix_afl_api_lineup_provider_match):
-- every stat row for one match, and for one team within it. Needed because
-- external_record_id here is a composite; provider_match_id alone is not
-- the leading component of any other index.
CREATE INDEX ix_afl_api_player_match_provider_match
  ON staging.afl_api_player_match (provider_match_id, provider_team_id);

-- =====================================================================
-- 3 — staging.afl_api_brownlow_vote
-- =====================================================================
-- §10. The declared spine grain for `afl_api.brownlow_match_votes` is ONE
-- record per MATCH (external_key `matchVotes.matchId`, one payload
-- carrying all three vote-getters' votes[] array — see
-- emitAflApiBrownlowMatchVotes / AflApiBrownlowMatchVoteRecord). The
-- typed projection below EXPLODES that one spine record into one row PER
-- VOTE (per §10's explicit column list), so — unlike every other
-- projection table in this migration and in 076/077 — its PRIMARY KEY
-- must add provider_player_id beyond the (source_id, family,
-- external_record_id) triple that alone identifies the spine record.
-- version_seq still names the exact spine version every row of one
-- match's vote set was derived from; all three of a match's rows always
-- share one version_seq (§10: "a match's vote set is one unit,
-- all-or-none").
--
-- Canonical identity here is OPTION-B nullable, exactly as afl_api_lineup
-- (077) establishes: a vote is observed because the provider published it;
-- whether AFLDB can resolve it to a canonical match/player/club is
-- separate enrichment and its absence is an expected staging state, never
-- a reason to withhold the row (§10 explicit column list: "match_id NULL,
-- player_id NULL, club_id NULL").
CREATE TABLE staging.afl_api_brownlow_vote (
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  version_seq          integer     NOT NULL,

  provider_match_id    text        NOT NULL,
  provider_player_id   text        NOT NULL,
  provider_team_id     text        NOT NULL,

  season                 smallint  NOT NULL REFERENCES seasons(year),
  -- AFL API numbering, as observed (§10: 2025 shows 0 for Opening Round).
  api_round_number       smallint  NOT NULL,
  -- AFLDB/AFL Tables numbering, via the season's declared round
  -- vocabulary (§6.4) — the value brownlow_round_votes.round_number would
  -- take.
  canonical_round_number smallint  NOT NULL,

  votes                smallint    NOT NULL,
  eligible              boolean     NOT NULL,

  -- Nullable by design (Option B, see header): identity is the provider
  -- observation, never the canonical resolution.
  match_id              integer    REFERENCES matches(id),
  player_id             integer    REFERENCES players(id),
  club_id                integer    REFERENCES clubs(id),

  projected_by_batch_id bigint     NOT NULL REFERENCES import_batches(id),
  projected_at          timestamptz NOT NULL DEFAULT now(),

  -- One vote row per player per match's vote set.
  PRIMARY KEY (source_id, family, external_record_id, provider_player_id),
  FOREIGN KEY (source_id, family, external_record_id, version_seq)
    REFERENCES staging.source_record_versions
      (source_id, family, external_record_id, version_seq),

  CONSTRAINT afl_api_brownlow_vote_family_ck CHECK (family = 'brownlow_match_votes'),

  CONSTRAINT afl_api_brownlow_vote_provider_ids_ck CHECK (
    btrim(provider_match_id)  <> '' AND provider_match_id  NOT LIKE '%|%'
    AND btrim(provider_player_id) <> '' AND provider_player_id NOT LIKE '%|%'
    AND btrim(provider_team_id)   <> '' AND provider_team_id   NOT LIKE '%|%'
  ),
  -- The brownlow_match_votes family's external_key is matchVotes.matchId
  -- alone (§5.2, S1 registry) — the spine record is per-match, not per-vote.
  CONSTRAINT afl_api_brownlow_vote_external_record_id_ck CHECK (
    external_record_id = provider_match_id
  ),

  -- §10: votes are exactly {3,2,1} per match; the emitter's
  -- BrownlowVoteSetError already refuses a violating match record before
  -- persistence, so this CHECK is a structural backstop, not the primary
  -- enforcement.
  CONSTRAINT afl_api_brownlow_vote_votes_ck CHECK (votes IN (1, 2, 3)),
  CONSTRAINT afl_api_brownlow_vote_round_ck CHECK (
    api_round_number >= 0 AND canonical_round_number >= 1
  )
);

COMMENT ON TABLE staging.afl_api_brownlow_vote IS
  'One vote (one player, one match) from an afl_api brownlow_match_votes observation: what this source PROPOSES for brownlow_round_votes. Not a canonical fact store. Three rows share one spine record (external_record_id = provider_match_id, the match-grain observation) and its version_seq — AFLDB-ISSUE-228 §10.';
COMMENT ON COLUMN staging.afl_api_brownlow_vote.match_id IS
  'Nullable by design (Option B, matching afl_api_lineup / migration 077): a vote is observed because the provider published it; canonical resolution is separate enrichment and its absence is expected, never a reason to withhold the row.';
COMMENT ON COLUMN staging.afl_api_brownlow_vote.canonical_round_number IS
  'AFL Tables/AFLDB round numbering via the season''s declared round vocabulary (AFLDB-ISSUE-228 §6.4), i.e. the value brownlow_round_votes.round_number would take. Never api_round_number + a bare offset — the vocabulary is the only translation path.';

CREATE INDEX ix_afl_api_brownlow_vote_version
  ON staging.afl_api_brownlow_vote
     (source_id, family, external_record_id, version_seq);
CREATE INDEX ix_afl_api_brownlow_vote_match  ON staging.afl_api_brownlow_vote (match_id);
CREATE INDEX ix_afl_api_brownlow_vote_player ON staging.afl_api_brownlow_vote (player_id);
CREATE INDEX ix_afl_api_brownlow_vote_club   ON staging.afl_api_brownlow_vote (club_id);
CREATE INDEX ix_afl_api_brownlow_vote_season ON staging.afl_api_brownlow_vote (season);

-- =====================================================================
-- 4 — afl_api source description (prose only)
-- =====================================================================
-- §5.1. 077 refuses only on kind/url (identity-bearing, unchanged here);
-- name and description are prose and 077 deliberately leaves them
-- writable by a later migration. This is the first such update, and it
-- amends the description to state the ISSUE-228 families' direct-HTTP
-- access alongside the existing fitzRoy-mediated ISSUE-100/118 families
-- — a DATA-only statement, no kind/url change, independence group
-- unchanged.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sources WHERE key = 'afl_api') THEN
    RAISE EXCEPTION
      'sources.key ''afl_api'' does not exist. Migration 077 must be applied before 103.';
  END IF;

  UPDATE sources
  SET description =
    'Official AFL.com.au JSON APIs (aflapi.afl.com.au v2, api.afl.com.au CFS '
    || 'with a public WMCTok media token, sapi.afl.com.au). Reached directly '
    || 'for ISSUE-228 families and through fitzRoy for the ISSUE-100/118 '
    || 'families. No operator credential.'
  WHERE key = 'afl_api';
END $$;

-- =====================================================================
-- 5 — grants
-- =====================================================================
-- Mirrors migrations 076 and 077 exactly: the minimum a persistence path
-- needs to upsert projections and read them back inside one transaction.
-- No TRUNCATE granted here — privileges.sql already grants afldb_import
-- DELETE/TRUNCATE on ALL TABLES IN SCHEMA staging on a reconcile, exactly
-- as 076/077 document; this is not a stronger boundary than the
-- repository already has, and not registered in privileges.sql for the
-- same reason those two migrations are not.
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afl_api_match         TO afldb_import;
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afl_api_player_match  TO afldb_import;
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.afl_api_brownlow_vote TO afldb_import;
GRANT SELECT ON staging.afl_api_match         TO afldb_app;
GRANT SELECT ON staging.afl_api_player_match  TO afldb_app;
GRANT SELECT ON staging.afl_api_brownlow_vote TO afldb_app;
