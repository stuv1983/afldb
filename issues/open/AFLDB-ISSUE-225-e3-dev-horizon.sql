-- AFLDB-ISSUE-225 evidence pass E3 -- afldb_dev ONLY, READ ONLY.
--
-- Purpose: the horizon-dependent facts E2 could not supply, because afldb_test now ends at
-- season 2025 (E2 Q0c: max_match_season 2025, matches_2026 0). Nothing else is read.
--   H.  DEV match horizon and 2026 fixture size for the organizations involved
--   I.  identities, with derived-career against source agreement
--   C.  David Swallow  games250sameclub  (cell board 938, 2026-02-08)
--       Dylan Shiel    games100clubs2    (cell board 967, 2026-03-09; first listed board 887, 2025-12-19)
--   T.  Darcy Tucker   teammates-150     (cell board 1024, 2026-05-05)
--   A.  derived against source agreement for exactly those rows
--
-- afldb_dev ids are NOT the afldb_test corpus-bridge ids (3581 / 4006 / 3305), and
-- afldb_test carries no legacy_player_id for them (E2 Q0a). This file therefore resolves the
-- three players by display_name and prints every matching row in I. A name matching more
-- than one row is reported per id, never merged.
--
-- One READ ONLY transaction: the guard runs first, ROLLBACK runs last. CREATE is refused
-- in a read-only transaction, so every section repeats its own CTE. Run it only as runbook
-- issues/open/AFLDB-ISSUE-225.md section 7 (E3) gives it, with psql -v ON_ERROR_STOP=1.
-- ASCII only: the operator transport may pass this file through PowerShell.

\pset pager off
\pset null '(null)'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

\qecho '== G. target guard'
SELECT current_database() AS database,
       current_user AS role,
       current_setting('transaction_read_only') AS transaction_read_only,
       inet_server_port() AS server_port,
       now() AS observed_at;

DO $$
BEGIN
  IF current_database() <> 'afldb_dev' THEN
    RAISE EXCEPTION 'ISSUE-225 E3: refusing database %, afldb_dev only', current_database();
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'ISSUE-225 E3: transaction is not read-only';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
\qecho '== H1. DEV match horizon (afldb_test E2 Q0c: max 2025, 0 matches in 2026)'
SELECT max(season) AS max_match_season,
       count(*) FILTER (WHERE season = 2026) AS matches_2026,
       count(*) FILTER (WHERE season = 2026 AND is_final) AS finals_2026,
       min(match_date) FILTER (WHERE season = 2026) AS first_2026_match,
       max(match_date) FILTER (WHERE season = 2026) AS last_2026_match
  FROM matches;

\qecho '== H2. 2026 fixture size per organization any of the three players represented (completeness check)'
WITH orgs AS (
  SELECT DISTINCT c2.organization_id
    FROM players p
    JOIN player_clubs pc ON pc.player_id = p.id
    JOIN clubs c2 ON c2.id = pc.club_id
   WHERE p.display_name IN ('David Swallow', 'Dylan Shiel', 'Darcy Tucker')
)
SELECT co.slug AS organization,
       (SELECT count(*) FROM matches m JOIN clubs cl ON cl.id IN (m.home_club_id, m.away_club_id)
         WHERE m.season = 2026 AND cl.organization_id = o.organization_id) AS club_matches_2026,
       (SELECT count(*) FROM matches m JOIN clubs cl ON cl.id IN (m.home_club_id, m.away_club_id)
         WHERE m.season = 2026 AND m.is_final AND cl.organization_id = o.organization_id) AS club_finals_2026,
       (SELECT max(m.match_date) FROM matches m JOIN clubs cl ON cl.id IN (m.home_club_id, m.away_club_id)
         WHERE m.season = 2026 AND cl.organization_id = o.organization_id) AS last_match_2026,
       (SELECT count(*) FROM player_match_stats x JOIN matches m ON m.id = x.match_id JOIN clubs cl ON cl.id = x.club_id
         WHERE m.season = 2026 AND cl.organization_id = o.organization_id) AS club_player_games_2026
  FROM orgs o
  JOIN club_organizations co ON co.id = o.organization_id
 ORDER BY co.slug;

-- ---------------------------------------------------------------------------
\qecho '== I. identities resolved by name; derived career (player_career_stats) against source (player_match_stats)'
SELECT p.id AS player_id, p.display_name, p.slug, p.legacy_player_id,
       pcs.debut_season, pcs.final_season, pcs.games, pcs.clubs_played,
       src.pms_final_season, src.pms_games,
       (pcs.final_season IS NOT DISTINCT FROM src.pms_final_season
        AND pcs.games IS NOT DISTINCT FROM src.pms_games) AS career_derived_agrees
  FROM players p
  LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
  LEFT JOIN LATERAL (SELECT max(m.season) AS pms_final_season, count(*) AS pms_games
                       FROM player_match_stats x JOIN matches m ON m.id = x.match_id
                      WHERE x.player_id = p.id) src ON true
 WHERE p.display_name IN ('David Swallow', 'Dylan Shiel', 'Darcy Tucker')
 ORDER BY p.display_name, p.id;

-- ---------------------------------------------------------------------------
-- Family C: games250sameclub / games100clubs2 -> games_at_*_incl_merged (grid-solver.ts)
\qecho '== C1. Swallow and Shiel: source recount per season and organization, with provenance (compare E2 Q3b)'
SELECT p.display_name, x.player_id, m.season, co.slug AS organization,
       count(*) AS games,
       count(*) FILTER (WHERE m.is_final) AS finals,
       string_agg(DISTINCT coalesce(s.key, '(null)'), ',') AS pms_sources
  FROM players p
  JOIN player_match_stats x ON x.player_id = p.id
  JOIN matches m ON m.id = x.match_id
  JOIN clubs cl ON cl.id = x.club_id
  JOIN club_organizations co ON co.id = cl.organization_id
  LEFT JOIN sources s ON s.id = x.source_id
 WHERE p.display_name IN ('David Swallow', 'Dylan Shiel')
 GROUP BY p.display_name, x.player_id, m.season, co.slug
 ORDER BY p.display_name, x.player_id, m.season, co.slug;

\qecho '== C2. Swallow and Shiel: games per merged organization (the builder grain) at each horizon'
WITH t(display_name, cell_board_date, first_listed_date) AS (
  VALUES ('David Swallow', DATE '2026-02-08', DATE '2026-02-08'),
         ('Dylan Shiel',   DATE '2026-03-09', DATE '2025-12-19')
), r AS (
  SELECT t.display_name, t.cell_board_date, t.first_listed_date, x.player_id,
         m.season, m.match_date, co.slug,
         coalesce((SELECT rel.to_organization_id FROM club_organization_relations rel
                    WHERE rel.from_organization_id = cl.organization_id AND rel.relation = 'merged_into'),
                  cl.organization_id) AS merged_organization_id
    FROM t
    JOIN players p ON p.display_name = t.display_name
    JOIN player_match_stats x ON x.player_id = p.id
    JOIN matches m ON m.id = x.match_id
    JOIN clubs cl ON cl.id = x.club_id
    JOIN club_organizations co ON co.id = cl.organization_id
)
SELECT display_name, player_id, merged_organization_id,
       string_agg(DISTINCT slug, ',') AS organizations,
       count(*) AS games_all,
       count(*) FILTER (WHERE season <= 2025) AS games_to_2025,
       count(*) FILTER (WHERE season = 2026) AS games_2026,
       count(*) FILTER (WHERE match_date < first_listed_date) AS games_before_first_listed_board,
       count(*) FILTER (WHERE match_date < cell_board_date) AS games_before_cell_board,
       max(match_date) AS last_match
  FROM r
 GROUP BY display_name, player_id, merged_organization_id
 ORDER BY display_name, player_id, merged_organization_id;

\qecho '== C3. every 2026 match row for the three players (0 rows = no 2026 game on afldb_dev)'
SELECT p.display_name, x.player_id, m.match_date, m.round_code, m.is_final,
       cl.name AS club, opp.name AS opponent, s.key AS source, x.import_batch_id
  FROM players p
  JOIN player_match_stats x ON x.player_id = p.id
  JOIN matches m ON m.id = x.match_id AND m.season = 2026
  JOIN clubs cl ON cl.id = x.club_id
  JOIN clubs opp ON opp.id = CASE WHEN m.home_club_id = x.club_id THEN m.away_club_id ELSE m.home_club_id END
  LEFT JOIN sources s ON s.id = x.source_id
 WHERE p.display_name IN ('David Swallow', 'Dylan Shiel', 'Darcy Tucker')
 ORDER BY p.display_name, m.match_date;

-- ---------------------------------------------------------------------------
-- Family B: teammates-150 -> career_teammates_min(150) (grid-solver.ts)
\qecho '== T1. Darcy Tucker: club-seasons, derived (player_club_season_stats) against source (player_match_stats)'
WITH t AS (SELECT id AS player_id FROM players WHERE display_name = 'Darcy Tucker'),
d AS (
  SELECT s.player_id, s.season, s.club_id, s.games
    FROM player_club_season_stats s JOIN t ON t.player_id = s.player_id
), src AS (
  SELECT x.player_id, m.season, x.club_id, count(*) AS games
    FROM player_match_stats x JOIN matches m ON m.id = x.match_id JOIN t ON t.player_id = x.player_id
   GROUP BY x.player_id, m.season, x.club_id
)
SELECT coalesce(d.player_id, src.player_id) AS player_id,
       coalesce(d.season, src.season) AS season,
       cl.name AS club,
       d.games AS derived_games, src.games AS source_games,
       (d.games IS NOT DISTINCT FROM src.games) AS agrees
  FROM d
  FULL JOIN src ON src.player_id = d.player_id AND src.season = d.season AND src.club_id = d.club_id
  JOIN clubs cl ON cl.id = coalesce(d.club_id, src.club_id)
 ORDER BY 1, 2, 3;

\qecho '== T2. Darcy Tucker: teammate counts at each horizon (threshold 150; afldb_test E2 Q2a = 146, all through 2025)'
WITH t AS (SELECT id AS player_id, display_name FROM players WHERE display_name = 'Darcy Tucker')
SELECT t.player_id, t.display_name,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN player_club_season_stats o
            ON o.season = me.season AND o.club_id = me.club_id AND o.player_id <> me.player_id
         WHERE me.player_id = t.player_id) AS teammates_builder_grain_all,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN clubs mc ON mc.id = me.club_id
          JOIN player_club_season_stats o ON o.season = me.season AND o.player_id <> me.player_id
          JOIN clubs oc ON oc.id = o.club_id AND oc.organization_id = mc.organization_id
         WHERE me.player_id = t.player_id) AS teammates_org_grain_all,
       (SELECT count(DISTINCT o.player_id)
          FROM player_club_season_stats me
          JOIN player_club_season_stats o
            ON o.season = me.season AND o.club_id = me.club_id AND o.player_id <> me.player_id
         WHERE me.player_id = t.player_id AND me.season <= 2025) AS teammates_builder_grain_to_2025,
       (SELECT count(DISTINCT o.player_id)
          FROM (SELECT DISTINCT m.season, x.club_id
                  FROM player_match_stats x JOIN matches m ON m.id = x.match_id
                 WHERE x.player_id = t.player_id AND m.match_date < DATE '2026-05-05') me
          JOIN matches m2 ON m2.season = me.season AND m2.match_date < DATE '2026-05-05'
          JOIN player_match_stats o
            ON o.match_id = m2.id AND o.club_id = me.club_id AND o.player_id <> t.player_id) AS teammates_source_as_at_board_1024
  FROM t
 ORDER BY t.player_id;

\qecho '== T3. Darcy Tucker 2026 club-seasons: derived roster against source roster and fixture (0 rows = no 2026 game)'
WITH t AS (SELECT id AS player_id FROM players WHERE display_name = 'Darcy Tucker'),
cs AS (
  SELECT DISTINCT x.club_id
    FROM player_match_stats x JOIN matches m ON m.id = x.match_id JOIN t ON t.player_id = x.player_id
   WHERE m.season = 2026
)
SELECT cl.name AS club,
       (SELECT count(*) FROM player_club_season_stats s
         WHERE s.season = 2026 AND s.club_id = cs.club_id) AS derived_roster_2026,
       (SELECT count(DISTINCT x.player_id) FROM player_match_stats x JOIN matches m ON m.id = x.match_id
         WHERE m.season = 2026 AND x.club_id = cs.club_id) AS source_roster_2026,
       (SELECT count(*) FROM matches m
         WHERE m.season = 2026 AND cs.club_id IN (m.home_club_id, m.away_club_id)) AS club_matches_2026,
       (SELECT count(*) FROM player_match_stats x JOIN matches m ON m.id = x.match_id
         WHERE m.season = 2026 AND x.club_id = cs.club_id) AS club_player_games_2026
  FROM cs
  JOIN clubs cl ON cl.id = cs.club_id
 ORDER BY cl.name;

-- ---------------------------------------------------------------------------
\qecho '== A1. player_clubs against player_match_stats per club identity, all three players'
WITH t AS (
  SELECT id AS player_id, display_name FROM players
   WHERE display_name IN ('David Swallow', 'Dylan Shiel', 'Darcy Tucker')
), d AS (
  SELECT pc.player_id, pc.club_id, pc.games, pc.first_season, pc.last_season
    FROM player_clubs pc JOIN t ON t.player_id = pc.player_id
), src AS (
  SELECT x.player_id, x.club_id, count(*) AS games, min(m.season) AS first_season, max(m.season) AS last_season
    FROM player_match_stats x JOIN matches m ON m.id = x.match_id JOIN t ON t.player_id = x.player_id
   GROUP BY x.player_id, x.club_id
)
SELECT t.display_name, t.player_id, cl.name AS club,
       d.games AS derived_games, src.games AS source_games,
       d.first_season, d.last_season,
       src.first_season AS source_first_season, src.last_season AS source_last_season,
       (d.games IS NOT DISTINCT FROM src.games
        AND d.first_season IS NOT DISTINCT FROM src.first_season
        AND d.last_season IS NOT DISTINCT FROM src.last_season) AS agrees
  FROM d
  FULL JOIN src ON src.player_id = d.player_id AND src.club_id = d.club_id
  JOIN t ON t.player_id = coalesce(d.player_id, src.player_id)
  JOIN clubs cl ON cl.id = coalesce(d.club_id, src.club_id)
 ORDER BY t.display_name, t.player_id, coalesce(d.first_season, src.first_season);

\qecho '== A2. player_club_season_stats against player_match_stats, Swallow and Shiel (only disagreeing rows print; expect 0 rows)'
WITH t AS (
  SELECT id AS player_id, display_name FROM players
   WHERE display_name IN ('David Swallow', 'Dylan Shiel')
), d AS (
  SELECT s.player_id, s.season, s.club_id, s.games
    FROM player_club_season_stats s JOIN t ON t.player_id = s.player_id
), src AS (
  SELECT x.player_id, m.season, x.club_id, count(*) AS games
    FROM player_match_stats x JOIN matches m ON m.id = x.match_id JOIN t ON t.player_id = x.player_id
   GROUP BY x.player_id, m.season, x.club_id
)
SELECT t.display_name, t.player_id, coalesce(d.season, src.season) AS season, cl.name AS club,
       d.games AS derived_games, src.games AS source_games
  FROM d
  FULL JOIN src ON src.player_id = d.player_id AND src.season = d.season AND src.club_id = d.club_id
  JOIN t ON t.player_id = coalesce(d.player_id, src.player_id)
  JOIN clubs cl ON cl.id = coalesce(d.club_id, src.club_id)
 WHERE d.games IS DISTINCT FROM src.games
 ORDER BY t.display_name, t.player_id, 3;

ROLLBACK;
