-- =====================================================================
-- 096 - Season list administration: authoritative club playing lists
-- =====================================================================
-- AFLDB-ISSUE-161 (AFLDB-ISSUE-156 P3c) Stage 1. Forward-only. Additive.
--
-- AFLDB has never held a club's PLAYING LIST. Every player-club fact it
-- owns is DERIVED from matches actually played -- player_clubs,
-- player_club_season_stats, player_season_stats, player_career_stats and
-- club_seasons are all TRUNCATEd and rebuilt by
-- tools/migration/rebuild_derived.py from player_match_stats -- so a
-- player who is LISTED but has not PLAYED has no club anywhere in the
-- model, and "is this player currently on a list" is not a question any
-- query can answer.
--
-- This migration does exactly four things:
--
--   1. creates the canonical registry table season_list_members;
--   2. creates afldb_season_list_clubs(), the ONE eligibility rule the
--      list page, copy-forward, add and transfer all resolve through;
--   3. admits 'season_list_members' as a data_overrides entity_type, so a
--      membership has a durable record destructive reloads replay;
--   4. registers the table in the fail-closed role registries.
--
-- It writes NO data. There is no backfill and there can never be one:
-- "listed" is not derivable from "played" (a delisted player plays no
-- games; a listed rookie may play none either), and no source in the
-- repository publishes historical lists. AFLDB-ISSUE-161 D-2 sets the
-- first authoritative list season to 2027 and forbids promoting 2026
-- match appearances into membership -- appearances may be DISPLAYED for
-- review, never WRITTEN as a list.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * no FK season -> seasons(year). A 2027 list is administrative intent
--     about a season the reference register has not reached: seasons rows
--     come from data/reference/seasons.json through load_reference_data.py
--     (TRUNCATE ... CASCADE and copy), the ISSUE-101 rollover refuses to
--     advance the register until the completed season's full-history
--     acquisition is accepted, and seasons.year is a permanent natural
--     identity that needs no lineage remap. The FK would buy no promotion
--     safety and would make the table unusable for its only purpose;
--   * no data_edits.table_name widening. A membership row is DELETABLE
--     (D-4 below), so an audit row pointing at season_list_members.id
--     would dangle and would need its own lineage target. The audit
--     subject is the PLAYER instead -- table_name 'players', field_groups
--     'season_list_added' / 'season_list_removed' -- exactly as
--     AFLDB-ISSUE-160 §9.1 resolved the identical case for manual draft
--     selections;
--   * no status / active / retired / delisted / removed_at column. D-4:
--     presence IS membership and absence IS non-membership. Removal is an
--     audited DELETE whose inactive override is a TOMBSTONE that no
--     importer and no replay may resurrect. "Retired" is never stored --
--     it is the absence of a membership in the current list season;
--   * no seasons, clubs or club_seasons row is created here or by any
--     ISSUE-161 code path (D-6). "Opening a season" is not a database
--     initialisation step at all: it is the first membership written for
--     that season;
--   * no privileges.sql edit (the two registries below drive it), no
--     trigger, and no change to afldb_identity_for_season().
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The canonical table
-- ---------------------------------------------------------------------
CREATE TABLE season_list_members (
  id                 bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- Deliberately no FK to seasons(year); see the header. The CHECK is the
  -- same range seasons_year_ck uses, so the two can never disagree about
  -- what a plausible season is. The 2027 floor is a SERVER rule
  -- (FIRST_LIST_SEASON in src/db/queries/admin-season-lists.ts), not a
  -- CHECK: a later decision to administer an earlier season must be a
  -- reviewed code change, not a migration that rewrites history.
  season             smallint    NOT NULL CHECK (season BETWEEN 1897 AND 2100),

  -- The historical club IDENTITY trading in that season, resolved by
  -- afldb_season_list_clubs() below and never typed by a human. Lineage
  -- and organisation views derive from clubs.organization_id as everywhere
  -- else, so a rename between seasons is a different identity, not an edit.
  club_id            integer     NOT NULL REFERENCES clubs(id),

  -- Plain FK, no ON DELETE CASCADE on purpose: an administrative decision
  -- about a person must not vanish silently because something else removed
  -- the person.
  player_id          integer     NOT NULL REFERENCES players(id),

  source_id          smallint    NOT NULL REFERENCES sources(id),

  origin             text        NOT NULL CHECK (origin IN (
                       'added',        -- an explicit per-player decision
                       'copied_list',  -- carried forward from season - 1
                       'transferred',  -- moved within a season, atomically
                       'imported'      -- reserved: a future list source
                     )),

  -- Set only by copy-forward, and only to a season strictly earlier than
  -- this row's. Evidence, not identity.
  copied_from_season smallint    CHECK (copied_from_season IS NULL OR copied_from_season < season),

  note               text,
  import_batch_id    bigint      REFERENCES import_batches(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- I-1 (AFLDB-ISSUE-161 D-3). One player holds at most ONE club's list
  -- place in a season. Evidence gathered on rebuilt afldb_test before this
  -- migration was written: over the whole 1897-2026 history
  -- player_club_season_stats holds 249 player-seasons with more than one
  -- club, and the LATEST is 1992 -- the residue of the pre-1993 clearance
  -- era. Season >= 2000: ZERO. The first list season is 2027, so the
  -- constraint is contradicted by nothing in the modern game.
  --
  -- It also implies uniqueness of (season, club_id, player_id), so no
  -- second constraint is needed, and it is what makes "the club of P's
  -- membership in season S" a FUNCTION rather than a query that might
  -- return two answers.
  CONSTRAINT season_list_members_one_club_ck UNIQUE (season, player_id)
);

-- Every FK column carries a leading-column index
-- (tests/integration/fk-indexes.test.ts), and each of these is also a real
-- access path: the club list page, a club's list history, a player's list
-- history, the per-source write scope, and the importer batch back-reference.
CREATE INDEX ix_slm_season_club ON season_list_members (season, club_id);
CREATE INDEX ix_slm_club        ON season_list_members (club_id, season);
CREATE INDEX ix_slm_player      ON season_list_members (player_id, season DESC);
CREATE INDEX ix_slm_source      ON season_list_members (source_id);
CREATE INDEX ix_slm_batch       ON season_list_members (import_batch_id) WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE season_list_members IS
  'One row asserts: this player was a member of this club''s playing list for this season, as recorded by this source. ADMINISTRATIVE INTENT, never participation — it says nothing about games played, and player_club_season_stats continues to mean "played for". NEVER derived and never rebuilt from matches; never hand-edited outside src/db/queries/admin-season-lists.ts. Absence is the whole of "not listed": there is no retired, delisted or status column, and a removal is an audited DELETE whose inactive data_overrides row is a tombstone no importer or replay may resurrect.';
COMMENT ON COLUMN season_list_members.season IS
  'The AFL season year the list applies to. No FK to seasons(year) by design (AFLDB-ISSUE-161 §5): a list for the next season is intent about a season the tracked reference register has not reached yet.';
COMMENT ON COLUMN season_list_members.club_id IS
  'The historical club identity trading in that season, resolved through afldb_season_list_clubs(season). Never an organisation id and never typed by a human.';
COMMENT ON COLUMN season_list_members.origin IS
  'How this membership came to exist. There is deliberately no appearance-derived origin: AFLDB-ISSUE-161 D-2 forbids promoting match appearances into authoritative membership, so a player picked out of the non-authoritative appearances review panel is an ordinary ''added'' row whose override payload records candidate_source = ''appearances:<season>'' as evidence only.';
COMMENT ON COLUMN season_list_members.import_batch_id IS
  'Importer-written rows only. No list importer exists in AFLDB-ISSUE-161; a future one writes under its OWN source_id, never over a manual row and never onto a tombstoned key.';


-- ---------------------------------------------------------------------
-- 2. The ONE eligible-club rule
-- ---------------------------------------------------------------------
-- The season-boundary problem AFLDB-ISSUE-160 hit, solved without touching
-- the tracked reference register. clubs.last_season is loaded from
-- data/reference/clubs.json and a current identity's NULL is replaced by
-- seasons.json's last_season, so afldb_identity_for_season(org, 2027)
-- returns NULL for EVERY identity while the register ends at 2026 — which
-- would make next season's list unadministrable.
--
-- For a season the register has not reached, the identities that will
-- compete are the ones currently competing: the only fact the repository
-- holds about the future. Once the rollover advances the register the two
-- arms coincide, so nothing has to be migrated when it does.
--
-- This is a FUNCTION rather than a rule spelled out in TypeScript because
-- the list page, copy-forward, add and transfer must not be able to
-- disagree about which clubs exist in a season. Nothing hard-codes 18: a
-- new club, a rename or a departure enters through clubs.json and is
-- picked up here with no code change.
--
-- afldb_identity_for_season() itself is NOT modified: ladder rows, season
-- pages and the ISSUE-160 J-6 draft constraint keep their exact behaviour.
CREATE FUNCTION afldb_season_list_clubs(p_season smallint) RETURNS SETOF clubs
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT c.*
    FROM clubs c
   WHERE CASE
           -- Forward extension. On an empty seasons table max(year) is
           -- NULL, the comparison is NULL, and the CASE falls through to
           -- the historical arm — which then matches nothing. Fail-closed
           -- in the one state where the register cannot answer.
           WHEN p_season >= (SELECT max(year) FROM seasons)
             THEN c.is_current_afl_club
           ELSE afldb_identity_for_season(c.organization_id, p_season) = c.id
                AND EXISTS (SELECT 1 FROM club_seasons cs
                             WHERE cs.club_id = c.id AND cs.season = p_season)
         END
   ORDER BY c.name
$$;

COMMENT ON FUNCTION afldb_season_list_clubs IS
  'The club identities whose playing list may be administered for a season (AFLDB-ISSUE-161 §9.1, D-6). At or beyond the reference register''s last season the answer is the current AFL identities — a list for a future season is intent, and the register describes played history. Before it, the era identity that actually competed. Requires no matches, no fixture and no club_seasons row for a future season: AFLDB-ISSUE-161 owns no fixture and must work for a season with none.';


-- ---------------------------------------------------------------------
-- 3. data_overrides.entity_type
-- ---------------------------------------------------------------------
-- Every existing literal is retained verbatim; nothing is weakened. The
-- three settle targets migration 073's narrowness proves unrepresentable
-- (match_period_scores, player_match_stats, brownlow_round_votes) are
-- still absent and must stay absent: src/lib/acquisition/manual-authority.ts
-- reads this constraint live and refuses to APPLY those targets if any of
-- them ever appears here. That proof is order-independent about entities
-- which are NOT settle targets (AFLDB-ISSUE-159 §3.1, D-1), so this
-- widening is safe to deploy before or after the code.
--
-- The durable record of a membership is one data_overrides row:
--
--   entity_type     'season_list_members'
--   entity_key      '<club_slug>|<season>|<player identity>'
--   field_group     'membership'
--   override_values {club_slug, season, player_identity, origin,
--                    copied_from_season?, candidate_source?, note?}
--   is_active       true = listed; false = TOMBSTONE, intentionally removed
--
-- The key is NATURAL and rebuild-stable, not a minted token: club slugs are
-- tracked reference data and the player identity is the same string the
-- ISSUE-160 players lineage rule and replay resolve (an AFL Tables profile
-- path, or a manual_admin_edit token). A membership HAS a natural key, so
-- minting one would let the same player be listed twice under two tokens
-- and would make copy-forward non-idempotent. Because the key is natural,
-- re-adding a removed player reactivates the same record instead of
-- creating a second one. No component can be NULL at write time and the
-- writer refuses when the player's identity does not resolve to exactly
-- one string, so no null|null|<year>|null class of key can arise.
ALTER TABLE data_overrides
  DROP CONSTRAINT data_overrides_entity_type_check,
  ADD CONSTRAINT data_overrides_entity_type_check CHECK (entity_type IN (
    'players',
    'matches',
    'draft_picks',
    'coaches',
    'match_coaches',
    'season_list_members'
  ));

COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS
  'Entities whose durable human decisions destructive reloads replay. A settle target must never be admitted here: src/lib/acquisition/manual-authority.ts proves from this constraint that an override for match_period_scores, player_match_stats or brownlow_round_votes is unrepresentable, and admitting one degrades the nightly settle from apply to propose-only.';


-- ---------------------------------------------------------------------
-- 4. Fail-closed role registries (039 / 045)
-- ---------------------------------------------------------------------
-- The app reads the table, the ETL role writes it; privileges.sql
-- reconciles from these rows, so no privileges.sql edit is needed and
-- afldb_auth gets nothing. grant_import_write also classifies the table as
-- an import-writable REGISTRY for tools/db/promotion-inventory.ts: it is
-- rebuilt on promotion and re-created by replay_admin_overrides, so it must
-- NOT also appear in PROMOTION_CONTRACT (that would classify it
-- {kind:'both'}, which refuses every promotion phase), and it is not a
-- DERIVED_FOOTBALL_TABLE because nothing ever recomputes it.
--
-- Deploy order is binding: this migration, then npm run db:privileges,
-- then the code. App read is fail-closed since migration 039, so code that
-- lands first reads nothing (ISSUE-027 precedent).
SELECT afldb_meta.grant_app_read('season_list_members');
SELECT afldb_meta.grant_import_write('season_list_members');
