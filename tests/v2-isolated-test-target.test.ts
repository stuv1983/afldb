import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

import {
  ISOLATED_CLUSTER_NAME,
  ISOLATED_DATABASE_MARKER,
  checkIsolatedTestDsn,
  checkIsolatedTestServer,
  isolatedDatabaseOf,
} from '@afldb/domain';

import { assertCreatableName, checkListenerOwnership, environmentFor, resolveConfig, verifyTarget } from '../tools/v2/isolated-pg';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), readFileSync: vi.fn() }));
vi.mock('postgres', () => ({ default: vi.fn(() => { throw new Error('Unexpected database connection'); }) }));
afterEach(() => vi.clearAllMocks());

const PORT = 55432;
const dsn = (host: string, port: number | '', db: string, query = '') =>
  `postgresql://afldb_owner:pw@${host}${port === '' ? '' : `:${port}`}/${db}${query}`;
const checks = (findings: readonly { check: string }[]) => findings.map((f) => f.check).sort();

describe('isolated test target: DSN guard', () => {
  it('accepts a loopback afldb_v2_*_test DSN on the isolated port', () => {
    expect(checkIsolatedTestDsn(dsn('127.0.0.1', PORT, 'afldb_v2_int_test'), PORT)).toEqual([]);
    expect(checkIsolatedTestDsn(dsn('localhost', PORT, 'afldb_v2_shadow_test'), PORT)).toEqual([]);
  });

  it.each([
    ['afldb_test', ['database_name']],
    ['afldb_dev', ['database_name', 'database_suffix']],
    ['afldb_prod', ['database_name', 'database_suffix']],
    ['afldb', ['database_name', 'database_suffix']],
    ['code_test_db', ['database_name', 'database_suffix']],
    ['afldb_v2_int', ['database_name', 'database_suffix']],
  ])('refuses database %s by name', (db, expected) => {
    expect(checks(checkIsolatedTestDsn(dsn('127.0.0.1', PORT, db), PORT))).toEqual(expected);
  });

  it('refuses a remote host, the default port, a missing port and libpq redirection', () => {
    expect(checks(checkIsolatedTestDsn(dsn('10.0.40.100', PORT, 'afldb_v2_int_test'), PORT))).toEqual(['loopback_host']);
    expect(checks(checkIsolatedTestDsn(dsn('127.0.0.1', 5432, 'afldb_v2_int_test'), PORT))).toEqual(['port']);
    expect(checks(checkIsolatedTestDsn(dsn('127.0.0.1', '', 'afldb_v2_int_test'), PORT))).toEqual(['port']);
    expect(checks(checkIsolatedTestDsn(dsn('127.0.0.1', PORT, 'afldb_v2_int_test', '?host=10.0.40.100'), PORT)))
      .toEqual(['libpq_redirect']);
    expect(checks(checkIsolatedTestDsn(dsn('127.0.0.1', PORT, 'afldb_v2_int_test', '?service=prod'), PORT)))
      .toEqual(['libpq_redirect']);
  });

  it('refuses something that is not a postgres URL', () => {
    expect(checks(checkIsolatedTestDsn('mysql://x@127.0.0.1:55432/afldb_v2_int_test', PORT))).toEqual(['dsn_url']);
    expect(checks(checkIsolatedTestDsn('not a url', PORT))).toEqual(['dsn_url']);
    expect(isolatedDatabaseOf('not a url')).toBeNull();
  });
});

describe('isolated test target: server guard', () => {
  const good = { clusterName: ISOLATED_CLUSTER_NAME, databaseComment: ISOLATED_DATABASE_MARKER, currentDatabase: 'afldb_v2_int_test' };

  it('accepts the marked cluster and database', () => {
    expect(checkIsolatedTestServer('afldb_v2_int_test', good)).toEqual([]);
  });

  it('refuses another cluster, an unmarked database and a different current database', () => {
    expect(checks(checkIsolatedTestServer('afldb_v2_int_test', { ...good, clusterName: '' }))).toEqual(['cluster_name']);
    expect(checks(checkIsolatedTestServer('afldb_v2_int_test', { ...good, clusterName: null }))).toEqual(['cluster_name']);
    expect(checks(checkIsolatedTestServer('afldb_v2_int_test', { ...good, databaseComment: null }))).toEqual(['database_marker']);
    expect(checks(checkIsolatedTestServer('afldb_v2_int_test', { ...good, currentDatabase: 'afldb_test' }))).toEqual(['current_database']);
  });
});

describe('tools/v2/isolated-pg.ts pure helpers', () => {
  it('creates only afldb_v2_*_test names', () => {
    expect(() => assertCreatableName('afldb_v2_int_test')).not.toThrow();
    for (const bad of ['afldb_test', 'afldb_dev', 'postgres', 'afldb_v2_int', 'afldb_v2_x_test; DROP DATABASE afldb', 'AFLDB_V2_X_TEST']) {
      expect(() => assertCreatableName(bad)).toThrow(/refused/);
    }
  });

  it('requires a root outside the repository and refuses port 5432', () => {
    expect(() => resolveConfig({})).toThrow(/AFLDB_V2_PG_ROOT/);
    expect(() => resolveConfig({ AFLDB_V2_PG_ROOT: '.' })).toThrow(/outside the repository/);
    expect(() => resolveConfig({ AFLDB_V2_PG_ROOT: 'tools/v2' })).toThrow(/outside the repository/);
    expect(() => resolveConfig({ AFLDB_V2_PG_ROOT: '../afldb-v2-pg-elsewhere', AFLDB_V2_PG_PORT: '5432' })).toThrow(/5432/);
    expect(resolveConfig({ AFLDB_V2_PG_ROOT: '../afldb-v2-pg-elsewhere' }).port).toBe(55432);
  });

  it('gives every DSN variable the same verified database and marks the run isolated', () => {
    const cfg = resolveConfig({ AFLDB_V2_PG_ROOT: '../afldb-v2-pg-elsewhere' });
    const pw = { afldb_owner: 'o', afldb_app: 'a', afldb_import: 'i', afldb_backup: 'b', afldb_auth: 'u' };
    const env = environmentFor(cfg, 'afldb_v2_int_test', pw);
    const dsnVars = Object.entries(env).filter(([k]) => k.includes('DATABASE_URL'));
    expect(dsnVars.length).toBe(8);
    for (const [, value] of dsnVars) {
      expect(checkIsolatedTestDsn(value, 55432)).toEqual([]);
      expect(isolatedDatabaseOf(value)).toBe('afldb_v2_int_test');
    }
    expect(env.AFLDB_V2_ISOLATED_PG).toBe('1');
    expect(new URL(env.DATABASE_URL).username).toBe('afldb_app');
    expect(new URL(env.AFLDB_TEST_DATABASE_URL).username).toBe('afldb_owner');
  });
});

describe('isolated launcher: local process ownership before authentication', () => {
  const cfg = resolveConfig({ AFLDB_V2_PG_ROOT: '../afldb-v2-listener-test', AFLDB_V2_PG_PORT: '55433' });
  const data = join(cfg.root, 'data');
  const executablePath = join(cfg.bin, process.platform === 'win32' ? 'postgres.exe' : 'postgres');
  const postmaster = `123\n${data}\n1792444854\n55433\n\n127.0.0.1\n`;
  const owner = { pid: 123, address: '127.0.0.1', executablePath, commandLine: `"${executablePath}" -D "${data}" -p 55433` };

  it('accepts only the matching postmaster, executable, data directory and loopback listener', () => {
    expect(() => checkListenerOwnership(cfg, postmaster, [owner])).not.toThrow();
    for (const changed of [{ pid: 456 }, { executablePath: join(cfg.bin, 'ssh.exe') },
      { commandLine: `postgres -D "${join(cfg.root, 'other')}"` }, { address: '0.0.0.0' }]) {
      expect(() => checkListenerOwnership(cfg, postmaster, [{ ...owner, ...changed }])).toThrow(/no database credentials sent/);
    }
    expect(() => checkListenerOwnership(cfg, postmaster, [])).toThrow();
    expect(() => checkListenerOwnership(cfg, postmaster.replace('\n55433\n', '\n55432\n'), [owner])).toThrow();
    expect(() => checkListenerOwnership(cfg, postmaster, [owner, { ...owner, pid: 456 }])).toThrow();
  });

  it('refuses an SSH listener before reading credentials or constructing a PostgreSQL client', async () => {
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith('postmaster.pid')) return postmaster;
      throw new Error('Unexpected secret read');
    });
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify([
      { ...owner, pid: 456, executablePath: 'ssh.exe', commandLine: 'ssh -L sensitive-forwarding-arguments' },
    ]), stderr: '', pid: 1, output: [], signal: null });
    await expect(verifyTarget(cfg, 'afldb_v2_listener_test')).rejects.toThrow(/no database credentials sent/);
    expect(postgres).not.toHaveBeenCalled();
    expect(vi.mocked(readFileSync).mock.calls.every(([path]) => String(path).endsWith('postmaster.pid'))).toBe(true);
  });

  it('refuses unavailable process inspection without attempting authentication', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'private process details', pid: 1, output: [], signal: null });
    await expect(verifyTarget(cfg, 'afldb_v2_listener_test')).rejects.toThrow(/cannot prove ownership/);
    expect(postgres).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
  });
});
