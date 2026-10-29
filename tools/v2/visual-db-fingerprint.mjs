/**
 * Read-only fingerprint of the tables a visual-state run can touch, for proving a database was NOT changed
 * (the source clone and template are compared before and after a run). Invoke through isolated-pg run:
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run <db> -- node tools/v2/visual-db-fingerprint.mjs
 *
 * Prints one `table rows md5` line per table and a combined digest. Opens one READ ONLY transaction.
 */
import { createHash } from 'node:crypto';
import postgres from 'postgres';

if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated runner required');
export const FINGERPRINT_TABLES = ['award_proposals', 'award_proposal_decisions', 'award_winners', 'derived_award_results',
  'derived_award_projections', 'brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
  'data_edits', 'data_issues', 'data_submissions', 'data_submission_rows', 'matches', 'player_match_stats',
  'match_period_scores', 'players', 'external_identities', 'import_batches', 'canonical_applications',
  'promotion_candidates', 'import_rejections', 'site_settings', 'auth_users', 'staging.source_records',
  'staging.source_record_versions', 'staging.afl_api_match', 'staging.afl_api_brownlow_vote'];
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
try {
  const lines = await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [db] = await tx`SELECT current_database() AS name`;
    const out = [`database ${db.name}`];
    for (const table of FINGERPRINT_TABLES) {
      const [row] = await tx.unsafe(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM ${table} t`);
      out.push(`${table} ${row.rows} ${row.digest}`);
    }
    return out;
  });
  const combined = createHash('sha256').update(lines.slice(1).join('\n')).digest('hex');
  console.log(`${lines.join('\n')}\ncombined ${combined}`);
} finally {
  await sql.end({ timeout: 5 });
}
