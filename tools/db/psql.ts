/**
 * AFLDB-ISSUE-093 §20 — the ONE psql execution path.
 *
 * The clean rebuild's destructive DATABASE RESET and the rollback-only proof of that same
 * reset both run their SQL through this module, with the SAME binary, the SAME argument
 * vector and the SAME error handling. That is the whole point of the file: a proof that
 * exercised a different execution mechanism from the real reset would prove the SQL and
 * leave the mechanism untested, which is exactly the gap this stage exists to close.
 *
 * The two callers differ in ONE respect, and it is the safety-relevant one:
 *
 *   real reset  — the SQL stream ends normally, so psql's --single-transaction COMMITs.
 *   proof       — the SQL stream always ends in RAISE EXCEPTION, so the transaction is
 *                 already ABORTED when psql reaches the end. COMMIT is unreachable.
 *
 * Nothing here ever prints a DSN or a password. psql's own diagnostics name relations,
 * roles and hosts, never the connection string it was handed.
 */

/** The executable. Not a path: the repository already relies on psql being on PATH. */
export const PSQL_BIN = 'psql';

/**
 * The argument vector, built in one place so the two callers cannot drift apart.
 *
 *   -d <dsn>             the target, as an OPTION and never as a positional operand.
 *   ON_ERROR_STOP=1      any SQL error is a non-zero exit, not a warning on stdout.
 *   --single-transaction the whole stream is one transaction: the real reset is
 *                        all-or-nothing, and the proof's abort discards everything.
 *   -q                   suppress command tags; errors and RAISE output are unaffected.
 *   -f -                 read the stream from stdin, so no SQL is ever written to disk.
 *
 * `-d <dsn>` rather than the bare `psql <dsn> …` this repository uses elsewhere, and that
 * is not cosmetic. psql's usage is `psql [OPTION]... [DBNAME [USERNAME]]`, and psql does
 * NOT always use GNU getopt: `src/port/getopt_long.c`, which PostgreSQL builds on Windows
 * and anywhere the system getopt_long is missing, **stops at the first non-option argument
 * and does not permute**. With the DSN leading, every flag after it can then be consumed as
 * an operand instead of an option — silently, because psql only warns about extras. A psql
 * that ignored `--single-transaction` and `ON_ERROR_STOP=1` would autocommit each statement
 * and still exit 0, which is exactly the shape of the 2026-08-27 incident (§20.12). With no
 * positional operand at all there is nothing for a non-permuting getopt to stop at.
 */
export function psqlArgv(dsn: string): string[] {
  return ['-d', dsn, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', '-'];
}

/**
 * Strip anything that looks like a connection string out of text before it is printed.
 * psql's own diagnostics name relations, roles and hosts rather than the DSN, but a
 * "psql said:" relay must not depend on that being true of every future message.
 */
export function redact(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*/gi, '<redacted-dsn>')
    .replace(/\b(password|PGPASSWORD)\s*=\s*\S+/gi, '$1=<redacted>');
}

/** psql could not be launched at all — missing binary, permissions, spawn failure. */
export class PsqlUnavailable extends Error {}

export type PsqlResult = { status: number; stdout: string; stderr: string };

export type SpawnSyncLike = (
  command: string,
  args: string[],
  options: { input: string; encoding: 'utf8'; cwd?: string },
) => { status: number | null; stdout: string | null; stderr: string | null; error?: Error };

export type PsqlDeps = { spawn: SpawnSyncLike; cwd?: string };

/**
 * Run one SQL stream through psql. Returns the exit status rather than throwing on a SQL
 * error, because BOTH outcomes are meaningful: the rebuild treats non-zero as a failed
 * reset, and the proof REQUIRES non-zero (its stream always aborts deliberately).
 *
 * Throws only when psql itself could not run.
 */
export function runPsql(dsn: string, sql: string, deps: PsqlDeps): PsqlResult {
  const result = deps.spawn(PSQL_BIN, psqlArgv(dsn), {
    input: sql, encoding: 'utf8', cwd: deps.cwd,
  });
  if (result.error) {
    throw new PsqlUnavailable(
      `Could not run '${PSQL_BIN}': ${result.error.message}. It must be on PATH — the same `
      + 'dependency `npm run db:privileges:test` and tools/maintenance/restore-test.sh '
      + 'already have. Nothing has been executed.');
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * The probe. It proves THREE things about the execution path, and every one of them was
 * assumed rather than proven by the first live attempt on 2026-08-27:
 *
 *   1. psql launches                      — spawnSync returns no `error`;
 *   2. psql RECEIVES THE STREAM ON STDIN  — the OK token comes back;
 *   3. a SQL error becomes a NON-ZERO EXIT — the abort token comes back with status != 0.
 *
 * (2) and (3) are the point. The earlier probe ran `SELECT 1` and accepted exit 0 — but an
 * EMPTY or undelivered stdin also exits 0, and so does an errored script when
 * ON_ERROR_STOP is not in force. The probe therefore could not distinguish a working path
 * from a path that silently discards the SQL, which is exactly the ambiguity that made the
 * first live proof unexplainable. It now deliberately fails, and demands proof of the
 * failure. Nothing it does touches a single application object.
 */
export const PSQL_PROBE_OK = 'AFLDB-PSQL-PROBE-STDIN-OK';
export const PSQL_PROBE_ABORT = 'AFLDB-PSQL-PROBE-ABORT';

export const PSQL_PROBE_SQL = `DO $afldb_probe$ BEGIN
  RAISE WARNING '${PSQL_PROBE_OK}';
END $afldb_probe$;
DO $afldb_probe$ BEGIN
  RAISE EXCEPTION '${PSQL_PROBE_ABORT}';
END $afldb_probe$;
`;

export function assertPsqlReachable(dsn: string, deps: PsqlDeps): void {
  const result = runPsql(dsn, PSQL_PROBE_SQL, deps);   // throws PsqlUnavailable if missing
  const output = `${result.stdout}\n${result.stderr}`;

  if (!output.includes(PSQL_PROBE_OK)) {
    throw new PsqlUnavailable(
      `psql launched (exit ${result.status}) but did NOT execute the SQL supplied on its `
      + 'stdin: the probe token never came back. The reset stream would be silently '
      + 'discarded the same way. Check that this psql is a real client and not a wrapper '
      + 'that drops stdin, and that `-f -` is reaching it.\n'
      + `psql said: ${redact(output.trim()) || '(nothing at all)'}`);
  }
  if (result.status === 0) {
    throw new PsqlUnavailable(
      'psql executed the stream but returned exit 0 for a script that deliberately raised '
      + 'an exception, so ON_ERROR_STOP is not in force on this path. A failed reset would '
      + `be reported as a success.\npsql said: ${redact(output.trim())}`);
  }
  if (!output.includes(PSQL_PROBE_ABORT)) {
    throw new PsqlUnavailable(
      `psql exited ${result.status} but never reported the probe's deliberate error, so `
      + 'PostgreSQL diagnostics are not reaching this process.\n'
      + `psql said: ${redact(output.trim())}`);
  }
}

export default { PSQL_BIN, psqlArgv, runPsql, assertPsqlReachable, redact };
