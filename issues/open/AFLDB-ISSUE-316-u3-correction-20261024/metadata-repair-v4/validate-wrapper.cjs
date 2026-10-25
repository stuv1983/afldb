'use strict';
// VM-only wrapper controls. No SSH, subprocess, database or execution marker on disk.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict');
const d=__dirname,read=n=>fs.readFileSync(path.join(d,n)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const markers=['I316_TRANSACTION_BEGUN','I316_PROTECTED_LOCKS_ACQUIRED','I316_POST_LOCK_GUARDS_PASSED','I316_BEFORE_STATE_CAPTURED','I316_METADATA_WRITES_COMPLETED','I316_IN_TRANSACTION_ASSERTIONS_PASSED','I316_COMMIT_ACKNOWLEDGED','I316_POSTCOMMIT_VERIFICATION_PASSED'];
const payload=status=>'I316_POSTCHECK='+JSON.stringify({status,u3_confirmable:status==='PASS'})+'\n';
const gates='I316_OPERATIONAL_HOST_GATE_PASS\nI316_OPERATIONAL_DATABASE_GATE_PASS\nI316_PREFLIGHT={}\n';
const clean=gates+markers.join('\n')+'\n'+payload('PASS');
const drift=gates+markers.slice(0,-1).join('\n')+'\n'+payload('CONCURRENT_SCHEMA_DRIFT')+'I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL\n';
const cases=[
 {name:'ordered clean success',output:clean,expected:'PASS'},
 {name:'optional drift blocks U3 without retry or reversal',output:drift,expected:'CONCURRENT_SCHEMA_DRIFT'},
 {name:'drift marker with protected failure is not verified drift',output:drift,status:3,expected:'STOP_NO_RETRY'},
 {name:'NO-GO refuses before transport',review:'NO-GO',expected:null},
 {name:'stopping finding refuses before transport',stopping:1,expected:null},
 {name:'exclusive ATTEMPT refuses second launch',attempt:true,expected:null},
 {name:'wrong manifest pin refuses',badManifest:true,expected:null},
 {name:'wrong review pin refuses',badReview:true,expected:null},
 {name:'precommit only never PASS',output:gates+markers.slice(0,6).join('\n'),expected:'STOP_NO_RETRY'},
 {name:'missing postcheck never PASS',output:gates+markers.join('\n'),expected:'STOP_NO_RETRY'},
 {name:'nonzero transport never PASS',output:clean,status:1,expected:'STOP_NO_RETRY'},
 {name:'unordered markers never PASS',output:gates+[markers[1],markers[0],...markers.slice(2)].join('\n')+'\n'+payload('PASS'),expected:'STOP_NO_RETRY'},
 {name:'missing operational host gate never PASS',output:clean.replace('I316_OPERATIONAL_HOST_GATE_PASS','MISSING'),expected:'STOP_NO_RETRY'},
 {name:'drift status with clean markers never PASS',output:clean.replace(payload('PASS'),payload('CONCURRENT_SCHEMA_DRIFT')),expected:'STOP_NO_RETRY'},
];
const results=[];
for(const c of cases){
 const mem=new Map(),writes=new Map();let launches=0;
 const runtime=JSON.parse(read('runtime.json'));
 // Synthetic runtime pins exercise the binding branch without changing installed bytes.
 runtime.node.sha256=sha('node-runtime');runtime.ssh.sha256=sha('ssh-runtime');
 for(const n of fs.readdirSync(d).filter(n=>/\.(sql|cjs|json|txt|md|sh)$/.test(n)&&!['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json'].includes(n)))mem.set(path.join(d,n),n==='runtime.json'?Buffer.from(JSON.stringify(runtime)):read(n));
 const manifest=Buffer.from(JSON.stringify({files:[...mem].map(([p,b])=>({path:path.basename(p),sha256:sha(b)}))}));
 const pin=sha(manifest),report=Buffer.from('Independent VM fixture review');
 const decision=Buffer.from(JSON.stringify({verdict:c.review||'GO',stopping_findings:c.stopping||0,manifest_sha256:pin,report_sha256:sha(report)}));
 mem.set(path.join(d,'MANIFEST.json'),manifest);mem.set(path.join(d,'REVIEW.md'),report);mem.set(path.join(d,'REVIEW.json'),decision);
 const fakefs={
  readFileSync:p=>p===runtime.node.path?Buffer.from('node-runtime'):p===runtime.ssh.path?Buffer.from('ssh-runtime'):(mem.has(p)?mem.get(p):fs.readFileSync(p)),
  lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1}),
  readdirSync:p=>p===d?[...mem.keys()].filter(p=>path.dirname(p)===d).map(p=>path.basename(p)):[...writes.keys()].filter(x=>path.dirname(x)===p).map(x=>path.basename(x)),
  writeFileSync:(p,b,o)=>{if(o?.flag==='wx'&&(writes.has(p)||(c.attempt&&path.basename(p)==='ATTEMPT.json')))throw Error('EEXIST');writes.set(p,Buffer.from(b));mem.set(p,Buffer.from(b));},
  mkdirSync:()=>{},
 };
 const mod={exports:{}},proc={argv:['node','run.cjs','execute',c.badManifest?'0'.repeat(64):pin,c.badReview?'0'.repeat(64):sha(decision)],execPath:runtime.node.path,exitCode:0};
 const req=n=>n==='node:fs'?fakefs:n==='node:child_process'?{spawnSync:()=>{launches++;return {status:c.status||0,stdout:c.output||'',stderr:''};}}:require(n);req.main=mod;
 vm.runInNewContext(read('run.cjs').toString(),{require:req,module:mod,__dirname:d,process:proc,console:{log:()=>{},error:()=>{}},Buffer},{timeout:5000});
 assert.equal(launches,c.expected===null?0:1,c.name);
 const result=writes.get(path.join(d,'execution','result.json'));
 if(c.expected===null)assert.equal(result,undefined,c.name);else{
  const r=JSON.parse(result);assert.equal(r.verdict,c.expected,c.name);assert.equal(r.u3_confirmed,c.expected==='PASS');
  assert.equal(r.metadata_verified,['PASS','CONCURRENT_SCHEMA_DRIFT'].includes(c.expected));assert.equal(r.automatic_retry,false);assert.equal(r.automatic_reversal,false);
 }
 assert.equal(proc.exitCode,c.expected==='PASS'?0:1,c.name);
 results.push({name:c.name,status:'PASS'});
}
fs.writeFileSync(path.join(d,'WRAPPER-VALIDATION.json'),JSON.stringify({status:'PASS',scope:'In-memory VM, stubbed runtime/transport; no actual subprocess, SSH or database',passed:results.length,results},null,2)+'\n');
console.log('WRAPPER_CONTROLS_PASS '+results.length);
