/**
 * getPlayerHonours' generic awards list (AFLDB-ISSUE-118 §W.4 Brownlow
 * de-duplication). The Brownlow Medal has its own authoritative section on
 * the player page (getPlayerBrownlow / brownlow_season_votes) and its own
 * concise stat-strip note (player.brownlowMedals); the generic Honours list
 * must not independently repeat it a third time. All-Australian already
 * follows this same exclusion for the same reason (its own dedicated
 * block), so a Brownlow medallist is discovered dynamically here the same
 * way.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getPlayerHonours } from '@/db/queries/awards';

afterAll(async () => {
  await sql.end();
});

describe('getPlayerHonours', () => {
  it('a Brownlow medallist\'s generic awards list carries no brownlow-medal row', async () => {
    const [medallist] = await sql<{ playerId: number }[]>`
      SELECT w.player_id AS "playerId"
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE a.slug = 'brownlow-medal' AND w.player_id IS NOT NULL
       LIMIT 1
    `;
    expect(medallist, 'the named-medals award family has not loaded this database').toBeDefined();

    const honours = await getPlayerHonours(medallist.playerId);
    expect(honours.awards.find((a) => a.slug === 'brownlow-medal')).toBeUndefined();
  });

  it('an All-Australian selection is still excluded from the generic list (unchanged behaviour)', async () => {
    const [aa] = await sql<{ playerId: number }[]>`
      SELECT w.player_id AS "playerId"
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE a.slug = 'all-australian' AND w.player_id IS NOT NULL
       LIMIT 1
    `;
    expect(aa, 'all-australian has not loaded this database').toBeDefined();

    const honours = await getPlayerHonours(aa.playerId);
    expect(honours.awards.find((a) => a.slug === 'all-australian')).toBeUndefined();
  });

  it('a genuinely different award is not swept up by the exclusion', async () => {
    const [other] = await sql<{ playerId: number; slug: string }[]>`
      SELECT w.player_id AS "playerId", a.slug
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
       WHERE a.slug NOT IN ('all-australian', 'brownlow-medal') AND w.player_id IS NOT NULL
       LIMIT 1
    `;
    expect(other, 'no non-Brownlow, non-AA award has loaded into this database').toBeDefined();

    const honours = await getPlayerHonours(other.playerId);
    expect(honours.awards.find((a) => a.slug === other.slug)).toBeDefined();
  });
});
