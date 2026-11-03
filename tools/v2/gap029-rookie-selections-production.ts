/** V2-GAP-029 / owner decision (3 Nov 2026): the REVIEWED, GUARDED production entry point for the eight manual Rookie Draft selections.
 *
 *   baseline  read-only digest of the draft_picks surface the plan depends on
 *   plan      read-only; target-bound; resolves every selection's player, club and conflicts; digest-sealed; names the actor
 *   apply     needs the plan, an approval pinned to the plan digest, a clean HEAD, fresh backup + verified restore evidence
 *   verify    read-only after the fact: the eight rows, their overrides, unchanged pre-existing rows, optional audit-table count
 *
 *   node --import tsx --conditions=react-server tools/v2/gap029-rookie-selections-production.ts baseline --target T --out O
 *   ... plan   --target T --actor-user-id N --backup B --backup-file F --restore-evidence R --out O          (production)
 *   ... plan   --target T --actor-user-id N --rehearsal --out O                                             (isolated clone only)
 *   ... apply  --plan P --approval A --backup-file F --restore-evidence R --out O                           (production)
 *   ... apply  --plan P --rehearsal --out O                                                                 (isolated clone only)
 *   ... verify --plan P --apply-record A --out O                                                            (read-only; AFLDB_GAP029_AUDIT_DSN optional)
 *
 * The write IS the existing audited admin mutation: `createManualPickInTransaction` (src/db/queries/admin-draft.ts), the very code
 * `createManualPick` runs for the admin editor, so validation, selection-conflict refusal, durable-identity resolution, the
 * data_overrides selection payload and the `data_edits` audit row with the V2-GAP-006 sealed-season correction guard are the editor's own.
 * What this file adds is only the ceremony around it:
 *   - ACTOR: a real `auth_users.id` is named in the plan and the approval. Inside the write transaction, before any write, the
 *     migration-105 function `assert_viable_super_admin_actor(id)` proves it is an enabled, fully-enrolled, non-fixture Super Admin
 *     (the role the editor's `data.draft.edit` capability requires) and row-locks it FOR SHARE until commit. There is no synthetic
 *     actor, no creation of a user, no bypass flag and no widened grant. The sealed-season correction note is built here from the
 *     reviewed evidence (always >= 20 characters) and judged by the guard like any editor note.
 *   - ONE transaction: all selections that need inserting commit together or none does. Every non-ok editor result THROWS, which
 *     rolls the whole transaction back (the editor returns refusals; a caller composing several writes must not commit past one).
 *   - AFTER the writes, still inside the transaction: exactly N new draft_picks rows with exactly the reviewed content, N new
 *     data_overrides rows, the audit sequence advanced by exactly N, and every pre-existing draft_picks row byte-identical;
 *     otherwise it rolls back.
 *   - BINDING: the plan digest covers the target identity, the reviewed revision, the evidence and outcomes-file hashes, the baseline
 *     digest, the actor and every resolved id/action; the approval pins the digest, target, revision, evidence, actor, operation.
 *
 * Transport: reads and the target proof use AFLDB_GAP029_DSN (read-only session for baseline/plan/verify); the write uses
 * AFLDB_GAP029_WRITE_DSN (the afldb_import role). Both must name exactly the reviewed target. Output files lie outside the checkout and
 * are created exclusively. No retry, no Git write. The tool never creates, edits or disables a user.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import postgres from 'postgres';

import { loadRookieRelistingOutcomes, type RookieRelistingOutcome } from '../../tests/rookie-relisting-outcomes';

export const EVIDENCE_PATH = 'docs/v2/evidence/gap-029-rookie-selections-2026-11-03.json';
export const OUTCOMES_PATH = 'data/players/rookie-relisting-outcomes.csv';
export const OPERATION = 'gap029-rookie-selections';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DRAFT_TYPE = 'Rookie';
export const DRAFT_KIND = 'rookie';
export const MANUAL_SOURCE = 'manual';
const PICK_LINK = "ARRAY['player_id','link_status_value','match_method','confidence_notes']";

/** What the reviewed owner decision adds to each CSV row: the production player id (read live 3 Nov), the club slug, the
 * closure cells and how the pick number and the re-drafting itself are corroborated. Pinned here and recomputed against the CSV. */
export const REVIEWED: Record<string, { playerId: number; clubSlug: string; cells: number; pickNumberBasis: string; redraftCorroboration: string }> = {
  'players/A/Adam_Schneider.html': { playerId: 57, clubSlug: 'st-kilda', cells: 3, pickNumberBasis: 'primary: the club\'s own Rookie Draft coverage (saints.com.au) names pick 54',
    redraftCorroboration: 'club-official coverage names the re-draft and the pick' },
  'players/L/Lachie_Henderson.html': { playerId: 8350, clubSlug: 'geelong', cells: 3, pickNumberBasis: 'primary: geelongcats.com.au lists "Pick 35, Rookie Draft"',
    redraftCorroboration: 'club-official draftee review names the Rookie Draft pick' },
  'players/P/Phil_Davis.html': { playerId: 10673, clubSlug: 'greater-western-sydney', cells: 4, pickNumberBasis: 'primary: AFL.com.au 2022 draft rundown, GWS Rookie Draft pick 3 (re-listed)',
    redraftCorroboration: 'official AFL.com.au draft rundown marks the selection as a re-listing' },
  'players/S/Sam_Reid2.html': { playerId: 11672, clubSlug: 'sydney', cells: 2, pickNumberBasis: 'primary: afl.com.au "selected at pick No.11 in the Rookie Draft with Sydney"',
    redraftCorroboration: 'official afl.com.au report; the draft was held in 2023 for the 2024 season' },
  'players/L/Lewis_Taylor.html': { playerId: 8793, clubSlug: 'sydney', cells: 1, pickNumberBasis: 'primary: sydneyswans.com.au "re-list Lewis Taylor in Rookie Draft ... with pick 10"',
    redraftCorroboration: 'club-official report names the re-listing and the pick' },
  'players/P/Paul_Seedsman.html': { playerId: 10348, clubSlug: 'adelaide', cells: 2, pickNumberBasis: 'primary: afl.com.au 2022 draft rundown, Adelaide Rookie Draft "21. Paul Seedsman (re-listed)"',
    redraftCorroboration: 'official afl.com.au draft rundown marks the selection as a re-listing' },
  'players/M/Michael_Rischitelli.html': { playerId: 9575, clubSlug: 'gold-coast', cells: 3,
    pickNumberBasis: 'SECONDARY, not primary: Wikipedia\'s "2019 AFL rookie draft" page (season-labelled) lists him as the first round\'s second selection. The club article names no pick number.',
    redraftCorroboration: 'goldcoastfc.com.au "Rischitelli to play on in 2019" (club-official) records the club committing to select him at the Rookie Draft on Friday 23 November 2018, and the owner states official AFL reporting corroborates the re-drafting' },
  'players/B/Bryce_Gibbs.html': { playerId: 2443, clubSlug: 'adelaide', cells: 5,
    pickNumberBasis: 'SECONDARY, not primary: Zero Hanger citing The Age (Daniel Cherny, 10 Dec 2020), "Crows to re-draft Bryce Gibbs with Pick 1 in rookie draft". No primary AFL or club article naming the pick was found.',
    redraftCorroboration: 'the owner states official AFL reporting corroborates the re-drafting; that article is not named in the instruction, the reviewed CSV or the sources retrievable when this record was built, so it is not cited, and it is not the pick-number source' },
};

export interface Entry {
  afltablesProfile: string; player: string; expectedPlayerId: number;
  draftEventYear: number; firstPlayingSeason: number; draftType: string; draftKind: string;
  clubName: string; clubSlug: string; pick: number; cells: number;
  pickNumberEvidence: 'primary' | 'secondary'; pickNumberBasis: string; redraftCorroboration: string;
  sourceEvidence: string; reference: string; detail: string; correctionNote: string; rowSha256: string;
}
export interface Existing { id: number; pick_number: number | null; club_id: number | null; source_key: string | null; draft_type: string; detail: string | null; player_id: number | null }
export interface Live { playerIds: Map<string, number[]>; clubIds: Map<string, number[]>; sameEvent: Map<string, Existing[]>; byPick: Map<string, Existing[]> }
export interface Resolved { playerId: number; clubId: number; action: 'to insert' | 'already present' }

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const fail = (why: string): never => { throw new Error(`GAP-029 rookies refused: ${why}`); };
export const eventKey = (playerId: number, year: number) => JSON.stringify([playerId, year, DRAFT_KIND]);
export const pickKey = (year: number, pick: number) => JSON.stringify([year, DRAFT_KIND, pick]);
export const rowDigest = (e: Omit<Entry, 'rowSha256'>) => sha(canon(e));

/** Pure: the reviewed entries, derived from the tracked outcomes CSV and the pinned decision table. */
export function buildEntries(outcomes: readonly RookieRelistingOutcome[]): Entry[] {
  if (outcomes.length !== 8 || outcomes.some((o) => o.verdict !== 'gridley_supported')) fail('the reviewed rookie population changed');
  const profiles = new Set(outcomes.map((o) => o.afltablesProfile));
  if (profiles.size !== 8 || Object.keys(REVIEWED).some((p) => !profiles.has(p))) fail('the reviewed rookie population differs from the decision table');
  return outcomes.map((o) => {
    const r = REVIEWED[o.afltablesProfile]!;
    const detail = `V2-GAP-029; ${o.reference}; draft event year=${o.eventYear}; first playing season=${o.eventYear + 1}; pick-number evidence=${o.evidenceStrength}; ${o.evidence}`;
    const correctionNote = `V2-GAP-029 owner-approved correction (3 Nov 2026): record the reviewed ${o.eventYear} Rookie Draft selection of ${o.player} (${o.eventClub}, pick ${o.pick}); `
      + `pick-number evidence is ${o.evidenceStrength}; see ${o.reference}.`;
    if (detail.length > 2000 || correctionNote.length < 20 || correctionNote.length > 2000) fail(`${o.afltablesProfile}: detail or correction note length`);
    const base = { afltablesProfile: o.afltablesProfile, player: o.player, expectedPlayerId: r.playerId, draftEventYear: o.eventYear, firstPlayingSeason: o.eventYear + 1,
      draftType: DRAFT_TYPE, draftKind: DRAFT_KIND, clubName: o.eventClub, clubSlug: r.clubSlug, pick: o.pick, cells: r.cells, pickNumberEvidence: o.evidenceStrength,
      pickNumberBasis: r.pickNumberBasis, redraftCorroboration: r.redraftCorroboration, sourceEvidence: o.evidence, reference: o.reference, detail, correctionNote };
    return { ...base, rowSha256: rowDigest(base) };
  });
}

/** Pure: why an entry cannot be inserted against what the target holds, or the resolved ids and the action. */
export function entryProblem(e: Entry, live: Live): string | Resolved {
  const { rowSha256, ...rest } = e;
  if (rowDigest(rest) !== rowSha256) return `${e.afltablesProfile}: evidence row digest differs from its content`;
  const players = live.playerIds.get(e.afltablesProfile) ?? [];
  if (players.length !== 1) return `${e.afltablesProfile}: profile resolves to ${players.length} players, not exactly one`;
  if (players[0] !== e.expectedPlayerId) return `${e.afltablesProfile}: resolves to player ${players[0]}, the reviewed identity is ${e.expectedPlayerId}`;
  const clubs = live.clubIds.get(e.clubSlug) ?? [];
  if (clubs.length !== 1) return `${e.afltablesProfile}: club ${e.clubSlug} resolves to ${clubs.length} clubs, not exactly one`;
  const playerId = players[0]; const clubId = clubs[0];
  const held = live.sameEvent.get(eventKey(playerId, e.draftEventYear)) ?? [];
  if (held.length > 1) return `${e.afltablesProfile}: the player already holds ${held.length} ${e.draftEventYear} rookie selections`;
  if (held.length === 1) {
    const h = held[0];
    const equal = h.pick_number === e.pick && h.club_id === clubId && h.source_key === MANUAL_SOURCE && h.draft_type === DRAFT_TYPE && h.detail === e.detail;
    return equal ? { playerId, clubId, action: 'already present' } : `${e.afltablesProfile}: selection #${h.id} already exists for this player, year and kind with different content; nothing is adopted or mutated`;
  }
  const clash = (live.byPick.get(pickKey(e.draftEventYear, e.pick)) ?? []).filter((r) => r.player_id !== playerId);
  if (clash.length) return `${e.afltablesProfile}: pick ${e.pick} of the ${e.draftEventYear} rookie draft is held by selection #${clash[0].id} (another player); nothing is adopted or mutated`;
  return { playerId, clubId, action: 'to insert' };
}

export interface Target { host: string; port: number; database: string; user: string; systemIdentifier: string; databaseOid: string; clusterName: string; databaseComment: string | null }
export interface Backup { target: Target; sha256: string; restoreEvidenceSha256: string; capturedAt: string; restoredAt: string; baselineDigest: string }
export interface Plan { operation: string; revision: string; target: Target; rehearsal: boolean; actorUserId: number; evidenceSha256: string; outcomesSha256: string; baselineDigest: string;
  backup: Backup | null; createdAt: string; expiresAt: string; entries: (Entry & Resolved)[]; digest: string }
export interface Approval { planDigest: string; target: Target; revision: string; operation: string; evidenceSha256: string; actorUserId: number; approvedAt: string; expiresAt: string; reference: string }
export const planDigest = (p: Omit<Plan, 'digest'>) => sha(canon(p));
const fresh = (iso: string, now: number) => { const t = Date.parse(iso); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE_MS; };

/** Pure: every reason an execution approval does not bind to this plan, the live revision and evidence. Null when it binds. */
export function approvalProblem(plan: Plan, approval: Approval | null, ctx: { now: number; revision: string; evidenceSha256: string }): string | null {
  const { digest, ...body } = plan;
  if (digest !== planDigest(body)) return 'plan digest differs from its content';
  if (plan.operation !== OPERATION || plan.evidenceSha256 !== ctx.evidenceSha256 || plan.revision !== ctx.revision) return 'plan operation, evidence or revision differs';
  if (!(Date.parse(plan.expiresAt) > ctx.now)) return 'stale plan';
  if (plan.rehearsal) return null;
  if (!approval || !plan.backup) return 'missing execution approval or backup evidence';
  if (approval.planDigest !== plan.digest || approval.operation !== OPERATION || !same(approval.target, plan.target) || approval.revision !== ctx.revision
    || approval.evidenceSha256 !== ctx.evidenceSha256 || approval.actorUserId !== plan.actorUserId) return 'approval does not bind to this plan, target, revision, evidence and actor';
  if (!(Date.parse(approval.expiresAt) > ctx.now) || Date.parse(approval.expiresAt) > Date.parse(plan.expiresAt) || !(Date.parse(approval.approvedAt) <= ctx.now)) return 'approval window invalid or expired';
  if (!String(approval.reference ?? '').trim()) return 'approval carries no written reference';
  if (!fresh(plan.backup.capturedAt, ctx.now) || !fresh(plan.backup.restoredAt, ctx.now)) return 'backup no longer fresh';
  return null;
}

function readEvidence(): { entries: Entry[]; sha: string; outcomesSha: string } {
  const normalised = Buffer.from(readFileSync(EVIDENCE_PATH).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const doc = JSON.parse(normalised.toString('utf8')) as { entries: Entry[]; outcomes: { sha256: string } };
  const outcomesBytes = Buffer.from(readFileSync(OUTCOMES_PATH).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (sha(outcomesBytes) !== doc.outcomes.sha256) fail('the tracked rookie outcomes file differs from the reviewed bytes');
  const built = buildEntries(loadRookieRelistingOutcomes(outcomesBytes.toString('utf8')));
  if (!same(built, doc.entries)) fail('the evidence file differs from the entries derived from the tracked outcomes file');
  return { entries: built, sha: sha(normalised), outcomesSha: doc.outcomes.sha256 };
}

async function readLive(s: postgres.Sql | postgres.TransactionSql, entries: readonly Entry[]): Promise<Live> {
  const playerIds = new Map<string, number[]>();
  for (const r of await s<{ external_id: string; player_id: number }[]>`SELECT DISTINCT ei.external_id, ei.player_id::int AS player_id FROM external_identities ei
      JOIN sources so ON so.id = ei.source_id WHERE so.key = 'afltables' AND ei.match_method = 'afltables_profile_url' AND ei.status::text IN ('unique','resolved')
      AND ei.player_id IS NOT NULL AND ei.external_id = ANY(${entries.map((e) => e.afltablesProfile)})`) playerIds.set(r.external_id, [...(playerIds.get(r.external_id) ?? []), r.player_id]);
  const clubIds = new Map<string, number[]>();
  for (const r of await s<{ id: number; slug: string }[]>`SELECT id::int AS id, slug FROM clubs WHERE slug = ANY(${entries.map((e) => e.clubSlug)})`) clubIds.set(r.slug, [...(clubIds.get(r.slug) ?? []), r.id]);
  const rows = await s<(Existing & { draft_year: number })[]>`SELECT dp.id::int AS id, dp.draft_year::int AS draft_year, dp.pick_number::int AS pick_number, dp.club_id::int AS club_id, so.key AS source_key,
      dp.draft_type, dp.detail, dp.player_id::int AS player_id FROM draft_picks dp LEFT JOIN sources so ON so.id = dp.source_id
      WHERE dp.draft_kind = ${DRAFT_KIND} AND dp.draft_year = ANY(${[...new Set(entries.map((e) => e.draftEventYear))]})`;
  const sameEvent = new Map<string, Existing[]>(); const byPick = new Map<string, Existing[]>();
  for (const r of rows) {
    if (r.player_id !== null) sameEvent.set(eventKey(r.player_id, r.draft_year), [...(sameEvent.get(eventKey(r.player_id, r.draft_year)) ?? []), r]);
    if (r.pick_number !== null) byPick.set(pickKey(r.draft_year, r.pick_number), [...(byPick.get(pickKey(r.draft_year, r.pick_number)) ?? []), r]);
  }
  return { playerIds, clubIds, sameEvent, byPick };
}

/** Whole-surface digest: every draft_picks row EXCEPT the link columns (a link-only DraftGuru import leaves it equal), plus the draft overrides. */
async function surfaceDigest(s: postgres.Sql | postgres.TransactionSql, maxId: number | null): Promise<{ digest: string; picks: number; maxId: number; overrides: number; maxOverrideId: number; overridesDigest: string }> {
  const [p] = await s.unsafe(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg((to_jsonb(t) - ${PICK_LINK})::text, '|' ORDER BY id)),'') AS d
      FROM draft_picks t WHERE ($1::int IS NULL OR id <= $1::int)`, [maxId]) as unknown as { n: number; mx: number; d: string }[];
  const [o] = await s.unsafe(`SELECT count(*)::int AS n, coalesce(max(id),0)::int AS mx, coalesce(md5(string_agg(concat_ws(',', id, entity_key, field_group, override_values::text, admin_user_id, is_active), '|' ORDER BY id)),'') AS d
      FROM data_overrides WHERE entity_type = 'draft_picks'`) as unknown as { n: number; mx: number; d: string }[];
  return { digest: sha(canon({ p, o })), picks: p.n, maxId: p.mx, overrides: o.n, maxOverrideId: o.mx, overridesDigest: o.d };
}

/** Full-row digest (every column, link columns included) of the draft_picks and draft override rows that existed before the write. */
async function priorRowsDigest(s: postgres.Sql | postgres.TransactionSql, maxPickId: number, maxOverrideId: number): Promise<string> {
  const [p] = await s.unsafe(`SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM draft_picks t WHERE id <= $1::int`, [maxPickId]) as unknown as { d: string }[];
  const [o] = await s.unsafe(`SELECT coalesce(md5(string_agg(to_jsonb(t)::text, '|' ORDER BY id)),'') AS d FROM data_overrides t WHERE entity_type = 'draft_picks' AND id <= $1::int`, [maxOverrideId]) as unknown as { d: string }[];
  return sha(canon({ p: p.d, o: o.d }));
}

async function auditSequence(s: postgres.Sql | postgres.TransactionSql): Promise<number | null> {
  const [r] = await s<{ v: string | null }[]>`SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'data_edits_id_seq'`;
  return r?.v == null ? null : Number(r.v);
}

async function run() {
  const mode = process.argv[2];
  const args = process.argv.slice(3);
  const flag = (f: string) => args.includes(f);
  const opt = (f: string): string => { const i = args.indexOf(f); if (i < 0 || !args[i + 1]) throw new Error(`${f} required`); return args[i + 1]; };
  if (!['baseline', 'plan', 'apply', 'verify'].includes(mode ?? '')) fail('mode must be baseline, plan, apply or verify');
  const root = process.cwd();
  const outside = (p: string): string => { const abs = resolve(p); const rel = relative(root, abs); if (!rel.startsWith('..') || isAbsolute(rel)) fail('evidence files must be outside the checkout'); return abs; };
  const json = <T,>(p: string): T => JSON.parse(readFileSync(outside(p), 'utf8')) as T;
  const out = outside(opt('--out'));
  if (existsSync(out)) fail('output already exists; preserve evidence and choose another path');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (mode === 'apply' || mode === 'plan') { execFileSync('git', ['diff', '--quiet']); execFileSync('git', ['diff', '--cached', '--quiet']); }
  const plan0 = mode === 'apply' || mode === 'verify' ? json<Plan>(opt('--plan')) : null;
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
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
  const prove = async (s: postgres.TransactionSql, writerRole = false): Promise<void> => {
    const [row] = await s<Record<string, string | null>[]>`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier",
      d.oid::text AS "databaseOid", current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
    if (writerRole && row?.user !== 'afldb_import') fail('the write connection must be the afldb_import role');
    if (!row || !same({ ...row, ...(writerRole ? { user: target.user } : {}) }, { database: target.database, user: target.user, systemIdentifier: target.systemIdentifier, databaseOid: target.databaseOid, clusterName: target.clusterName, databaseComment: target.databaseComment })) fail('live database identity differs from the reviewed target');
  };
  const resolveAll = (live: Live): (Entry & Resolved)[] => evidence.entries.map((e) => { const r = entryProblem(e, live); if (typeof r === 'string') return fail(r); return { ...e, ...r }; });
  const now = Date.now();
  const write = (v: unknown) => writeFileSync(out, `${JSON.stringify(v, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    if (mode === 'baseline') {
      const b = await sql.begin('read only isolation level repeatable read', async (tx) => { await prove(tx); return surfaceDigest(tx, null); });
      write({ target, revision, baselineDigest: b.digest, draftPicks: b.picks, maxDraftPickId: b.maxId, draftOverrides: b.overrides, capturedAt: new Date().toISOString() });
      console.log(`Read-only draft_picks baseline ${b.digest} (${b.picks} picks, ${b.overrides} overrides)`);
      return;
    }
    const fileHash = (p: string) => sha(readFileSync(outside(p)));
    if (mode === 'plan') {
      const actorUserId = Number(opt('--actor-user-id'));
      if (!Number.isInteger(actorUserId) || actorUserId < 1) fail('--actor-user-id must be a real auth_users id');
      const backup = rehearsal ? null : json<Backup>(opt('--backup'));
      if (backup) {
        if (!same(backup.target, target) || !fresh(backup.capturedAt, now) || !fresh(backup.restoredAt, now) || Date.parse(backup.restoredAt) < Date.parse(backup.capturedAt)) fail('fresh target-bound backup and verified restore evidence required');
        if (fileHash(opt('--backup-file')) !== backup.sha256 || fileHash(opt('--restore-evidence')) !== backup.restoreEvidenceSha256) fail('backup or restore evidence content differs');
      }
      const result = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const [fn] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'assert_viable_super_admin_actor'`;
        if (fn.n !== 1) fail('the actor-viability assertion (migration 105) is not installed on the target');
        const b = await surfaceDigest(tx, null);
        if (backup && b.digest !== backup.baselineDigest) fail('baseline drift: the restored backup no longer matches the live target');
        const entries = resolveAll(await readLive(tx, evidence.entries));
        const body: Omit<Plan, 'digest'> = { operation: OPERATION, revision, target, rehearsal, actorUserId, evidenceSha256: evidence.sha, outcomesSha256: evidence.outcomesSha, baselineDigest: b.digest, backup,
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_AGE_MS).toISOString(), entries };
        return { ...body, digest: planDigest(body) } as Plan;
      });
      write(result);
      console.log(`Review plan ${result.digest}; no writes (${result.entries.filter((e) => e.action === 'to insert').length} to insert, ${result.entries.filter((e) => e.action === 'already present').length} already present); actor ${actorUserId} is asserted only at apply`);
      return;
    }
    const plan = plan0!;
    if (mode === 'verify') {
      const record = json<{ planDigest: string; createdPickIds: number[]; maxIdBefore: number }>(opt('--apply-record'));
      if (record.planDigest !== plan.digest) fail('the apply record belongs to a different plan');
      const report = await sql.begin('read only isolation level repeatable read', async (tx) => {
        await prove(tx);
        const live = await readLive(tx, evidence.entries);
        const entries = evidence.entries.map((e) => entryProblem(e, live));
        const present = entries.filter((r) => typeof r !== 'string' && r.action === 'already present').length;
        const preserved = await surfaceDigest(tx, record.maxIdBefore);
        const totals = await surfaceDigest(tx, null);
        const ov = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'draft_picks' AND field_group = 'selection' AND is_active
          AND admin_user_id = ${plan.actorUserId} AND (override_values ->> 'detail') LIKE 'V2-GAP-029;%' AND (override_values ->> 'draft_kind') = ${DRAFT_KIND}`;
        let audit: unknown = 'not checked: set AFLDB_GAP029_AUDIT_DSN to a role that can read data_edits';
        const auditDsn = process.env.AFLDB_GAP029_AUDIT_DSN;
        if (auditDsn) {
          sameDb(auditDsn, false);
          const a = postgres(auditDsn, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
          try { audit = (await a`SELECT count(*)::int AS n, count(DISTINCT row_id)::int AS players, min(admin_user_id)::int AS actor_min, max(admin_user_id)::int AS actor_max
            FROM data_edits WHERE table_name = 'players' AND field_group = 'draft_selection' AND note LIKE 'V2-GAP-029 owner-approved correction%'`)[0]; } finally { await a.end({ timeout: 5 }); }
        }
        return { entriesPresent: present, entriesTotal: entries.length, refusals: entries.filter((r) => typeof r === 'string'), preExistingNonLinkDigestAtBoundary: preserved.digest, draftPicksNow: totals.picks, draftPicksAtBaseline: plan.baselineDigest ? 'see plan.baselineDigest' : null,
          selectionOverridesByActor: ov[0].n, audit };
      });
      write({ planDigest: plan.digest, checkedAt: new Date().toISOString(), ...report });
      console.log(`Read-only verification: ${report.entriesPresent}/${report.entriesTotal} selections present`);
      return;
    }
    const problem = approvalProblem(plan, rehearsal ? null : json<Approval>(opt('--approval')), { now, revision, evidenceSha256: evidence.sha });
    if (problem) fail(problem);
    if (!rehearsal) {
      const pb = plan.backup!;
      if (fileHash(opt('--backup-file')) !== pb.sha256 || fileHash(opt('--restore-evidence')) !== pb.restoreEvidenceSha256) fail('backup or restore evidence content differs');
    }
    // The editor module builds (but does not connect) the app's own pools when imported. Point them at the reviewed read-only target BEFORE the import
    // so nothing can fall back to an ambient configuration; they are never queried on this path (the mutation runs on the caller's transaction).
    process.env.DATABASE_URL = dsn; process.env.AFLDB_AUTH_DATABASE_URL = dsn;
    const { createManualPickInTransaction } = await import('../../src/db/queries/admin-draft');
    const writer = postgres(process.env.AFLDB_GAP029_WRITE_DSN ?? '', { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      const result = await writer.begin('isolation level repeatable read', async (tx) => {
        await prove(tx, true);
        // The actor FIRST: an enabled, fully-enrolled, non-fixture Super Admin, row-locked FOR SHARE until this transaction ends.
        try { await tx`SELECT public.assert_viable_super_admin_actor(${plan.actorUserId}::int)`; } catch { fail(`actor ${plan.actorUserId} is not a viable Super Admin; nothing written`); }
        const before = await surfaceDigest(tx, null);
        if (before.digest !== plan.baselineDigest) fail('baseline drift; re-plan and obtain new execution approval');
        const live = await readLive(tx, evidence.entries);
        const entries = resolveAll(live);
        if (!same(entries.map((e) => ({ k: e.afltablesProfile, p: e.playerId, c: e.clubId, a: e.action })), plan.entries.map((e) => ({ k: e.afltablesProfile, p: e.playerId, c: e.clubId, a: e.action })))) fail('the live resolution differs from the reviewed plan');
        const todo = entries.filter((e) => e.action === 'to insert');
        if (todo.length === 0) return { replay: true, written: 0 };
        const priorBefore = await priorRowsDigest(tx, before.maxId, before.maxOverrideId);
        const seqBefore = await auditSequence(tx);
        if (seqBefore === null) fail('the audit sequence is not readable, so exactly-N audit rows cannot be proved; nothing written');
        const created: { profile: string; pickId: number; playerId: number; token: string }[] = [];
        for (const e of todo) {
          const r = await createManualPickInTransaction(tx, { playerId: e.playerId, adminUserId: plan.actorUserId, draftYear: e.draftEventYear, draftType: e.draftType, draftKind: e.draftKind,
            pickNumber: e.pick, clubSlug: e.clubSlug, detail: e.detail, note: e.correctionNote });
          // any non-ok result throws, so the whole transaction rolls back; nothing is confirmed on the operator's behalf
          if (!r.ok) return fail(`the audited editor path refused ${e.afltablesProfile}: ${'error' in r ? r.error : 'confirmation required'}`);
          created.push({ profile: e.afltablesProfile, pickId: r.pickId, playerId: r.playerId, token: r.pickToken });
        }
        const seqAfter = await auditSequence(tx);
        const total = await surfaceDigest(tx, null);
        const cur = await readLive(tx, evidence.entries);
        const allThere = evidence.entries.every((e) => { const x = entryProblem(e, cur); return typeof x !== 'string' && x.action === 'already present'; });
        const newRows = await tx<{ id: number; club_id: number; pick_number: number; player_id: number }[]>`SELECT id::int AS id, club_id::int AS club_id, pick_number::int AS pick_number, player_id::int AS player_id
          FROM draft_picks WHERE id = ANY(${created.map((c) => c.pickId)})`;
        const clubsOk = todo.every((e) => { const n = newRows.find((r) => r.player_id === e.playerId); return n && n.club_id === e.clubId && n.pick_number === e.pick; });
        // commits only if: every pre-existing row byte-identical, exactly N new rows/overrides, exactly N audit ids consumed, content as reviewed
        if (total.picks !== before.picks + todo.length || total.overrides !== before.overrides + todo.length || seqAfter !== (seqBefore as number) + todo.length || !allThere || !clubsOk || newRows.length !== todo.length) fail('post-write verification failed; rolled back');
        if (await priorRowsDigest(tx, before.maxId, before.maxOverrideId) !== priorBefore) fail('a pre-existing draft_picks or override row changed; rolled back');
        return { replay: false, written: todo.length, created, maxIdBefore: before.maxId, auditSequenceBefore: seqBefore, auditSequenceAfter: seqAfter, draftPicksAfter: total.picks };
      });
      write({ ...result, planDigest: plan.digest, at: new Date().toISOString() });
      console.log(result.replay ? 'Every selection is already present; nothing written' : `Committed ${result.written} selections in one transaction; review restricted output`);
    } finally { await writer.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
}

function main() {
  return run().catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith('GAP-029 rookies refused:') ? error.message : 'GAP-029 rookies refused or failed; inspect restricted evidence. No automatic retry.');
    process.exitCode = 1;
  });
}

if (process.argv[1] && /gap029-rookie-selections-production\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) void main();
