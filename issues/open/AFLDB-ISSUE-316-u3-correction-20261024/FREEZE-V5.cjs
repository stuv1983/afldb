'use strict';
// Freeze metadata-repair-v5: pin the final real-PostgreSQL evidence, write the v4->v5 delta and the manifest.
// Usage: node FREEZE-V5.cjs <validation-evidence-directory-name>. Refuses if a manifest/review/attempt exists.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,v4=path.join(root,'metadata-repair-v4'),v5=path.join(root,'metadata-repair-v5');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const insist=(ok,m)=>{if(!ok)throw Error(m);};
const v4pin='829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84';
insist(sha(fs.readFileSync(path.join(v4,'MANIFEST.json')))===v4pin,'Frozen v4 manifest changed');
const v4m=JSON.parse(fs.readFileSync(path.join(v4,'MANIFEST.json')));
for(const f of v4m.files)insist(sha(fs.readFileSync(path.join(v4,f.path)))===f.sha256,'Frozen v4 member changed '+f.path);
for(const n of ['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json','execution'])insist(!fs.existsSync(path.join(v5,n)),'Refusing: '+n+' already exists');
insist(!fs.readdirSync(v5).some(n=>fs.statSync(path.join(v5,n)).isDirectory()),'Refusing: package contains a directory');
const evName=process.argv[2];insist(/^metadata-repair-v5-validation-[A-Za-z0-9]{6}$/.test(evName||''),'Pass the final validation evidence directory name');
const ev=path.join(root,evName),j=n=>JSON.parse(fs.readFileSync(path.join(ev,n)));
const report=j('PG-VALIDATION.json'),cleanup=j('PG-CLEANUP.json'),transport=j('PG-TRANSPORT.json'),inventory=j('TRANSFER-INVENTORY.json');
insist(report.status==='PASS'&&cleanup.status==='PASS'&&cleanup.evidence_credential_scan==='PASS'&&transport.verdict==='PASS','Validation evidence not PASS');
for(const m of inventory)insist(sha(fs.readFileSync(path.join(v5,m.name)))===m.sha256,'Validated member changed since the real-PostgreSQL run: '+m.name);
insist(JSON.stringify(inventory)===JSON.stringify(transport.submitted_members),'Remote inventory differs from submitted members');
const pglite=JSON.parse(fs.readFileSync(path.join(v5,'VALIDATION.json'))),wrapper=JSON.parse(fs.readFileSync(path.join(v5,'WRAPPER-VALIDATION.json')));
insist(pglite.passed===20&&pglite.results.every(r=>r.status==='PASS'),'PGlite validation incomplete');
insist(wrapper.status==='PASS'&&wrapper.passed===31,'Wrapper validation incomplete');
const dbCases=report.results.filter(r=>r.status==='PASS'&&!/^exact pre-lock ordering/.test(r.name)).length;
fs.writeFileSync(path.join(v5,'VALIDATION-EVIDENCE.json'),JSON.stringify({issue:'AFLDB-ISSUE-316',revision:'metadata-repair-v5',validation_only:true,
  host:'streamanator',ssh_destination:'arm@10.0.40.100',report_status:report.status,real_database_and_transport_cases:dbCases,static_order_checks:1,
  engine:report.engine,cleanup_status:cleanup.status,evidence_credential_scan:cleanup.evidence_credential_scan,
  remote_cluster_directory:report.work_directory,transferred_members:inventory,
  files:fs.readdirSync(ev).sort().map(n=>({path:'../'+evName+'/'+n,sha256:sha(fs.readFileSync(path.join(ev,n)))})),
  pglite_cases:pglite.passed,wrapper_controls:wrapper.passed,
  prior_failed_validation_runs:'metadata-repair-v5-validation-GFhNS5 (harness: CREATE DATABASE in a transaction block; the leak scan caught the fixture-only CREATE ROLE password in that run\'s server log, then fixed by SCRAM verifiers), -HgahMt (probe matched the bash stage), -2RK1Lx and -NABjAE (exact psql environment: platform-added SHLVL/PGSYSCONFDIR). Retained, not pinned.',
  limits:'Synthetic fixture; production identity.sql excluded; psql directives expanded; real transport over private loopback scram-sha-256 with fixture credential. No production transport/live-schema acceptance.',
  standing:'U3 unconfirmed; U4 Route B; Brownlow untouched; production NO-GO.'},null,2)+'\n');
const members=fs.readdirSync(v5).filter(n=>/\.(sql|cjs|json|txt|md|sh)$/.test(n)&&!['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json','V5-DELTA.json'].includes(n)).sort();
const v4map=new Map(v4m.files.map(f=>[f.path,f.sha256]));
const delta=[...new Set([...v4map.keys(),...members])].sort().map(n=>{const a=v4map.get(n)||null,b=members.includes(n)?sha(fs.readFileSync(path.join(v5,n))):null;
  return {path:n,v4_sha256:a,v5_sha256:b,status:a&&b?(a===b?'unchanged':'changed'):a?'removed':'added'};});
fs.writeFileSync(path.join(v5,'V5-DELTA.json'),JSON.stringify({derived_from_v4_manifest_sha256:v4pin,members:delta},null,2)+'\n');
const files=[...members,'V5-DELTA.json'].sort().map(n=>({path:n,sha256:sha(fs.readFileSync(path.join(v5,n)))}));
const manifest=JSON.stringify({version:1,issue:'AFLDB-ISSUE-316',revision:'metadata-repair-v5',derived_from_v4_manifest_sha256:v4pin,files},null,2)+'\n';
fs.writeFileSync(path.join(v5,'MANIFEST.json'),manifest,{flag:'wx'});
const summary={issue:'AFLDB-ISSUE-316',revision:'metadata-repair-v5',frozen_utc:new Date().toISOString(),manifest_sha256:sha(manifest),members:files.length,
  delta:{changed:delta.filter(x=>x.status==='changed').map(x=>x.path),added:delta.filter(x=>x.status==='added').map(x=>x.path),removed:delta.filter(x=>x.status==='removed').map(x=>x.path),
    unchanged:delta.filter(x=>x.status==='unchanged').map(x=>x.path)},
  validation:{real_database_and_transport_cases:dbCases,pglite:pglite.passed,wrapper:wrapper.passed,cleanup:cleanup.status,evidence:evName},
  production_contact:'read-only principal discovery only (../metadata-repair-v5-discovery/)',production_attempt:false,u3_confirmed:false,
  standing:'Review pending. U4 Route B; Brownlow untouched; production NO-GO.'};
fs.writeFileSync(path.join(root,'V5-FREEZE.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
