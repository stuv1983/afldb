/**
 * The family-relationship family against the real `afldb_test` database
 * (AFLDB-ISSUE-152 Phase D).
 *
 * Every count below is compared against an INDEPENDENTLY HAND-WRITTEN SQL
 * query rather than against a number copied out of the evidence pack: two
 * code paths agreeing is evidence, one code path agreeing with itself is
 * not. The measured populations from the read-only evidence run of
 * 2026-09-09 (`ISSUE-152-phase-d-evidence.sql`, transcript preserved
 * under `nl-ui-out-152-phaseg/evidence/`) are asserted once, as a fixture
 * contract, so a data change that moves them is a deliberate decision
 * rather than a silent one.
 *
 * The four rules this suite exists to protect:
 *
 *  - "brother" is LABEL-backed (`brothers` + `twin brothers`), never
 *    `relationship = 'sibling'`, which also holds 8 sisters and 16
 *    unsexed rows;
 *  - direction comes from person_a_role/person_b_role, never from which
 *    column a person sits in;
 *  - an UNLINKED opposite side is a name in the source and can satisfy
 *    nothing -- it must never become a canonical identity;
 *  - two relatives who share a display name are two identities, and the
 *    answer distinguishes them by id (ids 4700 and 4701 are both "Gary
 *    Ablett", father and son).
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { validatePlan, type NlPlayerRef, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerCareerRow } from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

/**
 * The evidence run of 2026-09-09 against `afldb_test`, as the fixture
 * contract. `parentChildFathers` equalling `fatherSonFathers` is the
 * measured collapse recorded in §5.3.D: the two populations coincide
 * EXTENSIONALLY today, which is exactly why the bare phrase "father-son"
 * stays unrecognised until AFLDB-ISSUE-153 (D8) -- no witness exists that
 * could distinguish the two readings.
 */
const M_D1 = {
  hasBrother: 658,
  parentOrChild: 181,
  fatherSonFathers: 107,
  parentChildFathers: 107,
  parentChildRows: 127,
} as const;

/** afldb_test ids, from the evidence transcript. */
const BRENT_HARVEY = 2164;
const SHANE_HARVEY = 11789;
const COOPER_HARVEY = 3048;
const ROBERT_WALLS = 11145;      // son David Walls is UNLINKED
const SHANE_MORRISON = 11802;    // father Peter Morrison is UNLINKED
const GARY_ABLETT_SNR = 4700;    // same display name as 4701
const GARY_ABLETT_JNR = 4701;

function plan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'player_career',
    metric: null,
    agg: { kind: 'list' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 1000,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

/** A population plan: one parameterless relationship predicate. */
function population(builder: string, overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return plan({ careerPredicates: [{ builder, params: {} }], ...overrides });
}

/** A per-player plan: the predicate's bound id and the named person, paired. */
function ofPlayer(builder: string, subject: NlPlayerRef): NlQueryPlan {
  return plan({
    careerPredicates: [{ builder, params: { player: String(subject.id) } }],
    relationshipSubject: subject,
  });
}

function ref(id: number): NlPlayerRef {
  return { id, slug: `player-${id}`, name: `Player ${id}` };
}

async function career(p: NlQueryPlan, limit = 1000): Promise<{
  lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number;
}> {
  const payload: NlAnswerPayload = await answerPlayerCareer(p, limit);
  if (payload.kind !== 'player_career') throw new Error(`expected player_career, got ${payload.kind}`);
  return payload;
}

async function scalar(query: Promise<{ n: string | number }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

async function ids(p: NlQueryPlan): Promise<number[]> {
  const { rows } = await career(p);
  return rows.map((r) => r.playerId).sort((a, b) => a - b);
}

// ------------------------------------------------------------- the fixture

describe('the relationship data Phase D was designed against', () => {
  it('matches the populations measured on 2026-09-09', async () => {
    const [row] = await sql<{
      parent_child_rows: string; parent_child_fathers: string; father_son_fathers: string;
    }[]>`
      SELECT (SELECT count(*) FROM player_relationships
               WHERE relationship = 'parent_child') AS parent_child_rows,
             (SELECT count(DISTINCT person_a_player_id) FROM player_relationships
               WHERE relationship = 'parent_child' AND person_a_role = 'father'
                 AND person_a_player_id IS NOT NULL) AS parent_child_fathers,
             (SELECT count(DISTINCT father_player_id) FROM father_son_selections
               WHERE father_player_id IS NOT NULL
                 AND father_link_status IN ('unique','resolved')) AS father_son_fathers
    `;
    expect(Number(row.parent_child_rows)).toBe(M_D1.parentChildRows);
    expect(Number(row.parent_child_fathers)).toBe(M_D1.parentChildFathers);
    expect(Number(row.father_son_fathers)).toBe(M_D1.fatherSonFathers);
  });

  /**
   * The role inventory the directional builders rest on: every
   * parent_child row is father -> son, so naming the roles explicitly
   * costs nothing today and is the only thing that keeps the builders
   * correct if a mother-daughter row is ever loaded.
   */
  it('holds no parent_child row whose roles are anything but father -> son', async () => {
    const other = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_relationships
       WHERE relationship = 'parent_child'
         AND (person_a_role IS DISTINCT FROM 'father' OR person_b_role IS DISTINCT FROM 'son')
    `);
    expect(other).toBe(0);
  });

  /** The reason "brother" is label-backed rather than relationship-backed. */
  it('holds sibling rows that are NOT brothers', async () => {
    const notBrothers = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_relationships
       WHERE relationship = 'sibling'
         AND relationship_label NOT IN ('brothers', 'twin brothers')
    `);
    expect(notBrothers).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------- C2

describe('C2 — has_brother', () => {
  it('returns exactly the hand-written label-backed set', async () => {
    const { total } = await career(population('has_brother'));
    const handWritten = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (
         SELECT r.person_a_player_id FROM player_relationships r
           JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
          WHERE r.relationship = 'sibling'
            AND r.relationship_label IN ('brothers', 'twin brothers')
            AND r.person_a_player_id IS NOT NULL AND bc.games > 0
          UNION
         SELECT r.person_b_player_id FROM player_relationships r
           JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
          WHERE r.relationship = 'sibling'
            AND r.relationship_label IN ('brothers', 'twin brothers')
            AND r.person_b_player_id IS NOT NULL AND ac.games > 0)
    `);
    expect(total).toBe(handWritten);
    expect(total).toBe(M_D1.hasBrother);
  });

  /**
   * MEASURED 2026-09-09: at PLAYER level the label-backed set and the
   * unsexed `relationship = 'sibling'` set are the same 658 people --
   * every player reachable through a `siblings`/`twins`-labelled row is
   * already reachable through a `brothers` row, and the 8 sister rows
   * have no linked side at all. The label restriction is still required,
   * and the fixture above proves why: the ROWS differ even though the
   * players do not, so a sister row that ever gains two linked sides
   * would enter the unsexed set and not this one. Asserted as the
   * invariant (a subset) rather than as today's coincidence.
   */
  it('is never larger than the unsexed sibling set it must not be confused with', async () => {
    const { total } = await career(population('has_brother'));
    const anySibling = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (
         SELECT r.person_a_player_id FROM player_relationships r
           JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
          WHERE r.relationship = 'sibling'
            AND r.person_a_player_id IS NOT NULL AND bc.games > 0
          UNION
         SELECT r.person_b_player_id FROM player_relationships r
           JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
          WHERE r.relationship = 'sibling'
            AND r.person_b_player_id IS NOT NULL AND ac.games > 0)
    `);
    expect(total).toBeLessThanOrEqual(anySibling);
  });

  it('answers a pinned player as one row or none, never a leaderboard', async () => {
    const { total, rows } = await career(plan({
      careerPredicates: [{ builder: 'has_brother', params: {} }],
      player: ref(BRENT_HARVEY),
    }));
    expect(total).toBe(1);
    expect(rows[0].playerId).toBe(BRENT_HARVEY);
  });
});

// ------------------------------------------------------------------- C3

describe('C3 — parent and child, typed by role', () => {
  it('the symmetric builder returns exactly the hand-written set', async () => {
    const { total } = await career(population('has_afl_parent_or_child'));
    const handWritten = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (
         SELECT r.person_a_player_id FROM player_relationships r
           JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
          WHERE r.relationship = 'parent_child'
            AND r.person_a_player_id IS NOT NULL AND bc.games > 0
          UNION
         SELECT r.person_b_player_id FROM player_relationships r
           JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
          WHERE r.relationship = 'parent_child'
            AND r.person_b_player_id IS NOT NULL AND ac.games > 0)
    `);
    expect(total).toBe(handWritten);
    expect(total).toBe(M_D1.parentOrChild);
  });

  it('the father direction returns the SONS of a father who played', async () => {
    const answered = await ids(population('has_afl_father'));
    const handWritten = await sql<{ id: number }[]>`
      SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (
         SELECT r.person_b_player_id FROM player_relationships r
           JOIN player_career_stats fc ON fc.player_id = r.person_a_player_id
          WHERE r.relationship = 'parent_child'
            AND r.person_a_role = 'father' AND r.person_b_role = 'son'
            AND r.person_b_player_id IS NOT NULL AND fc.games > 0)
       ORDER BY p.id
    `;
    expect(answered).toEqual(handWritten.map((r) => r.id));
    expect(answered).toContain(COOPER_HARVEY);
    expect(answered).not.toContain(BRENT_HARVEY);
  });

  it('the son direction returns the FATHERS of a son who played', async () => {
    const answered = await ids(population('has_afl_son'));
    const handWritten = await sql<{ id: number }[]>`
      SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (
         SELECT r.person_a_player_id FROM player_relationships r
           JOIN player_career_stats sc ON sc.player_id = r.person_b_player_id
          WHERE r.relationship = 'parent_child'
            AND r.person_a_role = 'father' AND r.person_b_role = 'son'
            AND r.person_a_player_id IS NOT NULL AND sc.games > 0)
       ORDER BY p.id
    `;
    expect(answered).toEqual(handWritten.map((r) => r.id));
    expect(answered).toContain(BRENT_HARVEY);
    expect(answered).not.toContain(COOPER_HARVEY);
  });

  it('the two directions are different populations, and both sit inside the symmetric one', async () => {
    const fathers = new Set(await ids(population('has_afl_father')));
    const sons = new Set(await ids(population('has_afl_son')));
    const either = new Set(await ids(population('has_afl_parent_or_child')));
    expect([...fathers].every((id) => either.has(id))).toBe(true);
    expect([...sons].every((id) => either.has(id))).toBe(true);
    // Gary Ablett Snr is in one and Jnr in the other -- the direction is
    // real, not a relabelling of the same set.
    expect(sons.has(GARY_ABLETT_SNR)).toBe(true);
    expect(fathers.has(GARY_ABLETT_JNR)).toBe(true);
  });

  it('excludes a player whose father is UNLINKED (fails closed)', async () => {
    const withAflFather = await ids(population('has_afl_father'));
    expect(withAflFather).not.toContain(SHANE_MORRISON);
    // ... and the row genuinely exists, so this is exclusion, not absence.
    const unlinkedSide = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_relationships
       WHERE relationship = 'parent_child'
         AND person_b_player_id = ${SHANE_MORRISON} AND person_a_player_id IS NULL
    `);
    expect(unlinkedSide).toBe(1);
  });
});

// ------------------------------------------------------------------- C4

describe('C4 — the relatives of one named player', () => {
  it('brother_of_player answers with the brother, not the subject', async () => {
    const answered = await ids(ofPlayer('brother_of_player', ref(BRENT_HARVEY)));
    expect(answered).toEqual([SHANE_HARVEY]);
    expect(answered).not.toContain(BRENT_HARVEY);
  });

  it('son_of_player and father_of_player are inverses of one another', async () => {
    expect(await ids(ofPlayer('son_of_player', ref(BRENT_HARVEY)))).toEqual([COOPER_HARVEY]);
    expect(await ids(ofPlayer('father_of_player', ref(COOPER_HARVEY)))).toEqual([BRENT_HARVEY]);
    // And never the wrong way round: Cooper has no recorded son.
    expect(await ids(ofPlayer('son_of_player', ref(COOPER_HARVEY)))).toEqual([]);
  });

  it('matches hand-written SQL for every father of a father-son selection', async () => {
    const answered = await ids(ofPlayer('son_of_player', ref(GARY_ABLETT_SNR)));
    const handWritten = await sql<{ id: number }[]>`
      SELECT r.person_b_player_id AS id FROM player_relationships r
       WHERE r.relationship = 'parent_child'
         AND r.person_a_role = 'father' AND r.person_b_role = 'son'
         AND r.person_a_player_id = ${GARY_ABLETT_SNR}
         AND r.person_b_player_id IS NOT NULL
       ORDER BY r.person_b_player_id
    `;
    expect(answered).toEqual(handWritten.map((r) => r.id));
  });

  /**
   * The identity trap. Ids 4700 and 4701 are BOTH "Gary Ablett", father
   * and son. An answer that deduplicated by display name would collapse
   * them into one person and lose the relationship entirely.
   */
  it('keeps two same-named relatives apart by id', async () => {
    const [snr] = await sql<{ display_name: string }[]>`
      SELECT display_name FROM players WHERE id = ${GARY_ABLETT_SNR}
    `;
    const [jnr] = await sql<{ display_name: string }[]>`
      SELECT display_name FROM players WHERE id = ${GARY_ABLETT_JNR}
    `;
    expect(snr.display_name).toBe(jnr.display_name);

    // Gary Ablett Snr has more than one recorded son, so this is not a
    // one-row answer -- what matters is that the son who SHARES his name
    // is present as his own id, and that no two rows collapse together.
    const { rows } = await career(ofPlayer('son_of_player', ref(GARY_ABLETT_SNR)));
    const answeredIds = rows.map((r) => r.playerId);
    expect(answeredIds).toContain(GARY_ABLETT_JNR);
    expect(answeredIds).not.toContain(GARY_ABLETT_SNR);
    expect(new Set(answeredIds).size).toBe(answeredIds.length);
    expect(rows.find((r) => r.playerId === GARY_ABLETT_JNR)?.displayName).toBe(snr.display_name);
  });

  it('an unlinked relative is a name, and returns nobody', async () => {
    // Robert Walls's son David Walls is unlinked in the source.
    expect(await ids(ofPlayer('son_of_player', ref(ROBERT_WALLS)))).toEqual([]);
    const unlinkedSide = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_relationships
       WHERE relationship = 'parent_child'
         AND person_a_player_id = ${ROBERT_WALLS} AND person_b_player_id IS NULL
    `);
    expect(unlinkedSide).toBe(1);
  });
});

// ------------------------------------------------------------------ FS4

describe('FS4 — father_son_father', () => {
  it('returns exactly the hand-written linked-father set', async () => {
    const { total } = await career(population('father_son_father'));
    const handWritten = await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (SELECT father_player_id FROM father_son_selections
                       WHERE father_player_id IS NOT NULL
                         AND father_link_status IN ('unique','resolved'))
    `);
    expect(total).toBe(handWritten);
    expect(total).toBe(M_D1.fatherSonFathers);
  });

  /**
   * The measured collapse (§5.3.D), asserted rather than assumed: the
   * draft-rule fathers and the parent_child fathers are the SAME people
   * in this database. It is why FS4 and C3's son-direction may both
   * exist without either being wrong, and why the bare phrase
   * "father-son" cannot be decided from data (D8).
   */
  it('coincides with the role-typed parent_child fathers, today', async () => {
    const fsFathers = await ids(population('father_son_father'));
    const pcFathers = await ids(population('has_afl_son'));
    expect(fsFathers.length).toBe(M_D1.fatherSonFathers);
    // has_afl_son additionally requires the SON to have played, so it is
    // a subset rather than an equality -- the honest relation to assert.
    expect(pcFathers.every((id) => fsFathers.includes(id))).toBe(true);
  });

  it('ranks by career games without losing the relationship', async () => {
    const ranked = await career(plan({
      careerPredicates: [{ builder: 'father_son_father', params: {} }],
      metric: 'games',
      agg: { kind: 'max' },
    }));
    expect(ranked.lead?.playerId).toBe(BRENT_HARVEY);
    expect(ranked.lead?.value).toBe(432);
  });
});

// ------------------------------------------------- the over-cap contract

describe('the list cap is disclosed, never silently applied', () => {
  it('counts the whole qualifying set even when the rows are capped', async () => {
    const { rows, total } = await career(population('has_brother'), 100);
    expect(rows).toHaveLength(100);
    expect(total).toBe(M_D1.hasBrother);
    expect(total).toBeGreaterThan(rows.length);
  });
});
