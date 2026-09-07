/** Read-only, fail-closed report for an operator about to merge an issue branch. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectMigrationSources,
  compareMigrationSets,
  findMigrationConflicts,
  type MigrationFinding,
} from '../db/migration-safety';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
type Options = { issue?: string; runbook?: string; expectedFiles: string[]; help: boolean };
type ReadinessRecord = {
  status: 'ready' | 'in-progress' | 'blocked';
  hardBlockers: string[];
  expectedFiles: string[];
  validation: string[];
};

class Report {
  failed = 0;
  warned = 0;

  add(status: Status, label: string, details: readonly string[] = []): void {
    if (status === 'FAIL') this.failed += 1;
    if (status === 'WARN') this.warned += 1;
    console.log(`${status.padEnd(4)} ${label}`);
    for (const detail of details) console.log(`     ${detail}`);
  }
}

function usage(): void {
  console.log(`Usage: npm run merge:ready -- [options]

  --issue NNN              locate the issue runbook when present
  --runbook PATH           explicit repository-relative Markdown runbook
  --expected-file PATH     repeatable exact path or directory prefix ending in /

The command is read-only: it does not fetch, stage, commit, merge, push, migrate or run tests.
It ends with Merge readiness: READY or BLOCKED.`);
}

function need(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { expectedFiles: [], help: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--issue': options.issue = need(argv, i, argv[i]); i += 1; break;
      case '--runbook': options.runbook = need(argv, i, argv[i]); i += 1; break;
      case '--expected-file': options.expectedFiles.push(need(argv, i, argv[i])); i += 1; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (options.issue) {
    const match = /^(?:AFLDB-ISSUE-)?(\d{3})$/i.exec(options.issue);
    if (!match) throw new Error('--issue must be NNN or AFLDB-ISSUE-NNN.');
    options.issue = match[1];
  }
  return options;
}

function runGit(root: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function gitText(root: string, args: readonly string[]): string {
  const result = runGit(root, args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function normalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function safeRepoPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes the repository: ${path}`);
  }
  return absolute;
}

function mainWorktree(root: string): string | undefined {
  return gitText(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .find((lines) => lines.includes('branch refs/heads/main'))
    ?.find((line) => line.startsWith('worktree '))
    ?.slice('worktree '.length);
}

function validateStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value as string[];
}

function readRecord(path: string): ReadinessRecord {
  const content = readFileSync(path, 'utf8');
  const match = /<!--\s*afldb-merge-readiness\s*\r?\n([\s\S]*?)\r?\n-->/i.exec(content);
  if (!match) throw new Error('runbook has no afldb-merge-readiness JSON block');
  const raw = JSON.parse(match[1]) as Record<string, unknown>;
  if (!['ready', 'in-progress', 'blocked'].includes(String(raw.status))) {
    throw new Error("status must be 'ready', 'in-progress' or 'blocked'");
  }
  return {
    status: raw.status as ReadinessRecord['status'],
    hardBlockers: validateStringArray(raw.hardBlockers, 'hardBlockers'),
    expectedFiles: validateStringArray(raw.expectedFiles, 'expectedFiles'),
    validation: validateStringArray(raw.validation, 'validation'),
  };
}

function locateRunbook(root: string, options: Options): string | undefined {
  if (options.runbook) {
    const path = safeRepoPath(root, options.runbook);
    if (!existsSync(path)) throw new Error(`runbook does not exist: ${options.runbook}`);
    return path;
  }
  if (!options.issue) return undefined;
  const candidates = [
    resolve(root, 'issues', 'open', `AFLDB-ISSUE-${options.issue}.md`),
    resolve(root, `AFLDB-ISSUE-${options.issue}.md`),
  ];
  return candidates.find((path) => existsSync(path));
}

function fileExpected(path: string, expected: readonly string[]): boolean {
  return expected.some((entry) => entry.endsWith('/') ? path.startsWith(entry) : path === entry);
}

function reportMigration(report: Report, finding: MigrationFinding): void {
  report.add(finding.severity === 'error' ? 'FAIL' : 'WARN', `migration ${finding.code}`, [finding.message]);
}

export function runMergeReadiness(argv: readonly string[], cwd = process.cwd()): number {
  let report: Report | undefined;
  try {
    const options = parseArgs(argv);
    if (options.help) { usage(); return 0; }
    const root = realpathSync(gitText(cwd, ['rev-parse', '--show-toplevel']));
    if (resolve(root).toLowerCase() !== resolve(realpathSync(cwd)).toLowerCase()) {
      throw new Error(`run from the issue worktree root: ${root}`);
    }

    report = new Report();
    console.log('AFLDB merge readiness (read-only)');
    console.log('No fetch, stage, commit, merge, push, migration or test command will run.\n');

    const branch = gitText(root, ['branch', '--show-current']);
    report.add(branch && branch !== 'main' && branch !== 'master' ? 'PASS' : 'FAIL',
      `current branch: ${branch || '<detached>'}`,
      branch === 'main' || branch === 'master' ? ['Run this from the issue branch before merging into main.'] : []);

    const statusLines = gitText(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'])
      .split(/\r?\n/).filter(Boolean);
    const staged = statusLines.filter((line) => line.slice(0, 2) !== '??' && line[0] !== ' ');
    const unstaged = statusLines.filter((line) => line.slice(0, 2) !== '??' && line[1] !== ' ');
    const untracked = statusLines.filter((line) => line.startsWith('??'));
    report.add(statusLines.length ? 'FAIL' : 'PASS', 'issue worktree is clean', [
      `staged: ${staged.length}; unstaged: ${unstaged.length}; untracked: ${untracked.length}`,
      ...statusLines.map((line) => `path: ${line}`),
    ]);

    const hasMain = runGit(root, ['show-ref', '--verify', '--quiet', 'refs/heads/main']).status === 0;
    const hasOrigin = runGit(root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main']).status === 0;
    if (!hasMain || !hasOrigin) {
      report.add('FAIL', 'main and recorded origin/main refs exist', [
        `local main: ${hasMain ? 'yes' : 'no'}; origin/main: ${hasOrigin ? 'yes' : 'no'}`,
      ]);
    } else {
      const mainSha = gitText(root, ['rev-parse', 'refs/heads/main^{commit}']);
      const originSha = gitText(root, ['rev-parse', 'refs/remotes/origin/main^{commit}']);
      report.add(mainSha === originSha ? 'PASS' : 'FAIL', 'local main equals recorded origin/main', [
        `main: ${mainSha}`,
        `origin/main: ${originSha}`,
        'No fetch was attempted; fetch/update main separately before treating the recorded ref as current.',
      ]);

      const [ahead, behind] = gitText(root, [
        'rev-list', '--left-right', '--count', 'HEAD...refs/heads/main',
      ]).split(/\s+/).map(Number);
      const mainAncestor = runGit(root, ['merge-base', '--is-ancestor', 'refs/heads/main', 'HEAD']).status === 0;
      report.add(mainAncestor && behind === 0 && ahead > 0 ? 'PASS' : 'FAIL', 'base/main relationship', [
        `ahead of main: ${ahead}; behind main: ${behind}`,
        ...(ahead > 0 ? [] : ['The branch has no commit to merge.']),
        ...(mainAncestor ? [] : ['Current main is not an ancestor of the issue branch.']),
      ]);
    }

    const mainPath = mainWorktree(root);
    if (!mainPath || !existsSync(mainPath)) {
      report.add('FAIL', 'main worktree is available', ['No accessible worktree on refs/heads/main was found.']);
    } else {
      const mainDirty = gitText(mainPath, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all']);
      report.add(mainDirty ? 'FAIL' : 'PASS', `main worktree is clean: ${mainPath}`,
        mainDirty ? mainDirty.split(/\r?\n/).map((line) => `path: ${line}`) : []);
    }

    const collected = collectMigrationSources(root);
    const migrationFindings = [
      ...findMigrationConflicts(collected.sources),
      ...compareMigrationSets(collected.current, collected.base, false),
    ];
    for (const finding of migrationFindings) reportMigration(report, finding);
    if (!migrationFindings.length) {
      report.add('PASS', `migration collision/checksum parity (${collected.baseRef})`);
    }
    report.add('INFO', 'database migration parity not checked', [
      'Use the appropriate operational preflight when a database target is part of the merge contract.',
    ]);

    let record: ReadinessRecord | undefined;
    const runbook = locateRunbook(root, options);
    if (runbook) {
      try {
        record = readRecord(runbook);
        report.add(record.status === 'ready' && record.hardBlockers.length === 0 ? 'PASS' : 'FAIL',
          `runbook readiness: ${normalPath(relative(root, runbook))}`, [
            `status: ${record.status}`,
            `hard blockers: ${record.hardBlockers.length}`,
            ...record.hardBlockers.map((blocker) => `blocker: ${blocker}`),
          ]);
        report.add(record.validation.length ? 'PASS' : 'WARN', 'recorded validation evidence',
          record.validation.length ? record.validation : ['No validation evidence is recorded in the readiness block.']);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.add(message.includes('has no afldb-merge-readiness') ? 'WARN' : 'FAIL',
          `runbook readiness metadata unavailable: ${normalPath(relative(root, runbook))}`, [message]);
      }
    } else {
      report.add('WARN', 'issue/runbook readiness metadata unavailable', [
        'Pass --runbook or add the documented afldb-merge-readiness JSON block.',
      ]);
    }

    const expected = [...new Set([...options.expectedFiles, ...(record?.expectedFiles ?? [])].map(normalPath))];
    for (const path of expected) safeRepoPath(root, path.endsWith('/') ? path.slice(0, -1) : path);
    const changed = gitText(root, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', 'refs/heads/main...HEAD'])
      .split(/\r?\n/).filter(Boolean).map(normalPath);
    if (!expected.length) {
      report.add('WARN', 'unexpected-file classification not available', [
        `${changed.length} committed changed file(s); record expectedFiles or pass --expected-file.`,
      ]);
    } else {
      const unexpected = changed.filter((path) => !fileExpected(path, expected));
      report.add(unexpected.length ? 'FAIL' : 'PASS', 'committed files match the declared issue scope', [
        `changed: ${changed.length}; expected rules: ${expected.length}; unexpected: ${unexpected.length}`,
        ...unexpected.map((path) => `unexpected: ${path}`),
      ]);
    }

    console.log(`\nMerge readiness: ${report.failed ? 'BLOCKED' : 'READY'} `
      + `(${report.failed} blocker(s), ${report.warned} warning(s)).`);
    return report.failed ? 1 : 0;
  } catch (error) {
    console.error(`Merge readiness: BLOCKED\n${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1]
    && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  process.exitCode = runMergeReadiness(process.argv.slice(2));
}
