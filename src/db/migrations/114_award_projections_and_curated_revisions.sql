-- =====================================================================
-- 114 - Award projection provenance ledger + curated approved-revision support
-- =====================================================================
-- AFLDB V2 Launch F (stream F-D; follows migrations 111 and 112).
-- Forward-only. Additive. Writes NO data and never rewrites an existing row.
--
-- Two independent sections, one migration so that the Launch F awards work lands as one
-- deployable unit.
--
-- Section 1 - derived_award_projections
-- -------------------------------------
-- Migration 112's derived_award_results records a PUBLISHED derivation (today the Coleman
-- Medal). It deliberately does not write award_winners: projecting a published result into the
-- canonical award_winners table is a separate, audited act. This table is the append-only
-- PROVENANCE record of that act: which published derivation was projected, by whom, when, and
-- exactly which award_winners rows it inserted, updated, voided or retained.
--   * It is NOT a winner store. It holds KEYS and ACTIONS only (actions[] elements are
--     {entityKey, action, awardWinnerId} with action in inserted|updated|voided|retained);
--     the winners themselves live in award_winners with their own data_overrides and
--     data_edits rows, exactly as for a curated approval (migration 111).
--   * actions[].entityKey is the durable data_overrides entity key; awardWinnerId is the
--     award_winners.id at projection time, a SNAPSHOT a rebuild renumbers (the same caveat as
--     derived_award_results.result.inputs). The durable identity is entityKey.
--   * The only foreign keys are the composite (derived_award_result_id, award_slug, season) ->
--     derived_award_results (id, award_slug, season) - it uses 112's
--     derived_award_results_target_uq, so a projection can only name a derivation of the same
--     award and season - and projected_by -> auth_users(id). There is no FK into awards,
--     players, clubs or award_winners (the migration 111 / 112 reason).
--   * Projecting is an audited correction through the season seal (workflow
--     'derived_award_publication', the same workflow as the publication it projects), so
--     correction is NOT NULL and is checked against the actor, season and note rules.
--   * jsonb_array_length(actions) = changed_count + retained_count ties the counts to the
--     detail; changed_count counts inserted|updated|voided, retained_count counts retained.
--
-- Append-only: no role is ever granted UPDATE, DELETE or TRUNCATE. A re-projection after a
-- superseding publication is simply another row. There is deliberately no supersession chain
-- here: the ledger is a history of acts, not a current-state table.
--
-- Grants (hand-written, NOT afldb_meta.grant_app_read / grant_import_write)
--   afldb_import   SELECT, INSERT + USAGE on the identity sequence
--   afldb_auth     SELECT (the admin history view)
--   afldb_app      nothing
-- Not registered in afldb_meta.import_writable_tables (its reconcile loop hands out UPDATE,
-- DELETE and TRUNCATE and would destroy the append-only property).
--
-- Section 2 - curated-award approved-revision support (V2-GAP-018)
-- ----------------------------------------------------------------
-- Migration 111's workflow can never correct an APPROVED proposal: the state machine has no
-- transition out of 'approved', and award_proposals_approval_ck forbids an approval key on any
-- other status. Correcting an approved award winner needs (a) a way to retire the approved
-- revision to 'superseded' while KEEPING its approval record, and (b) a way to record the
-- replacement revision. This section widens three constraints by DROP CONSTRAINT / ADD
-- CONSTRAINT superset replacements (the migration 094 data_edits_table_name_check precedent;
-- ADR 0004): no row is rewritten and nothing that is accepted today is rejected afterwards.
--   * award_proposal_decisions_action_ck       + 'supersede_approved', 'revise_approved'
--   * award_proposal_decisions_transition_ck   every existing branch verbatim, plus
--       supersede_approved  approved -> superseded   (from_status IS NOT NULL)
--       revise_approved     (no status) -> approved  (from_status IS NULL)
--   * award_proposals_approval_ck              a SUPERSEDED former approval may keep its
--       approved_entity_key and approved_at (both or neither); the key is allowed only on
--       approved or superseded; every other status still carries neither.
-- Constraint re-validation scans the existing rows once (the tables are small, human-entered
-- workflow state). The TypeScript state machine, CURATED_AWARD_TRANSITIONS in
-- packages/admin/src/curated-awards-model.ts, is updated by a LATER stream to match the widened
-- ledger CHECK; until then the ledger accepts two actions the TypeScript never emits, and
-- tests/v2-curated-awards-pglite.test.ts (state machine versus ledger CHECK) is expected to
-- report that difference.
--
-- Deployment order (the AFLDB-ISSUE-027 / 097 lesson): apply this migration, THEN run
-- `npm run db:privileges` (it re-grants the import and auth blocks added to
-- tools/maintenance/privileges.sql, whose revoke loop strips them on every reconcile), THEN
-- deploy the code that writes derived_award_projections or emits the two new actions. The other
-- order only ever fails closed (no write), never writes wrongly.
--
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   Section 2 first. It is safe only while NO row uses the two new actions and no
-- ROLLBACK:   superseded proposal keeps an approval key, otherwise the ADD CONSTRAINT fails:
-- ROLLBACK:     ALTER TABLE award_proposal_decisions
-- ROLLBACK:       DROP CONSTRAINT award_proposal_decisions_action_ck,
-- ROLLBACK:       DROP CONSTRAINT award_proposal_decisions_transition_ck,
-- ROLLBACK:       ADD CONSTRAINT award_proposal_decisions_action_ck
-- ROLLBACK:         CHECK (action IN ('create', 'validate', 'approve', 'reject', 'revise', 'supersede')),
-- ROLLBACK:       ADD CONSTRAINT award_proposal_decisions_transition_ck
-- ROLLBACK:         CHECK (
-- ROLLBACK:           (action IN ('create', 'revise')
-- ROLLBACK:              AND from_status IS NULL AND to_status = 'proposed')
-- ROLLBACK:           OR (action = 'validate'
-- ROLLBACK:              AND from_status IS NOT NULL
-- ROLLBACK:              AND from_status IN ('proposed', 'validated', 'validation_failed')
-- ROLLBACK:              AND to_status IN ('validated', 'validation_failed'))
-- ROLLBACK:           OR (action = 'approve'
-- ROLLBACK:              AND from_status IS NOT NULL
-- ROLLBACK:              AND from_status = 'validated' AND to_status = 'approved')
-- ROLLBACK:           OR (action = 'reject'
-- ROLLBACK:              AND from_status IS NOT NULL
-- ROLLBACK:              AND from_status IN ('proposed', 'validated', 'validation_failed')
-- ROLLBACK:              AND to_status = 'rejected')
-- ROLLBACK:           OR (action = 'supersede'
-- ROLLBACK:              AND from_status IS NOT NULL
-- ROLLBACK:              AND from_status IN ('proposed', 'validated', 'validation_failed')
-- ROLLBACK:              AND to_status = 'superseded')
-- ROLLBACK:         );
-- ROLLBACK:     ALTER TABLE award_proposals
-- ROLLBACK:       DROP CONSTRAINT award_proposals_approval_ck,
-- ROLLBACK:       ADD CONSTRAINT award_proposals_approval_ck
-- ROLLBACK:         CHECK ((status = 'approved') = (approved_entity_key IS NOT NULL)
-- ROLLBACK:                AND (approved_entity_key IS NULL) = (approved_at IS NULL));
-- ROLLBACK:   Then section 1:
-- ROLLBACK:     DROP TABLE IF EXISTS derived_award_projections;
-- ROLLBACK:   Dropping the table drops its identity sequence, indexes, constraints and grants.
-- ROLLBACK:   Then remove the derived_award_projections blocks from tools/maintenance/privileges.sql
-- ROLLBACK:   (the afldb_import block and the afldb_auth spec row), the table name from the
-- ROLLBACK:   NOT IN list in tests/integration/privileges.test.ts with its dedicated test case,
-- ROLLBACK:   the inventory entry in tools/db/promotion-inventory.ts, the pins in
-- ROLLBACK:   tests/db-promotion-check.test.ts and the list in tests/reference-data.test.ts.
-- ROLLBACK:   Rolling back section 1 DISCARDS every projection provenance row: export them first
-- ROLLBACK:   (COPY derived_award_projections TO a file). award_winners and derived_award_results
-- ROLLBACK:   are NOT affected.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Section 1. derived_award_projections
-- ---------------------------------------------------------------------
CREATE TABLE derived_award_projections (
  id                        bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- The published derivation that was projected. The composite foreign key below
  -- makes the award and season of the projection agree with the derivation's.
  derived_award_result_id   bigint       NOT NULL,
  award_slug                text         NOT NULL,
  season                    integer      NOT NULL,

  -- The projection act.
  projected_by              integer      NOT NULL REFERENCES auth_users(id),
  projected_at              timestamptz  NOT NULL DEFAULT now(),

  -- What the projection did, by key: [{entityKey, action, awardWinnerId}], with action in
  -- inserted | updated | voided | retained. Keys and actions only, never winner values.
  actions                   jsonb        NOT NULL,
  changed_count             integer      NOT NULL,
  retained_count            integer      NOT NULL,

  -- The season seal's audit record (evaluateSeasonWrite(...).audit).
  correction                jsonb        NOT NULL,

  -- Uses derived_award_results_target_uq (migration 112).
  CONSTRAINT derived_award_projections_result_fk
    FOREIGN KEY (derived_award_result_id, award_slug, season)
    REFERENCES derived_award_results (id, award_slug, season),
  -- 'coleman' is the only derived award today (the migration 112 reason).
  CONSTRAINT derived_award_projections_award_slug_ck
    CHECK (award_slug = 'coleman'),
  CONSTRAINT derived_award_projections_season_ck
    CHECK (season BETWEEN 1897 AND 2100),
  CONSTRAINT derived_award_projections_actions_ck
    CHECK (jsonb_typeof(actions) = 'array'),
  CONSTRAINT derived_award_projections_changed_count_ck
    CHECK (changed_count >= 0),
  CONSTRAINT derived_award_projections_retained_count_ck
    CHECK (retained_count >= 0),
  CONSTRAINT derived_award_projections_counts_ck
    CHECK (jsonb_array_length(actions) = changed_count + retained_count),
  -- The audit record must be the seal's, for THIS workflow, season and actor, with the note and
  -- evidence the seal requires. coalesce(..., false): a CHECK PASSES on NULL.
  CONSTRAINT derived_award_projections_correction_ck
    CHECK (jsonb_typeof(correction) = 'object'
           AND coalesce(
             correction ->> 'workflow' = 'derived_award_publication'
             AND correction ->> 'actorUserId' = projected_by::text
             AND correction ->> 'season' = season::text
             AND length(btrim(correction ->> 'note')) BETWEEN 20 AND 2000
             AND length(btrim(correction ->> 'evidenceRef')) >= 1,
             false))
);

COMMENT ON TABLE derived_award_projections IS
  'AFLDB V2 derived awards (migration 114): append-only PROVENANCE record of projecting a published derivation (derived_award_results) into the canonical award_winners table. NOT a winner store: it holds entity keys and actions (inserted, updated, voided, retained) only. Each row is an audited correction through the season seal. No role gets UPDATE, DELETE or TRUNCATE. No foreign key into awards, players, clubs or award_winners; actions[].awardWinnerId is a snapshot a rebuild renumbers, the durable identity is actions[].entityKey.';
COMMENT ON COLUMN derived_award_projections.actions IS
  'Array of {entityKey, action, awardWinnerId}; action is inserted, updated, voided or retained. entityKey is the durable data_overrides key; awardWinnerId is a snapshot of award_winners.id at projection time.';
COMMENT ON COLUMN derived_award_projections.correction IS
  'evaluateSeasonWrite(...).audit from packages/domain/src/season-seal.ts: season, workflow (derived_award_publication), actorUserId (= projected_by), note and evidenceRef.';

CREATE INDEX ix_derived_award_projections_result
  ON derived_award_projections (derived_award_result_id, id);
CREATE INDEX ix_derived_award_projections_target
  ON derived_award_projections (award_slug, season, id);
CREATE INDEX ix_derived_award_projections_projected_by
  ON derived_award_projections (projected_by);

-- ---------------------------------------------------------------------
-- Grants. Guarded on the roles so a database built before they exist still
-- applies; tools/maintenance/privileges.sql mirrors them (its afldb_import
-- revoke loop strips them on every reconcile, and its afldb_auth section is
-- subtractive).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT ON derived_award_projections TO afldb_import;
    GRANT USAGE ON SEQUENCE derived_award_projections_id_seq TO afldb_import;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- SELECT only: afldb_auth never writes this table. Every write runs as
    -- afldb_import, in the projection's single transaction.
    GRANT SELECT ON derived_award_projections TO afldb_auth;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Section 2. Curated-award approved-revision support (V2-GAP-018).
-- Superset replacements of three migration-111 constraints: every combination
-- accepted before is accepted after. No row is rewritten.
-- ---------------------------------------------------------------------
ALTER TABLE award_proposal_decisions
  DROP CONSTRAINT award_proposal_decisions_action_ck,
  ADD CONSTRAINT award_proposal_decisions_action_ck
    CHECK (action IN ('create', 'validate', 'approve', 'reject', 'revise', 'supersede',
                      'supersede_approved', 'revise_approved'));

-- The migration-111 transition CHECK with every branch kept verbatim, plus the two new
-- actions. Every branch other than the from_status-IS-NULL ones says from_status IS NOT NULL
-- explicitly: a NULL from_status would otherwise make that branch NULL, and a CHECK PASSES on
-- NULL (the migration 111 lesson, caught there by the per-triple test).
ALTER TABLE award_proposal_decisions
  DROP CONSTRAINT award_proposal_decisions_transition_ck,
  ADD CONSTRAINT award_proposal_decisions_transition_ck
    CHECK (
      (action IN ('create', 'revise')
         AND from_status IS NULL AND to_status = 'proposed')
      OR (action = 'validate'
         AND from_status IS NOT NULL
         AND from_status IN ('proposed', 'validated', 'validation_failed')
         AND to_status IN ('validated', 'validation_failed'))
      OR (action = 'approve'
         AND from_status IS NOT NULL
         AND from_status = 'validated' AND to_status = 'approved')
      OR (action = 'reject'
         AND from_status IS NOT NULL
         AND from_status IN ('proposed', 'validated', 'validation_failed')
         AND to_status = 'rejected')
      OR (action = 'supersede'
         AND from_status IS NOT NULL
         AND from_status IN ('proposed', 'validated', 'validation_failed')
         AND to_status = 'superseded')
      OR (action = 'supersede_approved'
         AND from_status IS NOT NULL
         AND from_status = 'approved' AND to_status = 'superseded')
      OR (action = 'revise_approved'
         AND from_status IS NULL AND to_status = 'approved')
    );

-- A SUPERSEDED former approval keeps its approval key and time (both or neither: rows
-- superseded before they were ever approved have neither); the key is allowed only for
-- approved or superseded; every other status carries neither.
ALTER TABLE award_proposals
  DROP CONSTRAINT award_proposals_approval_ck,
  ADD CONSTRAINT award_proposals_approval_ck
    CHECK (
      (status = 'approved' AND approved_entity_key IS NOT NULL AND approved_at IS NOT NULL)
      OR (status = 'superseded' AND (approved_entity_key IS NULL) = (approved_at IS NULL))
      OR (status NOT IN ('approved', 'superseded')
          AND approved_entity_key IS NULL AND approved_at IS NULL)
    );
