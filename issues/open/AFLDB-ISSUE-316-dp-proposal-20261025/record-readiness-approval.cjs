// Record the owner's D/P approval; documentation/evidence only, no production operations.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname, p)));
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const out = path.join(__dirname, 'readiness');
if (fs.existsSync(path.join(out, 'APPROVAL.json'))) throw Error('Approval already recorded; do not overwrite');
const manifest = fs.readFileSync(path.join(__dirname, 'SHA256SUMS'));
let checked = 0;
for (const line of manifest.toString().trim().split(/\r?\n/)) {
  const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!m || sha(fs.readFileSync(path.join(__dirname, m[2]))) !== m[1]) throw Error('Pre-approval package hash mismatch');
  checked++;
}
if (checked !== 201 || sha(manifest) !== 'b708d8eb0b1fe198a1fd7677e0ba5a3b739c93a48f6883d710217f77126fb8b6') throw Error('Not the reviewed proposal package');
const pins = load('PIN-TABLE.json');
const changeSet = load('transition-change-set.json');
const frozen = {};
for (const p of ['PIN-TABLE.json', 'transition-change-set.json', 'successor-tuple.json', 'migration-binding.json',
  'activate-authority.PROPOSED.json', 'deactivate-authority.PROPOSED.json',
  'pins/rebuild-test.inactive.ts.txt', 'pins/rebuild-test.projected-active.ts.txt',
  'SEMANTIC-DIFF.json', 'SIMULATED-TREES-AND-AUTHORITIES.json', 'BUNDLES.json']) frozen[p] = sha(fs.readFileSync(path.join(__dirname, p)));
for (const f of pins.files) {
  const p = 'finals/' + f.path;
  frozen[p] = sha(fs.readFileSync(path.join(__dirname, p)));
  if (frozen[p] !== f.proposed_final_sha256) throw Error('Final pin mismatch ' + p);
}
for (const f of changeSet.inputs) {
  const packagePath = f.path.startsWith(rel + '/') ? f.path.slice(rel.length + 1) : 'inputs/' + path.posix.basename(f.path);
  // Manifest inputs are retained under inputs/manifests in this package; record existing input inventory below.
  if (fs.existsSync(path.join(__dirname, packagePath))) frozen[packagePath] = sha(fs.readFileSync(path.join(__dirname, packagePath)));
}
for (const item of load('CHANGED-FILES.json').proposal_files) {
  const p = item.path.slice(rel.length + 1);
  if (p.startsWith('inputs/') || p.startsWith('bundles/')) frozen[p] = sha(fs.readFileSync(path.join(__dirname, p)));
}
const before = load('validation/restatement-repair/protected-before.json');
for (const [p,h] of Object.entries(before)) if (sha(fs.readFileSync(path.join(root,p))) !== h) throw Error('Accepted source/structural drift ' + p);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'APPROVED-PACKAGE.sha256'), manifest);
const approval = {
  schema: 'afldb.issue316.readiness-approval/1', recorded_at_utc: new Date().toISOString(), owner_ruling_date: '2026-10-25',
  status: 'APPROVED FOR READINESS PROOF ONLY', D: '2026-10-27', P: 'def676517da3955aa18db3606785463aac464188',
  implementation_commit: 'c438f8449e65c28cf9f00879aaa045131b5f0d3a', evidence_tracking_commit: 'def676517da3955aa18db3606785463aac464188',
  readiness_window: { start_utc: '2026-10-27T02:00:00Z', end_utc: '2026-10-27T04:00:00Z', Melbourne_AEDT: '2026-10-27 13:00–15:00' },
  P_must_not_advance_for_documentation_commit: true,
  accepted_package: { manifest: 'APPROVED-PACKAGE.sha256', sha256: sha(manifest), members: checked },
  transition_change_set_sha256: pins.new_change_set_sha256, tuple_sha256: pins.tuple_sha256,
  rebuild: pins.rebuild, migrations: load('migration-binding.json'),
  authorities: pins.authorities.new, apply_write_set: pins.files.map(f => ({ path: f.path, base_sha256: f.base_at_P_sha256, final_sha256: f.proposed_final_sha256 })),
  approved_artifact_files: frozen,
  accepted_evidence: { structural_gate: 'CLOSED / ACCEPTED', J2_package: '167/167 PASS', successor_inputs: '264/264 PASS', offline_validator: 'exit 0 / 3-of-3 PASS / all pins match',
    B: 'installed / inactive / rebuild-ineligible', C_projection: '1640 rows / 91 checks', exact_P_DB_free: '11318 passed / 31 expected skipped / 0 failed', typecheck: 'PASS',
    broader_B: { passed: 2966, skipped: 7, failed: 0, exit: 0 }, broader_C: { passed: 2992, skipped: 7, failed: 0, exit: 0 },
    focused_B: { passed: 395, failed: 0, exit: 0 }, focused_C: { passed: 396, failed: 0, exit: 0 }, fresh_restatement_review: 'GO / no findings', earlier_restatement_failures: 'SUPERSEDED by owner-authorised proposal-only repair' },
  authorised: ['current read-only host/native-policy proof', 'fresh read-only three-target censuses', 'required read-only nightly/canonical check', 'enforced dry run without --apply', 'separate local documentation/evidence commit'],
  not_authorised: ['--apply', 'production rollover/seal mutation', 'successor activation', 'activation commit/deployment', 'deactivation', 'production deployment', 'disposable rebuild', 'push', 'Brownlow settlement/correction', 'OS package hold/install or timer mutation'],
  stop_rules: ['outside approved D/window', 'product/test/structural P change', 'approved artifact mismatch or substitution', 'candidate-affecting canonical drift',
    'native enforcement CRIT/HIGH or MED affecting completeness/visibility/provenance/isolation', 'census identity/failure/nonzero candidate total or missing result',
    'production census older than 6 hours at dry-run start', 'pending rollover/activation transaction artifact', 'dry run misses any required gate/pin/result', 'any attempted production write'],
  native_drift: 'Fresh actual inventory/policy plus normal enforcement/self-check and independent read-only review. Fully captured ordinary version drift with review GO needs no extra owner round-trip; no policy/timer mutation is authorised.',
  structural_gate: 'CLOSED / ACCEPTED', U3: 'CONFIRMED', U4: 'Route B', Brownlow: 'untouched', issue_316: 'OPEN', production: 'NO-GO pending separate apply approval'
};
fs.writeFileSync(path.join(out, 'APPROVAL.json'), JSON.stringify(approval, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'STATUS.json'), JSON.stringify({
  schema: 'afldb.issue316.readiness-status/1', observed_at_utc: new Date().toISOString(),
  state: 'AWAITING APPROVED READINESS WINDOW', D: approval.D, P: approval.P,
  readiness_window: approval.readiness_window, fresh_host_native_proof: 'NOT RUN', fresh_censuses: 'NOT RUN', nightly_canonical_check: 'NOT RUN', enforced_dry_run: 'NOT RUN',
  reason: 'Current UTC is before 2026-10-27T02:00:00Z. Fresh proof must be obtained in the approved window on D, not reused from today or J2.',
  production: approval.production, next_action: 'At approved window follow READINESS-RUNBOOK.md; return full proof package for separate production-apply decision.'
}, null, 2) + '\n');

const summary = '**Current owner ruling (2026-10-25):** structural gate **CLOSED / ACCEPTED**; D/P **APPROVED for readiness proof**. **D = 2026-10-27**, window **02:00–04:00 UTC / 13:00–15:00 AEDT (Melbourne)**; exact **P = `def676517da3955aa18db3606785463aac464188`**, implementation `c438f8449e65c28cf9f00879aaa045131b5f0d3a`. A later documentation/evidence commit never becomes P. Authorised in that window: current read-only host/native-policy proof, fresh three-target censuses, required nightly/canonical check and enforced dry run without `--apply`. No apply, activation, deactivation, deployment, disposable rebuild, push or Brownlow work. U3 **CONFIRMED**; U4 **Route B**; ISSUE-316 **OPEN**; production **NO-GO pending separate apply approval**.';
const evidence = '**D/P evidence accepted (2026-10-25):** retained J2 167/167 and inputs 264/264; real offline validator exit 0 / 3-of-3 PASS / all pins match; seven-file apply shape; B inactive/rebuild-ineligible; projected C 1,640 rows / 91 checks; exact-P DB-free validation and typecheck PASS. Proposal-only repair supersedes the earlier B 2,956/7/32 failure: broader B **2,966/7/0**, C **2,992/7/0**; focused B **395/0/0**, C **396/0/0**, all exit 0. Fresh-context restatement review GO, no findings. No accepted product/test assertions changed; no new rebuild required. Fresh proof is **NOT RUN**, awaiting the approved day-D window.';
for (const p of ['IssuesIndex.md', 'issues.md', 'issues/open/AFLDB-ISSUE-316.md']) {
  let t = read(p);
  if (!/^\*\*Current owner ruling \(2026-10-25\):\*\*.*$/m.test(t)) throw Error('Missing owner ruling ' + p);
  t = t.replace(/^\*\*Current owner ruling \(2026-10-25\):\*\*.*$/m, () => summary);
  const prior = /^\*\*D\/P (?:validation|preparation) \(2026-10-25\):[^\r\n]*$/m;
  if (!prior.test(t)) throw Error('Missing D/P summary ' + p);
  t = t.replace(prior, () => evidence + '\n[Approved bindings and day-D procedure](' + (p.startsWith('issues/open/') ? 'AFLDB-ISSUE-316-dp-proposal-20261025/readiness/READINESS-RUNBOOK.md' : rel + '/readiness/READINESS-RUNBOOK.md') + ').');
  if (p === 'issues.md') t = t.replace(/^\| AFLDB-ISSUE-316 \|[^\r\n]*$/m, () => '| AFLDB-ISSUE-316 | AFL API cutover: retire AFL Tables network acquisition | Medium | Data acquisition / source retirement | Open. Structural gate CLOSED / ACCEPTED. D/P approved for readiness proof; D 2026-10-27; P `def676517da3955aa18db3606785463aac464188`. U3 CONFIRMED; U4 Route B; Brownlow untouched; production NO-GO. | Await 2026-10-27 02:00–04:00 UTC: fresh host/native-policy proof, three read-only censuses, nightly/canonical check and enforced dry run only; then separate apply decision. [Runbook](' + rel + '/readiness/READINESS-RUNBOOK.md). |');
  t = t.replace('Successor activation separated from the apply (2026-10-25; current; local, uncommitted)', 'Successor activation separated from the apply (2026-10-25; accepted implementation c438f844)');
  fs.writeFileSync(path.join(root,p), t);
}
let blockers = read('blockers.md');
blockers = blockers.replace(/^> \*\*Current owner ruling \(2026-10-25\):\*\*.*$/m, () => '> ' + summary);
blockers = blockers.replace(/^> \*\*D\/P offline validation 2026-10-25[^]*?> \[Stopping record\]\([^\r\n]*\)\.[\r\n]*/m, () => '> ' + evidence + '\n> [Approved bindings and day-D procedure](' + rel + '/readiness/READINESS-RUNBOOK.md).\n\n');
fs.writeFileSync(path.join(root,'blockers.md'), blockers);
let changelog = read('CHANGELOG.md');
changelog = changelog.replace(/- Closed the successor-activation structural gate after final focused validation[^\r\n]*/, () => '- Closed the successor-activation structural gate at implementation `c438f844` / evidence and exact production candidate P `def676517da3955aa18db3606785463aac464188`. Owner approved D `2026-10-27` and the readiness window `02:00–04:00 UTC` (`13:00–15:00 AEDT`, Melbourne), preserving the reviewed seven-file pins, transition, tuple, inactive/active rebuild pins, migration binding and both authorities. Accepted retained-input proof, exact-P DB-free/typecheck, repaired broader B 2,966/7/0 and C 2,992/7/0, focused B 395/0/0 and C 396/0/0, and fresh restatement review GO supersede the historical proposal-copy failure. No product/accepted-test change or new rebuild. Current host/native proof, fresh three-target censuses, nightly/canonical check and enforced dry run are authorised in the approved day-D window and have not run. Documentation commits do not change P. Production NO-GO; apply, activation, deployment and push remain separately controlled. Binding/runbook: `' + rel + '/readiness/READINESS-RUNBOOK.md`.');
fs.writeFileSync(path.join(root,'CHANGELOG.md'), changelog);
let decision = read('docs/v2/issue316-production-readiness-decision-2026-10-24.md');
decision = decision.replace('**Status: for owner review. Nothing in this document is authorised.**', '**Current status: D/P APPROVED for readiness proof only; production NO-GO.** The owner ruling in §0b supersedes the historical approval drafts and restrictions below.');
decision = decision.replace(/^\*\*D\/P preparation \(2026-10-25\):[^\r\n]*/m, () => evidence + ' [Approved readiness runbook](../../' + rel + '/readiness/READINESS-RUNBOOK.md).');
decision = decision.replace('## 0a. Ruling recorded', () => `## 0b. D/P and read-only readiness authority (owner, 2026-10-25)

${summary}

${evidence}

The exact frozen hashes and the complete authorised procedure are in the
[approval record](../../${rel}/readiness/APPROVAL.json) and
[day-D runbook](../../${rel}/readiness/READINESS-RUNBOOK.md).
No approved input is silently regenerated. P remains exact even after the local
documentation commit. Candidate-affecting canonical drift, date/P drift, any
CRIT/HIGH, or MED affecting native completeness/visibility/provenance/isolation
stops and returns to the owner. Ordinary native version drift fully captured by
a fresh policy, normal enforcement/self-check and independent review GO may proceed
without another owner round-trip. J2 policy and censuses remain expired.

The historical combined dry-run/apply drafts below grant no apply authority.
Only the enforced dry run without \`--apply\` is authorised. No package hold,
installation or timer mutation is authorised. Three censuses are read-only, on
D, preferably within six hours; the production census must be no older than six
hours when the dry run begins. After proof, return the full decision package
and request the separate production-apply decision. State B must later be
validated before a separate activation decision. Brownlow stays Route B.

## 0a. Ruling recorded`);
fs.writeFileSync(path.join(root,'docs/v2/issue316-production-readiness-decision-2026-10-24.md'), decision);
const pp = path.join(__dirname,'PROPOSAL.md');
let proposal = fs.readFileSync(pp,'utf8');
proposal = proposal.replace('**Preparation status: COMPLETE FOR OWNER D/P ADJUDICATION. D/P NOT APPROVED. Production NO-GO.**', '**Current status: D/P APPROVED FOR READINESS PROOF ONLY. Production NO-GO pending separate apply approval.**\n\nOwner ruling 2026-10-25: [approved bindings](readiness/APPROVAL.json), [day-D runbook](readiness/READINESS-RUNBOOK.md). All reviewed structural bytes below remain unchanged. Earlier proposal wording is historical; D/window/P are now approved for readiness proof. Activation/deactivation authority files retain their exact reviewed bytes and PROPOSED names; execution remains separately unauthorised.');
proposal = proposal.replace('This proposal and the post-commit closure annotations are uncommitted. No additional commit or push has been made.', 'A separate local documentation/evidence commit is authorised. Its HEAD is never substituted for P. No push is authorised.');
proposal = proposal.replace('## Proposed window, D and P', '## Approved readiness window, D and P');
proposal = proposal.replace('- Proposed production window:', '- Approved readiness/proof window:').replace('AEDT**, Sydney)', 'AEDT**, Melbourne)');
proposal = proposal.replace('- Proposed rollover date **D = 2026-10-27 (UTC)**. This is a proposal, not a selected or authorised production window. If D slips, regenerate every affected artefact and consumer hash.', '- Approved rollover date **D = 2026-10-27 (UTC)**. If D slips, STOP, regenerate D-sensitive material and return for owner adjudication.');
proposal = proposal.replace('Root issue/index/changelog files were not edited under this proposal-only authority.\nTheir earlier STOP summaries are historical; this package records the owner\'s\nrepair ruling and current result. ISSUE-316 remains OPEN. No issue is closed here.', 'During the restatement repair, root issue/index/changelog files were unchanged.\nThe subsequent owner D/P approval authorises synchronized documentation/tracking\nand a separate local evidence commit. ISSUE-316 remains OPEN. No issue is closed here.');
proposal = proposal.replace(/\*\*Return this completed proposal to the owner for D\/P adjudication\.\*\*[^]*$/, () => `**Owner D/P adjudication: APPROVED for readiness proof, 2026-10-25.**
The approved window is 2026-10-27 02:00–04:00 UTC (13:00–15:00 AEDT, Melbourne).
P stays \`def676517da3955aa18db3606785463aac464188\` after documentation commits.
Proof has not run; await the approved window and follow the bound runbook.
Current native/host proof, fresh read-only censuses, nightly/canonical check and
enforced dry run only are authorised. Apply, activation, deactivation, deployment,
disposable rebuild and push remain unauthorised. No production operation was
performed while recording this ruling. Structural gate CLOSED / ACCEPTED;
U3 CONFIRMED; U4 Route B; Brownlow untouched; production NO-GO.
`);
fs.writeFileSync(pp,proposal);
const plan = load('RESTATEMENT-PLAN.json');
plan.owner_DP_approval = 'APPROVED FOR READINESS PROOF ONLY';
plan.readiness_approval = 'readiness/APPROVAL.json';
plan.status = 'All B/C checks and fresh restatement review accepted by owner; D/P approved; await approved 2026-10-27 proof window';
plan.broader_validation.owner_DP_adjudication_required = false;
fs.writeFileSync(path.join(__dirname,'RESTATEMENT-PLAN.json'),JSON.stringify(plan,null,2)+'\n');
const final = load('validation/FINAL-PACKAGE-CHECKS.json');
fs.writeFileSync(path.join(out,'ACCEPTED-PRE-APPROVAL-FINAL.json'),JSON.stringify(final,null,2)+'\n');
final.owner_DP_approval = 'APPROVED FOR READINESS PROOF ONLY';
final.proposal_owner_approved = true;
final.status = 'D/P APPROVED; AWAITING READINESS WINDOW';
final.readiness_approval = 'readiness/APPROVAL.json';
final.root_tracking_this_session = 'Synchronized under owner documentation/evidence commit authority; ISSUE-316 OPEN';
final.next_action = 'Fresh read-only proof at 2026-10-27 02:00–04:00 UTC; no apply/activation/deployment/push';
fs.writeFileSync(path.join(__dirname,'validation/FINAL-PACKAGE-CHECKS.json'),JSON.stringify(final,null,2)+'\n');
console.log(JSON.stringify({ status: approval.status, D: approval.D, P: approval.P, preserved_approved_artifacts: Object.keys(frozen).length, prior_manifest_members: checked, protected_files_unchanged: Object.keys(before).length, proof: 'NOT RUN — window not open' }));
