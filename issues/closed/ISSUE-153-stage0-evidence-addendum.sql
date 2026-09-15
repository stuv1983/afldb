-- AFLDB-ISSUE-153 Stage 0 — evidence addendum
--
-- Closes the two gaps the main pack opened rather than settled:
--   A1  the exact 3 players separating FS1 reading A (99) from B/D (96)
--   A2  the FS4-side cross-domain composition (11 rows, §7.4) — is its
--       wording already reachable outside the cross-domain reading?
--   A3  the C5/C6 collateral: family sizes, so the family-grain decision
--       is costed even though C5/C6 sit outside the eight labels.
--
-- READ ONLY transaction, SELECTs only, ends with ROLLBACK. afldb_test only.

\pset null '∅'
\timing on

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '=== A1 FS1 the 3-player gap — trusted rule sons whose FATHER is not a trusted link ==='
SELECT f.drafted_player_id AS son_id, p.display_name AS son_name, f.draft_year,
       f.father_name, f.father_player_id, f.father_link_status::text AS father_link_status,
       COALESCE(fpcs.games, 0)::int AS father_career_games
  FROM father_son_selections f
  JOIN players p ON p.id = f.drafted_player_id
  LEFT JOIN player_career_stats fpcs ON fpcs.player_id = f.father_player_id
 WHERE f.drafted_link_status IN ('unique','resolved')
   AND (f.father_player_id IS NULL OR f.father_link_status NOT IN ('unique','resolved'))
 ORDER BY f.draft_year, p.display_name;

\echo ''
\echo '=== A2 FS1 set difference proved directly: father_son_selection minus has_afl_father ==='
WITH fs AS (
  SELECT DISTINCT drafted_player_id AS player_id FROM father_son_selections
   WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique','resolved')
),
haf AS (
  SELECT DISTINCT r.person_b_player_id AS player_id
    FROM player_relationships r
    JOIN player_career_stats fc ON fc.player_id = r.person_a_player_id
   WHERE r.relationship = 'parent_child'
     AND r.person_a_role = 'father' AND r.person_b_role = 'son'
     AND r.person_b_player_id IS NOT NULL AND fc.games > 0
)
SELECT p.id AS player_id, p.display_name, 'in father_son_selection, NOT in has_afl_father' AS side
  FROM (SELECT player_id FROM fs EXCEPT SELECT player_id FROM haf) d
  JOIN players p ON p.id = d.player_id
 UNION ALL
SELECT p.id, p.display_name, 'in has_afl_father, NOT in father_son_selection'
  FROM (SELECT player_id FROM haf EXCEPT SELECT player_id FROM fs) d
  JOIN players p ON p.id = d.player_id
 ORDER BY side, display_name;

\echo ''
\echo '=== A3 C5/C6 collateral — family size distribution (the family grain the C1 decision creates) ==='
WITH members AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
),
fam AS (
  SELECT family_key, count(DISTINCT player_id)::int AS members
    FROM members GROUP BY family_key
)
SELECT members AS family_size, count(*)::int AS families
  FROM fam GROUP BY members ORDER BY members;

\echo ''
\echo '=== A4 D6 R3 costed — family count and size under sibling-only vs parent_child-folded ==='
WITH sib AS (
  SELECT family_key, person_a_player_id AS player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_a_player_id IS NOT NULL
  UNION
  SELECT family_key, person_b_player_id FROM player_relationships
   WHERE family_key IS NOT NULL AND person_b_player_id IS NOT NULL
)
SELECT (SELECT count(DISTINCT family_key) FROM sib)::int AS sibling_only_families,
       (SELECT count(DISTINCT player_id) FROM sib)::int AS sibling_only_linked_players,
       (SELECT count(*) FROM (
          SELECT person_a_player_id AS a, person_b_player_id AS b
            FROM player_relationships
           WHERE relationship = 'parent_child'
             AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL) x)::int
         AS parent_child_edges_available_to_fold;

ROLLBACK;
