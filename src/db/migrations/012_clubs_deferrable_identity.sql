-- =====================================================================
-- AFLDB 012 — Make the club self-identity FK deferrable
-- =====================================================================
-- clubs.current_identity_id references clubs.id, so the very first club
-- inserted has nothing valid to point at yet. The importer loads all 24
-- identities and then resolves successors in a second pass within the
-- same transaction.
--
-- Deferring the check to COMMIT lets that two-pass load work while still
-- guaranteeing the constraint holds for every committed state. The
-- constraint remains INITIALLY IMMEDIATE, so ordinary application
-- writes are still checked per statement; only the importer opts out,
-- via SET CONSTRAINTS ... DEFERRED.
-- =====================================================================

ALTER TABLE clubs
  DROP CONSTRAINT clubs_current_identity_id_fkey;

ALTER TABLE clubs
  ADD CONSTRAINT clubs_current_identity_id_fkey
  FOREIGN KEY (current_identity_id) REFERENCES clubs(id)
  DEFERRABLE INITIALLY IMMEDIATE;
