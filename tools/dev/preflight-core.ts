import { isAbsolute } from 'node:path';

export type PreflightMode =
  | 'implementation'
  | 'merge'
  | 'read-only'
  | 'rebuild'
  | 'promotion'
  | 'deploy';
export type PreflightEnvironment = 'dev' | 'prod';

export type PreflightOptions = {
  mode: PreflightMode;
  environment: PreflightEnvironment;
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
  return options;
}

export function defaultsFor(options: PreflightOptions): PreflightOptions {
  if (['implementation', 'merge', 'read-only'].includes(options.mode)) return options;
  const prod = options.environment === 'prod';
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
): string[] {
  const problems: string[] = [];
  if (expected && actual !== expected) problems.push(`connected to '${actual}', expected '${expected}'`);
  if ((mode === 'rebuild' || mode === 'promotion') && !actual.endsWith('_test')) {
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
