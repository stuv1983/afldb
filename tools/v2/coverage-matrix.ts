/**
 * AFLDB V2 Stage 3 — coverage matrix generator (plan D11, ADR 0011).
 *
 *   npx tsx tools/v2/coverage-matrix.ts --write   writes docs/v2/coverage-matrix.md
 *   npx tsx tools/v2/coverage-matrix.ts --check   exits 1 when that file differs from the registry
 *
 * Reads data/reference/seasons.json and the registry's evidence files with node:fs, relative to
 * the repository root (the current directory). No database, no network. Both modes first validate
 * the registry and prove every cited file exists and contains its anchor; --write refuses to
 * write a matrix whose evidence does not hold.
 *
 * Exit status: 0 ok; 1 --check found the file stale or the registry invalid; 2 usage error or
 * --write refused.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COVERAGE_REGISTRY,
  checkCoverageEvidence,
  renderCoverageMatrix,
  validateCoverageRegistry,
  type SeasonRegistry,
} from '@afldb/domain';

export const SEASONS_REGISTRY = 'data/reference/seasons.json';
export const MATRIX_DOC = 'docs/v2/coverage-matrix.md';

/** Read a repository file as UTF-8, or null when it does not exist or is not a file. */
export function readRepoFile(root: string, path: string): string | null {
  const full = join(root, path);
  try {
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  } catch {
    return null;
  }
}

export interface MatrixBuild {
  readonly text: string;
  readonly problems: readonly string[];
}

/** Validates the registry against the repository and renders the matrix. Pure of side effects. */
export function buildMatrix(root: string): MatrixBuild {
  const seasons = JSON.parse(readFileSync(join(root, SEASONS_REGISTRY), 'utf8')) as SeasonRegistry;
  const problems = [
    ...validateCoverageRegistry(COVERAGE_REGISTRY, seasons),
    ...checkCoverageEvidence(COVERAGE_REGISTRY, (path) => readRepoFile(root, path)),
  ];
  return { text: renderCoverageMatrix(COVERAGE_REGISTRY, seasons), problems };
}

const normaliseEol = (text: string): string => text.replace(/\r\n/g, '\n');

export function runCli(argv: readonly string[], root: string = process.cwd()): { code: number; lines: string[] } {
  const modes = argv.filter((arg) => arg === '--write' || arg === '--check');
  if (argv.length !== 1 || modes.length !== 1) {
    return { code: 2, lines: ['usage: npx tsx tools/v2/coverage-matrix.ts --write | --check'] };
  }
  const build = buildMatrix(root);
  const lines: string[] = [];
  for (const problem of build.problems) lines.push(`PROBLEM: ${problem}`);
  const target = join(root, MATRIX_DOC);

  if (modes[0] === '--write') {
    if (build.problems.length > 0) {
      lines.push(`REFUSED: ${build.problems.length} problem(s); ${MATRIX_DOC} was not written.`);
      return { code: 2, lines };
    }
    writeFileSync(target, build.text);
    lines.push(`written: ${MATRIX_DOC}`);
    return { code: 0, lines };
  }

  if (!existsSync(target)) {
    lines.push(`STALE: ${MATRIX_DOC} does not exist; run --write.`);
    return { code: 1, lines };
  }
  const stale = normaliseEol(readFileSync(target, 'utf8')) !== build.text;
  if (stale) lines.push(`STALE: ${MATRIX_DOC} differs from the registry; run --write.`);
  if (build.problems.length > 0) lines.push(`INVALID: ${build.problems.length} problem(s).`);
  if (!stale && build.problems.length === 0) lines.push(`ok: ${MATRIX_DOC} matches the registry and every evidence anchor holds.`);
  return { code: stale || build.problems.length > 0 ? 1 : 0, lines };
}

if (process.argv[1] && /coverage-matrix\.ts$/.test(process.argv[1])) {
  const { code, lines } = runCli(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exit(code);
}
