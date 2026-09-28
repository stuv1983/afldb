-- ---------------------------------------------------------------------
-- 106 — AFLDB-ISSUE-238 Slice 3 M1: `corrected` ledger action
-- (successor to 104)
-- ---------------------------------------------------------------------
-- ISSUE-238 D2 (runbook §7, approved for planning): a human correction of a
-- consumed trusted afl_api link (CD_I: P -> P') is recorded as a NEW ledger
-- action, `corrected`. It is not revoke+relink: a revoke means undo/non-use
-- under the existing contract, and a consumed correction is neither an undo
-- (the identity stays linked, to a different player) nor, for an
-- importer-origin provider, the undoing of any prior human decision at all
-- (there is no `linked` row to revoke). Historical `linked`/`revoked` rows
-- stay append-only and are unchanged by this migration (§10 M1, "existing
-- rows satisfy every new CHECK unchanged").
--
-- Migration 104's biconditional CHECK,
--   (action = 'revoked') = (supersedes_id IS NOT NULL),
-- assumed exactly two actions and is no longer sufficient: a human-origin
-- `corrected` row supersedes the `linked` row it corrects (supersedes_id SET),
-- while an importer-origin `corrected` row has no prior human link to
-- supersede (supersedes_id NULL). The runbook (§10 M1) replaces the single
-- biconditional with two one-directional implications that each action
-- vocabulary member satisfies independently; "the superseded row is a
-- `linked` row for the same external_id" is a cross-row fact and is enforced
-- in code (the correction planner/CLI), not by a CHECK.
--
-- `previous_player_identity` durably records the FROM identity a `corrected`
-- row moved away from -- the same stable-identity shape as the existing
-- `player_identity` column (external_identities.external_id for a trusted
-- afltables/afltables_profile_url row, or the manual_admin_edit token), never
-- a surrogate id, and never remapped by a promotion/rebuild the way a local
-- player id would be (§10 M1: "promotion resolves it rather than remapping
-- it"). Without it, a promotion/rebuild REPLAY cannot recognise the
-- candidate's still-uncorrected row as the one this ledger row already
-- corrected (runbook §9).
--
-- `surname_disagreement_acknowledged` (104:85, NOT NULL) already carries
-- exactly the meaning a `corrected` row also needs -- "a disagreement
-- existed between the provider's observed surname and P', and the operator
-- acknowledged it" -- so this migration adds no new column for it; the CLI
-- (a later slice) supplies the value for `corrected` the same way the link
-- path already does.
--
-- Grants are UNCHANGED: SELECT, INSERT + sequence USAGE to afldb_import;
-- SELECT only to afldb_auth; still deliberately outside
-- afldb_meta.import_writable_tables (104's rationale, restated: that
-- reconcile loop would hand back UPDATE/DELETE/TRUNCATE and destroy the
-- append-only property). A new action value and a new nullable column need
-- no new grant, and tools/maintenance/privileges.sql's existing mirror
-- (362-365, 495, confirmed by AFLDB-ISSUE-238's Slice-1 closure pass) already
-- matches this shape exactly, so this migration does not touch that file.
--
-- Deployment order (the ISSUE-027 lesson, restated by 104): this migration
-- and db:privileges must land before any code that writes `corrected` rows.
-- That code does not exist yet (Slice 4+); this migration alone changes no
-- observable behaviour.
-- ---------------------------------------------------------------------

-- 1. Action vocabulary gains `corrected`.
ALTER TABLE afl_api_identity_adjudications
  DROP CONSTRAINT afl_api_identity_adjudications_action_check;
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_action_check
  CHECK (action IN ('linked', 'revoked', 'corrected'));

-- 2. Replace the two-action biconditional with the two implications the
--    three-action vocabulary needs. `corrected` is deliberately unconstrained
--    here in either direction: whether it carries supersedes_id depends on
--    whether the correction is human-origin (supersedes a prior `linked`
--    row) or importer-origin (nothing to supersede) -- a cross-row fact the
--    planner enforces, not a same-row shape a CHECK can express.
ALTER TABLE afl_api_identity_adjudications
  DROP CONSTRAINT afl_api_identity_adjudications_revoke_ck;
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_revoke_ck
  CHECK (action <> 'revoked' OR supersedes_id IS NOT NULL);
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_linked_ck
  CHECK (action <> 'linked' OR supersedes_id IS NULL);

-- 3. The durable FROM identity. No FK: it is a stable identity string, like
--    player_identity, resolved rather than remapped across a lineage
--    boundary (§9).
ALTER TABLE afl_api_identity_adjudications
  ADD COLUMN previous_player_identity text;
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_previous_player_identity_ck
  CHECK ((action = 'corrected') = (previous_player_identity IS NOT NULL));

-- 4. A `corrected` row always carries its lineage-local previous_state
--    snapshot (audit only; never used for cross-lineage replay, §10 M1).
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_corrected_previous_state_ck
  CHECK (action <> 'corrected' OR previous_state IS NOT NULL);

-- 5. Structural P = P' guard on the stable identity strings (decided pass 4,
--    R238-P3-13). The planner additionally compares resolved players (§5.4),
--    because two distinct identity strings can denote one player through an
--    OD-7 continuity pair; that comparison cannot be expressed as a CHECK
--    and stays in code.
ALTER TABLE afl_api_identity_adjudications
  ADD CONSTRAINT afl_api_identity_adjudications_corrected_identity_distinct_ck
  CHECK (action <> 'corrected' OR previous_player_identity <> player_identity);

COMMENT ON COLUMN afl_api_identity_adjudications.previous_player_identity IS
  'AFLDB-ISSUE-238 M1: the stable identity (same shape as player_identity) that a '
  '''corrected'' row moved this provider away from. NULL for linked/revoked. No FK: '
  'a promotion/rebuild resolves it rather than remapping it (runbook §9, §10 M1).';
COMMENT ON TABLE afl_api_identity_adjudications IS
  'AFLDB-ISSUE-235: append-only ledger of every human afl_api identity decision (linked/revoked/'
  'corrected -- AFLDB-ISSUE-238 M1). Durable identity authority (OD-3): a promotion or the '
  'afldb_test rebuild replays the human resolved external_identities row from this ledger, keyed '
  'on external_id and player_identity, never on a surrogate id into external_identities. No role '
  'ever gets UPDATE, DELETE or TRUNCATE.';
