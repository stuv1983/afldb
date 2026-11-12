/** AFLDB-ISSUE-336: the REVIEWED, GUARDED entry point for the 35 DraftGuru Pre-Draft rows that the owner's CSV exports and the live DraftGuru year
 * pages carry but `draft_picks` lacks (owner decisions D-336-1 'Intl Schol' accepted, 6 Nov 2026; D-336-2 prepare the bounded insert).
 *
 *   describe  read-only; writes the connected database's identity (the --target file every other mode is bound to)
 *   baseline  read-only digest of the draft surface the plan depends on
 *   plan      read-only; target-bound; resolves every row's club, DraftGuru person and conflicts; digest-sealed; names the actor
 *   apply     needs the plan, an approval pinned to the plan digest, a clean HEAD, fresh backup + verified restore evidence (sealed by the assembler, stage I336)
 *   verify    read-only after the fact: the 35 rows, unchanged pre-existing rows, the audit rows where readable
 *   state     read-only: classifies the live surface as the plan's BASELINE, the plan's RESULT, or OTHER (use it after any non-zero apply)
 *
 *   node --import tsx --conditions=react-server tools/v2/issue336-predraft-insert-production.ts describe --out T
 *   ... baseline --target T --out O
 *   ... plan   --target T --actor-user-id N --backup B --backup-file F --restore-evidence R --out O          (production)
 *   ... plan   --target T --actor-user-id N --rehearsal --out O                                             (isolated clone only)
 *   ... apply  --plan P --approval A --backup-file F --restore-evidence R --out O                           (production)
 *   ... apply  --plan P --rehearsal --out O                                                                 (isolated clone only)
 *   ... verify --plan P --apply-record A --out O
 *   ... state  --plan P --out O
 *
 * WHAT IT WRITES, in ONE transaction: for each row a DraftGuru-sourced `draft_picks` row (draft_type 'Pre-Draft', draft_kind 'pre_draft', no pick
 * number, the importer's own reload key and source_record_id), a new UNMATCHED `draft_persons` row for a person URL not already stored (a stored URL
 * keeps its row and its link; nothing is matched by name), and one `data_edits` audit row per pick through `recordDataEdit`, so the V2-GAP-006 season
 * seal judges every sealed-season insert (2008-2025 are sealed) against the reviewed correction note, exactly as for an editor write. No override row:
 * these are source rows, which a later keyed DraftGuru reload reproduces under the same key. No career statistic, height or award is taken from the CSV.
 *
 * CONTROLS (as the V2-GAP-029 production tools): the actor is a real `auth_users.id`, proven an enabled, fully enrolled, non-fixture Super Admin by
 * `assert_viable_super_admin_actor` and row-locked until commit; the plan digest binds target, revision, evidence, baseline, actor and every resolved
 * id; the approval pins the digest; the baseline is re-read inside the write transaction (any drift refuses); inside the transaction, after the writes,
 * every pre-existing draft_picks / draft_persons / draft override row must be byte-identical, exactly N picks, M persons and N audit ids must have been
 * added, and every row must read back as reviewed, or it rolls back. Outcomes and exit codes are gap029-common.ts's; a committed outcome is never
 * reported as rolled back, never retried and never restored by this tool.
 *
 * Transport: AFLDB_GAP029_DSN (read-only sessions) and AFLDB_GAP029_WRITE_DSN (the afldb_import role), both naming exactly the reviewed target.
 * Output files lie outside the checkout and are created exclusively. Prints no DSN and no player name.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import postgres from 'postgres';

import { assemblyProblem, canonJson, lfSha256, MAX_AGE_MS, reportLines, runApply, sameJson, sha256 } from './gap029-common';

export const EVIDENCE_PATH = 'docs/v2/evidence/issue336-draft-categories-20261105/predraft-insert-plan.json';
/** sha256 of the reviewed evidence (LF-folded); the plan, approval and backup bind to it. */
export const EVIDENCE_SHA256 = '6a207cfe3b1408d6ff747040cecfac1cde9ebd9a43f584711c573eb20ff511cb';
export const EVENT_KINDS_PATH = 'data/reference/draftguru-event-kinds.json';
export const CLUB_CONTRACT_PATH = 'tools/rebuild/draftguru/draftguru-contract.json';
export const OPERATION = 'issue336-predraft-insert';
export const STAGE = 'I336';
export const TOOL_PATH = 'tools/v2/issue336-predraft-insert-production.ts';
export const ROWS = 35;
export const DRAFT_TYPE = 'Pre-Draft';
export const DRAFT_KIND = 'pre_draft';
export const AUDIT_FIELD_GROUP = 'source_insert';
export const NOTE_PREFIX = 'AFLDB-ISSUE-336 owner-approved correction';
/** Every file whose bytes decide what this tool writes or how the seal judges it. */
export const toolHashes = (): Record<string, string> => Object.fromEntries(
  [TOOL_PATH, 'tools/v2/gap029-common.ts', 'src/db/queries/audit-log.ts', 'src/lib/seasons/sealed-editor-guard.ts', EVENT_KINDS_PATH, CLUB_CONTRACT_PATH, EVIDENCE_PATH]
    .map((p) => [p, lfSha256(p)]),
);

export interface EvidenceRow {
  draft_year: number; event_type_raw: string; player_name_raw: string; player_url: string; club_name_raw: string; club_slug_source: string | null;
  signing_raw: string | null; pick_number: number | null; pick_note_raw: string | null; age_raw: string | null; height_raw: string | null;
  original_club_raw: string | null; source_url: string; row_index: number;
}
export interface Evidence { format: string; draftguru_pages: Record<string, { sha256: string; fetched_at_utc: string }>; rows: EvidenceRow[] }
export interface Entry {
  key: string; draftYear: number; playerUrl: string; sourceRecordId: string; clubSlug: string | null; signing: string | null; signingKind: string | null;
  pickNote: string | null; draftAge: number | null; heightCm: number | null; correctionNote: string; provenance: string;
  /** Source payload stored verbatim (never identity, never printed). */
  playerNameRaw: string; clubNameRaw: string; originalClubRaw: string | null;
}
export interface ExistingPick { id: number; source_record_id: string | null; draft_type: string; signing: string | null; club_name_raw: string | null }
export interface Person { id: number; dg_person_id: number; player_id: number | null; link_status: string; match_method: string | null }
export interface Live { sourceIds: number[]; clubIds: Map<string, number[]>; picks: Map<string, ExistingPick[]>; persons: Map<string, Person[]> }
export interface Resolved { clubId: number | null; personId: number | null; playerId: number | null; linkStatus: string; action: 'to insert' | 'already present' }

function fail(why: string): never { throw new Error(`ISSUE-336 insert refused: ${why}`); }
export const leadingInt = (raw: string | null): number | null => { const m = raw ? /^\s*(\d+)/.exec(raw) : null; return m ? Number(m[1]) : null; };
/** The importer's frozen head rule (draftguru-event-kinds.json signing.signing_kind.rule). */
export const signingHead = (raw: string | null): string | null => (raw === null ? null : raw.replace(/\s*\(.*$/s, '').trim());
export const nameKey = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const entryKey = (url: string, year: number): string => JSON.stringify([url, year, DRAFT_KIND]);

/** Pure: the reviewed entries, from the evidence bytes and the two contracts. Refuses anything the importer would refuse. */
export function buildEntries(evidenceText: string, vocabulary: ReadonlySet<string>, deliberateNullClubs: ReadonlySet<string>): Entry[] {
  if (sha256(Buffer.from(evidenceText.replace(/\r\n/g, '\n'), 'utf8')) !== EVIDENCE_SHA256) fail('the evidence differs from the reviewed bytes');
  const ev = JSON.parse(evidenceText) as Evidence;
  if (ev.format !== 'afldb.issue336.predraft-insert-plan.1' || ev.rows.length !== ROWS) fail('the evidence shape changed');
  const keys = new Set<string>();
  return ev.rows.map((r) => {
    if (r.event_type_raw !== DRAFT_TYPE || r.pick_number !== null) fail(`${r.source_url}#${r.row_index}: not an unnumbered Pre-Draft row`);
    if (!/^https:\/\/www\.draftguru\.com\.au\/players\//.test(r.player_url)) fail(`${r.source_url}#${r.row_index}: no DraftGuru person URL`);
    const head = signingHead(r.signing_raw);
    if (head !== null && !vocabulary.has(head)) fail(`${r.source_url}#${r.row_index}: signing head outside the closed vocabulary`);
    const page = ev.draftguru_pages[String(r.draft_year)];
    if (!page || !/^[0-9a-f]{64}$/.test(page.sha256)) fail(`${r.draft_year}: no fetched DraftGuru page record`);
    const key = entryKey(r.player_url, r.draft_year);
    if (keys.has(key)) fail('the evidence repeats a reload key');
    keys.add(key);
    const sourceRecordId = `${r.source_url}#${r.row_index}`;
    const correctionNote = `${NOTE_PREFIX} (D-336-1, D-336-2): record DraftGuru's ${r.draft_year} Pre-Draft selection ${sourceRecordId}, `
      + 'absent from the 2026-08 acquisition; see docs/v2/evidence/issue336-draft-categories-20261105/.';
    return {
      key, draftYear: r.draft_year, playerUrl: r.player_url, sourceRecordId, signing: r.signing_raw, signingKind: head, pickNote: r.pick_note_raw,
      clubSlug: r.club_slug_source && deliberateNullClubs.has(r.club_slug_source) ? null : r.club_slug_source,
      draftAge: leadingInt(r.age_raw), heightCm: leadingInt(r.height_raw), correctionNote,
      playerNameRaw: r.player_name_raw, clubNameRaw: r.club_name_raw, originalClubRaw: r.original_club_raw,
      provenance: `AFLDB-ISSUE-336 bounded insert from ${r.source_url} (fetched ${page.fetched_at_utc}, sha256 ${page.sha256.slice(0, 16)})`,
    };
  });
}

/** Pure: why an entry cannot be inserted against what the target holds, or the resolved ids and the action. */
export function entryProblem(e: Entry, live: Live): string | Resolved {
  if (live.sourceIds.length !== 1) return `the draftguru source resolves to ${live.sourceIds.length} rows, not exactly one`;
  let clubId: number | null = null;
  if (e.clubSlug !== null) {
    const clubs = live.clubIds.get(e.clubSlug) ?? [];
    if (clubs.length !== 1) return `${e.sourceRecordId}: club ${e.clubSlug} resolves to ${clubs.length} clubs, not exactly one`;
    clubId = clubs[0];
  }
  const persons = live.persons.get(e.playerUrl) ?? [];
  if (persons.length > 1) return `${e.sourceRecordId}: the person URL is stored ${persons.length} times`;
  const person = persons[0] ?? null;
  const held = live.picks.get(e.key) ?? [];
  if (held.length > 1) return `${e.sourceRecordId}: the reload key is stored ${held.length} times`;
  const base = { clubId, personId: person?.id ?? null, playerId: person?.player_id ?? null, linkStatus: person?.link_status ?? 'unmatched' };
  if (held.length === 1) {
    const h = held[0];
    const equal = h.source_record_id === e.sourceRecordId && h.draft_type === DRAFT_TYPE && h.signing === e.signing;
    return equal && person ? { ...base, action: 'already present' }
      : `${e.sourceRecordId}: selection #${h.id} already holds this reload key with different content; nothing is adopted or mutated`;
  }
  return { ...base, action: 'to insert' };
}

export interface Target { host: string; port: number; database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }
export interface Backup { target: Target; sha256: string; restoreEvidenceSha256: string; capturedAt: string; restoredAt: string; baselineDigest: string; importBatchesBefore: number }
export interface Plan { operation: string; revision: string; target: Target; rehearsal: boolean; actorUserId: number; evidenceSha256: string; baselineDigest: string;
  importBatchesBefore: number; backup: Backup | null; createdAt: string; expiresAt: string; entries: (Pick<Entry, 'key' | 'sourceRecordId'> & Resolved)[]; digest: string }
export interface Approval { planDigest: string; target: Target; revision: string; operation: string; evidenceSha256: string; actorUserId: number; approvedAt: string; expiresAt: string; reference: string }
export const planDigest = (p: Omit<Plan, 'digest'>): string => sha256(canonJson(p));
const fresh = (iso: string, now: number): boolean => { const t = Date.parse(iso); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };
const planned = (entries: readonly (Pick<Entry, 'key'> & Resolved)[]) => entries.map((e) => ({ k: e.key, c: e.clubId, p: e.personId, a: e.action }));

/** Pure: every reason an execution approval does not bind to this plan, the live revision and evidence. Null when it binds. */
export function approvalProblem(plan: Plan, approval: Approval | null, ctx: { now: number; revision: string }): string | null {
  const { digest, ...body } = plan;
  if (digest !== planDigest(body)) return 'plan digest differs from its content';
  if (plan.operation !== OPERATION || plan.evidenceSha256 !== EVIDENCE_SHA256 || plan.revision !== ctx.revision) return 'plan operation, evidence or revision differs';
  if (!(Date.parse(plan.expiresAt) > ctx.now)) return 'stale plan';
  if (plan.rehearsal) return null;
  if (!approval || !plan.backup) return 'missing execution approval or backup evidence';
  if (approval.planDigest !== plan.digest || approval.operation !== OPERATION || !sameJson(approval.target, plan.target) || approval.revision !== ctx.revision
    || approval.evidenceSha256 !== EVIDENCE_SHA256 || approval.actorUserId !== plan.actorUserId) return 'approval does not bind to this plan, target, revision, evidence and actor';
  if (!(Date.parse(approval.expiresAt) > ctx.now) || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt) || !(Date.parse(approval.approvedAt) <= ctx.now)) return 'approval window invalid or expired';
  if (!String(approval.reference ?? '').trim()) return 'approval carries no written reference';
  if (!fresh(plan.backup.capturedAt, ctx.now) || !fresh(plan.backup.restoredAt, ctx.now)) return 'backup no longer fresh';
  return null;
}

/** Pure: every reason a production plan must not trust this backup evidence (target-bound, fresh, ordered, machine-assembled and sealed), or null. */
export function backupProblem(backup: Backup, target: Target, ctx: { now: number; revision: string }, tools: Record<string, string> = toolHashes()): string | null {
  if (!sameJson(backup.target, target) || !fresh(backup.capturedAt, ctx.now) || !fresh(backup.restoredAt, ctx.now) || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) return 'fresh target-bound backup and verified restore evidence required';
  return assemblyProblem(backup as unknown as Record<string, unknown>, { operation: OPERATION, stage: STAGE, revision: ctx.revision, now: ctx.now, target, toolSha256: tools,
    stageFields: { baselineDigest: backup.baselineDigest, importBatchesBefore: backup.importBatchesBefore } });
}

function contracts(): { vocabulary: Set<string>; deliberateNull: Set<string> } {
  const kinds = JSON.parse(readFileSync(EVENT_KINDS_PATH, 'utf8')) as { signing: { signing_kind: { vocabulary: string[]; on_unknown_head: string } } };
  if (kinds.signing.signing_kind.on_unknown_head !== 'HALT') fail('the signing contract no longer fails closed');
  const clubs = JSON.parse(readFileSync(CLUB_CONTRACT_PATH, 'utf8')) as { club_resolution: { on_unknown_club_slug: string; deliberate_null: { club_slug: string }[] } };
  if (clubs.club_resolution.on_unknown_club_slug !== 'HALT') fail('the club contract no longer fails closed');
  return { vocabulary: new Set(kinds.signing.signing_kind.vocabulary), deliberateNull: new Set(clubs.club_resolution.deliberate_null.map((d) => d.club_slug)) };
}
const readEntries = (): Entry[] => { const c = contracts(); return buildEntries(readFileSync(EVIDENCE_PATH, 'utf8'), c.vocabulary, c.deliberateNull); };

type Db = postgres.Sql | postgres.TransactionSql;
async function readLive(s: Db, entries: readonly Entry[]): Promise<Live> {
  const sourceIds = (await s<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = 'draftguru'`).map((r) => r.id);
  const clubIds = new Map<string, number[]>();
  const slugs = [...new Set(entries.flatMap((e) => (e.clubSlug ? [e.clubSlug] : [])))];
  for (const r of await s<{ id: number; slug: string }[]>`SELECT id::int AS id, slug FROM clubs WHERE slug = ANY(${slugs})`) clubIds.set(r.slug, [...(clubIds.get(r.slug) ?? []), r.id]);
  const urls = entries.map((e) => e.playerUrl);
  const picks = new Map<string, ExistingPick[]>();
  for (const r of await s<(ExistingPick & { player_url: string; draft_year: number })[]>`SELECT dp.id::int AS id, dp.player_url, dp.draft_year::int AS draft_year, dp.source_record_id,
      dp.draft_type, dp.signing, dp.club_name_raw FROM draft_picks dp WHERE dp.source_id = ANY(${sourceIds}) AND dp.draft_kind = ${DRAFT_KIND} AND dp.player_url = ANY(${urls})`) {
    const k = entryKey(r.player_url, r.draft_year); picks.set(k, [...(picks.get(k) ?? []), r]);
  }
  const persons = new Map<string, Person[]>();
  for (const r of await s<(Person & { player_url: string })[]>`SELECT id::int AS id, dg_person_id::int AS dg_person_id, player_id::int AS player_id, link_status::text AS link_status,
      match_method, player_url FROM draft_persons WHERE source_id = ANY(${sourceIds}) AND player_url = ANY(${urls})`) persons.set(r.player_url, [...(persons.get(r.player_url) ?? []), r]);
  return { sourceIds, clubIds, picks, persons };
}

/** Whole-surface digest: every draft_picks and draft_persons row and every draft override, all columns. */
async function surfaceDigest(s: Db): Promise<{ digest: string; picks: number; maxPickId: number; persons: number; maxPersonId: number; overrides: number; maxOverrideId: number }> {
  const one = async (q: string) => ((await s.unsafe(q)) as unknown as { n: number; mx: number; d: string }[])[0];
  const p = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_picks t`);
  const q = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_persons t`);
  const o = await one(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM data_overrides t WHERE entity_type = 'draft_picks'`);
  return { digest: sha256(canonJson({ p, q, o })), picks: p.n, maxPickId: p.mx, persons: q.n, maxPersonId: q.mx, overrides: o.n, maxOverrideId: o.mx };
}

/** Full-row digest of the rows that existed before the write. */
async function priorRowsDigest(s: Db, i: { maxPickId: number; maxPersonId: number; maxOverrideId: number }): Promise<string> {
  const one = async (q: string, max: number) => ((await s.unsafe(q, [max])) as unknown as { d: string }[])[0].d;
  return sha256(canonJson({
    p: await one(`SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_picks t WHERE id <= $1::int`, i.maxPickId),
    q: await one(`SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_persons t WHERE id <= $1::int`, i.maxPersonId),
    o: await one(`SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM data_overrides t WHERE entity_type = 'draft_picks' AND id <= $1::int`, i.maxOverrideId),
  }));
}

const batchCount = async (s: Db): Promise<number> => (await s<{ n: number }[]>`SELECT count(*)::int AS n FROM import_batches`)[0].n;
async function auditSequence(s: Db): Promise<number | null> {
  const [r] = await s<{ v: string | null }[]>`SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'data_edits_id_seq'`;
  return r?.v == null ? null : Number(r.v);
}
/** Reviewed-note audit rows, or null when the role cannot read the audit table. Runs in a savepoint so a denied read cannot abort the transaction. */
async function auditNoteCount(s: postgres.TransactionSql): Promise<number | null> {
  try {
    return await s.savepoint(async (sp) => (await sp<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits WHERE table_name = 'draft_picks'
      AND field_group = ${AUDIT_FIELD_GROUP} AND note LIKE ${`${NOTE_PREFIX}%`}`)[0].n);
  } catch { return null; }
}

interface Info { maxPickId: number; maxPersonId: number; maxOverrideId: number; picksBefore: number; personsBefore: number; overridesBefore: number;
  priorDigest: string; planned: number; newPersons: number; auditBefore: number | null }

async function run(): Promise<void> {
  const mode = process.argv[2];
  const args = process.argv.slice(3);
  const flag = (f: string) => args.includes(f);
  const opt = (f: string): string => { const i = args.indexOf(f); if (i < 0 || !args[i + 1]) throw new Error(`${f} required`); return args[i + 1]; };
  if (!['describe', 'baseline', 'plan', 'apply', 'verify', 'state'].includes(mode ?? '')) fail('mode must be describe, baseline, plan, apply, verify or state');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const json = <T,>(p: string): T => JSON.parse(readFileSync(outside(p), 'utf8')) as T;
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');
  const write = (v: unknown) => writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const dsn = process.env.AFLDB_GAP029_DSN ?? '';
  const readOnly = () => postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC' } });
  const identity = async (s: Db): Promise<Omit<Target, 'host' | 'port'>> => {
    const [row] = await s<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    return row as unknown as Omit<Target, 'host' | 'port'>;
  };
  if (mode === 'describe') {
    let u: URL; try { u = new URL(dsn); } catch { return fail('explicit AFLDB_GAP029_DSN required'); }
    const sql = readOnly();
    try { write({ host: u.hostname, port: Number(u.port || 5432), ...(await sql.begin('read only', (tx) => identity(tx))) }); } finally { await sql.end({ timeout: 5 }); }
    console.log('Target identity written (read-only)');
    return;
  }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (mode === 'apply' || mode === 'plan') { execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']); }
  const plan0 = mode === 'apply' || mode === 'verify' || mode === 'state' ? json<Plan>(opt('--plan')) : null;
  const rehearsal = plan0 ? plan0.rehearsal : flag('--rehearsal');
  if (flag('--rehearsal') && plan0 && !plan0.rehearsal) fail('the plan is not a rehearsal plan');
  const target = plan0?.target ?? json<Target>(opt('--target'));
  const sameDb = (value: string, exactUser: boolean): void => {
    let u: URL; try { u = new URL(value); } catch { return fail('explicit DSN required'); }
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.search || u.hash || u.hostname !== target.host || Number(u.port || 5432) !== target.port
      || decodeURIComponent(u.pathname.slice(1)) !== target.database || (exactUser && decodeURIComponent(u.username) !== target.user)) fail('wrong target; no connection authorised');
  };
  sameDb(dsn, true);
  if (rehearsal && !/^afldb_v2_[a-z0-9_]+_test$/.test(target.database)) fail('a rehearsal is only for an isolated afldb_v2_*_test database');
  if (!rehearsal && /^afldb_v2_.*_test$/.test(target.database)) fail('an isolated clone is rehearsed with --rehearsal');
  if (mode === 'apply') sameDb(process.env.AFLDB_GAP029_WRITE_DSN ?? '', false);
  const entries = readEntries();
  const sql = readOnly();
  const prove = async (s: postgres.TransactionSql, writerRole = false): Promise<void> => {
    const row = await identity(s);
    if (writerRole && row.user !== 'afldb_import') fail('the write connection must be the afldb_import role');
    if (!sameJson({ ...row, ...(writerRole ? { user: target.user } : {}) }, { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier,
      databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment })) fail('live database identity differs from the reviewed target');
  };
  const independent = async <T,>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    const ro = readOnly();
    try { return (await ro.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return work(tx); })) as T; } finally { await ro.end({ timeout: 5 }); }
  };
  const resolveAll = (live: Live) => entries.map((e) => { const r = entryProblem(e, live); if (typeof r === 'string') return fail(r); return { key: e.key, sourceRecordId: e.sourceRecordId, ...r }; });
  const allPresent = (live: Live) => entries.every((e) => { const r = entryProblem(e, live); return typeof r !== 'string' && r.action === 'already present'; });
  const now = Date.now();
  try {
    if (mode === 'baseline') {
      const b = await sql.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return { ...(await surfaceDigest(tx)), batches: await batchCount(tx) }; });
      write({ target, revision, baselineDigest: b.digest, importBatchesBefore: b.batches, draftPicks: b.picks, draftPersons: b.persons, draftOverrides: b.overrides, capturedAt: new Date().toISOString() });
      console.log(`Read-only draft baseline ${b.digest} (${b.picks} picks, ${b.persons} persons, ${b.overrides} overrides)`);
      return;
    }
    const fileHash = (p: string) => sha256(readFileSync(outside(p)));
    if (mode === 'plan') {
      const actorUserId = Number(opt('--actor-user-id'));
      if (!Number.isInteger(actorUserId) || actorUserId < 1) fail('--actor-user-id must be a real auth_users id');
      const backup = rehearsal ? null : json<Backup>(opt('--backup'));
      if (backup) {
        const refused = backupProblem(backup, target, { now, revision });
        if (refused) fail(refused);
        if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
      }
      const result = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const [fn] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'assert_viable_super_admin_actor'`;
        if (fn.n !== 1) fail('the actor-viability assertion (migration 105) is not installed on the target');
        const b = await surfaceDigest(tx);
        const batches = await batchCount(tx);
        if (backup && b.digest !== backup.baselineDigest) fail('baseline drift: the restored backup no longer matches the live target');
        if (backup && batches !== backup.importBatchesBefore) fail('the backup was taken before another import committed (import_batches count differs): take a fresh restore-verified backup');
        const body: Omit<Plan, 'digest'> = { operation: OPERATION, revision, target, rehearsal, actorUserId, evidenceSha256: EVIDENCE_SHA256, baselineDigest: b.digest,
          importBatchesBefore: batches, backup, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_AGE_MS).toISOString(), entries: resolveAll(await readLive(tx, entries)) };
        return { ...body, digest: planDigest(body) } as Plan;
      });
      write(result);
      const todo = result.entries.filter((e) => e.action === 'to insert');
      console.log(`Review plan ${result.digest}; no writes (${todo.length} to insert, ${todo.filter((e) => e.personId === null).length} new persons, `
        + `${result.entries.length - todo.length} already present); actor ${actorUserId} is asserted only at apply`);
      return;
    }
    const plan = plan0!;
    { const { digest, ...body } = plan; if (digest !== planDigest(body) || plan.operation !== OPERATION) fail('plan digest or operation differs'); }
    if (mode === 'verify') {
      const record = json<{ planDigest: string; info?: Info }>(opt('--apply-record'));
      if (record.planDigest !== plan.digest || !record.info) fail('the apply record belongs to a different plan or carries no boundary');
      const info = record.info;
      const report = await independent(async (tx) => {
        const live = await readLive(tx, entries);
        return {
          entriesPresent: entries.filter((e) => { const r = entryProblem(e, live); return typeof r !== 'string' && r.action === 'already present'; }).length,
          preExistingUnchanged: (await priorRowsDigest(tx, info)) === info.priorDigest,
          draftPicksNow: (await surfaceDigest(tx)).picks,
          auditNoteRows: await auditNoteCount(tx),
        };
      });
      write({ planDigest: plan.digest, checkedAt: new Date().toISOString(), entriesTotal: entries.length, ...report });
      console.log(`Read-only verification: ${report.entriesPresent}/${entries.length} rows present; pre-existing rows unchanged: ${report.preExistingUnchanged}`);
      return;
    }
    if (mode === 'state') {
      const seen = await independent(async (tx) => {
        const b = await surfaceDigest(tx);
        return { baseline: b.digest === plan.baselineDigest, allPresent: allPresent(await readLive(tx, entries)), draftPicks: b.picks, draftPersons: b.persons };
      });
      const state = seen.baseline ? 'BASELINE (the plan has not been applied)' : seen.allPresent ? 'PLANNED RESULT PRESENT (every reviewed row is present)' : 'OTHER (neither the plan baseline nor the planned result)';
      write({ planDigest: plan.digest, state, ...seen, checkedAt: new Date().toISOString() });
      console.log(`STATE ${state}`);
      return;
    }
    const problem = approvalProblem(plan, rehearsal ? null : json<Approval>(opt('--approval')), { now, revision });
    if (problem) fail(problem);
    // The audit module builds (but does not connect) the app's own pools when imported. Point them at the reviewed read-only target BEFORE the import.
    process.env.DATABASE_URL = dsn; process.env.AFLDB_AUTH_DATABASE_URL = dsn;
    const { recordDataEdit } = await import('../../src/db/queries/audit-log');
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const writer = postgres(process.env.AFLDB_GAP029_WRITE_DSN ?? '', { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { TimeZone: 'Etc/UTC' } });
    try {
      const report = await runApply<Info>({
        preflight: async () => {
          if (rehearsal) return;
          const pb = plan.backup!;
          if (fileHash(opt('--backup-file')) !== pb.sha256 || fileHash(opt('--restore-evidence')) !== pb.restoreEvidenceSha256) fail('backup or restore evidence content differs');
          const refused = backupProblem(pb, plan.target, { now, revision });
          if (refused) fail(refused);
        },
        transact: (marks) => writer.begin('isolation level repeatable read', async (tx) => {
          await prove(tx, true);
          try { await tx`SELECT public.assert_viable_super_admin_actor(${plan.actorUserId}::int)`; } catch { fail(`actor ${plan.actorUserId} is not a viable Super Admin; nothing written`); }
          const before = await surfaceDigest(tx);
          if (before.digest !== plan.baselineDigest || (await batchCount(tx)) !== plan.importBatchesBefore) fail('baseline drift; re-plan and obtain new execution approval');
          const live = await readLive(tx, entries);
          if (!sameJson(planned(resolveAll(live)), planned(plan.entries))) fail('the live resolution differs from the reviewed plan');
          const todo = plan.entries.filter((e) => e.action === 'to insert');
          if (todo.length === 0) return { replay: true };
          const boundary = { maxPickId: before.maxPickId, maxPersonId: before.maxPersonId, maxOverrideId: before.maxOverrideId };
          const priorBefore = await priorRowsDigest(tx, boundary);
          const seqBefore = await auditSequence(tx);
          if (seqBefore === null) fail('the audit sequence is not readable, so exactly-N audit rows cannot be proved; nothing written');
          const auditBefore = await auditNoteCount(tx);
          const sourceId = live.sourceIds[0];
          let rank = (await tx<{ m: number }[]>`SELECT coalesce(max(dg_person_id),0)::int AS m FROM draft_persons WHERE source_id = ${sourceId}`)[0].m;
          marks.writing();
          let newPersons = 0;
          const created: { key: string; pickId: number; personId: number; auditId: string; seal: string }[] = [];
          for (const p of todo) {
            const e = byKey.get(p.key)!;
            let person = live.persons.get(e.playerUrl)?.[0] ?? null;
            if (!person) {
              rank += 1; newPersons += 1;
              [person] = await tx<Person[]>`INSERT INTO draft_persons (source_id, dg_person_id, player_url, display_name_raw, name_key, player_id, link_status, candidate_count,
                  match_method, confidence_notes, reported_games, reported_goals, is_matching_backlog)
                VALUES (${sourceId}, ${rank}, ${e.playerUrl}, ${e.playerNameRaw}, ${nameKey(e.playerNameRaw)}, NULL, 'unmatched', 0, NULL,
                  ${'AFLDB-ISSUE-336 bounded insert: identity unresolved; dg_person_id assigned past the stored maximum and renumbered by the next full reload'},
                  NULL, NULL, false)
                RETURNING id::int AS id, dg_person_id::int AS dg_person_id, player_id::int AS player_id, link_status::text AS link_status, match_method`;
            }
            const [pick] = await tx<{ id: number }[]>`INSERT INTO draft_picks (draft_year, draft_type, draft_kind, pick_number, pick_note, player_id, player_name_raw,
                link_status_value, candidate_count, match_method, confidence_notes, club_id, club_name_raw, original_club_raw, draft_age, height_cm, signing, signing_kind,
                detail, source_id, source_record_id, draft_person_id, dg_person_id, player_url)
              VALUES (${e.draftYear}, ${DRAFT_TYPE}, ${DRAFT_KIND}, NULL, ${e.pickNote}, ${person.player_id}, ${e.playerNameRaw}, ${person.link_status}, 0, ${person.match_method},
                ${e.provenance}, ${p.clubId}, ${e.clubNameRaw}, ${e.originalClubRaw}, ${e.draftAge}, ${e.heightCm}, ${e.signing}, ${e.signingKind}, NULL, ${sourceId},
                ${e.sourceRecordId}, ${person.id}, ${person.dg_person_id}, ${e.playerUrl})
              RETURNING id::int AS id`;
            // The editor's own audit write and season seal (2008-2025 are sealed): a refusal throws and rolls everything back.
            const receipt = await recordDataEdit(tx, { tableName: 'draft_picks', rowId: pick.id, fieldGroup: AUDIT_FIELD_GROUP, oldValues: {},
              newValues: { draft_year: e.draftYear, draft_kind: DRAFT_KIND, source_record_id: e.sourceRecordId, player_url: e.playerUrl, club_id: p.clubId, signing_kind: e.signingKind,
                draft_person_id: person.id, link_status_value: person.link_status },
              adminUserId: plan.actorUserId, note: e.correctionNote, seal: { kind: 'row' } });
            created.push({ key: e.key, pickId: pick.id, personId: person.id, auditId: receipt.id, seal: receipt.seal.basis });
          }
          const plannedPersons = todo.filter((e) => e.personId === null).length;
          const total = await surfaceDigest(tx);
          const seqAfter = await auditSequence(tx);
          const auditAfter = await auditNoteCount(tx);
          if (total.picks !== before.picks + todo.length) fail('post-write verification failed: the number of new draft_picks rows is not exactly the planned number; rolled back');
          if (newPersons !== plannedPersons || total.persons !== before.persons + plannedPersons) fail('post-write verification failed: the number of new draft_persons rows differs from the plan; rolled back');
          if (total.overrides !== before.overrides) fail('post-write verification failed: a draft override row was added; rolled back');
          if (seqAfter !== (seqBefore as number) + todo.length) fail(`post-write verification failed: the audit sequence moved by ${(seqAfter ?? NaN) - (seqBefore as number)}, not ${todo.length}; rolled back`);
          if (auditBefore !== null && auditAfter !== null && auditAfter !== auditBefore + todo.length) fail('post-write verification failed: the audit table did not gain exactly one reviewed-note row per row; rolled back');
          if (!allPresent(await readLive(tx, entries))) fail('post-write verification failed: a created row differs from the reviewed content; rolled back');
          if ((await priorRowsDigest(tx, boundary)) !== priorBefore) fail('a pre-existing draft_picks, draft_persons or override row changed; rolled back');
          const info: Info = { ...boundary, picksBefore: before.picks, personsBefore: before.persons, overridesBefore: before.overrides, priorDigest: priorBefore,
            planned: todo.length, newPersons: plannedPersons, auditBefore };
          marks.commitNext(info);
          return { replay: false, info, result: { written: todo.length, newPersons, created, auditSequenceBefore: seqBefore, auditSequenceAfter: seqAfter, draftPicksAfter: total.picks, info } };
        }),
        verify: (info) => independent(async (tx) => {
          const problems: string[] = [];
          if (!allPresent(await readLive(tx, entries))) problems.push('a reviewed row is missing or differs');
          if ((await priorRowsDigest(tx, info)) !== info.priorDigest) problems.push('a pre-existing draft row differs from its pre-write state');
          const total = await surfaceDigest(tx);
          if (total.picks !== info.picksBefore + info.planned) problems.push(`draft_picks holds ${total.picks} rows, expected ${info.picksBefore + info.planned}`);
          if (total.persons !== info.personsBefore + info.newPersons) problems.push(`draft_persons holds ${total.persons} rows, expected ${info.personsBefore + info.newPersons}`);
          if (total.overrides !== info.overridesBefore) problems.push('the draft override count changed');
          const auditNow = await auditNoteCount(tx);
          if (info.auditBefore !== null && auditNow !== null && auditNow !== info.auditBefore + info.planned) problems.push(`the audit table holds ${auditNow - info.auditBefore} new reviewed-note rows, expected ${info.planned}`);
          return problems;
        }),
        probe: (info) => independent(async (tx) => {
          const b = await surfaceDigest(tx);
          if (b.digest === plan.baselineDigest) return 'unchanged' as const;
          return allPresent(await readLive(tx, entries)) && b.picks === info.picksBefore + info.planned ? ('applied' as const) : ('other' as const);
        }),
        persist: (record) => write({ ...record, planDigest: plan.digest }),
      });
      for (const line of reportLines(report)) console.log(line);
      process.exitCode = report.exitCode;
    } finally { await writer.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
}

function main() {
  return run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('ISSUE-336 insert refused:') ? error.message : 'ISSUE-336 insert refused or failed; inspect restricted evidence. No automatic retry.');
    process.exitCode = 1;
  });
}

if (process.argv[1] && /issue336-predraft-insert-production\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main();
