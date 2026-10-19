/**
 * AFLDB V2 Stage 6 — read-only CAPTURE of the Coleman comparison and Brownlow reconciliation
 * reports from a restored shadow copy (docs/v2/shadow-rehearsal.md).
 *
 *   npx tsx --conditions=react-server tools/v2/shadow-award-reports.ts coleman \
 *       --dsn-env <VAR> --from <season> --through <season> [--settled] --out <file>
 *   npx tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
 *       --dsn-env <VAR> --season <season> [--eligibility-rule unrecorded|stored_eligible_rank_one] --out <file>
 *
 * (`--conditions=react-server` lets a tool import the `server-only` loaders, as the `db:code-test:*`
 * scripts do.) The reports are the inputs of `tools/v2/shadow-parity.ts` (checks `coleman` and
 * `brownlow`): run once BEFORE and once AFTER the rehearsal step under test, with the same range,
 * the same `--settled` choice and the same rule.
 *
 * WHAT IT DOES. It reuses, and does not re-implement, the Stage 5 read path of
 * `src/lib/admin/operations-centre.ts` (`compareColemanSeason`, `reconcileBrownlowSeasonForAdmin`):
 * the loaders (`loadColemanDerivationInput`, `loadStoredColemanWinners`,
 * `loadBrownlowReconciliationInput`) and the pure builders (`deriveColeman`,
 * `buildColemanComparisonReport`, `reconcileBrownlowSeason`). The operations-centre functions
 * themselves need an AdminUser and the audit plumbing and are not called.
 *
 * READ ONLY, FAIL CLOSED. Every loader runs inside ONE `BEGIN ISOLATION LEVEL REPEATABLE READ READ
 * ONLY` transaction on ONE connection opened with `default_transaction_read_only = on`; the
 * transaction state is read back and the run refuses unless the server reports `on` and `repeatable
 * read`; the connected database must be the one the DSN named; the executor handed to the loaders
 * refuses any statement that is not a SELECT/WITH read; the transaction is always rolled back; the
 * client is always ended. Nothing here can write to the database.
 *
 * TARGET. Only an isolated shadow copy (`afldb_v2_shadow[_<tag>]_test`, packages/domain/src/
 * shadow-target.ts) is accepted. There is no override flag. The DSN comes from the named variable
 * only and is NEVER printed, logged or put in an error message.
 *
 * Exit status: 0 the report was written; 2 refused or failed (nothing was written). A Coleman
 * `disagree` or a Brownlow `discrepancies` outcome is DATA in the report, not a failure of the capture.
 * Output files are created exclusively and never overwritten.
 */
import { existsSync, writeFileSync } from 'node:fs';

import { MAX_SEASON, MIN_SEASON } from '@afldb/admin';
import { postgresTransactionExecutor, type SqlExecutor } from '@afldb/db';
import {
  BROWNLOW_ELIGIBILITY_RULES,
  ColemanContractError,
  buildColemanComparisonReport,
  deriveColeman,
  reconcileBrownlowSeason,
  serialiseBrownlowReconciliationReport,
  serialiseColemanComparisonReport,
  validateBrownlowReconciliationReport,
  validateColemanComparisonReport,
  type BrownlowEligibilityRule,
  type ColemanContract,
  type ColemanDerivationOutcome,
} from '@afldb/derived';
import { evaluateShadowDsn, type SeasonRegistry } from '@afldb/domain';
import type postgres from 'postgres';

import { BrownlowInputError, loadBrownlowReconciliationInput } from '@/db/queries/brownlow-reconciliation-inputs';
import {
  loadColemanContract,
  loadColemanDerivationInput,
  loadStoredColemanWinners,
} from '@/db/queries/coleman-inputs';
import { SeasonRegistryError, loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

/* ------------------------------------------------------------------ *
 * Contract constants
 * ------------------------------------------------------------------ */

export const USAGE = [
  'usage:',
  '  shadow-award-reports.ts coleman  --dsn-env <VAR> --from <season> --through <season> [--settled] --out <file>',
  '  shadow-award-reports.ts brownlow --dsn-env <VAR> --season <season>'
    + ' [--eligibility-rule unrecorded|stored_eligible_rank_one] --out <file>',
  'exit: 0 report written; 2 refused or failed (nothing written). No override flag exists.',
].join('\n');

/** A capture covers at most this many consecutive seasons (a typo guard, not a data limit). */
export const MAX_COLEMAN_SPAN = 200;

/** The statement the read-only transaction state is read back with. */
export const READ_ONLY_STATE_SQL = `SELECT current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('transaction_isolation') AS transaction_isolation`;

export const SESSION_BEGIN_OPTIONS = 'isolation level repeatable read read only';

/** Settings the real session applies after BEGIN (transaction-local; nothing persists). */
export const SESSION_LOCAL_SETTINGS: readonly string[] = [
  `SET LOCAL statement_timeout = '300s'`,
  `SET LOCAL lock_timeout = '5s'`,
  `SET LOCAL idle_in_transaction_session_timeout = '300s'`,
];

/** Every statement the loaders are allowed to send: a read. Anything else is a defect. */
const READ_STATEMENT = /^\s*(?:SELECT|WITH)\b/i;
const WRITE_KEYWORD = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|LOCK)\b/i;

export class ShadowReportRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowReportRefusal';
  }
}

/** A command-line mistake: refused like any other, and the usage text is printed with it. */
export class ShadowUsageError extends ShadowReportRefusal {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowUsageError';
  }
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export type CaptureArgs =
  | { mode: 'coleman'; dsnEnv: string; from: number; through: number; settled: boolean; out: string }
  | { mode: 'brownlow'; dsnEnv: string; season: number; eligibilityRule: BrownlowEligibilityRule | undefined; out: string };

const VALUED = new Set(['--dsn-env', '--from', '--through', '--season', '--eligibility-rule', '--out']);
const COMMAND_FLAGS: Record<'coleman' | 'brownlow', readonly string[]> = {
  coleman: ['--dsn-env', '--from', '--through', '--settled', '--out'],
  brownlow: ['--dsn-env', '--season', '--eligibility-rule', '--out'],
};

function seasonValue(flag: string, text: string | undefined): number {
  if (text === undefined || !/^\d{1,4}$/.test(text)) throw new ShadowUsageError(`${flag} must be a whole year (digits only)`);
  const season = Number(text);
  if (season < MIN_SEASON || season > MAX_SEASON) {
    throw new ShadowUsageError(`${flag} must be a whole year from ${MIN_SEASON} to ${MAX_SEASON}`);
  }
  return season;
}

/** Parse and validate argv (without the node/script entries). Throws {@link ShadowReportRefusal}. */
export function parseCaptureArgs(argv: readonly string[]): CaptureArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'coleman' && mode !== 'brownlow') throw new ShadowUsageError('the first argument must be coleman or brownlow');
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!COMMAND_FLAGS[mode].includes(arg)) {
      throw new ShadowUsageError(arg.startsWith('--') ? `${arg} is not an option of ${mode}` : `unexpected argument ${arg}`);
    }
    if (flags.has(arg)) throw new ShadowUsageError(`${arg} given twice`);
    if (VALUED.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ShadowUsageError(`${arg} needs a value`);
      flags.set(arg, value);
      i += 1;
    } else {
      flags.set(arg, true);
    }
  }
  const text = (flag: string): string | undefined => {
    const value = flags.get(flag);
    return typeof value === 'string' ? value : undefined;
  };

  const dsnEnv = text('--dsn-env');
  if (dsnEnv === undefined) throw new ShadowUsageError('--dsn-env <VARIABLE> is required; no variable is ever read implicitly');
  if (!/^[A-Z_][A-Z0-9_]*$/.test(dsnEnv)) throw new ShadowUsageError('--dsn-env must name an environment variable (A-Z, 0-9, _)');
  const out = text('--out');
  if (out === undefined || out === '') throw new ShadowUsageError('--out <file> is required');

  if (mode === 'coleman') {
    const from = seasonValue('--from', text('--from'));
    const through = seasonValue('--through', text('--through'));
    if (from > through) throw new ShadowUsageError('--from must not be after --through');
    if (through - from + 1 > MAX_COLEMAN_SPAN) {
      throw new ShadowUsageError(`a capture covers at most ${MAX_COLEMAN_SPAN} seasons`);
    }
    return { mode, dsnEnv, from, through, settled: flags.get('--settled') === true, out };
  }
  const season = seasonValue('--season', text('--season'));
  const rule = text('--eligibility-rule');
  if (rule !== undefined && !(BROWNLOW_ELIGIBILITY_RULES as readonly string[]).includes(rule)) {
    throw new ShadowUsageError(`--eligibility-rule must be one of ${BROWNLOW_ELIGIBILITY_RULES.join(', ')}`);
  }
  return { mode, dsnEnv, season, eligibilityRule: rule as BrownlowEligibilityRule | undefined, out };
}

/* ------------------------------------------------------------------ *
 * The read-only session
 * ------------------------------------------------------------------ */

/**
 * One connection. `readOnly` runs `work` inside ONE read-only repeatable-read transaction that is
 * always rolled back; `close` ends the connection. The executor `work` receives may issue reads only.
 */
export interface ReadSession {
  readOnly<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Creates a session for a DSN that has already passed the shadow policy and names `expectedDatabase`. */
export type SessionFactory = (dsn: string, expectedDatabase: string) => ReadSession | Promise<ReadSession>;

/** Opens a postgres.js client. Injectable so the session is testable without a driver. */
export type PostgresConnect = (dsn: string) => Promise<postgres.Sql>;

const connectPostgres: PostgresConnect = async (dsn) => {
  const driver = (await import('postgres')).default;
  return driver(dsn, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 15,
    connection: { application_name: 'afldb-v2-shadow-award-reports', default_transaction_read_only: true },
  });
};

class RollbackSignal extends Error {
  constructor() {
    super('rollback');
    this.name = 'RollbackSignal';
  }
}

/**
 * The production session: postgres.js `sql.begin` with `isolation level repeatable read read only`
 * on a connection whose session default is read-only. The connected database name is checked
 * against the one the DSN named; the transaction is rolled back by a sentinel after `work`.
 */
export function createPostgresSessionFactory(connect: PostgresConnect = connectPostgres): SessionFactory {
  return async (dsn, expectedDatabase) => {
    const sql = await connect(dsn);
    return {
      async readOnly<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
        let result: T | undefined;
        let produced = false;
        try {
          await sql.begin(SESSION_BEGIN_OPTIONS, async (tx) => {
            const executor = postgresTransactionExecutor(tx);
            for (const statement of SESSION_LOCAL_SETTINGS) await executor.query(statement);
            const [named] = await executor.query<{ database_name: string }>('SELECT current_database() AS database_name');
            if (!named || named.database_name !== expectedDatabase) {
              throw new ShadowReportRefusal('the connected database is not the one the DSN named; refusing to read');
            }
            result = await work(executor);
            produced = true;
            throw new RollbackSignal(); // a read-only transaction has nothing to commit: always roll back
          });
        } catch (error) {
          if (!(error instanceof RollbackSignal)) throw error;
        }
        if (!produced) throw new ShadowReportRefusal('the read-only transaction produced no result');
        return result as T;
      },
      close: () => sql.end({ timeout: 5 }),
    };
  };
}

/** Throws unless the executor's transaction is `read only` and `repeatable read`. */
export async function assertReadOnlyState(executor: SqlExecutor): Promise<void> {
  const [state] = await executor.query<{ transaction_read_only: unknown; transaction_isolation: unknown }>(READ_ONLY_STATE_SQL);
  if (!state || state.transaction_read_only !== 'on') {
    throw new ShadowReportRefusal('the server does not report transaction_read_only = on; refusing to read');
  }
  if (state.transaction_isolation !== 'repeatable read') {
    throw new ShadowReportRefusal('the server does not report a repeatable read snapshot; refusing to read');
  }
}

/** An executor that forwards reads (SELECT/WITH) and throws on any other statement. */
export function readOnlyGuard(inner: SqlExecutor): SqlExecutor {
  return {
    query<R extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<R[]> {
      if (!READ_STATEMENT.test(text) || WRITE_KEYWORD.test(text)) {
        return Promise.reject(new ShadowReportRefusal('refusing a statement that is not a read'));
      }
      return inner.query<R>(text, params);
    },
  };
}

/** Run `work` in the session's read-only transaction, after the state check, behind the read guard. */
export function withReadOnlyExecutor<T>(session: ReadSession, work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
  return session.readOnly(async (executor) => {
    const guarded = readOnlyGuard(executor);
    await assertReadOnlyState(guarded);
    return work(guarded);
  });
}

/* ------------------------------------------------------------------ *
 * Capture (pure over an executor)
 * ------------------------------------------------------------------ */

export interface CaptureInputs {
  readonly registry: SeasonRegistry;
  readonly contract: ColemanContract;
  readonly generatedAt: string;
}

/** ONE Coleman comparison report covering every season from `from` through `through`. */
export async function captureColeman(
  executor: SqlExecutor,
  args: { from: number; through: number; settled: boolean },
  inputs: CaptureInputs,
) {
  const outcomes: ColemanDerivationOutcome[] = [];
  for (let season = args.from; season <= args.through; season += 1) {
    outcomes.push(deriveColeman(await loadColemanDerivationInput(executor, {
      season, settled: args.settled, derivedAt: inputs.generatedAt, registry: inputs.registry, contract: inputs.contract,
    })));
  }
  const stored = await loadStoredColemanWinners(executor);
  return buildColemanComparisonReport({ generatedAt: inputs.generatedAt, outcomes, stored });
}

/** One Brownlow reconciliation report for one season. */
export async function captureBrownlow(
  executor: SqlExecutor,
  args: { season: number; eligibilityRule: BrownlowEligibilityRule | undefined },
  inputs: Pick<CaptureInputs, 'registry' | 'generatedAt'>,
) {
  const input = await loadBrownlowReconciliationInput(executor, {
    season: args.season, registry: inputs.registry, generatedAt: inputs.generatedAt, eligibilityRule: args.eligibilityRule,
  });
  return reconcileBrownlowSeason(input);
}

/* ------------------------------------------------------------------ *
 * The CLI
 * ------------------------------------------------------------------ */

export interface CliDeps {
  env: Record<string, string | undefined>;
  createSession: SessionFactory;
  exists: (path: string) => boolean;
  /** Must create exclusively (flag `wx`) and throw if the file exists. */
  writeFile: (path: string, text: string) => void;
  now: () => Date;
  loadRegistry: () => SeasonRegistry;
  loadContract: () => ColemanContract;
}

export interface CliResult {
  exitCode: 0 | 2;
  lines: string[];
  errors: string[];
}

const defaultWriteFile = (path: string, text: string): void => writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });

/** Remove the DSN, its password and its host from a message. */
function redact(message: string, dsn: string | undefined): string {
  if (!dsn) return message;
  let out = message.split(dsn).join('<dsn>');
  try {
    const url = new URL(dsn);
    const secrets = [url.password, safeDecode(url.password), url.username, url.hostname]
      .filter((value) => value.length >= 3);
    for (const secret of new Set(secrets)) out = out.split(secret).join('<redacted>');
  } catch {
    // an unparsable DSN has already been replaced whole
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function refuse(errors: string[]): CliResult {
  return { exitCode: 2, lines: [], errors: [...errors, 'Nothing was written.'] };
}

/** Testable entry: every dependency is injectable. Never throws; never prints a DSN. */
export async function runCli(argv: readonly string[], deps: Partial<CliDeps> = {}): Promise<CliResult> {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? (() => new Date());
  const loadRegistry = deps.loadRegistry ?? (() => loadSeasonRegistry());
  const loadContract = deps.loadContract ?? (() => loadColemanContract());
  let knownDsn: string | undefined;
  try {
    const args = parseCaptureArgs(argv);

    // A test process never connects unless a session factory was injected.
    if (typeof env.VITEST === 'string' && env.VITEST !== '' && deps.createSession === undefined) {
      throw new ShadowReportRefusal('the capture never connects from a test process');
    }

    const value = env[args.dsnEnv];
    if (value === undefined || value.trim() === '') throw new ShadowReportRefusal(`${args.dsnEnv} is not set`);
    knownDsn = value.trim();
    const verdict = evaluateShadowDsn(knownDsn);
    if (!verdict.ok) {
      throw new ShadowReportRefusal(
        `${args.dsnEnv} is not an isolated shadow copy (database ${verdict.database === null ? '<unreadable>' : `'${verdict.database}'`}): ${verdict.reason}`,
      );
    }
    if (exists(args.out)) throw new ShadowReportRefusal('the --out file already exists; reports are never overwritten');

    // Everything that needs no database is loaded (and can refuse) before a connection exists.
    const registry = loadRegistry();
    const contract = args.mode === 'coleman' ? loadContract() : undefined;
    const generatedAt = now().toISOString();

    const lines = [
      'AFLDB V2 shadow award report capture — READ ONLY (repeatable read, read only, rolled back)',
      `  target   : database '${verdict.database}' from ${args.dsnEnv}`,
    ];

    const createSession = deps.createSession ?? createPostgresSessionFactory();
    const session = await createSession(knownDsn, verdict.database);
    let text: string;
    let summary: string;
    try {
      if (args.mode === 'coleman') {
        const report = await withReadOnlyExecutor(session, (executor) => captureColeman(
          executor,
          { from: args.from, through: args.through, settled: args.settled },
          { registry, contract: contract as ColemanContract, generatedAt },
        ));
        const problems = validateColemanComparisonReport(report);
        if (problems.length > 0) throw new ShadowReportRefusal(`the Coleman report is invalid: ${problems.slice(0, 5).join('; ')}`);
        text = serialiseColemanComparisonReport(report);
        summary = `  summary  : seasons ${report.summary.seasons}, agree ${report.summary.agree}, `
          + `disagree ${report.summary.disagree}, notDerivable ${report.summary.notDerivable}`;
      } else {
        const report = await withReadOnlyExecutor(session, (executor) => captureBrownlow(
          executor,
          { season: args.season, eligibilityRule: args.eligibilityRule },
          { registry, generatedAt },
        ));
        const problems = validateBrownlowReconciliationReport(report);
        if (problems.length > 0) throw new ShadowReportRefusal(`the Brownlow report is invalid: ${problems.slice(0, 5).join('; ')}`);
        text = serialiseBrownlowReconciliationReport(report);
        summary = `  summary  : season ${args.season}, outcome ${report.outcome}`;
      }
    } finally {
      await session.close();
    }

    try {
      writeFile(args.out, text);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new ShadowReportRefusal(code === 'EEXIST'
        ? 'the --out file already exists; reports are never overwritten'
        : 'the report could not be written to --out');
    }
    lines.push(summary, `  written  : ${args.out}`);
    return { exitCode: 0, lines, errors: [] };
  } catch (error) {
    const known = error instanceof ShadowReportRefusal
      || error instanceof BrownlowInputError
      || error instanceof ColemanContractError
      || error instanceof SeasonRegistryError;
    const message = redact(error instanceof Error ? error.message.split('\n')[0] : String(error), knownDsn);
    return refuse([`${known ? 'REFUSED' : 'FAILED'}: ${message}`, ...(error instanceof ShadowUsageError ? [USAGE] : [])]);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const result = await runCli(argv);
  for (const line of result.lines) console.log(line);
  for (const line of result.errors) console.error(line);
  return result.exitCode;
}

if (process.argv[1] && /shadow-award-reports\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => {
      console.error('FAILED: unexpected error. Nothing was written.');
      process.exit(2);
    });
}
