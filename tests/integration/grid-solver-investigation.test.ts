import { afterAll, describe, it } from 'vitest';
import { sql } from '@/db/client';

afterAll(async () => {
  await sql.end();
});

describe('grid solver investigation', () => {
  it('investigates Archie Roberts teammates', async () => {
    const roberts = await sql`SELECT id, display_name FROM players WHERE display_name ILIKE '%Archie Roberts%'`;
    console.log('Archie Roberts:', roberts);

    if (roberts.length > 0) {
      const pId = roberts[0].id;
      
      const sameMatch = await sql`
        SELECT COUNT(DISTINCT pms1.player_id) as c
        FROM player_match_stats pms1
        JOIN player_match_stats pms2 ON pms2.match_id = pms1.match_id AND pms2.club_id = pms1.club_id
        WHERE pms2.player_id = ${pId} AND pms1.player_id <> ${pId}
      `;
      console.log('Same match teammates:', sameMatch[0].c);

      const sameClubSeason = await sql`
        SELECT COUNT(DISTINCT pcs1.player_id) as c
        FROM player_club_season_stats pcs1
        JOIN player_club_season_stats pcs2 ON pcs2.season = pcs1.season AND pcs2.club_id = pcs1.club_id
        WHERE pcs2.player_id = ${pId} AND pcs1.player_id <> ${pId}
      `;
      console.log('Same club season teammates:', sameClubSeason[0].c);

      const sameClubOverlap = await sql`
        SELECT COUNT(DISTINCT pc1.player_id) as c
        FROM player_clubs pc1
        JOIN player_clubs pc2 ON pc2.club_id = pc1.club_id
        WHERE pc2.player_id = ${pId} AND pc1.player_id <> ${pId}
        AND pc1.first_season <= pc2.last_season AND pc1.last_season >= pc2.first_season
      `;
      console.log('Same club overlapping career teammates:', sameClubOverlap[0].c);

      const sameMatch30 = await sql`
        SELECT p.display_name, max(pms3.disposals) as max_disp
        FROM player_match_stats pms1
        JOIN player_match_stats pms2 ON pms2.match_id = pms1.match_id AND pms2.club_id = pms1.club_id
        JOIN player_match_stats pms3 ON pms3.player_id = pms1.player_id
        JOIN players p ON p.id = pms1.player_id
        WHERE pms2.player_id = ${pId} AND pms1.player_id <> ${pId}
        GROUP BY p.display_name
        HAVING max(pms3.disposals) >= 30
      `;
      console.log('Same match teammates with 30+ disposals count:', sameMatch30.length);

      const sameClubOverlap30 = await sql`
        SELECT p.display_name
        FROM player_clubs pc1
        JOIN player_clubs pc2 ON pc2.club_id = pc1.club_id
        JOIN players p ON p.id = pc1.player_id
        WHERE pc2.player_id = ${pId} AND pc1.player_id <> ${pId}
        AND pc1.first_season <= pc2.last_season AND pc1.last_season >= pc2.first_season
        AND EXISTS (SELECT 1 FROM player_match_stats pms3 WHERE pms3.player_id = pc1.player_id AND pms3.disposals >= 30)
        GROUP BY p.display_name
      `;
      console.log('Same club overlapping career teammates with 30+ disposals count:', sameClubOverlap30.length);

      const sameMatch2020 = await sql`
        SELECT count(DISTINCT pms1.player_id) as c
        FROM player_match_stats pms1
        JOIN player_match_stats pms2 ON pms2.match_id = pms1.match_id AND pms2.club_id = pms1.club_id
        JOIN player_season_stats pss ON pss.player_id = pms1.player_id
        WHERE pms2.player_id = ${pId} AND pms1.player_id <> ${pId}
        AND pss.season >= 2020
      `;
      console.log('Same match teammates + played in 2020s:', sameMatch2020[0].c);

      const sameClubOverlap2020 = await sql`
        SELECT count(DISTINCT pc1.player_id) as c
        FROM player_clubs pc1
        JOIN player_clubs pc2 ON pc2.club_id = pc1.club_id
        JOIN player_season_stats pss ON pss.player_id = pc1.player_id
        WHERE pc2.player_id = ${pId} AND pc1.player_id <> ${pId}
        AND pc1.first_season <= pc2.last_season AND pc1.last_season >= pc2.first_season
        AND pss.season >= 2020
      `;
      console.log('Same club overlapping career teammates + played in 2020s:', sameClubOverlap2020[0].c);
    }
  });
});
