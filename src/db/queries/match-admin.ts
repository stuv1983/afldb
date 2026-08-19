import 'server-only';

import postgres from 'postgres';
import { authSql } from '@/db/authClient';

export type QuarterScoreInput = {
  goals?: number | null;
  behinds?: number | null;
  points?: number | null;
};

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
  const homeScore = input.homeScore !== null && input.homeScore !== undefined
    ? Number(input.homeScore)
    : ((homeGoals ?? 0) * 6 + (homeBehinds ?? 0));

  const awayGoals = input.awayGoals !== null && input.awayGoals !== undefined ? Number(input.awayGoals) : null;
  const awayBehinds = input.awayBehinds !== null && input.awayBehinds !== undefined ? Number(input.awayBehinds) : null;
  const awayScore = input.awayScore !== null && input.awayScore !== undefined
    ? Number(input.awayScore)
    : ((awayGoals ?? 0) * 6 + (awayBehinds ?? 0));

  const margin = Math.abs(homeScore - awayScore);
  const result: 'home_win' | 'away_win' | 'draw' =
    homeScore > awayScore ? 'home_win' : (awayScore > homeScore ? 'away_win' : 'draw');
  const winnerClubId = result === 'home_win' ? input.homeClubId : (result === 'away_win' ? input.awayClubId : null);

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      // 1. Ensure season row exists
      const league = input.season >= 1990 ? 'AFL' : 'VFL';
      await tx`
        INSERT INTO seasons (year, league, is_complete)
        VALUES (${input.season}, ${league}, false)
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
          attendance, match_event, notes
        ) VALUES (
          ${matchKey}, ${input.season}, ${roundCode}, ${roundNumber}, ${input.roundType}::round_type, ${isFinal},
          ${input.matchDate}::date, ${input.matchTime || null}, ${input.venueId || null}, ${venueRaw},
          ${input.homeClubId}, ${input.awayClubId},
          ${homeGoals}, ${homeBehinds}, ${homeScore},
          ${awayGoals}, ${awayBehinds}, ${awayScore},
          ${result}::match_result, ${winnerClubId}, ${margin},
          ${input.attendance || null}, ${input.matchEvent?.trim() || null}, ${input.notes?.trim() || null}
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
