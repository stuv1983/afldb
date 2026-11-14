// Summarise a vitest JSON report: per file (ordered by startTime) status + counts + failing names. Usage: node summ.mjs <json>...
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`== ${f}: files ${j.numTotalTestSuites !== undefined ? '' : ''}tests total=${j.numTotalTests} passed=${j.numPassedTests} failed=${j.numFailedTests} pending=${j.numPendingTests} todo=${j.numTodoTests}; suites failed=${j.numFailedTestSuites}; startTime=${j.startTime}`);
  const files = [...j.testResults].sort((a, b) => a.startTime - b.startTime);
  for (const t of files) {
    const name = t.name.replace(/^.*\/tests\//, 'tests/');
    const c = { passed: 0, failed: 0, pending: 0 };
    for (const a of t.assertionResults) c[a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'pending']++;
    console.log(`  ${new Date(t.startTime).toISOString().slice(11, 23)} ${t.status.padEnd(7)} ${name} p=${c.passed} f=${c.failed} s=${c.pending}${t.message ? ` FILE-ERR: ${t.message.split('\n')[0].slice(0, 200)}` : ''}`);
    for (const a of t.assertionResults) if (a.status === 'failed') console.log(`      x ${a.fullName.slice(0, 150)} :: ${(a.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 160)}`);
  }
}
