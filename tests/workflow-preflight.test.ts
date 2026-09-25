/** DB-free regression coverage for the post-ISSUE-139 fail-fast workflow. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeChecksumRepresentations } from '../tools/db/migration-checksum';
import {
  compareAppliedMigrations,
  compareMigrationSets,
  findMigrationConflicts,
  migrationContentId,
  parseMigrationName,
  type MigrationEntry,
  type MigrationSource,
} from '../tools/db/migration-safety';
import {
  branchPolicyProblems,
  classifyWorktreeStatus,
  databaseTargetProblems,
  defaultsFor,
  linuxHostPathProblems,
  msysEnvironmentProblem,
  parsePreflightArgs,
  probeDatabase,
  PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS,
  worktreeFinding,
  type PreflightFinding,
} from '../tools/dev/preflight-core';
import { runBootstrap } from '../tools/dev/bootstrap-worktree';
import { runMergeReadiness } from '../tools/dev/merge-readiness';

function migration(name: string, contentId = name): MigrationEntry {
  return { name, contentId, checksum: computeChecksumRepresentations(`-- ${contentId}\n`) };
}

function source(label: string, ...migrations: MigrationEntry[]): MigrationSource {
  return { label, migrations };
}

const scratch: string[] = [];
const bootstrapCli = 'bootstrap';
const readinessCli = 'readiness';

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function tool(cwd: string, script: string, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...values) => stdout.push(values.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation((...values) => stderr.push(values.join(' ')));
  try {
    const status = script === bootstrapCli
      ? runBootstrap(args, cwd)
      : runMergeReadiness(args, cwd);
    return { status, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), 'afldb-workflow-'));
  scratch.push(root);
  const origin = join(root, 'origin.git');
  const main = join(root, 'main');
  mkdirSync(main);
  git(root, 'init', '--bare', origin);
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'AFLDB Test');
  git(main, 'config', 'user.email', 'afldb-test@example.invalid');
  mkdirSync(join(main, 'src', 'db', 'migrations'), { recursive: true });
  writeFileSync(join(main, 'README.md'), 'fixture\n');
  writeFileSync(join(main, 'src', 'db', 'migrations', '001_base.sql'), 'SELECT 1;\n');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'fixture base');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-u', 'origin', 'main');
  return { root, main, origin, target: join(root, 'afldb-issue-145') };
}

function addFeature(main: string, target: string): void {
  git(main, 'worktree', 'add', '-b', 'codex/issue-145', target, 'main');
  git(target, 'config', 'user.name', 'AFLDB Test');
  git(target, 'config', 'user.email', 'afldb-test@example.invalid');
}

function writeReadinessRunbook(
  target: string,
  overrides: Partial<{ status: string; hardBlockers: string[]; expectedFiles: string[]; validation: string[] }> = {},
): void {
  const record = {
    status: 'ready',
    hardBlockers: [],
    expectedFiles: ['src/change.txt', 'issues/open/AFLDB-ISSUE-145.md'],
    validation: ['npm test -- focused: PASS'],
    ...overrides,
  };
  mkdirSync(join(target, 'issues', 'open'), { recursive: true });
  writeFileSync(
    join(target, 'issues', 'open', 'AFLDB-ISSUE-145.md'),
    `# Test runbook\n\n<!-- afldb-merge-readiness\n${JSON.stringify(record)}\n-->\n`,
  );
}

function commitReadyFeature(target: string, overrides = {}): void {
  mkdirSync(join(target, 'src'), { recursive: true });
  writeFileSync(join(target, 'src', 'change.txt'), 'scoped change\n');
  writeReadinessRunbook(target, overrides);
  git(target, 'add', '.');
  git(target, 'commit', '-m', 'issue change');
}

afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

describe('migration collision preflight', () => {
  it('keeps the current checkout migration numbers and names unique', () => {
    const entries = readdirSync(join(process.cwd(), 'src', 'db', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => migration(name));
    expect(findMigrationConflicts([source('current checkout', ...entries)])).toEqual([]);
  });

  it('parses the tracked migration naming contract', () => {
    expect(parseMigrationName('091_access_code_delete.sql')).toEqual({
      number: '091', description: 'access_code_delete',
    });
    expect(parseMigrationName('access_code_delete.sql')).toBeUndefined();
  });

  it('refuses a numeric-prefix collision across a branch and worktree', () => {
    const findings = findMigrationConflicts([
      source('ref:refs/heads/main', migration('079_nl_search_log_head_to_head_grain.sql', 'main')),
      source('worktree:D:/dev/afldb-issue-117', migration('079_access_code_delete.sql', 'branch')),
    ]);
    expect(findings).toEqual([expect.objectContaining({
      severity: 'error', code: 'duplicate-number',
      message: expect.stringMatching(/079.*access_code_delete.*nl_search_log_head_to_head_grain/),
    })]);
  });

  it('refuses one migration name with different contents, but collapses identical copies', () => {
    expect(findMigrationConflicts([
      source('main', migration('091_access_code_delete.sql', 'same')),
      source('current', migration('091_access_code_delete.sql', 'same')),
    ])).toEqual([]);
    expect(findMigrationConflicts([
      source('main', migration('091_access_code_delete.sql', 'before')),
      source('current', migration('091_access_code_delete.sql', 'edited')),
    ])).toEqual([expect.objectContaining({ code: 'duplicate-name', severity: 'error' })]);
  });

  it('treats checkout-only CRLF/LF differences as identical migration content', () => {
    expect(migrationContentId('BEGIN;\nSELECT 1;\nCOMMIT;\n'))
      .toBe(migrationContentId('BEGIN;\r\nSELECT 1;\r\nCOMMIT;\r\n'));
  });

  it('reports stale and branch-local migration sets deterministically', () => {
    const base = source('origin/main', migration('090_a.sql'), migration('091_b.sql'));
    const current = source('current', migration('090_a.sql'), migration('092_c.sql'));
    expect(compareMigrationSets(current, base, false).map((finding) => [finding.code, finding.severity]))
      .toEqual([
        ['missing-base-migration', 'error'],
        ['branch-local-migration', 'warning'],
      ]);
    expect(compareMigrationSets(current, base, true)[1].severity).toBe('error');
  });

  it('refuses pending, unknown and checksum-mismatched applied migrations', () => {
    const local = [
      migration('090_a.sql', 'a'), migration('091_b.sql', 'b'), migration('092_c.sql', 'c'),
    ];
    const findings = compareAppliedMigrations(local, [
      { name: '090_a.sql', checksum: local[0].checksum!.canonicalLf },
      { name: '091_b.sql', checksum: computeChecksumRepresentations('-- changed\n').canonicalLf },
      { name: '089_orphan.sql', checksum: '0'.repeat(64) },
    ]);
    expect(findings.map((finding) => finding.code).sort()).toEqual([
      'checksum-mismatch', 'pending-migration', 'unknown-applied-migration',
    ]);
  });
});

describe('operator preflight safety', () => {
  it('keeps main merge-only without blocking merge or read-only sessions', () => {
    expect(branchPolicyProblems('implementation', 'main')).toEqual([
      'Implementation work must use a feature worktree; main is merge-only.',
    ]);
    expect(branchPolicyProblems('implementation', 'codex/issue-145')).toEqual([]);
    expect(branchPolicyProblems('merge', 'main')).toEqual([]);
    expect(branchPolicyProblems('merge', 'codex/issue-145')).toHaveLength(1);
    expect(branchPolicyProblems('read-only', 'main')).toEqual([]);
    expect(defaultsFor(parsePreflightArgs(['--mode', 'merge']))).not.toHaveProperty('dsnEnv');
    expect(defaultsFor(parsePreflightArgs(['--mode', 'read-only']))).not.toHaveProperty('dsnEnv');
  });

  it('accepts only environment-variable names for database configuration', () => {
    expect(parsePreflightArgs(['--mode', 'rebuild', '--dsn-env', 'AFLDB_TEST_DATABASE_URL']))
      .toMatchObject({ mode: 'rebuild', dsnEnv: 'AFLDB_TEST_DATABASE_URL' });
    expect(() => parsePreflightArgs(['--dsn-env', 'postgresql://user:secret@host/db']))
      .toThrow(/never a DSN/);
  });

  it('refuses test-vs-dev target mistakes', () => {
    expect(databaseTargetProblems('rebuild', 'afldb_test', 'afldb_dev')).toContain(
      "connected to 'afldb_dev', expected 'afldb_test'",
    );
    expect(databaseTargetProblems('rebuild', undefined, 'afldb_dev')).toContain(
      "mode 'rebuild' requires a *_test source database, got 'afldb_dev'",
    );
    expect(databaseTargetProblems('deploy', undefined, 'afldb_test')).toContain(
      "deploy preflight must not target a *_test database, got 'afldb_test'",
    );
  });

  it('detects the exact Git Bash path conversion seen in ISSUE-139', () => {
    expect(linuxHostPathProblems('/home/arm/example.dump')).toEqual([]);
    expect(linuxHostPathProblems('C:/Program Files/Git/home/arm/example.dump'))
      .toContain('looks like a Windows/MSYS-rewritten path');
    expect(msysEnvironmentProblem('promotion', { MSYSTEM: 'MINGW64' }))
      .toMatch(/MSYS_NO_PATHCONV=1/);
    expect(msysEnvironmentProblem('promotion', {
      MSYSTEM: 'MINGW64', MSYS_NO_PATHCONV: '1',
    })).toBeUndefined();
  });
});

describe('AFLDB-ISSUE-243 promotion source vs target preflight', () => {
  const promotion = (...args: string[]) => defaultsFor(parsePreflightArgs(['--mode', 'promotion', ...args]));
  const LOCAL = [migration('001_base.sql')];
  const APPLIED = LOCAL.map((entry) => ({ name: entry.name, checksum: entry.checksum!.raw }));

  function fakeProbe(database: string, role: string, ledger: () => Promise<{ name: string; checksum: string }[]>) {
    return { identity: vi.fn(async () => ({ database, role })), appliedMigrations: vi.fn(ledger) };
  }
  const deniedLedger = () => Promise.reject(new Error('permission denied for schema afldb_meta'));

  async function probeTarget(role: string, database = 'afldb_dev', env = 'dev') {
    const options = promotion('--environment', env, '--promotion-side', 'target',
      '--dsn-env', 'AFLDB_IMPORT_DATABASE_URL', '--expect-role', role);
    const probe = fakeProbe(database, role, deniedLedger);
    const findings: PreflightFinding[] = [];
    await probeDatabase(probe, {
      mode: options.mode, promotionSide: options.promotionSide, dsnEnv: options.dsnEnv!,
      expectedDatabase: options.expectDatabase, expectedRole: options.expectRole, localMigrations: LOCAL,
    }, (finding) => findings.push(finding));
    return { probe, findings };
  }

  it('resolves source to afldb_test and target to the exact environment database', () => {
    expect(promotion('--promotion-side', 'source')).toMatchObject({
      promotionSide: 'source', dsnEnv: 'AFLDB_TEST_DATABASE_URL', expectDatabase: 'afldb_test',
    });
    expect(promotion('--promotion-side', 'target', '--dsn-env', 'AFLDB_OWNER_DATABASE_URL'))
      .toMatchObject({ promotionSide: 'target', expectDatabase: 'afldb_dev' });
    expect(promotion('--environment', 'prod', '--promotion-side', 'target', '--dsn-env', 'AFLDB_PROD_DATABASE_URL'))
      .toMatchObject({ promotionSide: 'target', expectDatabase: 'afldb_prod' });
  });

  it('refuses invalid side combinations before any database contact', () => {
    expect(() => promotion('--promotion-side', 'target', '--environment', 'dev',
      '--dsn-env', 'AFLDB_OWNER_DATABASE_URL', '--expect-database', 'afldb_prod')).toThrow(/exactly 'afldb_dev'/);
    expect(() => promotion('--promotion-side', 'target', '--environment', 'prod',
      '--dsn-env', 'AFLDB_PROD_DATABASE_URL', '--expect-database', 'afldb_dev')).toThrow(/exactly 'afldb_prod'/);
    expect(() => promotion('--promotion-side', 'target', '--expect-database', 'afldb_test',
      '--dsn-env', 'AFLDB_TEST_DATABASE_URL')).toThrow(/exactly 'afldb_dev'/);
    expect(() => promotion('--promotion-side', 'source', '--expect-database', 'afldb_dev'))
      .toThrow(/must be a \*_test database/);
    expect(() => promotion('--promotion-side', 'target')).toThrow(/needs --dsn-env/);
    expect(() => promotion('--expect-database', 'afldb_test')).toThrow(/needs --promotion-side/);
    expect(() => promotion('--promotion-side', 'both')).toThrow(/Unknown promotion side/);
    for (const mode of ['implementation', 'merge', 'read-only', 'rebuild', 'deploy']) {
      expect(() => parsePreflightArgs(['--mode', mode, '--promotion-side', 'source']))
        .toThrow(/only valid with --mode promotion/);
    }
  });

  it('judges the connected database by side', () => {
    expect(databaseTargetProblems('promotion', 'afldb_test', 'afldb_test', undefined, undefined, 'source')).toEqual([]);
    expect(databaseTargetProblems('promotion', 'afldb_test', 'afldb_dev', undefined, undefined, 'source')).toEqual([
      "connected to 'afldb_dev', expected 'afldb_test'",
      "mode 'promotion' requires a *_test source database, got 'afldb_dev'",
    ]);
    expect(databaseTargetProblems('promotion', 'afldb_dev', 'afldb_dev', 'afldb_import', 'afldb_import', 'target'))
      .toEqual([]);
    expect(databaseTargetProblems('promotion', 'afldb_dev', 'afldb_prod', undefined, undefined, 'target'))
      .toEqual(["connected to 'afldb_prod', expected 'afldb_dev'"]);
    expect(databaseTargetProblems('promotion', 'afldb_prod', 'afldb_prod', undefined, undefined, 'target')).toEqual([]);
    expect(databaseTargetProblems('promotion', 'afldb_prod', 'afldb_dev', undefined, undefined, 'target'))
      .toEqual(["connected to 'afldb_dev', expected 'afldb_prod'"]);
    expect(databaseTargetProblems('promotion', 'afldb_dev', 'afldb_dev', 'afldb_backup', 'afldb_import', 'target'))
      .toEqual(["connected as role 'afldb_import', expected 'afldb_backup'"]);
    expect(databaseTargetProblems('promotion', undefined, 'afldb_dev', undefined, undefined, 'target'))
      .toContain('promotion target check needs an exact expected database');
    // Rebuild and deploy are unchanged; a side-less promotion keeps the strict source rule.
    expect(databaseTargetProblems('promotion', undefined, 'afldb_dev')).toContain(
      "mode 'promotion' requires a *_test source database, got 'afldb_dev'",
    );
    expect(databaseTargetProblems('rebuild', undefined, 'afldb_dev', undefined, undefined, 'target')).toContain(
      "mode 'rebuild' requires a *_test source database, got 'afldb_dev'",
    );
  });

  it('proves target import/backup identity without reading the migration ledger', async () => {
    for (const role of ['afldb_import', 'afldb_backup']) {
      const { probe, findings } = await probeTarget(role);
      expect(probe.appliedMigrations).not.toHaveBeenCalled();
      expect(findings[0]).toMatchObject({ status: 'PASS', label: 'database reachable via AFLDB_IMPORT_DATABASE_URL' });
      expect(findings.map((finding) => finding.status)).not.toContain('FAIL');
      expect(findings[1]).toMatchObject({ status: 'INFO', label: 'migration parity not read on a promotion target' });
    }
    const prod = await probeTarget('afldb_import', 'afldb_prod', 'prod');
    expect(prod.findings[0].status).toBe('PASS');
    const wrong = await probeTarget('afldb_import', 'afldb_prod', 'dev');
    expect(wrong.findings[0]).toMatchObject({ status: 'FAIL' });
    expect(wrong.findings[0].details).toContain("connected to 'afldb_prod', expected 'afldb_dev'");
  });

  it('still requires migration parity on the source', async () => {
    const options = promotion('--promotion-side', 'source', '--expect-role', 'afldb_owner');
    const context = {
      mode: options.mode, promotionSide: options.promotionSide, dsnEnv: options.dsnEnv!,
      expectedDatabase: options.expectDatabase, expectedRole: options.expectRole, localMigrations: LOCAL,
    };
    const findings: PreflightFinding[] = [];
    const matching = fakeProbe('afldb_test', 'afldb_owner', async () => APPLIED);
    await probeDatabase(matching, context, (finding) => findings.push(finding));
    expect(matching.appliedMigrations).toHaveBeenCalledTimes(1);
    expect(findings.map((finding) => [finding.status, finding.label])).toEqual([
      ['PASS', 'database reachable via AFLDB_TEST_DATABASE_URL'],
      ['PASS', 'migration parity (1/1)'],
    ]);

    const pending: PreflightFinding[] = [];
    await probeDatabase(fakeProbe('afldb_test', 'afldb_owner', async () => []), context, (f) => pending.push(f));
    expect(pending.slice(1).map((finding) => finding.status)).toContain('FAIL');

    await expect(probeDatabase(fakeProbe('afldb_test', 'afldb_owner', deniedLedger), context, () => {}))
      .rejects.toThrow(/permission denied/);

    const wrongRole: PreflightFinding[] = [];
    await probeDatabase(fakeProbe('afldb_test', 'afldb_import', async () => APPLIED), context, (f) => wrongRole.push(f));
    expect(wrongRole[0]).toMatchObject({ status: 'FAIL' });
    expect(wrongRole[0].details).toContain("connected as role 'afldb_import', expected 'afldb_owner'");
  });
});

describe('AFLDB-ISSUE-243 promotion working-tree classification', () => {
  const SETTLE = 'docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-2026-09-15-2201.json';
  const z = (...entries: string[]) => entries.map((entry) => `${entry}\0`).join('');

  it('shares the exact settle-manifest pattern with the DEV deploy classifier', () => {
    const deploy = readFileSync(join(process.cwd(), 'deploy', 'sync-dev-remote.sh'), 'utf8');
    expect(PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS).toHaveLength(1);
    for (const pattern of PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS) {
      expect(deploy).toContain(`[[ "$path" =~ ${pattern} ]] && return 0`);
    }
  });

  it('downgrades only untracked settle manifests to WARN in promotion mode', () => {
    const both = z(`?? ${SETTLE}`,
      '?? docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-2026-09-15-2203.json');
    expect(worktreeFinding('promotion', both)).toMatchObject({
      status: 'WARN', label: 'working tree holds only known operational artefacts',
    });
    expect(worktreeFinding('promotion', '')).toMatchObject({ status: 'PASS' });
  });

  it('keeps every other dirty path a promotion blocker', () => {
    const cases = [
      z(` M ${SETTLE}`),                                        // tracked modification of an allowlisted path
      z(`A  ${SETTLE}`),                                        // staged
      z('M  src/lib/settings.ts'),                              // staged source change
      z(' M tools/dev/preflight.ts'),                           // unstaged script change
      z('?? src/db/migrations/999_new.sql'),                    // unknown untracked migration
      z('?? notes.txt'),                                        // unknown untracked file
      z('?? docs/rebuild-manifests/afltables_fitzroy_core/extra.json'), // JSON outside the pattern
      z('?? docs/rebuild-manifests/afl_api/settle-2026.json'),  // another manifest root
      z('?? afldb-ui-questions-2026.csv'),                      // deploy-only allowlist entry
      z('?? .env.bak-20260925'),                                // deploy-only allowlist entry
      z(`?? ${SETTLE}`, '?? scratch.json'),                     // known plus unknown
      z('R  new.ts', 'old.ts'),                                 // rename
    ];
    for (const porcelain of cases) {
      expect(worktreeFinding('promotion', porcelain).status, porcelain).toBe('FAIL');
    }
    expect(classifyWorktreeStatus(z('R  new.ts', 'old.ts', `?? ${SETTLE}`))).toEqual({
      tracked: ['old.ts -> new.ts'], known: [SETTLE], unknown: [],
    });
  });

  it('does not relax rebuild, deploy, implementation or merge', () => {
    for (const mode of ['rebuild', 'deploy', 'implementation', 'merge'] as const) {
      expect(worktreeFinding(mode, z(`?? ${SETTLE}`)).status).toBe('FAIL');
    }
    expect(worktreeFinding('read-only', z(' M README.md')).status).toBe('WARN');
  });

  it('classifies real git -z output from a checkout', () => {
    const fixture = makeRepository();
    const manifests = join(fixture.main, 'docs', 'rebuild-manifests', 'afltables_fitzroy_core');
    mkdirSync(manifests, { recursive: true });
    writeFileSync(join(manifests, 'settle-2026-2026-09-15-2201.json'), '{}\n');
    writeFileSync(join(manifests, 'settle-2026-2026-09-15-2203.json'), '{}\n');
    const status = () => spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: fixture.main, encoding: 'utf8', windowsHide: true,
    }).stdout;
    expect(worktreeFinding('promotion', status()).status).toBe('WARN');

    writeFileSync(join(fixture.main, 'README.md'), 'changed\n');
    const tracked = worktreeFinding('promotion', status());
    expect(tracked.status).toBe('FAIL');
    expect(tracked.details).toContain('blocker (tracked/staged): README.md');
  });
});

describe('safe issue worktree bootstrap', () => {
  it('creates a fresh branch/worktree at the exact fetched main SHA', () => {
    const fixture = makeRepository();
    const base = git(fixture.main, 'rev-parse', 'main');
    const run = tool(fixture.main, bootstrapCli, '--issue', '145', '--branch', 'codex/issue-145');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('Worktree bootstrap: CREATED');
    expect(run.stdout).toContain(`Base SHA:  ${base}`);
    expect(git(fixture.target, 'rev-parse', 'HEAD')).toBe(base);
    expect(git(fixture.target, 'branch', '--show-current')).toBe('codex/issue-145');
  });

  it('refuses an existing target directory without deleting its contents', () => {
    const fixture = makeRepository();
    mkdirSync(fixture.target);
    const sentinel = join(fixture.target, 'keep.txt');
    writeFileSync(sentinel, 'keep\n');
    const run = tool(fixture.main, bootstrapCli, '--issue', '145', '--branch', 'codex/issue-145');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('target directory already exists; refusing reuse');
    expect(readFileSync(sentinel, 'utf8')).toBe('keep\n');
  });

  it('refuses an existing branch instead of silently reusing stale state', () => {
    const fixture = makeRepository();
    git(fixture.main, 'branch', 'codex/issue-145', 'main');
    const run = tool(fixture.main, bootstrapCli, '--issue', '145', '--branch', 'codex/issue-145');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/branch already exists at [0-9a-f]{40}; refusing stale\/silent reuse/);
    expect(existsSync(fixture.target)).toBe(false);
  });

  it('copies only an explicitly approved same-issue handoff', () => {
    const fixture = makeRepository();
    writeFileSync(join(fixture.main, 'AFLDB-ISSUE-145.md'), '# Approved handoff\n');
    const run = tool(
      fixture.main, bootstrapCli, '--issue', '145', '--branch', 'codex/issue-145',
      '--copy-handoff', 'AFLDB-ISSUE-145.md',
    );
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(fixture.target, 'AFLDB-ISSUE-145.md'), 'utf8')).toBe('# Approved handoff\n');
    expect(run.stdout).toContain('Copied approved handoff only: AFLDB-ISSUE-145.md');
  });

  it('does not copy or ignore arbitrary untracked files', () => {
    const fixture = makeRepository();
    writeFileSync(join(fixture.main, 'AFLDB-ISSUE-145.md'), '# Approved handoff\n');
    writeFileSync(join(fixture.main, 'notes.txt'), 'not approved\n');
    const run = tool(
      fixture.main, bootstrapCli, '--issue', '145', '--branch', 'codex/issue-145',
      '--copy-handoff', 'AFLDB-ISSUE-145.md',
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('main is not clean');
    expect(run.stderr).toContain('notes.txt');
    expect(existsSync(fixture.target)).toBe(false);
  });
});

describe('merge readiness report', () => {
  it('reports a clean, current, scoped issue branch READY with ahead/behind evidence', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target);
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('ahead of main: 1; behind main: 0');
    expect(run.stdout).toContain('migration collision/checksum parity');
    expect(run.stdout).toContain('npm test -- focused: PASS');
    expect(run.stdout).toContain('Merge readiness: READY');
  });

  it('blocks staged/unstaged changes and lists their path', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target);
    writeFileSync(join(fixture.target, 'src', 'change.txt'), 'modified\n');
    git(fixture.target, 'add', 'src/change.txt');
    writeFileSync(join(fixture.target, 'src', 'change.txt'), 'modified again\n');
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('staged: 1; unstaged: 1; untracked: 0');
    expect(run.stdout).toContain('src/change.txt');
    expect(run.stdout).toContain('Merge readiness: BLOCKED');
  });

  it('does not count an unstaged-only first path as staged', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target);
    writeFileSync(join(fixture.target, 'src', 'change.txt'), 'modified\n');
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('staged: 0; unstaged: 1; untracked: 0');
    expect(run.stdout).toContain('path:  M src/change.txt');
    expect(run.stdout).toContain('Merge readiness: BLOCKED');
  });

  it('blocks and lists untracked files', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target);
    writeFileSync(join(fixture.target, 'surprise.txt'), 'untracked\n');
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('untracked: 1');
    expect(run.stdout).toContain('surprise.txt');
  });

  it('blocks a branch behind current clean origin/main and reports both counts', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target);
    writeFileSync(join(fixture.main, 'README.md'), 'main advanced\n');
    git(fixture.main, 'add', 'README.md');
    git(fixture.main, 'commit', '-m', 'advance main');
    git(fixture.main, 'push', 'origin', 'main');
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('ahead of main: 1; behind main: 1');
    expect(run.stdout).toContain('Merge readiness: BLOCKED');
  });

  it('blocks a migration-number collision', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    writeFileSync(join(fixture.target, 'src', 'db', 'migrations', '001_feature.sql'), 'SELECT 2;\n');
    commitReadyFeature(fixture.target, {
      expectedFiles: [
        'src/change.txt',
        'src/db/migrations/001_feature.sql',
        'issues/open/AFLDB-ISSUE-145.md',
      ],
    });
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('migration duplicate-number');
    expect(run.stdout).toContain('migration number 001 is claimed by');
  });

  it('blocks a committed file outside the declared issue scope', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target, {
      expectedFiles: ['issues/open/AFLDB-ISSUE-145.md'],
    });
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('unexpected: src/change.txt');
  });

  it('blocks an explicitly unresolved hard blocker in the runbook', () => {
    const fixture = makeRepository();
    addFeature(fixture.main, fixture.target);
    commitReadyFeature(fixture.target, { status: 'blocked', hardBlockers: ['operator decision pending'] });
    const run = tool(fixture.target, readinessCli, '--issue', '145');
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('blocker: operator decision pending');
  });
});
