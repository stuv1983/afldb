import { isAbsolute } from 'node:path';

import {
  compareAppliedMigrations,
  type AppliedMigration,
  type MigrationEntry,
  type MigrationFinding,
} from '../db/migration-safety';

export type PreflightMode =
  | 'implementation'
  | 'merge'
  | 'read-only'
  | 'rebuild'
  | 'promotion'
  | 'deploy';
export type PreflightEnvironment = 'dev' | 'prod';
/**
 * AFLDB-ISSUE-243. A promotion reads a rebuilt *_test SOURCE and replaces a live TARGET, and the
 * two are checked differently. The side is always stated by the operator, never inferred from a
 * role name or DSN text.
 */
export type PromotionSide = 'source' | 'target';

export type PreflightOptions = {
  mode: PreflightMode;
  environment: PreflightEnvironment;
  promotionSide?: PromotionSide;
  issue?: string;
  dsnEnv?: string;
  expectDatabase?: string;
  expectRole?: string;
  sshHost?: string;
  help: boolean;
};

function need(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}

export function parsePreflightArgs(argv: readonly string[]): PreflightOptions {
  const options: PreflightOptions = { mode: 'implementation', environment: 'dev', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--mode': {
        const value = need(argv, i, arg);
        if (!['implementation', 'merge', 'read-only', 'rebuild', 'promotion', 'deploy'].includes(value)) {
          throw new Error(`Unknown preflight mode '${value}'.`);
        }
        options.mode = value as PreflightMode;
        i += 1;
        break;
      }
      case '--environment': {
        const value = need(argv, i, arg);
        if (!['dev', 'prod'].includes(value)) throw new Error(`Unknown environment '${value}'.`);
        options.environment = value as PreflightEnvironment;
        i += 1;
        break;
      }
      case '--promotion-side': {
        const value = need(argv, i, arg);
        if (!['source', 'target'].includes(value)) throw new Error(`Unknown promotion side '${value}'.`);
        options.promotionSide = value as PromotionSide;
        i += 1;
        break;
      }
      case '--issue': options.issue = need(argv, i, arg); i += 1; break;
      case '--dsn-env': options.dsnEnv = need(argv, i, arg); i += 1; break;
      case '--expect-database': options.expectDatabase = need(argv, i, arg); i += 1; break;
      case '--expect-role': options.expectRole = need(argv, i, arg); i += 1; break;
      case '--ssh-host': options.sshHost = need(argv, i, arg); i += 1; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.issue && !/^(?:AFLDB-ISSUE-)?\d{3}$/i.test(options.issue)) {
    throw new Error('--issue must be NNN or AFLDB-ISSUE-NNN.');
  }
  if (options.dsnEnv && !/^[A-Z][A-Z0-9_]*$/.test(options.dsnEnv)) {
    throw new Error('--dsn-env takes an environment variable name, never a DSN.');
  }
  if (options.expectRole && !/^[a-z_][a-z0-9_-]*$/i.test(options.expectRole)) {
    throw new Error('--expect-role is not a plausible PostgreSQL role name.');
  }
  const sideProblem = promotionSideProblem(options);
  if (sideProblem) throw new Error(sideProblem);
  return options;
}

/** The only database a promotion may replace in each environment. */
export function promotionTargetDatabase(environment: PreflightEnvironment): string {
  return environment === 'prod' ? 'afldb_prod' : 'afldb_dev';
}

/** Argument-level refusal, before any database is contacted. */
function promotionSideProblem(options: PreflightOptions): string | undefined {
  if (options.mode !== 'promotion') {
    return options.promotionSide
      ? `--promotion-side is only valid with --mode promotion, not '${options.mode}'.`
      : undefined;
  }
  if (!options.promotionSide) {
    return '--mode promotion needs --promotion-side source|target '
      + '(source = the rebuilt *_test database; target = a credential for the database being replaced).';
  }
  if (options.promotionSide === 'source') {
    if (options.expectDatabase && !options.expectDatabase.endsWith('_test')) {
      return `promotion source must be a *_test database, got --expect-database '${options.expectDatabase}'.`;
    }
    return undefined;
  }
  const target = promotionTargetDatabase(options.environment);
  if (options.expectDatabase && options.expectDatabase !== target) {
    return `promotion target for environment '${options.environment}' is exactly '${target}', `
      + `got --expect-database '${options.expectDatabase}'.`;
  }
  if (!options.dsnEnv) {
    return 'promotion target needs --dsn-env naming the credential under test.';
  }
  return undefined;
}

export function defaultsFor(options: PreflightOptions): PreflightOptions {
  if (['implementation', 'merge', 'read-only'].includes(options.mode)) return options;
  const prod = options.environment === 'prod';
  if (options.mode === 'promotion' && options.promotionSide === 'target') {
    return { ...options, expectDatabase: promotionTargetDatabase(options.environment) };
  }
  if (options.mode === 'rebuild' || options.mode === 'promotion') {
    return {
      ...options,
      dsnEnv: options.dsnEnv ?? 'AFLDB_TEST_DATABASE_URL',
      expectDatabase: options.expectDatabase ?? 'afldb_test',
    };
  }
  return {
    ...options,
    dsnEnv: options.dsnEnv ?? (prod ? 'AFLDB_PROD_DATABASE_URL' : 'AFLDB_OWNER_DATABASE_URL'),
    expectDatabase: options.expectDatabase ?? (prod ? 'afldb_prod' : 'afldb_dev'),
  };
}

export function branchPolicyProblems(mode: PreflightMode, branch: string): string[] {
  if (!branch) return ['Detached HEAD is not accepted for this workflow.'];
  const main = branch === 'main' || branch === 'master';
  if (mode === 'implementation' && main) {
    return ['Implementation work must use a feature worktree; main is merge-only.'];
  }
  if ((mode === 'merge' || mode === 'deploy') && !main) {
    return [`Mode '${mode}' must run on main, not '${branch}'.`];
  }
  return [];
}

export function databaseTargetProblems(
  mode: PreflightMode, expected: string | undefined, actual: string, expectedRole?: string, actualRole?: string,
  promotionSide?: PromotionSide,
): string[] {
  const problems: string[] = [];
  if (expected && actual !== expected) problems.push(`connected to '${actual}', expected '${expected}'`);
  if (mode === 'promotion' && promotionSide === 'target') {
    // A target is proven by exact identity alone; it is never a *_test database.
    if (!expected) problems.push('promotion target check needs an exact expected database');
    if (actual.endsWith('_test')) {
      problems.push(`promotion target must not be a *_test database, got '${actual}'`);
    }
  } else if ((mode === 'rebuild' || mode === 'promotion') && !actual.endsWith('_test')) {
    // Promotion without a stated side is judged as the stricter source.
    problems.push(`mode '${mode}' requires a *_test source database, got '${actual}'`);
  }
  if (mode === 'deploy' && actual.endsWith('_test')) {
    problems.push(`deploy preflight must not target a *_test database, got '${actual}'`);
  }
  if (expectedRole && actualRole !== expectedRole) {
    problems.push(`connected as role '${actualRole ?? '<unknown>'}', expected '${expectedRole}'`);
  }
  return problems;
}

export type PreflightStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
export type PreflightFinding = { status: PreflightStatus; label: string; details: string[] };

/**
 * A promotion target is replaced, not read, so its ledger is not evidence; the source's parity is
 * the gate. Skipping the read also lets a restricted afldb_import/afldb_backup credential prove its
 * identity without afldb_meta access it is not granted (AFLDB-ISSUE-243).
 */
export function requiresMigrationParity(mode: PreflightMode, promotionSide?: PromotionSide): boolean {
  return !(mode === 'promotion' && promotionSide === 'target');
}

export type DatabaseProbe = {
  identity(): Promise<{ database: string; role: string }>;
  appliedMigrations(): Promise<readonly AppliedMigration[]>;
};

export function migrationFindingStatus(finding: MigrationFinding, inspectionOnly = false): PreflightStatus {
  if (finding.severity === 'error' && !inspectionOnly) return 'FAIL';
  return finding.severity === 'warning' || inspectionOnly ? 'WARN' : 'INFO';
}

/** Identity first, then (where the side requires it) migration parity. Query errors propagate. */
export async function probeDatabase(
  probe: DatabaseProbe,
  context: {
    mode: PreflightMode;
    promotionSide?: PromotionSide;
    dsnEnv: string;
    expectedDatabase?: string;
    expectedRole?: string;
    localMigrations: readonly MigrationEntry[];
  },
  emit: (finding: PreflightFinding) => void,
): Promise<void> {
  const actual = await probe.identity();
  const problems = databaseTargetProblems(
    context.mode, context.expectedDatabase, actual.database, context.expectedRole, actual.role,
    context.promotionSide,
  );
  emit({
    status: problems.length ? 'FAIL' : 'PASS',
    label: `database reachable via ${context.dsnEnv}`,
    details: [`database: ${actual.database}`, `role: ${actual.role}`, ...problems],
  });

  if (!requiresMigrationParity(context.mode, context.promotionSide)) {
    emit({
      status: 'INFO',
      label: 'migration parity not read on a promotion target',
      details: ['Target checks prove identity, role and connectivity only; the source side proves parity.'],
    });
    return;
  }
  const applied = await probe.appliedMigrations();
  const parity = compareAppliedMigrations(context.localMigrations, applied);
  if (parity.length === 0) {
    emit({ status: 'PASS', label: `migration parity (${applied.length}/${context.localMigrations.length})`, details: [] });
    return;
  }
  for (const finding of parity) {
    emit({ status: migrationFindingStatus(finding), label: `migration ${finding.code}`, details: [finding.message] });
  }
}

/**
 * Untracked operational artefacts a promotion checkout may carry. Each entry is the exact regex
 * `deploy/sync-dev-remote.sh` (afldb_is_known_operational_artifact) uses, so the two cannot drift
 * unnoticed. Deliberately narrower than the deploy list: promotion accepts only the nightly
 * afltables settle manifests (AFLDB-ISSUE-243).
 */
export const PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS: readonly string[] = [
  '^docs/rebuild-manifests/afltables_fitzroy_core/settle-[A-Za-z0-9][A-Za-z0-9._-]*\\.json$',
];

export function isPromotionOperationalArtifact(path: string): boolean {
  return PROMOTION_OPERATIONAL_ARTIFACT_PATTERNS.some((pattern) => new RegExp(pattern).test(path));
}

export type WorktreeClassification = { tracked: string[]; known: string[]; unknown: string[] };

/** Classifies `git status --porcelain=v1 -z` output. Only an untracked (`??`) path can be known. */
export function classifyWorktreeStatus(porcelainZ: string): WorktreeClassification {
  const result: WorktreeClassification = { tracked: [], known: [], unknown: [] };
  const entries = porcelainZ.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    let path = entry.slice(3);
    if (status === '??') {
      (isPromotionOperationalArtifact(path) ? result.known : result.unknown).push(path);
      continue;
    }
    if (status.includes('R') || status.includes('C')) {
      i += 1;
      path = `${entries[i] || '<unknown source>'} -> ${path}`;
    }
    result.tracked.push(path);
  }
  return result;
}

/** Working-tree verdict. Only promotion tolerates the known operational artefacts, as WARN. */
export function worktreeFinding(mode: PreflightMode, porcelainZ: string): PreflightFinding {
  const { tracked, known, unknown } = classifyWorktreeStatus(porcelainZ);
  const total = tracked.length + known.length + unknown.length;
  if (total === 0) return { status: 'PASS', label: 'working tree is clean', details: [] };
  if (mode === 'read-only') {
    return {
      status: 'WARN', label: 'working tree state (inspection only)',
      details: [`${total} changed/untracked path(s); review and resolve them before the operation.`],
    };
  }
  if (mode !== 'promotion') {
    return {
      status: 'FAIL', label: 'working tree is clean',
      details: [`${total} changed/untracked path(s); review and resolve them before the operation.`],
    };
  }
  const details = [
    `tracked/staged changes: ${tracked.length}; known operational untracked: ${known.length}; `
      + `unknown untracked: ${unknown.length}`,
    ...tracked.map((path) => `blocker (tracked/staged): ${path}`),
    ...unknown.map((path) => `blocker (unknown untracked): ${path}`),
    ...known.map((path) => `known operational artefact (preserved, not a blocker): ${path}`),
  ];
  if (tracked.length || unknown.length) {
    return { status: 'FAIL', label: 'working tree has blocking changes for promotion', details };
  }
  return { status: 'WARN', label: 'working tree holds only known operational artefacts', details };
}

/** Fail early when Git Bash has already rewritten a Linux host path. */
export function linuxHostPathProblems(path: string): string[] {
  const problems: string[] = [];
  if (/^[a-z]:[\\/]/i.test(path) || /(?:^|[\\/])Program Files(?:[\\/]|$)/i.test(path)) {
    problems.push('looks like a Windows/MSYS-rewritten path');
  }
  if (!path.startsWith('/')) problems.push('must be an absolute Linux path beginning with /');
  if (/\\/.test(path)) problems.push('contains Windows path separators');
  if (/[\u0000-\u001f\u007f]/.test(path)) problems.push('contains control characters');
  return [...new Set(problems)];
}

export function msysEnvironmentProblem(
  mode: PreflightMode, env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (['implementation', 'merge', 'read-only'].includes(mode)
      || !env.MSYSTEM || env.MSYS_NO_PATHCONV === '1') return undefined;
  return `Git Bash/MSYS is active (${env.MSYSTEM}) without MSYS_NO_PATHCONV=1; `
    + "set MSYS_NO_PATHCONV=1 and MSYS2_ARG_CONV_EXCL='*' before passing Linux host paths.";
}

export function assertAbsoluteRepoRoot(path: string): void {
  if (!isAbsolute(path)) throw new Error(`repository root is not absolute: ${path}`);
}
