// Read-only facts about the launcher-proved isolated preview database. Usage (via isolated-pg run <db> --): node .prev-ledger.mjs <label>
import postgres from 'postgres';

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('isolated launcher required');
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
if (url.hostname !== '127.0.0.1' || !/^\/afldb_v2_.+_test$/.test(url.pathname)) throw new Error('isolated target required');
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await sql`SET TRANSACTION READ ONLY`.catch(() => {});
  const [ledger] = await sql`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations`;
  const recent = await sql`SELECT name, left(checksum, 12) AS checksum, duration_ms FROM afldb_meta.schema_migrations WHERE name >= '110' ORDER BY name`;
  const [s] = await sql`
    SELECT to_regclass('public.award_proposals') IS NOT NULL AS award_proposals,
           to_regclass('public.award_proposal_decisions') IS NOT NULL AS award_proposal_decisions,
           to_regclass('public.derived_award_results') IS NOT NULL AS derived_award_results,
           to_regclass('public.brownlow_eligibility_decisions') IS NOT NULL AS brownlow_eligibility_decisions,
           to_regclass('public.derived_award_projections') IS NOT NULL AS derived_award_projections,
           to_regclass('public.brownlow_correction_receipts') IS NOT NULL AS brownlow_correction_receipts,
           to_regclass('public.ix_afl_api_identity_adjudications_supersedes_id') IS NOT NULL AS ix_115,
           (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'staging' AND table_name = 'afl_api_brownlow_vote' AND column_name = 'eligible') AS staging_eligible_nullable,
           (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'fixtures' AND column_name IN ('confirmation', 'home_placeholder', 'away_placeholder')) AS fixtures_new_columns`;
  const [d] = await sql`
    SELECT (SELECT count(*)::int FROM draft_picks) AS draft_picks,
           (SELECT count(*)::int FROM draft_picks WHERE draft_year = 2021) AS y2021,
           (SELECT count(*)::int FROM draft_picks WHERE draft_year = 2025) AS y2025,
           (SELECT count(*)::int FROM draft_picks WHERE draft_year = 2025 AND draft_kind = 'rookie') AS y2025_rookie,
           (SELECT count(*)::int FROM draft_picks dp LEFT JOIN sources so ON so.id = dp.source_id WHERE so.key IS DISTINCT FROM 'draftguru') AS non_draftguru,
           (SELECT count(*)::int FROM draft_picks WHERE signing_kind = 'Intl Schol') AS intl_schol,
           (SELECT count(*)::int FROM fixtures) AS fixtures,
           (SELECT count(*)::int FROM fixtures WHERE confirmation <> 'confirmed') AS fixtures_unconfirmed`.catch(async () => {
    const [x] = await sql`SELECT (SELECT count(*)::int FROM draft_picks) AS draft_picks, (SELECT count(*)::int FROM draft_picks WHERE draft_year = 2021) AS y2021,
      (SELECT count(*)::int FROM draft_picks WHERE draft_year = 2025) AS y2025, (SELECT count(*)::int FROM draft_picks dp LEFT JOIN sources so ON so.id = dp.source_id WHERE so.key IS DISTINCT FROM 'draftguru') AS non_draftguru`;
    return [x];
  });
  console.log(JSON.stringify({ label: process.argv[2], ledger, recent, schema: s, draft: d }));
} finally {
  await sql.end();
}
