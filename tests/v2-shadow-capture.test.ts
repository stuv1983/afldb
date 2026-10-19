/**
 * AFLDB V2 Stage 6 — the read-only table row-count producer (`@afldb/db`, through a fake query
 * function only) and the `tools/v2/shadow-capture.ts row-counts` CLI (through injected deps only).
 * No database, no network, no file system. Every DSN, table and count is SYNTHETIC.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROW_COUNT_SCHEMAS,
  ROW_COUNTS_BEGIN_SQL,
  ROW_COUNTS_END_SQL,
  ROW_COUNTS_LOCAL_SETTINGS,
  ROW_COUNTS_SESSION_SQL,
  ROW_COUNTS_STATEMENT_ALLOWLIST,
  RowCountsProducerRefusal,
  produceTableRowCounts,
  rowCountCatalogSql,
  rowCountSql,
  schemaExistsSql,
  type RowCountsRow,
} from '@afldb/db';
import { TableRowCountsFormatError, parseTableRowCounts, validateTableRowCounts } from '@afldb/domain';

import {
  CaptureUsageError,
  SHADOW_CAPTURE_USAGE,
  parseCaptureArgs,
  redactDsn,
  runCli,
  type CaptureClient,
  type CaptureDeps,
} from '../tools/v2/shadow-capture';

const CLOCK = () => new Date('2026-10-20T01:02:03.000Z');
type Table = { schema: string; table: string; kind?: string; rls?: boolean };

// SYNTHETIC catalog, deliberately returned out of sorted order.
const TABLES: Table[] = [
  { schema: 'staging', table: 'raw_matches' },
  { schema: 'public', table: 'players' },
  { schema: 'afldb_meta', table: 'schema_migrations' },
  { schema: 'public', table: 'matches' },
  { schema: 'staging_aflw', table: 'aflw_players' },
  { schema: 'public', table: 'award_proposals' },
];
const COUNTS: Record<string, string> = {
  'staging.raw_matches': '12',
  'public.players': '13000',
  'afldb_meta.schema_migrations': '112',
  'public.matches': '16000',
  'staging_aflw.aflw_players': '0',
  'public.award_proposals': '3',
};

interface FakeOptions {
  readOnly?: string;
  isolation?: string;
  database?: string;
  tables?: Table[];
  counts?: Record<string, unknown>;
  present?: string[]; // schemas that exist; default: all five
  failOn?: RegExp;
  failRollback?: boolean;
  unfiltered?: boolean; // return catalog rows for schemas that were not requested
}

function fakeServer(options: FakeOptions = {}) {
  const statements: string[] = [];
  let rollbacks = 0;
  const present = options.present ?? ['public', 'staging', 'staging_aflw', 'aflw', 'afldb_meta'];
  const tables = options.tables ?? TABLES;
  const counts = options.counts ?? COUNTS;
  const query = async (statement: string): Promise<RowCountsRow[]> => {
    statements.push(statement);
    if (statement === ROW_COUNTS_END_SQL) {
      rollbacks += 1;
      if (options.failRollback) throw new Error('rollback failed');
      return [];
    }
    if (options.failOn?.test(statement)) throw new Error('synthetic failure');
    if (statement.startsWith('SELECT current_setting')) {
      return [{
        transaction_read_only: options.readOnly ?? 'on',
        transaction_isolation: options.isolation ?? 'repeatable read',
        database_name: options.database ?? 'afldb_v2_shadow_test',
        server_version: '17.0',
      }];
    }
    if (statement.startsWith('SELECT nspname')) {
      return present.filter((s) => statement.includes(`'${s}'`)).map((schema_name) => ({ schema_name }));
    }
    if (statement.includes('pg_catalog.pg_class')) {
      return tables.filter((t) => options.unfiltered || statement.includes(`'${t.schema}'`)).map((t) => ({ schema_name: t.schema, table_name: t.table, kind: t.kind ?? 'r', row_security: t.rls ?? false }));
    }
    const match = /FROM (?:ONLY )?"([a-z_0-9]+)"\."([a-z_0-9]+)"$/.exec(statement);
    if (match) {
      const key = `${match[1]}.${match[2]}`;
      return [{ rows: key in counts ? counts[key] : '0' }];
    }
    return [];
  };
  return { statements, query, rollbacks: () => rollbacks };
}

const isCount = (s: string) => s.startsWith('SELECT count(*)');
const produce = (server = fakeServer(), extra: Record<string, unknown> = {}) =>
  produceTableRowCounts(server.query, { now: CLOCK, ...extra });

// ---------------------------------------------------------------------------------------------
describe('produceTableRowCounts (fake query function only)', () => {
  it('issues exactly the documented statements in order and returns a valid sorted inventory', async () => {
    const db = fakeServer();
    const inventory = await produce(db);
    const schemas = [...DEFAULT_ROW_COUNT_SCHEMAS].sort();
    expect(db.statements).toEqual([
      ROW_COUNTS_SESSION_SQL,
      ROW_COUNTS_BEGIN_SQL,
      ...ROW_COUNTS_LOCAL_SETTINGS,
      expect.stringMatching(/^SELECT current_setting\('transaction_read_only'\)/),
      schemaExistsSql(schemas),
      rowCountCatalogSql(schemas),
      ...TABLES.map((t) => rowCountSql(t.schema, t.table)),
      ROW_COUNTS_END_SQL,
    ]);
    expect(inventory.producedAt).toBe('2026-10-20T01:02:03.000Z');
    expect(inventory.schemas).toEqual(['afldb_meta', 'aflw', 'public', 'staging', 'staging_aflw']);
    expect(inventory.tables).toEqual([
      { schema: 'afldb_meta', table: 'schema_migrations', rows: 112 },
      { schema: 'public', table: 'award_proposals', rows: 3 },
      { schema: 'public', table: 'matches', rows: 16000 },
      { schema: 'public', table: 'players', rows: 13000 },
      { schema: 'staging', table: 'raw_matches', rows: 12 },
      { schema: 'staging_aflw', table: 'aflw_players', rows: 0 },
    ]);
    expect(validateTableRowCounts(JSON.parse(JSON.stringify(inventory)), 'produced')).toBeTruthy();
    expect(parseTableRowCounts(JSON.stringify(inventory), 'round trip')).toEqual(inventory);
  });

  it('records the database NAME, server version and transaction description only', async () => {
    const inventory = await produce();
    expect(inventory.source).toEqual({ database: 'afldb_v2_shadow_test', serverVersion: '17.0', transaction: 'repeatable read, read only, rolled back' });
    expect(Object.keys(inventory).sort()).toEqual(['format', 'formatVersion', 'producedAt', 'schemas', 'source', 'status', 'tables']);
    for (const t of inventory.tables) expect(Object.keys(t).sort()).toEqual(['rows', 'schema', 'table']);
  });

  it('asserts read-only mode before any catalog or count statement', async () => {
    const db = fakeServer();
    await produce(db);
    const stateAt = db.statements.findIndex((s) => s.startsWith('SELECT current_setting'));
    const firstRead = db.statements.findIndex((s) => s.includes('pg_catalog.pg_') || isCount(s));
    expect(db.statements[0]).toBe(ROW_COUNTS_SESSION_SQL);
    expect(db.statements[1]).toBe(ROW_COUNTS_BEGIN_SQL);
    expect(stateAt).toBeGreaterThan(1);
    expect(stateAt).toBeLessThan(firstRead);

    const writable = fakeServer({ readOnly: 'off' });
    await expect(produce(writable)).rejects.toThrow(/transaction_read_only = on/);
    expect(writable.statements.some((s) => s.includes('pg_catalog.pg_') || isCount(s))).toBe(false);
    expect(writable.rollbacks()).toBe(1);
  });

  it('refuses a non-repeatable-read snapshot, an unexpected database and a missing schema', async () => {
    const snapshot = fakeServer({ isolation: 'read committed' });
    await expect(produce(snapshot)).rejects.toThrow(/repeatable read snapshot/);
    expect(snapshot.statements.some(isCount)).toBe(false);
    const redirected = fakeServer({ database: 'afldb_prod' });
    await expect(produce(redirected, { expectedDatabase: 'afldb_v2_shadow_test' })).rejects.toThrow(/connected to database 'afldb_prod', not the expected 'afldb_v2_shadow_test'/);
    expect(redirected.statements.some(isCount)).toBe(false);
    const gap = fakeServer({ present: ['public', 'staging', 'staging_aflw', 'aflw'] });
    await expect(produce(gap)).rejects.toThrow(/schema\(s\) not found.*afldb_meta/);
    expect(gap.statements.some(isCount)).toBe(false);
    for (const db of [snapshot, redirected, gap]) expect(db.rollbacks()).toBe(1);
  });

  it('refuses row-level security, an unexpected relation kind and a duplicate catalog row', async () => {
    for (const [tables, message] of [
      [[{ schema: 'public', table: 'players', rls: true }], /row-level security/],
      [[{ schema: 'public', table: 'players', kind: 'v' }], /unexpected relation kind/],
      [[{ schema: 'public', table: 'players' }, { schema: 'public', table: 'players' }], /listed twice/],
      [[{ schema: 'elsewhere', table: 'players' }], /schema that was not requested/],
    ] as const) {
      const db = fakeServer({ tables: [...tables], unfiltered: true });
      await expect(produce(db)).rejects.toThrow(message);
      expect(db.rollbacks()).toBe(1);
    }
  });

  it('counts an ordinary table with ONLY and a partitioned parent without it', async () => {
    const db = fakeServer({ tables: [{ schema: 'public', table: 'plain' }, { schema: 'public', table: 'parted', kind: 'p' }], counts: { 'public.plain': '4', 'public.parted': '9' } });
    const inventory = await produce(db);
    expect(db.statements).toContain('SELECT count(*)::text AS rows FROM ONLY "public"."plain"');
    expect(db.statements).toContain('SELECT count(*)::text AS rows FROM "public"."parted"');
    expect(inventory.tables.map((t) => t.rows)).toEqual([9, 4]);
  });

  it('an empty schema (views only, such as aflw) contributes nothing yet validation passes', async () => {
    const inventory = await produce();
    expect(inventory.tables.some((t) => t.schema === 'aflw')).toBe(false);
    expect(inventory.schemas).toContain('aflw');
  });

  it('refuses when no base table exists at all (the format needs a non-empty census) and still rolls back', async () => {
    const db = fakeServer({ tables: [] });
    await expect(produce(db)).rejects.toBeInstanceOf(TableRowCountsFormatError);
    expect(db.rollbacks()).toBe(1);
  });

  it('honours --schema, de-duplicates it and refuses an unsafe name before sending any statement', async () => {
    const db = fakeServer();
    await produce(db, { schemas: ['public', 'public'] });
    expect(db.statements).toContain(schemaExistsSql(['public']));
    for (const bad of ['Public', 'pub"lic', "x'; DROP TABLE y; --", '1abc', '', 'a-b', 'a b']) {
      const fresh = fakeServer();
      await expect(produce(fresh, { schemas: [bad] })).rejects.toBeInstanceOf(RowCountsProducerRefusal);
      expect(fresh.statements).toEqual([]);
    }
    const none = fakeServer();
    await expect(produce(none, { schemas: [] })).rejects.toThrow(/at least one schema/);
    expect(none.statements).toEqual([]);
  });

  it('refuses an unsafe table name from the catalog, sends no count for it, and rolls back once', async () => {
    const db = fakeServer({ tables: [{ schema: 'public', table: 'Bad"Name' }] });
    await expect(produce(db)).rejects.toThrow(/unsafe identifier/);
    expect(db.statements.some(isCount)).toBe(false);
    expect(db.rollbacks()).toBe(1);
  });

  it('every statement it sends is on the allowlist and none can write', async () => {
    const db = fakeServer();
    await produce(db);
    for (const s of db.statements) {
      expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(s)), s).toBe(true);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|COMMIT|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE)\b/);
    }
  });

  it.each([
    'DROP TABLE "public"."players"',
    'COMMIT',
    'SET default_transaction_read_only = off',
    'BEGIN',
    'BEGIN ISOLATION LEVEL REPEATABLE READ',
    'SELECT count(*)::text AS rows FROM ONLY "public"."players"; DROP TABLE x',
    'SELECT count(*)::text AS rows FROM ONLY "Public"."players"',
    'SELECT count(*)::text AS rows FROM ONLY public.players',
    'SELECT count(*) FROM "public"."players"',
    'SELECT * FROM "public"."players"',
    'SELECT pg_sleep(1)',
    'SELECT nspname AS schema_name FROM pg_catalog.pg_namespace WHERE nspname IN (\'public\'); DROP TABLE x',
    'SELECT nspname AS schema_name FROM pg_catalog.pg_namespace WHERE nspname IN (\'Public\')',
    'INSERT INTO t VALUES (1)',
    'ROLLBACK; COMMIT',
    'SET LOCAL statement_timeout = 1; DROP TABLE x',
    'SET search_path = public',
  ])('the allowlist refuses %j', (statement) => {
    expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(statement))).toBe(false);
  });

  it('the allowlist accepts the statements the producer builds, and nothing broader', () => {
    expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(rowCountCatalogSql(['public', 'aflw'])))).toBe(true);
    expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(schemaExistsSql(['public', 'aflw'])))).toBe(true);
    expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(rowCountSql('public', 'players')))).toBe(true);
    expect(ROW_COUNTS_STATEMENT_ALLOWLIST.some((re) => re.test(`${rowCountSql('public', 'players')}; DROP`))).toBe(false);
  });

  it.each([
    ['a non-integer', '12.5'],
    ['a negative', '-1'],
    ['an exponent', '1e3'],
    ['a leading zero', '007'],
    ['an empty string', ''],
    ['whitespace', ' 5'],
    ['null', null],
    ['undefined', undefined],
    ['a JS number', 5],
    ['beyond the safe range', '9007199254740993'],
  ])('refuses %s as a count, and rolls back once', async (_label, value) => {
    const db = fakeServer({ tables: [{ schema: 'public', table: 'players' }], counts: { 'public.players': value } });
    await expect(produce(db)).rejects.toThrow(/public\.players: the (server returned a count that is not a decimal integer|count exceeds)/);
    expect(db.rollbacks()).toBe(1);
  });

  it('accepts zero and the largest safe integer', async () => {
    const db = fakeServer({ tables: [{ schema: 'public', table: 'a' }, { schema: 'public', table: 'b' }], counts: { 'public.a': '0', 'public.b': '9007199254740991' } });
    expect((await produce(db)).tables.map((t) => t.rows)).toEqual([0, 9007199254740991]);
  });

  it('rolls back exactly once on success and on every failure point', async () => {
    const ok = fakeServer();
    await produce(ok);
    expect(ok.rollbacks()).toBe(1);
    expect(ok.statements.at(-1)).toBe(ROW_COUNTS_END_SQL);
    for (const failOn of [/statement_timeout/, /^SELECT current_setting/, /^SELECT nspname/, /pg_catalog\.pg_class/, /"public"\."matches"$/]) {
      const db = fakeServer({ failOn });
      await expect(produce(db)).rejects.toThrow('synthetic failure');
      expect(db.rollbacks()).toBe(1);
      expect(db.statements.at(-1)).toBe(ROW_COUNTS_END_SQL);
    }
  });

  it('a failing ROLLBACK never masks the original error and is attempted once', async () => {
    const db = fakeServer({ failOn: /"public"\."matches"$/, failRollback: true });
    await expect(produce(db)).rejects.toThrow('synthetic failure');
    expect(db.rollbacks()).toBe(1);
  });

  it('a failing final ROLLBACK returns no inventory and is not retried', async () => {
    const db = fakeServer({ failRollback: true });
    await expect(produce(db)).rejects.toThrow('rollback failed');
    expect(db.rollbacks()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The CLI, through injected deps
// ---------------------------------------------------------------------------------------------
const PASSWORD = 'pw-s3cret-XYZ';
const HOST = 'db-host.invalid';
const dsnFor = (database: string) => `postgres://shadow_user:${PASSWORD}@${HOST}:5432/${database}`;
const SHADOW_DSN = dsnFor('afldb_v2_shadow_test');

function harness(over: { env?: Record<string, string | undefined>; server?: ReturnType<typeof fakeServer>; existing?: string[]; noClient?: boolean; clientFails?: string } = {}) {
  const server = over.server ?? fakeServer();
  const files = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const calls = { created: 0, ended: 0 };
  const deps: CaptureDeps = {
    env: over.env ?? { SHADOW_DATABASE_URL: SHADOW_DSN },
    ...(over.noClient ? {} : {
      createClient: (): CaptureClient => {
        calls.created += 1;
        return {
          query: over.clientFails ? async () => { throw new Error(over.clientFails); } : server.query,
          end: async () => { calls.ended += 1; },
        };
      },
    }),
    exists: (path) => files.has(path) || (over.existing ?? []).includes(path),
    writeExclusive: (path, text) => {
      if (files.has(path)) throw new Error('EEXIST');
      files.set(path, text);
    },
    clock: CLOCK,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  return { deps, server, files, out, err, calls };
}
const ARGS = ['row-counts', '--dsn-env', 'SHADOW_DATABASE_URL', '--out', 'inventory.json'];
const allOutput = (h: { out: string[]; err: string[] }) => [...h.out, ...h.err].join('\n');

describe('shadow-capture row-counts', () => {
  it('writes a valid inventory, ends the client once, and prints the path and table count', async () => {
    const h = harness();
    expect(await runCli(ARGS, h.deps)).toBe(0);
    expect([...h.files.keys()]).toEqual(['inventory.json']);
    const inventory = parseTableRowCounts(h.files.get('inventory.json') as string, 'written');
    expect(inventory.tables).toHaveLength(TABLES.length);
    expect(inventory.source.database).toBe('afldb_v2_shadow_test');
    expect(h.files.get('inventory.json')?.endsWith('}\n')).toBe(true);
    expect(h.calls).toEqual({ created: 1, ended: 1 });
    expect(h.server.rollbacks()).toBe(1);
    expect(h.out.some((l) => l.includes('written  : inventory.json (6 tables; counts only)'))).toBe(true);
    expect(h.out.some((l) => l.includes("database 'afldb_v2_shadow_test' from SHADOW_DATABASE_URL"))).toBe(true);
    expect(allOutput(h)).not.toContain(PASSWORD);
    expect(allOutput(h)).not.toContain(HOST);
    expect(h.files.get('inventory.json')).not.toContain(PASSWORD);
    expect(h.files.get('inventory.json')).not.toContain(HOST);
  });

  it('passes --schema through (repeatable) and defaults to the five migration schemas', async () => {
    const custom = harness({ server: fakeServer({ present: ['public', 'staging'] }) });
    expect(await runCli([...ARGS, '--schema', 'public', '--schema', 'staging'], custom.deps)).toBe(0);
    expect(parseTableRowCounts(custom.files.get('inventory.json') as string, 'x').schemas).toEqual(['public', 'staging']);
    expect(parseCaptureArgs(ARGS).schemas).toEqual(DEFAULT_ROW_COUNT_SCHEMAS);
  });

  it.each([
    ['no subcommand', []],
    ['an unknown subcommand', ['manifest', '--dsn-env', 'SHADOW_DATABASE_URL', '--out', 'x.json']],
    ['two subcommands', ['row-counts', 'row-counts', '--dsn-env', 'SHADOW_DATABASE_URL', '--out', 'x.json']],
    ['an unknown option', [...ARGS, '--force']],
    ['a --dsn-env with no value', ['row-counts', '--out', 'x.json', '--dsn-env']],
    ['--dsn-env twice', [...ARGS, '--dsn-env', 'OTHER_DATABASE_URL']],
    ['--out twice', [...ARGS, '--out', 'b.json']],
    ['a missing --dsn-env', ['row-counts', '--out', 'x.json']],
    ['a lower-case --dsn-env', ['row-counts', '--dsn-env', 'shadow', '--out', 'x.json']],
    ['a missing --out', ['row-counts', '--dsn-env', 'SHADOW_DATABASE_URL']],
  ])('refuses %s with exit 2, no connection and nothing written', async (_label, argv) => {
    const h = harness();
    expect(await runCli(argv, h.deps)).toBe(2);
    expect(h.files.size).toBe(0);
    expect(h.calls.created).toBe(0);
    expect(h.err.join('\n')).toMatch(/^REFUSED: /);
    expect(allOutput(h)).not.toContain(PASSWORD);
  });

  it('refuses an unset or blank DSN variable', async () => {
    for (const env of [{}, { SHADOW_DATABASE_URL: '' }, { SHADOW_DATABASE_URL: '   ' }]) {
      const h = harness({ env });
      expect(await runCli(ARGS, h.deps)).toBe(2);
      expect(h.err.join('\n')).toContain('SHADOW_DATABASE_URL is not set');
      expect(h.calls.created).toBe(0);
    }
  });

  it('never falls back to DATABASE_URL', async () => {
    const h = harness({ env: { DATABASE_URL: SHADOW_DSN } });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.calls.created).toBe(0);
  });

  it.each([
    ['afldb_test'],
    ['afldb_restore_test'],
    ['afldb_dev'],
    ['afldb'],
    ['afldb_prod'],
    ['code_test_db'],
    ['postgres'],
    ['afldb_v2_shadow'],
    ['afldb_v2_shadow_test_x'],
    ['xafldb_v2_shadow_test'],
  ])('refuses a DSN naming %s: variable and database NAME only, no connection, nothing written', async (name) => {
    const h = harness({ env: { SHADOW_DATABASE_URL: dsnFor(name) } });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.files.size).toBe(0);
    expect(h.calls.created).toBe(0);
    expect(h.err.join('\n')).toContain(`SHADOW_DATABASE_URL names the database '${name}'`);
    expect(allOutput(h)).not.toContain(PASSWORD);
    expect(allOutput(h)).not.toContain(HOST);
    expect(allOutput(h)).not.toContain('shadow_user');
  });

  it('refuses a keyword-form, non-postgres or database-less DSN without echoing it', async () => {
    for (const value of [`host=${HOST} dbname=afldb_v2_shadow_test user=u password=${PASSWORD}`, `mysql://u:${PASSWORD}@${HOST}/afldb_v2_shadow_test`, `postgres://u:${PASSWORD}@${HOST}/`]) {
      const h = harness({ env: { SHADOW_DATABASE_URL: value } });
      expect(await runCli(ARGS, h.deps)).toBe(2);
      expect(h.err.join('\n')).toContain('no readable database');
      expect(h.calls.created).toBe(0);
      expect(allOutput(h)).not.toContain(PASSWORD);
      expect(allOutput(h)).not.toContain(HOST);
    }
  });

  it('has no override flag: a force or confirmation option is an unknown option', async () => {
    for (const flag of ['--force', '--i-understand-this-reads-a-non-test-database', '--read-only-source', '--allow-non-shadow']) {
      const h = harness({ env: { SHADOW_DATABASE_URL: dsnFor('afldb_test') } });
      expect(await runCli([...ARGS, flag], h.deps)).toBe(2);
      expect(h.err.join('\n')).toContain(`unknown option ${flag}`);
      expect(h.calls.created).toBe(0);
    }
  });

  it('refuses an existing --out file and never overwrites it', async () => {
    const h = harness({ existing: ['inventory.json'] });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain('already exists');
    expect(h.calls.created).toBe(0);
    expect(h.files.size).toBe(0);
  });

  it('refuses inside a test process unless a client is injected', async () => {
    const h = harness({ noClient: true, env: { SHADOW_DATABASE_URL: SHADOW_DSN, VITEST: 'true' } });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain('never connects from a test process');
    expect(h.files.size).toBe(0);
  });

  it('exit 2, nothing written, client ended once, DSN redacted when the connection fails', async () => {
    const h = harness({ clientFails: `connection to ${SHADOW_DSN} refused (user shadow_user, password ${PASSWORD})` });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.files.size).toBe(0);
    expect(h.calls).toEqual({ created: 1, ended: 1 });
    expect(h.err.join('\n')).toMatch(/^FAILED: /);
    expect(allOutput(h)).not.toContain(PASSWORD);
    expect(allOutput(h)).not.toContain(HOST);
    expect(allOutput(h)).not.toContain('shadow_user');
  });

  it('exit 2 and nothing written when the connected database is not the DSN database', async () => {
    const h = harness({ server: fakeServer({ database: 'afldb_prod' }) });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain("connected to database 'afldb_prod'");
    expect(h.files.size).toBe(0);
    expect(h.calls.ended).toBe(1);
    expect(h.server.rollbacks()).toBe(1);
  });

  it('exit 2 and nothing written when the server is not read-only', async () => {
    const h = harness({ server: fakeServer({ readOnly: 'off' }) });
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.files.size).toBe(0);
    expect(h.calls.ended).toBe(1);
  });

  it('exit 2 when the exclusive create loses a race, and the client is still ended', async () => {
    const h = harness();
    h.deps = { ...h.deps, writeExclusive: () => { throw new Error('EEXIST: file already exists'); } };
    expect(await runCli(ARGS, h.deps)).toBe(2);
    expect(h.calls.ended).toBe(1);
  });

  it('parseCaptureArgs and the usage text', () => {
    expect(parseCaptureArgs(ARGS)).toEqual({ dsnEnv: 'SHADOW_DATABASE_URL', out: 'inventory.json', schemas: DEFAULT_ROW_COUNT_SCHEMAS });
    expect(() => parseCaptureArgs([])).toThrow(SHADOW_CAPTURE_USAGE);
    expect(() => parseCaptureArgs(['row-counts', '--bad'])).toThrow(CaptureUsageError);
    expect(SHADOW_CAPTURE_USAGE).toBe('usage: shadow-capture.ts row-counts --dsn-env <VARIABLE> --out <inventory.json> [--schema <name> ...]');
  });

  it('redactDsn removes the whole DSN, the password (raw and decoded) and the user', () => {
    const dsn = 'postgres://some_user:p%40ss-word-1@h.invalid/afldb_v2_shadow_test';
    const text = redactDsn(`bad ${dsn}; user some_user; pw p%40ss-word-1; decoded p@ss-word-1`, dsn);
    expect(text).not.toContain('some_user');
    expect(text).not.toContain('p%40ss-word-1');
    expect(text).not.toContain('p@ss-word-1');
    expect(redactDsn('keyword form host=x', 'host=x password=y')).toBe('keyword form host=x');
  });
});
