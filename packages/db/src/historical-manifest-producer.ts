/**
 * AFLDB V2 Stage 2 — the historical baseline manifest PRODUCER (docs/v2/historical-manifest-spec.md).
 *
 * It reads a database and writes counts and sha256 digests; it never writes to the database.
 * Read-only is enforced by the server, not promised: the session is put into
 * default_transaction_read_only, the work runs inside BEGIN ... READ ONLY, the producer checks
 * transaction_read_only = on before its first table read, and the transaction always ends in
 * ROLLBACK. The only statements this module can issue are SET (session read-only), BEGIN READ ONLY,
 * SET LOCAL, SELECT and ROLLBACK; tests/v2-historical-manifest.test.ts asserts that through a
 * fake query function. Row content never leaves the database: string_agg and sha256 run
 * server-side and only the digests come back.
 *
 * NEVER RUN IN LAUNCH A (docs/v2/plan.md §7 R-007). The target DSN is taken only from the
 * variable named by --dsn-env; a database whose name does not end in `_test` is refused unless
 * both --read-only-source and --i-understand-this-reads-a-non-test-database are given.
 */
import {
  HISTORICAL_TABLES,
  MANIFEST_FORMAT,
  MANIFEST_FORMAT_VERSION,
  MANIFEST_SPEC_VERSION,
  METADATA_COLUMNS,
  describeColumnRef,
  isSealedSeason,
  type ColumnRef,
  type HistoricalManifest,
  type HistoricalTableSpec,
  type ManifestBucket,
  type ManifestTable,
  type SealedSeasons,
} from '@afldb/domain';

export type ManifestRow = Record<string, unknown>;
/** Runs one statement and returns its rows. The CLI binds it to a single postgres.js connection. */
export type ManifestQuery = (statement: string) => Promise<readonly ManifestRow[]>;

export const PRODUCER_SESSION_SQL = 'SET default_transaction_read_only = on';
export const PRODUCER_BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const PRODUCER_END_SQL = 'ROLLBACK';
/** Pinned so the text every digest hashes is independent of server and session defaults. */
export const PRODUCER_LOCAL_SETTINGS: readonly string[] = [
  `SET LOCAL statement_timeout = '900s'`,
  `SET LOCAL lock_timeout = '5s'`,
  `SET LOCAL idle_in_transaction_session_timeout = '300s'`,
  `SET LOCAL client_min_messages = warning`,
  `SET LOCAL search_path = pg_catalog`,
  `SET LOCAL DateStyle = 'ISO, YMD'`,
  `SET LOCAL IntervalStyle = 'postgres'`,
  `SET LOCAL TimeZone = 'UTC'`,
  `SET LOCAL extra_float_digits = 1`,
  `SET LOCAL bytea_output = 'hex'`,
];
export const PRODUCER_STATE_SQL = `SELECT current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('transaction_isolation') AS transaction_isolation,
       current_database() AS database_name,
       current_setting('server_version') AS server_version`;

/** Statement shapes the producer may issue; anything else is a defect. */
export const PRODUCER_STATEMENT_ALLOWLIST: readonly RegExp[] = [
  /^SET default_transaction_read_only = on$/,
  /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/,
  /^SET LOCAL [A-Za-z_]+ = [^;]+$/,
  /^SELECT\s[^;]+$/,
  /^ROLLBACK$/,
];

export class ManifestProducerRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestProducerRefusal';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new ManifestProducerRefusal(`refusing unsafe identifier ${JSON.stringify(name)}`);
  return `"${name}"`;
}
const literal = (name: string): string => `'${ident(name).slice(1, -1)}'`;
const columnExpr = (ref: ColumnRef): string => `${ref.via === 'match' ? 'm' : 't'}.${ident(ref.column)}`;
const needsMatch = (spec: HistoricalTableSpec): boolean =>
  spec.season?.via === 'match' || spec.key.some((k) => k.via === 'match');

/** Live columns, in attnum order, plus whether row-level security is enabled. */
export function catalogSql(tables: readonly HistoricalTableSpec[]): string {
  const names = [...new Set([...tables.map((t) => t.table), 'matches'])].map(literal).join(', ');
  return `SELECT c.relname AS table_name, a.attname AS column_name, a.attnum::int AS position,
       c.relrowsecurity AS row_security
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
   AND c.relname IN (${names})
 ORDER BY c.relname, a.attnum`;
}

const digestOf = (expr: string): string =>
  `encode(sha256(convert_to(coalesce(string_agg(${expr}, E'\\n' ORDER BY k COLLATE "C", f COLLATE "C"), ''), 'UTF8')), 'hex')`;

/**
 * One statement per table: per season, the row count and three digests, each over the rows in
 * (key text, fact text) order under the "C" collation, so the result does not depend on physical
 * order, plan or locale. `excluded` columns are removed from the fact text; `metadata` columns
 * form their own digest.
 */
export function bucketSql(spec: HistoricalTableSpec, excluded: readonly string[], metadata: readonly string[]): string {
  const season = spec.season ? columnExpr(spec.season) : 'NULL::int';
  const key = `jsonb_build_array(${spec.key.map(columnExpr).join(', ')})::text`;
  const removed = excluded.length ? `ARRAY[${excluded.map(literal).join(', ')}]::text[]` : `ARRAY[]::text[]`;
  const meta = metadata.length
    ? `jsonb_build_object(${metadata.map((c) => `${literal(c)}, t.${ident(c)}`).join(', ')})::text`
    : 'NULL::text';
  const join = needsMatch(spec) ? `\n  JOIN public."matches" AS m ON m."id" = t."match_id"` : '';
  return `SELECT s::text AS season, count(*)::text AS row_count,
       ${digestOf('k')} AS key_digest,
       ${digestOf('f')} AS fact_digest,
       ${metadata.length ? digestOf('p') : 'NULL::text'} AS metadata_digest
  FROM (SELECT ${season} AS s, ${key} AS k, (to_jsonb(t) - ${removed})::text AS f, ${meta} AS p
          FROM ONLY public.${ident(spec.table)} AS t${join}) r
 GROUP BY s
 ORDER BY s NULLS FIRST`;
}

interface LiveTable { columns: string[]; rowSecurity: boolean }

function readCatalog(rows: readonly ManifestRow[]): Map<string, LiveTable> {
  const out = new Map<string, LiveTable>();
  for (const r of rows) {
    const name = String(r.table_name);
    const entry = out.get(name) ?? { columns: [], rowSecurity: false };
    entry.columns.push(String(r.column_name));
    entry.rowSecurity = entry.rowSecurity || r.row_security === true || r.row_security === 't';
    out.set(name, entry);
  }
  return out;
}

/** Decides the fact, metadata and excluded column lists for one table. Pure. */
export function planColumns(
  spec: HistoricalTableSpec,
  live: readonly string[],
  pinned: ManifestTable | undefined,
): { fact: string[]; metadata: string[]; excluded: string[] } {
  const metadata = live.filter((c) => METADATA_COLUMNS.includes(c));
  let fact = live.filter((c) => !METADATA_COLUMNS.includes(c) && !(spec.surrogateId && c === 'id'));
  if (pinned) {
    const missing = pinned.factColumns.filter((c) => !live.includes(c));
    if (missing.length) {
      throw new ManifestProducerRefusal(`${spec.table}: pinned fact column(s) ${missing.join(', ')} no longer exist; the manifests cannot be made comparable`);
    }
    fact = live.filter((c) => pinned.factColumns.includes(c));
  }
  const excluded = live.filter((c) => !fact.includes(c) && !metadata.includes(c));
  return { fact, metadata, excluded };
}

export interface ProduceOptions {
  readonly sealed: SealedSeasons;
  readonly readOnlySource: boolean;
  readonly tables?: readonly HistoricalTableSpec[];
  readonly pinned?: HistoricalManifest;
  readonly clock?: () => Date;
}

const toInt = (value: unknown, what: string): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new ManifestProducerRefusal(`unexpected ${what} ${JSON.stringify(value)}`);
  return n;
};

/**
 * Produces a COMPLETE manifest or throws. On any error the transaction is still rolled back and
 * nothing is returned, so a partial manifest cannot exist.
 */
export async function produceManifest(query: ManifestQuery, options: ProduceOptions): Promise<HistoricalManifest> {
  const tables = options.tables ?? HISTORICAL_TABLES;
  const clock = options.clock ?? (() => new Date());
  const pinnedTables = new Map((options.pinned?.tables ?? []).map((t) => [t.table, t]));

  await query(PRODUCER_SESSION_SQL);
  await query(PRODUCER_BEGIN_SQL);
  try {
    for (const statement of PRODUCER_LOCAL_SETTINGS) await query(statement);
    const [state] = await query(PRODUCER_STATE_SQL);
    if (!state || state.transaction_read_only !== 'on') {
      throw new ManifestProducerRefusal('the server does not report transaction_read_only = on; refusing to read');
    }
    if (state.transaction_isolation !== 'repeatable read') {
      throw new ManifestProducerRefusal('the server does not report a repeatable read snapshot; refusing to read');
    }

    const catalog = readCatalog(await query(catalogSql(tables)));
    const out: ManifestTable[] = [];
    for (const spec of tables) {
      const live = catalog.get(spec.table);
      if (!live) throw new ManifestProducerRefusal(`${spec.table}: table not found (or not visible to this role) in schema public`);
      if (live.rowSecurity) throw new ManifestProducerRefusal(`${spec.table}: row-level security is enabled, so counts could be silently filtered`);
      if (needsMatch(spec) && !catalog.has('matches')) throw new ManifestProducerRefusal('matches: table not found in schema public');
      const pinned = pinnedTables.get(spec.table);
      const key = spec.key.map(describeColumnRef);
      const season = spec.season ? describeColumnRef(spec.season) : null;
      if (options.pinned && !pinned) throw new ManifestProducerRefusal(`${spec.table}: absent from the pinned manifest`);
      if (pinned && (pinned.key.join('|') !== key.join('|') || pinned.season !== season)) {
        throw new ManifestProducerRefusal(`${spec.table}: key or season definition differs from the pinned manifest`);
      }
      const cols = planColumns(spec, live.columns, pinned);
      const buckets: ManifestBucket[] = (await query(bucketSql(spec, cols.excluded, cols.metadata))).map((r) => {
        const seasonValue = r.season === null || r.season === undefined ? null : toInt(r.season, 'season');
        return {
          season: seasonValue,
          sealed: spec.kind === 'fact' && isSealedSeason(options.sealed, seasonValue),
          rows: toInt(r.row_count, 'row count'),
          keyDigest: String(r.key_digest),
          factDigest: String(r.fact_digest),
          metadataDigest: r.metadata_digest === null || r.metadata_digest === undefined ? null : String(r.metadata_digest),
        };
      });
      out.push({
        table: spec.table,
        kind: spec.kind,
        season,
        key,
        factColumns: cols.fact,
        metadataColumns: cols.metadata,
        excludedColumns: cols.excluded,
        buckets,
      });
    }
    return {
      format: MANIFEST_FORMAT,
      formatVersion: MANIFEST_FORMAT_VERSION,
      specVersion: MANIFEST_SPEC_VERSION,
      status: 'complete',
      producedAt: clock().toISOString(),
      source: {
        database: String(state.database_name),
        serverVersion: String(state.server_version),
        readOnlySource: options.readOnlySource,
        transaction: 'repeatable read, read only, rolled back',
      },
      sealed: options.sealed,
      pinnedTo: options.pinned ? { producedAt: options.pinned.producedAt, database: options.pinned.source.database } : null,
      tables: out,
    };
  } finally {
    await query(PRODUCER_END_SQL);
  }
}

// ---------------------------------------------------------------------------------------------
// Target resolution (pure): which variable, which database, and is reading it allowed
// ---------------------------------------------------------------------------------------------

export const NON_TEST_CONFIRMATION_FLAG = '--i-understand-this-reads-a-non-test-database';
export const READ_ONLY_SOURCE_FLAG = '--read-only-source';

export interface ProducerTargetArgs {
  readonly dsnEnv: string | null;
  readonly readOnlySource: boolean;
  readonly confirmNonTest: boolean;
}

export interface ProducerTarget {
  readonly variable: string;
  readonly database: string;
  readonly nonTestSource: boolean;
}

/**
 * Refuses unless the DSN comes from an explicitly named variable, parses as a postgres URL that
 * names a database, and either names a `_test` database or carries BOTH non-test flags. Never
 * includes the DSN in a message. Refuses inside a test process: tests use a fake query function.
 */
export function resolveProducerTarget(args: ProducerTargetArgs, env: Record<string, string | undefined>): ProducerTarget {
  if (typeof env.VITEST === 'string' && env.VITEST !== '') {
    throw new ManifestProducerRefusal('the producer never connects from a test process');
  }
  if (!args.dsnEnv) {
    throw new ManifestProducerRefusal('--dsn-env <VARIABLE> is required; the producer never reads DATABASE_URL or any other variable implicitly');
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(args.dsnEnv)) throw new ManifestProducerRefusal('--dsn-env must name an environment variable (A-Z, 0-9, _)');
  const dsn = env[args.dsnEnv];
  if (!dsn) throw new ManifestProducerRefusal(`${args.dsnEnv} is not set`);
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ManifestProducerRefusal(`${args.dsnEnv} is not a valid connection URL`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ManifestProducerRefusal(`${args.dsnEnv} is not a postgres:// or postgresql:// URL`);
  }
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    throw new ManifestProducerRefusal(`${args.dsnEnv} has an undecodable database name`);
  }
  if (!database || database.includes('/')) {
    throw new ManifestProducerRefusal(`${args.dsnEnv} must name exactly one database in its path (no PGDATABASE fallback)`);
  }
  if (database.endsWith('_test')) return { variable: args.dsnEnv, database, nonTestSource: false };
  const missing = [
    !args.readOnlySource && READ_ONLY_SOURCE_FLAG,
    !args.confirmNonTest && NON_TEST_CONFIRMATION_FLAG,
  ].filter(Boolean);
  if (missing.length) {
    throw new ManifestProducerRefusal(`${args.dsnEnv} names the database '${database}', which is not a _test database; reading it requires ${missing.join(' and ')}`);
  }
  return { variable: args.dsnEnv, database, nonTestSource: true };
}
