// Reads a Gridley corpus diagnostic report and prints the acceptance facts as JSON; exits 1 unless every GAP-029 corpus requirement holds:
//   approvedPolicyConformance.passed, zero unapproved differences, zero `incorrect known answer` findings, strict parity retained at its
//   accepted state (NOT passed, exactly 118 findings: it is deliberately not weakened).
// Usage: node corpus-summary.mjs <report.json>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const bytes = readFileSync(file);
const r = JSON.parse(bytes.toString('utf8'));
const ro = r.releaseOutcomes ?? {};
const incorrect = r.findingsByCategory?.['incorrect known answer'] ?? 0;
const out = {
  reportSha256: createHash('sha256').update(bytes).digest('hex'),
  cells: r.cells, solvedCells: r.solvedCells,
  strictCorpusParity: ro.strictCorpusParity,
  approvedTotal: ro.approvedTotal,
  approvedPolicyConformance: ro.approvedPolicyConformance,
  incorrectKnownAnswer: incorrect,
  knownAnswerAdjudications: r.knownAnswerAdjudications,
  findingsByCategory: r.findingsByCategory,
};
const checks = {
  conformancePassed: ro.approvedPolicyConformance?.passed === true,
  zeroUnapprovedDifferences: Array.isArray(ro.approvedPolicyConformance?.unapprovedDifferences) && ro.approvedPolicyConformance.unapprovedDifferences.length === 0,
  zeroIncorrectKnownAnswers: incorrect === 0,
  strictParityRetainedAt118: ro.strictCorpusParity?.passed === false && ro.strictCorpusParity?.findings === 118,
};
console.log(JSON.stringify({ ...out, checks }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
