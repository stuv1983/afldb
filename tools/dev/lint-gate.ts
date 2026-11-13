/**
 * Ratcheting lint gate (AFLDB-ISSUE-364).
 *
 * `eslint .` was red (hundreds of errors) and in no gate, so a new error could not be told from
 * old debt. This runs ESLint, counts ERROR-severity messages per file and rule, and compares them
 * with the committed baseline `tools/dev/lint-baseline.json`:
 *
 *   - a (file, rule) pair above its baseline count, or absent from the baseline, FAILS;
 *   - a pair below its baseline is reported so the baseline can be tightened (`--update`);
 *   - nothing is silenced: the debt stays visible in the baseline and shrinks as it is paid.
 *
 * Warnings are not gated. Run `npm run lint:gate`; `-- --update` rewrites the baseline and must
 * only ever be committed with a reviewed reduction (a rise needs the debt named in the issue).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LintMessage = { ruleId: string | null; severity: number };
export type LintFileResult = { filePath: string; messages: LintMessage[] };
/** repository-relative POSIX path -> rule id -> error count */
export type LintBaseline = Record<string, Record<string, number>>;

const PARSE_ERROR = '(no rule: parse or config error)';

export function summariseErrors(results: readonly LintFileResult[], root: string): LintBaseline {
  const summary: LintBaseline = {};
  for (const file of results) {
    const path = relative(root, file.filePath).replace(/\\/g, '/');
    for (const message of file.messages) {
      if (message.severity !== 2) continue;
      const rule = message.ruleId ?? PARSE_ERROR;
      summary[path] ??= {};
      summary[path][rule] = (summary[path][rule] ?? 0) + 1;
    }
  }
  return summary;
}

export function compareToBaseline(
  current: LintBaseline,
  baseline: LintBaseline,
): { regressions: string[]; improvements: string[] } {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const path of Object.keys(current).sort()) {
    for (const [rule, count] of Object.entries(current[path]).sort()) {
      const allowed = baseline[path]?.[rule] ?? 0;
      if (count > allowed) regressions.push(`${path}: ${rule} ${allowed} -> ${count}`);
    }
  }
  for (const path of Object.keys(baseline).sort()) {
    for (const [rule, allowed] of Object.entries(baseline[path]).sort()) {
      const count = current[path]?.[rule] ?? 0;
      if (count < allowed) improvements.push(`${path}: ${rule} ${allowed} -> ${count}`);
    }
  }
  return { regressions, improvements };
}

/** Stable key order, so a baseline diff shows only real change. */
export function serialiseBaseline(baseline: LintBaseline): string {
  const sorted: LintBaseline = {};
  for (const path of Object.keys(baseline).sort()) {
    sorted[path] = {};
    for (const rule of Object.keys(baseline[path]).sort()) sorted[path][rule] = baseline[path][rule];
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = resolve(HERE, 'lint-baseline.json');

export function runLintGate(argv: readonly string[], root = resolve(HERE, '..', '..')): number {
  const update = argv.includes('--update');
  const unknown = argv.filter((arg) => arg !== '--update');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown.join(' ')}`);
    return 2;
  }

  const eslint = resolve(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const run = spawnSync(process.execPath, [eslint, '.', '--format', 'json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true,
  });
  let results: LintFileResult[];
  try {
    results = JSON.parse(run.stdout) as LintFileResult[];
  } catch {
    console.error(`Lint gate: ESLint produced no JSON (exit ${run.status}).\n${run.stderr.slice(0, 2000)}`);
    return 2;
  }
  const current = summariseErrors(results, root);
  const total = Object.values(current).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);

  if (update) {
    writeFileSync(BASELINE_PATH, serialiseBaseline(current));
    console.log(`Lint baseline written: ${total} error(s) in ${Object.keys(current).length} file(s).`);
    return 0;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error('Lint gate: tools/dev/lint-baseline.json is missing; run with --update.');
    return 2;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as LintBaseline;
  const { regressions, improvements } = compareToBaseline(current, baseline);
  console.log(`Lint gate: ${total} error(s) now; baseline allows `
    + `${Object.values(baseline).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0)}.`);
  for (const line of improvements) console.log(`  paid down (tighten with --update): ${line}`);
  for (const line of regressions) console.error(`  REGRESSION: ${line}`);
  console.log(regressions.length ? `Lint gate: FAILED (${regressions.length}).` : 'Lint gate: PASSED.');
  return regressions.length ? 1 : 0;
}

if (process.argv[1]
    && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  process.exitCode = runLintGate(process.argv.slice(2));
}
