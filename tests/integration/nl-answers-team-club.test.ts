/**
 * team_match and club_season grains: every answer checked against an
 * independently hand-written SQL query, the same discipline
 * nl-answers.test.ts and nl-answers-game-season.test.ts apply to the
 * other three grains. Real ids are dynamically discovered from the test
 * database rather than hardcoded (grid-solver.test.ts's convention).
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { answerClubSeason } from '@/db/queries/nl/club-season';
import { answerTeamMatch } from '@/db/queries/nl/team-match';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAnswerPayload, NlClubSeasonRow, NlTeamMatchRow,
} from '@/search/nl/answer-types';

afterAll(async () => {
  await sql.end();
});

function basePlan(overrides: Partial<NlQueryPlan>): NlQueryPlan {
  const raw: NlQueryPlan = {
    v: 1,
    grain: 'team_match',
    metric: 'win_margin',
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
    ...overrides,
  };
  const validated = validatePlan(raw);
  if ('error' in validated) throw new Error(`test plan failed validation: ${validated.error}`);
  return validated;
}

async function teamMatch(overrides: Partial<NlQueryPlan>, limit = 25): Promise<{ lead: NlTeamMatchRow | null; rows: NlTeamMatchRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerTeamMatch(basePlan(overrides), limit);
  if (payload.kind !== 'team_match') throw new Error(`expected team_match, got ${payload.kind}`);
  return payload;
}

async function clubSeason(overrides: Partial<NlQueryPlan>, limit = 25): Promise<{ lead: NlClubSeasonRow | null; rows: NlClubSeasonRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerClubSeason(
    basePlan({ grain: 'club_season', metric: null, agg: { kind: 'list' }, ...overrides }),
    limit,
  );
  if (payload.kind !== 'club_season') throw new Error(`expected club_season, got ${payload.kind}`);
  return payload;
}

describe('team_match matches hand-written SQL', () => {
  it('unscoped "biggest win ever" matches matches.margin (already the winner\'s advantage)', async () => {
    const { lead } = await teamMatch({ metric: 'win_margin', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(margin) AS max FROM matches WHERE winner_club_id IS NOT NULL
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('unscoped "biggest loss ever" matches the same margin distribution from the loser\'s side', async () => {
    const { lead } = await teamMatch({ metric: 'loss_margin', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(margin) AS max FROM matches WHERE winner_club_id IS NOT NULL
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('a club-scoped biggest loss matches a hand-written per-club margin query', async () => {
    const [org] = await sql<{ id: number }[]>`SELECT id FROM club_organizations ORDER BY id LIMIT 1`;
    const { lead } = await teamMatch({
      metric: 'loss_margin', agg: { kind: 'max' },
      scope: { clubFor: { organizationId: org.id, slug: 'x', name: 'x' } },
    });

    const [expected] = await sql<{ max: number | null }[]>`
      SELECT max(m.margin) AS max FROM matches m
       WHERE m.winner_club_id IS NOT NULL
         AND m.winner_club_id <> ALL (SELECT id FROM clubs WHERE organization_id = ${org.id})
         AND (m.home_club_id IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
              OR m.away_club_id IN (SELECT id FROM clubs WHERE organization_id = ${org.id}))
    `;
    if (expected.max === null) {
      expect(lead).toBeNull();
    } else {
      expect(lead).not.toBeNull();
      expect(lead!.value).toBe(expected.max);
    }
  });

  it('a venue-scoped highest score matches a hand-written per-venue query', async () => {
    const [venue] = await sql<{ venueId: number }[]>`
      SELECT venue_id AS "venueId" FROM matches WHERE venue_id IS NOT NULL
       GROUP BY venue_id ORDER BY count(*) DESC LIMIT 1
    `;
    const { lead } = await teamMatch({
      metric: 'team_score', agg: { kind: 'max' },
      scope: { venue: { id: venue.venueId, slug: 'x', name: 'x' } },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      SELECT max(greatest(home_score, away_score)) AS max FROM matches WHERE venue_id = ${venue.venueId}
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('"top 5 highest scores" includes every hand-written top-5, with ties at the cutoff', async () => {
    const { rows } = await teamMatch({ metric: 'team_score', agg: { kind: 'top_n', n: 5 } }, 100);
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const expectedTop = await sql<{ matchId: number; score: number }[]>`
      SELECT id AS "matchId", home_score AS score FROM matches
      UNION ALL
      SELECT id, away_score FROM matches
      ORDER BY score DESC LIMIT 5
    `;
    for (const e of expectedTop) {
      expect(rows.some((r) => r.matchId === e.matchId && r.value === e.score),
        `match ${e.matchId} score ${e.score} missing`).toBe(true);
    }
  });
});

describe('club_season matches hand-written SQL', () => {
  it('unscoped "most wins in a season" matches a hand-written MAX', async () => {
    const { lead } = await clubSeason({ metric: 'wins', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`SELECT max(wins) AS max FROM club_seasons`;
    expect(lead!.value).toBe(expected.max);
  });

  it('a club-scoped percentage ranking matches a hand-written per-club MAX', async () => {
    const [org] = await sql<{ id: number }[]>`
      SELECT cl.organization_id AS id FROM club_seasons cs JOIN clubs cl ON cl.id = cs.club_id
       WHERE cs.percentage IS NOT NULL
       GROUP BY cl.organization_id ORDER BY count(*) DESC LIMIT 1
    `;
    const { lead } = await clubSeason({
      metric: 'percentage', agg: { kind: 'max' },
      scope: { clubFor: { organizationId: org.id, slug: 'x', name: 'x' } },
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: string }[]>`
      SELECT max(cs.percentage) AS max FROM club_seasons cs
       WHERE cs.club_id IN (SELECT id FROM clubs WHERE organization_id = ${org.id})
    `;
    expect(lead!.value).toBeCloseTo(Number(expected.max), 3);
  });

  it('"fewest wins by a premier" matches a hand-written MIN scoped to is_premier', async () => {
    const { lead } = await clubSeason({
      metric: 'wins', agg: { kind: 'min' },
      clubSeasonConditions: [{ kind: 'premier' }],
    });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ min: number }[]>`SELECT min(wins) AS min FROM club_seasons WHERE is_premier`;
    expect(lead!.value).toBe(expected.min);
  });

  it('"teams that won the wooden spoon" (a conditions-only list) matches a hand-written COUNT', async () => {
    const { total } = await clubSeason({ clubSeasonConditions: [{ kind: 'wooden_spoon' }] }, 200);

    const [expected] = await sql<{ count: string }[]>`SELECT count(*) FROM club_seasons WHERE wooden_spoon`;
    expect(total).toBe(Number(expected.count));
  });

  it('"clubs that made finals" vs "missed finals" partition club_seasons with finals_played recorded', async () => {
    const made = await clubSeason({ clubSeasonConditions: [{ kind: 'made_finals' }] }, 500);
    const missed = await clubSeason({ clubSeasonConditions: [{ kind: 'missed_finals' }] }, 500);

    const [expectedMade] = await sql<{ count: string }[]>`SELECT count(*) FROM club_seasons WHERE finals_played > 0`;
    const [expectedMissed] = await sql<{ count: string }[]>`SELECT count(*) FROM club_seasons WHERE finals_played = 0`;
    expect(made.total).toBe(Number(expectedMade.count));
    expect(missed.total).toBe(Number(expectedMissed.count));

    // The two conditions must never both be true for the same row.
    const madeIds = new Set(made.rows.map((r) => `${r.clubId}-${r.season}`));
    const missedIds = new Set(missed.rows.map((r) => `${r.clubId}-${r.season}`));
    for (const id of madeIds) expect(missedIds.has(id)).toBe(false);
  });
});
