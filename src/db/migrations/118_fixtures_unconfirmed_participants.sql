-- AFLDB-ISSUE-229 B2 (2027 feed, owner decision 2026-11-01): an UNCONFIRMED scheduled fixture with unresolved participants.
--
-- The first authentic 2027 season feed carries provider status PLACEHOLDER for 83 of 218 matches: the whole second half of
-- the home-and-away season (real clubs, venues and times, not yet confirmed) and every finals match (six of them with
-- ladder-position or bracket labels such as '7th' or 'Winner of QF1' instead of clubs, and the venue 'To Be Confirmed').
-- Owner policy: such a record is an unconfirmed SCHEDULED fixture; never a result, a cancellation or a void; a label is
-- never a club and 'To Be Confirmed' is never a venue.
--
-- fixtures already represents an unknown venue (venue_id and venue_raw NULL) and an unknown date or time (NULL). It cannot
-- represent (a) that the provider has not confirmed the fixture, or (b) a participant that is not yet a club. This migration
-- adds exactly that, and nothing else:
--   confirmation      'confirmed' (default; every existing row) | 'unconfirmed'
--   home_placeholder  the provider's label for an unresolved home participant (club NULL), otherwise NULL
--   away_placeholder  likewise for the away side
--   home_club_id / away_club_id become nullable, but ONLY together with a label and ONLY on an unconfirmed fixture:
--   exactly one of (club, label) is present per side, and a label requires confirmation = 'unconfirmed'.
-- Forward-only, additive in effect. Rewrites no row; every existing row satisfies the new checks (confirmation defaults to
-- 'confirmed', both clubs present, both labels NULL). No index, key, grant, ownership, default or other constraint changes.
-- Readers that join clubs on these columns (admin fixtures list, played-resolution) see no row for an unresolved participant,
-- which is the correct reading: a fixture whose participant is not yet a club cannot have been played.
-- ROLLBACK: (comment lines only; the migration runner executes this whole file)
-- ROLLBACK:   Refuse while any fixtures row has confirmation = 'unconfirmed' or a NULL club (retained provider observation is the
-- ROLLBACK:   source; delete or re-resolve those rows first), then: ALTER TABLE fixtures DROP CONSTRAINT fixtures_home_participant_ck,
-- ROLLBACK:   DROP CONSTRAINT fixtures_away_participant_ck, DROP CONSTRAINT fixtures_confirmation_ck, DROP COLUMN confirmation,
-- ROLLBACK:   DROP COLUMN home_placeholder, DROP COLUMN away_placeholder, ALTER COLUMN home_club_id SET NOT NULL,
-- ROLLBACK:   ALTER COLUMN away_club_id SET NOT NULL;

ALTER TABLE fixtures
  ADD COLUMN confirmation     text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN home_placeholder text,
  ADD COLUMN away_placeholder text,
  ALTER COLUMN home_club_id DROP NOT NULL,
  ALTER COLUMN away_club_id DROP NOT NULL;

ALTER TABLE fixtures
  ADD CONSTRAINT fixtures_confirmation_ck CHECK (confirmation IN ('confirmed', 'unconfirmed')),
  ADD CONSTRAINT fixtures_home_participant_ck CHECK (
    (home_club_id IS NOT NULL AND home_placeholder IS NULL)
    OR (home_club_id IS NULL AND home_placeholder IS NOT NULL AND length(btrim(home_placeholder)) > 0
        AND confirmation = 'unconfirmed')),
  ADD CONSTRAINT fixtures_away_participant_ck CHECK (
    (away_club_id IS NOT NULL AND away_placeholder IS NULL)
    OR (away_club_id IS NULL AND away_placeholder IS NOT NULL AND length(btrim(away_placeholder)) > 0
        AND confirmation = 'unconfirmed'));

COMMENT ON COLUMN fixtures.confirmation IS
  'confirmed | unconfirmed. Orthogonal to status: an unconfirmed fixture is still status ''scheduled'' (planned, details not yet confirmed by the provider, AFL API status PLACEHOLDER). It is never a result, cancellation or void. Every manual and every pre-118 row is confirmed.';
COMMENT ON COLUMN fixtures.home_placeholder IS
  'The provider''s label for a home participant that is not yet a club (a ladder position such as ''7th'' or a bracket reference such as ''Winner of QF1''); home_club_id is then NULL. A label is never a club. NULL when the home side is a club.';
COMMENT ON COLUMN fixtures.away_placeholder IS
  'The provider''s label for an away participant that is not yet a club; away_club_id is then NULL. A label is never a club. NULL when the away side is a club.';
