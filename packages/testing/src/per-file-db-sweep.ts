/**
 * AFLDB-ISSUE-363: remove per-file test databases left by a crashed run.
 *
 *   isolated-pg run <base _test database> -- node --import tsx packages/testing/src/per-file-db-sweep.ts \
 *       [--max-age-minutes 360] [--dry-run]
 *
 * plus AFLDB_TEST_PER_FILE_ADMIN_USER / AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE as for per-file mode (see
 * ./per-file-db.ts). Drops only databases whose name is `<prefix><yyyymmddHHMMSS>_<pid>_<nonce>_test` for the
 * configured prefix (default afldb_v2_pf_), older than the age bound (at least 60 minutes), carrying the base's marker
 * comment, and never the base. Refuses the same base DSNs per-file mode refuses (not `_test`, port 5432).
 * Relative imports only, so it runs under plain `node --import tsx`.
 */
import { DEFAULT_SWEEP_AGE_MS } from './per-file-db-policy';
import { sweepStalePerFileDatabases } from './per-file-db';

async function main(argv: readonly string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const i = argv.indexOf('--max-age-minutes');
  const maxAgeMs = i >= 0 ? Number(argv[i + 1]) * 60_000 : DEFAULT_SWEEP_AGE_MS;
  const baseDsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!baseDsn) throw new Error('AFLDB_TEST_DATABASE_URL must name the base _test database.');
  const result = await sweepStalePerFileDatabases({ env: process.env, baseDsn, maxAgeMs, dryRun });
  for (const name of result.dropped) console.log(`${dryRun ? 'would drop' : 'dropped'}\t${name}`);
  for (const k of result.kept) console.log(`kept\t${k.name}\t${k.reason}`);
  console.log(`sweep: ${result.dropped.length} ${dryRun ? 'would be dropped' : 'dropped'}, ${result.kept.length} kept`);
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
