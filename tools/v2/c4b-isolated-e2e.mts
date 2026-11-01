/**
 * ISOLATED end-to-end exercise of the C4b rehearsal runner (tools/current-season/afl-api-c4b-rehearsal.ts).
 *
 *   node tools/v2/isolated-pg.ts run afldb_v2_c4b_<label>_test -- \
 *     node --import tsx tools/v2/c4b-isolated-e2e.mts <new-evidence-parent-dir-outside-checkout>
 *
 * REAL, from the tool itself: the setting writer (AFLDB_AUTH_DATABASE_URL -> site_settings upsert plus its
 * auth_audit_log row in one transaction), the setting reader, the control-path reader the CLIs use (DATABASE_URL),
 * the same-database proof, the BEFORE/AFTER records, the evidence files, the three-attempt restore loop, the
 * signal/deadline plumbing, the restore-only recovery and the DETACHED WATCHDOG PROCESS (a real second process, started
 * by the tool, handshaking through watchdog-ready.json). All of it runs against the launcher-proved disposable
 * database, whose roles are the real afldb_auth / afldb_app roles.
 *
 * SIMULATED, and said so in the report (these are host facts that cannot be reproduced without the production host):
 *   - `systemctl is-enabled|is-active` answers (there is no systemd here);
 *   - the post-C2 register (`data/reference/seasons.json` in_progress_seasons = [2027]) supplied in memory;
 *   - the two provider-facing steps (acquire-afl-api.ts contacts the provider; settle-afl-api.ts --dry-run needs the
 *     acquired snapshot): a scripted step prints what the real ones print and, in the ON window, reads the control
 *     path the way the real CLIs do, proving the toggle is actually visible to them;
 *   - the readiness gate's verdict for the acquired feed.
 * Nothing here activates a provider, a writer, a unit or a timer. The report is JSON; the directory must not exist.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postgres from 'postgres';
import { readAflApiIngestionControls } from '../../src/lib/acquisition/afl-api-ingestion-control';
import * as c4b from '../current-season/afl-api-c4b-rehearsal';

const root = process.cwd();
const SEASON = 2027;
const KEY = c4b.C4B_SETTING_KEY;
const isVictim = process.argv[2] === '--victim';
const parentArg = isVictim ? process.argv[3] : process.argv[2];
if (!parentArg) throw new Error('usage: c4b-isolated-e2e.mts <new-evidence-parent-dir>');
const parent = resolve(parentArg);
if (!relative(root, parent).startsWith('..')) throw new Error('Evidence must be outside the checkout');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const database = decodeURIComponent(new URL(ownerDsn).pathname.slice(1));
if (!/^afldb_v2_c4b_.+_test$/.test(database) || new URL(ownerDsn).hostname !== '127.0.0.1') throw new Error('A dedicated afldb_v2_c4b_*_test isolated target is required');
for (const name of ['AFLDB_AUTH_DATABASE_URL', 'DATABASE_URL']) {
  if (decodeURIComponent(new URL(process.env[name] ?? 'x://y/z').pathname.slice(1)) !== database) throw new Error(`${name} must name the isolated database`);
}
const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });

/** Host facts that are simulated; each scenario may override them. */
type Host = { timers?: Record<string, [string, string]>; services?: Record<string, string>; register?: number[] };
function baseDeps(evidenceDir: string, runId: string, host: Host = {}) {
  const real = c4b.productionDeps(root, evidenceDir, runId);
  return {
    ...real,
    systemctl: (verb: 'is-enabled' | 'is-active', unit: string): string => {
      const t = host.timers?.[unit];
      if (t) return verb === 'is-enabled' ? t[0] : t[1];
      if (host.services?.[unit]) return host.services[unit];
      return verb === 'is-enabled' ? 'disabled' : 'inactive';
    },
    projectFile: (rel: string): string | undefined => {
      const text = real.projectFile(rel);
      if (rel === 'data/reference/seasons.json' && text !== undefined) return JSON.stringify({ ...JSON.parse(text), in_progress_seasons: host.register ?? [SEASON] });
      return text;
    },
    readiness: () => ({ exitCode: 0, lines: ['SIMULATED readiness verdict: READY'] }),
  };
}
const ACQUIRE_OK = (label: string) => ({ exitCode: 0, signal: null, output: `acquire-afl-api: season ${SEASON}, label ${label}\n` });
const SETTLE_OK = { exitCode: 0, signal: null, output: '  canonicalRowsInserted: 0\n  canonicalRowsUpdated: 0\n  seasonFeedComplete: true\n' };

const setting = async (): Promise<string> => (await sql<{ v: string }[]>`SELECT value::text AS v FROM site_settings WHERE key = ${KEY}`)[0]?.v ?? 'absent';
const auditRows = async (runId: string) => (await sql<{ detail: Record<string, unknown> }[]>`
  SELECT detail FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set' AND detail->>'run_id' = ${runId} ORDER BY id`).map((r) => r.detail);
const auditTotal = async (): Promise<number> => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set'`)[0].n;
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (cond: () => Promise<boolean> | boolean, ms: number, step = 250): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, step)); }
  return cond();
};

/* ---------------- victim mode: the real run, parent killed by the harness ---------------- */
if (isVictim) {
  const evidenceDir = process.argv[4]; const runId = process.argv[5];
  const deps = baseDeps(evidenceDir, runId);
  const hang = (): Promise<never> => new Promise(() => { setInterval(() => {}, 1 << 30); });
  await c4b.runC4bRehearsal({ season: SEASON, maxMinutes: 30, runId }, { ...deps, runStep: hang });
  process.exit(0);
}

/* ---------------- scenarios ---------------- */
mkdirSync(parent, { recursive: false });
const report: Record<string, unknown> = { database, startedAt: new Date().toISOString(), simulated: [
  'systemctl answers (no systemd in this environment)', 'post-C2 register [2027] supplied in memory',
  'acquire-afl-api.ts and settle-afl-api.ts --dry-run steps (provider-facing)', 'readiness verdict' ], scenarios: {} as Record<string, unknown> };
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const log: string[] = [];
const say = (l: string) => { log.push(l); console.log(l); };
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
const scenarios = report.scenarios as Record<string, unknown>;
const EVIDENCE_FULL = ['before.json', 'acquire.log', 'settle-dry-run.log', 'after.json', 'readiness.txt', 'restore-verified.json', 'result.json'];

let seq = 0;
async function run(name: string, over: Partial<ReturnType<typeof baseDeps>> & Record<string, unknown>, host: Host = {}, maxMinutes = 5) {
  const evidenceDir = join(parent, name); mkdirSync(evidenceDir);
  const runId = `c4b-e2e-${name}-${++seq}-${process.pid}`;
  const deps = { ...baseDeps(evidenceDir, runId, host), ...over } as ReturnType<typeof baseDeps>;
  const auditBefore = await auditTotal();
  const out = await c4b.runC4bRehearsal({ season: SEASON, maxMinutes, runId }, deps);
  const stored = await setting();
  const result = existsSync(join(evidenceDir, 'result.json')) ? JSON.parse(readFileSync(join(evidenceDir, 'result.json'), 'utf8')) : null;
  scenarios[name] = { exitCode: out.exitCode, verdict: out.verdict, reasons: out.reasons.map((r) => r.slice(0, 200)), settingAfter: stored, evidence: files(evidenceDir), auditRows: (await auditRows(runId)).map((d) => ({ enabled: d.enabled, step: d.step })) };
  return { out, evidenceDir, runId, stored, auditBefore, result };
}
const watchdogGone = async (evidenceDir: string): Promise<boolean> => {
  const marker = join(evidenceDir, 'watchdog-ready.json');
  if (!existsSync(marker)) return false;
  const pid = JSON.parse(readFileSync(marker, 'utf8')).watchdogPid as number;
  return wait(() => !alive(pid), 20_000);
};

// S0: baseline facts
{
  const before = await setting();
  check('S0 setting starts absent (never set on this database)', before === 'absent', before);
}

// S0b: the ADMIN toggle stores the value as a JSON string (`"false"`), a pre-existing production shape the tool must accept as off
{
  await sql`INSERT INTO site_settings (key, value) VALUES (${KEY}, ${JSON.stringify(false)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  const stored = await setting();
  check('S0b the admin-written shape is a JSON string "false" (documents the pre-existing production encoding)', stored === '"false"' || stored === 'false', stored);
}

// S1: CLEAR; the setting is visibly ON for the steps and OFF after
{
  const seen: { acquireSees?: boolean; settleSees?: boolean; settingDuring?: string } = {};
  const r = await run('s1-clear', {
    runStep: async (script: string) => {
      const c = await readAflApiIngestionControls(process.env);
      if (script === c4b.ACQUIRE_SCRIPT) { seen.acquireSees = c.currentSeasonEnabled; seen.settingDuring = await setting(); return ACQUIRE_OK('s1label'); }
      seen.settleSees = c.currentSeasonEnabled; return SETTLE_OK;
    },
  });
  check('S1 exit 0 CLEAR', r.out.exitCode === 0 && r.out.verdict === 'CLEAR', `${r.out.verdict} ${r.out.reasons[0]?.slice(0, 60)}`);
  check('S1 the toggle is really ON for the steps (stored as a real JSON boolean true; the control path the CLIs read sees it)', seen.settingDuring === 'true' && seen.acquireSees === true && seen.settleSees === true, JSON.stringify(seen));
  check('S1 setting is a real JSON boolean false afterwards, control path off', r.stored === 'false' && (await readAflApiIngestionControls(process.env)).currentSeasonEnabled === false, r.stored);
  const rows = await auditRows(r.runId);
  check('S1 two auth_audit_log rows: on then restore, tagged with the run and decision', rows.length === 2 && rows[0].enabled === true && rows[0].step === 'on' && rows[1].enabled === false && rows[1].step === 'restore' && rows.every((d) => d.decision === 'D-316-13' && d.via === 'afl-api-c4b-rehearsal'), JSON.stringify(rows.map((d) => [d.enabled, d.step])));
  check('S1 the seven evidence files exist', EVIDENCE_FULL.every((f) => files(r.evidenceDir).includes(f)), files(r.evidenceDir).join(','));
  check('S1 the detached watchdog (real second process) handshook and exited after the verified restore', await watchdogGone(r.evidenceDir) && !files(r.evidenceDir).includes('watchdog-result.json'), 'no watchdog-result.json: it never had to act');
}

// S2 .. S6: failures; each must end HALT and the setting restored
{
  const r = await run('s2-settle-fails', { runStep: async (s: string) => (s === c4b.ACQUIRE_SCRIPT ? ACQUIRE_OK('s2label') : { exitCode: 1, signal: null, output: 'settle exploded\n' }) });
  check('S2 settle exit 1 -> HALT (exit 1) and setting restored false', r.out.exitCode === 1 && r.out.verdict === 'HALT' && r.stored === 'false', `${r.out.verdict} ${r.stored}`);
}
{
  const r = await run('s3-acquire-throws', { runStep: async () => { throw new Error('provider unreachable'); } });
  check('S3 a step that throws -> HALT and setting restored false', r.out.exitCode === 1 && r.stored === 'false' && (await auditRows(r.runId)).length === 2, `${r.out.verdict} ${r.stored}`);
}
{
  const r = await run('s4-dryrun-writes', { runStep: async (s: string) => (s === c4b.ACQUIRE_SCRIPT ? ACQUIRE_OK('s4label') : { exitCode: 0, signal: null, output: '  canonicalRowsInserted: 3\n  canonicalRowsUpdated: 0\n  seasonFeedComplete: true\n' }) });
  check('S4 a dry-run that reports canonical inserts -> HALT, setting restored false', r.out.exitCode === 1 && r.out.reasons.some((x) => /canonicalRowsInserted is 3/.test(x)) && r.stored === 'false', r.out.reasons[0]?.slice(0, 70));
}
{
  const r = await run('s5-incomplete-feed', { runStep: async (s: string) => (s === c4b.ACQUIRE_SCRIPT ? ACQUIRE_OK('s5label') : { exitCode: 0, signal: null, output: '  canonicalRowsInserted: 0\n  canonicalRowsUpdated: 0\n  seasonFeedComplete: false\n' }) });
  check('S5 an incomplete season feed -> HALT, setting restored false', r.out.exitCode === 1 && r.stored === 'false', r.out.reasons[0]?.slice(0, 70));
}
{
  const r = await run('s6-record-drift', { runStep: async (s: string) => {
    if (s === c4b.ACQUIRE_SCRIPT) { await sql`INSERT INTO site_settings (key, value) VALUES ('acquisition.c4b_e2e_marker', '"changed"'::jsonb) ON CONFLICT (key) DO NOTHING`; return ACQUIRE_OK('s6label'); }
    return SETTLE_OK;
  } });
  check('S6 an unrelated acquisition.* setting changing during the run -> HALT with a BEFORE/AFTER difference; setting restored', r.out.exitCode === 1 && r.out.reasons.some((x) => /BEFORE\/AFTER differ/.test(x)) && r.stored === 'false', r.out.reasons.find((x) => /differ/.test(x))?.slice(0, 80));
}

// S7: interrupt and deadline
{
  let fire: ((s: string) => void) | undefined;
  const r = await run('s7-interrupt', {
    onInterrupt: (h: (s: string) => void) => { fire = h; return () => {}; },
    runStep: (s: string, _a: string[], abort: AbortSignal) => new Promise((res) => {
      setTimeout(() => fire?.('SIGINT'), 400);
      abort.addEventListener('abort', () => res({ exitCode: null, signal: 'SIGTERM', output: 'stopped\n' }), { once: true });
      void s;
    }),
  });
  check('S7 SIGINT during a step -> step stopped, setting restored false, HALT', r.out.exitCode === 1 && r.out.reasons.some((x) => /interrupted by SIGINT/.test(x)) && r.stored === 'false', `${r.stored}`);
}
{
  const r = await run('s8-deadline', {
    scheduleDeadline: (_ms: number, fn: () => void) => { const t = setTimeout(fn, 500); return () => clearTimeout(t); },
    runStep: (_s: string, _a: string[], abort: AbortSignal) => new Promise((res) => { abort.addEventListener('abort', () => res({ exitCode: null, signal: 'SIGTERM', output: 'stopped\n' }), { once: true }); }),
  });
  check('S8 deadline reached during a step -> setting restored false, HALT', r.out.exitCode === 1 && r.out.reasons.some((x) => /deadline was reached/.test(x)) && r.stored === 'false', `${r.stored}`);
}

// S9: transient restore failure retried; S10: permanent failure then --restore-only
{
  const evidenceDir = join(parent, 's9b-restore-transient'); mkdirSync(evidenceDir);
  const runId = `c4b-e2e-s9b-${process.pid}`;
  const base = baseDeps(evidenceDir, runId);
  let failures = 0;
  const deps = { ...base,
    runStep: async (s: string) => (s === c4b.ACQUIRE_SCRIPT ? ACQUIRE_OK('s9blabel') : SETTLE_OK),
    writeSetting: async (enabled: boolean, detail: Record<string, unknown>) => { if (!enabled && failures < 2) { failures += 1; throw new Error('simulated transient database error'); } return base.writeSetting(enabled, detail); },
  };
  const out = await c4b.runC4bRehearsal({ season: SEASON, maxMinutes: 5, runId }, deps as ReturnType<typeof baseDeps>);
  const marker = JSON.parse(readFileSync(join(evidenceDir, 'restore-verified.json'), 'utf8'));
  scenarios['s9b-restore-transient'] = { exitCode: out.exitCode, attempts: marker.attempts, settingAfter: await setting() };
  check('S9 two transient restore failures -> the third attempt restores and verifies (attempts=3), exit 0', out.exitCode === 0 && marker.attempts === 3 && (await setting()) === 'false', `attempts=${marker.attempts}`);
}
{
  const evidenceDir = join(parent, 's10-restore-permanent'); mkdirSync(evidenceDir);
  const runId = `c4b-e2e-s10-${process.pid}`;
  const base = baseDeps(evidenceDir, runId);
  let blocked = true;
  const deps = { ...base,
    sleep: async () => {},
    runStep: async (s: string) => (s === c4b.ACQUIRE_SCRIPT ? ACQUIRE_OK('s10label') : SETTLE_OK),
    writeSetting: async (enabled: boolean, detail: Record<string, unknown>) => { if (!enabled && blocked) throw new Error('simulated permanent database error'); return base.writeSetting(enabled, detail); },
  };
  const out = await c4b.runC4bRehearsal({ season: SEASON, maxMinutes: 5, runId }, deps as ReturnType<typeof baseDeps>);
  const stillOn = await setting();
  check('S10 restore that cannot be written -> exit 3 RESTORATION NOT VERIFIED and the setting is honestly still true', out.exitCode === 3 && out.verdict === 'RESTORATION NOT VERIFIED' && stillOn === 'true', `${out.verdict} ${stillOn}`);
  check('S10 no restore-verified marker is written when the restore is not verified', !files(evidenceDir).includes('restore-verified.json'), files(evidenceDir).join(','));
  // The recovery command: --restore-only, using the real deps (the failure is gone).
  blocked = false;
  const code = await c4b.runRestoreOnly(baseDeps(evidenceDir, `${runId}-restore-only`), `${runId}-restore-only`);
  check('S10 --restore-only recovers: exit 0, setting exactly false, control path off', code === 0 && (await setting()) === 'false' && !(await readAflApiIngestionControls(process.env)).currentSeasonEnabled, `code=${code}`);
  const again = await auditTotal();
  const code2 = await c4b.runRestoreOnly(baseDeps(evidenceDir, `${runId}-restore-only-2`), `${runId}-restore-only-2`);
  check('S10 --restore-only on an already-false setting writes nothing', code2 === 0 && (await auditTotal()) === again, `code=${code2}`);
  scenarios['s10-restore-permanent'] = { exitCode: out.exitCode, verdict: out.verdict, settingWhileUnverified: stillOn, restoreOnlyExit: code, evidence: files(evidenceDir) };
  // the watchdog from the unverified run only stops once its parent (this process) ends; it must then find the setting already false.
}

// S11: refusals write nothing
{
  const auditStart = await auditTotal();
  const cases: [string, Host, string][] = [
    ['s11a-timer-enabled', { timers: { 'afldb-settle-afl-api.timer': ['enabled', 'active'] } }, 'afldb-settle-afl-api.timer'],
    ['s11b-service-running', { services: { 'afldb-settle-afl-api-brownlow.service': 'active' } }, 'not inactive'],
    ['s11c-register-not-2027', { register: [2026] }, 'in_progress_seasons'],
  ];
  for (const [name, host, needle] of cases) {
    const r = await run(name, { runStep: async () => { throw new Error('must never run'); } }, host);
    check(`S11 ${name}: REFUSED (exit 2) naming the cause; setting untouched; no watchdog armed`, r.out.exitCode === 2 && r.out.reasons.some((x) => x.includes(needle)) && r.stored === 'false', r.out.reasons[0]?.slice(0, 80));
    check(`S11 ${name}: no audit row, no watchdog marker`, (await auditRows(r.runId)).length === 0 && !files(r.evidenceDir).includes('watchdog-ready.json'), files(r.evidenceDir).join(','));
  }
  // setting already true -> refuse
  await sql`UPDATE site_settings SET value = 'true'::jsonb WHERE key = ${KEY}`;
  const r = await run('s11d-leftover-on', { runStep: async () => { throw new Error('must never run'); } });
  check('S11 a leftover `true` setting is REFUSED (exit 2) and left alone for --restore-only', r.out.exitCode === 2 && r.stored === 'true', r.out.reasons[0]?.slice(0, 80));
  await sql`UPDATE site_settings SET value = 'false'::jsonb WHERE key = ${KEY}`;
  check('S11 the refusals added no audit rows at all', (await auditTotal()) === auditStart, `${auditStart}`);
}
// S11e: writer and control path name different databases -> refuse
{
  const saved = process.env.DATABASE_URL;
  const u = new URL(saved ?? ''); u.pathname = '/afldb_v2_gap029_prod_test';
  process.env.DATABASE_URL = u.toString();
  try {
    const r = await run('s11e-different-database', { runStep: async () => { throw new Error('must never run'); } });
    check('S11 writer/control databases differ -> REFUSED (exit 2), nothing written', r.out.exitCode === 2 && r.out.reasons.some((x) => /control path names/.test(x) || /could not be proved/.test(x)), r.out.reasons[0]?.slice(0, 90));
  } finally { process.env.DATABASE_URL = saved; }
}

// S12: the parent is killed (SIGKILL) while the setting is ON; the detached watchdog must restore it
{
  const evidenceDir = join(parent, 's12-parent-killed'); mkdirSync(evidenceDir);
  const runId = `c4b-e2e-s12-${process.pid}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/v2/c4b-isolated-e2e.mts', '--victim', parent, evidenceDir, runId], { cwd: root, env: process.env, stdio: 'ignore' });
  const on = await wait(async () => (await setting()) === 'true', 90_000, 200);
  check('S12 victim run turned the setting ON (real watchdog armed first)', on && files(evidenceDir).includes('watchdog-ready.json'), `on=${on}`);
  const wd = JSON.parse(readFileSync(join(evidenceDir, 'watchdog-ready.json'), 'utf8'));
  check('S12 watchdog is a different live process from the run', wd.watchdogPid !== child.pid && alive(wd.watchdogPid), `run=${child.pid} watchdog=${wd.watchdogPid}`);
  spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' });
  const killedAt = Date.now();
  const off = await wait(async () => (await setting()) === 'false', 60_000, 250);
  check('S12 after the run was killed, the watchdog wrote the setting OFF by itself', off, `${Math.round((Date.now() - killedAt) / 100) / 10}s`);
  const rows = await auditRows(runId);
  check('S12 audit trail shows on (run) then off (watchdog)', rows.length === 2 && rows[0].enabled === true && rows[1].enabled === false && rows[1].via === 'afl-api-c4b-watchdog', JSON.stringify(rows.map((d) => [d.enabled, d.via ?? d.step])));
  check('S12 watchdog recorded watchdog-result.json (reason: parent ended) and exited', await wait(() => files(evidenceDir).includes('watchdog-result.json'), 15_000) && await watchdogGone(evidenceDir), '');
  check('S12 control path reads off again', !(await readAflApiIngestionControls(process.env)).currentSeasonEnabled, '');
  scenarios['s12-parent-killed'] = { watchdogRestored: off, evidence: files(evidenceDir), auditRows: rows.map((d) => ({ enabled: d.enabled, via: d.via ?? d.step })) };
}

// S13: the real CLI on a host with no systemd refuses honestly and writes nothing
{
  const evidenceDir = join(parent, 's13-real-cli-no-systemd');
  const auditStart = await auditTotal();
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/current-season/afl-api-c4b-rehearsal.ts', '--season', String(SEASON), '--decision', 'D-316-13', '--evidence-dir', evidenceDir, '--max-minutes', '5'], { cwd: root, env: process.env, encoding: 'utf8' });
  const text = `${r.stdout}${r.stderr}`;
  scenarios['s13-real-cli-no-systemd'] = { exitCode: r.status, excerpt: text.split('\n').filter(Boolean).slice(-4).map((l) => l.slice(0, 160)) };
  check('S13 the unmodified CLI, with no systemd and a pre-C2 register, REFUSES (exit 2) and writes nothing', r.status === 2 && (await auditTotal()) === auditStart && (await setting()) === 'false', `exit=${r.status}`);
}

const failed = checks.filter((c) => !c.pass);
report.checks = checks; report.failed = failed.length; report.finishedAt = new Date().toISOString();
writeFileSync(join(parent, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
writeFileSync(join(parent, 'log.txt'), `${log.join('\n')}\n`, { flag: 'wx' });
say(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`);
await sql.end({ timeout: 5 });
if (failed.length) process.exitCode = 1;
