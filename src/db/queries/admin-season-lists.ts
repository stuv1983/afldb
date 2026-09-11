import { randomUUID } from 'node:crypto';

import 'server-only';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import { resolvePlayerIdentity } from '@/db/queries/player-identity';

/**
 * Season list administration: THE season-list mutation contract
 * (AFLDB-ISSUE-161, ISSUE-156 P3c).
 *
 * WHAT A MEMBERSHIP MEANS (§4). One `season_list_members` row asserts:
 *
 *     player P was a member of club C's playing list for season S.
 *
 * It is ADMINISTRATIVE INTENT, and it is the only thing in the database that
 * is. It does NOT mean, and must never be derived from, any of:
 *
 *   * P played a senior match for C in S;
 *   * P recorded statistics in S;
 *   * P has a `player_club_season_stats` row for (S, C);
 *   * P was drafted or traded to C;
 *   * P's "career club" or "latest club" inferred from appearances.
 *
 * Everything in that list is PARTICIPATION, and every table holding it
 * (`player_clubs`, `player_club_season_stats`, `player_season_stats`,
 * `player_career_stats`, `club_seasons`) is DERIVED — truncated and rebuilt
 * from `player_match_stats` by `tools/migration/rebuild_derived.py`, which the
 * nightly settle runs. "Listed" and "played for" are different facts about
 * different things, and conflating them is the defect this issue exists to
 * avoid: a delisted player plays no games, and a listed rookie may play none
 * either.
 *
 * FIRST_LIST_SEASON = 2027 (D-2). 2027 is the first authoritative
 * Admin-managed list season and every write below refuses a season under it.
 * 2026 match appearances are NEVER promoted into membership: there is no bulk
 * seed, no `seeded_appearances` origin, and no code path that writes a row the
 * way `readAppearanceReviewCandidates()` reads one. That projection exists so a
 * Super Admin can *review* who played in 2026 and add players one at a time;
 * each add is an ordinary `origin = 'added'` decision that merely records
 * `candidate_source = 'appearances:2026'` as evidence of where the human was
 * looking.
 *
 * DURABILITY (§5, §19) — the ISSUE-159/160 shape. The canonical row is an
 * ordinary registry-table row that a promotion rebuilds and a destructive
 * reload can remove. The durable record is a `data_overrides` row keyed by a
 * NATURAL, rebuild-stable key:
 *
 *     <club_slug>|<season>|<player identity>
 *
 * — club slugs are tracked reference data, and the player identity is exactly
 * the string the ISSUE-160 `players` lineage rule and replay resolve. No token
 * is minted per membership, because a membership HAS a natural key: minting one
 * would let the same player be listed twice under two tokens and would make
 * copy-forward non-idempotent. Re-adding a removed player therefore reactivates
 * the same record rather than creating a second one. No component may be NULL
 * and the writer refuses when the player's identity does not resolve to exactly
 * one string, so no `null|null|<year>|null` class of key can arise.
 *
 * REMOVAL IS NOT RETIREMENT (§12.2, D-4). Removing a membership means only
 * "P is not on C's list for S". It sets no player flag, touches no earlier
 * season, and changes no career statistic or draft row. It is an audited
 * `DELETE` whose override is flipped INACTIVE — a TOMBSTONE that binds every
 * future importer and the replay (§7 precedence). Reversal is a re-add, which
 * lifts the tombstone by reactivating the same key.
 *
 * TRANSACTIONS (§18). Every mutation is one `AFLDB_IMPORT_DATABASE_URL`
 * transaction: canonical write(s) + `data_overrides` + `recordDataEdit()`, all
 * or nothing. Preconditions are checked BEFORE the first write. A refusal
 * discovered after a write has happened is thrown as a `RollbackRefusal`, never
 * returned — `postgres.js` commits when the `begin()` callback RESOLVES, so a
 * plain `return refuse(...)` past the first write would commit a half-done,
 * partly-unaudited mutation while telling the operator it had failed. That is
 * the ISSUE-160 defect this file will not repeat.
 *
 * AUDIT SUBJECT (§17). The subject is the PLAYER (`data_edits.table_name =
 * 'players'`), not the membership: membership rows are deletable and are
 * renumbered by a promotion, so an audit row pointing at one would dangle and
 * would need its own lineage target. `data_edits.table_name`'s CHECK is not
 * widened. Actor, operation, player, club, season, before and after are all
 * recoverable from `data_edits` alone.
 *
 * READS. Canonical reads go on the public client. `data_overrides` carries no
 * `grant_app_read` (073 grants SELECT to `afldb_import` only), so override
 * reads go through the same narrow SELECT-only import-role helper ISSUE-159 D-2
 * introduced and `admin-draft.ts`/`admin-coaches.ts` each already own.
 *
 * NO FIXTURE DEPENDENCY (§9.4, W-14). Nothing here requires a `matches` row, a
 * fixture, a `club_seasons` row or a settle to have run for season S. Fixture
 * creation is not this issue's (likely AFLDB-ISSUE-162's); every mutation below
 * works against a season with zero matches, and the diagnostics render "no
 * matches recorded" instead of hiding the list.
 */

type Tx = postgres.TransactionSql;

/**
 * The first season whose list is AUTHORITATIVE (D-2, approved with
 * modification). Every authoritative write refuses a season below this. It is a
 * server rule rather than a CHECK constraint on purpose: a later decision to
 * administer an earlier season must be a reviewed code change, not a migration
 * that rewrites what the table has already asserted.
 */
export const FIRST_LIST_SEASON = 2027;

export const SEASON_LIST_ENTITY_TYPE = 'season_list_members';
export const SEASON_LIST_FIELD_GROUP = 'membership';
export const SEASON_LIST_SOURCE_KEY = 'manual_admin_edit';

/** Every `season_list_members.origin` the CHECK admits (migration 096). */
export const SEASON_LIST_ORIGINS = ['added', 'copied_list', 'transferred', 'imported'] as const;
export type SeasonListOrigin = (typeof SEASON_LIST_ORIGINS)[number];

// --- entity_key shape (§5) ----------------------------------------------

/**
 * The durable key of one membership. Mirrors the decode in
 * `tools/migration/common.py`'s `replay_admin_overrides('season_list_members')`;
 * the two must never be able to disagree about what a key means.
 *
 * The player identity is LAST because it is the only component that could ever
 * contain the separator: an AFL Tables profile path and a UUID token cannot,
 * but putting it last means the parser splits on the first two separators only
 * and is correct whatever the identity turns out to hold.
 */
export function seasonListEntityKey(input: {
  clubSlug: string; season: number; playerIdentity: string;
}): string {
  return `${input.clubSlug}|${input.season}|${input.playerIdentity}`;
}

export type ParsedSeasonListKey = { clubSlug: string; season: number; playerIdentity: string };

/** The inverse of {@link seasonListEntityKey}, or null when the key is not one. */
export function parseSeasonListEntityKey(key: string): ParsedSeasonListKey | null {
  const first = key.indexOf('|');
  if (first <= 0) return null;
  const second = key.indexOf('|', first + 1);
  if (second <= first + 1) return null;
  const seasonText = key.slice(first + 1, second);
  if (!/^\d{4}$/.test(seasonText)) return null;
  const playerIdentity = key.slice(second + 1);
  if (!playerIdentity) return null;
  return { clubSlug: key.slice(0, first), season: Number(seasonText), playerIdentity };
}

// --- season bounds (§9.1, I-4) ------------------------------------------

export type ListSeasonBounds = { first: number; last: number };

/**
 * The seasons whose lists may be administered, given the reference register's
 * last season: `FIRST_LIST_SEASON <= S <= maxYear + 1`.
 *
 * The upper bound is the register's last season plus one because a list is
 * intent about a season that has not been played. It is not "plus anything":
 * administering two unplayed seasons at once would mean maintaining a list for
 * a season whose club set the repository holds no fact about at all.
 *
 * With no register at all the range is EMPTY (`first > last`) rather than
 * open — fail-closed in the one state where nothing can be known.
 */
export function listSeasonBounds(maxSeasonYear: number | null): ListSeasonBounds {
  return {
    first: FIRST_LIST_SEASON,
    last: maxSeasonYear === null ? FIRST_LIST_SEASON - 1 : maxSeasonYear + 1,
  };
}

export function isAdministrableListSeason(season: number, bounds: ListSeasonBounds): boolean {
  return Number.isInteger(season) && season >= bounds.first && season <= bounds.last;
}

/**
 * TEST ONLY, and structurally inert outside a test run.
 *
 * Copy-forward moves a list from S-1 to S, so proving it needs TWO
 * administrable seasons — and with the register at 2026 the real rule admits
 * exactly one (2027). The integration suite raises the ceiling rather than
 * seeding a throwaway `seasons` row, because `seasons` is tracked reference
 * data that other suites read and ISSUE-161 writes none of it (D-6, §9.2).
 *
 * `NODE_ENV` is 'test' under vitest and 'production' in a built server, so this
 * cannot be reached in production even if the variable were somehow set there —
 * which `tests/admin-season-list-actions.test.ts` asserts. It raises only the
 * CEILING; it can never lower `FIRST_LIST_SEASON`, so no test can write an
 * authoritative row for a season below 2027.
 */
function testCeilingSeason(): number | null {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Exported for AFLDB-ISSUE-163 (§10): club leadership is administrable for
 * exactly the seasons whose lists are, so it reads THIS function rather than
 * carrying a copy. One rule, one test-only ceiling, and no state in which a
 * club's list may be administered for a season its leadership may not.
 */
export async function readListSeasonBounds(db: postgres.Sql | Tx): Promise<ListSeasonBounds> {
  // One cast, here: `postgres.Sql` and `TransactionSql` carry the same tagged
  // template call signature but TypeScript will not call it through the union.
  const [row] = await (db as postgres.Sql)<{ maxYear: number | null }[]>`
    SELECT max(year)::int AS "maxYear" FROM seasons
  `;
  const ceiling = testCeilingSeason();
  const maxYear = row?.maxYear ?? null;
  const effective = ceiling === null ? maxYear : Math.max(maxYear ?? ceiling, ceiling);
  return listSeasonBounds(effective);
}

function seasonBoundError(season: number, bounds: ListSeasonBounds): string {
  if (bounds.first > bounds.last) {
    return 'No season list can be administered yet: the season register is empty.';
  }
  if (season < bounds.first) {
    return `${season} is before ${FIRST_LIST_SEASON}, the first season AFLDB holds authoritative `
      + 'playing lists for. Earlier seasons are represented by matches played, not by lists.';
  }
  return `${season} is beyond ${bounds.last}, the latest season a list may be administered for. `
    + 'The season register has to advance first.';
}

// --- results (§18) -------------------------------------------------------

export type SeasonListRefusalReason =
  | 'validation'
  | 'not_found'
  | 'duplicate'
  | 'conflict'
  | 'stale'
  | 'forbidden'
  | 'ambiguous_identity'
  | 'failed';

export type SeasonListRefusal = {
  ok: false;
  error: string;
  reason: SeasonListRefusalReason;
  /**
   * The clubs or players a bulk refusal is ABOUT, so the caller can name them
   * without parsing the sentence. Empty for a refusal about one subject.
   */
  subjects?: string[];
};

export type SeasonListMutationResult<T> = ({ ok: true } & T) | SeasonListRefusal;

function refuse(
  reason: SeasonListRefusalReason, error: string, subjects?: string[],
): SeasonListRefusal {
  return subjects?.length ? { ok: false, error, reason, subjects } : { ok: false, error, reason };
}

/**
 * A refusal discovered AFTER this transaction has already written something.
 *
 * `postgres.js` commits when the `begin()` callback RESOLVES and rolls back only
 * when it REJECTS, so returning a refusal past the first write would commit the
 * half-done mutation while reporting failure — an unaudited canonical write,
 * which §18 forbids. Throwing rolls the transaction back, and the mutation's own
 * `catch` turns it back into exactly the refusal the caller would otherwise have
 * received, so the contract the action layer sees is unchanged.
 *
 * This is the AFLDB-ISSUE-160 `RollbackRefusal` pattern, used here for EVERY
 * post-write refusal without exception.
 */
class RollbackRefusal extends Error {
  constructor(
    readonly reason: SeasonListRefusalReason,
    readonly detail: string,
    readonly subjects: string[] = [],
  ) {
    super(detail);
    this.name = 'RollbackRefusal';
  }
}

/** The refusal a `RollbackRefusal` carried, or null for a genuine failure. */
function rolledBackRefusal(error: unknown): SeasonListRefusal | null {
  return error instanceof RollbackRefusal
    ? refuse(error.reason, error.detail, error.subjects)
    : null;
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

// --- eligible clubs (§9.1, D-6) ------------------------------------------

export type EligibleClub = {
  id: number;
  slug: string;
  name: string;
  organizationId: number;
};

/**
 * The clubs whose list may be administered for a season, resolved through the
 * ONE rule — `afldb_season_list_clubs()` in migration 096. The list page,
 * copy-forward, add and transfer all go through this, so they cannot disagree.
 *
 * Requires no `matches`, no fixture and no `club_seasons` row for a future
 * season (§9.4).
 */
export async function eligibleClubsForSeason(season: number): Promise<EligibleClub[]> {
  return sql<EligibleClub[]>`
    SELECT id, slug, name, organization_id AS "organizationId"
      FROM afldb_season_list_clubs(${season}::smallint)
     ORDER BY name
  `;
}

type ResolvedClub = EligibleClub & { eligible: boolean };

async function resolveClub(tx: Tx, clubSlug: string, season: number): Promise<ResolvedClub | null> {
  const [row] = await tx<ResolvedClub[]>`
    SELECT c.id, c.slug, c.name, c.organization_id AS "organizationId",
           EXISTS (SELECT 1 FROM afldb_season_list_clubs(${season}::smallint) e WHERE e.id = c.id)
             AS eligible
      FROM clubs c
     WHERE c.slug = ${clubSlug}
  `;
  return row ?? null;
}

function ineligibleClubError(club: { name: string }, season: number): string {
  return `${club.name} is not a club whose list may be administered for ${season}. `
    + 'Choose one of the identities competing in that season.';
}

// --- shared in-transaction primitives ------------------------------------

type MembershipRow = {
  id: number;
  season: number;
  clubId: number;
  clubSlug: string;
  clubName: string;
  playerId: number;
  playerName: string;
  origin: SeasonListOrigin;
  copiedFromSeason: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

const MEMBERSHIP_COLUMNS = `
  m.id::int AS id, m.season::int AS season, m.club_id AS "clubId", c.slug AS "clubSlug",
  c.name AS "clubName", m.player_id AS "playerId", p.display_name AS "playerName",
  m.origin, m.copied_from_season::int AS "copiedFromSeason", m.note,
  m.created_at::text AS "createdAt", m.updated_at::text AS "updatedAt"`;

/**
 * Lock one membership for update and read it back whole.
 *
 * `FOR UPDATE` is taken on `season_list_members` alone: the clubs and players
 * joins are lookups, and `FOR UPDATE OF` an outer relation is not permitted.
 */
async function lockMembership(tx: Tx, membershipId: number): Promise<MembershipRow | null> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM season_list_members WHERE id = ${membershipId} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${MEMBERSHIP_COLUMNS}
       FROM season_list_members m
       JOIN clubs c ON c.id = m.club_id
       JOIN players p ON p.id = m.player_id
      WHERE m.id = $1`,
    [membershipId],
  ) as unknown as MembershipRow[];
  return rows[0] ?? null;
}

/** The `manual_admin_edit` source every ISSUE-161 row is written under. */
async function manualSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    SELECT id FROM sources WHERE key = ${SEASON_LIST_SOURCE_KEY}
  `;
  if (!row) throw new Error(`Required source '${SEASON_LIST_SOURCE_KEY}' is not configured.`);
  return row.id;
}

type PlayerSubject = { id: number; displayName: string; identity: string };

/**
 * Re-read the player server-side and resolve the durable identity its override
 * key will carry. A refusal here always happens BEFORE any write.
 *
 * An identity-less legacy player is REFUSED rather than given a minted one:
 * minting an identity is a player-lifecycle decision that belongs to the draft
 * and adopt actions (ISSUE-160 §6.8), and a list membership is not the place to
 * take one silently.
 */
async function resolvePlayerSubject(
  tx: Tx, playerId: number,
): Promise<{ ok: true; player: PlayerSubject } | SeasonListRefusal> {
  const [player] = await tx<{ id: number; displayName: string }[]>`
    SELECT id, display_name AS "displayName" FROM players WHERE id = ${playerId}
  `;
  if (!player) return refuse('not_found', `No player with id ${playerId}.`);

  const resolved = await resolvePlayerIdentity(tx, player.id);
  if (!resolved.ok) return refuse(resolved.reason, resolved.error);
  if (resolved.identity === null) {
    return refuse('conflict',
      `${player.displayName} (#${player.id}) carries no durable identity, so a list membership `
      + 'recorded against them could not survive a rebuild. Attach an AFL Tables identity, or '
      + 'adopt the player through the draft administration screen, before listing them.');
  }
  return { ok: true, player: { id: player.id, displayName: player.displayName, identity: resolved.identity } };
}

type OverridePayload = {
  club_slug: string;
  season: number;
  player_identity: string;
  origin: SeasonListOrigin;
  copied_from_season?: number;
  candidate_source?: string;
  note?: string;
};

function overridePayload(input: {
  clubSlug: string; season: number; playerIdentity: string; origin: SeasonListOrigin;
  copiedFromSeason?: number | null; candidateSource?: string | null; note?: string | null;
}): OverridePayload {
  // Keys are written only when supplied: an absent key and an explicit null are
  // different things to the replay, and the four required ones are always present.
  const payload: OverridePayload = {
    club_slug: input.clubSlug,
    season: input.season,
    player_identity: input.playerIdentity,
    origin: input.origin,
  };
  if (input.copiedFromSeason != null) payload.copied_from_season = input.copiedFromSeason;
  if (input.candidateSource) payload.candidate_source = input.candidateSource;
  const note = (input.note ?? '').trim();
  if (note) payload.note = note;
  return payload;
}

/**
 * Write one membership: canonical row, durable override, audit row. Every
 * caller (add, multi-add, copy-forward, transfer) goes through here, so the
 * three writes can never come apart in one path and not another.
 *
 * A `duplicate` discovered by `ON CONFLICT DO NOTHING` is THROWN, not returned:
 * by this point the transaction may already hold other rows (multi-add,
 * copy-forward, transfer), and a returned refusal would commit them.
 */
async function insertMembership(tx: Tx, input: {
  season: number;
  club: { id: number; slug: string; name: string };
  player: PlayerSubject;
  origin: SeasonListOrigin;
  sourceId: number;
  adminUserId: number;
  copiedFromSeason?: number | null;
  candidateSource?: string | null;
  note?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<{ membershipId: number; entityKey: string }> {
  const entityKey = seasonListEntityKey({
    clubSlug: input.club.slug, season: input.season, playerIdentity: input.player.identity,
  });
  const payload = overridePayload({
    clubSlug: input.club.slug,
    season: input.season,
    playerIdentity: input.player.identity,
    origin: input.origin,
    copiedFromSeason: input.copiedFromSeason,
    candidateSource: input.candidateSource,
    note: input.note,
  });

  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO season_list_members
          (season, club_id, player_id, source_id, origin, copied_from_season, note)
    VALUES (${input.season}::smallint, ${input.club.id}, ${input.player.id}, ${input.sourceId},
            ${input.origin}, ${input.copiedFromSeason ?? null}::smallint,
            ${(input.note ?? '').trim() || null})
    ON CONFLICT (season, player_id) DO NOTHING
    RETURNING id::int AS id
  `;
  if (!inserted) {
    // I-1. Someone else listed this player for this season between the
    // precondition check and here, or a bulk request named them twice.
    throw new RollbackRefusal('duplicate',
      `${input.player.displayName} already holds a ${input.season} list place, so they cannot also `
      + `be listed at ${input.club.name}. Transfer the existing membership instead.`,
      [input.player.displayName]);
  }

  // The durable record. ON CONFLICT reactivates a TOMBSTONE for the same natural
  // key rather than creating a second record — which is exactly what "re-adding a
  // mistakenly removed player" has to mean (§12.2).
  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
    VALUES (${SEASON_LIST_ENTITY_TYPE}, ${entityKey}, ${SEASON_LIST_FIELD_GROUP},
            ${tx.json(payload as unknown as postgres.JSONValue)}, ${input.adminUserId}, true, now())
    ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
       SET override_values = EXCLUDED.override_values,
           is_active = true,
           admin_user_id = EXCLUDED.admin_user_id,
           updated_at = now()
  `;

  await recordDataEdit(tx, {
    tableName: 'players',
    rowId: input.player.id,
    fieldGroup: 'season_list_added',
    oldValues: {},
    newValues: { ...payload, entity_key: entityKey, ...(input.auditExtra ?? {}) },
    adminUserId: input.adminUserId,
    note: input.note,
  });

  return { membershipId: inserted.id, entityKey };
}

/**
 * Delete one membership and TOMBSTONE its durable record: `is_active = false`
 * means "intentionally removed" and binds every importer and the replay (§7
 * precedence rule 1). The override is created if it does not exist, which is the
 * case for a row a future importer owned.
 */
async function deleteMembership(tx: Tx, input: {
  row: MembershipRow;
  playerIdentity: string;
  adminUserId: number;
  note?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<{ entityKey: string }> {
  const entityKey = seasonListEntityKey({
    clubSlug: input.row.clubSlug, season: input.row.season, playerIdentity: input.playerIdentity,
  });

  await tx`DELETE FROM season_list_members WHERE id = ${input.row.id}`;

  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
    VALUES (${SEASON_LIST_ENTITY_TYPE}, ${entityKey}, ${SEASON_LIST_FIELD_GROUP},
            ${tx.json(overridePayload({
              clubSlug: input.row.clubSlug,
              season: input.row.season,
              playerIdentity: input.playerIdentity,
              origin: input.row.origin,
              copiedFromSeason: input.row.copiedFromSeason,
              note: input.note,
            }) as unknown as postgres.JSONValue)},
            ${input.adminUserId}, false, now())
    ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
       SET is_active = false,
           admin_user_id = EXCLUDED.admin_user_id,
           updated_at = now()
  `;

  await recordDataEdit(tx, {
    tableName: 'players',
    rowId: input.row.playerId,
    fieldGroup: 'season_list_removed',
    oldValues: {
      season: input.row.season,
      club_slug: input.row.clubSlug,
      origin: input.row.origin,
      copied_from_season: input.row.copiedFromSeason,
      note: input.row.note,
      created_at: input.row.createdAt,
    },
    newValues: {
      season: input.row.season,
      club_slug: input.row.clubSlug,
      entity_key: entityKey,
      ...(input.auditExtra ?? {}),
      ...((input.note ?? '').trim() ? { note: (input.note ?? '').trim() } : {}),
    },
    adminUserId: input.adminUserId,
    note: input.note,
  });

  return { entityKey };
}

// --- add (§12.1) ---------------------------------------------------------

export type AddSeasonListMemberInput = {
  season: number;
  clubSlug: string;
  playerId: number;
  adminUserId: number;
  note?: string | null;
  /**
   * Where the admin was LOOKING when they chose this player —
   * `'appearances:<season>'` or `'draft:<pick id>'`. Evidence recorded in the
   * override payload and the audit row; never identity, and never a reason a
   * row may be written without an explicit human decision (D-2).
   */
  candidateSource?: string | null;
};

export async function addSeasonListMember(
  input: AddSeasonListMemberInput,
): Promise<SeasonListMutationResult<{ membershipId: number; entityKey: string }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const pre = await preflightAdd(tx, input);
        if (!pre.ok) return pre;

        const written = await insertMembership(tx, {
          season: input.season,
          club: pre.club,
          player: pre.player,
          origin: 'added',
          sourceId: pre.sourceId,
          adminUserId: input.adminUserId,
          candidateSource: input.candidateSource,
          note: input.note,
        });
        return { ok: true as const, ...written };
      }) as SeasonListMutationResult<{ membershipId: number; entityKey: string }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

function mutationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `The season list could not be changed: ${message}`;
}

type AddPreflight =
  | { ok: true; club: ResolvedClub; player: PlayerSubject; sourceId: number }
  | SeasonListRefusal;

/** Every precondition of an add, checked before the first write (§18). */
async function preflightAdd(tx: Tx, input: {
  season: number; clubSlug: string; playerId: number;
}): Promise<AddPreflight> {
  const bounds = await readListSeasonBounds(tx as unknown as typeof sql);
  if (!isAdministrableListSeason(input.season, bounds)) {
    return refuse('validation', seasonBoundError(input.season, bounds));
  }

  const club = await resolveClub(tx, input.clubSlug, input.season);
  if (!club) return refuse('validation', `No club with the identifier "${input.clubSlug}".`);
  if (!club.eligible) return refuse('validation', ineligibleClubError(club, input.season));

  const subject = await resolvePlayerSubject(tx, input.playerId);
  if (!subject.ok) return subject;

  // I-1, checked before any write so the common case is a plain refusal that
  // names the club the player is already at and can offer a transfer.
  const [existing] = await tx<{ clubName: string; clubSlug: string }[]>`
    SELECT c.name AS "clubName", c.slug AS "clubSlug"
      FROM season_list_members m
      JOIN clubs c ON c.id = m.club_id
     WHERE m.season = ${input.season}::smallint AND m.player_id = ${input.playerId}
  `;
  if (existing) {
    return refuse('duplicate',
      existing.clubSlug === club.slug
        ? `${subject.player.displayName} is already on ${club.name}'s ${input.season} list.`
        : `${subject.player.displayName} is already on ${existing.clubName}'s ${input.season} list. `
          + 'A player holds one list place per season — transfer the existing membership instead.');
  }

  return { ok: true, club, player: subject.player, sourceId: await manualSourceId(tx) };
}

// --- multi-select add (§18, §23, §14) ------------------------------------

export type AddSeasonListMembersInput = {
  season: number;
  clubSlug: string;
  playerIds: readonly number[];
  adminUserId: number;
  note?: string | null;
  candidateSource?: string | null;
};

/**
 * Several EXPLICIT per-player decisions submitted together — the draftee panel
 * and the appearances review panel both use it. One transaction for the whole
 * selection: any single refusal rolls back every row and names the player, so
 * the operator never has to work out which half of a selection landed.
 *
 * This is not a bulk seed. Every player id came from a human ticking a box; the
 * projection that offered them writes nothing itself (D-2).
 */
export async function addSeasonListMembers(
  input: AddSeasonListMembersInput,
): Promise<SeasonListMutationResult<{ batchId: string; added: number; entityKeys: string[] }>> {
  const playerIds = [...new Set(input.playerIds)];
  if (playerIds.length === 0) return refuse('validation', 'No players were selected.');

  const batchId = randomUUID();
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        // Every precondition of every player first, then every write.
        const preflights: { club: ResolvedClub; player: PlayerSubject; sourceId: number }[] = [];
        for (const playerId of playerIds) {
          const pre = await preflightAdd(tx, {
            season: input.season, clubSlug: input.clubSlug, playerId,
          });
          if (!pre.ok) return pre;
          preflights.push(pre);
        }

        const entityKeys: string[] = [];
        for (const pre of preflights) {
          const written = await insertMembership(tx, {
            season: input.season,
            club: pre.club,
            player: pre.player,
            origin: 'added',
            sourceId: pre.sourceId,
            adminUserId: input.adminUserId,
            candidateSource: input.candidateSource,
            note: input.note,
            auditExtra: { batch_id: batchId },
          });
          entityKeys.push(written.entityKey);
        }
        return { ok: true as const, batchId, added: entityKeys.length, entityKeys };
      }) as SeasonListMutationResult<{ batchId: string; added: number; entityKeys: string[] }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- remove (§12.2, D-4) -------------------------------------------------

export type RemoveSeasonListMemberInput = {
  membershipId: number;
  /** The `updatedAt` the form rendered. Per-row compare-and-swap. */
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

/**
 * "This player is not a member of this club's list for this season." NOT
 * "retire": no player flag is set, no earlier membership is touched, and no
 * career statistic, draft row or link changes. A mistaken removal is reversed by
 * adding the player again, which lifts the tombstone.
 */
export async function removeSeasonListMember(
  input: RemoveSeasonListMemberInput,
): Promise<SeasonListMutationResult<{ entityKey: string; playerId: number }>> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const row = await lockMembership(tx, input.membershipId);
        if (!row) return refuse('not_found', 'That list membership no longer exists.');
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That membership changed while this page was open. Reload the list and try again.');
        }

        const subject = await resolvePlayerSubject(tx, row.playerId);
        if (!subject.ok) return subject;

        const { entityKey } = await deleteMembership(tx, {
          row,
          playerIdentity: subject.player.identity,
          adminUserId: input.adminUserId,
          note: input.note,
        });
        return { ok: true as const, entityKey, playerId: row.playerId };
      }) as SeasonListMutationResult<{ entityKey: string; playerId: number }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- transfer (§13) ------------------------------------------------------

export type TransferSeasonListMemberInput = {
  membershipId: number;
  toClubSlug: string;
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

/**
 * Move a membership WITHIN one season, atomically.
 *
 * A move BETWEEN seasons is not this: it is simply an add to the new club in
 * the new season, and the previous season's row is history that is never
 * touched. This primitive exists for a mistaken club, or a rule-permitted
 * mid-season move.
 *
 * It is one primitive rather than remove-then-add because a separate add that
 * failed would leave the player unlisted — a worse state than either the
 * before or the after. The UNIQUE holds at commit; the two audit rows share a
 * `transfer_id` so the viewer can show them as one movement.
 */
export async function transferSeasonListMember(
  input: TransferSeasonListMemberInput,
): Promise<SeasonListMutationResult<{
  membershipId: number; fromEntityKey: string; toEntityKey: string; transferId: string;
}>> {
  const transferId = randomUUID();
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const row = await lockMembership(tx, input.membershipId);
        if (!row) return refuse('not_found', 'That list membership no longer exists.');
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That membership changed while this page was open. Reload the list and try again.');
        }
        if (row.clubSlug === input.toClubSlug) {
          return refuse('validation', `${row.playerName} is already on ${row.clubName}'s ${row.season} list.`);
        }

        const target = await resolveClub(tx, input.toClubSlug, row.season);
        if (!target) return refuse('validation', `No club with the identifier "${input.toClubSlug}".`);
        if (!target.eligible) return refuse('validation', ineligibleClubError(target, row.season));

        const subject = await resolvePlayerSubject(tx, row.playerId);
        if (!subject.ok) return subject;

        const sourceId = await manualSourceId(tx);

        // Everything above refused before a write. From here, any refusal throws.
        const { entityKey: fromEntityKey } = await deleteMembership(tx, {
          row,
          playerIdentity: subject.player.identity,
          adminUserId: input.adminUserId,
          note: input.note,
          auditExtra: { transfer_id: transferId, transferred_to: target.slug },
        });

        const written = await insertMembership(tx, {
          season: row.season,
          club: target,
          player: subject.player,
          origin: 'transferred',
          sourceId,
          adminUserId: input.adminUserId,
          note: input.note,
          auditExtra: { transfer_id: transferId, transferred_from: row.clubSlug },
        });

        return {
          ok: true as const,
          membershipId: written.membershipId,
          fromEntityKey,
          toEntityKey: written.entityKey,
          transferId,
        };
      }) as SeasonListMutationResult<{
        membershipId: number; fromEntityKey: string; toEntityKey: string; transferId: string;
      }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- copy forward (§11a) -------------------------------------------------

export type CopySeasonListsForwardInput = {
  /** The TARGET season. The source is always its predecessor's list. */
  season: number;
  clubs: 'all' | readonly string[];
  dryRun: boolean;
  adminUserId: number;
  note?: string | null;
};

export type CopyForwardClubPlan = {
  clubSlug: string;
  clubName: string;
  fromClubSlug: string;
  players: number;
};

export type CopySeasonListsForwardResult = {
  batchId: string;
  dryRun: boolean;
  fromSeason: number;
  clubs: CopyForwardClubPlan[];
  copied: number;
};

/**
 * Carry a whole season's lists forward to the next season.
 *
 * The source is the PREVIOUS SEASON'S LIST and never appearances (D-2). 2027 is
 * the first authoritative list season, so it has nothing to copy from: the
 * refusal says so and points at the appearances review panel, from which every
 * add is an explicit per-player decision.
 *
 * Clubs are mapped by ORGANISATION, so a rename between the two seasons carries
 * the list onto the new identity rather than stranding it on the old one.
 *
 * It refuses BEFORE any write if any requested club is ineligible, if any target
 * club already holds a row (the operator narrows the request; the preview shows
 * which clubs are at zero), or if any source player already holds a place in the
 * target season. A `dryRun` runs the identical code path up to the point of the
 * first write and returns the plan.
 */
export async function copySeasonListsForward(
  input: CopySeasonListsForwardInput,
): Promise<SeasonListMutationResult<CopySeasonListsForwardResult>> {
  const batchId = randomUUID();
  const fromSeason = input.season - 1;

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const bounds = await readListSeasonBounds(tx as unknown as typeof sql);
        if (!isAdministrableListSeason(input.season, bounds)) {
          return refuse('validation', seasonBoundError(input.season, bounds));
        }
        if (fromSeason < FIRST_LIST_SEASON) {
          return refuse('validation',
            `${input.season} has no earlier list to copy: ${FIRST_LIST_SEASON} is the first season `
            + 'AFLDB holds authoritative lists for. Build this list from the previous season\'s '
            + 'appearances review panel, where every player is added by an explicit decision.');
        }

        const eligible = await tx<ResolvedClub[]>`
          SELECT id, slug, name, organization_id AS "organizationId", true AS eligible
            FROM afldb_season_list_clubs(${input.season}::smallint)
           ORDER BY name
        `;
        const eligibleBySlug = new Map(eligible.map((c) => [c.slug, c]));
        const eligibleByOrg = new Map(eligible.map((c) => [c.organizationId, c]));

        let requested: ResolvedClub[];
        if (input.clubs === 'all') {
          requested = eligible;
        } else {
          const missing = input.clubs.filter((slug) => !eligibleBySlug.has(slug));
          if (missing.length) {
            return refuse('validation',
              `Not administrable for ${input.season}: ${missing.join(', ')}. `
              + 'Copy forward was refused rather than silently skipping them.',
              [...missing]);
          }
          requested = input.clubs.map((slug) => eligibleBySlug.get(slug)!);
        }
        const requestedOrgs = new Set(requested.map((c) => c.organizationId));

        // The source rows, with the target identity of the same organisation.
        const sourceRows = await tx<{
          playerId: number; displayName: string; fromClubSlug: string; fromClubName: string;
          organizationId: number;
        }[]>`
          SELECT m.player_id AS "playerId", p.display_name AS "displayName",
                 c.slug AS "fromClubSlug", c.name AS "fromClubName",
                 c.organization_id AS "organizationId"
            FROM season_list_members m
            JOIN clubs c ON c.id = m.club_id
            JOIN players p ON p.id = m.player_id
           WHERE m.season = ${fromSeason}::smallint
           ORDER BY c.name, p.display_name
        `;
        if (sourceRows.length === 0) {
          return refuse('not_found',
            `There is no ${fromSeason} list to copy forward.`);
        }

        // §9.3: a club present in S-1 with no eligible identity in S has LEFT the
        // competition. Naming it is the point — silently dropping its players is
        // exactly the failure this refusal exists to prevent.
        // Only when copying EVERY club: a narrowed request simply does not copy
        // the clubs it did not ask for, which is not a departure.
        const departed = input.clubs === 'all'
          ? [...new Map(sourceRows
              .filter((r) => !eligibleByOrg.has(r.organizationId))
              .map((r) => [r.fromClubSlug, r.fromClubName] as const)).values()]
          : [];
        if (departed.length) {
          return refuse('conflict',
            `No ${input.season} identity exists for: ${departed.join(', ')}. `
            + 'Their players are not copied anywhere; add them to another club or leave them unlisted.',
            departed);
        }

        const plannedRows = sourceRows
          .map((row) => ({ row, target: eligibleByOrg.get(row.organizationId) }))
          .filter((entry): entry is { row: typeof sourceRows[number]; target: ResolvedClub } =>
            entry.target !== undefined && requestedOrgs.has(entry.target.organizationId));
        if (plannedRows.length === 0) {
          return refuse('not_found',
            `There is nothing in the ${fromSeason} list to copy to the requested ${input.season} clubs.`);
        }

        // Collision: any target club that already holds rows in S.
        const targetIds = [...new Set(plannedRows.map((e) => e.target.id))];
        const populated = await tx<{ slug: string; name: string }[]>`
          SELECT DISTINCT c.slug, c.name
            FROM season_list_members m
            JOIN clubs c ON c.id = m.club_id
           WHERE m.season = ${input.season}::smallint
             AND m.club_id = ANY(${targetIds}::int[])
           ORDER BY c.name
        `;
        if (populated.length) {
          return refuse('conflict',
            `Already holding ${input.season} list rows: ${populated.map((c) => c.name).join(', ')}. `
            + 'Copy forward was refused before writing anything; narrow the request to the clubs '
            + 'still at zero.',
            populated.map((c) => c.slug));
        }

        // I-1 across the whole request: a source player who already holds a place
        // in S at a club OUTSIDE the request would otherwise fail on the UNIQUE
        // halfway through. Named, before any write.
        const playerIds = plannedRows.map((e) => e.row.playerId);
        const alreadyListed = await tx<{ displayName: string }[]>`
          SELECT p.display_name AS "displayName"
            FROM season_list_members m
            JOIN players p ON p.id = m.player_id
           WHERE m.season = ${input.season}::smallint
             AND m.player_id = ANY(${playerIds}::int[])
           ORDER BY p.display_name
        `;
        if (alreadyListed.length) {
          const names = alreadyListed.map((p) => p.displayName);
          return refuse('duplicate',
            `Already hold a ${input.season} list place: ${names.join(', ')}.`, names);
        }
        const duplicateInSource = playerIds.length !== new Set(playerIds).size;
        if (duplicateInSource) {
          return refuse('conflict',
            `The ${fromSeason} list holds a player at more than one club, which cannot be copied `
            + 'into a season where a player holds one list place. Correct the source season first.');
        }

        const clubPlans = [...plannedRows.reduce((acc, entry) => {
          const key = entry.target.slug;
          const plan = acc.get(key) ?? {
            clubSlug: entry.target.slug, clubName: entry.target.name,
            fromClubSlug: entry.row.fromClubSlug, players: 0,
          };
          plan.players += 1;
          acc.set(key, plan);
          return acc;
        }, new Map<string, CopyForwardClubPlan>()).values()];

        if (input.dryRun) {
          // The identical code path, stopped before the first write. Nothing has
          // been written, so nothing has to be rolled back.
          return {
            ok: true as const,
            batchId, dryRun: true, fromSeason, clubs: clubPlans, copied: 0,
          };
        }

        const sourceId = await manualSourceId(tx);
        for (const entry of plannedRows) {
          const subject = await resolvePlayerSubject(tx, entry.row.playerId);
          if (!subject.ok) {
            // Past the first write on the second and later rows, so this must
            // throw: a returned refusal would commit the rows already written.
            throw new RollbackRefusal(subject.reason, subject.error, [entry.row.displayName]);
          }
          await insertMembership(tx, {
            season: input.season,
            club: entry.target,
            player: subject.player,
            origin: 'copied_list',
            sourceId,
            adminUserId: input.adminUserId,
            copiedFromSeason: fromSeason,
            note: input.note,
            auditExtra: { batch_id: batchId },
          });
        }

        return {
          ok: true as const,
          batchId, dryRun: false, fromSeason, clubs: clubPlans, copied: plannedRows.length,
        };
      }) as SeasonListMutationResult<CopySeasonListsForwardResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- reads (§20, §25) ----------------------------------------------------

export type SeasonListMemberRow = {
  membershipId: number;
  season: number;
  clubSlug: string;
  clubName: string;
  playerId: number;
  playerSlug: string;
  displayName: string;
  origin: SeasonListOrigin;
  copiedFromSeason: number | null;
  note: string | null;
  updatedAt: string;
  /** Games for THIS club in THIS season, or null when the season has no matches at all. */
  gamesInSeason: number | null;
  /** A draft selection by this club for season-1 or season, when one exists. */
  draftPickId: number | null;
  /** True when the player holds a `manual_admin_edit` identity and no AFL Tables one. */
  awaitingIdentity: boolean;
  /**
   * AFLDB-ISSUE-163 §9. The ACTIVE leadership role this member holds at this
   * club for this season, or null. Read-only and additive: it changes no
   * membership invariant, and it is what lets the member table badge a captain
   * and the Remove/Transfer confirm warn that an appointment exists.
   *
   * It WARNS, it never blocks — AFLDB-ISSUE-161's removal and transfer
   * contracts are untouched, and an appointment survives the membership going
   * away because an appointment is historical validity, not current
   * eligibility.
   */
  activeLeadershipRole: 'captain' | 'vice_captain' | null;
};

/**
 * One club's list for one season — ONE query (§25). Every badge the page shows
 * is a column here rather than a per-row lookup.
 *
 * `gamesInSeason` is NULL, not 0, when the season holds no matches at all:
 * "no matches recorded for this season" and "listed but has not played" are
 * different statements and the page must be able to tell them apart (§9.4).
 */
export async function readClubSeasonList(
  season: number, clubSlug: string,
): Promise<SeasonListMemberRow[]> {
  return sql<SeasonListMemberRow[]>`
    SELECT m.id::int AS "membershipId", m.season::int AS season,
           c.slug AS "clubSlug", c.name AS "clubName",
           p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
           m.origin, m.copied_from_season::int AS "copiedFromSeason", m.note,
           m.updated_at::text AS "updatedAt",
           CASE WHEN EXISTS (SELECT 1 FROM matches mt WHERE mt.season = m.season)
                THEN COALESCE(pcs.games, 0) ELSE NULL END AS "gamesInSeason",
           dp.id AS "draftPickId",
           (NOT EXISTS (SELECT 1 FROM external_identities e
                          JOIN sources s ON s.id = e.source_id
                         WHERE e.player_id = p.id AND s.key = 'afltables'
                           AND e.match_method = 'afltables_profile_url'
                           AND e.status IN ('unique', 'resolved')))
             AS "awaitingIdentity",
           (SELECT l.role FROM club_leadership l
             WHERE l.season = m.season AND l.club_id = m.club_id AND l.player_id = m.player_id
               AND l.status = 'active'
             ORDER BY l.role LIMIT 1) AS "activeLeadershipRole"
      FROM season_list_members m
      JOIN clubs c ON c.id = m.club_id
      JOIN players p ON p.id = m.player_id
      LEFT JOIN player_club_season_stats pcs
             ON pcs.player_id = m.player_id AND pcs.season = m.season AND pcs.club_id = m.club_id
      LEFT JOIN LATERAL (
             SELECT d.id FROM draft_picks d
              WHERE d.player_id = m.player_id AND d.club_id = m.club_id
                AND d.draft_year IN (m.season - 1, m.season)
              ORDER BY d.id LIMIT 1
           ) dp ON true
     WHERE m.season = ${season}::smallint AND c.slug = ${clubSlug}
     ORDER BY p.display_name
  `;
}

export type SeasonListClubSummary = {
  clubSlug: string;
  clubName: string;
  organizationId: number;
  members: number;
  previousMembers: number;
};

/**
 * The season overview: every eligible club, its member count, and the count it
 * held in the previous season (0 when there was no list then). "No list yet" is
 * `members = 0`, which is a real and expected state, not an error.
 */
export async function readSeasonListOverview(season: number): Promise<SeasonListClubSummary[]> {
  return sql<SeasonListClubSummary[]>`
    SELECT e.slug AS "clubSlug", e.name AS "clubName", e.organization_id AS "organizationId",
           (SELECT count(*)::int FROM season_list_members m
             WHERE m.season = ${season}::smallint AND m.club_id = e.id) AS members,
           (SELECT count(*)::int FROM season_list_members m
              JOIN clubs pc ON pc.id = m.club_id
             WHERE m.season = ${season - 1}::smallint
               AND pc.organization_id = e.organization_id) AS "previousMembers"
      FROM afldb_season_list_clubs(${season}::smallint) e
     ORDER BY e.name
  `;
}

export type SeasonListChangeSummary = {
  clubSlug: string;
  clubName: string;
  added: number;
  departed: number;
};

/**
 * STAGE 2 ADDITION (§11, §15.1, §20). "changes vs S-1 (+added / -departed,
 * computed by organisation)" is explicit runbook text for the season
 * overview's club cards, not an optional nicety -- Stage 1 delivered no read
 * for it. Read-only, additive; changes no Stage 1 invariant.
 *
 * Computed PER CLUB: a player counts as "added" to a club when they are on
 * that club's S list but were not, anywhere in the SAME organisation, on
 * S-1's roster (or, for `FIRST_LIST_SEASON`, did not appear there in S-1);
 * "departed" is the mirror -- on the organisation's S-1 roster (list or
 * appearances) but not on THIS club's S list, whether they moved to another
 * club or left the game entirely. The S-1 side is organisation-scoped so a
 * rename between S-1 and S never miscounts a continuing player as both.
 */
export async function readSeasonListChanges(season: number): Promise<SeasonListChangeSummary[]> {
  if (season === FIRST_LIST_SEASON) {
    return sql<SeasonListChangeSummary[]>`
      SELECT e.slug AS "clubSlug", e.name AS "clubName",
             (SELECT count(*)::int FROM season_list_members m
               WHERE m.season = ${season}::smallint AND m.club_id = e.id
                 AND NOT EXISTS (
                   SELECT 1 FROM player_club_season_stats pcs JOIN clubs pc ON pc.id = pcs.club_id
                    WHERE pcs.season = ${season - 1}::smallint AND pc.organization_id = e.organization_id
                      AND pcs.player_id = m.player_id
                 )) AS added,
             (SELECT count(*)::int FROM player_club_season_stats pcs
                JOIN clubs pc ON pc.id = pcs.club_id
               WHERE pcs.season = ${season - 1}::smallint AND pc.organization_id = e.organization_id
                 AND NOT EXISTS (
                   SELECT 1 FROM season_list_members m
                    WHERE m.season = ${season}::smallint AND m.club_id = e.id AND m.player_id = pcs.player_id
                 )) AS departed
        FROM afldb_season_list_clubs(${season}::smallint) e
       ORDER BY e.name
    `;
  }
  return sql<SeasonListChangeSummary[]>`
    SELECT e.slug AS "clubSlug", e.name AS "clubName",
           (SELECT count(*)::int FROM season_list_members m
             WHERE m.season = ${season}::smallint AND m.club_id = e.id
               AND NOT EXISTS (
                 SELECT 1 FROM season_list_members m2 JOIN clubs c2 ON c2.id = m2.club_id
                  WHERE m2.season = ${season - 1}::smallint AND c2.organization_id = e.organization_id
                    AND m2.player_id = m.player_id
               )) AS added,
           (SELECT count(*)::int FROM season_list_members m2
              JOIN clubs c2 ON c2.id = m2.club_id
             WHERE m2.season = ${season - 1}::smallint AND c2.organization_id = e.organization_id
               AND NOT EXISTS (
                 SELECT 1 FROM season_list_members m
                  WHERE m.season = ${season}::smallint AND m.club_id = e.id AND m.player_id = m2.player_id
               )) AS departed
      FROM afldb_season_list_clubs(${season}::smallint) e
     ORDER BY e.name
  `;
}

export type SeasonListChangeCandidate = {
  playerId: number;
  playerSlug: string;
  displayName: string;
};

/**
 * STAGE 2 ADDITION (§15.1's "departed since S-1" diagnostic row; §13's
 * "the season page's 'departed since S-1' panel" reference). Only meaningful
 * for a season with an earlier AUTHORITATIVE list to compare against
 * (season > FIRST_LIST_SEASON) -- for FIRST_LIST_SEASON (2027) this exact
 * set is already what `readAppearanceReviewCandidates()` shows, clearly
 * labelled non-authoritative, so this function is not called for it (the
 * caller decides; no season guard here mirrors the caller-decides shape of
 * the appearances projection).
 */
export async function readDepartedSincePreviousList(
  season: number, clubSlug: string,
): Promise<SeasonListChangeCandidate[]> {
  return sql<SeasonListChangeCandidate[]>`
    SELECT DISTINCT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName"
      FROM season_list_members m2
      JOIN players p ON p.id = m2.player_id
      JOIN clubs c2 ON c2.id = m2.club_id
      JOIN clubs target ON target.slug = ${clubSlug}
     WHERE m2.season = ${season - 1}::smallint
       AND c2.organization_id = target.organization_id
       AND NOT EXISTS (SELECT 1 FROM season_list_members m
                        WHERE m.season = ${season}::smallint AND m.club_id = target.id AND m.player_id = p.id)
     ORDER BY p.display_name
  `;
}

export type AppearanceReviewCandidate = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  games: number;
  goals: number;
  fromClubSlug: string;
  fromClubName: string;
  candidateSource: string;
};

/**
 * NOT A LIST. A read-only projection of who PLAYED for this organisation in the
 * previous season and is not already listed in this one (§23, D-2).
 *
 * It exists so the first authoritative list season can be built by review
 * instead of from nothing. It writes nothing, it is never a source of
 * membership, and "played in 2026" implies nothing whatever about who is on a
 * 2027 list — a retiring premiership player and a delisted rookie both appear
 * here. The only way a row of this becomes a membership is a Super Admin
 * choosing that player, which produces an ordinary `origin = 'added'` row
 * carrying `candidate_source` as evidence of where they were looking.
 */
export async function readAppearanceReviewCandidates(
  season: number, clubSlug: string,
): Promise<AppearanceReviewCandidate[]> {
  const fromSeason = season - 1;
  return sql<AppearanceReviewCandidate[]>`
    SELECT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
           pcs.games, pcs.goals,
           pc.slug AS "fromClubSlug", pc.name AS "fromClubName",
           ${`appearances:${fromSeason}`} AS "candidateSource"
      FROM player_club_season_stats pcs
      JOIN players p ON p.id = pcs.player_id
      JOIN clubs pc ON pc.id = pcs.club_id
      JOIN clubs target ON target.slug = ${clubSlug}
     WHERE pcs.season = ${fromSeason}::smallint
       AND pc.organization_id = target.organization_id
       AND NOT EXISTS (SELECT 1 FROM season_list_members m
                        WHERE m.season = ${season}::smallint AND m.player_id = p.id)
     ORDER BY pcs.games DESC, p.display_name
  `;
}

export type SeasonListDiagnostic = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  games: number;
};

/**
 * §15.1: players who PLAYED for this club in this season and are not on its
 * list — a definite list error once the season's lists are complete, and
 * meaningless before the season has been played. Empty for a season with no
 * matches, which is the correct answer rather than a warning.
 */
export async function readPlayedNotListed(
  season: number, clubSlug: string,
): Promise<SeasonListDiagnostic[]> {
  return sql<SeasonListDiagnostic[]>`
    SELECT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName", pcs.games
      FROM player_club_season_stats pcs
      JOIN players p ON p.id = pcs.player_id
      JOIN clubs c ON c.id = pcs.club_id
     WHERE pcs.season = ${season}::smallint AND c.slug = ${clubSlug}
       AND NOT EXISTS (SELECT 1 FROM season_list_members m
                        WHERE m.season = pcs.season AND m.player_id = pcs.player_id)
     ORDER BY pcs.games DESC, p.display_name
  `;
}

export type DraftSuggestionCandidate = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  draftPickId: number;
  draftYear: number;
  draftKind: string | null;
  pickNumber: number | null;
};

/**
 * STAGE 2 ADDITION (§14, §20 club-page "Draftees" panel). Stage 1 delivered
 * no read for this — `readClubSeasonList()`'s `draftPickId` column answers a
 * different question ("does this ALREADY-LISTED player's own club draft
 * pick exist") — so this is new, read-only, and additive: it changes no
 * Stage 1 invariant and writes nothing.
 *
 * `draft_picks` rows for THIS club with `draft_year IN (S-1, S)`,
 * `player_id IS NOT NULL`, not yet on the S list — exactly §14's rule. Like
 * the appearances review panel, this is a suggestion, never a source of
 * membership: adding from it is the same explicit `addSeasonListMember`
 * decision as anywhere else, carrying `candidate_source = 'draft:<pick id>'`
 * as evidence of where the admin was looking.
 */
export async function readDraftSuggestions(
  season: number, clubSlug: string,
): Promise<DraftSuggestionCandidate[]> {
  return sql<DraftSuggestionCandidate[]>`
    SELECT p.id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
           d.id AS "draftPickId", d.draft_year::int AS "draftYear", d.draft_kind AS "draftKind",
           d.pick_number AS "pickNumber"
      FROM draft_picks d
      JOIN players p ON p.id = d.player_id
      JOIN clubs c ON c.id = d.club_id
     WHERE c.slug = ${clubSlug}
       AND d.player_id IS NOT NULL
       AND d.draft_year IN (${season - 1}, ${season})
       AND NOT EXISTS (SELECT 1 FROM season_list_members m
                        WHERE m.season = ${season}::smallint AND m.player_id = d.player_id)
     ORDER BY d.draft_year DESC, d.pick_number NULLS LAST, p.display_name
  `;
}

// --- durable-record reads (import role only, D-2) ------------------------

export type SeasonListOverrideRow = {
  entityKey: string;
  fieldGroup: string;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: Date;
};

/** Every override row — active or tombstoned — for one membership key. */
export async function readSeasonListOverrides(entityKey: string): Promise<SeasonListOverrideRow[]> {
  return withImportConnection((importSql) => importSql<SeasonListOverrideRow[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup",
           override_values AS "overrideValues", is_active AS "isActive", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = ${SEASON_LIST_ENTITY_TYPE} AND entity_key = ${entityKey}
     ORDER BY field_group
  `);
}

/** Every membership key carrying an ACTIVE durable record. */
export async function readActiveSeasonListOverrideKeys(): Promise<Set<string>> {
  const rows = await withImportConnection((importSql) => importSql<{ entityKey: string }[]>`
    SELECT DISTINCT entity_key AS "entityKey" FROM data_overrides
     WHERE entity_type = ${SEASON_LIST_ENTITY_TYPE} AND is_active
  `);
  return new Set(rows.map((r) => r.entityKey));
}

// --- derivations (§8) ----------------------------------------------------

/**
 * The latest season anyone is listed for — data-derived, never a clock and
 * never a configuration value. NULL until the first membership exists.
 *
 * Every "current player / current club / retired" question in §8 is answered
 * against this season and nothing else. A consumer must treat "no membership"
 * as UNKNOWN rather than "retired" until every eligible club in that season has
 * a list, which `readSeasonListOverview()` is what shows.
 */
export async function currentListSeason(): Promise<number | null> {
  const [row] = await sql<{ season: number | null }[]>`
    SELECT max(season)::int AS season FROM season_list_members
  `;
  return row?.season ?? null;
}

/** The administrable season range, for the season selector. */
export async function administrableListSeasons(): Promise<ListSeasonBounds> {
  return readListSeasonBounds(sql);
}
