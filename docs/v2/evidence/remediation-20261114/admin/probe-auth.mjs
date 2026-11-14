import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
console.log(JSON.stringify(await sql`SELECT entity_type, is_active, count(*)::int AS n, min(substr(entity_key,1,40)) AS sample FROM data_overrides WHERE entity_type = 'player_match_stats' GROUP BY 1,2`));
await sql.end({ timeout: 2 });
