/** Compact assertion-level evidence; never turns a failure/skip into a pass. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [fullPath, colemanPath, output] = process.argv.slice(2);
if (!fullPath || !colemanPath || !output) throw new Error('full report, isolated Coleman report and new output path required');
const reports = [fullPath, colemanPath].map((path) => ({ path, report: JSON.parse(readFileSync(path, 'utf8')) }));
const failures = [];
const skipped = [];
const files = [];
for (const { path, report } of reports) {
  for (const result of report.testResults) {
    const file = result.name.replaceAll('\\', '/').split('/tests/').at(-1);
    files.push({ file, status: result.status,
      passed: result.assertionResults.filter((r) => r.status === 'passed').length,
      failed: result.assertionResults.filter((r) => r.status === 'failed').length,
      skipped: result.assertionResults.filter((r) => r.status === 'skipped' || r.status === 'pending').length });
    if (result.status === 'failed' && !result.assertionResults.some((r) => r.status === 'failed')) {
      failures.push({ report: path, file, name: '(suite setup/teardown)', message: result.message });
    }
    for (const test of result.assertionResults) {
      if (test.status === 'failed') failures.push({ report: path, file, name: test.fullName, messages: test.failureMessages });
      if (test.status === 'skipped' || test.status === 'pending') skipped.push({ file, name: test.fullName });
    }
  }
}
const originalGapFiles = ['admin-draft', 'admin-season-lists', 'awards-reload-links', 'match-admin-delete'];
const gap028 = originalGapFiles.map((name) => {
  const file = files.find((r) => r.file === `integration/${name}.test.ts`);
  if (!file) throw new Error(`Required original gap suite is absent: ${name}`);
  return file;
});
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
const untracked = git('ls-files','--others','--exclude-standard').split('\n').filter(Boolean);
const preservedUntracked = untracked.filter((file) => file.startsWith('.codex/'));
const changedFiles = [...new Set([...git('diff','--name-only','36679a1e').split('\n'),
  ...untracked.filter((file) => !preservedUntracked.includes(file)), output])].filter(Boolean).sort();
const classification = (file) => {
  if (file.endsWith('release-gates.test.ts')) return 'Exact stable-identity membership mismatch; approved reference cohort required; no repin';
  if (file.endsWith('gridley-corpus.test.ts')) return 'Strict dataset/answer-key evidence gap; diagnostic waiver not used';
  if (/club-comparison-route|home-records|nl-answers-cross-domain/.test(file)) return 'Snapshot/count disagreement against local through-2025 history; approved source baseline required; assertion retained';
  return 'Unclassified failure: must review, never baseline-waived';
};
const summary = { baseline: '36679a1e', changedFiles, preservedUntracked,
  reports: reports.map(({ path, report }) => ({ path, passed: report.numPassedTests,
  failed: report.numFailedTests, skipped: report.numPendingTests, total: report.numTotalTests })),
  green: failures.length === 0 && skipped.length === 0, gap028,
  failures: failures.map((failure) => ({ ...failure, classification: classification(failure.file) })), skipped, files };
writeFileSync(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reports: summary.reports, failedAssertionsOrSuites: failures.length,
  skipped: skipped.length, gap028: gap028.map((r) => `${r.file}: ${r.status}`), green: summary.green }));
