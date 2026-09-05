/**
 * getPlayerAfterSirenEvents (after_siren_kicks, migration 089), added to
 * unblock the player-page UI exposure of after-the-siren events
 * (AFLDB-ISSUE-118 §W.4). Fixtures are the same tracked Wikipedia rows
 * tests/after-siren-normalisation.test.ts exercises at the loader level --
 * Luke Shuey (2017 EF, extra-time siren, goal to win), David King (1994 QF,
 * end_of_regulation miss) and Kerry Good (1980 Escort Championships GF, a
 * non-premiership-season event with no match_id) -- discovered dynamically
 * by name, never a hardcoded player id.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getPlayerAfterSirenEvents } from '@/db/queries/after-siren';

afterAll(async () => {
  await sql.end();
});

async function afterSirenPlayerId(nameClean: string): Promise<number | null> {
  const [row] = await sql<{ playerId: number | null }[]>`
    SELECT player_id AS "playerId" FROM after_siren_kicks WHERE player_name_clean = ${nameClean} LIMIT 1
  `;
  return row?.playerId ?? null;
}

describe('getPlayerAfterSirenEvents', () => {
  it('Luke Shuey 2017: an extra-time-siren goal to win, linked to its match', async () => {
    const playerId = await afterSirenPlayerId('Luke Shuey');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const shuey = events.find((e) => e.season === 2017 && e.siren === 'end_of_extra_time');
    expect(shuey).toBeDefined();
    expect(shuey).toMatchObject({
      kickScored: 'goal',
      kickEffect: 'won',
      kickerResult: 'win',
      premiershipSeason: true,
    });
  });

  it('David King 1994: an end_of_regulation miss, kick_effect none', async () => {
    const playerId = await afterSirenPlayerId('David King');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const king = events.find((e) => e.season === 1994 && e.siren === 'end_of_regulation');
    expect(king).toBeDefined();
    expect(king).toMatchObject({ kickScored: 'none', kickEffect: 'none' });
  });

  it('Kerry Good 1980: a non-premiership-season event carries no match id', async () => {
    const playerId = await afterSirenPlayerId('Kerry Good');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const good = events.find((e) => e.season === 1980);
    expect(good).toBeDefined();
    expect(good!.premiershipSeason).toBe(false);
    expect(good!.matchId).toBeNull();
    expect(good!.competition).toBe('Escort Championships');
  });

  it('a player with no after-siren events returns an empty array', async () => {
    const [someone] = await sql<{ id: number }[]>`
      SELECT p.id FROM players p
       WHERE NOT EXISTS (SELECT 1 FROM after_siren_kicks a WHERE a.player_id = p.id)
       LIMIT 1
    `;
    expect(someone).toBeDefined();
    expect(await getPlayerAfterSirenEvents(someone.id)).toEqual([]);
  });
});
