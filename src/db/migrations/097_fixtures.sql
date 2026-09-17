-- =====================================================================
-- 097 - Fixture administration: the canonical scheduled-match registry
-- =====================================================================
-- AFLDB-ISSUE-162 (AFLDB-ISSUE-156 P3d) Stage 1. Forward-only. Additive.
--
-- AFLDB has never been able to represent an UNPLAYED match. matches
-- requires home_score, away_score, result and margin NOT NULL (003:43-52)
-- and reconciles them with five CHECKs (003:60-70, 022:25-55), so the only
-- "fixture" the database knows is a game that has already been scored. The
-- current-season acquisition records exactly this: "pre-match match
-- identity is structurally unavailable" (AFLDB-ISSUE-100 L3A). Every
-- consumer of matches -- club_seasons (rebuild_derived.py:340-356),
-- season metadata, round ladders (rounds.ts:44-105), venue records, the NL
-- team plans, the Grid Solver -- reads "row exists" as "match played". A
-- scheduled row placed in matches with placeholder scores would count as a
-- 0-0 draw; with NULL scores it could not be inserted at all.
--
-- This migration does exactly four things:
--
--   1. creates the canonical registry table fixtures, which holds
--      SCHEDULED-match facts and has NO score, result, margin, attendance
--      or statistic column at all -- so "0-0 means not played" is
--      UNREPRESENTABLE here rather than merely forbidden;
--   2. admits 'fixtures' as a data_overrides entity_type, so a fixture has
--      a durable record that destructive reloads and promotions replay;
--   3. admits 'fixtures' as a data_edits table_name, so a fixture mutation
--      is audited against the fixture itself;
--   4. registers the table in the fail-closed role registries.
--
-- It writes NO data. There is no backfill and there can never be one: no
-- source in the repository publishes AFLDB-normalised historical
-- schedules, and a played match is not a fixture record -- it is the
-- result, which matches already holds.
--
-- matches IS NOT TOUCHED. No column, constraint, index or consumer of it
-- changes. "Played" is a read-time DERIVED relation between the two tables
-- (AFLDB-ISSUE-162 §18), never a stored flag on either, and no writer in
-- this issue inserts, updates or deletes a matches row.
--
-- The repository's own precedent for the distinction is AFLW:
-- staging_aflw.fixtures (the published schedule, scores CHECK-forced NULL
-- unless played, 025:80-125) is a separate table from staging_aflw.matches
-- ("one row per played fixture", 025:127-131). That model is staging-only
-- and outside the normalised model, so it is a design precedent, not a
-- reusable table.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * no FK season -> seasons(year), for the same reason migration 096
--     gave (096:33-41). A 2027 fixture is administrative intent about a
--     season the reference register has not reached: seasons rows come
--     from data/reference/seasons.json through load_reference_data.py
--     (TRUNCATE ... CASCADE and copy) and the AFLDB-ISSUE-101 rollover
--     refuses to advance the register until the completed season's
--     acquisition is accepted. The FK would buy no promotion safety
--     (seasons.year is a permanent natural identity needing no lineage
--     remap) and would make the table unusable for its only purpose.
--     The administrable window -- max(seasons.year) <= S <= max + 1 (D-3)
--     -- is a SERVER rule in src/db/queries/admin-fixtures.ts, not a
--     CHECK, so a later decision about the window is a reviewed code
--     change rather than a migration that rewrites what is already stored;
--   * no match_id and no match_key column, and no FK to matches (D-6,
--     operator constraint 2026-09-11). fixture_key is the fixture's
--     identity BEFORE, DURING and AFTER settlement. A stored match_id
--     would be lineage-bound (matches.id is renumbered by a promotion) and
--     would need the AFLDB-ISSUE-155 staged-remap machinery for a link
--     that is fully derivable from season + round_code + the club ids;
--   * no score, goals, behinds, result, margin, winner, attendance,
--     period, lineup or statistic column. A fixture that could carry one
--     would eventually be read as a result;
--   * no DELETE path. status 'cancelled' (the real-world event did not
--     happen) and 'void' (the row should never have been entered) are
--     terminal states that KEEP the row, so every data_edits row pointing
--     at fixtures.id stays resolvable through the fixture_key lineage rule
--     at the next promotion remap (D-2, docs/production-promotion.md §7.4c);
--   * no seasons, clubs, club_seasons, venues or venue_aliases row is
--     created here or by any AFLDB-ISSUE-162 code path (D-3, §11). An
--     unmapped venue name lives in venue_raw with venue_id NULL, which is
--     the same shape matches uses for an unresolved source string
--     (003:74-75), and is handed off to a future venue-administration
--     surface;
--   * no privileges.sql edit (the two registries below drive it), no
--     trigger, and no change to afldb_season_list_clubs() or
--     afldb_identity_for_season().
--
-- OPERATIONAL NOTE (reference loader). fixtures references clubs, venues,
-- sources and import_batches, so it enters the TRUNCATE ... CASCADE closure
-- of load_reference_data.py exactly as season_list_members did. That guard is
-- FK-graph based rather than a hard-coded list, so it picks this table up with
-- no code change and REFUSES while it holds rows unless --allow-cascade is
-- given -- which is correct: the administered schedule is then re-created by
-- replay_admin_overrides('fixtures'), and the refusal is what makes an
-- operator decide that deliberately instead of discovering it afterwards.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The canonical table
-- ---------------------------------------------------------------------
CREATE TABLE fixtures (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- THE durable fixture identity. A randomUUID() minted once at creation
  -- by src/db/queries/admin-fixtures.ts and never edited: it survives a
  -- reschedule, a venue change, a round correction, a home/away swap, a
  -- club replacement, cancellation, voiding, a destructive rebuild and a
  -- DEV -> PROD promotion. Deliberately NOT derived from date, venue, club
  -- names or matches.match_key -- match_key is a CONTENT ADDRESS over
  -- season|round|date|home|away (003:20-23), i.e. over precisely the
  -- fields a fixture exists in order to change, which is why
  -- tools/migration/match-rekey.ts has to MOVE it when a result's details
  -- are corrected. Names never decide identity anywhere in AFLDB.
  fixture_key      text        NOT NULL UNIQUE,

  -- No FK; see the header. The CHECK is the same range seasons_year_ck and
  -- season_list_members use, so the three can never disagree about what a
  -- plausible season is.
  season           smallint    NOT NULL CHECK (season BETWEEN 1897 AND 2100),

  -- The matches round vocabulary EXACTLY (003:26-29), so the read-time
  -- played resolution (§18) compares like with like: home-and-away
  -- round_code is the decimal string of round_number, finals codes are the
  -- FINALS_CODES keys EF/QF/SF/PF/GF/WF (import_fitzroy_core.py:166-173).
  -- AFLDB numbers the Opening Round as round 1 from 2024, so there is no
  -- round 0 here either. A human never types a code: the writer renders it
  -- from round_type and, for home-and-away, round_number.
  round_code       text        NOT NULL,
  round_number     smallint,
  round_type       round_type  NOT NULL,
  is_final         boolean     GENERATED ALWAYS AS (round_type <> 'home_and_away') STORED,

  -- D-5. NULL means genuinely UNKNOWN / TBC. There is no sentinel date, no
  -- fake midnight and no synthetic "TBC" venue row anywhere in this table.
  -- match_time is local venue time as free text, the same vocabulary
  -- matches.match_time carries from AFL Tables' Local.start.time
  -- (import_fitzroy_core.py:1604); the writer constrains an administrator
  -- to HH:MM 24-hour, the column keeps the vocabulary. No timestamptz and
  -- no second time representation: matches.scheduled_at has had no reader
  -- and no writer anywhere in src/ or tools/ since migration 003, and
  -- inventing a convention nothing consumes is how that column got there.
  match_date       date,
  match_time       text,

  -- venue_id NULL + venue_raw NULL  = venue TBC
  -- venue_id NULL + venue_raw set   = a named venue not (yet) in venues
  -- venue_id set  + venue_raw set   = venues.canonical_name copied at write
  --                                   time, the createMatch() convention
  --                                   (match-admin.ts:212-218), so a fixture
  --                                   renders a venue string the way matches does
  venue_id         integer     REFERENCES venues(id),
  venue_raw        text,

  home_club_id     integer     NOT NULL REFERENCES clubs(id),
  away_club_id     integer     NOT NULL REFERENCES clubs(id),

  -- D-2. Three states, no DELETE, no tombstone:
  --   scheduled  this match is planned to occur
  --   cancelled  it was a real scheduled event and it did not happen
  --   void       it was entered incorrectly and was never a real event
  -- The two terminal states are NOT interchangeable: conflating a
  -- real-world cancellation with an operator's data-entry correction
  -- destroys the only record of which one happened.
  status           text        NOT NULL DEFAULT 'scheduled'
                               CHECK (status IN ('scheduled', 'cancelled', 'void')),
  status_reason    text,
  notes            text,

  -- manual_admin_edit (057:36-42) for every AFLDB-ISSUE-162 row.
  -- source_record_id = fixture_key for a manual row. A FUTURE fixture
  -- importer writes under its OWN source_id with the provider's id here,
  -- never over a manual row (§7 precedence).
  source_id        smallint    NOT NULL REFERENCES sources(id),
  source_record_id text        NOT NULL,
  import_batch_id  bigint      REFERENCES import_batches(id),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fixtures_clubs_differ_ck CHECK (home_club_id <> away_club_id),

  -- The matches_round_number_ck shape (003:66-68) plus the round_code
  -- rendering, so a home-and-away fixture can never disagree with itself
  -- about which round it is in -- which is what would make the played
  -- resolution miss.
  CONSTRAINT fixtures_round_number_ck CHECK (
    (round_type = 'home_and_away' AND round_number IS NOT NULL
       AND round_code = round_number::text)
    OR (round_type <> 'home_and_away' AND round_number IS NULL)),

  -- A time cannot be known when the date is not: "7:20pm on a day nobody
  -- has announced" is not a fact, it is two halves of one.
  CONSTRAINT fixtures_time_needs_date_ck CHECK (match_time IS NULL OR match_date IS NOT NULL),

  -- A mapped venue always renders a name, exactly as matches does
  -- (venue_raw NOT NULL there, 003:37).
  CONSTRAINT fixtures_venue_ck CHECK (venue_id IS NULL OR venue_raw IS NOT NULL),

  -- Leaving a terminal state unexplained loses the only thing that
  -- distinguishes a cancellation from a mistake a year later.
  CONSTRAINT fixtures_status_reason_ck CHECK (status = 'scheduled' OR status_reason IS NOT NULL),

  CONSTRAINT fixtures_source_record_uq UNIQUE (source_id, source_record_id)
);

-- Every FK column carries a leading-column index
-- (tests/integration/fk-indexes.test.ts), and each of these is also a real
-- access path: the season/round page, a club's fixture list either way
-- round, the venue hand-off, the per-source write scope and a future
-- importer's batch back-reference.
CREATE INDEX ix_fixtures_season_round ON fixtures (season, round_code);
CREATE INDEX ix_fixtures_home         ON fixtures (home_club_id, season);
CREATE INDEX ix_fixtures_away         ON fixtures (away_club_id, season);
CREATE INDEX ix_fixtures_venue        ON fixtures (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX ix_fixtures_source       ON fixtures (source_id);
CREATE INDEX ix_fixtures_batch        ON fixtures (import_batch_id) WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE fixtures IS
  'One row asserts: this AFL match is SCHEDULED to occur. SCHEDULE FACTS ONLY — this table has no score, result, margin, winner, attendance, period, lineup or statistic column, and none may ever be added: matches is the played-match table and the only thing that means "this game happened". "Played" is DERIVED at read time (AFLDB-ISSUE-162 §18) — exactly one matches row for the same season, round_code and club pair — and is never stored here: there is no match_id and no match_key column, and fixture_key remains the fixture''s identity before, during and after settlement. Nothing derived reads this table: ladders, club_seasons, season metadata, venue and club records, player and coach statistics, NL search plans and the Grid Solver all read matches and are unaffected by any row here. Never hand-edited outside src/db/queries/admin-fixtures.ts, and never deleted — status ''cancelled'' and ''void'' are terminal states that keep the row so its data_edits audit rows stay resolvable.';
COMMENT ON COLUMN fixtures.fixture_key IS
  'The durable fixture identity: a randomUUID() minted once at creation and NEVER edited. It survives reschedules, venue changes, round corrections, home/away swaps, club replacements, cancellation, voiding, a destructive rebuild and a promotion, and it is the data_overrides key ''manual_admin_edit:<token>''. Never derived from date, venue, club names or matches.match_key — match_key is a content address over the very fields a fixture exists to change.';
COMMENT ON COLUMN fixtures.season IS
  'The AFL season year. No FK to seasons(year) by design (AFLDB-ISSUE-162 §8): a fixture for the next season is intent about a season the tracked reference register has not reached yet. The administrable window max(seasons.year) <= S <= max + 1 is enforced by the writer, not by a constraint.';
COMMENT ON COLUMN fixtures.round_code IS
  'The matches round vocabulary exactly: the decimal string of round_number for home-and-away (Opening Round is round 1 from 2024, never round 0), or EF/QF/SF/PF/GF/WF for finals. Rendered server-side from round_type and round_number; never typed by a human. It is one of the three exact facts the read-time played resolution compares.';
COMMENT ON COLUMN fixtures.match_date IS
  'NULL means the date is genuinely unknown / TBC (AFLDB-ISSUE-162 D-5). There is no sentinel date and no fake midnight.';
COMMENT ON COLUMN fixtures.match_time IS
  'Local venue start time as free text (HH:MM, enforced by the writer), the same vocabulary matches.match_time carries. NULL means the time is TBC. No timestamptz, no UTC conversion, no DST arithmetic — and deliberately no second scheduled_at column: the one on matches has had no reader or writer since migration 003.';
COMMENT ON COLUMN fixtures.venue_raw IS
  'The venue name as it should render. Copied from venues.canonical_name when venue_id is set; carries a typed name when the venue is not in venues yet (venue_id NULL); NULL only when the venue is TBC. AFLDB-ISSUE-162 creates no venues or venue_aliases row — an unmapped name is a warning handed to venue administration, never an invented venue.';
COMMENT ON COLUMN fixtures.status IS
  'scheduled | cancelled | void. ''cancelled'' = a real scheduled event that did not happen (reversible by reinstating). ''void'' = a row entered in error that was never a real event (not reversible; enter a new fixture). Neither is a DELETE: the row, its identity and its audit trail persist so a promotion lineage remap can always resolve them.';
COMMENT ON COLUMN fixtures.import_batch_id IS
  'Importer-written rows only. No fixture importer exists in AFLDB-ISSUE-162; a future one writes under its OWN source_id, never over a manual_admin_edit row.';


-- ---------------------------------------------------------------------
-- 2. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here. That proof is order-independent about entities
-- which are NOT settle targets (AFLDB-ISSUE-159 §3.1, D-1), and fixtures
-- is not one, so this widening is safe to deploy before or after the code.
--
-- The durable record of a fixture is ONE data_overrides row:
--
--   entity_type     'fixtures'
--   entity_key      'manual_admin_edit:<token>'
--   field_group     'fixture'
--   override_values {fixture_key, season, round_type, round_number,
--                    round_code, match_date, match_time, home_club_slug,
--                    away_club_slug, venue_slug?, venue_raw?, status,
--                    status_reason?, notes?, batch_id?}
--   is_active       ALWAYS true
--
-- Club SLUGS and a venue SLUG, never ids: ids are renumbered by a
-- promotion, slugs are tracked reference data. is_active is always true
-- because the lifecycle lives in the payload's status: unlike a
-- season-list membership there is no DELETE to tombstone, and a
-- cancelled or void fixture must be RE-CREATED by the replay, not
-- suppressed by it, or its audit rows become unresolvable.
--
-- The key is a MINTED TOKEN rather than a natural key, which is the
-- opposite of migration 096's choice, and for the opposite reason: a
-- membership has a natural key (club, season, player) that no edit can
-- change, whereas every candidate natural key for a fixture -- date,
-- venue, even round and the club pair -- is a fact an administrator is
-- expected to correct. A key over mutable facts would change identity on
-- a reschedule, which is exactly what fixture_key exists to prevent.
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players',
    'matches',
    'draft_picks',
    'coaches',
    'match_coaches',
    'season_list_members',
    'fixtures'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';


-- ---------------------------------------------------------------------
-- 3. data_edits.table_name
-- ---------------------------------------------------------------------
-- Every existing literal from migration 095 is retained verbatim.
--
-- This is the AFLDB-ISSUE-160 draft_picks shape, NOT the AFLDB-ISSUE-161
-- audit-on-the-parent shape. 096 audited a membership against its PLAYER
-- because a membership row is DELETABLE, so an audit row pointing at
-- season_list_members.id would dangle. A fixture is never deleted (§16)
-- and has no allowlisted parent row to be a property of -- it is not a
-- property of a match, because the whole point is that the match may not
-- exist -- so the fixture itself is the audit subject, and row_id =
-- fixtures.id always resolves through the new fixture_key lineage rule in
-- tools/db/promotion-inventory.ts.
--
-- Admitting the name here OBLIGES that lineage target: without it a
-- fixture audit row would be reinstated with its row_id integer unchanged
-- and would silently name a different fixture after a lineage-changing
-- promotion, which is the exact AFLDB-ISSUE-142 (B) failure and the
-- AFLDB-ISSUE-160 D-3 defect.
ALTER TABLE data_edits
  DROP CONSTRAINT data_edits_table_name_check,
  ADD CONSTRAINT data_edits_table_name_check CHECK (table_name IN (
    'players',
    'matches',
    'draft_picks',
    'award_winners',
    'hall_of_fame',
    'honour_team_members',
    'brownlow_vote_entry_state',
    'brownlow_season_authority',
    'coaches',
    'fixtures'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted entities whose manual mutations are recorded in this append-only audit log. match_coaches is absent by design: its primary key is composite, so a coaching-assignment edit is audited against its match (table_name = ''matches'', field_group = ''coach_assignment''). season_list_members is absent by the same reasoning applied to deletability: a membership is audited against its player. fixtures IS here because a fixture is never deleted, so its id always resolves — through fixture_key at a lineage remap.';


-- ---------------------------------------------------------------------
-- 4. Fail-closed role registries (039 / 045)
-- ---------------------------------------------------------------------
-- The app reads the table (the Admin Centre pages and the read-time played
-- resolution), the ETL role writes it; privileges.sql reconciles from these
-- rows, so no privileges.sql edit is needed and afldb_auth gets nothing.
-- grant_import_write also classifies the table as an import-writable
-- REGISTRY for tools/db/promotion-inventory.ts: it is rebuilt on promotion
-- and re-created by replay_admin_overrides('fixtures'), so it must NOT also
-- appear in PROMOTION_CONTRACT (that would classify it {kind:'both'}, which
-- refuses every promotion phase), and it is not a DERIVED_FOOTBALL_TABLE
-- because nothing ever recomputes it.
--
-- Deploy order is binding: this migration, then npm run db:privileges, then
-- the code. App read is fail-closed since migration 039, so code that lands
-- first reads nothing (AFLDB-ISSUE-027 precedent).
SELECT afldb_meta.grant_app_read('fixtures');
SELECT afldb_meta.grant_import_write('fixtures');
