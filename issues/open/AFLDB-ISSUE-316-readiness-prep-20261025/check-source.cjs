// Local source/window stop gate only. Does not execute readiness commands or contact any host/DB.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const P = 'def676517da3955aa18db3606785463aac464188';
const ADMIN = 'ffb062675ee25650cfc1b4fa6bfe98336a23cc4f';
const OPEN = Date.parse('2026-10-27T02:00:00Z');
const CLOSE = Date.parse('2026-10-27T04:00:00Z');
const adminRoot = path.resolve(__dirname, '../../..');
const packageRoot = path.join(adminRoot, 'issues/open/AFLDB-ISSUE-316-dp-proposal-20261025');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const git = (cwd, args) => cp.execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }).trim();
const blob = b => crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
function inWindow(now) { return now >= OPEN && now < CLOSE; }
function refuse(reason) { throw Error(reason); }
function parseBoundJSON(actual, committed, label) {
  if (!Buffer.from(actual).equals(Buffer.from(committed))) refuse('Administrative authority/inventory drift from committed ADMIN: ' + label);
  return JSON.parse(Buffer.from(actual).toString('utf8'));
}
function readBoundJSON(rel) {
  const file=path.join(packageRoot,rel), stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse('Administrative authority/inventory source type changed: ' + rel);
  const expected=cp.execFileSync('git',['show',ADMIN+':issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/'+rel],{cwd:adminRoot,maxBuffer:32*1024*1024});
  return parseBoundJSON(fs.readFileSync(file),expected,rel);
}
function approvedInputMap(files) {
  if (!Array.isArray(files) || files.length !== 264 || new Set(files.map(f=>f.relative_path)).size !== 264) refuse('Approved external inventory must contain exactly 264 unique paths');
  for (const f of files) if (typeof f.relative_path !== 'string' || path.isAbsolute(f.relative_path) || f.relative_path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..') || !/^[a-f0-9]{64}$/.test(f.expected_sha256)) refuse('Invalid approved external input path/hash');
  return new Map(files.map(f=>[f.relative_path,f.expected_sha256]));
}
function assertHelperBytes(actual, committed, label) {
  if (!Buffer.from(actual).equals(Buffer.from(committed))) refuse('Helper working bytes differ from declared H: ' + label);
}
function verifyHelpers(H) {
  if (!/^[a-f0-9]{40}$/.test(H ?? '')) refuse('H must be an explicit full helper commit SHA');
  if (git(adminRoot,['rev-parse',H+'^{commit}']) !== H) refuse('H is not an exact commit');
  if (cp.spawnSync('git',['merge-base','--is-ancestor',ADMIN,H],{cwd:adminRoot}).status !== 0) refuse('H does not descend from the accepted documentation commit');
  const prefix=path.relative(adminRoot,__dirname).replaceAll('\\','/');
  const files=cp.execFileSync('git',['ls-tree','-r','-z','--name-only',H,'--',prefix],{cwd:adminRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  for (const name of ['check-source.cjs','check-preparation.cjs','prepare-local.cjs','refresh-manifest.cjs','SHA256SUMS']) if (!files.includes(prefix+'/'+name)) refuse('H does not contain the complete helper set');
  const actual=fs.readdirSync(__dirname,{withFileTypes:true}).map(e=>{
    if (!e.isFile() || e.isSymbolicLink()) refuse('Unexpected helper directory entry: '+e.name);
    return prefix+'/'+e.name;
  }).sort();
  if (JSON.stringify(actual)!==JSON.stringify([...files].sort())) refuse('Helper working file membership differs from H');
  for (const p of files) {
    const expected=cp.execFileSync('git',['show',H+':'+p],{cwd:adminRoot,maxBuffer:32*1024*1024});
    assertHelperBytes(fs.readFileSync(path.join(adminRoot,p)),expected,p);
  }
  return { H, files_verified:files.length, bytes:'EXACT', freshness_work_started:false };
}
function inspect(executionRoot, opening = false, H) {
  const now = Date.now();
  // Before any source/runtime examination in opening mode: never collect early opening evidence.
  if (opening && !inWindow(now)) refuse('OUTSIDE APPROVED WINDOW: no opening preflight or freshness work may run');
  if (opening && !H) refuse('Opening requires an explicit reviewed helper commit H');
  const currentAdmin = git(adminRoot, ['rev-parse', 'HEAD']);
  if (cp.spawnSync('git',['merge-base','--is-ancestor',ADMIN,currentAdmin],{cwd:adminRoot}).status !== 0) refuse('Administrative HEAD does not include the accepted documentation lineage A');
  const approval = readBoundJSON('readiness/APPROVAL.json');
  if (approval.P !== P || approval.D !== '2026-10-27') refuse('Approved D/P mismatch');
  for (const [p,h] of Object.entries(approval.approved_artifact_files)) {
    if (sha(fs.readFileSync(path.join(packageRoot,p))) !== h) refuse('Approved artifact drift: ' + p);
  }
  if (git(executionRoot, ['rev-parse','HEAD']) !== P) refuse('Execution tree is not exact P');
  if (git(executionRoot, ['rev-parse','--show-toplevel']).replaceAll('\\','/').toLowerCase() !== fs.realpathSync(executionRoot).replaceAll('\\','/').toLowerCase()) refuse('Not the execution worktree root');
  if (git(executionRoot, ['diff','--name-only','HEAD']) || git(executionRoot, ['diff','--cached','--name-only'])) refuse('Unexpected execution-tree product/test/configuration change');
  const raw = cp.execFileSync('git',['ls-tree','-r','-z',P],{cwd:executionRoot,encoding:'utf8',maxBuffer:32*1024*1024});
  const tracked = raw.split('\0').filter(Boolean).map(s => {
    const m = /^(\d+) blob ([a-f0-9]{40})\t([^]*)$/.exec(s);
    if (!m) refuse('Unsupported tree entry');
    return { mode: m[1], git_blob: m[2], path: m[3] };
  });
  const hashes = {};
  for (const f of tracked) {
    const p = path.join(executionRoot,f.path);
    const stat = fs.lstatSync(p);
    if (f.mode === '120000' ? !stat.isSymbolicLink() : !stat.isFile() || stat.isSymbolicLink()) refuse('Tracked source type changed: ' + f.path);
    const b = f.mode === '120000' ? Buffer.from(fs.readlinkSync(p)) : fs.readFileSync(p);
    if (blob(b) !== f.git_blob) refuse('Raw bytes do not match committed P: ' + f.path);
    hashes[f.path] = { git_blob: f.git_blob, sha256: sha(b), mode: f.mode };
  }
  const helperBinding=H ? verifyHelpers(H) : { H:null, status:'NOT YET FROZEN — preparation only' };
  const externalInputs = approvedInputMap(readBoundJSON('validation/external-inputs.json').files);
  const allowed = new Map([...externalInputs, ...Object.entries(approval.approved_artifact_files).map(([p,h]) => ['issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/'+p,h])]);
  let supplied = 0;
  for (const [p,h] of allowed) if (fs.existsSync(path.join(executionRoot,p))) {
    if (sha(fs.readFileSync(path.join(executionRoot,p))) !== h) refuse('Approved external input mismatch: ' + p);
    if (externalInputs.has(p)) supplied++;
  }
  const untracked = cp.execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:executionRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  for (const p of untracked) if (!allowed.has(p)) refuse('Unexpected untracked execution input: ' + p);
  // Configuration/residue cannot hide behind ignore rules. No deletion or recovery is attempted.
  const residues = ['.rollover-transaction.json', 'tools/db/rebuild-test.ts.activation-tmp', ...approval.apply_write_set.map(f=>f.path+'.rollover-tmp')];
  for (const p of residues) if (fs.existsSync(path.join(executionRoot,p))) refuse('Pending transaction/activation material: ' + p);
  const unexpected = [];
  const known = new Set(tracked.map(f=>f.path));
  function extraFiles(dir, rel = '') {
    for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
      const p = rel ? rel+'/'+e.name : e.name;
      if (!rel && e.name === '.git') continue;
      // Runtime dependencies require their own current, enforced policy on Linux; never certify them here.
      if (!rel && e.name === 'node_modules') continue;
      if (e.isDirectory()) extraFiles(path.join(dir,e.name),p);
      else if (!known.has(p) && !allowed.has(p)) unexpected.push(p);
    }
  }
  extraFiles(executionRoot);
  if (unexpected.length) refuse('Unexpected ignored/configuration execution input: ' + unexpected.join(', '));
  if (opening && supplied !== 264) refuse('Opening source gate requires all 264 approved external inputs, not historical census copies');
  if (opening && !inWindow(Date.now())) refuse('Approved window expired during source examination');
  const result = { classification: opening ? 'LOCAL SOURCE GATE ONLY — FRESH OPENING PREFLIGHT STILL INCOMPLETE' : 'PRE-WINDOW LOCAL PREPARATION ONLY — NOT FRESHNESS EVIDENCE',
    checked_at_utc: new Date().toISOString(), checked_at_AEDT: new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',dateStyle:'full',timeStyle:'long'}).format(new Date()),
    D:'2026-10-27', source_P:P, administrative_HEAD:currentAdmin, administrative_anchor:ADMIN, helper_binding:helperBinding, execution_tree_commit:P, execution_root:executionRoot,
    tracked_files:tracked.length, raw_P_bytes_match:true, unexpected_source_changes:[], expected_external_inputs:264, supplied_external_inputs:supplied,
    pending_transaction_or_activation_material:[], runtime_dependencies:'NOT CERTIFIED: current Linux native/runtime enforcement required',
    production_DB_identity:'NOT OBSERVED', production_system_identifier:'NOT OBSERVED', service_identity_health:'NOT OBSERVED',
    fresh_host_native_proof:'NOT RUN', fresh_censuses:'NOT RUN', nightly_canonical_check:'NOT RUN', enforced_dry_run:'NOT RUN',
    production:'NO-GO', automatic_apply:false, complete_readiness_preflight:false };
  return { result, hashes };
}
module.exports = { inspect, inWindow, parseBoundJSON, approvedInputMap, verifyHelpers, assertHelperBytes };
if (require.main === module) {
  try {
    const args=process.argv.slice(2);
    const mode=args.shift();
    if (!['--prepare','--opening'].includes(mode)) refuse('Use --prepare or --opening; there is no proof/apply execution mode');
    let H;
    const helperFlag=args.indexOf('--helper-commit');
    if (helperFlag>=0) {
      H=args[helperFlag+1];
      if (!/^[a-f0-9]{40}$/.test(H ?? '')) refuse('H must be an explicit full helper commit SHA');
      args.splice(helperFlag,2);
    }
    const candidate=args.length ? path.resolve(args.shift()) : path.join(adminRoot,'.local-release/issue316-readiness-20261027/execution-P');
    if (args.length || candidate.startsWith('--')) refuse('Unexpected argument; no commands may be forwarded');
    console.log(JSON.stringify(inspect(candidate,mode==='--opening',H).result,null,2));
  } catch (e) {
    console.log(JSON.stringify({ status:'STOP', reason:e.message, freshness_work_started:false, production:'NO-GO' }));
    process.exitCode=1;
  }
}
