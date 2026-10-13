/**
 * AFLDB-ISSUE-093 §H11 F1 — cross-platform runner for tools/maintenance/privileges.sql.
 *
 *     npm run db:privileges              # AFLDB_OWNER_DATABASE_URL
 *     npm run db:privileges:test         # AFLDB_TEST_DATABASE_URL
 *     npm run db:privileges:code-test    # AFLDB_CODE_TEST_DATABASE_URL (AFLDB-ISSUE-146)
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
 * No DSN or password is ever printed, on any path. AFLDB-ISSUE-313: nor is the password on
 * psql's command line. `-d` carries the password-free DSN and the password travels in the
 * child's PGPASSWORD (tools/db/psql.ts `psqlConnection`, shared with every other psql caller).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PSQL_BIN, PsqlCredentialRefused, psqlConnection, redact, type EnvLike } from './psql';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIVILEGES_SQL = join('tools', 'maintenance', 'privileges.sql');

/** Every target is named explicitly, mirroring tools/db/migrate.ts. */
const TARGETS = {
  dev: 'AFLDB_OWNER_DATABASE_URL',
  test: 'AFLDB_TEST_DATABASE_URL',
  'code-test': 'AFLDB_CODE_TEST_DATABASE_URL',
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

/** What `main` needs from `spawnSync`; a test supplies a capturing fake. */
export type PrivilegesSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => { status: number | null; error?: Error };

export function main(
  args: readonly string[] = process.argv,
  env: EnvLike = process.env,
  spawn: PrivilegesSpawn = spawnSync as PrivilegesSpawn,
): number {
  const index = args.indexOf('--target');
  if (index !== -1 && !args[index + 1]) {
    console.error('ERROR: --target needs a target name.'
      + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`);
    return 1;
  }
  const requested = index === -1 ? 'dev' : args[index + 1];

  if (!Object.hasOwn(TARGETS, requested)) {
    console.error(
      `ERROR: unknown privileges target '${requested}'.`
      + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`);
    return 1;
  }

  const variable = TARGETS[requested as Target];
  const dsn = env[variable];
  if (!dsn) {
    console.error(`ERROR: ${variable} is not set (target '${requested}').`);
    return 1;
  }

  // The password never rides in argv (ISSUE-313): `-d` gets the password-free DSN and the
  // password goes to the child as PGPASSWORD. A DSN whose password cannot be moved without
  // guessing is refused here, before psql is launched.
  let connection: ReturnType<typeof psqlConnection>;
  try {
    connection = psqlConnection(dsn, env);
  } catch (error) {
    if (!(error instanceof PsqlCredentialRefused)) throw error;
    console.error(`ERROR: ${variable}: ${error.message}`);
    return 1;
  }

  // Options first, DSN via -d and never as a positional operand: PostgreSQL's own
  // non-permuting getopt_long stops at the first non-option argument (see tools/db/psql.ts).
  const argv = ['-v', 'ON_ERROR_STOP=1', '-f', PRIVILEGES_SQL, '-d', connection.dsn];

  const result = spawn(PSQL_BIN, argv, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    env: connection.env,
  });

  if (result.error) {
    console.error(
      `ERROR: could not run '${PSQL_BIN}': ${redact(result.error.message)}.`
      + '\n       It must be on PATH. Nothing has been executed.');
    return 1;
  }
  return result.status ?? 1;
}

// Entry point. Importing this module RUNS the privileges script, exactly as it did before
// ISSUE-313 — except when AFLDB_PRIVILEGES_NO_AUTORUN is exactly '1', which the DB-free test
// sets for the duration of its import so it can exercise `main` with a fake spawn.
//
// The guard is fail-open and cannot make a direct run skip its work silently: the opt-out is a
// single purpose-named variable (not a generic one such as VITEST, which a vitest worker hands
// to every child it spawns), and if it is set on a DIRECT run of this file the run refuses
// with a non-zero exit instead of exiting 0 having done nothing.
const NO_AUTORUN = 'AFLDB_PRIVILEGES_NO_AUTORUN';
if (process.env[NO_AUTORUN] !== '1') {
  loadEnv();
  process.exit(main());
} else if (/[\\/]privileges\.ts$/.test(process.argv[1] ?? '')) {
  console.error(`ERROR: ${NO_AUTORUN}=1 is set, but this is a direct run of tools/db/privileges.ts. `
    + 'Refusing to skip the privileges work silently; unset it. Nothing has been executed.');
  process.exit(1);
}
