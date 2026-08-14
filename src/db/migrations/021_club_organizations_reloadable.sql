-- =====================================================================
-- AFLDB 021 — Make the organization layer reloadable
-- =====================================================================
-- Migration 017 made clubs.organization_id NOT NULL, which is true of
-- the finished data but makes a full reload impossible: the importer
-- truncates and rebuilds clubs, and the organizations cannot exist
-- before the identities they are derived from.
--
-- PostgreSQL 16 cannot defer a NOT NULL, so the guarantee moves from the
-- column to the places that can express it without blocking a reload:
--
--   * the importer rebuilds club_organizations immediately after clubs,
--     inside the same run
--   * tools/validation/validate_migration.py fails if any club has no
--     organization
--   * a release-gate test asserts the same
--
-- The rule has not been relaxed, only enforced somewhere that a
-- mid-reload intermediate state does not trip.
-- =====================================================================

ALTER TABLE clubs ALTER COLUMN organization_id DROP NOT NULL;

COMMENT ON COLUMN clubs.organization_id IS
  'The continuing club this identity belongs to. NULL only transiently during a reload; the importer and validator both require it to be set. Use for "clubs played" and lineage totals; use clubs.id for matches, stints and era pages.';

-- Relations are re-seeded by slug on reload, so they must be removable
-- without taking the organizations with them.
ALTER TABLE club_organization_relations
  DROP CONSTRAINT club_organization_relations_from_organization_id_fkey,
  ADD  CONSTRAINT club_organization_relations_from_organization_id_fkey
       FOREIGN KEY (from_organization_id) REFERENCES club_organizations(id)
       ON DELETE CASCADE;

ALTER TABLE club_organization_relations
  DROP CONSTRAINT club_organization_relations_to_organization_id_fkey,
  ADD  CONSTRAINT club_organization_relations_to_organization_id_fkey
       FOREIGN KEY (to_organization_id) REFERENCES club_organizations(id)
       ON DELETE CASCADE;
