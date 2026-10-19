-- =====================================================================
-- 112 - Derived award results: the append-only ledger of PUBLISHED derivations
-- =====================================================================
-- AFLDB V2 Stage 4 (docs/v2/plan.md section 3 D6, docs/v2/adr/0006-coleman-derived.md).
-- Forward-only. Additive. Writes NO data and never rewrites an existing row.
--
-- Purpose
-- -------
-- The Coleman Medal is DERIVED from promoted player goal facts, never ingested
-- (packages/derived/src/coleman.ts). A derivation is a pure function; this table
-- is where a derivation that a super administrator has explicitly PUBLISHED is
-- recorded, with everything needed to audit and reproduce it:
--   * result            the full serialiseColemanDerivation() output (leaderboard,
--                       winners, counts and the exact canonical inputs);
--   * winners           the winners alone (a self-consistency CHECK ties it to result);
--   * method_version    the contract's method_version
--                       (data/reference/coleman-derivation.json);
--   * derivation_version the code version (COLEMAN_DERIVATION_VERSION);
--   * input_checksum    sha256 of the canonical inputs (independent of derived_at);
--   * correction        the season seal's audit record. A derivable season is a COMPLETE
--                       season and a complete season is a SEALED one, so every publication
--                       is an audited correction through the seal
--                       (packages/domain/src/season-seal.ts, workflow
--                       'derived_award_publication', docs/v2/historical-baseline.md section 2).
--
-- This table is the DERIVATION RECORD. It is NOT award_winners. The Coleman
-- award_winners rows stay owned by tools/migration/import_awards.py; projecting a
-- published result into award_winners is a later step that must itself pass the
-- seal and supply player_name_raw (ADR 0006, divergence 8). Nothing in this
-- migration or in the publisher writes award_winners.
--
-- Append-only, and how "current" is kept without an UPDATE
-- ---------------------------------------------------------
-- No role is ever granted UPDATE, DELETE or TRUNCATE here, so a row can never be
-- marked "superseded" in place. Supersession is instead expressed by the NEW row:
-- supersedes_id names the row it replaces. Four constraints make the chain a
-- single linear history per (award_slug, season):
--   * uq_derived_award_results_root        at most ONE row per (award_slug, season)
--                                           has supersedes_id IS NULL (the first
--                                           publication);
--   * uq_derived_award_results_supersedes  a row has at most ONE successor
--                                           (no branching);
--   * derived_award_results_supersedes_fk  the predecessor must be the SAME
--                                           (award_slug, season), via a composite
--                                           foreign key to the unique key
--                                           (id, award_slug, season);
--   * derived_award_results_supersedes_ck  supersedes_id < id, so there is no cycle.
-- The CURRENT row of a (award_slug, season) is therefore the one that no other row
-- names in supersedes_id (equivalently, the highest id). The publisher reads it as
--   SELECT ... FROM derived_award_results r WHERE award_slug = $1 AND season = $2
--      AND NOT EXISTS (SELECT 1 FROM derived_award_results s WHERE s.supersedes_id = r.id)
-- and serialises concurrent publishers with pg_advisory_xact_lock (afldb_import has
-- no UPDATE privilege, so SELECT ... FOR UPDATE is unavailable by design); the two
-- unique indexes are the backstop if the lock were ever bypassed.
--
-- Natural identity, not row ids
-- -----------------------------
-- There is NO foreign key into players, clubs, matches, awards or award_winners.
-- Those tables are rebuilt by TRUNCATE ... CASCADE and renumbered by a promotion,
-- so an FK into them would either empty this ledger on a rebuild or make it
-- lineage-bound (the migration 111 reason, restated). The only foreign keys are
-- published_by -> auth_users(id) and the intra-table supersession chain. The
-- durable identity of a winner is the AFL Tables profile path inside
-- winners[].key ('coleman:<season>:<profile path>'). NOTE: result.inputs and the
-- leaderboard also embed database player/club/match ids, which a rebuild
-- renumbers; they are a snapshot of the database that produced them, not a
-- durable reference.
--
-- Grants (hand-written, NOT afldb_meta.grant_app_read / grant_import_write)
-- ------------------------------------------------------------------------
--   afldb_import   SELECT, INSERT + USAGE on the identity sequence
--   afldb_auth     SELECT (the admin history view)
--   afldb_app      nothing (an unpublished-then-published derivation is not yet a
--                  public surface; the public site reads award_winners)
-- The table is deliberately NOT registered in afldb_meta.import_writable_tables:
-- that registry's reconcile loop hands out UPDATE, DELETE and TRUNCATE, which would
-- destroy the append-only property (the migration-066 / 104 / 111 reason).
--
-- Deployment order (the AFLDB-ISSUE-027 / 097 lesson): apply this migration, THEN
-- run `npm run db:privileges` (it re-grants the import and auth blocks added to
-- tools/maintenance/privileges.sql, whose revoke loop strips them on every
-- reconcile), THEN deploy the code that writes this table. The other order only
-- ever fails closed (no write), never writes wrongly.
--
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   DROP TABLE IF EXISTS derived_award_results;
-- ROLLBACK:   Dropping the table drops its identity sequence, indexes, constraints and grants.
-- ROLLBACK:   Then remove the derived_award_results blocks from tools/maintenance/privileges.sql
-- ROLLBACK:   (the afldb_import block and the afldb_auth spec row), the table name from the
-- ROLLBACK:   NOT IN list in tests/integration/privileges.test.ts, the inventory entry in
-- ROLLBACK:   tools/db/promotion-inventory.ts, and restore the two count pins in
-- ROLLBACK:   tests/db-promotion-check.test.ts and the list in tests/reference-data.test.ts.
-- ROLLBACK:   Rolling back DISCARDS every published derivation and its audit record: export
-- ROLLBACK:   them first (COPY derived_award_results TO a file). award_winners is NOT affected.
-- =====================================================================

CREATE TABLE derived_award_results (
  id                  bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- The target, by natural identity (see the header).
  award_slug          text         NOT NULL,
  season              integer      NOT NULL,

  -- What produced the result.
  method_version      integer      NOT NULL,
  derivation_version  text         NOT NULL,
  input_checksum      text         NOT NULL,

  -- The result itself.
  result              jsonb        NOT NULL,
  winners             jsonb        NOT NULL,
  derived_at          timestamptz  NOT NULL,

  -- The publication.
  published_at        timestamptz  NOT NULL DEFAULT now(),
  published_by        integer      NOT NULL REFERENCES auth_users(id),
  basis               text         NOT NULL,
  -- The season seal's audit record (evaluateSeasonWrite(...).audit).
  correction          jsonb        NOT NULL,

  -- The row this one replaces; NULL for the first publication of a season.
  supersedes_id       bigint,

  -- Target of the composite supersession foreign key below.
  CONSTRAINT derived_award_results_target_uq
    UNIQUE (id, award_slug, season),
  -- The predecessor must belong to the same (award_slug, season). With
  -- supersedes_id NULL the foreign key is not checked (MATCH SIMPLE).
  CONSTRAINT derived_award_results_supersedes_fk
    FOREIGN KEY (supersedes_id, award_slug, season)
    REFERENCES derived_award_results (id, award_slug, season),
  CONSTRAINT derived_award_results_supersedes_ck
    CHECK (supersedes_id IS NULL OR supersedes_id < id),
  -- 'coleman' is the only derived award today. Adding another is a new migration
  -- that replaces this CHECK, never an edit of this file.
  CONSTRAINT derived_award_results_award_slug_ck
    CHECK (award_slug = 'coleman'),
  CONSTRAINT derived_award_results_season_ck
    CHECK (season BETWEEN 1897 AND 2100),
  CONSTRAINT derived_award_results_method_version_ck
    CHECK (method_version >= 1),
  CONSTRAINT derived_award_results_derivation_version_ck
    CHECK (length(btrim(derivation_version)) BETWEEN 1 AND 100),
  CONSTRAINT derived_award_results_input_checksum_ck
    CHECK (input_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT derived_award_results_result_ck
    CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT derived_award_results_winners_ck
    CHECK (jsonb_typeof(winners) = 'array'),
  -- Self-consistency: the scalar columns and the winners column must agree with
  -- the result they summarise. coalesce(..., false): a CHECK PASSES on NULL, so a
  -- missing key in result must FAIL, not pass.
  CONSTRAINT derived_award_results_self_consistent_ck
    CHECK (coalesce(
      winners = result -> 'winners'
      AND result ->> 'inputChecksum' = input_checksum
      AND result ->> 'derivationVersion' = derivation_version
      AND result ->> 'season' = season::text
      AND result ->> 'methodVersion' = method_version::text,
      false)),
  CONSTRAINT derived_award_results_basis_ck
    CHECK (basis = 'audited_correction'),
  -- The audit record must be the seal's, for THIS workflow, season and actor, with
  -- the note and evidence the seal requires.
  CONSTRAINT derived_award_results_correction_ck
    CHECK (jsonb_typeof(correction) = 'object'
           AND coalesce(
             correction ->> 'workflow' = 'derived_award_publication'
             AND correction ->> 'actorUserId' = published_by::text
             AND correction ->> 'season' = season::text
             AND length(btrim(correction ->> 'note')) BETWEEN 20 AND 2000
             AND length(btrim(correction ->> 'evidenceRef')) >= 1,
             false))
);

COMMENT ON TABLE derived_award_results IS
  'AFLDB V2 derived awards (migration 112): append-only ledger of published derivations (today only the Coleman Medal). Each row is the full derivation result, its method and code versions, input checksum and the season seal audit record. A recompute after an authorised correction is a NEW row with supersedes_id naming its predecessor; the current row of an (award_slug, season) is the one no other row supersedes. No role gets UPDATE, DELETE or TRUNCATE. Names nothing by id outside auth_users and itself; result.inputs embeds database ids that a rebuild renumbers, the durable identity is winners[].key. NOT award_winners.';
COMMENT ON COLUMN derived_award_results.result IS
  'The full serialiseColemanDerivation() output. result.inputs and the leaderboard embed database ids (a snapshot); the durable winner identity is the profile path in winners[].key.';
COMMENT ON COLUMN derived_award_results.supersedes_id IS
  'The earlier publication this one replaces, always for the same (award_slug, season). NULL for the first publication. At most one row names any given predecessor.';
COMMENT ON COLUMN derived_award_results.correction IS
  'evaluateSeasonWrite(...).audit from packages/domain/src/season-seal.ts: season, workflow (derived_award_publication), actorUserId (= published_by), note and evidenceRef.';

-- Exactly one first publication per (award_slug, season).
CREATE UNIQUE INDEX uq_derived_award_results_root
  ON derived_award_results (award_slug, season)
  WHERE supersedes_id IS NULL;
-- A publication has at most one successor, so the chain is linear. Also the
-- supporting index for the supersedes_id foreign key.
CREATE UNIQUE INDEX uq_derived_award_results_supersedes
  ON derived_award_results (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX ix_derived_award_results_target
  ON derived_award_results (award_slug, season, id);
CREATE INDEX ix_derived_award_results_published_by
  ON derived_award_results (published_by);

-- ---------------------------------------------------------------------
-- Grants. Guarded on the roles so a database built before they exist still
-- applies; tools/maintenance/privileges.sql mirrors them (its afldb_import
-- revoke loop strips them on every reconcile, and its afldb_auth section is
-- subtractive).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT ON derived_award_results TO afldb_import;
    GRANT USAGE ON SEQUENCE derived_award_results_id_seq TO afldb_import;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- SELECT only: afldb_auth never writes this table. Every write runs as
    -- afldb_import, inside the publisher's single transaction.
    GRANT SELECT ON derived_award_results TO afldb_auth;
  END IF;
END
$$;
