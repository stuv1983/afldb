/**
 * Builds the sweep's report from the observation files the workers
 * wrote, without re-running the sweep.
 *
 * Standalone rather than only an `afterAll` hook because the hook is
 * best-effort by construction: Playwright runs it once per worker, and
 * only whichever worker happens to finish last sees a complete set of
 * files. A run that ends with two workers finishing together can leave
 * no summary at all, and re-driving 12,000 browser navigations to
 * recover a report that is already sitting on disk would be absurd.
 *
 *   npx tsx tools/nl/ui-summary.ts [corpus.csv]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  groupByCore, hydrationByWorker, metamorphicViolations, readUiCorpus, scoreObservation, summarise,
  type UiObservation,
} from './ui-corpus';

const OUT_DIR = resolve('nl-ui-out');

export function readObservations(dir = OUT_DIR): Map<string, UiObservation> {
  const observations = new Map<string, UiObservation>();
  for (const entry of readdirSync(dir)) {
    if (!/^observations.*\.jsonl$/.test(entry)) continue;
    for (const line of readFileSync(resolve(dir, entry), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const observation = JSON.parse(line) as UiObservation;
      // Last write wins. Only reachable with NL_UI_APPEND, where a
      // re-run of some batches is the point.
      observations.set(observation.id, observation);
    }
  }
  return observations;
}

export function buildReport(corpusPath: string, dir = OUT_DIR) {
  const cases = readUiCorpus(corpusPath);
  const observations = readObservations(dir);
  const violations = metamorphicViolations(groupByCore(cases), observations);
  const summary = summarise(cases, observations, violations);

  const failures = cases
    .filter((c) => {
      const observation = observations.get(c.id);
      return observation && scoreObservation(c.expectedStatus, observation.outcome) === 'fail';
    })
    .map((c) => {
      const observation = observations.get(c.id)!;
      return {
        id: c.id,
        category: c.category,
        question: c.question,
        expected: c.expectedStatus,
        outcome: observation.outcome,
        httpStatus: observation.httpStatus,
        errors: observation.errors,
      };
    });

  // Listed as well as counted: a client-side error that turns out to
  // cluster on one question shape is a different defect from one
  // scattered at random, and only the list distinguishes them.
  const clientErrors = [...observations.values()]
    .filter((o) => o.errors.length > 0)
    .map((o) => ({ id: o.id, question: o.question, outcome: o.outcome, errors: o.errors }));

  return {
    summary, failures, violations, clientErrors,
    hydration: hydrationByWorker(observations.values()),
    observed: observations.size,
    total: cases.length,
  };
}

export function formatSummary(report: ReturnType<typeof buildReport>): string {
  const { summary, hydration } = report;
  const lines = [
    '',
    `NL UI sweep — ${report.observed} of ${report.total} questions observed`,
    `  pass ${summary.pass}   fail ${summary.fail}   unscored ${summary.unscored}`,
    `  outcomes: ${Object.entries(summary.byOutcome).map(([k, v]) => `${k} ${v}`).join('  ')}`,
    `  filler-variant disagreements: ${summary.metamorphic}`,
    `  loads with a client-side error (reported, not failed): ${summary.clientErrors}`,
    summary.failuresByCategory.length > 0
      ? `  failures by category: ${summary.failuresByCategory.map(([c, n]) => `${c} ${n}`).join(', ')}`
      : '  no scored failures',
  ];

  // Only when the deployment was traced; otherwise this is all zeroes and
  // says nothing (see deploy/server-cluster.mjs, AFLDB_TRACE_REQUESTS).
  const workers = Object.entries(hydration.byWorker).sort(([a], [b]) => a.localeCompare(b));
  if (workers.length > 0) {
    lines.push('', `  hydration errors: ${hydration.totalHydrationErrors}`);
    for (const [worker, stats] of workers) {
      lines.push(`    worker ${worker}: ${stats.hydrationErrors} of ${stats.loads} loads (${stats.ratePercent}%)`);
    }
    const { sameWorker, differentWorker } = hydration.crossWorker;
    if (sameWorker.loads > 0 || differentWorker.loads > 0) {
      lines.push(
        '  by worker agreement (document vs its subrequests):',
        `    same worker:      ${sameWorker.hydrationErrors} of ${sameWorker.loads} (${sameWorker.ratePercent}%)`,
        `    different worker: ${differentWorker.hydrationErrors} of ${differentWorker.loads} (${differentWorker.ratePercent}%)`,
      );
    }
    if (hydration.untraced > 0) lines.push(`    (${hydration.untraced} loads carried no trace headers)`);
  }

  lines.push('');
  return lines.join('\n');
}

// tsx runs this file directly; the spec imports the functions instead.
if (process.argv[1]?.endsWith('ui-summary.ts')) {
  const corpusPath = process.argv[2]
    ?? process.env.NL_UI_CORPUS
    ?? 'C:/temp/stressTest/afldb_ui_nl_12000.csv';
  const report = buildReport(resolve(corpusPath));
  writeFileSync(resolve(OUT_DIR, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(formatSummary(report));
  console.log(`  full report: ${resolve(OUT_DIR, 'summary.json')}\n`);
}
