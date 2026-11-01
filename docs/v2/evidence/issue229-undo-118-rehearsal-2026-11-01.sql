-- REHEARSED ON A DISPOSABLE COPY ONLY (2026-11-01). NOT an authorised production step; any production use needs its own owner approval and a fresh backup.
BEGIN;
-- precondition shown by the migration's own ROLLBACK note: refuse while unconfirmed or label rows exist
SELECT count(*) FILTER (WHERE confirmation = 'unconfirmed' OR home_club_id IS NULL OR away_club_id IS NULL) AS blockers_before FROM fixtures;
-- recovery route: remove ONLY the provider-owned 2027 rows (the retained feed re-creates them), keep every manual row
DELETE FROM fixtures WHERE source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND season = 2027;
SELECT count(*) FILTER (WHERE confirmation = 'unconfirmed' OR home_club_id IS NULL OR away_club_id IS NULL) AS blockers_after, count(*) AS remaining FROM fixtures;
ALTER TABLE fixtures DROP CONSTRAINT fixtures_home_participant_ck, DROP CONSTRAINT fixtures_away_participant_ck, DROP CONSTRAINT fixtures_confirmation_ck,
  DROP COLUMN confirmation, DROP COLUMN home_placeholder, DROP COLUMN away_placeholder,
  ALTER COLUMN home_club_id SET NOT NULL, ALTER COLUMN away_club_id SET NOT NULL;
SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'fixtures' AND column_name IN ('home_club_id','away_club_id','confirmation','home_placeholder') ORDER BY 1;
DELETE FROM afldb_meta.schema_migrations WHERE name = '118_fixtures_unconfirmed_participants.sql';
SELECT count(*) AS ledger FROM afldb_meta.schema_migrations;
COMMIT;
