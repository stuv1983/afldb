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
  databaseTargetProblems,
  defaultsFor,
  linuxHostPathProblems,
  msysEnvironmentProblem,
  parsePreflightArgs,
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
