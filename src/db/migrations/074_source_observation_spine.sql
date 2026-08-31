-- ---------------------------------------------------------------------
-- 074 — AFLDB-ISSUE-096 S2: the source observation spine and the
--       reviewed-promotion ledger
-- ---------------------------------------------------------------------
-- The generic foundation every 2026+ acquisition family inherits. It
-- stores what a source said and when, and it queues what a human might
-- promote from that. It promotes nothing itself.
--
-- Three observation grains, because one table cannot hold both
-- invariants at once:
--
--   I1 idempotence      — polling unchanged upstream state must create
--                         no history at all.
--   I2 correction history — a genuine A -> B -> A must stay THREE ordered
--                         states, not two.
--
-- A single table keyed (source, family, record, payload_hash) satisfies
-- I1 and destroys I2: the second A collides with the first and decays
-- into a timestamp touch, so the transition disappears. Hence immutable
-- CONTENT (source_payloads) is separated from ordered STATE
-- (source_record_versions) from current-key state (source_records).
-- Version identity is version_seq, never the hash.
--
-- NOTHING HERE WRITES CANONICAL DATA. There is no trigger, no rule and
-- no default that touches a canonical table: promotion is a reviewed,
-- super-admin action and its transaction belongs to a later stage. The
-- CHECK constraints below make an accepted refusal verb unrepresentable
-- rather than merely discouraged.
-- ---------------------------------------------------------------------

-- =====================================================================
-- A1 — immutable, content-addressed payloads
-- =====================================================================
-- Deduplicated by content, so A -> B -> A stores TWO payload rows for
-- THREE states. hash_recipe records how the hash was computed (algorithm
-- plus the family's declared exclusion list). It is stored, not assumed,
-- so a later change to that list — moving Kali's `sourcedAt` to the
-- exclusions, say — is a reference-data edit that the comparison layer
-- absorbs by recomputing from raw_payload. No backfill, no migration,
-- and no spurious version row.
CREATE TABLE staging.source_payloads (
  source_id        smallint    NOT NULL REFERENCES sources(id),
  family           text        NOT NULL,
  payload_hash     char(64)    NOT NULL,
  hash_recipe      text        NOT NULL,
  raw_payload      jsonb       NOT NULL,
  first_stored_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, family, payload_hash),
  CONSTRAINT source_payloads_hash_ck  CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT source_payloads_recipe_ck CHECK (length(hash_recipe) BETWEEN 1 AND 200)
);

COMMENT ON TABLE staging.source_payloads IS
  'Immutable deduplicated source content, addressed by hash. Never updated: identical content is stored once and referenced by every version that observed it.';
COMMENT ON COLUMN staging.source_payloads.hash_recipe IS
  'Algorithm plus the family hash-exclusion list that produced payload_hash. Stored so the exclusion list can change later without invalidating history or forcing a backfill.';

-- =====================================================================
-- A2 — the ordered history grain
-- =====================================================================
-- DELIBERATELY NOT UNIQUE on (source_id, family, external_record_id,
-- payload_hash). That constraint is the one thing that would break I2:
-- it would reject the second A of an A -> B -> A correction. Version
-- identity is version_seq. Do not add it.
CREATE TABLE staging.source_record_versions (
  source_id           smallint    NOT NULL,
  family              text        NOT NULL,
  external_record_id  text        NOT NULL,
  version_seq         integer     NOT NULL,
  payload_hash        char(64)    NOT NULL,
  -- Only a genuine upstream mutation timestamp. NULL when the source
  -- publishes none. Never fetch time, observed_from, last_seen_at,
  -- data_accessed or a scheduled match start time.
  source_updated_at   timestamptz,
  observed_from       timestamptz NOT NULL,
  observed_to         timestamptz,
  opened_by_batch_id  bigint      NOT NULL REFERENCES import_batches(id),
  closed_by_batch_id  bigint      REFERENCES import_batches(id),
  PRIMARY KEY (source_id, family, external_record_id, version_seq),
  FOREIGN KEY (source_id, family, payload_hash)
    REFERENCES staging.source_payloads (source_id, family, payload_hash),
  CONSTRAINT source_record_versions_seq_ck      CHECK (version_seq >= 1),
  CONSTRAINT source_record_versions_interval_ck CHECK (observed_to IS NULL OR observed_to > observed_from),
  -- A closed version names the batch that closed it; an open one cannot.
  CONSTRAINT source_record_versions_close_ck    CHECK ((observed_to IS NULL) = (closed_by_batch_id IS NULL))
);

-- Exactly one open version per external record: the interval chain has
-- no gaps and no overlaps.
CREATE UNIQUE INDEX ux_source_record_versions_open
  ON staging.source_record_versions (source_id, family, external_record_id)
  WHERE observed_to IS NULL;

CREATE INDEX ix_source_record_versions_payload
  ON staging.source_record_versions (source_id, family, payload_hash);

COMMENT ON TABLE staging.source_record_versions IS
  'Ordered immutable history: one row per DISTINCT consecutive state of an external record, with a valid-time interval. A -> B -> A is version_seq 1/2/3 over two payload rows. Never deduplicated on payload_hash.';
COMMENT ON COLUMN staging.source_record_versions.source_updated_at IS
  'Genuine upstream mutation timestamp only (Squiggle games.updated, Kali matches.sourcedAt). NULL where the source publishes none. The payload hash, not this column, is the change oracle.';

-- =====================================================================
-- A3 — current-key state
-- =====================================================================
-- absent_since lives HERE and only here. Absence is a property of the
-- external key — the source stopped offering the record — not of any one
-- historical payload. Putting it on a version would assert that a
-- specific past payload disappeared, which is not what was observed.
--
-- scope_key records the enumeration the record was last seen in (e.g.
-- 'season=2026'), so an absence sweep can only ever assert absence
-- INSIDE a scope the fetch actually enumerated.
CREATE TABLE staging.source_records (
  source_id            smallint    NOT NULL,
  family               text        NOT NULL,
  external_record_id   text        NOT NULL,
  scope_key            text        NOT NULL,
  current_version_seq  integer     NOT NULL,
  current_payload_hash char(64)    NOT NULL,
  first_seen_at        timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  last_batch_id        bigint      NOT NULL REFERENCES import_batches(id),
  absent_since         timestamptz,
  PRIMARY KEY (source_id, family, external_record_id),
  FOREIGN KEY (source_id, family, external_record_id, current_version_seq)
    REFERENCES staging.source_record_versions (source_id, family, external_record_id, version_seq),
  CONSTRAINT source_records_seen_ck   CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT source_records_absent_ck CHECK (absent_since IS NULL OR absent_since >= first_seen_at)
);

-- The absence sweep: records in one enumerated scope not seen by this
-- batch. Also the reappearance path, which clears absent_since.
CREATE INDEX ix_source_records_sweep
  ON staging.source_records (source_id, family, scope_key, last_seen_at);
CREATE INDEX ix_source_records_absent
  ON staging.source_records (source_id, family)
  WHERE absent_since IS NOT NULL;

COMMENT ON TABLE staging.source_records IS
  'Current state of one external record: which version is open, when it was first and last seen, and whether the source has stopped offering it. An unchanged poll touches this row only.';
COMMENT ON COLUMN staging.source_records.absent_since IS
  'The source stopped offering this key inside its enumerated scope. NEVER a canonical deletion and never a source-driven DELETE: history is retained and a reappearance clears this column.';
COMMENT ON COLUMN staging.source_records.scope_key IS
  'The enumeration scope the record was last observed in. An absence sweep may only assert absence within a scope the fetch actually enumerated.';

-- =====================================================================
-- Reviewed promotion: candidates
-- =====================================================================
-- A candidate is a PROPOSAL. It carries the exact source version it was
-- derived from, so two providers that happen to project identical values
-- can never collapse into one piece of evidence, and so a candidate can
-- be re-checked against the source at accept time.
CREATE TABLE promotion_candidates (
  id                    bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id             smallint    NOT NULL REFERENCES sources(id),
  family                text        NOT NULL,
  external_record_id    text        NOT NULL,
  source_version_seq    integer     NOT NULL,
  -- The reconciliation vocabulary. 'unchanged' is absent by design: it
  -- produces no diff and therefore no candidate.
  verb                  text        NOT NULL,
  season                smallint    NOT NULL REFERENCES seasons(year),
  target_table          text        NOT NULL,
  target_id             bigint,
  proposed_fields       jsonb       NOT NULL,
  -- Hash of the target row's CURRENT values for exactly the fields this
  -- promotion would write, captured when the review screen rendered.
  baseline_canonical_hash char(64),
  -- Independence GROUPS, not source rows. Two providers in one group are
  -- one witness.
  agreeing_groups       text[]      NOT NULL DEFAULT '{}',
  disagreeing_groups    text[]      NOT NULL DEFAULT '{}',
  status                text        NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_batch_id   bigint      NOT NULL REFERENCES import_batches(id),
  resolved_at           timestamptz,
  resolved_decision_id  bigint,
  FOREIGN KEY (source_id, family, external_record_id, source_version_seq)
    REFERENCES staging.source_record_versions (source_id, family, external_record_id, version_seq),
  CONSTRAINT promotion_candidates_verb_ck CHECK (verb IN (
    'new', 'corrected', 'rescheduled', 'absent', 'unresolved_identity',
    'source_disagreement', 'foreign_owned_collision', 'manual_authority_conflict',
    'stale_review'
  )),
  CONSTRAINT promotion_candidates_status_ck CHECK (status IN (
    'pending', 'accepted', 'rejected', 'superseded'
  )),
  -- A 'new' row has no target yet, so it has no baseline to go stale.
  -- Anything else must carry both or neither.
  CONSTRAINT promotion_candidates_target_ck CHECK (
    (verb = 'new'  AND target_id IS NULL AND baseline_canonical_hash IS NULL)
    OR (verb <> 'new' AND (target_id IS NULL) = (baseline_canonical_hash IS NULL))
  ),
  -- Absence proposes nothing: it is a review signal, never a write.
  CONSTRAINT promotion_candidates_absent_ck CHECK (
    verb <> 'absent' OR (target_id IS NULL AND proposed_fields = '{}'::jsonb)
  ),
  -- FAIL CLOSED IN THE SCHEMA: only the three verbs that actually propose
  -- a canonical write may ever reach 'accepted'. A refusal verb reaching
  -- 'accepted' is unrepresentable, not merely discouraged.
  CONSTRAINT promotion_candidates_acceptable_ck CHECK (
    status <> 'accepted' OR verb IN ('new', 'corrected', 'rescheduled')
  ),
  CONSTRAINT promotion_candidates_resolution_ck CHECK (
    (status = 'pending') = (resolved_at IS NULL)
  ),
  CONSTRAINT promotion_candidates_decision_ck CHECK (
    (status = 'pending') = (resolved_decision_id IS NULL)
  )
);

-- One live proposal per external record and target table: a re-run
-- refreshes the pending candidate instead of stacking duplicates.
CREATE UNIQUE INDEX ux_promotion_candidates_pending
  ON promotion_candidates (source_id, family, external_record_id, target_table)
  WHERE status = 'pending';

CREATE INDEX ix_promotion_candidates_queue
  ON promotion_candidates (created_at)
  WHERE status = 'pending';

CREATE INDEX ix_promotion_candidates_target
  ON promotion_candidates (target_table, target_id);

-- The composite foreign key back to the observation this proposal was
-- derived from. ux_promotion_candidates_pending does NOT cover it: its
-- fourth column is target_table rather than source_version_seq, and its
-- `WHERE status = 'pending'` predicate is not one a referential probe
-- implies. Without this, deleting a source version scans the queue.
CREATE INDEX ix_promotion_candidates_evidence
  ON promotion_candidates (source_id, family, external_record_id, source_version_seq);

-- resolved_decision_id, whose foreign key is added at the foot of this
-- migration once promotion_decisions exists. Partial on the 041 shape --
-- `WHERE col IS NOT NULL`, the only predicate the parent-side probe
-- implies -- because a pending candidate has no decision and pending is
-- the common state.
CREATE INDEX ix_promotion_candidates_decision
  ON promotion_candidates (resolved_decision_id)
  WHERE resolved_decision_id IS NOT NULL;

COMMENT ON TABLE promotion_candidates IS
  'Proposed canonical changes awaiting super-admin review. Creating one NEVER changes canonical data. Only new/corrected/rescheduled may ever be accepted; every refusal verb is barred from acceptance by CHECK.';
COMMENT ON COLUMN promotion_candidates.source_version_seq IS
  'The exact observation version this proposal was derived from. Retained so provider evidence cannot be conflated and so acceptance can detect that the source moved on.';
COMMENT ON COLUMN promotion_candidates.baseline_canonical_hash IS
  'Hash of the target row''s current values for exactly the fields this promotion would write, captured at render. Re-checked inside the accept transaction; a change is stale_review.';

-- =====================================================================
-- Reviewed promotion: decisions
-- =====================================================================
-- Append-only by grant, on the player_link_resolutions (056) and
-- data_edits (057) pattern: a wrong decision gets a correcting decision,
-- never a rewrite of this log.
CREATE TABLE promotion_decisions (
  id              bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  candidate_id    bigint      NOT NULL REFERENCES promotion_candidates(id),
  decision        text        NOT NULL,
  -- Why a promotion was refused or requeued. The manual-authority values
  -- are the ISSUE-086 boundary: this pipeline records that authority
  -- refused, and stores no override of its own.
  refusal_reason  text,
  admin_user_id   integer     NOT NULL REFERENCES auth_users(id),
  previous_values jsonb,
  new_values      jsonb,
  note            text        CHECK (note IS NULL OR length(note) <= 2000),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotion_decisions_decision_ck CHECK (decision IN ('accept', 'reject', 'requeue')),
  CONSTRAINT promotion_decisions_reason_ck CHECK (refusal_reason IS NULL OR refusal_reason IN (
    'stale_review', 'stale_canonical_target', 'manual_authority_conflict',
    'manual_authority_indeterminate', 'foreign_owned_collision',
    'season_not_in_progress', 'unresolved_identity', 'source_disagreement'
  )),
  CONSTRAINT promotion_decisions_accept_ck  CHECK (
    decision <> 'accept' OR (refusal_reason IS NULL AND new_values IS NOT NULL)
  ),
  CONSTRAINT promotion_decisions_requeue_ck CHECK (
    decision <> 'requeue' OR refusal_reason IS NOT NULL
  )
);

CREATE INDEX ix_promotion_decisions_candidate ON promotion_decisions (candidate_id);

-- The auth_users reference, indexed on the same terms as the nine
-- operational-bookkeeping indexes in migration 041: no read path filters
-- on it, but deleting an administrator scans this ledger without it. The
-- column is NOT NULL, so the index is plain rather than partial.
CREATE INDEX ix_promotion_decisions_admin
  ON promotion_decisions (admin_user_id);

COMMENT ON TABLE promotion_decisions IS
  'One append-only row per super-admin promotion decision. Append-only by grant: no UPDATE, no DELETE. A wrong decision is corrected by a later decision, never by rewriting this log.';

ALTER TABLE promotion_candidates
  ADD CONSTRAINT promotion_candidates_decision_fk
  FOREIGN KEY (resolved_decision_id) REFERENCES promotion_decisions(id);

-- =====================================================================
-- Grants
-- =====================================================================
-- Staging: privileges.sql grants the staging schema wholesale, so these
-- are the pre-reconcile catch-up, exactly as migration 063 does.
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.source_payloads        TO afldb_import;
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.source_record_versions TO afldb_import;
GRANT SELECT, INSERT, UPDATE, DELETE ON staging.source_records         TO afldb_import;
GRANT SELECT ON staging.source_payloads        TO afldb_app;
GRANT SELECT ON staging.source_record_versions TO afldb_app;
GRANT SELECT ON staging.source_records         TO afldb_app;

-- Public: app read is fail-closed since 039, so both tables are
-- registered readable — the review screen reads through the ordinary app
-- role, as every admin query module does.
SELECT afldb_meta.grant_app_read('promotion_candidates');
SELECT afldb_meta.grant_app_read('promotion_decisions');

-- The acquisition/diff job creates candidates, and the promotion
-- transaction resolves them, both as afldb_import (045 registry).
SELECT afldb_meta.grant_import_write('promotion_candidates');

-- promotion_decisions is DELIBERATELY NOT registered import-writable.
-- grant_import_write() hands out UPDATE, DELETE and TRUNCATE, and
-- privileges.sql regenerates the whole set from that registry — so a
-- REVOKE here would be silently undone at the next reconcile and the
-- ledger would stop being append-only without anyone touching it.
-- Instead the ledger follows data_edits (057) exactly: written by
-- afldb_auth with SELECT, INSERT and nothing else, listed in
-- privileges.sql's afldb_auth spec so the reconciler keeps it that way.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- Append-only by grant: no UPDATE, no DELETE.
    GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth;
    GRANT USAGE, SELECT ON SEQUENCE promotion_decisions_id_seq TO afldb_auth;
    -- Candidate content is immutable to the reviewer; only the workflow
    -- columns move, on migration 056's column-scoped pattern.
    GRANT SELECT ON promotion_candidates TO afldb_auth;
    GRANT UPDATE (status, resolved_at, resolved_decision_id)
      ON promotion_candidates TO afldb_auth;
  END IF;
END
$$;
