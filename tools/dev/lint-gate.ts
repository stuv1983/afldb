/**
 * Ratcheting lint gate (AFLDB-ISSUE-364).
 *
 * THIS IS A RATCHET, NOT CLEAN LINT. `eslint .` reports hundreds of errors; the committed baseline
 * `tools/dev/lint-baseline.json` records the existing debt (338 errors in 43 files when the gate was
 * wired) and the gate only stops it growing. It runs ESLint, counts ERROR-severity messages per
 * file and rule, and compares them with the baseline:
 *
 *   - a (file, rule) pair above its baseline count, or absent from the baseline (a new file, or a
 *     new rule in an old file), FAILS;
 *   - a pair below its baseline PASSES and is reported so the baseline can be tightened
 *     (`--update`). Tightening is not forced: the slack can be re-spent silently until someone
 *     tightens it, which is the known weakness of any ratchet that is not rewritten on every fix;
 *   - nothing is silenced: the debt stays visible in the baseline and shrinks as it is paid;
 *   - a gate that cannot reach a verdict (ESLint missing, cannot be spawned, no JSON, baseline
 *     missing or malformed) REFUSES with exit 2 and a named reason. It never passes by default.
 *
 * Warnings are not gated. Run `npm run lint:gate`; `-- --update` rewrites the baseline and must
 * only ever be committed with a reviewed reduction (a rise needs the debt named in the issue).
 * `tools/dev/preflight.ts` (implementation and merge modes) and `merge:ready` run this same
 * evaluation, so a regression blocks the operator workflow as well as the standalone command.
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

export function baselineTotals(baseline: LintBaseline): { errors: number; files: number } {
  return {
    errors: Object.values(baseline).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0),
    files: Object.keys(baseline).length,
  };
}

/** Throws a plain Error naming the first thing wrong; a baseline that cannot be trusted refuses the gate. */
export function parseBaseline(text: string): LintBaseline {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('top level must be an object of file -> rule -> count');
  }
  for (const [path, rules] of Object.entries(value)) {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
      throw new Error(`"${path}" must be an object of rule -> count`);
    }
    for (const [rule, count] of Object.entries(rules)) {
      if (!Number.isInteger(count) || (count as number) < 0) {
        throw new Error(`"${path}" / "${rule}" must be a non-negative integer count`);
      }
    }
  }
  return value as LintBaseline;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');
/** The baseline of THIS checkout; a checkout under test is read from `<root>/tools/dev/lint-baseline.json`. */
export const BASELINE_PATH = resolve(HERE, 'lint-baseline.json');
const baselinePathFor = (root: string) => resolve(root, 'tools', 'dev', 'lint-baseline.json');

export type LintGateOutcome = {
  /** 0 passed, 1 regression (error count rose or a new file has errors), 2 refused (no verdict). */
  exitCode: 0 | 1 | 2;
  /** One line stating the verdict and, where known, the ratchet figures. */
  summary: string;
  /** Regression lines, or the named refusal reason. */
  problems: string[];
  /** Pairs below their baseline: allowed to pass, reported so the baseline can be tightened. */
  improvements: string[];
  current?: LintBaseline;
  baseline?: LintBaseline;
};

function refusal(reason: string, detail: string[] = []): LintGateOutcome {
  return { exitCode: 2, summary: `Lint gate: REFUSED - ${reason}`, problems: [reason, ...detail], improvements: [] };
}

type EslintRun =
  | { ok: true; results: LintFileResult[] }
  | { ok: false; outcome: LintGateOutcome };

function runEslint(root: string): EslintRun {
  const eslint = resolve(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(eslint)) {
    return { ok: false, outcome: refusal(`ESLint is not installed at ${eslint}; run npm ci in this checkout`) };
  }
  const run = spawnSync(process.execPath, [eslint, '.', '--format', 'json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true,
  });
  // B-07: a failed spawn (ENOENT, ENOBUFS, a signal) leaves stdout null; JSON.parse(null) is null, not a throw.
  if (run.error) {
    return { ok: false, outcome: refusal(`could not start ESLint (${run.error.message})`) };
  }
  if (run.status !== 0 && run.status !== 1) {
    return {
      ok: false,
      outcome: refusal(`ESLint ended abnormally (exit ${run.status ?? 'signal ' + run.signal})`,
        [(run.stderr ?? '').slice(0, 2000)].filter(Boolean)),
    };
  }
  let results: unknown;
  try {
    results = JSON.parse(run.stdout ?? '');
  } catch {
    return {
      ok: false,
      outcome: refusal(`ESLint produced no JSON (exit ${run.status})`, [(run.stderr ?? '').slice(0, 2000)].filter(Boolean)),
    };
  }
  if (!Array.isArray(results)) {
    return { ok: false, outcome: refusal('ESLint JSON output was not a list of file results') };
  }
  return { ok: true, results: results as LintFileResult[] };
}

/** Pure of console output: runs ESLint in `root` and judges it against `<root>/tools/dev/lint-baseline.json`. */
export function evaluateLintGate(root = DEFAULT_ROOT): LintGateOutcome {
  const baselinePath = baselinePathFor(root);
  if (!existsSync(baselinePath)) {
    return refusal(`tools/dev/lint-baseline.json is missing in ${root}; the ratchet has nothing to compare with`);
  }
  let baseline: LintBaseline;
  try {
    baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    return refusal(`tools/dev/lint-baseline.json is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const eslint = runEslint(root);
  if (!eslint.ok) return eslint.outcome;

  const current = summariseErrors(eslint.results, root);
  const now = baselineTotals(current);
  const allowed = baselineTotals(baseline);
  const { regressions, improvements } = compareToBaseline(current, baseline);
  const figures = `${now.errors} error(s) in ${now.files} file(s) now; the ratchet baseline allows `
    + `${allowed.errors} in ${allowed.files} (existing debt, not clean lint)`;
  return {
    exitCode: regressions.length ? 1 : 0,
    summary: regressions.length
      ? `Lint gate: FAILED - ${regressions.length} regression(s); ${figures}.`
      : `Lint gate: PASSED - ${figures}.`,
    problems: regressions,
    improvements,
    current,
    baseline,
  };
}

/**
 * Report lines for an operator workflow (preflight, merge:ready). Same shape as their findings; a
 * gate that throws is a FAIL with the message, never a skipped check.
 */
export type LintGateFinding = { status: 'PASS' | 'WARN' | 'FAIL'; label: string; details: string[] };

export function lintGateFindings(
  root: string,
  evaluate: (root: string) => LintGateOutcome = evaluateLintGate,
): LintGateFinding[] {
  let outcome: LintGateOutcome;
  try {
    outcome = evaluate(root);
  } catch (error) {
    return [{
      status: 'FAIL',
      label: 'lint ratchet gate could not run',
      details: [error instanceof Error ? error.message : String(error), 'Run npm run lint:gate for the full output.'],
    }];
  }
  const findings: LintGateFinding[] = [];
  if (outcome.exitCode === 0) {
    findings.push({ status: 'PASS', label: 'lint ratchet gate: no error count rose', details: [outcome.summary] });
  } else if (outcome.exitCode === 1) {
    findings.push({
      status: 'FAIL',
      label: 'lint ratchet gate: error count rose or a new file has errors',
      details: [outcome.summary, ...outcome.problems.map((line) => `REGRESSION: ${line}`),
        'Fix the new errors; never raise tools/dev/lint-baseline.json.'],
    });
  } else {
    findings.push({
      status: 'FAIL',
      label: 'lint ratchet gate refused (no verdict)',
      details: [outcome.summary, ...outcome.problems.slice(1), 'Fix the cause and rerun; npm run lint:gate shows the same refusal.'],
    });
  }
  if (outcome.improvements.length) {
    findings.push({
      status: 'WARN',
      label: `lint baseline has ${outcome.improvements.length} paid-down pair(s) not yet tightened`,
      details: [...outcome.improvements.slice(0, 10), 'Tighten with npm run lint:gate -- --update in a reviewed commit (never a rise).'],
    });
  }
  return findings;
}

export function runLintGate(argv: readonly string[], root = DEFAULT_ROOT): number {
  const update = argv.includes('--update');
  const unknown = argv.filter((arg) => arg !== '--update');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown.join(' ')}`);
    return 2;
  }

  if (update) {
    const eslint = runEslint(root);
    if (!eslint.ok) {
      console.error(eslint.outcome.summary);
      for (const line of eslint.outcome.problems.slice(1)) console.error(line);
      return 2;
    }
    const current = summariseErrors(eslint.results, root);
    const totals = baselineTotals(current);
    writeFileSync(baselinePathFor(root), serialiseBaseline(current));
    console.log(`Lint baseline written: ${totals.errors} error(s) in ${totals.files} file(s).`);
    return 0;
  }

  const outcome = evaluateLintGate(root);
  if (outcome.exitCode === 2) {
    console.error(outcome.summary);
    for (const line of outcome.problems.slice(1)) console.error(line);
    return 2;
  }
  console.log(outcome.summary.replace(/^Lint gate: (PASSED|FAILED) - /, 'Lint gate (ratchet): '));
  for (const line of outcome.improvements) console.log(`  paid down (tighten with --update): ${line}`);
  for (const line of outcome.problems) console.error(`  REGRESSION: ${line}`);
  console.log(outcome.exitCode ? `Lint gate: FAILED (${outcome.problems.length}).` : 'Lint gate: PASSED (ratchet; existing debt remains).');
  return outcome.exitCode;
}

if (process.argv[1]
    && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  process.exitCode = runLintGate(process.argv.slice(2));
}
