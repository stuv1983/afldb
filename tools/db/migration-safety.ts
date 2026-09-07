/**
 * Read-only migration inventory and collision checks shared by the operator
 * preflight and the migration runner.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  computeChecksumRepresentations,
  matchesStoredChecksum,
  type MigrationChecksumRepresentations,
} from './migration-checksum';

export const MIGRATION_DIRECTORY = 'src/db/migrations';

export type MigrationEntry = {
  name: string;
  contentId: string;
  checksum?: MigrationChecksumRepresentations;
};

export type MigrationSource = {
  label: string;
  migrations: readonly MigrationEntry[];
};

export type MigrationFinding = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
};

export type AppliedMigration = { name: string; checksum: string };

const MIGRATION_NAME = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i;

export function parseMigrationName(name: string): { number: string; description: string } | undefined {
  const match = MIGRATION_NAME.exec(basename(name));
  return match ? { number: match[1], description: match[2] } : undefined;
}

export function migrationContentId(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function readWorkingTreeMigrations(directory: string): MigrationEntry[] {
  if (!existsSync(directory)) throw new Error(`migration directory does not exist: ${directory}`);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(directory, name));
      const sql = bytes.toString('utf8');
      return {
        name,
        contentId: migrationContentId(sql),
        checksum: computeChecksumRepresentations(sql),
      };
    });
}

function addFinding(
  findings: MigrationFinding[], severity: MigrationFinding['severity'], code: string, message: string,
): void {
  findings.push({ severity, code, message });
}

/**
 * Detect filename problems across refs and worktrees. Identical copies of the same migration
 * on several refs are expected and collapse to one logical file. A shared numeric prefix with
 * two names, or one name with two contents, is a collision.
 */
export function findMigrationConflicts(sources: readonly MigrationSource[]): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const byNumber = new Map<string, Map<string, Set<string>>>();
  const byName = new Map<string, Map<string, Set<string>>>();

  for (const source of [...sources].sort((a, b) => a.label.localeCompare(b.label))) {
    for (const migration of [...source.migrations].sort((a, b) => a.name.localeCompare(b.name))) {
      const parsed = parseMigrationName(migration.name);
      if (!parsed) {
        addFinding(findings, 'error', 'invalid-name',
          `${migration.name} in ${source.label} is not named NNN_description.sql.`);
        continue;
      }
      const names = byNumber.get(parsed.number) ?? new Map<string, Set<string>>();
      const nameSources = names.get(migration.name) ?? new Set<string>();
      nameSources.add(source.label);
      names.set(migration.name, nameSources);
      byNumber.set(parsed.number, names);

      const contents = byName.get(migration.name) ?? new Map<string, Set<string>>();
      const contentSources = contents.get(migration.contentId) ?? new Set<string>();
      contentSources.add(source.label);
      contents.set(migration.contentId, contentSources);
      byName.set(migration.name, contents);
    }
  }

  for (const number of [...byNumber.keys()].sort()) {
    const names = byNumber.get(number)!;
    if (names.size <= 1) continue;
    const detail = [...names.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, labels]) => `${name} [${[...labels].sort().join(', ')}]`)
      .join('; ');
    addFinding(findings, 'error', 'duplicate-number', `migration number ${number} is claimed by: ${detail}`);
  }

  for (const name of [...byName.keys()].sort()) {
    const contents = byName.get(name)!;
    if (contents.size <= 1) continue;
    const labels = [...contents.values()].flatMap((value) => [...value]).sort();
    addFinding(findings, 'error', 'duplicate-name',
      `${name} has different contents across relevant refs/worktrees: ${[...new Set(labels)].join(', ')}`);
  }

  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

/** Compare the current checkout's migration set with its deploy base. */
export function compareMigrationSets(
  current: MigrationSource,
  base: MigrationSource,
  strictBranchParity: boolean,
): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const currentByName = new Map(current.migrations.map((entry) => [entry.name, entry]));
  const baseByName = new Map(base.migrations.map((entry) => [entry.name, entry]));

  for (const name of [...baseByName.keys()].sort()) {
    if (!currentByName.has(name)) {
      addFinding(findings, 'error', 'missing-base-migration',
        `${current.label} is missing ${name} from ${base.label}; update the branch before continuing.`);
    }
  }
  for (const name of [...currentByName.keys()].sort()) {
    if (baseByName.has(name)) continue;
    addFinding(findings, strictBranchParity ? 'error' : 'warning', 'branch-local-migration',
      `${name} exists in ${current.label} but not ${base.label}`
      + (strictBranchParity ? '; merge it before rebuild/promotion/deploy work.' : '; reserve its number before applying it outside *_test.'));
  }
  return findings;
}

/** Compare an applied database ledger with the exact checkout files. */
export function compareAppliedMigrations(
  local: readonly MigrationEntry[], applied: readonly AppliedMigration[],
): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const localByName = new Map(local.map((entry) => [entry.name, entry]));
  const appliedByName = new Map(applied.map((entry) => [entry.name, entry]));

  for (const entry of [...local].sort((a, b) => a.name.localeCompare(b.name))) {
    const stored = appliedByName.get(entry.name);
    if (!stored) {
      addFinding(findings, 'error', 'pending-migration', `${entry.name} is pending in the target database.`);
    } else if (!entry.checksum || !matchesStoredChecksum(stored.checksum, entry.checksum)) {
      addFinding(findings, 'error', 'checksum-mismatch',
        `${entry.name} is applied with a checksum that does not match this checkout.`);
    }
  }
  for (const entry of [...applied].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!localByName.has(entry.name)) {
      addFinding(findings, 'error', 'unknown-applied-migration',
        `${entry.name} is applied in the target database but absent from this checkout.`);
    }
  }
  return findings;
}

type GitResult = { status: number; stdout: string; stderr: string };

function git(repoRoot: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function requireGit(repoRoot: string, args: readonly string[]): string {
  const result = git(repoRoot, args);
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || 'unknown error'}`);
  }
  return result.stdout.trim();
}

function refMigrations(repoRoot: string, ref: string): MigrationEntry[] {
  const output = requireGit(repoRoot, ['ls-tree', '-r', ref, '--', MIGRATION_DIRECTORY]);
  if (!output) return [];
  const entries = output.split(/\r?\n/).map((line) => {
    const match = /^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/.exec(line);
    if (!match) throw new Error(`could not parse git ls-tree output for ${ref}: ${line}`);
    return { name: basename(match[2]), oid: match[1] };
  });
  const input = `${entries.map((entry) => entry.oid).join('\n')}\n`;
  const blobs = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot, input, encoding: null, windowsHide: true,
  });
  if ((blobs.status ?? 1) !== 0 || !blobs.stdout) {
    throw new Error(`git cat-file failed for ${ref}: ${blobs.stderr?.toString().trim() || blobs.error?.message || 'unknown error'}`);
  }
  const contents: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const newline = blobs.stdout.indexOf(0x0a, offset);
    if (newline < 0) throw new Error(`git cat-file returned a truncated header for ${ref}:${entry.name}`);
    const header = blobs.stdout.subarray(offset, newline).toString('utf8');
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (!match || match[1] !== entry.oid) {
      throw new Error(`git cat-file returned an unexpected header for ${ref}:${entry.name}: ${header}`);
    }
    const size = Number(match[2]);
    const start = newline + 1;
    const end = start + size;
    if (end >= blobs.stdout.length) throw new Error(`git cat-file returned truncated content for ${ref}:${entry.name}`);
    contents.push(blobs.stdout.subarray(start, end));
    offset = end + 1;
  }
  return entries.map((entry, index) => ({
    name: entry.name,
    contentId: migrationContentId(contents[index].toString('utf8')),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function worktreePaths(repoRoot: string): string[] {
  const output = requireGit(repoRoot, ['worktree', 'list', '--porcelain']);
  return output.split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)))
    .sort((a, b) => a.localeCompare(b));
}

function relevantRefs(repoRoot: string, baseRef: string): string[] {
  const output = requireGit(repoRoot, [
    'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes',
  ]);
  const current = requireGit(repoRoot, ['symbolic-ref', '-q', 'HEAD']);
  const always = new Set([baseRef, current, 'refs/heads/main', 'refs/remotes/origin/main']);
  const refs = output.split(/\r?\n/).filter(Boolean).filter((ref) => !ref.endsWith('/HEAD'));
  return refs.filter((ref) => {
    if (always.has(ref)) return true;
    // A merged historical branch no longer reserves a migration number. Any unmerged ref
    // still can, so include it even when no worktree currently has it checked out.
    return git(repoRoot, ['merge-base', '--is-ancestor', ref, baseRef]).status !== 0;
  }).sort((a, b) => a.localeCompare(b));
}

export type CollectedMigrationSources = {
  sources: MigrationSource[];
  current: MigrationSource;
  base: MigrationSource;
  baseRef: string;
};

/**
 * Scan current/unmerged refs plus worktrees. This reads migration filenames/content only and
 * never fetches, checks out, stages, or otherwise changes Git state.
 */
export function collectMigrationSources(repoRoot: string): CollectedMigrationSources {
  const root = resolve(repoRoot);
  const originMain = git(root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main']).status === 0;
  const localMain = git(root, ['show-ref', '--verify', '--quiet', 'refs/heads/main']).status === 0;
  const baseRef = originMain ? 'refs/remotes/origin/main' : (localMain ? 'refs/heads/main' : 'HEAD');
  const sources: MigrationSource[] = relevantRefs(root, baseRef)
    .map((ref) => ({ label: `ref:${ref}`, migrations: refMigrations(root, ref) }));

  let current: MigrationSource | undefined;
  for (const path of worktreePaths(root)) {
    const directory = join(path, MIGRATION_DIRECTORY);
    if (!existsSync(directory)) continue;
    const source = { label: `worktree:${path.replace(/\\/g, '/')}`, migrations: readWorkingTreeMigrations(directory) };
    sources.push(source);
    if (resolve(path).toLowerCase() === root.toLowerCase()) current = source;
  }
  if (!current) {
    current = { label: `worktree:${root.replace(/\\/g, '/')}`, migrations: readWorkingTreeMigrations(join(root, MIGRATION_DIRECTORY)) };
    sources.push(current);
  }

  const base = sources.find((source) => source.label === `ref:${baseRef}`)
    ?? { label: `ref:${baseRef}`, migrations: refMigrations(root, baseRef) };
  if (!sources.includes(base)) sources.push(base);
  return { sources, current, base, baseRef };
}

