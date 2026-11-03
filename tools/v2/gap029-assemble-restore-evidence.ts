/** V2-GAP-029: MACHINE-GENERATED restore evidence for a production plan. It replaces the hand step that used to produce the restore-derived
 * fields of `backup.json` (`draftLinkRestorePlanExpect`, `siblingContentDigest`, and each stage's restore baseline).
 *
 *   restore-evidence  builds `afldb.gap029.restore-evidence.1` from the capture provenance sidecar, the dump, and the GUARDED restored database
 *                     (identity proven by query, never typed in). Run once per data stage, after that stage's own fresh backup was restored.
 *   assemble          runs the stage's own tool in --rehearsal mode against the guarded restored database, reads what it produced and writes the
 *                     sealed `backup.json` that the stage's production `plan` requires. The stage digests are read from the guarded restored database, never typed in; the dump hash, restore time, archive entry count, provenance sidecar and production-target file are supplied inputs that are checked against each other and against the restored database, not chosen to satisfy a gate.
 *
 *   AFLDB_V2_ISOLATED_PG=1 AFLDB_TEST_DATABASE_URL=<restored db>   (both set by `tools/v2/isolated-pg.ts run <db> -- ...`)
 *   node --import tsx tools/v2/gap029-assemble-restore-evidence.ts restore-evidence --provenance P --dump D --dump-sha256 H --restored-at ISO \
 *        --toc-entries N --production-target T --out E
 *   node --import tsx tools/v2/gap029-assemble-restore-evidence.ts assemble --stage S1|S2|S3|S4 --production-target T --dump D --dump-sha256 H \
 *        --restore-evidence E --work-dir W --out B  [--label L]            (S2 also exports its child from the restored database)
 *
 * It REFUSES (and writes nothing) on: a dirty checkout; a restored database that is not a marked isolated `afldb_v2_*_test` database or that sits
 * in the production cluster; a missing or unreadable dump; a dump whose bytes do not hash to the stated sha256; restore evidence that is missing,
 * of another format, about another dump, another source database or another restored database, out of order, older than 24 hours or edited; a
 * stage tool that fails or whose output is not the expected shape. Every input hash, the tool hashes, the revision and the restored target's
 * identity are bound into a seal (see `gap029-common.ts` for what the seal does and does not prove).
 *
 * Reads the dump only to hash it; writes only under --work-dir and --out (both outside the checkout, created exclusively, mode 600/700). Prints no
 * DSN. It does not restore, start or stop any database and makes no network connection other than to the restored database.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import postgres from 'postgres';

import { ASSEMBLY_FORMAT, ISOLATED_CLUSTER, ISOLATED_COMMENT, ISOLATED_DB, freshAt, sealAssembly, sameJson, sha256, type TargetId } from './gap029-common';
import { toolHashes as s1ToolHashes, OPERATION as S1_OP } from './gap029-captaincy-additions-production';
import { toolHashes as s3ToolHashes, OPERATION as S3_OP } from './gap029-rookie-selections-production';

export const RESTORE_EVIDENCE_FORMAT = 'afldb.gap029.restore-evidence.1';
export const V3_PARENT_REL = 'data/reference/draftguru-person-bridge-20260918-v3.json';
export const V3_PARENT_SHA = '1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b';
export const DEFAULT_LABEL = 'annual-html-20260826';
export const STAGES = ['S1', 'S2', 'S3', 'S4'] as const;
export type Stage = (typeof STAGES)[number];
export const OPERATION_OF: Record<Stage, string> = { S1: S1_OP, S2: 'gap029-draft-link-production', S3: S3_OP, S4: 'gap029-sibling-pair' };
const HEX64 = /^[0-9a-f]{64}$/;

export interface RestoreEvidence {
  format: string; revision: string;
  backup: { archive: string; sha256: string; bytes: number; provenanceSha256: string };
  source: { host: string; database: string; systemIdentifier: string; databaseOid: string; ledgerRows: number; ledgerLast: string };
  restore: { target: TargetId; restoredAt: string; tocEntries: number };
  capturedAt: string; restoredAt: string;
}

const fail = (why: string): never => { throw new Error(`GAP-029 evidence assembly refused: ${why}`); };

/** Pure: every reason this restore evidence cannot back a production plan, or null. */
export function restoreEvidenceProblem(ev: unknown, ctx: { dumpSha256: string; restoreTarget: TargetId; productionTarget: TargetId; now: number }): string | null {
  const e = ev as RestoreEvidence | null;
  if (!e || typeof e !== 'object' || e.format !== RESTORE_EVIDENCE_FORMAT) return `restore evidence is missing or not ${RESTORE_EVIDENCE_FORMAT}`;
  if (e.backup?.sha256 !== ctx.dumpSha256) return 'restore evidence is about a different dump than the one supplied';
  if (e.source?.systemIdentifier !== ctx.productionTarget.systemIdentifier || e.source?.databaseOid !== ctx.productionTarget.databaseOid || e.source?.database !== ctx.productionTarget.database) return 'restore evidence names a different source database than the production target';
  if (!sameJson(e.restore?.target, ctx.restoreTarget)) return 'restore evidence names a different restored database than the one being read';
  if (!Number.isInteger(e.restore?.tocEntries) || e.restore.tocEntries < 1) return 'restore evidence carries no archive table-of-contents count';
  if (!Number.isInteger(e.source?.ledgerRows) || e.source.ledgerRows < 1 || !e.source?.ledgerLast) return 'restore evidence carries no source migration ledger';
  const captured = Date.parse(e.capturedAt); const restored = Date.parse(e.restoredAt);
  if (!(Number.isFinite(captured) && Number.isFinite(restored) && captured <= restored && restored <= ctx.now) || e.restore.restoredAt !== e.restoredAt) return 'restore evidence timestamps are missing or out of order';
  if (!freshAt(e.capturedAt, ctx.now) || !freshAt(e.restoredAt, ctx.now)) return 'restore evidence is older than 24 hours; take and restore a fresh backup';
  return null;
}

/** Pure: the stage-specific fields (and nothing else) a stage's production plan relies on, validated. */
export function stageFieldsFrom(stage: Stage, out: any): Record<string, unknown> {
  const hex = (v: unknown, what: string): string => (typeof v === 'string' && HEX64.test(v) ? v : fail(`${what} is not a sha256`));
  const count = (v: unknown, what: string): number => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fail(`${what} is not a count`));
  if (stage === 'S1') return { baselineDigest: hex(out?.baselineDigest, 'baselineDigest') };
  if (stage === 'S3') return { baselineDigest: hex(out?.baselineDigest, 'baselineDigest'), importBatchesBefore: count(out?.importBatchesBefore, 'importBatchesBefore') };
  if (stage === 'S2') {
    const x = out?.expect ?? {};
    const expect = { after_state_sha256: hex(x.after_state_sha256, 'after_state_sha256'), baseline_sha256: hex(x.baseline_sha256, 'baseline_sha256'),
      newly_linked_sha256: hex(x.newly_linked_sha256, 'newly_linked_sha256'), picks_after_sha256: hex(x.picks_after_sha256, 'picks_after_sha256') };
    if (Object.keys(x).length !== 4) fail('the draft-link plan expectation does not have exactly four values');
    return { baselineDigest: expect.baseline_sha256, draftLinkRestorePlanExpect: expect, batchesBefore: count(out?.batchesBefore, 'batchesBefore') };
  }
  const b = out?.before ?? {};
  count(out?.importBatchesBefore, 'importBatchesBefore');
  return { baselineDigest: hex(b.fullRowDigest, 'fullRowDigest'), siblingContentDigest: hex(b.contentDigest, 'contentDigest'), siblingFullRowDigest: hex(b.fullRowDigest, 'fullRowDigest'), siblingImportBatchesBefore: out.importBatchesBefore };
}

/** Pure: the sealed backup.json. Every field that is not a hash or a timestamp passed in is read from the arguments, never defaulted. */
export function buildBackup(a: {
  stage: Stage; revision: string; assembledAt: string; productionTarget: TargetId; restoreTarget: TargetId; dumpSha256: string; restoreEvidenceSha256: string;
  capturedAt: string; restoredAt: string; toolSha256: Record<string, string>; stageFields: Record<string, unknown>; derivedMode: string; derivedOutputSha256: string; extraInputs?: Record<string, unknown>;
}): Record<string, unknown> {
  return sealAssembly({
    target: a.productionTarget, sha256: a.dumpSha256, restoreEvidenceSha256: a.restoreEvidenceSha256, capturedAt: a.capturedAt, restoredAt: a.restoredAt, ...a.stageFields,
    assembly: {
      format: ASSEMBLY_FORMAT, stage: a.stage, operation: OPERATION_OF[a.stage], revision: a.revision, assembledAt: a.assembledAt, restoreTarget: a.restoreTarget,
      inputs: { dumpSha256: a.dumpSha256, restoreEvidenceSha256: a.restoreEvidenceSha256, toolSha256: a.toolSha256, ...(a.extraInputs ?? {}) },
      derived: { mode: a.derivedMode, outputSha256: a.derivedOutputSha256, values: a.stageFields },
    },
  });
}

async function fileSha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((ok, bad) => { const s = createReadStream(path); s.on('data', (c) => h.update(c)); s.on('end', () => ok()); s.on('error', bad); });
  return h.digest('hex');
}

async function run(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  const opt = (f: string, optional = false): string => { const i = args.indexOf(f); if (i < 0 || !args[i + 1]) { if (optional) return ''; throw new Error(`${f} required`); } return args[i + 1]; };
  if (mode !== 'restore-evidence' && mode !== 'assemble') fail('mode must be restore-evidence or assemble');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']);
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');

  // The restored database: the guarded isolated runner sets these two; nothing else is accepted.
  const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
  if (process.env.AFLDB_V2_ISOLATED_PG !== '1') fail('run inside `tools/v2/isolated-pg.ts run <db> --` (AFLDB_V2_ISOLATED_PG=1 is required)');
  let u: URL; try { u = new URL(dsn); } catch { return fail('AFLDB_TEST_DATABASE_URL is not a URL'); }
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !ISOLATED_DB.test(decodeURIComponent(u.pathname.slice(1)))) fail('the restored database must be an isolated afldb_v2_*_test database on loopback');
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
  try {
    const [row] = await sql<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    const restoreTarget: TargetId = { host: u.hostname, port: Number(u.port), ...(row as unknown as Omit<TargetId, 'host' | 'port'>) };
    if (restoreTarget.clusterName !== ISOLATED_CLUSTER || restoreTarget.databaseComment !== ISOLATED_COMMENT) fail('the restored database is not marked as the isolated test cluster');
    const productionTarget = JSON.parse(readFileSync(outside(opt('--production-target')), 'utf8')) as TargetId;
    if (/^afldb_v2_/.test(productionTarget.database) || productionTarget.systemIdentifier === restoreTarget.systemIdentifier) fail('the production target is the isolated cluster');
    const dump = outside(opt('--dump'));
    if (!existsSync(dump) || !statSync(dump).isFile()) fail('the dump file is missing');
    const dumpSha256 = opt('--dump-sha256');
    if (!HEX64.test(dumpSha256) || (await fileSha256(dump)) !== dumpSha256) fail('the dump bytes do not hash to the stated sha256');
    const now = Date.now();
    const write = (path: string, doc: unknown): void => { writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); };

    if (mode === 'restore-evidence') {
      const provBytes = readFileSync(outside(opt('--provenance')));
      const prov = JSON.parse(provBytes.toString('utf8'));
      const si = prov.source_identity ?? {};
      if (si.system_identifier !== productionTarget.systemIdentifier || si.database_oid !== productionTarget.databaseOid || si.database !== productionTarget.database) fail('the capture provenance names a different source than the production target');
      const ledger = Array.isArray(prov.observed_ledger) ? prov.observed_ledger : [];
      const restoredAt = new Date(opt('--restored-at')).toISOString();
      const ev: RestoreEvidence = {
        format: RESTORE_EVIDENCE_FORMAT, revision,
        backup: { archive: basename(dump), sha256: dumpSha256, bytes: statSync(dump).size, provenanceSha256: sha256(provBytes) },
        source: { host: String(si.host), database: String(si.database), systemIdentifier: String(si.system_identifier), databaseOid: String(si.database_oid), ledgerRows: ledger.length, ledgerLast: String(ledger.at(-1)?.name ?? '') },
        restore: { target: restoreTarget, restoredAt, tocEntries: Number(opt('--toc-entries')) },
        capturedAt: new Date(prov.captured_start_utc).toISOString(), restoredAt,
      };
      const problem = restoreEvidenceProblem(ev, { dumpSha256, restoreTarget, productionTarget, now });
      if (problem) fail(problem);
      write(out, ev);
      console.log(`Restore evidence written (${ev.source.ledgerRows} ledger rows, ${ev.restore.tocEntries} archive entries); sha256 ${sha256(readFileSync(out))}`);
      return;
    }

    // ---- assemble ----
    const stage = opt('--stage') as Stage;
    if (!STAGES.includes(stage)) fail('--stage must be S1, S2, S3 or S4');
    const evBytes = readFileSync(outside(opt('--restore-evidence')));
    const ev = JSON.parse(evBytes.toString('utf8')) as RestoreEvidence;
    const problem = restoreEvidenceProblem(ev, { dumpSha256, restoreTarget, productionTarget, now });
    if (problem) fail(problem);
    const work = outside(opt('--work-dir'));
    if (existsSync(work)) fail('the work directory already exists; choose a new one');
    mkdirSync(work, { mode: 0o700, recursive: true });
    const restoreTargetFile = join(work, 'restore-target.json'); write(restoreTargetFile, restoreTarget);
    const env = { ...process.env, AFLDB_GAP029_DSN: dsn };
    const py = process.env.AFLDB_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const runTs = (tool: string, extra: string[], conditions = false): void => { execFileSync('node', ['--import', 'tsx', ...(conditions ? ['--conditions=react-server'] : []), tool, ...extra], { env, cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }); };
    const runPy = (tool: string, extra: string[]): void => { execFileSync(py, [tool, ...extra], { env, cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }); };
    const pyHashes = (tool: string): Record<string, string> => JSON.parse(execFileSync(py, [tool, 'tool-hashes'], { env, cwd: root, encoding: 'utf8' }));

    let outFile: string; let toolSha256: Record<string, string>; let derivedMode: string; let extraInputs: Record<string, unknown> = {};
    if (stage === 'S1') {
      outFile = join(work, 's1-baseline.json'); derivedMode = 'baseline --rehearsal'; toolSha256 = s1ToolHashes();
      runTs('tools/v2/gap029-captaincy-additions-production.ts', ['baseline', '--target', restoreTargetFile, '--rehearsal', '--out', outFile]);
    } else if (stage === 'S3') {
      outFile = join(work, 's3-baseline.json'); derivedMode = 'baseline --rehearsal'; toolSha256 = s3ToolHashes();
      runTs('tools/v2/gap029-rookie-selections-production.ts', ['baseline', '--target', restoreTargetFile, '--rehearsal', '--out', outFile], true);
    } else if (stage === 'S2') {
      const label = opt('--label', true) || DEFAULT_LABEL;
      if ((await fileSha256(resolve(root, V3_PARENT_REL))) !== V3_PARENT_SHA) fail('the v3 parent bridge differs from its pinned sha256');
      const child = join(work, 'child.json');
      // The child is exported against THIS restore (read-only, rolled-back registration read), so its sha is derived, not chosen.
      execFileSync(py, ['tools/rebuild/draftguru/export_person_bridge.py', '--resolve-against', 'isolated', '--parent', V3_PARENT_REL, '--out', child], { env, cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
      const childSha = await fileSha256(child);
      outFile = join(work, 's2-plan.json'); derivedMode = 'plan --rehearsal'; toolSha256 = pyHashes('tools/v2/gap029-draft-link-production.py');
      runPy('tools/v2/gap029-draft-link-production.py', ['plan', '--target', restoreTargetFile, '--child', child, '--child-sha256', childSha, '--label', label, '--rehearsal', '--out', outFile]);
      extraInputs = { childSha256: childSha, label, parentSha256: V3_PARENT_SHA };
    } else {
      outFile = join(work, 's4-plan.json'); derivedMode = 'plan --rehearsal'; toolSha256 = pyHashes('tools/v2/gap029-sibling-pair-production.py');
      runPy('tools/v2/gap029-sibling-pair-production.py', ['plan', '--target', restoreTargetFile, '--rehearsal', '--out', outFile]);
    }
    const outBytes = readFileSync(outFile);
    const stageFields = stageFieldsFrom(stage, JSON.parse(outBytes.toString('utf8')));
    // The tools must be in the same state after the derivation as before (they refuse a dirty tree; this proves the run edited nothing tracked).
    execFileSync('git', ['diff', '--quiet']);
    const backup = buildBackup({ stage, revision, assembledAt: new Date().toISOString(), productionTarget, restoreTarget, dumpSha256, restoreEvidenceSha256: sha256(evBytes),
      capturedAt: ev.capturedAt, restoredAt: ev.restoredAt, toolSha256, stageFields, derivedMode, derivedOutputSha256: sha256(outBytes), extraInputs });
    write(out, backup);
    console.log(`Assembled ${stage} restore evidence at revision ${revision.slice(0, 12)}; backup sha256 ${dumpSha256.slice(0, 12)}; seal ${(backup.assembly as any).sealedBodySha256.slice(0, 12)}; sha256 ${sha256(readFileSync(out))}`);
  } finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && /gap029-assemble-restore-evidence\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('GAP-029 evidence assembly refused:') ? error.message : `GAP-029 evidence assembly failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown'}. Nothing was assembled.`);
    process.exitCode = 1;
  });
}
