-- AFLDB-ISSUE-153 Stage 0 — deferred relationship / cross-domain semantics
--
-- Purpose:
--   Measure the facts that decide C1, FS1, FS2, FS3, FS6, D6, D8 and X3.
--   ISSUE-152 measured POPULATION SIZES and concluded the two "father-son"
--   readings "coincide extensionally". A size collapse is not a set identity:
--   127 = 127 is consistent with two disjoint 127-row sets. This pack tests the
--   collapse at ROW and PAIR level, tests whether it is STRUCTURAL (one source)
--   or INCIDENTAL (two sources that happen to agree), and measures every
--   candidate reading that has so far been asserted rather than counted:
--
--     D8   is the father-son collapse a set identity, and is it durable?
--     FS1  the exact answer population under each reading
--     FS2  raw club_id vs organization_id lineage divergence
--     FS3  draft_year vs any playing-season reading (chronology trap)
--     FS6  distribution over ALL rows vs over TRUSTED rows only
--     D6   family_key grouping vs sibling-only vs relationship-graph folding
--     C1   "biggest" by member count vs by combined career games (gap M5)
--     X3   the same answer under BOTH D8 readings, and the coaching seam
--
--   Nothing here re-measures what §5.3.C / §5.3.D already established, except
--   where the earlier number was a COUNT and the decision needs a SET.
--
-- Safety:
--   READ ONLY transaction, SELECTs only, ends with ROLLBACK. No loader, no
--   migration, no write path, no DDL. afldb_test only.
--
-- Run (afldb_test only):
--   .\tools\issue-152\phase-d-evidence.ps1 -SqlFile ISSUE-153-stage0-evidence.sql

\pset null '∅'
\timing on

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '====================================================================='
\echo 'AFLDB-ISSUE-153 STAGE 0 EVIDENCE'
\echo '====================================================================='

-- =====================================================================
-- 0. BASELINE — restate the two populations so every later divergence
--    has a denominator on the same transcript.
-- =====================================================================

\echo ''
\echo '=== 0.1 The two father-son populations, side by side ==='
SELECT 'father_son_selections' AS population,
       count(*)::int AS rows,
       count(*) FILTER (WHERE drafted_player_id IS NOT NULL AND father_player_id IS NOT NULL)::int AS both_linked,
       count(*) FILTER (WHERE drafted_player_id IS NULL OR father_player_id IS NULL)::int AS any_unlinked,
       count(DISTINCT drafted_player_id)::int AS distinct_sons,
       count(DISTINCT father_player_id)::int AS distinct_fathers
  FROM father_son_selections
 UNION ALL
SELECT 'player_relationships parent_child',
       count(*)::int,
       count(*) FILTER (WHERE person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL)::int,
       count(*) FILTER (WHERE person_a_player_id IS NULL OR person_b_player_id IS NULL)::int,
       count(DISTINCT CASE WHEN person_b_role = 'son' THEN person_b_player_id END)::int,
       count(DISTINCT CASE WHEN person_a_role = 'father' THEN person_a_player_id END)::int
  FROM player_relationships
 WHERE relationship = 'parent_child';

\echo ''
\echo '=== 0.2 parent_child role pairs — exhaustive (is direction always father->son?) ==='
SELECT person_a_role, person_b_role, relationship_label, count(*)::int AS rows
  FROM player_relationships
 WHERE relationship = 'parent_child'
 GROUP BY person_a_role, person_b_role, relationship_label
 ORDER BY rows DESC;

-- =====================================================================
-- 1. D8 — IS THE COLLAPSE A SET IDENTITY, AND IS IT DURABLE?
--    §5.3.D proved the father sets overlap 107/107. The SON side and the
--    PAIR level were never tested, and neither was provenance.
-- =====================================================================

\echo ''
\echo '=== 1.1 D8 son-side set comparison (trusted rows only, both readings) ==='
WITH rule_sons AS (
  SELECT DISTINCT drafted_player_id AS player_id
    FROM father_son_selections
   WHERE drafted_player_id IS NOT NULL
     AND drafted_link_status IN ('unique', 'resolved')
),
rel_sons AS (
  SELECT DISTINCT person_b_player_id AS player_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_role = 'father' AND person_b_role = 'son'
     AND person_b_player_id IS NOT NULL
)
SELECT (SELECT count(*) FROM rule_sons)::int AS rule_reading_sons,
       (SELECT count(*) FROM rel_sons)::int  AS relationship_reading_sons,
       (SELECT count(*) FROM (SELECT player_id FROM rule_sons INTERSECT SELECT player_id FROM rel_sons) x)::int AS in_both,
       (SELECT count(*) FROM (SELECT player_id FROM rule_sons EXCEPT SELECT player_id FROM rel_sons) x)::int AS rule_only,
       (SELECT count(*) FROM (SELECT player_id FROM rel_sons EXCEPT SELECT player_id FROM rule_sons) x)::int AS relationship_only;

\echo ''
\echo '=== 1.2 D8 father-side set comparison (re-proof of the 107/107 claim) ==='
WITH rule_fathers AS (
  SELECT DISTINCT father_player_id AS player_id
    FROM father_son_selections
   WHERE father_player_id IS NOT NULL
     AND father_link_status IN ('unique', 'resolved')
),
rel_fathers AS (
  SELECT DISTINCT person_a_player_id AS player_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_role = 'father' AND person_b_role = 'son'
     AND person_a_player_id IS NOT NULL
)
SELECT (SELECT count(*) FROM rule_fathers)::int AS rule_reading_fathers,
       (SELECT count(*) FROM rel_fathers)::int  AS relationship_reading_fathers,
       (SELECT count(*) FROM (SELECT player_id FROM rule_fathers INTERSECT SELECT player_id FROM rel_fathers) x)::int AS in_both,
       (SELECT count(*) FROM (SELECT player_id FROM rule_fathers EXCEPT SELECT player_id FROM rel_fathers) x)::int AS rule_only,
       (SELECT count(*) FROM (SELECT player_id FROM rel_fathers EXCEPT SELECT player_id FROM rule_fathers) x)::int AS relationship_only;

\echo ''
\echo '=== 1.3 D8 PAIR-level comparison — the strongest identity test ==='
WITH rule_pairs AS (
  SELECT DISTINCT father_player_id AS father_id, drafted_player_id AS son_id
    FROM father_son_selections
   WHERE father_player_id IS NOT NULL AND drafted_player_id IS NOT NULL
),
rel_pairs AS (
  SELECT DISTINCT person_a_player_id AS father_id, person_b_player_id AS son_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_role = 'father' AND person_b_role = 'son'
     AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT (SELECT count(*) FROM rule_pairs)::int AS rule_pairs,
       (SELECT count(*) FROM rel_pairs)::int  AS relationship_pairs,
       (SELECT count(*) FROM (SELECT * FROM rule_pairs INTERSECT SELECT * FROM rel_pairs) x)::int AS identical_pairs,
       (SELECT count(*) FROM (SELECT * FROM rule_pairs EXCEPT SELECT * FROM rel_pairs) x)::int AS rule_only_pairs,
       (SELECT count(*) FROM (SELECT * FROM rel_pairs EXCEPT SELECT * FROM rule_pairs) x)::int AS relationship_only_pairs;

\echo ''
\echo '=== 1.4 D8 divergence witnesses — any pair in one reading and not the other (exhaustive) ==='
WITH rule_pairs AS (
  SELECT DISTINCT father_player_id AS father_id, drafted_player_id AS son_id
    FROM father_son_selections
   WHERE father_player_id IS NOT NULL AND drafted_player_id IS NOT NULL
),
rel_pairs AS (
  SELECT DISTINCT person_a_player_id AS father_id, person_b_player_id AS son_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_role = 'father' AND person_b_role = 'son'
     AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
),
diff AS (
  SELECT 'rule_only' AS side, father_id, son_id FROM (SELECT * FROM rule_pairs EXCEPT SELECT * FROM rel_pairs) a
  UNION ALL
  SELECT 'relationship_only', father_id, son_id FROM (SELECT * FROM rel_pairs EXCEPT SELECT * FROM rule_pairs) b
)
SELECT d.side, d.father_id, fp.display_name AS father_name,
       d.son_id, sp.display_name AS son_name
  FROM diff d
  LEFT JOIN players fp ON fp.id = d.father_id
  LEFT JOIN players sp ON sp.id = d.son_id
 ORDER BY d.side, son_name;

\echo ''
\echo '=== 1.5 D8 provenance — is the collapse STRUCTURAL (one source) or INCIDENTAL? ==='
SELECT 'father_son_selections' AS tbl, source_id, count(*)::int AS rows,
       min(import_batch_id)::text AS min_batch, max(import_batch_id)::text AS max_batch,
       NULL::text AS extraction_method
  FROM father_son_selections
 GROUP BY source_id
 UNION ALL
SELECT 'player_relationships parent_child', source_id, count(*)::int,
       min(import_batch_id)::text, max(import_batch_id)::text,
       string_agg(DISTINCT COALESCE(extraction_method, '∅'), ' | ')
  FROM player_relationships
 WHERE relationship = 'parent_child'
 GROUP BY source_id
 ORDER BY tbl, source_id;

\echo ''
\echo '=== 1.6 D8 label / rule inventory — exhaustive, both tables ==='
SELECT 'parent_child label' AS dimension, relationship_label AS value, count(*)::int AS rows
  FROM player_relationships WHERE relationship = 'parent_child' GROUP BY relationship_label
 UNION ALL
SELECT 'father_son rule', rule, count(*)::int FROM father_son_selections GROUP BY rule
 UNION ALL
SELECT 'father_son competition', COALESCE(competition, '∅'), count(*)::int FROM father_son_selections GROUP BY competition
 ORDER BY dimension, rows DESC;

\echo ''
\echo '=== 1.7 D8 durability — could the two ever diverge? Constraint / uniqueness surface ==='
SELECT (SELECT count(*) FROM father_son_selections f
         WHERE f.drafted_player_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM player_relationships r
                            WHERE r.relationship = 'parent_child'
                              AND r.person_b_player_id = f.drafted_player_id))::int AS rule_sons_with_no_relationship_row,
       (SELECT count(*) FROM player_relationships r
         WHERE r.relationship = 'parent_child' AND r.person_b_player_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM father_son_selections f
                            WHERE f.drafted_player_id = r.person_b_player_id))::int AS relationship_sons_with_no_rule_row,
       (SELECT count(*) FROM (SELECT drafted_player_id FROM father_son_selections
                               WHERE drafted_player_id IS NOT NULL
                               GROUP BY drafted_player_id HAVING count(*) > 1) x)::int AS sons_selected_more_than_once;

-- =====================================================================
-- 2. FS1 — THE EXACT ANSWER POPULATION UNDER EACH READING
-- =====================================================================

\echo ''
\echo '=== 2.1 FS1 candidate populations — every defensible answer set, counted ==='
SELECT 'A. rule: trusted drafted link (father_son_selection builder)' AS reading,
       count(DISTINCT drafted_player_id)::int AS players
  FROM father_son_selections
 WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
 UNION ALL
SELECT 'B. rule: trusted drafted link AND father also linked',
       count(DISTINCT drafted_player_id)::int
  FROM father_son_selections
 WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
   AND father_player_id IS NOT NULL AND father_link_status IN ('unique', 'resolved')
 UNION ALL
SELECT 'C. rule: trusted drafted link AND the son actually played',
       count(DISTINCT f.drafted_player_id)::int
  FROM father_son_selections f
  JOIN player_career_stats pcs ON pcs.player_id = f.drafted_player_id
 WHERE f.drafted_player_id IS NOT NULL AND f.drafted_link_status IN ('unique', 'resolved')
   AND pcs.games > 0
 UNION ALL
SELECT 'D. relationship: has_afl_father builder (father linked AND played)',
       count(DISTINCT r.person_b_player_id)::int
  FROM player_relationships r
  JOIN player_career_stats fc ON fc.player_id = r.person_a_player_id
 WHERE r.relationship = 'parent_child'
   AND r.person_a_role = 'father' AND r.person_b_role = 'son'
   AND r.person_b_player_id IS NOT NULL AND fc.games > 0;

\echo ''
\echo '=== 2.2 FS1 divergence witnesses — trusted rule sons who never played a game ==='
SELECT f.drafted_player_id, p.display_name, f.draft_year, COALESCE(pcs.games, 0)::int AS career_games
  FROM father_son_selections f
  JOIN players p ON p.id = f.drafted_player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = f.drafted_player_id
 WHERE f.drafted_link_status IN ('unique', 'resolved')
   AND COALESCE(pcs.games, 0) = 0
 ORDER BY f.draft_year, p.display_name;

-- =====================================================================
-- 3. FS2 — CLUB LINEAGE
-- =====================================================================

\echo ''
\echo '=== 3.1 FS2 raw club_id vs organization_id — where do they differ? ==='
SELECT cl.organization_id,
       count(DISTINCT cl.id)::int AS distinct_club_ids,
       string_agg(DISTINCT cl.name, ' | ' ORDER BY cl.name) AS club_names,
       count(*)::int AS selections,
       min(f.draft_year)::int AS first_year, max(f.draft_year)::int AS last_year
  FROM father_son_selections f
  JOIN clubs cl ON cl.id = f.club_id
 GROUP BY cl.organization_id
 ORDER BY selections DESC, cl.organization_id;

\echo ''
\echo '=== 3.2 FS2 the lineage trap — organizations whose selections span more than one club_id ==='
SELECT cl.organization_id, cl.id AS club_id, cl.name AS club_name,
       cl.first_season, cl.last_season, count(*)::int AS selections
  FROM father_son_selections f
  JOIN clubs cl ON cl.id = f.club_id
 WHERE cl.organization_id IN (
        SELECT c2.organization_id FROM father_son_selections f2
          JOIN clubs c2 ON c2.id = f2.club_id
         GROUP BY c2.organization_id HAVING count(DISTINCT c2.id) > 1)
 GROUP BY cl.organization_id, cl.id, cl.name, cl.first_season, cl.last_season
 ORDER BY cl.organization_id, cl.first_season;

\echo ''
\echo '=== 3.3 FS2 unresolved club — rows a club-scoped answer must fail closed on ==='
SELECT count(*)::int AS selections_with_null_club_id,
       count(*) FILTER (WHERE club_name_raw IS NOT NULL)::int AS with_raw_club_name
  FROM father_son_selections
 WHERE club_id IS NULL;

\echo ''
\echo '=== 3.4 FS2 club-scoped answers — trusted-son counts per organization (the answerable set) ==='
SELECT cl.organization_id, min(cl.name) AS example_club,
       count(*)::int AS all_selections,
       count(*) FILTER (WHERE f.drafted_link_status IN ('unique','resolved'))::int AS trusted_son_selections,
       count(DISTINCT f.drafted_player_id) FILTER (WHERE f.drafted_link_status IN ('unique','resolved'))::int AS trusted_distinct_sons
  FROM father_son_selections f
  JOIN clubs cl ON cl.id = f.club_id
 GROUP BY cl.organization_id
 ORDER BY all_selections DESC, example_club;

-- =====================================================================
-- 4. FS3 — DRAFT YEAR AND THE CHRONOLOGY TRAP
-- =====================================================================

\echo ''
\echo '=== 4.1 FS3 selections by draft year (exhaustive) ==='
SELECT draft_year::int,
       count(*)::int AS selections,
       count(*) FILTER (WHERE drafted_link_status IN ('unique','resolved'))::int AS trusted_sons
  FROM father_son_selections
 GROUP BY draft_year
 ORDER BY draft_year;

\echo ''
\echo '=== 4.2 FS3 the chronology trap — draft_year vs the son actual first playing season ==='
WITH linked AS (
  SELECT f.drafted_player_id AS player_id, f.draft_year, p.display_name
    FROM father_son_selections f
    JOIN players p ON p.id = f.drafted_player_id
   WHERE f.drafted_link_status IN ('unique','resolved')
),
debut AS (
  SELECT l.player_id, l.display_name, l.draft_year,
         min(m.season)::int AS first_season
    FROM linked l
    JOIN player_match_stats pms ON pms.player_id = l.player_id
    JOIN matches m ON m.id = pms.match_id
   GROUP BY l.player_id, l.display_name, l.draft_year
)
SELECT count(*)::int AS linked_sons_who_played,
       count(*) FILTER (WHERE first_season = draft_year)::int      AS debut_same_year_as_draft,
       count(*) FILTER (WHERE first_season = draft_year + 1)::int  AS debut_year_after_draft,
       count(*) FILTER (WHERE first_season > draft_year + 1)::int  AS debut_two_or_more_years_after,
       count(*) FILTER (WHERE first_season < draft_year)::int      AS debut_BEFORE_draft_year
  FROM debut;

\echo ''
\echo '=== 4.3 FS3 divergence witnesses — sons whose debut season is not their draft year ==='
WITH linked AS (
  SELECT f.drafted_player_id AS player_id, f.draft_year, p.display_name
    FROM father_son_selections f
    JOIN players p ON p.id = f.drafted_player_id
   WHERE f.drafted_link_status IN ('unique','resolved')
),
debut AS (
  SELECT l.player_id, l.display_name, l.draft_year, min(m.season)::int AS first_season
    FROM linked l
    JOIN player_match_stats pms ON pms.player_id = l.player_id
    JOIN matches m ON m.id = pms.match_id
   GROUP BY l.player_id, l.display_name, l.draft_year
)
SELECT player_id, display_name, draft_year, first_season,
       (first_season - draft_year)::int AS years_between
  FROM debut
 WHERE first_season <> draft_year
 ORDER BY abs(first_season - draft_year) DESC, display_name
 LIMIT 40;

-- =====================================================================
-- 5. FS6 — DISTRIBUTION: WHICH DENOMINATOR IS HONEST?
-- =====================================================================

\echo ''
\echo '=== 5.1 FS6 the denominator question — all rows vs trusted rows, both groupings ==='
SELECT 'by organization' AS grouping,
       count(DISTINCT cl.organization_id)::int AS groups,
       count(*)::int AS all_rows,
       count(*) FILTER (WHERE f.drafted_link_status IN ('unique','resolved'))::int AS trusted_rows
  FROM father_son_selections f LEFT JOIN clubs cl ON cl.id = f.club_id
 UNION ALL
SELECT 'by draft year',
       count(DISTINCT draft_year)::int, count(*)::int,
       count(*) FILTER (WHERE drafted_link_status IN ('unique','resolved'))::int
  FROM father_son_selections;

\echo ''
\echo '=== 5.2 FS6 groups whose answer CHANGES between the two denominators ==='
SELECT cl.organization_id, min(cl.name) AS example_club,
       count(*)::int AS all_rows,
       count(*) FILTER (WHERE f.drafted_link_status IN ('unique','resolved'))::int AS trusted_rows,
       (count(*) - count(*) FILTER (WHERE f.drafted_link_status IN ('unique','resolved')))::int AS lost_rows
  FROM father_son_selections f
  JOIN clubs cl ON cl.id = f.club_id
 GROUP BY cl.organization_id
HAVING count(*) <> count(*) FILTER (WHERE f.drafted_link_status IN ('unique','resolved'))
 ORDER BY lost_rows DESC, example_club;

-- =====================================================================
-- 6. D6 / C1 — WHAT IS A "FAMILY", AND WHAT MAKES ONE "BIGGEST"?
-- =====================================================================

\echo ''
\echo '=== 6.1 D6 family_key coverage by relationship type (exhaustive) ==='
SELECT relationship::text AS relationship,
       count(*)::int AS rows,
       count(*) FILTER (WHERE family_key IS NOT NULL)::int AS with_family_key,
       count(*) FILTER (WHERE family_key IS NULL)::int AS without_family_key,
       count(DISTINCT family_key)::int AS distinct_family_keys
  FROM player_relationships
 GROUP BY relationship
 ORDER BY rows DESC;

\echo ''
\echo '=== 6.2 D6 reading R1 vs R2 — does ANY family_key group contain a non-sibling row? ==='
SELECT count(*)::int AS family_keys_with_a_non_sibling_row
  FROM (SELECT family_key FROM player_relationships
         WHERE family_key IS NOT NULL AND relationship <> 'sibling'
         GROUP BY family_key) x;

\echo ''
\echo '=== 6.3 C1 gap M5 — combined career games per family (top 25 by GAMES) ==='
WITH members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT m.family_key,
       count(DISTINCT m.player_id)::int AS linked_members,
       sum(COALESCE(pcs.games, 0))::int AS combined_games,
       string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name) AS players
  FROM members m
  JOIN players p ON p.id = m.player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = m.player_id
 GROUP BY m.family_key
 ORDER BY combined_games DESC, linked_members DESC, m.family_key
 LIMIT 25;

\echo ''
\echo '=== 6.4 C1 the metric divergence — top 25 by MEMBER COUNT, with their games rank ==='
WITH members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
),
fam AS (
  SELECT m.family_key,
         count(DISTINCT m.player_id)::int AS linked_members,
         sum(COALESCE(pcs.games, 0))::int AS combined_games
    FROM members m
    LEFT JOIN player_career_stats pcs ON pcs.player_id = m.player_id
   GROUP BY m.family_key
)
SELECT family_key, linked_members, combined_games,
       rank() OVER (ORDER BY linked_members DESC)::int AS rank_by_members,
       rank() OVER (ORDER BY combined_games DESC)::int AS rank_by_games,
       (rank() OVER (ORDER BY combined_games DESC)
        - rank() OVER (ORDER BY linked_members DESC))::int AS rank_shift
  FROM fam
 ORDER BY linked_members DESC, combined_games DESC
 LIMIT 25;

\echo ''
\echo '=== 6.5 D6 reading R3 — folding parent_child in by player graph, not family_key ==='
-- parent_child rows carry NO family_key. If a "football family" is meant to
-- include a father and son, family_key CANNOT express it. This measures how
-- many sibling families would GAIN a member if the parent_child edges were
-- folded in on shared player identity.
WITH sib_members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
),
pc AS (
  SELECT person_a_player_id AS father_id, person_b_player_id AS son_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
),
touching AS (
  SELECT DISTINCT s.family_key, pc.father_id, pc.son_id
    FROM pc JOIN sib_members s
      ON s.player_id = pc.father_id OR s.player_id = pc.son_id
)
SELECT (SELECT count(*) FROM pc)::int AS linked_parent_child_edges,
       (SELECT count(DISTINCT family_key) FROM touching)::int AS sibling_families_touched_by_a_parent_child_edge,
       (SELECT count(*) FROM pc WHERE NOT EXISTS (
          SELECT 1 FROM sib_members s WHERE s.player_id = pc.father_id OR s.player_id = pc.son_id))::int
         AS parent_child_edges_in_no_sibling_family;

\echo ''
\echo '=== 6.6 D6 R3 witnesses — sibling families a parent_child edge would extend ==='
WITH sib_members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
),
pc AS (
  SELECT person_a_player_id AS father_id, person_b_player_id AS son_id
    FROM player_relationships
   WHERE relationship = 'parent_child'
     AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT s.family_key,
       fp.display_name AS father_name, pc.father_id,
       sp.display_name AS son_name,    pc.son_id,
       (SELECT count(DISTINCT s2.player_id) FROM sib_members s2 WHERE s2.family_key = s.family_key)::int AS current_members,
       CASE WHEN EXISTS (SELECT 1 FROM sib_members s3 WHERE s3.family_key = s.family_key AND s3.player_id = pc.father_id)
             AND EXISTS (SELECT 1 FROM sib_members s4 WHERE s4.family_key = s.family_key AND s4.player_id = pc.son_id)
            THEN 'both already in family' ELSE 'WOULD ADD A MEMBER' END AS effect
  FROM pc
  JOIN sib_members s ON s.player_id = pc.father_id OR s.player_id = pc.son_id
  LEFT JOIN players fp ON fp.id = pc.father_id
  LEFT JOIN players sp ON sp.id = pc.son_id
 GROUP BY s.family_key, fp.display_name, pc.father_id, sp.display_name, pc.son_id
 ORDER BY effect, s.family_key
 LIMIT 60;

\echo ''
\echo '=== 6.7 C1 identity hazard — families containing two players with the same display name ==='
WITH members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT m.family_key, p.display_name, count(DISTINCT m.player_id)::int AS distinct_player_ids,
       string_agg(DISTINCT m.player_id::text, ', ') AS player_ids
  FROM members m JOIN players p ON p.id = m.player_id
 GROUP BY m.family_key, p.display_name
HAVING count(DISTINCT m.player_id) > 1
 ORDER BY m.family_key;

\echo ''
\echo '=== 6.8 C1 fail-closed size — families with an unlinked side ==='
SELECT count(DISTINCT family_key)::int AS family_keys_with_an_unlinked_side,
       count(*)::int AS rows_with_an_unlinked_side
  FROM player_relationships
 WHERE family_key IS NOT NULL
   AND (person_a_player_id IS NULL OR person_b_player_id IS NULL);

-- =====================================================================
-- 7. X3 — DOES THE ANSWER DEPEND ON D8 AT ALL?
-- =====================================================================

\echo ''
\echo '=== 7.1 X3 under BOTH D8 readings, and both coaching seams ==='
WITH rule_sons AS (
  SELECT DISTINCT drafted_player_id AS player_id FROM father_son_selections
   WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique','resolved')
),
rel_sons AS (
  SELECT DISTINCT person_b_player_id AS player_id FROM player_relationships
   WHERE relationship = 'parent_child' AND person_a_role = 'father' AND person_b_role = 'son'
     AND person_b_player_id IS NOT NULL
)
SELECT 'A. rule reading  x coaches identity only' AS reading,
       (SELECT count(DISTINCT r.player_id) FROM rule_sons r JOIN coaches c ON c.player_id = r.player_id)::int AS answer_count
 UNION ALL
SELECT 'B. rule reading  x ACTUALLY COACHED (match_coaches)',
       (SELECT count(DISTINCT r.player_id) FROM rule_sons r JOIN coaches c ON c.player_id = r.player_id
         WHERE EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id))::int
 UNION ALL
SELECT 'C. relationship reading x coaches identity only',
       (SELECT count(DISTINCT r.player_id) FROM rel_sons r JOIN coaches c ON c.player_id = r.player_id)::int
 UNION ALL
SELECT 'D. relationship reading x ACTUALLY COACHED (match_coaches)',
       (SELECT count(DISTINCT r.player_id) FROM rel_sons r JOIN coaches c ON c.player_id = r.player_id
         WHERE EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id))::int;

\echo ''
\echo '=== 7.2 X3 the answer rows themselves, under the rule reading (exhaustive) ==='
SELECT DISTINCT child.id AS player_id, child.display_name,
       f.draft_year, cl.name AS selection_club, cl.organization_id,
       c.id AS coach_id, c.display_name AS coach_name,
       (SELECT count(*) FROM match_coaches mc WHERE mc.coach_id = c.id)::int AS coached_games
  FROM father_son_selections f
  JOIN players child ON child.id = f.drafted_player_id
  JOIN coaches c ON c.player_id = child.id
  LEFT JOIN clubs cl ON cl.id = f.club_id
 WHERE f.drafted_link_status IN ('unique','resolved')
 ORDER BY coached_games DESC, child.display_name;

\echo ''
\echo '=== 7.3 X3 the answer rows under the relationship reading (exhaustive) ==='
SELECT DISTINCT son.id AS player_id, son.display_name,
       r.person_a_name AS father_name, r.person_a_player_id AS father_id,
       c.id AS coach_id, c.display_name AS coach_name,
       (SELECT count(*) FROM match_coaches mc WHERE mc.coach_id = c.id)::int AS coached_games
  FROM player_relationships r
  JOIN players son ON son.id = r.person_b_player_id
  JOIN coaches c ON c.player_id = son.id
 WHERE r.relationship = 'parent_child'
   AND r.person_a_role = 'father' AND r.person_b_role = 'son'
 ORDER BY coached_games DESC, son.display_name;

\echo ''
\echo '=== 7.4 X3 the FATHER side — fathers of selections who coached (a different question) ==='
SELECT DISTINCT fa.id AS player_id, fa.display_name,
       c.id AS coach_id,
       (SELECT count(*) FROM match_coaches mc WHERE mc.coach_id = c.id)::int AS coached_games
  FROM father_son_selections f
  JOIN players fa ON fa.id = f.father_player_id
  JOIN coaches c ON c.player_id = fa.id
 WHERE f.father_link_status IN ('unique','resolved')
 ORDER BY coached_games DESC, fa.display_name;

\echo ''
\echo '====================================================================='
\echo 'END OF AFLDB-ISSUE-153 STAGE 0 EVIDENCE'
\echo '====================================================================='

ROLLBACK;
