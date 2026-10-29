-- =====================================================================
-- 111 - Curated award proposals: an audited proposal -> review -> approval workflow
-- =====================================================================
-- AFLDB V2 Stage 4 (docs/v2/plan.md section 3 D8, docs/v2/adr/0008-curated-awards.md).
-- Forward-only. Additive. Writes NO data and never rewrites an existing row.
--
-- Purpose
-- -------
-- Club awards, league awards and historical honours that cannot be derived
-- from a source are curated by people. The owner's rule is that an import or
-- a manual entry only ever creates a PROPOSAL, that an authorised
-- administrator reviews it, that approval promotes it TRANSACTIONALLY into the
-- canonical award_winners table (all or nothing), that a rejection keeps an
-- audit record, and that a correction is a new REVISION rather than an erased
-- history. Wikipedia-derived input may only ever create a proposal: it is a
-- locally supplied file prepared offline, never fetched by runtime code and
-- never approved automatically.
--
-- This migration creates exactly two tables:
--
--   1. award_proposals -- one row per REVISION of one proposed award winner.
--      The value columns mirror award_winners and are IMMUTABLE once written
--      (the grants below give afldb_import UPDATE on the workflow columns
--      only). A correction is revision n+1 linked by revision_of_id; the
--      earlier revision is moved to 'superseded' and kept.
--
--   2. award_proposal_decisions -- the append-only decision ledger. Every
--      status transition writes exactly one row, in the same transaction as
--      the status change (the migration-074 promotion_decisions and
--      migration-104 afl_api_identity_adjudications pattern). The table's own
--      CHECK mirrors the TypeScript state machine
--      (packages/admin/src/curated-awards-model.ts, CURATED_AWARD_TRANSITIONS),
--      so a ledger row cannot record a transition the workflow forbids.
--
-- Two audit tiers, not a widened data_edits
-- -----------------------------------------
-- The repository audits in two tiers and this migration reuses both.
--   * The WORKFLOW (propose, validate, reject, revise, approve) is audited by
--     award_proposal_decisions, exactly as 074 and 104 audit their decisions.
--   * The CANONICAL row an approval creates is audited by the existing path:
--     approval calls the existing insertAwardWinner() in
--     src/db/queries/admin-awards.ts on the same transaction, which writes
--     award_winners, a data_overrides row, a data_edits row and recomputes the
--     award span. The proposal id is carried into that data_edits row.
-- data_edits_table_name_check is deliberately NOT widened: that would cascade
-- into tools/db/promotion-inventory.ts lineage rules for a table that is not
-- canonical football data.
--
-- Natural identity, not row ids
-- -----------------------------
-- A proposal names its award by awards.slug, its player by the durable
-- identity string src/db/queries/player-identity.ts resolvePlayerIdentity()
-- already computes ('afltables:<profile path>' or 'manual_admin_edit:<token>')
-- and its club by clubs.slug. It carries NO foreign key into awards, players,
-- clubs or award_winners. Those four tables are rebuilt by TRUNCATE ...
-- CASCADE and renumbered by a promotion, so an id (or an FK) into them would
-- turn this ledger into lineage-bound state that tools/db/promotion-inventory.ts
-- could only reinstate through a staged remap (AFLDB-ISSUE-151/155), and a
-- plain rebuild would silently empty it. The same rule
-- src/db/queries/admin-awards.ts states as its invariant 3: the durable record
-- is named by natural identity, never by id. Validation and approval resolve
-- the natural keys to ids inside the transaction. The only foreign keys here
-- are intra-family (the ledger -> its proposal, a revision -> its predecessor)
-- and admin_user_id/created_by -> auth_users.
--
-- Not enforced: a four-eyes rule. Any capability-holding administrator
-- (data.awards.edit, super_admin) may approve a proposal they created. That is
-- recorded in docs/v2/adr/0008-curated-awards.md, not silently assumed.
--
-- Grants (hand-written, NOT afldb_meta.grant_app_read / grant_import_write)
-- ------------------------------------------------------------------------
--   afldb_import   award_proposals            SELECT, INSERT, UPDATE (workflow columns only)
--                  award_proposal_decisions   SELECT, INSERT
--                  + USAGE on both identity sequences
--   afldb_auth     SELECT on both (the admin history view)
--   afldb_app      nothing. Proposals hold unvetted data and source evidence and
--                  must never reach the public site, so neither table is
--                  registered with grant_app_read(), and the default-deny of
--                  migrations 039/045 stays in force.
-- Neither table is registered in afldb_meta.import_writable_tables: that
-- registry's reconcile loop hands out UPDATE, DELETE and TRUNCATE, which would
-- destroy the immutability of the value columns and the append-only property
-- of the ledger (the migration-066 / 104 reason, restated). No role ever gets
-- DELETE or TRUNCATE.
--
-- Deployment order (the AFLDB-ISSUE-027 / 097 lesson): apply this migration,
-- THEN run `npm run db:privileges` (it re-grants the import and auth blocks
-- added to tools/maintenance/privileges.sql, whose revoke loop strips them on
-- every reconcile), THEN deploy the code that writes these tables. The other
-- order only ever fails closed (no write), never writes wrongly.
-- tools/db/privileges.ts is the runner and needs no change.
--
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   Reverse in this order (the ledger references the proposals):
-- ROLLBACK:     DROP TABLE IF EXISTS award_proposal_decisions;
-- ROLLBACK:     DROP TABLE IF EXISTS award_proposals;
-- ROLLBACK:   Dropping a table drops its identity sequence, indexes, constraints and grants.
-- ROLLBACK:   Then remove the two award_proposals blocks from tools/maintenance/privileges.sql
-- ROLLBACK:   (the afldb_import block and the two afldb_auth spec rows) and the two table names
-- ROLLBACK:   from the NOT IN list in tests/integration/privileges.test.ts.
-- ROLLBACK:   Rolling back DISCARDS every proposal and decision row: export them first
-- ROLLBACK:   (COPY award_proposals / award_proposal_decisions TO a file). Approved winners are
-- ROLLBACK:   NOT affected: they live in award_winners with their own data_overrides and
-- ROLLBACK:   data_edits rows, which depend on neither table.
-- =====================================================================

CREATE TABLE award_proposals (
  id                   bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- Shared by every revision of one proposal.
  proposal_key         uuid         NOT NULL DEFAULT gen_random_uuid(),
  revision             smallint     NOT NULL DEFAULT 1,
  revision_of_id       bigint       REFERENCES award_proposals(id),

  -- The target, by natural identity (see the header).
  award_slug           text         NOT NULL,
  season               smallint     NOT NULL,
  -- NULL only while the player is unresolved; an unresolved proposal can be
  -- stored and reviewed but validation refuses to approve it.
  player_identity      text,
  player_name_raw      text         NOT NULL,
  club_slug            text,

  -- The value, mirroring award_winners.
  votes                numeric(8,2),
  position             text,
  is_captain           boolean      NOT NULL DEFAULT false,
  is_vice_captain      boolean      NOT NULL DEFAULT false,
  note                 text,
  -- Some awards legitimately record the same player twice in one season (the
  -- 1984 All-Australian club and state selections, admin-awards.ts R-5), so a
  -- duplicate is a conflict to confirm, never silently allowed.
  duplicate_confirmed  boolean      NOT NULL DEFAULT false,

  -- The evidence.
  source_kind          text         NOT NULL,
  source_url           text,
  citation             text,
  acquired_on          date         NOT NULL,

  -- The workflow.
  status               text         NOT NULL DEFAULT 'proposed',
  validation_result    jsonb,
  validated_at         timestamptz,
  -- The durable entity key insertAwardWinner() returned: '<sources.key>:<natural key>'.
  -- Never an award_winners.id, which a rebuild renumbers.
  approved_entity_key  text,
  approved_at          timestamptz,

  created_by           integer      NOT NULL REFERENCES auth_users(id),
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT award_proposals_revision_ck
    CHECK (revision >= 1),
  CONSTRAINT award_proposals_revision_chain_ck
    CHECK ((revision = 1) = (revision_of_id IS NULL)),
  CONSTRAINT award_proposals_proposal_revision_uq
    UNIQUE (proposal_key, revision),
  CONSTRAINT award_proposals_award_slug_ck
    CHECK (length(award_slug) BETWEEN 1 AND 200),
  CONSTRAINT award_proposals_season_ck
    CHECK (season BETWEEN 1897 AND 2100),
  CONSTRAINT award_proposals_player_identity_ck
    CHECK (player_identity IS NULL OR player_identity ~ '^(afltables|manual_admin_edit):.+$'),
  CONSTRAINT award_proposals_player_name_ck
    CHECK (length(btrim(player_name_raw)) BETWEEN 1 AND 200),
  CONSTRAINT award_proposals_votes_ck
    CHECK (votes IS NULL OR votes BETWEEN 0 AND 999999.99),
  CONSTRAINT award_proposals_position_ck
    CHECK (position IS NULL OR length(position) <= 200),
  CONSTRAINT award_proposals_note_ck
    CHECK (note IS NULL OR length(note) <= 2000),
  CONSTRAINT award_proposals_source_kind_ck
    CHECK (source_kind IN ('manual_entry', 'offline_file', 'wikipedia_offline_file')),
  CONSTRAINT award_proposals_source_url_ck
    CHECK (source_url IS NULL
           OR (source_url ~ '^https?://[^[:space:]]+$' AND length(source_url) <= 2000)),
  CONSTRAINT award_proposals_citation_ck
    CHECK (citation IS NULL OR length(btrim(citation)) BETWEEN 1 AND 2000),
  -- Required evidence: a proposal with neither a source URL nor a citation
  -- cannot be stored at all.
  CONSTRAINT award_proposals_evidence_ck
    CHECK (source_url IS NOT NULL OR citation IS NOT NULL),
  -- Wikipedia input must name the page it was prepared from.
  -- coalesce: a NULL source_url must FAIL this check, and a CHECK passes on NULL.
  CONSTRAINT award_proposals_wikipedia_url_ck
    CHECK (source_kind <> 'wikipedia_offline_file'
           OR coalesce(source_url ~* '^https://([a-z0-9-]+[.])*wikipedia[.]org/', false)),
  CONSTRAINT award_proposals_status_ck
    CHECK (status IN ('proposed', 'validated', 'validation_failed',
                      'approved', 'rejected', 'superseded')),
  CONSTRAINT award_proposals_validation_result_ck
    CHECK (validation_result IS NULL OR jsonb_typeof(validation_result) = 'object'),
  -- An approved proposal names the canonical row it produced, and only an
  -- approved proposal does.
  CONSTRAINT award_proposals_approval_ck
    CHECK ((status = 'approved') = (approved_entity_key IS NOT NULL)
           AND (approved_entity_key IS NULL) = (approved_at IS NULL))
);

COMMENT ON TABLE award_proposals IS
  'AFLDB V2 curated awards (migration 111): one row per REVISION of one proposed award winner. Value columns are immutable once written; a correction is revision n+1 (revision_of_id) and the earlier revision becomes superseded. Names its award, player and club by natural identity (slug / durable player identity), never by id, so a rebuild or promotion cannot dangle it. Approval promotes through insertAwardWinner() in one transaction.';
COMMENT ON COLUMN award_proposals.player_identity IS
  'The durable identity string resolvePlayerIdentity() computes: afltables:<profile path> or manual_admin_edit:<token>. NULL only while unresolved; validation refuses to approve a NULL.';
COMMENT ON COLUMN award_proposals.approved_entity_key IS
  'The data_overrides entity key of the award_winners row an approval created. Never an id.';
COMMENT ON COLUMN award_proposals.source_kind IS
  'manual_entry (admin data editor), offline_file (a locally supplied file) or wikipedia_offline_file (a locally supplied file prepared offline from Wikipedia; requires a wikipedia.org source_url). Runtime code never fetches Wikipedia.';

-- At most one LIVE revision per proposal: superseded and rejected revisions
-- are history, anything else is the current one.
CREATE UNIQUE INDEX uq_award_proposals_live_revision
  ON award_proposals (proposal_key)
  WHERE status IN ('proposed', 'validated', 'validation_failed', 'approved');
-- A revision has at most one successor, so the chain is linear. Also the
-- supporting index for the revision_of_id foreign key.
CREATE UNIQUE INDEX uq_award_proposals_revision_of
  ON award_proposals (revision_of_id)
  WHERE revision_of_id IS NOT NULL;
CREATE INDEX ix_award_proposals_created_by
  ON award_proposals (created_by);
CREATE INDEX ix_award_proposals_target
  ON award_proposals (award_slug, season);
CREATE INDEX ix_award_proposals_status
  ON award_proposals (status, id);

CREATE TABLE award_proposal_decisions (
  id               bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  proposal_id      bigint       NOT NULL REFERENCES award_proposals(id),
  action           text         NOT NULL,
  -- NULL for the two actions that create a row (create, revise).
  from_status      text,
  to_status        text         NOT NULL,
  admin_user_id    integer      NOT NULL REFERENCES auth_users(id),
  -- Reduced forms: the values or status before and after, never raw payloads.
  previous_values  jsonb,
  new_values       jsonb,
  note             text,
  decided_at       timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT award_proposal_decisions_action_ck
    CHECK (action IN ('create', 'validate', 'approve', 'reject', 'revise', 'supersede')),
  CONSTRAINT award_proposal_decisions_status_ck
    CHECK ((from_status IS NULL OR from_status IN
              ('proposed', 'validated', 'validation_failed', 'approved', 'rejected', 'superseded'))
           AND to_status IN
              ('proposed', 'validated', 'validation_failed', 'approved', 'rejected', 'superseded')),
  -- The state machine, mirrored. Keep in step with CURATED_AWARD_TRANSITIONS.
  -- Every branch other than create/revise says from_status IS NOT NULL explicitly: a
  -- NULL from_status would otherwise make that branch NULL, and a CHECK PASSES on NULL
  -- (tests/v2-curated-awards-pglite.test.ts tries every action/from/to triple and caught this).
  CONSTRAINT award_proposal_decisions_transition_ck
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
    ),
  CONSTRAINT award_proposal_decisions_note_ck
    CHECK (note IS NULL OR length(note) <= 2000),
  -- A rejection always keeps its reason.
  CONSTRAINT award_proposal_decisions_reject_note_ck
    CHECK (action <> 'reject' OR (note IS NOT NULL AND length(btrim(note)) >= 10))
);

COMMENT ON TABLE award_proposal_decisions IS
  'AFLDB V2 curated awards (migration 111): append-only ledger of every award_proposals status transition, written in the same transaction as the change. No role ever gets UPDATE, DELETE or TRUNCATE. The transition CHECK mirrors CURATED_AWARD_TRANSITIONS in packages/admin.';

CREATE INDEX ix_award_proposal_decisions_proposal
  ON award_proposal_decisions (proposal_id, id);
CREATE INDEX ix_award_proposal_decisions_admin_user_id
  ON award_proposal_decisions (admin_user_id);

-- ---------------------------------------------------------------------
-- Grants. Guarded on the roles so a database built before they exist still
-- applies; tools/maintenance/privileges.sql mirrors them (its afldb_import
-- revoke loop strips them on every reconcile, and its afldb_auth section is
-- subtractive).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT, INSERT ON award_proposals TO afldb_import;
    -- Workflow columns only: the proposed value and its evidence are immutable
    -- at the grant level, so a correction can only be a new revision.
    GRANT UPDATE (status, validation_result, validated_at,
                  approved_entity_key, approved_at, updated_at)
      ON award_proposals TO afldb_import;
    GRANT USAGE ON SEQUENCE award_proposals_id_seq TO afldb_import;
    GRANT SELECT, INSERT ON award_proposal_decisions TO afldb_import;
    GRANT USAGE ON SEQUENCE award_proposal_decisions_id_seq TO afldb_import;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    -- SELECT only: afldb_auth never writes these tables. Every write runs as
    -- afldb_import, in the same transaction as the canonical write it audits.
    GRANT SELECT ON award_proposals TO afldb_auth;
    GRANT SELECT ON award_proposal_decisions TO afldb_auth;
  END IF;
END
$$;
