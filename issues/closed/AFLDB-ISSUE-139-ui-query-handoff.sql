\pset pager off
\timing on

\echo
\echo ============================================================
\echo FAMILY RECORDS — most combined family games
\echo ============================================================

WITH family_names AS (
  SELECT
    family_key,
    max(family_name) FILTER (WHERE family_name IS NOT NULL) AS family_name
  FROM player_relationships
  WHERE family_key IS NOT NULL
  GROUP BY family_key
),
family_members AS (
  SELECT family_key, person_a_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL
    AND person_a_player_id IS NOT NULL

  UNION

  SELECT family_key, person_b_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL
    AND person_b_player_id IS NOT NULL
),
member_stats AS (
  SELECT
    fm.family_key,
    fm.player_id,
    p.display_name,
    p.slug,
    COALESCE(pcs.games, 0)::int AS games
  FROM family_members fm
  JOIN players p ON p.id = fm.player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = fm.player_id
),
families AS (
  SELECT
    ms.family_key,
    COALESCE(fn.family_name, ms.family_key) AS family_name,
    count(*)::int AS linked_members,
    sum(ms.games)::int AS combined_games,
    jsonb_agg(
      jsonb_build_object(
        'playerId', ms.player_id,
        'name', ms.display_name,
        'slug', ms.slug,
        'games', ms.games
      )
      ORDER BY ms.games DESC, ms.display_name
    ) AS members
  FROM member_stats ms
  LEFT JOIN family_names fn ON fn.family_key = ms.family_key
  GROUP BY ms.family_key, fn.family_name
)
SELECT
  dense_rank() OVER (
    ORDER BY combined_games DESC, linked_members DESC
  )::int AS rank,
  family_key,
  family_name,
  linked_members,
  combined_games,
  members
FROM families
ORDER BY combined_games DESC, linked_members DESC, family_name
LIMIT 50;


\echo
\echo ============================================================
\echo FAMILY DATA — summary / linkage sanity
\echo ============================================================

WITH family_members AS (
  SELECT family_key, person_a_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT
  count(DISTINCT family_key)::int AS families,
  count(DISTINCT player_id)::int AS linked_players
FROM family_members;

SELECT
  relationship,
  count(*)::int AS relationships,
  count(DISTINCT family_key)::int AS families,
  count(*) FILTER (
    WHERE person_a_player_id IS NULL OR person_b_player_id IS NULL
  )::int AS rows_with_unlinked_player
FROM player_relationships
WHERE family_key IS NOT NULL
GROUP BY relationship
ORDER BY relationship;


\echo
\echo ============================================================
\echo COACH RECORDS — career games / W-D-L / win percentage
\echo ============================================================

WITH coach_totals AS (
  SELECT
    c.id AS coach_id,
    c.display_name,
    c.player_id,
    p.slug AS player_slug,
    (c.player_id IS NULL) AS coach_only,
    min(m.season)::int AS first_season,
    max(m.season)::int AS last_season,
    min(m.match_date) AS first_match_date,
    max(m.match_date) AS last_match_date,
    count(mc.match_id)::int AS games,
    count(*) FILTER (
      WHERE m.winner_club_id = mc.club_id
    )::int AS wins,
    count(*) FILTER (
      WHERE m.winner_club_id IS NULL
    )::int AS draws,
    count(*) FILTER (
      WHERE m.winner_club_id IS NOT NULL
        AND m.winner_club_id <> mc.club_id
    )::int AS losses,
    count(*) FILTER (
      WHERE m.is_finals_series
    )::int AS finals,
    count(*) FILTER (
      WHERE m.round_type = 'grand_final'
    )::int AS grand_finals,
    count(*) FILTER (
      WHERE m.round_type = 'grand_final'
        AND m.winner_club_id = mc.club_id
    )::int AS premierships
  FROM coaches c
  LEFT JOIN players p ON p.id = c.player_id
  LEFT JOIN match_coaches mc ON mc.coach_id = c.id
  LEFT JOIN matches m ON m.id = mc.match_id
  GROUP BY c.id, c.display_name, c.player_id, p.slug
)
SELECT
  dense_rank() OVER (ORDER BY games DESC)::int AS games_rank,
  coach_id,
  display_name,
  coach_only,
  player_id,
  player_slug,
  first_season,
  last_season,
  first_match_date,
  last_match_date,
  games,
  wins,
  draws,
  losses,
  finals,
  grand_finals,
  premierships,
  CASE
    WHEN games > 0
    THEN round(((wins + draws * 0.5) * 100.0 / games)::numeric, 2)
    ELSE NULL
  END AS win_pct
FROM coach_totals
ORDER BY games DESC, display_name
LIMIT 50;


\echo
\echo ============================================================
\echo COACH DATA — counts / coach-only sanity
\echo ============================================================

SELECT
  count(*)::int AS coaches,
  count(*) FILTER (WHERE player_id IS NULL)::int AS coach_only,
  count(*) FILTER (WHERE player_id IS NOT NULL)::int AS player_and_coach
FROM coaches;

SELECT
  c.id,
  c.display_name,
  c.player_id,
  c.afltables_coach_path,
  min(m.season)::int AS first_season,
  max(m.season)::int AS last_season,
  count(mc.match_id)::int AS games
FROM coaches c
LEFT JOIN match_coaches mc ON mc.coach_id = c.id
LEFT JOIN matches m ON m.id = mc.match_id
WHERE c.display_name = 'Chris Fagan'
GROUP BY c.id, c.display_name, c.player_id, c.afltables_coach_path;


\echo
\echo ============================================================
\echo AFTER-THE-SIREN — aggregate player records
\echo ============================================================

WITH totals AS (
  SELECT
    a.player_id,
    count(*)::int AS attempts,
    count(*) FILTER (WHERE a.kick_scored = 'goal')::int AS goals,
    count(*) FILTER (WHERE a.kick_scored = 'behind')::int AS behinds,
    count(*) FILTER (WHERE a.kick_scored = 'none')::int AS misses,
    count(*) FILTER (
      WHERE a.kick_scored = 'goal'
        AND a.kick_effect = 'won'
    )::int AS goals_to_win,
    count(*) FILTER (
      WHERE a.kick_scored = 'goal'
        AND a.kick_effect = 'drew'
    )::int AS goals_to_draw
  FROM after_siren_kicks a
  WHERE a.player_id IS NOT NULL
  GROUP BY a.player_id
),
first_goal AS (
  SELECT DISTINCT ON (a.player_id)
    a.player_id,
    a.id AS event_id,
    a.season,
    a.round_raw,
    m.match_date,
    a.match_id,
    COALESCE(op.name, a.opponent_name_raw) AS opponent_name,
    op.slug AS opponent_slug,
    a.kick_effect,
    a.kicker_result
  FROM after_siren_kicks a
  LEFT JOIN matches m ON m.id = a.match_id
  LEFT JOIN clubs op ON op.id = a.opponent_club_id
  WHERE a.player_id IS NOT NULL
    AND a.kick_scored = 'goal'
  ORDER BY a.player_id, a.season, a.id
),
last_goal AS (
  SELECT DISTINCT ON (a.player_id)
    a.player_id,
    a.id AS event_id,
    a.season,
    a.round_raw,
    m.match_date,
    a.match_id,
    COALESCE(op.name, a.opponent_name_raw) AS opponent_name,
    op.slug AS opponent_slug,
    a.kick_effect,
    a.kicker_result
  FROM after_siren_kicks a
  LEFT JOIN matches m ON m.id = a.match_id
  LEFT JOIN clubs op ON op.id = a.opponent_club_id
  WHERE a.player_id IS NOT NULL
    AND a.kick_scored = 'goal'
  ORDER BY a.player_id, a.season DESC, a.id DESC
)
SELECT
  dense_rank() OVER (
    ORDER BY t.goals DESC, t.attempts DESC
  )::int AS rank,
  p.id AS player_id,
  p.display_name,
  p.slug,
  t.attempts,
  t.goals,
  t.behinds,
  t.misses,
  t.goals_to_win,
  t.goals_to_draw,

  fg.season AS first_goal_season,
  fg.round_raw AS first_goal_round,
  fg.match_date AS first_goal_date,
  fg.match_id AS first_goal_match_id,
  fg.opponent_name AS first_goal_opponent,
  fg.opponent_slug AS first_goal_opponent_slug,
  fg.kick_effect AS first_goal_effect,

  lg.season AS last_goal_season,
  lg.round_raw AS last_goal_round,
  lg.match_date AS last_goal_date,
  lg.match_id AS last_goal_match_id,
  lg.opponent_name AS last_goal_opponent,
  lg.opponent_slug AS last_goal_opponent_slug,
  lg.kick_effect AS last_goal_effect

FROM totals t
JOIN players p ON p.id = t.player_id
LEFT JOIN first_goal fg ON fg.player_id = t.player_id
LEFT JOIN last_goal lg ON lg.player_id = t.player_id
WHERE t.goals > 0
ORDER BY t.goals DESC, t.attempts DESC, p.display_name;


\echo
\echo ============================================================
\echo AFTER-THE-SIREN — dataset sanity
\echo ============================================================

SELECT
  count(*)::int AS total_events,
  count(DISTINCT player_id) FILTER (
    WHERE player_id IS NOT NULL
  )::int AS linked_players,
  count(*) FILTER (WHERE kick_scored = 'goal')::int AS goals,
  count(*) FILTER (WHERE kick_scored = 'behind')::int AS behinds,
  count(*) FILTER (WHERE kick_scored = 'none')::int AS no_score,
  count(*) FILTER (WHERE kick_effect = 'won')::int AS match_winners,
  count(*) FILTER (WHERE kick_effect = 'drew')::int AS match_drawers,
  count(*) FILTER (WHERE premiership_season)::int AS premiership_season_events,
  count(*) FILTER (WHERE NOT premiership_season)::int AS other_competitions
FROM after_siren_kicks;


\echo
\echo ============================================================
\echo COACHES INDEX — direct basis for Coaches navigation page
\echo ============================================================

SELECT
  c.id,
  c.display_name,
  min(m.season)::int AS first_season,
  max(m.season)::int AS last_season,
  count(mc.match_id)::int AS games,
  c.player_id,
  p.slug AS player_slug
FROM coaches c
LEFT JOIN players p ON p.id = c.player_id
LEFT JOIN match_coaches mc ON mc.coach_id = c.id
LEFT JOIN matches m ON m.id = mc.match_id
GROUP BY c.id, c.display_name, c.player_id, p.slug
ORDER BY c.surname, c.given_name, c.display_name;


\echo
\echo ============================================================
\echo EXPLAIN — family aggregate
\echo ============================================================

EXPLAIN
WITH family_members AS (
  SELECT family_key, person_a_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id AS player_id
  FROM player_relationships
  WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT
  fm.family_key,
  count(*) AS members,
  sum(COALESCE(pcs.games, 0)) AS games
FROM family_members fm
LEFT JOIN player_career_stats pcs ON pcs.player_id = fm.player_id
GROUP BY fm.family_key
ORDER BY games DESC;


\echo
\echo ============================================================
\echo EXPLAIN — coach aggregate
\echo ============================================================

EXPLAIN
SELECT
  c.id,
  count(mc.match_id),
  count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
FROM coaches c
LEFT JOIN match_coaches mc ON mc.coach_id = c.id
LEFT JOIN matches m ON m.id = mc.match_id
GROUP BY c.id;


\echo
\echo ============================================================
\echo EXPLAIN — after-the-siren player aggregate
\echo ============================================================

EXPLAIN
SELECT
  player_id,
  count(*),
  count(*) FILTER (WHERE kick_scored = 'goal')
FROM after_siren_kicks
WHERE player_id IS NOT NULL
GROUP BY player_id
ORDER BY count(*) DESC;
