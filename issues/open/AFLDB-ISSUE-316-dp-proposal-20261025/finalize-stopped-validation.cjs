// Preserve the stopping result and refresh only proposal/tracking inventories.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname, p)));
const put = (p, obj) => fs.writeFileSync(path.join(__dirname, p), JSON.stringify(obj, null, 2) + '\n');
const insist = (ok, why) => { if (!ok) throw Error(why); };
const j2 = load('validation/retained-J2-integrity.json');
const external = load('validation/external-inputs.json');
const checked = [...j2.files.map(e => ({ path: e.path, sha256: e.expected_sha256 })), ...external.files.map(e => ({ path: e.path, sha256: e.expected_sha256 })), ...external.historical_censuses];
for (const e of checked) insist(sha(fs.readFileSync(e.path)) === e.sha256, 'External evidence changed: ' + e.path);
put('validation/EXTERNAL-IMMUTABILITY.json', { verified_at: new Date().toISOString(), status: 'PASS', package_files: j2.files.length, successor_files: external.files.length, separately_consumed_historical_censuses: external.historical_censuses.length, all_434_pin_checks_match: checked.length === 434, external_writes: false,
  original_package_manifest_sha256: j2.manifest_sha256,
  final_package_manifest_sha256: sha(fs.readFileSync(path.join(j2.package, 'HASHES.sha256'))) });
const broader = load('validation/state-B-broader.exit.json');
insist(broader.exit_code === 1 && broader.failed === 32, 'Unexpected broader B result');
const findings = broader.failures.map(f => ({ name: f.name,
  classification: f.message.some(m => m.includes('ReferenceError: fabricated is not defined')) ? 'Material restatement defect: undefined fixture'
    : f.name.startsWith('ISSUE-316 ladder-season-scope') || f.name.startsWith('final validation takes') ? 'Material B/C restatement conflict: inactive B used as adopted successor'
    : 'Additional child-process/runtime failure; cause not fully adjudicated',
  error: f.message[0].split('\n')[0], location: f.message[0].split('\n').find(s => s.includes('/tests/') && /:\d+:\d+/.test(s))?.trim() ?? null }));
put('validation/STOPPING-FINDINGS.json', { status: 'STOP', owner_adjudication_required: true, state: 'B', passed: broader.passed, skipped: broader.skipped, failed: broader.failed, findings,
  state_C: 'NOT RUN after material State B failure', product_or_assertion_edits: false, stopping_record: 'STOP-RECORD.md' });
const previousPath = path.join(__dirname, 'validation/FINAL-PACKAGE-CHECKS.pre-retained-inputs.json');
if (!fs.existsSync(previousPath)) fs.copyFileSync(path.join(__dirname, 'validation/FINAL-PACKAGE-CHECKS.json'), previousPath, fs.constants.COPYFILE_EXCL);
const candidate = load('validation/OFFLINE-RECONCILIATION.json');
const authorityPins = candidate.authorities.map(a => ({ action: a.action, sha256: a.sha256 }));
for (const a of authorityPins) insist(sha(fs.readFileSync(path.join(__dirname, a.action + '-authority.PROPOSED.json'))) === a.sha256, 'Authority changed');
for (const f of load('PIN-TABLE.json').files) insist(sha(fs.readFileSync(path.join(__dirname, 'finals', f.path))) === f.proposed_final_sha256, 'Final pin changed');
const tracking = ['IssuesIndex.md', 'issues.md', 'blockers.md', 'CHANGELOG.md'];
for (const p of tracking) insist(fs.readFileSync(path.join(root, p), 'utf8').includes('2,956 passed / 7 skipped / 32 failed'), 'Tracking not synchronised: ' + p);
let links = 0;
for (const p of ['PROPOSAL.md', 'STOP-RECORD.md', 'restatements/README.md']) {
  const file = path.join(__dirname, p);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    insist(fs.existsSync(path.resolve(path.dirname(file), target)), 'Broken evidence link: ' + target);
    links++;
  }
}
const final = { verified_at: new Date().toISOString(), status: 'STOP — owner adjudication required', proposal: 'INCOMPLETE / NOT EXECUTION-READY', source_P: candidate.source_P,
  proposed_D: candidate.proposed_D, proposed_window_UTC: candidate.production_window_UTC, values_owner_approved: false,
  retained_J2: '167/167 PASS', retained_successor_inputs: '264/264 PASS', real_offline_validator: 'exit 0 / 3-of-3 / all pins match', candidate_reconciliation: 'PASS; seven-file apply shape, B inactivity, C 1640/91 and both proposed authority bindings unchanged',
  state_B_broader: { exit_code: 1, passed: broader.passed, skipped: broader.skipped, failed: broader.failed }, state_C_broader: 'NOT RUN after B stopping finding',
  existing_focused_rollover_evidence: '395/395 per state, previous run; does not complete broader validation',
  external_evidence_unchanged: true, current_local_links_checked: links, tracking_updated: tracking,
  previous_source_index_and_diff_checks: 'Retained in FINAL-PACKAGE-CHECKS.pre-retained-inputs.json; no new Git command/check claimed',
  product_or_accepted_assertion_edits: false, production_contact: false, database_connection: false, external_material_modified: false,
  structural_gate: 'CLOSED / ACCEPTED', U3: 'CONFIRMED', U4: 'Route B', Brownlow: 'untouched', issue_316: 'OPEN', production: 'NO-GO',
  next_action: 'Owner adjudicates the material B restatement failure before repair/resumption. No production or other execution authority inferred.' };
put('validation/FINAL-PACKAGE-CHECKS.json', final);
function filesIn(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['simulations', 'simulation-objects', '__pycache__'].includes(e.name) || e.name.startsWith('simulation.index')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesIn(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}
const all = filesIn(__dirname).filter(p => !['CHANGED-FILES.json', 'SHA256SUMS'].includes(path.basename(p))).sort();
const changed = load('CHANGED-FILES.json');
const prior = new Map(changed.proposal_files.map(f => [f.path, f.sha256]));
const proposalFiles = all.map(p => ({ path: path.relative(root, p).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(p)) }));
changed.proposal_files = proposalFiles;
changed.retained_input_validation_session = { date: '2026-10-25', status: final.status,
  changed_or_added_proposal_files: proposalFiles.filter(f => prior.get(f.path) !== f.sha256).map(f => f.path),
  tracking_files: tracking.map(p => ({ path: p, sha256: sha(fs.readFileSync(path.join(root, p))) })),
  also_updated: [rel + '/CHANGED-FILES.json', rel + '/SHA256SUMS'],
  generated_validation_copies: '.local-release/issue316-dp-20261025/{source-P,state-B,state-C}: retained successor inputs copied; product checkout and restatement previews unchanged',
  no_git_commands_executed: true, no_product_or_accepted_assertion_edits: true };
put('CHANGED-FILES.json', changed);
const sums = [...all, path.join(__dirname, 'CHANGED-FILES.json')].sort().map(p => sha(fs.readFileSync(p)) + '  ' + path.relative(__dirname, p).replaceAll('\\', '/')).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'SHA256SUMS'), sums);
// Read back every package consumer hash, including the updated file inventory.
for (const line of sums.trim().split('\n')) {
  const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
  insist(m && sha(fs.readFileSync(path.join(__dirname, m[2]))) === m[1], 'Final package hash mismatch');
}
console.log(JSON.stringify({ ...final, package_hashed_members: all.length + 1, changed_or_added_proposal_files: changed.retained_input_validation_session.changed_or_added_proposal_files.length,
  package_manifest_sha256: sha(Buffer.from(sums)), failure_classifications: findings.reduce((out, f) => { out[f.classification] = (out[f.classification] || 0) + 1; return out; }, {}) }));
