/**
 * AFLDB V2 Stage 2 — the sealed historical baseline manifest (docs/v2/historical-manifest-spec.md).
 *
 * This module is the pure half: the table specification, the sealed-season rule, manifest
 * validation and the offline comparator. It performs no I/O and opens no connection. The
 * producer that reads a database lives in @afldb/db and is never run in Launch A.
 *
 * A manifest holds counts and sha256 digests only. It never holds row content, a connection
 * string, a host name or a credential.
 */

export const MANIFEST_FORMAT = 'afldb.v2.historical-baseline-manifest';
export const MANIFEST_FORMAT_VERSION = 1;
export const COMPARISON_FORMAT = 'afldb.v2.historical-baseline-comparison';
/** Bumped whenever HISTORICAL_TABLES or the digest recipe changes. */
export const MANIFEST_SPEC_VERSION = 1;

/** Columns that record where and when a row came from, digested apart from the facts. */
export const METADATA_COLUMNS: readonly string[] = [
  'source_id', 'source_record_id', 'import_batch_id', 'imported_at', 'created_at', 'updated_at',
];

export type HistoricalTableKind = 'fact' | 'reference';

/** A column read from the table's own row (`row`) or from its match (`match`, via `match_id`). */
export interface ColumnRef {
  readonly column: string;
  readonly via: 'row' | 'match';
}

export interface HistoricalTableSpec {
  readonly table: string;
  readonly kind: HistoricalTableKind;
  /** The season a row belongs to; null for reference tables, which form one bucket. */
  readonly season: ColumnRef | null;
  /** The ordered natural (or stable) key. Need not be unique: rows are also ordered by content. */
  readonly key: readonly ColumnRef[];
  /** True when `id` is an identity a rebuild renumbers: it is left out of the fact digest. */
  readonly surrogateId: boolean;
}

const row = (column: string): ColumnRef => ({ column, via: 'row' });
const match = (column: string): ColumnRef => ({ column, via: 'match' });

function fact(table: string, season: ColumnRef, key: ColumnRef[], surrogateId = false): HistoricalTableSpec {
  return { table, kind: 'fact', season, key, surrogateId };
}
function reference(table: string, key: ColumnRef[] = [row('id')]): HistoricalTableSpec {
  return { table, kind: 'reference', season: null, key, surrogateId: false };
}

/**
 * The tables the sealed baseline covers. Derived tables (rebuilt from these), staging, the
 * observation spine, audit ledgers, auth/operational tables and AFLW are out of scope; the
 * reasons are in docs/v2/historical-baseline.md §3.
 */
export const HISTORICAL_TABLES: readonly HistoricalTableSpec[] = [
  fact('seasons', row('year'), [row('year')]),
  fact('matches', row('season'), [row('match_key')]),
  fact('match_period_scores', match('season'), [match('match_key'), row('club_id'), row('period')]),
  fact('player_match_stats', match('season'), [match('match_key'), row('player_id')], true),
  fact('player_match_period_stats', match('season'), [match('match_key'), row('player_id'), row('period')], true),
  fact('match_coaches', match('season'), [match('match_key'), row('club_id')]),
  fact('brownlow_round_votes', row('season'), [row('season'), row('player_id'), row('round_number')], true),
  fact('brownlow_season_votes', row('season'), [row('season'), row('player_id')], true),
  fact('brownlow_season_authority', row('season'), [row('season')]),
  fact('club_seasons', row('season'), [row('season'), row('club_id')], true),
  fact('captaincies', row('season'), [row('season'), row('club_id'), row('player_id'), row('id')]),
  fact('award_winners', row('season'), [row('award_id'), row('season'), row('id')]),
  fact('award_nominations', row('season'), [row('award_id'), row('season'), row('id')]),
  fact('draft_picks', row('draft_year'), [row('draft_year'), row('id')]),
  fact('father_son_selections', row('draft_year'), [row('draft_year'), row('id')]),
  fact('player_achievements', row('season'), [row('season'), row('id')]),
  fact('after_siren_kicks', row('season'), [row('season'), row('id')]),
  fact('season_list_members', row('season'), [row('season'), row('player_id')]),
  fact('club_leadership', row('season'), [row('season'), row('id')]),
  reference('clubs'),
  reference('club_aliases'),
  reference('venues'),
  reference('venue_aliases'),
  reference('players'),
  reference('player_name_aliases'),
  reference('external_identities'),
  reference('draft_persons'),
  reference('player_relationships'),
  reference('awards'),
  reference('coaches'),
  reference('hall_of_fame'),
  reference('honour_team_members'),
];

// ---------------------------------------------------------------------------------------------
// Sealed seasons
// ---------------------------------------------------------------------------------------------

/** The subset of data/reference/seasons.json the sealed rule reads. */
export interface SeasonRegistry {
  readonly first_season: number;
  readonly last_season: number;
  readonly in_progress_seasons: readonly number[];
}

export interface SealedSeasons {
  readonly from: number;
  readonly through: number;
  /** Seasons inside [from, through] that are still in progress, and therefore not sealed. */
  readonly open: readonly number[];
}

/**
 * Sealed = every season from first_season to last_season that is not in progress. A season is
 * sealed once the rollover (tools/db/rollover-season.ts) removes it from in_progress_seasons.
 */
export function sealedSeasonsFrom(registry: SeasonRegistry): SealedSeasons {
  const { first_season: first, last_season: last, in_progress_seasons: inProgress } = registry;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error('seasons registry: first_season and last_season must be integers, first <= last');
  }
  if (!Array.isArray(inProgress) || inProgress.some((s) => !Number.isInteger(s))) {
    throw new Error('seasons registry: in_progress_seasons must be a list of integers');
  }
  let through = last;
  while (through >= first && inProgress.includes(through)) through -= 1;
  if (through < first) throw new Error('seasons registry: no season is sealed');
  const open = [...new Set(inProgress.filter((s) => s >= first && s < through))].sort((a, b) => a - b);
  return { from: first, through, open };
}

export function isSealedSeason(sealed: SealedSeasons, season: number | null): boolean {
  return season !== null && season >= sealed.from && season <= sealed.through && !sealed.open.includes(season);
}

// ---------------------------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------------------------

export interface ManifestBucket {
  /** null for a reference table, or for fact rows whose season is NULL. */
  readonly season: number | null;
  readonly sealed: boolean;
  readonly rows: number;
  /** sha256 of the ordered key list. */
  readonly keyDigest: string;
  /** sha256 of the ordered fact text (every column except metadata and excluded columns). */
  readonly factDigest: string;
  /** sha256 of the ordered metadata text; null when the table has no metadata column. */
  readonly metadataDigest: string | null;
}

export interface ManifestTable {
  readonly table: string;
  readonly kind: HistoricalTableKind;
  /** e.g. "row.season" or "match.season"; null for reference tables. */
  readonly season: string | null;
  /** e.g. ["match.match_key", "row.player_id"]. */
  readonly key: readonly string[];
  readonly factColumns: readonly string[];
  readonly metadataColumns: readonly string[];
  readonly excludedColumns: readonly string[];
  readonly buckets: readonly ManifestBucket[];
}

export interface HistoricalManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly formatVersion: number;
  readonly specVersion: number;
  readonly status: 'complete';
  readonly producedAt: string;
  readonly source: {
    readonly database: string;
    readonly serverVersion: string;
    readonly readOnlySource: boolean;
    readonly transaction: string;
  };
  readonly sealed: SealedSeasons;
  /** Set when fact columns were pinned to an earlier manifest (producer --pin-columns). */
  readonly pinnedTo: { readonly producedAt: string; readonly database: string } | null;
  readonly tables: readonly ManifestTable[];
}

export const describeColumnRef = (ref: ColumnRef): string => `${ref.via}.${ref.column}`;

export class ManifestFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestFormatError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function fail(label: string, message: string): never {
  throw new ManifestFormatError(`${label}: ${message}`);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function stringList(value: unknown, pattern?: RegExp): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && (!pattern || pattern.test(v)));
}

/** Validates a parsed manifest strictly; refuses anything that is not a COMPLETE manifest. */
export function validateManifest(value: unknown, label: string): HistoricalManifest {
  if (!isObject(value)) fail(label, 'not a JSON object');
  if (value.format !== MANIFEST_FORMAT) fail(label, `format is not ${MANIFEST_FORMAT}`);
  if (value.formatVersion !== MANIFEST_FORMAT_VERSION) fail(label, `unsupported formatVersion ${String(value.formatVersion)}`);
  if (!nonNegativeInteger(value.specVersion)) fail(label, 'specVersion is missing');
  if (value.status !== 'complete') fail(label, 'status is not "complete"; an incomplete manifest proves nothing');
  if (typeof value.producedAt !== 'string' || Number.isNaN(Date.parse(value.producedAt))) fail(label, 'producedAt is not a timestamp');
  const source = value.source;
  if (!isObject(source) || typeof source.database !== 'string' || typeof source.serverVersion !== 'string'
    || typeof source.readOnlySource !== 'boolean' || typeof source.transaction !== 'string') {
    fail(label, 'source must state database, serverVersion, readOnlySource and transaction');
  }
  const sealed = value.sealed;
  if (!isObject(sealed) || !Number.isInteger(sealed.from) || !Number.isInteger(sealed.through)
    || (sealed.from as number) > (sealed.through as number) || !Array.isArray(sealed.open)
    || !sealed.open.every((s) => Number.isInteger(s))) {
    fail(label, 'sealed must be { from, through, open[] } with from <= through');
  }
  const pinned = value.pinnedTo;
  if (pinned !== null && (!isObject(pinned) || typeof pinned.producedAt !== 'string' || typeof pinned.database !== 'string')) {
    fail(label, 'pinnedTo must be null or { producedAt, database }');
  }
  if (!Array.isArray(value.tables) || value.tables.length === 0) fail(label, 'tables must be a non-empty list');
  const seen = new Set<string>();
  for (const table of value.tables) {
    if (!isObject(table) || typeof table.table !== 'string' || !IDENTIFIER.test(table.table)) fail(label, 'a table entry has no valid name');
    const name = table.table as string;
    if (seen.has(name)) fail(label, `table ${name} appears twice`);
    seen.add(name);
    if (table.kind !== 'fact' && table.kind !== 'reference') fail(label, `${name}: kind must be fact or reference`);
    if (table.season !== null && typeof table.season !== 'string') fail(label, `${name}: season must be a string or null`);
    if (!stringList(table.key) || table.key.length === 0) fail(label, `${name}: key must be a non-empty list`);
    if (!stringList(table.factColumns, IDENTIFIER) || table.factColumns.length === 0) fail(label, `${name}: factColumns must be a non-empty list of column names`);
    if (!stringList(table.metadataColumns, IDENTIFIER)) fail(label, `${name}: metadataColumns must be a list of column names`);
    if (!stringList(table.excludedColumns, IDENTIFIER)) fail(label, `${name}: excludedColumns must be a list of column names`);
    if (!Array.isArray(table.buckets)) fail(label, `${name}: buckets must be a list`);
    const seasons = new Set<string>();
    for (const bucket of table.buckets) {
      if (!isObject(bucket)) fail(label, `${name}: a bucket is not an object`);
      if (bucket.season !== null && !Number.isInteger(bucket.season)) fail(label, `${name}: bucket season must be an integer or null`);
      const k = String(bucket.season);
      if (seasons.has(k)) fail(label, `${name}: season ${k} appears twice`);
      seasons.add(k);
      if (typeof bucket.sealed !== 'boolean') fail(label, `${name} ${k}: sealed must be a boolean`);
      if (!nonNegativeInteger(bucket.rows) || bucket.rows === 0) fail(label, `${name} ${k}: rows must be a positive integer`);
      if (typeof bucket.keyDigest !== 'string' || !SHA256.test(bucket.keyDigest)) fail(label, `${name} ${k}: keyDigest is not a sha256`);
      if (typeof bucket.factDigest !== 'string' || !SHA256.test(bucket.factDigest)) fail(label, `${name} ${k}: factDigest is not a sha256`);
      if (bucket.metadataDigest !== null && (typeof bucket.metadataDigest !== 'string' || !SHA256.test(bucket.metadataDigest))) {
        fail(label, `${name} ${k}: metadataDigest is not a sha256 or null`);
      }
    }
  }
  return value as unknown as HistoricalManifest;
}

export function parseManifest(text: string, label: string): HistoricalManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ManifestFormatError(`${label}: not valid JSON`);
  }
  return validateManifest(parsed, label);
}

// ---------------------------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------------------------

/**
 * violation  — a sealed fact or a reference row count changed; reconciliation must explain it.
 * unverified — the two manifests cannot prove the sealed scope equal (definitions differ).
 * review     — a change that may be legitimate (provenance re-stamped, reference rows edited).
 * info       — expected movement (open seasons, newly covered tables, wider sealed range).
 */
export type FindingSeverity = 'violation' | 'unverified' | 'review' | 'info';

export type FindingCode =
  | 'SPEC_VERSION_DIFFERS'
  | 'SEALED_RANGE_DIFFERS'
  | 'TABLE_MISSING'
  | 'TABLE_ADDED'
  | 'KIND_CHANGED'
  | 'KEY_DEFINITION_CHANGED'
  | 'SEASON_DEFINITION_CHANGED'
  | 'FACT_COLUMNS_CHANGED'
  | 'METADATA_COLUMNS_CHANGED'
  | 'ROWS_CHANGED'
  | 'KEYS_CHANGED'
  | 'FACTS_CHANGED'
  | 'METADATA_CHANGED'
  | 'REFERENCE_ROWS_DECREASED'
  | 'REFERENCE_CHANGED'
  | 'OPEN_SEASON_CHANGED';

export interface ComparisonFinding {
  readonly severity: FindingSeverity;
  readonly code: FindingCode;
  readonly table: string | null;
  readonly season: number | null;
  readonly detail: string;
}

export interface ManifestComparison {
  readonly format: typeof COMPARISON_FORMAT;
  readonly formatVersion: 1;
  readonly before: { readonly producedAt: string; readonly database: string };
  readonly after: { readonly producedAt: string; readonly database: string };
  /** The seasons sealed in BOTH manifests: the scope the verdict speaks for. */
  readonly comparedSealed: { readonly from: number; readonly through: number; readonly open: readonly number[] } | null;
  readonly verdict: 'sealed-scope-identical' | 'reconciliation-required';
  readonly counts: Readonly<Record<FindingSeverity, number>>;
  readonly findings: readonly ComparisonFinding[];
}

const EMPTY_BUCKET = { rows: 0, keyDigest: null, factDigest: null, metadataDigest: null } as const;
type BucketView = Pick<ManifestBucket, 'rows'> & {
  keyDigest: string | null; factDigest: string | null; metadataDigest: string | null;
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function intersectSealed(a: SealedSeasons, b: SealedSeasons): SealedSeasons | null {
  const from = Math.max(a.from, b.from);
  const through = Math.min(a.through, b.through);
  if (from > through) return null;
  const open = [...new Set([...a.open, ...b.open])].filter((s) => s >= from && s <= through).sort((x, y) => x - y);
  return { from, through, open };
}

/** Pure. Compares two validated manifests; the verdict covers the seasons sealed in both. */
export function compareManifests(before: HistoricalManifest, after: HistoricalManifest): ManifestComparison {
  const findings: ComparisonFinding[] = [];
  const add = (severity: FindingSeverity, code: FindingCode, table: string | null, season: number | null, detail: string) => {
    findings.push({ severity, code, table, season, detail });
  };

  if (before.specVersion !== after.specVersion) {
    add('review', 'SPEC_VERSION_DIFFERS', null, null, `spec version ${before.specVersion} -> ${after.specVersion}; tables are compared only where their definitions agree`);
  }
  const scope = intersectSealed(before.sealed, after.sealed);
  const describe = (s: SealedSeasons) => `${s.from}-${s.through}${s.open.length ? ` (open: ${s.open.join(', ')})` : ''}`;
  if (before.sealed.from !== after.sealed.from || before.sealed.through !== after.sealed.through
    || !sameList(before.sealed.open.map(String), after.sealed.open.map(String))) {
    add(scope ? 'info' : 'unverified', 'SEALED_RANGE_DIFFERS', null, null,
      `sealed ${describe(before.sealed)} -> ${describe(after.sealed)}; ${scope ? `comparing ${describe(scope)}` : 'no season is sealed in both'}`);
  }
  const inScope = (season: number | null) => scope !== null && isSealedSeason(scope, season);

  const afterTables = new Map(after.tables.map((t) => [t.table, t]));
  const beforeNames = new Set(before.tables.map((t) => t.table));
  for (const t of after.tables) {
    if (!beforeNames.has(t.table)) add('info', 'TABLE_ADDED', t.table, null, 'covered by the after manifest only');
  }

  for (const b of before.tables) {
    const a = afterTables.get(b.table);
    if (!a) {
      add('violation', 'TABLE_MISSING', b.table, null, 'covered by the before manifest but absent from the after manifest');
      continue;
    }
    if (a.kind !== b.kind) {
      add('unverified', 'KIND_CHANGED', b.table, null, `${b.kind} -> ${a.kind}`);
      continue;
    }
    if (!sameList(a.key, b.key)) {
      add('unverified', 'KEY_DEFINITION_CHANGED', b.table, null, `[${b.key.join(', ')}] -> [${a.key.join(', ')}]`);
      continue;
    }
    if (a.season !== b.season) {
      add('unverified', 'SEASON_DEFINITION_CHANGED', b.table, null, `${String(b.season)} -> ${String(a.season)}`);
      continue;
    }
    const factsComparable = sameList(a.factColumns, b.factColumns);
    if (!factsComparable) {
      add('unverified', 'FACT_COLUMNS_CHANGED', b.table, null,
        'the fact column sets differ, so fact digests are not comparable; re-produce the after manifest with --pin-columns <before manifest>');
    }
    const metadataComparable = sameList(a.metadataColumns, b.metadataColumns);
    if (!metadataComparable) {
      add('review', 'METADATA_COLUMNS_CHANGED', b.table, null, `[${b.metadataColumns.join(', ')}] -> [${a.metadataColumns.join(', ')}]`);
    }

    const seasons = new Set<string>([...b.buckets, ...a.buckets].map((x) => String(x.season)));
    const index = (list: readonly ManifestBucket[]) => new Map(list.map((x) => [String(x.season), x]));
    const bi = index(b.buckets);
    const ai = index(a.buckets);
    for (const key of [...seasons].sort()) {
      const season = key === 'null' ? null : Number(key);
      const x: BucketView = bi.get(key) ?? EMPTY_BUCKET;
      const y: BucketView = ai.get(key) ?? EMPTY_BUCKET;
      const rowsDiffer = x.rows !== y.rows;
      const keysDiffer = x.keyDigest !== y.keyDigest;
      const factsDiffer = factsComparable && x.factDigest !== y.factDigest;
      const metadataDiffer = metadataComparable && x.metadataDigest !== y.metadataDigest;
      if (!rowsDiffer && !keysDiffer && !factsDiffer && !metadataDiffer) continue;
      const counts = `rows ${x.rows} -> ${y.rows}`;

      if (b.kind === 'reference') {
        if (y.rows < x.rows) add('violation', 'REFERENCE_ROWS_DECREASED', b.table, null, `${counts}; reference rows are never deleted`);
        else add('review', 'REFERENCE_CHANGED', b.table, null,
          `${counts}; ${[keysDiffer && 'keys', factsDiffer && 'facts', metadataDiffer && 'metadata'].filter(Boolean).join(', ')} differ`);
        continue;
      }
      if (!inScope(season)) {
        add('info', 'OPEN_SEASON_CHANGED', b.table, season, `${counts}; season ${key} is not sealed in both manifests`);
        continue;
      }
      if (rowsDiffer) add('violation', 'ROWS_CHANGED', b.table, season, counts);
      if (keysDiffer) add('violation', 'KEYS_CHANGED', b.table, season, 'the ordered key list differs');
      if (factsDiffer) add('violation', 'FACTS_CHANGED', b.table, season, 'the ordered fact digest differs');
      if (metadataDiffer && !rowsDiffer && !keysDiffer && !factsDiffer) {
        add('review', 'METADATA_CHANGED', b.table, season, 'facts are identical; provenance or timestamps were re-stamped');
      }
    }
  }

  const counts: Record<FindingSeverity, number> = { violation: 0, unverified: 0, review: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const clean = counts.violation === 0 && counts.unverified === 0 && counts.review === 0 && scope !== null;
  return {
    format: COMPARISON_FORMAT,
    formatVersion: 1,
    before: { producedAt: before.producedAt, database: before.source.database },
    after: { producedAt: after.producedAt, database: after.source.database },
    comparedSealed: scope,
    verdict: clean ? 'sealed-scope-identical' : 'reconciliation-required',
    counts,
    findings,
  };
}

/** Exit status for a comparison: 0 when the sealed scope is identical, 1 otherwise. */
export const comparisonExitCode = (c: ManifestComparison): 0 | 1 => (c.verdict === 'sealed-scope-identical' ? 0 : 1);

export function renderComparison(c: ManifestComparison): string[] {
  const lines = [
    `before : ${c.before.database} at ${c.before.producedAt}`,
    `after  : ${c.after.database} at ${c.after.producedAt}`,
    `sealed : ${c.comparedSealed ? `${c.comparedSealed.from}-${c.comparedSealed.through}` : 'none in common'}`,
    `counts : ${c.counts.violation} violation, ${c.counts.unverified} unverified, ${c.counts.review} review, ${c.counts.info} info`,
  ];
  for (const f of c.findings) {
    lines.push(`  ${f.severity.toUpperCase().padEnd(10)} ${f.code.padEnd(26)} ${f.table ?? '-'}${f.season === null ? '' : ` ${f.season}`}: ${f.detail}`);
  }
  lines.push(`verdict: ${c.verdict}`);
  return lines;
}
