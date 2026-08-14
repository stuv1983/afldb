-- =====================================================================
-- AFLDB 010 — Grant TRUNCATE to the import role
-- =====================================================================
-- The migration tool is a reload-style importer: each group truncates
-- its targets and reloads, which is what makes reruns idempotent.
-- afldb_import held SELECT/INSERT/UPDATE/DELETE but not TRUNCATE.
--
-- TRUNCATE rather than DELETE matters at this scale: player_match_stats
-- holds ~694K rows, and DELETE would leave the table bloated and force a
-- vacuum after every reload.
--
-- This stays within least privilege: afldb_import may still only touch
-- data, never schema, and afldb_app remains read-only.
-- =====================================================================

GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO afldb_import;

ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  GRANT TRUNCATE ON TABLES TO afldb_import;
