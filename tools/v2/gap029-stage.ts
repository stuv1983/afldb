/** V2-GAP-029 WORKSTATION runner: drives one stage's preparation end to end over SSH/SCP and prints the owner's copy-ready commands. It adds NO database
 * access of its own; every database action is a phase of the production-host wrapper (tools/v2/gap029-ops/prod-stage.sh) or the restore-host script
 * (tools/v2/gap029-ops/restore-assemble-host.sh), and every file that crosses a boundary is hash-verified on both sides.
 *
 *   node --import tsx tools/v2/gap029-stage.ts pack     --rev R --out-dir D
 *   node --import tsx tools/v2/gap029-stage.ts prepare  --stage S --rev R --tar T --tar-sha256 H --private-root D --restore-workspace W [--restore-host dev] [--owner-email E]
 *   node --import tsx tools/v2/gap029-stage.ts commands --stage S --run-dir D
 *   node --import tsx tools/v2/gap029-stage.ts approve  --run-dir D --digest H --expires ISO [--not-before ISO]         (OWNER ACT: records the approval)
 *   node --import tsx tools/v2/gap029-stage.ts apply|report|state|accept --run-dir D
 *
 * Environment: GAP029_SSH / GAP029_SCP (the ssh and scp programs; default the Windows OpenSSH on win32), GAP029_SSH_GAP_MS (pause between connections, default 2500, to
 * stay under the network's intrusion-prevention burst limits), GAP029_PROFILE (local profile file; default the production profile), GAP029_REMOTE_ENV (space separated
 * KEY=VALUE pairs prefixed to remote commands, e.g. GAP029_PROFILE=... for a simulation). Nothing is retried; a failed step stops the run and says what is left behind.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadProfile, RUN_FILES } from './gap029-ops';
import { STAGES, backupEvidenceBasicProblems, approvalStatement, isStage, sha256Hex, type Manifest, type Profile, type StageId } from './gap029-ops-lib';

const fail = (why: string): never => { throw new Error(`GAP-029 stage runner refused: ${why}`); };
const SAFE = /^[A-Za-z0-9_./:@%+=,~-]+$/;
const sha = (path: string): string => sha256Hex(readFileSync(path));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function args(argv: string[]): { cmd: string; opt: (f: string, optional?: boolean) => string; many: (f: string) => string[] } {
  const [cmd, ...rest] = argv;
  return {
    cmd: cmd ?? '',
    opt: (f, optional = false) => { const i = rest.indexOf(f); if (i < 0 || rest[i + 1] === undefined) { if (optional) return ''; return fail(`${f} required`); } return rest[i + 1]; },
    many: (f) => rest.flatMap((x, i) => (x === f && rest[i + 1] !== undefined ? [rest[i + 1]] : [])),
  };
}

const sshProgram = (): string => process.env.GAP029_SSH || (process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh');
const scpProgram = (): string => process.env.GAP029_SCP || (process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\scp.exe' : 'scp');
const gapMs = (): number => Number(process.env.GAP029_SSH_GAP_MS ?? 2500);
const remoteEnv = (): string => (process.env.GAP029_REMOTE_ENV ?? '').split(/\s+/).filter(Boolean).map((kv) => (SAFE.test(kv) && /^[A-Z_][A-Z0-9_]*=/.test(kv) ? kv : fail(`bad GAP029_REMOTE_ENV entry ${kv}`))).join(' ');
const q = (a: string): string => (SAFE.test(a) ? a : fail(`remote argument ${JSON.stringify(a)} contains characters outside the safe set`));
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6'];

interface Ran { code: number; out: string }
let lastConn = 0;
async function pace(): Promise<void> { const wait = lastConn + gapMs() - Date.now(); if (wait > 0) await sleep(wait); lastConn = Date.now(); }

async function ssh(host: string, remote: string, opts: { stdinFile?: string; cwd?: string; quiet?: boolean } = {}): Promise<Ran> {
  await pace();
  return new Promise((done) => {
    const child = spawn(sshProgram(), [...SSH_OPTS, host, remote], { cwd: opts.cwd, stdio: [opts.stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (c: Buffer) => { out += c.toString('utf8'); if (!opts.quiet) process.stdout.write(c); };
    child.stdout!.on('data', take); child.stderr!.on('data', take);
    if (opts.stdinFile) createReadStream(opts.stdinFile).pipe(child.stdin!);
    child.on('error', () => done({ code: 255, out: `${out}\n(ssh could not start)` })); child.on('close', (c) => done({ code: c ?? 255, out }));
  });
}
async function scp(cwd: string, from: string[], to: string, recursive = false): Promise<Ran> {
  await pace();
  return new Promise((done) => {
    const child = spawn(scpProgram(), [...SSH_OPTS, '-q', ...(recursive ? ['-r'] : []), ...from, to], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); }); child.stderr.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => done({ code: 255, out: 'scp could not start' })); child.on('close', (c) => done({ code: c ?? 255, out }));
  });
}

interface Ctx { stage: StageId; rev: string; profileFile: string; profile: Profile; profileSha: string; prodHost: string; restoreHost: string; restoreWorkspace: string; ownerEmail: string; privateRoot: string; profileRemote: string }

const step = (n: string): void => console.log(`\n##### ${new Date().toISOString()} ${n}`);
const prodOps = (c: Ctx): string => `${c.profile.OPS_ROOT}/${c.rev.slice(0, 8)}`;
const prodScript = (c: Ctx): string => `${prodOps(c)}/cand/tools/v2/gap029-ops/prod-stage.sh`;
const withEnv = (c: Ctx, cmd: string): string => [remoteEnv(), c.ownerEmail ? `GAP029_OWNER_EMAIL=${q(c.ownerEmail)}` : '', cmd].filter(Boolean).join(' ');

function localCli(cwd: string, ...a: string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'tools/v2/gap029-ops.ts', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function pack(rev: string, outDir: string): Promise<{ tar: string; sha: string }> {
  if (!/^[0-9a-f]{40}$/.test(rev)) fail('--rev must be 40 hex');
  const repo = process.cwd(); const out = resolve(outDir); mkdirSync(out, { recursive: true });
  const work = join(out, `pack-${rev.slice(0, 8)}`);
  if (existsSync(work)) fail(`${work} already exists`);
  mkdirSync(join(work, 'cand'), { recursive: true });
  const cand = join(work, 'cand');
  const git = (...a: string[]) => execFileSync('git', ['-C', cand, '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); git('config', 'core.filemode', 'false');
  git('fetch', '-q', '--depth', '1', repo, rev); git('checkout', '-q', '--detach', 'FETCH_HEAD');
  if (git('rev-parse', 'HEAD') !== rev) fail('the packed checkout is not at the requested revision');
  if (git('status', '--porcelain') !== '') fail('the packed checkout is not clean');
  const tar = join(work, 'cand.tar.gz');
  // relative names with a cwd: a drive-letter path ("D:\...") is read as a remote host by GNU tar
  execFileSync('tar', ['-czf', 'cand.tar.gz', 'cand'], { cwd: work });
  const h = sha(tar);
  console.log(`PACKED revision ${rev} tar ${tar} sha256 ${h} tracked ${git('ls-files').split('\n').length}`);
  return { tar, sha: h };
}

async function prepare(c: Ctx, tar: string, tarSha: string): Promise<void> {
  const repo = process.cwd();
  if (sha(tar) !== tarSha) fail('the local tarball does not hash to --tar-sha256');
  const runLocalBase = resolve(c.privateRoot); mkdirSync(runLocalBase, { recursive: true });
  const ops = prodOps(c); const prod = c.prodHost;
  const record: Record<string, unknown> = { stage: c.stage, revision: c.rev, tarSha256: tarSha, profile: c.profile.PROFILE_NAME, evidenceClass: c.profile.EVIDENCE_CLASS, profileSha256: c.profileSha, startedAt: new Date().toISOString() };
  let left = 'on the production host only the private pinned-checkout upload (nothing else; no backup yet)';
  const must = (r: Ran, what: string): Ran => { if (r.code !== 0) fail(`${what} failed (exit ${r.code}); nothing further was run. Left behind: ${left}. Nothing is retried; prepare a NEW run (a fresh backup) or ask for a decision`); return r; };

  step(`1 upload the pinned checkout to ${prod} (private staging directory ${ops}/in) and bootstrap`);
  must(await ssh(prod, `umask 077; mkdir -p -m 700 ${q(ops)}/in && cat > ${q(ops)}/in/cand.tar.gz`, { stdinFile: tar }), 'upload');
  must(await ssh(prod, `cd ${q(ops)} && [ "$(sha256sum in/cand.tar.gz | cut -d' ' -f1)" = ${q(tarSha)} ] && { [ -d cand ] || tar xzf in/cand.tar.gz -C ${q(ops)}; } && ${withEnv(c, `bash ${q(prodScript(c))} prep ${q(c.rev)} ${q(tarSha)}`)}`), 'bootstrap and prep');

  step(`2 ${c.stage}: capture on ${prod} (preflight, actor check, ONE fresh backup, target identity)`);
  const cap = must(await ssh(prod, withEnv(c, `bash ${q(prodScript(c))} capture ${q(c.rev)} ${q(c.stage)}`)), 'capture');
  const field = (name: string): string => new RegExp(`^${name}=(.+)$`, 'm').exec(cap.out)?.[1]?.trim() ?? fail(`capture output has no ${name}`);
  const run = field('RUN'); const capDir = field('CAPTURE_DIR'); const runDir = field('RUN_DIR'); const targetSha = field('TARGET_SHA256');
  if (!/CAPTURE_COMPLETE/.test(cap.out) || !new RegExp(`^${c.stage}-\\d{8}T\\d{6}Z$`).test(run)) fail('capture did not complete');
  // the host's reported paths are never trusted: both are derivable from the profile and the run name
  if (runDir !== `${prodOps(c)}/runs/${run}` || capDir !== `${c.profile.BACKUP_ROOT}/gap029-${c.stage}-${run.slice(c.stage.length + 1)}`) fail('the production host reported a run or capture directory that is not the one derived from the profile');
  const local = join(runLocalBase, run); mkdirSync(join(local, 'capture'), { recursive: true });
  record.run = run; record.remoteRunDir = runDir; record.remoteCaptureDir = capDir; record.localDir = local;
  left = `the production host keeps capture ${capDir} and run ${runDir} (private, mode 700, never deleted by this tool); the workstation keeps ${local}`;

  step('3 fetch the capture directory and target.json, verify every hash locally');
  must(await scp(join(local, 'capture'), [`${prod}:${capDir}/*`], '.'), 'download of the capture directory');
  must(await scp(local, [`${prod}:${runDir}/target.json`], '.'), 'download of target.json');
  if (sha(join(local, 'target.json')) !== targetSha) fail('target.json differs from the hash the production host printed');
  const chk = localCli(repo, 'check-capture', '--stage', c.stage, '--dir', join(local, 'capture'), '--profile', c.profileFile).trim();
  console.log(chk);
  localCli(repo, 'check-target', '--target', join(local, 'target.json'), '--profile', c.profileFile, '--dir', join(local, 'capture'));
  const dumpName = readdirSync(join(local, 'capture')).find((n) => n.endsWith('.dump'))!;
  const dumpSha = sha(join(local, 'capture', dumpName));
  record.dumpSha256 = dumpSha; record.dumpBytes = readFileSync(join(local, 'capture', dumpName)).length;

  step(`4 copy to ${c.restoreHost} (private workspace), restore into a guarded disposable database and assemble the sealed evidence`);
  const W = c.restoreWorkspace; const tag = `${c.stage.toLowerCase()}_${run.slice(3, 11)}_${run.slice(12, 18)}`.toLowerCase();
  const rin = `${W}/in/${run}`;
  must(await ssh(c.restoreHost, `umask 077; mkdir -p -m 700 ${q(W)}/in && mkdir -m 700 ${q(rin)}`), 'creating the restore-host staging directory');
  must(await scp(local, ['capture', 'target.json'], `${c.restoreHost}:${rin}/`, true), 'upload to the restore host');
  const remoteSha = must(await ssh(c.restoreHost, `sha256sum ${q(rin)}/capture/${q(dumpName)} ${q(rin)}/target.json`, { quiet: true }), 'remote hash check');
  if (!remoteSha.out.includes(dumpSha) || !remoteSha.out.includes(targetSha)) fail('the restore host holds different bytes than the workstation verified');
  console.log(`restore host holds identical bytes (dump ${dumpSha.slice(0, 16)}..., target ${targetSha.slice(0, 16)}...)`);
  const asm = must(await ssh(c.restoreHost, `${remoteEnv()} W=${q(W)} R=${q(c.rev)} STAGE=${q(c.stage)} CAPDIR=${q(rin)}/capture PROD_TARGET=${q(rin)}/target.json TAG=${q(tag)} PROFILE=${q(c.profileRemote)} bash ${q(W)}/cand/tools/v2/gap029-ops/restore-assemble-host.sh`), 'restore and evidence assembly');
  if (!/ASSEMBLY_COMPLETE/.test(asm.out)) fail('assembly did not complete');
  const outputs: Record<string, string> = {};
  for (const m of asm.out.matchAll(/^OUTPUT (\S+) ([0-9a-f]{64})$/gm)) outputs[m[1]] = m[2];
  const evDir = `${W}/evidence-private/${tag}`;

  step('5 fetch the assembled evidence and verify it');
  const ev = join(local, 'evidence'); mkdirSync(ev, { recursive: true });
  const fetchList = ['backup.json', 'restore-evidence.json', ...(STAGES[c.stage].needsChild ? ['work/child.json'] : [])];
  for (const f of fetchList) must(await scp(ev, [`${c.restoreHost}:${evDir}/${f}`], '.'), `download of ${f}`);
  const files: Record<string, string> = { 'backup.json': join(ev, 'backup.json'), 'restore-evidence.json': join(ev, 'restore-evidence.json'), ...(STAGES[c.stage].needsChild ? { 'child.json': join(ev, 'child.json') } : {}) };
  for (const [name, p] of Object.entries(files)) if (sha(p) !== outputs[name]) fail(`${name} differs from the hash the restore host printed`);
  const backup = JSON.parse(readFileSync(files['backup.json'], 'utf8')) as Record<string, any>;
  const problems = backupEvidenceBasicProblems(backup, { stage: c.stage, revision: c.rev, dumpSha256: dumpSha, restoreEvidenceSha256: sha(files['restore-evidence.json']),
    productionTarget: JSON.parse(readFileSync(join(local, 'target.json'), 'utf8')), childSha256: files['child.json'] ? sha(files['child.json']) : undefined });
  if (problems.length) fail(`the assembled evidence is not usable: ${problems.join('; ')}`);
  console.log(`assembled evidence verified: stage ${c.stage} revision ${c.rev.slice(0, 12)} dump ${dumpSha.slice(0, 16)}... restoreTarget ${backup.assembly.restoreTarget.database}`);
  Object.assign(record, { backupSha256: sha(files['backup.json']), restoreEvidenceSha256: sha(files['restore-evidence.json']), childSha256: files['child.json'] ? sha(files['child.json']) : null, restoreWorkspace: W, restoreTag: tag });

  step(`6 upload the evidence to ${prod} and generate the read-only plan`);
  must(await scp(ev, Object.keys(files).map((k) => (k === 'child.json' ? 'child.json' : k)), `${prod}:${runDir}/`), 'upload of the evidence');
  const hostSha = must(await ssh(prod, `sha256sum ${q(runDir)}/backup.json ${q(runDir)}/restore-evidence.json`, { quiet: true }), 'remote hash check');
  if (!hostSha.out.includes(sha(files['backup.json'])) || !hostSha.out.includes(sha(files['restore-evidence.json']))) fail('the production host holds different evidence bytes than the workstation verified');
  const plan = must(await ssh(prod, withEnv(c, `bash ${q(prodScript(c))} plan ${q(c.rev)} ${q(c.stage)} ${q(run)}`)), 'plan');
  if (!/PLAN_COMPLETE/.test(plan.out)) fail('plan did not complete');

  step('7 fetch the plan and manifest; record the run');
  for (const f of ['plan.json', 'manifest.json', 'actor.txt']) must(await scp(local, [`${prod}:${runDir}/${f}`], '.'), `download of ${f}`);
  const manifest = JSON.parse(readFileSync(join(local, 'manifest.json'), 'utf8')) as Manifest; const planDoc = JSON.parse(readFileSync(join(local, 'plan.json'), 'utf8'));
  if (manifest.planDigest !== planDoc.digest || manifest.files[RUN_FILES.plan] !== sha(join(local, 'plan.json'))) fail('the fetched plan differs from the manifest');
  Object.assign(record, { planDigest: planDoc.digest, planSha256: sha(join(local, 'plan.json')), manifestSha256: sha(join(local, 'manifest.json')), planExpiresAt: planDoc.expiresAt, completedAt: new Date().toISOString() });
  writeFileSync(join(local, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`\nPREPARATION COMPLETE stage ${c.stage} run ${run} plan ${planDoc.digest} class ${c.profile.EVIDENCE_CLASS}`);
  printCommands(c, local, record);
}

function printCommands(c: Ctx, local: string, rec: Record<string, any>): void {
  const run = String(rec.run); const script = prodScript(c); const tool = 'node --import tsx tools/v2/gap029-stage.ts';
  const L = (label: string, cmd: string, expect: string) => console.log(`\n[${label}]\n  ${cmd}\n  expect: ${expect}`);
  console.log('\n===== COPY-READY OWNER COMMANDS (each line is labelled with the machine it runs on) =====');
  L('WORKSTATION  D:\\dev\\afldb', `${tool} approve --run-dir ${local} --digest ${rec.planDigest} --expires <ISO-8601 UTC, before the plan/backup limits>`, `APPROVAL WRITTEN for ${c.stage} plan ${rec.planDigest} ... (refused if the digest is not this plan's)`);
  L('WORKSTATION  D:\\dev\\afldb', `${tool} apply --run-dir ${local}`, 'WRAPPER OUTCOME COMMITTED_VERIFIED (exit 0) ... or the named non-zero outcome; the apply runs ONCE, detached on the production host');
  L('WORKSTATION  D:\\dev\\afldb', `${tool} report --run-dir ${local}`, 'RECORDED OUTCOME (use this if the apply session drops; it never starts another apply)');
  L('WORKSTATION  D:\\dev\\afldb', `${tool} accept --run-dir ${local}`, `ACCEPTED stage=${c.stage} (read-only; only after a COMMITTED_VERIFIED or NOTHING_WRITTEN outcome)`);
  console.log(`\n(production-host equivalent for the apply step: ssh ${c.prodHost} "bash ${script} apply ${c.rev} ${c.stage} ${run}")`);
}

async function viaRun(runDir: string, phase: string, extra: string[] = []): Promise<number> {
  const rec = JSON.parse(readFileSync(join(resolve(runDir), 'run.json'), 'utf8')) as Record<string, any>;
  const c = ctxFrom(rec.stage, rec.revision, '', '', '', '');
  if (rec.profileSha256 !== c.profileSha || rec.evidenceClass !== c.profile.EVIDENCE_CLASS) fail(`this run was prepared with profile ${String(rec.profileSha256).slice(0, 12)}... (${String(rec.evidenceClass)}); the profile now loaded is ${c.profileSha.slice(0, 12)}... (${c.profile.EVIDENCE_CLASS}). Unset GAP029_PROFILE / GAP029_REMOTE_ENV or load the profile the run was prepared with`);
  const r = await ssh(c.prodHost, withEnv(c, `bash ${q(prodScript(c))} ${phase} ${q(c.rev)} ${q(c.stage)} ${q(String(rec.run))}${extra.map((x) => ` ${q(x)}`).join('')}`));
  return r.code;
}

function ctxFrom(stage: string, rev: string, restoreHost: string, restoreWorkspace: string, ownerEmail: string, privateRoot: string): Ctx {
  if (!isStage(stage)) fail('--stage must be S1..S4');
  const profileFile = resolve(process.env.GAP029_PROFILE || 'tools/v2/gap029-ops/profile.production.env');
  const { profile, sha256: profileSha } = loadProfile(profileFile);
  return { stage: stage as StageId, rev, profileFile, profile, profileSha, prodHost: process.env.GAP029_PROD_HOST || profile.SSH_HOST, restoreHost, restoreWorkspace, ownerEmail, privateRoot,
    profileRemote: process.env.GAP029_RESTORE_PROFILE || `${restoreWorkspace}/cand/tools/v2/gap029-ops/profile.production.env` };
}

async function main(): Promise<number> {
  const { cmd, opt } = args(process.argv.slice(2));
  if (cmd === 'pack') { await pack(opt('--rev'), opt('--out-dir')); return 0; }
  if (cmd === 'prepare') {
    const c = ctxFrom(opt('--stage'), opt('--rev'), opt('--restore-host', true) || 'dev', opt('--restore-workspace'), opt('--owner-email', true), opt('--private-root'));
    await prepare(c, resolve(opt('--tar')), opt('--tar-sha256'));
    return 0;
  }
  if (cmd === 'commands') {
    const local = resolve(opt('--run-dir')); const rec = JSON.parse(readFileSync(join(local, 'run.json'), 'utf8'));
    printCommands(ctxFrom(rec.stage, rec.revision, '', '', '', ''), local, rec); return 0;
  }
  if (cmd === 'approve') {
    const local = resolve(opt('--run-dir')); const rec = JSON.parse(readFileSync(join(local, 'run.json'), 'utf8')) as Record<string, any>;
    const c = ctxFrom(rec.stage, rec.revision, '', '', '', '');
    const plan = JSON.parse(readFileSync(join(local, 'plan.json'), 'utf8')); const manifest = JSON.parse(readFileSync(join(local, 'manifest.json'), 'utf8')) as Manifest;
    // the window start is always sent explicitly (one minute behind this clock to absorb skew), so the statement text and the recorded approval agree
    const expires = opt('--expires'); const nb = opt('--not-before', true) || new Date(Date.now() - 60000).toISOString();
    const statement = approvalStatement(c.stage, plan, { dumpSha256: manifest.files.dump, restoreEvidenceSha256: manifest.files[RUN_FILES.restoreEvidence], evidenceClass: manifest.evidenceClass, window: `from ${nb} until ${expires}` });
    const stmtName = `approval-statement-${new Date().toISOString().replace(/[-:.]/g, '')}.txt`;
    writeFileSync(join(local, stmtName), `${statement}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Statement being recorded as the approval reference:\n${statement}\n`);
    const remoteStmt = `${rec.remoteRunDir}/${stmtName}`;
    const up = await scp(local, [stmtName], `${c.prodHost}:${remoteStmt}`);
    if (up.code !== 0) fail('could not upload the statement');
    return viaRun(local, 'approve', [opt('--digest'), remoteStmt, expires, nb]);
  }
  if (['apply', 'report', 'state', 'accept'].includes(cmd)) return viaRun(opt('--run-dir'), cmd);
  return fail('unknown command');
}

if (process.argv[1] && /gap029-stage\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().then((c) => { process.exitCode = c; }).catch((e: unknown) => {
    console.error(e instanceof Error && e.message.startsWith('GAP-029 stage runner refused:') ? e.message : `GAP-029 stage runner failed: ${e instanceof Error ? e.message.slice(0, 300) : 'unknown'}`);
    process.exitCode = 1;
  });
}
