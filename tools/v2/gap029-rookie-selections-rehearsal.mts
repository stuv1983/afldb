/** V2-GAP-029: rehearsal and negative controls for tools/v2/gap029-rookie-selections-production.ts, on an ISOLATED production-derived clone only.
 *
 *   isolated-pg run <afldb_v2_*_test> -- node --import tsx --conditions=react-server tools/v2/gap029-rookie-selections-rehearsal.mts <outDir>
 *
 * Every negative control runs the REAL tool as a child process and must (a) exit non-zero with the expected refusal text and (b) leave the
 * draft_picks/data_overrides surface exactly as it was. The only writes outside the tool are clone-local fixtures a control needs
 * (extra auth_users rows, one pick-number nudge, one trigger), each restored or dropped, and refused outright on a non-isolated database.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { approvalProblem, entryProblem, planDigest, type Plan } from './gap029-rookie-selections-production';

const TOOL = 'tools/v2/gap029-rookie-selections-production.ts';
const out = process.argv[2];
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const importDsn = process.env.AFLDB_IMPORT_DATABASE_URL ?? '';
if (!out || process.env.AFLDB_V2_ISOLATED_PG !== '1' || !/\/afldb_v2_[a-z0-9_]+_test$/.test(ownerDsn)) throw new Error('isolated afldb_v2_*_test target and an output directory required');
mkdirSync(out, { recursive: true });
const owner = postgres(ownerDsn, { max: 1, onnotice: () => {} });
const u = new URL(ownerDsn);
const [facts] = await owner<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
  current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment" FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
const target = { host: u.hostname, port: Number(u.port), ...facts };
writeFileSync(join(out, 'target.json'), JSON.stringify(target, null, 2));
let seq = 0;
const results: { control: string; expected: string; exit: number | null; matched: boolean; surfaceUnchanged: boolean | null }[] = [];

const surface = async () => {
  const [p] = await owner`SELECT count(*)::int n, md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) d FROM draft_picks t`;
  const [o] = await owner`SELECT count(*)::int n, md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)) d FROM data_overrides t WHERE entity_type = 'draft_picks'`;
  const [e] = await owner`SELECT count(*)::int n FROM data_edits WHERE field_group = 'draft_selection'`;
  return JSON.stringify([p, o, e]);
};
const run = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--conditions=react-server', TOOL, ...args], { env: { ...process.env, AFLDB_GAP029_DSN: ownerDsn, AFLDB_GAP029_WRITE_DSN: importDsn, ...env }, encoding: 'utf8' });
  return { status: r.status, text: `${r.stdout}${r.stderr}`.trim() };
};
const file = (name: string) => join(out, `${String(++seq).padStart(2, '0')}-${name}`);
const control = async (name: string, expected: string, args: string[], env: Record<string, string> = {}) => {
  const before = await surface();
  const r = run(args, env);
  const after = await surface();
  const matched = r.status !== 0 && r.text.includes(expected);
  results.push({ control: name, expected, exit: r.status, matched, surfaceUnchanged: before === after });
  console.log(`${matched && before === after ? 'PASS' : 'FAIL'} ${name}: exit ${r.status}; ${r.text.split('\n')[0].slice(0, 160)}`);
};
const planFor = (actor: number, name: string): string => {
  const p = file(`plan-${name}.json`);
  const r = run(['plan', '--target', join(out, 'target.json'), '--actor-user-id', String(actor), '--rehearsal', '--out', p]);
  if (r.status !== 0) throw new Error(`plan ${name} failed: ${r.text}`);
  return p;
};
const rewrite = (planPath: string, name: string, mutate: (p: Plan) => void, redigest = true): string => {
  const p = JSON.parse(readFileSync(planPath, 'utf8')) as Plan;
  mutate(p);
  if (redigest) { const { digest: _d, ...body } = p; p.digest = planDigest(body); }
  const q = file(`plan-${name}.json`); writeFileSync(q, JSON.stringify(p, null, 2)); return q;
};
const applyArgs = (planPath: string, name: string) => ['apply', '--plan', planPath, '--rehearsal', '--out', file(`apply-${name}.json`)];
const must = (cond: boolean, why: string) => { if (!cond) { console.log(`FAIL ${why}`); results.push({ control: why, expected: 'true', exit: null, matched: false, surfaceUnchanged: null }); } };

try {
  // fixtures local to this clone: a disabled fully-enrolled Super Admin
  await owner`INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) VALUES ('rehearsal-disabled@gap029-rehearsal.net', 'super_admin', 'x$1$1$1$x', 'JBSWY3DPEHPK3PXP', now()) ON CONFLICT (email) DO NOTHING`;
  const [dis] = await owner<{ id: number }[]>`SELECT id::int FROM auth_users WHERE email = 'rehearsal-disabled@gap029-rehearsal.net'`;
  const [real] = await owner<{ id: number }[]>`SELECT id::int FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL AND password_hash IS NOT NULL AND totp_secret IS NOT NULL AND email NOT LIKE '%.invalid' ORDER BY id LIMIT 1`;
  const actor = real.id;
  const base = run(['baseline', '--target', join(out, 'target.json'), '--rehearsal', '--out', file('baseline-0.json')]);
  console.log(base.text);
  const good = planFor(actor, 'good');
  const goodPlan = JSON.parse(readFileSync(good, 'utf8')) as Plan;
  must(goodPlan.entries.length === 8 && goodPlan.entries.every((e) => e.action === 'to insert'), 'good plan: 8 to insert');

  // ---- plan-stage controls
  await control('plan: non-numeric actor refused', 'actor-user-id must be a real auth_users id', ['plan', '--target', join(out, 'target.json'), '--actor-user-id', 'abc', '--rehearsal', '--out', file('x.json')]);
  const wrong = join(out, 'wrong-target.json'); writeFileSync(wrong, JSON.stringify({ ...target, database: 'afldb_v2_not_this_test' }));
  await control('plan: wrong target refused before any connection', 'wrong target', ['plan', '--target', wrong, '--actor-user-id', String(actor), '--rehearsal', '--out', file('x.json')]);
  await control('plan: an isolated clone is not accepted as a production plan', 'an isolated clone is rehearsed with --rehearsal', ['plan', '--target', join(out, 'target.json'), '--actor-user-id', String(actor), '--out', file('x.json')]);

  // ---- apply-stage controls: actor
  for (const [label, id] of [['admin role (not Super Admin)', 2], ['second admin role, test.com.tst domain', 3], ['contributor', 4], ['Super Admin with example.invalid domain, no password/TOTP', 5], ['disabled Super Admin', dis.id], ['non-existent user', 999999]] as const) {
    const p = planFor(id, `actor-${id}`);
    await control(`apply: actor refused: ${label}`, `actor ${id} is not a viable Super Admin`, applyArgs(p, `actor-${id}`));
  }
  // ---- apply-stage controls: binding
  await control('apply: tampered plan refused', 'plan digest differs from its content', applyArgs(rewrite(good, 'tamper', (p) => { p.entries[0].pick = 99; }, false), 'tamper'));
  await control('apply: stale plan refused', 'stale plan', applyArgs(rewrite(good, 'stale', (p) => { p.expiresAt = new Date(Date.now() - 1000).toISOString(); }), 'stale'));
  await control('apply: wrong revision refused', 'plan operation, evidence or revision differs', applyArgs(rewrite(good, 'rev', (p) => { p.revision = '0'.repeat(40); }), 'rev'));
  await control('apply: changed evidence refused', 'plan operation, evidence or revision differs', applyArgs(rewrite(good, 'ev', (p) => { p.evidenceSha256 = '0'.repeat(64); }), 'ev'));
  await control('apply: wrong operation refused', 'plan operation, evidence or revision differs', applyArgs(rewrite(good, 'op', (p) => { p.operation = 'something-else'; }), 'op'));
  await control('apply: writer must be afldb_import', 'the write connection must be the afldb_import role', applyArgs(good, 'owner-writer'), { AFLDB_GAP029_WRITE_DSN: ownerDsn });
  const otherDb = new URL(importDsn); otherDb.pathname = '/postgres';
  await control('apply: write DSN naming another database refused', 'wrong target', applyArgs(good, 'other-db'), { AFLDB_GAP029_WRITE_DSN: otherDb.toString() });
  // ---- drift between plan and apply
  const [victim] = await owner<{ id: number; detail: string | null }[]>`SELECT id::int, detail FROM draft_picks WHERE draft_kind = 'rookie' ORDER BY id LIMIT 1`;
  await owner`UPDATE draft_picks SET detail = coalesce(detail,'') || ' drift' WHERE id = ${victim.id}`;
  await control('apply: baseline drift after planning refused', 'baseline drift', applyArgs(good, 'drift'));
  await owner`UPDATE draft_picks SET detail = ${victim.detail} WHERE id = ${victim.id}`;
  // ---- conflict: another player already holds the 2018 rookie pick 2 slot (nudge one row, restore it)
  const [other] = await owner<{ id: number; pick_number: number }[]>`SELECT id::int, pick_number::int FROM draft_picks WHERE draft_kind = 'rookie' AND draft_year = 2018 AND pick_number IS NOT NULL AND player_id IS DISTINCT FROM 9575 ORDER BY id LIMIT 1`;
  await owner`UPDATE draft_picks SET pick_number = 2 WHERE id = ${other.id}`;
  await control('plan: pick held by another player refused', 'is held by selection', ['plan', '--target', join(out, 'target.json'), '--actor-user-id', String(actor), '--rehearsal', '--out', file('x.json')]);
  await owner`UPDATE draft_picks SET pick_number = ${other.pick_number} WHERE id = ${other.id}`;
  // ---- the sealed-season guard is live on this exact code path: a too-short note on a sealed season rolls back
  {
    process.env.DATABASE_URL = ownerDsn; process.env.AFLDB_AUTH_DATABASE_URL = ownerDsn;
    const { createManualPickInTransaction } = await import('../../src/db/queries/admin-draft');
    const imp = postgres(importDsn, { max: 1, onnotice: () => {} });
    const before = await surface();
    let refusal = '';
    try {
      await imp.begin(async (tx) => {
        await createManualPickInTransaction(tx, { playerId: 9575, adminUserId: actor, draftYear: 2018, draftType: 'Rookie', draftKind: 'rookie', pickNumber: 2, clubSlug: 'gold-coast', detail: 'x', note: 'too short' });
      });
    } catch (e) { refusal = e instanceof Error ? e.message : String(e); }
    await imp.end({ timeout: 5 });
    const ok = /sealed/.test(refusal) && before === await surface();
    results.push({ control: 'sealed season: a note under 20 characters is refused on the shared editor path and rolls back', expected: 'sealed', exit: null, matched: ok, surfaceUnchanged: before === await surface() });
    console.log(`${ok ? 'PASS' : 'FAIL'} sealed-season note control: ${refusal.slice(0, 120)}`);
  }
  // ---- atomicity: the 8th insert fails inside the editor; nothing from the first seven may remain
  await owner.unsafe(`CREATE OR REPLACE FUNCTION public.gap029_rehearsal_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.player_name_raw = 'Bryce Gibbs' THEN RAISE EXCEPTION 'rehearsal fault on the eighth insert'; END IF; RETURN NEW; END $f$`);
  await owner.unsafe('CREATE TRIGGER gap029_rehearsal_fail BEFORE INSERT ON draft_picks FOR EACH ROW EXECUTE FUNCTION public.gap029_rehearsal_fail()');
  await control('apply: fault on the 8th insert rolls back all eight (atomic)', 'refused or failed', applyArgs(good, 'atomic'));
  await owner.unsafe('DROP TRIGGER gap029_rehearsal_fail ON draft_picks');
  await owner.unsafe('DROP FUNCTION public.gap029_rehearsal_fail()');

  // ---- the real apply, then verify, replay and parity
  const beforeApply = await surface();
  const ap = run(applyArgs(good, 'real'));
  console.log(ap.text);
  const applyFile = join(out, readdirLast(out, 'apply-real'));
  const applyRecord = JSON.parse(readFileSync(applyFile, 'utf8'));
  must(ap.status === 0 && applyRecord.written === 8, 'real apply wrote 8');
  const v = run(['verify', '--plan', good, '--apply-record', applyFile, '--out', file('verify.json')], { AFLDB_GAP029_AUDIT_DSN: ownerDsn });
  console.log(v.text);
  const audit = await owner`SELECT d.id::int, d.row_id::int AS player_id, d.admin_user_id::int AS actor, length(d.note)::int AS note_len, d.new_values ->> 'pick_number' AS pick, d.new_values ->> 'draft_year' AS year
    FROM data_edits d WHERE d.table_name = 'players' AND d.field_group = 'draft_selection' AND d.note LIKE 'V2-GAP-029 owner-approved correction%' ORDER BY d.id`;
  must(audit.length === 8 && audit.every((a) => a.actor === actor && a.note_len >= 20), 'eight data_edits rows by the named actor with notes >= 20');
  const replayPlan = planFor(actor, 'replay');
  const rp = JSON.parse(readFileSync(replayPlan, 'utf8')) as Plan;
  must(rp.entries.every((e) => e.action === 'already present'), 'replay plan: all already present');
  const rr = run(applyArgs(replayPlan, 'replay'));
  console.log(rr.text);
  must(rr.status === 0 && /nothing written/.test(rr.text), 'replay apply writes nothing');
  await control('apply: the first plan cannot be replayed after commit', 'baseline drift', applyArgs(good, 'stale-after-commit'));
  const rows = await owner`SELECT dp.id::int, dp.player_id::int, dp.draft_year::int, dp.draft_type, dp.draft_kind::text, dp.pick_number::int, dp.club_id::int, so.key AS source, dp.link_status_value::text AS link, dp.match_method FROM draft_picks dp JOIN sources so ON so.id = dp.source_id WHERE dp.id = ANY(${applyRecord.created.map((c: { pickId: number }) => c.pickId)}) ORDER BY dp.id`;
  const overrides = await owner`SELECT count(*)::int n FROM data_overrides WHERE entity_type = 'draft_picks' AND field_group = 'selection' AND is_active AND (override_values ->> 'detail') LIKE 'V2-GAP-029;%' AND admin_user_id = ${actor}`;
  // pure-function controls (no database): approvals bind to the plan
  const prod: Plan = { ...goodPlan, rehearsal: false, backup: { target: goodPlan.target, sha256: 'a', restoreEvidenceSha256: 'b', capturedAt: new Date().toISOString(), restoredAt: new Date().toISOString(), baselineDigest: goodPlan.baselineDigest }, digest: '' };
  { const { digest: _d, ...body } = prod; prod.digest = planDigest(body); }
  const ctx = { now: Date.now() + 1000, revision: prod.revision, evidenceSha256: prod.evidenceSha256 };
  const approval = { planDigest: prod.digest, target: prod.target, revision: prod.revision, operation: prod.operation, evidenceSha256: prod.evidenceSha256, actorUserId: prod.actorUserId,
    approvedAt: new Date().toISOString(), expiresAt: prod.expiresAt, reference: 'rehearsal reference' };
  const approvalControls: [string, boolean][] = [
    ['approval binds', approvalProblem(prod, approval, ctx) === null],
    ['approval: other plan digest refused', approvalProblem(prod, { ...approval, planDigest: 'f'.repeat(64) }, ctx) !== null],
    ['approval: other actor refused', approvalProblem(prod, { ...approval, actorUserId: approval.actorUserId + 1 }, ctx) !== null],
    ['approval: other target refused', approvalProblem(prod, { ...approval, target: { ...approval.target, databaseOid: '1' } }, ctx) !== null],
    ['approval: other revision refused', approvalProblem(prod, { ...approval, revision: '1'.repeat(40) }, ctx) !== null],
    ['approval: other evidence refused', approvalProblem(prod, { ...approval, evidenceSha256: '2'.repeat(64) }, ctx) !== null],
    ['approval: expired refused', approvalProblem(prod, { ...approval, expiresAt: new Date(Date.now() - 1).toISOString() }, ctx) !== null],
    ['approval: outlives plan refused', approvalProblem(prod, { ...approval, expiresAt: new Date(Date.parse(prod.expiresAt) + 1000).toISOString() }, ctx) !== null],
    ['approval: missing refused', approvalProblem(prod, null, ctx) !== null],
    ['approval: blank reference refused', approvalProblem(prod, { ...approval, reference: ' ' }, ctx) !== null],
  ];
  for (const [name, ok] of approvalControls) { results.push({ control: name, expected: 'pure', exit: null, matched: ok, surfaceUnchanged: null }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); }
  void entryProblem;
  const summary = { target: { database: target.database, systemIdentifier: target.systemIdentifier }, actor, planDigest: goodPlan.digest, surfaceBeforeApply: beforeApply, rows, overrides: overrides[0].n, audit,
    controls: results, allPassed: results.every((r) => r.matched && r.surfaceUnchanged !== false) };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`${summary.allPassed ? 'ALL CONTROLS PASSED' : 'CONTROL FAILURE'}: ${results.filter((r) => r.matched).length}/${results.length}`);
  process.exitCode = summary.allPassed ? 0 : 1;
} finally {
  await owner.end({ timeout: 5 });
}

function readdirLast(dir: string, marker: string): string {
  const f = readdirSync(dir).filter((n) => n.includes(marker)).sort().pop();
  if (!f) throw new Error(`no ${marker} file`);
  return f;
}
