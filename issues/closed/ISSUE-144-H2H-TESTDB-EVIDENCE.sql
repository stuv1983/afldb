\pset pager off
\pset border 2
\pset null '[NULL]'

\echo
\echo ============================================================
\echo AFLDB ISSUE-138 - CLUB VS CLUB / H2H TEST DB EVIDENCE
\echo Generated read-only from afldb_test
\echo ============================================================

\echo
\echo === 1. DATABASE ===
SELECT
    current_database() AS database,
    current_user AS db_user,
    current_timestamp AS generated_at;

\echo
\echo === 2. RELEVANT ENUM VALUES ===
SELECT
    t.typname AS enum_type,
    e.enumsortorder,
    e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN (
    'club_succession',
    'club_organization_relation',
    'match_round_type',
    'match_result',
    'stat_coverage'
)
   OR t.typname ILIKE '%succession%'
   OR t.typname ILIKE '%organization%relation%'
   OR t.typname ILIKE '%round%type%'
   OR t.typname ILIKE '%result%'
   OR t.typname ILIKE '%coverage%'
ORDER BY t.typname, e.enumsortorder;

\echo
\echo === 3. PLAYERS TABLE SHAPE ===
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'players'
ORDER BY ordinal_position;

\echo
\echo === 4. ALL CLUB IDENTITIES AND ORGANISATIONS ===
SELECT
    c.id AS club_id,
    c.name,
    c.slug,
    c.short_name,
    c.abbreviation,
    c.organization_id,
    o.name AS organization_name,
    o.slug AS organization_slug,
    c.current_identity_id,
    c.succession,
    c.first_season,
    c.last_season,
    c.is_current_afl_club
FROM clubs c
LEFT JOIN club_organizations o
    ON o.id = c.organization_id
ORDER BY o.name NULLS LAST, c.first_season NULLS FIRST, c.name;

\echo
\echo === 5. CLUB ORGANISATION RELATIONS ===
SELECT
    r.from_organization_id,
    fo.name AS from_organization,
    r.to_organization_id,
    too.name AS to_organization,
    r.relation,
    r.effective_season,
    r.notes
FROM club_organization_relations r
LEFT JOIN club_organizations fo
    ON fo.id = r.from_organization_id
LEFT JOIN club_organizations too
    ON too.id = r.to_organization_id
ORDER BY fo.name, too.name, r.effective_season;

\echo
\echo === 6. ADELAIDE / BRISBANE IDENTITIES ===
SELECT
    c.id AS club_id,
    c.name,
    c.slug,
    c.organization_id,
    o.name AS organization_name,
    o.slug AS organization_slug,
    c.current_identity_id,
    c.succession,
    c.first_season,
    c.last_season,
    c.is_current_afl_club
FROM clubs c
LEFT JOIN club_organizations o
    ON o.id = c.organization_id
WHERE c.name ILIKE '%Adelaide%'
   OR c.name ILIKE '%Brisbane%'
   OR o.name ILIKE '%Adelaide%'
   OR o.name ILIKE '%Brisbane%'
ORDER BY o.name, c.first_season NULLS FIRST, c.name;

\echo
\echo === 7. ADELAIDE VS BRISBANE LIONS - H2H SUMMARY ===
WITH target AS (
    SELECT
        (SELECT id
         FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id
         LIMIT 1) AS org_a,
        (SELECT id
         FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id
         LIMIT 1) AS org_b
),
h2h AS (
    SELECT
        m.*,
        hc.organization_id AS home_org_id,
        ac.organization_id AS away_org_id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    CROSS JOIN target t
    WHERE (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
       OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
)
SELECT
    oa.name AS club_a,
    ob.name AS club_b,
    count(*) AS matches,
    count(*) FILTER (
        WHERE h.winner_club_id IN (
            SELECT id FROM clubs WHERE organization_id = t.org_a
        )
    ) AS club_a_wins,
    count(*) FILTER (
        WHERE h.winner_club_id IN (
            SELECT id FROM clubs WHERE organization_id = t.org_b
        )
    ) AS club_b_wins,
    count(*) FILTER (
        WHERE h.result::text ILIKE '%draw%'
           OR h.home_score = h.away_score
    ) AS draws,
    min(h.match_date) AS first_meeting,
    max(h.match_date) AS latest_meeting,
    count(*) FILTER (WHERE h.is_final IS TRUE) AS is_final_matches,
    count(*) FILTER (WHERE h.is_finals_series IS TRUE) AS finals_series_matches
FROM h2h h
CROSS JOIN target t
LEFT JOIN club_organizations oa ON oa.id = t.org_a
LEFT JOIN club_organizations ob ON ob.id = t.org_b
GROUP BY oa.name, ob.name, t.org_a, t.org_b;

\echo
\echo === 8. ADELAIDE VS BRISBANE LIONS - EVERY MATCH ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
)
SELECT
    m.id AS match_id,
    m.season,
    m.round_code,
    m.round_number,
    m.round_type,
    m.is_final,
    m.is_finals_series,
    m.match_event,
    m.match_date,
    v.canonical_name AS venue,
    hc.name AS home_club,
    m.home_score,
    m.away_score,
    ac.name AS away_club,
    wc.name AS winner,
    m.result,
    m.margin,
    m.attendance
FROM matches m
JOIN clubs hc ON hc.id = m.home_club_id
JOIN clubs ac ON ac.id = m.away_club_id
LEFT JOIN clubs wc ON wc.id = m.winner_club_id
LEFT JOIN venues v ON v.id = m.venue_id
CROSS JOIN target t
WHERE (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
   OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
ORDER BY m.match_date, m.id;

\echo
\echo === 9. ADELAIDE VS BRISBANE LIONS - RECORD BY VENUE ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
),
h2h AS (
    SELECT
        m.*,
        hc.organization_id AS home_org_id,
        ac.organization_id AS away_org_id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    CROSS JOIN target t
    WHERE (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
       OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
)
SELECT
    coalesce(v.canonical_name, h.venue_raw, '[unknown]') AS venue,
    count(*) AS matches,
    count(*) FILTER (
        WHERE wc.organization_id = t.org_a
    ) AS club_a_wins,
    count(*) FILTER (
        WHERE wc.organization_id = t.org_b
    ) AS club_b_wins,
    count(*) FILTER (
        WHERE h.home_score = h.away_score
    ) AS draws,
    min(h.match_date) AS first_meeting,
    max(h.match_date) AS latest_meeting
FROM h2h h
CROSS JOIN target t
LEFT JOIN venues v ON v.id = h.venue_id
LEFT JOIN clubs wc ON wc.id = h.winner_club_id
GROUP BY coalesce(v.canonical_name, h.venue_raw, '[unknown]')
ORDER BY matches DESC, venue;

\echo
\echo === 10. ADELAIDE VS BRISBANE LIONS - FINALS MEETINGS ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
)
SELECT
    m.id,
    m.season,
    m.round_code,
    m.round_type,
    m.is_final,
    m.is_finals_series,
    m.match_event,
    m.match_date,
    hc.name AS home_club,
    m.home_score,
    m.away_score,
    ac.name AS away_club,
    wc.name AS winner,
    m.margin
FROM matches m
JOIN clubs hc ON hc.id = m.home_club_id
JOIN clubs ac ON ac.id = m.away_club_id
LEFT JOIN clubs wc ON wc.id = m.winner_club_id
CROSS JOIN target t
WHERE (
       (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
    OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
)
AND (m.is_final IS TRUE OR m.is_finals_series IS TRUE)
ORDER BY m.match_date, m.id;

\echo
\echo === 11. PLAYER_CLUBS - CROSSOVER PLAYERS BETWEEN ADELAIDE AND BRISBANE LIONS ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
),
by_org AS (
    SELECT
        pc.player_id,
        c.organization_id,
        sum(pc.games) AS games,
        sum(pc.goals) AS goals,
        min(pc.first_season) AS first_season,
        max(pc.last_season) AS last_season,
        min(pc.first_match_id) AS first_match_id,
        max(pc.last_match_id) AS last_match_id
    FROM player_clubs pc
    JOIN clubs c ON c.id = pc.club_id
    CROSS JOIN target t
    WHERE c.organization_id IN (t.org_a, t.org_b)
    GROUP BY pc.player_id, c.organization_id
),
both AS (
    SELECT player_id
    FROM by_org
    GROUP BY player_id
    HAVING count(DISTINCT organization_id) = 2
)
SELECT
    b.player_id,
    COALESCE(
        NULLIF(to_jsonb(p)->>'display_name', ''),
        NULLIF(to_jsonb(p)->>'full_name', ''),
        NULLIF(to_jsonb(p)->>'name', ''),
        concat_ws(
            ' ',
            NULLIF(to_jsonb(p)->>'first_name', ''),
            NULLIF(to_jsonb(p)->>'last_name', '')
        )
    ) AS player_name,
    oa.name AS club_a,
    a.games AS club_a_games,
    a.goals AS club_a_goals,
    a.first_season AS club_a_first_season,
    a.last_season AS club_a_last_season,
    ob.name AS club_b,
    bb.games AS club_b_games,
    bb.goals AS club_b_goals,
    bb.first_season AS club_b_first_season,
    bb.last_season AS club_b_last_season,
    CASE
        WHEN a.first_match_id < bb.first_match_id THEN oa.name || ' -> ' || ob.name
        WHEN bb.first_match_id < a.first_match_id THEN ob.name || ' -> ' || oa.name
        ELSE 'same/unknown'
    END AS first_representation_direction
FROM both b
CROSS JOIN target t
JOIN players p ON p.id = b.player_id
JOIN by_org a
    ON a.player_id = b.player_id
   AND a.organization_id = t.org_a
JOIN by_org bb
    ON bb.player_id = b.player_id
   AND bb.organization_id = t.org_b
LEFT JOIN club_organizations oa ON oa.id = t.org_a
LEFT JOIN club_organizations ob ON ob.id = t.org_b
ORDER BY
    (coalesce(a.games,0) + coalesce(bb.games,0)) DESC,
    player_name;

\echo
\echo === 12. PLAYER MATCH STAT COLUMNS AVAILABLE ===
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'player_match_stats'
ORDER BY ordinal_position;

\echo
\echo === 13. STAT AVAILABILITY - COVERAGE BY STAT ===
SELECT
    stat_key,
    min(season) FILTER (WHERE is_recorded) AS first_recorded_season,
    max(season) FILTER (WHERE is_recorded) AS last_recorded_season,
    count(*) FILTER (WHERE is_recorded) AS recorded_seasons,
    sum(populated_rows) AS populated_rows,
    sum(total_rows) AS total_rows
FROM stat_availability
GROUP BY stat_key
ORDER BY stat_key;

\echo
\echo === 14. STAT AVAILABILITY - RECENT SEASONS ===
SELECT
    stat_key,
    season,
    is_recorded,
    populated_rows,
    total_rows,
    coverage
FROM stat_availability
WHERE season >= 2020
ORDER BY season DESC, stat_key;

\echo
\echo === 15. ADELAIDE / BRISBANE SELECTED-SEASON CLUB RECORDS ===
SELECT
    cs.season,
    o.name AS organization,
    c.name AS club_identity,
    cs.played,
    cs.wins,
    cs.draws,
    cs.losses,
    cs.points_for,
    cs.points_against,
    cs.premiership_points,
    cs.percentage,
    cs.ladder_rank,
    cs.finals_played,
    cs.is_premier,
    cs.wooden_spoon
FROM club_seasons cs
JOIN clubs c ON c.id = cs.club_id
JOIN club_organizations o ON o.id = c.organization_id
WHERE (
       o.name ILIKE '%Adelaide%'
    OR o.name ILIKE '%Brisbane Lions%'
)
AND cs.season >= 2024
ORDER BY cs.season DESC, o.name, c.name;

\echo
\echo === 16. PLAYER_CLUB_SEASON_STATS COVERAGE ===
SELECT
    min(season) AS first_season,
    max(season) AS last_season,
    count(*) AS rows,
    count(DISTINCT player_id) AS players,
    count(DISTINCT club_id) AS club_identities
FROM player_club_season_stats;

\echo
\echo === 17. BROWNLOW SEASON COVERAGE ===
SELECT
    min(season) AS first_season,
    max(season) AS last_season,
    count(*) AS rows,
    count(DISTINCT season) AS seasons,
    count(DISTINCT player_id) AS players,
    count(*) FILTER (WHERE is_winner) AS winner_rows,
    count(*) FILTER (WHERE is_ineligible) AS ineligible_rows
FROM brownlow_season_votes;

\echo
\echo === 18. ADELAIDE / BRISBANE BROWNLOW SEASON SUMMARY ===
SELECT
    bsv.season,
    o.name AS organization,
    sum(bsv.votes) AS total_votes,
    count(*) FILTER (WHERE bsv.votes > 0) AS players_polling,
    max(bsv.votes) AS leading_votes,
    sum(bsv.three_vote_games) AS three_vote_games,
    count(*) FILTER (WHERE bsv.is_winner) AS winners
FROM brownlow_season_votes bsv
JOIN clubs c ON c.id = bsv.club_id
JOIN club_organizations o ON o.id = c.organization_id
WHERE o.name ILIKE '%Adelaide%'
   OR o.name ILIKE '%Brisbane Lions%'
GROUP BY bsv.season, o.name
ORDER BY bsv.season DESC, o.name;

\echo
\echo === 19. BROWNLOW ROUND VOTE COVERAGE ===
SELECT
    min(season) AS first_season,
    max(season) AS last_season,
    count(*) AS rows,
    count(DISTINCT season) AS seasons,
    count(DISTINCT player_id) AS players,
    count(*) FILTER (WHERE played) AS played_rows,
    count(*) FILTER (WHERE votes > 0) AS vote_rows
FROM brownlow_round_votes;

\echo
\echo === 20. PLAYER_MATCH_STATS BROWNLOW COVERAGE ===
SELECT
    min(m.season) FILTER (WHERE pms.brownlow_votes IS NOT NULL) AS first_season,
    max(m.season) FILTER (WHERE pms.brownlow_votes IS NOT NULL) AS last_season,
    count(*) FILTER (WHERE pms.brownlow_votes IS NOT NULL) AS recorded_rows,
    count(*) FILTER (WHERE pms.brownlow_votes > 0) AS polling_rows,
    sum(pms.brownlow_votes) FILTER (WHERE pms.brownlow_votes IS NOT NULL) AS total_votes
FROM player_match_stats pms
JOIN matches m ON m.id = pms.match_id;

\echo
\echo === 21. ADELAIDE VS BRISBANE - H2H PLAYER LEADERS ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
),
h2h_matches AS (
    SELECT m.id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    CROSS JOIN target t
    WHERE (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
       OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
)
SELECT
    pms.player_id,
    COALESCE(
        NULLIF(to_jsonb(p)->>'display_name', ''),
        NULLIF(to_jsonb(p)->>'full_name', ''),
        NULLIF(to_jsonb(p)->>'name', ''),
        concat_ws(
            ' ',
            NULLIF(to_jsonb(p)->>'first_name', ''),
            NULLIF(to_jsonb(p)->>'last_name', '')
        )
    ) AS player_name,
    o.name AS organization,
    count(*) AS games,
    sum(pms.goals) AS goals,
    max(pms.goals) AS max_goals_in_match,
    max(pms.disposals) AS max_disposals_in_match,
    sum(pms.brownlow_votes) AS brownlow_votes
FROM player_match_stats pms
JOIN h2h_matches hm ON hm.id = pms.match_id
JOIN players p ON p.id = pms.player_id
JOIN clubs c ON c.id = pms.club_id
LEFT JOIN club_organizations o ON o.id = c.organization_id
GROUP BY pms.player_id, p, o.name
ORDER BY games DESC, goals DESC NULLS LAST
LIMIT 50;

\echo
\echo === 22. H2H PERIOD SCORE COVERAGE ===
WITH target AS (
    SELECT
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Adelaide%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_a,
        (SELECT id FROM club_organizations
         WHERE name ILIKE '%Brisbane Lions%'
         ORDER BY is_active DESC, id LIMIT 1) AS org_b
),
h2h_matches AS (
    SELECT m.id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    CROSS JOIN target t
    WHERE (hc.organization_id = t.org_a AND ac.organization_id = t.org_b)
       OR (hc.organization_id = t.org_b AND ac.organization_id = t.org_a)
)
SELECT
    count(DISTINCT hm.id) AS h2h_matches,
    count(DISTINCT mps.match_id) AS matches_with_period_scores,
    count(*) AS period_score_rows,
    min(mps.period) AS min_period,
    max(mps.period) AS max_period
FROM h2h_matches hm
LEFT JOIN match_period_scores mps ON mps.match_id = hm.id;

\echo
\echo === 23. LONG-RUNNING RIVALRY SCALE - TOP ORGANISATION PAIRS ===
WITH pair_counts AS (
    SELECT
        LEAST(hc.organization_id, ac.organization_id) AS org_a,
        GREATEST(hc.organization_id, ac.organization_id) AS org_b,
        count(*) AS matches,
        min(m.season) AS first_season,
        max(m.season) AS last_season
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE hc.organization_id IS NOT NULL
      AND ac.organization_id IS NOT NULL
      AND hc.organization_id <> ac.organization_id
    GROUP BY
        LEAST(hc.organization_id, ac.organization_id),
        GREATEST(hc.organization_id, ac.organization_id)
)
SELECT
    oa.name AS organization_a,
    ob.name AS organization_b,
    pc.matches,
    pc.first_season,
    pc.last_season
FROM pair_counts pc
JOIN club_organizations oa ON oa.id = pc.org_a
JOIN club_organizations ob ON ob.id = pc.org_b
ORDER BY pc.matches DESC
LIMIT 20;

\echo
\echo === 24. PLAYER-MATCH SCALE FOR TOP H2H PAIRS ===
WITH pair_matches AS (
    SELECT
        LEAST(hc.organization_id, ac.organization_id) AS org_a,
        GREATEST(hc.organization_id, ac.organization_id) AS org_b,
        m.id AS match_id
    FROM matches m
    JOIN clubs hc ON hc.id = m.home_club_id
    JOIN clubs ac ON ac.id = m.away_club_id
    WHERE hc.organization_id IS NOT NULL
      AND ac.organization_id IS NOT NULL
      AND hc.organization_id <> ac.organization_id
),
pair_scale AS (
    SELECT
        pm.org_a,
        pm.org_b,
        count(DISTINCT pm.match_id) AS matches,
        count(pms.id) AS player_match_rows
    FROM pair_matches pm
    LEFT JOIN player_match_stats pms ON pms.match_id = pm.match_id
    GROUP BY pm.org_a, pm.org_b
)
SELECT
    oa.name AS organization_a,
    ob.name AS organization_b,
    ps.matches,
    ps.player_match_rows
FROM pair_scale ps
JOIN club_organizations oa ON oa.id = ps.org_a
JOIN club_organizations ob ON ob.id = ps.org_b
ORDER BY ps.matches DESC
LIMIT 20;

\echo
\echo ============================================================
\echo END ISSUE-138 TEST DATABASE EVIDENCE
\echo ============================================================
