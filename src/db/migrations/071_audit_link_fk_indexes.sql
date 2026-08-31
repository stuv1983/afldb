-- =====================================================================
-- AFLDB 071 — Index the four foreign keys migrations 056/057 left uncovered
-- =====================================================================
-- Migration 041 swept the pre-056 schema for unindexed foreign keys.
-- Migrations 056 and 057 each declared foreign keys without the
-- migration-041-shape supporting indexes, so four referential probes
-- now perform sequential scans of the child table on every parent-side
-- delete:
--
--   data_edits.admin_user_id              → auth_users   (NOT NULL)
--   player_link_resolutions.admin_user_id → auth_users   (NOT NULL)
--   player_link_resolutions.player_id     → players      (nullable)
--   player_link_suggestions.resolved_by   → auth_users   (nullable)
--
-- All four are caught up here on the same terms 041 and 050 used.
-- auth_users is explicitly deletable (see fk-indexes.test.ts); players
-- may be deleted via TRUNCATE...CASCADE reloads. Neither belongs in
-- DELETE_FREE_PARENTS.
--
-- NOT NULL columns get an unconditional index (the same shape as
-- ix_admin_invites_invited_by and ix_data_submissions_uploaded_by in
-- migration 041). Nullable columns get the partial
-- WHERE col IS NOT NULL form, which keeps NULLs out of the index and
-- matches the predicate the referential probe implies.
-- =====================================================================

-- data_edits.admin_user_id — NOT NULL; every row names the acting admin.
-- Deleting an auth_users row scans data_edits without this index.
CREATE INDEX IF NOT EXISTS ix_data_edits_admin_user_id
  ON data_edits (admin_user_id);

-- player_link_resolutions.admin_user_id — NOT NULL; every resolution row
-- names the admin who made the decision. Same delete-scan risk as above.
CREATE INDEX IF NOT EXISTS ix_plr_admin_user_id
  ON player_link_resolutions (admin_user_id);

-- player_link_resolutions.player_id — nullable; NULL when action =
-- 'confirmed_unlinked' (migration 056's plr_action_player_ck constraint
-- enforces this). The partial form keeps unlinked-resolution rows out of
-- the index entirely, matching the selectivity argument from migrations
-- 041 and 050.
CREATE INDEX IF NOT EXISTS ix_plr_player_id
  ON player_link_resolutions (player_id) WHERE player_id IS NOT NULL;

-- player_link_suggestions.resolved_by — nullable; NULL while the
-- suggestion is still open. Partial form for the same reason.
CREATE INDEX IF NOT EXISTS ix_pls_resolved_by
  ON player_link_suggestions (resolved_by) WHERE resolved_by IS NOT NULL;
