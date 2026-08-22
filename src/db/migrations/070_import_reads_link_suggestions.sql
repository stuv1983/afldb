-- ---------------------------------------------------------------------
-- 070 — the importer may read reader suggestions (AFLDB-ISSUE-078)
-- ---------------------------------------------------------------------
-- A keyed reload deletes the rows whose source fact has gone away. For
-- first-kick-goal that is a curator marking a manifest entry
-- `Status=retired`, and the loader must not carry that out blindly:
-- player_achievements.id is referenced WITHOUT a foreign key by
-- application state, so deleting a row can strand a durable reference.
--
-- player_link_suggestions is one of those references, and unlike the
-- match-candidate cache it is genuinely surfaced when orphaned. The cache
-- is read keyed by the entity ids currently on the page
-- (readSuggestionsForEntities), so an orphan there is never fetched; the
-- "Reader suggestions" panel in /admin/player-links renders every OPEN
-- suggestion unjoined, so an orphan sits in that queue permanently and
-- can never be approved — lockUnresolvedTarget finds no row.
--
-- Migration 056's column comment calls a dead target_id "a harmless
-- unsurfaced row". That is true of the per-row lookup it was written
-- about, and not of the standalone panel. Rather than let a reload create
-- them, the importer refuses to retire a referenced row unless the
-- curator names it explicitly (--accept-retirement), and this grant is
-- what lets it see them at all.
--
-- SELECT only, and exactly the shape migration 068 established for
-- player_link_resolutions: the importer may READ the human-contributed
-- state it might otherwise destroy, and may not write it. No UPDATE, no
-- DELETE, no TRUNCATE. Mirrored in tools/maintenance/privileges.sql,
-- whose import revoke loop strips anything not re-granted there.
--
-- Deployment order, as for 066 and 068: apply this migration and run
-- `npm run db:privileges` BEFORE the importer code that depends on it, or
-- the first retirement fails closed on the read.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') THEN
    GRANT SELECT ON player_link_suggestions TO afldb_import;
  END IF;
END
$$;
