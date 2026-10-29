'use strict';
// Authorised validation transport only. Never invokes the production wrapper.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const dir=__dirname;
// Keep later validation evidence outside the executable package. Every attempt
// gets a new directory, so failed transport evidence is never overwritten.
const evidence=fs.mkdtempSync(path.join(path.dirname(dir),'metadata-repair-v5-validation-'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// Explicit transitive dependencies of validate-pg/validateOrder/seed/sql and the v5 transport tests only.
// Never submit run.cjs, identity.sql, the production observation, retained live evidence or env.
// operational-host.sh is submitted only to prove it refuses off-production before any transport.
const names=['validate-pg.cjs','validate-order.cjs','validate.cjs',
  'binding.json','protected.json','expected-migrations.json','audit-schema-source.txt',
  'preflight.sql','repair.sql','postcheck.sql','operational-guard.sql',
  'migration-guard.sql','checks.sql','canonical-gates.sql','snapshot.sql',
  'locks.sql','lock-assert.sql','repair-body.sql','assert-post.sql',
  'principal.sql','transport.sh','operational-host.sh'];
const files=names.map(name=>{const bytes=fs.readFileSync(path.join(dir,name));return {name,sha256:sha(bytes),base64:bytes.toString('base64')};});
const bootstrap=String.raw`const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
if(os.hostname()!=='streamanator'||os.userInfo().username!=='arm')throw Error('Validation host identity refused');
const files=JSON.parse(fs.readFileSync(0,'utf8'));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i316-v5-package-'));fs.chmodSync(dir,0o700);
for(const f of files){if(!/^[a-zA-Z0-9_.-]+$/.test(f.name))throw Error('Invalid member');const b=Buffer.from(f.base64,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Transfer hash mismatch');fs.writeFileSync(path.join(dir,f.name),b,{flag:'wx'});}
fs.writeFileSync(path.join(dir,'TRANSFER-INVENTORY.json'),JSON.stringify(files.map(({name,sha256})=>({name,sha256})),null,2)+'\n');
console.log('VALIDATION_PACKAGE_RETAINED '+dir);
const r=cp.spawnSync(process.execPath,[path.join(dir,'validate-pg.cjs'),'/usr/lib/postgresql/16/bin'],{env:{PATH:'/usr/bin:/bin',NODE_PATH:'/home/arm/projects/afldb/node_modules'},encoding:'utf8',timeout:600000,maxBuffer:8388608});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
for(const name of ['TRANSFER-INVENTORY.json','PG-VALIDATION.json','PG-CLEANUP.json','PG-SERVER.log','PG-CLUSTER-COMMANDS.json'])if(fs.existsSync(path.join(dir,name)))console.log('I316_EVIDENCE '+name+' '+fs.readFileSync(path.join(dir,name)).toString('base64'));
if(r.error)console.error('VALIDATION_CHILD_ERROR '+r.error.code);console.log('VALIDATION_PACKAGE_RETAINED '+dir);process.exitCode=r.status===0?0:1;`;
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const result=spawnSync('C:/WINDOWS/System32/OpenSSH/ssh.exe',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','arm@10.0.40.100','node -e '+q(bootstrap)],
  {input:JSON.stringify(files),encoding:'utf8',timeout:660000,maxBuffer:8*1024*1024,windowsHide:true});
const output=result.stdout||'';
fs.writeFileSync(path.join(evidence,'PG-TRANSPORT.stdout.log'),output);
fs.writeFileSync(path.join(evidence,'PG-TRANSPORT.stderr.log'),result.stderr||'');
for(const m of output.matchAll(/^I316_EVIDENCE ([a-zA-Z0-9_.-]+) ([A-Za-z0-9+/=]+)$/gm))fs.writeFileSync(path.join(evidence,m[1]),Buffer.from(m[2],'base64'),{flag:'wx'});
const reportPath=path.join(evidence,'PG-VALIDATION.json'),cleanupPath=path.join(evidence,'PG-CLEANUP.json');
const ok=result.status===0&&!result.error&&fs.existsSync(reportPath)&&fs.existsSync(cleanupPath)&&
  JSON.parse(fs.readFileSync(reportPath)).status==='PASS'&&JSON.parse(fs.readFileSync(cleanupPath)).status==='PASS';
fs.writeFileSync(path.join(evidence,'PG-TRANSPORT.json'),JSON.stringify({status:result.status,error:result.error?.code||null,
  verdict:ok?'PASS':'FAIL',finished_utc:new Date().toISOString(),submitted_members:files.map(({name,sha256})=>({name,sha256})),
  stdout_sha256:sha(output),stderr_sha256:sha(result.stderr||'')},null,2)+'\n');
console.log(output.replace(/^I316_EVIDENCE .*$/gm,''));
console.log('LOCAL_VALIDATION_EVIDENCE '+evidence);
if(result.stderr)console.error(result.stderr);
if(!ok)process.exitCode=1;
