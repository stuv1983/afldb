// run 4 baseline: vitest JSON -> TSV of failing ids: <file>\t<full test name | <file-level>>\t<first message line, 200 chars>
// Identical logic to run3/qualification-3/qual.sh `vfail` (VFAIL_JS), moved into a file. usage: node vfail.js <json> <checkout root>
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = process.argv[3].replace(/\/$/, '') + '/';
const one = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((x) => x.trim()).find((x) => x) || '';
const cut = (s) => one(s).replace(/\s+/g, ' ').slice(0, 200);
const rows = [];
for (const f of j.testResults) {
  const rel = f.name.startsWith(root) ? f.name.slice(root.length) : f.name;
  const failed = (f.assertionResults || []).filter((a) => a.status === 'failed');
  for (const a of failed) rows.push([rel, a.fullName, cut((a.failureMessages || [])[0])]);
  if (f.status === 'failed' && (failed.length === 0 || one(f.message))) rows.push([rel, '<file-level>', cut(f.message)]);
}
rows.sort((a, b) => (a[0] + '\t' + a[1] < b[0] + '\t' + b[1] ? -1 : a[0] + '\t' + a[1] > b[0] + '\t' + b[1] ? 1 : 0));
for (const r of rows) console.log(r.join('\t'));
