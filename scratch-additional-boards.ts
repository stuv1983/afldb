import { solveCellSummary } from './src/db/queries/grid-solver.js';
import { sql } from './src/db/client.js';

async function run() {
  const [universityRow] = await sql`SELECT organization_id FROM clubs WHERE name = 'University' LIMIT 1`;
  const [gwsRow] = await sql`SELECT organization_id FROM clubs WHERE name = 'Greater Western Sydney' LIMIT 1`;
  
  const universityId = String(universityRow.organization_id);
  const gwsId = String(gwsRow.organization_id);

  console.log('University Org ID:', universityId);
  console.log('GWS Org ID:', gwsId);

  // Broad intersection: Played in 2010s x 100+ career games
  console.log('\n--- Broad Intersection ---');
  let sum = await solveCellSummary(
    { builder: 'played_in_decade', params: { decade: '2010' } } as any,
    { builder: 'career_games_min', params: { games: '100' } } as any,
    'games_desc'
  );
  console.log(`Played in 2010s x 100+ career games: ${sum?.eligible} eligible`);

  // Narrow intersection: University x Played in 2010s (should be 0)
  console.log('\n--- Narrow / Impossible Intersection ---');
  sum = await solveCellSummary(
    { builder: 'played_for_club', params: { club: universityId } } as any,
    { builder: 'played_in_decade', params: { decade: '2010' } } as any,
    'games_desc'
  );
  console.log(`University x Played in 2010s: ${sum?.eligible} eligible`);

  // Historical stats: 30+ disposals x Played in 1900s
  console.log('\n--- Historical Stats (Disposals in 1900s - missing data) ---');
  sum = await solveCellSummary(
    { builder: 'single_game_stat_min', params: { stat: 'disposals', x: '30' } } as any,
    { builder: 'played_in_decade', params: { decade: '1900' } } as any,
    'games_desc'
  );
  console.log(`30+ disposals in a game x Played in 1900s: ${sum?.eligible} eligible`);

  // Null data test: never played in a draw x GWS
  console.log('\n--- Draw test ---');
  sum = await solveCellSummary(
    { builder: 'never_played_in_draw', params: {} } as any,
    { builder: 'played_for_club', params: { club: gwsId } } as any,
    'games_desc'
  );
  console.log(`Never played in a draw x GWS: ${sum?.eligible} eligible`);

  process.exit(0);
}

run().catch(console.error);
