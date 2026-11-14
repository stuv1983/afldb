/**
 * AFLDB-ISSUE-363: vitest globalSetup for per-file test databases (main process; configured in vitest.config.mts).
 *
 * Off (AFLDB_TEST_PER_FILE_DB unset / 0): does nothing and returns no teardown, so default runs are unchanged.
 * On: (1) refuses before any worker starts if the base DSN is not allowed (not `_test`, port 5432) or the mode value
 * is a typo; (2) creates a run ledger directory and exposes it to the workers as AFLDB_TEST_PER_FILE_LEDGER;
 * (3) at the end of the run (pass, fail or interrupt, but not SIGKILL) drops every database a worker created and did
 * not drop itself. A file whose tests are all skipped never runs its `afterAll`, which is why the worker-level drop
 * alone is not enough. Relative imports only.
 */
import { perFileModeOf, assertPerFileBaseAllowed, PER_FILE_DB_ENV } from './per-file-db-policy';
import { PER_FILE_LEDGER_ENV, createPerFileLedger, reapLedgerDatabases } from './per-file-db';

export default function setup(): (() => Promise<void>) | undefined {
  if (perFileModeOf(process.env[PER_FILE_DB_ENV]) === 'off') return undefined;
  const baseDsn = process.env.AFLDB_TEST_DATABASE_URL;
  assertPerFileBaseAllowed(baseDsn);
  const ledgerDir = createPerFileLedger();
  process.env[PER_FILE_LEDGER_ENV] = ledgerDir;
  return async () => {
    const result = await reapLedgerDatabases({ env: process.env, baseDsn: baseDsn as string, ledgerDir });
    for (const name of result.dropped) console.log(`per-file databases: reaped ${name} (its file did not run its teardown)`);
    for (const r of result.refused) console.error(`per-file databases: NOT dropped ${r.name}: ${r.reason}`);
  };
}
