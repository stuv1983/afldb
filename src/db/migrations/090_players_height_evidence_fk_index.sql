-- =====================================================================
-- AFLDB 090 — Index the foreign key migration 086 added
-- =====================================================================
-- Migration 041 swept the schema for unindexed foreign keys, on the
-- reasoning in its header: PostgreSQL indexes a PRIMARY KEY and a UNIQUE
-- constraint for you, never a foreign key's referencing column.
-- Migration 086 (AFLDB-ISSUE-118 Stage H2) then added
-- players.height_evidence_id -> player_height_evidence(id) and did not
-- cover it, the same miss migration 050 caught up for migration 047.
--
-- player_height_evidence is not delete-free: it is ON DELETE CASCADE from
-- players(id), and the height enrichment pass is re-runnable, so an
-- evidence row can be deleted and re-inserted. Without this index that
-- delete sequentially scans players. Caught up here on migration 041's
-- own terms, in migration 050's partial shape: height_evidence_id is
-- NULL for every player whose height predates this system or was entered
-- by hand, and the referential probe is `WHERE height_evidence_id = $1`,
-- so `WHERE height_evidence_id IS NOT NULL` is a usable, smaller index.
-- =====================================================================

CREATE INDEX IF NOT EXISTS ix_players_height_evidence_id
  ON players (height_evidence_id) WHERE height_evidence_id IS NOT NULL;
