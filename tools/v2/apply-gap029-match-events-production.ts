/** V2-GAP-029: the REVIEWED PRODUCTION ENTRY POINT for the 64 evidenced marquee-match event labels.
 *
 * Counterpart of the isolated-only `apply-gap029-match-events.ts` (which must stay isolated). Same evidence, same
 * pre-write identity validation, same audited writer (`saveEdit`: one `data_edits` audit row and one active
 * `data_overrides` replay row per label), plus the production discipline the Brownlow correction runner uses:
 *
 *   baseline  read-only digest of the 64 rows and the label audit surfaces (compare live with a restored backup)
 *   plan      read-only; target-bound; produces a digest-sealed plan
 *   apply     needs the plan, an approval pinned to the plan digest, this checkout's clean HEAD, a fresh backup and
 *             verified restore evidence; re-validates the live rows (any drift refuses) and writes through `saveEdit`
 *
 *   node --import tsx --conditions=react-server tools/v2/apply-gap029-match-events-production.ts baseline --target T --out O
 *   ... plan  --target T --actor-id N --backup B --backup-file F --restore-evidence R --out O
 *   ... apply --plan P --approval A --backup-file F --restore-evidence R --out O
 *
 * Authority and transport. Reads and the target proof use ONE explicit secret variable, `AFLDB_GAP029_DSN` (never
 * `.env`-loaded here). The audited writer needs `AFLDB_IMPORT_DATABASE_URL` and `DATABASE_URL`, exactly as the Data
 * Editor does; this tool refuses unless BOTH name the same host, port and database as the reviewed target.json. Every
 * output file must lie outside the checkout and is created exclusively. No automatic retry, no Git write.
 *
 * Failure model. `saveEdit` commits each label in its own transaction, so a mid-run failure leaves some labels written;
 * that is safe and resumable: the plan's validation treats an already-correct label as done, and re-running `plan`
 * then `apply` (a new plan, a new approval) finishes the rest. Reversal is `saveEdit` setting `match_event` back to NULL.
 */
import 'server-only';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import postgres from 'postgres';
import { saveEdit } from '../../src/db/queries/data-edits';
import { sql as appSql } from '../../src/db/client';
import { entryProblem, type Entry, type Row } from './gap029-label-checks';

export { entryProblem };

/** sha256 of the committed LF bytes of the r2 evidence file (CRLF working copies are normalised before hashing). */
export const EVIDENCE_SHA256 = 'e3848807931cf255175c1642d9ded63590b2c7e2633b33a5e9f0fa5b96a4430f';
export const EVIDENCE_PATH = 'docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json';
export const LABELS = ['Anzac Day', "Dreamtime at the 'G", "King's Birthday"] as const;
const OPERATION = 'gap029-match-events';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Target { host: string; port: number; database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }
interface Backup { target: Target; sha256: string; restoreEvidenceSha256: string; capturedAt: string; restoredAt: string; baselineDigest: string }
interface Plan { operation: string; revision: string; target: Target; evidenceSha256: string; actorId: number; baselineDigest: string; backup: Backup; createdAt: string; expiresAt: string; entries: { matchId: number; label: string; before: string | null; action: 'to label' | 'already labelled' }[]; digest: string }
interface Approval { planDigest: string; target: Target; revision: string; operation: string; evidenceSha256: string; approvedAt: string; expiresAt: string; reference: string }

const fail = (why: string): never => { throw new Error(`GAP-029 labels refused: ${why}`); };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const planDigest = (p: Omit<Plan, 'digest'>) => sha(canon(p));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const fresh = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };

function readEvidence(): { entries: Entry[]; sha: string } {
  const bytes = readFileSync(EVIDENCE_PATH);
  const normalised = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (sha(normalised) !== EVIDENCE_SHA256) fail('the evidence file differs from the reviewed bytes');
  const doc = JSON.parse(normalised.toString('utf8')) as { entries: Entry[] };
  const ids = doc.entries.map((e) => e.matchId);
  if (doc.entries.length !== 64 || new Set(ids).size !== 64) fail('the evidence must name exactly 64 distinct matches');
  if (doc.entries.some((e) => !(LABELS as readonly string[]).includes(e.label))) fail('unrecognised label in the evidence');
  return { entries: doc.entries, sha: EVIDENCE_SHA256 };
}

function main() {
  return run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('GAP-029 labels refused:') ? error.message : 'GAP-029 labels refused or failed; inspect restricted evidence. No automatic retry.');
    process.exitCode = 1;
  });
}

async function run() {
  const mode = process.argv[2];
  const args = process.argv.slice(3);
  const opt = (flag: string): string => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1]) throw new Error(`${flag} required`); return args[i + 1]; };
  if (!['baseline', 'plan', 'apply'].includes(mode ?? '')) fail('mode must be baseline, plan or apply');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const json = <T,>(p: string): T => JSON.parse(readFileSync(outside(p), 'utf8')) as T;
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']);

  const plan0 = mode === 'apply' ? json<Plan>(opt('--plan')) : null;
  const target = plan0?.target ?? json<Target>(opt('--target'));
  const dsn = process.env.AFLDB_GAP029_DSN ?? '';
  // transport: the validation DSN must be exactly the reviewed target; the writer DSNs must name the same host/port/database
  const sameDb = (value: string, exactUser: boolean): void => {
    let u: URL; try { u = new URL(value); } catch { return fail('explicit DSN required'); }
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.search || u.hash || u.hostname !== target.host || Number(u.port || 5432) !== target.port
      || decodeURIComponent(u.pathname.slice(1)) !== target.database || (exactUser && decodeURIComponent(u.username) !== target.user)) fail('wrong target; no connection authorised');
  };
  sameDb(dsn, true);
  if (mode !== 'baseline') { sameDb(process.env.AFLDB_IMPORT_DATABASE_URL ?? '', false); sameDb(process.env.DATABASE_URL ?? '', false); }
  const evidence = readEvidence();
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, ...(mode === 'apply' ? {} : { connection: { default_transaction_read_only: true } }) });
  const ids = evidence.entries.map((e) => e.matchId);
  const readRows = async (s: postgres.Sql | postgres.TransactionSql): Promise<Map<number, Row>> => new Map((await s<Row[]>`
    SELECT m.id::int AS id, m.season::int AS season, m.match_date::text AS match_date, m.round_code, m.venue_raw, hc.name AS hn, ac.name AS an,
           m.home_score::int AS hs, m.away_score::int AS aws, m.match_event
      FROM matches m JOIN clubs hc ON hc.id = m.home_club_id JOIN clubs ac ON ac.id = m.away_club_id WHERE m.id = ANY(${ids})`).map((r) => [r.id, r]));
  const prove = async (s: postgres.TransactionSql): Promise<void> => {
    const [row] = await s<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    if (!row || !same(row, { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier, databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment })) fail('live database identity differs from the reviewed target');
  };
  /** Digest of the 64 rows and the label audit surfaces; equal on a faithful restore, different after any drift or write. */
  const baseline = async (s: postgres.TransactionSql): Promise<string> => {
    const rows = [...(await readRows(s)).values()].sort((a, b) => a.id - b.id);
    const [c] = await s<{ edits: string; overrides: string; labelled: string }[]>`SELECT
      (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event')::text AS edits,
      (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND field_group = 'match_event')::text AS overrides,
      (SELECT count(*) FROM matches WHERE match_event IS NOT NULL)::text AS labelled`;
    return sha(canon({ rows, c }));
  };
  /** The audited writer (`saveEdit`) records but does not check the actor, so every write path re-proves it here. */
  const requireActiveSuperAdmin = async (s: postgres.Sql | postgres.TransactionSql, id: number): Promise<void> => {
    const [actor] = await s<{ id: number }[]>`SELECT id::int AS id FROM auth_users WHERE id = ${id} AND role::text = 'super_admin' AND disabled_at IS NULL`;
    if (!actor) fail('the actor is not an active Super Admin');
  };
  const now = Date.now();
  try {
    if (mode === 'baseline') {
      const digest = await sql.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return baseline(tx); });
      writeFileSync(out, `${JSON.stringify({ target, revision, baselineDigest: digest, capturedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(`Read-only GAP-029 baseline ${digest}`);
      return;
    }
    const fileHash = (p: string) => sha(readFileSync(outside(p)));
    if (mode === 'plan') {
      const backup = json<Backup>(opt('--backup'));
      const actorId = Number(opt('--actor-id'));
      if (!Number.isInteger(actorId) || actorId < 1) fail('a real active Super Admin id is required');
      if (!same(backup.target, target) || !fresh(backup.capturedAt, now) || !fresh(backup.restoredAt, now) || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) fail('fresh target-bound backup and verified restore evidence required');
      if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
      const result = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const live = await baseline(tx);
        if (live !== backup.baselineDigest) fail('baseline drift: the restored backup no longer matches the live target');
        await requireActiveSuperAdmin(tx, actorId);
        const rows = await readRows(tx);
        const entries = evidence.entries.map((e) => { const p = entryProblem(e, rows.get(e.matchId)); if (p) fail(p); const before = rows.get(e.matchId)!.match_event; return { matchId: e.matchId, label: e.label, before, action: (before === e.label ? 'already labelled' : 'to label') as 'to label' | 'already labelled' }; });
        const body: Omit<Plan, 'digest'> = { operation: OPERATION, revision, target, evidenceSha256: evidence.sha, actorId, baselineDigest: live, backup, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_AGE_MS).toISOString(), entries };
        return { ...body, digest: planDigest(body) } as Plan;
      });
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log(`Review plan ${result.digest}; no writes (${result.entries.filter((e) => e.action === 'to label').length} to label, ${result.entries.filter((e) => e.action === 'already labelled').length} already labelled)`);
      return;
    }
    // apply
    const plan = plan0!;
    const approval = json<Approval>(opt('--approval'));
    const { digest, ...body } = plan;
    if (digest !== planDigest(body) || plan.operation !== OPERATION || plan.evidenceSha256 !== evidence.sha) fail('plan digest or evidence differs');
    if (approval.planDigest !== plan.digest || approval.operation !== OPERATION || !same(approval.target, plan.target) || approval.revision !== revision || plan.revision !== revision
      || approval.evidenceSha256 !== evidence.sha || !(Date.parse(approval.expiresAt) > now) || !(Date.parse(plan.expiresAt) > now) || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt)
      || !(Date.parse(approval.approvedAt) <= now) || !String(approval.reference ?? '').trim()) fail('stale plan or missing execution approval');
    if (!fresh(plan.backup.capturedAt, now) || !fresh(plan.backup.restoredAt, now)) fail('backup no longer fresh');
    if (fileHash(opt('--backup-file')) !== plan.backup.sha256 || fileHash(opt('--restore-evidence')) !== plan.backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
    // re-validate live state and prove the target on the validation connection; the writer connections then name the same database
    const pre = await sql.begin('isolation level repeatable read', async (tx) => {
      await prove(tx);
      await requireActiveSuperAdmin(tx, plan.actorId);
      const rows = await readRows(tx);
      const todo = evidence.entries.filter((e) => { const p = entryProblem(e, rows.get(e.matchId)); if (p) fail(p); return rows.get(e.matchId)!.match_event !== e.label; });
      const [c0] = await tx<{ edits: number; overrides: number }[]>`SELECT
        (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event')::int AS edits,
        (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND field_group = 'match_event' AND is_active)::int AS overrides`;
      return { todo, live: await baseline(tx), c0 };
    });
    if (pre.todo.length === 0) {
      writeFileSync(out, `${JSON.stringify({ replay: true, written: 0, planDigest: plan.digest, at: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log('Every label is already applied; nothing written');
      return;
    }
    if (pre.live !== plan.baselineDigest) fail('baseline drift; re-plan and obtain new execution approval');
    const written: number[] = [];
    for (const e of pre.todo) {
      // re-proved before EVERY label: an actor disabled or demoted mid-run stops the run at the next label boundary
      await requireActiveSuperAdmin(sql, plan.actorId);
      const r = await saveEdit({ entityKey: 'matches', rowId: e.matchId, groupKey: 'match_event', raw: { match_event: e.label }, adminUserId: plan.actorId,
        note: `V2-GAP-029: ${e.label} ${e.year} named by first-party club/league sources; plan ${plan.digest.slice(0, 12)}; see ${EVIDENCE_PATH}` });
      if (!r.ok) throw new Error(`GAP-029 labels refused: the audited writer refused match ${e.matchId} after ${written.length} written; re-plan to resume`);
      written.push(e.matchId);
    }
    const verify = await sql.begin('read only', async (tx) => {
      const rows = await readRows(tx);
      const [c] = await tx<{ edits: number; overrides: number }[]>`SELECT
        (SELECT count(*) FROM data_edits WHERE table_name = 'matches' AND field_group = 'match_event')::int AS edits,
        (SELECT count(*) FROM data_overrides WHERE entity_type = 'matches' AND field_group = 'match_event' AND is_active)::int AS overrides`;
      const dist = await tx<{ match_event: string; n: number }[]>`SELECT match_event, count(*)::int AS n FROM matches WHERE match_event = ANY(${[...LABELS]}) GROUP BY 1 ORDER BY 1`;
      return { allLabelled: evidence.entries.every((e) => rows.get(e.matchId)?.match_event === e.label), auditRowsAdded: c.edits - pre.c0.edits,
        overridesAdded: c.overrides - pre.c0.overrides, dist };
    });
    writeFileSync(out, `${JSON.stringify({ replay: false, written: written.length, planDigest: plan.digest, verify, at: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (!verify.allLabelled || verify.auditRowsAdded !== written.length || verify.overridesAdded !== written.length) fail('post-write verification failed');
    console.log(`Labels committed (${written.length} written); review restricted output`);
  } finally { await sql.end({ timeout: 5 }); await appSql.end({ timeout: 5 }).catch(() => {}); }
}

if (process.argv[1] && /apply-gap029-match-events-production\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main();
