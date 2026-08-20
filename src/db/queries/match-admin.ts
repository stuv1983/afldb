import 'server-only';

import postgres from 'postgres';
import { sql } from '@/db/client';
import { authSql } from '@/db/authClient';
import {
  clearPlayerClubMatchReferences,
  recomputePlayerDerivedStats,
  recomputeSeasonMetadata,
} from '@/db/queries/player-derived';

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

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
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

      const clubs = await tx<{ id: number; name: string; activeId: number | null }[]>`
        SELECT c.id, c.name,
               afldb_identity_for_season(c.organization_id, ${input.season}) AS "activeId"
          FROM clubs c
         WHERE c.id = ANY(${[input.homeClubId, input.awayClubId]})
      `;
      for (const clubId of [input.homeClubId, input.awayClubId]) {
        const club = clubs.find((candidate) => candidate.id === clubId);
        if (!club) throw new Error(`Club #${clubId} does not exist.`);
        if (club.activeId !== club.id) {
          throw new Error(`${club.name} is not the historical club identity active in ${input.season}.`);
        }
      }

      // 2. Resolve venue raw name
      let venueRaw = (input.venueRaw || '').trim();
      if (input.venueId) {
        const [v] = await tx<{ canonicalName: string }[]>`
          SELECT canonical_name AS "canonicalName" FROM venues WHERE id = ${input.venueId}
        `;
        if (v?.canonicalName) venueRaw = v.canonicalName;
      }
      if (!venueRaw) venueRaw = 'AFL Venue';

      // 3. Generate the stable natural match key. A retry must not create a
      // second copy of the same fixture under a time-based suffix.
      const baseKey = `${input.season}|${roundCode}|${input.matchDate}|${input.homeClubId}|${input.awayClubId}`;
      const matchKey = baseKey;
      const [existing] = await tx<{ id: number }[]>`SELECT id FROM matches WHERE match_key = ${matchKey}`;
      if (existing) {
        throw new Error(`Match #${existing.id} already exists for that season, round, date and clubs.`);
      }

      let attendanceSourceId: number | null = null;
      if (attendance !== null) {
        const [manualSource] = await tx<{ id: number }[]>`
          SELECT id FROM sources WHERE key = 'manual_admin_edit'
        `;
        if (!manualSource) {
          throw new Error('The manual_admin_edit provenance source is not configured.');
        }
        attendanceSourceId = manualSource.id;
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
          attendance, attendance_status, attendance_source_id, match_event, notes
        ) VALUES (
          ${matchKey}, ${input.season}, ${roundCode}, ${roundNumber}, ${input.roundType}::round_type, ${isFinal},
          ${input.matchDate}::date, ${input.matchTime || null}, ${input.venueId || null}, ${venueRaw},
          ${input.homeClubId}, ${input.awayClubId},
          ${homeGoals}, ${homeBehinds}, ${homeScore},
          ${awayGoals}, ${awayBehinds}, ${awayScore},
          ${result}::match_result, ${winnerClubId}, ${margin},
          ${attendance}, ${attendanceStatus}::coverage_status, ${attendanceSourceId},
          ${input.matchEvent?.trim() || null}, ${input.notes?.trim() || null}
        )
        RETURNING id, season
      `;

      // 5. Insert quarter scores if provided
      for (const [clubId, periods] of [[input.homeClubId, input.homeQuarters], [input.awayClubId, input.awayQuarters]] as const) {
        if (!periods) continue;
        for (let p = 1; p <= 4; p++) {
          const q = periods[p];
          if (q && [q.goals, q.behinds, q.points].some((value) => value !== null && value !== undefined)) {
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

      await recomputeSeasonMetadata(tx, input.season);

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
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
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

      // player_clubs points its first/last match foreign keys at matches.
      // Remove those derived rows before deleting the authoritative match;
      // the same transaction rebuilds them from what remains below.
      await clearPlayerClubMatchReferences(tx, affectedIds);

      if (affectedIds.length > 0 && match.roundNumber !== null) {
        await tx`
          DELETE FROM brownlow_round_votes
           WHERE season = ${match.season}
             AND round_number = ${match.roundNumber}
             AND player_id = ANY(${affectedIds})
        `;
      }

      // 3. Delete dependent rows
      await tx`DELETE FROM player_achievements WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM player_match_stats WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM match_period_scores WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM matches WHERE id = ${input.matchId}`;

      await recomputePlayerDerivedStats(tx, affectedIds, match.season);
      await recomputeSeasonMetadata(tx, match.season);

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
