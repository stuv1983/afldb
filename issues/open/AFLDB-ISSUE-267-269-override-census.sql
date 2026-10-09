-- AFLDB-ISSUE-267 / AFLDB-ISSUE-269: read-only exposure census of active `matches` overrides.
--
-- Operator-run only (runbooks issues/open/AFLDB-ISSUE-267.md §17.5, AFLDB-ISSUE-269.md §17.3).
-- Read-only transaction, 30 s statement timeout. Prints no credentials: role and database names only.
-- Plain SQL plus psql \echo / \pset; no \gset or \if.
--
-- WHAT THIS MEASURES. Exposure, not damage:
--   * Section 1 lists the overrides that WOULD trigger ISSUE-267 on the next replay of the unfixed
--     code. It does not show that a past rebuild, reload or promotion wrote NULL period rows.
--   * Section 2 lists the matches that WOULD trigger ISSUE-269. It does not show which group a past
--     replay dropped, or that one was dropped.
--   * Sections 3 and 4 show whether the FIXED replay would refuse on this database (it would stop a
--     `matches` reload, rebuild or the post-swap promotion replay until resolved).
--   * Section 5 is a symptom check only: a final-period row that disagrees with its match totals.
--     A NULL there can be a legitimate "not recorded" source value (NULL is not zero), and a
--     mismatch can have a cause other than the replay. It proves neither corruption nor its cause.
--
-- Exit status (psql, with ON_ERROR_STOP on): 0 when every section ran and '== Done.' is the last line;
-- 3 for any failed statement; 2 for a lost connection. A run that does not end in '== Done.' with
-- status 0 is not evidence.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset null '(null)'
\pset footer on

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

\echo '== 0. Target'
SELECT current_database() AS database, current_user AS role,
       current_setting('transaction_read_only') AS transaction_read_only,
       (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND is_active) AS active_matches_overrides;

\echo '== 1. ISSUE-267 exposure: active matches/score overrides lacking any score component (absent or JSON null)'
SELECT count(*) AS partial_score_overrides,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM matches m WHERE m.match_key = o.entity_key)) AS resolving_to_a_match
  FROM data_overrides o
 WHERE o.entity_type = 'matches' AND o.field_group = 'score' AND o.is_active
   AND (o.override_values->>'home_goals' IS NULL OR o.override_values->>'home_behinds' IS NULL
        OR o.override_values->>'away_goals' IS NULL OR o.override_values->>'away_behinds' IS NULL);

SELECT o.entity_key,
       array_to_string(array_remove(ARRAY[
           CASE WHEN o.override_values->>'home_goals'   IS NULL THEN 'home_goals'   END,
           CASE WHEN o.override_values->>'home_behinds' IS NULL THEN 'home_behinds' END,
           CASE WHEN o.override_values->>'away_goals'   IS NULL THEN 'away_goals'   END,
           CASE WHEN o.override_values->>'away_behinds' IS NULL THEN 'away_behinds' END
       ], NULL), ', ') AS absent_or_null_components,
       o.override_values::text AS payload,
       EXISTS (SELECT 1 FROM matches m WHERE m.match_key = o.entity_key) AS resolves,
       o.updated_at
  FROM data_overrides o
 WHERE o.entity_type = 'matches' AND o.field_group = 'score' AND o.is_active
   AND (o.override_values->>'home_goals' IS NULL OR o.override_values->>'home_behinds' IS NULL
        OR o.override_values->>'away_goals' IS NULL OR o.override_values->>'away_behinds' IS NULL)
 ORDER BY o.entity_key
 LIMIT 200;

\echo '== 2. ISSUE-269 exposure: match keys with more than one active matches override row'
SELECT o.entity_key, count(*) AS active_rows,
       string_agg(o.field_group, ', ' ORDER BY o.field_group) AS field_groups,
       EXISTS (SELECT 1 FROM matches m WHERE m.match_key = o.entity_key) AS resolves
  FROM data_overrides o
 WHERE o.entity_type = 'matches' AND o.is_active
 GROUP BY o.entity_key
HAVING count(*) > 1
 ORDER BY o.entity_key
 LIMIT 200;

\echo '== 3. Fixed replay would refuse: equal-authority rows disagreeing on one field (expected: no rows)'
SELECT o.entity_key, f.key,
       string_agg(o.field_group || '=' || f.value::text, ', ' ORDER BY o.field_group) AS rows_in_conflict
  FROM data_overrides o
  JOIN matches m ON m.match_key = o.entity_key
  CROSS JOIN LATERAL jsonb_each(o.override_values) AS f(key, value)
 WHERE o.entity_type = 'matches' AND o.is_active
 GROUP BY o.entity_key, f.key
HAVING count(DISTINCT f.value) > 1
 ORDER BY o.entity_key, f.key
 LIMIT 200;

\echo '== 4. Fixed replay would refuse: score-overridden match with a component neither source nor merged overrides record (expected: no rows)'
-- The SAME evaluation as the underivable-score preflight in replay_admin_overrides('matches')
-- (tools/migration/common.py): every active row of the match is merged first (lowest field_group
-- wins a key, which only matters where section 3 already reports a disagreement), then each
-- component is COALESCE(merged override, source). A component supplied by ANY active group, not
-- only by the `score` row, counts. Section 3's conflicts are reported there and not repeated here.
WITH merged_overrides AS (
    SELECT w.match_key, jsonb_object_agg(w.key, w.value) AS override_values
      FROM (SELECT DISTINCT ON (o.entity_key, f.key)
                   o.entity_key AS match_key, f.key, f.value
              FROM data_overrides o
              JOIN matches m ON m.match_key = o.entity_key
              CROSS JOIN LATERAL jsonb_each(o.override_values) AS f(key, value)
             WHERE o.entity_type = 'matches' AND o.is_active = true
             ORDER BY o.entity_key, f.key, o.field_group) w
     GROUP BY w.match_key
), evaluated AS (
    SELECT m.match_key, m.home_goals, m.home_behinds, m.away_goals, m.away_behinds,
           o.override_values::text AS merged_override_values,
           array_to_string(array_remove(ARRAY[
               CASE WHEN COALESCE((o.override_values->>'home_goals')::smallint, m.home_goals) IS NULL THEN 'home_goals' END,
               CASE WHEN COALESCE((o.override_values->>'home_behinds')::smallint, m.home_behinds) IS NULL THEN 'home_behinds' END,
               CASE WHEN COALESCE((o.override_values->>'away_goals')::smallint, m.away_goals) IS NULL THEN 'away_goals' END,
               CASE WHEN COALESCE((o.override_values->>'away_behinds')::smallint, m.away_behinds) IS NULL THEN 'away_behinds' END
           ], NULL), ', ') AS missing
      FROM matches m
      LEFT JOIN merged_overrides o ON o.match_key = m.match_key
     WHERE m.match_key IN (SELECT entity_key FROM data_overrides
                            WHERE entity_type = 'matches' AND field_group = 'score' AND is_active = true)
)
SELECT match_key, missing, home_goals AS source_home_goals, home_behinds AS source_home_behinds,
       away_goals AS source_away_goals, away_behinds AS source_away_behinds, merged_override_values
  FROM evaluated
 WHERE missing <> ''
 ORDER BY match_key
 LIMIT 200;

\echo '== 5. Symptom only: score-overridden matches whose final-period rows disagree with the match totals'
WITH scored AS (
    SELECT m.id, m.match_key, m.home_club_id, m.away_club_id,
           m.home_goals, m.home_behinds, m.home_score, m.away_goals, m.away_behinds, m.away_score,
           (SELECT GREATEST(COALESCE(max(p.period), 4), 4)::int FROM match_period_scores p WHERE p.match_id = m.id)
               AS final_period
      FROM matches m
     WHERE m.match_key IN (SELECT entity_key FROM data_overrides
                            WHERE entity_type = 'matches' AND field_group = 'score' AND is_active)
)
SELECT s.match_key, s.final_period, side.side, side.goals AS match_goals, side.behinds AS match_behinds,
       side.points AS match_points, p.goals AS period_goals, p.behinds AS period_behinds,
       p.points AS period_points, (p.match_id IS NULL) AS period_row_missing
  FROM scored s
  CROSS JOIN LATERAL (VALUES ('home', s.home_club_id, s.home_goals, s.home_behinds, s.home_score),
                             ('away', s.away_club_id, s.away_goals, s.away_behinds, s.away_score))
       AS side(side, club_id, goals, behinds, points)
  LEFT JOIN match_period_scores p ON p.match_id = s.id AND p.club_id = side.club_id AND p.period = s.final_period
 WHERE p.match_id IS NULL
    OR p.goals IS DISTINCT FROM side.goals
    OR p.behinds IS DISTINCT FROM side.behinds
    OR p.points IS DISTINCT FROM side.points
 ORDER BY s.match_key, side.side
 LIMIT 200;

ROLLBACK;
\echo '== Done.'
