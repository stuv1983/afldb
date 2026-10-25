// Later local evidence verification. No network, database, cleanup or product writes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
process.chdir(root);
const candidate = 'c438f8449e65c28cf9f00879aaa045131b5f0d3a';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/, ''));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const insist = (ok, why) => { if (!ok) throw new Error(why); };
const local = n => path.join(__dirname, n);
const admission = json(local('U3-ADMISSION-MANIFEST.json'));
const audit = json(local('IGNORED-U3-ADMISSION.json'));
insist(sha(read(local('IGNORED-U3-ADMISSION.json'))) === admission.source_admission_audit_sha256, 'Admission audit changed');
insist(sha(read(local('blind-credential-scan.cjs'))) === admission.scanner_sha256, 'Scanner changed');
insist(admission.files.length === 42 && sha(Buffer.from(JSON.stringify(admission.files))) === admission.candidate_inventory_sha256, 'Blind scan inventory binding changed');
insist(admission.candidate_inventory_sha256 === '5e90c8e7d7cdde45e0f91c3f4ab0421e70ffcffa770a9f45837ef9d46c8ff2bc', 'Wrong accepted inventory');
const staged = git('diff', '--cached', '--name-only', '-z').toString().split('\0').filter(Boolean);
for (const f of admission.files) {
  insist(read(f.path).length === f.size && sha(read(f.path)) === f.sha256, 'Admitted worktree mismatch: ' + f.path);
  insist(sha(git('show', ':' + f.path)) === f.sha256, 'Admitted index mismatch: ' + f.path);
}
const excluded = audit.entries.filter(e => e.disposition === 'EXCLUDED');
insist(excluded.length === 20 && excluded.every(f => !staged.includes(f.path)), 'Excluded file staged');
const material = json(local('U3-MATERIALISATION-VERIFICATION.json'));
for (const f of material.files) insist(sha(read(f.path)) === f.sha256_original_bytes, 'Frozen source changed: ' + f.path);
const committed = json(local('COMMITTED-EVIDENCE.json'));
insist(git('rev-parse', candidate).toString().trim() === candidate, 'Candidate object mismatch');
insist(git('rev-parse', candidate + '^{tree}').toString().trim() === committed.commit_tree, 'Candidate tree mismatch');
for (const f of committed.files) insist(sha(git('cat-file', 'blob', candidate + ':' + f.path)) === f.sha256_committed_blob_bytes, 'Committed blob mismatch: ' + f.path);
insist(sha(read(committed.patch.path)) === committed.patch.sha256, 'Canonical patch changed');
const head = git('rev-parse', 'HEAD').toString().trim();
if (process.argv.includes('--allow-evidence-descendant')) {
  git('merge-base', '--is-ancestor', candidate, 'HEAD');
} else insist(head === candidate, 'HEAD changed before evidence commit');
const allowed = p => ['CHANGELOG.md', 'IssuesIndex.md', 'blockers.md', 'issues.md', 'issues/open/AFLDB-ISSUE-316.md', 'docs/v2/issue316-production-readiness-decision-2026-10-24.md', 'docs/v2/issue316-u3-player-row-evidence-2026-10-24.md'].includes(p) || p.startsWith('issues/open/AFLDB-ISSUE-316-activation-separation-20261025/') || p.startsWith('issues/open/AFLDB-ISSUE-316-u3-correction-20261024/');
const changed = git('diff', '--name-only', candidate, '-z').toString().split('\0').filter(Boolean);
insist([...changed, ...staged].every(allowed), 'Product/assertion or unrelated tracked change');
const linkScope = json(local('CURRENT-VERIFICATION.json')).current_navigation_links.scope;
let linkCount = 0;
for (const p of linkScope) {
  for (const match of read(p).toString().matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    target = decodeURIComponent(target);
    insist(fs.existsSync(path.resolve(path.dirname(p), target)), 'Broken local link: ' + p + ' -> ' + target);
    linkCount++;
  }
}
git('diff', '--check');
git('diff', '--cached', '--check');
const result = {
  verified_at: new Date().toISOString(), implementation_candidate: candidate, head,
  admitted_worktree_and_index_hashes: 42, excluded_staged: 0,
  candidate_inventory_sha256: admission.candidate_inventory_sha256,
  blind_scan_binding: 'PASS: same accepted inventory; no remote scan rerun',
  frozen_source_hashes: material.files.length, committed_blob_hashes: committed.files.length,
  canonical_patch: 'PASS', product_or_assertion_changes: [],
  current_links: { status: 'PASS', count: linkCount, scope: linkScope, limits: 'Local target existence; remote URLs and anchors not checked' },
  diff_check: { cached: 'PASS', worktree: 'PASS' }, staged_count: staged.length,
  status: 'PASS'
};
fs.writeFileSync(local('FINAL-REVERIFICATION.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
