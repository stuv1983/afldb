'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { inWindow, inspect, parseBoundJSON, approvedInputMap, verifyHelpers, assertHelperBytes } = require('./check-source.cjs');
const root=path.resolve(__dirname,'../../..');
const results=[];
const helperBytes=fs.readFileSync(path.join(__dirname,'check-source.cjs'));
assert.doesNotThrow(()=>assertHelperBytes(helperBytes,Buffer.from(helperBytes),'check-source.cjs'));
results.push({check:'raw helper byte comparison accepts identical frozen bytes',result:'PASS'});
const changedHelper=Buffer.from(helperBytes);changedHelper[0]^=1;
assert.throws(()=>assertHelperBytes(changedHelper,helperBytes,'check-source.cjs'),/differ from declared H/);
results.push({check:'one-byte helper drift refuses without altering working files',result:'PASS'});
assert.throws(()=>verifyHelpers('ffb06267'),/explicit full helper commit/);
results.push({check:'short or implicit helper commit refuses',result:'PASS'});
assert.throws(()=>verifyHelpers('ffb062675ee25650cfc1b4fa6bfe98336a23cc4f'),/complete helper set/);
results.push({check:'administrative anchor without helpers cannot substitute for H',result:'PASS'});
const base='issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/';
const committed=p=>cp.execFileSync('git',['show','ffb062675ee25650cfc1b4fa6bfe98336a23cc4f:'+base+p],{cwd:root});
const approvalBytes=committed('readiness/APPROVAL.json');
assert.equal(parseBoundJSON(approvalBytes,approvalBytes,'approval').P,'def676517da3955aa18db3606785463aac464188');
results.push({check:'exact committed administrative authority bytes accepted',result:'PASS'});
const changedApproval=JSON.parse(approvalBytes);changedApproval.approved_artifact_files['unreviewed-input.json']='0'.repeat(64);
assert.throws(()=>parseBoundJSON(Buffer.from(JSON.stringify(changedApproval)),approvalBytes,'approval'),/drift from committed ADMIN/);
results.push({check:'in-memory authority/allowlist substitution refuses before parsing',result:'PASS'});
const externalBytes=committed('validation/external-inputs.json');
const changedExternal=JSON.parse(externalBytes);changedExternal.files[0].expected_sha256='0'.repeat(64);
assert.throws(()=>parseBoundJSON(Buffer.from(JSON.stringify(changedExternal)),externalBytes,'external'),/drift from committed ADMIN/);
results.push({check:'in-memory external inventory hash substitution refuses',result:'PASS'});
const entries=JSON.parse(externalBytes).files;
assert.equal(approvedInputMap(entries).size,264);
results.push({check:'accepted committed external inventory has 264 unique paths',result:'PASS'});
const duplicate=structuredClone(entries);duplicate[1]=duplicate[0];
assert.throws(()=>approvedInputMap(duplicate),/exactly 264 unique paths/);
results.push({check:'264 entries with a duplicate path refuse',result:'PASS'});
assert.throws(()=>approvedInputMap(entries.slice(1)),/exactly 264 unique paths/);
results.push({check:'short external inventory refuses',result:'PASS'});
for(const [time,expected] of [
  ['2026-10-27T01:59:59.999Z',false],['2026-10-27T02:00:00.000Z',true],
  ['2026-10-27T03:00:00.000Z',true],['2026-10-27T03:59:59.999Z',true],
  ['2026-10-27T04:00:00.000Z',false],['2026-10-28T02:00:00.000Z',false]
]) { assert.equal(inWindow(Date.parse(time)),expected); results.push({check:'pure UTC window boundary '+time,result:'PASS',expected}); }
const invoke=args=> {
  const r=cp.spawnSync(process.execPath,[path.join(__dirname,'check-source.cjs'),...args],{encoding:'utf8'});
  assert.equal(r.status,1);const j=JSON.parse(r.stdout);assert.equal(j.status,'STOP');assert.equal(j.freshness_work_started,false);return j;
};
if(!inWindow(Date.now())) {
  assert.match(invoke(['--opening']).reason,/OUTSIDE APPROVED WINDOW/);
  results.push({check:'actual-clock early/expired opening refuses without starting freshness work',result:'PASS'});
}
assert.match(invoke(['--prepare',root]).reason,/Execution tree is not exact P/);
results.push({check:'administrative descendant cannot substitute for execution P',result:'PASS'});
assert.match(invoke(['--unexpected-mode']).reason,/no proof\/apply execution mode/);
results.push({check:'unknown execution mode refuses; no forwarded command or automatic apply',result:'PASS'});
const execution=path.join(root,'.local-release/issue316-readiness-20261027/execution-P');
assert.equal(inspect(execution,false).result.raw_P_bytes_match,true);
results.push({check:'current source gate passes all raw P blob and source-type checks',result:'PASS'});
assert.equal(cp.execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:execution,encoding:'utf8'}).trim(),'');
results.push({check:'prepared exact-P worktree status is clean',result:'PASS'});
const report={classification:'PRE-WINDOW LOCAL TOOLING CHECKS ONLY — NOT FRESH WINDOW EVIDENCE',checked_at_utc:new Date().toISOString(),checks:results,
  production_contact:false,host_native_proof:'NOT RUN',fresh_censuses:'NOT RUN',enforced_dry_run:'NOT RUN'};
fs.writeFileSync(path.join(__dirname,'LOCAL-CHECKS.json'),JSON.stringify(report,null,2)+'\n');
const files=fs.readdirSync(__dirname).filter(p=>fs.statSync(path.join(__dirname,p)).isFile()&&p!=='SHA256SUMS').sort();
fs.writeFileSync(path.join(__dirname,'SHA256SUMS'),files.map(p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,p))).digest('hex')+'  '+p).join('\n')+'\n');
console.log(JSON.stringify({classification:report.classification,passed:results.length,failed:0,production_contact:false}));
