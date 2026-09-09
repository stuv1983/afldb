/**
 * AFLDB-ISSUE-152 — read-only SQL evidence over the repository's own PostgreSQL
 * runtime, for a workstation with no psql.
 *
 *     tsx tools/issue-152/phase-d-evidence.ts <script.sql> [--dry-run]
 *
 * Driven by tools/issue-152/phase-d-evidence.ps1, which derives the DSN from
 * .env, proves the SSH forward is up, and captures this process's stdout as the
 * UTF-8 transcript. Run it through that entry point; the two halves are one
 * tool.
 *
 * WHY THIS EXISTS AT ALL. Phase D's first evidence pass was executed against
 * afldb_dev by accident. Every D0.1–D4.4 number in it is plausible and none of
 * it is admissible: afldb_dev lags the canonical rebuild. Nothing in that run
 * announced the wrong target. So the target is proven here, not trusted — and
 * proven on the connection that runs the evidence, because a guard on a
 * different connection proves nothing about this one.
 *
 * THE SAME-SESSION GUARANTEE, which is the whole contract:
 *
 *   * `max: 1` plus `sql.reserve()` — one physical connection, held for the
 *     whole run and released at the end. No pool can hand a later statement to
 *     a different backend.
 *   * `pg_backend_pid()` is read BEFORE the first evidence statement and again
 *     AFTER the last one, and both must match.
 *   * every single result is checked against that pid as it arrives.
 *     postgres.js records the BackendKeyData of the connection that ran each
 *     query (`result.state.pid`), so a silent reconnect mid-run is caught at the
 *     statement it happened on, not inferred afterwards.
 *   * `current_database()` is asserted in JS *and* by a server-side DO block
 *     that RAISEs. The DO block is what makes the refusal PostgreSQL's, not a
 *     client-side opinion.
 *
 * READ ONLY, three ways. The session is put in `default_transaction_read_only`
 * and that setting is read back and asserted; the script itself is a
 * `BEGIN TRANSACTION READ ONLY … ROLLBACK`; and any statement that would clear
 * either of those (`READ WRITE`, or a SET of that GUC) is refused statically
 * before a connection is opened. There is no code path here that commits
 * anything: the only non-SELECT statements sent are SET, DO, BEGIN and
 * ROLLBACK.
 *
 * PSQL META-COMMANDS. The evidence scripts are psql scripts and are executed
 * UNMODIFIED. `\echo`, `\pset null` and `\timing` are interpreted here — they
 * are output formatting, not semantics. Every other backslash command is a hard
 * refusal rather than a skip, because skipping one silently is how a `\c` (a
 * SECOND connection, past the guard), a `\i` (unseen SQL) or a `\copy` would
 * get through. Unsupported commands are reported before anything is executed.
 *
 * NO CREDENTIAL IS PRINTED. The DSN arrives in the environment, never in argv,
 * so it is not visible in a process listing, and every error message is passed
 * through tools/db/psql.ts's `redact` before it reaches the transcript.
 *
 * Exit codes mirror psql's, because the operator-facing script explains them:
 *   0  evidence complete     2  connection failed
 *   1  usage / static refusal (nothing was executed, no connection opened)
 *   3  SQL error, guard refusal, or session drift
 */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { redact } from '../db/psql';

/** The only database this tool will run evidence against, unless overridden to another _test. */
const DEFAULT_DATABASE = 'afldb_test';

/** CLAUDE.md §10: integration databases end in _test. afldb_dev can never satisfy this. */
const TEST_DATABASE = /^[a-z0-9_]+_test$/;

/** Interpreted here. Anything else is refused — see the header. */
const SUPPORTED_META = new Set(['echo', 'pset', 'timing']);

export const EXIT_OK = 0;
export const EXIT_STATIC = 1;
export const EXIT_CONNECT = 2;
export const EXIT_SQL = 3;

// ---------------------------------------------------------------- the parser

export type EvidenceItem =
  | { kind: 'meta'; name: string; rest: string; line: number }
  | { kind: 'sql'; text: string; line: number };

/**
 * Splits a psql script into meta-commands and statements, in file order.
 *
 * The splitting is the part that has to be right: a `;` inside a string, a
 * comment or a dollar-quoted body is not a statement boundary, and treating one
 * as a boundary would send PostgreSQL two fragments that each parse to
 * something other than what the file says. So this tracks single quotes (with
 * `''`), quoted identifiers (with `""`), `--` comments, nested block comments
 * and dollar quoting with an arbitrary tag.
 *
 * A backslash command is recognised only at the start of a line with no
 * statement pending, which is exactly where psql recognises one and nowhere a
 * backslash can appear inside SQL this repository writes.
 *
 * "No statement pending" means no SQL yet — not an empty buffer. Comments and
 * blank lines are trivia, exactly as they are to psql's own lexer. Getting that
 * wrong is not cosmetic: every section of the Phase D pack opens with a `-- ---`
 * banner and then two `\echo`s, so counting the banner as a pending statement
 * swallowed 18 of the 31 meta-commands into the following SELECT and would have
 * sent a literal `\echo` to PostgreSQL.
 */
export function parseEvidenceScript(source: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let state: 'normal' | 'single' | 'double' | 'line' | 'block' | 'dollar' = 'normal';
  let depth = 0;
  let tag = '';
  let buffer = '';
  let hasSql = false;
  let line = 1;
  let startLine = 1;
  let i = 0;

  /** Marks the first real SQL character of a statement, comments excluded. */
  const openSql = () => {
    if (!hasSql) { startLine = line; hasSql = true; }
  };
  const flush = () => {
    // Trailing comments and blank lines are trivia, and are dropped rather than
    // sent as a statement of their own.
    if (hasSql) items.push({ kind: 'sql', text: buffer.trim(), line: startLine });
    buffer = '';
    hasSql = false;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    if (state === 'normal') {
      if (ch === '\\' && !hasSql && (i === 0 || source[i - 1] === '\n')) {
        let end = source.indexOf('\n', i);
        if (end < 0) end = source.length;
        const raw = source.slice(i + 1, end).trim();
        const space = raw.search(/\s/);
        items.push({
          kind: 'meta',
          name: (space < 0 ? raw : raw.slice(0, space)).toLowerCase(),
          rest: space < 0 ? '' : raw.slice(space + 1).trim(),
          line,
        });
        buffer = '';
        hasSql = false;
        i = end + 1;
        line += 1;
        continue;
      }
      if (ch === ';') { flush(); i += 1; continue; }
      if (ch === '-' && next === '-') { state = 'line'; buffer += '--'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block'; depth = 1; buffer += '/*'; i += 2; continue; }
      if (ch === '$') {
        const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
        if (match) {
          openSql();
          state = 'dollar'; tag = match[0]; buffer += tag; i += tag.length; continue;
        }
      }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
    } else if (state === 'single') {
      if (ch === "'" && next === "'") { buffer += "''"; i += 2; continue; }
      if (ch === "'") state = 'normal';
    } else if (state === 'double') {
      if (ch === '"' && next === '"') { buffer += '""'; i += 2; continue; }
      if (ch === '"') state = 'normal';
    } else if (state === 'line') {
      if (ch === '\n') state = 'normal';
    } else if (state === 'block') {
      if (ch === '/' && next === '*') { depth += 1; buffer += '/*'; i += 2; continue; }
      if (ch === '*' && next === '/') {
        depth -= 1; buffer += '*/'; i += 2;
        if (depth === 0) state = 'normal';
        continue;
      }
    } else if (state === 'dollar') {
      if (source.startsWith(tag, i)) { buffer += tag; i += tag.length; state = 'normal'; continue; }
    }

    // A comment's own characters are trivia; everything else -- including a
    // string or dollar-quoted body -- opens the statement.
    if (state !== 'line' && state !== 'block' && ch.trim().length > 0) openSql();
    buffer += ch;
    if (ch === '\n') line += 1;
    i += 1;
  }

  if (state !== 'normal') {
    throw new Error(
      `Script ends inside an unterminated ${state === 'dollar' ? `dollar-quoted block (${tag})` : state}. `
      + 'Refusing to guess where the last statement ends.');
  }
  flush();
  return items;
}

/**
 * Everything that must hold before a connection is opened. Refusals here cost
 * nothing and happen while the database has still never been touched.
 */
export function staticRefusals(items: EvidenceItem[], database: string): string[] {
  const refusals: string[] = [];

  if (!TEST_DATABASE.test(database)) {
    refusals.push(
      `target database '${database}' does not end in _test. This runner exists because an `
      + 'evidence pass was executed against afldb_dev by accident.');
  }

  for (const item of items) {
    if (item.kind === 'meta') {
      if (!SUPPORTED_META.has(item.name)) {
        refusals.push(
          `line ${item.line}: unsupported psql meta-command \\${item.name}. Skipping one silently `
          + 'is how a \\c (a second connection, past the guard), a \\i (unseen SQL) or a \\copy '
          + 'would get through.');
      }
      continue;
    }
    // The session is read-only; these are the two statements that could undo that.
    if (/\bread\s+write\b/i.test(item.text)) {
      refusals.push(`line ${item.line}: statement asks for READ WRITE, which this runner never permits.`);
    }
    if (/default_transaction_read_only/i.test(item.text)) {
      refusals.push(`line ${item.line}: statement changes default_transaction_read_only, which this runner asserts.`);
    }
  }
  return refusals;
}

// -------------------------------------------------------------- presentation

export function formatValue(value: unknown, nullDisplay: string): string {
  if (value === null || value === undefined) return nullDisplay;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A psql-shaped result table. Deliberately close to psql's layout — the ISSUE-152
 * evidence packs are read side by side with earlier psql transcripts — but not a
 * reimplementation of it: everything is left-aligned, and no attempt is made to
 * reproduce psql's numeric alignment.
 */
export function formatTable(columns: string[], rows: unknown[][], nullDisplay: string): string {
  const cells = rows.map((row) => row.map((value) => formatValue(value, nullDisplay)));
  const widths = columns.map((name, index) =>
    Math.max(name.length, ...cells.map((row) => (row[index] ?? '').length), 0));

  const lines: string[] = [];
  lines.push(' ' + columns.map((name, index) => name.padEnd(widths[index])).join(' | '));
  lines.push(widths.map((width) => '-'.repeat(width + 2)).join('+'));
  for (const row of cells) {
    lines.push(' ' + row.map((value, index) => value.padEnd(widths[index])).join(' | '));
  }
  lines.push(`(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------- run

class GuardError extends Error {}

const out = (text = '') => process.stdout.write(`${text}\n`);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const scriptPath = argv.find((argument) => !argument.startsWith('--'));

  if (!scriptPath) {
    out('usage: tsx tools/issue-152/phase-d-evidence.ts <script.sql> [--dry-run]');
    return EXIT_STATIC;
  }

  const database = process.env.AFLDB_EVIDENCE_DATABASE || DEFAULT_DATABASE;
  const items = parseEvidenceScript(readFileSync(scriptPath, 'utf8'));
  const statements = items.filter((item) => item.kind === 'sql').length;
  const refusals = staticRefusals(items, database);

  if (refusals.length > 0) {
    out('');
    out(`REFUSED before opening a connection (${refusals.length}):`);
    for (const refusal of refusals) out(`  * ${refusal}`);
    out('');
    return EXIT_STATIC;
  }

  if (dryRun) {
    out('');
    out(`Parsed ${scriptPath}: ${statements} statements, ${items.length - statements} meta-commands, `
      + `target ${database}. No connection was opened.`);
    out('');
    // The execution plan, so a swallowed meta-command or a statement split in
    // the wrong place is visible before anything runs rather than after.
    for (const item of items) {
      if (item.kind === 'meta') continue;
      const first = item.text.replace(/\s+/g, ' ').slice(0, 88);
      out(`  line ${String(item.line).padStart(4)}  ${first}${item.text.length > 88 ? ' ...' : ''}`);
    }
    out('');
    return EXIT_OK;
  }

  const dsn = process.env.AFLDB_EVIDENCE_DATABASE_URL;
  if (!dsn) {
    out('AFLDB_EVIDENCE_DATABASE_URL is not set. Run this through tools/issue-152/phase-d-evidence.ps1,');
    out('which derives it from .env and never puts a DSN in argv.');
    return EXIT_STATIC;
  }

  let nullDisplay = '';
  let timing = false;
  let suppressNotices = false;

  const sql = postgres(dsn, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 0,
    onnotice: (notice) => { if (!suppressNotices) out(`${notice.severity}:  ${notice.message}`); },
  });

  let connection: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  let backendPid: number | null = null;

  try {
    // ---- connect and prove the target, on the connection the evidence will use
    try {
      connection = await sql.reserve();

      await connection.unsafe(`SET application_name = 'afldb-issue-152-evidence'`);
      // Some of these counts are correlated EXISTS over the whole player set and
      // run through an SSH forward; psql's own default is no timeout at all.
      await connection.unsafe(`SET statement_timeout = '600s'`);
      await connection.unsafe('SET default_transaction_read_only = on');

      const identity = await connection.unsafe(
        'SELECT current_database() AS connected_database,'
        + ' current_user AS connected_role,'
        + ' pg_backend_pid() AS backend_pid,'
        + " current_setting('default_transaction_read_only') AS default_read_only,"
        + " coalesce(inet_server_addr()::text, '(local)') AS server_addr,"
        + ' inet_server_port() AS server_port');

      const row = identity[0] as Record<string, unknown>;
      out('');
      out('=== target proof (this connection, before any evidence statement) ===');
      out(formatTable(
        Object.keys(row),
        [Object.values(row)],
        '(null)'));
      out('');

      backendPid = Number(row.backend_pid);

      if (row.connected_database !== database) {
        throw new GuardError(
          `refused: connected to '${String(row.connected_database)}', not '${database}'. `
          + 'No evidence statement was executed.');
      }
      if (row.default_read_only !== 'on') {
        throw new GuardError(
          `refused: default_transaction_read_only is '${String(row.default_read_only)}', not 'on'.`);
      }
    } catch (error) {
      if (error instanceof GuardError) throw error;
      out('');
      out(`CONNECTION FAILED: ${redact(error instanceof Error ? error.message : String(error))}`);
      out('');
      out(`  Nothing was executed. If this is ECONNREFUSED on 127.0.0.1, the SSH forward is`);
      out('  down: start .\\tools\\issue-152\\phase-g-tunnel.ps1 in window 1.');
      return EXIT_CONNECT;
    }

    /*
     * The server's own refusal, on the same connection. The JS check above has
     * already passed; this one exists so the guarantee does not rest on a
     * client-side comparison of a value the client also formatted.
     */
    await connection.unsafe(
      `DO $afldb_evidence_guard$ BEGIN`
      + ` IF current_database() <> '${database}' THEN`
      + ` RAISE EXCEPTION 'AFLDB-ISSUE-152 evidence refused: connected to %, not ${database}', current_database();`
      + ` END IF;`
      + ` RAISE NOTICE 'AFLDB-ISSUE-152 target confirmed: % (backend pid %)', current_database(), pg_backend_pid();`
      + ` END $afldb_evidence_guard$`);

    // ---- the script itself, unmodified, in file order
    for (const item of items) {
      if (item.kind === 'meta') {
        if (item.name === 'echo') out(stripQuotes(item.rest));
        else if (item.name === 'timing') timing = item.rest.toLowerCase() !== 'off';
        else if (item.name === 'pset' && /^null\b/i.test(item.rest)) {
          nullDisplay = stripQuotes(item.rest.replace(/^null\s*/i, ''));
        }
        continue;
      }

      const started = performance.now();
      let result;
      try {
        result = await connection.unsafe(item.text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = (error as { detail?: string; hint?: string; position?: string });
        out('');
        out(`ERROR:  ${redact(message)}`);
        if (detail?.detail) out(`DETAIL:  ${redact(detail.detail)}`);
        if (detail?.hint) out(`HINT:  ${redact(detail.hint)}`);
        out(`  at line ${item.line} of ${scriptPath}`);
        out('  The run stopped here; no later statement was executed.');
        out('');
        return EXIT_SQL;
      }
      const elapsed = performance.now() - started;

      // A silent reconnect would move the evidence to a different session --
      // caught at the statement it happened on rather than inferred later.
      const ranOn = (result as unknown as { state?: { pid?: number } }).state?.pid;
      if (typeof ranOn === 'number' && backendPid !== null && ranOn !== backendPid) {
        throw new GuardError(
          `session drift: statement at line ${item.line} ran on backend pid ${ranOn}, not ${backendPid}. `
          + 'The transcript above is INVALID as acceptance evidence.');
      }

      const columns = Array.isArray(result.columns) ? result.columns.map((column) => String(column.name)) : [];
      if (columns.length > 0) {
        out(formatTable(columns, result.map((r) => columns.map((name) => (r as Record<string, unknown>)[name])), nullDisplay));
      } else {
        out(result.command || 'OK');
      }
      if (timing) out(`Time: ${elapsed.toFixed(3)} ms`);
      out('');
    }

    // ---- the closing half of the same-session proof
    const closing = await connection.unsafe('SELECT current_database() AS connected_database, pg_backend_pid() AS backend_pid');
    const closingRow = closing[0] as Record<string, unknown>;
    if (closingRow.connected_database !== database || Number(closingRow.backend_pid) !== backendPid) {
      throw new GuardError(
        `session drift: the run ended on ${String(closingRow.connected_database)} `
        + `backend pid ${String(closingRow.backend_pid)}, but started on ${database} backend pid ${backendPid}. `
        + 'The transcript above is INVALID as acceptance evidence.');
    }

    out(`=== same-session proof: ${database}, backend pid ${backendPid}, start and end ===`);
    out('');
    return EXIT_OK;
  } catch (error) {
    out('');
    out(`REFUSED: ${redact(error instanceof Error ? error.message : String(error))}`);
    out('');
    return EXIT_SQL;
  } finally {
    if (connection) {
      // The script rolls itself back; this is the belt for the case where it
      // could not reach its own ROLLBACK. "no transaction in progress" is the
      // expected notice on the normal path, so notices are quiet from here.
      suppressNotices = true;
      try { await connection.unsafe('ROLLBACK'); } catch { /* nothing to roll back */ }
      connection.release();
    }
    await sql.end({ timeout: 5 });
  }
}

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2
    && ((trimmed.startsWith("'") && trimmed.endsWith("'"))
      || (trimmed.startsWith('"') && trimmed.endsWith('"')))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Same guard as tools/current-season/*.ts: importing this module (to test the
// parser, say) must not open a connection or read argv.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      out('');
      out(`FAILED: ${redact(error instanceof Error ? error.stack || error.message : String(error))}`);
      process.exitCode = EXIT_SQL;
    });
}
