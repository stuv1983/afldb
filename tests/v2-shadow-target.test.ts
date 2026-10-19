/**
 * AFLDB V2 Stage 6 — the shadow-rehearsal target policy (`@afldb/domain` shadow-target), its
 * consistency with the D5 test-DSN policy (`@afldb/testing`), and the shadow target guard CLI
 * (`tools/v2/shadow-guard.ts`). Pure: no database, no network, no file-system access (the guard is
 * driven through an injected directory listing). Every DSN below is SYNTHETIC and uses the
 * reserved `.invalid` host.
 */
import { describe, expect, it } from 'vitest';

import {
  RESERVED_DATABASE_NAMES,
  SHADOW_DATABASE_NAME_PATTERN,
  databaseNameFromDsn,
  evaluateShadowDatabaseName,
  evaluateShadowDsn,
  scanShadowEnvironment,
} from '@afldb/domain';
import { applyTestDsnPolicy } from '@afldb/testing';

import { isForbiddenEnvFile, runGuard, type GuardDeps } from '../tools/v2/shadow-guard';

const PASSWORD = 'pw-s3cret-XYZ';
const HOST = 'db-host.invalid';
const dsn = (database: string, query = '') => `postgres://shadow_user:${PASSWORD}@${HOST}:5432/${database}${query}`;

const ACCEPTED = [
  dsn('afldb_v2_shadow_test'),
  `postgresql://shadow_user:${PASSWORD}@${HOST}/afldb_v2_shadow_test`,
  dsn('afldb_v2_shadow_20261020_test'),
  dsn('afldb_v2_shadow_r2_test'),
  dsn('afldb_v2_shadow_a_b_c_test'),
  dsn('afldb_v2_shadow_test', '?sslmode=require'),
  dsn('afldb_v2_shadow_test', '?dbname=afldb_v2_shadow_test'),
];

describe('shadow database name policy', () => {
  it.each(ACCEPTED)('accepts a shadow copy: %#', (value) => {
    const verdict = evaluateShadowDsn(value);
    expect(verdict.ok).toBe(true);
    expect(verdict.database).toMatch(SHADOW_DATABASE_NAME_PATTERN);
  });

  it.each([
    ['afldb_test', /shared integration-test database/],
    ['afldb_restore_test', /restore-verification database/],
    ['afldb_dev', /development database/],
    ['afldb', /production/],
    ['afldb_prod', /production/],
    ['code_test_db', /full-rebuild rehearsal database/],
    ['postgres', /maintenance database/],
    ['template0', /template/],
    ['template1', /template/],
  ])('refuses the reserved database %s by name, saying why', (name, reason) => {
    const verdict = evaluateShadowDsn(dsn(name));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.database).toBe(name);
      expect(verdict.reason).toMatch(reason);
    }
    expect(RESERVED_DATABASE_NAMES[name]).toBeDefined();
  });

  it.each([
    'afldb_v2_shadow', // no _test suffix
    'afldb_v2_shadow_test_x', // suffix is not last
    'xafldb_v2_shadow_test', // not anchored at the start
    'afldb_v2_shadow__test', // empty tag
    'afldb_v2_shadow_-_test',
    'afldb_v2_shadow_A_test', // uppercase tag
    'AFLDB_V2_SHADOW_TEST', // uppercase
    'afldb_v2_shadow_test ', // trailing space
    'afldb_v2_shadow_test/extra',
    'afldb_v2_shadow_te_st',
    'afldb_v2_shadowtest',
    'afldb_v3_shadow_test',
  ])('refuses the near-miss %j', (name) => {
    expect(evaluateShadowDatabaseName(name).ok).toBe(false);
  });

  it('refuses an absent name', () => {
    expect(evaluateShadowDatabaseName(null)).toEqual({ ok: false, database: null, reason: 'no database name could be read' });
    expect(evaluateShadowDsn(`postgres://u:${PASSWORD}@${HOST}/`).ok).toBe(false);
    expect(evaluateShadowDsn(`postgres://u:${PASSWORD}@${HOST}`).ok).toBe(false);
  });

  it('refuses any percent-encoded path, because postgres.js opens the raw (undecoded) name (W2 F-001)', () => {
    expect(databaseNameFromDsn(dsn('afldb%5Fprod'))).toBeNull();
    expect(evaluateShadowDsn(dsn('afldb%5Fprod')).ok).toBe(false);
    expect(evaluateShadowDsn(dsn('afldb%5Ftest')).ok).toBe(false);
    expect(evaluateShadowDsn(dsn('afldb_v2_shadow_test%2Fx')).ok).toBe(false);
    expect(evaluateShadowDsn(dsn('afldb_v2_shadow_test%')).ok).toBe(false);
    expect(evaluateShadowDsn(dsn('afldb_v2_shadow%5Ftest')).ok).toBe(false); // raw name is not a shadow name
  });

  it('?dbname= must agree with the path; two different names are refused, never guessed', () => {
    expect(evaluateShadowDsn(dsn('afldb_v2_shadow_test', '?dbname=afldb_v2_shadow_test')).ok).toBe(true);
    expect(evaluateShadowDsn(dsn('afldb_v2_shadow_test', '?dbname=afldb_prod')).ok).toBe(false);
    expect(evaluateShadowDsn(dsn('afldb_prod', '?dbname=afldb_v2_shadow_test')).ok).toBe(false);
    expect(evaluateShadowDsn(`postgres://u:p@${HOST}/?dbname=afldb_v2_shadow_test`).ok).toBe(false); // path empty, query differs
  });

  it('refuses the libpq keyword form and non-postgres schemes', () => {
    expect(evaluateShadowDsn(`host=${HOST} dbname=afldb_v2_shadow_test user=u password=${PASSWORD}`).ok).toBe(false);
    expect(evaluateShadowDsn('afldb_v2_shadow_test').ok).toBe(false);
    expect(evaluateShadowDsn('').ok).toBe(false);
    expect(evaluateShadowDsn(`mysql://u:${PASSWORD}@${HOST}/afldb_v2_shadow_test`).ok).toBe(false);
    expect(evaluateShadowDsn(`http://u:${PASSWORD}@${HOST}/afldb_v2_shadow_test`).ok).toBe(false);
    expect(evaluateShadowDsn(`file:///afldb_v2_shadow_test`).ok).toBe(false);
  });

  it('never echoes the password or host, whatever the verdict', () => {
    const inputs = [...ACCEPTED, dsn('afldb_prod'), dsn('afldb_test'), dsn('whatever'), `host=${HOST} password=${PASSWORD}`, `mysql://u:${PASSWORD}@${HOST}/x`];
    for (const value of inputs) {
      const text = JSON.stringify(evaluateShadowDsn(value));
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(HOST);
    }
  });
});

describe('consistency with the D5 test-DSN policy (ADR 0005)', () => {
  const ACCEPTED_FOR_D5 = ACCEPTED.filter((value) => !value.includes('%'));

  it.each(ACCEPTED_FOR_D5)('every accepted shadow DSN is accepted by applyTestDsnPolicy as the test DSN: %#', (value) => {
    expect(evaluateShadowDsn(value).ok).toBe(true);
    const env: Record<string, string | undefined> = { AFLDB_TEST_DATABASE_URL: value };
    expect(() => applyTestDsnPolicy(env)).not.toThrow();
    expect(applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: value }).mode).toBe('test-database');
  });

  it.each(['afldb_dev', 'afldb_prod', 'afldb'])('both policies refuse %s', (name) => {
    expect(evaluateShadowDsn(dsn(name)).ok).toBe(false);
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: dsn(name) })).toThrow(/not a _test database/);
  });

  it('the shadow rule is strictly narrower than D5: every shadow name ends in _test, the reserved _test names are shadow-refused but D5-accepted', () => {
    for (const name of ['afldb_test', 'afldb_restore_test', 'code_test_db']) {
      expect(evaluateShadowDsn(dsn(name)).ok).toBe(false);
    }
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: dsn('afldb_test') })).not.toThrow();
    expect(() => applyTestDsnPolicy({ AFLDB_TEST_DATABASE_URL: dsn('afldb_restore_test') })).not.toThrow();
    expect(SHADOW_DATABASE_NAME_PATTERN.source.endsWith('_test$')).toBe(true);
  });
});

describe('scanShadowEnvironment', () => {
  const SHADOW = dsn('afldb_v2_shadow_test');

  it('passes a clean shadow environment and lists names only', () => {
    const result = scanShadowEnvironment({ SHADOW_DATABASE_URL: SHADOW }, ['SHADOW_DATABASE_URL']);
    expect(result.ok).toBe(true);
    expect(result.checked).toEqual([{ variable: 'SHADOW_DATABASE_URL', database: 'afldb_v2_shadow_test' }]);
    expect(result.findings).toEqual([]);
  });

  it('refuses an unrelated DSN variable left in the shell, even though it is not required', () => {
    const result = scanShadowEnvironment({ SHADOW_DATABASE_URL: SHADOW, DATABASE_URL: dsn('afldb_prod') }, ['SHADOW_DATABASE_URL']);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.variable)).toEqual(['DATABASE_URL']);
    expect(result.findings[0].database).toBe('afldb_prod');
  });

  it('refuses a required variable that is missing, empty or not a *DATABASE_URL* name', () => {
    expect(scanShadowEnvironment({}, ['SHADOW_DATABASE_URL']).findings).toEqual([
      { variable: 'SHADOW_DATABASE_URL', database: null, problem: 'required but not set' },
    ]);
    expect(scanShadowEnvironment({ SHADOW_DATABASE_URL: '  ' }, ['SHADOW_DATABASE_URL']).ok).toBe(false);
    expect(scanShadowEnvironment({ SHADOW: SHADOW }, ['SHADOW']).findings[0].problem).toMatch(/must be a \*DATABASE_URL\* variable/);
  });

  it('refuses PGSERVICE and PGSERVICEFILE whatever they hold, and a non-shadow PGDATABASE', () => {
    const base = { SHADOW_DATABASE_URL: SHADOW };
    expect(scanShadowEnvironment({ ...base, PGSERVICE: 'prod' }, ['SHADOW_DATABASE_URL']).findings.map((f) => f.variable)).toEqual(['PGSERVICE']);
    expect(scanShadowEnvironment({ ...base, PGSERVICEFILE: '/x' }, ['SHADOW_DATABASE_URL']).ok).toBe(false);
    const wrong = scanShadowEnvironment({ ...base, PGDATABASE: 'afldb_dev' }, ['SHADOW_DATABASE_URL']);
    expect(wrong.ok).toBe(false);
    expect(wrong.findings[0]).toMatchObject({ variable: 'PGDATABASE', database: 'afldb_dev' });
    expect(scanShadowEnvironment({ ...base, PGDATABASE: 'afldb_v2_shadow_test' }, ['SHADOW_DATABASE_URL']).ok).toBe(true);
    expect(scanShadowEnvironment({ ...base, PGSERVICE: '' }, ['SHADOW_DATABASE_URL']).ok).toBe(true);
  });

  it('refuses a required variable naming afldb_test, and never contains the password or host', () => {
    const env = { SHADOW_DATABASE_URL: dsn('afldb_test'), OTHER_DATABASE_URL: `host=${HOST} password=${PASSWORD}` };
    const result = scanShadowEnvironment(env, ['SHADOW_DATABASE_URL']);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.variable)).toEqual(['OTHER_DATABASE_URL', 'SHADOW_DATABASE_URL']);
    const text = JSON.stringify(result);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(HOST);
  });
});

// ---------------------------------------------------------------------------------------------
// The guard CLI, driven through injected deps
// ---------------------------------------------------------------------------------------------
function guardHarness(over: { env?: Record<string, string | undefined>; files?: readonly string[]; listFails?: boolean; cwd?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const listed: string[] = [];
  const deps: GuardDeps = {
    env: over.env ?? { SHADOW_DATABASE_URL: dsn('afldb_v2_shadow_test') },
    cwd: () => over.cwd ?? '/shadow/checkout',
    listDirectory: (directory) => {
      listed.push(directory);
      if (over.listFails) throw new Error(`EACCES ${PASSWORD}`);
      return over.files ?? ['package.json', '.env.example', 'tools'];
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  return { deps, out, err, listed };
}
const everything = (h: { out: string[]; err: string[] }) => [...h.out, ...h.err].join('\n');

describe('shadow-guard check', () => {
  it('passes: prints NAME -> database and SHADOW TARGET OK, never a DSN', () => {
    const h = guardHarness();
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(0);
    expect(h.out).toContain('  SHADOW_DATABASE_URL -> afldb_v2_shadow_test');
    expect(h.out.at(-1)).toBe('SHADOW TARGET OK');
    expect(h.err).toEqual([]);
    expect(everything(h)).not.toContain(PASSWORD);
    expect(everything(h)).not.toContain(HOST);
  });

  it('allows .env.example and lists the default root (the current directory)', () => {
    const h = guardHarness({ files: ['.env.example', 'README.md'], cwd: '/shadow/checkout' });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(0);
    expect(h.listed[0]).toMatch(/shadow[\\/]checkout$/);
  });

  it.each(['.env', '.env.local', '.env.production', '.env.development.local', '.env.test', '.envrc'])('refuses %s in the root', (name) => {
    const h = guardHarness({ files: ['package.json', '.env.example', name] });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain(`${name} exists in`);
    expect(h.err.at(-1)).toMatch(/SHADOW TARGET REFUSED/);
    expect(h.out).not.toContain('SHADOW TARGET OK');
  });

  it('honours --root and reports every .env file, sorted', () => {
    const h = guardHarness({ files: ['.env.local', '.env', '.env.example'] });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL', '--root', '/elsewhere'], h.deps)).toBe(2);
    expect(h.listed[0]).toMatch(/elsewhere$/);
    const lines = h.err.filter((l) => l.includes('exists in'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('.env exists');
    expect(lines[1]).toContain('.env.local exists');
  });

  it('refuses when the directory cannot be listed (fail closed) without echoing the error text', () => {
    const h = guardHarness({ listFails: true });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toMatch(/cannot list/);
    expect(everything(h)).not.toContain(PASSWORD);
  });

  it('refuses a non-shadow required variable, saying only the name and the reason', () => {
    for (const name of ['afldb_test', 'afldb_dev', 'afldb_prod', 'afldb_v2_shadow']) {
      const h = guardHarness({ env: { SHADOW_DATABASE_URL: dsn(name) } });
      expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(2);
      expect(h.out).toContain(`  SHADOW_DATABASE_URL -> ${name}`);
      expect(everything(h)).not.toContain(PASSWORD);
      expect(everything(h)).not.toContain(HOST);
    }
  });

  it('refuses a required variable that is unset', () => {
    const h = guardHarness({ env: {} });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(2);
    expect(h.err.join('\n')).toContain('SHADOW_DATABASE_URL: required but not set');
  });

  it('refuses an unrelated DSN variable, PGSERVICE and a non-shadow PGDATABASE, listing every finding', () => {
    const h = guardHarness({
      env: { SHADOW_DATABASE_URL: dsn('afldb_v2_shadow_test'), DATABASE_URL: dsn('afldb_prod'), PGSERVICE: 'prod', PGDATABASE: 'afldb_dev' },
      files: ['.env'],
    });
    expect(runGuard(['check', '--require', 'SHADOW_DATABASE_URL'], h.deps)).toBe(2);
    const refused = h.err.filter((l) => l.startsWith('  REFUSED:'));
    expect(refused).toHaveLength(4);
    expect(refused.join('\n')).toMatch(/DATABASE_URL \(database 'afldb_prod'\)/);
    expect(refused.join('\n')).toMatch(/PGSERVICE: must be unset/);
    expect(refused.join('\n')).toMatch(/PGDATABASE \(database 'afldb_dev'\)/);
    expect(refused.join('\n')).toMatch(/\.env exists/);
    expect(everything(h)).not.toContain(PASSWORD);
  });

  it('checks every --require variable', () => {
    const env = { A_DATABASE_URL: dsn('afldb_v2_shadow_a_test'), B_DATABASE_URL: dsn('afldb_v2_shadow_b_test') };
    const ok = guardHarness({ env });
    expect(runGuard(['check', '--require', 'A_DATABASE_URL', '--require', 'B_DATABASE_URL'], ok.deps)).toBe(0);
    expect(ok.out).toContain('  A_DATABASE_URL -> afldb_v2_shadow_a_test');
    expect(ok.out).toContain('  B_DATABASE_URL -> afldb_v2_shadow_b_test');
    const bad = guardHarness({ env: { ...env, B_DATABASE_URL: dsn('afldb_test') } });
    expect(runGuard(['check', '--require', 'A_DATABASE_URL', '--require', 'B_DATABASE_URL'], bad.deps)).toBe(2);
  });

  it.each([
    [[], /usage/],
    [['status'], /usage/],
    [['check'], /at least one --require/],
    [['check', '--require'], /needs a value/],
    [['check', '--require', 'lower-case'], /must name an environment variable/],
    [['check', '--require', 'X_DATABASE_URL', '--bogus'], /unknown option/],
    [['check', '--require', 'X_DATABASE_URL', 'stray'], /unexpected argument/],
    [['check', '--require', 'X_DATABASE_URL', '--root', 'a', '--root', 'b'], /--root given twice/],
  ])('bad usage %j exits 2 and checks nothing', (argv, message) => {
    const h = guardHarness();
    expect(runGuard(argv, h.deps)).toBe(2);
    expect(h.err.join('\n')).toMatch(message);
    expect(h.listed).toEqual([]);
    expect(h.out).toEqual([]);
  });

  it('isForbiddenEnvFile', () => {
    expect(isForbiddenEnvFile('.env')).toBe(true);
    expect(isForbiddenEnvFile('.env.example')).toBe(false);
    expect(isForbiddenEnvFile('.env.example.bak')).toBe(true);
    expect(isForbiddenEnvFile('environment.ts')).toBe(false);
  });
});
