// Extra GAP-029 FINAL assertions on a Gridley corpus diagnostic report (the reviewed corpus-summary.mjs asserts conformance PASS, zero unapproved differences,
// zero incorrect known answers and strict parity retained at 118; this adds the accepted 78 + 40 split, current adjudications and the production-scope counts).
// Usage: node final-corpus-checks.mjs <report.json>
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ro = r.releaseOutcomes ?? {};
const adj = r.knownAnswerAdjudications ?? [];
const gaps = r.scope?.gaps ?? {};
const checks = {
  strictParityFindings118: ro.strictCorpusParity?.passed === false && ro.strictCorpusParity?.findings === 118,
  approvedDeferrals78: ro.approvedDeferrals?.findings === 78 && ro.approvedDeferrals?.dataMatches === 0,
  approvedDisagreements40: ro.approvedDisagreements?.findings === 40 && ro.approvedDisagreements?.dataMatches === 0,
  approvedTotal118: ro.approvedTotal?.findings === 118 && ro.approvedTotal?.dataMatches === 0,
  findingsByCategoryAgree: (r.findingsByCategory?.unsupported ?? -1) === 78 && (r.findingsByCategory?.['criterion disagreement'] ?? -1) === 40,
  everyAdjudicationCurrent: adj.length > 0 && adj.every((a) => /: current$/.test(a)),
  noStaleAdjudication: !adj.some((a) => /stale/i.test(a)),
  everyGapFlagOpen: Object.keys(gaps).length > 0 && Object.values(gaps).every((v) => v === true || typeof v === 'number'),
  draftLinksGateOpen: gaps.draftLinks === true,
  productionScopeCounts: r.scope?.draftPicks === 6818 && r.scope?.captaincies === 1781 && r.scope?.matchesWithEvent === 64,
};
console.log(JSON.stringify({ scope: r.scope, cells: r.cells, solvedCells: r.solvedCells, knownAnswerAdjudications: adj, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
