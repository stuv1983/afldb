/**
 * AFLDB-ISSUE-350 — OPENING the in-progress season in a LIVE database.
 *
 * `tools/db/rollover-season.ts` moves a completed season out of the in-season pipeline by editing the TRACKED
 * reference files; nothing writes the `seasons` row or the current clubs' `last_season` into a database that
 * was loaded before that rollover. A rebuilt database gets both from `tools/migration/load_reference_data.py`
 * (`load_seasons`, `load_clubs`); production, loaded earlier, has neither for 2027, so the AFL API settle
 * fails on `afl_api_match_season_fkey` from the first concluded 2027 match.
 *
 * This module is the PURE half of the audited operation that closes that gap, plus the read-only reader both
 * the operation and the gate check share. It has no opinion the tracked contract does not state:
 *
 *   season row      exactly what `load_seasons` derives: year, league (league_eras), status (in_progress_seasons),
 *                   notes (season_notes); every measured column stays NULL and no date is written.
 *   club identities exactly what `load_clubs` derives: an identity whose `clubs.json` last_season is null takes
 *                   `seasons.json` last_season. Only those identities, and only from year - 1.
 *   organisations   `club_organizations.last_season` = max over members, which for an open identity is `year`.
 *
 * Classification is three-valued per part (absent -> change, equal -> nothing, different -> REFUSE). There is no
 * "ON CONFLICT DO NOTHING" anywhere: a row that exists with the wrong league or status is a refusal, not a pass.
 */
import { createHash } from 'node:crypto';

import type postgres from 'postgres';

type Db = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;

export class OpeningRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpeningRefused';
  }
}

/* ------------------------------------------------------------------ *
 * The tracked contract
 * ------------------------------------------------------------------ */

export interface OpenIdentity { hist: string; slug: string; firstSeason: number }
export interface OpeningExpectation {
  year: number;
  previousYear: number;
  league: 'VFL' | 'AFL';
  status: 'in_progress';
  notes: string | null;
  /** Identities open in `clubs.json` (last_season null), which `load_clubs` ends at `year`. */
  open: readonly OpenIdentity[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Derive what a freshly loaded database holds for the season being opened, from the two tracked documents.
 * Refuses unless the contract covers the year, declares it in progress and has a coherent open set.
 */
export function expectedOpening(seasonsDoc: unknown, clubsDoc: unknown, requestedYear?: number): OpeningExpectation {
  const root = (seasonsDoc ?? {}) as Row;
  const first = root.first_season;
  const last = root.last_season;
  if (!isInt(first) || !isInt(last)) throw new OpeningRefused('seasons.json declares no integer first_season/last_season.');
  const year = requestedYear ?? last;
  if (year !== last) {
    throw new OpeningRefused(`the tracked register ends at ${last}; it does not cover season ${year}, so nothing defines that row.`);
  }
  const inProgress = Array.isArray(root.in_progress_seasons) ? (root.in_progress_seasons as unknown[]) : [];
  if (!inProgress.every(isInt) || !inProgress.includes(year)) {
    throw new OpeningRefused(`seasons.json does not declare ${year} in progress (in_progress_seasons ${JSON.stringify(inProgress)}); `
      + 'there is no in-progress season row to open.');
  }
  let league: string | null = null;
  const eras = Array.isArray(root.league_eras) ? (root.league_eras as Row[]) : [];
  for (const era of eras) {
    const eraFirst = era.first_season; const eraLast = era.last_season === null ? last : era.last_season;
    if (isInt(eraFirst) && isInt(eraLast) && year >= eraFirst && year <= eraLast) league = String(era.league);
  }
  if (league !== 'VFL' && league !== 'AFL') throw new OpeningRefused(`seasons.json league_eras give no VFL/AFL league for ${year}.`);
  const notesDoc = (root.season_notes ?? {}) as Record<string, unknown>;
  const rawNote = notesDoc[String(year)];
  const notes = rawNote === undefined || rawNote === null ? null : String(rawNote);

  const identities = Array.isArray((clubsDoc as Row | null)?.identities) ? ((clubsDoc as Row).identities as Row[]) : [];
  if (identities.length === 0) throw new OpeningRefused('clubs.json carries no identities.');
  const open: OpenIdentity[] = [];
  for (const identity of identities) {
    const openEra = identity.last_season === null || identity.last_season === undefined;
    if (!openEra) continue;
    // load_clubs reads the same three facts; if they disagree the register is incoherent and nothing is derived.
    if (identity.succession !== 'current' || identity.is_current_afl_club !== true) {
      throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} has no last_season but is not a current AFL club.`);
    }
    if (!isInt(identity.first_season)) throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} has no first_season.`);
    open.push({ hist: String(identity.hist), slug: String(identity.slug), firstSeason: identity.first_season });
  }
  for (const identity of identities) {
    if (identity.is_current_afl_club === true && identity.last_season !== null && identity.last_season !== undefined) {
      throw new OpeningRefused(`clubs.json identity ${String(identity.hist)} is a current AFL club with a closed era.`);
    }
  }
  if (open.length === 0) throw new OpeningRefused('clubs.json has no open identity; there is no current club to carry into the season.');
  return { year, previousYear: year - 1, league, status: 'in_progress', notes, open };
}

/* ------------------------------------------------------------------ *
 * Live facts
 * ------------------------------------------------------------------ */

export interface OpeningFacts {
  maxYear: number | null;
  /** Every `seasons` row as `to_jsonb`, ordered by year. */
  seasons: Row[];
  /** Every `clubs` row as `to_jsonb`, ordered by id. */
  clubs: Row[];
  /** Every `club_organizations` row as `to_jsonb`, ordered by id. */
  orgs: Row[];
  /** md5 of afldb_identity_for_season(org, s) for EVERY organisation and every season s <= previousYear. */
  identityHistoryDigest: string;
  /** afldb_identity_for_season(org, year) per organisation (null when no identity trades that year). */
  identityForYear: { org: number; club: number | null }[];
  /** afldb_season_list_clubs(previousYear) and (year) as sorted id lists. */
  listPrevious: number[];
  listYear: number[];
  batches: { n: number; maxId: number };
}

async function jsonRows(rows: Promise<{ j: string }[]>): Promise<Row[]> {
  return (await rows).map((r) => JSON.parse(r.j) as Row);
}
const idList = (text: string | null): number[] => (text ? text.split(',').map(Number) : []);

/** The read-only reader: SELECTs only, parameterised, safe under `read only` transactions. */
export async function readOpeningFacts(db: Db, year: number): Promise<OpeningFacts> {
  const previous = year - 1;
  const [max] = await db<{ m: number | null }[]>`SELECT max(year)::int AS m FROM seasons`;
  const seasons = await jsonRows(db<{ j: string }[]>`SELECT to_jsonb(s)::text AS j FROM seasons s ORDER BY s.year`);
  const clubs = await jsonRows(db<{ j: string }[]>`SELECT to_jsonb(c)::text AS j FROM clubs c ORDER BY c.id`);
  const orgs = await jsonRows(db<{ j: string }[]>`SELECT to_jsonb(o)::text AS j FROM club_organizations o ORDER BY o.id`);
  const [history] = await db<{ d: string | null }[]>`
    SELECT md5(string_agg(o.id::text || ':' || s.year::text || ':' || coalesce(afldb_identity_for_season(o.id, s.year)::text, '-'),
                          ',' ORDER BY o.id, s.year)) AS d
      FROM club_organizations o CROSS JOIN seasons s
     WHERE s.year <= ${previous}::smallint`;
  const identityForYear = (await db<{ org: number; club: number | null }[]>`
    SELECT o.id AS org, afldb_identity_for_season(o.id, ${year}::smallint) AS club
      FROM club_organizations o ORDER BY o.id`).map((r) => ({ org: Number(r.org), club: r.club === null ? null : Number(r.club) }));
  const [prevList] = await db<{ ids: string | null }[]>`
    SELECT array_to_string(array_agg(id ORDER BY id), ',') AS ids FROM afldb_season_list_clubs(${previous}::smallint)`;
  const [yearList] = await db<{ ids: string | null }[]>`
    SELECT array_to_string(array_agg(id ORDER BY id), ',') AS ids FROM afldb_season_list_clubs(${year}::smallint)`;
  const [batch] = await db<{ n: number; mx: number }[]>`SELECT count(*)::int AS n, coalesce(max(id), 0)::int AS mx FROM import_batches`;
  return {
    maxYear: max?.m ?? null, seasons, clubs, orgs,
    identityHistoryDigest: history?.d ?? '',
    identityForYear,
    listPrevious: idList(prevList?.ids ?? null),
    listYear: idList(yearList?.ids ?? null),
    batches: { n: Number(batch.n), maxId: Number(batch.mx) },
  };
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

export type PartAction = 'change' | 'present';
export interface OpeningClassification {
  /** OPEN: every part already equals the contract. NOT_OPEN: at least one part to write, none contradicted. REFUSED: see problems. */
  state: 'OPEN' | 'NOT_OPEN' | 'REFUSED';
  season: PartAction;
  clubs: { id: number; hist: string; slug: string; organizationId: number; action: PartAction }[];
  orgs: { id: number; action: PartAction }[];
  problems: string[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The four columns `load_seasons` writes, as the live row holds them. */
function seasonCore(row: Row): Row {
  return { year: num(row.year), league: row.league, status: row.status, notes: row.notes ?? null };
}

/** Pure: judge the live facts against the contract. Writes nothing; refuses on anything unexpected. */
export function classifyOpening(exp: OpeningExpectation, facts: OpeningFacts): OpeningClassification {
  const problems: string[] = [];
  const row = facts.seasons.find((s) => num(s.year) === exp.year) ?? null;
  let season: PartAction = 'present';
  if (row === null) {
    season = 'change';
    if (facts.maxYear !== exp.previousYear) {
      problems.push(`the seasons table ends at ${String(facts.maxYear)}, not ${exp.previousYear}; the season ${exp.year} row would not be the next season`);
    }
  } else {
    const core = seasonCore(row);
    const want = { year: exp.year, league: exp.league, status: exp.status, notes: exp.notes };
    if (JSON.stringify(core) !== JSON.stringify(want)) {
      problems.push(`season ${exp.year} exists but differs from the tracked contract (live ${JSON.stringify(core)}, expected ${JSON.stringify(want)}); nothing is adopted or overwritten`);
    }
    if (facts.maxYear !== exp.year) problems.push(`season ${exp.year} exists but the seasons table ends at ${String(facts.maxYear)}`);
  }

  const histCounts = new Map<string, Row[]>();
  for (const club of facts.clubs) {
    const key = String(club.legacy_club_hist);
    histCounts.set(key, [...(histCounts.get(key) ?? []), club]);
  }
  const clubs: OpeningClassification['clubs'] = [];
  const openHists = new Set(exp.open.map((o) => o.hist));
  for (const open of exp.open) {
    const live = histCounts.get(open.hist) ?? [];
    if (live.length !== 1) { problems.push(`identity ${open.hist} resolves to ${live.length} clubs rows, not exactly one`); continue; }
    const c = live[0];
    const id = Number(c.id);
    if (c.slug !== open.slug) problems.push(`identity ${open.hist}: live slug ${String(c.slug)} differs from the register (${open.slug})`);
    if (c.is_current_afl_club !== true || c.succession !== 'current') problems.push(`identity ${open.hist} is not a current AFL club in the database`);
    if (num(c.first_season) !== open.firstSeason) problems.push(`identity ${open.hist}: first_season ${String(c.first_season)} differs from the register (${open.firstSeason}); it is never changed here`);
    if (num(c.current_identity_id) !== id) problems.push(`identity ${open.hist}: current_identity_id is not itself`);
    const last = num(c.last_season);
    let action: PartAction;
    if (last === exp.previousYear) action = 'change';
    else if (last === exp.year) action = 'present';
    else { problems.push(`identity ${open.hist}: last_season is ${String(last)}, expected ${exp.previousYear} (to open) or ${exp.year} (already open)`); continue; }
    clubs.push({ id, hist: open.hist, slug: open.slug, organizationId: Number(c.organization_id), action });
  }
  const liveCurrent = facts.clubs.filter((c) => c.is_current_afl_club === true).map((c) => String(c.legacy_club_hist));
  const extra = liveCurrent.filter((h) => !openHists.has(h));
  if (extra.length > 0) problems.push(`the database's current clubs differ from the register: not open in clubs.json: ${extra.join(', ')}`);

  const orgs: OpeningClassification['orgs'] = [];
  for (const orgId of [...new Set(clubs.map((c) => c.organizationId))].sort((a, b) => a - b)) {
    const org = facts.orgs.find((o) => num(o.id) === orgId);
    if (!org) { problems.push(`organisation ${orgId} does not exist`); continue; }
    const last = num(org.last_season);
    if (last === exp.previousYear) orgs.push({ id: orgId, action: 'change' });
    else if (last === exp.year) orgs.push({ id: orgId, action: 'present' });
    else problems.push(`organisation ${orgId}: last_season is ${String(last)}, expected ${exp.previousYear} or ${exp.year}`);
  }

  const pending = season === 'change' || clubs.some((c) => c.action === 'change') || orgs.some((o) => o.action === 'change');
  return { state: problems.length > 0 ? 'REFUSED' : pending ? 'NOT_OPEN' : 'OPEN', season, clubs, orgs, problems };
}

/* ------------------------------------------------------------------ *
 * The write (inside the caller's transaction) and the before/after proof
 * ------------------------------------------------------------------ */

/** The changes, as the plan names them (ids only). */
export interface OpeningChanges {
  insertSeason: boolean;
  clubIds: number[];
  orgIds: number[];
}

export const changesOf = (c: OpeningClassification): OpeningChanges => ({
  insertSeason: c.season === 'change',
  clubIds: c.clubs.filter((x) => x.action === 'change').map((x) => x.id).sort((a, b) => a - b),
  orgIds: c.orgs.filter((x) => x.action === 'change').map((x) => x.id).sort((a, b) => a - b),
});

/**
 * The only statements this operation issues: one INSERT into seasons (columns as load_seasons), UPDATEs of
 * `clubs.last_season` and `club_organizations.last_season` bounded by id, by the old value and by is_current.
 * Each affected-row count must equal the plan or the transaction throws.
 */
export async function writeOpening(tx: postgres.TransactionSql, exp: OpeningExpectation, changes: OpeningChanges): Promise<void> {
  if (changes.insertSeason) {
    await tx`INSERT INTO seasons (year, league, status, notes)
             VALUES (${exp.year}::smallint, ${exp.league}, 'in_progress'::season_status, ${exp.notes})`;
  }
  if (changes.clubIds.length > 0) {
    const done = await tx<{ id: number }[]>`
      UPDATE clubs SET last_season = ${exp.year}::smallint
       WHERE id = ANY(${changes.clubIds}) AND last_season = ${exp.previousYear}::smallint AND is_current_afl_club
      RETURNING id`;
    if (done.length !== changes.clubIds.length) throw new OpeningRefused(`updated ${done.length} clubs rows, the plan names ${changes.clubIds.length}`);
  }
  if (changes.orgIds.length > 0) {
    const done = await tx<{ id: number }[]>`
      UPDATE club_organizations SET last_season = ${exp.year}::smallint
       WHERE id = ANY(${changes.orgIds}) AND last_season = ${exp.previousYear}::smallint
      RETURNING id`;
    if (done.length !== changes.orgIds.length) throw new OpeningRefused(`updated ${done.length} organisation rows, the plan names ${changes.orgIds.length}`);
  }
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/** Canonical JSON (sorted keys) so a digest does not depend on key order. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/**
 * Digest of the whole surface this operation can affect. Independent of the session time zone because every
 * value is text or a number (the caller still pins Etc/UTC). `import_batches` is deliberately NOT part of it:
 * the 05:00 nightly settle adds a batch row every night, and an unrelated batch must not make a reviewed plan
 * look drifted. The batch the operation itself writes is verified by id.
 */
export function surfaceDigest(facts: OpeningFacts): string {
  return createHash('sha256').update(stable({
    seasons: facts.seasons, clubs: facts.clubs, orgs: facts.orgs, history: facts.identityHistoryDigest,
    forYear: facts.identityForYear, listPrevious: facts.listPrevious, listYear: facts.listYear,
  })).digest('hex');
}

const MEASURED = ['first_match_date', 'last_match_date', 'match_count', 'club_count', 'data_through_date', 'source_built_at', 'last_loaded_round', 'completed_at'];

/**
 * Pure: every reason the transition from `before` to `after` is not exactly the planned one. The acceptance
 * criteria of the plan review (O-1, O-2): nothing but the planned columns moved, identity history is
 * byte-identical, the year resolves for exactly the open identities, and neither season list changed.
 */
export function transitionProblems(
  exp: OpeningExpectation, changes: OpeningChanges, before: OpeningFacts, after: OpeningFacts,
): string[] {
  const out: string[] = [];
  const bySeason = (f: OpeningFacts) => new Map(f.seasons.map((s) => [num(s.year), s]));
  const b = bySeason(before); const a = bySeason(after);
  for (const [year, row] of b) if (!same(row, a.get(year))) out.push(`seasons row ${String(year)} changed`);
  const created = a.get(exp.year);
  if (!created) out.push(`season ${exp.year} is absent afterwards`);
  else {
    if (!same(seasonCore(created), { year: exp.year, league: exp.league, status: exp.status, notes: exp.notes })) out.push(`season ${exp.year} differs from the contract afterwards`);
    if (changes.insertSeason) for (const col of MEASURED) if (created[col] !== null && created[col] !== undefined) out.push(`season ${exp.year} column ${col} is not NULL`);
  }
  if (a.size !== b.size + (changes.insertSeason ? 1 : 0)) out.push(`seasons holds ${a.size} rows, expected ${b.size + (changes.insertSeason ? 1 : 0)}`);

  const diff = (kind: string, rowsBefore: Row[], rowsAfter: Row[], ids: number[]): void => {
    if (rowsBefore.length !== rowsAfter.length) out.push(`${kind} row count changed`);
    const afterById = new Map(rowsAfter.map((r) => [num(r.id), r]));
    for (const r of rowsBefore) {
      const id = num(r.id);
      const next = afterById.get(id);
      const want = ids.includes(Number(id)) ? { ...r, last_season: exp.year } : r;
      if (!same(want, next)) out.push(`${kind} ${String(id)} is not exactly its ${ids.includes(Number(id)) ? 'planned' : 'previous'} content`);
    }
  };
  diff('clubs', before.clubs, after.clubs, changes.clubIds);
  diff('club_organizations', before.orgs, after.orgs, changes.orgIds);

  if (before.identityHistoryDigest !== after.identityHistoryDigest) out.push(`afldb_identity_for_season changed for a season up to ${exp.previousYear}`);
  if (!same(before.listPrevious, after.listPrevious)) out.push(`afldb_season_list_clubs(${exp.previousYear}) changed`);
  if (!same(before.listYear, after.listYear)) out.push(`afldb_season_list_clubs(${exp.year}) changed`);
  const openClubById = new Map(after.clubs.filter((c) => c.is_current_afl_club === true).map((c) => [Number(c.id), Number(c.organization_id)]));
  const expectedYear = new Map<number, number>([...openClubById].map(([club, org]) => [org, club]));
  const resolved = after.identityForYear.filter((r) => r.club !== null);
  if (resolved.length !== expectedYear.size || resolved.some((r) => expectedYear.get(r.org) !== r.club)) {
    out.push(`afldb_identity_for_season(org, ${exp.year}) is not non-NULL for exactly the open identities`);
  }
  return out;
}

/** Facts for the gate: every part present, nothing refused. */
export const isOpen = (c: OpeningClassification): boolean => c.state === 'OPEN';
