'use strict';
// Authorised validation transport only. Never invokes the production wrapper.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const dir=__dirname;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const names=fs.readdirSync(dir).filter(n=>/\.(sql|json|txt|cjs)$/.test(n)&&!['MANIFEST.json','REVIEW.json','runtime.json'].includes(n));
const files=names.map(name=>{const bytes=fs.readFileSync(path.join(dir,name));return {name,sha256:sha(bytes),base64:bytes.toString('base64')};});
const bootstrap=`const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
if(os.hostname()!=='streamanator'||os.userInfo().username!=='arm')throw Error('Validation host identity refused');
const files=JSON.parse(fs.readFileSync(0,'utf8'));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i316-f004-package-'));fs.chmodSync(dir,0o700);
for(const f of files){if(!/^[a-zA-Z0-9_.-]+$/.test(f.name))throw Error('Invalid member');const b=Buffer.from(f.base64,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Transfer hash mismatch');fs.writeFileSync(path.join(dir,f.name),b,{flag:'wx'});}
const r=cp.spawnSync(process.execPath,[path.join(dir,'validate-pg.cjs'),'/usr/lib/postgresql/16/bin'],{env:{PATH:'/usr/bin:/bin',NODE_PATH:'/home/arm/projects/afldb/node_modules'},encoding:'utf8',timeout:300000,maxBuffer:8388608});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
if(r.status===0){const report=fs.readFileSync(path.join(dir,'PG-VALIDATION.json'));console.log('I316_PG_REPORT_BASE64='+report.toString('base64'));}
if(r.error)console.error('VALIDATION_CHILD_ERROR '+r.error.code);console.log('VALIDATION_PACKAGE_RETAINED '+dir);process.exitCode=r.status===0?0:1;`;
const q=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const result=spawnSync('C:/WINDOWS/System32/OpenSSH/ssh.exe',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','arm@10.0.40.100','node -e '+q(bootstrap)],
  {input:JSON.stringify(files),encoding:'utf8',timeout:330000,maxBuffer:8*1024*1024,windowsHide:true});
const output=result.stdout||'';
fs.writeFileSync(path.join(dir,'PG-TRANSPORT.stdout.log'),output);
fs.writeFileSync(path.join(dir,'PG-TRANSPORT.stderr.log'),result.stderr||'');
const match=output.match(/^I316_PG_REPORT_BASE64=([A-Za-z0-9+/=]+)$/m);
const ok=result.status===0&&!result.error&&match;
if(ok)fs.writeFileSync(path.join(dir,'PG-VALIDATION.json'),Buffer.from(match[1],'base64'));
fs.writeFileSync(path.join(dir,'PG-TRANSPORT.json'),JSON.stringify({status:result.status,error:result.error?.code||null,
  verdict:ok?'PASS':'FAIL',finished_utc:new Date().toISOString(),submitted_members:files.map(({name,sha256})=>({name,sha256})),
  stdout_sha256:sha(output),stderr_sha256:sha(result.stderr||'')},null,2)+'\n');
console.log(output.replace(/^I316_PG_REPORT_BASE64=.*$/m,''));
if(result.stderr)console.error(result.stderr);
if(!ok)process.exitCode=1;
