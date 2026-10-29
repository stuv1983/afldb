'use strict';
// Candidate snapshot/tracking only. Not a production or validation executor.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,repo=path.resolve(base,'../../..'),dir=path.join(base,'metadata-repair-v4');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>fs.writeFileSync(p,s);
for(const rev of ['v2','v3']){
 const d=path.join(base,'metadata-repair-'+rev),m=JSON.parse(read(path.join(d,'MANIFEST.json')));
 for(const f of m.files)if(sha(fs.readFileSync(path.join(d,f.path)))!==f.sha256)throw Error('Frozen '+rev+' mismatch '+f.path);
}
const title='  - **F-005 owner scope clarification / v4 prepared (2026-10-25; current).**';
const detail=`
    F-005 accepted against the prior v3 contract: **Resolved by owner scope clarification, subject to v4
    proving detection and isolation under the revised contract.** V2/v3 remain frozen and unexecuted.
    V4 removes catalog locks/absence exclusion; existing protected-data locks and unchanged two-write body
    remain strict. Optional presence/schema is observed internally and postcommit; drift blocks U3 without
    retry/reversal. Added bounded operational DDL/deployment and expected migration-110 guards.
    Static ordering PASS; inherited PGlite16 plus three drift cases **19/19 PASS**; wrapper **14/14 PASS**.
    Real PostgreSQL timing validation is prepared but blocked by automatic approval review of source transfer
    to arm@10.0.40.100 (streamanator); explicit destination approval requested. No fresh GO or final freeze.
    No production contact/attempt/write. **Next:** authorise that isolated validation transfer, run real tests,
    then freeze exact v4 bytes and commission fresh independent review. U3 unconfirmed; U4 Route B;
    Brownlow untouched; production NO-GO. No census/rollover/activation/apply/deploy/rebuild/push.
`;
for(const [name,link] of [['IssuesIndex.md','issues/open/'],['issues.md','issues/open/'],['issues/open/AFLDB-ISSUE-316.md','']]){
 const p=path.join(repo,name);let s=read(p);
 const old='  - **F-004 repaired in frozen v3; new F-005 MED stops execution (2026-10-25; current).**';
 const at=s.indexOf(old);if(at<0)throw Error('Tracking anchor missing '+name);
 const target=link+'AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V4-RECORD.md';
 s=s.slice(0,at)+title+detail+`    [V4 record](${target}).\n`+s.slice(at).replace(old,'  - **Historical frozen-v3 review (2026-10-25; scope ruling supersedes F-005 disposition).**');
 // Only the exact old current-next-action sentence; preserve v3 review as evidence.
 s=s.replace('    **Next:** owner adjudication of F-005; no further revision, retry or production action inferred.',
   '    Historical next action was owner adjudication; the v4 scope ruling above now governs.');
 if(name==='issues.md'){
   const start=s.indexOf('| AFLDB-ISSUE-316 |'),end=s.indexOf('\n',start);
   if(start<0)throw Error('Open row missing');
   const row=s.slice(start,end).replace('**Metadata gate 2026-10-25 (current): v3 independent review NO-GO, F-005 MED','**Metadata gate 2026-10-25 (historical v3): independent review NO-GO, F-005 MED');
   const update=' **Current v4 owner scope ruling:** F-005 resolved by scope clarification subject to v4 detection/isolation proof. V4 candidate prepared; static/PGlite19/wrapper14 PASS; real PostgreSQL validation blocked pending explicit approval of transfer to arm@10.0.40.100. Fresh review/final freeze/execution pending; no production action; U3 unconfirmed, U4 Route B, production NO-GO. ';
   s=s.slice(0,start)+row.replace(/\|\s*$/,update+'|')+s.slice(end);
 }
 write(p,s);
}
const bp=path.join(repo,'blockers.md');let bs=read(bp);const first=bs.indexOf('> **Scoped update'),last=bs.indexOf('> **Navigation aid');
if(first<0||last<0)throw Error('Blocker anchors');
write(bp,bs.slice(0,first)+`> **Scoped update 2026-10-25 — ISSUE-316/U3:** F-005 resolved by owner scope clarification,
> subject to v4 proving detection/isolation. V2/v3 frozen/unexecuted. V4 candidate: static PASS,
> PGlite19/19 and wrapper14/14 PASS; required real PostgreSQL timing tests prepared but blocked on
> explicit approval of source transfer to arm@10.0.40.100 (streamanator), rejected by auto-review.
> Final freeze/fresh exact-byte review/production gates pending. No production contact/attempt/write.
> U3 unconfirmed; U4 Route B; Brownlow untouched; production NO-GO. No retry or reversal.
> [V4 record](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V4-RECORD.md).

`+bs.slice(last));
const cp=path.join(repo,'CHANGELOG.md');let cs=read(cp);const anchor='## [Unreleased]';
write(cp,cs.replace(anchor,anchor+`

### ISSUE-316 metadata repair v4 scope clarification (2026-10-25)

- Prepared separately hashed v4 candidate under the owner's narrowed F-005 contract: removed broad catalog
  locks, retained existing-data lock ordering and unchanged two-write body, added optional schema observation/
  postcommit drift classification and bounded operational schema/version guards. U3 cannot pass on drift;
  no automatic retry/reversal. Local PGlite19/19, wrapper14/14 and static ordering pass. Real PostgreSQL timing
  tests and fresh independent review remain pending; source transfer requires explicit destination approval.
  V2/v3 unchanged/unexecuted; no production action or broader readiness authority.
`));
const names=fs.readdirSync(dir).filter(n=>!['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json'].includes(n)).sort();
const m={version:1,issue:'AFLDB-ISSUE-316',revision:'metadata-repair-v4',derived_from_v3_manifest_sha256:sha(fs.readFileSync(path.join(base,'metadata-repair-v3/MANIFEST.json'))),files:names.map(n=>({path:n,sha256:sha(fs.readFileSync(path.join(dir,n)))}))};
write(path.join(dir,'MANIFEST.json'),JSON.stringify(m,null,2)+'\n');
write(path.join(base,'V4-STATE.json'),JSON.stringify({state:'CANDIDATE_AWAITING_REAL_POSTGRESQL_VALIDATION_AND_FRESH_REVIEW',manifest_sha256:sha(fs.readFileSync(path.join(dir,'MANIFEST.json'))),local_validation:{pglite:19,wrapper:14,static:'PASS'},production_contact:false,production_attempt:false,u3_confirmed:false,blocker:'Automatic approval review rejected source transfer to arm@10.0.40.100; explicit user approval requested',next:'Approve exact validation destination/transfer, run isolated PostgreSQL tests, freeze and fresh-context review before any production connection'},null,2)+'\n');
const changed=['IssuesIndex.md','issues.md','issues/open/AFLDB-ISSUE-316.md','blockers.md','CHANGELOG.md'];
const relative=p=>path.relative(repo,p).split(path.sep).join('/');
for(const n of ['PREPARE-V4.cjs','PATCH-V4.cjs','TRACK-V4.cjs','METADATA-REPAIR-V4-RECORD.md','V4-STATE.json'])changed.push(relative(path.join(base,n)));
for(const n of fs.readdirSync(dir))changed.push(relative(path.join(dir,n)));
const inventory='SESSION-FILES.metadata-repair-v4.json';
for(const n of [inventory,'SHA256SUMS.before-metadata-repair-v4','SHA256SUMS'])changed.push(relative(path.join(base,n)));
write(path.join(base,inventory),JSON.stringify({scope:'All repository files created/edited by this v4 task; no Git operations',files:changed.sort()},null,2)+'\n');
fs.copyFileSync(path.join(base,'SHA256SUMS'),path.join(base,'SHA256SUMS.before-metadata-repair-v4'),fs.constants.COPYFILE_EXCL);
const all=[];function walk(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())walk(p);else if(p!==path.join(base,'SHA256SUMS'))all.push(p);}}
walk(base);write(path.join(base,'SHA256SUMS'),all.sort().map(p=>sha(fs.readFileSync(p))+'  '+path.relative(base,p).split(path.sep).join('/')).join('\n')+'\n');
console.log(JSON.stringify({candidate_manifest:sha(fs.readFileSync(path.join(dir,'MANIFEST.json'))),members:names.length,changed_files:changed.length}));
