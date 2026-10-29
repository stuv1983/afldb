'use strict';
// No database library, DSN, credential, application environment, browser, or automatic retry.
// This wrapper never reads a credential: transport.sh reads the existing protected one on the host.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dir = __dirname;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(dir,name));
function insist(ok,message) { if (!ok) throw new Error(message); }
// Pinned principal and endpoint: AFLDB_PROD_DATABASE_URL is the established production migration DSN (afldb_owner).
const PRODUCTION=['/home/arm/projects/afldb/.env','AFLDB_PROD_DATABASE_URL','afldb_owner','localhost','5432','afldb_prod'];
const TRANSPORT_PASS=mode=>'I316_TRANSPORT_PREREQUISITES_PASS mode='+mode+' user=afldb_owner host=localhost port=5432 database=afldb_prod';
function manifest(expected) {
  const raw=read('MANIFEST.json');
  insist(/^[a-f0-9]{64}$/.test(expected) && sha(raw)===expected,'Manifest pin mismatch');
  const m=JSON.parse(raw);
  insist(Array.isArray(m.files) && m.files.length>10,'Incomplete manifest');
  const seen=new Set();
  for (const entry of m.files) {
    insist(/^[a-zA-Z0-9_.-]+$/.test(entry.path) && !seen.has(entry.path),'Invalid/duplicate member');
    seen.add(entry.path);
    const file=path.join(dir,entry.path), stat=fs.lstatSync(file);
    insist(stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1,'Nonregular manifest member');
    insist(sha(read(entry.path))===entry.sha256,'Artifact hash mismatch: '+entry.path);
  }
  for(const name of fs.readdirSync(dir)) if (/\.(sql|cjs|json|txt|md|sh)$/.test(name)
    && !['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json'].includes(name))
    insist(seen.has(name),'Unmanifested package/input: '+name);
  for(const name of ['run.cjs','binding.json','note.txt','OWNER-RULING.md','preflight.sql','repair.sql','postcheck.sql','identity.sql','principal.sql',
    'operational-host.sh','operational-observation.sh','transport.sh','expected-migrations.json'])
    insist(seen.has(name),'Missing required member '+name);
  return {m,seen};
}
function expand(name,seen,stack=[]) {
  insist(seen.has(name) && !stack.includes(name),'Unbound/circular SQL include');
  return read(name).toString('utf8').replace(/^\\ir ([a-z-]+\.sql)\s*$/gm,
    (_,child)=>expand(child,seen,[...stack,name]));
}
function settings(binding,manifestPin,reviewPin) {
  const note=read('note.txt');
  insist(note.length===967 && sha(note)==='3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d','Note raw hash/length mismatch');
  insist(binding.note===note.toString('utf8'),'Binding note differs from input');
  insist(binding.approval_sha256===sha(read('OWNER-RULING.md')),'Approval reference mismatch');
  const q=s=>"'"+s.replace(/'/g,"''")+"'";
  return Object.entries({'afldb.i316.binding':JSON.stringify(binding),
    'afldb.i316.approval_sha256':sha(read('OWNER-RULING.md')),
    'afldb.i316.expected_migrations':JSON.stringify(JSON.parse(read('expected-migrations.json')).rows),
    'afldb.i316.manifest_sha256':manifestPin,'afldb.i316.review_sha256':reviewPin})
    .map(([k,v])=>`SELECT set_config(${q(k)},${q(v)},false) AS configured \\gset`).join('\n')+'\n';
}
// One remote bash -c script: host gate, then transport. The SQL is psql stdin, never shell source.
function remoteScript(mode) {
  insist(['prerequisite','execute'].includes(mode),'Invalid transport mode');
  return read('operational-host.sh').toString('utf8')+'\n'+read('transport.sh').toString('utf8')+'\ni316_transport '+mode+' '+PRODUCTION.join(' ')+'\n';
}
const shellQuote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function ssh(runtime,args,input,timeout) {
  return spawnSync(runtime.ssh.path,['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','afldb',...args],
    {input,encoding:'utf8',maxBuffer:32*1024*1024,timeout,windowsHide:true});
}
const linesOf=text=>(text||'').split(/\r?\n/);
function single(lines,prefix,label) {
  const found=lines.filter(line=>line.startsWith(prefix));
  insist(found.length===1,label+': missing/duplicate '+prefix);
  return JSON.parse(found[0].slice(prefix.length));
}
function ordered(output,markers) {
  let last=-1;
  return markers.every(marker=>{const at=output.indexOf(marker,last+1); if(at<0)return false; last=at; return true;});
}
// Step 2: fresh no-sudo observation (byte copy of the replacement observation that passed on production).
function observe(runtime,save) {
  const script=read('operational-observation.sh');
  insist(!script.includes(0x0d) && !(script[0]===0xef&&script[1]===0xbb&&script[2]===0xbf),'Observation script must be LF without BOM');
  const o=ssh(runtime,['bash','-s'],script,120000);
  save('observation.stdout.log',o.stdout||''); save('observation.stderr.log',o.stderr||'');
  save('observation.transport.json',{status:o.status,error:o.error?.code||null,signal:o.signal});
  const lines=linesOf(o.stdout), once=m=>lines.filter(s=>s===m).length===1;
  insist(o.status===0 && !o.error && !o.stderr,'Observation STOP: transport/exit/stderr');
  for(const m of ['I316_OBS_HOST=afldb-prod USER=arm','I316_OBS_PS_EXIT 0','UNSAFE_PROCESSES 0','I316_OBS_PROCESS_GATE=PASS','SYSTEMD_RELEVANT_JOBS_CLEAR',
    'SYSTEMD_RELEVANT_TRANSITIONS_CLEAR','SYSTEMD_AFLDB_JOB_UNITS_IDLE','I316_OBS_SERVICE_GATE=PASS','I316_OBS_DEPLOY_MARKERS_CLEAR',
    'I316_OBS_DB_CONNECTION user=afldb_backup database=afldb_prod','I316_OBS_DB_GATE=PASS','I316_OBS_DB_EXIT 0','I316_OBS_DECISION=PASS'])
    insist(once(m),'Observation STOP: missing/duplicate marker '+m);
  insist(!lines.some(s=>s.startsWith('UNSAFE_PROCESS ')||s.startsWith('PS_MALFORMED_ROW')||s.startsWith('I316_OBS_STOP')),'Observation STOP: unsafe/malformed/stop row');
  const identity=single(lines,'I316_OBS_DB_IDENTITY=','Observation STOP'), db=single(lines,'I316_OBS_DB=','Observation STOP');
  insist(identity.database==='afldb_prod' && identity.user==='afldb_backup' && String(identity.oid)==='66668'
    && identity.system_identifier==='7674454702926115004' && identity.read_only==='on','Observation STOP: identity');
  for(const k of ['ddl_sessions','idle_in_transaction_sessions','tooling_application_sessions','schema_class_relation_locks','prepared_transactions',
    'progress_create_index','progress_cluster','progress_copy_not_to','progress_manual_vacuum'])
    insist(db[k]===0,'Observation STOP: '+k);
  insist(db.superuser || db.read_all_stats || db.update_process_title==='on','Observation STOP: database visibility inadequate');
  return {status:'PASS',identity};
}
// Steps 3-5: transport prerequisites, identity/principal connection and the exact read-only preflight.
// Session is read-only (default_transaction_read_only=on plus the READ ONLY preflight transaction).
function prerequisite(runtime,binding,manifestPin,reviewPin,seen,save) {
  const sql='\\set ON_ERROR_STOP on\n'+settings(binding,manifestPin,reviewPin)+expand('preflight.sql',seen)
    +'\n\\echo I316_PREREQUISITE_READ_ONLY_PREFLIGHT_COMPLETE\n';
  insist(!/\b(UPDATE|INSERT|DELETE)\s+(INTO\s+)?public\.data_edits\b|SERIALIZABLE|\bLOCK TABLE\b/.test(sql),'Prerequisite SQL is not read-only preflight');
  save('submitted.sql',sql);
  const r=ssh(runtime,['bash','-c',shellQuote(remoteScript('prerequisite'))],sql,1200000);
  save('prerequisite.stdout.log',r.stdout||''); save('prerequisite.stderr.log',r.stderr||'');
  save('prerequisite.transport.json',{status:r.status,error:r.error?.code||null,signal:r.signal});
  const output=r.stdout||'', lines=linesOf(output), once=m=>lines.filter(s=>s===m).length===1;
  insist(r.status===0 && !r.error,'Prerequisite STOP: transport/exit');
  insist(!lines.some(s=>/^I316_(TRANSPORT|OPERATIONAL_HOST)_STOP /.test(s)),'Prerequisite STOP: gate refused');
  for(const m of ['I316_OPERATIONAL_HOST_GATE_PASS',TRANSPORT_PASS('prerequisite'),'I316_OPERATIONAL_DATABASE_GATE_PASS','I316_PREREQUISITE_READ_ONLY_PREFLIGHT_COMPLETE'])
    insist(once(m),'Prerequisite STOP: missing/duplicate marker '+m);
  const identity=single(lines,'I316_IDENTITY=','Prerequisite STOP'), principal=single(lines,'I316_PRINCIPAL=','Prerequisite STOP');
  const visibility=single(lines,'I316_OPERATIONAL_VISIBILITY=','Prerequisite STOP');
  single(lines,'I316_PREFLIGHT=','Prerequisite STOP');
  insist(identity.database==='afldb_prod' && identity.user==='afldb_owner' && String(identity.oid)==='66668'
    && identity.system_identifier==='7674454702926115004' && identity.read_only==='on','Prerequisite STOP: identity');
  insist(principal.session_user==='afldb_owner' && principal.current_user==='afldb_owner' && principal.superuser===false
    && principal.database_owner==='afldb_owner' && principal.read_only==='on','Prerequisite STOP: principal');
  insist(visibility.superuser || visibility.read_all_stats || visibility.update_process_title==='on','Prerequisite STOP: visibility');
  insist(ordered(output,['I316_OPERATIONAL_HOST_GATE_PASS',TRANSPORT_PASS('prerequisite'),'I316_IDENTITY=','I316_PRINCIPAL=',
    'I316_OPERATIONAL_DATABASE_GATE_PASS','I316_PREFLIGHT=','I316_PREREQUISITE_READ_ONLY_PREFLIGHT_COMPLETE']),'Prerequisite STOP: marker order');
  return {status:'PASS',identity,principal,visibility};
}
function main() {
  const [mode,manifestPin,reviewPin]=process.argv.slice(2);
  insist(['verify','prerequisite','execute'].includes(mode),'Usage: node run.cjs verify|prerequisite|execute MANIFEST_SHA256 [REVIEW_JSON_SHA256]');
  // Step 1: package and review pins.
  const {seen}=manifest(manifestPin);
  const binding=JSON.parse(read('binding.json'));
  const runtime=JSON.parse(read('runtime.json'));
  insist(path.resolve(process.execPath).toLowerCase()===path.resolve(runtime.node.path).toLowerCase()
    && sha(fs.readFileSync(process.execPath))===runtime.node.sha256,'Node runtime pin mismatch');
  insist(sha(fs.readFileSync(runtime.ssh.path))===runtime.ssh.sha256,'SSH runtime pin mismatch');
  if(mode==='verify') { settings(binding,manifestPin,'0'.repeat(64)); console.log('PACKAGE_HASHES_PASS'); return; }
  insist(/^[a-f0-9]{64}$/.test(reviewPin) && sha(read('REVIEW.json'))===reviewPin,'Independent review pin mismatch');
  const review=JSON.parse(read('REVIEW.json'));
  insist(review.verdict==='GO' && review.stopping_findings===0 && review.manifest_sha256===manifestPin
    && review.report_sha256===sha(read('REVIEW.md')),'Review gate did not pass');
  // A consumed attempt refuses before any production contact.
  insist(!fs.existsSync(path.join(dir,'ATTEMPT.json')),'Execution attempt already consumed: no relaunch; owner adjudication required');
  const executionDir=path.join(dir,'execution');
  insist(!fs.existsSync(executionDir),'Execution evidence already exists: no relaunch');
  // Pre-boundary evidence: a new directory per run. Failures here consume no attempt.
  const out=path.join(dir,'prerequisite-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z'));
  fs.mkdirSync(out);
  const save=(name,value)=>fs.writeFileSync(path.join(out,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const evidenceHashes=()=>{const files=fs.readdirSync(out).sort().filter(n=>n!=='EVIDENCE-HASHES.json').map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(out,name)))}));
    fs.writeFileSync(path.join(out,'EVIDENCE-HASHES.json'),JSON.stringify(files,null,2)+'\n',{flag:'wx'});return sha(JSON.stringify(files));};
  let prior;
  try {
    const observation=observe(runtime,save);
    const pre=prerequisite(runtime,binding,manifestPin,reviewPin,seen,save);
    prior={status:'PASS',mode,observation,prerequisite:pre,attempt_consumed:false,utc:new Date().toISOString()};
    save('PREREQUISITE-RESULT.json',prior);
  } catch(error) {
    save('PREREQUISITE-STOP.json',{status:'STOP',reason:error.message,attempt_consumed:false,automatic_retry:false,utc:new Date().toISOString()});
    evidenceHashes();
    throw new Error(error.message+' (before the single-use boundary: no attempt consumed, no write-capable session opened)');
  }
  const priorEvidence=evidenceHashes();
  if(mode==='prerequisite') { console.log('PREREQUISITE_PASS; no attempt consumed; write transaction NOT invoked'); return; }
  const sql='\\set ON_ERROR_STOP on\n'+settings(binding,manifestPin,reviewPin)
    +expand('preflight.sql',seen)+'\n'+expand('repair.sql',seen)+'\n'+expand('postcheck.sql',seen);
  const shell=remoteScript('execute'), sshArgs=['bash','-c',shellQuote(shell)];
  // Step 6: the single-use boundary, persisted immediately before the one write-capable invocation.
  // From here the attempt is consumed whatever happens; operator adjudication must decide recovery.
  fs.writeFileSync(path.join(dir,'ATTEMPT.json'),JSON.stringify({started_utc:new Date().toISOString(),manifest_sha256:manifestPin,review_sha256:reviewPin,
    prerequisite_evidence:path.basename(out),prerequisite_evidence_hashes_sha256:priorEvidence})+'\n',{flag:'wx'});
  fs.mkdirSync(executionDir);
  fs.writeFileSync(path.join(executionDir,'submitted.sql'),sql,{flag:'wx'});
  // Step 7: exactly one invocation. No retry on any outcome.
  const result=ssh(runtime,sshArgs,sql,2400000);
  const output=result.stdout||'', lines=linesOf(output);
  fs.writeFileSync(path.join(executionDir,'stdout.log'),output);
  fs.writeFileSync(path.join(executionDir,'stderr.log'),result.stderr||'');
  const markers=['I316_TRANSACTION_BEGUN','I316_PROTECTED_LOCKS_ACQUIRED','I316_POST_LOCK_GUARDS_PASSED',
    'I316_BEFORE_STATE_CAPTURED','I316_METADATA_WRITES_COMPLETED','I316_IN_TRANSACTION_ASSERTIONS_PASSED',
    'I316_COMMIT_ACKNOWLEDGED','I316_POSTCOMMIT_VERIFICATION_PASSED'];
  const inOrder=ordered(output,markers);
  const checks=lines.filter(line=>line.startsWith('I316_POSTCHECK='));
  let postcheck=null;try{if(checks.length===1)postcheck=JSON.parse(checks[0].slice('I316_POSTCHECK='.length));}catch{}
  let principals=[];try{principals=lines.filter(line=>line.startsWith('I316_PRINCIPAL=')).map(line=>JSON.parse(line.slice('I316_PRINCIPAL='.length)));}catch{principals=[];}
  const principalOK=principals.length===3 && principals.every(p=>p.session_user==='afldb_owner' && p.current_user==='afldb_owner' && p.superuser===false);
  const transportOK=result.status===0 && !result.error;
  const gates=lines.filter(line=>line==='I316_OPERATIONAL_HOST_GATE_PASS').length===1 && lines.filter(line=>line===TRANSPORT_PASS('execute')).length===1
    && output.includes('I316_OPERATIONAL_DATABASE_GATE_PASS') && output.includes('I316_PREFLIGHT=') && principalOK;
  const driftOrdered=ordered(output,markers.slice(0,-1).concat('I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL'));
  const drift=transportOK && gates && driftOrdered && postcheck?.status==='CONCURRENT_SCHEMA_DRIFT' && postcheck.u3_confirmable===false;
  const passed=postcheck?.status==='PASS' && postcheck.u3_confirmable===true && gates && inOrder && transportOK
    && output.includes('I316_COMMIT_ACKNOWLEDGED') && output.includes('I316_POSTCHECK=');
  fs.writeFileSync(path.join(executionDir,'result.json'),JSON.stringify({status:result.status,signal:result.signal,
    error:result.error?.code||null,verdict:passed?'PASS':drift?'CONCURRENT_SCHEMA_DRIFT':'STOP_NO_RETRY',metadata_verified:passed||drift,u3_confirmed:passed,
    attempt_consumed:true,automatic_retry:false,automatic_reversal:false,finished_utc:new Date().toISOString()},null,2)+'\n');
  const files=fs.readdirSync(executionDir).sort().map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(executionDir,name)))}));
  fs.writeFileSync(path.join(executionDir,'EVIDENCE-HASHES.json'),JSON.stringify(files,null,2)+'\n');
  insist(passed,drift?'CONCURRENT_SCHEMA_DRIFT: exact metadata assertions passed; U3 unconfirmed. No retry or reversal. Owner adjudication required.':'Execution or verification failed/ambiguous. STOP; attempt consumed; preserve evidence; no retry.');
  console.log('METADATA_REPAIR_AND_POSTCHECK_PASS');
}
if(require.main===module) {try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={expand,settings,remoteScript,PRODUCTION};
