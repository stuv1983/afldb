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
import { answerTeamStreak } from '@/db/queries/nl/team-streak';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAnswerPayload, NlClubSeasonRow, NlTeamAggregateRow, NlTeamMatchRow, NlTeamStreakRow,
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

async function teamAggregate(overrides: Partial<NlQueryPlan>, limit = 100): Promise<{ rows: NlTeamAggregateRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerTeamMatch(basePlan({
    metric: null, agg: { kind: 'list' }, ...overrides,
  }), limit);
  if (payload.kind !== 'team_aggregate') throw new Error(`expected team_aggregate, got ${payload.kind}`);
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

async function teamStreak(overrides: Partial<NlQueryPlan>, limit = 25): Promise<{ lead: NlTeamStreakRow | null; rows: NlTeamStreakRow[]; total: number }> {
  const payload: NlAnswerPayload = await answerTeamStreak(basePlan({
    grain: 'team_streak', metric: null, agg: { kind: 'max' },
    streakDefinition: { kind: 'win' }, ...overrides,
  }), limit);
  if (payload.kind !== 'team_streak') throw new Error(`expected team_streak, got ${payload.kind}`);
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

  it('derives H2 from final minus half-time, never by summing cumulative Q3 and Q4 checkpoints', async () => {
    const { lead } = await teamMatch({ metric: 'team_score', periodSplit: 'H2', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();

    const [expected] = await sql<{ max: number }[]>`
      WITH sides AS (
        SELECT m.id AS match_id, m.home_club_id AS club_id, m.home_score AS final_score FROM matches m
        UNION ALL
        SELECT m.id, m.away_club_id, m.away_score FROM matches m
      )
      SELECT max(s.final_score - ht.points)::int AS max
        FROM sides s
        JOIN match_period_scores ht
          ON ht.match_id = s.match_id AND ht.club_id = s.club_id AND ht.period = 2
       WHERE ht.points IS NOT NULL
    `;
    expect(lead!.value).toBe(expected.max);
    expect(lead!.value).toBe(lead!.clubScore);
  });

  it('derives Q3 as the three-quarter checkpoint minus half-time', async () => {
    const { lead } = await teamMatch({ metric: 'team_score', periodSplit: 'Q3', agg: { kind: 'max' } });
    expect(lead).not.toBeNull();
    const [expected] = await sql<{ max: number }[]>`
      SELECT max(q3.points - q2.points)::int AS max
        FROM match_period_scores q3
        JOIN match_period_scores q2
          ON q2.match_id = q3.match_id AND q2.club_id = q3.club_id AND q2.period = 2
       WHERE q3.period = 3 AND q3.points IS NOT NULL AND q2.points IS NOT NULL
    `;
    expect(lead!.value).toBe(expected.max);
  });

  it('returns organization-level win counts for HAVING queries rather than one arbitrary match', async () => {
    const [opponent] = await sql<{ organizationId: number }[]>`
      WITH sides AS (
        SELECT m.winner_club_id, m.home_club_id AS club_id, m.away_club_id AS opponent_id FROM matches m
        UNION ALL
        SELECT m.winner_club_id, m.away_club_id, m.home_club_id FROM matches m
      )
      SELECT opp.organization_id AS "organizationId"
        FROM sides s JOIN clubs opp ON opp.id = s.opponent_id
       WHERE s.winner_club_id = s.club_id
       GROUP BY opp.organization_id
      HAVING count(*) > 3
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    const actual = await teamAggregate({
      havingClause: { metric: 'wins', op: 'gt', value: 3 },
      scope: { clubAgainst: { organizationId: opponent.organizationId, slug: 'x', name: 'x' } },
    });
    const expected = await sql<{ organizationId: number; value: number }[]>`
      WITH sides AS (
        SELECT m.winner_club_id, m.home_club_id AS club_id, m.away_club_id AS opponent_id FROM matches m
        UNION ALL
        SELECT m.winner_club_id, m.away_club_id, m.home_club_id FROM matches m
      )
      SELECT own.organization_id AS "organizationId", count(*)::int AS value
        FROM sides s
        JOIN clubs own ON own.id = s.club_id
        JOIN clubs opp ON opp.id = s.opponent_id
       WHERE s.winner_club_id = s.club_id AND opp.organization_id = ${opponent.organizationId}
       GROUP BY own.organization_id
      HAVING count(*) > 3
       ORDER BY value DESC, own.organization_id
    `;
    expect(new Map(actual.rows.map((r) => [r.organizationId, r.value])))
      .toEqual(new Map(expected.map((r) => [r.organizationId, r.value])));
    expect(actual.total).toBe(expected.length);
  });

  it('filters 100-point losses before grouping and applying the requested count threshold', async () => {
    const actual = await teamAggregate({
      havingClause: { metric: 'losses', op: 'gte', value: 5 },
      matchFilter: { metric: 'loss_margin', op: 'gt', value: 100 },
    });
    const expected = await sql<{ organizationId: number; value: number }[]>`
      WITH losers AS (
        SELECT m.home_club_id AS club_id, m.away_score - m.home_score AS loss_margin
          FROM matches m WHERE m.winner_club_id = m.away_club_id
        UNION ALL
        SELECT m.away_club_id, m.home_score - m.away_score
          FROM matches m WHERE m.winner_club_id = m.home_club_id
      )
      SELECT cl.organization_id AS "organizationId", count(*)::int AS value
        FROM losers l JOIN clubs cl ON cl.id = l.club_id
       WHERE l.loss_margin > 100
       GROUP BY cl.organization_id
      HAVING count(*) >= 5
       ORDER BY value DESC, cl.organization_id
    `;
    expect(new Map(actual.rows.map((r) => [r.organizationId, r.value])))
      .toEqual(new Map(expected.map((r) => [r.organizationId, r.value])));
    expect(actual.total).toBe(expected.length);
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

describe('team_streak matches chronological truth', () => {
  it('computes a club lineage winning streak across historical identity rows', async () => {
    const [org] = await sql<{ id: number }[]>`
      SELECT organization_id AS id FROM clubs GROUP BY organization_id
       ORDER BY count(*) DESC, organization_id LIMIT 1
    `;
    const matches = await sql<{ matchId: number; matchDate: Date; won: boolean }[]>`
      SELECT m.id AS "matchId", m.match_date AS "matchDate",
             (m.winner_club_id = side.club_id) AS won
        FROM matches m
        JOIN LATERAL (
          SELECT m.home_club_id AS club_id
          UNION ALL SELECT m.away_club_id
        ) side ON true
        JOIN clubs cl ON cl.id = side.club_id
       WHERE cl.organization_id = ${org.id}
       ORDER BY m.match_date, m.id
    `;
    let longest = 0;
    let current = 0;
    for (const match of matches) {
      current = match.won ? current + 1 : 0;
      longest = Math.max(longest, current);
    }

    const { lead } = await teamStreak({
      scope: { clubFor: { organizationId: org.id, slug: 'x', name: 'x' } },
    });
    expect(lead).not.toBeNull();
    expect(lead!.clubId).toBe(org.id);
    expect(lead!.streakLength).toBe(longest);
  });
});
