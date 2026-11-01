/**
 * ISOLATED end-to-end rehearsal of the F-229-SWITCH fixture window (tools/current-season/afl-api-fixture-window.ts).
 *
 *   node --import tsx tools/v2/isolated-pg.ts run afldb_v2_fxw_<label>_test -- \
 *     node --import tsx tools/v2/fixture-window-isolated-e2e.mts <new-evidence-parent-dir-outside-checkout>
 *
 * The target must be a ledger-118 database cloned from the verified production backup (no fixtures yet).
 *
 * REAL: the window tool end to end; the switch writer and its audit rows; the control-path reader; the BEFORE/AFTER
 * records; the session-level advisory lock; the database-session inventory (a real second connection as `afldb_import`
 * is used for the foreign-writer case); the DETACHED WATCHDOG PROCESS (a second OS process, killed-parent case included);
 * and the PRODUCTION CLI `tools/current-season/settle-afl-api-fixture-schedule.ts` itself (--validate-only, --dry-run,
 * --apply) reading the retained authentic 2027 snapshot, so the switch gate that refuses without the switch is the real
 * gate.
 * SIMULATED, and recorded in the report: `systemctl` answers and the process/cron/at inventory (this host has neither
 * systemd nor cron), and step failures where a scenario needs one the real CLI cannot be made to produce.
 * Nothing here activates a writer, a unit or a timer outside the disposable database. The directory must not exist.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postgres from 'postgres';
import { readAflApiIngestionControls } from '../../src/lib/acquisition/afl-api-ingestion-control';
import * as c4b from '../current-season/afl-api-c4b-rehearsal';
import * as fxw from '../current-season/afl-api-fixture-window';

const root = process.cwd();
const KEY = fxw.SWITCH_KEY;
const LABEL = 'afl-api-2027-2026-11-01-012026';
const FEED_SHA = '21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d';
const EXPECT = 218;
const SNAP_SRC = (process.env.AFLDB_FXW_SNAPSHOT_SRC ?? `D:/tmp/afldb-issue229-b2-check-20261101/root/data/sources/afl_api/fixtures/${LABEL}`).split(String.fromCharCode(92)).join('/');
const SNAP_DST = join(root, 'data', 'sources', 'afl_api', 'fixtures', LABEL);
const DECISION = 'ISOLATED-REHEARSAL: not an owner approval (fixture window e2e)';
const isVictim = process.argv[2] === '--victim';
const parentArg = isVictim ? process.argv[3] : process.argv[2];
if (!parentArg) throw new Error('usage: fixture-window-isolated-e2e.mts <new-evidence-parent-dir>');
const parent = resolve(parentArg);
if (!relative(root, parent).startsWith('..')) throw new Error('Evidence must be outside the checkout');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const database = decodeURIComponent(new URL(ownerDsn).pathname.slice(1));
if (!/^afldb_v2_fxw_.+_test$/.test(database) || new URL(ownerDsn).hostname !== '127.0.0.1') throw new Error('A dedicated afldb_v2_fxw_*_test isolated target is required');
for (const name of ['AFLDB_AUTH_DATABASE_URL', 'DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL']) {
  if (decodeURIComponent(new URL(process.env[name] ?? 'x://y/z').pathname.slice(1)) !== database) throw new Error(`${name} must name the isolated database`);
}
const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
const [{ pid: harnessBackend }] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

if (!existsSync(SNAP_DST)) { mkdirSync(join(root, 'data', 'sources', 'afl_api', 'fixtures'), { recursive: true }); cpSync(SNAP_SRC, SNAP_DST, { recursive: true }); }

type Host = { timers?: Record<string, [string, string]>; services?: Record<string, string>; extraInventory?: fxw.InventoryLine[]; unreadable?: string[] };
const ARGS = (over: Record<string, unknown> = {}) => ({ mode: 'run' as const, label: LABEL, expectInitial: 'absent' as 'absent' | 'false', expectCreated: EXPECT, expectFeedSha256: FEED_SHA, decision: DECISION, evidenceDir: '', maxMinutes: 10, ...over });

function winDeps(evidenceDir: string, runId: string, host: Host = {}) {
  const real = fxw.productionWindowDeps(root, evidenceDir, runId);
  // The harness's own owner connection is excluded from the session inventory; every other session is real.
  const inventory = fxw.hostInventory(async () => (await fxw.databaseSessions()).filter((s) => s.pid !== harnessBackend && !(process.env.FXW_HARNESS_BACKENDS ?? '').split(',').includes(String(s.pid))));
  return {
    ...real,
    systemctl: (verb: 'is-enabled' | 'is-active', unit: string): string => {
      const t = host.timers?.[unit]; if (t) return verb === 'is-enabled' ? t[0] : t[1];
      if (host.services?.[unit]) return host.services[unit];
      return verb === 'is-enabled' ? 'disabled' : 'inactive';
    },
    inventory: async () => { const inv = await inventory(); return { ...inv, lines: [...inv.lines, ...(host.extraInventory ?? [])], unreadable: [...inv.unreadable, ...(host.unreadable ?? [])] }; },
  };
}

const rawSetting = async (): Promise<string> => (await sql<{ v: string }[]>`SELECT value::text AS v FROM site_settings WHERE key = ${KEY}`)[0]?.v ?? 'absent';
const auditRows = async (runId: string) => (await sql<{ detail: Record<string, unknown> }[]>`SELECT detail FROM auth_audit_log WHERE action = ${fxw.AUDIT_ACTION} AND detail->>'run_id' = ${runId} ORDER BY id`).map((r) => r.detail);
const auditTotal = async (): Promise<number> => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_audit_log WHERE action = ${fxw.AUDIT_ACTION}`)[0].n;
const counts = async () => (await sql<{ f: number; m: number }[]>`SELECT (SELECT count(*) FROM fixtures)::int AS f, (SELECT count(*) FROM matches)::int AS m`)[0];
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (cond: () => Promise<boolean> | boolean, ms: number, step = 250): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, step)); }
  return cond();
};
const watchdogGone = async (evidenceDir: string): Promise<boolean> => {
  const marker = join(evidenceDir, 'watchdog-ready.json');
  if (!existsSync(marker)) return false;
  const pid = JSON.parse(readFileSync(marker, 'utf8')).watchdogPid as number;
  return wait(() => !alive(pid), 30_000);
};
const controlOn = async (): Promise<boolean> => (await readAflApiIngestionControls(process.env)).currentSeasonEnabled;

/* ---------------- victim mode: the real window, parent killed by the harness ---------------- */
if (isVictim) {
  const evidenceDir = process.argv[4]; const runId = process.argv[5];
  const deps = winDeps(evidenceDir, runId);
  const hang = (): Promise<never> => new Promise(() => { setInterval(() => {}, 1 << 30); });
  await fxw.runFixtureWindow({ ...ARGS(), evidenceDir } as never, runId, { ...deps, runStep: (async (script: string, argv: string[]) => (argv.includes('--validate-only') ? deps.runStep(script, argv, new AbortController().signal) : hang())) as never });
  process.exit(0);
}

mkdirSync(parent, { recursive: false });
const report: Record<string, unknown> = { database, startedAt: new Date().toISOString(), snapshot: LABEL, feedSha256: FEED_SHA, simulated: [
  'systemctl answers (no systemd on this host)', 'process / cron / at inventory sources other than the database sessions (no cron or at here; foreign entries are injected where a scenario needs one)',
  'step failures in the scenarios that name them'], scenarios: {} as Record<string, unknown> };
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const log: string[] = [];
const say = (l: string) => { log.push(l); console.log(l); };
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
const scenarios = report.scenarios as Record<string, unknown>;

let seq = 0;
async function win(name: string, over: Record<string, unknown> = {}, host: Host = {}, args: Record<string, unknown> = {}) {
  const evidenceDir = join(parent, name); mkdirSync(evidenceDir);
  const runId = `fxw-e2e-${name}-${++seq}-${process.pid}`;
  const deps = { ...winDeps(evidenceDir, runId, host), ...over } as never;
  const before = await counts(); const auditBefore = await auditTotal();
  const out = await fxw.runFixtureWindow({ ...ARGS(args), evidenceDir } as never, runId, deps);
  const after = await counts(); const stored = await rawSetting();
  scenarios[name] = { exitCode: out.exitCode, verdict: out.verdict, reasons: out.reasons.map((r) => r.slice(0, 220)), settingAfter: stored, fixtures: [before.f, after.f], matches: [before.m, after.m], auditRowsAdded: (await auditTotal()) - auditBefore, evidence: files(evidenceDir) };
  return { out, evidenceDir, runId, stored, before, after, auditBefore };
}
const stepDir = join(parent, 'steps'); mkdirSync(stepDir);
const realStep = (evidenceDir: string, runId: string) => winDeps(evidenceDir, runId).runStep;

// S0 baseline
{
  const c = await counts();
  const migs = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM afldb_meta.schema_migrations WHERE name LIKE '118_%'`)[0].n;
  check('S0 target is a ledger-118 production clone: migration 118 applied, 0 fixtures, setting absent', migs === 1 && c.f === 0 && (await rawSetting()) === 'absent', `118=${migs} fixtures=${c.f} matches=${c.m} setting=${await rawSetting()}`);
  check('S0 the pinned feed file sha256 matches the approved value', createHashOf(join(SNAP_DST, '00-season-matches.json')) === FEED_SHA, FEED_SHA.slice(0, 12));
}
function createHashOf(p: string): string { return spawnSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))`, p], { encoding: 'utf8' }).stdout; }

// S1 --check-only: every precondition, nothing written
{
  const a0 = await auditTotal();
  const r = await win('s1-check-only', {}, {}, { mode: 'check-only' });
  check('S1 --check-only on a clean host: CLEAR, nothing written (no audit row, no watchdog, setting still absent)', r.out.exitCode === 0 && (await auditTotal()) === a0 && r.stored === 'absent' && !files(r.evidenceDir).includes('watchdog-ready.json'), files(r.evidenceDir).join(','));
  const pre = JSON.parse(readFileSync(join(r.evidenceDir, 'preconditions.json'), 'utf8'));
  check('S1 absent systemd units are RECORDED as not-found and flagged "not proof"', pre.absentUnitsAreNotProof === true || Object.values(pre.units as Record<string, string>).every((v) => !/not-found/.test(v)), JSON.stringify(Object.values(pre.units as Record<string, string>)).slice(0, 80));
}

// S2 expected initial state
{
  const a0 = await auditTotal();
  let r = await win('s2a-expect-false-but-absent', { runStep: async () => { throw new Error('must never run'); } }, {}, { expectInitial: 'false' });
  check('S2 --expect-initial false against an ABSENT setting: REFUSED (exit 2), nothing written', r.out.exitCode === 2 && r.out.reasons.some((x) => /absent, not the expected false/.test(x)) && (await auditTotal()) === a0 && r.stored === 'absent', r.out.reasons[0]?.slice(0, 90));
  await sql`INSERT INTO site_settings (key, value) VALUES (${KEY}, 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  r = await win('s2b-leftover-true', { runStep: async () => { throw new Error('must never run'); } }, {}, { expectInitial: 'false' });
  check('S2 a leftover `true` is REFUSED (exit 2) and left alone for --restore-only', r.out.exitCode === 2 && r.stored === 'true' && (await auditTotal()) === a0, r.out.reasons[0]?.slice(0, 90));
  await sql`INSERT INTO site_settings (key, value) VALUES (${KEY}, '"maybe"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  r = await win('s2c-odd-value', { runStep: async () => { throw new Error('must never run'); } }, {}, { expectInitial: 'false' });
  check('S2 an unrecognised stored value is REFUSED, not read as false', r.out.exitCode === 2 && /not the expected false/.test(r.out.reasons.join(' ')), r.out.reasons[0]?.slice(0, 90));
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S3 the other writers: injected scheduler/process findings, a REAL afldb_import session, an unreadable source, and a lock holder
{
  const a0 = await auditTotal();
  const never = { runStep: async () => { throw new Error('must never run'); } };
  const cases: [string, Host, RegExp][] = [
    ['s3a-cron-line', { extraInventory: [{ source: 'cron', text: '30 4 * * * arm cd /srv/afldb && node tools/current-season/settle-afl-api-fixtures.ts --label x' }] }, /cron names a switch consumer/],
    ['s3b-at-job', { extraInventory: [{ source: 'at', text: '12 Sun Nov  1 13:00:00 2026 a arm  node acquire-afl-api.ts' }] }, /at names a switch consumer/],
    ['s3c-running-process', { extraInventory: [{ source: 'process', pid: 424242, text: 'node --import tsx tools/current-season/settle-afl-api-fixture-schedule.ts --label other --apply' }] }, /process 424242 is running a switch consumer/],
    ['s3d-differently-named-timer', { extraInventory: [{ source: 'systemd-unit', text: 'nightly-sync.timer enabled inactive ExecStart=/usr/bin/node tools/current-season/acquire-afl-api.ts' }] }, /can start/],
    ['s3e-unreadable-source', { unreadable: ['crontab'] }, /could not be read, so it proves nothing/],
    ['s3f-timer-enabled', { timers: { 'afldb-settle-afl-api.timer': ['enabled', 'active'] } }, /afldb-settle-afl-api\.timer is enabled/],
  ];
  for (const [name, host, needle] of cases) {
    const r = await win(name, never, host);
    check(`S3 ${name}: REFUSED (exit 2) naming the cause; no write, no watchdog`, r.out.exitCode === 2 && needle.test(r.out.reasons.join(' | ')) && !files(r.evidenceDir).includes('watchdog-ready.json') && r.stored === 'absent', r.out.reasons[0]?.slice(0, 100));
  }
  // A REAL second connection as the import role (another operator's psql, an admin promotion).
  const other = postgres(process.env.AFLDB_IMPORT_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
  try {
    await other`SELECT 1`;
    const r = await win('s3g-real-import-session', never);
    check('S3 a REAL concurrent afldb_import session is detected: REFUSED (exit 2), nothing written', r.out.exitCode === 2 && /connected as afldb_import/.test(r.out.reasons.join(' ')), r.out.reasons[0]?.slice(0, 100));
  } finally { await other.end({ timeout: 5 }); }
  // A second window holds the lock.
  const holder = postgres(process.env.AFLDB_AUTH_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
  try {
    await holder`SELECT pg_advisory_lock(${fxw.WINDOW_LOCK_KEYS[0]}, ${fxw.WINDOW_LOCK_KEYS[1]})`;
    const r = await win('s3h-lock-held', { runStep: async (script: string, argv: string[], abort: AbortSignal) => (argv.includes('--validate-only') ? realStep(stepDir, 's')(script, argv, abort) : (() => { throw new Error('must never run'); })()) });
    check('S3 a second window holding the lock: REFUSED (exit 2) as "one window at a time"; nothing written', r.out.exitCode === 2 && /one window at a time/.test(r.out.reasons.join(' ')) && r.stored === 'absent', r.out.reasons[0]?.slice(0, 100));
  } finally { await holder.end({ timeout: 5 }); }
  const after = await win('s3i-after-release', {}, {}, { mode: 'check-only' });
  check('S3 after the holder disconnects (process death releases the lock) a check-only is CLEAR again', after.out.exitCode === 0, '');
  check('S3 none of the refusals wrote an audit row', (await auditTotal()) === a0, `${a0}`);
}

// S4 dry-run outcome mismatch: the REAL dry-run says created=218, the operator expected 217 -> HALT, apply never runs, switch restored
{
  const r = await win('s4-dry-run-mismatch', {}, {}, { expectCreated: 217 });
  const rows = await auditRows(r.runId);
  check('S4 dry-run reports created=218 but 217 was approved -> HALT (exit 1); the apply never ran; fixtures 0', r.out.exitCode === 1 && r.out.reasons.some((x) => /created=218, not exactly created=217|not exactly created=217/.test(x)) && r.after.f === 0 && !files(r.evidenceDir).includes('apply.log'), r.out.reasons[0]?.slice(0, 120));
  check('S4 switch restored to exactly boolean false (explicit row; initial was absent) and the control path is off', r.stored === 'false' && !(await controlOn()), r.stored);
  check('S4 audit trail: on then off, both this run\'s', rows.length === 2 && rows[0].enabled === true && rows[1].enabled === false, JSON.stringify(rows.map((d) => d.enabled)));
  check('S4 evidence: before.json, preconditions.json, validate-only.log, dry-run.log, after.json, transition.json, restore-verified.json, result.json',
    ['before.json', 'preconditions.json', 'validate-only.log', 'dry-run.log', 'after.json', 'transition.json', 'restore-verified.json', 'result.json'].every((f) => files(r.evidenceDir).includes(f)), files(r.evidenceDir).join(','));
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S5 the apply fails after a clean dry-run: refusal path
{
  const evidenceDir0 = join(parent, 's5-apply-fails'); mkdirSync(evidenceDir0);
  const runId0 = `fxw-e2e-s5-${process.pid}`;
  const deps0 = winDeps(evidenceDir0, runId0);
  const r = await (async () => {
    const before = await counts();
    const out = await fxw.runFixtureWindow({ ...ARGS(), evidenceDir: evidenceDir0 } as never, runId0, {
      ...deps0,
      runStep: async (script: string, argv: string[], abort: AbortSignal) => (argv.includes('--apply') ? { exitCode: 1, signal: null, output: 'Outcome: refused\n  REFUSED CD_M2027014010 simulated\n' } : deps0.runStep(script, argv, abort)),
    } as never);
    return { out, before, after: await counts() };
  })();
  scenarios['s5-apply-fails'] = { exitCode: r.out.exitCode, reasons: r.out.reasons.map((x) => x.slice(0, 160)), settingAfter: await rawSetting() };
  check('S5 a refused/failed apply after a clean dry-run: HALT (exit 1), switch restored false and verified, fixtures unchanged', r.out.exitCode === 1 && (await rawSetting()) === 'false' && !(await controlOn()) && r.after.f === r.before.f, r.out.reasons[0]?.slice(0, 100));
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S6 concurrent operator toggles the switch (a foreign audit row) after the dry-run: the apply is NOT started
{
  const evidenceDir0 = join(parent, 's6-concurrent-toggle'); mkdirSync(evidenceDir0);
  const runId0 = `fxw-e2e-s6-${process.pid}`;
  const deps0 = winDeps(evidenceDir0, runId0);
  const before = await counts();
  const out = await fxw.runFixtureWindow({ ...ARGS(), evidenceDir: evidenceDir0 } as never, runId0, {
    ...deps0,
    runStep: async (script: string, argv: string[], abort: AbortSignal) => {
      const res = await deps0.runStep(script, argv, abort);
      if (argv.includes('--dry-run')) await sql`INSERT INTO auth_audit_log (action, detail) VALUES (${fxw.AUDIT_ACTION}, ${sql.json({ via: 'admin-toggle', enabled: true, run_id: 'someone-else' })})`;
      return res;
    },
  } as never);
  const after = await counts();
  check('S6 a foreign switch-audit row appearing mid-window: HALT (exit 1) naming the concurrent toggle; the apply never started; fixtures unchanged', out.exitCode === 1 && out.reasons.some((x) => /concurrent toggle/.test(x)) && !files(evidenceDir0).includes('apply.log') && after.f === before.f, out.reasons[0]?.slice(0, 130));
  check('S6 the switch is restored false regardless', (await rawSetting()) === 'false' && !(await controlOn()), await rawSetting());
  scenarios['s6-concurrent-toggle'] = { exitCode: out.exitCode, reasons: out.reasons.map((x) => x.slice(0, 200)) };
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S7 SIGINT during the dry-run, S8 deadline
{
  let fire: ((s: string) => void) | undefined;
  const r = await win('s7-sigint', {
    onInterrupt: (h: (s: string) => void) => { fire = h; return () => { fire = undefined; }; },
    runStep: (async (script: string, argv: string[], abort: AbortSignal) => {
      if (argv.includes('--validate-only')) return realStep(stepDir, 's')(script, argv, abort);
      return new Promise((res) => { setTimeout(() => fire?.('SIGINT'), 400); abort.addEventListener('abort', () => res({ exitCode: null, signal: 'SIGTERM', output: 'stopped\n' }), { once: true }); });
    }) as never,
  });
  check('S7 SIGINT during the dry-run: step stopped, switch restored false, HALT, fixtures unchanged', r.out.exitCode === 1 && r.out.reasons.some((x) => /interrupted by SIGINT/.test(x)) && r.stored === 'false' && r.after.f === r.before.f, r.stored);
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
  const d = await win('s8-deadline', {
    scheduleDeadline: (_ms: number, fn: () => void) => { const t = setTimeout(fn, 600); return () => clearTimeout(t); },
    runStep: (async (script: string, argv: string[], abort: AbortSignal) => (argv.includes('--validate-only') ? realStep(stepDir, 's')(script, argv, abort) : new Promise((res) => { abort.addEventListener('abort', () => res({ exitCode: null, signal: 'SIGTERM', output: 'stopped\n' }), { once: true }); }))) as never,
  });
  check('S8 deadline reached mid-step: switch restored false, HALT, fixtures unchanged', d.out.exitCode === 1 && d.out.reasons.some((x) => /deadline was reached/.test(x)) && d.stored === 'false' && d.after.f === d.before.f, d.stored);
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S9 restore failures: transient (retried) and permanent (exit 3, then --restore-only)
{
  const evidenceDir = join(parent, 's9-restore'); mkdirSync(evidenceDir);
  const runId = `fxw-e2e-s9-${process.pid}`;
  const base = winDeps(evidenceDir, runId);
  let failures = 0;
  const out = await fxw.runFixtureWindow({ ...ARGS(), evidenceDir } as never, runId, { ...base,
    runStep: (async (script: string, argv: string[], abort: AbortSignal) => (argv.includes('--validate-only') ? base.runStep(script, argv, abort) : { exitCode: 1, signal: null, output: 'simulated step failure\n' })) as never,
    writeSetting: async (enabled: boolean, detail: Record<string, unknown>) => { if (!enabled && failures < 2) { failures += 1; throw new Error('simulated transient database error'); } return base.writeSetting(enabled, detail); },
  } as never);
  const marker = JSON.parse(readFileSync(join(evidenceDir, 'restore-verified.json'), 'utf8'));
  check('S9 two transient restore failures: the third attempt restores and verifies (attempts=3); the step failure is still a HALT', out.exitCode === 1 && marker.attempts === 3 && (await rawSetting()) === 'false', `attempts=${marker.attempts}`);
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
  const evidenceDir2 = join(parent, 's9b-restore-permanent'); mkdirSync(evidenceDir2);
  const runId2 = `fxw-e2e-s9b-${process.pid}`;
  const base2 = winDeps(evidenceDir2, runId2);
  let blocked = true;
  const out2 = await fxw.runFixtureWindow({ ...ARGS(), evidenceDir: evidenceDir2 } as never, runId2, { ...base2, sleep: async () => {},
    runStep: (async (script: string, argv: string[], abort: AbortSignal) => (argv.includes('--validate-only') ? base2.runStep(script, argv, abort) : { exitCode: 1, signal: null, output: 'simulated step failure\n' })) as never,
    writeSetting: async (enabled: boolean, detail: Record<string, unknown>) => { if (!enabled && blocked) throw new Error('simulated permanent database error'); return base2.writeSetting(enabled, detail); },
  } as never);
  const stillOn = await rawSetting();
  check('S9 a restore that cannot be written: exit 3 RESTORATION NOT VERIFIED, the switch honestly still true, no restore-verified marker', out2.exitCode === 3 && out2.verdict === 'RESTORATION NOT VERIFIED' && stillOn === 'true' && !files(evidenceDir2).includes('restore-verified.json'), `${out2.verdict} ${stillOn}`);
  blocked = false;
  const code = await c4b.runRestoreOnly(winDeps(evidenceDir2, `${runId2}-ro`), `${runId2}-ro`);
  check('S9 --restore-only recovers: exit 0, exactly false, control path off', code === 0 && (await rawSetting()) === 'false' && !(await controlOn()), `code=${code}`);
  scenarios['s9-restore'] = { transientAttempts: marker.attempts, permanentExit: out2.exitCode, restoreOnlyExit: code };
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S10 process death: the window process is killed (hard) with the switch ON; the detached watchdog restores it
{
  const evidenceDir = join(parent, 's10-parent-killed'); mkdirSync(evidenceDir);
  const runId = `fxw-e2e-s10-${process.pid}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/v2/fixture-window-isolated-e2e.mts', '--victim', parent, evidenceDir, runId], { cwd: root, env: { ...process.env, FXW_HARNESS_BACKENDS: String(harnessBackend) }, stdio: 'ignore' });
  const on = await wait(async () => (await rawSetting()) === 'true', 120_000, 200);
  check('S10 the victim window turned the switch ON only after the real watchdog was armed and proven ready', on && files(evidenceDir).includes('watchdog-ready.json'), `on=${on}`);
  if (!on) { const rj = files(evidenceDir).includes('result.json') ? readFileSync(join(evidenceDir, 'result.json'), 'utf8').slice(0, 400) : 'no result.json'; say(`S10 victim did not reach ON: ${rj}`); if (child.pid !== undefined) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } } }
  const wd = existsSync(join(evidenceDir, 'watchdog-ready.json')) ? JSON.parse(readFileSync(join(evidenceDir, 'watchdog-ready.json'), 'utf8')) : { watchdogPid: -1 };
  check('S10 the watchdog is a different live process from the window', wd.watchdogPid !== child.pid && alive(wd.watchdogPid), `window=${child.pid} watchdog=${wd.watchdogPid}`);
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }); else if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
  const t0 = Date.now();
  const off = await wait(async () => (await rawSetting()) === 'false', 60_000, 250);
  check('S10 after the window was killed the watchdog wrote the switch OFF by itself, and the control path reads off', off && !(await controlOn()), `${Math.round((Date.now() - t0) / 100) / 10}s`);
  const rows = await auditRows(runId);
  check('S10 audit trail: on (window) then off (watchdog)', rows.length === 2 && rows[0].enabled === true && rows[1].enabled === false && rows[1].via === 'afl-api-c4b-watchdog', JSON.stringify(rows.map((d) => [d.enabled, d.via])));
  check('S10 fixtures untouched by the killed window (dry-run never reached an apply)', (await counts()).f === 0, '');
  scenarios['s10-parent-killed'] = { restored: off, evidence: files(evidenceDir) };
  await sql`DELETE FROM site_settings WHERE key = ${KEY}`;
}

// S11 SUCCESS: the real validate-only, dry-run, apply; initial state absent
{
  const r = await win('s11-success');
  const rows = await auditRows(r.runId);
  const tr = JSON.parse(readFileSync(join(r.evidenceDir, 'transition.json'), 'utf8'));
  check('S11 SUCCESS: CLEAR (exit 0); the real dry-run and real apply each reported exactly created=218', r.out.exitCode === 0 && r.out.verdict === 'CLEAR', r.out.reasons[0]?.slice(0, 120));
  check('S11 fixtures 0 -> 218; canonical matches unchanged', r.before.f === 0 && r.after.f === 218 && r.before.m === r.after.m, `${r.before.f}->${r.after.f} matches ${r.before.m}->${r.after.m}`);
  check('S11 switch restored to exactly boolean false and the control path is off', r.stored === 'false' && !(await controlOn()), r.stored);
  check('S11 audit: exactly one ON then one OFF row, both carrying this run id and the decision reference', rows.length === 2 && rows[0].enabled === true && rows[1].enabled === false && rows.every((d) => d.decision === DECISION), JSON.stringify(rows.map((d) => d.enabled)));
  check('S11 transition.json records the initial raw state, switch-on/off events, counts and audit rows', tr.before.switchRaw === null && tr.after.switchRaw === 'false' && tr.events.map((e: { what: string }) => e.what).join(',') === 'switch-on,dry-run,apply,switch-off' && tr.audit.length === 2, JSON.stringify(tr.events.map((e: { what: string }) => e.what)));
  check('S11 evidence complete incl. apply.log and restore-verified.json', ['apply.log', 'dry-run.log', 'transition.json', 'restore-verified.json', 'watchdog-ready.json'].every((f) => files(r.evidenceDir).includes(f)), files(r.evidenceDir).join(','));
  // The watchdog must have stood down.
  check('S11 the watchdog stood down by itself after the verified restore (process gone, no action taken, no extra audit row)', await watchdogGone(r.evidenceDir) && !files(r.evidenceDir).includes('watchdog-result.json') && rows.length === 2, '');
}

// S12 replay after success, from the ADMIN shape: initial value is the JSON string "false"; nothing left to create -> HALT, fixtures unchanged
{
  await sql`INSERT INTO site_settings (key, value) VALUES (${KEY}, ${JSON.stringify('false')}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  const stored = await rawSetting();
  const r = await win('s12-replay-admin-shape', {}, {}, { expectInitial: 'false' });
  check('S12 the admin-written shape (production double-encoding: a JSON string whose text is "false" with quotes) is stored and then accepted as initial `false`', stored === JSON.stringify(JSON.stringify('false')) && r.out.exitCode !== 2, stored);
  check('S12 a second apply of the same snapshot: the real dry-run reports no changes, so HALT (exit 1), the apply never runs, fixtures stay 218', r.out.exitCode === 1 && r.out.reasons.some((x) => /dry-run: outcome was no_changes/.test(x)) && r.after.f === 218 && !files(r.evidenceDir).includes('apply.log'), r.out.reasons[0]?.slice(0, 120));
  check('S12 switch ends as exactly boolean false (admin string shape replaced by the canonical boolean)', r.stored === 'false', r.stored);
}

// S13 the unmodified CLI refuses to settle while the switch is off (the gate the window exists to satisfy)
{
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tools/current-season/settle-afl-api-fixture-schedule.ts', '--label', LABEL, '--dry-run'], { cwd: root, env: process.env, encoding: 'utf8' });
  const text = `${r.stdout}${r.stderr}`;
  check('S13 with the switch off the real settle CLI refuses --dry-run (non-zero, names the switch) and writes nothing', r.status !== 0 && /afl_api_current_season_enabled|ingestion|disabled|switch/i.test(text) && (await counts()).f === 218, `exit=${r.status} ${text.trim().split('\n').pop()?.slice(0, 90)}`);
}

const failed = checks.filter((c) => !c.pass);
report.checks = checks; report.failed = failed.length; report.finishedAt = new Date().toISOString();
writeFileSync(join(parent, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
writeFileSync(join(parent, 'log.txt'), `${log.join('\n')}\n`, { flag: 'wx' });
say(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`);
await sql.end({ timeout: 5 });
if (failed.length) process.exitCode = 1;
