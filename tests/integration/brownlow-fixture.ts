/**
 * AFLDB-ISSUE-155 Phase C1 §27.27 — the reserved Brownlow workflow seasons.
 *
 * The Brownlow transactions cannot be proved against real rows. Finalising a
 * 1998 match rewrites a published historical fact, and `afldb_test` is shared:
 * a suite that mutated real Brownlow data would leave the release gates and
 * every other suite reading something a rebuild did not put there. So each
 * case here is proved over a season built for it, above every real one, and
 * removed afterwards.
 *
 * ISOLATION MODEL — COMMITTED FIXTURES, the convention
 * `tests/integration/wildcard-final-fixture.ts` established and for the same
 * reason: the code under test opens its own connections (the read model on
 * the app pool, the four transactions on a short-lived import connection), so
 * an uncommitted fixture would be invisible to it. Everything is namespaced by
 * an `issue155-<season>-` match key and player slug, and `clubs` and `sources`
 * are READ, never written.
 *
 * Seasons 2086-2088 and 2090-2099 are claimed by other suites (see the ISSUE-129
 * fixture's own note). This one takes 2089, 2085 and 2084:
 *
 *   2089  MAIN      four home-and-away matches over two rounds, every side a
 *                   full 18, plus a Wildcard Final and a Grand Final so
 *                   `not_home_and_away` has something real to refuse. Seeded
 *                   SOURCE-PUBLISHED: three `brownlow_season_votes` rows owned
 *                   by afltables, which is the state every real season starts
 *                   in and the state §27.9 calls `source_published`.
 *   2085  SHORT     two home-and-away matches, one of them a side short of the
 *                   §27.6 threshold, so participant refusal and
 *                   publish-while-incomplete are provable.
 *   2084  NO_MEDAL  one home-and-away match in a season whose coverage grid
 *                   says no medal was awarded — the 1942-45 shape.
 *
 * FAILS CLOSED on a key collision, like the ISSUE-129 fixture: a row already
 * sitting on an ISSUE-155 key is an unknown row, and adopting it would corrupt
 * whatever put it there.
 */
import postgres from 'postgres';

import { sql } from '@/db/client';
import {
  recomputeBrownlowCareerTotals,
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
} from '@/db/queries/player-derived';

export const BROWNLOW_MAIN_SEASON = 2089;
export const BROWNLOW_SHORT_SEASON = 2085;
export const BROWNLOW_NO_MEDAL_SEASON = 2084;

/** §27.6: fewer than this on either side and a match cannot be finalised. */
const FULL_SIDE = 18;
/** Deliberately below it, for the participant-incomplete case. */
const SHORT_SIDE = 10;

export type BrownlowFixtureMatch = {
  matchId: number;
  roundNumber: number | null;
  homeClubId: number;
  awayClubId: number;
  homePlayerIds: number[];
  awayPlayerIds: number[];
};

export type BrownlowFixture = {
  season: number;
  clubIds: number[];
  /** Every player seeded for the season, in club order. */
  playerIds: number[];
  /** Home-and-away matches, in fixture order. */
  matches: BrownlowFixtureMatch[];
  /** Present only on the main season. */
  wildcardFinalMatchId: number | null;
  grandFinalMatchId: number | null;
  /** The players carrying seeded source-published season totals, if any. */
  sourcePublishedPlayerIds: number[];
  cleanup: () => Promise<void>;
};

type IdRow = { id: number };

/**
 * §27.30 — cleanup must not depend on `seedBrownlowSeason` returning.
 *
 * Vitest's `beforeAll` timeout rejects the *hook*; it does not cancel the
 * in-flight seed, which keeps running on its own connection and commits every
 * statement it issues. The caller's fixture handles are assigned only from the
 * awaited return value, so on a timeout they are never assigned and an
 * `afterAll` written against them cleans up nothing at all.
 *
 * So the remover is registered the moment the namespace is claimed — before a
 * single row is written — and `afterAll` sweeps this registry instead. A
 * sweeping caller also gets `abort()`, which stops an abandoned seed at its
 * next checkpoint so its inserts are not still committing while the deletes
 * run.
 */
type SeedRegistration = {
  /** Marks the seed cancelled. Observed at its next checkpoint, immediately. */
  abort: () => void;
  /** Has the seed stopped? Distinguishes "finished" from "still running". */
  isSettled: () => boolean;
  /**
   * Destroys the seed's own connection, so an in-flight statement rejects and no
   * further statement can be issued. Memoised and safe to call repeatedly.
   */
  stop: () => Promise<void>;
  /** Settles when the seed has stopped, successfully or not. */
  settled: Promise<void>;
  remove: () => Promise<void>;
};

const seededSeasons = new Map<number, SeedRegistration>();

/**
 * Second protection only, against a seed that is genuinely hung. It is NOT the
 * cancellation mechanism: a Vitest `beforeAll` timeout at its 30s default fires
 * long before this, and correctness must not depend on either that timeout or
 * this deadline. `quiesce()` is the mechanism.
 */
const SEED_DEADLINE_MS = Number(process.env.AFLDB_BROWNLOW_SEED_DEADLINE_MS ?? 300_000);

/**
 * How long a cancelled seed is given to stop cooperatively before its connection
 * is destroyed. A cancelled seed throws at its next checkpoint, which is at most
 * one statement away, so this is generous for the normal path and short enough
 * that a seed blocked inside a statement reaches the hard stop quickly.
 */
const SEED_GRACE_MS = 2_000;

/**
 * Make it impossible for a seed to commit another row, then wait for it to stop.
 *
 * This is the ordering §27.30 needs and the reason cleanup no longer races an
 * in-flight seed. Cooperative cancellation alone cannot promise it — checkpoints
 * only fire *between* statements, so a seed blocked inside one would keep going
 * and commit while the deletes ran. Destroying the connection makes the promise
 * hard: after `stop()` resolves there is no connection left to commit on,
 * whether or not the seed's own promise has formally settled.
 */
/**
 * The test database, for the seed's own connection. `tests/integration/guard.ts`
 * has already required this and `tests/setup.ts` has already checked it names a
 * `_test` database; this is the fail-closed restatement, because the fixture
 * writes committed rows and must never do so against anything else.
 */
function seedDsn(): string {
  const dsn = process.env.AFLDB_TEST_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_TEST_DATABASE_URL must be set to seed the ISSUE-155 fixture.');
  return dsn;
}

async function quiesce(entry: SeedRegistration): Promise<void> {
  entry.abort();
  await settleWithin(entry.settled, SEED_GRACE_MS);
  if (entry.isSettled()) return;
  await entry.stop();
  await settleWithin(entry.settled, SEED_GRACE_MS);
}

/**
 * A cancellable delay. Cancelling matters: the settle wait is raced against a
 * seed that has normally already finished, and an uncancelled timer would keep
 * the process alive for SEED_GRACE_MS after every healthy run.
 */
function bounded(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); } };
}

/** Wait for `settled`, but never longer than `ms`. */
async function settleWithin(settled: Promise<void>, ms: number): Promise<void> {
  const wait = bounded(ms);
  try {
    await Promise.race([settled, wait.promise]);
  } finally {
    wait.cancel();
  }
}

/**
 * Remove every season this module has seeded, newest claim first, and forget
 * it. Idempotent: a season already removed through its own handle is gone from
 * the registry and a second `removeSeeded` would delete nothing anyway.
 *
 * FAILS CLOSED. A season whose removal throws stays registered and the error is
 * re-raised, so the suite fails rather than reporting green over rows it left in
 * `afldb_test`.
 */
export async function cleanupSeededBrownlowSeasons(): Promise<void> {
  const entries = [...seededSeasons.entries()].sort(([a], [b]) => b - a);
  const failures: string[] = [];
  for (const [season, entry] of entries) {
    try {
      // Cancel and quiesce BEFORE deleting: only once the seed can no longer
      // commit is it safe to remove what it wrote.
      await quiesce(entry);
      await entry.remove();
      seededSeasons.delete(season);
    } catch (error) {
      failures.push(`${season}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      'ISSUE-155 fixture cleanup failed; afldb_test still holds fixture rows for '
      + `${failures.join('; ')}. Remove them before the next run: the fixture's `
      + 'collision guard will refuse it.',
    );
  }
}

const STAT_LINE = {
  kicks: 11, marks: 4, handballs: 7, disposals: 18, goals: 1, behinds: 1,
  hitouts: 0, tackles: 3, freesFor: 1, freesAgainst: 1,
};

type FixtureShape = {
  /** One entry per home-and-away match: [homeClubIndex, awayClubIndex, roundNumber, sideSize]. */
  homeAndAway: Array<{ home: number; away: number; round: number; homeSide: number; awaySide: number }>;
  finals: boolean;
  /** Seed source-published `brownlow_season_votes` rows for this many players. */
  sourcePublishedPlayers: number;
  /** `brownlow_season_total` coverage for the season. */
  coverage: 'complete' | 'not_applicable';
};

const SHAPES: Record<number, FixtureShape> = {
  [BROWNLOW_MAIN_SEASON]: {
    homeAndAway: [
      { home: 0, away: 1, round: 1, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
      { home: 2, away: 3, round: 1, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
      { home: 0, away: 2, round: 2, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
      { home: 1, away: 3, round: 2, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
    ],
    finals: true,
    sourcePublishedPlayers: 3,
    coverage: 'complete',
  },
  [BROWNLOW_SHORT_SEASON]: {
    homeAndAway: [
      { home: 0, away: 1, round: 1, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
      { home: 2, away: 3, round: 1, homeSide: FULL_SIDE, awaySide: SHORT_SIDE },
    ],
    finals: false,
    sourcePublishedPlayers: 0,
    coverage: 'complete',
  },
  [BROWNLOW_NO_MEDAL_SEASON]: {
    homeAndAway: [
      { home: 0, away: 1, round: 1, homeSide: FULL_SIDE, awaySide: FULL_SIDE },
    ],
    finals: false,
    sourcePublishedPlayers: 0,
    coverage: 'not_applicable',
  },
};

export async function seedBrownlowSeason(season: number): Promise<BrownlowFixture> {
  const shape = SHAPES[season];
  if (!shape) throw new Error(`No ISSUE-155 fixture shape is defined for season ${season}.`);

  const prefix = `issue155-${season}-`;

  const collisions = await sql<{ matchKey: string }[]>`
    SELECT match_key AS "matchKey" FROM matches WHERE match_key LIKE ${`${prefix}%`}
  `;
  if (collisions.length > 0) {
    throw new Error(
      'Refusing to run: matches rows already exist on ISSUE-155 fixture keys '
      + `(${collisions.map((row) => row.matchKey).join(', ')}). Remove them deliberately.`,
    );
  }
  const existingSeason = await sql<{ year: number }[]>`
    SELECT year FROM seasons WHERE year = ${season}
  `;
  if (existingSeason.length > 0) {
    throw new Error(`Refusing to run: seasons(${season}) already exists.`);
  }

  // Four existing club identities, read and never written. Distinct
  // organization_id keeps player_career_stats.clubs_played honest.
  const clubs = await sql<IdRow[]>`
    SELECT DISTINCT ON (organization_id) id::int AS id
      FROM clubs
     WHERE organization_id IS NOT NULL
     ORDER BY organization_id, id
     LIMIT 4
  `;
  if (clubs.length < 4) throw new Error('the ISSUE-155 fixture needs four club identities');
  const clubIds = clubs.map((row) => row.id);

  const [{ id: sourceId }] = await sql<IdRow[]>`
    SELECT id::int AS id FROM sources WHERE key = 'afltables'
  `;

  const seededPlayerIds: number[] = [];
  const removeSeeded = async (): Promise<void> => {
    // Order is FK order. brownlow_vote_entry_state RESTRICTs the match delete
    // (§27.15), which is the whole point of that key, so it goes first.
    const matchIds = await sql<IdRow[]>`
      SELECT id::int AS id FROM matches WHERE match_key LIKE ${`${prefix}%`}
    `;
    const ids = matchIds.map((row) => row.id);
    if (ids.length > 0) {
      await sql`DELETE FROM data_edits
                 WHERE table_name = 'brownlow_vote_entry_state' AND row_id = ANY(${ids})`;
      await sql`DELETE FROM brownlow_vote_entry_state WHERE match_id = ANY(${ids})`;
    }
    await sql`DELETE FROM data_edits
               WHERE table_name = 'brownlow_season_authority' AND row_id = ${season}`;
    await sql`DELETE FROM data_edits
               WHERE table_name = 'matches' AND row_id = ANY(${ids.length > 0 ? ids : [0]})`;
    await sql`DELETE FROM brownlow_season_authority WHERE season = ${season}`;
    await sql`DELETE FROM brownlow_round_votes WHERE season = ${season}`;
    await sql`DELETE FROM brownlow_season_votes WHERE season = ${season}`;
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
    await sql`DELETE FROM stat_availability WHERE season = ${season}`;
    await sql`DELETE FROM seasons WHERE year = ${season}`;
  };

  // An abandoned seed is removed by two paths at once — this function's own
  // `catch` and the registry sweep — so the removal runs once and both await the
  // same result. A cached rejection is the point: a failed removal must keep
  // failing rather than look clean on the second ask.
  let removal: Promise<void> | undefined;
  const removeOnce = (): Promise<void> => {
    removal ??= removeSeeded();
    return removal;
  };

  // Every write `seed()` makes goes through this connection and nothing else
  // does, so destroying it is a hard guarantee that the seed cannot commit
  // another row. `removeSeeded` deliberately stays on the shared pool, so
  // cleanup still works after the seed connection is gone.
  const seedSql = postgres(seedDsn(), { max: 1, onnotice: () => {} });

  let cancelled = false;
  let settledFlag = false;
  let stopped: Promise<void> | undefined;
  const stopSeedConnection = (): Promise<void> => {
    stopped ??= seedSql.end({ timeout: 0 }).then(() => undefined, () => undefined);
    return stopped;
  };

  // §27.30. The namespace is claimed once the guards above have passed, so the
  // registration — the cancellation signal, the in-flight state, the hard stop
  // and the remover — exists before `seed()` writes anything, and stays reachable
  // whether or not this function ever returns.
  const entry: SeedRegistration = {
    abort: () => { cancelled = true; },
    isSettled: () => settledFlag,
    stop: stopSeedConnection,
    settled: Promise.resolve(),
    remove: removeOnce,
  };
  seededSeasons.set(season, entry);

  /**
   * Cancellation observed immediately, not on a timer: `seed()` checks the flag
   * between statements, so an abandoned seed stops at most one statement after
   * the sweep cancels it.
   */
  const abortIfCancelled = (): void => {
    if (cancelled) {
      throw new Error(
        `seedBrownlowSeason(${season}) was cancelled; it stopped at its next checkpoint.`,
      );
    }
  };

  let deadline: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      cancelled = true;
      reject(new Error(
        `seedBrownlowSeason(${season}) exceeded its ${SEED_DEADLINE_MS}ms internal deadline. `
        + 'Its rows have been removed. Set AFLDB_BROWNLOW_SEED_DEADLINE_MS to raise it.',
      ));
    }, SEED_DEADLINE_MS);
  });

  const seedPromise = seed();
  // Attached immediately, so a rejection that loses the race below is never an
  // unhandled rejection, and so `isSettled()` is true the moment the seed stops.
  const settled = seedPromise.then(
    () => { settledFlag = true; },
    () => { settledFlag = true; },
  );
  entry.settled = settled;

  try {
    return await Promise.race([seedPromise, expiry]);
  } catch (error) {
    // The seed may still be in flight — on the deadline path it certainly is.
    // Quiesce first: nothing is deleted until the seed cannot commit again.
    await quiesce(entry);
    await removeOnce();
    seededSeasons.delete(season);
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    // Seeding is over on every path; the dedicated connection has no further
    // purpose and must not be left open.
    await stopSeedConnection();
  }

  async function seed(): Promise<BrownlowFixture> {
    await seedSql`
      INSERT INTO seasons (year, league, status)
      VALUES (${season}, 'AFL', 'complete'::season_status)
    `;

    const insertMatch = async (
      key: string, roundCode: string, roundNumber: number | null, roundType: string,
      isFinal: boolean, date: string, home: number, away: number,
    ): Promise<number> => {
      abortIfCancelled();
      const [row] = await seedSql<IdRow[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_score, away_score, result, winner_club_id, margin,
          attendance, attendance_status, source_id
        ) VALUES (
          ${`${prefix}${key}`}, ${season}, ${roundCode}, ${roundNumber},
          ${roundType}::round_type, ${isFinal},
          ${date}, 'ISSUE-155 Fixture Oval', ${home}, ${away},
          100, 80, 'home_win'::match_result, ${home}, 20,
          NULL, 'not_collected'::coverage_status, ${sourceId}
        )
        RETURNING id::int AS id
      `;
      return row.id;
    };

    // 18 (or 10) players per club, reused across that club's matches in the
    // season, so a player's season record is a real one rather than one
    // appearance per fixture row.
    const clubPlayers: number[][] = [];
    for (let clubIndex = 0; clubIndex < clubIds.length; clubIndex += 1) {
      const ids: number[] = [];
      for (let n = 0; n < FULL_SIDE; n += 1) {
        abortIfCancelled();
        const slug = `${prefix}c${clubIndex}-p${n}`;
        const name = `Issue155 ${season} C${clubIndex} P${n}`;
        const [row] = await seedSql<IdRow[]>`
          INSERT INTO players (display_name, sort_name, search_name, slug)
          VALUES (${name}, ${name}, ${name.toLowerCase()}, ${slug})
          RETURNING id::int AS id
        `;
        ids.push(row.id);
        seededPlayerIds.push(row.id);
      }
      clubPlayers.push(ids);
    }

    const insertStats = async (
      playerId: number, matchId: number, clubId: number, jumper: number,
    ): Promise<void> => {
      abortIfCancelled();
      await seedSql`
        INSERT INTO player_match_stats (
          player_id, match_id, club_id, jumper_number, kicks, marks, handballs,
          disposals, goals, behinds, hitouts, tackles, frees_for, frees_against,
          source_id
        ) VALUES (
          ${playerId}, ${matchId}, ${clubId}, ${String(jumper)},
          ${STAT_LINE.kicks}, ${STAT_LINE.marks}, ${STAT_LINE.handballs},
          ${STAT_LINE.disposals}, ${STAT_LINE.goals}, ${STAT_LINE.behinds},
          ${STAT_LINE.hitouts}, ${STAT_LINE.tackles},
          ${STAT_LINE.freesFor}, ${STAT_LINE.freesAgainst}, ${sourceId}
        )
      `;
    };

    const matches: BrownlowFixtureMatch[] = [];
    for (let index = 0; index < shape.homeAndAway.length; index += 1) {
      const entry = shape.homeAndAway[index];
      const home = clubIds[entry.home];
      const away = clubIds[entry.away];
      const day = String(index + 5).padStart(2, '0');
      const matchId = await insertMatch(
        `ha${index}`, String(entry.round), entry.round, 'home_and_away', false,
        `${season}-03-${day}`, home, away,
      );
      const homePlayerIds = clubPlayers[entry.home].slice(0, entry.homeSide);
      const awayPlayerIds = clubPlayers[entry.away].slice(0, entry.awaySide);
      let jumper = 1;
      for (const playerId of homePlayerIds) await insertStats(playerId, matchId, home, jumper++);
      jumper = 1;
      for (const playerId of awayPlayerIds) await insertStats(playerId, matchId, away, jumper++);
      matches.push({
        matchId, roundNumber: entry.round, homeClubId: home, awayClubId: away,
        homePlayerIds, awayPlayerIds,
      });
    }

    let wildcardFinalMatchId: number | null = null;
    let grandFinalMatchId: number | null = null;
    if (shape.finals) {
      // Two matches that are NOT home-and-away, so §27.6's refusal has a real
      // subject on both sides of the ISSUE-129 wildcard distinction.
      wildcardFinalMatchId = await insertMatch(
        'wf', 'WF', null, 'wildcard_final', true, `${season}-08-28`, clubIds[0], clubIds[1],
      );
      grandFinalMatchId = await insertMatch(
        'gf', 'GF', null, 'grand_final', true, `${season}-09-26`, clubIds[0], clubIds[2],
      );
      let jumper = 1;
      for (const playerId of clubPlayers[0]) {
        await insertStats(playerId, wildcardFinalMatchId, clubIds[0], jumper);
        await insertStats(playerId, grandFinalMatchId, clubIds[0], jumper);
        jumper += 1;
      }
      jumper = 1;
      for (const playerId of clubPlayers[1]) {
        await insertStats(playerId, wildcardFinalMatchId, clubIds[1], jumper++);
      }
      jumper = 1;
      for (const playerId of clubPlayers[2]) {
        await insertStats(playerId, grandFinalMatchId, clubIds[2], jumper++);
      }
    }

    const playerIds = clubPlayers.flat();

    // The derived record publication reads: `deriveSeasonRows` refuses a polled
    // player with no player_season_stats row rather than defaulting his games,
    // so the fixture builds it with the production builders, never by hand.
    abortIfCancelled();
    await seedSql.begin(async (tx) => {
      await recomputeClubSeasons(tx, season);
      await recomputePlayerDerivedStats(tx, playerIds, season);
    });

    // The coverage grid. `lockMatch` refuses every mutation in a season whose
    // brownlow_season_total coverage is `not_applicable`, which is how
    // 1942-45 stays un-enterable, so this row decides whether the season is
    // administrable at all.
    const coverage = shape.coverage;
    abortIfCancelled();
    await seedSql`
      INSERT INTO stat_availability (stat_key, season, is_recorded, coverage)
      VALUES ('brownlow_season_total', ${season}, ${coverage === 'complete'},
              ${coverage}::coverage_status)
      ON CONFLICT (stat_key, season) DO UPDATE
         SET is_recorded = EXCLUDED.is_recorded, coverage = EXCLUDED.coverage
    `;

    // Source-published season totals: the state §27.9 calls `source_published`
    // and the state every real season is in before anyone administers it.
    // Owned by afltables, so a finalisation must leave them completely alone.
    //
    // `games` is read back from player_season_stats rather than assumed, for
    // the same reason preflight P13(i) had to measure it: the artefact stores
    // home-and-away games only, and a hand-guessed number here would make the
    // fixture's own rows unlike the ones publication derives.
    const sourcePublishedPlayerIds = playerIds.slice(0, shape.sourcePublishedPlayers);
    for (let index = 0; index < sourcePublishedPlayerIds.length; index += 1) {
      abortIfCancelled();
      const playerId = sourcePublishedPlayerIds[index];
      const votes = 20 - index * 5;
      const [record] = await seedSql<{ homeAndAway: number }[]>`
        SELECT (games - COALESCE(finals, 0))::int AS "homeAndAway"
          FROM player_season_stats
         WHERE player_id = ${playerId} AND season = ${season}
      `;
      await seedSql`
        INSERT INTO brownlow_season_votes (
          season, player_id, club_id, votes, vote_rank, eligible_rank,
          is_ineligible, is_winner, games,
          three_vote_games, two_vote_games, one_vote_games, polling_games,
          link_status_value, source_id, source_record_id, import_batch_id
        ) VALUES (
          ${season}, ${playerId}, NULL, ${votes},
          ${index + 1}, ${index + 1}, false, ${index === 0},
          ${record.homeAndAway}, ${index === 0 ? 2 : null}, NULL, NULL, ${index + 1},
          'unique', ${sourceId}, ${`${prefix}season-${index}`}, NULL
        )
      `;
    }

    // Career totals now disagree with the season rows just inserted, and
    // db-health's reconciliation is table-wide: a fixture that left that drift
    // behind would make its own assertions unprovable. The production narrow
    // rebuild is what closes it, which is also a small proof it works.
    if (sourcePublishedPlayerIds.length > 0) {
      abortIfCancelled();
      await seedSql.begin(async (tx) => {
        await recomputeSeasonBrownlowStatus(tx, season);
        await recomputeBrownlowCareerTotals(tx, sourcePublishedPlayerIds);
      });
    }

    return {
      season,
      clubIds,
      playerIds,
      matches,
      wildcardFinalMatchId,
      grandFinalMatchId,
      sourcePublishedPlayerIds,
      // Deregisters as well as removes, so a caller that cleans up through the
      // handle and a caller that sweeps the registry cannot fight over it.
      cleanup: async () => {
        await removeOnce();
        seededSeasons.delete(season);
      },
    };
  }
}
