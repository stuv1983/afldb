/**
 * coach_record grain (AFLDB-ISSUE-152 Phase B). A new file rather than an
 * addition to nl-answers.test.ts because the integration suites are already
 * split by grain -- that one says in its own header that it is player_career
 * only, with -game-season and -team-club beside it.
 *
 * Every answer here is checked against an independently HAND-WRITTEN query,
 * never just "returns rows": the compiler is a parameterised generalisation
 * of db/queries/coaches.ts, and the whole point of these tests is that the
 * generalisation returns what the originals return.
 *
 * The exact-count expectations come from the measured evidence run of
 * 2026-09-08 (ISSUE-152-nl-evidence-output.txt) and are marked (E) there as
 * exhaustive. League-wide boards are asserted as orderings and inequalities
 * instead, because the evidence for those is a LIMIT 25 witness list.
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerCoachRecord } from '@/db/queries/nl/coach-record';
import { buildNlParseContext } from '@/db/queries/nl/resolve';
import { parseNlQuestion } from '@/search/nl/parser';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload, NlCoachRecordRow } from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

async function coachRecord(p: NlQueryPlan, limit = 100): Promise<{
  lead: NlCoachRecordRow | null; rows: NlCoachRecordRow[]; total: number;
}> {
  const payload: NlAnswerPayload = await answerCoachRecord(p, limit);
  if (payload.kind !== 'coach_record') throw new Error(`expected coach_record, got ${payload.kind}`);
  return payload;
}

async function coachCount(p: NlQueryPlan): Promise<number> {
  const payload: NlAnswerPayload = await answerCoachRecord(p, 100);
  if (payload.kind !== 'count') throw new Error(`expected count, got ${payload.kind}`);
  return payload.value;
}

function plan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'coach_record',
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
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

async function clubRef(name: string) {
  const [row] = await sql<{ organizationId: number; slug: string; name: string }[]>`
    SELECT o.id AS "organizationId", o.slug, o.name
      FROM club_organizations o
     WHERE o.name = ${name}
  `;
  if (!row) throw new Error(`no club organization named ${name}`);
  return row;
}

async function coachRef(displayName: string) {
  const [row] = await sql<{ id: number; playerId: number | null; playerSlug: string | null }[]>`
    SELECT c.id, c.player_id AS "playerId", p.slug AS "playerSlug"
      FROM coaches c LEFT JOIN players p ON p.id = c.player_id
     WHERE c.display_name = ${displayName}
  `;
  if (!row) throw new Error(`no coach named ${displayName}`);
  return { id: row.id, slug: 'x', name: displayName, playerId: row.playerId, playerSlug: row.playerSlug };
}

describe('club-scoped coaching records match a hand-written getClubCoachRecords-shaped query', () => {
  it('every Richmond coach, same rows in the same order', async () => {
    const richmond = await clubRef('Richmond');
    const { rows, total } = await coachRecord(plan({ scope: { clubFor: richmond } }));

    const expected = await sql<{
      coachId: number; games: number; wins: number; draws: number; losses: number; seasons: number;
    }[]>`
      SELECT c.id AS "coachId",
             count(*)::int AS games,
             count(*) FILTER (WHERE m.winner_club_id = mc.club_id)::int AS wins,
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (
               WHERE m.winner_club_id IS NOT NULL AND m.winner_club_id <> mc.club_id
             )::int AS losses,
             count(DISTINCT m.season)::int AS seasons
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
        JOIN coaches c ON c.id = mc.coach_id
       WHERE mc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${richmond.organizationId})
       GROUP BY c.id, c.display_name
       ORDER BY max(m.season) DESC, min(m.season) DESC, c.display_name
    `;

    // (E) §1.4: the Richmond organization has exactly 42 coaches, 1908-2025.
    expect(total).toBe(42);
    expect(expected).toHaveLength(42);
    expect(rows.map((r) => [r.coachId, r.games, r.wins, r.draws, r.losses, r.seasons]))
      .toEqual(expected.map((r) => [r.coachId, r.games, r.wins, r.draws, r.losses, r.seasons]));
    // games = wins + draws + losses always holds.
    for (const row of rows) expect(row.games).toBe(row.wins + row.draws + row.losses);
  });

  it("Damien Hardwick's Richmond record is the measured 307/170/6/131, not his whole career", async () => {
    const richmond = await clubRef('Richmond');
    const hardwick = await coachRef('Damien Hardwick');

    const { lead } = await coachRecord(plan({ coach: hardwick, scope: { clubFor: richmond } }));
    expect(lead).toMatchObject({
      games: 307, wins: 170, draws: 6, losses: 131, seasons: 14, firstSeason: 2010, lastSeason: 2023,
    });
    expect(lead!.winPct).toBe('56.35');

    const { lead: career } = await coachRecord(plan({ coach: hardwick }));
    const [expectedCareer] = await sql<{ games: number }[]>`
      SELECT count(*)::int AS games
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       WHERE mc.coach_id = ${hardwick.id}
    `;
    expect(career!.games).toBe(expectedCareer.games);
    expect(career!.games).toBeGreaterThan(307);
  });

  it('a season witness returns exactly one Richmond coach for 2017', async () => {
    const richmond = await clubRef('Richmond');
    const { rows } = await coachRecord(plan({ scope: { clubFor: richmond, seasonMin: 2017, seasonMax: 2017 } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: 'Damien Hardwick', games: 25, wins: 18, draws: 0, losses: 7 });
  });

  it('counts a club\'s coaches rather than listing them when asked how many', async () => {
    const richmond = await clubRef('Richmond');
    expect(await coachCount(plan({ scope: { clubFor: richmond }, agg: { kind: 'count' } }))).toBe(42);
  });
});

describe('coaching thresholds match a hand-written HAVING', () => {
  // (E) §7.2: the Richmond thresholds, measured exhaustively.
  const cases: [string, 'games' | 'wins', number, number][] = [
    ['games >= 200', 'games', 200, 3],
    ['games >= 100', 'games', 100, 8],
    ['games >= 50', 'games', 50, 14],
    ['wins >= 100', 'wins', 100, 3],
    ['wins >= 50', 'wins', 50, 7],
    ['wins >= 25', 'wins', 25, 14],
  ];

  it.each(cases)('Richmond coaches with %s', async (_label, metric, value, expectedCount) => {
    const richmond = await clubRef('Richmond');
    const { total } = await coachRecord(plan({
      scope: { clubFor: richmond }, metric, metricCondition: { op: 'gte', value },
    }));

    const measured = metric === 'games'
      ? sql`count(*) >= ${value}`
      : sql`count(*) FILTER (WHERE m.winner_club_id = mc.club_id) >= ${value}`;
    const [expected] = await sql<{ count: string }[]>`
      SELECT count(*) AS count FROM (
        SELECT c.id
          FROM match_coaches mc
          JOIN matches m ON m.id = mc.match_id
          JOIN coaches c ON c.id = mc.coach_id
         WHERE mc.club_id IN (SELECT id FROM clubs WHERE organization_id = ${richmond.organizationId})
         GROUP BY c.id
        HAVING ${measured}
      ) q
    `;
    expect(Number(expected.count)).toBe(expectedCount);
    expect(total).toBe(expectedCount);
  });
});

describe('win percentage is draw-weighted, and the qualifier is real', () => {
  it('George Angus computes 70.00, which a plain W/G control does NOT match', async () => {
    const angus = await coachRef('George Angus');
    const { lead } = await coachRecord(plan({ coach: angus }));
    // (W) §1.3: 60 games, 41 wins, 2 draws.
    expect(lead).toMatchObject({ games: 60, wins: 41, draws: 2 });
    expect(lead!.winPct).toBe('70.00');

    const [control] = await sql<{ plain: string }[]>`
      SELECT round((count(*) FILTER (WHERE m.winner_club_id = mc.club_id) * 100.0 / count(*))::numeric, 2) AS plain
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       WHERE mc.coach_id = ${angus.id}
    `;
    expect(control.plain).toBe('68.33');
    expect(lead!.winPct).not.toBe(control.plain);
  });

  it('the 50-game board is led by Cliff Rankin, and dropping the qualifier changes the answer', async () => {
    const qualified = await coachRecord(plan({
      metric: 'win_pct', agg: { kind: 'max' }, coachQualifier: { minGames: 50 }, limit: 25,
    }), 25);
    // (W) §1.3: 57 games, 45 wins, 78.95.
    expect(qualified.lead).toMatchObject({ displayName: 'Cliff Rankin', games: 57, wins: 45, draws: 0 });
    expect(qualified.lead!.winPct).toBe('78.95');

    const [expected] = await sql<{ displayName: string; winPct: string }[]>`
      WITH t AS (
        SELECT c.display_name AS "displayName",
               count(*)::int AS games,
               (count(*) FILTER (WHERE m.winner_club_id = mc.club_id)
                 + count(*) FILTER (WHERE m.winner_club_id IS NULL) * 0.5) * 100.0 / count(*) AS pct
          FROM match_coaches mc
          JOIN matches m ON m.id = mc.match_id
          JOIN coaches c ON c.id = mc.coach_id
         GROUP BY c.id, c.display_name
      )
      SELECT "displayName", round(pct::numeric, 2) AS "winPct"
        FROM t WHERE games >= 50 ORDER BY pct DESC, "displayName" LIMIT 1
    `;
    expect(qualified.lead!.displayName).toBe(expected.displayName);
    expect(qualified.lead!.winPct).toBe(expected.winPct);

    // Without the qualifier the board is a one-game sample. The plan is
    // built UNVALIDATED on purpose: validatePlan refuses this shape, and
    // this control exists to show what it is refusing.
    const unqualifiedPlan: NlQueryPlan = {
      v: 1, grain: 'coach_record', metric: 'win_pct', agg: { kind: 'max' }, scope: {},
      careerConditions: [], careerPredicates: [], clubSeasonConditions: [], tiePolicy: 'all', limit: 25,
    };
    expect(validatePlan(unqualifiedPlan)).toHaveProperty('error');
    const unqualified = await coachRecord(unqualifiedPlan, 25);
    expect(unqualified.lead!.games).toBeLessThan(50);
    expect(unqualified.lead!.displayName).not.toBe('Cliff Rankin');
  });

  it('a reader-stated minimum is applied instead of the default', async () => {
    const { rows } = await coachRecord(plan({
      metric: 'win_pct', agg: { kind: 'top_n', n: 5 }, coachQualifier: { minGames: 300 }, limit: 100,
    }));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.games).toBeGreaterThanOrEqual(300);
  });
});

describe('club scope folds the organization lineage and never a merger', () => {
  it('a Western Bulldogs query returns Footscray-era coaching rows', async () => {
    const bulldogs = await clubRef('Western Bulldogs');
    const { rows } = await coachRecord(plan({ scope: { clubFor: bulldogs } }));

    const footscrayCoaches = await sql<{ coachId: number }[]>`
      SELECT DISTINCT mc.coach_id AS "coachId"
        FROM match_coaches mc JOIN clubs cl ON cl.id = mc.club_id
       WHERE cl.name = 'Footscray'
    `;
    expect(footscrayCoaches.length).toBeGreaterThan(0);
    const returned = new Set(rows.map((r) => r.coachId));
    for (const { coachId } of footscrayCoaches) expect(returned.has(coachId)).toBe(true);
  });

  it('a Brisbane Lions query returns no Fitzroy coaching rows', async () => {
    const lions = await clubRef('Brisbane Lions');
    const { rows } = await coachRecord(plan({ scope: { clubFor: lions } }));

    const fitzroyOnly = await sql<{ coachId: number }[]>`
      SELECT DISTINCT mc.coach_id AS "coachId"
        FROM match_coaches mc JOIN clubs cl ON cl.id = mc.club_id
       WHERE cl.name = 'Fitzroy'
         AND mc.coach_id NOT IN (
           SELECT mc2.coach_id FROM match_coaches mc2 JOIN clubs cl2 ON cl2.id = mc2.club_id
            WHERE cl2.name <> 'Fitzroy'
              AND cl2.organization_id = (SELECT organization_id FROM clubs WHERE name = 'Brisbane Lions' LIMIT 1)
         )
    `;
    expect(fitzroyOnly.length).toBeGreaterThan(0);
    const returned = new Set(rows.map((r) => r.coachId));
    for (const { coachId } of fitzroyOnly) expect(returned.has(coachId)).toBe(false);
  });
});

describe('the coach/player identity seam', () => {
  it('coachOnly agrees with coaches.player_id IS NULL on every returned row', async () => {
    const { rows } = await coachRecord(plan({ metric: 'games', agg: { kind: 'top_n', n: 50 }, limit: 100 }));
    expect(rows.length).toBeGreaterThan(0);
    const links = await sql<{ id: number; playerId: number | null }[]>`
      SELECT id, player_id AS "playerId" FROM coaches WHERE id = ANY(${rows.map((r) => r.coachId)})
    `;
    const byId = new Map(links.map((l) => [l.id, l.playerId]));
    for (const row of rows) {
      expect(row.coachOnly).toBe(byId.get(row.coachId) === null);
      expect(row.playerId).toBe(byId.get(row.coachId) ?? null);
    }
  });

  it('the table splits 368 player-linked / 18 coach-only', async () => {
    // (E) §1.8. The reason a coaching answer cannot be modelled as a player.
    const [counts] = await sql<{ linked: string; coachOnly: string; total: string }[]>`
      SELECT count(*) FILTER (WHERE player_id IS NOT NULL) AS linked,
             count(*) FILTER (WHERE player_id IS NULL) AS "coachOnly",
             count(*) AS total
        FROM coaches
    `;
    expect(Number(counts.linked)).toBe(368);
    expect(Number(counts.coachOnly)).toBe(18);
    expect(Number(counts.total)).toBe(386);
  });
});

describe('nothing is fabricated', () => {
  it('an unknown coach returns no record at all', async () => {
    const [{ max }] = await sql<{ max: number }[]>`SELECT coalesce(max(id), 0)::int AS max FROM coaches`;
    const { rows, total, lead } = await coachRecord(plan({
      coach: { id: max + 1000, slug: 'nobody', name: 'Nobody', playerId: null, playerSlug: null },
    }));
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(lead).toBeNull();
  });

  it('a season with no coaching records returns an empty result, not a zero-row record', async () => {
    const richmond = await clubRef('Richmond');
    const { rows, total } = await coachRecord(plan({
      scope: { clubFor: richmond, seasonMin: 2090, seasonMax: 2090 },
    }));
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('coaching coverage', () => {
  it('the earliest recorded coaching season really is 1902', async () => {
    // The NL_COVERAGE floor is a measured fact, not a guess.
    const [row] = await sql<{ first: number }[]>`
      SELECT min(m.season)::int AS first
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
    `;
    expect(row.first).toBe(1902);
  });
});

/**
 * The Phase B corpora, run through the REAL parse context -- the 386-row
 * coach directory built from the database, not a hand-written stand-in.
 *
 * This is what stops a corpus row and the engine drifting apart: a question
 * added to the plan corpus that the parser cannot answer, or a decline row
 * that quietly starts producing a confident answer, fails here rather than
 * only in an overnight browser sweep.
 */
describe('the Phase B coaching corpora, against the real coach directory', () => {
  const CORPUS_DIR = 'tests/nl-ui/corpora';

  function readCorpus(file: string): { id: string; question: string }[] {
    const text = readFileSync(join(process.cwd(), CORPUS_DIR, file), 'utf8');
    return text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      return { id: cells[0], question: cells[2] };
    });
  }

  it('every plan row parses to a coaching plan that validates', async () => {
    const ctx = await buildNlParseContext();
    const failures: string[] = [];
    for (const { id, question } of readCorpus('afldb-ui-questions-coaching-v1-20260908.csv')) {
      const parsed = await parseNlQuestion(question, ctx);
      if (parsed.status !== 'plan') {
        failures.push(`${id} "${question}": ${parsed.status}`);
        continue;
      }
      const validated = validatePlan(parsed.plan);
      if ('error' in validated) failures.push(`${id} "${question}": ${validated.error}`);
    }
    expect(failures).toEqual([]);
  });

  it('every decline row declines, or refuses honestly at validation', async () => {
    const ctx = await buildNlParseContext();
    const answered: string[] = [];
    for (const { id, question } of readCorpus('afldb-ui-questions-coaching-decline-v1-20260908.csv')) {
      const parsed = await parseNlQuestion(question, ctx);
      if (parsed.status !== 'plan') continue;
      const validated = validatePlan(parsed.plan);
      if (!('error' in validated)) answered.push(`${id} "${question}"`);
    }
    expect(answered).toEqual([]);
  });

  it('the real coach directory keeps a colliding surname out of the alias set', async () => {
    const ctx = await buildNlParseContext();
    expect(ctx.coaches).toBeDefined();
    expect(ctx.coaches!.length).toBe(386);
    const aliases = new Set(ctx.coaches!.flatMap((c) => c.names));
    // Albert and Charlie Pannam both coached Richmond; Len and Norm Smith
    // both coached. Neither bare surname may resolve to one of them.
    expect(aliases.has('pannam')).toBe(false);
    expect(aliases.has('smith')).toBe(false);
    // A unique surname still resolves.
    expect(aliases.has('hardwick')).toBe(true);
    // 18 coaches have no player row at all.
    expect(ctx.coaches!.filter((c) => c.playerId === null)).toHaveLength(18);
  });
});
