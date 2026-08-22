import 'server-only';

import postgres from 'postgres';
import { recordDataEdit } from '@/db/queries/audit-log';
import { recomputePlayerDerivedStats } from '@/db/queries/player-derived';
import {
  deriveDisposals,
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
};

export type SaveMatchSheetResult =
  | { ok: true; playerCount: number; scoreUpdated: boolean }
  | { ok: false; error: string };

/**
 * Save complete match sheet (lineup and statistics) for a game (see changeLog.md).
 * Updates player_match_stats and recomputes player career and season summaries
 * in real time. Team scores remain a separate fact because rushed behinds are
 * not attributable to player rows.
 */
export async function saveMatchSheet(input: SaveMatchSheetInput): Promise<SaveMatchSheetResult> {
  const payload = validateMatchSheetPayload({
    players: input.players,
    removedPlayerIds: input.removedPlayerIds ?? [],
  });
  if (!payload.ok) return { ok: false, error: payload.error };

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
      // 1. Fetch match metadata
      const [match] = await tx<{
        id: number;
        season: number;
        homeClubId: number;
        awayClubId: number;
        isFinal: boolean;
      }[]>`
        SELECT id, season, home_club_id AS "homeClubId",
               away_club_id AS "awayClubId", is_final AS "isFinal"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;

      if (!match) {
        throw new Error(`Match with ID #${input.matchId} does not exist.`);
      }

      for (const player of players) {
        if (player.clubId !== match.homeClubId && player.clubId !== match.awayClubId) {
          throw new Error(
            `Player #${player.playerId} must be assigned to one of the two clubs in this match.`,
          );
        }
      }

      if (players.some((player) => player.brownlowVotes != null)) {
        if (match.isFinal) {
          throw new Error('Brownlow votes cannot be recorded for finals.');
        }
        const [availability] = await tx<{ coverage: string }[]>`
          SELECT coverage::text AS coverage
            FROM stat_availability
           WHERE stat_key = 'brownlow_match_votes'
             AND season = ${match.season}
        `;
        if (!availability || !['complete', 'partial'].includes(availability.coverage)) {
          throw new Error(`Per-match Brownlow votes are not recorded for the ${match.season} season.`);
        }
      }

      const existingPlayers = await tx<{ playerId: number }[]>`
        SELECT player_id AS "playerId"
          FROM player_match_stats
         WHERE match_id = ${input.matchId}
      `;

      // 2. Remove players marked for removal
      const removed = removedPlayerIds;
      if (removed.length > 0) {
        await tx`
          DELETE FROM player_match_stats
           WHERE match_id = ${input.matchId}
             AND player_id = ANY(${removed})
        `;
      }

      // 3. Upsert player match stats
      for (const p of players) {
        const kicks = p.kicks ?? null;
        const handballs = p.handballs ?? null;
        const disposals = deriveDisposals(kicks, handballs, p.disposals);

        await tx`
          INSERT INTO player_match_stats (
            player_id, match_id, club_id, jumper_number,
            goals, behinds, kicks, handballs, disposals,
            marks, tackles, hitouts, frees_for, frees_against,
            brownlow_votes
          ) VALUES (
            ${p.playerId}, ${input.matchId}, ${p.clubId}, ${p.jumperNumber?.trim() || null},
            ${p.goals ?? null}, ${p.behinds ?? null}, ${kicks}, ${handballs}, ${disposals},
            ${p.marks ?? null}, ${p.tackles ?? null}, ${p.hitouts ?? null},
            ${p.freesFor ?? null}, ${p.freesAgainst ?? null},
            ${p.brownlowVotes ?? null}
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
            frees_against = EXCLUDED.frees_against,
            brownlow_votes = EXCLUDED.brownlow_votes
        `;
      }

      const affectedIds = Array.from(new Set([
        ...existingPlayers.map((row) => row.playerId),
        ...players.map((player) => player.playerId),
        ...removed,
      ])).filter((id) => Number.isInteger(id) && id > 0);

      await recomputePlayerDerivedStats(tx, affectedIds, match.season);

      // 6. Required audit, same transaction: a failed insert rolls the
      // whole match sheet back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'matches',
        rowId: input.matchId,
        fieldGroup: 'match_sheet',
        oldValues: {},
        newValues: { playersCount: players.length, scoreUpdated: input.syncMatchScores },
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
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to save match sheet: ${msg}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
