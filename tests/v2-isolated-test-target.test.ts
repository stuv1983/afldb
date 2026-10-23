import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

import {
  EXPOSED_CREDENTIALS_MARKER, assertCreatableName, assertCredentialsNotExposed, assertLocalListener, checkListenerOwnership,
  environmentFor, main, resolveConfig, verifyTarget,
} from '../tools/v2/isolated-pg';

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

describe('isolated cluster: exposed credentials are unusable (ISSUE-316 credential incident)', () => {
  const markedRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'afldb-exposed-'));
    mkdirSync(join(root, 'secrets'));
    writeFileSync(join(root, 'secrets', EXPOSED_CREDENTIALS_MARKER), 'nonsecret marker\n');
    return root;
  };
  const credentialModes = ['init', 'start', 'roles', 'rotate-credentials', 'create-db', 'drop-db', 'list', 'verify', 'run', undefined];

  it('refuses every command that could start, authenticate or hand the passwords on; stop and status still run', () => {
    const cfg = { root: markedRoot(), bin: '/nonexistent', port: PORT };
    for (const mode of credentialModes) expect(() => assertCredentialsNotExposed(cfg, mode)).toThrow(/marked exposed/);
    for (const mode of ['stop', 'status']) expect(() => assertCredentialsNotExposed(cfg, mode)).not.toThrow();
    const unmarked = { root: mkdtempSync(join(tmpdir(), 'afldb-unmarked-')), bin: '/nonexistent', port: PORT };
    for (const mode of credentialModes) expect(() => assertCredentialsNotExposed(unmarked, mode)).not.toThrow();
  });

  it('refuses in main before any process, listener check or secret read', async () => {
    vi.stubEnv('AFLDB_V2_PG_ROOT', markedRoot());
    try {
      for (const argv of [['start'], ['run', 'afldb_v2_x_test', '--', 'psql'], ['rotate-credentials']]) {
        await expect(main(argv)).rejects.toThrow(/marked exposed/);
      }
      expect(spawnSync).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
      expect(postgres).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
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

// ISSUE-316 ladder-season-scope: the rehearsal listener tool is invoked by its bound absolute path.
describe('isolated launcher: listener tool resolution under the rehearsal guard', () => {
  const cfg = resolveConfig({ AFLDB_V2_PG_ROOT: '../afldb-v2-listener-absolute', AFLDB_V2_PG_PORT: '55434' });
  const data = join(cfg.root, 'data');
  const postgresExe = join(cfg.bin, process.platform === 'win32' ? 'postgres.exe' : 'postgres');
  const ssOutput = 'LISTEN 0      200    127.0.0.1:55434    0.0.0.0:*    users:(("postgres",pid=4242,fd=7))\n';
  const result = (stdout: string) => ({ status: 0, stdout, stderr: '', pid: 1, output: [], signal: null });
  // A Linux listener table, process list and postmaster file, entirely in memory.
  const linux = (spawn: unknown, guardedTool: () => string | undefined) => ({
    platform: 'linux' as const, spawn: spawn as never, guardedTool,
    readlink: (() => postgresExe) as never,
    readFile: ((path: string) => String(path).endsWith('cmdline') ? `${postgresExe}\0-D\0${data}\0` : `4242\n${data}\n1\n55434\n`) as never,
  });
  afterEach(() => vi.unstubAllEnvs());

  it('invokes the verified absolute tool, never the bare name, and still checks postmaster ownership', () => {
    const spawn = vi.fn(() => result(ssOutput));
    expect(() => assertLocalListener(cfg, linux(spawn, () => '/opt/reviewed/ss'))).not.toThrow();
    expect(spawn).toHaveBeenCalledOnce();
    expect((spawn.mock.calls as unknown[][])[0]).toEqual(['/opt/reviewed/ss', ['-H', '-ltnp', 'sport = :55434'], expect.objectContaining({ timeout: 10_000 })]);
  });

  it('keeps the bare-name lookup for an ordinary process, where no guard or rehearsal environment exists', () => {
    const spawn = vi.fn(() => result(ssOutput));
    expect(() => assertLocalListener(cfg, linux(spawn, () => undefined))).not.toThrow();
    expect((spawn.mock.calls as unknown[][])[0][0]).toBe('ss');
  });

  it('refuses, with no process spawned, when the guarded tool cannot be proven; there is no PATH fallback', () => {
    const spawn = vi.fn(() => result(ssOutput));
    expect(() => assertLocalListener(cfg, linux(spawn, () => { throw new Error('Rehearsal package refused: unbound listener tool'); })))
      .toThrow(/cannot prove ownership.*no database credentials sent/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['only the launcher-set tool variable', { AFLDB_REHEARSAL_LISTENER_TOOL: 'ss' }],
    ['only a resolution policy variable', { AFLDB_RESOLUTION_POLICY: '/tmp/policy.json' }],
    ['the tool variable and a spec path without its pin', { AFLDB_REHEARSAL_LISTENER_TOOL: '/usr/bin/ss', AFLDB_REHEARSAL_LAUNCH_SPEC: '/spec.json' }],
    ['every variable but no installed resolution preload', { AFLDB_REHEARSAL_LISTENER_TOOL: '/usr/bin/ss', AFLDB_REHEARSAL_LAUNCH_SPEC: '/spec.json', AFLDB_REHEARSAL_LAUNCH_SPEC_SHA256: 'a'.repeat(64) }],
  ])('the real guard refuses %s as authority and spawns nothing', (_name, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const spawn = vi.fn(() => result(ssOutput));
    expect(() => assertLocalListener(cfg, { platform: 'linux', spawn: spawn as never })).toThrow(/cannot prove ownership/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('uses the verified tool on the Windows inspection path as well, instead of a SystemRoot lookup', () => {
    const spawn = vi.fn(() => result('[]'));
    expect(() => assertLocalListener(cfg, { platform: 'win32', spawn: spawn as never, guardedTool: () => 'C:\\reviewed\\powershell.exe',
      readFile: (() => '') as never })).toThrow(/cannot prove ownership/); // no owners, but the tool was already chosen
    expect((spawn.mock.calls as unknown[][])[0][0]).toBe('C:\\reviewed\\powershell.exe');
  });
});
