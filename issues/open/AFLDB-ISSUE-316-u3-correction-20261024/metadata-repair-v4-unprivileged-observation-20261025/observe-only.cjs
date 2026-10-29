'use strict';
// AFLDB-ISSUE-316 v4: replacement separate operational observation (unprivileged, no sudo).
// OBSERVE ONLY. This launcher never invokes `run.cjs execute`, never creates ATTEMPT.json and
// never opens a write-capable production connection. On observation PASS it re-verifies the frozen
// manifest and independent-review pins read-only (`run.cjs verify`) and records the result.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const dir=__dirname,pkg=path.join(dir,'../metadata-repair-v4');
const manifest='829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84',review='39e71a77aa6e26127369647ab2f09a9c25f53af3567567372dc1d86e04a913a2';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const out=path.join(dir,'run-'+stamp);
function insist(b,m){if(!b)throw Error(m)}
function save(n,v){fs.writeFileSync(path.join(out,n),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
function run(){
 fs.mkdirSync(out);
 const rt=JSON.parse(fs.readFileSync(path.join(pkg,'runtime.json')));
 insist(path.resolve(process.execPath).toLowerCase()===path.resolve(rt.node.path).toLowerCase(),'Launcher not running under pinned Node STOP');
 insist(hash(fs.readFileSync(rt.node.path))===rt.node.sha256 && hash(fs.readFileSync(rt.ssh.path))===rt.ssh.sha256,'Runtime changed STOP');
 insist(!fs.existsSync(path.join(pkg,'ATTEMPT.json')),'Prior attempt marker present STOP');
 const script=fs.readFileSync(path.join(dir,'operational-observation-v2.sh'));
 insist(!script.includes(0x0d) && !(script[0]===0xef&&script[1]===0xbb&&script[2]===0xbf),'Observation script must be LF without BOM STOP');
 const self=fs.readFileSync(__filename);
 save('observation-launch.json',{utc:new Date().toISOString(),destination:'afldb',user:'arm',sudo:false,read_only:true,
  script:'operational-observation-v2.sh',script_sha256:hash(script),launcher:'observe-only.cjs',launcher_sha256:hash(self),
  invokes_frozen_execute:false});
 const o=spawnSync(rt.ssh.path,['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','afldb','bash','-s'],{input:script,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
 save('observation.stdout.log',o.stdout||'');save('observation.stderr.log',o.stderr||'');
 save('observation.transport.json',{status:o.status,error:o.error?.code||null,signal:o.signal,finished_utc:new Date().toISOString()});
 const lines=(o.stdout||'').split(/\r?\n/),once=m=>lines.filter(s=>s===m).length===1;
 const stopLine=lines.find(s=>s.startsWith('I316_OBS_STOP '));
 insist(o.status===0&&!o.error&&!o.stderr,'Observation STOP: transport/exit/stderr '+JSON.stringify({status:o.status,error:o.error?.code||null,stderr_bytes:(o.stderr||'').length,stop:stopLine||null}));
 for(const m of ['I316_OBS_HOST=afldb-prod USER=arm','I316_OBS_PS_EXIT 0','UNSAFE_PROCESSES 0','I316_OBS_PROCESS_GATE=PASS','SYSTEMD_RELEVANT_JOBS_CLEAR',
  'SYSTEMD_RELEVANT_TRANSITIONS_CLEAR','SYSTEMD_AFLDB_JOB_UNITS_IDLE','I316_OBS_SERVICE_GATE=PASS','I316_OBS_DEPLOY_MARKERS_CLEAR',
  'I316_OBS_DB_CONNECTION user=afldb_backup database=afldb_prod','I316_OBS_DB_GATE=PASS','I316_OBS_DB_EXIT 0','I316_OBS_DECISION=PASS'])
  insist(once(m),'Observation STOP: missing/duplicate marker '+m);
 insist(!lines.some(s=>s.startsWith('UNSAFE_PROCESS ')||s.startsWith('PS_MALFORMED_ROW')),'Observation STOP: unsafe/malformed process row');
 const get=p=>{const a=lines.filter(s=>s.startsWith(p));insist(a.length===1,'Observation STOP: missing/duplicate '+p);return JSON.parse(a[0].slice(p.length));};
 const identity=get('I316_OBS_DB_IDENTITY='),db=get('I316_OBS_DB=');
 insist(identity.database==='afldb_prod'&&identity.user==='afldb_backup'&&String(identity.oid)==='66668'&&identity.system_identifier==='7674454702926115004'&&identity.read_only==='on','Observation STOP: identity');
 const counts=['ddl_sessions','idle_in_transaction_sessions','tooling_application_sessions','schema_class_relation_locks','prepared_transactions','progress_create_index','progress_cluster','progress_copy_not_to','progress_manual_vacuum'];
 for(const k of counts)insist(db[k]===0,'Observation STOP: '+k+'='+db[k]);
 insist(db.superuser||db.read_all_stats||db.update_process_title==='on','Observation STOP: database visibility inadequate');
 save('OBSERVATION-RESULT.json',{status:'PASS',utc:new Date().toISOString(),host:'afldb-prod',user:'arm',sudo_used:false,identity,database:db,
  scope:'Bounded point-in-time observation; no future-work exclusion claimed.'});
 // Owner step 1 (read-only): reverify frozen manifest and independent-review pins.
 const v=spawnSync(rt.node.path,[path.join(pkg,'run.cjs'),'verify',manifest],{encoding:'utf8',windowsHide:true,timeout:60000});
 const r=JSON.parse(fs.readFileSync(path.join(pkg,'REVIEW.json')));
 const pins={verify_status:v.status,verify_stdout:(v.stdout||'').trim(),verify_stderr:v.stderr||'',review_json_sha256:hash(fs.readFileSync(path.join(pkg,'REVIEW.json'))),
  review_md_sha256:hash(fs.readFileSync(path.join(pkg,'REVIEW.md'))),verdict:r.verdict,stopping_findings:r.stopping_findings,review_manifest_sha256:r.manifest_sha256,utc:new Date().toISOString()};
 pins.status=(v.status===0&&!v.error&&pins.verify_stdout==='PACKAGE_HASHES_PASS'&&!v.stderr&&pins.review_json_sha256===review&&r.verdict==='GO'
  &&r.stopping_findings===0&&r.manifest_sha256===manifest&&pins.review_md_sha256===r.report_sha256)?'PASS':'STOP';
 save('PIN-REVERIFY.json',pins);
 insist(pins.status==='PASS','Frozen package/review pin reverify STOP');
 console.log('OBSERVATION_PASS; PIN_REVERIFY_PASS; frozen execute NOT invoked by this launcher');
}
try{run()}catch(e){try{save('OBSERVATION-STOP.json',{utc:new Date().toISOString(),reason:e.message,automatic_retry:false});}catch{}console.error(e.message);process.exitCode=1}
finally{try{const files=fs.readdirSync(out).sort().map(n=>({path:n,sha256:hash(fs.readFileSync(path.join(out,n)))}));fs.writeFileSync(path.join(out,'EVIDENCE-HASHES.json'),JSON.stringify(files,null,2)+'\n',{flag:'wx'});console.log('EVIDENCE_DIR='+out);}catch{}}
