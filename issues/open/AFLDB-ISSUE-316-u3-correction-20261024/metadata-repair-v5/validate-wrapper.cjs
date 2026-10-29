'use strict';
// VM-only wrapper controls. No SSH, subprocess, database, credential or execution marker on disk.
// Proves the v5 single-use boundary: observation and read-only prerequisite failures consume nothing;
// the marker is persisted immediately before the one write-capable invocation; after it, any outcome
// consumes the attempt and nothing retries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict');
const d=__dirname,read=n=>fs.readFileSync(path.join(d,n)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// The retained replacement observation that passed on production (2026-10-24T20:28:11Z), as the observation fixture.
const obsFile=path.join(d,'..','metadata-repair-v4-unprivileged-observation-20261025','run-20261024T202811Z','observation.stdout.log');
const obsOK=fs.readFileSync(obsFile,'utf8');
assert.equal(sha(obsOK),JSON.parse(fs.readFileSync(path.join(path.dirname(obsFile),'EVIDENCE-HASHES.json'),'utf8')).find(f=>f.path==='observation.stdout.log').sha256,'Observation fixture hash');
const PROD='/home/arm/projects/afldb/.env AFLDB_PROD_DATABASE_URL afldb_owner localhost 5432 afldb_prod';
const tline=mode=>'I316_TRANSPORT_PREREQUISITES_PASS mode='+mode+' user=afldb_owner host=localhost port=5432 database=afldb_prod';
const identity=(ro,user='afldb_owner',oid='66668')=>'I316_IDENTITY='+JSON.stringify({oid,user,database:'afldb_prod',read_only:ro,system_identifier:'7674454702926115004'});
const principal=(ro,o={})=>'I316_PRINCIPAL='+JSON.stringify({session_user:'afldb_owner',current_user:'afldb_owner',superuser:false,database_owner:'afldb_owner',read_only:ro,...o});
const visibility='I316_OPERATIONAL_VISIBILITY='+JSON.stringify({superuser:false,read_all_stats:false,update_process_title:'on',other_role_client_sessions:2,state_redacted_sessions:2});
const preOK=['I316_OPERATIONAL_HOST_GATE_PASS',tline('prerequisite'),identity('on'),principal('on'),visibility,'I316_OPERATIONAL_DATABASE_GATE_PASS',
  'I316_PREFLIGHT={}','I316_PREREQUISITE_READ_ONLY_PREFLIGHT_COMPLETE'].join('\n')+'\n';
const markers=['I316_TRANSACTION_BEGUN','I316_PROTECTED_LOCKS_ACQUIRED','I316_POST_LOCK_GUARDS_PASSED','I316_BEFORE_STATE_CAPTURED','I316_METADATA_WRITES_COMPLETED','I316_IN_TRANSACTION_ASSERTIONS_PASSED','I316_COMMIT_ACKNOWLEDGED','I316_POSTCOMMIT_VERIFICATION_PASSED'];
const payload=status=>'I316_POSTCHECK='+JSON.stringify({status,u3_confirmable:status==='PASS'})+'\n';
// Execute session: preflight (identity, principal, gates), repair (identity, principal), postcheck (identity, principal).
const wHead=(p=principal('off'))=>['I316_OPERATIONAL_HOST_GATE_PASS',tline('execute'),identity('off'),p,visibility,'I316_OPERATIONAL_DATABASE_GATE_PASS','I316_PREFLIGHT={}'].join('\n')+'\n';
const wMid=(p=principal('off'))=>markers.slice(0,2).join('\n')+'\n'+identity('off')+'\n'+p+'\n'+markers.slice(2,7).join('\n')+'\n'+identity('on')+'\n'+principal('on')+'\n';
const clean=wHead()+wMid()+payload('PASS')+markers[7]+'\n';
const drift=wHead()+wMid()+payload('CONCURRENT_SCHEMA_DRIFT')+'I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL\n';
const ok={status:0,stdout:'',stderr:''};
const C=(name,o)=>({name,mode:'execute',spawns:[],...o});
const cases=[
 C('ordered clean success',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:clean}],launches:3,attempt:true,verdict:'PASS'}),
 C('optional drift blocks U3 without retry or reversal',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:drift}],launches:3,attempt:true,verdict:'CONCURRENT_SCHEMA_DRIFT'}),
 C('drift marker with protected failure is not verified drift',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{status:3,stdout:drift,stderr:''}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('NO-GO refuses before any production contact',{review:'NO-GO',launches:0,attempt:false}),
 C('stopping finding refuses before any production contact',{stopping:1,launches:0,attempt:false}),
 C('consumed attempt refuses before any production contact',{preAttempt:true,launches:0,attempt:'pre-existing'}),
 C('wrong manifest pin refuses',{badManifest:true,launches:0,attempt:false}),
 C('wrong review pin refuses',{badReview:true,launches:0,attempt:false}),
 C('observation STOP consumes nothing',{spawns:[{status:1,stdout:'I316_OBS_HOST=afldb-prod USER=arm\nI316_OBS_STOP ps_failed\nI316_OBS_DECISION=STOP\n',stderr:''}],launches:1,attempt:false,stop:/Observation STOP/}),
 C('observation identity mismatch consumes nothing',{spawns:[{...ok,stdout:obsOK.replace('"oid": "66668"','"oid": "1"')}],launches:1,attempt:false,stop:/Observation STOP: identity/}),
 C('observation SSH failure consumes nothing',{spawns:[{status:255,stdout:'',stderr:'ssh: connect to host afldb port 22: Connection timed out\n',error:{code:'ETIMEDOUT'}}],launches:1,attempt:false,stop:/Observation STOP/}),
 C('prerequisite transport failure before write invocation consumes nothing',{spawns:[{...ok,stdout:obsOK},{status:255,stdout:'',stderr:'Connection closed\n'}],launches:2,attempt:false,stop:/Prerequisite STOP: transport/}),
 C('missing credential prerequisite stops before attempt consumption',{spawns:[{...ok,stdout:obsOK},{status:1,stdout:'I316_OPERATIONAL_HOST_GATE_PASS\nI316_TRANSPORT_STOP credential_key_count\n',stderr:''}],launches:2,attempt:false,stop:/Prerequisite STOP/}),
 C('connection/authentication failure stops before attempt consumption',{spawns:[{...ok,stdout:obsOK},{status:2,stdout:'I316_OPERATIONAL_HOST_GATE_PASS\n'+tline('prerequisite')+'\n',stderr:'psql: error: connection to server failed\n'}],launches:2,attempt:false,stop:/Prerequisite STOP/}),
 C('prerequisite wrong principal stops before attempt consumption',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK.replace(principal('on'),principal('on',{session_user:'postgres',superuser:true}))}],launches:2,attempt:false,stop:/Prerequisite STOP: principal/}),
 C('prerequisite identity must be read-only afldb_owner',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK.replace(identity('on'),identity('off'))}],launches:2,attempt:false,stop:/Prerequisite STOP: identity/}),
 C('prerequisite missing preflight stops before attempt consumption',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK.replace('I316_PREFLIGHT={}\n','')}],launches:2,attempt:false,stop:/Prerequisite STOP/}),
 C('prerequisite host gate stop consumes nothing',{spawns:[{...ok,stdout:obsOK},{status:1,stdout:'I316_OPERATIONAL_HOST_STOP unsafe_process_detected\n',stderr:''}],launches:2,attempt:false,stop:/Prerequisite STOP/}),
 C('write-session transport failure after the boundary consumes the attempt; no retry',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{status:255,stdout:'',stderr:'Connection closed\n'}],launches:3,attempt:true,verdict:'STOP_NO_RETRY',relaunch:true}),
 C('write-session missing transport marker never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:clean.replace(tline('execute'),'MISSING')}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('write-session superuser principal never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:wHead(principal('off',{superuser:true}))+wMid()+payload('PASS')+markers[7]+'\n'}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('precommit only never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:wHead()+markers.slice(0,6).join('\n')}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('missing postcheck never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:wHead()+wMid()+markers[7]+'\n'}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('unordered markers never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:clean.replace(markers[0]+'\n'+markers[1],markers[1]+'\n'+markers[0])}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('missing operational host gate never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:clean.replace('I316_OPERATIONAL_HOST_GATE_PASS','MISSING')}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('drift status with clean markers never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{...ok,stdout:clean.replace(payload('PASS'),payload('CONCURRENT_SCHEMA_DRIFT'))}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('nonzero write transport never PASS',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK},{status:1,stdout:clean,stderr:''}],launches:3,attempt:true,verdict:'STOP_NO_RETRY'}),
 C('attempt marker collision at the boundary: no write invocation',{spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK}],attemptRace:true,launches:2,attempt:'race',stop:/EEXIST/}),
 C('prerequisite mode never writes the marker or opens a write session',{mode:'prerequisite',spawns:[{...ok,stdout:obsOK},{...ok,stdout:preOK}],launches:2,attempt:false,exit:0}),
 C('prerequisite mode failure consumes nothing',{mode:'prerequisite',spawns:[{...ok,stdout:obsOK},{status:255,stdout:'',stderr:''}],launches:2,attempt:false,stop:/Prerequisite STOP/}),
];
function harness(c) {
  const mem=new Map(),dirs=new Set([d]);const calls=[];let errors=[];
  const runtime=JSON.parse(read('runtime.json'));
  // Synthetic runtime pins exercise the binding branch without changing installed bytes.
  runtime.node.sha256=sha('node-runtime');runtime.ssh.sha256=sha('ssh-runtime');
  for(const n of fs.readdirSync(d).filter(n=>/\.(sql|cjs|json|txt|md|sh)$/.test(n)&&!['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json'].includes(n)
    &&!/^(PG-|VALIDATION|WRAPPER-VALIDATION)/.test(n)))
    mem.set(path.join(d,n),n==='runtime.json'?Buffer.from(JSON.stringify(runtime)):read(n));
  const manifest=Buffer.from(JSON.stringify({files:[...mem].map(([p,b])=>({path:path.basename(p),sha256:sha(b)}))}));
  const pin=sha(manifest),report=Buffer.from('Independent VM fixture review');
  const decision=Buffer.from(JSON.stringify({verdict:c.review||'GO',stopping_findings:c.stopping||0,manifest_sha256:pin,report_sha256:sha(report)}));
  mem.set(path.join(d,'MANIFEST.json'),manifest);mem.set(path.join(d,'REVIEW.md'),report);mem.set(path.join(d,'REVIEW.json'),decision);
  const attemptPath=path.join(d,'ATTEMPT.json');
  if(c.preAttempt)mem.set(attemptPath,Buffer.from('{"prior":true}\n'));
  const fakefs={
    readFileSync:(p,e)=>{const b=p===runtime.node.path?Buffer.from('node-runtime'):p===runtime.ssh.path?Buffer.from('ssh-runtime'):(mem.has(p)?mem.get(p):null);
      if(b===null){const err=Error('ENOENT '+p);err.code='ENOENT';throw err;}return e?b.toString(e):b;},
    lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1}),
    existsSync:p=>mem.has(p)||dirs.has(p),
    readdirSync:p=>[...new Set([...mem.keys()].filter(x=>path.dirname(x)===p).map(x=>path.basename(x)).concat([...dirs].filter(x=>path.dirname(x)===p&&x!==p).map(x=>path.basename(x))))],
    writeFileSync:(p,b,o)=>{
      if(c.attemptRace&&p===attemptPath)throw Error('EEXIST: attempt marker appeared');
      if(o?.flag==='wx'&&mem.has(p))throw Error('EEXIST '+p);
      if(!dirs.has(path.dirname(p)))throw Error('ENOENT dir '+p);
      mem.set(p,Buffer.from(b));},
    mkdirSync:p=>{if(dirs.has(p)||mem.has(p))throw Error('EEXIST '+p);dirs.add(p);},
  };
  const spawnSync=(cmd,args,opts)=>{
    calls.push({cmd,args,input:opts.input,attemptAtCall:mem.has(attemptPath)});
    const r=c.spawns[calls.length-1];
    if(!r){errors.push('unexpected extra spawn '+calls.length);return {status:255,stdout:'',stderr:'',error:{code:'UNEXPECTED'}};}
    return r;
  };
  const launch=()=>{
    const mod={exports:{}},proc={argv:['node','run.cjs',c.mode,c.badManifest?'0'.repeat(64):pin,c.badReview?'0'.repeat(64):sha(decision)],execPath:runtime.node.path,exitCode:0};
    const logs=[];
    const req=n=>n==='node:fs'?fakefs:n==='node:child_process'?{spawnSync}:require(n);req.main=mod;
    vm.runInNewContext(read('run.cjs').toString(),{require:req,module:mod,__dirname:d,process:proc,console:{log:m=>logs.push(m),error:m=>logs.push(m)},Buffer},{timeout:10000});
    return {proc,logs};
  };
  return {mem,dirs,calls,errors,launch,attemptPath,runtime};
}
const results=[];
for(const c of cases){
  const h=harness(c);const {proc,logs}=h.launch();
  assert.deepEqual(h.errors,[],c.name);
  assert.equal(h.calls.length,c.launches,c.name+': spawn count');
  // Spawn 1 observation (bash -s, observation script), 2 read-only prerequisite, 3 the single write-capable session.
  h.calls.forEach((call,i)=>{
    assert.equal(call.cmd,h.runtime.ssh.path,c.name);
    assert.equal(JSON.stringify(call.args.slice(0,6)),JSON.stringify(['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','afldb']),c.name);
    const text=call.args.join(' ')+'\n'+call.input;
    assert(!/postgres(ql)?:\/\//.test(text)&&!/PGPASSWORD=[A-Za-z0-9]/.test(text),c.name+': credential-shaped value in argv/stdin');
    if(i===0){assert.equal(JSON.stringify(call.args.slice(6)),JSON.stringify(['bash','-s']));assert(Buffer.from(call.input).equals(read('operational-observation.sh')),'observation stdin must be the exact passed script bytes');assert.equal(call.attemptAtCall,c.preAttempt===true);}
    if(i===1){assert.equal(call.args[6],'bash');assert.equal(call.args[7],'-c');assert(call.args[8].includes('i316_transport prerequisite '+PROD+'\n'));
      assert(!/SERIALIZABLE|UPDATE public\.data_edits|INSERT INTO public\.data_edits/.test(call.input));assert(call.input.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
      assert.equal(call.attemptAtCall,false,c.name+': marker must not exist during prerequisite');}
    if(i===2){assert(call.args[8].includes('i316_transport execute '+PROD+'\n'));assert(call.input.includes('BEGIN ISOLATION LEVEL SERIALIZABLE'));
      assert(call.input.includes('UPDATE public.data_edits d SET note'));assert.equal(call.attemptAtCall,true,c.name+': marker must be persisted before the write invocation');}
  });
  const attempt=h.mem.get(h.attemptPath);
  if(c.attempt===true)assert(attempt&&JSON.parse(attempt).prerequisite_evidence,c.name+': attempt consumed');
  else if(c.attempt==='pre-existing')assert.equal(attempt.toString(),'{"prior":true}\n',c.name);
  else assert.equal(attempt,undefined,c.name+': attempt must not be consumed');
  const result=h.mem.get(path.join(d,'execution','result.json'));
  if(c.verdict){const r=JSON.parse(result);assert.equal(r.verdict,c.verdict,c.name);assert.equal(r.u3_confirmed,c.verdict==='PASS');assert.equal(r.attempt_consumed,true);
    assert.equal(r.metadata_verified,['PASS','CONCURRENT_SCHEMA_DRIFT'].includes(c.verdict));assert.equal(r.automatic_retry,false);assert.equal(r.automatic_reversal,false);}
  else assert.equal(result,undefined,c.name+': no execution result before the boundary');
  const expectedExit=c.exit??(c.verdict==='PASS'?0:1);
  assert.equal(proc.exitCode,expectedExit,c.name+': exit '+logs.join(' | '));
  if(c.stop)assert(logs.some(l=>c.stop.test(String(l))),c.name+': stop reason '+logs.join(' | '));
  if(c.launches>=1&&!c.preAttempt&&c.mode&&!['NO-GO'].includes(c.review)&&!c.badManifest&&!c.badReview&&!c.stopping){
    const pre=[...h.dirs].filter(x=>path.basename(x).startsWith('prerequisite-'));assert.equal(pre.length,1,c.name+': one prerequisite evidence dir');
    assert(h.mem.has(path.join(pre[0],'EVIDENCE-HASHES.json')),c.name+': prerequisite evidence hashed');
  }
  if(c.relaunch){
    // Second launch after a consumed attempt: refused before any production contact.
    const before=h.calls.length;const again=h.launch();
    assert.equal(h.calls.length,before,c.name+': relaunch must not spawn');assert.equal(again.proc.exitCode,1);
    assert(again.logs.some(l=>/already consumed/.test(String(l))),c.name+': relaunch reason');
  }
  results.push({name:c.name,status:'PASS'});
}
// Static composition: exactly host gate, transport, then the single pinned call line.
{
  const h=harness(C('static',{}));const mod={exports:{}};
  const req=n=>n==='node:fs'?{readFileSync:p=>fs.readFileSync(p)}:require(n);
  vm.runInNewContext(read('run.cjs').toString(),{require:req,module:mod,__dirname:d,process:{argv:[]},console,Buffer});
  for(const mode of ['prerequisite','execute'])
    assert.equal(mod.exports.remoteScript(mode),read('operational-host.sh').toString()+'\n'+read('transport.sh').toString()+'\ni316_transport '+mode+' '+PROD+'\n');
  assert.throws(()=>mod.exports.remoteScript('other'),/Invalid transport mode/);
  const code=read('operational-host.sh').toString().replace(/^\s*#.*$/gm,'')+read('transport.sh').toString().replace(/^\s*#.*$/gm,'')
    +read('run.cjs').toString().replace(/\/\/.*$/gm,'');
  assert(!/\bsudo\b/.test(code),'no sudo invocation anywhere in the v5 host gate, transport or wrapper');
  for(const f of ['preflight.sql','repair.sql','postcheck.sql'])assert(read(f).toString().includes('\\ir identity.sql\n\\ir principal.sql\n'),f+' must bind the principal right after identity');
  results.push({name:'static composition: host gate + transport + pinned call; no sudo; principal follows identity in all three streams',status:'PASS'});
}
fs.writeFileSync(path.join(d,'WRAPPER-VALIDATION.json'),JSON.stringify({status:'PASS',scope:'In-memory VM, stubbed runtime/transport; no actual subprocess, SSH, database or credential. Observation fixture is the retained production observation stdout (hash-checked).',passed:results.length,results},null,2)+'\n');
console.log('WRAPPER_CONTROLS_PASS '+results.length);
