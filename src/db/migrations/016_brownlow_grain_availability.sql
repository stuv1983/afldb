-- =====================================================================
-- AFLDB 016 — Retire the single 'brownlow' availability key
-- =====================================================================
-- Migration 015 added three grain-aware statistic keys. This migration
-- populates their per-season coverage and removes the generic key, so no
-- reader can ask "was Brownlow recorded in 1950?" and get one answer for
-- three different questions.
--
-- The three grains genuinely disagree:
--
--   season total   1924-2025, except the war years 1942-1945
--   round votes    1984-2025 only
--   match votes    1931-1934 and 1984-2025, and PARTIAL even inside that
--                  window — no season from 1931 to 1934 has every
--                  home-and-away match fully polled
--
-- Finals are never polled for the Brownlow, so their absence from the
-- match grain is not_applicable, not missing data.
--
-- Coverage is computed from the loaded data rather than hardcoded, so a
-- future reload that fills a gap reports the improvement automatically.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Per-season coverage for each grain
-- --------------------------------------------------------------------
WITH season_ctx AS (
    SELECT s.year   AS season,
           s.status AS season_status,
           -- The medal was first awarded in 1924 and was suspended for
           -- the war years. Without a medal there is nothing to record.
           EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year)
             AS medal_awarded
    FROM seasons s
),
match_ctx AS (
    -- A fully polled match distributes exactly 3 + 2 + 1 = 6 votes.
    SELECT mt.season,
           count(*) FILTER (WHERE NOT mt.is_final)                  AS ha_matches,
           count(*) FILTER (WHERE NOT mt.is_final AND vs.total = 6) AS ha_complete,
           count(*) FILTER (WHERE NOT mt.is_final AND vs.total > 0) AS ha_any
    FROM matches mt
    LEFT JOIN LATERAL (
        SELECT COALESCE(sum(pms.brownlow_votes), 0) AS total
        FROM player_match_stats pms WHERE pms.match_id = mt.id
    ) vs ON true
    GROUP BY mt.season
),
round_ctx AS (
    SELECT season, count(*) AS vote_rows
    FROM brownlow_round_votes GROUP BY season
),
resolved AS (
    SELECT
        c.season,
        -- Season total -------------------------------------------------
        CASE
          WHEN c.medal_awarded                    THEN 'complete'
          WHEN c.season_status = 'in_progress'    THEN 'pending'
          ELSE 'not_applicable'
        END::coverage_status AS season_total,
        -- Round votes --------------------------------------------------
        CASE
          WHEN COALESCE(r.vote_rows, 0) > 0       THEN 'complete'
          WHEN c.season_status = 'in_progress'    THEN 'pending'
          WHEN c.medal_awarded                    THEN 'not_collected'
          ELSE 'not_applicable'
        END::coverage_status AS round_votes,
        -- Match votes --------------------------------------------------
        CASE
          WHEN m.ha_matches > 0 AND m.ha_complete = m.ha_matches THEN 'complete'
          WHEN COALESCE(m.ha_any, 0) > 0          THEN 'partial'
          WHEN c.season_status = 'in_progress'    THEN 'pending'
          WHEN c.medal_awarded                    THEN 'not_collected'
          ELSE 'not_applicable'
        END::coverage_status AS match_votes,
        m.ha_matches, m.ha_complete
    FROM season_ctx c
    LEFT JOIN match_ctx m ON m.season = c.season
    LEFT JOIN round_ctx r ON r.season = c.season
)
INSERT INTO stat_availability (stat_key, season, is_recorded, coverage,
                               populated_rows, total_rows)
SELECT 'brownlow_season_total', season, season_total = 'complete', season_total,
       NULL::integer, NULL::integer FROM resolved
UNION ALL
SELECT 'brownlow_round_votes', season, round_votes = 'complete', round_votes,
       NULL::integer, NULL::integer FROM resolved
UNION ALL
SELECT 'brownlow_match_votes', season,
       match_votes IN ('complete', 'partial'), match_votes,
       ha_complete::integer, ha_matches::integer FROM resolved
ON CONFLICT (stat_key, season) DO UPDATE
   SET is_recorded    = EXCLUDED.is_recorded,
       coverage       = EXCLUDED.coverage,
       populated_rows = EXCLUDED.populated_rows,
       total_rows     = EXCLUDED.total_rows;

-- --------------------------------------------------------------------
-- 2. Remove the generic key
-- --------------------------------------------------------------------
-- ON DELETE CASCADE on stat_availability.stat_key removes its per-season
-- rows with it. Nothing reads this key any more: the site reads the
-- season-total grain, which is the one that answers "how many votes".
DELETE FROM stat_definitions WHERE key = 'brownlow';
