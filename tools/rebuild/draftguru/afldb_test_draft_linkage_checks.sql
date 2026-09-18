-- AFLDB-ISSUE-222 -- read-only draft-linkage checks on afldb_test after the bridge import.
--
--   $env:PGOPTIONS = '-c default_transaction_read_only=on'
--   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 -f tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql -d $env:AFLDB_TEST_DATABASE_URL
--
-- Every statement is a SELECT inside one READ ONLY transaction that is rolled back; PGOPTIONS
-- additionally makes the whole session read-only server-side. Runbook AFLDB-ISSUE-222.md
-- §6.1 (both levels), §6.2 (top-10 national coverage by year), §6.4 (remaining negative
-- controls). Expected values for the 2026-09-19 import are noted beside each block.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database, current_user AS role,
       current_setting('transaction_read_only') AS transaction_read_only;   -- afldb_test | ... | on

-- §6.1 person level. Expected: resolved|draftguru_explicit_admin_decision 5,
-- unique|draftguru_person_page_afltables_bridge 3465, unmatched|<null> 1586,
-- unmatched|draftguru_explicit_admin_decision 1; total 5057.
SELECT dp.link_status, dp.match_method,
       count(*) FILTER (WHERE coalesce(dp.reported_games, 0) > 0) AS played,   -- breakdown only
       count(*) AS persons
  FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
 WHERE s.key = 'draftguru'
 GROUP BY 1, 2 ORDER BY 1, 2;

-- §6.1 consistency across levels. Expected: picks 6810, mismatched 0, linked 5115,
-- capability 75.11 (the bridge/human split of the 5,115 is printed, not pre-stated).
SELECT count(*) AS picks,
       count(*) FILTER (WHERE k.player_id IS DISTINCT FROM p.player_id
                           OR k.link_status_value::text IS DISTINCT FROM p.link_status::text) AS mismatched,
       count(*) FILTER (WHERE k.link_status_value IN ('unique', 'resolved')) AS linked,
       count(*) FILTER (WHERE k.link_status_value = 'unique') AS bridge_linked,
       count(*) FILTER (WHERE k.link_status_value = 'resolved') AS human_linked,
       round(100.0 * count(*) FILTER (WHERE k.link_status_value IN ('unique', 'resolved')) / count(*), 2) AS capability_pct
  FROM draft_picks k JOIN sources s ON s.id = k.source_id
  JOIN draft_persons p ON p.id = k.draft_person_id
 WHERE s.key = 'draftguru';

-- §6.1 pick level, per (draft_year, draft_kind): the capability statement per cell.
SELECT k.draft_year, k.draft_kind, count(*) AS picks,
       count(*) FILTER (WHERE k.link_status_value = 'resolved') AS human_linked,
       count(*) FILTER (WHERE k.link_status_value = 'unique') AS bridge_linked,
       count(*) FILTER (WHERE k.link_status_value NOT IN ('unique', 'resolved')) AS unlinked,
       count(*) FILTER (WHERE coalesce(p.reported_games, 0) > 0) AS played
  FROM draft_picks k JOIN sources s ON s.id = k.source_id
  JOIN draft_persons p ON p.id = k.draft_person_id
 WHERE s.key = 'draftguru'
 GROUP BY 1, 2 ORDER BY 1, 2;

-- §6.2 National Draft picks 1-10 by year (42 drafts: 1981, 1982, 1986-2025). A top-10 pick who
-- never played (reported_games 0) is expected unlinked; one with a career and no link is a
-- finding for AFLDB-ISSUE-224 / §6.2, never a hand-link.
SELECT k.draft_year, count(*) AS top10_picks,
       count(*) FILTER (WHERE k.link_status_value IN ('unique', 'resolved')) AS linked,
       count(*) FILTER (WHERE k.link_status_value NOT IN ('unique', 'resolved')
                          AND coalesce(p.reported_games, 0) > 0) AS unlinked_with_games,
       string_agg(k.player_name_raw, ', ' ORDER BY k.pick_number)
         FILTER (WHERE k.link_status_value NOT IN ('unique', 'resolved')
                   AND coalesce(p.reported_games, 0) > 0) AS unlinked_with_games_names
  FROM draft_picks k JOIN sources s ON s.id = k.source_id
  JOIN draft_persons p ON p.id = k.draft_person_id
 WHERE s.key = 'draftguru' AND k.draft_kind = 'national' AND k.pick_number BETWEEN 1 AND 10
 GROUP BY 1 ORDER BY 1;

-- §6.4 no two DraftGuru persons share a canonical player. Expected: 0 rows.
SELECT dp.player_id, count(*) AS persons
  FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
 WHERE s.key = 'draftguru' AND dp.player_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;

-- §6.4 the rejected identities are reached by no DraftGuru person. Expected: 0 rows.
SELECT dp.player_url, e.external_id
  FROM external_identities e JOIN sources se ON se.id = e.source_id AND se.key = 'afltables'
  JOIN draft_persons dp ON dp.player_id = e.player_id
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
 WHERE e.external_id IN ('players/C/Craig_Somerville.html', 'players/D/David_Sullivan.html');

-- §6.4 the confirmed_unlinked ledger person stays unmatched. Expected: unmatched | NULL player.
SELECT dp.player_url, dp.link_status, dp.match_method, dp.player_id
  FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
 WHERE s.key = 'draftguru' AND dp.player_url = 'https://www.draftguru.com.au/players/aaron_bruce/1';

-- §6.4 trade / free-agency rows carry no pick number. Expected: violations 0.
SELECT count(*) AS list_moves, count(*) FILTER (WHERE k.pick_number IS NOT NULL) AS violations
  FROM draft_picks k JOIN sources s ON s.id = k.source_id
 WHERE s.key = 'draftguru' AND k.draft_kind IN ('trade', 'free_agency');

-- §6.4 / U5 / §3.6 Sam Chapman: outcome printed, never asserted.
SELECT dp.player_url, dp.link_status, dp.match_method, dp.player_id, dp.reported_games
  FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
 WHERE s.key = 'draftguru' AND dp.player_url LIKE '%/sam_chapman/%';

-- §6.7 probe as the corpus computes it. Expected: linked*2 >= total -> true.
SELECT (SELECT count(*) FROM draft_picks) AS draft_total,
       (SELECT count(*) FROM draft_picks WHERE link_status_value IN ('unique', 'resolved')) AS draft_linked,
       (SELECT count(*) FROM draft_picks WHERE link_status_value IN ('unique', 'resolved')) * 2
         >= (SELECT count(*) FROM draft_picks) AS probe_crossed;

-- The audit row of the import. Expected: status completed, tool import_draftguru.py, error NULL.
SELECT b.id, b.status, b.tool, b.records_read, b.records_inserted, b.records_updated, b.error,
       b.started_at, b.completed_at
  FROM import_batches b JOIN sources s ON s.id = b.source_id
 WHERE s.key = 'draftguru'
 ORDER BY b.id DESC LIMIT 3;

ROLLBACK;
