/**
 * One read-only operator preflight for implementation, merge, inspection, rebuild,
 * promotion and deploy work.
 * It never fetches Git refs, writes a plan, applies a migration, or changes a database.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectMigrationSources,
  compareAppliedMigrations,
  compareMigrationSets,
  findMigrationConflicts,
  type AppliedMigration,
  type MigrationFinding,
} from '../db/migration-safety';
import { assertContractCoherent, historicalOnlyTables } from '../db/promotion-inventory';
import {
  branchPolicyProblems,
  databaseTargetProblems,
  defaultsFor,
  msysEnvironmentProblem,
  parsePreflightArgs,
  type PreflightMode,
} from './preflight-core';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO';

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

function run(command: string, args: readonly string[], cwd = PROJECT_ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function git(args: readonly string[]) {
  return run('git', args);
}

function gitText(args: readonly string[]): string {
  const result = git(args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function loadEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [rawName, ...rest] = trimmed.split('=');
    const name = rawName.trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) values.set(name, rest.join('=').trim());
  }
  return values;
}

function envValue(name: string, file: ReadonlyMap<string, string>): string | undefined {
  return process.env[name] || file.get(name) || undefined;
}

function redactConnectionError(message: string, dsn: string): string {
  let redacted = message.replaceAll(dsn, '<redacted DSN>');
  try {
    const url = new URL(dsn);
    for (const secret of [url.username, url.password, decodeURIComponent(url.username), decodeURIComponent(url.password)]) {
      if (secret) redacted = redacted.replaceAll(secret, '<redacted>');
    }
  } catch {
    return 'Connection failed (details withheld because the DSN could not be safely parsed).';
  }
  return redacted;
}

function toolCheck(report: Report, command: string, required: boolean): void {
  const result = run(command, ['--version']);
  if (result.status === 0) report.add('PASS', `${command} is available`);
  else report.add(required ? 'FAIL' : 'WARN', `${command} is unavailable`, [
    required ? `Install/put ${command} on PATH before this operation.` : 'Not required for this preflight mode.',
  ]);
}

function reportMigrationFinding(report: Report, finding: MigrationFinding, inspectionOnly = false): void {
  const status = finding.severity === 'error' && !inspectionOnly
    ? 'FAIL'
    : finding.severity === 'warning' || inspectionOnly ? 'WARN' : 'INFO';
  report.add(status, `migration ${finding.code}`, [finding.message]);
}

function checkGit(report: Report, mode: PreflightMode): void {
  const top = gitText(['rev-parse', '--show-toplevel']);
  const cwd = realpathSync(process.cwd());
  const topReal = realpathSync(top);
  report.add(samePath(topReal, PROJECT_ROOT) && samePath(cwd, PROJECT_ROOT) ? 'PASS' : 'FAIL',
    'working directory is this repository root', [
      `expected: ${PROJECT_ROOT}`,
      `actual:   ${cwd}`,
      ...(samePath(topReal, PROJECT_ROOT) ? [] : ['Git resolved a different repository; stop and change directories.']),
    ]);

  const branch = gitText(['branch', '--show-current']);
  const branchProblems = branchPolicyProblems(mode, branch);
  report.add(branchProblems.length ? 'FAIL' : 'PASS',
    branch ? `branch ${branch} is valid for ${mode}` : 'branch is attached', branchProblems);

  const dirty = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  const dirtyStatus = dirty ? (mode === 'read-only' ? 'WARN' : 'FAIL') : 'PASS';
  report.add(dirtyStatus, mode === 'read-only' ? 'working tree state (inspection only)' : 'working tree is clean', dirty
    ? [`${dirty.split(/\r?\n/).length} changed/untracked path(s); review and resolve them before the operation.`]
    : []);

  const gitDir = resolve(PROJECT_ROOT, gitText(['rev-parse', '--git-dir']));
  const commonDir = resolve(PROJECT_ROOT, gitText(['rev-parse', '--git-common-dir']));
  if (mode === 'implementation') {
    report.add(!samePath(gitDir, commonDir) ? 'PASS' : 'FAIL', 'implementation uses a linked worktree',
      samePath(gitDir, commonDir) ? ['The primary checkout is merge-only; create a linked worktree.'] : []);
  } else if (mode === 'merge') {
    report.add(samePath(gitDir, commonDir) ? 'PASS' : 'FAIL', 'merge uses the primary checkout',
      samePath(gitDir, commonDir) ? [] : ['Run operator merges from the clean primary main checkout.']);
  } else {
    report.add('INFO', samePath(gitDir, commonDir) ? 'primary checkout' : 'linked worktree checkout');
  }

  const hasMain = git(['show-ref', '--verify', '--quiet', 'refs/heads/main']).status === 0;
  if (!hasMain) {
    report.add(mode === 'read-only' ? 'WARN' : 'FAIL', 'local main ref exists',
      ['Fetch/update the repository before continuing.']);
    return;
  }
  const ancestor = git(['merge-base', '--is-ancestor', 'refs/heads/main', 'HEAD']).status === 0;
  const behind = Number(gitText(['rev-list', '--count', 'HEAD..refs/heads/main']));
  report.add(ancestor && behind === 0 ? 'PASS' : mode === 'read-only' ? 'WARN' : 'FAIL',
    'branch contains current local main', [
    `behind local main: ${behind}`,
    ...(ancestor ? [] : ['Current local main is not an ancestor of HEAD; rebase/recreate the worktree before work.']),
  ]);

  const hasOriginMain = git(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main']).status === 0;
  if (!hasOriginMain) {
    report.add('WARN', 'origin/main ref is unavailable', ['No fetch was attempted; freshness cannot be proven.']);
  } else {
    const [aheadOrigin, behindOrigin] = gitText([
      'rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/main',
    ]).split(/\s+/).map(Number);
    const unsafe = behindOrigin > 0 || (mode === 'deploy' && aheadOrigin > 0);
    report.add(unsafe ? (mode === 'read-only' ? 'WARN' : 'FAIL') : 'PASS',
      'branch relationship to recorded origin/main', [
      `ahead: ${aheadOrigin}; behind: ${behindOrigin}`,
      'Read-only check only: run the operator-approved fetch separately when remote freshness is required.',
    ]);
  }
}

async function checkDatabase(
  report: Report,
  mode: PreflightMode,
  dsnEnv: string,
  dsn: string,
  expectedDatabase: string | undefined,
  expectedRole: string | undefined,
  localMigrations: ReturnType<typeof collectMigrationSources>['current']['migrations'],
): Promise<void> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(dsn, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: `afldb-preflight:${mode}` },
  });
  try {
    await sql.unsafe('SET default_transaction_read_only = on');
    const identity = await sql<{ database: string; role: string }[]>`
      SELECT current_database() AS database, current_user AS role
    `;
    const actual = identity[0];
    const targetProblems = databaseTargetProblems(
      mode, expectedDatabase, actual.database, expectedRole, actual.role,
    );
    report.add(targetProblems.length ? 'FAIL' : 'PASS', `database reachable via ${dsnEnv}`, [
      `database: ${actual.database}`,
      `role: ${actual.role}`,
      ...targetProblems,
    ]);

    const applied = await sql<AppliedMigration[]>`
      SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name
    `;
    const parity = compareAppliedMigrations(localMigrations, applied);
    if (parity.length === 0) report.add('PASS', `migration parity (${applied.length}/${localMigrations.length})`);
    else for (const finding of parity) reportMigrationFinding(report, finding);
  } catch (error) {
    report.add('FAIL', `database preflight via ${dsnEnv}`, [
      error instanceof Error ? redactConnectionError(error.message, dsn) : 'connection/query failed',
      'Verify the tunnel/host, environment variable, role grants, and expected database name.',
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function usage(): void {
  console.log(`Usage: npm run preflight -- [options]

  --mode implementation|merge|read-only|rebuild|promotion|deploy
                                                   default: implementation
  --environment dev|prod                           default: dev
  --issue NNN                                      optional issue/workflow label
  --dsn-env NAME                                   DSN variable name; never pass the DSN
  --expect-database NAME                           exact database identity
  --expect-role NAME                               optional exact PostgreSQL role
  --ssh-host HOST                                  require a read-only BatchMode SSH probe

The command is read-only. It does not fetch refs, write plans, migrate, deploy, or mutate a database.`);
}

async function main(): Promise<void> {
  let options;
  try {
    options = defaultsFor(parsePreflightArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`FAIL arguments: ${error instanceof Error ? error.message : error}`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (options.help) { usage(); return; }

  const report = new Report();
  console.log(`AFLDB read-only preflight: ${options.mode} / ${options.environment}`
    + (options.issue ? ` / ${options.issue.toUpperCase()}` : ''));
  console.log('No Git fetch, database write, migration, plan write, deploy, or service action will run.\n');

  try {
    checkGit(report, options.mode);
  } catch (error) {
    report.add('FAIL', 'Git/repository checks could not run', [error instanceof Error ? error.message : String(error)]);
  }

  let collected: ReturnType<typeof collectMigrationSources> | undefined;
  try {
    collected = collectMigrationSources(PROJECT_ROOT);
    const conflicts = findMigrationConflicts(collected.sources);
    for (const finding of conflicts) reportMigrationFinding(report, finding, options.mode === 'read-only');
    const parity = compareMigrationSets(
      collected.current,
      collected.base,
      ['rebuild', 'promotion', 'deploy'].includes(options.mode),
    );
    for (const finding of parity) reportMigrationFinding(report, finding, options.mode === 'read-only');
    if (conflicts.length === 0 && parity.length === 0) {
      report.add('PASS', `migration names are collision-free across relevant refs/worktrees (${collected.baseRef})`);
    }
  } catch (error) {
    report.add(options.mode === 'read-only' ? 'WARN' : 'FAIL', 'migration inventory',
      [error instanceof Error ? error.message : String(error)]);
  }

  const envPath = join(PROJECT_ROOT, '.env');
  const envFile = loadEnvFile(envPath);
  const needsEnvironment = ['rebuild', 'promotion', 'deploy'].includes(options.mode);
  report.add(existsSync(envPath) ? 'PASS' : (needsEnvironment ? 'FAIL' : 'WARN'), '.env file presence',
    existsSync(envPath) ? [] : ['Create the local untracked .env before rebuild/promotion/deploy work.']);

  const msys = msysEnvironmentProblem(options.mode, process.env);
  report.add(msys ? 'FAIL' : 'PASS', 'Git Bash/MSYS path-conversion guard', msys ? [msys] : []);

  toolCheck(report, 'git', true);
  toolCheck(report, 'psql', needsEnvironment);
  toolCheck(report, 'pg_restore', options.mode === 'promotion');

  if (options.mode === 'promotion') {
    try {
      assertContractCoherent();
      const withheld = historicalOnlyTables(options.environment);
      report.add('PASS', 'promotion plan/disposition contract is coherent', [
        `${withheld.length} historical-only table(s) declared for ${options.environment}.`,
      ]);
    } catch (error) {
      report.add('FAIL', 'promotion plan/disposition contract', [error instanceof Error ? error.message : String(error)]);
    }
  }

  if (options.sshHost) {
    const ssh = run('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', options.sshHost, 'true',
    ]);
    report.add(ssh.status === 0 ? 'PASS' : 'FAIL', `SSH host ${options.sshHost} is reachable`,
      ssh.status === 0 ? [] : ['Verify the host alias/key/tunnel before the expensive operation.']);
  } else if (needsEnvironment) {
    report.add('WARN', 'SSH reachability was not requested', ['Pass --ssh-host <alias> when the operation crosses hosts.']);
  }

  if (options.dsnEnv) {
    const dsn = envValue(options.dsnEnv, envFile);
    report.add(dsn ? 'PASS' : 'FAIL', `${options.dsnEnv} is present`,
      dsn ? ['value is set and intentionally not printed'] : ['Set it in the environment or untracked .env.']);
    if (dsn && collected) {
      await checkDatabase(
        report, options.mode, options.dsnEnv, dsn, options.expectDatabase, options.expectRole,
        collected.current.migrations,
      );
    }
  }

  console.log(`\nPreflight result: ${report.failed ? 'BLOCKED' : 'READY'} `
    + `(${report.failed} blocker(s), ${report.warned} warning(s)).`);
  if (report.failed) {
    console.log('Resolve every FAIL and rerun this same command before the expensive or state-changing step.');
    process.exitCode = 1;
  }
}

void main();
