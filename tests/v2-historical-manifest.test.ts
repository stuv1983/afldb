/**
 * AFLDB V2 Stage 2 — the historical baseline manifest: table spec against the migrations, the
 * sealed-season rule, manifest validation, the offline comparator, the producer (through a fake
 * query function only) and its target refusals. No database, no network.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ManifestProducerRefusal,
  PRODUCER_BEGIN_SQL,
  PRODUCER_END_SQL,
  PRODUCER_SESSION_SQL,
  PRODUCER_STATEMENT_ALLOWLIST,
  bucketSql,
  planColumns,
  produceManifest,
  resolveProducerTarget,
  type ManifestRow,
} from '@afldb/db';
import {
  HISTORICAL_TABLES,
  METADATA_COLUMNS,
  ManifestFormatError,
  compareManifests,
  comparisonExitCode,
  parseManifest,
  sealedSeasonsFrom,
  validateManifest,
  type HistoricalManifest,
  type HistoricalTableSpec,
  type ManifestTable,
} from '@afldb/domain';

import { parseCliArgs, runCompare, CliUsageError } from '../tools/v2/historical-manifest';

const ROOT = process.cwd();
const FIXTURE = join(ROOT, 'tests/fixtures/v2/historical-manifest/before.synthetic.json');
const fixtureText = readFileSync(FIXTURE, 'utf8');
const before = (): HistoricalManifest => parseManifest(fixtureText, 'fixture');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object | null ? Mutable<T[K]> : T[K] };
const mutable = (m: HistoricalManifest) => clone(m) as unknown as Mutable<HistoricalManifest>;
const hex = (c: string) => c.repeat(64);

// ---------------------------------------------------------------------------------------------
// Static column map from the migrations (CREATE TABLE bodies, ADD COLUMN, add_provenance_columns)
// ---------------------------------------------------------------------------------------------
function migrationColumns(): Map<string, Set<string>> {
  const dir = join(ROOT, 'src/db/migrations');
  const tables = new Map<string, Set<string>>();
  const of = (name: string) => {
    const set = tables.get(name) ?? new Set<string>();
    tables.set(name, set);
    return set;
  };
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+) \(([\s\S]*?)\n\);/g)) {
      const cols = of(m[1]);
      for (const line of m[2].split('\n')) {
        const c = /^\s+([a-z_][a-z0-9_]*)\s+[a-z]/.exec(line);
        if (c && !['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].includes(c[1])) cols.add(c[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([a-z_]+)([^;]*);/g)) {
      for (const a of m[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/g)) of(m[1]).add(a[1]);
      const rename = /RENAME TO ([a-z_]+)/.exec(m[2]);
      if (rename) { tables.set(rename[1], of(m[1])); tables.delete(m[1]); }
    }
    for (const m of sql.matchAll(/add_provenance_columns\('([a-z_]+)'\)/g)) {
      for (const c of ['source_id', 'source_record_id', 'import_batch_id', 'imported_at']) of(m[1]).add(c);
    }
  }
  return tables;
}

describe('HISTORICAL_TABLES against the migrations', () => {
  const columns = migrationColumns();

  it('names each table once, and every table exists', () => {
    const names = HISTORICAL_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(columns.has(name), name).toBe(true);
  });

  it('every key, season and surrogate column exists where the spec reads it', () => {
    const matches = columns.get('matches')!;
    for (const spec of HISTORICAL_TABLES) {
      const own = columns.get(spec.table)!;
      const refs = [...spec.key, ...(spec.season ? [spec.season] : [])];
      for (const ref of refs) {
        const where = ref.via === 'match' ? matches : own;
        expect(where.has(ref.column), `${spec.table}: ${ref.via}.${ref.column}`).toBe(true);
      }
      if (refs.some((r) => r.via === 'match')) expect(own.has('match_id'), `${spec.table}.match_id`).toBe(true);
      if (spec.surrogateId) expect(own.has('id'), `${spec.table}.id`).toBe(true);
      expect(spec.kind === 'reference' ? spec.season === null : spec.season !== null, spec.table).toBe(true);
    }
  });

  it('leaves out derived, staging, ledger and auth tables', () => {
    const names = new Set(HISTORICAL_TABLES.map((t) => t.table));
    for (const excluded of ['player_club_season_stats', 'player_career_stats', 'player_clubs', 'data_edits',
      'canonical_applications', 'promotion_candidates', 'import_batches', 'auth_users', 'nl_search_log']) {
      expect(names.has(excluded), excluded).toBe(false);
    }
  });
});

describe('sealed seasons', () => {
  it('reads 1897-2025 from the real seasons registry (2026 in progress)', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, 'data/reference/seasons.json'), 'utf8'));
    expect(sealedSeasonsFrom(registry)).toEqual({ from: 1897, through: 2025, open: [] });
  });

  it('keeps an in-progress season inside the range open, and refuses nonsense', () => {
    expect(sealedSeasonsFrom({ first_season: 1897, last_season: 2026, in_progress_seasons: [2025, 2026] }))
      .toEqual({ from: 1897, through: 2024, open: [] });
    expect(sealedSeasonsFrom({ first_season: 1897, last_season: 2026, in_progress_seasons: [2020] }))
      .toEqual({ from: 1897, through: 2026, open: [2020] });
    expect(() => sealedSeasonsFrom({ first_season: 2000, last_season: 1999, in_progress_seasons: [] })).toThrow();
    expect(() => sealedSeasonsFrom({ first_season: 2026, last_season: 2026, in_progress_seasons: [2026] })).toThrow(/no season is sealed/);
  });
});

describe('manifest validation', () => {
  it('accepts the synthetic fixture', () => {
    expect(before().tables.map((t) => t.table)).toEqual(['matches', 'player_match_stats', 'players']);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['wrong format', JSON.stringify({ ...JSON.parse(fixtureText), format: 'x' }), /format is not/],
    ['incomplete', JSON.stringify({ ...JSON.parse(fixtureText), status: 'incomplete' }), /status is not "complete"/],
  ])('refuses %s', (_name, text, message) => {
    expect(() => parseManifest(text, 'm')).toThrow(ManifestFormatError);
    expect(() => parseManifest(text, 'm')).toThrow(message);
  });

  it('refuses a bad digest, a zero-row bucket, a duplicated season and an unsafe column name', () => {
    const cases: Array<[(m: Mutable<HistoricalManifest>) => void, RegExp]> = [
      [(m) => { m.tables[0].buckets[0].factDigest = 'abc'; }, /factDigest is not a sha256/],
      [(m) => { m.tables[0].buckets[0].rows = 0; }, /rows must be a positive integer/],
      [(m) => { m.tables[0].buckets[1].season = 2024; }, /appears twice/],
      [(m) => { m.tables[0].factColumns = ['id; drop']; }, /factColumns/],
      [(m) => { m.tables = []; }, /non-empty/],
    ];
    for (const [mutate, message] of cases) {
      const m = mutable(before());
      mutate(m);
      expect(() => validateManifest(m, 'm')).toThrow(message);
    }
  });
});

describe('compareManifests (offline)', () => {
  it('identical manifests: sealed scope identical, exit 0', () => {
    const c = compareManifests(before(), before());
    expect(c.verdict).toBe('sealed-scope-identical');
    expect(c.findings).toEqual([]);
    expect(comparisonExitCode(c)).toBe(0);
  });

  it('a changed sealed fact is a violation', () => {
    const after = mutable(before());
    after.tables[1].buckets[0].factDigest = hex('f');
    const c = compareManifests(before(), after as unknown as HistoricalManifest);
    expect(c.findings).toEqual([expect.objectContaining({ severity: 'violation', code: 'FACTS_CHANGED', table: 'player_match_stats', season: 2025 })]);
    expect(comparisonExitCode(c)).toBe(1);
  });

  it('a vanished sealed bucket reports rows, keys and facts changed', () => {
    const after = mutable(before());
    after.tables[0].buckets.splice(0, 1);
    const codes = compareManifests(before(), after as unknown as HistoricalManifest).findings.map((f) => f.code);
    expect(codes).toEqual(['ROWS_CHANGED', 'KEYS_CHANGED', 'FACTS_CHANGED']);
  });

  it('metadata-only change is review; open-season movement is info and still exit 0', () => {
    const meta = mutable(before());
    meta.tables[0].buckets[1].metadataDigest = hex('0');
    const c1 = compareManifests(before(), meta as unknown as HistoricalManifest);
    expect(c1.findings.map((f) => [f.severity, f.code])).toEqual([['review', 'METADATA_CHANGED']]);
    expect(comparisonExitCode(c1)).toBe(1);

    const open = mutable(before());
    open.tables[0].buckets[2].rows = 130;
    open.tables[0].buckets[2].factDigest = hex('a');
    const c2 = compareManifests(before(), open as unknown as HistoricalManifest);
    expect(c2.findings.map((f) => [f.severity, f.code, f.season])).toEqual([['info', 'OPEN_SEASON_CHANGED', 2026]]);
    expect(comparisonExitCode(c2)).toBe(0);
  });

  it('reference rows: a decrease is a violation, growth is review', () => {
    const shrink = mutable(before());
    shrink.tables[2].buckets[0].rows = 12999;
    expect(compareManifests(before(), shrink as unknown as HistoricalManifest).findings[0]).toMatchObject({ severity: 'violation', code: 'REFERENCE_ROWS_DECREASED' });
    const grow = mutable(before());
    grow.tables[2].buckets[0].rows = 13001;
    grow.tables[2].buckets[0].keyDigest = hex('1');
    expect(compareManifests(before(), grow as unknown as HistoricalManifest).findings[0]).toMatchObject({ severity: 'review', code: 'REFERENCE_CHANGED' });
  });

  it('different fact columns make the facts unverified, not silently equal', () => {
    const after = mutable(before());
    after.tables[1].factColumns.push('new_stat');
    after.tables[1].buckets[0].factDigest = hex('9');
    const findings = compareManifests(before(), after as unknown as HistoricalManifest).findings;
    expect(findings.map((f) => [f.severity, f.code])).toEqual([['unverified', 'FACT_COLUMNS_CHANGED']]);
  });

  it('a table missing from the after manifest is a violation; a new table is info', () => {
    const after = mutable(before());
    const [removed] = after.tables.splice(1, 1);
    after.tables.push({ ...removed, table: 'club_seasons' });
    const findings = compareManifests(before(), after as unknown as HistoricalManifest).findings;
    expect(findings.map((f) => [f.severity, f.code, f.table])).toEqual([
      ['info', 'TABLE_ADDED', 'club_seasons'],
      ['violation', 'TABLE_MISSING', 'player_match_stats'],
    ]);
  });

  it('a later manifest that seals 2026 compares only the seasons sealed in both', () => {
    const after = mutable(before());
    after.sealed.through = 2026;
    after.tables[0].buckets[2].sealed = true;
    after.tables[0].buckets[2].rows = 207;
    const c = compareManifests(before(), after as unknown as HistoricalManifest);
    expect(c.comparedSealed).toEqual({ from: 1897, through: 2025, open: [] });
    expect(c.findings.map((f) => [f.severity, f.code])).toEqual([['info', 'SEALED_RANGE_DIFFERS'], ['info', 'OPEN_SEASON_CHANGED']]);
    expect(c.verdict).toBe('sealed-scope-identical');
  });
});

// ---------------------------------------------------------------------------------------------
// The producer, through a fake query function
// ---------------------------------------------------------------------------------------------
const SPEC: readonly HistoricalTableSpec[] = HISTORICAL_TABLES.filter((t) => ['matches', 'player_match_stats', 'players'].includes(t.table));
const LIVE: Record<string, string[]> = {
  matches: ['id', 'season', 'match_key', 'home_score', 'away_score', 'source_id', 'source_record_id', 'import_batch_id', 'imported_at'],
  player_match_stats: ['id', 'player_id', 'match_id', 'club_id', 'kicks', 'goals', 'source_id', 'source_record_id', 'import_batch_id', 'imported_at'],
  players: ['id', 'first_name', 'surname'],
};

function fakeDatabase(options: { readOnly?: string; rowSecurity?: string; dropTable?: string; failOn?: RegExp } = {}) {
  const statements: string[] = [];
  const query = async (statement: string): Promise<ManifestRow[]> => {
    statements.push(statement);
    if (options.failOn?.test(statement)) throw new Error('synthetic failure');
    if (statement.startsWith('SELECT current_setting')) {
      return [{ transaction_read_only: options.readOnly ?? 'on', transaction_isolation: 'repeatable read', database_name: 'synthetic_test', server_version: '17.0' }];
    }
    if (statement.includes('pg_catalog.pg_attribute')) {
      return Object.entries(LIVE).filter(([t]) => t !== options.dropTable).flatMap(([table, cols]) =>
        cols.map((column_name, i) => ({ table_name: table, column_name, position: i + 1, row_security: table === options.rowSecurity })));
    }
    if (statement.includes('FROM ONLY public."players"')) {
      return [{ season: null, row_count: '13000', key_digest: hex('d'), fact_digest: hex('e'), metadata_digest: null }];
    }
    if (statement.includes('FROM ONLY public.')) {
      return [
        { season: '2025', row_count: '216', key_digest: hex('4'), fact_digest: hex('5'), metadata_digest: hex('6') },
        { season: '2026', row_count: '120', key_digest: hex('7'), fact_digest: hex('8'), metadata_digest: hex('9') },
      ];
    }
    return [];
  };
  return { statements, query };
}

const SEALED = { from: 1897, through: 2025, open: [] };
const CLOCK = () => new Date('2026-10-19T01:02:03.000Z');

describe('produceManifest (fake query function only)', () => {
  it('opens read-only, verifies read-only, issues only allowlisted statements and rolls back', async () => {
    const db = fakeDatabase();
    const manifest = await produceManifest(db.query, { sealed: SEALED, readOnlySource: false, tables: SPEC, clock: CLOCK });
    expect(db.statements[0]).toBe(PRODUCER_SESSION_SQL);
    expect(db.statements[1]).toBe(PRODUCER_BEGIN_SQL);
    expect(db.statements.at(-1)).toBe(PRODUCER_END_SQL);
    const stateAt = db.statements.findIndex((s) => s.startsWith('SELECT current_setting'));
    const firstRead = db.statements.findIndex((s) => s.includes('pg_catalog.pg_attribute'));
    expect(stateAt).toBeGreaterThan(1);
    expect(stateAt).toBeLessThan(firstRead);
    for (const s of db.statements) {
      expect(PRODUCER_STATEMENT_ALLOWLIST.some((re) => re.test(s)), s).toBe(true);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|COMMIT|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/);
    }
    expect(validateManifest(clone(manifest), 'produced')).toBeTruthy();
    expect(manifest.producedAt).toBe('2026-10-19T01:02:03.000Z');
    expect(manifest.source).toEqual({ database: 'synthetic_test', serverVersion: '17.0', readOnlySource: false, transaction: 'repeatable read, read only, rolled back' });
    const pms = manifest.tables.find((t) => t.table === 'player_match_stats')!;
    expect(pms.excludedColumns).toEqual(['id']);
    expect(pms.metadataColumns).toEqual(['source_id', 'source_record_id', 'import_batch_id', 'imported_at']);
    expect(pms.buckets.map((b) => [b.season, b.sealed, b.rows])).toEqual([[2025, true, 216], [2026, false, 120]]);
    expect(manifest.tables.find((t) => t.table === 'players')!.buckets).toEqual([
      { season: null, sealed: false, rows: 13000, keyDigest: hex('d'), factDigest: hex('e'), metadataDigest: null },
    ]);
  });

  it('carries no row content: only names, counts and digests', async () => {
    const manifest = await produceManifest(fakeDatabase().query, { sealed: SEALED, readOnlySource: false, tables: SPEC, clock: CLOCK });
    for (const t of manifest.tables) {
      expect(Object.keys(t).sort()).toEqual(['buckets', 'excludedColumns', 'factColumns', 'key', 'kind', 'metadataColumns', 'season', 'table']);
      for (const b of t.buckets) expect(Object.keys(b).sort()).toEqual(['factDigest', 'keyDigest', 'metadataDigest', 'rows', 'sealed', 'season']);
    }
  });

  it.each([
    ['the server is not read-only', { readOnly: 'off' }, /transaction_read_only = on/],
    ['row-level security hides rows', { rowSecurity: 'players' }, /row-level security/],
    ['a table is missing', { dropTable: 'players' }, /players: table not found/],
    ['a digest query fails', { failOn: /FROM ONLY public\."matches"/ }, /synthetic failure/],
  ])('refuses when %s, and still rolls back', async (_name, options, message) => {
    const db = fakeDatabase(options);
    await expect(produceManifest(db.query, { sealed: SEALED, readOnlySource: false, tables: SPEC, clock: CLOCK })).rejects.toThrow(message);
    expect(db.statements.at(-1)).toBe(PRODUCER_END_SQL);
    expect(db.statements.filter((s) => s === PRODUCER_END_SQL)).toHaveLength(1);
  });

  it('pins fact columns to an earlier manifest and refuses when a pinned column is gone', async () => {
    const pinned = before();
    const spec = SPEC.find((t) => t.table === 'player_match_stats')!;
    const pinnedTable = pinned.tables.find((t) => t.table === 'player_match_stats') as ManifestTable;
    const plan = planColumns(spec, [...LIVE.player_match_stats, 'new_stat'], pinnedTable);
    expect(plan.fact).toEqual(['player_id', 'match_id', 'club_id', 'kicks', 'goals']);
    expect(plan.excluded).toEqual(['id', 'new_stat']);
    expect(() => planColumns(spec, LIVE.player_match_stats.filter((c) => c !== 'kicks'), pinnedTable)).toThrow(/kicks no longer exist/);
    await expect(produceManifest(fakeDatabase().query, { sealed: SEALED, readOnlySource: false, tables: SPEC, pinned, clock: CLOCK }))
      .resolves.toMatchObject({ pinnedTo: { producedAt: pinned.producedAt, database: 'synthetic_fixture_test' } });
  });

  it('builds digest SQL with quoted identifiers, a C-collation order and the match join only when needed', () => {
    const pms = bucketSql(SPEC.find((t) => t.table === 'player_match_stats')!, ['id'], ['source_id']);
    expect(pms).toContain('FROM ONLY public."player_match_stats" AS t');
    expect(pms).toContain('JOIN public."matches" AS m ON m."id" = t."match_id"');
    expect(pms).toContain('jsonb_build_array(m."match_key", t."player_id")::text');
    expect(pms).toContain(`(to_jsonb(t) - ARRAY['id']::text[])::text`);
    expect(pms).toContain('ORDER BY k COLLATE "C", f COLLATE "C"');
    expect(pms).not.toContain(';');
    expect(bucketSql(SPEC.find((t) => t.table === 'players')!, [], [])).not.toContain('JOIN');
    expect(() => bucketSql({ ...SPEC[0], table: 'matches"; --' }, [], [])).toThrow(ManifestProducerRefusal);
  });

  it('every spec table yields allowlisted SQL', () => {
    for (const spec of HISTORICAL_TABLES) {
      const sql = bucketSql(spec, spec.surrogateId ? ['id'] : [], METADATA_COLUMNS.slice(0, 2));
      expect(PRODUCER_STATEMENT_ALLOWLIST.some((re) => re.test(sql)), spec.table).toBe(true);
    }
  });
});

describe('resolveProducerTarget', () => {
  const env = (extra: Record<string, string>) => ({ ...extra });
  const args = (over: Partial<{ dsnEnv: string | null; readOnlySource: boolean; confirmNonTest: boolean }> = {}) =>
    ({ dsnEnv: 'MANIFEST_DSN', readOnlySource: false, confirmNonTest: false, ...over });
  const NON_TEST = 'postgres://reader:s3cret-pw@db.invalid:5432/afldb_dev';

  it('accepts a _test database from the named variable', () => {
    expect(resolveProducerTarget(args(), env({ MANIFEST_DSN: 'postgres://u:p@h.invalid/afldb_test' })))
      .toEqual({ variable: 'MANIFEST_DSN', database: 'afldb_test', nonTestSource: false });
  });

  it('never falls back to DATABASE_URL', () => {
    expect(() => resolveProducerTarget(args({ dsnEnv: null }), env({ DATABASE_URL: 'postgres://u:p@h.invalid/afldb_test' })))
      .toThrow(/--dsn-env <VARIABLE> is required/);
  });

  it('refuses a non-_test database without both flags, and names the missing flag', () => {
    expect(() => resolveProducerTarget(args(), env({ MANIFEST_DSN: NON_TEST }))).toThrow(/--read-only-source and --i-understand/);
    expect(() => resolveProducerTarget(args({ readOnlySource: true }), env({ MANIFEST_DSN: NON_TEST }))).toThrow(/requires --i-understand-this-reads-a-non-test-database$/);
    expect(() => resolveProducerTarget(args({ confirmNonTest: true }), env({ MANIFEST_DSN: NON_TEST }))).toThrow(/requires --read-only-source$/);
    expect(resolveProducerTarget(args({ readOnlySource: true, confirmNonTest: true }), env({ MANIFEST_DSN: NON_TEST })))
      .toEqual({ variable: 'MANIFEST_DSN', database: 'afldb_dev', nonTestSource: true });
  });

  it('refuses unset, malformed, non-postgres and database-less DSNs without echoing them', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{}, /MANIFEST_DSN is not set/],
      [{ MANIFEST_DSN: 'not a url s3cret-pw' }, /not a valid connection URL/],
      [{ MANIFEST_DSN: 'mysql://u:s3cret-pw@h.invalid/afldb_test' }, /postgres:\/\//],
      [{ MANIFEST_DSN: 'postgres://u:s3cret-pw@h.invalid/' }, /must name exactly one database/],
    ];
    for (const [e, message] of cases) {
      let error: unknown;
      try { resolveProducerTarget(args(), e); } catch (err) { error = err; }
      expect(error).toBeInstanceOf(ManifestProducerRefusal);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain('s3cret-pw');
    }
    expect(() => resolveProducerTarget(args({ dsnEnv: 'lower-case' }), env({}))).toThrow(/must name an environment variable/);
  });

  it('refuses inside a test process, whatever the target', () => {
    expect(() => resolveProducerTarget(args(), { VITEST: 'true', MANIFEST_DSN: 'postgres://u:p@h.invalid/afldb_test' }))
      .toThrow(/never connects from a test process/);
  });
});

describe('CLI (compare only; produce is never run)', () => {
  let scratch: string | null = null;
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  it('parses both modes and refuses database options on compare', () => {
    expect(parseCliArgs(['compare', 'a.json', 'b.json', '--out', 'r.json'])).toEqual({ mode: 'compare', before: 'a.json', after: 'b.json', out: 'r.json' });
    expect(parseCliArgs(['produce', '--dsn-env', 'X', '--out', 'm.json', '--read-only-source', '--i-understand-this-reads-a-non-test-database']))
      .toEqual({ mode: 'produce', dsnEnv: 'X', out: 'm.json', pinColumns: null, readOnlySource: true, confirmNonTest: true });
    expect(() => parseCliArgs(['compare', 'a.json', 'b.json', '--dsn-env', 'X'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['produce', '--out'])).toThrow(/needs a value/);
    expect(() => parseCliArgs(['produce', '--dsn-env', 'X'])).toThrow(/needs --out/);
    expect(() => parseCliArgs(['drop'])).toThrow(/usage/);
  });

  it('compares two files offline, writes the report exclusively, and never overwrites it', () => {
    scratch = mkdtempSync(join(tmpdir(), 'afldb-v2-manifest-'));
    const after = mutable(before());
    after.tables[0].buckets[0].keyDigest = hex('b');
    const afterPath = join(scratch, 'after.json');
    writeFileSync(afterPath, JSON.stringify(after));
    const out = join(scratch, 'report.json');
    const result = runCompare(FIXTURE, afterPath, out);
    expect(result.code).toBe(1);
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ format: 'afldb.v2.historical-baseline-comparison', verdict: 'reconciliation-required' });
    expect(result.lines.at(-1)).toBe('verdict: reconciliation-required');
    expect(() => runCompare(FIXTURE, afterPath, out)).toThrow(/never overwritten/);
    expect(runCompare(FIXTURE, FIXTURE, null).code).toBe(0);
  });
});
