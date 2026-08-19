import 'server-only';

import postgres from 'postgres';
import { authSql } from '@/db/authClient';

export type PlayerMatchStatInput = {
  playerId: number;
  clubId: number;
  jumperNumber?: string | null;
  goals?: number | null;
  behinds?: number | null;
  kicks?: number | null;
  handballs?: number | null;
  disposals?: number | null;
  marks?: number | null;
  tackles?: number | null;
  hitouts?: number | null;
  freesFor?: number | null;
  freesAgainst?: number | null;
  brownlowVotes?: number | null;
};

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
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
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
        roundType: string;
      }[]>`
        SELECT id, season, home_club_id AS "homeClubId",
               away_club_id AS "awayClubId", is_final AS "isFinal",
               round_type AS "roundType"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;

      if (!match) {
        throw new Error(`Match with ID #${input.matchId} does not exist.`);
      }

      // 2. Remove players marked for removal
      const removed = input.removedPlayerIds ?? [];
      if (removed.length > 0) {
        await tx`
          DELETE FROM player_match_stats
           WHERE match_id = ${input.matchId}
             AND player_id = ANY(${removed})
        `;
      }

      // 3. Upsert player match stats
      for (const p of input.players) {
        if (!p.playerId || !p.clubId) continue;

        const kicks = p.kicks ?? null;
        const handballs = p.handballs ?? null;
        // Auto-calculate disposals if kicks/handballs are provided
        const disposals = p.disposals !== null && p.disposals !== undefined
          ? p.disposals
          : (kicks !== null || handballs !== null) ? ((kicks ?? 0) + (handballs ?? 0)) : null;

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
        const [totals] = await tx<{
          homeGoals: number;
          homeBehinds: number;
          awayGoals: number;
          awayBehinds: number;
        }[]>`
          SELECT
            COALESCE(sum(goals) FILTER (WHERE club_id = ${match.homeClubId}), 0)::int AS "homeGoals",
            COALESCE(sum(behinds) FILTER (WHERE club_id = ${match.homeClubId}), 0)::int AS "homeBehinds",
            COALESCE(sum(goals) FILTER (WHERE club_id = ${match.awayClubId}), 0)::int AS "awayGoals",
            COALESCE(sum(behinds) FILTER (WHERE club_id = ${match.awayClubId}), 0)::int AS "awayBehinds"
          FROM player_match_stats
          WHERE match_id = ${input.matchId}
        `;

        if (totals) {
          const homeScore = totals.homeGoals * 6 + totals.homeBehinds;
          const awayScore = totals.awayGoals * 6 + totals.awayBehinds;
          const result = homeScore > awayScore ? 'home_win' : homeScore < awayScore ? 'away_win' : 'draw';
          const winnerClubId = homeScore > awayScore ? match.homeClubId : homeScore < awayScore ? match.awayClubId : null;
          const margin = Math.abs(homeScore - awayScore);

          await tx`
            UPDATE matches
               SET home_goals = ${totals.homeGoals},
                   home_behinds = ${totals.homeBehinds},
                   home_score = ${homeScore},
                   away_goals = ${totals.awayGoals},
                   away_behinds = ${totals.awayBehinds},
                   away_score = ${awayScore},
                   result = ${result}::match_result,
                   winner_club_id = ${winnerClubId},
                   margin = ${margin}
             WHERE id = ${input.matchId}
          `;
        }
      }

      // 5. Recompute derived player_career_stats & player_season_stats for affected players
      const affectedIds = Array.from(new Set([
        ...input.players.map((p) => p.playerId),
        ...removed,
      ])).filter((id) => Number.isInteger(id) && id > 0);

      if (affectedIds.length > 0) {
        // Career stats recalculation
        await tx`
          DELETE FROM player_career_stats WHERE player_id = ANY(${affectedIds});
          INSERT INTO player_career_stats (
            player_id, games, finals, premierships, wins, draws, losses,
            goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
            behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
            disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
            hitouts_recorded_games,
            brownlow_votes, brownlow_medals,
            clubs_played, seasons_played, debut_season, final_season,
            debut_date, last_match_date, best_goals_game, best_disposals_game
          )
          SELECT
              g.player_id,
              g.games, g.finals, g.premierships, g.wins, g.draws, g.losses,
              g.goals, g.behinds, g.kicks, g.handballs, g.disposals, g.marks,
              g.tackles, g.hitouts,
              g.behinds_rec, g.kicks_rec, g.handballs_rec, g.disposals_rec,
              g.marks_rec, g.tackles_rec, g.hitouts_rec,
              COALESCE(b.votes, 0),
              COALESCE(b.medals, 0),
              g.clubs_played, g.seasons_played, g.debut_season, g.final_season,
              g.debut_date, g.last_match_date, g.best_goals, g.best_disposals
          FROM (
              SELECT
                  pms.player_id,
                  count(*) AS games,
                  count(*) FILTER (WHERE m.is_final) AS finals,
                  count(*) FILTER (WHERE m.round_type = 'grand_final' AND (CASE WHEN m.result = 'draw' THEN 'D' WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W' ELSE 'L' END) = 'W') AS premierships,
                  count(*) FILTER (WHERE (CASE WHEN m.result = 'draw' THEN 'D' WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W' ELSE 'L' END) = 'W') AS wins,
                  count(*) FILTER (WHERE m.result = 'draw') AS draws,
                  count(*) FILTER (WHERE (CASE WHEN m.result = 'draw' THEN 'D' WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W' ELSE 'L' END) = 'L') AS losses,
                  COALESCE(sum(pms.goals), 0) AS goals,
                  sum(pms.behinds) AS behinds, sum(pms.kicks) AS kicks,
                  sum(pms.handballs) AS handballs, sum(pms.disposals) AS disposals,
                  sum(pms.marks) AS marks, sum(pms.tackles) AS tackles, sum(pms.hitouts) AS hitouts,
                  count(pms.behinds) AS behinds_rec, count(pms.kicks) AS kicks_rec,
                  count(pms.handballs) AS handballs_rec, count(pms.disposals) AS disposals_rec,
                  count(pms.marks) AS marks_rec, count(pms.tackles) AS tackles_rec,
                  count(pms.hitouts) AS hitouts_rec,
                  count(DISTINCT cl.organization_id) AS clubs_played,
                  count(DISTINCT m.season) AS seasons_played,
                  min(m.season) AS debut_season, max(m.season) AS final_season,
                  min(m.match_date) AS debut_date, max(m.match_date) AS last_match_date,
                  max(pms.goals) AS best_goals, max(pms.disposals) AS best_disposals
              FROM player_match_stats pms
              JOIN matches m ON m.id = pms.match_id
              JOIN clubs cl ON cl.id = pms.club_id
              WHERE pms.player_id = ANY(${affectedIds})
              GROUP BY pms.player_id
          ) g
          LEFT JOIN (
              SELECT player_id,
                     sum(votes) AS votes,
                     count(*) FILTER (WHERE is_winner) AS medals
              FROM brownlow_season_votes
              WHERE player_id = ANY(${affectedIds})
              GROUP BY player_id
          ) b ON b.player_id = g.player_id;
        `;

        // Season stats recalculation
        await tx`
          DELETE FROM player_season_stats WHERE player_id = ANY(${affectedIds}) AND season = ${match.season};
          INSERT INTO player_season_stats (
            player_id, season, primary_club_id, club_count,
            games, finals, wins, draws, losses,
            goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
            disposals_recorded_games, tackles_recorded_games, hitouts_recorded_games,
            brownlow_votes, brownlow_status, is_premier
          )
          SELECT
              a.player_id, a.season, a.primary_club_id, a.club_count,
              a.games, a.finals, a.wins, a.draws, a.losses,
              a.goals, a.behinds, a.kicks, a.handballs,
              a.disposals, a.marks, a.tackles, a.hitouts,
              a.disposals_rec, a.tackles_rec, a.hitouts_rec,
              CASE WHEN sb.status = 'complete' THEN COALESCE(bsv.votes, 0) END,
              sb.status,
              a.is_premier
          FROM (
              SELECT
                  c.player_id,
                  c.season,
                  count(*) AS games,
                  count(*) FILTER (WHERE c.is_final) AS finals,
                  count(*) FILTER (WHERE c.outcome = 'W') AS wins,
                  count(*) FILTER (WHERE c.outcome = 'D') AS draws,
                  count(*) FILTER (WHERE c.outcome = 'L') AS losses,
                  sum(c.goals) AS goals, sum(c.behinds) AS behinds,
                  sum(c.kicks) AS kicks, sum(c.handballs) AS handballs,
                  sum(c.disposals) AS disposals, sum(c.marks) AS marks,
                  sum(c.tackles) AS tackles, sum(c.hitouts) AS hitouts,
                  count(c.disposals) AS disposals_rec,
                  count(c.tackles) AS tackles_rec,
                  count(c.hitouts) AS hitouts_rec,
                  count(DISTINCT c.club_id) AS club_count,
                  (array_agg(c.club_id ORDER BY cnt DESC, c.club_id))[1] AS primary_club_id,
                  bool_or(c.round_type = 'grand_final' AND c.outcome = 'W') AS is_premier
              FROM (
                  SELECT pms.*, m.season, m.is_final, m.round_type,
                         (CASE WHEN m.result = 'draw' THEN 'D' WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W' ELSE 'L' END) AS outcome,
                         count(*) OVER (PARTITION BY pms.player_id, m.season, pms.club_id) AS cnt
                    FROM player_match_stats pms
                    JOIN matches m ON m.id = pms.match_id
                   WHERE pms.player_id = ANY(${affectedIds}) AND m.season = ${match.season}
              ) c
              GROUP BY c.player_id, c.season
          ) a
          JOIN (
              SELECT s.year AS season,
                     CASE
                       WHEN EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year) THEN 'complete'
                       WHEN s.status = 'in_progress' THEN 'pending'
                       ELSE 'not_applicable'
                     END::coverage_status AS status
                FROM seasons s
               WHERE s.year = ${match.season}
          ) sb ON sb.season = a.season
          LEFT JOIN brownlow_season_votes bsv
                 ON bsv.player_id = a.player_id AND bsv.season = a.season;
        `;

        // Players career span
        await tx`
          UPDATE players p
             SET debut_season = sub.debut_season,
                 final_season = sub.final_season
            FROM (
              SELECT pms.player_id, min(m.season) AS debut_season, max(m.season) AS final_season
                FROM player_match_stats pms
                JOIN matches m ON m.id = pms.match_id
               WHERE pms.player_id = ANY(${affectedIds})
               GROUP BY pms.player_id
            ) sub
           WHERE p.id = sub.player_id;
        `;
      }

      return { playerCount: input.players.length, scoreUpdated: input.syncMatchScores };
    });

    // 6. Audit log in data_edits
    try {
      await authSql`
        INSERT INTO data_edits
              (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('matches', ${input.matchId}, 'match_sheet',
                '{}'::jsonb,
                ${authSql.json({ playersCount: input.players.length, scoreUpdated: input.syncMatchScores })},
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
