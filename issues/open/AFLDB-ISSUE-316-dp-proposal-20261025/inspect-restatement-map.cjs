'use strict';
const fs = require('node:fs');
const path = require('node:path');
const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'restatements/RESTATEMENT-MAP.json')));
if (process.argv[2] === 'result-shape') {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'validation/state-B-broader.results.json')));
  console.log(JSON.stringify(j.testResults[0].assertionResults[0]));
  process.exit(0);
}
const out = map.entries.filter(e => e.state === 'B' && !e.change.startsWith('unchanged')).map(e => ({ p: e.path, line: e.line, title: e.test.split(' > ').at(-1), source: e.proposed_text_source, classification: e.classification }));
console.log(JSON.stringify(out, null, 2));
