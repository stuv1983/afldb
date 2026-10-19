/**
 * AFLDB V2 Stage 6 — shadow-rehearsal capture CLI (docs/v2/shadow-rehearsal.md).
 *
 *   npx tsx tools/v2/shadow-capture.ts row-counts --dsn-env <VARIABLE> --out <inventory.json>
 *       [--schema <name> ...]
 *
 * `row-counts` reads ONE database read-only (session + transaction, always rolled back) and writes
 * the exact row count of every base table in the schemas (default: public, staging, staging_aflw,
 * aflw, afldb_meta) to a new file. It writes counts and names only: no row value, host, role or
 * connection string.
 *
 * The target is checked by NAME before any connection is made: the DSN named by --dsn-env must name
 * an `afldb_v2_shadow[_<tag>]_test` database (`@afldb/domain` evaluateShadowDsn). There is NO flag
 * that overrides that: only a restored shadow copy is ever a target; `afldb_test`, DEV, PROD and
 * every other database are refused. The DSN is never printed (the variable name and the database
 * NAME only).
 *
 * Exit status: 0 inventory written; 2 refused, invalid input or failure (nothing written). The
 * output file is created exclusively and never overwritten.
 */
import { existsSync, writeFileSync } from 'node:fs';

import {
  DEFAULT_ROW_COUNT_SCHEMAS,
  RowCountsProducerRefusal,
  produceTableRowCounts,
  type RowCountsQuery,
  type RowCountsRow,
} from '@afldb/db';
import { TableRowCountsFormatError, evaluateShadowDsn, parseTableRowCounts } from '@afldb/domain';

export const SHADOW_CAPTURE_USAGE =
  'usage: shadow-capture.ts row-counts --dsn-env <VARIABLE> --out <inventory.json> [--schema <name> ...]';

export class CaptureUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureUsageError';
  }
}

export interface CaptureClient {
  readonly query: RowCountsQuery;
  end(): Promise<void>;
}

export interface CaptureDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Absent in production: the real postgres.js client is then created, and refused inside a test process. */
  readonly createClient?: (dsn: string) => CaptureClient | Promise<CaptureClient>;
  readonly exists: (path: string) => boolean;
  /** Exclusive create: must throw if the file exists. */
  readonly writeExclusive: (path: string, text: string) => void;
  readonly clock: () => Date;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

export interface RowCountsArgs {
  readonly dsnEnv: string | null;
  readonly out: string | null;
  readonly schemas: readonly string[];
}

export function parseCaptureArgs(argv: readonly string[]): RowCountsArgs {
  const positional: string[] = [];
  let dsnEnv: string | null = null;
  let out: string | null = null;
  const schemas: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dsn-env' || arg === '--out' || arg === '--schema') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new CaptureUsageError(`${arg} needs a value`);
      i += 1;
      if (arg === '--schema') {
        schemas.push(value);
      } else if (arg === '--dsn-env') {
        if (dsnEnv !== null) throw new CaptureUsageError('--dsn-env given twice');
        dsnEnv = value;
      } else {
        if (out !== null) throw new CaptureUsageError('--out given twice');
        out = value;
      }
    } else if (arg.startsWith('--')) {
      throw new CaptureUsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1 || positional[0] !== 'row-counts') {
    throw new CaptureUsageError(SHADOW_CAPTURE_USAGE);
  }
  return { dsnEnv, out, schemas: schemas.length ? schemas : DEFAULT_ROW_COUNT_SCHEMAS };
}

/** Strips the DSN, its user and its password from any text that might echo them. */
export function redactDsn(text: string, dsn: string): string {
  let out = text;
  const secrets = [dsn];
  try {
    const url = new URL(dsn);
    secrets.push(decodeURIComponent(url.password), url.password, decodeURIComponent(url.username), url.username);
  } catch {
    // not a URL: only the whole value can be redacted
  }
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out;
}

async function realClient(dsn: string): Promise<CaptureClient> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(dsn, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connect_timeout: 15,
    connection: { application_name: 'afldb-v2-shadow-capture', default_transaction_read_only: true },
  });
  return {
    query: (statement) => sql.unsafe(statement).then((rows) => rows as unknown as RowCountsRow[]),
    end: () => sql.end({ timeout: 5 }),
  };
}

const exclusiveWrite = (path: string, text: string): void => {
  writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
};

export function defaultCaptureDeps(): CaptureDeps {
  return {
    env: process.env,
    exists: existsSync,
    writeExclusive: exclusiveWrite,
    clock: () => new Date(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}

/** Testable entry. Returns the process exit code; never throws. */
export async function runCli(argv: readonly string[], deps: CaptureDeps = defaultCaptureDeps()): Promise<number> {
  const refuse = (message: string): number => {
    deps.error(`REFUSED: ${message}`);
    deps.error('Nothing was written to any database or file.');
    return 2;
  };
  let dsn: string | null = null;
  try {
    const args = parseCaptureArgs(argv);
    if (!deps.createClient && typeof deps.env.VITEST === 'string' && deps.env.VITEST !== '') {
      return refuse('the capture never connects from a test process');
    }
    if (!args.dsnEnv) return refuse('--dsn-env <VARIABLE> is required; the capture never reads DATABASE_URL or any other variable implicitly');
    if (!/^[A-Z_][A-Z0-9_]*$/.test(args.dsnEnv)) return refuse('--dsn-env must name an environment variable (A-Z, 0-9, _)');
    if (!args.out) return refuse('--out <inventory.json> is required');
    const raw = deps.env[args.dsnEnv];
    if (raw === undefined || raw.trim() === '') return refuse(`${args.dsnEnv} is not set`);
    dsn = raw.trim();
    const verdict = evaluateShadowDsn(dsn);
    if (!verdict.ok) {
      return refuse(`${args.dsnEnv} names ${verdict.database === null ? 'no readable database' : `the database '${verdict.database}'`}: ${verdict.reason}. Only an afldb_v2_shadow[_<tag>]_test copy is a shadow target.`);
    }
    if (deps.exists(args.out)) return refuse('the --out file already exists; inventories are never overwritten');

    deps.log('AFLDB V2 shadow row-count capture — READ ONLY (session + transaction), rolled back');
    deps.log(`  target   : database '${verdict.database}' from ${args.dsnEnv}`);
    deps.log(`  schemas  : ${args.schemas.join(', ')}`);

    const client = await (deps.createClient ?? realClient)(dsn);
    try {
      const inventory = await produceTableRowCounts(client.query, {
        schemas: args.schemas,
        now: deps.clock,
        expectedDatabase: verdict.database,
      });
      const text = `${JSON.stringify(inventory, null, 2)}\n`;
      parseTableRowCounts(text, 'the row-count inventory about to be written');
      deps.writeExclusive(args.out, text);
      deps.log(`  written  : ${args.out} (${inventory.tables.length} tables; counts only)`);
      return 0;
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch (error) {
    const known = error instanceof CaptureUsageError || error instanceof RowCountsProducerRefusal || error instanceof TableRowCountsFormatError;
    const text = error instanceof Error ? error.message : String(error);
    deps.error(`${known ? 'REFUSED' : 'FAILED'}: ${dsn ? redactDsn(text, dsn) : text}`);
    deps.error('Nothing was written to any database.');
    return 2;
  }
}

if (process.argv[1] && /shadow-capture\.ts$/.test(process.argv[1])) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
