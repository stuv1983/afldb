'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const dir=__dirname,pkg=path.join(dir,'../metadata-repair-v4');
const manifest='829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84',review='39e71a77aa6e26127369647ab2f09a9c25f53af3567567372dc1d86e04a913a2';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function insist(b,m){if(!b)throw Error(m)}
function save(n,v){fs.writeFileSync(path.join(dir,n),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
function run(){
 const rt=JSON.parse(fs.readFileSync(path.join(pkg,'runtime.json')));
 insist(hash(fs.readFileSync(rt.node.path))===rt.node.sha256 && hash(fs.readFileSync(rt.ssh.path))===rt.ssh.sha256,'Runtime changed STOP');
 insist(!fs.existsSync(path.join(pkg,'ATTEMPT.json')),'Prior attempt STOP');
 const v=spawnSync(rt.node.path,[path.join(pkg,'run.cjs'),'verify',manifest],{encoding:'utf8',windowsHide:true,timeout:60000});
 save('final-package-verify.json',{status:v.status,error:v.error?.code||null,stdout:v.stdout||'',stderr:v.stderr||'',utc:new Date().toISOString()});
 insist(v.status===0 && !v.error && v.stdout.trim()==='PACKAGE_HASHES_PASS' && !v.stderr,'Frozen verify failed STOP');
 insist(hash(fs.readFileSync(path.join(pkg,'REVIEW.json')))===review,'Review changed STOP');
 const r=JSON.parse(fs.readFileSync(path.join(pkg,'REVIEW.json')));insist(r.verdict==='GO'&&r.stopping_findings===0&&r.manifest_sha256===manifest&&hash(fs.readFileSync(path.join(pkg,'REVIEW.md')))===r.report_sha256,'Review gate STOP');
 const script=fs.readFileSync(path.join(dir,'operational-observation.sh'));
 save('observation-launch.json',{utc:new Date().toISOString(),destination:'afldb',script_sha256:hash(script),read_only:true});
 const o=spawnSync(rt.ssh.path,['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','afldb','bash','-s'],{input:script,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
 save('operational-observation.stdout.log',o.stdout||'');save('operational-observation.stderr.log',o.stderr||'');
 save('operational-observation.transport.json',{status:o.status,error:o.error?.code||null,signal:o.signal,finished_utc:new Date().toISOString()});
 insist(o.status===0&&!o.error&&!o.stderr,'Operational observation command failed STOP before frozen attempt');
 const out=o.stdout,lines=out.split(/\r?\n/),get=p=>{const a=lines.filter(s=>s.startsWith(p));insist(a.length===1,'Missing/duplicate observation '+p);return JSON.parse(a[0].slice(p.length));};
 for(const m of ['I316_SEPARATE_HOST=afldb-prod USER=arm','SYSTEMD_RELEVANT_JOBS_CLEAR','SYSTEMD_RELEVANT_TRANSITIONS_CLEAR','I316_OPERATIONAL_DATABASE_GATE_PASS','I316_SEPARATE_DATABASE_OBSERVATION_COMPLETE','I316_SEPARATE_OPERATIONAL_OBSERVATION_COMPLETE'])insist(lines.filter(s=>s===m).length===1,'Missing/duplicate marker '+m);
 insist(lines.some(s=>/^PROCESS_ROWS [1-9][0-9]*$/.test(s))&&lines.filter(s=>s==='UNSAFE_PROCESSES 0').length===1&&!out.includes('UNSAFE_PROCESS '),'Unsafe/unreadable process observation STOP');
 const identity=get('I316_IDENTITY='),sessions=get('I316_SEPARATE_SESSIONS=');
 insist(identity.database==='afldb_prod'&&identity.user==='postgres'&&identity.oid===66668&&identity.system_identifier==='7674454702926115004'&&identity.read_only==='on','Identity observation STOP');
 insist(sessions.database==='afldb_prod'&&sessions.read_only==='on'&&Array.isArray(sessions.sessions)&&sessions.unsafe_sessions===0&&sessions.unsafe_relation_locks===0&&sessions.prepared_transactions===0,'Unsafe database work STOP');
 save('OPERATIONAL-OBSERVATION-PASS.json',{status:'PASS',utc:new Date().toISOString(),host:'afldb-prod',identity,sessions,process_command_succeeded:true,systemd_commands_succeeded:true,scope:'Bounded point-in-time observation; no future-work exclusion claimed.'});
 console.log('SEPARATE_OPERATIONAL_OBSERVATION_PASS; invoking exact frozen wrapper once');
 save('frozen-wrapper-launch.json',{utc:new Date().toISOString(),manifest_sha256:manifest,review_sha256:review,automatic_retry:false});
 const e=spawnSync(rt.node.path,[path.join(pkg,'run.cjs'),'execute',manifest,review],{encoding:'utf8',windowsHide:true,timeout:2500000,maxBuffer:8*1024*1024});
 save('frozen-wrapper.stdout.log',e.stdout||'');save('frozen-wrapper.stderr.log',e.stderr||'');save('frozen-wrapper.exit.json',{status:e.status,error:e.error?.code||null,signal:e.signal,finished_utc:new Date().toISOString(),automatic_retry:false});
 console.log('FROZEN_WRAPPER_EXIT='+e.status);console.log(e.stdout||'');console.error(e.stderr||'');
 insist(e.status===0&&!e.error,'Frozen execution failed/ambiguous STOP_NO_RETRY');
}
try{run()}catch(e){save('DRIVER-STOP.json',{utc:new Date().toISOString(),reason:e.message,automatic_retry:false});console.error(e.message);process.exitCode=1}
