import 'server-only';

import { join } from 'node:path';

import postgres from 'postgres';
import { recordDataEdit } from '@/db/queries/audit-log';
import { recomputePlayerDerivedStats } from '@/db/queries/player-derived';
import {
  PLAYER_MATCH_STATS_ENTITY,
  buildMatchSheetAuthorityWrites,
  continuityPartnersOf,
  decodePlayerMatchStatsKey,
  interpretKeyAuthority,
  loadContinuityRulesFailClosed,
  matchSheetRetryableRefusal,
  matchSheetStaleToken,
  planMatchSheetChanges,
  planReturnToSource,
  summariseActiveMatchAuthority,
  type AuthorityRecordRow,
  type MatchAuthoritySummary,
  type MatchSheetStatRow,
} from '@/lib/acquisition/match-sheet-authority';
import {
  loadPlayerIdentityRows,
  playerMatchStatsAuthorityStorable,
} from '@/lib/acquisition/manual-authority';
import {
  validateMatchSheetPayload,
  type PlayerMatchStatInput,
} from '@/lib/match-sheet';

export type { PlayerMatchStatInput } from '@/lib/match-sheet';

export type SaveMatchSheetInput = {
  matchId: number;
  syncMatchScores: boolean;
  players: PlayerMatchStatInput[];
  removedPlayerIds?: number[];
  adminUserId: number;
  note?: string;
  /**
   * The stale-sheet token the editor was rendered with
   * (`loadMatchSheetStaleToken`). A save whose token no longer matches the locked
   * rows is refused whole: a source settle's change must never be turned into manual
   * authority or a durable removal.
   */
  staleToken: string;
};

export type SaveMatchSheetResult =
  | { ok: true; playerCount: number; scoreUpdated: boolean }
  | { ok: false; error: string };

/** A deliberate, user-facing refusal (never a defect): reported without a prefix. */
class MatchSheetRefusal extends Error {}

export const STALE_SHEET_REFUSAL =
  'This match sheet has changed since it was loaded (for example by a source update). '
  + 'Nothing was saved. Reload the sheet and re-apply your edits.';

/**
 * The contract the continuity rules are read from, relative to the process cwd (F-PR-02).
 * Also read by the legacy CSV intake's authority check (AFLDB-ISSUE-264).
 */
export const CONTINUITY_CONTRACT_SEGMENTS = ['tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json'] as const;

/**
 * Reads the match's Match Sheet rows and returns their stale-sheet token. UNLOCKED:
 * for the editor page (render the token as a hidden field) and for tests. The
 * column list matches the locked read inside `saveMatchSheet` exactly (int8 and
 * smallint are cast to int so nothing arrives as a string).
 */
export async function loadMatchSheetStaleToken(
  db: postgres.Sql | postgres.TransactionSql, matchId: number,
): Promise<string> {
  const rows = await db<MatchSheetStatRow[]>`
    SELECT player_id::int AS "playerId", club_id::int AS "clubId", jumper_number AS "jumperNumber",
           goals::int AS goals, behinds::int AS behinds, kicks::int AS kicks,
           handballs::int AS handballs, disposals::int AS disposals, marks::int AS marks,
           tackles::int AS tackles, hitouts::int AS hitouts,
           frees_for::int AS "freesFor", frees_against::int AS "freesAgainst"
      FROM player_match_stats
     WHERE match_id = ${matchId}
     ORDER BY player_id
  `;
  return matchSheetStaleToken(rows);
}

function auditJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Save complete match sheet (lineup and statistics) for a game (see changeLog.md).
 *
 * AFLDB-ISSUE-257 Slice 3: ONE transaction that (1) locks the match and every
 * `player_match_stats` row of it, (2) refuses a stale sheet before any write,
 * (3) writes only the changed/added/removed rows, (4) records each change as
 * durable `data_overrides` authority under the player's stable identity key, then
 * (5) recomputes derived stats and (6) writes the audit. Every refusal is THROWN, so
 * the canonical change and its authority commit or roll back together; nothing in
 * the transaction catches. Team scores remain a separate fact because rushed
 * behinds are not attributable to player rows.
 */
export async function saveMatchSheet(input: SaveMatchSheetInput): Promise<SaveMatchSheetResult> {
  const payload = validateMatchSheetPayload({
    players: input.players,
    removedPlayerIds: input.removedPlayerIds ?? [],
  });
  if (!payload.ok) return { ok: false, error: payload.error };

  if (typeof input.staleToken !== 'string' || input.staleToken.trim() === '') {
    return {
      ok: false,
      error: 'The match sheet is missing its freshness token. Nothing was saved. Reload the sheet and try again.',
    };
  }

  if (input.syncMatchScores) {
    return {
      ok: false,
      error: 'Team scores cannot be synchronized from player statistics because rushed behinds are not attributed to players. Edit the team score in Match Details.',
    };
  }

  const { players, removedPlayerIds } = payload.value;
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) {
    return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };
  }

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const result = await importSql.begin(async (tx) => {
      // A settle holds these locks while it runs; do not queue behind it forever.
      await tx`SET LOCAL lock_timeout = '5s'`;

      // 1. Lock the match and read its key.
      const [match] = await tx<{
        id: number;
        season: number;
        matchKey: string;
        homeClubId: number;
        awayClubId: number;
      }[]>`
        SELECT id, season, match_key AS "matchKey", home_club_id AS "homeClubId",
               away_club_id AS "awayClubId"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;

      if (!match) {
        throw new MatchSheetRefusal(`Match with ID #${input.matchId} does not exist.`);
      }

      for (const player of players) {
        if (player.clubId !== match.homeClubId && player.clubId !== match.awayClubId) {
          throw new MatchSheetRefusal(
            `Player #${player.playerId} must be assigned to one of the two clubs in this match.`,
          );
        }
      }

      // 2. Lock every row of the match and refuse a stale sheet before any write.
      // (AFLDB-ISSUE-155 §27.15: brownlow_votes is neither read nor written here.)
      const locked = await tx<MatchSheetStatRow[]>`
        SELECT player_id::int AS "playerId", club_id::int AS "clubId", jumper_number AS "jumperNumber",
               goals::int AS goals, behinds::int AS behinds, kicks::int AS kicks,
               handballs::int AS handballs, disposals::int AS disposals, marks::int AS marks,
               tackles::int AS tackles, hitouts::int AS hitouts,
               frees_for::int AS "freesFor", frees_against::int AS "freesAgainst"
          FROM player_match_stats
         WHERE match_id = ${input.matchId}
         ORDER BY player_id
           FOR UPDATE
      `;
      if (matchSheetStaleToken(locked) !== input.staleToken.trim()) {
        throw new MatchSheetRefusal(STALE_SHEET_REFUSAL);
      }

      // 3. Per-player plan against the locked pre-image.
      const clubs = await tx<{ id: number; slug: string }[]>`
        SELECT id::int AS id, slug FROM clubs
      `;
      const plan = planMatchSheetChanges({
        locked,
        players,
        removedPlayerIds,
        clubSlugById: new Map(clubs.map((c) => [Number(c.id), c.slug])),
      });
      if (!plan.ok) throw new MatchSheetRefusal(plan.error);

      // 4. Authority plan. Probe first: under State A nothing may be attempted.
      let storable = true;
      let identities = new Map<number, { afltablesPaths: string[]; manualTokens: string[] }>();
      let records: AuthorityRecordRow[] = [];
      if (plan.items.length > 0) {
        storable = await playerMatchStatsAuthorityStorable(tx);
        if (storable) {
          identities = await loadPlayerIdentityRows(tx, plan.items.map((item) => item.playerId));
          const stored = await tx<{
            entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: string | null;
          }[]>`
            SELECT entity_key AS "entityKey", field_group AS "fieldGroup",
                   is_active AS "isActive", override_values::text AS "overrideValues"
              FROM data_overrides
             WHERE entity_type = ${PLAYER_MATCH_STATS_ENTITY}
               AND starts_with(entity_key, ${match.matchKey}::text || '|')
               AND strpos(substr(entity_key, length(${match.matchKey}::text) + 2), '|') = 0
          `;
          records = stored.map((row) => {
            let parsed: unknown = null;
            try {
              parsed = row.overrideValues === null ? null : JSON.parse(row.overrideValues);
            } catch {
              parsed = null;
            }
            return {
              entityKey: row.entityKey,
              fieldGroup: row.fieldGroup,
              isActive: row.isActive === true,
              overrideValues: parsed,
            };
          });
        }
      }
      const authority = buildMatchSheetAuthorityWrites({
        matchKey: match.matchKey,
        items: plan.items,
        storable,
        continuity: loadContinuityRulesFailClosed(join(process.cwd(), ...CONTINUITY_CONTRACT_SEGMENTS)),
        identities,
        records,
      });
      if (!authority.ok) throw new MatchSheetRefusal(authority.error);

      // 5. Canonical writes: removals, then only changed/added rows. Ownership
      // (source_id) of an existing row is never touched.
      const removed = plan.items.filter((item) => item.kind === 'remove').map((item) => item.playerId);
      if (removed.length > 0) {
        await tx`
          DELETE FROM player_match_stats
           WHERE match_id = ${input.matchId}
             AND player_id = ANY(${removed})
        `;
      }

      for (const item of plan.items) {
        if (item.kind === 'remove') continue;
        const p = item.row;
        await tx`
          INSERT INTO player_match_stats (
            player_id, match_id, club_id, jumper_number,
            goals, behinds, kicks, handballs, disposals,
            marks, tackles, hitouts, frees_for, frees_against
          ) VALUES (
            ${p.playerId}, ${input.matchId}, ${p.clubId}, ${p.jumperNumber},
            ${p.goals}, ${p.behinds}, ${p.kicks}, ${p.handballs}, ${p.disposals},
            ${p.marks}, ${p.tackles}, ${p.hitouts}, ${p.freesFor}, ${p.freesAgainst}
          )
          ON CONFLICT (player_id, match_id) DO UPDATE SET
            club_id = EXCLUDED.club_id,
            jumper_number = EXCLUDED.jumper_number,
            goals = EXCLUDED.goals,
            behinds = EXCLUDED.behinds,
            kicks = EXCLUDED.kicks,
            handballs = EXCLUDED.handballs,
            disposals = EXCLUDED.disposals,
            marks = EXCLUDED.marks,
            tackles = EXCLUDED.tackles,
            hitouts = EXCLUDED.hitouts,
            frees_for = EXCLUDED.frees_for,
            frees_against = EXCLUDED.frees_against
        `;
      }

      // 6. Authority writes (same transaction; a failure rolls the rows back).
      for (const op of authority.ops) {
        if (op.kind === 'upsert') {
          await tx`
            INSERT INTO data_overrides
                  (entity_type, entity_key, field_group, override_values, admin_user_id,
                   is_active, updated_at)
            VALUES (${PLAYER_MATCH_STATS_ENTITY}, ${op.entityKey}, ${op.fieldGroup},
                    ${tx.json(op.payload as unknown as postgres.JSONValue)},
                    ${input.adminUserId}, true, now())
            ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
               SET override_values = EXCLUDED.override_values,
                   is_active = true,
                   admin_user_id = EXCLUDED.admin_user_id,
                   updated_at = now()
          `;
        } else {
          await tx`
            UPDATE data_overrides
               SET is_active = false,
                   admin_user_id = ${input.adminUserId},
                   updated_at = now()
             WHERE entity_type = ${PLAYER_MATCH_STATS_ENTITY}
               AND entity_key = ${op.entityKey}
               AND field_group = ${op.fieldGroup}
          `;
        }
      }

      const affectedIds = Array.from(new Set([
        ...locked.map((row) => Number(row.playerId)),
        ...players.map((player) => player.playerId),
        ...removedPlayerIds,
      ])).filter((id) => Number.isInteger(id) && id > 0);

      await recomputePlayerDerivedStats(tx, affectedIds, match.season);

      // 7. Required audit, same transaction (AFLDB-ISSUE-027). Shape is fixed:
      // tableName 'matches', fieldGroup 'match_sheet' (ISSUE-238 L8-d depends on it).
      const oldPlayers: Record<string, unknown> = {};
      const newPlayers: Record<string, unknown> = {};
      for (const item of plan.items) {
        if (item.kind === 'remove') {
          oldPlayers[item.playerId] = item.pre;
          newPlayers[item.playerId] = { kind: 'remove' };
        } else if (item.kind === 'add') {
          oldPlayers[item.playerId] = null;
          newPlayers[item.playerId] = { kind: 'add', values: item.delta };
        } else {
          const before: Record<string, unknown> = {};
          for (const field of Object.keys(item.delta)) {
            before[field] = (item.pre as Record<string, unknown>)[field];
          }
          oldPlayers[item.playerId] = before;
          newPlayers[item.playerId] = { kind: 'update', values: item.delta };
        }
      }
      await recordDataEdit(tx, {
        tableName: 'matches',
        rowId: input.matchId,
        fieldGroup: 'match_sheet',
        oldValues: auditJson({ players: oldPlayers }),
        newValues: auditJson({
          playersCount: players.length,
          scoreUpdated: input.syncMatchScores,
          players: newPlayers,
          authorityKeys: authority.keys,
        }),
        adminUserId: input.adminUserId,
        note: input.note,
      });

      return { playerCount: players.length, scoreUpdated: false };
    });

    return {
      ok: true,
      playerCount: result.playerCount,
      scoreUpdated: result.scoreUpdated,
    };
  } catch (err) {
    if (err instanceof MatchSheetRefusal) return { ok: false, error: err.message };
    // 55P03 lock timeout or 40P01 deadlock victim: the whole transaction rolled
    // back; classification only, never a retry or a partial save (F-S4-01/F-S4-02).
    const retryable = matchSheetRetryableRefusal(err);
    if (retryable) return { ok: false, error: retryable };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to save match sheet: ${msg}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-257 Slice 7 — durable authority: deletion guard, summary, return to source
 * ------------------------------------------------------------------ */

type Db = postgres.Sql | postgres.TransactionSql;

type StoredAuthorityRow = AuthorityRecordRow & { id: number };

/**
 * Reads EVERY `data_overrides` record (active and inactive) under the match's key
 * prefix (the §18.3 predicate, never LIKE), reverse-resolves their identities and
 * summarises the ACTIVE authority. Parameterised; no locks. Under the pre-migration
 * CHECK (State A) no such record can exist, so the answer is empty.
 */
async function loadMatchAuthority(
  db: Db, matchKey: string,
): Promise<{ rows: StoredAuthorityRow[]; summary: MatchAuthoritySummary }> {
  const stored = await db<{
    id: number; entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: string | null;
  }[]>`
    SELECT id::int AS id, entity_key AS "entityKey", field_group AS "fieldGroup",
           is_active AS "isActive", override_values::text AS "overrideValues"
      FROM data_overrides
     WHERE entity_type = ${PLAYER_MATCH_STATS_ENTITY}
       AND starts_with(entity_key, ${matchKey}::text || '|')
       AND strpos(substr(entity_key, length(${matchKey}::text) + 2), '|') = 0
     ORDER BY entity_key, field_group
  `;
  const rows: StoredAuthorityRow[] = stored.map((row) => {
    let parsed: unknown = null;
    try {
      parsed = row.overrideValues === null ? null : JSON.parse(row.overrideValues);
    } catch {
      parsed = null;
    }
    return {
      id: Number(row.id),
      entityKey: row.entityKey,
      fieldGroup: row.fieldGroup,
      isActive: row.isActive === true,
      overrideValues: parsed,
    };
  });
  if (rows.length === 0) return { rows, summary: { entries: [], indeterminate: [] } };

  const continuity = loadContinuityRulesFailClosed(join(process.cwd(), ...CONTINUITY_CONTRACT_SEGMENTS));
  const externalIds = new Set<string>();
  for (const row of rows) {
    const decoded = decodePlayerMatchStatsKey(row.entityKey);
    if (decoded === null) continue;
    externalIds.add(decoded.externalId);
    if (decoded.sourceKey === 'afltables' && continuity.ok) {
      for (const partner of continuityPartnersOf(decoded.externalId, continuity.rules)) {
        externalIds.add(partner);
      }
    }
  }
  const identities = await db<{
    sourceKey: string; externalId: string; matchMethod: string | null; playerId: number;
  }[]>`
    SELECT s.key AS "sourceKey", e.external_id AS "externalId",
           e.match_method AS "matchMethod", e.player_id::int AS "playerId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key IN ('afltables', 'manual_admin_edit')
       AND e.external_id = ANY(${[...externalIds]}::text[])
       AND e.status IN ('unique', 'resolved')
       AND e.player_id IS NOT NULL
  `;
  const playerIdsByIdentity = new Map<string, number[]>();
  for (const row of identities) {
    if (row.sourceKey === 'afltables' && row.matchMethod !== 'afltables_profile_url') continue;
    const identity = `${row.sourceKey}:${row.externalId}`;
    const players = playerIdsByIdentity.get(identity) ?? [];
    if (!players.includes(Number(row.playerId))) players.push(Number(row.playerId));
    playerIdsByIdentity.set(identity, players);
  }
  return {
    rows,
    summary: summariseActiveMatchAuthority({ matchKey, records: rows, playerIdsByIdentity, continuity }),
  };
}

async function loadPlayerNames(db: Db, playerIds: readonly number[]): Promise<Map<number, string>> {
  if (playerIds.length === 0) return new Map();
  const players = await db<{ id: number; name: string }[]>`
    SELECT id::int AS id, display_name AS name FROM players WHERE id = ANY(${[...playerIds]}::int[])
  `;
  return new Map(players.map((p) => [Number(p.id), p.name]));
}

/**
 * D-257-5: `deleteMatch` must refuse while ANY active Match Sheet authority exists under
 * the match's key (fail closed: an active record that does not decode or resolve still
 * blocks). Returns the refusal text, or `null` when nothing active exists. Runs inside
 * the caller's transaction; never deactivates, deletes or discards anything.
 */
export async function matchDeletionAuthorityRefusal(
  tx: Db, matchId: number, matchKey: string,
): Promise<string | null> {
  const { summary } = await loadMatchAuthority(tx, matchKey);
  const count = summary.entries.length + summary.indeterminate.length;
  if (count === 0) return null;
  const names = await loadPlayerNames(tx, summary.entries.map((e) => e.playerId));
  const named = [
    ...summary.entries.map((e) => names.get(e.playerId) ?? `player #${e.playerId}`),
    ...summary.indeterminate.map((i) => i.entityKey),
  ].join(', ');
  return `Match #${matchId} carries durable Match Sheet authority for ${count} player row${count === 1 ? '' : 's'} `
    + `(${named}) and cannot be deleted. Relinquish it first with "Return to source" in the `
    + `Match Sheet editor (/admin/data-editor?mode=match-sheet&id=${matchId}).`;
}

export type MatchSheetAuthorityPanelEntry = {
  playerId: number;
  playerName: string;
  clubId: number | null;
  kind: 'fields' | 'addition' | 'removal';
  fields: string[];
};

export type MatchSheetAuthoritySummaryResult =
  | { status: 'ok'; entries: MatchSheetAuthorityPanelEntry[]; indeterminateKeys: string[] }
  | { status: 'unavailable'; reason: string };

/**
 * Read-only, unlocked summary of a match's ACTIVE durable authority for the editor page.
 * The app role cannot read `data_overrides`, so this uses the import-role connection.
 * Fail closed: a missing DSN or any read error is `unavailable`, never "no authority".
 */
export async function loadMatchSheetAuthoritySummary(
  matchId: number,
): Promise<MatchSheetAuthoritySummaryResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) {
    return { status: 'unavailable', reason: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };
  }
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const [match] = await importSql<{ matchKey: string }[]>`
      SELECT match_key AS "matchKey" FROM matches WHERE id = ${matchId}
    `;
    if (!match) return { status: 'ok', entries: [], indeterminateKeys: [] };
    const { summary } = await loadMatchAuthority(importSql, match.matchKey);
    const ids = summary.entries.map((e) => e.playerId);
    const names = await loadPlayerNames(importSql, ids);
    const clubs = ids.length === 0 ? [] : await importSql<{ playerId: number; clubId: number }[]>`
      SELECT player_id::int AS "playerId", club_id::int AS "clubId"
        FROM player_match_stats
       WHERE match_id = ${matchId} AND player_id = ANY(${ids}::int[])
    `;
    const clubByPlayer = new Map(clubs.map((c) => [Number(c.playerId), Number(c.clubId)]));
    return {
      status: 'ok',
      entries: summary.entries.map((e) => ({
        playerId: e.playerId,
        playerName: names.get(e.playerId) ?? `Player #${e.playerId}`,
        clubId: clubByPlayer.get(e.playerId) ?? null,
        kind: e.kind,
        fields: e.fields,
      })),
      indeterminateKeys: summary.indeterminate.map((i) => i.entityKey),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

export type ReturnMatchSheetToSourceInput = {
  matchId: number;
  playerId: number;
  adminUserId: number;
  note?: string;
};

export type ReturnMatchSheetToSourceResult =
  | { ok: true; withdrawnKeys: string[]; rowDeleted: boolean; rowKept: boolean }
  | { ok: false; error: string };

const PMS_AUDIT_COLUMNS = [
  'club_id', 'jumper_number', 'goals', 'behinds', 'kicks', 'handballs', 'disposals',
  'marks', 'tackles', 'hitouts', 'frees_for', 'frees_against',
] as const;

/**
 * D-257-6: withdraw one player's durable Match Sheet authority ("Return to source").
 * ONE transaction (same skeleton as `saveMatchSheet`): lock the match and the player's
 * row, read the match's records, plan with `planReturnToSource`, then deactivate the
 * key's active records (only the granted columns) and, for a still-unowned manual
 * addition, delete the row and recompute that player's derived stats. No canonical
 * value is ever invented: the next settle restores source rows/values. Every refusal
 * is THROWN inside `begin` (postgres.js commits when the callback resolves).
 */
export async function returnMatchSheetToSource(
  input: ReturnMatchSheetToSourceInput,
): Promise<ReturnMatchSheetToSourceResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) {
    return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };
  }
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const result = await importSql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;

      const [match] = await tx<{
        id: number; season: number; matchKey: string; homeClubId: number; awayClubId: number;
      }[]>`
        SELECT id, season, match_key AS "matchKey", home_club_id AS "homeClubId",
               away_club_id AS "awayClubId"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;
      if (!match) throw new MatchSheetRefusal(`Match with ID #${input.matchId} does not exist.`);

      // The player's row (may not exist). OF pms: the LEFT JOIN side cannot be locked.
      const [row] = await tx<{
        id: number; sourceId: number | null; sourceKey: string | null;
        club_id: number | null; jumper_number: string | null;
        goals: number | null; behinds: number | null; kicks: number | null;
        handballs: number | null; disposals: number | null; marks: number | null;
        tackles: number | null; hitouts: number | null;
        frees_for: number | null; frees_against: number | null;
      }[]>`
        SELECT pms.id::int AS id, pms.source_id::int AS "sourceId", s.key AS "sourceKey",
               pms.club_id::int AS club_id, pms.jumper_number AS jumper_number,
               pms.goals::int AS goals, pms.behinds::int AS behinds, pms.kicks::int AS kicks,
               pms.handballs::int AS handballs, pms.disposals::int AS disposals,
               pms.marks::int AS marks, pms.tackles::int AS tackles, pms.hitouts::int AS hitouts,
               pms.frees_for::int AS frees_for, pms.frees_against::int AS frees_against
          FROM player_match_stats pms
          LEFT JOIN sources s ON s.id = pms.source_id
         WHERE pms.match_id = ${input.matchId} AND pms.player_id = ${input.playerId}
           FOR UPDATE OF pms
      `;

      const { rows, summary } = await loadMatchAuthority(tx, match.matchKey);
      if (summary.indeterminate.length > 0) {
        const keys = summary.indeterminate.map((i) => `${i.entityKey} (${i.reason})`).join('; ');
        throw new MatchSheetRefusal(
          `This match has durable Match Sheet authority that cannot be attributed to a player: ${keys}. `
          + 'Nothing was changed. This needs operator repair before any player can be returned to source.',
        );
      }
      const mine = summary.entries.filter((e) => e.playerId === input.playerId);
      if (mine.length === 0) {
        throw new MatchSheetRefusal(
          'There is no durable Match Sheet authority for this player in this match. Nothing was changed.',
        );
      }
      if (mine.length > 1) {
        throw new MatchSheetRefusal(
          `This player has durable authority under more than one key (${mine.map((e) => e.entityKey).join(', ')}). `
          + 'Nothing was changed. This needs operator repair.',
        );
      }
      const entry = mine[0];
      const keyRows = rows.filter((r) => r.entityKey === entry.entityKey);
      const plan = planReturnToSource({
        authority: interpretKeyAuthority(keyRows),
        row: row ? { sourceKey: row.sourceKey, hasSourceId: row.sourceId !== null } : null,
      });
      if (!plan.ok) {
        throw new MatchSheetRefusal(`Cannot return this player to source: ${plan.error}. Nothing was changed.`);
      }

      const active = keyRows.filter((r) => r.isActive);
      await tx`
        UPDATE data_overrides
           SET is_active = false,
               admin_user_id = ${input.adminUserId},
               updated_at = now()
         WHERE id = ANY(${active.map((r) => r.id)}::bigint[])
           AND is_active
      `;

      const rowDeleted = plan.action === 'withdraw_delete_row';
      const rowKept = plan.action === 'withdraw_keep_row';
      const deletedRow: Record<string, unknown> = {};
      if (rowDeleted && row) {
        for (const column of PMS_AUDIT_COLUMNS) deletedRow[column] = row[column];
        await tx`DELETE FROM player_match_stats WHERE id = ${row.id}`;
        await recomputePlayerDerivedStats(tx, [input.playerId], match.season);
      }

      const withdrawn: Record<string, unknown> = {};
      for (const record of active) withdrawn[record.fieldGroup] = record.overrideValues;
      await recordDataEdit(tx, {
        tableName: 'matches',
        rowId: input.matchId,
        fieldGroup: 'match_sheet_return_to_source',
        oldValues: auditJson({
          playerId: input.playerId,
          withdrawn: { [entry.entityKey]: withdrawn },
          ...(rowDeleted ? { deletedRow } : {}),
        }),
        newValues: auditJson({
          playerId: input.playerId,
          withdrawnKeys: [entry.entityKey],
          rowDeleted,
          rowKept,
        }),
        adminUserId: input.adminUserId,
        note: input.note,
      });

      return { withdrawnKeys: [entry.entityKey], rowDeleted, rowKept };
    });
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof MatchSheetRefusal) return { ok: false, error: err.message };
    const retryable = matchSheetRetryableRefusal(err);
    if (retryable) return { ok: false, error: retryable };
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to return the player to source: ${msg}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
