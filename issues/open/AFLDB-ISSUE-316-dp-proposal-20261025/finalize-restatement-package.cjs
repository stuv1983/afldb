// Proposal documentation/inventory only. No Git, validator, database, production or rebuild execution.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname, p)));
const put = (p, v) => fs.writeFileSync(path.join(__dirname, p), JSON.stringify(v, null, 2) + '\n');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const proofDir = 'validation/restatement-repair/';
const checks = {};
for (const state of ['B', 'C']) for (const mode of ['broader', 'focused']) {
  const p = `${proofDir}state-${state}-${mode}-final.exit.json`, j = load(p);
  if (j.exit_code !== 0 || j.failed !== 0 || j.suite_failures !== 0 || !j.expected_skips_match || j.protected_files.mismatches.length) throw Error('Invalid final result: ' + p);
  checks[`${state}_${mode}`] = { passed: j.passed, skipped: j.skipped, failed: j.failed, exit_code: j.exit_code, result: p, full_results: j.result_file };
}
const review = load(proofDir + 'REVIEW.json');
if (review.verdict !== 'GO' || review.stopping_findings.length) throw Error('Fresh read-only review is not GO');
for (const [p, h] of Object.entries(review.reviewed_files ?? {})) {
  if (sha(fs.readFileSync(path.join(__dirname, p))) !== h) throw Error('Reviewed bytes drifted: ' + p);
}
const before = load(proofDir + 'protected-before.json');
const mismatches = Object.entries(before).filter(([p,h]) => !fs.existsSync(path.join(root,p)) || sha(fs.readFileSync(path.join(root,p))) !== h).map(([p]) => p);
if (mismatches.length) throw Error('Protected drift: ' + JSON.stringify(mismatches));
const map = load('restatements/RESTATEMENT-MAP.json');
if (map.summary.unmatched_P || map.summary.runtime_title_unmatched || map.entries.some(e => !['PASS', 'EXPECTED SKIP', 'PASS WITH EXPECTED SKIPS'].includes(e.validation.result))) throw Error('Incomplete map');
const proposalPath = path.join(__dirname, 'PROPOSAL.md');
let proposal = fs.readFileSync(proposalPath, 'utf8');
const introStart = proposal.indexOf('**Preparation status:');
const introEnd = proposal.indexOf('The successor-activation structural gate', introStart);
if (introStart < 0 || introEnd < introStart) throw Error('Missing proposal intro');
proposal = proposal.slice(0, introStart) + `**Preparation status: COMPLETE FOR OWNER D/P ADJUDICATION. D/P NOT APPROVED. Production NO-GO.**

The owner accepted the initial broader B STOP as a D/P proposal restatement defect.
Only proposed copies and supporting validation/evidence were repaired. Final results:

| Projection | Passed | Expected skipped | Failed | Exit |
|---|---:|---:|---:|---:|
| Broader B | ${checks.B_broader.passed} | 7 | 0 | 0 |
| Broader C | ${checks.C_broader.passed} | 7 | 0 | 0 |
| Focused B | ${checks.B_focused.passed} | 0 | 0 | 0 |
| Focused C | ${checks.C_focused.passed} | 0 | 0 | 0 |

Fresh-context read-only restatement review: **GO, no stopping findings**.
[Review](validation/restatement-repair/REVIEW.md),
[machine-readable map](restatements/RESTATEMENT-MAP.json),
[fixture/classification record](restatements/REPAIR-RECORD.md),
[final evidence](validation/FINAL-PACKAGE-CHECKS.json).
The same seven expected broader skips remain. All ${Object.keys(before).length} protected accepted-source,
test, reference/deployment and structural-artifact hashes match. No accepted product or
test assertion changed. The accepted retained-input proof is reused, not repeated.
[Historical STOP](STOP-RECORD.md) and failed repair attempts remain retained.

` + proposal.slice(introEnd);
const sectionStart = proposal.indexOf('## Retained-input validation and stopping restatement finding');
if (sectionStart < 0) throw Error('Missing stopping section');
proposal = proposal.slice(0, sectionStart) + `## Accepted retained proof and repaired restatements

The accepted retained J2 proof remains unchanged: 167/167 package hashes, 264/264
successor inputs, real offline validator exit 0 / 3-of-3 gates / all pins match,
seven-file apply shape, installed/inactive B, and projected C 1,640 rows / 91 check
definitions. It was not repeated because the test restatements were defective.
No new disposable rebuild was performed or indicated.

The initial B 2,956/7/32 result is historical D/P proposal-restatement evidence,
not a product/rebuild finding. P's complete inactive refusal fixtures are restored
in B; J2's adopted resolution/guard/mutation/final-check assertions remain C-only.
Explicit predecessor invariants are retained identically in both states.
The map covers ${map.summary.declarations} declarations, including every changed test,
with ${map.summary.unmatched_P} unmatched P declarations and ${map.summary.runtime_title_unmatched}
unmatched runtime titles. Fixture repairs and material input/state assertions are
explicitly recorded. See the linked review and final test results above.

Root issue/index/changelog files were not edited under this proposal-only authority.
Their earlier STOP summaries are historical; this package records the owner's
repair ruling and current result. ISSUE-316 remains OPEN. No issue is closed here.
No fresh Git/index/ancestry/diff check is claimed; prior structural evidence is retained.

**Return this completed proposal to the owner for D/P adjudication.** No D, P,
window, proposed activation/deactivation authority or execution permission is
self-approved. Structural gate CLOSED / ACCEPTED; U3 CONFIRMED; U4 Route B;
Brownlow untouched; production NO-GO.

No production census, native-policy proof window, enforced production dry run,
rollover/apply, successor activation, deployment, disposable rebuild or push was
performed. Any production or freshness-sensitive step waits for separate owner
adjudication. Deactivation precedes rollover recovery if activation has occurred;
apply recovery never edits the tuple table.
`;
fs.writeFileSync(proposalPath, proposal);
const plan = load('RESTATEMENT-PLAN.json');
plan.classification = 'Owner-authorised proposal-only B/C restatement repair; accepted checkout remains unchanged';
plan.status = 'B/C broader and focused PASS; fresh read-only review GO; complete for owner D/P adjudication, not owner-approved';
plan.broader_validation = { state_B: checks.B_broader, state_C: checks.C_broader, historical_stopping_record: 'STOP-RECORD.md', owner_repair_authorised: true, owner_DP_adjudication_required: true };
plan.rollover_validation = { B: checks.B_focused, C: checks.C_focused };
plan.restatement_map = 'restatements/RESTATEMENT-MAP.json';
plan.fixture_repairs = 'restatements/REPAIR-RECORD.md';
plan.fresh_read_only_review = proofDir + 'REVIEW.json';
if (!plan.conflict_resolutions.some(r => r.evidence === 'restatements/REPAIR-RECORD.md')) plan.conflict_resolutions.push({ path: 'tests/db-test-rebuild.test.ts', repair: 'Restore complete P inactive helpers/refusals to B; J2 adopted setup and assertions C-only; explicit predecessor invariants in both states', evidence: 'restatements/REPAIR-RECORD.md' });
put('RESTATEMENT-PLAN.json', plan);
const stopPath = path.join(__dirname, 'STOP-RECORD.md');
let stop = fs.readFileSync(stopPath, 'utf8');
if (!stop.includes('## Subsequent owner ruling and repair')) stop += `
## Subsequent owner ruling and repair

The owner accepted this STOP and classified the original B result as a D/P proposal
restatement defect. Proposal-only repair was authorised without reopening the
structural gate or repeating accepted J2 proof. Final broader B ${checks.B_broader.passed}/7/0,
broader C ${checks.C_broader.passed}/7/0, focused B ${checks.B_focused.passed}/0/0 and C
${checks.C_focused.passed}/0/0 all exit 0. Fresh read-only review GO, no stopping
findings. [Current proposal](PROPOSAL.md), [repair record](restatements/REPAIR-RECORD.md),
[review](validation/restatement-repair/REVIEW.md). The earlier text/results above
are preserved historical evidence. D/P adjudication remains the owner's decision;
production NO-GO.
`;
fs.writeFileSync(stopPath, stop);
fs.writeFileSync(path.join(__dirname, 'restatements/README.md'), `# Proposed B/C restatements — validated for owner review

B is applied/installed/inactive/rebuild-ineligible; C is the activated tree.
Broader B ${checks.B_broader.passed}/7/0; broader C ${checks.C_broader.passed}/7/0;
focused B ${checks.B_focused.passed}/0/0; focused C ${checks.C_focused.passed}/0/0.
All exit 0. Fresh read-only restatement review GO, no stopping findings.
See [map](RESTATEMENT-MAP.json), [fixture/classification record](REPAIR-RECORD.md),
[review](../validation/restatement-repair/REVIEW.md) and [proposal](../PROPOSAL.md).
These are proposed text copies, not accepted-checkout changes or D/P approval.
TypeScript previews use .ts.txt to remain outside the application typecheck.
`);
const previousFinal = 'validation/FINAL-PACKAGE-CHECKS.pre-restatement-repair.json';
if (!fs.existsSync(path.join(__dirname, previousFinal))) fs.copyFileSync(path.join(__dirname, 'validation/FINAL-PACKAGE-CHECKS.json'), path.join(__dirname, previousFinal));
const final = { verified_at: new Date().toISOString(), status: 'COMPLETE FOR OWNER D/P ADJUDICATION', proposal_owner_approved: false,
  source_P: 'def676517da3955aa18db3606785463aac464188', proposed_D: '2026-10-27', proposed_window_UTC: '02:00–04:00',
  structural_gate: 'CLOSED / ACCEPTED', retained_proof: { accepted_reused_not_rerun: true, package: '167/167 PASS', inputs: '264/264 PASS', real_offline_validator: 'exit 0 / 3-of-3 / pins match', state_C_projection: '1640 rows / 91 definitions' },
  checks, fresh_read_only_review: proofDir + 'REVIEW.json', restatement_map: 'restatements/RESTATEMENT-MAP.json', map_summary: map.summary,
  protected_files: { count: Object.keys(before).length, mismatches }, product_or_accepted_assertion_edits: false, structural_artifact_edits: false,
  production_contact: false, database_connection: false, disposable_rebuild: false, Git_commands: false,
  root_tracking_this_session: 'Unchanged under proposal-only authority; current ruling/result tracked in this package; ISSUE-316 OPEN',
  U3: 'CONFIRMED', U4: 'Route B', Brownlow: 'untouched', production: 'NO-GO', next_action: 'Owner adjudicates D/P; no production execution authorised' };
put('validation/FINAL-PACKAGE-CHECKS.json', final);
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['simulations', 'simulation-objects', '__pycache__'].includes(e.name) || e.name.startsWith('simulation.index')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesIn(p) : e.isFile() ? [p] : [];
  });
}
const all = filesIn(__dirname).filter(p => !['CHANGED-FILES.json', 'SHA256SUMS'].includes(path.basename(p))).sort();
const changed = load('CHANGED-FILES.json');
const prior = new Map(changed.proposal_files.map(f => [f.path, f.sha256]));
changed.proposal_files = all.map(p => ({ path: path.relative(root,p).replaceAll('\\','/'), sha256: sha(fs.readFileSync(p)) }));
changed.restatement_repair_session = { ...final, changed_or_added_proposal_files: changed.proposal_files.filter(f => prior.get(f.path) !== f.sha256), generated_copies: '.local-release/issue316-dp-20261025/state-{B,C}; existing excluded projections only' };
put('CHANGED-FILES.json', changed);
const sums = [...all, path.join(__dirname, 'CHANGED-FILES.json')].sort().map(p => sha(fs.readFileSync(p)) + '  ' + path.relative(__dirname,p).replaceAll('\\','/')).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'SHA256SUMS'), sums);
for (const line of sums.trim().split('\n')) {
  const [,h,p] = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (sha(fs.readFileSync(path.join(__dirname,p))) !== h) throw Error('Package hash mismatch ' + p);
}
console.log(JSON.stringify({ status: final.status, checks, protected_files: Object.keys(before).length, package_members: all.length + 1, sha256sums: sha(Buffer.from(sums)) }));
