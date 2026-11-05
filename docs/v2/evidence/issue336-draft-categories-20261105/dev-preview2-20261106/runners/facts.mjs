// READ-ONLY facts on an isolated restore (DEV copy or production copy). Usage (via isolated-pg run <db> --): node .facts.mjs <label>
import postgres from 'postgres';

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('isolated launcher required');
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
if (url.hostname !== '127.0.0.1' || !/^\/afldb_v2_.+_test$/.test(url.pathname)) throw new Error('isolated target required');
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const NBSP = ' ';
const out = { label: process.argv[2], database: url.pathname.slice(1) };
const q = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = `unavailable: ${e.code ?? ''} ${e.message}`; } };
try {
  await sql`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;
  await q('ledger', async () => (await sql`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations`)[0]);
  await q('siteSettings', () => sql`SELECT key, value::text AS value FROM site_settings WHERE key LIKE 'acquisition.%' ORDER BY key`);
  await q('draft', async () => (await sql`
    SELECT count(*)::int AS picks,
           count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
           count(*) FILTER (WHERE strpos(player_name_raw, ${NBSP}) > 0)::int AS raw_with_nbsp,
           count(*) FILTER (WHERE player_id IS NULL AND strpos(player_name_raw, ${NBSP}) > 0)::int AS unlinked_raw_with_nbsp
      FROM draft_picks`)[0]);
  await q('playersDisplayNbsp', async () => (await sql`SELECT count(*)::int AS n FROM players WHERE strpos(display_name, ${NBSP}) > 0`)[0].n);
  await q('jakeLong2014', () => sql`
    SELECT dp.draft_kind AS kind, dp.pick_number AS pick, dp.player_id IS NOT NULL AS linked,
           encode(convert_to(dp.player_name_raw, 'UTF8'), 'hex') AS raw_hex
      FROM draft_picks dp WHERE dp.draft_year = 2014 AND translate(dp.player_name_raw, ${NBSP}, ' ') ILIKE 'Jake Long'`);
  await q('activeMatchOverrides', async () => (await sql`
    SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'matches' AND is_active`)[0].n);
  await q('matchesBySeason', () => sql`SELECT season, count(*)::int AS n FROM matches WHERE season >= 2025 GROUP BY season ORDER BY season`);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await sql.end();
}
