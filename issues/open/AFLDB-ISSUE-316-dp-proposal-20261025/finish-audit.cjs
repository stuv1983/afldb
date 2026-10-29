// Bounded final audit and file inventory. No staging, commits, network or database.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const rel = path.relative(root, __dirname).replaceAll('\\', '/');
const P = 'def676517da3955aa18db3606785463aac464188';
const candidate = 'c438f8449e65c28cf9f00879aaa045131b5f0d3a';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const git = (...args) => cp.execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const insist = (v, why) => { if (!v) throw Error(why); };
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname, p)));
insist(git('rev-parse', 'HEAD').toString().trim() === P && git('rev-parse', 'HEAD^').toString().trim() === candidate, 'HEAD ancestry changed');
insist(git('diff', '--cached', '--name-only').length === 0, 'Unexpected staged files');
const tracked = new Set(git('ls-tree', '-r', '--name-only', '-z', P).toString().split('\0').filter(Boolean));
const audit = JSON.parse(fs.readFileSync(path.join(root, 'issues/open/AFLDB-ISSUE-316-activation-separation-20261025/IGNORED-U3-ADMISSION.json')));
insist(audit.entries.filter(e => e.disposition === 'EXCLUDED').every(e => !tracked.has(e.path)), 'Excluded file committed');
const source = path.join(root, load('SOURCE-P.json').source_root);
let sourceCount = 0;
for (const entry of git('ls-tree', '-r', '-z', P).toString().split('\0').filter(Boolean)) {
  const m = /^(\d+) blob ([0-9a-f]+)\t(.*)$/.exec(entry); if (!m) continue;
  const p = path.join(source, m[3]);
  const b = m[1] === '120000' ? Buffer.from(fs.readlinkSync(p)) : fs.readFileSync(p);
  const oid = crypto.createHash('sha1').update(Buffer.from('blob ' + b.length + '\0')).update(b).digest('hex');
  insist(oid === m[2], 'Source P changed: ' + m[3]); sourceCount++;
}
for (const f of load('validation/fixture-inputs.json').files) {
  insist(sha(fs.readFileSync(path.join(root, f.path))) === f.sha256, 'Original retained input changed: ' + f.path);
  insist(sha(fs.readFileSync(path.join(source, f.path))) === f.sha256, 'Copied input changed: ' + f.path);
}
const pins = load('PIN-TABLE.json');
insist(sha(fs.readFileSync(path.join(__dirname, 'transition-change-set.json'))) === pins.new_change_set_sha256, 'Change-set digest');
for (const f of pins.files) insist(sha(fs.readFileSync(path.join(__dirname, 'finals', f.path))) === f.proposed_final_sha256, 'Final pin: ' + f.path);
let links = 0;
for (const p of [path.join(__dirname, 'PROPOSAL.md'), path.join(root, 'issues/open/AFLDB-ISSUE-316-activation-separation-20261025/LOCAL-GATE.md')]) {
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    insist(fs.existsSync(path.resolve(path.dirname(p), decodeURIComponent(target))), 'Broken current link: ' + target); links++;
  }
}
git('diff', '--check'); git('diff', '--cached', '--check');
const result = { verified_at: new Date().toISOString(), implementation_candidate: candidate, evidence_tracking_commit: P,
  source_P_tracked_files_unchanged: sourceCount, original_fixture_files_unchanged: load('validation/fixture-inputs.json').files.length,
  excluded_files_committed_or_staged: 0, staged_paths: 0, current_local_links: links,
  diff_check: { worktree: 'PASS', cached: 'PASS' }, status: 'PASS',
  structural_gate: 'CLOSED / ACCEPTED', proposal: 'PARTIAL / NOT EXECUTION-READY', production: 'NO-GO' };
fs.writeFileSync(path.join(__dirname, 'validation/FINAL-PACKAGE-CHECKS.json'), JSON.stringify(result, null, 2) + '\n');
function filesIn(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['simulations', 'simulation-objects'].includes(e.name) || e.name.startsWith('simulation.index')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesIn(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}
const paths = filesIn(__dirname).filter(p => !['CHANGED-FILES.json', 'SHA256SUMS'].includes(path.basename(p))).sort();
const postCommitChanged = git('diff', '--name-only', '-z').toString().split('\0').filter(Boolean);
const committedEvidence = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', P).toString().split('\0').filter(Boolean);
const record = { classification: 'Complete evidence commit membership plus post-commit authored/generated proposal and tracking files; no product checkout edits',
  implementation_candidate: candidate, evidence_tracking_commit: P, evidence_commit_files: committedEvidence,
  post_commit_changed_tracking_files: postCommitChanged,
  proposal_files: paths.map(p => ({ path: path.relative(root, p).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(p)) })),
  separate_closure_receipt: 'issues/open/AFLDB-ISSUE-316-activation-separation-20261025/STRUCTURAL-CLOSURE.json',
  generated_validation_copies: { root: '.local-release/issue316-dp-20261025', source_commit: P,
    source_P_files: sourceCount, fixture_inventory: rel + '/validation/fixture-inputs.json',
    state_B_C: 'Excluded generated copies with proposed restatement overlays; no real branch/index/checkout changes' },
  self: rel + '/CHANGED-FILES.json', self_hash_omitted: true,
};
fs.writeFileSync(path.join(__dirname, 'CHANGED-FILES.json'), JSON.stringify(record, null, 2) + '\n');
const sums = [...paths, path.join(__dirname, 'CHANGED-FILES.json')].sort().map(p => sha(fs.readFileSync(p)) + '  ' + path.relative(__dirname, p).replaceAll('\\', '/')).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'SHA256SUMS'), sums);
console.log(JSON.stringify({ ...result, proposal_files: paths.length + 2, evidence_commit_files: committedEvidence.length, post_commit_changed_tracking_files: postCommitChanged.length }));
