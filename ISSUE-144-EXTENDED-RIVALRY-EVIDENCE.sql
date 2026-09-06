\pset pager off
\pset border 2
\pset null '[NULL]'

\echo ============================================================
\echo ISSUE-144 EXTENDED RIVALRY EVIDENCE
\echo ============================================================

\echo
\echo === 1. ADELAIDE / BRISBANE H2H BY DECADE ===
WITH pair_matches AS (
    SELECT
        m.*,
        hc.organization_id AS home_org,
        ac.organization_id AS away_org,
        wc.organization_id AS winner_org
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    LEFT JOIN clubs wc ON wc.id = m.winner_club_id
    WHERE (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
    )
    OR (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
    )
)
SELECT
    (season / 10) * 10 AS decade,
    count(*) AS meetings,
    count(*) FILTER (
        WHERE winner_org = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
    ) AS adelaide_wins,
    count(*) FILTER (
        WHERE winner_org = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
    ) AS brisbane_wins,
    count(*) FILTER (WHERE result = 'draw') AS draws,
    sum(
        CASE
            WHEN home_org = (
                SELECT id FROM club_organizations WHERE slug = 'adelaide'
            )
            THEN home_score ELSE away_score
        END
    ) AS adelaide_points,
    sum(
        CASE
            WHEN home_org = (
                SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
            )
            THEN home_score ELSE away_score
        END
    ) AS brisbane_points
FROM pair_matches
GROUP BY (season / 10) * 10
ORDER BY decade;

\echo
\echo === 2. PERIOD SCORE GLOBAL COVERAGE BY SEASON ===
SELECT
    m.season,
    count(DISTINCT m.id) AS matches,
    count(DISTINCT mps.match_id) AS matches_with_period_scores,
    round(
        100.0 * count(DISTINCT mps.match_id)
        / NULLIF(count(DISTINCT m.id),0),
        2
    ) AS pct_with_period_scores
FROM matches m
LEFT JOIN match_period_scores mps
    ON mps.match_id = m.id
GROUP BY m.season
ORDER BY m.season;

\echo
\echo === 3. PERIOD SCORE COVERAGE BY ORGANISATION PAIR - TOP HISTORICAL PAIRS ===
WITH pairs AS (
    SELECT
        LEAST(hc.organization_id, ac.organization_id) AS org_a,
        GREATEST(hc.organization_id, ac.organization_id) AS org_b,
        m.id AS match_id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE hc.organization_id <> ac.organization_id
),
coverage AS (
    SELECT
        p.org_a,
        p.org_b,
        count(DISTINCT p.match_id) AS matches,
        count(DISTINCT mps.match_id) AS matches_with_period_scores
    FROM pairs p
    LEFT JOIN match_period_scores mps
        ON mps.match_id = p.match_id
    GROUP BY p.org_a, p.org_b
)
SELECT
    oa.name AS organization_a,
    ob.name AS organization_b,
    c.matches,
    c.matches_with_period_scores,
    round(
        100.0 * c.matches_with_period_scores / NULLIF(c.matches,0),
        2
    ) AS pct_covered
FROM coverage c
JOIN club_organizations oa ON oa.id = c.org_a
JOIN club_organizations ob ON ob.id = c.org_b
ORDER BY c.matches DESC
LIMIT 25;

\echo
\echo === 4. ADELAIDE / BRISBANE PERIOD BREAK RECORD CANDIDATES ===
WITH target_matches AS (
    SELECT
        m.id,
        m.match_date,
        m.season,
        hc.organization_id AS home_org,
        ac.organization_id AS away_org
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
    )
    OR (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
    )
),
periods AS (
    SELECT
        tm.id AS match_id,
        tm.match_date,
        tm.season,
        mps.period,
        c.organization_id,
        mps.points
    FROM target_matches tm
    JOIN match_period_scores mps ON mps.match_id = tm.id
    JOIN clubs c ON c.id = mps.club_id
)
SELECT
    match_id,
    season,
    match_date,
    period,
    max(points) - min(points) AS break_margin
FROM periods
GROUP BY match_id, season, match_date, period
ORDER BY break_margin DESC, match_date, match_id, period
LIMIT 30;

\echo
\echo === 5. ADELAIDE / BRISBANE H2H PLAYER GAMES DISTRIBUTION ===
WITH h2h AS (
    SELECT m.id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
    )
    OR (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
    )
),
player_games AS (
    SELECT
        pms.player_id,
        count(*) AS games
    FROM player_match_stats pms
    JOIN h2h ON h2h.id = pms.match_id
    GROUP BY pms.player_id
)
SELECT
    games,
    count(*) AS players
FROM player_games
GROUP BY games
ORDER BY games;

\echo
\echo === 6. H2H AVERAGE DISPOSALS - MINIMUM GAME THRESHOLD COMPARISON ===
WITH h2h AS (
    SELECT m.id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
    )
    OR (
        hc.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'brisbane-lions'
        )
        AND
        ac.organization_id = (
            SELECT id FROM club_organizations WHERE slug = 'adelaide'
        )
    )
),
agg AS (
    SELECT
        pms.player_id,
        p.display_name,
        count(*) FILTER (WHERE pms.disposals IS NOT NULL) AS recorded_games,
        avg(pms.disposals::numeric) FILTER (
            WHERE pms.disposals IS NOT NULL
        ) AS avg_disposals
    FROM player_match_stats pms
    JOIN h2h ON h2h.id = pms.match_id
    JOIN players p ON p.id = pms.player_id
    GROUP BY pms.player_id, p.display_name
)
SELECT
    'min_1' AS threshold,
    recorded_games,
    display_name,
    round(avg_disposals,2) AS avg_disposals
FROM agg
WHERE recorded_games >= 1
ORDER BY avg_disposals DESC, recorded_games DESC, display_name
LIMIT 10;

SELECT
    'min_3' AS threshold,
    recorded_games,
    display_name,
    round(avg_disposals,2) AS avg_disposals
FROM agg
WHERE recorded_games >= 3
ORDER BY avg_disposals DESC, recorded_games DESC, display_name
LIMIT 10;

SELECT
    'min_5' AS threshold,
    recorded_games,
    display_name,
    round(avg_disposals,2) AS avg_disposals
FROM agg
WHERE recorded_games >= 5
ORDER BY avg_disposals DESC, recorded_games DESC, display_name
LIMIT 10;

SELECT
    'min_10' AS threshold,
    recorded_games,
    display_name,
    round(avg_disposals,2) AS avg_disposals
FROM agg
WHERE recorded_games >= 10
ORDER BY avg_disposals DESC, recorded_games DESC, display_name
LIMIT 10;

\echo
\echo === 7. H2H STAT COVERAGE BY METRIC / SEASON ===
SELECT
    stat_key,
    min(season) FILTER (WHERE is_recorded) AS first_recorded,
    max(season) FILTER (WHERE is_recorded) AS last_recorded,
    count(*) FILTER (WHERE coverage = 'complete') AS complete_seasons,
    count(*) FILTER (WHERE coverage = 'partial') AS partial_seasons
FROM stat_availability
WHERE stat_key IN (
    'goals',
    'disposals',
    'kicks',
    'handballs',
    'marks',
    'tackles',
    'hitouts',
    'rebounds',
    'inside50s',
    'clearances',
    'clangers',
    'contested',
    'uncontested',
    'goal_assists'
)
GROUP BY stat_key
ORDER BY stat_key;

\echo
\echo === 8. QUARTER/PERIOD STRUCTURE SANITY ===
SELECT
    period,
    count(*) AS rows,
    count(DISTINCT match_id) AS matches,
    min(points) AS min_points,
    max(points) AS max_points
FROM match_period_scores
GROUP BY period
ORDER BY period;

\echo
\echo === 9. MATCHES WITH NON-FOUR-PERIOD STRUCTURE ===
SELECT
    m.id,
    m.season,
    m.round_code,
    m.match_date,
    count(DISTINCT mps.period) AS periods,
    count(*) AS rows
FROM matches m
JOIN match_period_scores mps ON mps.match_id = m.id
GROUP BY m.id, m.season, m.round_code, m.match_date
HAVING count(DISTINCT mps.period) <> 4
ORDER BY m.season, m.match_date, m.id
LIMIT 100;

\echo
\echo ============================================================
\echo END EXTENDED RIVALRY EVIDENCE
\echo ============================================================
