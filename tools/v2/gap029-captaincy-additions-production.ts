/** V2-GAP-029 / owner decision D1: the REVIEWED, ADDITIVE, KEY-GUARDED entry point for the seven missing AFLDB-ISSUE-225
 * co-captain rows (`captaincies`), for a production-bound plan and, separately, a rehearsal on a production-derived clone.
 *
 *   baseline  read-only digest of the whole captaincies table and the import-batch surface
 *   plan      read-only; target-bound; resolves every row's club and player identity, refuses any conflict;
 *             produces a digest-sealed plan (7 "to insert", or "already present" when a row equals the evidence exactly)
 *   apply     needs the plan, an approval pinned to the plan digest, a clean HEAD, fresh backup + verified restore evidence
 *
 *   node --import tsx tools/v2/gap029-captaincy-additions-production.ts baseline --target T --out O
 *   ... plan  --target T --backup B --backup-file F --restore-evidence R --out O          (production)
 *   ... plan  --target T --rehearsal --out O                                              (isolated clone only)
 *   ... apply --plan P --approval A --backup-file F --restore-evidence R --out O          (production)
 *   ... apply --plan P --rehearsal --out O                                                (isolated clone only)
 *
 * Properties. Additive only: the only statements are one INSERT into import_batches and seven INSERTs into captaincies in a
 * SINGLE transaction. No UPDATE or DELETE exists in this file. Existing rows are re-read after the write and must equal their
 * pre-write digest, or the transaction rolls back. A source key already present with different content, or a natural key
 * (season, club, name, role) held by another row, refuses the whole run (nothing is adopted or mutated). The evidence rows are
 * also required to equal the tracked `data/awards/captaincies.csv` rows, so a later reload (`import_awards.py --groups
 * captaincies`) adopts exactly these rows by their source key.
 *
 * Transport. Reads and the target proof use `AFLDB_GAP029_DSN` (read-only session for baseline/plan). The write uses
 * `AFLDB_GAP029_WRITE_DSN` (the import role). Both must name exactly the reviewed target's host, port and database. Every
 * output file lies outside the checkout and is created exclusively. No retry, no Git write.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import postgres from 'postgres';

export const EVIDENCE_PATH = 'docs/v2/evidence/gap-029-captaincy-additions-2026-11-03.json';
export const MANIFEST_PATH = 'data/awards/captaincies.csv';
export const OPERATION = 'gap029-captaincy-additions';
const SOURCE_KEY = 'wikipedia';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface Entry { sourceKey: string; season: number; club: string; player: string; bootstrapPlayerId: number; afltablesProfile: string; linkStatus: string; role: string; period: string; note: string; rowSha256: string }
export interface Existing { id: number; season: number; club_id: number; player_id: number | null; player_name_raw: string; link_status_value: string; role: string; period: string | null; notes: string | null; source_id: number | null; source_record_id: string | null }
export interface Live { sourceId: number | null; seasons: Set<number>; clubIds: Map<string, number[]>; playerIds: Map<string, number[]>; bySourceKey: Map<string, Existing>; byNaturalKey: Map<string, Existing> }
export interface Resolved { clubId: number; playerId: number; action: 'to insert' | 'already present' }

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const fail = (why: string): never => { throw new Error(`GAP-029 captaincies refused: ${why}`); };
export const rowDigest = (e: Entry) => sha(JSON.stringify([e.sourceKey, e.season, e.club, e.player, e.linkStatus, e.role, e.period, e.note]));
export const naturalKey = (season: number, clubId: number, name: string, role: string) => JSON.stringify([season, clubId, name, role]);

/** Pure: why an entry cannot be inserted against what the target holds, or the resolved ids and the action. */
export function captaincyEntryProblem(e: Entry, live: Live): string | Resolved {
  if (rowDigest(e) !== e.rowSha256) return `${e.sourceKey}: evidence row digest differs from its content`;
  if (e.linkStatus !== 'unique') return `${e.sourceKey}: only a unique-linked row is admitted`;
  if (live.sourceId === null) return 'source wikipedia is not registered on the target';
  if (!live.seasons.has(e.season)) return `${e.sourceKey}: season ${e.season} is not registered`;
  const clubs = live.clubIds.get(e.club) ?? [];
  if (clubs.length !== 1) return `${e.sourceKey}: club ${JSON.stringify(e.club)} resolves to ${clubs.length} clubs, not exactly one`;
  const players = live.playerIds.get(e.afltablesProfile) ?? [];
  if (players.length !== 1) return `${e.sourceKey}: profile ${e.afltablesProfile} resolves to ${players.length} players, not exactly one`;
  const clubId = clubs[0]; const playerId = players[0];
  const held = live.bySourceKey.get(e.sourceKey);
  if (held) {
    const equal = held.season === e.season && held.club_id === clubId && held.player_id === playerId && held.player_name_raw === e.player
      && held.link_status_value === e.linkStatus && held.role === e.role && held.period === e.period && held.notes === e.note && held.source_id === live.sourceId;
    return equal ? { clubId, playerId, action: 'already present' } : `${e.sourceKey}: the source key is held by row ${held.id} with different content; nothing is adopted or mutated`;
  }
  const clash = live.byNaturalKey.get(naturalKey(e.season, clubId, e.player, e.role));
  if (clash) return `${e.sourceKey}: the natural key (season, club, name, role) is held by row ${clash.id} (source key ${clash.source_record_id}); nothing is adopted or mutated`;
  return { clubId, playerId, action: 'to insert' };
}

interface Target { host: string; port: number; database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }
interface Backup { target: Target; sha256: string; restoreEvidenceSha256: string; capturedAt: string; restoredAt: string; baselineDigest: string }
interface Plan { operation: string; revision: string; target: Target; rehearsal: boolean; evidenceSha256: string; manifestSha256: string; baselineDigest: string; backup: Backup | null; createdAt: string; expiresAt: string; entries: (Entry & Resolved)[]; digest: string }
interface Approval { planDigest: string; target: Target; revision: string; operation: string; evidenceSha256: string; approvedAt: string; expiresAt: string; reference: string }
const planDigest = (p: Omit<Plan, 'digest'>) => sha(canon(p));
const fresh = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };

function readEvidence(): { entries: Entry[]; sha: string; manifestSha: string } {
  const normalised = Buffer.from(readFileSync(EVIDENCE_PATH).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const doc = JSON.parse(normalised.toString('utf8')) as { entries: Entry[]; trackedManifest: { sha256: string } };
  const manifestBytes = Buffer.from(readFileSync(MANIFEST_PATH).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (sha(manifestBytes) !== doc.trackedManifest.sha256) fail('the tracked captaincies manifest differs from the reviewed bytes');
  if (doc.entries.length !== 7 || new Set(doc.entries.map((e) => e.sourceKey)).size !== 7) fail('the evidence must name exactly seven distinct source keys');
  // equality with the tracked manifest rows: the evidence cannot drift from the file a later reload would read
  const lines = manifestBytes.toString('utf8').split('\n');
  for (const e of doc.entries) {
    const line = lines.find((l) => l.startsWith(`${e.sourceKey},`));
    if (!line || !line.includes(e.player) || !line.includes(e.period) || !line.includes(e.note)) fail(`${e.sourceKey}: not equal to the tracked manifest row`);
  }
  return { entries: doc.entries, sha: sha(normalised), manifestSha: doc.trackedManifest.sha256 };
}

async function readLive(s: postgres.Sql | postgres.TransactionSql, entries: Entry[]): Promise<Live> {
  const src = await s<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${SOURCE_KEY}`;
  const seasons = new Set((await s<{ year: number }[]>`SELECT year::int AS year FROM seasons`).map((r) => r.year));
  const clubIds = new Map<string, number[]>();
  for (const r of await s<{ id: number; name: string }[]>`SELECT id::int AS id, name FROM clubs WHERE name = ANY(${entries.map((e) => e.club)})`) clubIds.set(r.name, [...(clubIds.get(r.name) ?? []), r.id]);
  const playerIds = new Map<string, number[]>();
  for (const r of await s<{ external_id: string; player_id: number }[]>`SELECT DISTINCT ei.external_id, ei.player_id::int AS player_id FROM external_identities ei
      JOIN sources so ON so.id = ei.source_id WHERE so.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status::text IN ('unique','resolved')
      AND ei.player_id IS NOT NULL AND ei.external_id = ANY(${entries.map((e) => e.afltablesProfile)})`) playerIds.set(r.external_id, [...(playerIds.get(r.external_id) ?? []), r.player_id]);
  const rows = await s<Existing[]>`SELECT id::int AS id, season::int AS season, club_id::int AS club_id, player_id::int AS player_id, player_name_raw, link_status_value::text AS link_status_value,
      role, period, notes, source_id::int AS source_id, source_record_id FROM captaincies`;
  return { sourceId: src[0]?.id ?? null, seasons, clubIds, playerIds,
    bySourceKey: new Map(rows.filter((r) => r.source_record_id).map((r) => [`${r.source_record_id}`, r])),
    byNaturalKey: new Map(rows.map((r) => [naturalKey(r.season, r.club_id, r.player_name_raw, r.role), r])) };
}

async function tableDigest(s: postgres.Sql | postgres.TransactionSql, maxId: number | null): Promise<{ digest: string; count: number; maxId: number }> {
  const rows = await s<Existing[]>`SELECT id::int AS id, season::int AS season, club_id::int AS club_id, player_id::int AS player_id, player_name_raw, link_status_value::text AS link_status_value,
      role, period, notes, source_id::int AS source_id, source_record_id, import_batch_id::text AS import_batch_id FROM captaincies WHERE (${maxId}::int IS NULL OR id <= ${maxId}::int) ORDER BY id`;
  return { digest: sha(canon(rows)), count: rows.length, maxId: rows.reduce((m, r) => Math.max(m, r.id), 0) };
}

async function run() {
  const mode = process.argv[2];
  const args = process.argv.slice(3);
  const flag = (f: string) => args.includes(f);
  const opt = (f: string): string => { const i = args.indexOf(f); if (i < 0 || !args[i + 1]) throw new Error(`${f} required`); return args[i + 1]; };
  if (!['baseline', 'plan', 'apply'].includes(mode ?? '')) fail('mode must be baseline, plan or apply');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const json = <T,>(p: string): T => JSON.parse(readFileSync(outside(p), 'utf8')) as T;
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']);
  const plan0 = mode === 'apply' ? json<Plan>(opt('--plan')) : null;
  const rehearsal = plan0 ? plan0.rehearsal : flag('--rehearsal');
  if (flag('--rehearsal') && plan0 && !plan0.rehearsal) fail('the plan is not a rehearsal plan');
  const target = plan0?.target ?? json<Target>(opt('--target'));
  const dsn = process.env.AFLDB_GAP029_DSN ?? '';
  const sameDb = (value: string, exactUser: boolean): void => {
    let u: URL; try { u = new URL(value); } catch { return fail('explicit DSN required'); }
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.search || u.hash || u.hostname !== target.host || Number(u.port || 5432) !== target.port
      || decodeURIComponent(u.pathname.slice(1)) !== target.database || (exactUser && decodeURIComponent(u.username) !== target.user)) fail('wrong target; no connection authorised');
  };
  sameDb(dsn, true);
  if (rehearsal && !/^afldb_v2_[a-z0-9_]+_test$/.test(target.database)) fail('a rehearsal is only for an isolated afldb_v2_*_test database');
  if (!rehearsal && /^afldb_v2_.*_test$/.test(target.database)) fail('an isolated clone is rehearsed with --rehearsal');
  if (mode === 'apply') sameDb(process.env.AFLDB_GAP029_WRITE_DSN ?? '', false);
  const evidence = readEvidence();
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, ...(mode === 'apply' ? {} : { connection: { default_transaction_read_only: true } }) });
  const prove = async (s: postgres.TransactionSql, writerRole = false): Promise<void> => {
    const [row] = await s<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    if (writerRole && row?.user !== 'afldb_import') fail('the write connection must be the afldb_import role');
    if (!row || !same({ ...row, ...(writerRole ? { user: target.user } : {}) }, { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier, databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment })) fail('live database identity differs from the reviewed target');
  };
  const resolveAll = (live: Live): (Entry & Resolved)[] => evidence.entries.map((e) => { const r = captaincyEntryProblem(e, live); if (typeof r === 'string') return fail(r); return { ...e, ...r }; });
  const baselineOf = async (s: postgres.TransactionSql) => {
    const t = await tableDigest(s, null);
    const [b] = await s<{ n: string; mx: string | null }[]>`SELECT count(*)::text AS n, max(id)::text AS mx FROM import_batches`;
    return { ...t, tableDigest: t.digest, batches: b.n, maxBatch: b.mx, digest: sha(canon({ t: t.digest, b })) };
  };
  const now = Date.now();
  const write = (v: unknown) => writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    if (mode === 'baseline') {
      const b = await sql.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return baselineOf(tx); });
      write({ target, revision, baselineDigest: b.digest, captaincies: b.count, maxCaptaincyId: b.maxId, importBatches: b.batches, capturedAt: new Date().toISOString() });
      console.log(`Read-only captaincies baseline ${b.digest} (${b.count} rows)`);
      return;
    }
    const fileHash = (p: string) => sha(readFileSync(outside(p)));
    if (mode === 'plan') {
      const backup = rehearsal ? null : json<Backup>(opt('--backup'));
      if (backup) {
        if (!same(backup.target, target) || !fresh(backup.capturedAt, now) || !fresh(backup.restoredAt, now) || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) fail('fresh target-bound backup and verified restore evidence required');
        if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
      }
      const result = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const b = await baselineOf(tx);
        if (backup && b.digest !== backup.baselineDigest) fail('baseline drift: the restored backup no longer matches the live target');
        const entries = resolveAll(await readLive(tx, evidence.entries));
        const body: Omit<Plan, 'digest'> = { operation: OPERATION, revision, target, rehearsal, evidenceSha256: evidence.sha, manifestSha256: evidence.manifestSha, baselineDigest: b.digest, backup,
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_AGE_MS).toISOString(), entries };
        return { ...body, digest: planDigest(body) } as Plan;
      });
      write(result);
      console.log(`Review plan ${result.digest}; no writes (${result.entries.filter((e) => e.action === 'to insert').length} to insert, ${result.entries.filter((e) => e.action === 'already present').length} already present)`);
      return;
    }
    const plan = plan0!;
    const { digest, ...body } = plan;
    if (digest !== planDigest(body) || plan.operation !== OPERATION || plan.evidenceSha256 !== evidence.sha || plan.manifestSha256 !== evidence.manifestSha || plan.revision !== revision) fail('plan digest, evidence or revision differs');
    if (!(Date.parse(plan.expiresAt) > now)) fail('stale plan');
    if (!rehearsal) {
      const approval = json<Approval>(opt('--approval'));
      if (!plan.backup || approval.planDigest !== plan.digest || approval.operation !== OPERATION || !same(approval.target, plan.target) || approval.revision !== revision
        || approval.evidenceSha256 !== evidence.sha || !(Date.parse(approval.expiresAt) > now) || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt)
        || !(Date.parse(approval.approvedAt) <= now) || !String(approval.reference ?? '').trim()) fail('stale plan or missing execution approval');
      const pb = plan.backup!;
      if (!fresh(pb.capturedAt, now) || !fresh(pb.restoredAt, now)) fail('backup no longer fresh');
      if (fileHash(opt('--backup-file')) !== pb.sha256 || fileHash(opt('--restore-evidence')) !== pb.restoreEvidenceSha256) fail('backup or restore evidence content differs');
    }
    const writer = postgres(process.env.AFLDB_GAP029_WRITE_DSN ?? '', { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      const result = await writer.begin('isolation level repeatable read', async (tx) => {
        await prove(tx, true);
        const before = await baselineOf(tx);
        if (before.digest !== plan.baselineDigest) fail('baseline drift; re-plan and obtain new execution approval');
        const live = await readLive(tx, evidence.entries);
        const entries = resolveAll(live);
        if (!same(entries.map((e) => ({ k: e.sourceKey, c: e.clubId, p: e.playerId, a: e.action })), plan.entries.map((e) => ({ k: e.sourceKey, c: e.clubId, p: e.playerId, a: e.action })))) fail('the live resolution differs from the reviewed plan');
        const todo = entries.filter((e) => e.action === 'to insert');
        if (todo.length === 0) return { replay: true, written: 0 };
        const [batch] = await tx<{ id: string }[]>`INSERT INTO import_batches (source_id, tool, target_table, status, records_read, records_inserted, records_updated, records_rejected, notes, completed_at)
          VALUES (${live.sourceId!}, 'gap029-captaincy-additions-production.ts', 'captaincies', 'completed', ${evidence.entries.length}, ${todo.length}, 0, 0,
                  ${`V2-GAP-029 D1 additive co-captain rows; plan ${plan.digest.slice(0, 12)}; evidence ${EVIDENCE_PATH}`}, now()) RETURNING id::text AS id`;
        for (const e of todo) {
          await tx`INSERT INTO captaincies (season, club_id, player_id, player_name_raw, link_status_value, role, period, notes, source_id, source_record_id, import_batch_id)
            VALUES (${e.season}, ${e.clubId}, ${e.playerId}, ${e.player}, ${e.linkStatus}::link_status, ${e.role}, ${e.period}, ${e.note}, ${live.sourceId!}, ${e.sourceKey}, ${batch.id}::bigint)`;
        }
        const after = await tableDigest(tx, before.maxId);
        const total = await tableDigest(tx, null);
        const cur = await readLive(tx, evidence.entries);
        const allThere = evidence.entries.every((e) => { const r = captaincyEntryProblem(e, cur); return typeof r !== 'string' && r.action === 'already present'; });
        // the transaction commits only if every pre-existing row is byte-identical and exactly the planned rows were added
        if (after.digest !== before.tableDigest || total.count !== before.count + todo.length || !allThere) fail('post-write verification failed; rolled back');
        return { replay: false, written: todo.length, batchId: batch.id, captaincies: total.count };
      });
      write({ ...result, planDigest: plan.digest, at: new Date().toISOString() });
      console.log(result.replay ? 'Every row is already present; nothing written' : `Committed ${result.written} rows; review restricted output`);
    } finally { await writer.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
}

function main() {
  return run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('GAP-029 captaincies refused:') ? error.message : 'GAP-029 captaincies refused or failed; inspect restricted evidence. No automatic retry.');
    process.exitCode = 1;
  });
}

if (process.argv[1] && /gap029-captaincy-additions-production\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main();
