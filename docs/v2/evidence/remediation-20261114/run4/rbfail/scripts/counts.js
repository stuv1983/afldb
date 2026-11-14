// run 4 baseline: counts and file order from a vitest JSON report. usage: node counts.js <json> <checkout root>
// Prints: files by status, tests by assertion status, vitest's own numbers, wall duration, and the files in the order vitest
// reported them (the JSON reporter lists files in completion order; for serial runs this is the execution order).
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = process.argv[3].replace(/\/$/, '') + '/';
const rel = (n) => (n.startsWith(root) ? n.slice(root.length) : n);
const tally = (arr, key) => arr.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {});
const files = j.testResults;
const asserts = files.flatMap((f) => f.assertionResults || []);
const ends = files.map((f) => f.endTime).filter(Boolean);
const wall = ends.length ? Math.max(...ends) - j.startTime : null;
console.log('files total=' + files.length + ' by status=' + JSON.stringify(tally(files, (f) => f.status)));
console.log('file-level failures (status failed with zero failed assertions)=' + files.filter((f) => f.status === 'failed' && !(f.assertionResults || []).some((a) => a.status === 'failed')).length);
console.log('tests total=' + j.numTotalTests + ' passed=' + j.numPassedTests + ' failed=' + j.numFailedTests + ' pending=' + j.numPendingTests + ' todo=' + (j.numTodoTests || 0));
console.log('assertion statuses=' + JSON.stringify(tally(asserts, (a) => a.status)));
console.log('wall ms=' + wall + ' (' + (wall / 60000).toFixed(1) + ' min)');
console.log('# order (JSON completion order): n<TAB>file<TAB>status<TAB>file duration ms<TAB>assertions');
files.forEach((f, i) => console.log((i + 1) + '\t' + rel(f.name) + '\t' + f.status + '\t' + Math.round((f.endTime || 0) - (f.startTime || 0)) + '\t' + (f.assertionResults || []).length));
