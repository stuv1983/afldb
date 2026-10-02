-- AFLDB-ISSUE-225 evidence pass E2 -- afldb_test ONLY, READ ONLY.
--
-- Every statement below is a SELECT inside one READ ONLY transaction that ends in
-- ROLLBACK. The guard refuses any database other than afldb_test and any session that
-- is not read-only, before a single evidence row is read. Run it exactly as the runbook
-- (issues/closed/AFLDB-ISSUE-225.md §7) gives it: psql -v ON_ERROR_STOP=1, so a refused
-- guard ends the run.
--
-- Player ids are afldb_test ids, as the corpus bridge reported them
-- (D:\backups\afldb\issue-222\gridley-corpus-20260919-d1-d2.json). They are NOT the ids
-- in the tracked data/*.csv files, which carry DEV/legacy ids; Q0 confirms each identity.

\pset pager off
\pset null '(null)'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

\qecho '== G. target guard'
SELECT current_database() AS database,
       current_setting('transaction_read_only') AS transaction_read_only,
       inet_server_port() AS server_port,
       now() AS observed_at;

DO $$
BEGIN
  IF current_database() <> 'afldb_test' THEN
    RAISE EXCEPTION 'ISSUE-225 evidence: refusing database %, afldb_test only', current_database();
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'ISSUE-225 evidence: transaction is not read-only';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
\qecho '== Q0a. identities behind the 15 bridged players, career span, derived vs source final season'
SELECT p.id, p.display_name, p.legacy_player_id,
       pcs.debut_season, pcs.final_season, pcs.games, pcs.clubs_played,
       (SELECT max(m.season) FROM player_match_stats x JOIN matches m ON m.id = x.match_id
         WHERE x.player_id = p.id) AS pms_final_season,
       (SELECT count(*) FROM player_match_stats x WHERE x.player_id = p.id) AS pms_games
  FROM players p
  LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
 WHERE p.id IN (2489, 12093, 2502, 5927, 59, 11061, 2126, 7870, 3305, 2111, 2109, 6461, 669, 3581, 4006)
 ORDER BY p.id;

\qecho '== Q0b. any other player row sharing one of those display names (split identity check)'
SELECT p.display_name, array_agg(p.id ORDER BY p.id) AS player_ids, count(*) AS rows
  FROM players p
 WHERE p.display_name IN (SELECT display_name FROM players
                           WHERE id IN (2489, 12093, 2502, 5927, 59, 11061, 2126, 7870, 3305, 2111, 2109, 6461, 669, 3581, 4006))
 GROUP BY p.display_name
 ORDER BY p.display_name;

\qecho '== Q0c. match horizon (the corpus harness fairness test reads max(matches.season))'
SELECT max(season) AS max_match_season,
       count(*) FILTER (WHERE season = 2026) AS matches_2026,
       max(match_date) FILTER (WHERE season = 2026) AS last_2026_match
  FROM matches;

\qecho '== Q0d. derived-table drift: players whose player_career_stats.final_season disagrees with player_match_stats'
SELECT count(*) AS players_with_stale_final_season
  FROM player_career_stats pcs
  JOIN (SELECT x.player_id, max(m.season) AS s FROM player_match_stats x JOIN matches m ON m.id = x.match_id
         GROUP BY x.player_id) src ON src.player_id = pcs.player_id
 WHERE pcs.final_season IS DISTINCT FROM src.s;

-- ---------------------------------------------------------------------------
-- Family A: captain -> club_captain_any (grid-solver.ts, `case 'club_captain_any'`)
\qecho '== Q1a. every captaincies row on either player id, or a raw name matching Bruce / May, any link status'
SELECT c.id, c.season, cl.name AS club, c.player_id, c.player_name_raw,
       c.link_status_value::text AS link_status, c.role, c.period, c.notes, c.source_record_id
  FROM captaincies c
  JOIN clubs cl ON cl.id = c.club_id
 WHERE c.player_id IN (2489, 12093)
    OR c.player_name_raw ~* '(cameron bruce|\mbruce\M|steven may|steve may|\mmay\M)'
 ORDER BY c.season, cl.name, c.player_name_raw;

\qecho '== Q1b. the captain(s) recorded for every club-season either player played'
WITH career AS (
  SELECT DISTINCT s.player_id, s.season, cl.organization_id
    FROM player_club_season_stats s
    JOIN clubs cl ON cl.id = s.club_id
   WHERE s.player_id IN (2489, 12093)
)
SELECT k.player_id, k.season, co.slug AS organization,
       string_agg(c.player_name_raw || ' [' || c.link_status_value::text
                  || coalesce(', ' || c.period, '') || ']', '; ' ORDER BY c.player_name_raw) AS captains_recorded
  FROM career k
  JOIN club_organizations co ON co.id = k.organization_id
  LEFT JOIN captaincies c
         ON c.season = k.season
        AND c.club_id IN (SELECT id FROM clubs WHERE organization_id = k.organization_id)
 GROUP BY k.player_id, k.season, co.slug
 ORDER BY k.player_id, k.season;

\qecho '== Q1c. captaincies totals (ISSUE-118 §23.21 loaded 1,774 rows, 1,774 trusted)'
SELECT count(*) AS rows,
       count(*) FILTER (WHERE player_id IS NOT NULL AND link_status_value IN ('unique', 'resolved')) AS trusted,
       min(season) AS min_season, max(season) AS max_season
  FROM captaincies;

-- ---------------------------------------------------------------------------
-- Family B: teammates-150 / teammates-100 -> career_teammates_min (grid-solver.ts:425-455)
\qecho '== Q2a. games-grain teammate recount per player: identity grain (the builder) and organization grain'
WITH targets(player_id, threshold) AS (
  VALUES (2502, 150), (5927, 150), (59, 150), (11061, 150), (2126, 150), (7870, 150),
         (3305, 150), (2111, 150), (2109, 150), (6461, 150), (669, 100)
)
SELECT t.player_id, p.display_name, t.threshold,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN player_club_season_stats o
            ON o.season = me.season AND o.club_id = me.club_id AND o.player_id <> me.player_id
         WHERE me.player_id = t.player_id) AS teammates_builder_grain,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN clubs mc ON mc.id = me.club_id
          JOIN player_club_season_stats o ON o.season = me.season AND o.player_id <> me.player_id
          JOIN clubs oc ON oc.id = o.club_id AND oc.organization_id = mc.organization_id
         WHERE me.player_id = t.player_id) AS teammates_org_grain,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN player_club_season_stats o
            ON o.season = me.season AND o.club_id = me.club_id AND o.player_id <> me.player_id
         WHERE me.player_id = t.player_id AND me.season <= 2000) AS teammates_to_2000
  FROM targets t
  JOIN players p ON p.id = t.player_id
 ORDER BY t.player_id;

\qecho '== Q2b. per club-season roster coverage for the same 11 players (a thin roster against a full fixture = data hole)'
SELECT me.player_id, me.season, cl.name AS club, me.games AS own_games,
       (SELECT count(*) FROM player_club_season_stats o
         WHERE o.season = me.season AND o.club_id = me.club_id) AS players_who_played,
       (SELECT count(*) FROM matches m
         WHERE m.season = me.season AND me.club_id IN (m.home_club_id, m.away_club_id)) AS club_matches,
       (SELECT count(*) FROM player_match_stats x JOIN matches m ON m.id = x.match_id
         WHERE m.season = me.season AND x.club_id = me.club_id) AS club_player_games
  FROM player_club_season_stats me
  JOIN clubs cl ON cl.id = me.club_id
 WHERE me.player_id IN (2502, 5927, 59, 11061, 2126, 7870, 3305, 2111, 2109, 6461, 669)
 ORDER BY me.player_id, me.season, cl.name;

\qecho '== Q2c. whole-population eligible counts (ISSUE-118 §22.6 recorded 3,580 at 100 and 995 at 150)'
WITH rosters AS (
  SELECT season, club_id, array_agg(player_id) AS players
    FROM player_club_season_stats
   GROUP BY season, club_id
), counts AS (
  SELECT t.player_id, count(DISTINCT t.other) AS n
    FROM (SELECT s.player_id, unnest(r.players) AS other
            FROM player_club_season_stats s
            JOIN rosters r ON r.season = s.season AND r.club_id = s.club_id) t
   WHERE t.other <> t.player_id
   GROUP BY t.player_id
)
SELECT count(*) FILTER (WHERE n >= 100) AS eligible_100,
       count(*) FILTER (WHERE n >= 150) AS eligible_150
  FROM counts;

-- ---------------------------------------------------------------------------
-- Family C: games250sameclub / games100clubs2 -> games_at_*_incl_merged (grid-solver.ts:324-343)
\qecho '== Q3a. player_clubs by club identity, with the organization the builder groups by'
SELECT pc.player_id, cl.id AS club_id, cl.name AS club, co.slug AS organization,
       coalesce((SELECT r.to_organization_id FROM club_organization_relations r
                  WHERE r.from_organization_id = cl.organization_id AND r.relation = 'merged_into'),
                cl.organization_id) AS merged_organization_id,
       pc.games, pc.first_season, pc.last_season
  FROM player_clubs pc
  JOIN clubs cl ON cl.id = pc.club_id
  JOIN club_organizations co ON co.id = cl.organization_id
 WHERE pc.player_id IN (3581, 4006)
 ORDER BY pc.player_id, pc.first_season;

\qecho '== Q3b. source recount from player_match_stats per season and club identity'
SELECT x.player_id, m.season, cl.name AS club, count(*) AS games,
       count(*) FILTER (WHERE m.is_final) AS finals
  FROM player_match_stats x
  JOIN matches m ON m.id = x.match_id
  JOIN clubs cl ON cl.id = x.club_id
 WHERE x.player_id IN (3581, 4006)
 GROUP BY x.player_id, m.season, cl.name
 ORDER BY x.player_id, m.season, cl.name;

\qecho '== Q3c. club fixture size per season for every organization either player represented (missing matches check)'
SELECT co.slug AS organization, m.season, count(*) AS club_matches,
       count(*) FILTER (WHERE m.is_final) AS club_finals
  FROM matches m
  JOIN clubs cl ON cl.id IN (m.home_club_id, m.away_club_id)
  JOIN club_organizations co ON co.id = cl.organization_id
 WHERE cl.organization_id IN (SELECT c2.organization_id FROM clubs c2
                               WHERE c2.id IN (SELECT club_id FROM player_clubs WHERE player_id IN (3581, 4006)))
   AND m.season BETWEEN 2010 AND 2026
 GROUP BY co.slug, m.season
 ORDER BY co.slug, m.season;

ROLLBACK;
