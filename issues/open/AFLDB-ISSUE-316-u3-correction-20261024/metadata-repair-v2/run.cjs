'use strict';
// No database library, DSN, application environment, browser, or automatic retry.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dir = __dirname;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(dir,name));
function insist(ok,message) { if (!ok) throw new Error(message); }
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
  for(const name of fs.readdirSync(dir)) if (/\.(sql|cjs|json|txt|md)$/.test(name)
    && !['MANIFEST.json','REVIEW.json','REVIEW.md','ATTEMPT.json'].includes(name))
    insist(seen.has(name),'Unmanifested package/input: '+name);
  for(const name of ['run.cjs','binding.json','note.txt','OWNER-RULING.md','preflight.sql','repair.sql','postcheck.sql'])
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
    'afldb.i316.manifest_sha256':manifestPin,'afldb.i316.review_sha256':reviewPin})
    .map(([k,v])=>`SELECT set_config(${q(k)},${q(v)},false) AS configured \\gset`).join('\n')+'\n';
}
function main() {
  const [mode,manifestPin,reviewPin]=process.argv.slice(2);
  insist(['verify','execute'].includes(mode),'Usage: node run.cjs verify|execute MANIFEST_SHA256 [REVIEW_JSON_SHA256]');
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
  // Refuse any second launch, even after transport failure. Operator adjudication must decide recovery.
  fs.writeFileSync(path.join(dir,'ATTEMPT.json'),JSON.stringify({started_utc:new Date().toISOString(),manifest_sha256:manifestPin,review_sha256:reviewPin})+'\n',{flag:'wx'});
  const evidence=path.join(dir,'execution'); fs.mkdirSync(evidence);
  const sql='\\set ON_ERROR_STOP on\n'+settings(binding,manifestPin,reviewPin)
    +expand('preflight.sql',seen)+'\n'+expand('repair.sql',seen)+'\n'+expand('postcheck.sql',seen);
  fs.writeFileSync(path.join(evidence,'submitted.sql'),sql,{flag:'wx'});
  // No login-shell/profile/config aliases, application DSN, or forwarded environment.
  const shell="set -eu\n[ \"$(hostname)\" = afldb-prod ]\n[ \"$(id -un)\" = arm ]\nexec sudo -n -u postgres env -i PATH=/usr/bin:/bin PGAPPNAME=afldb-i316-metadata-repair PGOPTIONS='-c statement_timeout=600000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000' /usr/bin/psql -X -qAt -P pager=off -v ON_ERROR_STOP=1 --dbname=afldb_prod -f -\n";
  // The first bash consumes only this literal command. SQL is psql stdin, never shell source.
  const result=spawnSync(runtime.ssh.path,['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','afldb','bash','-c',"'"+shell.replace(/'/g,"'\\''")+"'"],
    {input:sql,encoding:'utf8',maxBuffer:32*1024*1024,timeout:2400000,windowsHide:true});
  const output=result.stdout||'';
  fs.writeFileSync(path.join(evidence,'stdout.log'),output);
  fs.writeFileSync(path.join(evidence,'stderr.log'),result.stderr||'');
  const passed=result.status===0 && !result.error && output.includes('I316_PREFLIGHT=')
    && output.includes('I316_COMMIT_ACKNOWLEDGED') && output.includes('I316_POSTCHECK=');
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({status:result.status,signal:result.signal,
    error:result.error?.code||null,verdict:passed?'PASS':'STOP_NO_RETRY',finished_utc:new Date().toISOString()},null,2)+'\n');
  const files=fs.readdirSync(evidence).sort().map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(evidence,name)))}));
  fs.writeFileSync(path.join(evidence,'EVIDENCE-HASHES.json'),JSON.stringify(files,null,2)+'\n');
  insist(passed,'Execution or verification failed/ambiguous. STOP; preserve evidence; no retry.');
  console.log('METADATA_REPAIR_AND_POSTCHECK_PASS');
}
if(require.main===module) {try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={expand,settings};
