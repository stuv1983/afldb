/** V2-GAP-029 production wrapper: the host-side CLI that the shell wrappers call. Everything here is read-only except the files it is asked to create
 * (exclusively, mode 600) inside a run directory, and the stage tool it launches (which has its own guards and outcomes).
 *
 *   node --import tsx tools/v2/gap029-ops.ts <command> ...        (run from the pinned checkout; every path argument lies OUTSIDE the checkout)
 *
 *   stage-info       --stage S
 *   check-capture    --stage S --dir D --profile P [--max-age-hours H]
 *   check-target     --target T --profile P [--dir D]
 *   run-tool         --stage S --phase plan|apply|state|verify --run-dir R --capture-dir D --profile P
 *   manifest-write   --stage S --run-dir R --capture-dir D --profile P
 *   manifest-verify  --stage S --run-dir R --profile P
 *   plan-summary     --stage S --run-dir R
 *   statement        --stage S --run-dir R --window "<text>"
 *   approval-make    --stage S --run-dir R --digest H --statement-file F --expires ISO [--not-before ISO]
 *   approval-check   --stage S --run-dir R
 *   outcome          --stage S --run-dir R --tool-log L --tool-exit N|none [--state-log L2]
 *
 * Connection strings arrive only as environment variables set by the shell wrapper (AFLDB_GAP029_DSN, AFLDB_GAP029_WRITE_DSN); nothing here prints them.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { MAX_AGE_MS } from './gap029-common';
import {
  STAGES, approvalProblems, approvalStatement, buildApproval, captureProblems, classifyOutcome, isStage, manifestProblems, parseProfile, planProblems, sha256Hex, targetProblems,
  MANIFEST_FORMAT, type Manifest, type Profile, type StageId,
} from './gap029-ops-lib';

const fail = (why: string): never => { throw new Error(`GAP-029 ops refused: ${why}`); };

function parseArgs(argv: string[]): { cmd: string; opt: (f: string, optional?: boolean) => string } {
  const [cmd, ...rest] = argv;
  return { cmd: cmd ?? '', opt: (f, optional = false) => { const i = rest.indexOf(f); if (i < 0 || rest[i + 1] === undefined) { if (optional) return ''; return fail(`${f} required`); } return rest[i + 1]; } };
}

const outsideCheckout = (p: string): string => {
  const abs = resolve(p); const rel = relative(process.cwd(), abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) fail(`${p} lies inside the checkout`);
  return abs;
};
const sha = (path: string): string => sha256Hex(readFileSync(path));
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeExclusive = (path: string, doc: unknown): void => { writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); };

export function loadProfile(path: string): { profile: Profile; sha256: string } {
  const bytes = readFileSync(path);
  const { profile, problems } = parseProfile(bytes.toString('utf8'));
  if (problems.length) fail(`profile ${path}: ${problems.join('; ')}`);
  return { profile, sha256: sha256Hex(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')) };
}

export const RUN_FILES = { target: 'target.json', backup: 'backup.json', restoreEvidence: 'restore-evidence.json', child: 'child.json', plan: 'plan.json', manifest: 'manifest.json', approval: 'approval.json', outcome: 'outcome.json' } as const;

function captureDirFiles(dir: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isFile()) files[name] = readFileSync(p); }
  return files;
}
const dumpAndSidecar = (dir: string): { dump: string; sidecar: string } => {
  const names = readdirSync(dir);
  const dump = names.find((n) => /^afldb_prod-\d{8}T\d{6}Z\.dump$/.test(n)); const sidecar = names.find((n) => /^afldb_prod-\d{8}T\d{6}Z\.provenance\.json$/.test(n));
  if (!dump || !sidecar) return fail('the capture directory has no dump or sidecar');
  return { dump, sidecar };
};
const runPath = (runDir: string, name: string): string => join(runDir, name);
const gitHead = (): string => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const gitClean = (): void => { execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']); };

/** The files of a prepared run, hashed in place. */
function runFileHashes(stage: StageId, runDir: string, captureDir: string): { files: Record<string, string>; dumpName: string; provenanceName: string } {
  const { dump, sidecar } = dumpAndSidecar(captureDir);
  const files: Record<string, string> = { dump: sha(join(captureDir, dump)), provenance: sha(join(captureDir, sidecar)) };
  for (const n of [RUN_FILES.target, RUN_FILES.backup, RUN_FILES.restoreEvidence, RUN_FILES.plan, ...(STAGES[stage].needsChild ? [RUN_FILES.child] : [])]) files[n] = sha(runPath(runDir, n));
  return { files, dumpName: dump, provenanceName: sidecar };
}

const OPS_TOOL_FILES = ['tools/v2/gap029-ops.ts', 'tools/v2/gap029-ops-lib.ts', 'tools/v2/gap029-common.ts', 'tools/v2/gap029-ops/prod-stage.sh', 'tools/v2/gap029-ops/capture-prod-stage.sh',
  'tools/v2/gap029-ops/restore-assemble-host.sh'];
const opsToolHashes = (): Record<string, string> => Object.fromEntries(OPS_TOOL_FILES.filter((f) => existsSync(f)).map((f) => [f, sha256Hex(Buffer.from(readFileSync(f).toString('utf8').replace(/\r\n/g, '\n'), 'utf8'))]));

const stamp = (): string => new Date().toISOString();

async function runTool(stage: StageId, phase: string, runDir: string, captureDir: string, profile: Profile): Promise<number> {
  const spec = STAGES[stage];
  gitClean();
  const backup = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.backup));
  const { dump } = dumpAndSidecar(captureDir);
  const common = ['--backup-file', join(captureDir, dump), '--restore-evidence', runPath(runDir, RUN_FILES.restoreEvidence)];
  const logsDir = join(runDir, 'logs'); mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  let n = 1; while (existsSync(join(runDir, `${phase}-out-${n}.json`)) || existsSync(join(logsDir, `${phase}-${n}.log`))) n += 1;
  const out = join(runDir, `${phase}-out-${n}.json`); const logPath = join(logsDir, `${phase}-${n}.log`);
  let args: string[];
  if (phase === 'plan') {
    args = ['plan', '--target', runPath(runDir, RUN_FILES.target), ...(spec.needsActor ? ['--actor-user-id', '1'] : [])];
    if (spec.needsChild) args.push('--child', runPath(runDir, RUN_FILES.child), '--child-sha256', String(backup.assembly?.inputs?.childSha256 ?? fail('the sealed evidence carries no child sha256')), '--label', spec.label!);
    if (spec.expectAfterContentDigest) args.push('--expect-after-content-digest', spec.expectAfterContentDigest);
    args.push('--backup', runPath(runDir, RUN_FILES.backup), ...common, '--out', out);
  } else if (phase === 'apply') args = ['apply', '--plan', runPath(runDir, RUN_FILES.plan), '--approval', runPath(runDir, RUN_FILES.approval), ...common, '--out', out];
  else if (phase === 'state') args = ['state', '--plan', runPath(runDir, RUN_FILES.plan), '--out', out];
  else if (phase === 'verify' && spec.hasVerify) {
    const rec = join(runDir, 'apply-out-1.json'); if (!existsSync(rec)) return fail('no apply record to verify');
    args = ['verify', '--plan', runPath(runDir, RUN_FILES.plan), '--apply-record', rec, '--out', out];
  } else return fail(`phase ${phase} is not available for ${stage}`);
  const argv = spec.runner === 'tsx' ? ['--import', 'tsx', ...(spec.conditions ? ['--conditions=react-server'] : []), spec.tool, ...args] : [spec.tool, ...args];
  const exe = spec.runner === 'tsx' ? profile.NODE : profile.PYTHON;
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
  log.write(`# ${stamp()} ${stage} ${phase} #${n}: ${spec.runner} ${spec.tool} ${args[0]} (arguments are file paths only; no connection string is logged)\n`);
  const code: number | null = await new Promise((done) => {
    const child = spawn(exe, argv, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (s: NodeJS.ReadableStream, to: NodeJS.WritableStream) => s.on('data', (c: Buffer) => { log.write(c); to.write(c); });
    pipe(child.stdout!, process.stdout); pipe(child.stderr!, process.stderr);
    child.on('error', () => done(null)); child.on('close', (c) => done(c));
  });
  log.write(`# exit ${code === null ? 'none' : code}\n`); log.end();
  console.log(`[tool log ${logPath} exit ${code === null ? 'none' : code}]`);
  return code ?? 99;
}

async function main(): Promise<number> {
  const { cmd, opt } = parseArgs(process.argv.slice(2));
  if (cmd === 'stage-info') {
    const s = opt('--stage'); if (!isStage(s)) return fail('--stage must be S1..S4');
    const { id, title, decision, operation, tool, runner, needsChild, needsActor, hasVerify } = STAGES[s];
    console.log(JSON.stringify({ id, title, decision, operation, tool, runner, needsChild, needsActor, hasVerify })); return 0;
  }
  const stageArg = opt('--stage', true);
  const stage = stageArg ? (isStage(stageArg) ? stageArg : fail('--stage must be S1..S4')) : null;
  if (cmd === 'check-capture') {
    const { profile } = loadProfile(opt('--profile'));
    const hours = opt('--max-age-hours', true);
    if (hours && !(Number(hours) > 0 && Number(hours) <= 24)) return fail('--max-age-hours may only tighten the 24 h limit');
    const dir = outsideCheckout(opt('--dir')); const files = captureDirFiles(dir);
    const problems = captureProblems(stage!, { files }, profile, Date.now(), hours ? Number(hours) * 3600000 : MAX_AGE_MS);
    if (problems.length) { for (const p of problems) console.log(`CAPTURE CHECK FAIL: ${p}`); return 1; }
    const { dump, sidecar } = dumpAndSidecar(dir); const s = JSON.parse(files[sidecar].toString('utf8'));
    console.log(`CAPTURE CHECK PASS stage ${stage} class ${s.evidence_class} profile ${s.capture_profile} dump ${dump} bytes ${files[dump].length} sha256 ${sha256Hex(files[dump])} captured ${s.captured_start_utc} ledger ${s.observed_ledger.length}`);
    return 0;
  }
  if (cmd === 'check-target') {
    const { profile } = loadProfile(opt('--profile')); const dir = opt('--dir', true);
    const sidecar = dir ? readJson<Record<string, any>>(join(outsideCheckout(dir), dumpAndSidecar(dir).sidecar)) : undefined;
    const problems = targetProblems(readJson(outsideCheckout(opt('--target'))), profile, sidecar);
    if (problems.length) { for (const p of problems) console.log(`TARGET CHECK FAIL: ${p}`); return 1; }
    console.log('TARGET CHECK PASS'); return 0;
  }
  const runDir = opt('--run-dir', true) ? outsideCheckout(opt('--run-dir')) : '';
  if (cmd === 'run-tool') {
    const { profile } = loadProfile(opt('--profile'));
    return runTool(stage!, opt('--phase'), runDir, outsideCheckout(opt('--capture-dir')), profile);
  }
  if (cmd === 'manifest-write') {
    const { profile, sha256: profileSha } = loadProfile(opt('--profile')); gitClean();
    const captureDir = outsideCheckout(opt('--capture-dir')); const revision = gitHead();
    const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan)); const target = readJson<Record<string, unknown>>(runPath(runDir, RUN_FILES.target));
    const h = runFileHashes(stage!, runDir, captureDir);
    const problems = [...planProblems(stage!, plan, { revision, target, dumpSha256: h.files.dump, restoreEvidenceSha256: h.files[RUN_FILES.restoreEvidence], now: Date.now() }),
      ...captureProblems(stage!, { files: captureDirFiles(captureDir) }, profile, Date.now())];
    if (problems.length) { for (const p of problems) console.log(`MANIFEST REFUSED: ${p}`); return 1; }
    const m: Manifest = { format: MANIFEST_FORMAT, stage: stage!, operation: STAGES[stage!].operation, revision, evidenceClass: profile.EVIDENCE_CLASS, profileName: profile.PROFILE_NAME, profileSha256: profileSha,
      target, planDigest: plan.digest, planExpiresAt: plan.expiresAt, backupCapturedAt: plan.backup.capturedAt, createdAt: stamp(), captureDir, dumpName: h.dumpName, provenanceName: h.provenanceName,
      files: h.files, opsToolSha256: opsToolHashes() };
    writeExclusive(runPath(runDir, RUN_FILES.manifest), m);
    console.log(`MANIFEST WRITTEN stage ${stage} revision ${revision} plan ${plan.digest} class ${profile.EVIDENCE_CLASS} sha256 ${sha(runPath(runDir, RUN_FILES.manifest))}`);
    return 0;
  }
  if (cmd === 'manifest-verify') {
    const { profile, sha256: profileSha } = loadProfile(opt('--profile')); gitClean();
    const m = readJson<Manifest>(runPath(runDir, RUN_FILES.manifest));
    const resolveSha = (key: string): string | null => {
      const path = key === 'dump' ? join(m.captureDir, m.dumpName) : key === 'provenance' ? join(m.captureDir, m.provenanceName) : runPath(runDir, key);
      return existsSync(path) ? sha(path) : null;
    };
    const problems = manifestProblems(m, { stage: stage!, revision: gitHead(), profileSha256: profileSha, evidenceClass: profile.EVIDENCE_CLASS, sha: resolveSha });
    const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan));
    if (plan.digest !== m.planDigest) problems.push('the plan digest differs from the manifest');
    const now = Date.now();
    problems.push(...planProblems(stage!, plan, { revision: m.revision, target: m.target, dumpSha256: m.files.dump, restoreEvidenceSha256: m.files[RUN_FILES.restoreEvidence], now }));
    for (const [k, v] of Object.entries(opsToolHashes())) if (m.opsToolSha256[k] !== v) problems.push(`${k} differs from the wrapper bytes the run was prepared with`);
    if (problems.length) { for (const p of problems) console.log(`MANIFEST VERIFY FAIL: ${p}`); return 1; }
    console.log(`MANIFEST VERIFY PASS stage ${stage} revision ${m.revision} plan ${m.planDigest} class ${m.evidenceClass}`); return 0;
  }
  if (cmd === 'plan-summary' || cmd === 'statement') {
    const m = readJson<Manifest>(runPath(runDir, RUN_FILES.manifest)); const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan));
    const spec = STAGES[stage!];
    if (cmd === 'statement') {
      console.log(approvalStatement(stage!, plan, { dumpSha256: m.files.dump, restoreEvidenceSha256: m.files[RUN_FILES.restoreEvidence], evidenceClass: m.evidenceClass, window: opt('--window') }));
      return 0;
    }
    console.log([`PLAN ${stage} ${spec.title}`, `  digest ${plan.digest}`, `  plan file sha256 ${m.files[RUN_FILES.plan]}`, `  revision ${plan.revision}`, `  evidence class ${m.evidenceClass}`,
      `  target ${plan.target.database} OID ${plan.target.databaseOid} system ${plan.target.systemIdentifier} as ${plan.target.user}`,
      `  backup sha256 ${m.files.dump} captured ${plan.backup.capturedAt} restored ${plan.backup.restoredAt}`, `  restore evidence sha256 ${m.files[RUN_FILES.restoreEvidence]}`,
      `  plan expires ${plan.expiresAt}; approvals must expire before ${new Date(Date.parse(plan.backup.capturedAt) + MAX_AGE_MS - 20 * 60000).toISOString()} (backup 24 h limit minus 20 min)`,
      '  expected changes:', ...spec.changes(plan).map((l) => `    ${l}`)].join('\n'));
    return 0;
  }
  if (cmd === 'approval-make') {
    const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan));
    const { approval, problems } = buildApproval(stage!, plan, { digest: opt('--digest'), statement: readFileSync(outsideCheckout(opt('--statement-file')), 'utf8'), expiresAt: opt('--expires'), notBefore: opt('--not-before', true) || undefined, now: Date.now() });
    if (!approval) { for (const p of problems) console.log(`APPROVAL REFUSED: ${p}`); return 1; }
    writeExclusive(runPath(runDir, RUN_FILES.approval), approval);
    console.log(`APPROVAL WRITTEN for ${stage} plan ${approval.planDigest} window ${approval.notBefore} .. ${approval.expiresAt}`); return 0;
  }
  if (cmd === 'approval-check') {
    const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan));
    const path = runPath(runDir, RUN_FILES.approval);
    const problems = approvalProblems(stage!, plan, existsSync(path) ? readJson(path) : null, Date.now());
    if (problems.length) { for (const p of problems) console.log(`APPROVAL CHECK FAIL: ${p}`); return 1; }
    console.log(`APPROVAL CHECK PASS for ${stage} plan ${plan.digest}`); return 0;
  }
  if (cmd === 'accept-write') {
    const outcome = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.outcome));
    if (outcome.stage !== stage || !['COMMITTED_VERIFIED', 'NOTHING_WRITTEN'].includes(outcome.classification)) return fail('acceptance needs a recorded COMMITTED_VERIFIED or NOTHING_WRITTEN outcome for this stage');
    const plan = readJson<Record<string, any>>(runPath(runDir, RUN_FILES.plan)); const acceptedDir = outsideCheckout(opt('--accepted-dir'));
    writeExclusive(join(acceptedDir, `${stage}.json`), { stage, run: runDir.split(/[\\/]/).pop(), planDigest: plan.digest, revision: plan.revision, outcomeSha256: sha(runPath(runDir, RUN_FILES.outcome)),
      stateLogSha256: sha(join(runDir, 'logs', 'accept-state.txt')), acceptedAt: stamp() });
    console.log(`ACCEPTANCE RECORDED for ${stage} plan ${plan.digest}`); return 0;
  }
  if (cmd === 'outcome') {
    const exitArg = opt('--tool-exit'); const stateLog = opt('--state-log', true);
    const report = classifyOutcome({ stage: stage!, toolExit: exitArg === 'none' ? null : Number(exitArg), toolLog: readFileSync(opt('--tool-log'), 'utf8'), stateLog: stateLog && existsSync(stateLog) ? readFileSync(stateLog, 'utf8') : null });
    for (const l of report.lines) console.log(l);
    try { writeExclusive(runPath(runDir, RUN_FILES.outcome), { stage, classification: report.classification, exitCode: report.exitCode, committed: report.committed, notes: report.notes, toolLogSha256: sha(opt('--tool-log')), at: stamp() }); }
    catch { console.log('note: outcome.json already exists or could not be written; the first record stands'); }
    return report.exitCode;
  }
  return fail(`unknown command ${cmd}`);
}

if (process.argv[1] && /gap029-ops\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().then((c) => { process.exitCode = c; }).catch((e: unknown) => {
    console.error(e instanceof Error && e.message.startsWith('GAP-029 ops refused:') ? e.message : `GAP-029 ops failed: ${e instanceof Error ? e.message.slice(0, 300) : 'unknown'}`);
    process.exitCode = 1;
  });
}
