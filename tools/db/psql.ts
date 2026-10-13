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
 *
 * AFLDB-ISSUE-313: nor does the password ever reach psql's ARGUMENT VECTOR. argv is readable
 * by every local user (`ps`, `/proc/<pid>/cmdline`) for the whole life of the child, so
 * `psqlConnection` splits a URI DSN into a password-free `-d` value and a child environment
 * carrying `PGPASSWORD` (readable only by the process owner). Every psql this repository
 * launches from TypeScript takes its connection from that one function.
 */

/** The executable. Not a path: the repository already relies on psql being on PATH. */
export const PSQL_BIN = 'psql';

/** psql could not be launched at all — missing binary, permissions, spawn failure. */
export class PsqlUnavailable extends Error {}

/**
 * A connection string that cannot be handed to psql without leaving its password on the
 * command line, or whose password cannot be moved off it WITHOUT guessing what libpq would
 * have done. A refusal, never a fallback: the alternative is a silently different connection
 * or a leaked credential. Messages name the problem, never the DSN or any part of it.
 *
 * A subclass of PsqlUnavailable so the callers that already fail closed on "psql cannot be
 * used" (the reset proof) fail closed on this too, before anything is executed.
 */
export class PsqlCredentialRefused extends PsqlUnavailable {}

/** Any string-keyed environment; `NodeJS.ProcessEnv` is stricter than a test fixture needs. */
export type EnvLike = Record<string, string | undefined>;

export type PsqlConnection = {
  /** The `-d` value. Carries no password; safe to appear in argv and in error text. */
  dsn: string;
  /**
   * The child process environment: a COPY of the parent's, plus `PGPASSWORD` when the DSN
   * carried a password. The parent's own environment is never modified. NEVER log this.
   */
  env: NodeJS.ProcessEnv;
};

const URI_SCHEME = /^postgres(?:ql)?:\/\//;   // libpq's own test: exactly these two, lower case

function refuse(reason: string): never {
  throw new PsqlCredentialRefused(
    `Refusing to hand this connection string to psql: ${reason}. The password cannot be moved `
    + 'off the psql command line without guessing what libpq would do with it. Use a postgres '
    + 'URL with the password in its user:password userinfo (the form .env.example documents) and '
    + 'no other password source, or put the credential in PGPASSWORD / a .pgpass file yourself. '
    + 'Nothing has been executed.');
}

function decodeSecret(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return refuse('the password is not valid percent-encoded UTF-8');
  }
  // An environment value cannot hold NUL, and Node's error for one would quote the value.
  if (decoded.includes('\0')) return refuse('the password contains a NUL character');
  return decoded;
}

function decodeKeyword(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;   // libpq refuses an undecodable keyword outright; it cannot be `password`
  }
}

/**
 * Split a DSN into what may appear on a command line and the password that may not.
 *
 * The rule that keeps this from guessing at libpq: a password SOURCE is the userinfo's text
 * after ':' and every `password` query parameter. If no source holds any text there is no
 * secret, and the string is returned untouched. If exactly ONE source holds text and it is the
 * only source, that text moves to the environment and its source is cut out. Anything else —
 * two sources, a source beside an empty one, a secret that libpq would not parse the way this
 * code does — is refused, because resolving it would need libpq's precedence and empty-value
 * rules, which are not assumed here.
 *
 *   userinfo      `postgres://user:PASSWORD@host/db` — located as libpq locates it (the first
 *                 '@' before the first '/'), percent-decoded.
 *   query         `?password=PASSWORD` — the keyword is percent-decoded before it is compared
 *                 (`pass%77ord` is `password`); `&` separates parameters.
 *   sslpassword   a secret with no environment variable to carry it: refused.
 *   key=value     `host=h password=…` — not parsed. Refused if it names a password keyword,
 *                 passed through untouched otherwise (a bare database name, say).
 *
 * Everything else in the string — scheme, user, host list, port, database, every other
 * parameter, its spelling and its order — is returned byte for byte.
 */
function splitDsn(dsn: string): { safe: string; password: string | undefined } {
  const scheme = URI_SCHEME.exec(dsn);
  if (!scheme) {
    if (/(?:^|\s)(?:ssl)?password\s*=/i.test(dsn)) {
      refuse('a key=value connection string names a password keyword');
    }
    return { safe: dsn, password: undefined };
  }

  const body = dsn.slice(scheme[0].length);

  // userspec: '@' before the first '/' ends it, and the user ends at the first ':' or '@'.
  let at = 0;
  while (at < body.length && body[at] !== '@' && body[at] !== '/') at += 1;
  const hasUserspec = body[at] === '@';
  const userspec = hasUserspec ? body.slice(0, at) : '';
  const colon = userspec.indexOf(':');
  const userinfoRaw = colon === -1 ? undefined : userspec.slice(colon + 1);
  const afterUserspec = hasUserspec ? at + 1 : 0;
  const rest = body.slice(afterUserspec);

  const mark = rest.indexOf('?');
  const elements = mark === -1 ? [] : rest.slice(mark + 1).split('&');
  const queryRaw = new Map<number, string>();          // element index -> raw (still encoded) value
  elements.forEach((element, index) => {
    const eq = element.indexOf('=');
    const keyword = decodeKeyword(eq === -1 ? element : element.slice(0, eq));
    if (keyword === 'sslpassword') {
      refuse('it carries an sslpassword parameter, which has no environment-variable equivalent');
    }
    if (keyword === 'password') queryRaw.set(index, eq === -1 ? '' : element.slice(eq + 1));
  });

  const sources = [...(userinfoRaw === undefined ? [] : [userinfoRaw]), ...queryRaw.values()];
  if (!sources.some((text) => text !== '')) return { safe: dsn, password: undefined };
  if (sources.length > 1) refuse('it has more than one password source');

  if (userinfoRaw) {
    // Cut ":PASSWORD" out of the userinfo; keep the user, the '@' and everything after.
    return {
      safe: scheme[0] + userspec.slice(0, colon) + body.slice(at),
      password: decodeSecret(userinfoRaw),
    };
  }
  const [[index, raw]] = [...queryRaw];
  if (raw.includes('=')) refuse('a password query parameter is malformed');
  const kept = elements.filter((_, i) => i !== index);
  return {
    safe: scheme[0] + body.slice(0, afterUserspec) + rest.slice(0, mark)
      + (kept.length ? `?${kept.join('&')}` : ''),
    password: decodeSecret(raw),
  };
}

/**
 * The connection psql is launched with: a password-free `-d` value and the environment that
 * carries the password instead. `parentEnv` is copied, never modified; when the DSN carries
 * no password the child's environment is the parent's (so an ambient PGPASSWORD / PGPASSFILE
 * keeps working exactly as it did when the DSN went straight to psql).
 */
export function psqlConnection(
  dsn: string,
  parentEnv: EnvLike = process.env,
): PsqlConnection {
  const { safe, password } = splitDsn(dsn);
  const env = { ...parentEnv } as NodeJS.ProcessEnv;
  if (password !== undefined) {
    // Windows environment names are case-insensitive; a copy of process.env is a plain
    // object, so a differently-cased parent PGPASSWORD would otherwise sit beside ours.
    if (process.platform === 'win32') {
      for (const name of Object.keys(env)) if (name.toUpperCase() === 'PGPASSWORD') delete env[name];
    }
    env.PGPASSWORD = password;
  }
  return { dsn: safe, env };
}

/**
 * The argument vector, built in one place so the two callers cannot drift apart.
 *
 *   -d <dsn>             the target, as an OPTION and never as a positional operand. The value
 *                        is the PASSWORD-FREE form (ISSUE-313): the password travels in the
 *                        child environment from `psqlConnection`, never in this vector.
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
  return ['-d', psqlConnection(dsn).dsn, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', '-'];
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

export type PsqlResult = { status: number; stdout: string; stderr: string };

export type SpawnSyncLike = (
  command: string,
  args: string[],
  options: { input: string; encoding: 'utf8'; cwd?: string; env?: NodeJS.ProcessEnv },
) => { status: number | null; stdout: string | null; stderr: string | null; error?: Error };

export type PsqlDeps = { spawn: SpawnSyncLike; cwd?: string };

/**
 * Run one SQL stream through psql. Returns the exit status rather than throwing on a SQL
 * error, because BOTH outcomes are meaningful: the rebuild treats non-zero as a failed
 * reset, and the proof REQUIRES non-zero (its stream always aborts deliberately).
 *
 * Throws only when psql itself could not run — or, before anything is spawned, when the DSN's
 * password cannot be moved off the command line (PsqlCredentialRefused).
 */
export function runPsql(dsn: string, sql: string, deps: PsqlDeps): PsqlResult {
  const connection = psqlConnection(dsn);
  const result = deps.spawn(PSQL_BIN, psqlArgv(dsn), {
    input: sql, encoding: 'utf8', cwd: deps.cwd, env: connection.env,
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

export default { PSQL_BIN, psqlArgv, psqlConnection, runPsql, assertPsqlReachable, redact };
