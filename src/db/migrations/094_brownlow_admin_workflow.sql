-- =====================================================================
-- AFLDB 094 — Brownlow administration: canonical match identity and the
--             draft / final / publication workflow
-- =====================================================================
-- AFLDB-ISSUE-155 Phase C1. The implementation contract is §27 of
-- AFLDB-ISSUE-155.md; §27.16 is this file's specification and §27.5 is
-- the backfill statement below, reproduced rather than re-derived.
--
-- WHY. Brownlow votes are stored in three grains (season total, round
-- fact, per-match mirror) and none of them carries a match identifier.
-- Admin entry of a vote therefore has nothing canonical to attach to,
-- and the generic match sheet has been the only way to write a per-match
-- vote at all -- a second authority the settle and the artefact loader
-- both have to work around. This migration makes the match-level vote
-- the canonical fact by giving brownlow_round_votes a real match
-- identity, and adds the two workflow tables that let an Admin draft and
-- a Super Admin finalise and publish without drafts ever becoming rows
-- in a public fact table.
--
-- PREFLIGHT EVIDENCE (run against afldb_test, 2026-09-10, §27.20). These
-- are the measurements this file's constraints depend on; each is
-- re-checkable after apply:
--
--   P1  320,861 round rows, 1984-2025; 298,622 carry a published zero,
--       so the round table is a dense participation record, not a sparse
--       poll record. No NULL votes, no played = false rows.
--   P2  320,861 of 320,861 rows resolve to exactly ONE match through the
--       player's own player_match_stats row. Zero unresolved, zero
--       ambiguous. The backfill below therefore leaves no NULL match_id
--       on current data -- but the column stays nullable forever, because
--       an unresolved historical row is a legitimate state (§27.5).
--   P3  HARD GATE, green: zero duplicates of (match_id, player_id) and
--       zero of (match_id, votes) where votes > 0. Both unique indexes
--       below are satisfiable without weakening.
--   P5  Round facts and season totals agree exactly across 1984-2025:
--       44,478 votes on both sides, zero player-level mismatches.
--   P6  All 7,413 home-and-away matches of the era are textbook 3/2/1.
--       No partial matches, no uncovered matches, so P7's exception
--       population is empty and `void` ships unused on existing data.
--   P8  16,327 H&A matches 1897-2026, every one with line-ups. Seven
--       matches sit under 18 a side and all seven are incomplete 2026
--       imports, so the §27.6 participant threshold stays at 18 and
--       those seven correctly refuse finalisation until repaired.
--   P11 HARD GATE, green: afldb_import holds every privilege the four
--       transactions need across 20 checks.
--   P12 The player_match_stats mirror is perfectly aligned with the round
--       facts across 1984-2025 (44,478 both sides, zero disagreement),
--       and pre-1984 mirror values exist for exactly 1931-1934. Those
--       four seasons are NOT promoted into round facts here: they are
--       partial, the coverage authority already says so, and fabricating
--       complete round facts from them is the §27.22 stop condition.
--
-- FORWARD-ONLY AND ADDITIVE. One new column, three new indexes on an
-- existing table, two new tables, one widened CHECK. No column is
-- dropped, no data is deleted, no constraint is weakened or made NOT
-- VALID. match_id is never made NOT NULL, in this migration or a later
-- one. The runner wraps the whole file in one transaction, so a backfill
-- or constraint failure leaves the database on 093 with nothing applied.
--
-- DEPLOY ORDER: this migration must reach a host BEFORE the Phase C1
-- code, which reads and writes the two new tables. Old code tolerates it
-- because every object is additive and nothing existing changes shape.
--
-- PRIVILEGES: section 7 grants afldb_import its writes directly rather
-- than through the migration-045 registry, deliberately. The reconciler
-- strips an unregistered table's grants on every run, so the matching
-- block in tools/maintenance/privileges.sql travels with this migration
-- and is what makes the grants survive `npm run db:privileges`, a
-- restore, or a rebuild. Applying this file without that edit leaves a
-- database whose Brownlow mutations work until the next reconcile.
--
-- CONTRACT TESTS that fail if this file is reverted:
--   tests/integration/admin-brownlow.test.ts  (objects, backfill, indexes)
--   tests/integration/privileges.test.ts      (app read, import write,
--                                              auth nothing)
--   tests/integration/fk-indexes.test.ts      (the auth_users and players
--                                              foreign keys added below)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Match identity on the round fact
-- ---------------------------------------------------------------------
-- ON DELETE SET NULL, not CASCADE: a Brownlow vote is a fact about a
-- player's season and survives the deletion of the match row it was
-- polled in. Deleting a match that has a workflow row is refused
-- outright by the RESTRICT foreign key in section 4, so this path is
-- reachable only for matches nobody has administered.
ALTER TABLE brownlow_round_votes
  ADD COLUMN match_id integer REFERENCES matches(id) ON DELETE SET NULL;

COMMENT ON COLUMN brownlow_round_votes.match_id IS
  'Exact home-and-away match this vote was polled in. NULL = not resolved '
  '(no line-up row for the player in that round, or more than one); never '
  'guessed. Fuzzy matching by name, date or club is not used anywhere.';


-- ---------------------------------------------------------------------
-- 2. Deterministic backfill (§27.5)
-- ---------------------------------------------------------------------
-- The ONLY evidence used is the player's own canonical line-up row in
-- that season and round. A row with no candidate, or with more than one,
-- keeps match_id NULL and is reported as unresolved by the admin season
-- view. P2 measured zero of each on current data; the statement is
-- written to survive the day that stops being true.
UPDATE brownlow_round_votes rv
   SET match_id = r.match_id
  FROM (
    SELECT rv2.id,
           (array_agg(m.id))[1] AS match_id,
           count(DISTINCT m.id)  AS candidates
      FROM brownlow_round_votes rv2
      JOIN matches m
        ON m.season = rv2.season
       AND m.round_type = 'home_and_away'
       AND m.round_number = rv2.round_number
      JOIN player_match_stats pms
        ON pms.match_id = m.id AND pms.player_id = rv2.player_id
     WHERE rv2.match_id IS NULL
     GROUP BY rv2.id
  ) r
 WHERE r.id = rv.id AND r.candidates = 1;

-- Report what the backfill achieved, so the apply log carries the
-- evidence the post-migration validation compares against.
DO $$
DECLARE
  total      bigint;
  resolved   bigint;
  unresolved bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE match_id IS NOT NULL),
         count(*) FILTER (WHERE match_id IS NULL)
    INTO total, resolved, unresolved
    FROM brownlow_round_votes;

  RAISE NOTICE '094 backfill: % of % round rows resolved to a match, % unresolved (expected 320861 / 320861 / 0 on afldb_test)',
    resolved, total, unresolved;
END
$$;


-- ---------------------------------------------------------------------
-- 3. Match-grain invariants
-- ---------------------------------------------------------------------
-- Both are PARTIAL on match_id IS NOT NULL so that unresolved legacy
-- rows are untouched by them: history that cannot be attributed to a
-- match is not constrained as though it could.
--
-- Together these are the database's own statement of the Brownlow rule,
-- independent of any application code: within one match a player holds
-- at most one assignment, and at most one player holds each of 3, 2
-- and 1. A published zero is excluded from the value index, because
-- every non-polling participant carries one (P1).
CREATE UNIQUE INDEX ux_brownlow_round_votes_match_player
  ON brownlow_round_votes (match_id, player_id)
  WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX ux_brownlow_round_votes_match_value
  ON brownlow_round_votes (match_id, votes)
  WHERE match_id IS NOT NULL AND votes > 0;

-- No separate single-column index on match_id. §27.16 planned one as
-- "the FK's own index", but neither reason holds against the current
-- rule: tests/integration/fk-indexes.test.ts exempts every foreign key
-- pointing at `matches` (a delete-free parent, reloaded by TRUNCATE
-- CASCADE), and ux_brownlow_round_votes_match_player already leads with
-- match_id under exactly the predicate a referential probe implies, so
-- it serves both the ON DELETE SET NULL probe and every read-model
-- lookup by match. A third index here would be dead weight of the kind
-- migration 041 removed.


-- ---------------------------------------------------------------------
-- 4. Vote entry workflow state
-- ---------------------------------------------------------------------
-- Deliberately a SEPARATE table rather than workflow columns on
-- brownlow_round_votes: a draft must never be a row in a public fact
-- table. Nothing here is a public statistical authority -- the canonical
-- facts stay in brownlow_round_votes and the mirror -- so no public
-- query reads this table.
--
-- ON DELETE RESTRICT on match_id is intentional (§27.15): deleting a
-- match that carries a Brownlow decision fails, and match-admin's
-- existing error path surfaces it. Fail closed beats silently discarding
-- an administrative record.
CREATE TABLE brownlow_vote_entry_state (
  match_id           integer     PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT,
  season             smallint    NOT NULL REFERENCES seasons(year),
  status             text        NOT NULL CHECK (status IN ('draft', 'final', 'void')),

  three_player_id    integer     REFERENCES players(id),
  two_player_id      integer     REFERENCES players(id),
  one_player_id      integer     REFERENCES players(id),

  -- Monotonic; the compare-and-set every mutation carries (§27.14).
  revision           integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

  created_by         integer     NOT NULL REFERENCES auth_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         integer     NOT NULL REFERENCES auth_users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  finalised_by       integer     REFERENCES auth_users(id),
  finalised_at       timestamptz,
  finalised_revision integer,
  last_reason        text        CHECK (last_reason IS NULL OR length(last_reason) <= 500),

  -- A player cannot hold two of the three votes in one match.
  --
  -- `<>`, NOT `IS DISTINCT FROM`, and the difference is load-bearing.
  -- §27.16 specified IS DISTINCT FROM, which evaluates NULL IS DISTINCT
  -- FROM NULL as FALSE -- so a draft holding only a three-vote, with two
  -- empty slots, would be REFUSED by the database, contradicting §27.7's
  -- "0-3 distinct participants selected". `<>` yields NULL when either
  -- side is empty and a CHECK passes on NULL, while still returning
  -- FALSE for two equal ids. Empty slots pass; duplicates never do.
  CONSTRAINT bves_distinct_ck CHECK (
    three_player_id <> two_player_id
    AND three_player_id <> one_player_id
    AND two_player_id   <> one_player_id),

  -- A draft may be incomplete; a final may not. This is the database's
  -- half of the state machine -- the application refuses an incomplete
  -- finalisation with a stable error code before ever reaching here.
  CONSTRAINT bves_final_complete_ck CHECK (
    status <> 'final'
    OR (three_player_id IS NOT NULL AND two_player_id IS NOT NULL AND one_player_id IS NOT NULL
        AND finalised_by IS NOT NULL AND finalised_at IS NOT NULL AND finalised_revision IS NOT NULL)),

  -- "No votes were awarded in this match", declared by a Super Admin
  -- with a reason. It holds no selection and writes no vote rows.
  CONSTRAINT bves_void_empty_ck CHECK (
    status <> 'void'
    OR (three_player_id IS NULL AND two_player_id IS NULL AND one_player_id IS NULL
        AND finalised_by IS NOT NULL AND last_reason IS NOT NULL))
);

COMMENT ON TABLE brownlow_vote_entry_state IS
  'Per-match Brownlow entry workflow: draft, final or void. Workflow state only, '
  'never a public statistical authority -- the canonical facts are '
  'brownlow_round_votes rows carrying match_id. Drafts reach no public query.';

COMMENT ON COLUMN brownlow_vote_entry_state.revision IS
  'Monotonic. Every mutation supplies the revision it was rendered from and is '
  'refused as stale if it no longer matches (§27.14). Never last-write-wins.';

CREATE INDEX ix_bves_season_status ON brownlow_vote_entry_state (season, status);

-- Foreign keys to players and auth_users need their own indexes:
-- fk-indexes.test.ts exempts only delete-free parents, and its comment
-- names a new auth_users reference as exactly the case it should catch.
CREATE INDEX ix_bves_three ON brownlow_vote_entry_state (three_player_id) WHERE three_player_id IS NOT NULL;
CREATE INDEX ix_bves_two   ON brownlow_vote_entry_state (two_player_id)   WHERE two_player_id   IS NOT NULL;
CREATE INDEX ix_bves_one   ON brownlow_vote_entry_state (one_player_id)   WHERE one_player_id   IS NOT NULL;
CREATE INDEX ix_bves_created_by   ON brownlow_vote_entry_state (created_by);
CREATE INDEX ix_bves_updated_by   ON brownlow_vote_entry_state (updated_by);
CREATE INDEX ix_bves_finalised_by ON brownlow_vote_entry_state (finalised_by) WHERE finalised_by IS NOT NULL;


-- ---------------------------------------------------------------------
-- 5. Season authority and publication record
-- ---------------------------------------------------------------------
-- Which authority a season's totals carry, and the revision a
-- publication was derived from. A season with no row here has never been
-- administered: its brownlow_season_votes rows remain source-published
-- and authoritative, exactly as they are today (§27.3 item 3).
CREATE TABLE brownlow_season_authority (
  season             smallint    PRIMARY KEY REFERENCES seasons(year),
  revision           integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_revision integer,
  published_by       integer     REFERENCES auth_users(id),
  published_at       timestamptz,
  updated_by         integer     NOT NULL REFERENCES auth_users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Published means all three recorded together or none of them. There
  -- is no half-published season.
  CONSTRAINT bsa_published_ck CHECK (
    (published_revision IS NULL) = (published_by IS NULL)
    AND (published_revision IS NULL) = (published_at IS NULL))
);

COMMENT ON TABLE brownlow_season_authority IS
  'Publication state of a season''s Brownlow totals. published_revision NOT NULL '
  'means brownlow_season_votes for that season were derived from the finalised '
  'match set and carry source manual_admin_edit; absent row means source-published.';

CREATE INDEX ix_bsa_updated_by   ON brownlow_season_authority (updated_by);
CREATE INDEX ix_bsa_published_by ON brownlow_season_authority (published_by) WHERE published_by IS NOT NULL;


-- ---------------------------------------------------------------------
-- 6. Audit allowlist (the migration-058 pattern)
-- ---------------------------------------------------------------------
-- data_edits.table_name is an allowlist by design. Widen it for the two
-- workflow entities so the required Brownlow audit rows can be written
-- inside the same transaction as the fact they describe. Every existing
-- entry is retained verbatim; nothing is weakened.
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
    'brownlow_season_authority'
  ));

COMMENT ON CONSTRAINT data_edits_table_name_check ON data_edits IS
  'Allowlisted statistical entities whose manual mutations are recorded in this append-only audit log.';


-- ---------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------
-- READ: through the migration-039 registry, which is data, so
-- privileges.sql rebuilds afldb_app's SELECT from the database itself
-- and a restore recovers it. The admin read model runs on the app pool
-- like every other read. Drafts are kept out of public output by the
-- query layer, not by this grant.
SELECT afldb_meta.grant_app_read('brownlow_vote_entry_state');
SELECT afldb_meta.grant_app_read('brownlow_season_authority');

-- WRITE: deliberately NOT registered in afldb_meta.import_writable_tables.
-- That registry's loop grants SELECT, INSERT, UPDATE, DELETE **and
-- TRUNCATE** to afldb_import, which is exactly the power a record of
-- administrative decisions must not hand to a reload path -- the reason
-- migrations 066, 073, 078, 080 and 083 each took this narrow route
-- instead. No ETL job writes these tables; the four Brownlow
-- transactions in src/db/queries/admin-brownlow.ts are their only writer.
--
-- The reconciler's import loop REVOKEs ALL on any public table absent
-- from the write registry, so these two grants are stripped on every
-- `npm run db:privileges` run and MUST be mirrored in
-- tools/maintenance/privileges.sql after that loop, beside the 066 and
-- 080 blocks. That mirror travels with this migration.
--
-- SELECT is required for the FOR UPDATE row locks of §27.14, UPDATE for
-- every state transition, INSERT for the first draft and the
-- insert-if-absent authority row, DELETE for a discarded entry. Neither
-- table owns a sequence -- the primary keys are match_id and season,
-- both supplied -- so unlike the 066 block there is no sequence grant.
--
-- Guarded on the role existing, the migration-066 shape: on a cluster
-- whose migrations run before role setup an unguarded GRANT would fail
-- and take the whole migration with it. privileges.sql applies the grant
-- in that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON brownlow_vote_entry_state, brownlow_season_authority
      TO afldb_import;
  END IF;
END
$$;

-- afldb_auth gets nothing. Neither table is added to that role's
-- hand-typed specification in privileges.sql.
