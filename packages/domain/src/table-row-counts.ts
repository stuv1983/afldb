/**
 * AFLDB V2 Stage 6 — the table row-count inventory format (shadow parity input).
 *
 * A row-count inventory is a content-free census of every base table in the named schemas of one
 * database: schema, table and exact row count, nothing else (no row value, no host, no role, no
 * connection string). Two inventories taken before and after a shadow rehearsal step are compared
 * by the shadow parity tool (`packages/derived/src/shadow-parity.ts`); the season-grained,
 * zero-tolerance check of sealed history is the historical manifest's job
 * (`./historical-manifest.ts`), not this one's. This census answers two narrower questions: did any
 * table disappear or lose rows, and did exactly the tables V2 adds (migrations 111, 112, 113 and 114) appear.
 *
 * Pure: no I/O, no database. The read-only producer lives in `@afldb/db`.
 */

export const TABLE_ROW_COUNTS_FORMAT = 'afldb.v2.table-row-counts';
export const TABLE_ROW_COUNTS_FORMAT_VERSION = 1;

/**
 * The only tables a V2 shadow rehearsal may add (documented expected deltas). Each is created by a
 * V2 additive migration and is reversible by that migration's comment-only ROLLBACK block:
 * `src/db/migrations/111_curated_award_proposals.sql` (award_proposals, award_proposal_decisions)
 * `src/db/migrations/112_derived_award_results.sql` (derived_award_results),
 * `src/db/migrations/113_brownlow_eligibility_decisions.sql` (brownlow_eligibility_decisions) and
 * `src/db/migrations/114_award_projections_and_curated_revisions.sql` (derived_award_projections).
 */
export const V2_ADDED_TABLES: readonly { readonly schema: string; readonly table: string; readonly migration: string }[] = [
  { schema: 'public', table: 'award_proposals', migration: '111_curated_award_proposals.sql' },
  { schema: 'public', table: 'award_proposal_decisions', migration: '111_curated_award_proposals.sql' },
  { schema: 'public', table: 'derived_award_results', migration: '112_derived_award_results.sql' },
  { schema: 'public', table: 'brownlow_eligibility_decisions', migration: '113_brownlow_eligibility_decisions.sql' },
  { schema: 'public', table: 'derived_award_projections', migration: '114_award_projections_and_curated_revisions.sql' },
];

export const isV2AddedTable = (schema: string, table: string): boolean =>
  V2_ADDED_TABLES.some((t) => t.schema === schema && t.table === table);

export interface TableRowCount {
  readonly schema: string;
  readonly table: string;
  readonly rows: number;
}

export interface TableRowCounts {
  readonly format: typeof TABLE_ROW_COUNTS_FORMAT;
  readonly formatVersion: typeof TABLE_ROW_COUNTS_FORMAT_VERSION;
  /** Only `complete` is ever written; a partial census is never a file. */
  readonly status: 'complete';
  readonly producedAt: string;
  readonly source: {
    /** The database NAME only (never host, port, role or connection string). */
    readonly database: string;
    readonly serverVersion: string;
    readonly transaction: string;
  };
  /** The schemas censused, sorted. Every base table in them is listed (zero-row tables included). */
  readonly schemas: readonly string[];
  /** Sorted by (schema, table) under code-unit order. */
  readonly tables: readonly TableRowCount[];
}

export class TableRowCountsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableRowCountsFormatError';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function fail(label: string, message: string): never {
  throw new TableRowCountsFormatError(`${label}: ${message}`);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Validates a parsed inventory strictly; refuses anything that is not a COMPLETE inventory. */
export function validateTableRowCounts(value: unknown, label: string): TableRowCounts {
  if (!isObject(value)) fail(label, 'not a JSON object');
  if (value.format !== TABLE_ROW_COUNTS_FORMAT) fail(label, `format is not ${TABLE_ROW_COUNTS_FORMAT}`);
  if (value.formatVersion !== TABLE_ROW_COUNTS_FORMAT_VERSION) {
    fail(label, `formatVersion is not ${TABLE_ROW_COUNTS_FORMAT_VERSION}`);
  }
  if (value.status !== 'complete') fail(label, 'status is not "complete"; an incomplete census proves nothing');
  if (typeof value.producedAt !== 'string' || Number.isNaN(Date.parse(value.producedAt))) {
    fail(label, 'producedAt is not a timestamp');
  }
  const source = value.source;
  if (!isObject(source) || typeof source.database !== 'string' || source.database.length === 0
    || typeof source.serverVersion !== 'string' || typeof source.transaction !== 'string') {
    fail(label, 'source must state database, serverVersion and transaction');
  }
  const schemas = value.schemas;
  if (!Array.isArray(schemas) || schemas.length === 0
    || !schemas.every((s) => typeof s === 'string' && IDENTIFIER.test(s))) {
    fail(label, 'schemas must be a non-empty list of schema names');
  }
  if (new Set(schemas).size !== schemas.length) fail(label, 'schemas lists a schema twice');
  const schemaSet = new Set(schemas as string[]);
  if (!Array.isArray(value.tables) || value.tables.length === 0) fail(label, 'tables must be a non-empty list');
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const entry of value.tables) {
    if (!isObject(entry) || typeof entry.schema !== 'string' || !IDENTIFIER.test(entry.schema)
      || typeof entry.table !== 'string' || !IDENTIFIER.test(entry.table)) {
      fail(label, 'a table entry has no valid schema and table name');
    }
    const key = `${entry.schema}.${entry.table}`;
    if (!schemaSet.has(entry.schema)) fail(label, `${key}: schema is not in schemas`);
    if (seen.has(key)) fail(label, `${key} appears twice`);
    seen.add(key);
    if (typeof entry.rows !== 'number' || !Number.isSafeInteger(entry.rows) || entry.rows < 0) {
      fail(label, `${key}: rows must be a non-negative safe integer`);
    }
    if (previous !== null && codeUnitCompare(previous, key) > 0) fail(label, `${key}: tables are not sorted`);
    previous = key;
  }
  return value as unknown as TableRowCounts;
}

export function parseTableRowCounts(text: string, label: string): TableRowCounts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TableRowCountsFormatError(`${label}: not valid JSON`);
  }
  return validateTableRowCounts(parsed, label);
}
