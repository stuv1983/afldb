\set ON_ERROR_STOP on
\pset pager off

\echo '============================================================'
\echo 'AFLDB-ISSUE-171 — READ-ONLY DATA EVIDENCE'
\echo '============================================================'
SELECT current_database() AS database,
       current_setting('default_transaction_read_only') AS default_transaction_read_only;

\echo ''
\echo '== 1. Existing player career record leaders =='
WITH career AS (
  SELECT p.id, p.display_name,
         c.games, c.goals, c.finals, c.premierships, c.brownlow_votes
    FROM players p
    JOIN player_career_stats c ON c.player_id = p.id
)
SELECT 'games' AS metric, display_name, games::numeric AS value
FROM career WHERE games > 0 ORDER BY games DESC, display_name LIMIT 5;

WITH career AS (
  SELECT p.id, p.display_name,
         c.games, c.goals, c.finals, c.premierships, c.brownlow_votes
    FROM players p
    JOIN player_career_stats c ON c.player_id = p.id
)
SELECT 'goals' AS metric, display_name, goals::numeric AS value
FROM career WHERE goals > 0 ORDER BY goals DESC, display_name LIMIT 5;

WITH career AS (
  SELECT p.id, p.display_name,
         c.games, c.goals, c.finals, c.premierships, c.brownlow_votes
    FROM players p
    JOIN player_career_stats c ON c.player_id = p.id
)
SELECT 'finals' AS metric, display_name, finals::numeric AS value
FROM career WHERE finals > 0 ORDER BY finals DESC, display_name LIMIT 5;

WITH career AS (
  SELECT p.id, p.display_name,
         c.games, c.goals, c.finals, c.premierships, c.brownlow_votes
    FROM players p
    JOIN player_career_stats c ON c.player_id = p.id
)
SELECT 'premierships' AS metric, display_name, premierships::numeric AS value
FROM career WHERE premierships > 0 ORDER BY premierships DESC, display_name LIMIT 5;

WITH career AS (
  SELECT p.id, p.display_name,
         c.games, c.goals, c.finals, c.premierships, c.brownlow_votes
    FROM players p
    JOIN player_career_stats c ON c.player_id = p.id
)
SELECT 'brownlow_votes' AS metric, display_name, brownlow_votes::numeric AS value
FROM career WHERE brownlow_votes > 0 ORDER BY brownlow_votes DESC, display_name LIMIT 5;

\echo ''
\echo '== 2. Existing player match / season record leaders =='
SELECT 'goals_in_match' AS metric,
       p.display_name, pms.goals::numeric AS value,
       m.season, m.id AS match_id
  FROM player_match_stats pms
  JOIN players p ON p.id = pms.player_id
  JOIN matches m ON m.id = pms.match_id
 WHERE pms.goals IS NOT NULL
 ORDER BY pms.goals DESC, m.match_date, m.id, p.id
 LIMIT 10;

SELECT 'disposals_in_match' AS metric,
       p.display_name, pms.disposals::numeric AS value,
       m.season, m.id AS match_id
  FROM player_match_stats pms
  JOIN players p ON p.id = pms.player_id
  JOIN matches m ON m.id = pms.match_id
 WHERE pms.disposals IS NOT NULL
 ORDER BY pms.disposals DESC, m.match_date, m.id, p.id
 LIMIT 10;

SELECT 'goals_in_season' AS metric,
       p.display_name, pss.goals::numeric AS value,
       pss.season
  FROM player_season_stats pss
  JOIN players p ON p.id = pss.player_id
 WHERE pss.goals IS NOT NULL
 ORDER BY pss.goals DESC, pss.season, p.id
 LIMIT 10;

\echo ''
\echo '== 3. Coach population and canonical career leaders =='
SELECT count(*)::int AS coaches,
       count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked_to_player,
       count(*) FILTER (WHERE player_id IS NULL)::int AS coach_only_people
  FROM coaches;

WITH coach_totals AS (
  SELECT c.id, c.display_name,
         count(mc.match_id)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
         count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
         count(*) FILTER (
           WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
         )::int AS losses,
         count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
         count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS grand_finals,
         count(*) FILTER (
           WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id
         )::int AS premierships
    FROM coaches c
    LEFT JOIN match_coaches mc ON mc.coach_id = c.id
    LEFT JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT display_name, games, wins, draws, losses, finals, grand_finals, premierships,
       round(100.0 * (wins + draws * 0.5) / NULLIF(games, 0), 2) AS win_pct
  FROM coach_totals
 ORDER BY games DESC, display_name
 LIMIT 15;

\echo ''
\echo '== 3a. Coach wins leaders =='
WITH coach_totals AS (
  SELECT c.id, c.display_name,
         count(mc.match_id)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
         count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT display_name, games, wins, draws,
       round(100.0 * (wins + draws * 0.5) / NULLIF(games, 0), 2) AS win_pct
  FROM coach_totals
 ORDER BY wins DESC, games DESC, display_name
 LIMIT 10;

\echo ''
\echo '== 3b. Coach finals / premiership leaders =='
WITH coach_totals AS (
  SELECT c.id, c.display_name,
         count(mc.match_id)::int AS games,
         count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
         count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS grand_finals,
         count(*) FILTER (
           WHERE m.round_type = 'grand_final' AND m.winner_club_id = mc.club_id
         )::int AS premierships
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT display_name, games, finals, grand_finals, premierships
  FROM coach_totals
 ORDER BY premierships DESC, grand_finals DESC, finals DESC, games DESC, display_name
 LIMIT 15;

\echo ''
\echo '== 3c. Coach win percentage threshold evidence =='
WITH coach_totals AS (
  SELECT c.id, c.display_name,
         count(mc.match_id)::int AS games,
         count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
         count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws
    FROM coaches c
    JOIN match_coaches mc ON mc.coach_id = c.id
    JOIN matches m ON m.id = mc.match_id
   GROUP BY c.id, c.display_name
)
SELECT display_name, games, wins, draws,
       round(100.0 * (wins + draws * 0.5) / games, 2) AS win_pct
  FROM coach_totals
 WHERE games >= 50
 ORDER BY (wins + draws * 0.5) / games DESC, games DESC, display_name
 LIMIT 15;

\echo ''
\echo '== 4. Venue population / match-hosting leaders =='
SELECT count(*)::int AS venues,
       count(*) FILTER (WHERE slug IS NOT NULL)::int AS venues_with_slug
  FROM venues;

SELECT v.id, v.canonical_name, v.slug,
       count(m.id)::int AS matches,
       count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
       count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS grand_finals,
       count(m.attendance)::int AS matches_with_attendance,
       max(m.attendance)::int AS highest_attendance,
       round(avg(m.attendance))::int AS avg_recorded_attendance
  FROM venues v
  LEFT JOIN matches m ON m.venue_id = v.id
 GROUP BY v.id, v.canonical_name, v.slug
 ORDER BY matches DESC, v.canonical_name
 LIMIT 20;

\echo ''
\echo '== 4a. Venue finals leaders =='
SELECT v.id, v.canonical_name, v.slug,
       count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
       count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS grand_finals,
       count(m.id)::int AS matches
  FROM venues v
  JOIN matches m ON m.venue_id = v.id
 GROUP BY v.id, v.canonical_name, v.slug
 ORDER BY finals DESC, grand_finals DESC, matches DESC, v.canonical_name
 LIMIT 15;

\echo ''
\echo '== 4b. Highest recorded attendance globally =='
SELECT m.id AS match_id, m.season, m.match_date,
       v.id AS venue_id, v.canonical_name, v.slug,
       h.name AS home, a.name AS away,
       m.attendance
  FROM matches m
  JOIN venues v ON v.id = m.venue_id
  JOIN clubs h ON h.id = m.home_club_id
  JOIN clubs a ON a.id = m.away_club_id
 WHERE m.attendance IS NOT NULL
 ORDER BY m.attendance DESC, m.match_date, m.id
 LIMIT 10;

\echo ''
\echo '== 5. First-kick-goal population / coverage =='
SELECT count(*)::int AS total_active,
       count(*) FILTER (
         WHERE player_id IS NOT NULL
           AND link_status_value IN ('unique', 'resolved')
       )::int AS linked,
       count(*) FILTER (
         WHERE NOT (
           player_id IS NOT NULL
           AND link_status_value IN ('unique', 'resolved')
         )
       )::int AS unlinked,
       min(season)::int AS earliest_season,
       max(season)::int AS latest_season,
       count(*) FILTER (WHERE consecutive_goal_kicks > 1)::int AS multi_kick,
       max(consecutive_goal_kicks)::int AS max_consecutive_goal_kicks,
       count(*) FILTER (WHERE no_further_career_goals)::int AS only_career_goal,
       count(*) FILTER (WHERE no_further_career_kicks)::int AS no_further_career_kicks,
       count(*) FILTER (WHERE match_id IS NOT NULL)::int AS resolved_match
  FROM player_achievements
 WHERE achievement_type = 'first_kick_goal'
   AND status = 'active';

\echo ''
\echo '== 5a. Most consecutive goals from first career kicks =='
SELECT COALESCE(p.display_name, a.player_name_clean) AS player_name,
       p.slug,
       a.season,
       a.round_raw,
       a.consecutive_goal_kicks,
       a.no_further_career_goals,
       a.no_further_career_kicks,
       a.kickless_matches_before_first_kick,
       a.match_id
  FROM player_achievements a
  LEFT JOIN players p ON p.id = a.player_id
 WHERE a.achievement_type = 'first_kick_goal'
   AND a.status = 'active'
 ORDER BY a.consecutive_goal_kicks DESC, a.season, a.id
 LIMIT 15;

\echo ''
\echo '== 6. After-the-siren population / coverage =='
SELECT count(*)::int AS active_events,
       count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked_events,
       count(DISTINCT player_id) FILTER (WHERE player_id IS NOT NULL)::int AS linked_players,
       min(season)::int AS earliest_season,
       max(season)::int AS latest_season,
       count(*) FILTER (WHERE kick_scored = 'goal')::int AS goals,
       count(*) FILTER (WHERE kick_scored = 'behind')::int AS behinds,
       count(*) FILTER (WHERE kick_scored = 'none')::int AS misses,
       count(*) FILTER (WHERE kick_scored = 'goal' AND kick_effect = 'won')::int AS goals_to_win,
       count(*) FILTER (WHERE kick_scored = 'goal' AND kick_effect = 'drew')::int AS goals_to_draw,
       count(*) FILTER (WHERE cited)::int AS cited_events
  FROM after_siren_kicks
 WHERE status = 'active';

\echo ''
\echo '== 6a. After-the-siren player record leaders =='
WITH totals AS (
  SELECT a.player_id,
         count(*)::int AS attempts,
         count(*) FILTER (WHERE a.kick_scored = 'goal')::int AS goals,
         count(*) FILTER (WHERE a.kick_scored = 'behind')::int AS behinds,
         count(*) FILTER (WHERE a.kick_scored = 'none')::int AS misses,
         count(*) FILTER (
           WHERE a.kick_scored = 'goal' AND a.kick_effect = 'won'
         )::int AS goals_to_win,
         count(*) FILTER (
           WHERE a.kick_scored = 'goal' AND a.kick_effect = 'drew'
         )::int AS goals_to_draw
    FROM after_siren_kicks a
   WHERE a.player_id IS NOT NULL
     AND a.status = 'active'
   GROUP BY a.player_id
)
SELECT p.display_name, p.slug,
       t.attempts, t.goals, t.behinds, t.misses, t.goals_to_win, t.goals_to_draw
  FROM totals t
  JOIN players p ON p.id = t.player_id
 ORDER BY t.attempts DESC, t.goals DESC, p.display_name
 LIMIT 20;

\echo ''
\echo '== 7. Broad match-record candidates =='
SELECT count(*)::int AS matches,
       min(season)::int AS earliest_season,
       max(season)::int AS latest_season,
       count(*) FILTER (WHERE is_finals_series)::int AS finals,
       count(*) FILTER (WHERE round_type = 'grand_final')::int AS grand_finals,
       count(attendance)::int AS matches_with_attendance
  FROM matches;

SELECT m.id, m.season, m.match_date,
       h.name AS home, a.name AS away,
       m.home_score, m.away_score,
       abs(m.home_score - m.away_score) AS margin,
       v.canonical_name AS venue
  FROM matches m
  JOIN clubs h ON h.id = m.home_club_id
  JOIN clubs a ON a.id = m.away_club_id
  LEFT JOIN venues v ON v.id = m.venue_id
 ORDER BY abs(m.home_score - m.away_score) DESC, m.match_date, m.id
 LIMIT 10;

\echo ''
\echo '============================================================'
\echo 'END AFLDB-ISSUE-171 EVIDENCE'
\echo '============================================================'
