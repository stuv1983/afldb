/**
 * AFLDB V2 plan D5 (review resolutions R-001..R-004) — production-connection refusal.
 *
 * Proves, without any database:
 *   - the setup policy (@afldb/testing, packages/testing/src/dsn-policy.ts) on plain env objects;
 *   - that THIS test process, after tests/setup.ts ran, holds no connection variable that could
 *     reach a non-test database;
 *   - that src/db/client.ts and src/db/authClient.ts refuse a production-looking DSN inside a test
 *     process before any pool is built, and that the guard is a no-op outside one;
 *   - that tools/current-season/load-env.ts never rehydrates a connection variable from a `.env`
 *     inside a test process, and is unchanged outside one.
 *
 * The present-DSN branch is proved here on env objects only: it is unverified on a live database
 * (none exists on the V2 workstation; docs/v2/known-gaps.md).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  adminDsnFor,
  applyTestDsnPolicy,
  assertAdminServerIdentity,
  assertPerFileAdminDsnAllowed,
  assertPerFileBaseAllowed,
  assertPerFileDroppable,
  assertPerFilePrefix,
  checkAdminServerIdentity,
  createPerFileDatabase,
  createPerFileLedger,
  dropPerFileDatabase,
  isDsnVariable,
  LIBPQ_CONNECTION_VARIABLES,
  MIN_SWEEP_AGE_MS,
  parsePerFileDatabaseName,
  perFileAppliesTo,
  perFileDatabaseName,
  perFileDatabasesCreatedByThisProcess,
  perFileModeOf,
  reapLedgerDatabases,
  redirectDsn,
  redirectEnvToDatabase,
  selectStalePerFileDatabases,
  sweepStalePerFileDatabases,
  type AdminSql,
  type DsnEnv,
} from '@afldb/testing';
import {
  assertTestProcessDsn,
  isTestProcess,
  testProcessDsnRefusal,
} from '@/db/test-process-guard';
import { isConnectionVariableName, loadEnv } from '../tools/current-season/load-env';
import { COMMITTED_FIXTURE_SEASONS, COMMITTING_SUITES } from './integration/leaked-fixtures';

// Captured at module evaluation, i.e. immediately after tests/setup.ts applied the policy and
// before any test in this file could change process.env.
const ENV_AFTER_SETUP: DsnEnv = { ...process.env };

const PROD = 'postgresql://afldb_import:s3cret-prod-pw@db.example.com:5432/afldb_prod';
const DEV = 'postgresql://afldb_import:s3cret-dev-pw@127.0.0.1:5432/afldb_dev';
const TEST = 'postgresql://afldb_owner:pw@127.0.0.1:55432/afldb_test';

describe('applyTestDsnPolicy — no test database (strip, never throw)', () => {
  it('removes every *DATABASE_URL* variable and the libpq connection variables, and does not throw', () => {
    const env: DsnEnv = {
      DATABASE_URL: PROD,
      AFLDB_IMPORT_DATABASE_URL: DEV,
      AFLDB_AUTH_DATABASE_URL: PROD,
      AFLDB_OWNER_DATABASE_URL: PROD,
      AFLDB_PROD_IMPORT_DATABASE_URL: PROD,
      PGHOST: 'db.example.com',
      PGPASSWORD: 's3cret',
      PGDATABASE: 'afldb_prod',
      HOME: '/home/u',
      AFLDB_BASE_URL: 'https://example.test',
    };
    const result = applyTestDsnPolicy(env);
    expect(result.mode).toBe('no-test-database');
    expect(Object.keys(env).sort()).toEqual(['AFLDB_BASE_URL', 'HOME']);
    expect(result.removed).toContain('DATABASE_URL');
    expect(result.removed).toContain('PGPASSWORD');
    // The report carries names, never values.
    expect(JSON.stringify(result)).not.toContain('s3cret');
  });

  it('is a no-op on an environment that holds no connection variable', () => {
    const env: DsnEnv = { HOME: '/home/u' };
    expect(applyTestDsnPolicy(env)).toEqual({ mode: 'no-test-database', removed: [] });
    expect(env).toEqual({ HOME: '/home/u' });
  });

  it('still refuses an import-role test DSN without a test DSN, BEFORE anything is stripped', () => {
    const env: DsnEnv = { AFLDB_TEST_IMPORT_DATABASE_URL: TEST, DATABASE_URL: PROD };
    expect(() => applyTestDsnPolicy(env)).toThrow(
      'AFLDB_TEST_DATABASE_URL must be set when AFLDB_TEST_IMPORT_DATABASE_URL is configured.',
    );
    // The throw precedes the strip: the pre-V2 fail-closed signal cannot be silenced by it.
    expect(env.DATABASE_URL).toBe(PROD);
  });
});

describe('applyTestDsnPolicy — a test database is configured', () => {
  it('redirects a stray DATABASE_URL to the test DSN instead of deleting it', () => {
    const env: DsnEnv = { AFLDB_TEST_DATABASE_URL: TEST, DATABASE_URL: DEV };
    const result = applyTestDsnPolicy(env);
    expect(result.mode).toBe('test-database');
    expect(env.DATABASE_URL).toBe(TEST);
  });

  it('sets DATABASE_URL to the test DSN when it was absent', () => {
    const env: DsnEnv = { AFLDB_TEST_DATABASE_URL: TEST };
    applyTestDsnPolicy(env);
    expect(env.DATABASE_URL).toBe(TEST);
  });

  it('removes every other DSN variable that does not name a _test database, and keeps the ones that do', () => {
    const env: DsnEnv = {
      AFLDB_TEST_DATABASE_URL: TEST,
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgresql://afldb_import:pw@127.0.0.1:55432/afldb_test',
      AFLDB_TEST_AUTH_DATABASE_URL: 'postgresql://afldb_auth:pw@127.0.0.1:55432/afldb_test',
      AFLDB_IMPORT_DATABASE_URL: DEV,
      AFLDB_AUTH_DATABASE_URL: PROD,
      AFLDB_CODE_TEST_DATABASE_URL: 'postgresql://o:pw@127.0.0.1:55432/code_test_db',
      AFLDB_EVIDENCE_DATABASE_URL: 'not a url',
    };
    const result = applyTestDsnPolicy(env);
    expect(result.removed.sort()).toEqual([
      'AFLDB_AUTH_DATABASE_URL',
      'AFLDB_CODE_TEST_DATABASE_URL',
      'AFLDB_EVIDENCE_DATABASE_URL',
      'AFLDB_IMPORT_DATABASE_URL',
    ]);
    expect(env.AFLDB_TEST_IMPORT_DATABASE_URL).toMatch(/afldb_test$/);
    expect(env.AFLDB_TEST_AUTH_DATABASE_URL).toMatch(/afldb_test$/);
    expect(env.DATABASE_URL).toBe(TEST);
  });

  it('refuses a test DSN naming the DEV database, with the pre-V2 message', () => {
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: DEV })).toThrow(
      "AFLDB_TEST_DATABASE_URL points at 'afldb_dev', which is not a _test database.",
    );
  });

  it('refuses a production-looking test DSN by the same _test$ suffix allowlist (not a host heuristic)', () => {
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: PROD })).toThrow(
      "AFLDB_TEST_DATABASE_URL points at 'afldb_prod', which is not a _test database.",
    );
    // A name that merely CONTAINS _test is not enough.
    expect(() => applyTestDsnPolicy({
      AFLDB_TEST_DATABASE_URL: 'postgresql://u:p@h/afldb_test_pre_rebuild_20260825',
    })).toThrow(/not a _test database/);
  });

  it('refuses a test DSN that is not a URL', () => {
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: 'afldb_test' })).toThrow(
      'AFLDB_TEST_DATABASE_URL is not a valid connection URL.',
    );
  });
});

describe('this test process after tests/setup.ts', () => {
  it('holds no connection variable that can reach a non-test database', () => {
    const testUrl = ENV_AFTER_SETUP.AFLDB_TEST_DATABASE_URL;
    for (const [name, value] of Object.entries(ENV_AFTER_SETUP)) {
      if (!isDsnVariable(name) || !value) continue;
      expect(value, name).toMatch(/_test(\?.*)?$/);
    }
    if (!testUrl) {
      // No test database: nothing DSN-like survives, libpq defaults included.
      expect(Object.keys(ENV_AFTER_SETUP).filter(isDsnVariable)).toEqual([]);
      for (const name of LIBPQ_CONNECTION_VARIABLES) expect(ENV_AFTER_SETUP[name], name).toBeUndefined();
      expect(ENV_AFTER_SETUP.DATABASE_URL).toBeUndefined();
    } else {
      expect(ENV_AFTER_SETUP.DATABASE_URL).toBe(testUrl);
    }
  });

  it('is recognised as a test process (VITEST is set)', () => {
    expect(isTestProcess()).toBe(true);
  });
});

describe('test-process guard in the runtime database clients', () => {
  it('refuses production and DEV databases, wherever they are hosted', () => {
    expect(testProcessDsnRefusal('DATABASE_URL', PROD)).toMatch(/'afldb_prod', which is not a _test database/);
    // A tunnelled DEV/PROD database on loopback is still refused: only port 1 is a placeholder.
    expect(testProcessDsnRefusal('DATABASE_URL', DEV)).toMatch(/'afldb_dev'/);
    expect(testProcessDsnRefusal('DATABASE_URL', 'not a url')).toMatch(/not a valid connection URL/);
  });

  it('never echoes the DSN or its password in a refusal', () => {
    expect(testProcessDsnRefusal('DATABASE_URL', PROD)).not.toContain('s3cret');
    expect(testProcessDsnRefusal('DATABASE_URL', PROD)).not.toContain('db.example.com');
  });

  it('allows a _test database and the never-connectable unit placeholders', () => {
    expect(testProcessDsnRefusal('DATABASE_URL', TEST)).toBeNull();
    expect(testProcessDsnRefusal('AFLDB_AUTH_DATABASE_URL', 'postgres://unit.invalid/afldb_unit_never_connected')).toBeNull();
    expect(testProcessDsnRefusal('DATABASE_URL', 'postgresql://unused:unused@127.0.0.1:1/afldb_unit_placeholder')).toBeNull();
  });

  it('is a no-op outside a test process, so production keeps its own DSN', () => {
    expect(() => assertTestProcessDsn('DATABASE_URL', PROD, {})).not.toThrow();
    expect(() => assertTestProcessDsn('DATABASE_URL', PROD, { VITEST: 'true' })).toThrow(/afldb_prod/);
  });

  describe('module-level refusal', () => {
    const saved = { DATABASE_URL: process.env.DATABASE_URL, AUTH: process.env.AFLDB_AUTH_DATABASE_URL };
    const g = globalThis as { __afldbSql?: unknown; __afldbAuthSql?: unknown };
    const savedPools = { sql: g.__afldbSql, auth: g.__afldbAuthSql };

    afterEach(() => {
      if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.DATABASE_URL;
      if (saved.AUTH === undefined) delete process.env.AFLDB_AUTH_DATABASE_URL;
      else process.env.AFLDB_AUTH_DATABASE_URL = saved.AUTH;
      g.__afldbSql = savedPools.sql;
      g.__afldbAuthSql = savedPools.auth;
      vi.resetModules();
    });

    it('src/db/client.ts refuses a production DSN before building a pool', async () => {
      process.env.DATABASE_URL = PROD;
      g.__afldbSql = undefined;
      vi.resetModules();
      await expect(import('@/db/client')).rejects.toThrow(/'afldb_prod', which is not a _test database/);
      expect(g.__afldbSql).toBeUndefined();
    });

    it('src/db/authClient.ts refuses a production DSN on first use', async () => {
      process.env.AFLDB_AUTH_DATABASE_URL = PROD;
      g.__afldbAuthSql = undefined;
      vi.resetModules();
      const { authSql } = await import('@/db/authClient');
      expect(() => authSql.options).toThrow(/AFLDB_AUTH_DATABASE_URL names the database 'afldb_prod'/);
      expect(g.__afldbAuthSql).toBeUndefined();
    });
  });
});

describe('tools/current-season/load-env.ts inside and outside a test process', () => {
  const MANAGED = ['DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'PGPASSWORD', 'V2_D5_PLAIN', 'VITEST'];
  const saved: Record<string, string | undefined> = {};
  let scratch = '';

  afterEach(() => {
    if (!scratch) return;
    for (const name of MANAGED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(scratch, { recursive: true, force: true });
    scratch = '';
  });

  function prepare(): void {
    for (const name of MANAGED) saved[name] = process.env[name];
    for (const name of MANAGED.filter((n) => n !== 'VITEST')) delete process.env[name];
    scratch = mkdtempSync(join(tmpdir(), 'afldb-v2-d5-'));
    writeFileSync(join(scratch, '.env'), [
      `DATABASE_URL=${PROD}`,
      `AFLDB_IMPORT_DATABASE_URL=${DEV}`,
      'PGPASSWORD=s3cret',
      'V2_D5_PLAIN=from_file',
    ].join('\n'), 'utf8');
  }

  it('classifies connection variable names', () => {
    expect(isConnectionVariableName('DATABASE_URL')).toBe(true);
    expect(isConnectionVariableName('AFLDB_PROD_AUTH_DATABASE_URL')).toBe(true);
    expect(isConnectionVariableName('PGPASSWORD')).toBe(true);
    expect(isConnectionVariableName('PGDATA')).toBe(false);
    expect(isConnectionVariableName('AFLDB_BASE_URL')).toBe(false);
  });

  it('inside a test process, never rehydrates a connection variable from .env', () => {
    prepare();
    loadEnv(scratch);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.AFLDB_IMPORT_DATABASE_URL).toBeUndefined();
    expect(process.env.PGPASSWORD).toBeUndefined();
    expect(process.env.V2_D5_PLAIN).toBe('from_file');
  });

  it('outside a test process, loads exactly as before (the systemd/manual contract is unchanged)', () => {
    prepare();
    delete process.env.VITEST;
    try {
      loadEnv(scratch);
      expect(process.env.DATABASE_URL).toBe(PROD);
      expect(process.env.AFLDB_IMPORT_DATABASE_URL).toBe(DEV);
      expect(process.env.V2_D5_PLAIN).toBe('from_file');
    } finally {
      // Never leave a production-looking value in this process, even on failure.
      delete process.env.DATABASE_URL;
      delete process.env.AFLDB_IMPORT_DATABASE_URL;
      delete process.env.PGPASSWORD;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// AFLDB-ISSUE-363 owner decision (1): per-file disposable databases. Every refusal is proved on plain values or
// with an injected connection that fails the test if it is ever opened, so no database is needed.
// ---------------------------------------------------------------------------------------------
const NOW = new Date(Date.UTC(2026, 10, 14, 5, 30, 0));
const GOOD_NAME = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 4242, nonce: 'a1b2c3d4' });
const BASE_55651 = 'postgresql://afldb_owner:pw@127.0.0.1:55651/afldb_v2_base_test';
const NEVER_CONNECT = async (): Promise<AdminSql> => { throw new Error('a connection was opened but the refusal must come first'); };
const MARKER = 'afldb-v2-isolated-test';

/**
 * A scripted fake admin connection. `answer` is what the fake "server" says to `inet_server_port(), current_database()`.
 * Tagged-template statements and `unsafe` statements are logged separately so a test can assert that NOTHING but the
 * identity query ran when the server is refused.
 */
interface FakeLog { sql: string[]; unsafe: string[] }
function scriptedAdmin(
  answer: { port: number | null; db: string | null },
  log: FakeLog,
  sweepRows: { name: string; comment: string | null }[] = [],
): () => Promise<AdminSql> {
  const sql = Object.assign(
    async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      log.sql.push(text);
      if (/inet_server_port/.test(text)) return [answer];
      if (/datdba/.test(text)) return [{ owner: 'afldb_owner', comment: MARKER }];
      if (/txid_current/.test(text)) return [{ xid: '1' }];
      if (/NOT datistemplate/.test(text)) return sweepRows;
      if (/WHERE datname = /.test(text)) return [{ comment: MARKER }];
      return [];
    },
    { unsafe: async (text: string) => { log.unsafe.push(text); return []; }, end: async () => {} },
  );
  return async () => sql as unknown as AdminSql;
}
const GOOD_SERVER = { port: 55651, db: 'postgres' };

describe('per-file databases: mode and base refusals', () => {
  it('is off unless asked for, accepts 1 / all, and rejects a typo instead of silently running shared mode', () => {
    expect(perFileModeOf(undefined)).toBe('off');
    expect(perFileModeOf('')).toBe('off');
    expect(perFileModeOf('0')).toBe('off');
    expect(perFileModeOf('1')).toBe('registered');
    expect(perFileModeOf('all')).toBe('all');
    expect(() => perFileModeOf('yes please')).toThrow(/not recognised/);
  });

  it('refuses a base database that does not end in _test', () => {
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@127.0.0.1:55651/afldb_dev')).toThrow(/base_name/);
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@127.0.0.1:55651/afldb_prod')).toThrow(/does not end in _test/);
    expect(() => assertPerFileBaseAllowed(BASE_55651)).not.toThrow();
  });

  it("refuses DEV's port 5432, an unstated (default 5432) port, a libpq redirect and a non-URL", () => {
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@10.0.40.100:5432/afldb_test')).toThrow(/port 5432 is DEV/);
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@127.0.0.1:5432/afldb_v2_base_test')).toThrow(/port \(/);
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@localhost/afldb_v2_base_test')).toThrow(/default 5432/);
    expect(() => assertPerFileBaseAllowed(`${BASE_55651}?host=10.0.40.100`)).toThrow(/libpq_redirect/);
    expect(() => assertPerFileBaseAllowed('not a url')).toThrow(/base_dsn/);
    expect(() => assertPerFileBaseAllowed(undefined)).toThrow(/is not set/);
  });

  it('refuses a multi-host DSN, whose entries without their own port use 5432 (REVIEW-D MED-1)', () => {
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@10.0.40.100,127.0.0.1:55651/afldb_v2_base_test')).toThrow(/multi_host/);
    expect(() => assertPerFileBaseAllowed('postgresql://u:p@127.0.0.1,10.0.40.100:55651/afldb_v2_base_test')).toThrow(/multi_host/);
    expect(() => assertPerFileAdminDsnAllowed('postgresql://u:p@10.0.40.100,127.0.0.1:55651/postgres')).toThrow(/multi_host/);
  });

  it('refuses ANY query parameter on the base or admin DSN, not only five libpq names (REVIEW-D MED-1)', () => {
    for (const q of ['?database=x', '?user=y', '?application_name=x', '?options=-c%20search_path%3Dx', '?sslmode=disable', '?&']) {
      expect(() => assertPerFileBaseAllowed(`${BASE_55651}${q}`), q).toThrow(/query_parameter/);
    }
    expect(() => assertPerFileAdminDsnAllowed('postgresql://u:p@127.0.0.1:55651/postgres?database=x')).toThrow(/query_parameter/);
    // the named libpq redirects keep their own check name
    expect(() => assertPerFileBaseAllowed(`${BASE_55651}?host=10.0.40.100`)).toThrow(/libpq_redirect/);
  });

  it('refuses an admin DSN on port 5432 or with no port, and accepts a plain one', () => {
    expect(() => assertPerFileAdminDsnAllowed('postgresql://u:p@127.0.0.1:5432/postgres')).toThrow(/port/);
    expect(() => assertPerFileAdminDsnAllowed('postgresql://u:p@127.0.0.1/postgres')).toThrow(/default 5432/);
    expect(() => assertPerFileAdminDsnAllowed('not a url')).toThrow(/admin DSN is not a URL/);
    expect(() => assertPerFileAdminDsnAllowed('postgresql://u:p@127.0.0.1:55651/postgres')).not.toThrow();
  });

  it('adminDsnFor refuses a base the policy refuses even if the caller skipped the base check', () => {
    expect(() => adminDsnFor('postgresql://u:p@10.0.40.100,127.0.0.1:55651/afldb_v2_base_test', {})).toThrow(/multi_host/);
    expect(() => adminDsnFor(`${BASE_55651}?database=x`, {})).toThrow(/query_parameter/);
    expect(() => adminDsnFor('postgresql://u:p@127.0.0.1:5432/afldb_v2_base_test', {})).toThrow(/port/);
  });

  it('never puts a credential in a refusal message', () => {
    let message = '';
    try {
      assertPerFileBaseAllowed('postgresql://afldb_owner:s3cret-pw@10.0.40.100:5432/afldb_prod');
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/refused/);
    expect(message).not.toContain('s3cret');
  });

  it('refuses before any connection is opened', async () => {
    await expect(createPerFileDatabase(
      { env: {}, baseDsn: 'postgresql://u:p@127.0.0.1:5432/afldb_v2_base_test' }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/Per-file test databases refused/);
    await expect(createPerFileDatabase(
      { env: {}, baseDsn: 'postgresql://u:p@127.0.0.1:55651/afldb_dev' }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/does not end in _test/);
    await expect(createPerFileDatabase(
      { env: { AFLDB_TEST_PER_FILE_DB_PREFIX: 'Bad-Prefix_' }, baseDsn: BASE_55651 }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/prefix .* refused/);
  });
});

describe('per-file databases: the SERVER is asked which port and database the admin connection reached (REVIEW-D MED-1)', () => {
  const expected = { port: '55651', database: 'postgres' };

  it('accepts the expected answer and refuses a NULL port, 5432, another port and another database', () => {
    expect(checkAdminServerIdentity({ port: 55651, database: 'postgres' }, expected)).toEqual([]);
    expect(() => assertAdminServerIdentity({ port: 55651, database: 'postgres' }, expected)).not.toThrow();
    expect(() => assertAdminServerIdentity({ port: null, database: 'postgres' }, expected)).toThrow(/server_port.*no TCP port/);
    expect(() => assertAdminServerIdentity({ port: undefined, database: 'postgres' }, expected)).toThrow(/server_port/);
    expect(() => assertAdminServerIdentity({ port: 5432, database: 'postgres' }, expected)).toThrow(/DEV's PostgreSQL port/);
    expect(() => assertAdminServerIdentity({ port: '5432', database: 'postgres' }, { port: '5432', database: 'postgres' })).toThrow(/DEV's PostgreSQL port/);
    expect(() => assertAdminServerIdentity({ port: 6543, database: 'postgres' }, expected)).toThrow(/reports port 6543 but the DSN names 55651/);
    expect(() => assertAdminServerIdentity({ port: 55651, database: 'afldb_dev' }, expected)).toThrow(/server_database/);
    expect(() => assertAdminServerIdentity({ port: 55651, database: null }, expected)).toThrow(/server_database/);
  });

  it('create: a tunnel whose server answers port 5432 is refused before the lock, the base lookup or any CREATE', async () => {
    const log: FakeLog = { sql: [], unsafe: [] };
    await expect(createPerFileDatabase(
      { env: {}, baseDsn: BASE_55651 }, { connect: scriptedAdmin({ port: 5432, db: 'postgres' }, log) },
    )).rejects.toThrow(/server_port.*DEV's PostgreSQL port/);
    expect(log.unsafe).toEqual([]);
    expect(log.sql).toHaveLength(1);
    expect(log.sql[0]).toMatch(/inet_server_port/);
    expect(perFileDatabasesCreatedByThisProcess().size).toBe(0);
  });

  it('create: a NULL port (Unix socket) and a wrong database are refused the same way', async () => {
    for (const answer of [{ port: null, db: 'postgres' }, { port: 55651, db: 'afldb_v2_base_test' }, { port: 4444, db: 'postgres' }]) {
      const log: FakeLog = { sql: [], unsafe: [] };
      await expect(createPerFileDatabase({ env: {}, baseDsn: BASE_55651 }, { connect: scriptedAdmin(answer, log) }))
        .rejects.toThrow(/Per-file test databases refused/);
      expect(log.unsafe).toEqual([]);
      expect(log.sql).toHaveLength(1);
    }
  });

  it('create passes the identity check on the expected server, drop then refuses a server that answers 5432 before any DROP', async () => {
    const okLog: FakeLog = { sql: [], unsafe: [] };
    const db = await createPerFileDatabase(
      { env: {}, baseDsn: BASE_55651 }, { connect: scriptedAdmin(GOOD_SERVER, okLog), now: () => NOW, pid: 4242, randomHex: () => 'a1b2c3d4' },
    );
    try {
      expect(db.name).toBe(GOOD_NAME);
      expect(okLog.unsafe[0]).toMatch(/^CREATE DATABASE "afldb_v2_pf_20261114053000_4242_a1b2c3d4_test"/);
      const dropLog: FakeLog = { sql: [], unsafe: [] };
      await expect(dropPerFileDatabase(db, { env: {}, baseDsn: BASE_55651 }, { connect: scriptedAdmin({ port: 5432, db: 'postgres' }, dropLog) }))
        .rejects.toThrow(/server_port/);
      expect(dropLog.unsafe).toEqual([]);
      const goodDrop: FakeLog = { sql: [], unsafe: [] };
      await dropPerFileDatabase(db, { env: {}, baseDsn: BASE_55651 }, { connect: scriptedAdmin(GOOD_SERVER, goodDrop) });
      expect(goodDrop.unsafe).toEqual([`DROP DATABASE IF EXISTS "${GOOD_NAME}" WITH (FORCE)`]);
    } finally {
      expect(perFileDatabasesCreatedByThisProcess().has(GOOD_NAME)).toBe(false);
    }
  });

  it('sweep: a server answering 5432 is refused before any listing or DROP', async () => {
    const log: FakeLog = { sql: [], unsafe: [] };
    await expect(sweepStalePerFileDatabases(
      { env: {}, baseDsn: BASE_55651, maxAgeMs: 6 * 3600_000, dryRun: false },
      { connect: scriptedAdmin({ port: 5432, db: 'postgres' }, log, [{ name: 'afldb_v2_pf_20200101000000_1_00000001_test', comment: MARKER }]) },
    )).rejects.toThrow(/server_port/);
    expect(log.unsafe).toEqual([]);
    expect(log.sql).toHaveLength(1);
  });
});

describe('per-file databases: generated names and prefix', () => {
  it('generates <prefix><utc stamp>_<pid>_<nonce>_test, which the isolated-target name rule also accepts', () => {
    expect(GOOD_NAME).toBe('afldb_v2_pf_20261114053000_4242_a1b2c3d4_test');
    expect(/^afldb_v2_[a-z0-9]+(?:_[a-z0-9]+)*_test$/.test(GOOD_NAME)).toBe(true);
    expect(parsePerFileDatabaseName(GOOD_NAME, 'afldb_v2_pf_')).toEqual({ createdAt: NOW, pid: 4242, nonce: 'a1b2c3d4' });
  });

  it.each([
    ['empty', ''],
    ['no afldb_v2_ start', 'pf_'],
    ['uppercase', 'afldb_v2_PF_'],
    ['no trailing underscore', 'afldb_v2_pf'],
    ['punctuation', 'afldb_v2_p-f_'],
    ['too long', 'afldb_v2_abcdefghijklm_'],
    ['injection', 'afldb_v2_x"; DROP DATABASE y; --_'],
    ['bare afldb_', 'afldb_'],
  ])('refuses a malformed prefix: %s', (_label, prefix) => {
    expect(() => assertPerFilePrefix(prefix)).toThrow(/prefix .* refused/);
    expect(() => perFileDatabaseName({ prefix, now: NOW, pid: 1, nonce: 'a1b2c3d4' })).toThrow(/prefix .* refused/);
    expect(() => parsePerFileDatabaseName(GOOD_NAME, prefix)).toThrow(/prefix .* refused/);
  });

  it('refuses a malformed nonce or pid', () => {
    expect(() => perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 1, nonce: 'XYZ' })).toThrow(/nonce/);
    expect(() => perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 0, nonce: 'a1b2c3d4' })).toThrow(/pid/);
  });

  it('does not parse a look-alike name', () => {
    for (const name of [
      'afldb_v2_pf_20261114053000_4242_a1b2c3d4', // no _test
      'afldb_v2_pf_20261114053000_4242_a1b2c3d_test', // short nonce
      'afldb_v2_pf_20261399053000_4242_a1b2c3d4_test', // impossible date
      'afldb_v2_other_20261114053000_4242_a1b2c3d4_test', // other prefix
      'afldb_v2_base_test',
    ]) expect(parsePerFileDatabaseName(name, 'afldb_v2_pf_')).toBeNull();
  });
});

describe('per-file databases: only a name this process generated may be dropped', () => {
  const created = new Set<string>([GOOD_NAME]);
  const opts = { createdByThisProcess: created, baseName: 'afldb_v2_base_test', prefix: 'afldb_v2_pf_' };

  it('allows the name this process generated', () => {
    expect(() => assertPerFileDroppable(GOOD_NAME, opts)).not.toThrow();
  });

  it('refuses the DSN-named base even if it were somehow registered', () => {
    expect(() => assertPerFileDroppable('afldb_v2_base_test', { ...opts, createdByThisProcess: new Set(['afldb_v2_base_test']) }))
      .toThrow(/base database named by the DSN/);
  });

  it('refuses a well-formed name that another process generated', () => {
    const other = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 999, nonce: 'deadbeef' });
    expect(() => assertPerFileDroppable(other, opts)).toThrow(/this process did not generate it/);
  });

  it.each([
    'afldb_dev', 'afldb_prod', 'afldb_test', 'postgres', 'template1', 'afldb_v2_rem2tests363_tmpl_test',
    'afldb_v2_pf_20261114053000_4242_a1b2c3d4', // right prefix, no _test
  ])('refuses %s even when it is in the registry', (name) => {
    expect(() => assertPerFileDroppable(name, { ...opts, createdByThisProcess: new Set([name]) })).toThrow(/Refusing to drop/);
  });

  it('dropPerFileDatabase refuses an unregistered name before opening any connection', async () => {
    const stranger = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 7, nonce: 'cafebabe' });
    expect(perFileDatabasesCreatedByThisProcess().has(stranger)).toBe(false);
    await expect(dropPerFileDatabase(
      { name: stranger, baseName: 'afldb_v2_base_test', prefix: 'afldb_v2_pf_' }, { env: {}, baseDsn: BASE_55651 }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/this process did not generate it/);
    await expect(dropPerFileDatabase(
      { name: 'afldb_v2_base_test', baseName: 'afldb_v2_base_test', prefix: 'afldb_v2_pf_' }, { env: {}, baseDsn: BASE_55651 }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/Refusing to drop/);
  });
});

describe('per-file databases: sweep selection', () => {
  const old = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: new Date(NOW.getTime() - 24 * 3600_000), pid: 1, nonce: '00000001' });
  const young = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: new Date(NOW.getTime() - 60_000), pid: 2, nonce: '00000002' });
  const marker = 'afldb-v2-isolated-test';
  const opts = { prefix: 'afldb_v2_pf_', baseName: 'afldb_v2_base_test', baseComment: marker, now: NOW, maxAgeMs: 6 * 3600_000 };

  it('drops only old, generated-shape, marked, same-prefix databases', () => {
    const { drop, kept } = selectStalePerFileDatabases([
      { name: old, comment: marker },
      { name: young, comment: marker },
      { name: 'afldb_v2_base_test', comment: marker },
      { name: 'afldb_v2_pf_notgenerated_test', comment: marker },
      { name: 'afldb_v2_pf2_20200101000000_1_00000003_test', comment: marker },
      { name: old.replace('00000001', '00000009'), comment: 'some-other-marker' },
    ], opts);
    expect(drop).toEqual([old]);
    expect(kept.map((k) => k.reason).sort()).toEqual([
      'base database', 'different prefix', 'marker comment differs from the base', 'prefix matches but not the generated shape', 'younger than the age bound',
    ]);
  });

  it('drops an old generated-shape database with a NULL comment (a kill during CREATE DATABASE) but keeps a young one and a different non-null comment (REVIEW-D MED-2)', () => {
    const orphan = old.replace('00000001', '0000000a');
    const youngOrphan = young.replace('00000002', '0000000b');
    const { drop, kept } = selectStalePerFileDatabases([
      { name: orphan, comment: null },
      { name: youngOrphan, comment: null },
      { name: old.replace('00000001', '0000000c'), comment: 'someone-elses-marker' },
      { name: old.replace('00000001', '0000000d'), comment: '' },
    ], opts);
    expect(drop).toEqual([orphan]);
    expect(kept.map((k) => [k.name === youngOrphan, k.reason])).toEqual([
      [true, 'younger than the age bound'],
      [false, 'marker comment differs from the base'],
      [false, 'marker comment differs from the base'],
    ]);
    // a NULL comment never bypasses the name shape, the prefix, the base exclusion or the age bound
    const refused = selectStalePerFileDatabases([
      { name: 'afldb_v2_base_test', comment: null },
      { name: 'afldb_v2_pf_notgenerated_test', comment: null },
      { name: 'afldb_dev', comment: null },
    ], opts);
    expect(refused.drop).toEqual([]);
  });

  it('sweepStalePerFileDatabases removes the NULL-comment orphan end to end and nothing else', async () => {
    const orphan = old.replace('00000001', '0000000a');
    const log: FakeLog = { sql: [], unsafe: [] };
    const result = await sweepStalePerFileDatabases(
      { env: {}, baseDsn: BASE_55651, maxAgeMs: 6 * 3600_000, dryRun: false },
      {
        now: () => NOW,
        connect: scriptedAdmin(GOOD_SERVER, log, [
          { name: orphan, comment: null },
          { name: old.replace('00000001', '0000000c'), comment: 'someone-elses-marker' },
          { name: young, comment: MARKER },
        ]),
      },
    );
    expect(result.dropped).toEqual([orphan]);
    expect(log.unsafe).toEqual([`DROP DATABASE IF EXISTS "${orphan}" WITH (FORCE)`]);
  });

  it('refuses an age bound below the minimum so a live run is never reaped', () => {
    expect(() => selectStalePerFileDatabases([], { ...opts, maxAgeMs: MIN_SWEEP_AGE_MS - 1 })).toThrow(/minimum/);
    expect(() => selectStalePerFileDatabases([], { ...opts, maxAgeMs: Number.NaN })).toThrow(/minimum/);
  });

  it('refuses a base the mode refuses, before any connection', async () => {
    await expect(sweepStalePerFileDatabases(
      { env: {}, baseDsn: 'postgresql://u:p@127.0.0.1:5432/afldb_v2_base_test', maxAgeMs: 6 * 3600_000, dryRun: true }, { connect: NEVER_CONNECT },
    )).rejects.toThrow(/Per-file test databases refused/);
  });
});

describe('per-file databases: redirection and selection', () => {
  const base = { host: '127.0.0.1', port: '55651', database: 'afldb_v2_base_test' };

  it('redirects only URLs that name the base on the same host and port', () => {
    expect(redirectDsn(BASE_55651, base, GOOD_NAME)).toBe(`postgresql://afldb_owner:pw@127.0.0.1:55651/${GOOD_NAME}`);
    expect(redirectDsn('postgresql://u:p@127.0.0.1:55651/other_test', base, GOOD_NAME)).toBeNull();
    expect(redirectDsn('postgresql://u:p@10.0.40.100:55651/afldb_v2_base_test', base, GOOD_NAME)).toBeNull();
    expect(redirectDsn('postgresql://u:p@127.0.0.1:5432/afldb_v2_base_test', base, GOOD_NAME)).toBeNull();
    expect(redirectDsn('garbage', base, GOOD_NAME)).toBeNull();
  });

  it('rewrites every DSN variable naming the base and reports names, not values', () => {
    const env: DsnEnv = {
      AFLDB_TEST_DATABASE_URL: BASE_55651,
      DATABASE_URL: 'postgresql://afldb_app:pw2@127.0.0.1:55651/afldb_v2_base_test',
      AFLDB_TEST_IMPORT_DATABASE_URL: 'postgresql://afldb_import:pw3@127.0.0.1:55651/afldb_v2_base_test',
      AFLDB_ELSEWHERE_DATABASE_URL: 'postgresql://x:y@127.0.0.1:55651/elsewhere_test',
      HOME: '/home/u',
    };
    const changed = redirectEnvToDatabase(env, BASE_55651, GOOD_NAME);
    expect(changed.sort()).toEqual(['AFLDB_TEST_DATABASE_URL', 'AFLDB_TEST_IMPORT_DATABASE_URL', 'DATABASE_URL']);
    expect(JSON.stringify(changed)).not.toContain('pw');
    expect(env.AFLDB_TEST_DATABASE_URL).toContain(`/${GOOD_NAME}`);
    expect(env.AFLDB_ELSEWHERE_DATABASE_URL).toContain('/elsewhere_test');
    expect(env.HOME).toBe('/home/u');
  });

  it('applies to integration files only: all, the registered list, or nothing', () => {
    const registered = ['tests/integration/settle-afltables.test.ts'];
    const settle = '/repo/tests/integration/settle-afltables.test.ts';
    const other = '/repo/tests/integration/venue-records.test.ts';
    expect(perFileAppliesTo('off', settle, registered)).toBe(false);
    expect(perFileAppliesTo('registered', settle, registered)).toBe(true);
    expect(perFileAppliesTo('registered', other, registered)).toBe(false);
    expect(perFileAppliesTo('all', other, registered)).toBe(true);
    expect(perFileAppliesTo('all', '/repo/tests/dsn-policy.test.ts', registered)).toBe(false);
    expect(perFileAppliesTo('all', 'C:\\repo\\tests\\integration\\venue-records.test.ts', registered)).toBe(true);
    expect(perFileAppliesTo('all', undefined, registered)).toBe(false);
  });

  it('builds the admin DSN from a password FILE, never from the environment, on the base host and port', () => {
    const dsn = adminDsnFor(BASE_55651, { AFLDB_TEST_PER_FILE_ADMIN_USER: 'afldb_v2_super', AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE: '/x/superuser.pw' }, () => 'file-pw\n');
    const u = new URL(dsn);
    expect([u.hostname, u.port, u.pathname, u.username, u.password]).toEqual(['127.0.0.1', '55651', '/postgres', 'afldb_v2_super', 'file-pw']);
    expect(new URL(adminDsnFor(BASE_55651, {}, () => 'unused')).username).toBe('afldb_owner');
  });
});

describe('per-file databases: the run-level reaper drops only what the run recorded', () => {
  const recordedName = perFileDatabaseName({ prefix: 'afldb_v2_pf_', now: NOW, pid: 31, nonce: '0badc0de' });

  // The admin connection now asks the server who it is before the first DROP (REVIEW-D MED-1), so the fake answers.
  function fakeAdmin(statements: string[], answer: { port: number | null; db: string | null } = GOOD_SERVER): () => Promise<AdminSql> {
    return scriptedAdmin(answer, { sql: [], unsafe: statements });
  }

  it('drops a recorded generated name, refuses the base and look-alikes found in the ledger, and removes the ledger', async () => {
    const ledgerDir = createPerFileLedger();
    try {
      for (const entry of [recordedName, 'afldb_v2_base_test', 'afldb_prod', 'afldb_v2_pf_notgenerated_test']) {
        writeFileSync(join(ledgerDir, entry), '');
      }
      const statements: string[] = [];
      const result = await reapLedgerDatabases({ env: {}, baseDsn: BASE_55651, ledgerDir }, { connect: fakeAdmin(statements) });
      expect(result.dropped).toEqual([recordedName]);
      expect(result.refused.map((r) => r.name).sort()).toEqual(['afldb_prod', 'afldb_v2_base_test', 'afldb_v2_pf_notgenerated_test']);
      expect(statements).toEqual([`DROP DATABASE IF EXISTS "${recordedName}" WITH (FORCE)`]);
      expect(existsSync(ledgerDir)).toBe(false);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
    }
  });

  it('refuses a server that answers port 5432 before dropping anything it recorded (REVIEW-D MED-1)', async () => {
    const ledgerDir = createPerFileLedger();
    try {
      writeFileSync(join(ledgerDir, recordedName), '');
      const statements: string[] = [];
      await expect(reapLedgerDatabases({ env: {}, baseDsn: BASE_55651, ledgerDir }, { connect: fakeAdmin(statements, { port: 5432, db: 'postgres' }) }))
        .rejects.toThrow(/server_port.*DEV's PostgreSQL port/);
      expect(statements).toEqual([]);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
    }
  });

  it('opens no connection when nothing was recorded or the ledger is gone', async () => {
    const ledgerDir = createPerFileLedger();
    try {
      await expect(reapLedgerDatabases({ env: {}, baseDsn: BASE_55651, ledgerDir }, { connect: NEVER_CONNECT }))
        .resolves.toEqual({ dropped: [], refused: [] });
      await expect(reapLedgerDatabases({ env: {}, baseDsn: BASE_55651, ledgerDir }, { connect: NEVER_CONNECT }))
        .resolves.toEqual({ dropped: [], refused: [] });
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
    }
  });
});

describe('per-file databases: the vitest globalSetup reads the DSN from the main process environment (REVIEW-D LOW-5)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is a no-op with the mode off, so default runs are unchanged', async () => {
    vi.stubEnv('AFLDB_TEST_PER_FILE_DB', '');
    const { default: setup } = await import('../packages/testing/src/per-file-global-setup');
    expect(setup()).toBeUndefined();
  });

  it('with the mode on and no DSN in the process environment, refuses and names the cause (.env is loaded only in workers)', async () => {
    vi.stubEnv('AFLDB_TEST_PER_FILE_DB', 'all');
    vi.stubEnv('AFLDB_TEST_DATABASE_URL', '');
    const { default: setup } = await import('../packages/testing/src/per-file-global-setup');
    expect(() => setup()).toThrow(/not in the vitest main process environment.*\.env/s);
  });

  it('with the mode on and a refused DSN, refuses before creating a ledger', async () => {
    vi.stubEnv('AFLDB_TEST_PER_FILE_DB', 'all');
    vi.stubEnv('AFLDB_TEST_DATABASE_URL', 'postgresql://u:p@10.0.40.100,127.0.0.1:55651/afldb_v2_base_test');
    vi.stubEnv('AFLDB_TEST_PER_FILE_LEDGER', '');
    const { default: setup } = await import('../packages/testing/src/per-file-global-setup');
    expect(() => setup()).toThrow(/multi_host/);
    expect(process.env.AFLDB_TEST_PER_FILE_LEDGER).toBe('');
  });
});

describe('per-file databases: the committed-fixture registry', () => {
  it('names only integration suites that exist, once each, and every named fixture-season owner', () => {
    expect(new Set(COMMITTING_SUITES).size).toBe(COMMITTING_SUITES.length);
    for (const suite of COMMITTING_SUITES) {
      expect(suite, suite).toMatch(/^tests\/integration\/[a-z0-9-]+\.test\.ts$/);
      expect(existsSync(join(process.cwd(), suite)), `${suite} does not exist`).toBe(true);
    }
    // The suites that own a reserved fixture season must be per-file in `=1` mode.
    for (const owner of Object.values(COMMITTED_FIXTURE_SEASONS)) {
      for (const path of owner.match(/tests\/integration\/[a-z0-9-]+\.test\.ts/g) ?? []) {
        expect(COMMITTING_SUITES, `${path} reserves a fixture season but is not registered`).toContain(path);
      }
    }
  });

  it("awards-reload-links' multi-club and finals seasons are used by no other suite (decision 2)", () => {
    expect(COMMITTED_FIXTURE_SEASONS[2061]).toBe('tests/integration/awards-reload-links.test.ts');
    expect(COMMITTED_FIXTURE_SEASONS[2062]).toBe('tests/integration/awards-reload-links.test.ts');
    expect(COMMITTED_FIXTURE_SEASONS[2093]).not.toContain('awards-reload-links');
    expect(COMMITTED_FIXTURE_SEASONS[2091]).not.toContain('awards-reload-links');
  });
});
