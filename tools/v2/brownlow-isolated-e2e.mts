/**
 * ISOLATED end-to-end rehearsal of the ordered Brownlow production workflow
 * (docs/v2/brownlow-ordered-execution-package-2026-11-01.md): observe -> backfill -> adopt -> resolve checkpoint
 * -> eligibility -> acceptance, driven through the REAL runner CLI (`tools/v2/brownlow-production-correction.ts`),
 * never through mocked SQL and never by bypassing a production guard.
 *
 *   node tools/v2/isolated-pg.ts run afldb_v2_bro_<label>_test -- \
 *     node --import tsx --conditions=react-server tools/v2/brownlow-isolated-e2e.mts <new-evidence-dir-outside-checkout>
 *
 * Authority. The runner's only DSN input is `AFLDB_BROWNLOW_CORRECTION_DSN`; this driver binds it, for its child
 * processes only, to the isolated database the launcher proved (`AFLDB_TEST_DATABASE_URL`), and writes a target.json
 * from that database's live identity. Nothing here can name a shared or production target: the launcher guard, the
 * `afldb_v2_bro_*_test` name and the loopback isolated port are all required before any command runs.
 *
 * Per stage it takes a REAL backup (pg_dump -Fc) of the target, restores it into a second isolated database, takes the
 * runner's `baseline` of both and requires the digests to be equal, then plan -> approval -> apply -> replay, with
 * SQL read-backs of the package's acceptance checks and receipts. Refusals and a rolled-back apply are exercised.
 * The approval reference says SYNTHETIC / isolated rehearsal; none of it is production authority. The pinned
 * 2025 snapshot is copied (hash-checked) into the checkout's git-ignored data/sources directory, as the package says.
 *
 * Output: <evidence>/report.json (counts, digests, statuses; no DSN or secret), plus every plan/approval/result file.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import postgres from 'postgres';

const root = process.cwd();
const [evidenceArg] = process.argv.slice(2);
if (!evidenceArg) throw new Error('usage: brownlow-isolated-e2e.mts <new-evidence-dir>');
const evidence = resolve(evidenceArg);
const rel = relative(root, evidence);
if (!rel.startsWith('..') || isAbsolute(rel)) throw new Error('Evidence must be outside the checkout');
if (existsSync(evidence)) throw new Error('Evidence directory exists; evidence is never overwritten');
if (process.env.AFLDB_V2_ISOLATED_PG !== '1') throw new Error('Isolated launcher required');
const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const url = new URL(ownerDsn);
const database = decodeURIComponent(url.pathname.slice(1));
if (!/^afldb_v2_bro_.+_test$/.test(database) || url.hostname !== '127.0.0.1') throw new Error('A dedicated afldb_v2_bro_*_test isolated target is required');
const pgBin = process.env.AFLDB_V2_PG_BIN ?? '';
if (!pgBin) throw new Error('AFLDB_V2_PG_BIN required');
mkdirSync(evidence, { recursive: false });

const CLI = ['--import', 'tsx', '--conditions=react-server', 'tools/v2/brownlow-production-correction.ts'];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const writeJson = (name: string, value: unknown): string => {
  const path = join(evidence, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return path;
};
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const dsnFor = (db: string): string => { const u = new URL(ownerDsn); u.pathname = `/${db}`; return u.toString(); };
const sql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report: Record<string, unknown> = { database, revision, startedAt: new Date().toISOString(), stages: {} as Record<string, unknown> };
const log: string[] = [];
const say = (line: string) => { log.push(line); console.log(line); };
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

/** Run the real CLI against `db`. Returns status and the last stdout/stderr line only (no DSN is ever echoed). */
function cli(db: string, args: string[]): { status: number; out: string; msg: string } {
  const result = spawnSync(process.execPath, [...CLI, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, AFLDB_BROWNLOW_CORRECTION_DSN: dsnFor(db) }, maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').filter(Boolean).pop() ?? '';
  const clean = text.replace(/postgres(ql)?:\/\/\S+/g, '<dsn>');
  return { status: result.status ?? -1, out: clean, msg: clean };
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

const state = async () => (await sql<Record<string, string>[]>`
  SELECT (SELECT count(*) FROM brownlow_correction_receipts)::text AS receipts,
         (SELECT count(*) FROM import_batches)::text AS batches,
         (SELECT count(*) FROM canonical_applications)::text AS applications,
         (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY id)) FROM brownlow_round_votes r)::text AS votes,
         (SELECT md5(string_agg(to_jsonb(r)::text, '|' ORDER BY id)) FROM brownlow_round_votes r WHERE season = 2026)::text AS "votes2026",
         (SELECT count(*) FROM brownlow_round_votes WHERE season = 2026)::text AS "n2026",
         (SELECT md5(string_agg((to_jsonb(r) - 'match_id')::text, '|' ORDER BY id)) FROM brownlow_round_votes r)::text AS "votesNoMatch",
         (SELECT md5(string_agg(concat_ws(',', season, player_id, round_number, votes, match_id), '|' ORDER BY id)) FROM brownlow_round_votes)::text AS "votesCore"`)[0];
const scalar = async (text: string): Promise<string> => String(Object.values((await sql.unsafe(text))[0] ?? {})[0] ?? 'null');

const initial = await state();
report.initial = initial;
say(`target ${database}; revision ${revision}; initial ${JSON.stringify(initial)}`);
const ledger = await scalar('SELECT max(name) FROM afldb_meta.schema_migrations');
check('migration ledger latest is 117 and the receipt ledger is empty', ledger.startsWith('117') && initial.receipts === '0', ledger);
const actor = Number(await scalar("SELECT min(id) FROM auth_users WHERE role::text = 'super_admin' AND disabled_at IS NULL"));
check('an active Super Admin exists for the eligibility actor', actor >= 1, `actorId=${actor}`);

const fixtureObs = await scalar("SELECT count(*) FROM staging.source_records r JOIN sources s ON s.id = r.source_id WHERE s.key = 'afl_api' AND r.family = 'match' AND r.scope_key = 'season=2025'");
const seeded = await scalar("SELECT count(*) FROM import_batches WHERE tool = 'brownlow-isolated-seed-2025-fixture-observations.mts'");
report.fixtureObservationPrerequisite = { initialMatch2025Observations: fixtureObs, simulatedSeedBatches: seeded, route: 'AUTHENTIC: governed stage B0 (observe + stage fixture-identities-2025) of the retained provider snapshot afl-api-2025-2026-10-20-014218; nothing is seeded or copied from another database' };
check('prerequisite starts EMPTY, as on production: no 2025 afl_api match observations and no simulated seed batch', fixtureObs === '0' && seeded === '0', `observations=${fixtureObs} seedBatches=${seeded}`);

// ---- snapshot placement (pinned, hash-checked) -----------------------------------------------------------------
const LABEL = 'afl-api-brownlow-2025-2026-10-20-014218';
const ARTIFACTS = (process.env.AFLDB_BRO_ARTIFACT_ROOT ?? 'D:/tmp/afldb-gap006-brownlow-artifacts-20261101').split(String.fromCharCode(92)).join('/');
const SNAP_SRC = `${ARTIFACTS}/acq-x/${LABEL}`;
const FIX_LABEL = 'afl-api-2025-2026-10-20-014218';
const FIX_SRC = `${ARTIFACTS}/fixture-root-x/fixture-root/data/sources/afl_api/fixtures/${FIX_LABEL}`;
const FIX_DST = join(root, 'data', 'sources', 'afl_api', 'fixtures', FIX_LABEL);
const SNAP_DST = join(root, 'data', 'sources', 'afl_api', 'brownlow', LABEL);
const snapFiles = readdirSync(SNAP_SRC).sort();
if (!existsSync(SNAP_DST)) { mkdirSync(join(root, 'data', 'sources', 'afl_api', 'brownlow'), { recursive: true }); cpSync(SNAP_SRC, SNAP_DST, { recursive: true }); }
const manifestSha = sha(join(SNAP_DST, 'manifest.json'));
check('pinned snapshot placed and manifest hash matches the package', manifestSha === '43dec3ee84e2bd622a9d33899eb16896487d5344f5225eaa819b5a1262bb47f3', manifestSha.slice(0, 12));
if (!existsSync(FIX_DST)) { mkdirSync(join(root, 'data', 'sources', 'afl_api', 'fixtures'), { recursive: true }); cpSync(FIX_SRC, FIX_DST, { recursive: true }); }
const fixManifestSha = sha(join(FIX_DST, 'manifest.json'));
check('retained 2025 FIXTURES snapshot placed; manifest hash equals the reviewed pin', fixManifestSha === '46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36', fixManifestSha.slice(0, 12));
check('every snapshot file is byte-identical to the retained copy', snapFiles.every((f) => sha(join(SNAP_SRC, f)) === sha(join(SNAP_DST, f))), snapFiles.join(','));

// ---- per-stage machinery ----------------------------------------------------------------------------------------
async function freshBackup(stage: string) {
  const dump = join(evidence, `${stage}-backup.dump`);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
  const capturedAt = new Date().toISOString();
  const d = spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'), ['-Fc', '-Z', '3', '--no-password', '-f', dump, database], { env, encoding: 'utf8' });
  if (d.status !== 0) throw new Error(`pg_dump failed: ${(d.stderr ?? '').slice(-200)}`);
  const restoreDb = `${database.replace(/_test$/, '')}_${stage.replace(/[^a-z0-9]+/gi, '_')}_rst_test`;
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/v2/isolated-pg.ts', 'create-db', restoreDb], { cwd: root, encoding: 'utf8', env: { ...process.env, AFLDB_V2_ISOLATED_PG: '' } });
  const r = spawnSync(join(pgBin, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore'), ['--no-password', '--no-comments', '--no-owner', '-j', '4', '-d', restoreDb, dump], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`pg_restore failed: ${(r.stderr ?? '').slice(-300)}`);
  const restoredAt = new Date().toISOString();
  const targetBase = await identity(database);
  const restoreTarget = await identity(restoreDb);
  const t1 = writeJson(`${stage}-target.json`, targetBase);
  const t2 = writeJson(`${stage}-restore-target.json`, restoreTarget);
  const b1 = cli(database, ['baseline', '--target', t1, '--out', join(evidence, `${stage}-baseline-target.json`)]);
  const b2 = cli(restoreDb, ['baseline', '--target', t2, '--out', join(evidence, `${stage}-baseline-restore.json`)]);
  if (b1.status || b2.status) throw new Error(`baseline failed: ${b1.out} | ${b2.out}`);
  const bt = readJson<{ baselineDigest: string }>(join(evidence, `${stage}-baseline-target.json`)).baselineDigest;
  const br = readJson<{ baselineDigest: string }>(join(evidence, `${stage}-baseline-restore.json`)).baselineDigest;
  check(`${stage}: restored backup baseline equals the live target baseline`, bt === br, bt.slice(0, 16));
  const restoreEvidence = writeJson(`${stage}-restore-report.json`, { restoreDatabase: restoreDb, restoredFrom: `${stage}-backup.dump`, targetBaselineDigest: bt, restoreBaselineDigest: br, capturedAt, restoredAt });
  const backup = { target: targetBase, baselineDigest: br, sha256: sha(dump), restoreEvidenceSha256: sha(restoreEvidence), capturedAt, restoredAt };
  return { dump, restoreEvidence, backupPath: writeJson(`${stage}-backup.json`, backup), targetPath: t1, baselineDigest: bt, restoreDb };
}

type Request = Record<string, unknown>;
function approvalFor(plan: Record<string, any>, over: Record<string, unknown> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    planDigest: plan.digest, target: plan.target, revision, operation: plan.request.operation, seasons: plan.request.seasons,
    source: String(plan.request.operation).endsWith('backfill') ? 'legacy' : 'afl_api',
    approvedAt: new Date().toISOString(), expiresAt: plan.expiresAt,
    reference: 'SYNTHETIC isolated rehearsal approval - never production authority', rulings: plan.request.rulings, stage: plan.request.stage, ...over,
  };
}

const snapshotArgs = (request: Request) => (request.operation === 'observe' ? ['--snapshot-label', request.stage ? FIX_LABEL : LABEL] : []);

async function planStage(stage: string, request: Request, b: Awaited<ReturnType<typeof freshBackup>>, tag = 'plan') {
  const requestPath = writeJson(`${stage}-${tag}-request.json`, request);
  const out = join(evidence, `${stage}-${tag}.json`);
  const r = cli(database, ['plan', '--target', b.targetPath, '--request', requestPath, '--backup', b.backupPath, '--backup-file', b.dump, '--restore-evidence', b.restoreEvidence, '--out', out, ...snapshotArgs(request)]);
  return { status: r.status, msg: r.out, out };
}
function applyStage(stage: string, planPath: string, approvalPath: string, b: Awaited<ReturnType<typeof freshBackup>>, request: Request, tag: string) {
  const out = join(evidence, `${stage}-${tag}.json`);
  const r = cli(database, ['apply', '--plan', planPath, '--approval', approvalPath, '--backup-file', b.dump, '--restore-evidence', b.restoreEvidence, '--out', out, ...snapshotArgs(request)]);
  return { status: r.status, msg: r.out, out };
}
const unchanged = async (before: Record<string, string>, name: string) => {
  const after = await state();
  check(`${name}: state unchanged (receipts, batches, applications, all vote rows)`, JSON.stringify(after) === JSON.stringify(before), `receipts=${after.receipts}`);
};

const stages = report.stages as Record<string, unknown>;

// ================= B0: governed 2025 fixture-identity prerequisite (authentic retained snapshot) ===================
const CANON = ['matches', 'players', 'player_match_stats', 'player_career_stats', 'brownlow_round_votes', 'brownlow_season_votes', 'award_winners',
  'external_identities', 'canonical_applications', 'brownlow_eligibility_decisions', 'brownlow_season_authority', 'sources', 'site_settings', 'auth_users', 'data_edits'];
const canon = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const t of CANON) out[t] = await scalar(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(md5(to_jsonb(x)::text), '|' ORDER BY md5(to_jsonb(x)::text)), '')) FROM ${t} x`);
  return out;
};
const OBS_FP_SQL = `SELECT count(*)::text || ':' || md5(coalesce(string_agg(r.external_record_id || '=' || v.payload_hash, '|' ORDER BY r.external_record_id), ''))
  FROM staging.source_records r JOIN sources s ON s.id = r.source_id
  JOIN staging.source_record_versions v ON (v.source_id, v.family, v.external_record_id, v.version_seq) = (r.source_id, r.family, r.external_record_id, r.current_version_seq)
  WHERE s.key = 'afl_api' AND r.family = 'match' AND r.scope_key = 'season=2025'`;
const obsFingerprint = async (): Promise<string> => scalar(OBS_FP_SQL);
{
  const stage = 'b0-fixture-identities';
  const request: Request = { operation: 'observe', seasons: [2025], stage: 'fixture-identities-2025' };
  const b = await freshBackup(stage);
  const plan = await planStage(stage, request, b);
  check(`${stage}: plan succeeds read-only against the retained pinned snapshot`, plan.status === 0, plan.msg.slice(0, 80));
  const planDoc = readJson<Record<string, any>>(plan.out); // eslint-disable-line @typescript-eslint/no-explicit-any
  const obs = planDoc.request.observation as Record<string, unknown>;
  check(`${stage}: the plan binds the pinned manifest, 212 built records and the four finals refusals`, obs.manifestSha256 === fixManifestSha && obs.builtRecords === 212 && (obs.refusedProviderMatchIds as string[]).length === 4, `records=${obs.builtRecords} digest=${String(obs.recordsDigest).slice(0, 12)}`);
  const before = await state(); const canonBefore = await canon();
  const goodApproval = writeJson(`${stage}-approval.json`, approvalFor(planDoc));

  // refusals: nothing may change
  const noStage = writeJson(`${stage}-approval-no-stage.json`, approvalFor(planDoc, { stage: undefined }));
  let r = applyStage(stage, plan.out, noStage, b, request, 'refused-no-stage');
  check(`${stage}: refuses an approval that does not name the stage`, r.status !== 0 && /stage/.test(r.msg), r.msg.slice(0, 110)); await unchanged(before, `${stage}/no-stage`);
  const otherLabel = cli(database, ['plan', '--target', b.targetPath, '--request', writeJson(`${stage}-other-label-request.json`, request), '--backup', b.backupPath, '--backup-file', b.dump, '--restore-evidence', b.restoreEvidence, '--out', join(evidence, `${stage}-plan-other-label.json`), '--snapshot-label', 'afl-api-2025-2026-10-21-000000']);
  check(`${stage}: refuses every snapshot label except the pinned one (no seal bypass for anything else)`, otherLabel.status !== 0, otherLabel.msg.slice(0, 110)); await unchanged(before, `${stage}/other-label`);
  const wrongRev = writeJson(`${stage}-approval-wrong-revision.json`, approvalFor(planDoc, { revision: 'f'.repeat(40) }));
  r = applyStage(stage, plan.out, wrongRev, b, request, 'refused-wrong-revision');
  check(`${stage}: refuses an approval pinned to another revision`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/wrong-revision`);
  // The general settle CLI must STILL refuse the sealed season (untouched control).
  const generic = spawnSync(process.execPath, ['--import', 'tsx', 'tools/current-season/settle-afl-api-fixtures.ts', '--label', FIX_LABEL, '--dry-run'], { cwd: root, encoding: 'utf8', env: { ...process.env, AFLDB_IMPORT_DATABASE_URL: dsnFor(database) } });
  const genericMsg = `${generic.stdout}${generic.stderr}`;
  check(`${stage}: the general settle CLI still refuses the sealed season 2025 (control; the refusal is intact)`, generic.status !== 0 && /sealed|season_sealed|Refused/i.test(genericMsg), genericMsg.trim().split('\n').pop()?.slice(0, 110));
  await unchanged(before, `${stage}/generic-cli-refusal`);
  // A canonical table moving inside the transaction rolls the whole stage back.
  await sql.unsafe(`CREATE OR REPLACE FUNCTION public.bro_e2e_touch() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN UPDATE players SET sort_name = sort_name || ' ' WHERE id = (SELECT min(id) FROM players); RETURN NULL; END $fn$`);
  await sql.unsafe('CREATE TRIGGER bro_e2e_touch_trg AFTER INSERT ON staging.source_record_versions FOR EACH STATEMENT EXECUTE FUNCTION public.bro_e2e_touch()');
  r = applyStage(stage, plan.out, goodApproval, b, request, 'failed-canonical-touch');
  await sql.unsafe('DROP TRIGGER bro_e2e_touch_trg ON staging.source_record_versions'); await sql.unsafe('DROP FUNCTION public.bro_e2e_touch()');
  check(`${stage}: a canonical table changing inside the stage rolls the whole stage back`, r.status !== 0 && /players/.test(r.msg), r.msg.slice(0, 130));
  await unchanged(before, `${stage}/canonical-touch (all 212 observations rolled back)`);
  check(`${stage}: after the rolled-back attempts the target still holds no 2025 match observations`, (await obsFingerprint()).startsWith('0:'), await obsFingerprint());

  const applied = applyStage(stage, plan.out, goodApproval, b, request, 'result');
  check(`${stage}: apply commits`, applied.status === 0, applied.msg.slice(0, 80));
  const after = await state(); const canonAfter = await canon();
  const fp = await obsFingerprint();
  check(`${stage}: exactly 212 afl_api 2025 match-family observations now exist`, fp.startsWith('212:'), fp);
  check(`${stage}: canonical football data is UNCHANGED (${CANON.length} tables hashed before and after)`, JSON.stringify(canonBefore) === JSON.stringify(canonAfter), CANON.filter((t) => canonBefore[t] !== canonAfter[t]).join(',') || 'identical');
  check(`${stage}: all vote rows (incl. 2026) are unchanged and no staging vote row was created`, after.votes === before.votes && (await scalar('SELECT count(*) FROM staging.afl_api_brownlow_vote')) === '0', '');
  const batch = await sql<{ tool: string; status: string; notes: string; n: number }[]>`SELECT tool, status, notes, records_inserted::int AS n FROM import_batches WHERE tool = 'brownlow-production-correction.ts' ORDER BY id DESC LIMIT 1`;
  check(`${stage}: one completed import batch owns the observations and names the pinned snapshot`, batch.length === 1 && batch[0].status === 'completed' && batch[0].n === 212 && batch[0].notes.includes(fixManifestSha) && !/SIMULATED/i.test(batch[0].notes), `inserted=${batch[0]?.n}`);
  const replay = applyStage(stage, plan.out, goodApproval, b, request, 'replay');
  const afterReplay = await state();
  check(`${stage}: replay is accepted and writes no second batch, version or receipt`, replay.status === 0 && afterReplay.receipts === after.receipts && afterReplay.batches === after.batches && (await obsFingerprint()) === fp, `receipts=${afterReplay.receipts} batches=${afterReplay.batches}`);
  // A re-plan needs a backup of the CURRENT state (the one taken before the apply no longer equals the target).
  const bAfter = await freshBackup(`${stage}-after`);
  const again = await planStage(stage, request, bAfter, 'plan-after');
  check(`${stage}: planning the stage again is refused (first load only)`, again.status !== 0 && /first load only/.test(again.msg), again.msg.slice(0, 110));
  // Optional corroboration against the earlier authentic rehearsal output (the template restored on this cluster).
  const cmpDb = process.env.AFLDB_B0_COMPARE_DB;
  let comparison = 'not requested';
  if (cmpDb) {
    const other = postgres(dsnFor(cmpDb), { max: 1, onnotice: () => {} });
    try {
      const fpOther = String(Object.values((await other.unsafe(OBS_FP_SQL))[0] ?? {})[0]);
      comparison = fpOther === fp ? 'identical' : `DIFFERENT ${fpOther}`;
      check(`${stage}: the 212 (record id, payload hash) pairs equal those the 2026-10-20 authentic rehearsal run produced from the same snapshot`, fpOther === fp, `${cmpDb}: ${fpOther.slice(0, 20)}`);
    } finally { await other.end({ timeout: 5 }); }
  }
  stages[stage] = { plan: planDoc.digest, receipt: after.receipts, observations: fp, canonicalUnchanged: true, comparison, manifestSha256: fixManifestSha };
}

// ================= B1: observe (2025) ===========================================================================
{
  const stage = 'b1-observe';
  const request: Request = { operation: 'observe', seasons: [2025] };
  const b = await freshBackup(stage);
  const plan = await planStage(stage, request, b);
  check(`${stage}: plan succeeds read-only`, plan.status === 0, plan.msg.slice(0, 80));
  const planDoc = readJson<Record<string, any>>(plan.out); // eslint-disable-line @typescript-eslint/no-explicit-any
  const before = await state();
  const goodApproval = writeJson(`${stage}-approval.json`, approvalFor(planDoc));

  // refusals: nothing may change
  const wrongRev = writeJson(`${stage}-approval-wrong-revision.json`, approvalFor(planDoc, { revision: 'f'.repeat(40) }));
  let r = applyStage(stage, plan.out, wrongRev, b, request, 'refused-wrong-revision');
  check(`${stage}: refuses an approval pinned to another revision`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/wrong-revision`);
  const expired = writeJson(`${stage}-approval-expired.json`, approvalFor(planDoc, { approvedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' }));
  r = applyStage(stage, plan.out, expired, b, request, 'refused-expired');
  check(`${stage}: refuses an expired approval`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/expired`);
  const tampered = writeJson(`${stage}-plan-tampered.json`, { ...planDoc, request: { ...planDoc.request, seasons: [2025, 2024] } });
  r = applyStage(stage, tampered, goodApproval, b, request, 'refused-tampered-plan');
  check(`${stage}: refuses a plan edited after review`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/tampered-plan`);
  const wrongTarget = writeJson(`${stage}-target-wrong.json`, { ...(await identity(database)), systemIdentifier: '1' });
  const wrongRequestPath = writeJson(`${stage}-wrong-target-request.json`, request);
  r = cli(database, ['plan', '--target', wrongTarget, '--request', wrongRequestPath, '--backup', b.backupPath, '--backup-file', b.dump, '--restore-evidence', b.restoreEvidence, '--out', join(evidence, `${stage}-plan-wrong-target.json`), ...snapshotArgs(request)]);
  check(`${stage}: refuses a plan whose target identity is wrong`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/wrong-target`);
  // drift between plan and apply
  const [row] = await sql`SELECT id FROM brownlow_round_votes WHERE season = 2025 ORDER BY id LIMIT 1`;
  await sql`UPDATE brownlow_round_votes SET imported_at = imported_at + interval '1 second' WHERE id = ${row.id}`;
  r = applyStage(stage, plan.out, goodApproval, b, request, 'refused-drift');
  await sql`UPDATE brownlow_round_votes SET imported_at = imported_at - interval '1 second' WHERE id = ${row.id}`;
  check(`${stage}: refuses when a covered row drifted after the plan`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/drift`);

  const applied = applyStage(stage, plan.out, goodApproval, b, request, 'result');
  check(`${stage}: apply commits`, applied.status === 0, applied.msg.slice(0, 80));
  const after = await state();
  const replay = applyStage(stage, plan.out, goodApproval, b, request, 'replay');
  const afterReplay = await state();
  check(`${stage}: replay is accepted and writes no second batch or receipt`, replay.status === 0 && afterReplay.receipts === after.receipts && afterReplay.batches === after.batches, `receipts=${afterReplay.receipts} batches=${afterReplay.batches}`);
  const staged = await scalar('SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE season = 2025');
  const sets = await scalar("SELECT count(DISTINCT provider_match_id) FROM staging.afl_api_brownlow_vote WHERE season = 2025").catch(() => 'n/a');
  check(`${stage}: 621 staged vote rows for 2025, no canonical vote write`, staged === '621' && after.votes === before.votes, `staged=${staged} distinctSets=${sets}`);
  check(`${stage}: exactly one Brownlow observe receipt (the B0 stage has its own); 2026 rows untouched`, (await scalar("SELECT count(*) FROM brownlow_correction_receipts WHERE operation = 'observe' AND result->>'stage' IS NULL")) === '1' && after.votes2026 === initial.votes2026, '');
  stages[stage] = { plan: planDoc.digest, receipt: after.receipts, staged621: staged, state: after };
}

// ================= B2: backfill (1984-2025) =====================================================================
{
  const stage = 'b2-backfill';
  const seasons = Array.from({ length: 42 }, (_, i) => 1984 + i);
  const b = await freshBackup(stage);
  const bad = await planStage(stage, { operation: 'backfill', seasons: [...seasons, 2026] }, b, 'plan-with-2026');
  check(`${stage}: a plan that names 2026 is refused`, bad.status !== 0, bad.msg.slice(0, 110));
  const request: Request = { operation: 'backfill', seasons };
  const plan = await planStage(stage, request, b);
  check(`${stage}: plan succeeds`, plan.status === 0, plan.msg.slice(0, 80));
  const planDoc = readJson<Record<string, any>>(plan.out); // eslint-disable-line @typescript-eslint/no-explicit-any
  const repairs = planDoc.payload?.export?.repairs?.length;
  check(`${stage}: the plan repairs exactly 320,861 rows`, repairs === 320861, String(repairs));
  const before = await state();
  const approvalPath = writeJson(`${stage}-approval.json`, approvalFor(planDoc));
  // injected failure after the writes: whole apply must roll back, then the same approval must still succeed
  await sql.unsafe(`CREATE OR REPLACE FUNCTION public.bro_e2e_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'bro e2e injected receipt failure'; END $$`);
  await sql.unsafe('CREATE TRIGGER bro_e2e_fail_trg BEFORE INSERT ON public.brownlow_correction_receipts FOR EACH ROW EXECUTE FUNCTION public.bro_e2e_fail()');
  let r = applyStage(stage, plan.out, approvalPath, b, request, 'failed-injected');
  await sql.unsafe('DROP TRIGGER bro_e2e_fail_trg ON public.brownlow_correction_receipts');
  await sql.unsafe('DROP FUNCTION public.bro_e2e_fail()');
  check(`${stage}: an injected receipt failure fails the apply`, r.status !== 0, r.msg.slice(0, 110));
  await unchanged(before, `${stage}/rollback (320,861 candidate writes rolled back)`);
  check(`${stage}: no row has a match_id after the rolled-back apply`, (await scalar('SELECT count(*) FROM brownlow_round_votes WHERE match_id IS NOT NULL')) === '0', '');
  // recovery: same plan, same approval (still fresh), failure removed
  const applied = applyStage(stage, plan.out, approvalPath, b, request, 'result');
  check(`${stage}: recovery apply of the same plan commits`, applied.status === 0, applied.msg.slice(0, 80));
  const after = await state();
  const replay = applyStage(stage, plan.out, approvalPath, b, request, 'replay');
  const afterReplay = await state();
  check(`${stage}: replay writes no second receipt`, replay.status === 0 && afterReplay.receipts === after.receipts, `receipts=${afterReplay.receipts}`);
  const q = async (t: string) => scalar(t);
  check(`${stage}: match_id set on exactly 320,861 in-scope rows`, (await q('SELECT count(*) FILTER (WHERE match_id IS NOT NULL) FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025')) === '320861', '');
  check(`${stage}: 2026 rows (9,522) keep match_id NULL and are byte-identical`, (await q('SELECT count(*) FROM brownlow_round_votes WHERE season = 2026 AND match_id IS NULL')) === '9522' && after.votes2026 === initial.votes2026, `n2026=${after.n2026}`);
  check(`${stage}: total 330,383; positive 22,239 and zero 298,622 in scope`, (await q('SELECT count(*) FROM brownlow_round_votes')) === '330383'
    && (await q('SELECT count(*) FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 AND votes > 0')) === '22239'
    && (await q('SELECT count(*) FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 AND votes = 0')) === '298622', '');
  check(`${stage}: only match_id moved (every other column of every vote row identical)`, after.votesNoMatch === before.votesNoMatch && after.votes !== before.votes, before.votesNoMatch.slice(0, 12));
  stages[stage] = { plan: planDoc.digest, repairs, state: after };
}

// ================= B3: adopt (2025) ==============================================================================
{
  const stage = 'b3-adopt';
  const request: Request = { operation: 'adopt', seasons: [2025] };
  const b = await freshBackup(stage);
  const plan = await planStage(stage, request, b);
  check(`${stage}: plan succeeds (207 adoptable, 0 refused)`, plan.status === 0, plan.msg.slice(0, 80));
  const planDoc = readJson<Record<string, any>>(plan.out); // eslint-disable-line @typescript-eslint/no-explicit-any
  const before = await state();
  const approvalPath = writeJson(`${stage}-approval.json`, approvalFor(planDoc));
  const applied = applyStage(stage, plan.out, approvalPath, b, request, 'result');
  check(`${stage}: apply commits`, applied.status === 0, applied.msg.slice(0, 80));
  const after = await state();
  const replay = applyStage(stage, plan.out, approvalPath, b, request, 'replay');
  const afterReplay = await state();
  check(`${stage}: replay writes no second receipt or batch`, replay.status === 0 && afterReplay.receipts === after.receipts && afterReplay.batches === after.batches, `receipts=${afterReplay.receipts}`);
  const api = await scalar("SELECT count(*) FROM brownlow_round_votes v JOIN sources s ON s.id = v.source_id WHERE v.season = 2025 AND s.key = 'afl_api'");
  const legacy = await scalar('SELECT count(*) FROM brownlow_round_votes WHERE season = 2025 AND source_id IS NULL');
  check(`${stage}: 621 rows adopted to afl_api, 8,901 zero rows keep their original provenance`, api === '621' && legacy === '8901', `afl_api=${api} legacy=${legacy}`);
  check(`${stage}: season, player, round, votes and match_id unchanged by adoption; 2026 untouched`, after.votesCore === before.votesCore && after.votes2026 === initial.votes2026, before.votesCore.slice(0, 12));
  check(`${stage}: 621 audit rows in canonical_applications for the adoption`, Number(after.applications) - Number(before.applications) >= 621, `delta=${Number(after.applications) - Number(before.applications)}`);
  stages[stage] = { plan: planDoc.digest, api, legacy, state: after };
}

// ================= resolve checkpoint ============================================================================
{
  const unresolved = await scalar("SELECT count(*) FROM public.data_issues WHERE issue_type = 'afl_api_brownlow_settle' AND entity_type = 'brownlow_round_votes' AND resolved_at IS NULL");
  check('resolve checkpoint: 0 unresolved afl_api_brownlow_settle issues, resolve skipped per the package rule', unresolved === '0', `unresolved=${unresolved}`);
  stages['resolve-checkpoint'] = { unresolved, skipped: unresolved === '0' };
}

// ================= E: eligibility ================================================================================
{
  const stage = 'e-eligibility';
  const pinned = readJson<Record<string, unknown>>(join(root, 'docs', 'v2', 'evidence', 'brownlow-eligibility-request-2026-11-01.json'));
  const request: Request = { ...pinned, actorId: actor };
  const b = await freshBackup(stage);
  const plan = await planStage(stage, request, b);
  check(`${stage}: plan succeeds for the twelve rulings`, plan.status === 0, plan.msg.slice(0, 80));
  const planDoc = readJson<Record<string, any>>(plan.out); // eslint-disable-line @typescript-eslint/no-explicit-any
  const before = await state();
  const short = writeJson(`${stage}-approval-missing-ruling.json`, approvalFor(planDoc, { rulings: (planDoc.request.rulings as unknown[]).slice(1) }));
  let r = applyStage(stage, plan.out, short, b, request, 'refused-missing-ruling');
  check(`${stage}: refuses an approval that omits one of the twelve rulings`, r.status !== 0, r.msg.slice(0, 110)); await unchanged(before, `${stage}/missing-ruling`);
  const approvalPath = writeJson(`${stage}-approval.json`, approvalFor(planDoc));
  const applied = applyStage(stage, plan.out, approvalPath, b, request, 'result');
  check(`${stage}: apply commits`, applied.status === 0, applied.msg.slice(0, 80));
  const after = await state();
  const replay = applyStage(stage, plan.out, approvalPath, b, request, 'replay');
  const afterReplay = await state();
  check(`${stage}: replay writes no second receipt`, replay.status === 0 && afterReplay.receipts === after.receipts, `receipts=${afterReplay.receipts}`);
  const decisions = await scalar('SELECT count(*) FROM brownlow_eligibility_decisions');
  const ineligible = await scalar('SELECT count(*) FROM brownlow_season_votes WHERE season = 2025 AND is_ineligible AND eligible_rank IS NULL AND player_id IN (12446,12869,13246,11386,11625,3191,4006,10252,8798,10130,11831,6737)');
  const winner = (await sql<Record<string, unknown>[]>`SELECT player_id, votes, eligible_rank FROM brownlow_season_votes WHERE season = 2025 AND eligible_rank = 1`)[0];
  check(`${stage}: 12 decisions, the twelve players are ineligible with no eligible rank`, decisions === '12' && ineligible === '12', `decisions=${decisions} ineligible=${ineligible}`);
  check(`${stage}: the 2025 winner stays player 9235 with 39 votes at eligible rank 1`, Number(winner?.player_id) === 9235 && Number(winner?.votes) === 39, JSON.stringify(winner));
  check(`${stage}: raw vote rows unchanged by eligibility; 2026 untouched`, after.votes === before.votes && after.votes2026 === initial.votes2026, '');
  stages[stage] = { plan: planDoc.digest, decisions, ineligible, winner, state: after };
}

// ================= C: acceptance (no database write) ==============================================================
{
  const receipts = await sql<{ operation: string; n: string }[]>`SELECT operation, count(*)::text AS n FROM brownlow_correction_receipts GROUP BY operation ORDER BY operation`;
  const final = await state();
  const ok = JSON.stringify(receipts.map((x) => [x.operation, x.n])) === JSON.stringify([['adopt', '1'], ['backfill', '1'], ['eligibility', '1'], ['observe', '2']]);
  check('acceptance: exactly one receipt per stage (B0 fixture-identities and B1 observe, both operation observe; backfill; adopt; eligibility = 5)', ok, JSON.stringify(receipts));
  check('acceptance: 2026 vote rows (9,522) are byte-identical to the start', final.votes2026 === initial.votes2026 && final.n2026 === '9522', initial.votes2026.slice(0, 12));
  stages.acceptance = { receipts, final };
}

const failed = checks.filter((c) => !c.pass);
report.finishedAt = new Date().toISOString();
report.checks = checks;
report.failed = failed.length;
writeFileSync(join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
writeFileSync(join(evidence, 'log.txt'), `${log.join('\n')}\n`, { flag: 'wx' });
say(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`);
await sql.end({ timeout: 5 });
if (failed.length) process.exitCode = 1;
void statSync;
