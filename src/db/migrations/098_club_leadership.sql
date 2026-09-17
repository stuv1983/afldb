-- =====================================================================
-- 098 - Club leadership: the canonical captain / vice-captain registry
-- =====================================================================
-- AFLDB-ISSUE-163 (AFLDB-ISSUE-156 P3e) Stage 1. Forward-only. Additive.
--
-- AFLDB already holds a captaincy table, and it is the wrong shape to be
-- the canonical one. captaincies (005:177-194) is a curated Wikipedia
-- HONOURS IMPORT: 1,774 rows for 1897-2026 loaded by
-- tools/migration/import_awards.py from data/awards/captaincies.csv. Its
-- natural uniqueness is on the RAW PLAYER NAME
-- (captaincies_natural_uq (season, club_id, player_name_raw, role),
-- 042:55-74), its season column is a FOREIGN KEY to the reference
-- register, its role vocabulary is the single value 'Captain', its
-- effective period is free text ("2022 (co-captain), 2023- (sole
-- captain)"), it has no lifecycle, and its reload REFUSES THE WHOLE
-- awards import on a natural-key collision with a row it does not own
-- (import_awards.py:2322-2370). Every one of those is a contract this
-- issue must not break, and extending the table breaks all five:
--
--   * a 2027 row is impossible while season REFERENCES seasons(year) and
--     the AFLDB-ISSUE-101 rollover has not run;
--   * a name-keyed unique means names would decide identity, which
--     nothing in AFLDB is allowed to do;
--   * a manual 2027 row plus a later curated CSV row for the same person
--     bricks the entire awards reload;
--   * captaincies.py pins EXPECTED_TOTAL 1774 / MAX_SEASON 2026 and
--     tools/db/rebuild-test.ts:833-888 pins the row count;
--   * there is no status, so an appointment could not end or be voided.
--
-- So this migration adds a SEPARATE canonical registry, club_leadership,
-- and does exactly four things:
--
--   1. creates the table: one row = one APPOINTMENT (season, club
--      identity, player, role, lifecycle status, optional evidence
--      dates), with a minted appointment_key that no edit ever moves;
--   2. admits 'club_leadership' as a data_overrides entity_type, so an
--      appointment has a durable record that destructive reloads and
--      promotions replay;
--   3. admits 'club_leadership' as a data_edits table_name, so a
--      leadership mutation is audited against the appointment itself;
--   4. registers the table in the fail-closed role registries.
--
-- It writes NO data. There is no backfill and this issue creates none:
-- the 2026 captaincies rows are Wikipedia facts ABOUT 2026, not 2027
-- appointments, and promoting them would invent decisions nobody took.
--
-- captaincies IS NOT TOUCHED. No column, constraint, index, loader,
-- manifest gate or consumer of it changes. The two coexist by a HARD
-- SEASON BOUNDARY (AFLDB-ISSUE-163 §3, §20.3, operator clarification
-- 2026-09-12):
--
--     season <= 2026   captaincies      (the historical honours source)
--     season >= 2027   club_leadership  (the canonical registry)
--
-- so no season is ever answered by both, and no row here can collide
-- with, or be mistaken for, a legacy captaincies row. The boundary is
-- built into the public queries themselves rather than applied as a
-- de-duplication afterwards, and a source-contract test pins
-- captaincies.py's MAX_SEASON below FIRST_LEADERSHIP_SEASON so the CSV
-- can never start answering a season this table owns. Converting the
-- 1,774 legacy rows into canonical ones is a recorded FOLLOW-UP
-- (AFLDB-ISSUE-163 §23) that this schema already supports through its
-- source columns; it is not done here.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * no players.is_captain and no club_seasons.captain_player_id. An
--     appointment is a fact about a club, a season and an OFFICE, held
--     for a period and capable of ending; a column on a person or on a
--     club-season can hold neither history nor two concurrent holders;
--   * no leadership_role column on season_list_members. One membership
--     row per player-season cannot hold an ENDED captaincy and a current
--     vice-captaincy at once, and a membership is DELETABLE (096's
--     removal is a DELETE plus a tombstone) -- which would delete
--     leadership history along with it;
--   * no match-level "captained this game" record. That joins the lineup
--     domain (AFLDB-ISSUE-100 territory) and is out of scope;
--   * no free-text player identity. player_id is NOT NULL and the
--     durable payload names the person by their AFL Tables profile path
--     or manual_admin_edit token, never by a display name;
--   * no FK season -> seasons(year), for the reason migrations 096
--     (096:33-41) and 097 (097:49-57) both gave. A 2027 appointment is
--     administrative intent about a season the tracked reference
--     register has not reached: seasons rows come from
--     data/reference/seasons.json and the AFLDB-ISSUE-101 rollover
--     refuses to advance the register until the completed season's
--     acquisition is accepted. The FK would buy no promotion safety
--     (seasons.year is a permanent natural identity needing no lineage
--     remap) and would make the table unusable for its only purpose.
--     The administrable window -- FIRST_LEADERSHIP_SEASON <= S <=
--     max(seasons.year) + 1 -- is a SERVER rule in
--     src/db/queries/admin-club-leadership.ts, not a CHECK;
--   * no FK to season_list_members, and no cascade from it. A player is
--     appointable only while they hold that club's season-list place,
--     but that rule governs CURRENT MUTATION ELIGIBILITY, not historical
--     validity: an appointment survives a later list correction,
--     transfer or removal. A FK would either BLOCK AFLDB-ISSUE-161's
--     DELETE (weakening a contract this issue may not touch) or CASCADE
--     it (destroying leadership history). The precondition is enforced
--     at write time under FOR KEY SHARE instead, and deliberately NOT
--     re-checked by the replay;
--   * no co_captain role. The AFL office is "captain"; "co-captains" is
--     the plural, and the existing data already models it that way -- 30
--     captaincies rows are role 'Captain' with a co-captain annotation
--     (Richmond 2022-23 Nankervis and Grimes are both 'Captain'). A
--     stored co_captain would force every reader to ask whether a lone
--     co_captain is a captain, and would require REWRITING rows when a
--     co-captain becomes sole captain. Co-captaincy is >= 2 concurrent
--     active 'captain' rows at one club-season;
--   * no DELETE path. 'ended' (the appointment ceased) and 'void' (the
--     row was entered in error and was never valid) are states that KEEP
--     the row, so every data_edits row pointing at club_leadership.id
--     stays resolvable through the appointment_key lineage rule at the
--     next promotion remap (docs/production-promotion.md §7.4c);
--   * no sentinel dates. NULL started_on / ended_on means GENUINELY
--     UNKNOWN. Nothing here fabricates 1 January, a season-opening date,
--     a round date or the current date, and "current" is never derived
--     from a clock: it is status = 'active';
--   * no seasons, clubs or club_seasons row is created here or by any
--     AFLDB-ISSUE-163 code path, no privileges.sql edit (the two
--     registries below drive it), no trigger, and no change to
--     captaincies, season_list_members, afldb_season_list_clubs() or
--     afldb_identity_for_season().
--
-- OPERATIONAL NOTE (reference loader). club_leadership references clubs,
-- players, sources and import_batches, so it enters the TRUNCATE ...
-- CASCADE closure of load_reference_data.py exactly as season_list_members
-- and fixtures did. That guard is FK-graph based rather than a hard-coded
-- list, so it picks this table up with no code change and REFUSES while it
-- holds rows unless --allow-cascade is given -- which is correct: the
-- appointments are then re-created by
-- replay_admin_overrides('club_leadership'), and the refusal is what makes
-- an operator decide that deliberately instead of discovering it
-- afterwards.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The canonical table
-- ---------------------------------------------------------------------
CREATE TABLE club_leadership (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- THE durable appointment identity. A randomUUID() minted once at
  -- creation by src/db/queries/admin-club-leadership.ts and never
  -- edited: it survives a date correction, an added note, an end, a
  -- void, a reinstatement, a destructive rebuild and a DEV -> PROD
  -- promotion, and it is the data_overrides key
  -- 'manual_admin_edit:<token>'.
  --
  -- Deliberately NOT a natural key, which is the opposite of migration
  -- 096's choice and for the opposite reason. A membership has a natural
  -- key (club, season, player) that no edit can change. Every candidate
  -- natural key here either RECURS -- (club, season, player, role) comes
  -- back when a player is re-appointed later in the same season, which
  -- is a second, genuinely different appointment -- or is MUTABLE:
  -- adding started_on to the key would move the identity on a date
  -- correction, and role, ended_on, status_reason and note are all
  -- things an administrator is expected to change. Names never decide
  -- identity anywhere in AFLDB.
  appointment_key  text        NOT NULL UNIQUE,

  -- No FK; see the header. The CHECK is the same range seasons_year_ck,
  -- season_list_members and fixtures use, so the four can never disagree
  -- about what a plausible season is. The 2027 floor is a SERVER rule
  -- (FIRST_LEADERSHIP_SEASON = FIRST_LIST_SEASON, imported so the two
  -- are one constant), not a CHECK.
  season           smallint    NOT NULL CHECK (season BETWEEN 1897 AND 2100),

  -- The historical club IDENTITY trading in that season, resolved
  -- through afldb_season_list_clubs() -- the ONE eligibility rule
  -- migration 096 introduced and 097 reused -- and never typed by a
  -- human. Organisation views derive from clubs.organization_id as
  -- everywhere else.
  club_id          integer     NOT NULL REFERENCES clubs(id),

  -- Plain FK, no ON DELETE CASCADE on purpose: an administrative
  -- decision about a person must not vanish silently because something
  -- else removed the person.
  player_id        integer     NOT NULL REFERENCES players(id),

  -- The closed vocabulary (AFLDB-ISSUE-163 D-2). Stored lowercase
  -- snake_case, matching season_list_members.origin and fixtures.status;
  -- rendered labels live in the UI. Widening it is an additive migration
  -- and a deliberate decision, not a typo someone can make.
  role             text        NOT NULL CHECK (role IN ('captain', 'vice_captain')),

  -- Lifecycle (D-3, D-7). Three states, no DELETE, no tombstone:
  --   active  currently holds the office
  --   ended   held it and ceased -- valid history, preserved
  --   void    entered in error, never valid leadership truth
  -- 'ended' and 'void' are NOT interchangeable: conflating a real
  -- appointment that finished with an operator's data-entry correction
  -- destroys the only record of which one happened. "Current" is this
  -- column and nothing else -- never now() and never a date comparison.
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'ended', 'void')),
  status_reason    text,

  -- Evidence dates (D-3). NULL = genuinely unknown / not announced,
  -- which is the NORMAL state of a pre-season appointment. There is no
  -- sentinel, no season-start fabrication, no round column (Opening
  -- Round renumbering, byes and finals codes make a round meaningless
  -- here, and a captain who steps down in the off-season has none) and
  -- no timestamptz: these are AFL local calendar facts, never instants.
  -- A round may be recorded in note as text; it is never a key.
  started_on       date,
  ended_on         date,

  note             text,

  -- manual_admin_edit (057:36-42) for every AFLDB-ISSUE-163 row, with
  -- source_record_id = appointment_key. A FUTURE importer -- the
  -- controlled captaincies conversion of §23, say -- writes under its
  -- OWN source_id with its own record id, and never over a manual row.
  source_id        smallint    NOT NULL REFERENCES sources(id),
  source_record_id text        NOT NULL,
  import_batch_id  bigint      REFERENCES import_batches(id),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- L-5. An interval that ends before it starts is not a fact about an
  -- office; it is two halves of a typing error.
  CONSTRAINT club_leadership_dates_ck
    CHECK (started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on),

  -- L-6. The lifecycle and the dates may never contradict each other: a
  -- row that says "currently holds the office" cannot also carry the
  -- date on which it ceased. (The reverse is NOT constrained: an ended
  -- appointment whose end date nobody announced is an ordinary and
  -- honest state, and NULL there means unknown, not open-ended.)
  CONSTRAINT club_leadership_active_open_ck
    CHECK (status <> 'active' OR ended_on IS NULL),

  -- L-7. Leaving a void unexplained loses the only thing that
  -- distinguishes an erroneous record from an appointment that really
  -- happened and finished.
  CONSTRAINT club_leadership_void_reason_ck
    CHECK (status <> 'void' OR status_reason IS NOT NULL),

  CONSTRAINT club_leadership_source_record_uq UNIQUE (source_id, source_record_id)
);

-- L-2 (D-6). ONE ACTIVE appointment per player per season: at most one
-- role, at most one club. It is a PARTIAL index on purpose, and the
-- partiality carries three separate decisions:
--
--   * co-captains are UNAFFECTED. Two active 'captain' rows at one
--     club-season are two DIFFERENT players, so nothing here caps how
--     many captains or vice-captains a club may have. An index on
--     (season, club_id, role) would make co-captaincy unrepresentable,
--     which is the defect this shape exists to avoid;
--   * ended and void rows are OUTSIDE the index, so a player may be
--     re-appointed later in the same season as a NEW appointment, and a
--     mid-season replacement keeps both rows (the outgoing one ended,
--     the incoming one active) as the honest history it is;
--   * a player cannot simultaneously be captain of one club and
--     vice-captain of another, or hold two roles at one club. Combined
--     with season_list_members' UNIQUE (season, player_id) -- a player
--     holds one list place per season -- the two-clubs case is already
--     unreachable through the writer; this makes it unrepresentable.
CREATE UNIQUE INDEX ux_club_leadership_active_player
  ON club_leadership (season, player_id) WHERE status = 'active';

-- Every FK column carries a leading-column index
-- (tests/integration/fk-indexes.test.ts), and each of these is also a
-- real access path: the club-season leadership block and the public
-- Captains history union, a player's leadership history, the per-source
-- write scope and a future importer's batch back-reference.
CREATE INDEX ix_club_leadership_club_season ON club_leadership (club_id, season DESC);
CREATE INDEX ix_club_leadership_player      ON club_leadership (player_id, season DESC);
CREATE INDEX ix_club_leadership_source      ON club_leadership (source_id);
CREATE INDEX ix_club_leadership_batch       ON club_leadership (import_batch_id) WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE club_leadership IS
  'One row asserts: this player was appointed to this leadership role at this club identity for this season; it is currently held (status ''active''), was held and has ceased (''ended''), or was recorded in error and was never valid (''void''). ADMINISTRATIVE FACT ABOUT AN OFFICE — not participation, and not a match-level "captained this game" record. CURRENT leadership is status = ''active'' and is NEVER derived from a clock or a date comparison; the dates are evidence and NULL means genuinely unknown. Co-captaincy is two or more concurrent active ''captain'' rows, never a role. COEXISTS WITH captaincies BY A HARD SEASON BOUNDARY (AFLDB-ISSUE-163 §3): seasons before 2027 are answered by captaincies (the Wikipedia honours import, untouched by this issue), seasons from 2027 by this table, and never both. Never hand-edited outside src/db/queries/admin-club-leadership.ts, and NEVER deleted — ''ended'' and ''void'' keep the row so its data_edits audit rows stay resolvable through appointment_key at a promotion lineage remap.';
COMMENT ON COLUMN club_leadership.appointment_key IS
  'The durable appointment identity: a randomUUID() minted once at creation and NEVER edited. It survives a date correction, a note, an end, a void, a reinstatement, a destructive rebuild and a promotion, and it is the data_overrides key ''manual_admin_edit:<token>''. Never derived from role, dates, notes or a player display name — every one of those is a fact an administrator is expected to change, and a key over mutable facts would move the record''s identity when they did.';
COMMENT ON COLUMN club_leadership.season IS
  'The AFL season the appointment belongs to — a pre-season appointment for 2027 announced in December 2026 is a 2027 row. No FK to seasons(year) by design (AFLDB-ISSUE-163 §5): an appointment for the next season is intent about a season the tracked reference register has not reached yet. The administrable window FIRST_LEADERSHIP_SEASON <= S <= max(seasons.year) + 1 is enforced by the writer, not by a constraint.';
COMMENT ON COLUMN club_leadership.club_id IS
  'The historical club identity trading in that season, resolved through afldb_season_list_clubs(season) — the same one rule AFLDB-ISSUE-161 and -162 use. Never an organisation id and never typed by a human; organisation-wide reads derive from clubs.organization_id.';
COMMENT ON COLUMN club_leadership.role IS
  'captain | vice_captain. Deliberately no co_captain: the office is "captain" and co-captaincy is two or more concurrent active captain rows, which is how the existing captaincies data already models it. Deliberately no acting/interim role either — a one-match stand-in is match-level and out of scope, while a sustained interim captain IS the captain for that period and is an ordinary captain appointment whose note may say so.';
COMMENT ON COLUMN club_leadership.status IS
  'active | ended | void. ''active'' = currently holds the office (and therefore carries no ended_on). ''ended'' = a valid historical appointment that ceased. ''void'' = a row entered in error that never represented valid leadership truth (terminal, and it must carry a status_reason). None of the three is a DELETE: the row, its identity and its audit trail persist so a promotion lineage remap can always resolve them.';
COMMENT ON COLUMN club_leadership.started_on IS
  'The date the appointment took effect, when it is known. NULL means GENUINELY UNKNOWN / not announced — the normal state of a pre-season appointment — and is never defaulted to 1 January, a season-opening date or anything else. Evidence only: "current" is decided by status, never by comparing this to a clock.';
COMMENT ON COLUMN club_leadership.ended_on IS
  'The date the appointment ceased, when it is known. NULL on an ended row means the date is unknown; on an active row it is required (club_leadership_active_open_ck) and simply means the appointment is still held.';
COMMENT ON COLUMN club_leadership.import_batch_id IS
  'Importer-written rows only. No leadership importer exists in AFLDB-ISSUE-163; a future one (the controlled captaincies conversion of §23) writes under its OWN source_id, never over a manual_admin_edit row.';


-- ---------------------------------------------------------------------
-- 2. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here. That proof is order-independent about entities
-- which are NOT settle targets (AFLDB-ISSUE-159 §3.1, D-1), and
-- club_leadership is not one -- the nightly settle writes matches and
-- statistics and neither reads nor writes this table -- so this widening
-- is safe to deploy before or after the code.
--
-- The durable record of an appointment is ONE data_overrides row:
--
--   entity_type     'club_leadership'
--   entity_key      'manual_admin_edit:<appointment_key>'
--   field_group     'appointment'
--   override_values {appointment_key, club_slug, season, player_identity,
--                    role, status, started_on?, ended_on?, status_reason?,
--                    note?, replaces_appointment_key?,
--                    replaced_by_appointment_key?}
--   is_active       ALWAYS true
--
-- A club SLUG and a player IDENTITY STRING, never ids: ids are renumbered
-- by a promotion, slugs are tracked reference data, and the identity is
-- exactly the string the AFLDB-ISSUE-160 players lineage rule and replay
-- resolve (an AFL Tables profile path or a manual_admin_edit token). A
-- display name appears nowhere in the payload.
--
-- is_active is always true because the lifecycle lives in the payload's
-- status: unlike a season-list membership there is no DELETE to
-- tombstone, and an ENDED or VOID appointment must be RE-CREATED by the
-- replay, not suppressed by it, or its audit rows become unresolvable.
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players',
    'matches',
    'draft_picks',
    'coaches',
    'match_coaches',
    'season_list_members',
    'fixtures',
    'club_leadership'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';


-- ---------------------------------------------------------------------
-- 3. data_edits.table_name
-- ---------------------------------------------------------------------
-- Every existing literal from migrations 095 and 097 is retained verbatim.
--
-- This is the AFLDB-ISSUE-162 fixtures shape, NOT the AFLDB-ISSUE-161
-- audit-on-the-parent shape. 096 audited a membership against its PLAYER
-- because a membership row is DELETABLE, so an audit row pointing at
-- season_list_members.id would dangle. An appointment is never deleted
-- (ended and void keep the row) and it has no allowlisted parent row to
-- be a property OF: it is deliberately not a property of the player,
-- because the row is about a club, a season and an office, and the same
-- person may hold two appointments. So the appointment itself is the
-- audit subject, and row_id = club_leadership.id always resolves through
-- the new appointment_key lineage rule in tools/db/promotion-inventory.ts.
--
-- Admitting the name here OBLIGES that lineage target: without it a
-- leadership audit row would be reinstated with its row_id integer
-- unchanged and would silently name a DIFFERENT appointment after a
-- lineage-changing promotion, which is the exact AFLDB-ISSUE-142 (B)
-- failure and the AFLDB-ISSUE-160 D-3 defect.
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
    'fixtures',
    'club_leadership'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted entities whose manual mutations are recorded in this append-only audit log. match_coaches is absent by design: its primary key is composite, so a coaching-assignment edit is audited against its match (table_name = ''matches'', field_group = ''coach_assignment''). season_list_members is absent by the same reasoning applied to deletability: a membership is audited against its player. fixtures and club_leadership ARE here because neither is ever deleted, so their ids always resolve — through fixture_key and appointment_key at a lineage remap.';


-- ---------------------------------------------------------------------
-- 4. Fail-closed role registries (039 / 045)
-- ---------------------------------------------------------------------
-- The app reads the table (the Admin Centre leadership section, the
-- public club page's leadership block, the Captains history union and
-- the player honours union), the ETL role writes it; privileges.sql
-- reconciles from these rows, so no privileges.sql edit is needed and
-- afldb_auth gets nothing.
--
-- grant_import_write also classifies the table as an import-writable
-- REGISTRY for tools/db/promotion-inventory.ts: it is rebuilt on
-- promotion and re-created by replay_admin_overrides('club_leadership'),
-- so it must NOT also appear in PROMOTION_CONTRACT (that would classify
-- it {kind:'both'}, which refuses every promotion phase), and it is not
-- a DERIVED_FOOTBALL_TABLE because nothing ever recomputes it.
--
-- Deploy order is binding: migrations 096 -> 097 -> 098, then
-- npm run db:privileges, then the code. App read is fail-closed since
-- migration 039, so code that lands first reads nothing
-- (AFLDB-ISSUE-027 precedent).
SELECT afldb_meta.grant_app_read('club_leadership');
SELECT afldb_meta.grant_import_write('club_leadership');
