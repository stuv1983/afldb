/**
 * AFLDB-ISSUE-363 TST-6 — the one interpreter resolver for Python-backed Vitest suites.
 *
 * The documented override is `AFLDB_PYTHON` (docs/v2/isolated-rebuild.md; the rebuild harness's
 * `resolvePython`, `tests/club-list-sources.test.ts`, `tests/draftguru-import.test.ts` and others
 * already honour it). Six suites read only `PYTHON`, so on a host whose `python3` lacks psycopg
 * (the DEV host) they failed 78 cases for an environment reason that `AFLDB_PYTHON` could not fix.
 *
 * Order: `AFLDB_PYTHON`, then the legacy `PYTHON` (kept so nobody who set only that regresses),
 * then the in-tree `.venv`, then the platform's system interpreter. Environment and file
 * existence are parameters so the order is testable without touching the real environment.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveTestPython(
  root: string = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: string = process.platform,
): string {
  for (const name of ['AFLDB_PYTHON', 'PYTHON']) {
    const value = (env[name] ?? '').trim();
    if (value !== '') return value;
  }
  const venv = platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python');
  if (exists(venv)) return venv;
  return platform === 'win32' ? 'python' : 'python3';
}
