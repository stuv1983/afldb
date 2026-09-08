-- AFLDB-ISSUE-152 — NL record-family evidence pack
-- Read-only discovery queries for afldb_test / DEV-compatible schema.
--
-- Purpose:
--   Give ISSUE-152 Stage 0 concrete witnesses, coverage boundaries, NULL/link
--   behaviour and independently-derived aggregates before changing NL semantics.
--
-- Safety:
--   This script starts a READ ONLY transaction and performs SELECTs only.
--   It intentionally does not call db:status, migrations, loaders or any write path.
--
-- Source contracts checked against current main:
--   coaches + match_coaches       migration 087
--   after_siren_kicks             migration 089
--   player_relationships          migration 006
--   father_son_selections         migration 006
--   player_achievements           migration 053
--
-- Run with psql -X -v ON_ERROR_STOP=1 -f ISSUE-152-nl-evidence.sql

\pset pager off
\pset null '∅'
\timing on

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '====================================================================='
\echo 'AFLDB-ISSUE-152 NL EVIDENCE PACK'
\echo '====================================================================='

-- ---------------------------------------------------------------------
-- 0. Inventory / coverage boundaries
-- ---------------------------------------------------------------------

\echo ''
\echo '=== 0.1 Canonical row counts and trusted-link counts ==='
SELECT 'coaches' AS family,
       count(*)::bigint AS rows,
       count(*) FILTER (WHERE player_id IS NOT NULL)::bigint AS linked_rows,
       count(*) FILTER (WHERE player_id IS NULL)::bigint AS unlinked_rows
  FROM coaches
UNION ALL
SELECT 'match_coaches',
       count(*)::bigint,
       count(*)::bigint,
       0::bigint
  FROM match_coaches
UNION ALL
SELECT 'after_siren_kicks',
       count(*)::bigint,
       count(*) FILTER (WHERE player_id IS NOT NULL)::bigint,
       count(*) FILTER (WHERE player_id IS NULL)::bigint
  FROM after_siren_kicks
UNION ALL
SELECT 'player_relationships',
       count(*)::bigint,
       count(*) FILTER (
         WHERE person_a_player_id IS NOT NULL
           AND person_b_player_id IS NOT NULL
       )::bigint,
       count(*) FILTER (
         WHERE person_a_player_id IS NULL
            OR person_b_player_id IS NULL
       )::bigint
  FROM player_relationships
UNION ALL
SELECT 'father_son_selections',
       count(*)::bigint,
       count(*) FILTER (
         WHERE drafted_player_id IS NOT NULL
           AND father_player_id IS NOT NULL
       )::bigint,
       count(*) FILTER (
         WHERE drafted_player_id IS NULL
            OR father_player_id IS NULL
       )::bigint
  FROM father_son_selections
UNION ALL
SELECT 'first_kick_goal',
       count(*)::bigint,
       count(*) FILTER (WHERE player_id IS NOT NULL)::bigint,
       count(*) FILTER (WHERE player_id IS NULL)::bigint
  FROM player_achievements
 WHERE achievement_type = 'first_kick_goal'
ORDER BY family;

\echo ''
\echo '=== 0.2 Season/date coverage by family ==='
SELECT 'coaching' AS family,
       min(m.season)::int AS first_season,
       max(m.season)::int AS last_season,
       min(m.match_date) AS first_date,
       max(m.match_date) AS last_date
  FROM match_coaches mc
  JOIN matches m ON m.id = mc.match_id
UNION ALL
SELECT 'after_siren_kicks',
       min(a.season)::int,
       max(a.season)::int,
       min(m.match_date),
       max(m.match_date)
  FROM after_siren_kicks a
  LEFT JOIN matches m ON m.id = a.match_id
UNION ALL
SELECT 'father_son_selections',
       min(f.draft_year)::int,
       max(f.draft_year)::int,
       NULL::date,
       NULL::date
  FROM father_son_selections f
UNION ALL
SELECT 'first_kick_goal',
       min(a.season)::int,
       max(a.season)::int,
       min(m.match_date),
       max(m.match_date)
  FROM player_achievements a
  LEFT JOIN matches m ON m.id = a.match_id
 WHERE a.achievement_type = 'first_kick_goal'
ORDER BY family;

-- ---------------------------------------------------------------------
-- 1. COACHING
-- Canonical grain: one match_coaches row per (match, club), migration 087.
-- W/D/L is derived from matches, never coaches.source_games_coached.
-- Draw-weighted win percentage follows the existing public coach UI:
--   (wins + draws * 0.5) / games * 100
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '1. COACHING'
\echo '====================================================================='

\echo ''
\echo '=== 1.1 Coaching career leaders — games / W-D-L / span ==='
WITH x AS (
  SELECT c.id AS coach_id,
         c.display_name,
         c.player_id,
         min(m.season)::int AS first_season,
         max(m.season)::int AS last_season,
         count(*)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
         count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
         count(*) FILTER (
           WHERE m.winner_club_id IS NOT NULL
             AND m.winner_club_id <> mc.club_id
         )::int AS losses,
         count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
         count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS grand_finals,
         count(*) FILTER (
           WHERE m.round_type = 'grand_final'
             AND m.winner_club_id = mc.club_id
         )::int AS premierships
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name, c.player_id
)
SELECT *,
       round(((wins + draws * 0.5) * 100.0 / games)::numeric, 2) AS win_pct
  FROM x
 ORDER BY games DESC, display_name
 LIMIT 25;

\echo ''
\echo '=== 1.2 Coaching leaders by wins ==='
SELECT c.id AS coach_id,
       c.display_name,
       count(*)::int AS games,
       count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
       count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
       count(*) FILTER (
         WHERE m.winner_club_id IS NOT NULL
           AND m.winner_club_id <> mc.club_id
       )::int AS losses
  FROM coaches c
  JOIN match_coaches mc ON mc.coach_id = c.id
  JOIN matches m ON m.id = mc.match_id
 GROUP BY c.id, c.display_name
 ORDER BY wins DESC, games DESC, c.display_name
 LIMIT 25;

\echo ''
\echo '=== 1.3 Best coaching win percentage with 50+ games ==='
WITH x AS (
  SELECT c.id AS coach_id,
         c.display_name,
         count(*)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
         count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
         count(*) FILTER (
           WHERE m.winner_club_id IS NOT NULL
             AND m.winner_club_id <> mc.club_id
         )::int AS losses
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT *,
       round(((wins + draws * 0.5) * 100.0 / games)::numeric, 2) AS win_pct
  FROM x
 WHERE games >= 50
 ORDER BY ((wins + draws * 0.5) * 1.0 / games) DESC,
          games DESC,
          display_name
 LIMIT 25;

\echo ''
\echo '=== 1.4 Richmond coaching records — organization lineage scoped ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
)
SELECT c.id AS coach_id,
       c.display_name,
       min(m.season)::int AS first_season,
       max(m.season)::int AS last_season,
       count(DISTINCT m.season)::int AS seasons,
       count(*)::int AS games,
       count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
       count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
       count(*) FILTER (
         WHERE m.winner_club_id IS NOT NULL
           AND m.winner_club_id <> mc.club_id
       )::int AS losses,
       round((
         (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
           + count(*) FILTER (WHERE m.winner_club_id IS NULL) * 0.5)
         * 100.0 / count(*)
       )::numeric, 2) AS win_pct
  FROM match_coaches mc
  JOIN matches m ON m.id = mc.match_id
  JOIN coaches c ON c.id = mc.coach_id
 WHERE mc.club_id IN (
   SELECT id FROM clubs
    WHERE organization_id = (SELECT organization_id FROM target)
 )
 GROUP BY c.id, c.display_name
 ORDER BY games DESC, wins DESC, c.display_name;

\echo ''
\echo '=== 1.5 Coaches of Richmond in 2017 — season witness ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
)
SELECT c.id AS coach_id,
       c.display_name,
       count(*)::int AS games,
       count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
       count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
       count(*) FILTER (
         WHERE m.winner_club_id IS NOT NULL
           AND m.winner_club_id <> mc.club_id
       )::int AS losses
  FROM match_coaches mc
  JOIN matches m ON m.id = mc.match_id
  JOIN coaches c ON c.id = mc.coach_id
 WHERE m.season = 2017
   AND mc.club_id IN (
     SELECT id FROM clubs
      WHERE organization_id = (SELECT organization_id FROM target)
   )
 GROUP BY c.id, c.display_name
 ORDER BY games DESC, c.display_name;

\echo ''
\echo '=== 1.6 Coaches who coached more than one organization ==='
SELECT c.id AS coach_id,
       c.display_name,
       count(DISTINCT cl.organization_id)::int AS organizations,
       count(DISTINCT mc.club_id)::int AS club_identities,
       count(*)::int AS games
  FROM coaches c
  JOIN match_coaches mc ON mc.coach_id = c.id
  JOIN clubs cl ON cl.id = mc.club_id
 GROUP BY c.id, c.display_name
HAVING count(DISTINCT cl.organization_id) > 1
 ORDER BY organizations DESC, games DESC, c.display_name
 LIMIT 50;

\echo ''
\echo '=== 1.7 People who both played and coached — identity seam ==='
SELECT c.id AS coach_id,
       c.display_name AS coach_name,
       c.player_id,
       p.display_name AS player_name,
       pcs.games AS playing_games,
       count(mc.match_id)::int AS coached_games
  FROM coaches c
  JOIN players p ON p.id = c.player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
  LEFT JOIN match_coaches mc ON mc.coach_id = c.id
 WHERE c.link_status_value = 'unique'
 GROUP BY c.id, c.display_name, c.player_id, p.display_name, pcs.games
 ORDER BY coached_games DESC, p.display_name
 LIMIT 50;

\echo ''
\echo '=== 1.8 Coaching identity/link boundary ==='
SELECT link_status_value,
       count(*)::int AS coaches,
       count(*) FILTER (WHERE player_id IS NOT NULL)::int AS with_player_link,
       count(*) FILTER (WHERE player_id IS NULL)::int AS coach_only
  FROM coaches
 GROUP BY link_status_value
 ORDER BY link_status_value;

-- ---------------------------------------------------------------------
-- 2. AFTER-THE-SIREN
-- Canonical curated event table. Do not infer event semantics from scores.
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '2. AFTER-THE-SIREN'
\echo '====================================================================='

\echo ''
\echo '=== 2.1 Event-domain distribution ==='
SELECT premiership_season,
       kick_scored,
       kick_effect,
       kicker_result,
       siren,
       count(*)::int AS events
  FROM after_siren_kicks
 GROUP BY premiership_season, kick_scored, kick_effect, kicker_result, siren
 ORDER BY premiership_season DESC, kick_scored, kick_effect, kicker_result, siren;

\echo ''
\echo '=== 2.2 Competition and match-link coverage ==='
SELECT competition,
       premiership_season,
       count(*)::int AS events,
       count(*) FILTER (WHERE match_id IS NOT NULL)::int AS linked_matches,
       count(*) FILTER (WHERE match_id IS NULL)::int AS unlinked_matches
  FROM after_siren_kicks
 GROUP BY competition, premiership_season
 ORDER BY events DESC, competition;

\echo ''
\echo '=== 2.3 Player-link / citation boundary ==='
SELECT link_status_value,
       cited,
       count(*)::int AS events,
       count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked_players,
       count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked_players
  FROM after_siren_kicks
 GROUP BY link_status_value, cited
 ORDER BY link_status_value, cited DESC;

\echo ''
\echo '=== 2.4 Leaders — all after-siren kicks / goals / winning goals ==='
SELECT p.id AS player_id,
       p.display_name,
       count(*)::int AS kicks,
       count(*) FILTER (WHERE a.kick_scored = 'goal')::int AS goals,
       count(*) FILTER (WHERE a.kick_scored = 'behind')::int AS behinds,
       count(*) FILTER (WHERE a.kick_scored = 'none')::int AS no_score,
       count(*) FILTER (WHERE a.kick_effect = 'won')::int AS game_winners,
       count(*) FILTER (
         WHERE a.kick_effect = 'won' AND a.kick_scored = 'goal'
       )::int AS winning_goals,
       count(*) FILTER (WHERE a.kick_effect = 'drew')::int AS game_draws
  FROM after_siren_kicks a
  JOIN players p ON p.id = a.player_id
 GROUP BY p.id, p.display_name
 ORDER BY kicks DESC, goals DESC, game_winners DESC, p.display_name
 LIMIT 50;

\echo ''
\echo '=== 2.5 Goals after the siren against Richmond — organization lineage ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
)
SELECT a.id AS event_id,
       a.season,
       a.round_raw,
       p.display_name AS player,
       club.name AS club,
       opp.name AS opponent,
       a.kick_scored,
       a.kick_effect,
       a.kicker_result,
       a.siren,
       a.match_id
  FROM after_siren_kicks a
  LEFT JOIN players p ON p.id = a.player_id
  LEFT JOIN clubs club ON club.id = a.club_id
  LEFT JOIN clubs opp ON opp.id = a.opponent_club_id
 WHERE a.kick_scored = 'goal'
   AND a.opponent_club_id IN (
     SELECT id FROM clubs
      WHERE organization_id = (SELECT organization_id FROM target)
   )
 ORDER BY a.season, a.id;

\echo ''
\echo '=== 2.6 After-siren scores that won or drew the match ==='
SELECT a.id AS event_id,
       a.season,
       a.round_raw,
       COALESCE(p.display_name, a.player_name_raw) AS player,
       a.club_name_raw,
       a.opponent_name_raw,
       a.kick_scored,
       a.kick_effect,
       a.kicker_result,
       a.siren,
       a.premiership_season,
       a.match_id
  FROM after_siren_kicks a
  LEFT JOIN players p ON p.id = a.player_id
 WHERE a.kick_effect IN ('won', 'drew')
 ORDER BY a.season DESC, a.id DESC
 LIMIT 100;

\echo ''
\echo '=== 2.7 After-siren events in finals ==='
SELECT a.id AS event_id,
       a.season,
       a.round_raw,
       COALESCE(p.display_name, a.player_name_raw) AS player,
       a.club_name_raw,
       a.opponent_name_raw,
       a.kick_scored,
       a.kick_effect,
       m.round_type,
       m.match_date
  FROM after_siren_kicks a
  JOIN matches m ON m.id = a.match_id
  LEFT JOIN players p ON p.id = a.player_id
 WHERE m.is_finals_series
 ORDER BY m.match_date DESC, a.id DESC;

\echo ''
\echo '=== 2.8 First and most recent linked premiership-season after-siren events ==='
WITH ranked AS (
  SELECT a.id,
         a.season,
         a.round_raw,
         a.player_id,
         COALESCE(p.display_name, a.player_name_raw) AS player,
         a.club_name_raw,
         a.opponent_name_raw,
         a.kick_scored,
         a.kick_effect,
         a.siren,
         a.match_id,
         m.match_date,
         row_number() OVER (ORDER BY m.match_date, a.id) AS rn_first,
         row_number() OVER (ORDER BY m.match_date DESC, a.id DESC) AS rn_last
    FROM after_siren_kicks a
    JOIN matches m ON m.id = a.match_id
    LEFT JOIN players p ON p.id = a.player_id
   WHERE a.premiership_season
)
SELECT CASE WHEN rn_first = 1 THEN 'first' ELSE 'most_recent' END AS boundary,
       id AS event_id,
       match_date,
       season,
       round_raw,
       player,
       club_name_raw,
       opponent_name_raw,
       kick_scored,
       kick_effect,
       siren,
       match_id
  FROM ranked
 WHERE rn_first = 1 OR rn_last = 1
 ORDER BY match_date, event_id;

-- ---------------------------------------------------------------------
-- 3. FAMILY / RELATIONSHIPS
-- Keep typed relationship values distinct. Do not infer "brother", sex,
-- biological direction, or AFL-playing status where the stored data does not.
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '3. FAMILY / RELATIONSHIPS'
\echo '====================================================================='

\echo ''
\echo '=== 3.1 Relationship types and link completeness ==='
SELECT relationship,
       count(*)::int AS rows,
       count(*) FILTER (
         WHERE person_a_player_id IS NOT NULL
           AND person_b_player_id IS NOT NULL
       )::int AS both_linked,
       count(*) FILTER (
         WHERE person_a_player_id IS NULL
            OR person_b_player_id IS NULL
       )::int AS one_or_both_unlinked,
       count(DISTINCT family_key) FILTER (WHERE family_key IS NOT NULL)::int AS families
  FROM player_relationships
 GROUP BY relationship
 ORDER BY rows DESC, relationship;

\echo ''
\echo '=== 3.2 Relationship labels — reveals semantics available beyond enum ==='
SELECT relationship,
       relationship_label,
       count(*)::int AS rows
  FROM player_relationships
 GROUP BY relationship, relationship_label
 ORDER BY relationship, rows DESC, relationship_label;

\echo ''
\echo '=== 3.3 Fully linked sibling witnesses ==='
SELECT r.id AS relationship_id,
       r.family_key,
       r.family_name,
       pa.id AS player_a_id,
       pa.display_name AS player_a,
       r.person_a_role,
       pb.id AS player_b_id,
       pb.display_name AS player_b,
       r.person_b_role,
       r.relationship_label,
       r.confidence
  FROM player_relationships r
  JOIN players pa ON pa.id = r.person_a_player_id
  JOIN players pb ON pb.id = r.person_b_player_id
 WHERE r.relationship = 'sibling'
 ORDER BY r.family_name NULLS LAST, pa.display_name, pb.display_name
 LIMIT 100;

\echo ''
\echo '=== 3.4 Fully linked parent-child witnesses ==='
SELECT r.id AS relationship_id,
       r.family_key,
       r.family_name,
       pa.id AS player_a_id,
       pa.display_name AS player_a,
       r.person_a_role,
       pb.id AS player_b_id,
       pb.display_name AS player_b,
       r.person_b_role,
       r.relationship_label,
       r.confidence
  FROM player_relationships r
  JOIN players pa ON pa.id = r.person_a_player_id
  JOIN players pb ON pb.id = r.person_b_player_id
 WHERE r.relationship = 'parent_child'
 ORDER BY r.family_name NULLS LAST, pa.display_name, pb.display_name
 LIMIT 100;

\echo ''
\echo '=== 3.5 Largest fully linked football families by family_key ==='
WITH members AS (
  SELECT family_key, person_a_player_id AS player_id
    FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id
    FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT m.family_key,
       count(DISTINCT m.player_id)::int AS linked_players,
       string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name) AS players
  FROM members m
  JOIN players p ON p.id = m.player_id
 GROUP BY m.family_key
 ORDER BY linked_players DESC, m.family_key
 LIMIT 50;

\echo ''
\echo '=== 3.6 Relationship rows with unlinked relatives — fail-closed boundary ==='
SELECT r.id,
       r.family_key,
       r.family_name,
       r.person_a_name,
       r.person_a_role,
       r.person_a_player_id,
       r.person_b_name,
       r.person_b_role,
       r.person_b_player_id,
       r.relationship,
       r.relationship_label,
       r.confidence
  FROM player_relationships r
 WHERE r.person_a_player_id IS NULL
    OR r.person_b_player_id IS NULL
 ORDER BY r.relationship, r.family_name NULLS LAST, r.id
 LIMIT 100;

-- ---------------------------------------------------------------------
-- 4. FATHER-SON SELECTIONS
-- This is a draft-selection fact and is distinct from general parent_child.
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '4. FATHER-SON SELECTIONS'
\echo '====================================================================='

\echo ''
\echo '=== 4.1 Father-son coverage and link statuses ==='
SELECT min(draft_year)::int AS first_draft_year,
       max(draft_year)::int AS last_draft_year,
       count(*)::int AS selections,
       count(*) FILTER (
         WHERE drafted_player_id IS NOT NULL
           AND father_player_id IS NOT NULL
       )::int AS both_linked,
       count(*) FILTER (WHERE drafted_player_id IS NULL)::int AS child_unlinked,
       count(*) FILTER (WHERE father_player_id IS NULL)::int AS father_unlinked
  FROM father_son_selections;

SELECT drafted_link_status,
       father_link_status,
       count(*)::int AS rows
  FROM father_son_selections
 GROUP BY drafted_link_status, father_link_status
 ORDER BY rows DESC, drafted_link_status, father_link_status;

\echo ''
\echo '=== 4.2 Father-son selections by club organization ==='
SELECT cl.organization_id,
       min(cl.name) AS example_club_name,
       count(*)::int AS selections,
       min(f.draft_year)::int AS first_year,
       max(f.draft_year)::int AS last_year
  FROM father_son_selections f
  JOIN clubs cl ON cl.id = f.club_id
 GROUP BY cl.organization_id
 ORDER BY selections DESC, example_club_name;

\echo ''
\echo '=== 4.3 Geelong father-son selections — concrete witness ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'geelong'
   ORDER BY id
   LIMIT 1
)
SELECT f.id,
       f.draft_year,
       f.drafted_player_id,
       COALESCE(child.display_name, f.drafted_player_name) AS drafted_player,
       f.drafted_link_status,
       f.father_player_id,
       COALESCE(father.display_name, f.father_name) AS father,
       f.father_link_status,
       cl.name AS selection_club,
       f.selection_pick,
       f.rule,
       f.competition
  FROM father_son_selections f
  LEFT JOIN players child ON child.id = f.drafted_player_id
  LEFT JOIN players father ON father.id = f.father_player_id
  LEFT JOIN clubs cl ON cl.id = f.club_id
 WHERE f.club_id IN (
   SELECT id FROM clubs
    WHERE organization_id = (SELECT organization_id FROM target)
 )
 ORDER BY f.draft_year, f.id;

\echo ''
\echo '=== 4.4 Fully linked father-son selection witnesses ==='
SELECT f.id,
       f.draft_year,
       child.id AS child_id,
       child.display_name AS child,
       father.id AS father_id,
       father.display_name AS father,
       cl.name AS club,
       f.selection_pick,
       f.rule
  FROM father_son_selections f
  JOIN players child ON child.id = f.drafted_player_id
  JOIN players father ON father.id = f.father_player_id
  LEFT JOIN clubs cl ON cl.id = f.club_id
 WHERE f.drafted_link_status IN ('unique', 'resolved')
   AND f.father_link_status IN ('unique', 'resolved')
 ORDER BY f.draft_year DESC, child.display_name
 LIMIT 100;

-- ---------------------------------------------------------------------
-- 5. FIRST-KICK GOAL
-- Curated player_achievements fact. The achievement itself is not derivable
-- from match totals; match_id is resolved by career position.
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '5. FIRST-KICK GOAL'
\echo '====================================================================='

\echo ''
\echo '=== 5.1 Coverage and link status ==='
SELECT min(season)::int AS first_season,
       max(season)::int AS last_season,
       count(*)::int AS rows,
       count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked_players,
       count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked_players,
       count(*) FILTER (WHERE match_id IS NOT NULL)::int AS linked_matches,
       count(*) FILTER (WHERE match_id IS NULL)::int AS unlinked_matches
  FROM player_achievements
 WHERE achievement_type = 'first_kick_goal';

SELECT link_status_value,
       count(*)::int AS rows
  FROM player_achievements
 WHERE achievement_type = 'first_kick_goal'
 GROUP BY link_status_value
 ORDER BY rows DESC, link_status_value;

\echo ''
\echo '=== 5.2 First-kick-goal source annotations / special semantics ==='
SELECT consecutive_goal_kicks,
       no_further_career_goals,
       no_further_career_kicks,
       kickless_matches_before_first_kick,
       count(*)::int AS rows
  FROM player_achievements
 WHERE achievement_type = 'first_kick_goal'
 GROUP BY consecutive_goal_kicks,
          no_further_career_goals,
          no_further_career_kicks,
          kickless_matches_before_first_kick
 ORDER BY rows DESC,
          consecutive_goal_kicks DESC,
          kickless_matches_before_first_kick DESC;

\echo ''
\echo '=== 5.3 First and most recent resolved first-kick goals ==='
WITH ranked AS (
  SELECT a.id,
         a.season,
         a.round_raw,
         a.player_id,
         COALESCE(p.display_name, a.player_name_raw) AS player,
         a.club_id,
         a.club_name_raw,
         a.match_id,
         m.match_date,
         row_number() OVER (
           ORDER BY COALESCE(m.match_date, make_date(a.season, 12, 31)), a.id
         ) AS rn_first,
         row_number() OVER (
           ORDER BY COALESCE(m.match_date, make_date(a.season, 1, 1)) DESC, a.id DESC
         ) AS rn_last
    FROM player_achievements a
    LEFT JOIN players p ON p.id = a.player_id
    LEFT JOIN matches m ON m.id = a.match_id
   WHERE a.achievement_type = 'first_kick_goal'
)
SELECT CASE WHEN rn_first = 1 THEN 'first' ELSE 'most_recent' END AS boundary,
       id AS achievement_id,
       match_date,
       season,
       round_raw,
       player,
       club_name_raw,
       match_id
  FROM ranked
 WHERE rn_first = 1 OR rn_last = 1
 ORDER BY season, achievement_id;

\echo ''
\echo '=== 5.4 Richmond first-kick goals — organization lineage ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
)
SELECT a.id AS achievement_id,
       a.season,
       a.round_raw,
       COALESCE(p.display_name, a.player_name_raw) AS player,
       cl.name AS club,
       a.kickless_matches_before_first_kick,
       a.consecutive_goal_kicks,
       a.no_further_career_goals,
       a.no_further_career_kicks,
       a.match_id
  FROM player_achievements a
  LEFT JOIN players p ON p.id = a.player_id
  LEFT JOIN clubs cl ON cl.id = a.club_id
 WHERE a.achievement_type = 'first_kick_goal'
   AND a.club_id IN (
     SELECT id FROM clubs
      WHERE organization_id = (SELECT organization_id FROM target)
   )
 ORDER BY a.season, a.id;

\echo ''
\echo '=== 5.5 First-kick goals in the 1990s ==='
SELECT a.id AS achievement_id,
       a.season,
       a.round_raw,
       COALESCE(p.display_name, a.player_name_raw) AS player,
       a.club_name_raw,
       a.match_id
  FROM player_achievements a
  LEFT JOIN players p ON p.id = a.player_id
 WHERE a.achievement_type = 'first_kick_goal'
   AND a.season BETWEEN 1990 AND 1999
 ORDER BY a.season, a.id;

-- ---------------------------------------------------------------------
-- 6. CROSS-DOMAIN WITNESSES
-- Discovery only. These are NOT an instruction to add composition until the
-- typed plan can express and validate the ownership of every scope.
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '6. CROSS-DOMAIN WITNESSES'
\echo '====================================================================='

\echo ''
\echo '=== 6.1 Players who later coached Richmond ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
),
richmond_coaches AS (
  SELECT DISTINCT c.id AS coach_id,
         c.player_id,
         c.display_name
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
   WHERE c.player_id IS NOT NULL
     AND mc.club_id IN (
       SELECT id FROM clubs
        WHERE organization_id = (SELECT organization_id FROM target)
     )
)
SELECT rc.player_id,
       p.display_name,
       pcs.games AS playing_games,
       count(mc.match_id)::int AS career_coached_games,
       count(mc.match_id) FILTER (
         WHERE cl.organization_id = (SELECT organization_id FROM target)
       )::int AS richmond_coached_games
  FROM richmond_coaches rc
  JOIN players p ON p.id = rc.player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
  JOIN match_coaches mc ON mc.coach_id = rc.coach_id
  JOIN clubs cl ON cl.id = mc.club_id
 GROUP BY rc.player_id, p.display_name, pcs.games
 ORDER BY richmond_coached_games DESC, p.display_name;

\echo ''
\echo '=== 6.2 Players who played for Richmond and later/also coached Richmond ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
),
played AS (
  SELECT DISTINCT pms.player_id
    FROM player_match_stats pms
    JOIN clubs cl ON cl.id = pms.club_id
   WHERE cl.organization_id = (SELECT organization_id FROM target)
),
coached AS (
  SELECT DISTINCT c.player_id
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN clubs cl ON cl.id = mc.club_id
   WHERE c.player_id IS NOT NULL
     AND cl.organization_id = (SELECT organization_id FROM target)
)
SELECT p.id AS player_id,
       p.display_name
  FROM players p
  JOIN played pl ON pl.player_id = p.id
  JOIN coached co ON co.player_id = p.id
 ORDER BY p.display_name;

\echo ''
\echo '=== 6.3 Father-son selected players who later became coaches ==='
SELECT DISTINCT child.id AS player_id,
       child.display_name,
       f.draft_year,
       cl.name AS father_son_club,
       c.id AS coach_id,
       c.display_name AS coach_name,
       count(mc.match_id) OVER (PARTITION BY c.id)::int AS coached_games
  FROM father_son_selections f
  JOIN players child ON child.id = f.drafted_player_id
  JOIN coaches c ON c.player_id = child.id
  LEFT JOIN clubs cl ON cl.id = f.club_id
  LEFT JOIN match_coaches mc ON mc.coach_id = c.id
 WHERE f.drafted_link_status IN ('unique', 'resolved')
 ORDER BY coached_games DESC, child.display_name, f.draft_year;

-- ---------------------------------------------------------------------
-- 7. Useful NL test-witness candidates
-- Pick witnesses from the data rather than hard-coding thresholds that may
-- legitimately produce an empty result (lesson from ISSUE-110).
-- ---------------------------------------------------------------------

\echo ''
\echo '====================================================================='
\echo '7. NL TEST-WITNESS CANDIDATES'
\echo '====================================================================='

\echo ''
\echo '=== 7.1 Coaching threshold boundary values ==='
WITH by_coach AS (
  SELECT c.id,
         c.display_name,
         count(*)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT min(games)::int AS min_games,
       max(games)::int AS max_games,
       min(wins)::int AS min_wins,
       max(wins)::int AS max_wins,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY games)::int AS median_games,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY wins)::int AS median_wins
  FROM by_coach;

\echo ''
\echo '=== 7.2 Richmond coach thresholds with guaranteed witnesses ==='
WITH target AS (
  SELECT organization_id
    FROM clubs
   WHERE slug = 'richmond'
   ORDER BY id
   LIMIT 1
),
x AS (
  SELECT c.id,
         c.display_name,
         count(*)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   WHERE mc.club_id IN (
     SELECT id FROM clubs
      WHERE organization_id = (SELECT organization_id FROM target)
   )
   GROUP BY c.id, c.display_name
)
SELECT *
  FROM x
 ORDER BY games DESC, wins DESC, display_name;

\echo ''
\echo '=== 7.3 After-siren metric boundary values ==='
WITH x AS (
  SELECT player_id,
         count(*)::int AS kicks,
         count(*) FILTER (WHERE kick_scored = 'goal')::int AS goals,
         count(*) FILTER (WHERE kick_effect = 'won')::int AS winners
    FROM after_siren_kicks
   WHERE player_id IS NOT NULL
   GROUP BY player_id
)
SELECT min(kicks)::int AS min_kicks,
       max(kicks)::int AS max_kicks,
       min(goals)::int AS min_goals,
       max(goals)::int AS max_goals,
       min(winners)::int AS min_winners,
       max(winners)::int AS max_winners
  FROM x;

\echo ''
\echo '=== 7.4 Exact positive witnesses for each after-siren event subtype ==='
SELECT DISTINCT ON (kick_scored, kick_effect)
       kick_scored,
       kick_effect,
       id AS event_id,
       season,
       COALESCE(p.display_name, a.player_name_raw) AS player,
       club_name_raw,
       opponent_name_raw,
       premiership_season,
       match_id
  FROM after_siren_kicks a
  LEFT JOIN players p ON p.id = a.player_id
 ORDER BY kick_scored, kick_effect, season DESC, id DESC;

\echo ''
\echo '=== 7.5 Exact positive witnesses for every relationship enum ==='
SELECT DISTINCT ON (r.relationship)
       r.relationship,
       r.id,
       r.relationship_label,
       r.family_name,
       r.person_a_name,
       r.person_a_player_id,
       r.person_b_name,
       r.person_b_player_id
  FROM player_relationships r
 ORDER BY r.relationship,
          (r.person_a_player_id IS NOT NULL AND r.person_b_player_id IS NOT NULL) DESC,
          r.id;

\echo ''
\echo '====================================================================='
\echo 'END AFLDB-ISSUE-152 NL EVIDENCE PACK'
\echo '====================================================================='

ROLLBACK;
