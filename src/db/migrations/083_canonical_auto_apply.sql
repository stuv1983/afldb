-- =====================================================================
-- AFLDB 083 — Canonical auto-apply: provenance completion and the
--             canonical_applications ledger
-- =====================================================================
-- AFLDB-ISSUE-122 stage S1, implementing runbook §12.2 exactly
-- (issues/open/AFLDB-ISSUE-122.md). Schema only: no data is touched, no
-- writer exists yet (S5), nothing here changes settle, reconciliation or
-- the Squiggle/Kali path.
--
-- WHY
--
-- AFLDB-ISSUE-099 built the whole AFL Tables acquisition pipeline and
-- deliberately stopped at zero canonical writes. ISSUE-122 adds the write.
-- Before a machine may write canonical rows unattended, two schema facts
-- have to hold that do not hold today:
--
--   1. Every target must be ownership-determinate. match_period_scores
--      and brownlow_round_votes carry no provenance at all, so the settle
--      job cannot tell its own rows from anyone else's and fails closed
--      on both (TARGETS_WITHOUT_SOURCE_ID, settle-afltables.ts). That is
--      ISSUE-099 A1/A2, plus A3: player_match_stats has source_id and
--      import_batch_id (004) but never received source_record_id.
--
--   2. Every automatic canonical mutation must leave an append-only,
--      source-version-bound audit row. promotion_decisions (074) is the
--      HUMAN decision ledger and stays that way; the machine gets its own,
--      canonical_applications, written inside the same savepoint as the
--      canonical row it describes (runbook §13).
--
-- Migrations 073-076 are applied and checksum-frozen; nothing here edits
-- them. promotion_candidates, promotion_decisions, data_overrides and
-- data_edits are unchanged in both shape and grant.

-- ---------------------------------------------------------------------
-- 1. Provenance completion (ISSUE-099 A1 / A2 / A3)
-- ---------------------------------------------------------------------
-- The 001 helper adds the standard quartet: source_id REFERENCES sources,
-- source_record_id, import_batch_id REFERENCES import_batches, and
-- imported_at NOT NULL DEFAULT now(). Existing rows receive NULL
-- provenance and imported_at = this migration's transaction time, which is
-- the same reading every other table given the quartet after its data
-- already existed carries: "provenance unknown, present since at least
-- this moment". Ownership logic treats NULL source_id as unowned, never
-- as afltables-owned.
SELECT add_provenance_columns('match_period_scores');
SELECT add_provenance_columns('brownlow_round_votes');

-- player_match_stats already has source_id and import_batch_id (004:68-69),
-- so the helper cannot be used there; add the one missing column only.
ALTER TABLE player_match_stats ADD COLUMN source_record_id text;

COMMENT ON COLUMN player_match_stats.source_record_id IS
  'Provenance (migration 083, AFLDB-ISSUE-122): the external record id at the source '
  'named by source_id, completing the quartet that 004 left at source_id + import_batch_id.';

-- The two new import_batch_id / source_id foreign keys are DELIBERATELY
-- unindexed, on migration 044 section 6(b)'s standing rule for the
-- provenance quartet: import_batches and sources are append-only, nothing
-- deletes a parent, and no read path filters these tables by batch.
-- tests/integration/fk-indexes.test.ts exempts both parents for exactly
-- that reason.
COMMENT ON COLUMN match_period_scores.import_batch_id IS
  'Provenance (migration 083). Deliberately unindexed -- see migration 044 §6(b).';
COMMENT ON COLUMN brownlow_round_votes.import_batch_id IS
  'Provenance (migration 083). Deliberately unindexed -- see migration 044 §6(b).';

-- ---------------------------------------------------------------------
-- 2. canonical_applications — the append-only machine mutation ledger
-- ---------------------------------------------------------------------
-- One row per canonical INSERT or UPDATE the automatic path performs.
-- It records WHAT changed (the proposed field set, before and after),
-- WHICH evidence justified it (the exact staging source-record version),
-- and WHICH run did it (the import batch). It never records the source
-- payload itself: staging.source_payloads already keeps that immutably,
-- and repeating it here would only bloat the ledger.
CREATE TABLE canonical_applications (
  id                  bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- The run.
  import_batch_id     bigint      NOT NULL REFERENCES import_batches(id),
  -- The evidence: exactly one staging.source_record_versions row.
  source_id           smallint    NOT NULL REFERENCES sources(id),
  -- The contract family (source-families.json), not the dotted wire name.
  family              text        NOT NULL,
  external_record_id  text        NOT NULL,
  source_version_seq  integer     NOT NULL,
  -- The canonical target and its stable natural key, e.g.
  -- {"match_key": ...} or {"player_id": ..., "match_id": ...}.
  target_table        text        NOT NULL,
  target_key          jsonb       NOT NULL,
  verb                text        NOT NULL,
  -- The proposed field set for that target only, before and after.
  -- previous_values is NULL exactly when the row was inserted.
  previous_values     jsonb,
  new_values          jsonb       NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now(),

  -- Source-version binding. staging.source_record_versions declares
  -- PRIMARY KEY (source_id, family, external_record_id, version_seq)
  -- (074:79), the same key promotion_candidates already references
  -- (074:178-179). The partial ux_source_record_versions_open index is
  -- deliberately NOT the target: the ledger must be able to point at a
  -- version that has since been closed.
  FOREIGN KEY (source_id, family, external_record_id, source_version_seq)
    REFERENCES staging.source_record_versions (source_id, family, external_record_id, version_seq),

  -- The four ISSUE-122 canonical targets (MATCH_TARGET_TABLES +
  -- PLAYER_MATCH_TARGET_TABLES in settle-afltables.ts) and nothing else.
  CONSTRAINT canonical_applications_target_table_ck CHECK (target_table IN (
    'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes'
  )),
  CONSTRAINT canonical_applications_verb_ck CHECK (verb IN ('insert', 'update')),
  -- previous_values IS NULL  iff  verb = 'insert'.
  CONSTRAINT canonical_applications_previous_ck CHECK (
    (previous_values IS NULL) = (verb = 'insert')
  ),
  CONSTRAINT canonical_applications_target_key_ck CHECK (jsonb_typeof(target_key) = 'object'),
  -- Value-size policy (runbook §12.2(c)): each value set is a JSON object
  -- of at most 64 top-level keys. jsonb_path_query_array(..., '$.keyvalue()')
  -- yields one element per top-level key without a subquery or a
  -- set-returning function, neither of which a CHECK may contain. The
  -- CASE guarantees the type test runs first, so a non-object is a plain
  -- constraint violation rather than a jsonpath error.
  CONSTRAINT canonical_applications_new_values_ck CHECK (
    CASE WHEN jsonb_typeof(new_values) = 'object'
         THEN jsonb_array_length(jsonb_path_query_array(new_values, '$.keyvalue()')) <= 64
         ELSE false END
  ),
  CONSTRAINT canonical_applications_previous_values_ck CHECK (
    previous_values IS NULL
    OR CASE WHEN jsonb_typeof(previous_values) = 'object'
            THEN jsonb_array_length(jsonb_path_query_array(previous_values, '$.keyvalue()')) <= 64
            ELSE false END
  )
);

COMMENT ON TABLE canonical_applications IS
  'Append-only ledger of every canonical row the automatic AFL Tables settle path inserted '
  'or updated (AFLDB-ISSUE-122, migration 083). One row per mutation, written inside the '
  'same savepoint as the mutation, bound to the exact staging source-record version that '
  'justified it. Machine decisions only: human review decisions live in promotion_decisions.';
COMMENT ON COLUMN canonical_applications.family IS
  'Contract family from data/reference/source-families.json, never the dotted wire name.';
COMMENT ON COLUMN canonical_applications.target_key IS
  'The target row''s stable natural key as a JSON object, e.g. {"match_key": ...} or '
  '{"player_id": ..., "match_id": ...}. Never a surrogate id alone.';
COMMENT ON COLUMN canonical_applications.previous_values IS
  'The target''s prior values for the proposed field set. NULL exactly when verb = ''insert''.';
COMMENT ON COLUMN canonical_applications.new_values IS
  'The proposed field set as written, serialised through canonicalJson() so key order is '
  'deterministic. At most 64 keys; never the source payload (staging.source_payloads has it).';

-- Indexes. Every index names its caller (migration 041's rule).
--
-- Covers the composite foreign key above; without it a delete on
-- staging.source_record_versions would scan this table, and
-- tests/integration/fk-indexes.test.ts fails.
CREATE INDEX ix_canonical_applications_source_version
  ON canonical_applications (source_id, family, external_record_id, source_version_seq);
-- Audit queries: "what did the machine write to <table> most recently".
CREATE INDEX ix_canonical_applications_target_applied
  ON canonical_applications (target_table, applied_at DESC);
-- Per-run reads: the exception report and counter reconciliation (S6)
-- read a run's ledger rows by batch. This is the one provenance-shaped
-- foreign key that IS indexed, because unlike the fact tables this ledger
-- is read by batch by design; 044 §6(b)'s rule is about the quartet on
-- fact tables and is unchanged.
CREATE INDEX ix_canonical_applications_batch
  ON canonical_applications (import_batch_id);

-- ---------------------------------------------------------------------
-- 3. Grants — append-only BY GRANT
-- ---------------------------------------------------------------------
-- Mirrors promotion_decisions (074:320-338) and data_edits (057/066):
-- explicit grants, not afldb_meta.grant_import_write(), which hands out
-- SELECT, INSERT, UPDATE, DELETE and TRUNCATE (045:139-141) and would be
-- regenerated at every privileges.sql reconcile. The table is therefore
-- NOT registered in afldb_meta.import_writable_tables, and
-- tools/maintenance/privileges.sql re-grants exactly this shape after its
-- subtractive sweep (its afldb_import "table-level exceptions" block and
-- its afldb_auth spec array).
--
--   afldb_import  SELECT, INSERT on the table; USAGE on its identity
--                 sequence, which is all an INSERT needs (RETURNING id,
--                 never currval). No UPDATE, DELETE or TRUNCATE.
--   afldb_auth    SELECT only -- the admin surface may read the ledger,
--                 never write it.
--   afldb_app     nothing: this is not a public read surface, so it is
--                 not registered with afldb_meta.grant_app_read() either.
GRANT SELECT, INSERT ON canonical_applications TO afldb_import;
GRANT USAGE ON SEQUENCE canonical_applications_id_seq TO afldb_import;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT SELECT ON canonical_applications TO afldb_auth;
  END IF;
END
$$;
