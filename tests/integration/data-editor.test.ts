import './guard';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '@/db/client';
import { saveMatchSheet } from '@/db/queries/match-sheet';

// Ensure saveMatchSheet uses the test database.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

afterAll(async () => {
  await sql.end();
});

describe('Data Editor - Match Sheet Delta Tests', () => {
  it('propagates kicks correctly', async () => {
    // 1. Find a match to test
    const [match] = await sql<{ id: number; season: number; home_club_id: number; away_club_id: number }[]>`
      SELECT id, season, home_club_id, away_club_id FROM matches LIMIT 1
    `;
    expect(match).toBeDefined();

    // 2. Find a player in this match
    const [playerStat] = await sql<{ player_id: number; club_id: number; kicks: number; disposals: number; jumper_number: string }[]>`
      SELECT player_id, club_id, kicks, disposals, jumper_number
        FROM player_match_stats
       WHERE match_id = ${match.id}
       LIMIT 1
    `;
    expect(playerStat).toBeDefined();

    // 3. Get baseline season/career stats
    const [seasonBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_season_stats
       WHERE player_id = ${playerStat.player_id} AND season = ${match.season}
    `;
    const [careerBaseline] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_career_stats
       WHERE player_id = ${playerStat.player_id}
    `;

    // 4. Mutate
    const newKicks = (playerStat.kicks || 0) + 1;
    const result = await saveMatchSheet({
      matchId: match.id,
      syncMatchScores: false,
      players: [
        {
          playerId: playerStat.player_id,
          clubId: playerStat.club_id,
          jumperNumber: playerStat.jumper_number,
          kicks: newKicks,
        }
      ],
      adminUserId: 1,
      note: 'test mutation',
    });

    expect(result.ok).toBe(true);
    
    // Check derivation
    const [updatedStat] = await sql<{ kicks: number; disposals: number }[]>`
      SELECT kicks, disposals FROM player_match_stats
       WHERE match_id = ${match.id} AND player_id = ${playerStat.player_id}
    `;
    expect(updatedStat.kicks).toBe(newKicks);

    // 5. Restore original state so I don't leave db mutated for other tests.
    await saveMatchSheet({
      matchId: match.id,
      syncMatchScores: false,
      players: [
        {
          playerId: playerStat.player_id,
          clubId: playerStat.club_id,
          jumperNumber: playerStat.jumper_number,
          kicks: playerStat.kicks,
        }
      ],
      adminUserId: 1,
      note: 'restore',
    });
  });
});
