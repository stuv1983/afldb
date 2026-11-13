// read-only aggregate probe of the McGovern sibling pair on a disposable copy of the production snapshot
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1 });
const [db] = await sql`SELECT current_database() AS db, inet_server_port() AS port`;
console.log(JSON.stringify(db));
const [c] = await sql`SELECT count(*)::int AS pairs,
  count(*) FILTER (WHERE relationship = 'sibling' AND relationship_label IN ('brothers','twin brothers'))::int AS brother_rows,
  count(*) FILTER (WHERE source_record_id = 'siblings:afldb-sibling-supplement:015')::int AS mcgovern_rows
  FROM player_relationships WHERE relationship = 'sibling'`;
console.log(JSON.stringify(c));
const rows = await sql`SELECT person_a_player_id AS a, person_b_player_id AS b FROM player_relationships WHERE source_record_id = 'siblings:afldb-sibling-supplement:015'`;
console.log(JSON.stringify(rows));
const [n] = await sql`SELECT count(*)::int AS n FROM players p JOIN player_career_stats c ON c.player_id = p.id
  WHERE p.id IN (SELECT r.person_a_player_id FROM player_relationships r JOIN player_career_stats bc ON bc.player_id = r.person_b_player_id
     WHERE r.relationship = 'sibling' AND r.relationship_label IN ('brothers','twin brothers') AND r.person_a_player_id IS NOT NULL AND bc.games > 0
     UNION SELECT r.person_b_player_id FROM player_relationships r JOIN player_career_stats ac ON ac.player_id = r.person_a_player_id
     WHERE r.relationship = 'sibling' AND r.relationship_label IN ('brothers','twin brothers') AND r.person_b_player_id IS NOT NULL AND ac.games > 0)
  AND c.games > 0`;
console.log(JSON.stringify({ players_with_brother_games_gt0: n.n }));
await sql.end();
