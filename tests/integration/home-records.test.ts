import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getHomeRecord } from '@/db/queries/home-records';

afterAll(async () => {
  await sql.end();
});

describe('AFL home record catalogue against afldb_test', () => {
  it('preserves career records and reuses match and season record semantics', async () => {
    const career = await getHomeRecord('most-goals', 5);
    const match = await getHomeRecord('most-goals-in-a-game', 5);
    const season = await getHomeRecord('most-goals-in-a-season', 5);

    expect(career.rows[0]).toMatchObject({ displayName: 'Tony Lockett', value: 1360 });
    expect(match.rows[0]).toMatchObject({ displayName: 'Fred Fanning', value: 18, season: 1947 });
    expect(season.rows.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Bob Pratt', value: 150, season: 1934 }),
      expect.objectContaining({ displayName: 'Peter Hudson', value: 150, season: 1971 }),
    ]));
  });

  it('derives coach count and percentage leaders from canonical match assignments', async () => {
    const cases = [
      ['coach-most-games', 'Mick Malthouse', 718],
      ['coach-most-wins', 'Jock McHale', 466],
      ['coach-most-finals', 'Jock McHale', 58],
      ['coach-most-grand-finals', 'Jock McHale', 16],
      ['coach-most-premierships', 'Jock McHale', 7],
      ['coach-best-win-percentage', 'Cliff Rankin', 78.95],
    ] as const;

    for (const [value, displayName, expected] of cases) {
      const result = await getHomeRecord(value, 5);
      expect(result.rows[0]).toMatchObject({ kind: 'coach-total', displayName, value: expected });
    }
  });

  it('preserves venue counts and NULL attendance semantics', async () => {
    const cases = [
      ['venue-most-matches', 3200],
      ['venue-most-finals', 485],
      ['venue-most-grand-finals', 119],
      ['venue-highest-recorded-attendance', 121696],
    ] as const;

    for (const [value, expected] of cases) {
      const result = await getHomeRecord(value, 5);
      expect(result.rows[0]).toMatchObject({
        kind: 'venue-total', venueName: 'Melbourne Cricket Ground', value: expected,
      });
    }
  });

  it('uses active linked curated records for after-siren and first-kick leaders', async () => {
    const attempts = await getHomeRecord('after-siren-most-attempts', 5);
    const goalsToWin = await getHomeRecord('after-siren-most-goals-to-win', 5);
    const firstKick = await getHomeRecord('first-kick-most-consecutive-goals', 5);

    expect(attempts.rows[0]).toMatchObject({ displayName: 'Barry Hall', value: 2 });
    expect(goalsToWin.rows[0]).toMatchObject({ displayName: 'Barry Hall', value: 2 });
    expect(firstKick.rows[0]).toMatchObject({ displayName: 'Clen Denning', value: 6, season: 1935 });
  });
});
