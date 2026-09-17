-- ---------------------------------------------------------------------
-- 091 — a retired beta access code can be permanently deleted
--       (AFLDB-ISSUE-117)
-- ---------------------------------------------------------------------
-- Revocation (023) stops a code but keeps its row, so /admin/access
-- accumulates obsolete revoked codes with no way to clear them. The
-- admin page runs as afldb_auth, which migration 023 granted
-- SELECT, INSERT, UPDATE on beta_access_codes and no DELETE, so the
-- destructive half of the Active -> Revoke -> Delete lifecycle fails
-- closed at the role boundary until this grant exists.
--
-- NUMBERING (AFLDB-ISSUE-117 reconciliation, 2026-09-06). This migration
-- was written as 079 on the unmerged branch claude/issue-116 (2344ab5)
-- and applied to afldb_dev from there. Meanwhile main took 079 for
-- 079_nl_search_log_head_to_head_grain.sql, so the file cannot merge at
-- that number; it claims 091, the next free number after a scan of every
-- local and remote ref and every sibling worktree. The SQL is unchanged.
-- afldb_dev therefore still carries an applied ledger row named
-- 079_access_code_delete.sql that no checkout can reproduce; that row is
-- not edited or deleted here, and applying this migration there is safe
-- because GRANT is idempotent. See AFLDB-ISSUE-142 Finding C.
--
-- DELETE only, and only on this table. No foreign key references
-- beta_access_codes, so removing a row orphans no child rows and needs
-- no cascade. Two soft references exist and both were checked:
--
--   * the beta session cookie's subject is `code:<id>` (grantBetaAccess),
--     but hasBetaAccess() and the middleware verify the signed claim
--     alone -- signature, kind, expiry, epoch -- and never look the id
--     up. Deleting a code therefore ends no existing session, exactly as
--     revoking one does not; the epoch and the TTL remain the only ways
--     to cut a live beta session short. Deletion is not the weaker path.
--   * auth_audit_log rows (`beta.code_redeemed`) carry codeId and label
--     as detail, so redemption history stays readable after the row goes.
--
-- id is GENERATED ALWAYS AS IDENTITY, so a freed id is never reissued
-- and a later code cannot inherit a deleted one's cookie subject.
--
-- The precedent for a narrow DELETE on an afldb_auth table is
-- data_submission_rows (023) and site_media (037). Mirrored in
-- tools/maintenance/privileges.sql, whose afldb_auth section is
-- SUBTRACTIVE: a table left at its old privilege string there has the
-- new grant silently revoked by the next reconcile or restore.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_auth') THEN
    GRANT DELETE ON beta_access_codes TO afldb_auth;
  END IF;
END
$$;
