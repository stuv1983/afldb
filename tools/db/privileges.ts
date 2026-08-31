/**
 * AFLDB-ISSUE-093 §H11 F1 — cross-platform runner for tools/maintenance/privileges.sql.
 *
 *     npm run db:privileges              # AFLDB_OWNER_DATABASE_URL
 *     npm run db:privileges:test         # AFLDB_TEST_DATABASE_URL
 *
 * This exists for ONE reason: the package scripts used to interpolate the DSN with a
 * POSIX shell expansion —
 *
 *     psql -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql -d "$AFLDB_TEST_DATABASE_URL"
 *
 * — and npm on Windows runs package scripts under cmd.exe, which does not expand `$VAR`.
 * psql was handed the LITERAL string `$AFLDB_TEST_DATABASE_URL` as a database name. It
 * failed, so nothing was ever silently mis-targeted, but the PRIVILEGES stage of
 * `npm run db:test:rebuild` could not run at all — two stages after the destructive reset
 * had already emptied the database.
 *
 * The psql invocation is otherwise UNCHANGED: same binary, same flags, same SQL file, same
 * exit status. The DSN is read in Node and passed as an argument, so no shell is involved in
 * resolving it. Nothing here alters privileges.sql's transactional semantics — it is still
 * run with `-f <file>` under ON_ERROR_STOP, exactly as before, and this file deliberately
 * does NOT route through tools/db/psql.ts's `runPsql`, whose `--single-transaction -f -`
 * envelope belongs to the destructive reset and would change how privileges.sql executes.
 *
 * No DSN or password is ever printed, on any path.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PSQL_BIN, redact } from './psql';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIVILEGES_SQL = join('tools', 'maintenance', 'privileges.sql');

/** Every target is named explicitly, mirroring tools/db/migrate.ts. */
const TARGETS = {
  dev: 'AFLDB_OWNER_DATABASE_URL',
  test: 'AFLDB_TEST_DATABASE_URL',
} as const;

type Target = keyof typeof TARGETS;

/** .env without a dotenv dependency, as migrate.ts and rebuild-test.ts do. */
function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return; // Absent in CI; variables are expected to be set already.
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function main(): number {
  loadEnv();

  const index = process.argv.indexOf('--target');
  if (index !== -1 && !process.argv[index + 1]) {
    console.error('ERROR: --target needs a target name.'
      + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`);
    return 1;
  }
  const requested = index === -1 ? 'dev' : process.argv[index + 1];

  if (!Object.hasOwn(TARGETS, requested)) {
    console.error(
      `ERROR: unknown privileges target '${requested}'.`
      + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`);
    return 1;
  }

  const variable = TARGETS[requested as Target];
  const dsn = process.env[variable];
  if (!dsn) {
    console.error(`ERROR: ${variable} is not set (target '${requested}').`);
    return 1;
  }

  // Options first, DSN via -d and never as a positional operand: PostgreSQL's own
  // non-permuting getopt_long stops at the first non-option argument (see tools/db/psql.ts).
  const argv = ['-v', 'ON_ERROR_STOP=1', '-f', PRIVILEGES_SQL, '-d', dsn];

  const result = spawnSync(PSQL_BIN, argv, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(
      `ERROR: could not run '${PSQL_BIN}': ${redact(result.error.message)}.`
      + '\n       It must be on PATH. Nothing has been executed.');
    return 1;
  }
  return result.status ?? 1;
}

process.exit(main());
