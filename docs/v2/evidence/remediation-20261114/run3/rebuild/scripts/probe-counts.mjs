// Read-only: exact row count of every public base table of the isolated database named by argv[2]. Prints sorted "table<TAB>count".
// Place temporarily in the checkout root (needs its node_modules/postgres); run via isolated-pg run <db> -- node .probe-counts.mjs <db>
import postgres from 'postgres';
const db = process.argv[2];
const u = new URL(process.env.AFLDB_TEST_DATABASE_URL); u.pathname = `/${db}`;
const sql = postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
try {
  await sql`SET default_transaction_read_only = on`;
  const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`;
  for (const { table_name } of t) {
    const [r] = await sql.unsafe(`SELECT count(*)::text AS n FROM public."${table_name}"`);
    console.log(`${table_name}\t${r.n}`);
  }
} finally { await sql.end({ timeout: 2 }); }
