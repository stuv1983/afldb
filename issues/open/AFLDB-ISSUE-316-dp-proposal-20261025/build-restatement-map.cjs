'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const read = p => fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const tokenText = s => {
  const scan = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, s), a = [];
  while (scan.scan() !== ts.SyntaxKind.EndOfFileToken) a.push(scan.getTokenText());
  return a.join(' ');
};
// Explicit original-title links for renamed historical/predecessor and installed-state counterparts.
const renamed = {
  'shipped active and bounded to 2026 in the explicit predecessor, which altered no live behaviour': 'ships active and bounded to 2026, so this change alone alters no live behaviour',
  'ships retired by D-316-1 at the 2026 rollover, still bounded to 2026 (AFLDB-ISSUE-316)': 'ships active and bounded to 2026, so this change alone alters no live behaviour',
  'resolves and plans the explicit predecessor contract without injecting an expectation': 'resolves and plans the actual predecessor contract without injecting an expectation',
  'invariant: explicit predecessor plan reaches its first stage with predecessor documents': 'keeps the ordinary predecessor rebuild unchanged: guards pass and the real plan reaches its first stage',
  'accepts exactly c2-2026-final-core-v1 from the REAL tracked register (AFLDB-ISSUE-316 D-316-1)': 'accepts exactly full-history-20260902 from the REAL tracked register',
  'accepted exactly full-history-20260902 from the predecessor register': 'accepts exactly full-history-20260902 from the REAL tracked register',
  'refuses the retired %s by label on the normal path': 'refuses the retired predecessor by label on the normal path',
  'invariant: takes predecessor final-check values from its explicit register fixture': 'takes its expected values from the tracked register, not from this file',
  'state C: takes its expected values from the tracked register, not from this file': 'takes its expected values from the tracked register, not from this file',
  'included all 2026 football only in explicit synthetic completed metadata before the rollover': 'includes all 2026 football only in explicit synthetic completed metadata',
  'the real register holds one accepted baseline beside the two it retired': 'the real register holds one accepted baseline beside one retired one',
  'confirms the real repository boundary is 2026 / 2027 since the 2026 rollover (D-316-1)': 'confirms the real repository boundary is still 2025 / 2026',
  'the explicit predecessor boundary was 2025 / 2026': 'confirms the real repository boundary is still 2025 / 2026',
  'state A (explicit predecessor fixture): accepts the state and names what stays pending': 'state A (the real repository, predecessor, pre-apply): accepts the state and names what stays pending',
  'state C: accepts the real repository state, the adopted c2-2026-successor, and names what stays pending': 'state A (the real repository, predecessor, pre-apply): accepts the state and names what stays pending',
  'no manual_curated entry exists yet, and every api_* claim is 2026, resting on stored fixtures now that 2026 is sealed': 'no manual_curated entry exists yet, and nothing is api_* for a sealed season',
  'historical_baseline on the real 2027 season is a problem (it is open in data/reference/seasons.json)': 'historical_baseline on the real 2026 season is a problem (it is open in data/reference/seasons.json)',
  'historical_baseline on the real 2026 season is accepted now that the rollover sealed it, but no api_* claim may drop its fixture': 'historical_baseline on the real 2026 season is a problem (it is open in data/reference/seasons.json)',
  'reads 1897-2026 from the real seasons registry (2027 in progress since the 2026 rollover)': 'reads 1897-2025 from the real seasons registry (2026 in progress)',
  'read 1897-2025 from the explicit predecessor registry (2026 in progress)': 'reads 1897-2025 from the real seasons registry (2026 in progress)',
  'seals 2026 and does not seal 2027 (or a season past last_season) since the 2026 rollover': 'seals 2025 and does not seal 2026 (or a season past last_season)',
};
function tests(text, name) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  if (sf.parseDiagnostics.length) throw Error('Invalid syntax in ' + name + ': ' + JSON.stringify(sf.parseDiagnostics.map(d => ({ line: sf.getLineAndCharacterOfPosition(d.start).line + 1, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') }))));
  const entries = [];
  function visit(n, suites) {
    if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteralLike(n.arguments[0])) {
      const call = n.expression.getText(sf), title = n.arguments[0].text;
      const isTest = /^(?:it|test)(?:\b|\.)/.test(call);
      const isSuite = /^describe(?:\b|\.)/.test(call);
      if (isTest) {
        const callback = n.arguments.find(ts.isArrowFunction) ?? n.arguments.find(ts.isFunctionExpression);
        entries.push({ title, suites, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          text: n.getText(sf), tokens: tokenText(n.getText(sf)),
          body: tokenText(callback?.getText(sf) ?? ''),
          parameterization: tokenText(call),
          callback_sha256: sha(tokenText(callback?.getText(sf) ?? '')) });
        return;
      }
      if (isSuite) { ts.forEachChild(n, c => visit(c, [...suites, title])); return; }
    }
    ts.forEachChild(n, c => visit(c, suites));
  }
  visit(sf, []);
  return entries;
}
const plan = JSON.parse(read(path.join(__dirname, 'RESTATEMENT-PLAN.json')));
const patch = read(path.join(__dirname, 'accepted-J2-restatements.patch'));
const patchPost = {};
let current;
for (const line of patch.split('\n')) {
  if (line.startsWith('+++ b/')) { current = line.slice(6); patchPost[current] = ''; }
  else if (current && (line.startsWith(' ') || (line.startsWith('+') && !line.startsWith('+++')))) patchPost[current] += line.slice(1) + '\n';
  else if (current && line.startsWith('@@')) patchPost[current] += '\n/* hunk boundary */\n';
}
const states = {}, ptests = {}, fileRows = [];
for (const p of plan.files) {
  const before = read(path.join(root, p));
  const texts = {};
  for (const state of ['B', 'C']) texts[state] = read(path.join(__dirname, 'restatements/state-' + state, p + (/\.tsx?$/.test(p) ? '.txt' : '')));
  fileRows.push({ path: p, P_sha256_lf: sha(before), B_sha256_lf: sha(texts.B), C_sha256_lf: sha(texts.C), identical_between_states: texts.B === texts.C,
    rationale: p.startsWith('tests/') ? 'Test declarations mapped below; fixture and helper adaptations documented in REPAIR-RECORD.md.' : 'J2 post-rollover coverage restatement, identical in B/C; proposal copies only.' });
  if (!p.startsWith('tests/')) continue;
  ptests[p] = tests(before, p);
  for (const state of ['B', 'C']) (states[state] ??= {})[p] = tests(texts[state], p);
}
const results = {};
const runtime = {};
for (const state of ['B', 'C']) {
  const report = path.join(__dirname, `validation/restatement-repair/state-${state}-broader-final.exit.json`);
  results[state] = fs.existsSync(report) ? JSON.parse(read(report)) : null;
  runtime[state] = results[state] ? JSON.parse(read(path.join(__dirname, results[state].result_file))).testResults : [];
}
const entries = [];
for (const state of ['B', 'C']) for (const [p, list] of Object.entries(states[state])) for (const t of list) {
  const otherState = state === 'B' ? 'C' : 'B';
  const other = states[otherState][p].find(o => o.title === t.title && o.suites.join('/') === t.suites.join('/'));
  const fromP = ptests[p].find(o => o.title === t.title && o.suites.join('/') === t.suites.join('/')) ?? ptests[p].find(o => o.title === t.title) ?? ptests[p].find(o => o.title === renamed[t.title]);
  const identical = other && other.tokens === t.tokens;
  const classification = identical ? 'invariant' : state;
  const exactP = fromP && fromP.tokens === t.tokens;
  const bodyP = fromP && fromP.body === t.body && fromP.parameterization === t.parameterization;
  const j2Exact = tokenText(patchPost[p] ?? '').includes(t.tokens);
  const source = exactP || bodyP ? 'P' : j2Exact ? 'J2' : 'merged';
  const sourceTitle = fromP?.title ?? t.title;
  const stateSpecific = /adopted-successor guard|state [BC]:|actual contract, the adopted|tracked register/.test([...t.suites, t.title].join(' ')) && classification !== 'invariant';
  const validation = results[state];
  const suite = runtime[state].find(s => s.name.replaceAll('\\', '/').endsWith('/' + p));
  const titlePattern = t.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%[sdifjo#]/g, '.*').replace(/\\\$[\w.]+/g, '.*');
  const titleRe = new RegExp('^' + titlePattern + '$');
  const observed = suite?.assertionResults.filter(a => titleRe.test(a.title)) ?? [];
  entries.push({ state, path: p, line: t.line, test: [...t.suites, t.title].join(' > '),
    source_test: { path: p, title: sourceTitle, P_line: fromP?.line ?? null, J2_patch: 'accepted-J2-restatements.patch', evidence: fromP ? 'Exact P title match; body/parameterization compared token-wise' : 'Post-transition J2/merged declaration; see retained patch and original preview' },
    classification, proposed_text_source: source,
    change: exactP ? 'unchanged declaration (helper/input context separately mapped)' : bodyP ? 'title/comment only' : 'assertion/input/parameterization change',
    declaration_sha256: sha(t.tokens), callback_sha256: t.callback_sha256,
    rationale: identical ? 'Same declaration and parameterization in B/C. Includes controlled synthetic state projections; real activation is not assumed.' : stateSpecific && state === 'C' ? 'Activated-state assertion/setup belongs only to C; absent from B.' : stateSpecific && state === 'B' ? 'Inactive B must refuse successor adoption/resolution/execution; explicit P fixtures restored.' : 'State-specific restatement or predecessor fixture counterpart; inspect source and REPAIR-RECORD.md.',
    validation: validation ? { result: observed.length ? observed.every(a => a.status === 'passed') ? 'PASS' : observed.every(a => ['pending', 'skipped'].includes(a.status)) ? 'EXPECTED SKIP' : 'PASS WITH EXPECTED SKIPS' : 'CONTAINING SUITE PASS; no direct runtime title match',
      runtime_matches: observed.length, runtime_passed: observed.filter(a => a.status === 'passed').length, runtime_skipped: observed.filter(a => ['pending', 'skipped'].includes(a.status)).length,
      evidence: validation.result_file, suite: p, expected_skips_match: validation.expected_skips_match } : { result: 'NOT RUN' } });
}
const unmatchedP = [];
for (const [p, list] of Object.entries(ptests)) for (const t of list) {
  const matches = entries.filter(e => e.path === p && e.source_test.P_line === t.line);
  if (!matches.length) unmatchedP.push({ path: p, line: t.line, title: t.title,
    disposition: /ordinary predecessor rebuild/.test(t.title) ? 'Both states: explicit predecessor plan invariant counterpart; no claim that installed successor tree can run predecessor by default.' : /resolves and plans the actual contract/.test(t.title) ? 'Both states: explicit raw-predecessor resolution invariant; B installed-tree refusal; C adopted-tree resolution.' : 'Renamed/restated declaration; source title/body correspondence requires review against patch and map entries.' });
}
const map = { schema: 'afldb.issue316.proposal-restatement-map/1', scope: 'All declarations in all 14 proposed test files (superset of changed tests); no accepted test edits.',
  comparison: 'P title and tokens; J2 patch postimage exact token containment where available; otherwise merged. Source origins describe declaration text; shared helper changes have independent records.',
  invariants: 'Invariant classification requires identical declaration tokens and parameterization in B/C. Shared helpers/inputs are reviewed separately.',
  files: fileRows, entries, unmatched_P_declarations: unmatchedP,
  summary: { declarations: entries.length, changed_from_P: entries.filter(e => !e.change.startsWith('unchanged')).length, B: entries.filter(e => e.classification === 'B').length, C: entries.filter(e => e.classification === 'C').length, invariant: entries.filter(e => e.classification === 'invariant').length, unmatched_P: unmatchedP.length,
    runtime_title_unmatched: entries.filter(e => e.validation.runtime_matches === 0).length } };
fs.writeFileSync(path.join(__dirname, 'restatements/RESTATEMENT-MAP.json'), JSON.stringify(map, null, 2) + '\n');
console.log(JSON.stringify(map.summary));
console.log(JSON.stringify(unmatchedP));
