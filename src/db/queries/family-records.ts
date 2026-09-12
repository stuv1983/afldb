import 'server-only';

import { sql } from '@/db/client';

/**
 * Family and father-son record boards, from player_relationships
 * (migration 006, AFLDB-ISSUE-118 §23.29/§23.38).
 *
 * Sibling families are grouped by family_key; father-son pairs are the
 * relationship = 'parent_child' rows and are read separately -- they do
 * not share the family_key grouping, and merging the two models by
 * surname or display name would misrepresent both (ISSUE-139 UI handoff:
 * 351 linked sibling families / 704 players vs 127 parent_child rows, 96
 * with both sides linked).
 *
 * AFLDB-ISSUE-153 Stage 1 (decision Q4): the family board is a SIBLING
 * board -- its page says so -- so both family queries state
 * relationship = 'sibling' rather than grouping whatever relationship
 * types happen to carry a family_key. On today's data this changes
 * nothing (Stage 0 §4.6: all 498 sibling rows carry a family_key, all
 * 127 parent_child rows carry none, and no family_key group holds a
 * non-sibling row), which is exactly why it is safe to state now: the
 * constraint is the contract, not a repair, and a future relationship
 * type that starts carrying a family_key cannot silently redefine what
 * this board counts.
 *
 * The father-son board's own authority is recorded on getFatherSonRecords.
 */

export type FamilyMember = {
  playerId: number;
  name: string;
  slug: string;
  games: number;
};

export type FamilyRecordRow = {
  rank: number;
  familyKey: string;
  familyName: string;
  linkedMembers: number;
  combinedGames: number;
  members: FamilyMember[];
};

/**
 * Most combined career games by a linked sibling family. `family_members`
 * unions both relationship sides before it is grouped, so a player named
 * from more than one relationship row for the same family_key is still
 * counted once toward that family's combined total. Every scan states
 * relationship = 'sibling' (ISSUE-153 Q4) so the family name, the member
 * set and the total are all drawn from the same sibling population.
 */
export async function getFamilyRecords(limit = 50): Promise<FamilyRecordRow[]> {
  return sql<FamilyRecordRow[]>`
    WITH family_names AS (
      SELECT family_key,
             max(family_name) FILTER (WHERE family_name IS NOT NULL) AS family_name
        FROM player_relationships
       WHERE relationship = 'sibling' AND family_key IS NOT NULL
       GROUP BY family_key
    ),
    family_members AS (
      SELECT family_key, person_a_player_id AS player_id
        FROM player_relationships
       WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_a_player_id IS NOT NULL
       UNION
      SELECT family_key, person_b_player_id AS player_id
        FROM player_relationships
       WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_b_player_id IS NOT NULL
    ),
    member_stats AS (
      SELECT fm.family_key, fm.player_id, p.display_name, p.slug,
             COALESCE(pcs.games, 0)::int AS games
        FROM family_members fm
        JOIN players p ON p.id = fm.player_id
        LEFT JOIN player_career_stats pcs ON pcs.player_id = fm.player_id
    ),
    families AS (
      SELECT ms.family_key,
             COALESCE(fn.family_name, ms.family_key) AS family_name,
             count(*)::int AS linked_members,
             sum(ms.games)::int AS combined_games,
             jsonb_agg(
               jsonb_build_object(
                 'playerId', ms.player_id, 'name', ms.display_name,
                 'slug', ms.slug, 'games', ms.games
               ) ORDER BY ms.games DESC, ms.display_name
             ) AS members
        FROM member_stats ms
        LEFT JOIN family_names fn ON fn.family_key = ms.family_key
       GROUP BY ms.family_key, fn.family_name
    )
    SELECT dense_rank() OVER (ORDER BY combined_games DESC, linked_members DESC)::int AS rank,
           family_key AS "familyKey", family_name AS "familyName",
           linked_members AS "linkedMembers", combined_games AS "combinedGames",
           members
      FROM families
     ORDER BY combined_games DESC, linked_members DESC, family_name
     LIMIT ${limit}
  `;
}

/**
 * The stat strip above the same board, and therefore the same sibling
 * population: counting a wider one here would make the strip disagree
 * with the table it introduces.
 */
export async function getFamilyRecordsSummary(): Promise<{ families: number; linkedPlayers: number }> {
  const [row] = await sql<{ families: number; linkedPlayers: number }[]>`
    WITH family_members AS (
      SELECT family_key, person_a_player_id AS player_id
        FROM player_relationships
       WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_a_player_id IS NOT NULL
       UNION
      SELECT family_key, person_b_player_id AS player_id
        FROM player_relationships
       WHERE relationship = 'sibling' AND family_key IS NOT NULL AND person_b_player_id IS NOT NULL
    )
    SELECT count(DISTINCT family_key)::int AS families,
           count(DISTINCT player_id)::int AS "linkedPlayers"
      FROM family_members
  `;
  return row;
}

export type FatherSonRecordRow = {
  id: number;
  fatherPlayerId: number | null;
  fatherSlug: string | null;
  fatherName: string;
  fatherGames: number | null;
  sonPlayerId: number | null;
  sonSlug: string | null;
  sonName: string;
  sonGames: number | null;
  combinedGames: number | null;
  relationshipLabel: string;
};

/**
 * Father-son SELECTIONS, ranked by combined career games. Father/son is
 * read from person_a_role/person_b_role rather than assumed from column
 * position, so the board is correct even if a future writer records a
 * pair the other way round. Combined games is null when either side is
 * unlinked: the unlinked name still displays, but a combined total needs
 * both career-games figures to mean anything -- it is never treated as
 * zero.
 *
 * What these rows ARE (AFLDB-ISSUE-153 Stage 0 §4.1, decision Q3):
 * father_son_selections is the authoritative AFL father-son selection
 * record; these parent_child rows are its projection, written by
 * tools/migration/father_son.py from the same source (11) and the same
 * import batch (12). Measured read-only on afldb_test they are identical
 * to it at every level -- 99 sons, 107 fathers, 96 pairs, zero divergence
 * witnesses -- and every row carries the label 'father and son (AFL
 * father-son rule selection)'. So this board is a selection board that
 * happens to read the projection, NOT a general record of fathers and
 * sons who both played. The page prose says so.
 *
 * The projection is therefore read here deliberately, not by accident:
 * it already carries the display names for the 31 selections with an
 * unlinked side. Only father_son_selections carries club_id, draft_year,
 * selection_pick, rule and competition, so any scope beyond the pair
 * itself must read that table instead of this one. ISSUE-153 Stage 7
 * adds the assertion that the two stay set-identical.
 */
export async function getFatherSonRecords(limit = 200): Promise<FatherSonRecordRow[]> {
  return sql<FatherSonRecordRow[]>`
    WITH sides AS (
      SELECT r.id, r.relationship_label,
             CASE WHEN r.person_a_role = 'father' THEN r.person_a_player_id ELSE r.person_b_player_id END AS father_player_id,
             CASE WHEN r.person_a_role = 'father' THEN r.person_a_name ELSE r.person_b_name END AS father_name,
             CASE WHEN r.person_a_role = 'son' THEN r.person_a_player_id ELSE r.person_b_player_id END AS son_player_id,
             CASE WHEN r.person_a_role = 'son' THEN r.person_a_name ELSE r.person_b_name END AS son_name
        FROM player_relationships r
       WHERE r.relationship = 'parent_child'
    )
    SELECT s.id,
           s.father_player_id AS "fatherPlayerId", fp.slug AS "fatherSlug",
           COALESCE(fp.display_name, s.father_name) AS "fatherName", fpcs.games AS "fatherGames",
           s.son_player_id AS "sonPlayerId", sp.slug AS "sonSlug",
           COALESCE(sp.display_name, s.son_name) AS "sonName", spcs.games AS "sonGames",
           CASE WHEN fpcs.games IS NOT NULL AND spcs.games IS NOT NULL
                THEN fpcs.games + spcs.games END AS "combinedGames",
           s.relationship_label AS "relationshipLabel"
      FROM sides s
      LEFT JOIN players fp ON fp.id = s.father_player_id
      LEFT JOIN players sp ON sp.id = s.son_player_id
      LEFT JOIN player_career_stats fpcs ON fpcs.player_id = s.father_player_id
      LEFT JOIN player_career_stats spcs ON spcs.player_id = s.son_player_id
     ORDER BY "combinedGames" DESC NULLS LAST, "fatherName", "sonName"
     LIMIT ${limit}
  `;
}

export async function getFatherSonSummary(): Promise<{ total: number; bothLinked: number; oneUnlinked: number }> {
  const [row] = await sql<{ total: number; bothLinked: number; oneUnlinked: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (
             WHERE person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
           )::int AS "bothLinked",
           count(*) FILTER (
             WHERE person_a_player_id IS NULL OR person_b_player_id IS NULL
           )::int AS "oneUnlinked"
      FROM player_relationships
     WHERE relationship = 'parent_child'
  `;
  return row;
}
