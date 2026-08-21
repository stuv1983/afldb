import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const envStr = readFileSync(join(process.cwd(), '.env'), 'utf8');
for (const line of envStr.split('\n')) {
  if (line.trim().startsWith('DATABASE_URL=')) {
    process.env.DATABASE_URL = line.trim().substring('DATABASE_URL='.length);
  }
}
const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  const [essendon] = await sql`SELECT id, organization_id FROM clubs WHERE slug = 'essendon'`;
  const [archie] = await sql`SELECT id FROM players WHERE display_name = 'Archie Roberts'`;
  
  console.log(`Essendon org_id: ${essendon.organization_id}`);
  console.log(`Archie Roberts id: ${archie.id}`);

  // Base CTE for each row/col condition
  const rows = {
    '50 games or less': `p.id IN (SELECT player_id FROM player_career_stats WHERE games <= 50)`,
    'Archie Roberts teammate': `p.id IN (
      SELECT pcs1.player_id 
      FROM player_club_season_stats pcs1 
      JOIN player_club_season_stats pcs2 ON pcs1.season = pcs2.season AND pcs1.club_id = pcs2.club_id 
      WHERE pcs2.player_id = ${archie.id} AND pcs1.player_id != ${archie.id}
    )`,
    'Rising Star nomination': `p.id IN (
      SELECT an.player_id 
      FROM award_nominations an 
      JOIN awards a ON a.id = an.award_id 
      WHERE a.slug = 'rising-star' AND an.player_id IS NOT NULL AND an.link_status_value IN ('unique', 'resolved')
    )`
  };

  const cols = {
    'Essendon': `p.id IN (
      SELECT pc.player_id FROM player_clubs pc 
      JOIN clubs c ON pc.club_id = c.id 
      WHERE c.organization_id = ${essendon.organization_id}
    )`,
    '30+ disposals': `p.id IN (
      SELECT player_id FROM player_match_stats WHERE disposals >= 30
    )`,
    'Played in 2020s': `p.id IN (
      SELECT player_id FROM player_season_stats WHERE season BETWEEN 2020 AND 2029
    )`
  };

  for (const [rName, rSql] of Object.entries(rows)) {
    for (const [cName, cSql] of Object.entries(cols)) {
      const q = await sql.unsafe(`
        SELECT count(*) as c FROM players p 
        WHERE (${rSql}) AND (${cSql})
      `);
      
      const examples = await sql.unsafe(`
        SELECT p.display_name FROM players p 
        WHERE (${rSql}) AND (${cSql})
        LIMIT 3
      `);
      
      console.log(`Cell: [${rName}] x [${cName}]`);
      console.log(`  Count: ${q[0].c}`);
      console.log(`  Examples: ${examples.map(e => e.display_name).join(', ')}`);
      console.log('---');
    }
  }

  await sql.end();
}

run().catch(console.error);
