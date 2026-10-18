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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyTestDsnPolicy,
  isDsnVariable,
  LIBPQ_CONNECTION_VARIABLES,
  type DsnEnv,
} from '@afldb/testing';
import {
  assertTestProcessDsn,
  isTestProcess,
  testProcessDsnRefusal,
} from '@/db/test-process-guard';
import { isConnectionVariableName, loadEnv } from '../tools/current-season/load-env';

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
