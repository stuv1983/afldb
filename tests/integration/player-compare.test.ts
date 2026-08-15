/**
 * Runs against real data rather than fixtures, since the whole point of
 * these queries is a self-join over player_match_stats -- the only way to
 * know the join and the aggregation agree is to check them against rows
 * that actually exist. Pairs and players are discovered dynamically
 * (never hardcoded names) so the test does not depend on which specific
 * careers happen to be loaded.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getBestSingleGame, getHeadToHeadMatches, getPlayerOverlapSummary } from '@/db/queries/player-compare';
import { getPlayer } from '@/db/queries/players';

afterAll(async () => {
  await sql.end();
});

describe('player-compare queries', () => {
  it('overlap summary agrees with the head-to-head match counts, split by relationship', async () => {
    // Anchored on one long-career player first, rather than grouping the
    // unbounded self-join over all 694k rows: that first version of this
    // query hit the statement timeout, because grouping by (pms1, pms2)
    // with no WHERE forces PostgreSQL to materialise every co-occurring
    // pair in the whole fact table before the HAVING filter narrows
    // anything. Anchoring pms1 to a single player_id turns it into an
    // index seek (ix_pms_player) over ~300-400 rows instead.
    const [anchor] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats ORDER BY games DESC LIMIT 1
    `;
    expect(anchor).toBeDefined();

    const [pairRow] = await sql<{ other: number }[]>`
      SELECT pms2.player_id AS other
        FROM player_match_stats pms1
        JOIN player_match_stats pms2
          ON pms2.match_id = pms1.match_id AND pms2.player_id <> pms1.player_id
       WHERE pms1.player_id = ${anchor.playerId}
       GROUP BY pms2.player_id
      HAVING count(*) BETWEEN 50 AND 400
       ORDER BY count(*) DESC
       LIMIT 1
    `;
    expect(pairRow, `no teammate/opponent of player ${anchor.playerId} with 50-400 shared matches was found`).toBeDefined();
    const pair = { a: anchor.playerId, b: pairRow.other };

    const [overlap, all, teammates, opponents] = await Promise.all([
      getPlayerOverlapSummary(pair.a, pair.b),
      getHeadToHeadMatches(pair.a, pair.b, 'all'),
      getHeadToHeadMatches(pair.a, pair.b, 'teammates'),
      getHeadToHeadMatches(pair.a, pair.b, 'opponents'),
    ]);

    expect(overlap.together + overlap.against).toBeGreaterThanOrEqual(50);
    expect(overlap.together).toBe(teammates.length);
    expect(overlap.against).toBe(opponents.length);
    expect(all.length).toBe(teammates.length + opponents.length);
    expect(all.length).toBe(overlap.together + overlap.against);
  });

  it('never shows a shared match for two players who never played together', async () => {
    const [players] = await sql<{ ids: number[] }[]>`SELECT array_agg(id ORDER BY id) AS ids FROM (SELECT id FROM players LIMIT 2) t`;
    // Not a claim that these two never met -- just that the query returns
    // internally consistent zero/empty state when overlap.together and
    // overlap.against are both 0, which the vast majority of arbitrary
    // player pairs in a 13,000-player database will be.
    const [a, b] = players.ids;
    const overlap = await getPlayerOverlapSummary(a, b);
    if (overlap.together === 0 && overlap.against === 0) {
      const all = await getHeadToHeadMatches(a, b, 'all');
      expect(all).toEqual([]);
    }
  });

  it('best single game matches player_career_stats’ own precomputed bests', async () => {
    const [row] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId" FROM player_career_stats
       WHERE best_goals_game IS NOT NULL AND best_disposals_game IS NOT NULL
       ORDER BY best_goals_game DESC, best_disposals_game DESC
       LIMIT 1
    `;
    expect(row, 'no player with precomputed best-game figures was found').toBeDefined();

    const [profile, best] = await Promise.all([
      getPlayer(row.playerId),
      getBestSingleGame(row.playerId),
    ]);
    expect(profile).not.toBeNull();
    expect(best.goals).toBe(profile!.bestGoalsGame);
    expect(best.disposals).toBe(profile!.bestDisposalsGame);
  });
});
