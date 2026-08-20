import 'server-only';

import postgres from 'postgres';
import { sql } from '@/db/client';
import { authSql } from '@/db/authClient';

export type QuarterScoreInput = {
  goals?: number | null;
  behinds?: number | null;
  points?: number | null;
};

export type AdminMatchSummary = {
  id: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  roundCode: string;
  matchDate: Date;
  homeClubId: number;
  homeName: string;
  homeSlug: string;
  awayClubId: number;
  awayName: string;
  awaySlug: string;
  homeGoals: number | null;
  homeBehinds: number | null;
  homeScore: number;
  awayGoals: number | null;
  awayBehinds: number | null;
  awayScore: number;
  margin: number;
  result: string;
  venueName: string;
  attendance: number | null;
  playerCount: number;
};

/**
 * Super Admin: Search and browse matches with filters (season, club, round, query)
 * and player lineup counts (see changeLog.md).
 */
export async function searchAdminMatches(options: {
  season?: number | null;
  clubId?: number | null;
  roundNumber?: number | null;
  query?: string | null;
  limit?: number;
}): Promise<{ rows: AdminMatchSummary[]; total: number }> {
  const limit = options.limit ?? 30;
  const whereClauses = [
    options.season ? sql`m.season = ${options.season}` : sql`true`,
    options.clubId ? sql`(m.home_club_id = ${options.clubId} OR m.away_club_id = ${options.clubId})` : sql`true`,
    options.roundNumber ? sql`m.round_number = ${options.roundNumber}` : sql`true`,
    options.query?.trim() ? sql`(h.name ILIKE ${'%' + options.query.trim() + '%'} OR a.name ILIKE ${'%' + options.query.trim() + '%'} OR COALESCE(v.canonical_name, m.venue_raw) ILIKE ${'%' + options.query.trim() + '%'})` : sql`true`,
  ];

  const combinedWhere = sql`${whereClauses.reduce((acc, clause) => sql`${acc} AND ${clause}`)}`;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE ${combinedWhere}
  `;

  const rows = await sql<AdminMatchSummary[]>`
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.round_code AS "roundCode",
           m.match_date AS "matchDate",
           m.home_club_id AS "homeClubId", h.name AS "homeName", h.slug AS "homeSlug",
           m.away_club_id AS "awayClubId", a.name AS "awayName", a.slug AS "awaySlug",
           m.home_goals AS "homeGoals", m.home_behinds AS "homeBehinds", m.home_score AS "homeScore",
           m.away_goals AS "awayGoals", m.away_behinds AS "awayBehinds", m.away_score AS "awayScore",
           m.margin, m.result,
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           m.attendance,
           (SELECT count(*)::int FROM player_match_stats pms WHERE pms.match_id = m.id) AS "playerCount"
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE ${combinedWhere}
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${limit}
  `;

  return { rows, total: countRow?.count ?? 0 };
}

export type CreateMatchInput = {
  season: number;
  roundType: 'home_and_away' | 'elimination_final' | 'qualifying_final' | 'semi_final' | 'preliminary_final' | 'grand_final';
  roundNumber?: number | null;
  roundCode?: string | null;
  matchDate: string; // YYYY-MM-DD
  matchTime?: string | null; // e.g. "19:40"
  venueId?: number | null;
  venueRaw?: string | null;
  homeClubId: number;
  awayClubId: number;
  homeGoals?: number | null;
  homeBehinds?: number | null;
  homeScore?: number | null;
  awayGoals?: number | null;
  awayBehinds?: number | null;
  awayScore?: number | null;
  attendance?: number | null;
  matchEvent?: string | null;
  notes?: string | null;
  homeQuarters?: Record<number, QuarterScoreInput> | null; // periods 1..4
  awayQuarters?: Record<number, QuarterScoreInput> | null; // periods 1..4
  adminUserId: number;
};

/**
 * Super Admin: Create a new match in the database (see changeLog.md).
 * Enables adding live/current season matches with venue, scores, quarter breakdowns,
 * followed by immediate lineup, player statistics and Brownlow votes entry in MatchSheetEditor.
 */
export async function createMatch(input: CreateMatchInput): Promise<{ id: number; season: number }> {
  if (input.homeClubId === input.awayClubId) {
    throw new Error('Home club and away club must be different.');
  }

  const isFinal = input.roundType !== 'home_and_away';
  const roundNumber = isFinal ? null : (Number.isInteger(input.roundNumber) ? Number(input.roundNumber) : 1);

  let roundCode = (input.roundCode || '').trim().toUpperCase();
  if (!roundCode) {
    if (!isFinal) {
      roundCode = `R${roundNumber}`;
    } else {
      switch (input.roundType) {
        case 'grand_final': roundCode = 'GF'; break;
        case 'preliminary_final': roundCode = 'PF'; break;
        case 'semi_final': roundCode = 'SF'; break;
        case 'qualifying_final': roundCode = 'QF'; break;
        case 'elimination_final': roundCode = 'EF'; break;
        default: roundCode = 'Final';
      }
    }
  }

  const homeGoals = input.homeGoals !== null && input.homeGoals !== undefined ? Number(input.homeGoals) : null;
  const homeBehinds = input.homeBehinds !== null && input.homeBehinds !== undefined ? Number(input.homeBehinds) : null;
  const homeScore = (homeGoals !== null && homeBehinds !== null)
    ? (homeGoals * 6 + homeBehinds)
    : (input.homeScore !== null && input.homeScore !== undefined ? Number(input.homeScore) : ((homeGoals ?? 0) * 6 + (homeBehinds ?? 0)));

  const awayGoals = input.awayGoals !== null && input.awayGoals !== undefined ? Number(input.awayGoals) : null;
  const awayBehinds = input.awayBehinds !== null && input.awayBehinds !== undefined ? Number(input.awayBehinds) : null;
  const awayScore = (awayGoals !== null && awayBehinds !== null)
    ? (awayGoals * 6 + awayBehinds)
    : (input.awayScore !== null && input.awayScore !== undefined ? Number(input.awayScore) : ((awayGoals ?? 0) * 6 + (awayBehinds ?? 0)));

  const margin = Math.abs(homeScore - awayScore);
  const result: 'home_win' | 'away_win' | 'draw' =
    homeScore > awayScore ? 'home_win' : (awayScore > homeScore ? 'away_win' : 'draw');
  const winnerClubId = result === 'home_win' ? input.homeClubId : (result === 'away_win' ? input.awayClubId : null);

  const attendance = (input.attendance !== null && input.attendance !== undefined && Number(input.attendance) >= 0)
    ? Number(input.attendance)
    : null;
  const attendanceStatus: 'complete' | 'not_collected' = attendance !== null ? 'complete' : 'not_collected';

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      // 1. Ensure season row exists
      const league = input.season >= 1990 ? 'AFL' : 'VFL';
      await tx`
        INSERT INTO seasons (year, league, status)
        VALUES (${input.season}, ${league}, 'in_progress'::season_status)
        ON CONFLICT (year) DO NOTHING
      `;

      // 2. Resolve venue raw name
      let venueRaw = (input.venueRaw || '').trim();
      if (input.venueId) {
        const [v] = await tx<{ canonicalName: string }[]>`
          SELECT canonical_name AS "canonicalName" FROM venues WHERE id = ${input.venueId}
        `;
        if (v?.canonicalName) venueRaw = v.canonicalName;
      }
      if (!venueRaw) venueRaw = 'AFL Venue';

      // 3. Generate unique match_key
      const baseKey = `${input.season}|${roundCode}|${input.matchDate}|${input.homeClubId}|${input.awayClubId}`;
      let matchKey = baseKey;
      const [existing] = await tx<{ id: number }[]>`SELECT id FROM matches WHERE match_key = ${matchKey}`;
      if (existing) {
        matchKey = `${baseKey}|${Date.now()}`;
      }

      // 4. Insert into matches
      const [matchRow] = await tx<{ id: number; season: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, match_time, venue_id, venue_raw,
          home_club_id, away_club_id,
          home_goals, home_behinds, home_score,
          away_goals, away_behinds, away_score,
          result, winner_club_id, margin,
          attendance, attendance_status, match_event, notes
        ) VALUES (
          ${matchKey}, ${input.season}, ${roundCode}, ${roundNumber}, ${input.roundType}::round_type, ${isFinal},
          ${input.matchDate}::date, ${input.matchTime || null}, ${input.venueId || null}, ${venueRaw},
          ${input.homeClubId}, ${input.awayClubId},
          ${homeGoals}, ${homeBehinds}, ${homeScore},
          ${awayGoals}, ${awayBehinds}, ${awayScore},
          ${result}::match_result, ${winnerClubId}, ${margin},
          ${attendance}, ${attendanceStatus}::coverage_status, ${input.matchEvent?.trim() || null}, ${input.notes?.trim() || null}
        )
        RETURNING id, season
      `;

      // 5. Insert quarter scores if provided
      for (const [clubId, periods] of [[input.homeClubId, input.homeQuarters], [input.awayClubId, input.awayQuarters]] as const) {
        if (!periods) continue;
        for (let p = 1; p <= 4; p++) {
          const q = periods[p];
          if (q && (q.goals !== null || q.behinds !== null || q.points !== null)) {
            const qGoals = q.goals !== null && q.goals !== undefined ? Number(q.goals) : null;
            const qBehinds = q.behinds !== null && q.behinds !== undefined ? Number(q.behinds) : null;
            const qPoints = q.points !== null && q.points !== undefined
              ? Number(q.points)
              : (qGoals !== null && qBehinds !== null ? qGoals * 6 + qBehinds : null);

            await tx`
              INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
              VALUES (${matchRow.id}, ${clubId}, ${p}, ${qGoals}, ${qBehinds}, ${qPoints})
              ON CONFLICT (match_id, club_id, period) DO UPDATE SET
                goals = EXCLUDED.goals,
                behinds = EXCLUDED.behinds,
                points = EXCLUDED.points
            `;
          }
        }
      }

      return matchRow;
    });

    // 6. Audit in data_edits
    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('matches', ${created.id}, 'match_creation', '{}'::jsonb,
                ${authSql.json({
                  season: input.season,
                  roundCode,
                  matchDate: input.matchDate,
                  homeClubId: input.homeClubId,
                  awayClubId: input.awayClubId,
                  homeScore,
                  awayScore,
                })},
                ${input.adminUserId}, ${input.notes?.trim() || 'Created match via Data Editor'})
      `;
    } catch (auditErr) {
      console.error('Failed to log audit row for match creation', auditErr);
    }

    return created;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

/**
 * Super Admin: Delete a match from the database (see changeLog.md).
 * Removes player_match_stats, match_period_scores, and matches record,
 * while automatically recalculating career & season statistics for all affected players.
 */
export async function deleteMatch(input: {
  matchId: number;
  adminUserId: number;
  reason?: string | null;
}): Promise<{ ok: true; deletedId: number; affectedPlayers: number } | { ok: false; error: string }> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const result = await importSql.begin<
      | { ok: true; deletedId: number; season: number; affectedPlayers: number }
      | { ok: false; error: string }
    >(async (tx) => {
      // 1. Fetch match info
      const [match] = await tx<{
        id: number;
        season: number;
        roundNumber: number | null;
        roundCode: string;
        matchDate: string;
        homeClubId: number;
        awayClubId: number;
        homeScore: number;
        awayScore: number;
      }[]>`
        SELECT id, season, round_number AS "roundNumber", round_code AS "roundCode", match_date::text AS "matchDate",
               home_club_id AS "homeClubId", away_club_id AS "awayClubId",
               home_score AS "homeScore", away_score AS "awayScore"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;

      if (!match) {
        return { ok: false as const, error: `Match #${input.matchId} does not exist.` };
      }

      // 2. Identify all affected players in this match
      const playerRows = await tx<{ playerId: number }[]>`
        SELECT DISTINCT player_id AS "playerId"
          FROM player_match_stats
         WHERE match_id = ${input.matchId}
      `;
      const affectedIds = playerRows.map((r) => r.playerId).filter(Boolean);

      // 3. Delete dependent rows
      await tx`DELETE FROM player_achievements WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM player_match_stats WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM match_period_scores WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM matches WHERE id = ${input.matchId}`;

      // 4. Recalculate player career and season stats for all affected players
      if (affectedIds.length > 0) {
        // Sync Brownlow votes
        if (match.roundNumber) {
          await tx`
            DELETE FROM brownlow_round_votes
            WHERE season = ${match.season}
              AND round_number = ${match.roundNumber}
              AND player_id = ANY(${affectedIds})
          `;
        }

        await tx`
          INSERT INTO brownlow_season_votes (
            season, player_id, club_id, votes,
            three_vote_games, two_vote_games, one_vote_games, polling_games,
            link_status_value
          )
          SELECT
            m.season,
            pms.player_id,
            (array_agg(pms.club_id ORDER BY pms.id DESC))[1] AS club_id,
            COALESCE(sum(pms.brownlow_votes), 0)::smallint AS votes,
            count(*) FILTER (WHERE pms.brownlow_votes = 3)::smallint AS three_vote_games,
            count(*) FILTER (WHERE pms.brownlow_votes = 2)::smallint AS two_vote_games,
            count(*) FILTER (WHERE pms.brownlow_votes = 1)::smallint AS one_vote_games,
            count(*) FILTER (WHERE pms.brownlow_votes > 0)::smallint AS polling_games,
            'unique'::link_status
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
          WHERE m.season = ${match.season}
            AND pms.player_id = ANY(${affectedIds})
            AND pms.brownlow_votes > 0
          GROUP BY m.season, pms.player_id
          ON CONFLICT (season, player_id) DO UPDATE SET
            club_id = EXCLUDED.club_id,
            votes = EXCLUDED.votes,
            three_vote_games = EXCLUDED.three_vote_games,
            two_vote_games = EXCLUDED.two_vote_games,
            one_vote_games = EXCLUDED.one_vote_games,
            polling_games = EXCLUDED.polling_games;

          DELETE FROM brownlow_season_votes
          WHERE season = ${match.season}
            AND player_id = ANY(${affectedIds})
            AND NOT EXISTS (
              SELECT 1 FROM player_match_stats pms
              JOIN matches m ON m.id = pms.match_id
              WHERE m.season = ${match.season}
                AND pms.player_id = brownlow_season_votes.player_id
                AND pms.brownlow_votes > 0
            );
        `;

        // Career stats
        await tx`
          DELETE FROM player_career_stats WHERE player_id = ANY(${affectedIds});

          INSERT INTO player_career_stats (
            player_id, games, finals, premierships, wins, draws, losses,
            goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
            behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
            disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
            hitouts_recorded_games, brownlow_votes, brownlow_medals,
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

          -- Preserve 0-game profile row for players who now have no matches remaining
          INSERT INTO player_career_stats (
            player_id, games, goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
            finals, premierships, wins, draws, losses, brownlow_votes, brownlow_medals,
            clubs_played, seasons_played, behinds_recorded_games, kicks_recorded_games,
            handballs_recorded_games, disposals_recorded_games, marks_recorded_games,
            tackles_recorded_games, hitouts_recorded_games
          )
          SELECT unnest(${affectedIds}::int[]), 0, 0, 0, 0, 0, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0, 0,
                 0, 0, 0, 0,
                 0, 0, 0,
                 0, 0
          ON CONFLICT (player_id) DO NOTHING;
        `;

        // Season stats
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
              SELECT b.season,
                     CASE WHEN count(*) FILTER (WHERE b.status = 'complete') = count(*) THEN 'complete'
                          WHEN count(*) FILTER (WHERE b.status = 'not_awarded') > 0 THEN 'not_awarded'
                          ELSE 'pending' END AS status
                FROM brownlow_seasons b
               WHERE b.season = ${match.season}
               GROUP BY b.season
          ) sb ON sb.season = a.season
          LEFT JOIN brownlow_season_votes bsv ON bsv.player_id = a.player_id AND bsv.season = a.season;
        `;
      }

      return {
        ok: true as const,
        deletedId: input.matchId,
        season: match.season,
        affectedPlayers: affectedIds.length,
      };
    });

    if (!result.ok) {
      return result;
    }

    // Audit in data_edits
    try {
      await authSql`
        INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values, admin_user_id, note)
        VALUES ('matches', ${input.matchId}, 'match_deletion',
                ${authSql.json({ deletedMatchId: input.matchId, season: result.season })},
                '{}'::jsonb,
                ${input.adminUserId}, ${input.reason?.trim() || 'Deleted match via Data Editor'})
      `;
    } catch (auditErr) {
      console.error('Failed to log audit row for match deletion', auditErr);
    }

    return {
      ok: true,
      deletedId: result.deletedId,
      affectedPlayers: result.affectedPlayers,
    };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

