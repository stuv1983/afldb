-- AFLDB-ISSUE-152 Phase D — family / father–son evidence (UNBLOCKED HALF ONLY)
--
-- Purpose:
--   Measure the five facts the Phase D implementation cannot settle by code
--   inspection, for the ISSUE-153-INDEPENDENT subfamilies only:
--     C2  brothers who played            (reuses has_brother)
--     C3  parent-child AFL players       (typed player_relationships)
--     C4  relationship-typed, per-player (new player-parameterised builders)
--     FS4 fathers of father-son selections (reuses father_son_father)
--
--   Nothing here measures C1 / FS1-FS3 / FS6, which stay blocked on
--   AFLDB-ISSUE-153, and nothing here re-measures §5.3.C / §5.3.D, which the
--   Stage-0 pack already established.
--
-- Safety:
--   READ ONLY transaction, SELECTs only, ends with ROLLBACK. No loader, no
--   migration, no write path, no DDL.
--
-- Run (afldb_test only):
--   psql -X -v ON_ERROR_STOP=1 -f ISSUE-152-phase-d-evidence.sql -d "$AFLDB_TEST_DATABASE_URL"

\pset pager off
\pset null '∅'
\timing on

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '====================================================================='
\echo 'AFLDB-ISSUE-152 PHASE D EVIDENCE (unblocked half)'
\echo '====================================================================='

-- ---------------------------------------------------------------------
-- D0. Role inventory — decides whether a DIRECTIONAL parent/child reading
--     ("players whose father also played") is data-supported, or whether
--     only the SYMMETRIC reading may ship. Exhaustive, both columns.
-- ---------------------------------------------------------------------
\echo ''
\echo '=== D0.1 person_a_role / person_b_role inventory by relationship (exhaustive) ==='
SELECT relationship::text AS relationship,
       coalesce(person_a_role, '(null)') AS person_a_role,
       coalesce(person_b_role, '(null)') AS person_b_role,
       count(*)::bigint AS rows,
       count(*) FILTER (WHERE person_a_player_id IS NOT NULL
                          AND person_b_player_id IS NOT NULL)::bigint AS both_linked
  FROM player_relationships
 GROUP BY 1, 2, 3
 ORDER BY 1, 4 DESC, 2, 3;

-- ---------------------------------------------------------------------
-- D1. C2 — the set has_brother already returns, sized. The builder is
--     reused verbatim; this only sizes the answer (NL list cap is 100).
-- ---------------------------------------------------------------------
\echo ''
\echo '=== D1.1 C2: players has_brother returns (label-backed, other side played) ==='
SELECT count(*)::bigint AS players_with_a_brother_who_played
  FROM (
    SELECT r.person_a_player_id AS pid
      FROM player_relationships r
      JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_a_player_id IS NOT NULL AND bc.games > 0
     UNION
    SELECT r.person_b_player_id
      FROM player_relationships r
      JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_b_player_id IS NOT NULL AND ac.games > 0
  ) s;

\echo ''
\echo '=== D1.2 C2: how many of those have ZERO games themselves (renders as a 0-game row) ==='
SELECT count(*)::bigint AS returned_players_with_no_games
  FROM (
    SELECT r.person_a_player_id AS pid
      FROM player_relationships r
      JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_a_player_id IS NOT NULL AND bc.games > 0
     UNION
    SELECT r.person_b_player_id
      FROM player_relationships r
      JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_b_player_id IS NOT NULL AND ac.games > 0
  ) s
  LEFT JOIN player_career_stats pcs ON pcs.player_id = s.pid
 WHERE coalesce(pcs.games, 0) = 0;

-- ---------------------------------------------------------------------
-- D2. C3 — the proposed symmetric parent_child builder, sized, using the
--     SAME fail-closed rule has_brother uses: both sides linked, the OTHER
--     side has actually played.
-- ---------------------------------------------------------------------
\echo ''
\echo '=== D2.1 C3: players on either side of a linked parent_child row whose relative played ==='
SELECT count(*)::bigint AS parent_or_child_players
  FROM (
    SELECT r.person_a_player_id AS pid
      FROM player_relationships r
      JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
     WHERE r.relationship = 'parent_child'
       AND r.person_a_player_id IS NOT NULL AND bc.games > 0
     UNION
    SELECT r.person_b_player_id
      FROM player_relationships r
      JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
     WHERE r.relationship = 'parent_child'
       AND r.person_b_player_id IS NOT NULL AND ac.games > 0
  ) s;

\echo ''
\echo '=== D2.2 C3 vs FS4 overlap: is the parent_child parent set the same as father_son_father? ==='
WITH pc_parent AS (
  SELECT DISTINCT r.person_a_player_id AS pid
    FROM player_relationships r
   WHERE r.relationship = 'parent_child'
     AND r.person_a_role = 'father'
     AND r.person_a_player_id IS NOT NULL
), fs_father AS (
  SELECT DISTINCT father_player_id AS pid
    FROM father_son_selections
   WHERE father_player_id IS NOT NULL
     AND father_link_status IN ('unique', 'resolved')
)
SELECT (SELECT count(*) FROM pc_parent)::bigint AS parent_child_fathers,
       (SELECT count(*) FROM fs_father)::bigint AS father_son_selection_fathers,
       (SELECT count(*) FROM (SELECT pid FROM pc_parent INTERSECT SELECT pid FROM fs_father) x)::bigint AS in_both,
       (SELECT count(*) FROM (SELECT pid FROM pc_parent EXCEPT SELECT pid FROM fs_father) x)::bigint AS only_parent_child,
       (SELECT count(*) FROM (SELECT pid FROM fs_father EXCEPT SELECT pid FROM pc_parent) x)::bigint AS only_father_son;

-- ---------------------------------------------------------------------
-- D3. FS4 — the set father_son_father already returns, sized, plus the
--     fathers whose own playing record is empty (they must still be
--     answerable: the builder is about the SON's selection).
-- ---------------------------------------------------------------------
\echo ''
\echo '=== D3.1 FS4: distinct linked fathers of a father-son selection ==='
SELECT count(DISTINCT father_player_id)::bigint AS linked_fathers,
       count(*)::bigint AS selections_with_linked_father
  FROM father_son_selections
 WHERE father_player_id IS NOT NULL
   AND father_link_status IN ('unique', 'resolved');

\echo ''
\echo '=== D3.2 FS4: those fathers, with their own games (top 15 by games) ==='
SELECT p.id, p.display_name, coalesce(pcs.games, 0)::bigint AS games,
       count(fs.id)::bigint AS sons_selected
  FROM father_son_selections fs
  JOIN players p ON p.id = fs.father_player_id
  LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
 WHERE fs.father_player_id IS NOT NULL
   AND fs.father_link_status IN ('unique', 'resolved')
 GROUP BY p.id, p.display_name, pcs.games
 ORDER BY games DESC, p.display_name
 LIMIT 15;

-- ---------------------------------------------------------------------
-- D4. C4 — per-player witnesses. Named players whose relationship answer
--     is small, checkable and stable, for the DB-backed tests.
-- ---------------------------------------------------------------------
\echo ''
\echo '=== D4.1 C4: players with the MOST label-backed brothers who played (top 10) ==='
SELECT p.id, p.display_name, count(*)::bigint AS brothers_who_played
  FROM (
    SELECT r.person_a_player_id AS pid, r.person_b_player_id AS rel
      FROM player_relationships r
      JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_a_player_id IS NOT NULL AND bc.games > 0
     UNION
    SELECT r.person_b_player_id, r.person_a_player_id
      FROM player_relationships r
      JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
     WHERE r.relationship = 'sibling'
       AND r.relationship_label IN ('brothers', 'twin brothers')
       AND r.person_b_player_id IS NOT NULL AND ac.games > 0
  ) s
  JOIN players p ON p.id = s.pid
 GROUP BY p.id, p.display_name
 ORDER BY brothers_who_played DESC, p.display_name
 LIMIT 10;

\echo ''
\echo '=== D4.2 C4 witness: Brent Harvey — every recorded relationship, both directions ==='
SELECT r.id, r.relationship::text, r.relationship_label,
       r.person_a_player_id, r.person_a_name, r.person_a_role,
       r.person_b_player_id, r.person_b_name, r.person_b_role
  FROM player_relationships r
  JOIN players p ON p.display_name = 'Brent Harvey'
 WHERE r.person_a_player_id = p.id OR r.person_b_player_id = p.id
 ORDER BY r.id;

\echo ''
\echo '=== D4.3 C4 fail-closed witness: relationships where the OTHER side is unlinked (10) ==='
SELECT r.id, r.relationship::text, r.relationship_label,
       r.person_a_player_id, r.person_a_name,
       r.person_b_player_id, r.person_b_name
  FROM player_relationships r
 WHERE (r.person_a_player_id IS NULL) <> (r.person_b_player_id IS NULL)
 ORDER BY r.id
 LIMIT 10;

\echo ''
\echo '=== D4.4 C4 identity trap: same display name inside one family (must answer by id) ==='
SELECT r.id, r.relationship::text,
       a.id AS a_id, a.display_name AS a_name,
       b.id AS b_id, b.display_name AS b_name
  FROM player_relationships r
  JOIN players a ON a.id = r.person_a_player_id
  JOIN players b ON b.id = r.person_b_player_id
 WHERE a.display_name = b.display_name
 ORDER BY r.id;

ROLLBACK;

\echo ''
\echo '=== PHASE D EVIDENCE COMPLETE (read-only, rolled back) ==='
