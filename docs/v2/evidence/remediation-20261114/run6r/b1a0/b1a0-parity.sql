-- B1a-0 option A, packet 6R: the nine restore-test.sh parity aggregates (tools/maintenance/restore-test.sh:290-298, same SQL), labelled,
-- in ONE read-only REPEATABLE READ snapshot. Run on afldb_prod (read-only backup role) immediately after the dump, and on the restored
-- disposable copy on the DEV host; b1a0-dev-restore-verify.sh compares the two outputs line for line. No identity is printed.
--   PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -d "$DSN" -f b1a0-parity.sql > parity-<side>.txt
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'player_match_stats rows', count(*) FROM player_match_stats;
SELECT 'players rows', count(*) FROM players;
SELECT 'matches rows', count(*) FROM matches;
SELECT 'clubs rows', count(*) FROM clubs;
SELECT 'career games total', sum(games) FROM player_career_stats;
SELECT 'career goals total', sum(goals) FROM player_career_stats;
SELECT 'Brownlow votes total', sum(votes) FROM brownlow_season_votes;
SELECT 'unrecorded disposals', count(*) FROM player_match_stats WHERE disposals IS NULL;
SELECT 'stat_availability rows', count(*) FROM stat_availability;
ROLLBACK;
