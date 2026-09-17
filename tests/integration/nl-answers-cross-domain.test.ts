/**
 * The cross-domain composition against the real `afldb_test` database
 * (AFLDB-ISSUE-152 Phase F): one person who both played and coached.
 *
 * Every count below is compared against an INDEPENDENTLY HAND-WRITTEN SQL
 * query rather than against a number copied out of the evidence pack: two
 * code paths agreeing is evidence, one code path agreeing with itself is
 * not. The measured populations from the read-only evidence run of
 * 2026-09-09 (`ISSUE-152-phase-f-data-dump*.sql` and
 * `ISSUE-152-phase-f-fd4.sql`, transcripts preserved under
 * `nl-ui-out-152-phaseg/evidence/`) are asserted once, as a fixture
 * contract, so a data change that moves them is a deliberate decision
 * rather than a silent one.
 *
 * The four rules this suite exists to protect:
 *
 *  - a `coaches` row is an IDENTITY claim and nothing more. 368 linked
 *    coach identities exist; only 367 of those people ever coached a
 *    match. X1 is the 367, and the match_coaches join is the whole
 *    difference;
 *  - a coached club is an ORGANIZATION lineage, never a raw
 *    match_coaches.club_id -- real coaches diverge on it (Pagan 3 raw ids
 *    / 2 organizations, Wallace 3/2, Laidley 2/1);
 *  - X2 is an INTERSECTION and both halves survive to SQL: 27 people
 *    played for and coached Richmond, while 41 coached Richmond and 14 of
 *    those never played there;
 *  - a capped list says so in the answer's own sentence, never silently.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { answerCaveats } from '@/search/nl/describe';
import { NL_LIMITS, validatePlan, type NlClubRef, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlPlayerCareerRow } from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

/** The 2026-09-09 evidence, with X1 rebaselined after accepted 2026 coaching assignments. */
const M_F = {
  coachRows: 386,
  linkedCoaches: 368,
  coachOnly: 18,
  /** X1: played AND actually coached. NOT 368. */
  x1: 367,
  /** X2: played Richmond AND coached Richmond. */
  x2Richmond: 27,
  /** Coached Richmond, played anywhere -- the half X2 must not be mistaken for. */
  coachedRichmond: 41,
  /** Coached Richmond, never played there. */
  coachedRichmondNeverPlayed: 14,
  /** player_clubs rows recording no games -- why played_for_club is the right reuse (F-D4). */
  zeroGameMemberships: 0,
} as const;

const RICHMOND: NlClubRef = { organizationId: 18, slug: 'richmond', name: 'Richmond' };

/** afldb_test player ids, from the evidence transcripts. Identity is by id, never by name. */
const X2_POSITIVES = {
  'Tom Hafey': 12550,
  'Jack Dyer': 6244,
  'Perce Bentley': 10377,
  'Frank Hughes': 4386,
  'Tony Jewell': 12775,
  'Dan Minogue': 3195,
  'Terry Wallace': 12378,
  'Kevin Bartlett': 8193,
} as const;

/** Coached Richmond; never played for Richmond. The 14 that separate 41 from 27. */
const COACHED_RICHMOND_ONLY = {
  'Adem Yze': 67,
  'Allan Jeans': 481,
  'Andrew McQualter': 600,
  'Damien Hardwick': 3175,
  'Danny Frawley': 3266,
  'Jade Rawlings': 6669,
  'Jeff Gieschen': 6912,
  'Robert Walls': 11145,
} as const;

/** Played for Richmond; never coached Richmond. */
const PLAYED_RICHMOND_ONLY = {
  'Aaron Edwards': 6,
  'Aaron Fiora': 7,
  'Adam Pattison': 51,
} as const;

/** Never coached at all -- X1 negatives. Both "Aaron Black" ids are here (F6/F8). */
const NEVER_COACHED = {
  'Aaron Black (1)': 1,
  'Aaron Black (2)': 2,
  'Aaron Cadman': 3,
  'Aaron Davey': 5,
  'Adam Cerra': 28,
} as const;

/** The F4 lineage witnesses: raw club identities outnumber organizations. */
const LINEAGE_TRAPS = { 'Denis Pagan': 3651, 'Terry Wallace': 12378, 'Dani Laidley': 3208 } as const;

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

/** X1, exactly as the parser builds it. */
function x1Plan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return plan({ careerPredicates: [{ builder: 'has_coached', params: {} }], ...overrides });
}

/** X2, exactly as the parser builds it: two builder parameters, NO scope.clubFor. */
function x2Plan(played: NlClubRef, coached: NlClubRef): NlQueryPlan {
  return plan({
    careerPredicates: [
      { builder: 'played_for_club', params: { club: String(played.organizationId) } },
      { builder: 'coached_club', params: { club: String(coached.organizationId) } },
    ],
    crossDomainClubs: { played, coached },
  });
}

/** coached_club on its own -- not a supported question, but the half X2 must intersect. */
function coachedClubOnly(organizationId: number): NlQueryPlan {
  return {
    ...plan({ careerPredicates: [{ builder: 'has_coached', params: {} }] }),
    careerPredicates: [{ builder: 'coached_club', params: { club: String(organizationId) } }],
  };
}

async function career(p: NlQueryPlan, limit = 1000): Promise<{
  lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number;
}> {
  const payload: NlAnswerPayload = await answerPlayerCareer(p, limit);
  if (payload.kind !== 'player_career') throw new Error(`expected player_career, got ${payload.kind}`);
  return payload;
}

async function idsOf(p: NlQueryPlan): Promise<Set<number>> {
  const { rows } = await career(p);
  return new Set(rows.map((r) => r.playerId));
}

async function scalar(query: Promise<{ n: string | number }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

// ------------------------------------------------------------- the fixture

describe('the coaching data Phase F was designed against', () => {
  it('matches the seam counts measured on 2026-09-09', async () => {
    const [row] = await sql<{ total: string; linked: string; coach_only: string }[]>`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE player_id IS NOT NULL) AS linked,
             count(*) FILTER (WHERE player_id IS NULL) AS coach_only
        FROM coaches
    `;
    expect(Number(row.total)).toBe(M_F.coachRows);
    expect(Number(row.linked)).toBe(M_F.linkedCoaches);
    expect(Number(row.coach_only)).toBe(M_F.coachOnly);
  });

  /**
   * F-D4, and the reason X2 may reuse `played_for_club`. That builder
   * reads `player_clubs` ("club identities actually represented"), while
   * the measured 27 came from Richmond playing GAMES. The two definitions
   * coincide only while no membership records zero games.
   */
  it('records no zero-game club membership, so player_clubs and games agree', async () => {
    expect(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM player_clubs WHERE games <= 0
    `)).toBe(M_F.zeroGameMemberships);
  });

  it('Richmond is one organization with one club identity', async () => {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM clubs WHERE organization_id = ${RICHMOND.organizationId}
    `;
    expect(Number(row.n)).toBe(1);
  });
});

// ------------------------------------------------------------------- T1/T8

describe('X1 -- played and also coached', () => {
  it('T1: answers 367, and agrees with hand-written coaches ⋈ match_coaches SQL', async () => {
    const { total } = await career(x1Plan());
    expect(total).toBe(M_F.x1);
    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT c.player_id) AS n
        FROM coaches c
        JOIN match_coaches mc ON mc.coach_id = c.id
       WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique'
    `));
  });

  /**
   * THE regression this builder exists to prevent. A naive
   * `EXISTS (SELECT 1 FROM coaches WHERE player_id = p.id)` returns 368:
   * one person holds a coach identity and never coached a match.
   */
  it('T8: is 367 and not the 368 identity-only seam, and the difference is exactly the matchless identities', async () => {
    const identityOnly = await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT c.player_id) AS n FROM coaches c WHERE c.player_id IS NOT NULL
    `);
    const noMatches = await scalar(sql<{ n: string }[]>`
      SELECT count(DISTINCT c.player_id) AS n
        FROM coaches c
       WHERE c.player_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id)
    `);
    expect(identityOnly).toBe(M_F.linkedCoaches);
    const { total } = await career(x1Plan());
    expect(total).toBe(identityOnly - noMatches);
    expect(total).not.toBe(identityOnly);
  });

  it('T10/T11: players who never coached are absent, and a shared display name is two identities', async () => {
    const members = await idsOf(x1Plan());
    for (const [who, id] of Object.entries(NEVER_COACHED)) {
      expect(members.has(id), `${who} (${id}) must not be in X1`).toBe(false);
    }
    // Both "Aaron Black" rows are distinct identities and neither is
    // merged into the other by name.
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM players WHERE id IN (1, 2) AND display_name = 'Aaron Black'
    `;
    expect(Number(row.n)).toBe(2);
  });

  it('T12: the capped list states its own cap -- 100 of 367, never silently', async () => {
    const payload = await answerPlayerCareer(x1Plan({ limit: NL_LIMITS.maxListRows }), NL_LIMITS.maxListRows);
    if (payload.kind !== 'player_career') throw new Error('expected player_career');
    expect(payload.total).toBe(M_F.x1);
    expect(payload.rows).toHaveLength(NL_LIMITS.maxListRows);
    const caveats = answerCaveats(x1Plan(), payload);
    expect(caveats.join(' ')).toContain('367 players qualify');
    expect(caveats.join(' ')).toContain(`first ${NL_LIMITS.maxListRows}`);
  });
});

// ------------------------------------------------------------ T2/T5/T6/T14

describe('X2 -- played for a club and also coached a club', () => {
  it('T2: answers 27, and agrees with hand-written player_clubs ∩ match_coaches SQL', async () => {
    const { total } = await career(x2Plan(RICHMOND, RICHMOND));
    expect(total).toBe(M_F.x2Richmond);
    expect(total).toBe(await scalar(sql<{ n: string }[]>`
      SELECT count(*) AS n FROM players p
       WHERE p.id IN (SELECT pc.player_id FROM player_clubs pc
                       WHERE pc.club_id IN (SELECT id FROM clubs
                                             WHERE organization_id = ${RICHMOND.organizationId}))
         AND p.id IN (SELECT c.player_id FROM coaches c
                        JOIN match_coaches mc ON mc.coach_id = c.id
                       WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique'
                         AND mc.club_id IN (SELECT id FROM clubs
                                             WHERE organization_id = ${RICHMOND.organizationId}))
    `));
  });

  /**
   * T14. Without this the X2 test could pass while measuring only one
   * half of the conjunction: 41 is what "coached Richmond" alone returns,
   * and 27 is the intersection. The 14 between them are the people who
   * coached Richmond and never played there.
   */
  it('T14: the coaching half alone is 41, so 27 is provably an intersection', async () => {
    const { total } = await career(coachedClubOnly(RICHMOND.organizationId));
    expect(total).toBe(M_F.coachedRichmond);
    expect(total - M_F.x2Richmond).toBe(M_F.coachedRichmondNeverPlayed);
  });

  it('T5: every measured Richmond positive is present', async () => {
    const members = await idsOf(x2Plan(RICHMOND, RICHMOND));
    for (const [who, id] of Object.entries(X2_POSITIVES)) {
      expect(members.has(id), `${who} (${id}) must be in X2`).toBe(true);
    }
  });

  it('T6: both directions of the conjunction exclude the right people', async () => {
    const members = await idsOf(x2Plan(RICHMOND, RICHMOND));
    for (const [who, id] of Object.entries(COACHED_RICHMOND_ONLY)) {
      expect(members.has(id), `${who} (${id}) coached Richmond but never played there`).toBe(false);
    }
    for (const [who, id] of Object.entries(PLAYED_RICHMOND_ONLY)) {
      expect(members.has(id), `${who} (${id}) played for Richmond but never coached there`).toBe(false);
    }
    // ...and the coached-only people ARE in the coaching half, so their
    // absence above is the playing half doing its work, not an empty join.
    const coachedOnly = await idsOf(coachedClubOnly(RICHMOND.organizationId));
    for (const [who, id] of Object.entries(COACHED_RICHMOND_ONLY)) {
      expect(coachedOnly.has(id), `${who} (${id}) must satisfy the coaching half`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------- T7

/**
 * The F4 regression. `match_coaches.club_id` is a raw historical club
 * identity; `coached_club` takes an ORGANIZATION. A raw-id implementation
 * answers for some of a coach's clubs and not others, and nothing in the
 * result would look wrong.
 */
describe('T7: coached clubs fold through organization lineage, never raw club ids', () => {
  it.each(Object.entries(LINEAGE_TRAPS))('%s satisfies coached_club for every organization coached, and no other', async (who, playerId) => {
    const coachedOrgs = (await sql<{ organization_id: number }[]>`
      SELECT DISTINCT cl.organization_id
        FROM coaches c
        JOIN match_coaches mc ON mc.coach_id = c.id
        JOIN clubs cl ON cl.id = mc.club_id
       WHERE c.player_id = ${playerId} AND c.link_status_value = 'unique'
    `).map((r) => Number(r.organization_id));
    expect(coachedOrgs.length, `${who} must have coached at least one organization`).toBeGreaterThan(0);

    for (const orgId of coachedOrgs) {
      const members = await idsOf(coachedClubOnly(orgId));
      expect(members.has(playerId), `${who} coached organization ${orgId}`).toBe(true);
    }

    const others = (await sql<{ organization_id: number }[]>`
      SELECT DISTINCT organization_id FROM clubs
       WHERE organization_id IS NOT NULL
         AND organization_id <> ALL(${coachedOrgs}::int[])
       ORDER BY organization_id
       LIMIT 5
    `).map((r) => Number(r.organization_id));
    for (const orgId of others) {
      const members = await idsOf(coachedClubOnly(orgId));
      expect(members.has(playerId), `${who} never coached organization ${orgId}`).toBe(false);
    }
  });

  it('the raw club identities really do outnumber the organizations', async () => {
    const rows = await sql<{ player_id: number; raw_clubs: string; orgs: string }[]>`
      SELECT c.player_id,
             count(DISTINCT mc.club_id) AS raw_clubs,
             count(DISTINCT cl.organization_id) AS orgs
        FROM coaches c
        JOIN match_coaches mc ON mc.coach_id = c.id
        JOIN clubs cl ON cl.id = mc.club_id
       WHERE c.player_id = ANY(${Object.values(LINEAGE_TRAPS)}::int[])
         AND c.link_status_value = 'unique'
       GROUP BY c.player_id
    `;
    expect(rows).toHaveLength(Object.keys(LINEAGE_TRAPS).length);
    for (const row of rows) {
      expect(Number(row.raw_clubs), `player ${row.player_id}`).toBeGreaterThan(Number(row.orgs));
    }
  });
});

// --------------------------------------------------------------------- T13

describe('T13: ownership fails closed', () => {
  const hasCoached = { builder: 'has_coached', params: {} };
  const coachedRichmond = { builder: 'coached_club', params: { club: '18' } };
  const playedRichmond = { builder: 'played_for_club', params: { club: '18' } };

  function raw(overrides: Partial<NlQueryPlan>): NlQueryPlan {
    return {
      v: 1,
      grain: 'player_career',
      metric: null,
      agg: { kind: 'list' },
      scope: {},
      careerConditions: [],
      careerPredicates: [],
      clubSeasonConditions: [],
      tiePolicy: 'all',
      limit: 100,
      ...overrides,
    };
  }

  it.each([
    ['V1: a club in match scope', raw({ careerPredicates: [hasCoached], scope: { clubFor: RICHMOND } })],
    ['V5: both coaching predicates at once', raw({
      careerPredicates: [playedRichmond, coachedRichmond, hasCoached],
      crossDomainClubs: { played: RICHMOND, coached: RICHMOND },
    })],
    ['V6: a father–son selection ranked', raw({
      metric: 'games', agg: { kind: 'max' },
      careerPredicates: [{ builder: 'father_son_selection', params: {} }, hasCoached],
    })],
    ['V9: the composition at coach grain', raw({ grain: 'coach_record', careerPredicates: [hasCoached] })],
    ['V10: the composition at season grain', raw({
      grain: 'player_season', metric: 'goals', careerPredicates: [hasCoached],
    })],
  ])('%s is refused', (_label, candidate) => {
    expect(validatePlan(candidate)).toHaveProperty('error');
  });

  /**
   * AFLDB-ISSUE-153 (Finding 1). V7 -- "a father–son selection alone is
   * refused" -- was written under ISSUE-152 Phase F, when D8 declined the
   * bare father-son question outright. Operator decision Q1 settled D8 the
   * other way: a selection plan is FS1, it ANSWERS, and the bare and
   * collective wordings now decline in the PARSER rather than at plan
   * time. The guard was retired with the decision; this assertion was
   * left behind and is the stale half.
   *
   * It is corrected here, not by restoring the guard. Restoring it would
   * re-refuse the wording the operator approved, and would deny the son
   * side a ranking the father side already ships as `rel_024`.
   */
  it('V7 is RETIRED: a father–son selection alone is a plan, not a refusal', () => {
    const bare = raw({ careerPredicates: [{ builder: 'father_son_selection', params: {} }] });
    expect(validatePlan(bare)).not.toHaveProperty('error');
  });

  it('V6 is NARROWED, not retired: the ranking is refused only with coaching', () => {
    // The row above already pins the refusal. This pins its other edge:
    // the son-side ranking with no coaching conjunct is the exact mirror
    // of the shipped rel_024 on the father side, and Q1 consequence 3
    // forbids denying one side a wording the other is given.
    expect(validatePlan(raw({
      metric: 'games', agg: { kind: 'max' },
      careerPredicates: [{ builder: 'father_son_selection', params: {} }],
    }))).not.toHaveProperty('error');
  });
});
