import 'server-only';

import postgres from 'postgres';
import { authSql } from '@/db/authClient';
import { recomputePlayerDerivedStats, recomputeSeasonMetadata } from '@/db/queries/player-derived';
import {
  deriveDisposals,
  scoreSyncCoverageError,
  validateMatchSheetPayload,
  type PlayerMatchStatInput,
  type ScoreSyncCoverage,
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
 * Automatically updates player_match_stats, synchronizes match scores (if enabled),
 * and recomputes player career and season summaries in real time.
 */
export async function saveMatchSheet(input: SaveMatchSheetInput): Promise<SaveMatchSheetResult> {
  const payload = validateMatchSheetPayload({
    players: input.players,
    removedPlayerIds: input.removedPlayerIds ?? [],
  });
  if (!payload.ok) return { ok: false, error: payload.error };

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
        roundNumber: number | null;
        homeClubId: number;
        awayClubId: number;
        isFinal: boolean;
        roundType: string;
      }[]>`
        SELECT id, season, round_number AS "roundNumber", home_club_id AS "homeClubId",
               away_club_id AS "awayClubId", is_final AS "isFinal",
               round_type AS "roundType"
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

      // 4. Optional score synchronization from player goals/behinds
      if (input.syncMatchScores) {
        const [totals] = await tx<({
          homeGoals: number | null;
          homeBehinds: number | null;
          awayGoals: number | null;
          awayBehinds: number | null;
        } & ScoreSyncCoverage)[]>`
          SELECT
            (sum(goals) FILTER (WHERE club_id = ${match.homeClubId}))::int AS "homeGoals",
            (sum(behinds) FILTER (WHERE club_id = ${match.homeClubId}))::int AS "homeBehinds",
            (sum(goals) FILTER (WHERE club_id = ${match.awayClubId}))::int AS "awayGoals",
            (sum(behinds) FILTER (WHERE club_id = ${match.awayClubId}))::int AS "awayBehinds",
            count(*) FILTER (WHERE club_id = ${match.homeClubId})::int AS "homePlayers",
            count(*) FILTER (WHERE club_id = ${match.awayClubId})::int AS "awayPlayers",
            count(goals) FILTER (WHERE club_id = ${match.homeClubId})::int AS "homeGoalsRecorded",
            count(behinds) FILTER (WHERE club_id = ${match.homeClubId})::int AS "homeBehindsRecorded",
            count(goals) FILTER (WHERE club_id = ${match.awayClubId})::int AS "awayGoalsRecorded",
            count(behinds) FILTER (WHERE club_id = ${match.awayClubId})::int AS "awayBehindsRecorded"
          FROM player_match_stats
          WHERE match_id = ${input.matchId}
        `;

        if (!totals) throw new Error('Could not read the saved match score components.');
        const coverageError = scoreSyncCoverageError(totals);
        if (coverageError) throw new Error(coverageError);

        const homeGoals = totals.homeGoals as number;
        const homeBehinds = totals.homeBehinds as number;
        const awayGoals = totals.awayGoals as number;
        const awayBehinds = totals.awayBehinds as number;
        const homeScore = homeGoals * 6 + homeBehinds;
        const awayScore = awayGoals * 6 + awayBehinds;
        const result = homeScore > awayScore ? 'home_win' : homeScore < awayScore ? 'away_win' : 'draw';
        const winnerClubId = homeScore > awayScore ? match.homeClubId : homeScore < awayScore ? match.awayClubId : null;
        const margin = Math.abs(homeScore - awayScore);

        await tx`
          UPDATE matches
             SET home_goals = ${homeGoals},
                 home_behinds = ${homeBehinds},
                 home_score = ${homeScore},
                 away_goals = ${awayGoals},
                 away_behinds = ${awayBehinds},
                 away_score = ${awayScore},
                 result = ${result}::match_result,
                 winner_club_id = ${winnerClubId},
                 margin = ${margin}
           WHERE id = ${input.matchId}
        `;

        const [periodRow] = await tx<{ period: number }[]>`
          SELECT COALESCE(max(period), 4)::int AS period
            FROM match_period_scores
           WHERE match_id = ${input.matchId}
        `;
        const finalPeriod = periodRow?.period ?? 4;
        for (const score of [
          { clubId: match.homeClubId, goals: homeGoals, behinds: homeBehinds, points: homeScore },
          { clubId: match.awayClubId, goals: awayGoals, behinds: awayBehinds, points: awayScore },
        ]) {
          await tx`
            INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
            VALUES (${input.matchId}, ${score.clubId}, ${finalPeriod}, ${score.goals}, ${score.behinds}, ${score.points})
            ON CONFLICT (match_id, club_id, period) DO UPDATE SET
              goals = EXCLUDED.goals,
              behinds = EXCLUDED.behinds,
              points = EXCLUDED.points
          `;
        }
      }

      const affectedIds = Array.from(new Set([
        ...existingPlayers.map((row) => row.playerId),
        ...players.map((player) => player.playerId),
        ...removed,
      ])).filter((id) => Number.isInteger(id) && id > 0);

      // Round detail is independently recorded. Official season totals are
      // never inferred from this incomplete match-grain source.
      if (affectedIds.length > 0 && match.roundNumber !== null) {
        await tx`
          DELETE FROM brownlow_round_votes
           WHERE season = ${match.season}
             AND round_number = ${match.roundNumber}
             AND player_id = ANY(${affectedIds})
        `;
        await tx`
          INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes)
          SELECT ${match.season}, pms.player_id, ${match.roundNumber}, true, pms.brownlow_votes
            FROM player_match_stats pms
           WHERE pms.match_id = ${input.matchId}
             AND pms.player_id = ANY(${affectedIds})
             AND pms.brownlow_votes IS NOT NULL
          ON CONFLICT (season, player_id, round_number) DO UPDATE SET
            played = EXCLUDED.played,
            votes = EXCLUDED.votes
        `;
      }

      await recomputePlayerDerivedStats(tx, affectedIds, match.season);
      if (input.syncMatchScores) await recomputeSeasonMetadata(tx, match.season);

      return { playerCount: players.length, scoreUpdated: input.syncMatchScores };
    });

    // 6. Audit log in data_edits
    try {
      await authSql`
        INSERT INTO data_edits
              (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('matches', ${input.matchId}, 'match_sheet',
                '{}'::jsonb,
                ${authSql.json({ playersCount: players.length, scoreUpdated: input.syncMatchScores })},
                ${input.adminUserId},
                ${(input.note ?? '').trim().slice(0, 2000) || null})
      `;
    } catch (auditErr) {
      console.error('Audit row error in saveMatchSheet', auditErr);
    }

    return { ok: true, playerCount: result.playerCount, scoreUpdated: result.scoreUpdated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to save match sheet: ${msg}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
