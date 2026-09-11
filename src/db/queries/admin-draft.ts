import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import 'server-only';

import postgres from 'postgres';

import { recordDataEdit } from '@/db/queries/audit-log';
import { sql } from '@/db/client';
import {
  createPlayerInTransaction,
  readManualPlayerToken,
  type CreatePlayerInput,
} from '@/db/queries/players';
import { resolveLockedLink } from '@/db/queries/player-links';
import { EDITABLE_ENTITIES, validateFieldValue, type FieldValue } from '@/lib/edit/spec';

/**
 * Draft administration: THE draft mutation contract (AFLDB-ISSUE-160 §6).
 *
 * Before this file there were two draft writers -- the generic
 * `/admin/data-editor` slice and `CreatePlayerForm`'s optional draft block --
 * and neither produced a row that survived a source reload or a promotion.
 * D-5 retires both; the only `INSERT INTO draft_picks` in `src/` is here, and
 * `tests/data-overrides-source-contract.test.ts` asserts that by reading the
 * source.
 *
 * IDENTITY (§3.1). A draft selection is identified by where it came from, never
 * by `draft_picks.id`, which a promotion renumbers:
 *
 *   source-owned (DraftGuru)  `<source_id>|<player_url>|<draft_year>|<draft_kind>`
 *                             -- migration 069's reload key, and the
 *                             `data_overrides.entity_key` shape that already
 *                             exists. R-7: it embeds the per-database
 *                             `sources.id`; changing it would orphan every
 *                             override written so far, so it is left alone.
 *   manual (this file)        `manual_admin_edit:<token>`, token = randomUUID()
 *                             minted once at creation, never edited, never
 *                             name-derived. The canonical row carries
 *                             `player_url = 'manual:<token>'`, which cannot
 *                             collide with the DraftGuru URL contract regex,
 *                             so a manual row is inside the 069 partial unique
 *                             index without ever colliding with a source row.
 *   legacy (pre-160)          `source_id IS NULL` -- no identity at all. Not
 *                             promotable, not replayable. Repaired one row at
 *                             a time by `adoptLegacyPick()` (D-7, §6.8).
 *
 * AUDIT SUBJECT (§9.1). A manual selection is audited against its PLAYER
 * (`data_edits.table_name = 'players'`), not against `draft_picks`: a manual
 * row may be retired by DELETE (D-4), and under the `draft_pick_key` lineage
 * target (D-3) an audit row pointing at a deleted `draft_picks.id` would be
 * unresolvable and would STOP a PROD promotion. The player is the stable
 * subject. Source-owned rows are never deleted by an admin, so their audits
 * stay on `draft_picks`.
 *
 * TRANSACTIONS (§9.1). Every mutation is one `AFLDB_IMPORT_DATABASE_URL`
 * transaction: canonical write(s) + `data_overrides` + `recordDataEdit()`,
 * all or nothing. `recordDataEdit` has no try/catch by design, so a failed
 * audit rolls the mutation back with it.
 *
 * READS. Canonical reads go on the public client. `data_overrides` carries no
 * `grant_app_read` (migration 073 grants SELECT to `afldb_import` only), so
 * override reads go through the same narrow SELECT-only import-role helper
 * ISSUE-159 D-2 introduced. No `privileges.sql` change (§10).
 */

type Tx = postgres.TransactionSql;

export const MANUAL_SOURCE_KEY = 'manual_admin_edit';

// --- the frozen event contract (§3.1, J-8, J-9) -------------------------

export type DraftEventPair = { draftType: string; draftKind: string };

type EventKindContract = {
  absent_column?: { draft_type?: string; draft_kind?: string };
  events?: { draft_type?: string; draft_kind?: string }[];
};

function loadJson<T>(...parts: string[]): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), ...parts), 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * The `(draft_type, draft_kind)` pairs an admin may choose from, read from the
 * ONE authoritative mapping (`data/reference/draftguru-event-kinds.json`).
 *
 * `draft_kind` is an ENUMERATION and is never derived from `draft_type`
 * (migration 069): the 1981/1982/1987 annual pages carry no `Draft` column at
 * all, and those 113 rows are `('National Draft', 'national')` while every
 * other national row is `('National', 'national')`. Deriving one from the
 * other would silently rewrite them.
 */
export const DRAFT_EVENT_PAIRS: readonly DraftEventPair[] = (() => {
  const contract = loadJson<EventKindContract>('data', 'reference', 'draftguru-event-kinds.json');
  const pairs: DraftEventPair[] = [];
  const seen = new Set<string>();
  const push = (draftType?: string, draftKind?: string) => {
    if (!draftType || !draftKind) return;
    const key = `${draftType}|${draftKind}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ draftType, draftKind });
  };
  for (const event of contract?.events ?? []) push(event.draft_type, event.draft_kind);
  push(contract?.absent_column?.draft_type, contract?.absent_column?.draft_kind);
  return pairs;
})();

/** Every `draft_kind` the enumeration admits. Nothing else may be written. */
export const DRAFT_KINDS: readonly string[] = [
  ...new Set(DRAFT_EVENT_PAIRS.map((p) => p.draftKind)),
].sort();

/**
 * The kinds whose SOURCE rows carry no pick number at all, measured on the
 * rebuilt `afldb_test` at implementation (ISSUE-160 gate 2 probe (b),
 * 2026-09-11): free_agency 138/138 NULL, post_draft 188/188, pre_draft
 * 370/370, trade 990/990. Every other kind measured ZERO NULL picks, so a
 * NULL there is an assertion about a numbered board and needs an explicit
 * confirmation plus a `pick_note` (J-5).
 */
export const NULL_PICK_KINDS: readonly string[] = ['free_agency', 'post_draft', 'pre_draft', 'trade'];

export const MIN_DRAFT_YEAR = 1981;

/** Years with no draft held, from the tracked acquisition contract (J-8). */
export const NO_DRAFT_YEARS: readonly number[] = (() => {
  const contract = loadJson<{ known_coverage_gaps?: { year?: number }[] }>(
    'tools', 'rebuild', 'draftguru', 'draftguru-contract.json',
  );
  return (contract?.known_coverage_gaps ?? [])
    .map((gap) => gap.year)
    .filter((year): year is number => typeof year === 'number')
    .sort((a, b) => a - b);
})();

/**
 * The tracked, evidence-bound AFL Tables profile paths a repository review has
 * already decided about (`tools/rebuild/fitzroy/fitzroy-contract.json`
 * `profile_url_continuity.rules[]`, AFLDB-ISSUE-136). A browser must never
 * override one (J-16, the ISSUE-159 §4.3 precedent).
 *
 * NOTE for the runbook record: §7 J-16 names this file as
 * `data/reference/afltables-contract.json`. That path does not exist; the
 * tracked player-profile continuity rules live in the fitzRoy contract (the
 * coach-side `profile_link_corrections` live in
 * `tools/rebuild/afltables/afltables-contract.json`). The rule is implemented
 * against the real artefacts.
 */
export function trackedProfilePaths(): Set<string> {
  const contract = loadJson<{
    profile_url_continuity?: { rules?: { continuing_url?: string; renumbered_url?: string }[] };
  }>('tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json');
  const out = new Set<string>();
  for (const rule of contract?.profile_url_continuity?.rules ?? []) {
    if (rule.continuing_url) out.add(rule.continuing_url);
    if (rule.renumbered_url) out.add(rule.renumbered_url);
  }
  return out;
}

export const AFLTABLES_PROFILE_PATH_RE = /^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/;

// --- entity_key shapes (§3.1) -------------------------------------------

/** The `data_overrides.entity_key` of a MANUAL selection or player. */
export function manualEntityKey(token: string): string {
  return `${MANUAL_SOURCE_KEY}:${token}`;
}

/** The `player_url` a manual selection carries. Outside the DraftGuru regex by construction. */
export function manualPlayerUrl(token: string): string {
  return `manual:${token}`;
}

/**
 * The `data_overrides.entity_key` of a SOURCE-owned selection -- migration
 * 069's reload key, unchanged (R-7). Mirrors the expression
 * `replay_admin_overrides(draft_picks)` joins on; the two must never be able
 * to disagree about what a key means.
 */
export function sourcePickEntityKey(row: {
  sourceId: number; playerUrl: string; draftYear: number; draftKind: string;
}): string {
  return `${row.sourceId}|${row.playerUrl}|${row.draftYear}|${row.draftKind}`;
}

// --- the D-2 narrow SELECT-only import-role helper (ISSUE-159 precedent) --

async function withImportConnection<T>(fn: (importSql: postgres.Sql) => Promise<T>): Promise<T> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(importSql);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

// --- results (§6) --------------------------------------------------------

/** Why a mutation refused. Carried to the action layer, which audits the ones worth auditing. */
export type DraftRefusalReason =
  | 'validation'
  | 'not_found'
  | 'duplicate'
  | 'conflict'
  | 'stale'
  | 'forbidden'
  | 'ambiguous_identity'
  | 'failed';

/** Why a mutation wants an explicit confirmation rather than refusing outright. */
export type DraftConfirmReason =
  | 'null_pick_number'
  | 'distinct_namesakes'
  | 'unlinked_source_selection';

export type DraftCandidate = {
  kind: 'player' | 'pick';
  id: number;
  label: string;
  reason: string;
};

export type DraftMutationResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; reason: DraftRefusalReason }
  | {
      ok: false;
      needsConfirmation: true;
      confirm: DraftConfirmReason;
      error: string;
      candidates: DraftCandidate[];
    };

function refuse(reason: DraftRefusalReason, error: string): { ok: false; error: string; reason: DraftRefusalReason } {
  return { ok: false, error, reason };
}

function confirmNeeded(
  confirm: DraftConfirmReason, error: string, candidates: DraftCandidate[] = [],
): { ok: false; needsConfirmation: true; confirm: DraftConfirmReason; error: string; candidates: DraftCandidate[] } {
  return { ok: false, needsConfirmation: true, confirm, error, candidates };
}

// --- shared in-transaction reads ----------------------------------------

type PickRow = {
  id: number;
  sourceId: number | null;
  sourceKey: string | null;
  playerUrl: string | null;
  playerId: number | null;
  draftYear: number;
  draftKind: string | null;
  draftType: string;
  pickNumber: number | null;
  clubId: number | null;
  playerNameRaw: string;
  originalClubRaw: string | null;
  draftAge: number | null;
  heightCm: number | null;
  weightKg: number | null;
  pickNote: string | null;
  detail: string | null;
  linkStatusValue: string;
};

const PICK_COLUMNS = `
  dp.id, dp.source_id AS "sourceId", s.key AS "sourceKey", dp.player_url AS "playerUrl",
  dp.player_id AS "playerId", dp.draft_year AS "draftYear", dp.draft_kind AS "draftKind",
  dp.draft_type AS "draftType", dp.pick_number AS "pickNumber", dp.club_id AS "clubId",
  dp.player_name_raw AS "playerNameRaw", dp.original_club_raw AS "originalClubRaw",
  dp.draft_age AS "draftAge", dp.height_cm AS "heightCm", dp.weight_kg AS "weightKg",
  dp.pick_note AS "pickNote", dp.detail AS "detail",
  dp.link_status_value::text AS "linkStatusValue"`;

async function lockPick(tx: Tx, pickId: number): Promise<PickRow | null> {
  // FOR UPDATE on draft_picks only: the sources join is a lookup, and
  // `FOR UPDATE OF` on an outer-joined relation is not permitted.
  const [locked] = await tx<{ id: number }[]>`
    SELECT id FROM draft_picks WHERE id = ${pickId} FOR UPDATE
  `;
  if (!locked) return null;
  const [row] = await tx.unsafe(
    `SELECT ${PICK_COLUMNS} FROM draft_picks dp LEFT JOIN sources s ON s.id = dp.source_id WHERE dp.id = $1`,
    [pickId],
  ) as unknown as PickRow[];
  return row ?? null;
}

/**
 * A monotone revision for one selection: the highest `data_edits.id` that is
 * ABOUT this selection, under either audit subject. Every audited mutation
 * here writes one, so the value changes on every change -- which is exactly
 * what the J-18 compare-and-swap needs, and it needs no new column.
 */
export async function draftPickRevision(tx: Tx, pick: PickRow): Promise<string> {
  const [row] = await tx<{ revision: string | null }[]>`
    SELECT max(id)::text AS revision
      FROM data_edits
     WHERE (table_name = 'draft_picks' AND row_id = ${pick.id})
        OR (table_name = 'players'
            AND row_id = ${pick.playerId}
            AND field_group LIKE 'draft_selection%')
  `;
  return row?.revision ?? '0';
}

type ResolvedClub = { id: number; name: string; slug: string };

/** J-6 / J-7: the club identity ACTIVE in `draftYear`, or a refusal. Never a guess. */
async function resolveClubForYear(
  tx: Tx, clubSlug: string, draftYear: number,
): Promise<{ ok: true; club: ResolvedClub } | { ok: false; error: string }> {
  const [club] = await tx<{ id: number; name: string; slug: string; activeId: number | null }[]>`
    SELECT c.id, c.name, c.slug,
           afldb_identity_for_season(c.organization_id, ${draftYear}) AS "activeId"
      FROM clubs c
     WHERE c.slug = ${clubSlug}
  `;
  if (!club) return { ok: false, error: `No club with the identifier "${clubSlug}".` };
  if (club.activeId !== club.id) {
    return {
      ok: false,
      error: `${club.name} is not the historical club identity active in ${draftYear}. `
        + 'Select the identity that existed in that season.',
    };
  }
  return { ok: true, club: { id: club.id, name: club.name, slug: club.slug } };
}

/**
 * The player's DURABLE identity string for an override payload, resolved
 * server-side inside the transaction (§4 rule 2 -- nothing identity-shaped is
 * trusted from the browser). AFL Tables path first, then the manual token.
 */
async function resolvePlayerIdentity(
  tx: Tx, playerId: number,
): Promise<
  | { ok: true; identity: string; minted: false }
  | { ok: false; error: string; reason: DraftRefusalReason }
  | { ok: true; identity: null; minted: false }
> {
  const afl = await tx<{ externalId: string }[]>`
    SELECT DISTINCT e.external_id AS "externalId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE e.player_id = ${playerId}
       AND s.key = 'afltables'
       AND e.match_method = 'afltables_profile_url'
       AND e.status IN ('unique', 'resolved')
  `;
  if (afl.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_identity',
      error: 'That player holds more than one AFL Tables profile identity. Refusing to choose one; '
        + 'reconcile the identity before recording a selection against them.',
    };
  }
  if (afl.length === 1) return { ok: true, identity: `afltables:${afl[0].externalId}`, minted: false };

  const token = await readManualPlayerToken(tx, playerId);
  if (token) return { ok: true, identity: manualEntityKey(token), minted: false };
  return { ok: true, identity: null, minted: false };
}

// --- duplicate / conflict contract (§7) ---------------------------------

export type SelectionFacts = {
  playerId: number;
  draftYear: number;
  draftKind: string;
  draftType: string;
  pickNumber: number | null;
  pickNote: string | null;
};

/**
 * J-1, J-2, J-3, J-5, J-8, J-9 in one place, run INSIDE the mutation
 * transaction before any write. `excludePickId` lets an edit of an existing
 * manual row ignore itself.
 *
 * J-3 is implemented as a HARD REFUSAL. Operator decision D-8 pre-authorised
 * both branches and made gate 2 probe (a) choose between them; the probe
 * returned ZERO `(draft_year, draft_kind, pick_number)` collisions across all
 * 6,810 source rows on the rebuilt `afldb_test` (and zero on `afldb_dev`), so
 * the refusal branch is the one that ships. The confirmation branch is
 * deliberately not implemented.
 */
export async function checkSelectionConflicts(
  tx: Tx,
  facts: SelectionFacts,
  options: { excludePickId?: number; confirmed?: boolean } = {},
): Promise<{ ok: true } | ReturnType<typeof refuse> | ReturnType<typeof confirmNeeded>> {
  // J-9: the enumeration is the only representation.
  const pair = DRAFT_EVENT_PAIRS.find(
    (p) => p.draftKind === facts.draftKind && p.draftType === facts.draftType,
  );
  if (!pair) {
    return refuse('validation',
      `"${facts.draftType}" / "${facts.draftKind}" is not one of the recorded draft event kinds.`);
  }

  // J-8: the year bound is read from the data, not from the wall clock.
  const [bound] = await tx<{ maxSeason: number | null }[]>`
    SELECT max(season)::int AS "maxSeason" FROM matches
  `;
  const maxYear = (bound?.maxSeason ?? new Date().getUTCFullYear()) + 1;
  if (facts.draftYear < MIN_DRAFT_YEAR || facts.draftYear > maxYear) {
    return refuse('validation',
      `Draft year must be between ${MIN_DRAFT_YEAR} and ${maxYear}.`);
  }
  if (NO_DRAFT_YEARS.includes(facts.draftYear)) {
    return refuse('validation',
      `No draft was held in ${facts.draftYear} (tracked acquisition contract: known_coverage_gaps).`);
  }

  // J-1: the same person cannot hold two selections of the same year AND kind.
  // J-2 is the complement and is allowed: 23 people legitimately appear twice
  // in one year under different kinds (migration 069's measured evidence).
  const sameEvent = await tx<{ id: number; draftType: string }[]>`
    SELECT id, draft_type AS "draftType"
      FROM draft_picks
     WHERE player_id = ${facts.playerId}
       AND draft_year = ${facts.draftYear}
       AND draft_kind = ${facts.draftKind}
       AND id <> ${options.excludePickId ?? 0}
  `;
  if (sameEvent.length > 0) {
    return refuse('duplicate',
      `That player already has a ${facts.draftYear} ${facts.draftKind} selection `
      + `(#${sameEvent[0].id}). Edit it instead of adding a second.`);
  }

  // J-3 / J-4: a pick number belongs to one club in one event, so a collision
  // at (year, kind, pick) is a different person holding the same selection.
  if (facts.pickNumber !== null) {
    const collision = await tx<{ id: number; playerNameRaw: string; clubName: string | null }[]>`
      SELECT dp.id, dp.player_name_raw AS "playerNameRaw", c.name AS "clubName"
        FROM draft_picks dp
        LEFT JOIN clubs c ON c.id = dp.club_id
       WHERE dp.draft_year = ${facts.draftYear}
         AND dp.draft_kind = ${facts.draftKind}
         AND dp.pick_number = ${facts.pickNumber}
         AND dp.id <> ${options.excludePickId ?? 0}
    `;
    if (collision.length > 0) {
      const c = collision[0];
      return refuse('conflict',
        `Pick ${facts.pickNumber} of the ${facts.draftYear} ${facts.draftKind} draft is already `
        + `held by ${c.playerNameRaw}${c.clubName ? ` (${c.clubName})` : ''} — selection #${c.id}. `
        + 'Correct that selection rather than recording a second one at the same pick.');
    }
  }

  // J-5: a NULL pick is ordinary for the kinds whose whole source population
  // is NULL-numbered, and an assertion anywhere else.
  if (facts.pickNumber === null && !NULL_PICK_KINDS.includes(facts.draftKind)) {
    if (!facts.pickNote || facts.pickNote.trim() === '') {
      return refuse('validation',
        `Every recorded ${facts.draftKind} selection carries a pick number. `
        + 'Enter one, or record a pick note explaining why this selection has none.');
    }
    if (!options.confirmed) {
      return confirmNeeded('null_pick_number',
        `Every recorded ${facts.draftKind} selection carries a pick number. `
        + 'Confirm that this one genuinely has none.');
    }
  }

  return { ok: true };
}

export type NewPlayerFacts = {
  displayName: string;
  dob: string | null;
  draftYear: number;
  draftKind: string;
};

/**
 * J-10 … J-13, the new-player half. Names RANK and REFUSE here; they never
 * link. A likely duplicate with no distinguishing date of birth is a hard
 * refusal, not a guess (§4 "Ambiguous identity").
 */
export async function checkNewPlayerDuplicates(
  tx: Tx,
  facts: NewPlayerFacts,
  options: { confirmed?: boolean } = {},
): Promise<{ ok: true } | ReturnType<typeof refuse> | ReturnType<typeof confirmNeeded>> {
  const birthYear = facts.dob && /^\d{4}/.test(facts.dob) ? Number(facts.dob.slice(0, 4)) : null;

  const sameName = await tx<{
    id: number; displayName: string; dob: string | null; birthYear: number | null;
    games: number; span: string | null;
  }[]>`
    SELECT p.id, p.display_name AS "displayName", to_char(p.dob, 'YYYY-MM-DD') AS dob,
           p.birth_year AS "birthYear",
           COALESCE(cs.games, 0)::int AS games,
           CASE WHEN p.debut_season IS NULL THEN NULL
                ELSE p.debut_season || '–' || COALESCE(p.final_season::text, '') END AS span
      FROM players p
      LEFT JOIN player_career_stats cs ON cs.player_id = p.id
     WHERE p.search_name = afldb_normalise_name(${facts.displayName})
     ORDER BY p.id
  `;

  if (sameName.length > 0) {
    // J-10: a likely duplicate exists and no date of birth was typed.
    if (facts.dob === null) {
      return refuse('duplicate',
        `${sameName.length === 1 ? 'A player' : `${sameName.length} players`} named `
        + `"${facts.displayName}" already exist${sameName.length === 1 ? 's' : ''} `
        + `(${sameName.map((p) => `#${p.id}`).join(', ')}). Select the existing player, or enter a `
        + 'date of birth that distinguishes them.');
    }
    // J-11: the typed date agrees with an existing player's, or theirs is
    // unknown and the birth years agree. Either way it is the same person
    // until evidence says otherwise.
    const likely = sameName.filter((p) => (
      p.dob === null
        ? (p.birthYear === null || p.birthYear === birthYear)
        : p.dob === facts.dob
    ));
    if (likely.length > 0) {
      const p = likely[0];
      return refuse('duplicate',
        `"${p.displayName}" (#${p.id}) already exists with `
        + `${p.dob ? `the same date of birth (${p.dob})` : 'no recorded date of birth'}. `
        + 'Select that player instead of creating a second one.');
    }
    // J-12: only distinct namesakes remain -- same name, both dates known and
    // different. Legitimate, and confirmed explicitly.
    if (!options.confirmed) {
      return confirmNeeded('distinct_namesakes',
        `${sameName.length} existing player(s) share this name with a different date of birth. `
        + 'Confirm that this is a different person.',
        sameName.map((p) => ({
          kind: 'player' as const,
          id: p.id,
          label: `${p.displayName} (#${p.id})`,
          reason: `${p.dob ? `born ${p.dob}` : 'date of birth unrecorded'}`
            + `${p.span ? `, ${p.span}` : ''}, ${p.games} game(s)`,
        })));
    }
  }

  // J-13: DraftGuru already lists an UNLINKED selection for this event whose
  // name normalises the same way. The name assists the warning; it never
  // decides anything.
  if (!options.confirmed) {
    const unlinked = await tx<{ id: number; playerNameRaw: string; pickNumber: number | null }[]>`
      SELECT dp.id, dp.player_name_raw AS "playerNameRaw", dp.pick_number AS "pickNumber"
        FROM draft_picks dp
       WHERE dp.source_id IS NOT NULL
         AND dp.player_id IS NULL
         AND dp.draft_year = ${facts.draftYear}
         AND dp.draft_kind = ${facts.draftKind}
         AND afldb_normalise_name(dp.player_name_raw) = afldb_normalise_name(${facts.displayName})
       ORDER BY dp.id
    `;
    if (unlinked.length > 0) {
      return confirmNeeded('unlinked_source_selection',
        'DraftGuru already lists this selection, unlinked. Link it in Player links instead of '
        + 'creating a second selection — or confirm that this is a different person.',
        unlinked.map((u) => ({
          kind: 'pick' as const,
          id: u.id,
          label: `${u.playerNameRaw} — selection #${u.id}`,
          reason: `unlinked ${facts.draftYear} ${facts.draftKind} source selection`
            + `${u.pickNumber === null ? '' : `, pick ${u.pickNumber}`}`,
        })));
    }
  }

  return { ok: true };
}

// --- 6.1 saveSourcePickFields -------------------------------------------

/** The field groups of a SOURCE-owned selection an admin may correct (§6.1). */
export const SOURCE_PICK_GROUPS = ['player_info', 'measurements', 'notes', 'selection_facts'] as const;
export type SourcePickGroup = (typeof SOURCE_PICK_GROUPS)[number];

export function isSourcePickGroup(value: string): value is SourcePickGroup {
  return (SOURCE_PICK_GROUPS as readonly string[]).includes(value);
}

/**
 * The canonical write for one group of a source-owned selection. This is
 * `applyDraftPickEdit()` moved out of `data-edits.ts` (D-5) and extended with
 * `selection_facts`, which the generic editor never had: pick number and club
 * are the two source facts most often wrong, and correcting them was
 * impossible without inventing a second draft writer.
 */
async function applySourcePickGroup(
  tx: Tx, pickId: number, group: SourcePickGroup, v: Record<string, FieldValue>, clubId?: number | null,
): Promise<void> {
  switch (group) {
    case 'player_info':
      await tx`
        UPDATE draft_picks
           SET player_name_raw = ${v.player_name_raw},
               original_club_raw = ${v.original_club_raw},
               draft_age = ${v.draft_age}
         WHERE id = ${pickId}
      `;
      return;
    case 'measurements':
      await tx`
        UPDATE draft_picks
           SET height_cm = ${v.height_cm}, weight_kg = ${v.weight_kg}
         WHERE id = ${pickId}
      `;
      return;
    case 'notes':
      await tx`
        UPDATE draft_picks
           SET pick_note = ${v.pick_note}, detail = ${v.detail}
         WHERE id = ${pickId}
      `;
      return;
    case 'selection_facts':
      await tx`
        UPDATE draft_picks
           SET pick_number = ${v.pick_number},
               club_id = ${clubId ?? null},
               club_name_raw = COALESCE(
                 (SELECT name FROM clubs WHERE id = ${clubId ?? null}), club_name_raw)
         WHERE id = ${pickId}
      `;
      return;
  }
}

export type SaveSourcePickFieldsInput = {
  pickId: number;
  groupKey: string;
  raw: Record<string, string>;
  adminUserId: number;
  note?: string | null;
  expectedRevision?: string | null;
  confirmed?: boolean;
};

export async function saveSourcePickFields(
  input: SaveSourcePickFieldsInput,
): Promise<DraftMutationResult<{ changed: Record<string, { from: FieldValue; to: FieldValue }> }>> {
  const groupKey = input.groupKey;
  if (!isSourcePickGroup(groupKey)) {
    return refuse('validation', `Unknown draft field group "${groupKey}".`);
  }
  const entity = EDITABLE_ENTITIES.draft_picks;
  const group = entity.groups[groupKey];
  if (!group) return refuse('validation', `Unknown draft field group "${groupKey}".`);

  const values: Record<string, FieldValue> = {};
  for (const fieldKey of group.fields) {
    const result = validateFieldValue(entity.fields[fieldKey], input.raw[fieldKey] ?? '');
    if (!result.ok) return refuse('validation', result.error);
    values[fieldKey] = result.value;
  }

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pick = await lockPick(tx, input.pickId);
        if (!pick) return refuse('not_found', 'No draft selection with that id.');
        if (pick.sourceId === null) {
          return refuse('forbidden',
            'That selection carries no provenance (a pre-ISSUE-160 admin row). Adopt it first so it '
            + 'gains a durable identity, then edit it as a manual selection.');
        }
        if (pick.sourceKey === MANUAL_SOURCE_KEY) {
          return refuse('forbidden',
            'That is a manual selection. Edit it through the manual selection form, which rewrites '
            + 'its whole durable record.');
        }
        if (!pick.playerUrl || pick.draftKind === null) {
          return refuse('conflict',
            'That source selection carries no reload key, so an override written against it could '
            + 'never be replayed.');
        }
        if (input.expectedRevision != null) {
          const revision = await draftPickRevision(tx, pick);
          if (revision !== input.expectedRevision) {
            return refuse('stale', 'That selection changed since this form was opened. Reload and try again.');
          }
        }

        const before: Record<string, FieldValue> = {};
        let clubId: number | null | undefined;
        if (groupKey === 'selection_facts') {
          before.pick_number = pick.pickNumber;
          const [currentClub] = await tx<{ slug: string }[]>`
            SELECT slug FROM clubs WHERE id = ${pick.clubId}
          `;
          before.club_slug = currentClub?.slug ?? null;
          const clubSlug = values.club_slug;
          if (typeof clubSlug !== 'string' || clubSlug === '') {
            return refuse('validation', 'A club is required for a selection.');
          }
          const resolved = await resolveClubForYear(tx, clubSlug, pick.draftYear);
          if (!resolved.ok) return refuse('validation', resolved.error);
          clubId = resolved.club.id;

          const conflict = await checkSelectionConflicts(tx, {
            playerId: pick.playerId ?? 0,
            draftYear: pick.draftYear,
            draftKind: pick.draftKind,
            draftType: pick.draftType,
            pickNumber: values.pick_number as number | null,
            pickNote: pick.pickNote,
          }, { excludePickId: pick.id, confirmed: input.confirmed });
          if (!conflict.ok) return conflict;
        } else {
          for (const fieldKey of group.fields) {
            before[fieldKey] = (pick as unknown as Record<string, FieldValue>)[
              ({
                player_name_raw: 'playerNameRaw', original_club_raw: 'originalClubRaw',
                draft_age: 'draftAge', height_cm: 'heightCm', weight_kg: 'weightKg',
                pick_note: 'pickNote', detail: 'detail',
              } as Record<string, string>)[fieldKey] ?? fieldKey
            ] ?? null;
          }
        }

        await applySourcePickGroup(tx, pick.id, groupKey, values, clubId);

        // The override carries the DELTA only, so a field the admin did not
        // change keeps tracking the source across reloads.
        const entityKey = sourcePickEntityKey({
          sourceId: pick.sourceId, playerUrl: pick.playerUrl,
          draftYear: pick.draftYear, draftKind: pick.draftKind,
        });
        const [existing] = await tx<{ overrideValues: Record<string, unknown> }[]>`
          SELECT override_values AS "overrideValues" FROM data_overrides
           WHERE entity_type = 'draft_picks' AND entity_key = ${entityKey}
             AND field_group = ${groupKey}
        `;
        const overrides: Record<string, unknown> = existing ? { ...existing.overrideValues } : {};
        for (const fieldKey of Object.keys(values)) {
          if (values[fieldKey] !== before[fieldKey]) overrides[fieldKey] = values[fieldKey];
        }
        if (Object.keys(overrides).length > 0) {
          await tx`
            INSERT INTO data_overrides
                  (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES ('draft_picks', ${entityKey}, ${groupKey},
                    ${tx.json(overrides as postgres.JSONValue)}, ${input.adminUserId}, true, now())
            ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
              override_values = EXCLUDED.override_values,
              admin_user_id = EXCLUDED.admin_user_id,
              is_active = true,
              updated_at = now()
          `;
        }

        await recordDataEdit(tx, {
          tableName: 'draft_picks',
          rowId: pick.id,
          fieldGroup: groupKey,
          oldValues: before,
          newValues: values,
          adminUserId: input.adminUserId,
          note: input.note,
        });

        const changed: Record<string, { from: FieldValue; to: FieldValue }> = {};
        for (const fieldKey of Object.keys(values)) {
          if (before[fieldKey] !== values[fieldKey]) {
            changed[fieldKey] = { from: before[fieldKey] ?? null, to: values[fieldKey] };
          }
        }
        return { ok: true as const, changed };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be saved: ${message(error)}`);
    }
  });
}

// --- 6.2 retireSourcePickOverride ---------------------------------------

/**
 * Retire one durable override without touching the canonical row (§6.2, the
 * ISSUE-159 precedent). The canonical value stays as last written; the NEXT
 * source reload restores the source value because the replay no longer sees an
 * active override. Re-reading the source here would guess at a value this
 * database does not hold.
 */
export async function retireSourcePickOverride(input: {
  pickId: number; groupKey: string; adminUserId: number; note?: string | null;
}): Promise<DraftMutationResult<object>> {
  if (!isSourcePickGroup(input.groupKey)) {
    return refuse('validation', `Unknown draft field group "${input.groupKey}".`);
  }
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pick = await lockPick(tx, input.pickId);
        if (!pick) return refuse('not_found', 'No draft selection with that id.');
        if (pick.sourceId === null || !pick.playerUrl || pick.draftKind === null) {
          return refuse('forbidden', 'That selection is not source-owned, so it holds no source override.');
        }
        const entityKey = sourcePickEntityKey({
          sourceId: pick.sourceId, playerUrl: pick.playerUrl,
          draftYear: pick.draftYear, draftKind: pick.draftKind,
        });
        const retired = await tx<{ overrideValues: Record<string, unknown> }[]>`
          UPDATE data_overrides
             SET is_active = false, admin_user_id = ${input.adminUserId}, updated_at = now()
           WHERE entity_type = 'draft_picks' AND entity_key = ${entityKey}
             AND field_group = ${input.groupKey} AND is_active
          RETURNING override_values AS "overrideValues"
        `;
        if (retired.length === 0) {
          return refuse('not_found', 'That selection has no active override in this field group.');
        }
        await recordDataEdit(tx, {
          tableName: 'draft_picks',
          rowId: pick.id,
          fieldGroup: input.groupKey,
          oldValues: retired[0].overrideValues,
          newValues: {},
          adminUserId: input.adminUserId,
          note: `${(input.note ?? '').trim()}${input.note ? ' — ' : ''}override retired`,
        });
        return { ok: true as const };
      });
    } catch (error) {
      return refuse('failed', `The override could not be retired: ${message(error)}`);
    }
  });
}

// --- manual selection payload -------------------------------------------

export type ManualPickFields = {
  draftYear: number;
  draftType: string;
  draftKind: string;
  pickNumber: number | null;
  clubSlug: string;
  playerNameRaw?: string | null;
  originalClubRaw?: string | null;
  draftAge?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  pickNote?: string | null;
  detail?: string | null;
};

/**
 * The whole-row `selection` payload a manual selection's durable record
 * carries. `player_identity` and `club_slug` are IDENTITIES, not ids: a
 * promotion renumbers `players.id` and `clubs.id`, so storing either would
 * make the replay re-create the row against a different footballer or a
 * different club.
 */
function manualSelectionPayload(
  fields: ManualPickFields, playerIdentity: string, playerNameRaw: string,
): Record<string, unknown> {
  return {
    player_identity: playerIdentity,
    club_slug: fields.clubSlug,
    draft_year: fields.draftYear,
    draft_type: fields.draftType,
    draft_kind: fields.draftKind,
    pick_number: fields.pickNumber,
    player_name_raw: playerNameRaw,
    original_club_raw: fields.originalClubRaw ?? null,
    draft_age: fields.draftAge ?? null,
    height_cm: fields.heightCm ?? null,
    weight_kg: fields.weightKg ?? null,
    pick_note: fields.pickNote ?? null,
    detail: fields.detail ?? null,
  };
}

async function insertManualPick(
  tx: Tx,
  input: {
    token: string; playerId: number; playerNameRaw: string; clubId: number; clubName: string;
    fields: ManualPickFields;
  },
): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO draft_picks (
      draft_year, draft_type, draft_kind, pick_number, pick_note,
      player_id, player_name_raw, link_status_value, candidate_count, match_method,
      club_id, club_name_raw, original_club_raw,
      draft_age, height_cm, weight_kg, detail,
      source_id, source_record_id, player_url
    ) VALUES (
      ${input.fields.draftYear}, ${input.fields.draftType}, ${input.fields.draftKind},
      ${input.fields.pickNumber}, ${input.fields.pickNote ?? null},
      ${input.playerId}, ${input.playerNameRaw}, 'resolved', 0, 'manual_admin_edit',
      ${input.clubId}, ${input.clubName}, ${input.fields.originalClubRaw ?? null},
      ${input.fields.draftAge ?? null}, ${input.fields.heightCm ?? null},
      ${input.fields.weightKg ?? null}, ${input.fields.detail ?? null},
      (SELECT id FROM sources WHERE key = ${MANUAL_SOURCE_KEY}),
      ${input.token}, ${manualPlayerUrl(input.token)}
    )
    RETURNING id
  `;
  return row.id;
}

// --- 6.3 createManualPick (existing player) -----------------------------

export type CreateManualPickInput = ManualPickFields & {
  playerId: number;
  adminUserId: number;
  note?: string | null;
  confirmed?: boolean;
};

export async function createManualPick(
  input: CreateManualPickInput,
): Promise<DraftMutationResult<{ pickId: number; pickToken: string; playerSlug: string; playerId: number }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const [player] = await tx<{ id: number; displayName: string; slug: string }[]>`
          SELECT id, display_name AS "displayName", slug FROM players WHERE id = ${input.playerId} FOR UPDATE
        `;
        if (!player) return refuse('not_found', 'No player with that id.');

        const conflict = await checkSelectionConflicts(tx, {
          playerId: player.id,
          draftYear: input.draftYear,
          draftKind: input.draftKind,
          draftType: input.draftType,
          pickNumber: input.pickNumber,
          pickNote: input.pickNote ?? null,
        }, { confirmed: input.confirmed });
        if (!conflict.ok) return conflict;

        const club = await resolveClubForYear(tx, input.clubSlug, input.draftYear);
        if (!club.ok) return refuse('validation', club.error);

        const identity = await resolvePlayerIdentity(tx, player.id);
        if (!identity.ok) return refuse(identity.reason, identity.error);
        if (identity.identity === null) {
          return refuse('conflict',
            `${player.displayName} (#${player.id}) carries no durable identity, so a selection `
            + 'recorded against them could not survive a rebuild. Repair the player first.');
        }

        const token = randomUUID();
        const playerNameRaw = (input.playerNameRaw ?? '').trim() || player.displayName;
        const pickId = await insertManualPick(tx, {
          token, playerId: player.id, playerNameRaw,
          clubId: club.club.id, clubName: club.club.name, fields: input,
        });

        const payload = manualSelectionPayload(input, identity.identity, playerNameRaw);
        await tx`
          INSERT INTO data_overrides
                (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('draft_picks', ${manualEntityKey(token)}, 'selection',
                  ${tx.json(payload as postgres.JSONValue)}, ${input.adminUserId}, true, now())
        `;
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'draft_selection',
          oldValues: {},
          newValues: { ...payload, pick_token: token },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const, pickId, pickToken: token, playerSlug: player.slug, playerId: player.id };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be created: ${message(error)}`);
    }
  });
}

// --- 6.3b createPlayerAndDraftPick --------------------------------------

export type CreatePlayerAndDraftPickInput = ManualPickFields & {
  player: CreatePlayerInput;
  adminUserId: number;
  note?: string | null;
  confirmed?: boolean;
};

/**
 * The new case ISSUE-160 exists for: onboard a person into AFLDB through their
 * draft selection, atomically (§5). ONE transaction covers the player, its
 * identity, its durable record, the selection, the selection's durable record
 * and both audits -- every write is an import-role write on one connection, so
 * no compensating mechanism is needed and no half-created person can exist.
 */
export async function createPlayerAndDraftPick(
  input: CreatePlayerAndDraftPickInput,
): Promise<DraftMutationResult<{
  playerId: number; playerSlug: string; playerToken: string; pickId: number; pickToken: string;
}>> {
  const displayName = input.player.displayName.trim();
  if (!displayName || displayName.length > 100) {
    return refuse('validation', 'Display name is required (up to 100 characters).');
  }
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        // Duplicate and conflict rules run BEFORE the player insert, so a
        // refusal never leaves a person behind.
        const dup = await checkNewPlayerDuplicates(tx, {
          displayName,
          dob: input.player.dob?.trim() || null,
          draftYear: input.draftYear,
          draftKind: input.draftKind,
        }, { confirmed: input.confirmed });
        if (!dup.ok) return dup;

        const shape = await checkSelectionConflicts(tx, {
          playerId: 0,
          draftYear: input.draftYear,
          draftKind: input.draftKind,
          draftType: input.draftType,
          pickNumber: input.pickNumber,
          pickNote: input.pickNote ?? null,
        }, { confirmed: input.confirmed });
        if (!shape.ok) return shape;

        const club = await resolveClubForYear(tx, input.clubSlug, input.draftYear);
        if (!club.ok) return refuse('validation', club.error);

        const player = await createPlayerInTransaction(
          tx, { ...input.player, displayName }, { adminUserId: input.adminUserId },
        );
        const playerToken = await readManualPlayerToken(tx, player.id);
        if (!playerToken) {
          // Unreachable unless the primitive changed: fail closed rather than
          // write a selection whose payload names no identity.
          throw new Error('the new player did not receive a durable identity');
        }

        const pickToken = randomUUID();
        const playerNameRaw = (input.playerNameRaw ?? '').trim() || player.displayName;
        const pickId = await insertManualPick(tx, {
          token: pickToken, playerId: player.id, playerNameRaw,
          clubId: club.club.id, clubName: club.club.name, fields: input,
        });

        const payload = manualSelectionPayload(input, manualEntityKey(playerToken), playerNameRaw);
        await tx`
          INSERT INTO data_overrides
                (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('draft_picks', ${manualEntityKey(pickToken)}, 'selection',
                  ${tx.json(payload as postgres.JSONValue)}, ${input.adminUserId}, true, now())
        `;
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'player_creation',
          oldValues: {},
          newValues: { display_name: player.displayName, player_token: playerToken },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'draft_selection',
          oldValues: {},
          newValues: { ...payload, pick_token: pickToken },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return {
          ok: true as const,
          playerId: player.id, playerSlug: player.slug, playerToken, pickId, pickToken,
        };
      });
    } catch (error) {
      return refuse('failed', `The player and selection could not be created: ${message(error)}`);
    }
  });
}

// --- 6.4 saveManualPick --------------------------------------------------

export type SaveManualPickInput = ManualPickFields & {
  pickId: number;
  playerId: number;
  adminUserId: number;
  note?: string | null;
  expectedRevision?: string | null;
  confirmed?: boolean;
};

/**
 * Edit a manual selection, whole row. Unlike a source-owned correction this
 * REWRITES the single `selection` override rather than accumulating a delta:
 * the override IS the row for a manual selection, so a partial payload would
 * replay a partial row.
 */
export async function saveManualPick(
  input: SaveManualPickInput,
): Promise<DraftMutationResult<{ relinked: boolean }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pick = await lockPick(tx, input.pickId);
        if (!pick) return refuse('not_found', 'No draft selection with that id.');
        if (pick.sourceKey !== MANUAL_SOURCE_KEY || !pick.playerUrl?.startsWith('manual:')) {
          return refuse('forbidden',
            'Only a manual selection can be edited this way. A source-owned selection is corrected '
            + 'field group by field group, and its player link is changed only in Player links.');
        }
        if (input.expectedRevision != null) {
          const revision = await draftPickRevision(tx, pick);
          if (revision !== input.expectedRevision) {
            return refuse('stale', 'That selection changed since this form was opened. Reload and try again.');
          }
        }
        const token = pick.playerUrl.slice('manual:'.length);

        const [player] = await tx<{ id: number; displayName: string }[]>`
          SELECT id, display_name AS "displayName" FROM players WHERE id = ${input.playerId} FOR UPDATE
        `;
        if (!player) return refuse('not_found', 'No player with that id.');

        const conflict = await checkSelectionConflicts(tx, {
          playerId: player.id,
          draftYear: input.draftYear,
          draftKind: input.draftKind,
          draftType: input.draftType,
          pickNumber: input.pickNumber,
          pickNote: input.pickNote ?? null,
        }, { excludePickId: pick.id, confirmed: input.confirmed });
        if (!conflict.ok) return conflict;

        const club = await resolveClubForYear(tx, input.clubSlug, input.draftYear);
        if (!club.ok) return refuse('validation', club.error);

        const identity = await resolvePlayerIdentity(tx, player.id);
        if (!identity.ok) return refuse(identity.reason, identity.error);
        if (identity.identity === null) {
          return refuse('conflict',
            `${player.displayName} (#${player.id}) carries no durable identity.`);
        }

        const playerNameRaw = (input.playerNameRaw ?? '').trim() || player.displayName;
        const previousPlayerId = pick.playerId;
        const relinked = previousPlayerId !== null && previousPlayerId !== player.id;

        await tx`
          UPDATE draft_picks
             SET draft_year = ${input.draftYear}, draft_type = ${input.draftType},
                 draft_kind = ${input.draftKind}, pick_number = ${input.pickNumber},
                 pick_note = ${input.pickNote ?? null},
                 player_id = ${player.id}, player_name_raw = ${playerNameRaw},
                 link_status_value = 'resolved',
                 club_id = ${club.club.id}, club_name_raw = ${club.club.name},
                 original_club_raw = ${input.originalClubRaw ?? null},
                 draft_age = ${input.draftAge ?? null}, height_cm = ${input.heightCm ?? null},
                 weight_kg = ${input.weightKg ?? null}, detail = ${input.detail ?? null}
           WHERE id = ${pick.id}
        `;

        const payload = manualSelectionPayload(input, identity.identity, playerNameRaw);
        await tx`
          INSERT INTO data_overrides
                (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('draft_picks', ${manualEntityKey(token)}, 'selection',
                  ${tx.json(payload as postgres.JSONValue)}, ${input.adminUserId}, true, now())
          ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE SET
            override_values = EXCLUDED.override_values,
            admin_user_id = EXCLUDED.admin_user_id,
            is_active = true,
            updated_at = now()
        `;

        // A relink is TWO audit rows: one against the player who loses the
        // selection and one against the player who gains it. A single row
        // against the new player would erase the first person's history.
        if (relinked) {
          await recordDataEdit(tx, {
            tableName: 'players',
            rowId: previousPlayerId,
            fieldGroup: 'draft_selection_unlinked',
            oldValues: { pick_token: token, pick_id: pick.id },
            newValues: { moved_to_player_id: player.id },
            adminUserId: input.adminUserId,
            note: input.note,
          });
        }
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'draft_selection',
          oldValues: {
            draft_year: pick.draftYear, draft_kind: pick.draftKind, draft_type: pick.draftType,
            pick_number: pick.pickNumber, player_name_raw: pick.playerNameRaw,
          },
          newValues: { ...payload, pick_token: token },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const, relinked };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be saved: ${message(error)}`);
    }
  });
}

// --- 6.4b / 6.8 adoptLegacyPick (D-7) -----------------------------------

export type AdoptLegacyPickInput = {
  pickId: number;
  draftType: string;
  draftKind: string;
  adminUserId: number;
  note?: string | null;
  confirmed?: boolean;
};

/**
 * Give a pre-ISSUE-160 admin row (`source_id IS NULL`) the identity and
 * provenance it never had (§6.8, D-7). One import-role transaction, one row,
 * attributed to the acting admin -- there is no bulk backfill and there cannot
 * be one, because an override row requires an explicit `admin_user_id` and a
 * migration cannot attribute a human decision.
 *
 * It also repairs the LINKED PLAYER when that player has no durable identity
 * of its own, because a selection whose payload names an unresolvable player
 * is no more promotable than the row it replaces. A second identity is NEVER
 * minted when a valid one already exists.
 *
 * `draft_kind` is required by the payload and a legacy row may carry only
 * `draft_type`. Nothing is derived: the admin supplies the
 * `(draft_type, draft_kind)` pair from the frozen enumeration.
 */
export async function adoptLegacyPick(
  input: AdoptLegacyPickInput,
): Promise<DraftMutationResult<{
  pickToken: string; playerIdentity: string; mintedPlayerIdentity: boolean; playerId: number;
}>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pick = await lockPick(tx, input.pickId);
        if (!pick) return refuse('not_found', 'No draft selection with that id.');
        if (pick.sourceId !== null) {
          return refuse('stale', 'That selection already carries provenance; there is nothing to adopt.');
        }
        if (pick.playerId === null) {
          return refuse('conflict',
            'That selection carries neither provenance nor a player link. It is a data defect, not an '
            + 'adoptable row; report it rather than inventing an identity for it.');
        }

        const [player] = await tx<{
          id: number; displayName: string; givenName: string | null; surname: string | null;
          dob: string | null; dobConfidence: string; birthYear: number | null;
          heightCm: number | null; weightKg: number | null; notes: string | null;
        }[]>`
          SELECT id, display_name AS "displayName", given_name AS "givenName", surname,
                 to_char(dob, 'YYYY-MM-DD') AS dob, dob_confidence::text AS "dobConfidence",
                 birth_year AS "birthYear", height_cm AS "heightCm", weight_kg AS "weightKg", notes
            FROM players WHERE id = ${pick.playerId} FOR UPDATE
        `;
        if (!player) return refuse('not_found', 'The selection names a player that does not exist.');

        const club = pick.clubId === null
          ? null
          : (await tx<{ slug: string }[]>`SELECT slug FROM clubs WHERE id = ${pick.clubId}`)[0] ?? null;
        if (!club) {
          return refuse('conflict',
            'That selection names no club, so its durable record could not name one either. '
            + 'Give it a club before adopting it.');
        }

        const shape = await checkSelectionConflicts(tx, {
          playerId: player.id,
          draftYear: pick.draftYear,
          draftKind: input.draftKind,
          draftType: input.draftType,
          pickNumber: pick.pickNumber,
          pickNote: pick.pickNote,
        }, { excludePickId: pick.id, confirmed: input.confirmed });
        if (!shape.ok) return shape;

        // Step 2: the player's durable identity, in the settled order.
        const resolved = await resolvePlayerIdentity(tx, player.id);
        if (!resolved.ok) return refuse(resolved.reason, resolved.error);

        let playerIdentity = resolved.identity;
        let mintedPlayerIdentity = false;
        if (playerIdentity === null) {
          const playerToken = randomUUID();
          await tx`
            INSERT INTO external_identities
                  (source_id, external_id, external_name, external_url, player_id,
                   status, candidate_count, match_method, notes)
            VALUES ((SELECT id FROM sources WHERE key = ${MANUAL_SOURCE_KEY}),
                    ${playerToken}, ${player.displayName}, NULL, ${player.id},
                    'resolved', 0, 'manual_admin_edit',
                    'Identity adopted for a pre-ISSUE-160 admin-created player (AFLDB-ISSUE-160 §6.8).')
          `;
          const identityPayload: Record<string, unknown> = { display_name: player.displayName };
          if (player.givenName !== null) identityPayload.given_name = player.givenName;
          if (player.surname !== null) identityPayload.surname = player.surname;
          if (player.dob !== null) {
            identityPayload.dob = player.dob;
            identityPayload.dob_confidence = player.dobConfidence;
          }
          if (player.birthYear !== null) identityPayload.birth_year = player.birthYear;
          if (player.heightCm !== null) identityPayload.height_cm = player.heightCm;
          if (player.weightKg !== null) identityPayload.weight_kg = player.weightKg;
          if (player.notes !== null) identityPayload.notes = player.notes;
          await tx`
            INSERT INTO data_overrides
                  (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
            VALUES ('players', ${manualEntityKey(playerToken)}, 'identity',
                    ${tx.json(identityPayload as postgres.JSONValue)}, ${input.adminUserId}, true, now())
          `;
          await recordDataEdit(tx, {
            tableName: 'players',
            rowId: player.id,
            fieldGroup: 'identity_adopted',
            oldValues: {},
            newValues: { ...identityPayload, player_token: playerToken },
            adminUserId: input.adminUserId,
            note: input.note,
          });
          playerIdentity = manualEntityKey(playerToken);
          mintedPlayerIdentity = true;
        }

        // Step 3: the selection's own identity. The `source_id IS NULL`
        // predicate is the compare-and-swap: a second adopt updates 0 rows.
        const pickToken = randomUUID();
        const updated = await tx<{ id: number }[]>`
          UPDATE draft_picks
             SET source_id = (SELECT id FROM sources WHERE key = ${MANUAL_SOURCE_KEY}),
                 player_url = ${manualPlayerUrl(pickToken)},
                 source_record_id = ${pickToken},
                 draft_type = ${input.draftType},
                 draft_kind = ${input.draftKind}
           WHERE id = ${pick.id} AND source_id IS NULL
          RETURNING id
        `;
        if (updated.length === 0) {
          return refuse('stale', 'That selection was adopted by someone else while this form was open.');
        }

        const payload = manualSelectionPayload({
          draftYear: pick.draftYear,
          draftType: input.draftType,
          draftKind: input.draftKind,
          pickNumber: pick.pickNumber,
          clubSlug: club.slug,
          originalClubRaw: pick.originalClubRaw,
          draftAge: pick.draftAge,
          heightCm: pick.heightCm,
          weightKg: pick.weightKg,
          pickNote: pick.pickNote,
          detail: pick.detail,
        }, playerIdentity, pick.playerNameRaw);
        await tx`
          INSERT INTO data_overrides
                (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
          VALUES ('draft_picks', ${manualEntityKey(pickToken)}, 'selection',
                  ${tx.json(payload as postgres.JSONValue)}, ${input.adminUserId}, true, now())
        `;
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'draft_selection',
          oldValues: {},
          newValues: { ...payload, pick_token: pickToken, adopted_from_pick_id: pick.id },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return {
          ok: true as const,
          pickToken, playerIdentity, mintedPlayerIdentity, playerId: player.id,
        };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be adopted: ${message(error)}`);
    }
  });
}

// --- 6.5 attachAflTablesIdentity ----------------------------------------

/**
 * Attach a manual player's AFL Tables profile identity once the source
 * publishes them (§6.5, the debut case §8.4).
 *
 * Attaching FIRST is what makes the future safe: the very next settle resolves
 * the debutant's stats onto this player, and the next operator fitzRoy import
 * UPDATEs this player instead of inserting a second one. Without it, that
 * import would insert a duplicate -- which is why the D-2 guard exists in
 * `import_fitzroy_core.py` as the fail-closed backstop.
 */
export async function attachAflTablesIdentity(input: {
  playerId: number; profilePath: string; adminUserId: number; note?: string | null;
}): Promise<DraftMutationResult<object>> {
  const path = input.profilePath.trim();
  if (!AFLTABLES_PROFILE_PATH_RE.test(path)) {
    return refuse('validation',
      'An AFL Tables profile path looks like "players/S/Some_Player0.html".');
  }
  // J-16: a tracked, evidence-bound rule is never overridden from a browser.
  if (trackedProfilePaths().has(path)) {
    return refuse('forbidden',
      `${path} is named by a tracked profile-continuity rule (AFLDB-ISSUE-136). That decision is `
      + 'evidence-bound and is changed in the repository contract, never from the admin surface.');
  }

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const [player] = await tx<{ id: number; displayName: string }[]>`
          SELECT id, display_name AS "displayName" FROM players WHERE id = ${input.playerId} FOR UPDATE
        `;
        if (!player) return refuse('not_found', 'No player with that id.');

        const token = await readManualPlayerToken(tx, player.id);
        if (!token) {
          return refuse('forbidden',
            'Only a manually created player can have an AFL Tables identity attached here. A '
            + 'source-owned player already has one.');
        }

        const existing = await tx<{ playerId: number | null; externalId: string }[]>`
          SELECT e.player_id AS "playerId", e.external_id AS "externalId"
            FROM external_identities e
            JOIN sources s ON s.id = e.source_id
           WHERE s.key = 'afltables'
             AND e.match_method = 'afltables_profile_url'
             AND e.status IN ('unique', 'resolved')
             AND (e.external_id = ${path} OR e.player_id = ${player.id})
        `;
        // J-15: the path already belongs to another player. That is a merge.
        const claimedByOther = existing.find((e) => e.externalId === path && e.playerId !== player.id);
        if (claimedByOther) {
          return refuse('forbidden',
            `${path} is already registered to player #${claimedByOther.playerId}. Merging two existing `
            + 'players is out of scope here.');
        }
        // J-16: this player already holds an AFL Tables identity.
        const alreadyAttached = existing.find((e) => e.playerId === player.id);
        if (alreadyAttached) {
          return refuse('duplicate',
            `${player.displayName} already holds the AFL Tables identity `
            + `"${alreadyAttached.externalId}".`);
        }

        await tx`
          INSERT INTO external_identities
                (source_id, external_id, external_name, external_url, player_id,
                 status, candidate_count, match_method, notes)
          VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
                  ${path}, ${player.displayName},
                  ${`https://afltables.com/afl/stats/${path}`}, ${player.id},
                  'resolved', 0, 'afltables_profile_url',
                  'Attached by an administrator after the source published this person '
                  || '(AFLDB-ISSUE-160 §6.5).')
        `;
        // The player's durable record gains the path, so a rebuilt candidate
        // BINDS the token onto the path-player instead of creating a twin
        // (§8.1 step 2).
        const updated = await tx<{ id: number }[]>`
          UPDATE data_overrides
             SET override_values = override_values || ${tx.json({ afltables_profile_path: path } as postgres.JSONValue)},
                 admin_user_id = ${input.adminUserId},
                 updated_at = now()
           WHERE entity_type = 'players' AND entity_key = ${manualEntityKey(token)}
             AND field_group = 'identity'
          RETURNING id
        `;
        if (updated.length === 0) {
          return refuse('conflict',
            'That player holds a manual identity but no durable record to attach the path to.');
        }

        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: player.id,
          fieldGroup: 'source_identity',
          oldValues: {},
          newValues: { afltables_profile_path: path, player_token: token },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const };
      });
    } catch (error) {
      return refuse('failed', `The identity could not be attached: ${message(error)}`);
    }
  });
}

// --- 6.6 retireManualPick (D-4) -----------------------------------------

/**
 * Retire a manual selection: an audited DELETE of the canonical row plus
 * `is_active = false` on its durable record (D-4). No tombstone column and no
 * migration -- a retired manual selection is a selection that should never
 * have existed, and the `data_edits` row carries the whole of it in
 * `old_values`, against the PLAYER, which outlives the deleted id.
 */
export async function retireManualPick(input: {
  pickId: number; adminUserId: number; note?: string | null; expectedRevision?: string | null;
}): Promise<DraftMutationResult<{ playerId: number }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pick = await lockPick(tx, input.pickId);
        if (!pick) return refuse('not_found', 'No draft selection with that id.');
        if (pick.sourceKey !== MANUAL_SOURCE_KEY || !pick.playerUrl?.startsWith('manual:')) {
          return refuse('forbidden',
            'Only a manual selection can be retired. A source-owned selection is corrected, never '
            + 'deleted — the next reload would bring it straight back.');
        }
        if (pick.playerId === null) {
          return refuse('conflict', 'That manual selection names no player, so it has no audit subject.');
        }
        if (input.expectedRevision != null) {
          const revision = await draftPickRevision(tx, pick);
          if (revision !== input.expectedRevision) {
            return refuse('stale', 'That selection changed since this form was opened. Reload and try again.');
          }
        }
        const token = pick.playerUrl.slice('manual:'.length);

        await tx`
          UPDATE data_overrides
             SET is_active = false, admin_user_id = ${input.adminUserId}, updated_at = now()
           WHERE entity_type = 'draft_picks' AND entity_key = ${manualEntityKey(token)}
             AND field_group = 'selection'
        `;
        await tx`DELETE FROM draft_picks WHERE id = ${pick.id}`;

        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: pick.playerId,
          fieldGroup: 'draft_selection_retired',
          oldValues: {
            pick_token: token,
            pick_id: pick.id,
            draft_year: pick.draftYear,
            draft_type: pick.draftType,
            draft_kind: pick.draftKind,
            pick_number: pick.pickNumber,
            club_id: pick.clubId,
            player_name_raw: pick.playerNameRaw,
            original_club_raw: pick.originalClubRaw,
            draft_age: pick.draftAge,
            height_cm: pick.heightCm,
            weight_kg: pick.weightKg,
            pick_note: pick.pickNote,
            detail: pick.detail,
          },
          newValues: {},
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const, playerId: pick.playerId };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be retired: ${message(error)}`);
    }
  });
}

// --- 6.7 supersedeManualPickBySourceRow ---------------------------------

/**
 * The J-14 resolution: DraftGuru has published the selection a manual row was
 * standing in for. Link the source row to the player and retire the manual row
 * in ONE transaction, so the database is never briefly holding two selections
 * for one event or none at all.
 */
export async function supersedeManualPickBySourceRow(input: {
  manualPickId: number; sourcePickId: number; adminUserId: number; note?: string | null;
}): Promise<DraftMutationResult<{ playerId: number }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const manual = await lockPick(tx, input.manualPickId);
        if (!manual) return refuse('not_found', 'No manual selection with that id.');
        if (manual.sourceKey !== MANUAL_SOURCE_KEY || !manual.playerUrl?.startsWith('manual:')) {
          return refuse('forbidden', 'That is not a manual selection.');
        }
        if (manual.playerId === null) {
          return refuse('conflict', 'That manual selection names no player.');
        }
        const source = await lockPick(tx, input.sourcePickId);
        if (!source) return refuse('not_found', 'No source selection with that id.');
        if (source.sourceId === null || source.sourceKey === MANUAL_SOURCE_KEY) {
          return refuse('forbidden', 'The superseding selection must be a source-owned one.');
        }
        if (source.draftYear !== manual.draftYear || source.draftKind !== manual.draftKind) {
          return refuse('conflict',
            'The source selection is for a different draft event, so it does not supersede this one.');
        }

        const linked = await resolveLockedLink(tx, {
          targetTable: 'draft_picks',
          targetId: source.id,
          playerId: manual.playerId,
          adminUserId: input.adminUserId,
          note: input.note?.trim()
            || `Linked source selection #${source.id}, superseding manual selection #${manual.id}`,
        });
        if (!linked.ok) return refuse('conflict', linked.error);

        const token = manual.playerUrl.slice('manual:'.length);
        await tx`
          UPDATE data_overrides
             SET is_active = false, admin_user_id = ${input.adminUserId}, updated_at = now()
           WHERE entity_type = 'draft_picks' AND entity_key = ${manualEntityKey(token)}
             AND field_group = 'selection'
        `;
        await tx`DELETE FROM draft_picks WHERE id = ${manual.id}`;
        await recordDataEdit(tx, {
          tableName: 'players',
          rowId: manual.playerId,
          fieldGroup: 'draft_selection_retired',
          oldValues: {
            pick_token: token, pick_id: manual.id,
            draft_year: manual.draftYear, draft_kind: manual.draftKind,
            draft_type: manual.draftType, pick_number: manual.pickNumber,
            player_name_raw: manual.playerNameRaw,
          },
          newValues: { superseded_by_pick_id: source.id },
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const, playerId: manual.playerId };
      });
    } catch (error) {
      return refuse('failed', `The selection could not be superseded: ${message(error)}`);
    }
  });
}

// --- read helpers --------------------------------------------------------

export type DraftProvenance = 'draftguru' | 'manual' | 'legacy';

export function provenanceOf(sourceKey: string | null): DraftProvenance {
  if (sourceKey === null) return 'legacy';
  return sourceKey === MANUAL_SOURCE_KEY ? 'manual' : 'draftguru';
}

export type DraftAdminListFilters = {
  year?: number;
  kind?: string;
  clubSlug?: string;
  q?: string;
  provenance?: DraftProvenance;
  linkState?: 'linked' | 'unresolved';
  page: number;
  pageSize: number;
};

export type DraftAdminListRow = {
  id: number;
  draftYear: number;
  draftKind: string | null;
  draftType: string;
  pickNumber: number | null;
  playerNameRaw: string;
  playerId: number | null;
  playerSlug: string | null;
  clubName: string | null;
  clubSlug: string | null;
  provenance: DraftProvenance;
  linkStatusValue: string;
  entityKey: string | null;
};

/** The `/admin/draft` list. Canonical reads only; override state is a second, narrower read. */
export async function listDraftPicksForAdmin(
  filters: DraftAdminListFilters,
): Promise<{ rows: DraftAdminListRow[]; total: number }> {
  const offset = Math.max(0, (filters.page - 1) * filters.pageSize);
  const rows = await sql<(DraftAdminListRow & { sourceKey: string | null; total: string })[]>`
    WITH filtered AS (
      SELECT dp.id, dp.draft_year, dp.draft_kind, dp.draft_type, dp.pick_number,
             dp.player_name_raw, dp.player_id, dp.player_url, dp.source_id,
             dp.link_status_value, s.key AS source_key,
             p.slug AS player_slug, c.name AS club_name, c.slug AS club_slug
        FROM draft_picks dp
        LEFT JOIN sources s ON s.id = dp.source_id
        LEFT JOIN players p ON p.id = dp.player_id
        LEFT JOIN clubs c ON c.id = dp.club_id
       WHERE (${filters.year ?? null}::int IS NULL OR dp.draft_year = ${filters.year ?? null})
         AND (${filters.kind ?? null}::text IS NULL OR dp.draft_kind = ${filters.kind ?? null})
         AND (${filters.clubSlug ?? null}::text IS NULL OR c.slug = ${filters.clubSlug ?? null})
         AND (${filters.q ?? null}::text IS NULL
              OR dp.player_name_raw ILIKE '%' || ${filters.q ?? null} || '%'
              OR p.display_name ILIKE '%' || ${filters.q ?? null} || '%')
         AND (${filters.provenance ?? null}::text IS NULL
              OR (${filters.provenance ?? null} = 'legacy' AND dp.source_id IS NULL)
              OR (${filters.provenance ?? null} = 'manual' AND s.key = ${MANUAL_SOURCE_KEY})
              OR (${filters.provenance ?? null} = 'draftguru'
                  AND dp.source_id IS NOT NULL AND s.key <> ${MANUAL_SOURCE_KEY}))
         AND (${filters.linkState ?? null}::text IS NULL
              OR (${filters.linkState ?? null} = 'linked' AND dp.player_id IS NOT NULL)
              OR (${filters.linkState ?? null} = 'unresolved' AND dp.player_id IS NULL))
    )
    SELECT id, draft_year AS "draftYear", draft_kind AS "draftKind", draft_type AS "draftType",
           pick_number AS "pickNumber", player_name_raw AS "playerNameRaw",
           player_id AS "playerId", player_slug AS "playerSlug",
           club_name AS "clubName", club_slug AS "clubSlug",
           source_key AS "sourceKey", source_id AS "sourceId", player_url AS "playerUrl",
           link_status_value::text AS "linkStatusValue",
           count(*) OVER ()::text AS total
      FROM filtered
     ORDER BY draft_year DESC, draft_kind, pick_number NULLS LAST, id
     LIMIT ${filters.pageSize} OFFSET ${offset}
  `;
  return {
    total: rows.length > 0 ? Number(rows[0].total) : 0,
    rows: rows.map((r) => {
      const raw = r as unknown as {
        sourceId: number | null; playerUrl: string | null; sourceKey: string | null;
      };
      return {
        id: r.id,
        draftYear: r.draftYear,
        draftKind: r.draftKind,
        draftType: r.draftType,
        pickNumber: r.pickNumber,
        playerNameRaw: r.playerNameRaw,
        playerId: r.playerId,
        playerSlug: r.playerSlug,
        clubName: r.clubName,
        clubSlug: r.clubSlug,
        provenance: provenanceOf(raw.sourceKey),
        linkStatusValue: r.linkStatusValue,
        entityKey: entityKeyFor(raw.sourceKey, raw.sourceId, raw.playerUrl, r.draftYear, r.draftKind),
      };
    }),
  };
}

function entityKeyFor(
  sourceKey: string | null, sourceId: number | null, playerUrl: string | null,
  draftYear: number, draftKind: string | null,
): string | null {
  if (sourceKey === MANUAL_SOURCE_KEY && playerUrl?.startsWith('manual:')) {
    return manualEntityKey(playerUrl.slice('manual:'.length));
  }
  if (sourceId === null || playerUrl === null || draftKind === null) return null;
  return sourcePickEntityKey({ sourceId, playerUrl, draftYear, draftKind });
}

export type DraftPickAdminDetail = DraftAdminListRow & {
  playerDisplayName: string | null;
  originalClubRaw: string | null;
  draftAge: number | null;
  heightCm: number | null;
  weightKg: number | null;
  pickNote: string | null;
  detail: string | null;
  playerUrl: string | null;
};

export async function getDraftPickAdminDetail(pickId: number): Promise<DraftPickAdminDetail | null> {
  const [row] = await sql<(DraftPickAdminDetail & { sourceKey: string | null; sourceId: number | null })[]>`
    SELECT dp.id, dp.draft_year AS "draftYear", dp.draft_kind AS "draftKind",
           dp.draft_type AS "draftType", dp.pick_number AS "pickNumber",
           dp.player_name_raw AS "playerNameRaw", dp.player_id AS "playerId",
           dp.original_club_raw AS "originalClubRaw", dp.draft_age AS "draftAge",
           dp.height_cm AS "heightCm", dp.weight_kg AS "weightKg",
           dp.pick_note AS "pickNote", dp.detail, dp.player_url AS "playerUrl",
           dp.source_id AS "sourceId", s.key AS "sourceKey",
           dp.link_status_value::text AS "linkStatusValue",
           p.slug AS "playerSlug", p.display_name AS "playerDisplayName",
           c.name AS "clubName", c.slug AS "clubSlug"
      FROM draft_picks dp
      LEFT JOIN sources s ON s.id = dp.source_id
      LEFT JOIN players p ON p.id = dp.player_id
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE dp.id = ${pickId}
  `;
  if (!row) return null;
  return {
    ...row,
    provenance: provenanceOf(row.sourceKey),
    entityKey: entityKeyFor(row.sourceKey, row.sourceId, row.playerUrl, row.draftYear, row.draftKind),
  };
}

export type DraftOverrideRow = {
  fieldGroup: string;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: Date;
};

/** Every override row for one selection's identity. Import-role SELECT only (D-2). */
export async function readDraftOverrides(entityKey: string): Promise<DraftOverrideRow[]> {
  return withImportConnection((importSql) => importSql<DraftOverrideRow[]>`
    SELECT field_group AS "fieldGroup", override_values AS "overrideValues",
           is_active AS "isActive", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = 'draft_picks' AND entity_key = ${entityKey}
     ORDER BY field_group
  `);
}

/** Every selection `entity_key` carrying an ACTIVE override, for the list badge. D-2. */
export async function readActiveDraftOverrideKeys(): Promise<Set<string>> {
  const rows = await withImportConnection((importSql) => importSql<{ entityKey: string }[]>`
    SELECT DISTINCT entity_key AS "entityKey" FROM data_overrides
     WHERE entity_type = 'draft_picks' AND is_active
  `);
  return new Set(rows.map((r) => r.entityKey));
}

export type ManualPlayerAwaitingIdentity = {
  playerId: number;
  displayName: string;
  slug: string;
  dob: string | null;
  token: string;
  selections: number;
};

/**
 * Manual players that hold no AFL Tables identity yet -- the exact set the
 * D-2 importer guard measures itself against. Attaching an identity (6.5)
 * removes a player from this list AND from that guard's candidate set.
 */
export async function listManualPlayersAwaitingIdentity(): Promise<ManualPlayerAwaitingIdentity[]> {
  return sql<ManualPlayerAwaitingIdentity[]>`
    SELECT p.id AS "playerId", p.display_name AS "displayName", p.slug,
           to_char(p.dob, 'YYYY-MM-DD') AS dob,
           m.external_id AS token,
           (SELECT count(*) FROM draft_picks dp WHERE dp.player_id = p.id)::int AS selections
      FROM players p
      JOIN external_identities m ON m.player_id = p.id AND m.status IN ('unique', 'resolved')
      JOIN sources ms ON ms.id = m.source_id AND ms.key = ${MANUAL_SOURCE_KEY}
     WHERE NOT EXISTS (
             SELECT 1 FROM external_identities a
               JOIN sources asrc ON asrc.id = a.source_id AND asrc.key = 'afltables'
              WHERE a.player_id = p.id AND a.status IN ('unique', 'resolved'))
     ORDER BY p.display_name, p.id
  `;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
