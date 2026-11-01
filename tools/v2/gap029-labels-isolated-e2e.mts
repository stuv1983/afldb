/**
 * ISOLATED end-to-end exercise of the GAP-029 production entry point (apply-gap029-match-events-production.ts):
 * baseline -> plan -> approval -> apply -> replay, with refusals (including a changed venue identity and a disabled or demoted actor), an injected audit failure and a mid-run actor revocation, each then resumed.
 *
 *   node tools/v2/isolated-pg.ts run afldb_v2_gap029lab_<label>_test -- \
 *     node --import tsx --conditions=react-server tools/v2/gap029-labels-isolated-e2e.mts <new-evidence-dir-outside-checkout>
 *
 * The REAL CLI is driven (never imported). A real `pg_dump -Fc` of the target is restored into a second disposable
 * database and the tool's own `baseline` of both must agree before a plan is accepted. The approval reference says
 * SYNTHETIC / isolated; none of it is production authority. Same launcher guards as the Brownlow driver.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import postgres from 'postgres';

const root = process.cwd();
const evidence = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !relative(root, evidence).startsWith('..') || isAbsolute(relative(root, evidence))) throw new Error('A new evidence directory outside the checkout is required');
if (existsSync(evidence)) throw new Error('Evidence directory exists; never overwritten');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const url = new URL(ownerDsn);
const database = decodeURIComponent(url.pathname.slice(1));
if (!/^afldb_v2_gap029lab_.+_test$/.test(database) || url.hostname !== '127.0.0.1') throw new Error('A dedicated afldb_v2_gap029lab_*_test isolated target is required');
const pgBin = process.env.AFLDB_V2_PG_BIN ?? '';
mkdirSync(evidence);
const CLI = ['--import', 'tsx', '--conditions=react-server', 'tools/v2/apply-gap029-match-events-production.ts'];
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const writeJson = (name: string, v: unknown) => { const p = join(evidence, name); writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx' }); return p; };
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const dsnFor = (db: string, base = ownerDsn) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function cli(args: string[], env: Record<string, string> = {}, db = database): { status: number; msg: string } {
  const r = spawnSync(process.execPath, [...CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, AFLDB_GAP029_DSN: dsnFor(db), ...env } });
  const last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean).pop() ?? '';
  return { status: r.status ?? -1, msg: last.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>') };
}
async function identity(db: string) {
  const s = db === database ? sql : postgres(dsnFor(db), { max: 1, onnotice: () => {} });
  try {
    const [row] = await s`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    return { host: '127.0.0.1', port: Number(url.port), ...row } as Record<string, unknown>;
  } finally { if (s !== sql) await s.end({ timeout: 5 }); }
}
const counts = async () => (await sql<Record<string, string>[]>`SELECT
  (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event')::text AS edits,
  (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND field_group = 'match_event' AND is_active)::text AS overrides,
  (SELECT count(*) FROM matches WHERE match_event IS NOT NULL)::text AS labelled`)[0];

// ---- a real backup and restore ----
const stage = 'labels';
const dump = join(evidence, `${stage}-backup.dump`);
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
const capturedAt = new Date().toISOString();
if (spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'), ['-Fc', '-Z', '3', '--no-password', '-f', dump, database], { env, encoding: 'utf8' }).status !== 0) throw new Error('pg_dump failed');
const restoreDb = `${database.replace(/_test$/, '')}_rst_test`;
execFileSync(process.execPath, ['--import', 'tsx', 'tools/v2/isolated-pg.ts', 'create-db', restoreDb], { cwd: root, encoding: 'utf8', env: { ...process.env, AFLDB_V2_ISOLATED_PG: '' } });
if (spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore'), ['--no-password', '--no-comments', '--no-owner', '-j', '4', '-d', restoreDb, dump], { env, encoding: 'utf8' }).status !== 0) throw new Error('pg_restore failed');
const restoredAt = new Date().toISOString();
const target = await identity(database);
const restoreTarget = await identity(restoreDb);
const tPath = writeJson('target.json', target); const rtPath = writeJson('restore-target.json', restoreTarget);
const b1 = cli(['baseline', '--target', tPath, '--out', join(evidence, 'baseline-target.json')]);
const b2 = cli(['baseline', '--target', rtPath, '--out', join(evidence, 'baseline-restore.json')], {}, restoreDb);
check('baseline succeeds on the live target and on the restored backup', b1.status === 0 && b2.status === 0, `${b1.msg.slice(0, 40)} | ${b2.msg.slice(0, 40)}`);
const bt = readJson<{ baselineDigest: string }>(join(evidence, 'baseline-target.json')).baselineDigest;
const br = readJson<{ baselineDigest: string }>(join(evidence, 'baseline-restore.json')).baselineDigest;
check('restored backup baseline equals the live baseline', bt === br, bt.slice(0, 16));
const restoreEv = writeJson('restore-report.json', { restoreDatabase: restoreDb, targetBaselineDigest: bt, restoreBaselineDigest: br, capturedAt, restoredAt });
const backupPath = writeJson('backup.json', { target, baselineDigest: br, sha256: sha(dump), restoreEvidenceSha256: sha(restoreEv), capturedAt, restoredAt });

const initial = await counts();
console.log(`initial ${JSON.stringify(initial)}`);
const planArgs = (out: string, actor = '1') => ['plan', '--target', tPath, '--actor-id', actor, '--backup', backupPath, '--backup-file', dump, '--restore-evidence', restoreEv, '--out', join(evidence, out)];

// plan refusals
let r = cli(planArgs('plan-bad-actor.json', '999999'));
check('plan refuses an actor that is not an active Super Admin', r.status !== 0 && !existsSync(join(evidence, 'plan-bad-actor.json')), r.msg.slice(0, 90));
const wrongTarget = writeJson('target-wrong.json', { ...target, systemIdentifier: '1' });
r = cli(['plan', '--target', wrongTarget, '--actor-id', '1', '--backup', backupPath, '--backup-file', dump, '--restore-evidence', restoreEv, '--out', join(evidence, 'plan-wrong-target.json')]);
check('plan refuses a target whose identity is wrong', r.status !== 0, r.msg.slice(0, 90));
r = cli(planArgs('plan-wrong-import.json'), { AFLDB_IMPORT_DATABASE_URL: dsnFor('afldb_v2_gap029_prod_test', process.env.AFLDB_IMPORT_DATABASE_URL!) });
check('plan refuses when the writer connection names another database', r.status !== 0, r.msg.slice(0, 90));
const tamperedBackup = writeJson('backup-tampered.json', { ...readJson<Record<string, unknown>>(backupPath), sha256: 'f'.repeat(64) });
r = cli(['plan', '--target', tPath, '--actor-id', '1', '--backup', tamperedBackup, '--backup-file', dump, '--restore-evidence', restoreEv, '--out', join(evidence, 'plan-bad-backup.json')]);
check('plan refuses backup evidence whose bytes differ', r.status !== 0, r.msg.slice(0, 90));
check('no refusal wrote anything', JSON.stringify(await counts()) === JSON.stringify(initial), JSON.stringify(initial));

r = cli(planArgs('plan.json'));
check('plan succeeds read-only (64 to label)', r.status === 0 && /64 to label/.test(r.msg), r.msg.slice(0, 90));
const plan = readJson<Record<string, any>>(join(evidence, 'plan.json')); // eslint-disable-line @typescript-eslint/no-explicit-any
const approvalFor = (over: Record<string, unknown> = {}) => ({ planDigest: plan.digest, target: plan.target, revision, operation: plan.operation, evidenceSha256: plan.evidenceSha256,
  approvedAt: new Date().toISOString(), expiresAt: plan.expiresAt, reference: 'SYNTHETIC isolated rehearsal approval - never production authority', ...over });
const applyArgs = (planFile: string, approval: string, out: string) => ['apply', '--plan', planFile, '--approval', approval, '--backup-file', dump, '--restore-evidence', restoreEv, '--out', join(evidence, out)];
const goodApproval = writeJson('approval.json', approvalFor());

for (const [name, over] of [['wrong-revision', { revision: 'f'.repeat(40) }], ['expired', { approvedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' }],
  ['no-reference', { reference: '  ' }], ['other-plan', { planDigest: 'a'.repeat(64) }]] as const) {
  r = cli(applyArgs(join(evidence, 'plan.json'), writeJson(`approval-${name}.json`, approvalFor(over)), `refused-${name}.json`));
  check(`apply refuses an approval that is ${name}`, r.status !== 0 && JSON.stringify(await counts()) === JSON.stringify(initial), r.msg.slice(0, 90));
}
const tampered = writeJson('plan-tampered.json', { ...plan, entries: plan.entries.slice(1) });
r = cli(applyArgs(tampered, goodApproval, 'refused-tampered.json'));
check('apply refuses a plan edited after review', r.status !== 0 && JSON.stringify(await counts()) === JSON.stringify(initial), r.msg.slice(0, 90));
r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, 'refused-import-db.json'), { AFLDB_IMPORT_DATABASE_URL: dsnFor('afldb_v2_gap029_prod_test', process.env.AFLDB_IMPORT_DATABASE_URL!) });
check('apply refuses when the audited writer would write to another database', r.status !== 0 && JSON.stringify(await counts()) === JSON.stringify(initial), r.msg.slice(0, 90));
// drift: an unrelated match gains a label after the plan
const [other] = await sql`SELECT id FROM matches WHERE match_event IS NULL AND id <> ALL(${plan.entries.map((e: { matchId: number }) => e.matchId)}) ORDER BY id LIMIT 1`;
await sql`UPDATE matches SET match_event = 'Anzac Day' WHERE id = ${other.id}`;
r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, 'refused-drift.json'));
await sql`UPDATE matches SET match_event = NULL WHERE id = ${other.id}`;
check('apply refuses baseline drift since the plan', r.status !== 0 && /drift/.test(r.msg) && (await counts()).edits === initial.edits, r.msg.slice(0, 90));
// a covered match already carries a DIFFERENT event: the plan must refuse rather than overwrite
const first = plan.entries[0] as { matchId: number; label: string };
const wrongLabel = first.label === 'Anzac Day' ? "King's Birthday" : 'Anzac Day';
await sql`UPDATE matches SET match_event = ${wrongLabel} WHERE id = ${first.matchId}`;
r = cli(planArgs('plan-conflicting-event.json'));
await sql`UPDATE matches SET match_event = NULL WHERE id = ${first.matchId}`;
check('plan refuses when a covered match is changed after the backup (here: it carries a different event; the backup-baseline check fires first)', r.status !== 0 && /different event|baseline drift/.test(r.msg), r.msg.slice(0, 90));

// negative controls: a changed venue identity (different text, case change), and a disabled or demoted actor, each refused with nothing written
const venueId = (plan.entries[0] as { matchId: number }).matchId;
const [venueRow] = await sql`SELECT venue_raw FROM matches WHERE id = ${venueId}`;
// (matches.venue_raw is NOT NULL, so a NULL venue cannot be staged here; the pure check covers NULL in tests/v2-gap029-label-checks.test.ts)
for (const [name, value] of [['a different venue', 'GAP029 e2e changed venue'], ['a case-changed venue', String(venueRow.venue_raw).toLowerCase()]] as const) {
  await sql`UPDATE matches SET venue_raw = ${value} WHERE id = ${venueId}`;
  r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, `refused-venue-${name.replace(/\W+/g, '-')}.json`));
  await sql`UPDATE matches SET venue_raw = ${venueRow.venue_raw} WHERE id = ${venueId}`;
  check(`apply refuses a covered match whose venue identity changed to ${name}`, r.status !== 0 && /expected identity/.test(r.msg) && JSON.stringify(await counts()) === JSON.stringify(initial), r.msg.slice(0, 90));
}
const [actorRow] = await sql`SELECT role::text AS role, disabled_at FROM auth_users WHERE id = 1`;
for (const [name, change] of [['disabled', () => sql`UPDATE auth_users SET disabled_at = now() WHERE id = 1`], ['demoted', () => sql`UPDATE auth_users SET role = 'admin' WHERE id = 1`]] as const) {
  try {
    await change();
    const pr = cli(planArgs(`plan-actor-${name}.json`));
    check(`plan refuses an actor who has been ${name}`, pr.status !== 0 && /not an active Super Admin/.test(pr.msg), pr.msg.slice(0, 90));
    r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, `refused-actor-${name}.json`));
    check(`apply refuses, before any write, when the planned actor has been ${name}`, r.status !== 0 && /not an active Super Admin/.test(r.msg) && JSON.stringify(await counts()) === JSON.stringify(initial), r.msg.slice(0, 90));
  } finally { await sql`UPDATE auth_users SET role = ${actorRow.role}, disabled_at = ${actorRow.disabled_at} WHERE id = 1`; }
}
cli(['baseline', '--target', tPath, '--out', join(evidence, 'baseline-after-controls.json')]);
check('the negative controls left nothing behind (live baseline equals the backup baseline again)', readJson<{ baselineDigest: string }>(join(evidence, 'baseline-after-controls.json')).baselineDigest === bt, '');

// injected failure after 10 labels: partial state, resumable
await sql.unsafe(`CREATE OR REPLACE FUNCTION public.gap029_e2e_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event') >= ${Number(initial.edits) + 10} THEN RAISE EXCEPTION 'gap029 e2e injected failure'; END IF; RETURN NEW; END $$`);
await sql.unsafe('CREATE TRIGGER gap029_e2e_fail_trg BEFORE INSERT ON public.data_edits FOR EACH ROW EXECUTE FUNCTION public.gap029_e2e_fail()');
r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, 'failed-injected.json'));
await sql.unsafe('DROP TRIGGER gap029_e2e_fail_trg ON public.data_edits'); await sql.unsafe('DROP FUNCTION public.gap029_e2e_fail()');
const partial = await counts();
check('an injected audit failure stops the run part-way (10 labels written, audited, consistent)', r.status !== 0 && partial.labelled === String(Number(initial.labelled) + 10) && partial.edits === String(Number(initial.edits) + 10) && partial.overrides === String(Number(initial.overrides) + 10), JSON.stringify(partial));
r = cli(applyArgs(join(evidence, 'plan.json'), goodApproval, 'refused-after-partial.json'));
check('the old plan is refused after the partial write (baseline moved); resume needs a re-plan', r.status !== 0 && (await counts()).edits === partial.edits, r.msg.slice(0, 90));
// A resume always needs a fresh backup, a verified restore, baseline equality, a NEW plan and a NEW approval.
async function cycle(tag: string) {
  const dumpN = join(evidence, `labels-backup-${tag}.dump`);
  const capN = new Date().toISOString();
  if (spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'), ['-Fc', '-Z', '3', '--no-password', '-f', dumpN, database], { env, encoding: 'utf8' }).status !== 0) throw new Error('pg_dump failed');
  const restoreDbN = `${database.replace(/_test$/, '')}_rst${tag}_test`;
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/v2/isolated-pg.ts', 'create-db', restoreDbN], { cwd: root, encoding: 'utf8', env: { ...process.env, AFLDB_V2_ISOLATED_PG: '' } });
  if (spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore'), ['--no-password', '--no-comments', '--no-owner', '-j', '4', '-d', restoreDbN, dumpN], { env, encoding: 'utf8' }).status !== 0) throw new Error('pg_restore failed');
  const resN = new Date().toISOString();
  const rtN = writeJson(`restore-target-${tag}.json`, await identity(restoreDbN));
  cli(['baseline', '--target', tPath, '--out', join(evidence, `baseline-target-${tag}.json`)]);
  cli(['baseline', '--target', rtN, '--out', join(evidence, `baseline-restore-${tag}.json`)], {}, restoreDbN);
  const btN = readJson<{ baselineDigest: string }>(join(evidence, `baseline-target-${tag}.json`)).baselineDigest;
  const brN = readJson<{ baselineDigest: string }>(join(evidence, `baseline-restore-${tag}.json`)).baselineDigest;
  const restoreEvN = writeJson(`restore-report-${tag}.json`, { restoreDatabase: restoreDbN, targetBaselineDigest: btN, restoreBaselineDigest: brN, capturedAt: capN, restoredAt: resN });
  const backupN = writeJson(`backup-${tag}.json`, { target, baselineDigest: brN, sha256: sha(dumpN), restoreEvidenceSha256: sha(restoreEvN), capturedAt: capN, restoredAt: resN });
  const planRun = cli(['plan', '--target', tPath, '--actor-id', '1', '--backup', backupN, '--backup-file', dumpN, '--restore-evidence', restoreEvN, '--out', join(evidence, `plan-${tag}.json`)]);
  const planPath = join(evidence, `plan-${tag}.json`);
  const planN = readJson<Record<string, any>>(planPath); // eslint-disable-line @typescript-eslint/no-explicit-any
  const approvalN = writeJson(`approval-${tag}.json`, { planDigest: planN.digest, target: planN.target, revision, operation: planN.operation, evidenceSha256: planN.evidenceSha256, approvedAt: new Date().toISOString(), expiresAt: planN.expiresAt, reference: 'SYNTHETIC isolated rehearsal approval - never production authority' });
  return { dump: dumpN, restoreEv: restoreEvN, planPath, approval: approvalN, equal: btN === brN, digest: btN, planMsg: planRun.msg, planStatus: planRun.status };
}
const applyEnv = { ...process.env, AFLDB_GAP029_DSN: dsnFor(database) };
const applyWith = (c: Awaited<ReturnType<typeof cycle>>, out: string) => spawnSync(process.execPath, [...CLI, 'apply', '--plan', c.planPath, '--approval', c.approval, '--backup-file', c.dump, '--restore-evidence', c.restoreEv, '--out', join(evidence, out)], { cwd: root, encoding: 'utf8', env: applyEnv });
const lastLine = (x: { stdout?: string | null; stderr?: string | null }) => `${x.stdout ?? ''}${x.stderr ?? ''}`.trim().split('\n').filter(Boolean).pop() ?? '';

console.log('RESUME 1: fresh backup and restore, new plan, new approval');
const c2 = await cycle('2');
check('second restore baseline equals the live baseline (and differs from the first)', c2.equal && c2.digest !== bt, c2.digest.slice(0, 16));
check('re-plan shows 54 to label and 10 already labelled', c2.planStatus === 0 && /54 to label, 10 already labelled/.test(c2.planMsg), c2.planMsg.slice(0, 90));

// the actor is disabled WHILE the run is writing: it must stop at the next label boundary, consistent and resumable
await sql.unsafe(`CREATE OR REPLACE FUNCTION public.gap029_e2e_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event') >= ${Number(initial.edits) + 20} THEN UPDATE auth_users SET disabled_at = now() WHERE id = 1; END IF; RETURN NEW; END $$`);
await sql.unsafe('CREATE TRIGGER gap029_e2e_revoke_trg AFTER INSERT ON public.data_edits FOR EACH ROW EXECUTE FUNCTION public.gap029_e2e_revoke()');
const midRun = applyWith(c2, 'failed-actor-revoked.json');
await sql.unsafe('DROP TRIGGER gap029_e2e_revoke_trg ON public.data_edits'); await sql.unsafe('DROP FUNCTION public.gap029_e2e_revoke()');
const partial2 = await counts();
const [revoked] = await sql`SELECT disabled_at IS NOT NULL AS disabled FROM auth_users WHERE id = 1`;
check('an actor disabled mid-run stops the run at the next label boundary (20 labels written, audited, consistent)', midRun.status !== 0 && revoked.disabled === true && /not an active Super Admin/.test(lastLine(midRun))
  && partial2.labelled === String(Number(initial.labelled) + 20) && partial2.edits === String(Number(initial.edits) + 20) && partial2.overrides === String(Number(initial.overrides) + 20), `${lastLine(midRun).slice(0, 70)} ${JSON.stringify(partial2)}`);
await sql`UPDATE auth_users SET role = ${actorRow.role}, disabled_at = ${actorRow.disabled_at} WHERE id = 1`;

console.log('RESUME 2: fresh backup and restore, new plan, new approval');
const c3 = await cycle('3');
check('third restore baseline equals the live baseline', c3.equal && c3.digest !== c2.digest, c3.digest.slice(0, 16));
check('re-plan shows 44 to label and 20 already labelled', c3.planStatus === 0 && /44 to label, 20 already labelled/.test(c3.planMsg), c3.planMsg.slice(0, 90));
const finish = applyWith(c3, 'result.json');
const done = await counts();
const dist = await sql<{ match_event: string; n: number }[]>`SELECT match_event, count(*)::int AS n FROM matches WHERE match_event IS NOT NULL GROUP BY 1 ORDER BY 1`;
check('resumed apply finishes: 64 labelled, 64 audit rows, 64 active overrides added in total', finish.status === 0 && done.labelled === String(Number(initial.labelled) + 64) && done.edits === String(Number(initial.edits) + 64) && done.overrides === String(Number(initial.overrides) + 64), JSON.stringify(done));
check('distribution is Anzac 31 / Dreamtime 22 / King\'s Birthday 11', JSON.stringify(dist.map((d) => [d.match_event, d.n])) === JSON.stringify([['Anzac Day', 31], ["Dreamtime at the 'G", 22], ["King's Birthday", 11]]), JSON.stringify(dist));
const result = readJson<{ written: number; verify: { allLabelled: boolean; auditRowsAdded: number; overridesAdded: number } }>(join(evidence, 'result.json'));
check('result records 44 written and a verified outcome', result.written === 44 && result.verify.allLabelled && result.verify.auditRowsAdded === 44 && result.verify.overridesAdded === 44, JSON.stringify(result.verify));
const replay = applyWith(c3, 'replay.json');
check('replay of the same plan and approval writes nothing', replay.status === 0 && JSON.stringify(await counts()) === JSON.stringify(done) && readJson<{ replay: boolean }>(join(evidence, 'replay.json')).replay === true, '');

const failed = checks.filter((c) => !c.pass);
writeFileSync(join(evidence, 'report.json'), `${JSON.stringify({ database, revision, checks, failed: failed.length }, null, 2)}\n`, { flag: 'wx' });
console.log(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`);
await sql.end({ timeout: 5 });
if (failed.length) process.exitCode = 1;
void r;
