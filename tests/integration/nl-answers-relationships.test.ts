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
import { answerFatherSonSummary } from '@/db/queries/nl/father-son-summary';
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

// ============================================================ ISSUE-153
//
// The son's side of the father-son rule, and the two scopes only
// father_son_selections carries. Every figure here is compared against an
// independently hand-written query over the same table, for the reason
// this file's header gives: one code path agreeing with itself is not
// evidence. The Stage 0 read-only measurements of 2026-09-09 are asserted
// once as the fixture contract.

const M_153 = {
  /** FS1: trusted-linked selected players. */
  selectedPlayers: 99,
  /** FS4, unchanged, as the symmetry check. */
  fathers: 107,
  /** FS6's denominator: SELECTION EVENTS, not linked identities. */
  selectionRows: 127,
  /** FS2: distinct selecting organizations. */
  organizations: 17,
  /** FS3: distinct draft years. */
  draftYears: 35,
  /** X3: selected under the rule AND actually coached. */
  selectedAndCoached: 1,
  /** X3's father-side mirror. */
  fathersWhoCoached: 11,
} as const;

/** Rhyce Shaw -- the whole of X3 (Stage 0 §4.7). */
const RHYCE_SHAW = 10974;

describe('FS1 — players selected under the father-son rule (AFLDB-ISSUE-153)', () => {
  it('is 99 players, and the builder agrees with a hand-written query', async () => {
    const { rows, total } = await career(population('father_son_selection'));
    expect(total).toBe(M_153.selectedPlayers);
    const measured = await scalar(sql`
      SELECT count(DISTINCT drafted_player_id)::text AS n FROM father_son_selections
       WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
    `);
    expect(measured).toBe(total);
    expect(rows).toHaveLength(total);
  });

  /**
   * FS1 is NOT an alias of C3. The three witnesses were selected under the
   * rule -- so they belong here -- but their fathers are names the source
   * never linked, so they must not appear in has_afl_father. If this ever
   * returns an empty difference, the two questions have been collapsed
   * into one and one of them is now answering wrongly.
   */
  it('differs from has_afl_father by exactly the three unmatched-father witnesses', async () => {
    const selected = await ids(population('father_son_selection'));
    const hasFather = await ids(population('has_afl_father'));
    const onlySelected = selected.filter((id) => !hasFather.includes(id));
    expect(onlySelected).toHaveLength(3);

    const names = await sql<{ id: number; name: string }[]>`
      SELECT p.id, p.display_name AS name FROM players p
       WHERE p.id = ANY(${onlySelected}) ORDER BY p.display_name
    `;
    expect(names.map((r) => r.name)).toEqual(['Max Michalanney', 'Mitch Morton', 'Shane Morrison']);
  });

  /**
   * Stage 0 §2.2 returned 0 rows: every trusted rule son actually played,
   * so no "has played" filter is needed and adding one would be dead code
   * that quietly narrowed the answer the day the data changed.
   */
  it('needs no games filter — every selected player has played', async () => {
    const unplayed = await scalar(sql`
      SELECT count(*)::text AS n FROM father_son_selections f
       WHERE f.drafted_player_id IS NOT NULL AND f.drafted_link_status IN ('unique', 'resolved')
         AND NOT EXISTS (
           SELECT 1 FROM player_career_stats s WHERE s.player_id = f.drafted_player_id AND s.games > 0
         )
    `);
    expect(unplayed).toBe(0);
  });

  it('the father side is unchanged at 107 — the binding is symmetric, not a swap', async () => {
    const { total } = await career(population('father_son_father'));
    expect(total).toBe(M_153.fathers);
  });
});

describe('FS2/FS3 — the selecting club and the draft year', () => {
  it('folds a RENAME through organization lineage: the Bulldogs are one club', async () => {
    const org = await scalar(sql`
      SELECT o.id::text AS n FROM club_organizations o WHERE o.slug = 'western-bulldogs'
    `);
    const { total } = await career(plan({
      careerPredicates: [{ builder: 'father_son_selection_for_club', params: { club: String(org) } }],
      scope: { clubFor: { organizationId: org, slug: 'western-bulldogs', name: 'Western Bulldogs' } },
    }));
    const measured = await scalar(sql`
      SELECT count(DISTINCT f.drafted_player_id)::text AS n FROM father_son_selections f
        JOIN clubs c ON c.id = f.club_id
       WHERE f.drafted_player_id IS NOT NULL AND f.drafted_link_status IN ('unique', 'resolved')
         AND c.organization_id = ${org}
    `);
    expect(total).toBe(measured);
    // Two club ids, one lineage: a raw club_id split would return fewer.
    const clubIds = await scalar(sql`
      SELECT count(DISTINCT f.club_id)::text AS n FROM father_son_selections f
        JOIN clubs c ON c.id = f.club_id WHERE c.organization_id = ${org}
    `);
    expect(clubIds).toBeGreaterThan(1);
  });

  /**
   * A MERGER is not a rename. Fitzroy's selections stay Fitzroy's; folding
   * them into Brisbane would be a data-modelling error dressed as a
   * lineage improvement.
   */
  it('does NOT fold a merger: Fitzroy is not Brisbane', async () => {
    const [fitzroy] = await sql<{ id: number }[]>`SELECT id FROM club_organizations WHERE slug = 'fitzroy'`;
    const [brisbane] = await sql<{ id: number }[]>`
      SELECT id FROM club_organizations WHERE slug LIKE 'brisbane%' ORDER BY slug LIMIT 1
    `;
    expect(fitzroy.id).not.toBe(brisbane.id);
    const shared = await scalar(sql`
      SELECT count(*)::text AS n FROM clubs
       WHERE organization_id = ${fitzroy.id} AND id IN (
         SELECT id FROM clubs WHERE organization_id = ${brisbane.id}
       )
    `);
    expect(shared).toBe(0);
  });

  /**
   * THE trap. draft_year is not a playing season, and the two readings
   * share not one row: 0 of the 99 debut in their draft year. A builder
   * that ever compiled the year as a season would be wrong about every
   * single row it returned, which is why this is asserted against the
   * database rather than trusted from the runbook.
   */
  it('draft_year and the debut season are disjoint — 0 of 99 debut in their draft year', async () => {
    const sameYear = await scalar(sql`
      SELECT count(*)::text AS n FROM father_son_selections f
        JOIN player_career_stats s ON s.player_id = f.drafted_player_id
       WHERE f.drafted_link_status IN ('unique', 'resolved')
         AND extract(year FROM s.debut_date)::int = f.draft_year
    `);
    expect(sameYear).toBe(0);
  });

  it('scopes to a draft year, and to that year alone', async () => {
    const year = 2022;
    const { total } = await career(plan({
      careerPredicates: [{
        builder: 'father_son_selection_between', params: { from: String(year), to: String(year) },
      }],
      scope: { seasonMin: year, seasonMax: year },
    }));
    const measured = await scalar(sql`
      SELECT count(DISTINCT drafted_player_id)::text AS n FROM father_son_selections
       WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
         AND draft_year = ${year}
    `);
    expect(total).toBe(measured);
    expect(total).toBeGreaterThan(0);
  });
});

describe('FS6 — the distribution counts SELECTIONS, not linked players', () => {
  async function summary(kind: 'by_club' | 'by_draft_year') {
    const payload = await answerFatherSonSummary(plan({
      grain: 'achievement_summary', fatherSonSummary: { kind },
    }));
    if (payload.kind !== 'achievement_summary') throw new Error(`expected a summary, got ${payload.kind}`);
    return payload;
  }

  /**
   * Operator decision Q2. Written to FAIL if 99 is ever substituted for
   * 127: the two denominators change 14 of the 17 organizations, and for
   * Carlton and Adelaide they change most of the answer.
   */
  it('the denominator is 127 selection events, never the 99 linked players', async () => {
    const payload = await summary('by_club');
    expect(payload.total).toBe(M_153.selectionRows);
    expect(payload.total).not.toBe(M_153.selectedPlayers);

    const rows = await scalar(sql`SELECT count(*)::text AS n FROM father_son_selections`);
    expect(payload.total).toBe(rows);
    // The group counts sum to the denominator: no selection is dropped by
    // the club join, which is only true because no row has a null club_id.
    expect(payload.rows.reduce((sum, r) => sum + r.value, 0)).toBe(M_153.selectionRows);
  });

  it('groups by organization, one row per lineage', async () => {
    const payload = await summary('by_club');
    expect(payload.rows).toHaveLength(M_153.organizations);
    const measured = await scalar(sql`
      SELECT count(DISTINCT c.organization_id)::text AS n
        FROM father_son_selections f JOIN clubs c ON c.id = f.club_id
    `);
    expect(payload.rows.length).toBe(measured);
  });

  /**
   * The club where the two denominators diverge most in relative terms.
   * Asserted by name because "Carlton, 7" is the wrong answer this whole
   * decision exists to prevent, and it is wrong in a way that looks
   * entirely reasonable on the page.
   */
  it('Carlton counts its selections, not its linked players', async () => {
    const payload = await summary('by_club');
    const carlton = payload.rows.find((r) => r.label === 'Carlton');
    const selections = await scalar(sql`
      SELECT count(*)::text AS n FROM father_son_selections f
        JOIN clubs c ON c.id = f.club_id
        JOIN club_organizations o ON o.id = c.organization_id
       WHERE o.name = 'Carlton'
    `);
    const linked = await scalar(sql`
      SELECT count(DISTINCT f.drafted_player_id)::text AS n FROM father_son_selections f
        JOIN clubs c ON c.id = f.club_id
        JOIN club_organizations o ON o.id = c.organization_id
       WHERE o.name = 'Carlton'
         AND f.drafted_player_id IS NOT NULL AND f.drafted_link_status IN ('unique', 'resolved')
    `);
    expect(selections).toBeGreaterThan(linked);
    expect(carlton?.value).toBe(selections);
    expect(carlton?.value).not.toBe(linked);
  });

  it('groups by DRAFT year, chronologically, and links no year to a season page', async () => {
    const payload = await summary('by_draft_year');
    expect(payload.groupBy).toBe('draft_year');
    expect(payload.rows).toHaveLength(M_153.draftYears);
    expect(payload.rows.every((r) => r.href === null)).toBe(true);
    const years = payload.rows.map((r) => Number(r.label));
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(payload.rows.reduce((sum, r) => sum + r.value, 0)).toBe(M_153.selectionRows);
  });

  it('discloses the linked-player coverage without letting it become the denominator', async () => {
    const payload = await summary('by_club');
    expect(payload.disclosure).toContain(String(M_153.selectedPlayers));
    expect(payload.unit?.many).toBe('father–son selections');
  });
});

describe('X3 — selected under the rule AND actually coached', () => {
  /**
   * ACTUAL coaching appearance (match_coaches), the frozen ISSUE-152
   * contract -- not the coaches identity seam. Stage 0 measured the answer
   * as invariant across all four readings, so a change here is a change to
   * the data, not to the semantics.
   */
  it('is exactly Rhyce Shaw', async () => {
    const { rows, total } = await career(plan({
      careerPredicates: [
        { builder: 'has_coached', params: {} },
        { builder: 'father_son_selection', params: {} },
      ],
    }));
    expect(total).toBe(M_153.selectedAndCoached);
    expect(rows.map((r) => r.playerId)).toEqual([RHYCE_SHAW]);
  });

  /**
   * The 11-player answer the Phase F guard blocked collaterally: its
   * wording ships and answers everywhere else in the product, and only the
   * cross-domain reading refused it (operator decision Q6).
   */
  it('the father side is 11 players, and they all actually coached', async () => {
    const { rows, total } = await career(plan({
      careerPredicates: [
        { builder: 'has_coached', params: {} },
        { builder: 'father_son_father', params: {} },
      ],
    }));
    expect(total).toBe(M_153.fathersWhoCoached);
    const measured = await scalar(sql`
      SELECT count(DISTINCT f.father_player_id)::text AS n FROM father_son_selections f
       WHERE f.father_player_id IS NOT NULL AND f.father_link_status IN ('unique', 'resolved')
         AND EXISTS (
           SELECT 1 FROM coaches co JOIN match_coaches mc ON mc.coach_id = co.id
            WHERE co.player_id = f.father_player_id
         )
    `);
    expect(total).toBe(measured);
    expect(rows).toHaveLength(total);
  });

  /**
   * The identity seam is wider than the appearance seam, and X3 uses the
   * narrower one. If these two ever agree, the freeze has been lost.
   */
  it('a linked coach identity is not enough — the coaching must have happened', async () => {
    const identityOnly = await scalar(sql`
      SELECT count(DISTINCT f.father_player_id)::text AS n FROM father_son_selections f
        JOIN coaches co ON co.player_id = f.father_player_id
       WHERE f.father_player_id IS NOT NULL AND f.father_link_status IN ('unique', 'resolved')
    `);
    expect(identityOnly).toBeGreaterThanOrEqual(M_153.fathersWhoCoached);
  });
});

// ---------------------------------------------- AFLDB-ISSUE-153 Stage 7

/**
 * The father-son projection invariant.
 *
 * ISSUE-153 bound explicit father-son rule wording to
 * `father_son_selections` (operator decision Q1) on the strength of a
 * measured fact: `player_relationships.relationship = 'parent_child'` is
 * not an independent dataset that happens to agree with it, it is a
 * PROJECTION of it -- written by tools/migration/father_son.py from the
 * same source and the same import batch. Measured read-only on afldb_test
 * on 2026-09-09 the two are identical at every level: 99 sons, 107
 * fathers, 96 pairs, and zero divergence witnesses in either direction.
 *
 * That fact is load-bearing and nothing in the schema enforces it. The
 * `/records/father-son` board reads the projection while calling itself a
 * selection board; NL answers the same question from the authoritative
 * table. Today those are the same answer. If the importer, the source or
 * the model ever drifts, they silently stop being the same answer and the
 * two surfaces disagree without anything failing.
 *
 * So the evidence is turned into a check. This is the assertion that
 * makes ISSUE-153's central claim monitored rather than assumed, and a
 * failure here is not a flaky test: it means the projection and its
 * source have parted company and the binding needs re-deciding.
 */
describe('father_son_selections and its parent_child projection stay identical (ISSUE-153 Stage 7)', () => {
  it('same provenance: one source, one import batch', async () => {
    const [row] = await sql<{
      selectionSources: number; selectionBatches: number;
      projectionSources: number; projectionBatches: number; shared: number;
    }[]>`
      SELECT (SELECT count(DISTINCT source_id) FROM father_son_selections)::int AS "selectionSources",
             (SELECT count(DISTINCT import_batch_id) FROM father_son_selections)::int AS "selectionBatches",
             (SELECT count(DISTINCT source_id) FROM player_relationships
               WHERE relationship = 'parent_child')::int AS "projectionSources",
             (SELECT count(DISTINCT import_batch_id) FROM player_relationships
               WHERE relationship = 'parent_child')::int AS "projectionBatches",
             (SELECT count(*) FROM (
                SELECT source_id, import_batch_id FROM father_son_selections
                INTERSECT
                SELECT source_id, import_batch_id FROM player_relationships
                 WHERE relationship = 'parent_child'
              ) AS shared_provenance)::int AS shared
    `;
    expect(row.selectionSources).toBe(1);
    expect(row.selectionBatches).toBe(1);
    expect(row.projectionSources).toBe(1);
    expect(row.projectionBatches).toBe(1);
    // The decisive one: they are the SAME source and the SAME batch, which
    // is what makes one a projection of the other rather than a
    // corroborating second opinion.
    expect(row.shared).toBe(1);
  });

  /**
   * Set identity, asserted in both directions at all three levels. A count
   * match is not a set match -- 127 = 127 is equally consistent with two
   * disjoint sets -- so every check below is an EXCEPT in each direction,
   * and each must return nothing.
   */
  it('sons: neither side holds a player the other does not', async () => {
    const rows = await sql<{ side: string; playerId: number }[]>`
      SELECT 'rule only' AS side, x AS "playerId" FROM (
        SELECT drafted_player_id AS x FROM father_son_selections
          WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
        EXCEPT
        SELECT person_b_player_id FROM player_relationships
          WHERE relationship = 'parent_child' AND person_b_role = 'son'
            AND person_b_player_id IS NOT NULL
      ) AS a
      UNION ALL
      SELECT 'projection only', x FROM (
        SELECT person_b_player_id AS x FROM player_relationships
          WHERE relationship = 'parent_child' AND person_b_role = 'son'
            AND person_b_player_id IS NOT NULL
        EXCEPT
        SELECT drafted_player_id FROM father_son_selections
          WHERE drafted_player_id IS NOT NULL AND drafted_link_status IN ('unique', 'resolved')
      ) AS b
    `;
    expect(rows).toEqual([]);
  });

  it('fathers: neither side holds a player the other does not', async () => {
    const rows = await sql<{ side: string; playerId: number }[]>`
      SELECT 'rule only' AS side, x AS "playerId" FROM (
        SELECT father_player_id AS x FROM father_son_selections
          WHERE father_player_id IS NOT NULL AND father_link_status IN ('unique', 'resolved')
        EXCEPT
        SELECT person_a_player_id FROM player_relationships
          WHERE relationship = 'parent_child' AND person_a_role = 'father'
            AND person_a_player_id IS NOT NULL
      ) AS a
      UNION ALL
      SELECT 'projection only', x FROM (
        SELECT person_a_player_id AS x FROM player_relationships
          WHERE relationship = 'parent_child' AND person_a_role = 'father'
            AND person_a_player_id IS NOT NULL
        EXCEPT
        SELECT father_player_id FROM father_son_selections
          WHERE father_player_id IS NOT NULL AND father_link_status IN ('unique', 'resolved')
      ) AS b
    `;
    expect(rows).toEqual([]);
  });

  it('pairs: neither side holds a (father, son) pair the other does not', async () => {
    const rows = await sql<{ side: string; father: number; son: number }[]>`
      SELECT 'rule only' AS side, f AS father, s AS son FROM (
        SELECT father_player_id AS f, drafted_player_id AS s FROM father_son_selections
          WHERE father_player_id IS NOT NULL AND drafted_player_id IS NOT NULL
            AND father_link_status IN ('unique', 'resolved')
            AND drafted_link_status IN ('unique', 'resolved')
        EXCEPT
        SELECT person_a_player_id, person_b_player_id FROM player_relationships
          WHERE relationship = 'parent_child' AND person_a_role = 'father' AND person_b_role = 'son'
            AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
      ) AS a
      UNION ALL
      SELECT 'projection only', f, s FROM (
        SELECT person_a_player_id AS f, person_b_player_id AS s FROM player_relationships
          WHERE relationship = 'parent_child' AND person_a_role = 'father' AND person_b_role = 'son'
            AND person_a_player_id IS NOT NULL AND person_b_player_id IS NOT NULL
        EXCEPT
        SELECT father_player_id, drafted_player_id FROM father_son_selections
          WHERE father_player_id IS NOT NULL AND drafted_player_id IS NOT NULL
            AND father_link_status IN ('unique', 'resolved')
            AND drafted_link_status IN ('unique', 'resolved')
      ) AS b
    `;
    expect(rows).toEqual([]);
  });

  /**
   * Row-for-row, including the unlinked sides. The projection carries one
   * row per selection and nothing else -- so a future importer that
   * started writing parent_child rows from a second source would fail
   * here rather than silently widening what "father-son" means.
   */
  it('one projection row per selection, and no more', async () => {
    const [row] = await sql<{ selections: number; projection: number }[]>`
      SELECT (SELECT count(*) FROM father_son_selections)::int AS selections,
             (SELECT count(*) FROM player_relationships
               WHERE relationship = 'parent_child')::int AS projection
    `;
    expect(row.projection).toBe(row.selections);
  });

  /**
   * The family board's constraint (ISSUE-153 Q4) is a no-op only while
   * this holds. The moment a parent_child row carries a family_key, the
   * sibling filter starts changing the answer -- which is the point of
   * having stated it, but the operator should learn it from a failing
   * check rather than from a changed leaderboard.
   */
  it('no parent_child row carries a family_key, so the sibling board is unaffected', async () => {
    const [row] = await sql<{ keyed: number }[]>`
      SELECT count(*)::int AS keyed FROM player_relationships
       WHERE relationship = 'parent_child' AND family_key IS NOT NULL
    `;
    expect(row.keyed).toBe(0);
  });
});
