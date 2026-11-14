import postgres from 'postgres';
const db = process.argv[2];
const u = new URL(process.env.AFLDB_TEST_DATABASE_URL); u.pathname = `/${db}`;
const sql = postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
try {
  await sql`SET default_transaction_read_only = on`;
  const rows = await sql.unsafe(`SELECT p.id::int AS id, p.display_name, 
      (SELECT string_agg(s.key || ':' || coalesce(ei.match_method,'-') || ':' || ei.status::text, ', ') FROM external_identities ei JOIN sources s ON s.id=ei.source_id WHERE ei.player_id=p.id) AS identities,
      (SELECT count(*)::int FROM player_match_stats pms WHERE pms.player_id=p.id) AS match_rows,
      (SELECT count(*)::int FROM draft_persons dp WHERE dp.player_id=p.id) AS draft_persons
    FROM players p WHERE NOT EXISTS (SELECT 1 FROM external_identities ei JOIN sources s ON s.id=ei.source_id WHERE s.key='afltables' AND ei.player_id=p.id) ORDER BY p.id`);
  console.log(JSON.stringify(rows, null, 1));
} finally { await sql.end({ timeout: 2 }); }
