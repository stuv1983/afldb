/** Create one fresh issue worktree from fetched, clean, exact main. */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Options = {
  issue: string;
  branch: string;
  target?: string;
  handoffs: string[];
  help: boolean;
};

type Handoff = { relativePath: string; sourcePath: string; tracked: boolean };

function usage(): void {
  console.log(`Usage: npm run worktree:bootstrap -- --issue NNN --branch NAME [options]

  --issue NNN                 required issue number
  --branch NAME               required new branch name (for example codex/issue-NNN)
  --path PATH                 optional sibling worktree path; default ../afldb-issue-NNN
  --copy-handoff PATH         repeatable approved AFLDB-ISSUE-NNN.md path only

The command fetches origin/main, requires clean exact local main, and creates a new branch and
worktree at that exact SHA. It never reuses or deletes a branch/worktree and never copies other
untracked files.`);
}

function need(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}

function parseArgs(argv: readonly string[]): Options {
  let issue = '';
  let branch = '';
  let target: string | undefined;
  const handoffs: string[] = [];
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--issue': issue = need(argv, i, argv[i]); i += 1; break;
      case '--branch': branch = need(argv, i, argv[i]); i += 1; break;
      case '--path': target = need(argv, i, argv[i]); i += 1; break;
      case '--copy-handoff': handoffs.push(need(argv, i, argv[i])); i += 1; break;
      case '--help': case '-h': help = true; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (help) return { issue, branch, target, handoffs, help };
  const match = /^(?:AFLDB-ISSUE-)?(\d{3})$/i.exec(issue);
  if (!match) throw new Error('--issue must be NNN or AFLDB-ISSUE-NNN.');
  if (!branch) throw new Error('--branch is required; choose the Claude/Codex branch name explicitly.');
  return { issue: match[1], branch, target, handoffs, help };
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
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function worktreePaths(root: string): string[] {
  return gitText(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

function approvedHandoffs(root: string, issue: string, paths: readonly string[]): Handoff[] {
  const allowed = new RegExp(`^(?:issues/open/)?AFLDB-ISSUE-${issue}(?:-[A-Za-z0-9._-]+)?\\.md$`, 'i');
  const result: Handoff[] = [];
  for (const raw of paths) {
    const relativePath = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!allowed.test(relativePath)) {
      throw new Error(`handoff '${raw}' is not an approved AFLDB-ISSUE-${issue} Markdown path`);
    }
    const sourcePath = resolve(root, ...relativePath.split('/'));
    if (!inside(root, sourcePath) || !existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      throw new Error(`handoff '${raw}' must be a regular file inside main`);
    }
    const tracked = runGit(root, ['ls-files', '--error-unmatch', '--', relativePath]).status === 0;
    result.push({ relativePath, sourcePath, tracked });
  }
  return result;
}

export function runBootstrap(argv: readonly string[], cwd = process.cwd()): number {
  try {
    const options = parseArgs(argv);
    if (options.help) { usage(); return 0; }

    const root = realpathSync(gitText(cwd, ['rev-parse', '--show-toplevel']));
    if (!samePath(root, realpathSync(cwd))) {
      throw new Error(`run from the main checkout root: ${root}`);
    }
    if (gitText(root, ['branch', '--show-current']) !== 'main') {
      throw new Error('bootstrap must run from main; implementation worktrees may not create peers');
    }
    const gitDir = resolve(root, gitText(root, ['rev-parse', '--git-dir']));
    const commonDir = resolve(root, gitText(root, ['rev-parse', '--git-common-dir']));
    if (!samePath(gitDir, commonDir)) throw new Error('bootstrap must run from the primary main checkout');
    if (runGit(root, ['check-ref-format', '--branch', options.branch]).status !== 0) {
      throw new Error(`invalid branch name '${options.branch}'`);
    }

    const handoffs = approvedHandoffs(root, options.issue, options.handoffs);
    const allowedUntracked = new Set(handoffs.filter((item) => !item.tracked).map((item) => `?? ${item.relativePath}`));
    const statusLines = gitText(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'])
      .split(/\r?\n/).filter(Boolean);
    const blockers = statusLines.filter((line) => !allowedUntracked.has(line));
    if (blockers.length) {
      throw new Error(`main is not clean; blocking path(s):\n${blockers.map((line) => `  ${line}`).join('\n')}`);
    }

    const target = options.target
      ? resolve(dirname(root), options.target)
      : join(dirname(root), `afldb-issue-${options.issue}`);
    if (!samePath(dirname(target), dirname(root))) {
      throw new Error(`worktree path must be a sibling of main: ${target}`);
    }
    if (existsSync(target)) throw new Error(`target directory already exists; refusing reuse: ${target}`);
    if (worktreePaths(root).some((path) => samePath(path, target))) {
      throw new Error(`target path is already registered as a worktree; review it manually: ${target}`);
    }

    console.log('Fetching origin/main before choosing the base SHA...');
    const fetched = runGit(root, ['fetch', '--prune', 'origin', 'main']);
    if (fetched.status !== 0) throw new Error(fetched.stderr.trim() || 'git fetch origin main failed');
    const mainSha = gitText(root, ['rev-parse', 'refs/heads/main^{commit}']);
    const originSha = gitText(root, ['rev-parse', 'refs/remotes/origin/main^{commit}']);
    if (mainSha !== originSha) {
      throw new Error(`local main is not exact fetched origin/main (main=${mainSha}, origin/main=${originSha})`);
    }

    const existingBranch = runGit(root, ['show-ref', '--verify', '--hash', `refs/heads/${options.branch}`]);
    if (existingBranch.status === 0) {
      throw new Error(`branch already exists at ${existingBranch.stdout.trim()}; refusing stale/silent reuse`);
    }

    const added = runGit(root, ['worktree', 'add', '-b', options.branch, target, mainSha]);
    if (added.status !== 0) {
      throw new Error(`${added.stderr.trim() || 'git worktree add failed'}\nNo automatic cleanup was attempted.`);
    }

    for (const handoff of handoffs) {
      if (handoff.tracked) {
        console.log(`Handoff already present at base SHA: ${handoff.relativePath}`);
        continue;
      }
      const destination = join(target, ...handoff.relativePath.split('/'));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(handoff.sourcePath, destination);
      console.log(`Copied approved handoff only: ${handoff.relativePath}`);
    }

    const status = gitText(target, ['status', '--short', '--branch']);
    console.log('\nWorktree bootstrap: CREATED');
    console.log(`Branch:    ${options.branch}`);
    console.log(`Base SHA:  ${mainSha}`);
    console.log(`Worktree:  ${target}`);
    console.log(`Status:\n${status}`);
    return 0;
  } catch (error) {
    console.error(`Worktree bootstrap: BLOCKED\n${error instanceof Error ? error.message : error}`
      + '\nNo automatic deletion or cleanup was attempted.');
    return 1;
  }
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = runBootstrap(process.argv.slice(2));
}
