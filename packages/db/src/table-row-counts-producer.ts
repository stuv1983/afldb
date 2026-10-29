/**
 * AFLDB V2 Stage 6 — the table row-count PRODUCER (docs/v2/shadow-rehearsal.md).
 *
 * It censuses every base table in the requested schemas of one database and returns exact row
 * counts in the `afldb.v2.table-row-counts` format (`@afldb/domain` table-row-counts). It never
 * writes to the database and never returns a row value. Same discipline as
 * `./historical-manifest-producer.ts`: the session is put into default_transaction_read_only, the
 * work runs inside BEGIN ... READ ONLY, the producer checks transaction_read_only = on before its
 * first catalog read, every statement is checked against an allowlist BEFORE it is sent, and the
 * transaction always ends in one ROLLBACK that can never mask the error that caused it.
 *
 * The query function takes statement text only, so schema and table names are validated against
 * `^[a-z_][a-z0-9_]*$` and only then placed in the text, as quoted literals or identifiers.
 *
 * NEVER RUN IN A TEST PROCESS: tests/v2-shadow-capture.test.ts drives this through a fake query
 * function only. The only sanctioned caller is `tools/v2/shadow-capture.ts`, which refuses any
 * target that is not an `afldb_v2_shadow[_<tag>]_test` copy.
 */
import {
  TABLE_ROW_COUNTS_FORMAT,
  TABLE_ROW_COUNTS_FORMAT_VERSION,
  validateTableRowCounts,
  type TableRowCount,
  type TableRowCounts,
} from '@afldb/domain';

export type RowCountsRow = Record<string, unknown>;
/** Runs one statement and returns its rows. The CLI binds it to a single postgres.js connection. */
export type RowCountsQuery = (statement: string) => Promise<readonly RowCountsRow[]>;

/** The schemas the migrations create (`CREATE SCHEMA` in src/db/migrations) plus `public`. */
export const DEFAULT_ROW_COUNT_SCHEMAS: readonly string[] = ['public', 'staging', 'staging_aflw', 'aflw', 'afldb_meta'];

export const ROW_COUNTS_SESSION_SQL = 'SET default_transaction_read_only = on';
export const ROW_COUNTS_BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
export const ROW_COUNTS_END_SQL = 'ROLLBACK';
export const ROW_COUNTS_TRANSACTION = 'repeatable read, read only, rolled back';
export const ROW_COUNTS_LOCAL_SETTINGS: readonly string[] = [
  `SET LOCAL statement_timeout = '900s'`,
  `SET LOCAL lock_timeout = '5s'`,
  `SET LOCAL idle_in_transaction_session_timeout = '300s'`,
  `SET LOCAL client_min_messages = warning`,
  `SET LOCAL search_path = pg_catalog`,
];
export const ROW_COUNTS_STATE_SQL = `SELECT current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('transaction_isolation') AS transaction_isolation,
       current_database() AS database_name,
       current_setting('server_version') AS server_version`;

/** Statement shapes this producer may issue; anything else is a defect and is never sent. */
export const ROW_COUNTS_STATEMENT_ALLOWLIST: readonly RegExp[] = [
  /^SET default_transaction_read_only = on$/,
  /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/,
  /^SET LOCAL [A-Za-z_]+ = [^;]+$/,
  /^SELECT current_setting\('transaction_read_only'\) AS transaction_read_only,\s+current_setting\('transaction_isolation'\) AS transaction_isolation,\s+current_database\(\) AS database_name,\s+current_setting\('server_version'\) AS server_version$/,
  /^SELECT nspname AS schema_name FROM pg_catalog\.pg_namespace WHERE nspname IN \('[a-z_][a-z0-9_]*'(?:, '[a-z_][a-z0-9_]*')*\)$/,
  /^SELECT n\.nspname AS schema_name, c\.relname AS table_name, c\.relkind::text AS kind, c\.relrowsecurity AS row_security\s+FROM pg_catalog\.pg_class c\s+JOIN pg_catalog\.pg_namespace n ON n\.oid = c\.relnamespace\s+WHERE n\.nspname IN \('[a-z_][a-z0-9_]*'(?:, '[a-z_][a-z0-9_]*')*\) AND c\.relkind IN \('r', 'p'\) AND NOT c\.relispartition\s+ORDER BY n\.nspname, c\.relname$/,
  /^SELECT count\(\*\)::text AS rows FROM (?:ONLY )?"[a-z_][a-z0-9_]*"\."[a-z_][a-z0-9_]*"$/,
  /^ROLLBACK$/,
];

export class RowCountsProducerRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowCountsProducerRefusal';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new RowCountsProducerRefusal(`refusing unsafe identifier ${JSON.stringify(name)}`);
  return `"${name}"`;
}
const literal = (name: string): string => `'${ident(name).slice(1, -1)}'`;
const inList = (schemas: readonly string[]): string => schemas.map(literal).join(', ');

/** Which requested schemas exist at all (a missing schema must be a refusal, not a silent gap). */
export function schemaExistsSql(schemas: readonly string[]): string {
  return `SELECT nspname AS schema_name FROM pg_catalog.pg_namespace WHERE nspname IN (${inList(schemas)})`;
}

/** Base tables (ordinary and partitioned parents; partitions are counted through their parent). */
export function rowCountCatalogSql(schemas: readonly string[]): string {
  return `SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind::text AS kind, c.relrowsecurity AS row_security
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN (${inList(schemas)}) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
 ORDER BY n.nspname, c.relname`;
}

/**
 * One exact count. An ordinary table is read with ONLY so an inheritance child is counted once,
 * under its own name; a partitioned parent has no rows of its own, so it is read WITHOUT ONLY,
 * which includes its partitions (they are not listed separately).
 */
export function rowCountSql(schema: string, table: string, partitionedParent = false): string {
  return `SELECT count(*)::text AS rows FROM ${partitionedParent ? '' : 'ONLY '}${ident(schema)}.${ident(table)}`;
}

export interface RowCountsOptions {
  /** Defaults to {@link DEFAULT_ROW_COUNT_SCHEMAS}. Each name must match `^[a-z_][a-z0-9_]*$`. */
  readonly schemas?: readonly string[];
  readonly now?: () => Date;
  /** When given, the connected `current_database()` must equal it (defence against a redirected DSN). */
  readonly expectedDatabase?: string;
}

const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function parseCount(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new RowCountsProducerRefusal(`${label}: the server returned a count that is not a decimal integer`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RowCountsProducerRefusal(`${label}: the count exceeds the safe integer range`);
  return n;
}

/**
 * Produces a COMPLETE inventory or throws. On any error the transaction is still rolled back and
 * nothing is returned, so a partial inventory cannot exist.
 */
export async function produceTableRowCounts(query: RowCountsQuery, options: RowCountsOptions = {}): Promise<TableRowCounts> {
  const requested = options.schemas ?? DEFAULT_ROW_COUNT_SCHEMAS;
  if (requested.length === 0) throw new RowCountsProducerRefusal('at least one schema is required');
  const schemas = [...new Set(requested)].sort(codeUnitCompare);
  for (const schema of schemas) ident(schema); // validate before any statement is built or sent
  const clock = options.now ?? (() => new Date());

  // Every statement passes the allowlist before it reaches the query function.
  const send = async (statement: string): Promise<readonly RowCountsRow[]> => {
    if (!ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(statement))) {
      throw new RowCountsProducerRefusal('refusing a statement that is not on the row-count allowlist');
    }
    return query(statement);
  };

  await send(ROW_COUNTS_SESSION_SQL);
  await send(ROW_COUNTS_BEGIN_SQL);
  let ending = false;
  try {
    for (const statement of ROW_COUNTS_LOCAL_SETTINGS) await send(statement);
    const [state] = await send(ROW_COUNTS_STATE_SQL);
    if (!state || state.transaction_read_only !== 'on') {
      throw new RowCountsProducerRefusal('the server does not report transaction_read_only = on; refusing to read');
    }
    if (state.transaction_isolation !== 'repeatable read') {
      throw new RowCountsProducerRefusal('the server does not report a repeatable read snapshot; refusing to read');
    }
    const database = String(state.database_name);
    if (options.expectedDatabase !== undefined && database !== options.expectedDatabase) {
      throw new RowCountsProducerRefusal(`connected to database '${database}', not the expected '${options.expectedDatabase}'; refusing to read`);
    }

    const present = new Set((await send(schemaExistsSql(schemas))).map((r) => String(r.schema_name)));
    const missing = schemas.filter((s) => !present.has(s));
    if (missing.length) throw new RowCountsProducerRefusal(`schema(s) not found (or not visible to this role): ${missing.join(', ')}`);

    const catalog = await send(rowCountCatalogSql(schemas));
    const seen = new Set<string>();
    const tables: TableRowCount[] = [];
    for (const entry of catalog) {
      const schema = String(entry.schema_name);
      const table = String(entry.table_name);
      const key = `${schema}.${table}`;
      if (!schemas.includes(schema)) throw new RowCountsProducerRefusal(`${key}: the catalog returned a schema that was not requested`);
      if (seen.has(key)) throw new RowCountsProducerRefusal(`${key}: listed twice by the catalog`);
      seen.add(key);
      if (entry.row_security === true || entry.row_security === 't') {
        throw new RowCountsProducerRefusal(`${key}: row-level security is enabled, so the count could be silently filtered`);
      }
      const kind = String(entry.kind);
      if (kind !== 'r' && kind !== 'p') throw new RowCountsProducerRefusal(`${key}: unexpected relation kind ${JSON.stringify(kind)}`);
      const [counted] = await send(rowCountSql(schema, table, kind === 'p'));
      tables.push({ schema, table, rows: parseCount(counted?.rows, key) });
    }
    tables.sort((a, b) => codeUnitCompare(`${a.schema}.${a.table}`, `${b.schema}.${b.table}`));

    const inventory: TableRowCounts = {
      format: TABLE_ROW_COUNTS_FORMAT,
      formatVersion: TABLE_ROW_COUNTS_FORMAT_VERSION,
      status: 'complete',
      producedAt: clock().toISOString(),
      source: { database, serverVersion: String(state.server_version), transaction: ROW_COUNTS_TRANSACTION },
      schemas,
      tables,
    };
    validateTableRowCounts(JSON.parse(JSON.stringify(inventory)) as unknown, 'the produced row-count inventory');
    ending = true;
    await send(ROW_COUNTS_END_SQL);
    return inventory;
  } catch (error) {
    // Roll back once, and never let a failing ROLLBACK mask the error that caused it.
    if (!ending) await query(ROW_COUNTS_END_SQL).catch(() => undefined);
    throw error;
  }
}
