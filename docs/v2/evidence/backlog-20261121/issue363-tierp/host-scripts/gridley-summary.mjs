// ISSUE-363 G-1: aggregate a gridley-corpus run report (AFLDB_GRIDLEY_REPORT) into counts. Usage: node gridley-summary.mjs <report.json>...
// Prints, per report: gaps probe, failing findings (non-informational) by category, the deferral-policy unapproved differences by
// category, and how many failing cells read a match-event / draft criterion. Counts and criterion ids only (no player data).
import { readFileSync } from 'node:fs';

const INFORMATIONAL = new Set(['time of board', 'list membership', 'external source disagreement', 'adjudicated source conflict',
  'adjudicated key disagreement']);
const MATCH_EVENT = /^(anzac|dreamtime|bigfreeze|kingsbirthday|kings-birthday)/;
const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
for (const p of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(p, 'utf8'));
  const failing = r.findings.filter((f) => !INFORMATIONAL.has(f.category));
  const unapproved = r.releaseOutcomes?.approvedPolicyConformance?.unapprovedDifferences ?? [];
  const reads = (f, re) => re.test(f.row) || re.test(f.col);
  console.log(JSON.stringify({
    report: p,
    gaps: r.scope?.gaps ?? null,
    solved: `${r.solvedCells}/${r.cells}`,
    findingsByCategory: r.findingsByCategory,
    failing: failing.length,
    failingByCategory: tally(failing, (f) => f.category),
    failingReadingMatchEvent: failing.filter((f) => reads(f, MATCH_EVENT)).length,
    unapproved: unapproved.length,
    unapprovedByCategory: tally(unapproved, (f) => f.category),
    unapprovedReadingMatchEvent: unapproved.filter((f) => reads(f, MATCH_EVENT)).length,
    datasetGapCriteria: [...new Set(failing.filter((f) => f.category === 'dataset gap').flatMap((f) => String(f.detail).split(', ')))].sort(),
    criterionDisagreementCriteria: tally(failing.filter((f) => f.category === 'criterion disagreement'), (f) => `${f.row} x ${f.col}`),
    slowOver4s: (r.slowCells ?? []).filter((s) => s.ms > 4000).length,
  }));
}
