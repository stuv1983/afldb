\pset pager off
\timing on

\echo '============================================================'
\echo 'AFLDB ISSUE-150 — VENUE DATA EVIDENCE'
\echo '============================================================'

\echo ''
\echo '=== 1. VENUE INVENTORY / MATCH COUNTS ==='
SELECT
    v.id,
    v.slug,
    v.canonical_name,
    v.legacy_name,
    v.first_season,
    v.last_season,
    COUNT(m.id)::int AS matches,
    COUNT(m.attendance)::int AS matches_with_attendance,
    ROUND(AVG(m.attendance))::int AS avg_attendance,
    MAX(m.attendance)::int AS max_attendance
FROM venues v
LEFT JOIN matches m ON m.venue_id = v.id
GROUP BY
    v.id, v.slug, v.canonical_name, v.legacy_name,
    v.first_season, v.last_season
ORDER BY matches DESC, v.canonical_name;


\echo ''
\echo '=== 2. FIRST AND MOST RECENT MATCH PER VENUE ==='
WITH ranked AS (
    SELECT
        m.*,
        ROW_NUMBER() OVER (
            PARTITION BY m.venue_id
            ORDER BY m.match_date, m.id
        ) AS first_rn,
        ROW_NUMBER() OVER (
            PARTITION BY m.venue_id
            ORDER BY m.match_date DESC, m.id DESC
        ) AS latest_rn
    FROM matches m
    WHERE m.venue_id IS NOT NULL
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    f.id AS first_match_id,
    f.match_date AS first_match_date,
    fh.name AS first_home,
    fa.name AS first_away,
    f.home_score AS first_home_score,
    f.away_score AS first_away_score,
    l.id AS latest_match_id,
    l.match_date AS latest_match_date,
    lh.name AS latest_home,
    la.name AS latest_away,
    l.home_score AS latest_home_score,
    l.away_score AS latest_away_score
FROM venues v
LEFT JOIN ranked f
       ON f.venue_id = v.id
      AND f.first_rn = 1
LEFT JOIN clubs fh ON fh.id = f.home_club_id
LEFT JOIN clubs fa ON fa.id = f.away_club_id
LEFT JOIN ranked l
       ON l.venue_id = v.id
      AND l.latest_rn = 1
LEFT JOIN clubs lh ON lh.id = l.home_club_id
LEFT JOIN clubs la ON la.id = l.away_club_id
ORDER BY v.canonical_name;


\echo ''
\echo '=== 3. CLUB W-D-L RECORDS AT EACH VENUE ==='
WITH club_games AS (
    SELECT
        m.venue_id,
        m.id AS match_id,
        m.home_club_id AS club_id,
        m.away_club_id AS opponent_id,
        m.home_score AS score_for,
        m.away_score AS score_against
    FROM matches m
    WHERE m.venue_id IS NOT NULL

    UNION ALL

    SELECT
        m.venue_id,
        m.id AS match_id,
        m.away_club_id AS club_id,
        m.home_club_id AS opponent_id,
        m.away_score AS score_for,
        m.home_score AS score_against
    FROM matches m
    WHERE m.venue_id IS NOT NULL
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    c.id AS club_id,
    c.name AS club,
    c.slug AS club_slug,
    COUNT(*)::int AS games,
    COUNT(*) FILTER (WHERE cg.score_for > cg.score_against)::int AS wins,
    COUNT(*) FILTER (WHERE cg.score_for = cg.score_against)::int AS draws,
    COUNT(*) FILTER (WHERE cg.score_for < cg.score_against)::int AS losses,
    ROUND(
        100.0 *
        COUNT(*) FILTER (WHERE cg.score_for > cg.score_against)
        / NULLIF(COUNT(*), 0),
        2
    ) AS win_pct
FROM club_games cg
JOIN venues v ON v.id = cg.venue_id
JOIN clubs c ON c.id = cg.club_id
GROUP BY
    v.id, v.canonical_name,
    c.id, c.name, c.slug
ORDER BY
    v.canonical_name,
    games DESC,
    wins DESC,
    c.name;


\echo ''
\echo '=== 4. ATTENDANCE EXTREMES PER VENUE ==='
WITH ranked AS (
    SELECT
        m.*,
        ROW_NUMBER() OVER (
            PARTITION BY m.venue_id
            ORDER BY m.attendance DESC, m.match_date, m.id
        ) AS highest_rn,
        ROW_NUMBER() OVER (
            PARTITION BY m.venue_id
            ORDER BY m.attendance ASC, m.match_date, m.id
        ) AS lowest_rn
    FROM matches m
    WHERE m.venue_id IS NOT NULL
      AND m.attendance IS NOT NULL
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,

    hi.attendance AS highest_attendance,
    hi.id AS highest_match_id,
    hi.match_date AS highest_match_date,
    hih.name AS highest_home,
    hia.name AS highest_away,

    lo.attendance AS lowest_recorded_attendance,
    lo.id AS lowest_match_id,
    lo.match_date AS lowest_match_date,
    loh.name AS lowest_home,
    loa.name AS lowest_away

FROM venues v
LEFT JOIN ranked hi
       ON hi.venue_id = v.id
      AND hi.highest_rn = 1
LEFT JOIN clubs hih ON hih.id = hi.home_club_id
LEFT JOIN clubs hia ON hia.id = hi.away_club_id

LEFT JOIN ranked lo
       ON lo.venue_id = v.id
      AND lo.lowest_rn = 1
LEFT JOIN clubs loh ON loh.id = lo.home_club_id
LEFT JOIN clubs loa ON loa.id = lo.away_club_id

ORDER BY v.canonical_name;


\echo ''
\echo '=== 5. ATTENDANCE NULL / ZERO EDGE CASES ==='
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    COUNT(*)::int AS matches,
    COUNT(*) FILTER (WHERE m.attendance IS NULL)::int AS attendance_null,
    COUNT(*) FILTER (WHERE m.attendance = 0)::int AS attendance_zero,
    MIN(m.attendance) FILTER (
        WHERE m.attendance IS NOT NULL
    )::int AS minimum_recorded_attendance
FROM venues v
JOIN matches m ON m.venue_id = v.id
GROUP BY v.id, v.canonical_name
HAVING
       COUNT(*) FILTER (WHERE m.attendance IS NULL) > 0
    OR COUNT(*) FILTER (WHERE m.attendance = 0) > 0
ORDER BY
    attendance_zero DESC,
    attendance_null DESC,
    v.canonical_name;


\echo ''
\echo '=== 6. HIGHEST TEAM SCORE PER VENUE ==='
WITH team_scores AS (
    SELECT
        m.venue_id,
        m.id AS match_id,
        m.match_date,
        m.home_club_id AS club_id,
        m.away_club_id AS opponent_id,
        m.home_score AS score,
        m.away_score AS opponent_score
    FROM matches m
    WHERE m.venue_id IS NOT NULL

    UNION ALL

    SELECT
        m.venue_id,
        m.id AS match_id,
        m.match_date,
        m.away_club_id AS club_id,
        m.home_club_id AS opponent_id,
        m.away_score AS score,
        m.home_score AS opponent_score
    FROM matches m
    WHERE m.venue_id IS NOT NULL
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY score DESC, match_date, match_id
           ) AS rn
    FROM team_scores
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.score,
    r.opponent_score,
    r.match_id,
    r.match_date,
    c.name AS club,
    o.name AS opponent
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN clubs c ON c.id = r.club_id
JOIN clubs o ON o.id = r.opponent_id
WHERE r.rn = 1
ORDER BY v.canonical_name;


\echo ''
\echo '=== 7. BIGGEST WINNING MARGIN PER VENUE ==='
WITH ranked AS (
    SELECT
        m.id,
        m.match_date,
        m.venue_id,
        m.home_club_id,
        m.away_club_id,
        m.home_score,
        m.away_score,
        ABS(m.home_score - m.away_score) AS margin,
        ROW_NUMBER() OVER (
            PARTITION BY m.venue_id
            ORDER BY
                ABS(m.home_score - m.away_score) DESC,
                m.match_date,
                m.id
        ) AS rn
    FROM matches m
    WHERE m.venue_id IS NOT NULL
      AND m.home_score <> m.away_score
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.margin,
    r.id AS match_id,
    r.match_date,
    h.name AS home,
    r.home_score,
    a.name AS away,
    r.away_score
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN clubs h ON h.id = r.home_club_id
JOIN clubs a ON a.id = r.away_club_id
WHERE r.rn = 1
ORDER BY v.canonical_name;


\echo ''
\echo '=== 8. TOP 5 — PLAYER GAMES AT EACH VENUE ==='
WITH totals AS (
    SELECT
        m.venue_id,
        pms.player_id,
        COUNT(*)::int AS value
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE m.venue_id IS NOT NULL
    GROUP BY m.venue_id, pms.player_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY value DESC, player_id
           ) AS rn
    FROM totals
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.rn AS rank,
    p.id AS player_id,
    p.display_name AS player,
    p.slug AS player_slug,
    r.value AS games
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN players p ON p.id = r.player_id
WHERE r.rn <= 5
ORDER BY v.canonical_name, r.rn;


\echo ''
\echo '=== 9. TOP 5 — PLAYER GOALS AT EACH VENUE ==='
WITH totals AS (
    SELECT
        m.venue_id,
        pms.player_id,
        SUM(pms.goals)::int AS value,
        COUNT(pms.goals)::int AS recorded_games
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE m.venue_id IS NOT NULL
      AND pms.goals IS NOT NULL
    GROUP BY m.venue_id, pms.player_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY value DESC, player_id
           ) AS rn
    FROM totals
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.rn AS rank,
    p.id AS player_id,
    p.display_name AS player,
    p.slug AS player_slug,
    r.value AS goals,
    r.recorded_games
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN players p ON p.id = r.player_id
WHERE r.rn <= 5
ORDER BY v.canonical_name, r.rn;


\echo ''
\echo '=== 10. TOP 5 — PLAYER MARKS AT EACH VENUE ==='
WITH totals AS (
    SELECT
        m.venue_id,
        pms.player_id,
        SUM(pms.marks)::int AS value,
        COUNT(pms.marks)::int AS recorded_games
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE m.venue_id IS NOT NULL
      AND pms.marks IS NOT NULL
    GROUP BY m.venue_id, pms.player_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY value DESC, player_id
           ) AS rn
    FROM totals
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.rn AS rank,
    p.id AS player_id,
    p.display_name AS player,
    p.slug AS player_slug,
    r.value AS marks,
    r.recorded_games
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN players p ON p.id = r.player_id
WHERE r.rn <= 5
ORDER BY v.canonical_name, r.rn;


\echo ''
\echo '=== 11. TOP 5 — PLAYER KICKS AT EACH VENUE ==='
WITH totals AS (
    SELECT
        m.venue_id,
        pms.player_id,
        SUM(pms.kicks)::int AS value,
        COUNT(pms.kicks)::int AS recorded_games
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE m.venue_id IS NOT NULL
      AND pms.kicks IS NOT NULL
    GROUP BY m.venue_id, pms.player_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY value DESC, player_id
           ) AS rn
    FROM totals
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.rn AS rank,
    p.id AS player_id,
    p.display_name AS player,
    p.slug AS player_slug,
    r.value AS kicks,
    r.recorded_games
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN players p ON p.id = r.player_id
WHERE r.rn <= 5
ORDER BY v.canonical_name, r.rn;


\echo ''
\echo '=== 12. TOP 5 — PLAYER HANDBALLS AT EACH VENUE ==='
WITH totals AS (
    SELECT
        m.venue_id,
        pms.player_id,
        SUM(pms.handballs)::int AS value,
        COUNT(pms.handballs)::int AS recorded_games
    FROM player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    WHERE m.venue_id IS NOT NULL
      AND pms.handballs IS NOT NULL
    GROUP BY m.venue_id, pms.player_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY venue_id
               ORDER BY value DESC, player_id
           ) AS rn
    FROM totals
)
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    r.rn AS rank,
    p.id AS player_id,
    p.display_name AS player,
    p.slug AS player_slug,
    r.value AS handballs,
    r.recorded_games
FROM ranked r
JOIN venues v ON v.id = r.venue_id
JOIN players p ON p.id = r.player_id
WHERE r.rn <= 5
ORDER BY v.canonical_name, r.rn;


\echo ''
\echo '=== 13. STAT COVERAGE / ERA CHECK BY VENUE ==='
SELECT
    v.id AS venue_id,
    v.canonical_name AS venue,
    COUNT(pms.id)::int AS player_match_rows,
    COUNT(pms.goals)::int AS goals_recorded_rows,
    COUNT(pms.marks)::int AS marks_recorded_rows,
    COUNT(pms.kicks)::int AS kicks_recorded_rows,
    COUNT(pms.handballs)::int AS handballs_recorded_rows,
    MIN(m.season) FILTER (WHERE pms.goals IS NOT NULL) AS first_goals_season,
    MIN(m.season) FILTER (WHERE pms.marks IS NOT NULL) AS first_marks_season,
    MIN(m.season) FILTER (WHERE pms.kicks IS NOT NULL) AS first_kicks_season,
    MIN(m.season) FILTER (WHERE pms.handballs IS NOT NULL) AS first_handballs_season
FROM venues v
JOIN matches m ON m.venue_id = v.id
JOIN player_match_stats pms ON pms.match_id = m.id
GROUP BY v.id, v.canonical_name
ORDER BY v.canonical_name;


\echo ''
\echo '=== 14. SAMPLE HISTORICAL MATCHES WITH SPARSE PLAYER STATS ==='
SELECT
    v.canonical_name AS venue,
    m.id AS match_id,
    m.season,
    m.match_date,
    p.display_name AS player,
    pms.goals,
    pms.kicks,
    pms.marks,
    pms.handballs
FROM player_match_stats pms
JOIN matches m ON m.id = pms.match_id
JOIN venues v ON v.id = m.venue_id
JOIN players p ON p.id = pms.player_id
WHERE m.venue_id IS NOT NULL
  AND (
       pms.kicks IS NULL
    OR pms.marks IS NULL
    OR pms.handballs IS NULL
  )
ORDER BY m.season, m.match_date, p.display_name
LIMIT 50;


\echo ''
\echo '=== 15. SAMPLE MODERN MATCHES WITH RECORDED PLAYER STATS ==='
SELECT
    v.canonical_name AS venue,
    m.id AS match_id,
    m.season,
    m.match_date,
    p.display_name AS player,
    pms.goals,
    pms.kicks,
    pms.marks,
    pms.handballs
FROM player_match_stats pms
JOIN matches m ON m.id = pms.match_id
JOIN venues v ON v.id = m.venue_id
JOIN players p ON p.id = pms.player_id
WHERE m.venue_id IS NOT NULL
  AND pms.kicks IS NOT NULL
  AND pms.marks IS NOT NULL
  AND pms.handballs IS NOT NULL
ORDER BY m.season DESC, m.match_date DESC, p.display_name
LIMIT 50;


\echo ''
\echo '=== END ISSUE-150 VENUE EVIDENCE ==='
