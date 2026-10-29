/** Explicit opt-in to the restricted-role probe; secret DSN stays inside the process. */
import { spawnSync } from 'node:child_process';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || !process.env.AFLDB_TEST_IMPORT_DATABASE_URL) {
  throw new Error('Run inside isolated-pg run; restricted role DSN is required');
}
const output = process.argv[2];
if (!output) throw new Error('New JSON report path required');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'tests/integration/import-role-match-lock.test.ts', '--reporter=json', `--outputFile=${output}`], {
  env: { ...process.env, AFLDB_ISSUE274_IMPORT_LOCK: '1',
    AFLDB_ISSUE274_IMPORT_LOCK_DSN: process.env.AFLDB_TEST_IMPORT_DATABASE_URL },
  stdio: 'inherit', shell: false,
});
process.exitCode = result.status ?? 1;
