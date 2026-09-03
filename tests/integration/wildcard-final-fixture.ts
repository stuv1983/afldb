/**
 * AFLDB-ISSUE-129 §11 T8-T11 — the shared Wildcard Final fixture season.
 *
 * The §8.4 semantics cannot be proved against real 2026 rows: whether a club
 * loses a Wildcard Final and then plays no other final is a fact about a
 * season still in progress, and an acceptance case may not depend on how the
 * 2026 finals happen to fall. So each suite builds the exact shape the
 * decision talks about, over a reserved season of its own.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES, the convention
 * `tests/integration/settle-afltables.test.ts` established. The answer
 * functions under test (`answerClubSeason`, the Grid Solver builders,
 * `db-health`) open their own reads through the shared client, so an
 * uncommitted fixture would be invisible to them. Everything seeded here is
 * committed and then removed by `cleanup()`, and every row is namespaced: a
 * reserved season above every real one, an `issue129-` match-key prefix, and
 * an `issue129-` player slug prefix. `clubs` and `sources` are READ, never
 * written.
 *
 * Seasons 2086 and 2090-2094 and 2098-2099 are already claimed by other
 * integration suites; the three ISSUE-129 consumers take 2095, 2096 and 2097
 * so the suites stay parallel-safe.
 *
 * The shape, one home-and-away round plus a two-match finals fringe:
 *
 *   H&A r1   A def B      both clubs get a real home-and-away record
 *   H&A r1   C def D
 *   WF       A def B      wildcard_final: is_final = true, is_finals_series = false
 *   EF       A def C      elimination_final: a real finals-series appearance
 *
 * So club B loses the Wildcard Final and plays no other final — the §8.4
 * 9th-placed club — and club A wins it and then plays one genuine final.
 * `wildcardOnlyPlayer` appears in the Wildcard Final and nowhere else, on the
 * WINNING side of it; `finalsSeriesPlayer` appears in the Elimination Final, as
 * the control.
 */
import { sql } from '@/db/client';
import { recomputeClubSeasons, recomputePlayerDerivedStats } from '@/db/queries/player-derived';

export type WildcardFixture = {
  season: number;
  /** Won the Wildcard Final and played an Elimination Final: finals_played = 1. */
  wildcardWinnerClubId: number;
  /** Lost the Wildcard Final and played no other final: finals_played = 0. */
  wildcardLoserClubId: number;
  /** Lost the Elimination Final: finals_played = 1. */
  eliminationLoserClubId: number;
  /** Played the home-and-away round only. */
  homeAndAwayOnlyClubId: number;
  wildcardMatchId: number;
  eliminationMatchId: number;
  /** Played the Wildcard Final and nothing else, for `wildcardWinnerClubId`. */
  wildcardOnlyPlayerId: number;
  /** Played the Elimination Final and nothing else, for `eliminationLoserClubId`. */
  finalsSeriesPlayerId: number;
  cleanup: () => Promise<void>;
};

type ClubRow = { id: number };
type IdRow = { id: number };

const STAT_LINE = {
  kicks: 12, marks: 4, handballs: 8, disposals: 20, goals: 2, behinds: 1,
  hitouts: 0, tackles: 3, freesFor: 1, freesAgainst: 1,
};

/**
 * Seed the fixture season and return its ids.
 *
 * FAILS CLOSED on a key collision, the same way the settle suite does: a row
 * already sitting on an ISSUE-129 key is an unknown row, and adopting it
 * would corrupt whatever put it there.
 */
export async function seedWildcardFinalSeason(season: number): Promise<WildcardFixture> {
  const prefix = `issue129-${season}-`;

  const collisions = await sql<{ matchKey: string }[]>`
    SELECT match_key AS "matchKey" FROM matches WHERE match_key LIKE ${`${prefix}%`}
  `;
  if (collisions.length > 0) {
    throw new Error(
      `Refusing to run: matches rows already exist on ISSUE-129 fixture keys `
      + `(${collisions.map((row) => row.matchKey).join(', ')}). Remove them deliberately.`,
    );
  }
  const seasonRows = await sql<{ year: number }[]>`
    SELECT year FROM seasons WHERE year = ${season}
  `;
  if (seasonRows.length > 0) {
    throw new Error(`Refusing to run: seasons(${season}) already exists.`);
  }

  // Four existing club identities, read and never written. Distinct
  // organization_id keeps player_career_stats.clubs_played honest.
  const clubs = await sql<ClubRow[]>`
    SELECT DISTINCT ON (organization_id) id::int AS id
      FROM clubs
     WHERE organization_id IS NOT NULL
     ORDER BY organization_id, id
     LIMIT 4
  `;
  if (clubs.length < 4) throw new Error('fixture needs four club identities');
  const [a, b, c, d] = clubs.map((row) => row.id);

  const [{ id: sourceId }] = await sql<IdRow[]>`
    SELECT id::int AS id FROM sources WHERE key = 'afltables'
  `;

  // Ids collected as they are created, so a seed that fails half-way can still
  // remove what it committed rather than leaving a season row behind that
  // blocks the next run.
  const seededPlayerIds: number[] = [];
  const removeSeeded = async (): Promise<void> => {
    if (seededPlayerIds.length > 0) {
      await sql`DELETE FROM player_match_stats WHERE player_id = ANY(${seededPlayerIds})`;
      await sql`DELETE FROM player_career_stats WHERE player_id = ANY(${seededPlayerIds})`;
      await sql`DELETE FROM player_season_stats WHERE player_id = ANY(${seededPlayerIds})`;
      await sql`DELETE FROM player_club_season_stats WHERE player_id = ANY(${seededPlayerIds})`;
      await sql`DELETE FROM player_clubs WHERE player_id = ANY(${seededPlayerIds})`;
      await sql`DELETE FROM players WHERE id = ANY(${seededPlayerIds})`;
    }
    await sql`DELETE FROM club_seasons WHERE season = ${season}`;
    await sql`DELETE FROM matches WHERE match_key LIKE ${`${prefix}%`}`;
    await sql`DELETE FROM seasons WHERE year = ${season}`;
  };

  try {
    return await seed();
  } catch (error) {
    await removeSeeded();
    throw error;
  }

  async function seed(): Promise<WildcardFixture> {
  await sql`
    INSERT INTO seasons (year, league, status)
    VALUES (${season}, 'AFL', 'complete'::season_status)
  `;

  const insertMatch = async (
    key: string, roundCode: string, roundNumber: number | null, roundType: string,
    isFinal: boolean, date: string, home: number, away: number,
    homeScore: number, awayScore: number,
  ): Promise<number> => {
    const [row] = await sql<IdRow[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_number, round_type, is_final,
        match_date, venue_raw, home_club_id, away_club_id,
        home_score, away_score, result, winner_club_id, margin,
        attendance, attendance_status, source_id
      ) VALUES (
        ${`${prefix}${key}`}, ${season}, ${roundCode}, ${roundNumber},
        ${roundType}::round_type, ${isFinal},
        ${date}, 'ISSUE-129 Fixture Oval', ${home}, ${away},
        ${homeScore}, ${awayScore}, 'home_win'::match_result, ${home},
        ${homeScore - awayScore},
        NULL, 'not_collected'::coverage_status, ${sourceId}
      )
      RETURNING id::int AS id
    `;
    return row.id;
  };

  await insertMatch('ha-ab', '1', 1, 'home_and_away', false, `${season}-03-05`, a, b, 100, 80);
  await insertMatch('ha-cd', '1', 1, 'home_and_away', false, `${season}-03-06`, c, d, 90, 70);
  const wildcardMatchId = await insertMatch(
    'wf', 'WF', null, 'wildcard_final', true, `${season}-08-28`, a, b, 96, 93,
  );
  const eliminationMatchId = await insertMatch(
    'ef', 'EF', null, 'elimination_final', true, `${season}-09-04`, a, c, 88, 60,
  );

  const insertPlayer = async (slug: string, name: string): Promise<number> => {
    const [row] = await sql<IdRow[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${name}, ${name}, ${name.toLowerCase()}, ${`${prefix}${slug}`})
      RETURNING id::int AS id
    `;
    return row.id;
  };

  const wildcardOnlyPlayerId = await insertPlayer('wildcard-only', `Issue129 Wildcard ${season}`);
  seededPlayerIds.push(wildcardOnlyPlayerId);
  const finalsSeriesPlayerId = await insertPlayer('finals-series', `Issue129 Finalist ${season}`);
  seededPlayerIds.push(finalsSeriesPlayerId);

  const insertStats = async (playerId: number, matchId: number, clubId: number): Promise<void> => {
    await sql`
      INSERT INTO player_match_stats (
        player_id, match_id, club_id, kicks, marks, handballs, disposals,
        goals, behinds, hitouts, tackles, frees_for, frees_against, source_id
      ) VALUES (
        ${playerId}, ${matchId}, ${clubId}, ${STAT_LINE.kicks}, ${STAT_LINE.marks},
        ${STAT_LINE.handballs}, ${STAT_LINE.disposals}, ${STAT_LINE.goals},
        ${STAT_LINE.behinds}, ${STAT_LINE.hitouts}, ${STAT_LINE.tackles},
        ${STAT_LINE.freesFor}, ${STAT_LINE.freesAgainst}, ${sourceId}
      )
    `;
  };

  // Deliberately on the WINNING side of the Wildcard Final: "won a final" must
  // still be false for them (ISSUE-129 §8.4), which a losing-side fixture could
  // never prove.
  await insertStats(wildcardOnlyPlayerId, wildcardMatchId, a);
  await insertStats(finalsSeriesPlayerId, eliminationMatchId, c);

  // The derived aggregates under test, rebuilt by the production builders
  // rather than hand-written here — the point of T8/T9/T10 is what those
  // builders compute from a wildcard_final row.
  await sql.begin(async (tx) => {
    await recomputeClubSeasons(tx, season);
    await recomputePlayerDerivedStats(tx, [wildcardOnlyPlayerId, finalsSeriesPlayerId], season);
  });

  return {
    season,
    wildcardWinnerClubId: a,
    wildcardLoserClubId: b,
    eliminationLoserClubId: c,
    homeAndAwayOnlyClubId: d,
    wildcardMatchId,
    eliminationMatchId,
    wildcardOnlyPlayerId,
    finalsSeriesPlayerId,
    cleanup: removeSeeded,
  };
  }
}
