
import { solveCellSummary } from './src/db/queries/grid-solver.js';
import { sql } from './src/db/client.js';

async function run() {
  // 1. Get IDs
  const [playerRow] = await sql`SELECT id FROM players WHERE display_name = 'Archie Roberts' LIMIT 1`;
  const [clubRow] = await sql`SELECT organization_id FROM clubs WHERE name = 'Essendon' LIMIT 1`;
  const [awardRow] = await sql`SELECT id FROM awards WHERE name ILIKE '%Rising Star%' LIMIT 1`;

  const archieId = String(playerRow.id);
  const essendonId = String(clubRow.organization_id);
  const risingStarId = String(awardRow.id);

  console.log('Archie ID:', archieId);
  console.log('Essendon Org ID:', essendonId);
  console.log('Rising Star ID:', risingStarId);

  const cols = [
    { builder: 'played_for_club', params: { club: essendonId } },
    { builder: 'single_game_stat_min', params: { stat: 'disposals', x: '30' } },
    { builder: 'played_in_decade', params: { decade: '2020' } },
  ];

  const rows = [
    { builder: 'career_games_max', params: { games: '50' } },
    { builder: 'teammate_of', params: { player: archieId } },
    { builder: 'award_winner', params: { award: risingStarId } }
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const summary = await solveCellSummary(rows[r] as any, cols[c] as any, 'games_desc');
      console.log(`Row ${r+1}, Col ${c+1}: ${summary?.eligible} eligible`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
