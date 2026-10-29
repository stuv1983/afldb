// Refresh only documentation/evidence inventory after the owner's readiness approval.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const rel = path.relative(root, __dirname).replaceAll('\\','/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const load = p => JSON.parse(fs.readFileSync(path.join(__dirname,p)));
const put = (p,v) => fs.writeFileSync(path.join(__dirname,p),JSON.stringify(v,null,2)+'\n');
const approval = load('readiness/APPROVAL.json');
for (const [p,h] of Object.entries(approval.approved_artifact_files)) if (sha(fs.readFileSync(path.join(__dirname,p))) !== h) throw Error('Approved artifact changed: ' + p);
const review = load('validation/restatement-repair/REVIEW.json');
for (const [p,h] of Object.entries(review.reviewed_files)) if (sha(fs.readFileSync(path.join(__dirname,p))) !== h) throw Error('Reviewed assertion/map changed: ' + p);
const protectedFiles = load('validation/restatement-repair/protected-before.json');
for (const [p,h] of Object.entries(protectedFiles)) if (sha(fs.readFileSync(path.join(root,p))) !== h) throw Error('Accepted source/structural drift: ' + p);
const git = args => cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const head = git(['rev-parse','HEAD']);
const productDiff = git(['diff','--name-only',approval.P,'--','src','packages','tools','tests','data/reference','deploy']);
if (productDiff) throw Error('Product/accepted-test change: ' + productDiff);
const tracking = ['CHANGELOG.md','IssuesIndex.md','issues.md','blockers.md','docs/v2/issue316-production-readiness-decision-2026-10-24.md','issues/open/AFLDB-ISSUE-316.md',
  ...['CURRENT-VERIFICATION.json','FINAL-REVERIFICATION.json','LOCAL-GATE.md','SESSION-CHANGES.json','STRUCTURAL-CLOSURE.json'].map(p=>'issues/open/AFLDB-ISSUE-316-activation-separation-20261025/'+p)];
const check = { verified_at_utc: new Date().toISOString(), D: approval.D, P: approval.P, local_HEAD_before_documentation_commit: head,
  documentation_HEAD_does_not_become_P: true, approved_artifacts_unchanged: Object.keys(approval.approved_artifact_files).length,
  accepted_source_test_structural_hashes_unchanged: Object.keys(protectedFiles).length, reviewed_preview_map_hashes_unchanged: Object.keys(review.reviewed_files).length,
  product_or_accepted_test_changes_from_P: [], fresh_proof: 'NOT RUN; await approved day-D window', production: 'NO-GO',
  authorised_commit_scope: tracking, unrelated_codex_directory: 'excluded / untouched', push: false };
put('readiness/LOCAL-DOCUMENTATION-CHECK.json',check);
const final = load('validation/FINAL-PACKAGE-CHECKS.json');
final.Git_commands = 'Owner-authorised read-only local inspection and separate local documentation/evidence commit; no push';
final.approval_recorded_at_utc = approval.recorded_at_utc;
final.readiness_status = 'readiness/STATUS.json';
put('validation/FINAL-PACKAGE-CHECKS.json',final);
function filesIn(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=> {
    if (['simulations','simulation-objects','__pycache__'].includes(e.name)||e.name.startsWith('simulation.index')) return [];
    const p=path.join(dir,e.name);
    return e.isDirectory()?filesIn(p):e.isFile()?[p]:[];
  });
}
const all=filesIn(__dirname).filter(p=>!['CHANGED-FILES.json','SHA256SUMS'].includes(path.basename(p))).sort();
const changed=load('CHANGED-FILES.json');
const prior = new Map(changed.proposal_files.map(f=>[f.path,f.sha256]));
changed.proposal_files=all.map(p=>({path:path.relative(root,p).replaceAll('\\','/'),sha256:sha(fs.readFileSync(p))}));
changed.owner_readiness_approval_session={D:approval.D,P:approval.P,approval:'readiness/APPROVAL.json',readiness_status:'readiness/STATUS.json',
  changed_or_added_package_files:changed.proposal_files.filter(f=>prior.get(f.path)!==f.sha256),synchronized_tracking_and_prior_closure_files:tracking,
  local_documentation_commit:'authorised; its HEAD is not P',production:'NO-GO',product_test_or_structural_edits:false};
put('CHANGED-FILES.json',changed);
const members=[...all,path.join(__dirname,'CHANGED-FILES.json')].sort();
const sums=members.map(p=>sha(fs.readFileSync(p))+'  '+path.relative(__dirname,p).replaceAll('\\','/')).join('\n')+'\n';
fs.writeFileSync(path.join(__dirname,'SHA256SUMS'),sums);
for(const line of sums.trim().split('\n')) { const [,h,p]=/^([a-f0-9]{64})  (.+)$/.exec(line); if(sha(fs.readFileSync(path.join(__dirname,p)))!==h)throw Error('Final hash mismatch '+p); }
// Exact paths for a documentation-only commit; no recursive directory admission.
const paths=[...tracking,...members.map(p=>path.relative(root,p).replaceAll('\\','/')),rel+'/SHA256SUMS'].sort();
const admission=path.join(root,'.local-release/issue316-dp-documentation-admission.nul');
fs.writeFileSync(admission,paths.join('\0')+'\0');
console.log(JSON.stringify({D:approval.D,P:approval.P,source_HEAD:head,manifest_members:members.length,manifest_sha256:sha(Buffer.from(sums)),commit_paths:paths.length,admission_file:path.relative(root,admission).replaceAll('\\','/'),approved_artifacts_unchanged:check.approved_artifacts_unchanged,product_test_changes:0,fresh_proof:'NOT RUN — approved window not open'}));
