// Read-only probe of the rebuilt database. Run via: isolated-pg run <db> -- node probe-rebuilt.mjs <db>
import postgres from 'postgres';
const db = process.argv[2];
const base = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const u = new URL(base); u.pathname = `/${db}`;
const sql = postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
const out = {};
try {
  await sql`SET default_transaction_read_only = on`;
  const q = async (k, s) => { try { const [r] = await sql.unsafe(s); out[k] = r; } catch (e) { out[k] = 'ERR ' + String(e.message).slice(0, 100); } };
  await q('ledger', `SELECT max(name) AS head, count(*)::int AS applied FROM afldb_meta.schema_migrations`);
  await q('db', `SELECT current_database() AS db, pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database())::bigint::text AS bytes, shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname = current_database()`);
  await q('draft', `SELECT (SELECT count(*) FROM draft_picks)::int AS picks, (SELECT count(*) FROM draft_persons)::int AS persons, (SELECT min(id) FROM draft_picks)::int AS min_pick_id, (SELECT max(id) FROM draft_picks)::int AS max_pick_id, (SELECT count(*) FROM draft_picks WHERE id BETWEEN 6819 AND 6853)::int AS picks_6819_6853`);
  await q('core', `SELECT (SELECT count(*) FROM players)::int AS players, (SELECT count(*) FROM matches)::int AS matches, (SELECT count(*) FROM clubs)::int AS clubs, (SELECT count(*) FROM seasons)::int AS seasons, (SELECT max(year) FROM seasons)::int AS max_season`);
  await q('fixtures', `SELECT (SELECT count(*) FROM fixtures)::int AS fixtures`);
  await q('tables', `SELECT count(*)::int AS public_tables FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
} finally { await sql.end({ timeout: 2 }); }
console.log(JSON.stringify(out, null, 1));
