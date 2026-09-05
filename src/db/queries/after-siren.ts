import 'server-only';

import { sql } from '@/db/client';

export type PlayerAfterSirenEvent = {
  id: number;
  season: number;
  roundRaw: string;
  competition: string;
  premiershipSeason: boolean;
  clubId: number | null;
  clubName: string;
  clubSlug: string | null;
  opponentClubId: number | null;
  opponentName: string;
  opponentSlug: string | null;
  matchId: number | null;
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  kickerResult: 'win' | 'draw' | 'loss';
  siren: 'final' | 'end_of_regulation' | 'end_of_extra_time';
  kickerScoreRaw: string;
  opponentScoreRaw: string;
  cited: boolean;
};

/**
 * A player's after-the-siren kicks, from the canonical `after_siren_kicks`
 * table (migration 089, AFLDB-ISSUE-118 §23.33/§23.34). Read-only exposure:
 * this never recomputes, imports or corrects an event, it only shapes the
 * public fields a profile needs -- internal provenance (source_id,
 * source_record_id, candidate_count, link_status) stays off the page, the
 * same discipline every other public read model here follows.
 *
 * The kicker's own club and the opponent are both resolved to a canonical
 * club when the source's club string links to one; `clubSlug` /
 * `opponentSlug` are null otherwise, same fallback-to-raw-name convention as
 * `getPlayerMatches`.
 */
export async function getPlayerAfterSirenEvents(playerId: number): Promise<PlayerAfterSirenEvent[]> {
  return sql<PlayerAfterSirenEvent[]>`
    SELECT a.id, a.season, a.round_raw AS "roundRaw", a.competition,
           a.premiership_season AS "premiershipSeason",
           a.club_id AS "clubId", COALESCE(cl.name, a.club_name_raw) AS "clubName", cl.slug AS "clubSlug",
           a.opponent_club_id AS "opponentClubId",
           COALESCE(op.name, a.opponent_name_raw) AS "opponentName", op.slug AS "opponentSlug",
           a.match_id AS "matchId",
           a.kick_scored AS "kickScored", a.kick_effect AS "kickEffect",
           a.kicker_result AS "kickerResult", a.siren,
           a.kicker_score_raw AS "kickerScoreRaw", a.opponent_score_raw AS "opponentScoreRaw",
           a.cited
      FROM after_siren_kicks a
      LEFT JOIN clubs cl ON cl.id = a.club_id
      LEFT JOIN clubs op ON op.id = a.opponent_club_id
     WHERE a.player_id = ${playerId}
     ORDER BY a.season DESC, a.id DESC
  `;
}
