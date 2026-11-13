import postgres from 'postgres';
const base = new URL(process.env.AFLDB_TEST_DATABASE_URL);
for (const db of process.argv.slice(2)) {
  const u = new URL(base); u.pathname = `/${db}`;
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    const [r] = await sql`SELECT (SELECT max(name) FROM afldb_meta.schema_migrations) AS ledger, (SELECT count(*) FROM matches)::int AS matches, (SELECT count(*) FROM fixtures)::int AS fixtures, (SELECT count(*) FROM brownlow_correction_receipts)::int AS receipts`;
    console.log(db, JSON.stringify(r));
  } catch (e) { console.log(db, 'ERR', String(e.message).slice(0, 80)); }
  finally { await sql.end({ timeout: 2 }); }
}
