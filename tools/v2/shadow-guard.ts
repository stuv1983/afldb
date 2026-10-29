/**
 * AFLDB V2 Stage 6 — the shadow TARGET GUARD (docs/v2/shadow-rehearsal.md).
 *
 *   npx tsx tools/v2/shadow-guard.ts check --require <VARIABLE> [--require <VARIABLE> ...] [--root <dir>]
 *
 * The operator runs this before EVERY state-changing shadow step. It exits 0 only when:
 *   - every --require variable is set and names an `afldb_v2_shadow[_<tag>]_test` database;
 *   - no OTHER `*DATABASE_URL*` variable in the environment names anything else (an unrelated DSN
 *     left in the shell could be picked up by any tool);
 *   - PGSERVICE / PGSERVICEFILE are unset and PGDATABASE (if set) names a shadow copy;
 *   - <root> (default: the current directory) holds no `.env*` file other than `.env.example`
 *     (repository tools fill unset DSN variables from `.env`; see tools/current-season/load-env.ts
 *     and loadEnv in tools/db/migrate.ts; a shadow checkout must have none).
 *
 * It prints, per checked variable, `NAME -> <database name>`. It never prints a DSN. It makes no
 * connection of any kind. Exit status: 0 `SHADOW TARGET OK`; 2 refused (every finding listed) or
 * bad usage.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { scanShadowEnvironment } from '@afldb/domain';

export const SHADOW_GUARD_USAGE =
  'usage: shadow-guard.ts check --require <VARIABLE> [--require <VARIABLE> ...] [--root <dir>]';

export interface GuardDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: () => string;
  /** Names of the entries directly inside a directory. */
  readonly listDirectory: (directory: string) => readonly string[];
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

export function defaultGuardDeps(): GuardDeps {
  return {
    env: process.env,
    cwd: () => process.cwd(),
    listDirectory: (directory) => readdirSync(directory),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}

/** `.env`, `.env.local`, `.env.production`, ... but not the committed `.env.example`. */
export const isForbiddenEnvFile = (name: string): boolean => name.startsWith('.env') && name !== '.env.example';

interface GuardArgs {
  readonly required: readonly string[];
  readonly root: string | null;
}

function parseGuardArgs(argv: readonly string[]): GuardArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'check') throw new Error(SHADOW_GUARD_USAGE);
  const required: string[] = [];
  let root: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg !== '--require' && arg !== '--root') {
      throw new Error(arg.startsWith('--') ? `unknown option ${arg}` : `unexpected argument ${arg}`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    i += 1;
    if (arg === '--require') {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error('--require must name an environment variable (A-Z, 0-9, _)');
      required.push(value);
    } else {
      if (root !== null) throw new Error('--root given twice');
      root = value;
    }
  }
  if (required.length === 0) throw new Error('at least one --require <VARIABLE> is needed; the guard checks named targets only');
  return { required, root };
}

/** Testable entry. Returns the process exit code; never throws. */
export function runGuard(argv: readonly string[], deps: GuardDeps = defaultGuardDeps()): number {
  let args: GuardArgs;
  try {
    args = parseGuardArgs(argv);
  } catch (error) {
    deps.error(`REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof Error && error.message === SHADOW_GUARD_USAGE)) deps.error(SHADOW_GUARD_USAGE);
    return 2;
  }

  const scan = scanShadowEnvironment(deps.env, args.required);
  const findings = scan.findings.map((f) => `${f.variable}${f.database !== null ? ` (database '${f.database}')` : ''}: ${f.problem}`);

  const root = resolve(args.root ?? deps.cwd());
  try {
    const present = deps.listDirectory(root).filter(isForbiddenEnvFile).sort();
    for (const name of present) {
      findings.push(`${name} exists in ${root}: repository tools fill unset DSN variables from .env files, so a shadow checkout must have none (only .env.example is allowed)`);
    }
  } catch {
    findings.push(`cannot list ${root}: the .env check could not run`);
  }

  deps.log('AFLDB V2 shadow target guard — environment and directory check; no connection is made');
  for (const checked of scan.checked) {
    deps.log(`  ${checked.variable} -> ${checked.database ?? '(no readable database name)'}`);
  }
  if (findings.length === 0) {
    deps.log('SHADOW TARGET OK');
    return 0;
  }
  for (const finding of findings) deps.error(`  REFUSED: ${finding}`);
  deps.error('SHADOW TARGET REFUSED: do not run the shadow step.');
  return 2;
}

if (process.argv[1] && /shadow-guard\.ts$/.test(process.argv[1])) {
  process.exit(runGuard(process.argv.slice(2)));
}
