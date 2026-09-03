/**
 * Integration tests against the real afldb_test database.
 *
 * These verify PostgreSQL behaviour — constraints, indexes, search and
 * aggregation — so PostgreSQL is deliberately not mocked. afldb_test
 * carries the full migrated dataset, because a query that is fast and
 * correct against 100 rows proves nothing about 694,210.
 */
import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { reconcileCareerTotals } from '@/db/queries/db-health';
import { searchAdminMatches } from '@/db/queries/match-admin';
import { runMatchSearch } from '@/db/queries/match-search';
import { getSeasonMatches } from '@/db/queries/matches';
import { getPlayerMatches } from '@/db/queries/players';
import { getSeasonRoundLadder } from '@/db/queries/rounds';
import { searchRounds } from '@/db/queries/search';
import { formatRound, formatRoundShort } from '@/lib/format';
import { seedWildcardFinalSeason, type WildcardFixture } from './wildcard-final-fixture';
import type { MatchType } from '@/search/match-spec';
import type { NlGrain } from '@/search/nl/plan';

const SUPPORTED_NL_GRAINS = {
  player_career: true,
  player_game: true,
  player_season: true,
  team_match: true,
  club_season: true,
  team_streak: true,
  head_to_head: true,
  achievement_summary: true,
} satisfies Record<NlGrain, true>;

afterAll(async () => {
  await sql.end();
});

/** Thrown to force a rollback once a statement has been accepted. */
class Rollback extends Error {}

/**
 * Assert a statement is rejected, without leaving anything behind.
 *
 * These tests previously issued bare INSERTs. That is safe only while the
 * constraints hold: the first run after a constraint regressed would
 * COMMIT the bogus row, and later runs would then "pass" because the
 * duplicate key threw instead of the constraint — a regression that hides
 * itself after one run.
 *
 * The statement now runs inside a transaction that always ends in a
 * throw, so nothing is ever committed either way, and `accepted` records
 * which of the two throws happened.
 */
async function expectRejected(
  statement: (tx: typeof sql) => Promise<unknown>,
): Promise<void> {
  let accepted = false;
  await expect(
    sql.begin(async (tx) => {
      await statement(tx as unknown as typeof sql);
      accepted = true;
      throw new Rollback('statement was accepted');
    }),
  ).rejects.toThrow();
  expect(accepted).toBe(false);
}

describe('schema', () => {
  it('has pg_trgm and unaccent enabled', async () => {
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
    `;
    expect(rows.map((r) => r.extname).sort()).toEqual(['pg_trgm', 'unaccent']);
  });

  it('normalises names consistently with the search columns', async () => {
    const [row] = await sql<{ a: string; b: string; c: string }[]>`
      SELECT afldb_normalise_name('Anthony McDonald-Tipungwuti') AS a,
             afldb_normalise_name($$Jack O'Brien$$)              AS b,
             afldb_normalise_name('  Nic   Naitanui  ')          AS c
    `;
    // Hyphens become spaces so each part stays independently searchable.
    expect(row.a).toBe('anthony mcdonald tipungwuti');
    expect(row.b).toBe('jack obrien');
    expect(row.c).toBe('nic naitanui');
  });

  it('accepts every supported NL telemetry grain including head_to_head', async () => {
    const grains = Object.keys(SUPPORTED_NL_GRAINS) as NlGrain[];
    const inserted: NlGrain[] = [];

    await expect(
      sql.begin(async (tx) => {
        const database = tx as unknown as typeof sql;
        for (const grain of grains) {
          const [row] = await database<{ grain: NlGrain }[]>`
            INSERT INTO nl_search_log (
              question, outcome, grain, result_count, duration_ms
            )
            VALUES (
              ${`NL grain schema contract: ${grain}`}, 'answered', ${grain}, 1, 0
            )
            RETURNING grain
          `;
          inserted.push(row.grain);
        }
        throw new Rollback('accepted NL grain rows');
      }),
    ).rejects.toThrow('accepted NL grain rows');

    expect(inserted.sort()).toEqual([...grains].sort());
    expect(inserted).toContain('head_to_head');
  });

  it('refuses a match whose margin disagrees with its scores', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_score, away_score, result, winner_club_id, margin)
      VALUES ('bogus-margin', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 2, 100, 50, 'home_win', 1, 999)
    `);
  });

  it('refuses a Brownlow vote outside 0-3 in a single game', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO player_match_stats (player_id, match_id, club_id, brownlow_votes)
      VALUES (1, 1, 1, 9)
    `);
  });

  it('refuses a match between a club and itself', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_score, away_score, result, margin)
      VALUES ('bogus-self', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 1, 10, 10, 'draw', 0)
    `);
  });

  // Migration 022. The importer derives result from the scores, so the
  // data has always agreed; nothing stopped a future writer disagreeing.
  it('refuses a home_win the away team actually won', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_score, away_score, result, winner_club_id, margin)
      VALUES ('bogus-result', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 2, 50, 100, 'home_win', 1, 50)
    `);
  });

  it('refuses a draw whose scores differ', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_score, away_score, result, margin)
      VALUES ('bogus-draw', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 2, 60, 50, 'draw', 10)
    `);
  });

  it('refuses a score that disagrees with its goals and behinds', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_goals, home_behinds, home_score,
                           away_goals, away_behinds, away_score,
                           result, winner_club_id, margin)
      VALUES ('bogus-components', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 2, 10, 5, 999, 5, 5, 35, 'home_win', 1, 964)
    `);
  });

  it('refuses a negative score', async () => {
    await expectRejected((tx) => tx`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type,
                           is_final, match_date, venue_raw, home_club_id, away_club_id,
                           home_score, away_score, result, winner_club_id, margin)
      VALUES ('bogus-negative', 2000, '1', 1, 'home_and_away', false, '2000-01-01',
              'Nowhere', 1, 2, -10, 50, 'away_win', 2, 60)
    `);
  });
});

describe('data integrity', () => {
  it('has the full player-match dataset', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_match_stats
    `;
    // AFLDB-ISSUE-108: re-pinned to the accepted canonical baseline
    // full-history-20260827 (measured.player_match_rows = 685,471). 694,210 was
    // the retired legacy SQLite import.
    expect(row.n).toBe(685_471);
  });

  it('has no orphan player-match rows', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM player_match_stats s
        LEFT JOIN players p ON p.id = s.player_id
        LEFT JOIN matches m ON m.id = s.match_id
       WHERE p.id IS NULL OR m.id IS NULL
    `;
    expect(row.n).toBe(0);
  });

  it('keeps all 24 historical club identities', async () => {
    const [row] = await sql<{ total: number; current: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_current_afl_club)::int AS current
        FROM clubs
    `;
    expect(row.total).toBe(24);
    expect(row.current).toBe(18);
  });

  it('preserves NULL rather than defaulting unrecorded statistics', async () => {
    const [row] = await sql<{ nullDisposals: number; zeroDisposals: number }[]>`
      SELECT count(*) FILTER (WHERE disposals IS NULL)::int AS "nullDisposals",
             count(*) FILTER (WHERE disposals = 0)::int     AS "zeroDisposals"
        FROM player_match_stats
    `;
    // Both must exist: NULL means not recorded, 0 means recorded as none.
    expect(row.nullDisposals).toBeGreaterThan(200_000);
    expect(row.zeroDisposals).toBeGreaterThan(0);
  });
});

// AFLDB-ISSUE-108: the canonical legacy-free rebuild has no writer for
// brownlow_season_votes or player_career_stats.brownlow_votes
// (AFLDB-ISSUE-090 §27.5), so the authoritative-total assertions (79,113) and the
// legacy per-game figure (46,979) no longer describe the dataset. Skipped, not
// re-pinned to zero; re-enable with a legacy-free season-grain Brownlow path.
// When re-enabling, also re-address the Bob Skilton case below: player_id 3702 is a
// retired legacy surrogate that the canonical rebuild re-seeded (it is now David
// Stark). Resolve the witness from the data, as the club-identity gates now do.
describe('Brownlow correctness', () => {
  it.skip('uses the authoritative season totals for career votes', async () => {
    const [row] = await sql<{ career: number; authoritative: number }[]>`
      SELECT (SELECT sum(brownlow_votes) FROM player_career_stats)::int AS career,
             (SELECT sum(votes) FROM brownlow_season_votes)::int        AS authoritative
    `;
    expect(row.career).toBe(row.authoritative);
    expect(row.career).toBe(79_113);
  });

  it.skip('does not derive career votes from per-game votes', async () => {
    const [row] = await sql<{ perGame: number }[]>`
      SELECT sum(brownlow_votes)::int AS "perGame" FROM player_match_stats
    `;
    // Per-game votes are incomplete (1935-1983 missing) and must not be
    // the basis of a career total.
    expect(row.perGame).toBe(46_979);
    expect(row.perGame).toBeLessThan(79_113);
  });

  it.skip('credits Bob Skilton with the votes the legacy derivation lost', async () => {
    const [row] = await sql<{ votes: number; medals: number }[]>`
      SELECT brownlow_votes AS votes, brownlow_medals AS medals
        FROM player_career_stats WHERE player_id = 3702
    `;
    expect(row.votes).toBe(180);
    expect(row.medals).toBe(3);
  });

  it('marks 1935-1983 as not collected at match grain, not as absent', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stat_availability
       WHERE stat_key = 'brownlow_match_votes'
         AND coverage = 'not_collected'
         AND season BETWEEN 1935 AND 1983
    `;
    // 45, not 49: the span is 49 seasons, but 1942-1945 are
    // 'not_applicable' because no medal was awarded during the war.
    // 'not_collected' means the medal existed and the per-match
    // breakdown simply was not kept — a different fact, and conflating
    // the two is what produced the 40.6% shortfall.
    expect(row.n).toBe(45);
  });

  it('keeps the season total complete across the same years', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM stat_availability
       WHERE stat_key = 'brownlow_season_total'
         AND coverage = 'complete'
         AND season BETWEEN 1935 AND 1983
    `;
    // The same 45 seasons are fully known at season grain. This pair of
    // assertions is the whole argument for splitting the key.
    expect(row.n).toBe(45);
  });

  it('separates the war years from merely uncollected seasons', async () => {
    const rows = await sql<{ season: number }[]>`
      SELECT season FROM stat_availability
       WHERE stat_key = 'brownlow_season_total'
         AND coverage = 'not_applicable' AND season >= 1924
       ORDER BY season
    `;
    // No Brownlow Medal was awarded in these four seasons. A player who
    // appeared in 1943 did not poll zero votes; there was nothing to poll.
    expect(rows.map((r) => r.season)).toEqual([1942, 1943, 1944, 1945]);
  });
});

// AFLDB-ISSUE-108: these gates used to pin players.id (788, 2520, 2521). That is a
// surrogate the canonical rebuild re-seeds — import_fitzroy_core.py inserts players
// with no legacy_player_id and resolves identity by AFL Tables profile URL, so after
// the legacy-free rebuild those IDs addressed unrelated players (788 = Arthur Ford,
// 2520/2521 = Campbell Gray/Heath). The club-identity and name-collision data are
// correct; only the addressing was obsolete. Each witness is now resolved from the
// data, so the gates keep meaning across the next rebuild too.
describe('club identity', () => {
  it('counts a renamed club once in clubs_played', async () => {
    // Brent Harvey played for "Kangaroos" and "North Melbourne" — one club.
    // He is the all-time games record holder, which identifies him among the
    // players named Harvey without pinning a surrogate ID.
    const [row] = await sql<{ games: number; clubs: number; stints: number }[]>`
      SELECT c.games, c.clubs_played AS clubs,
             (SELECT count(*)::int FROM player_clubs pc WHERE pc.player_id = p.id)
               AS stints
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.search_name LIKE '%' || afldb_normalise_name('harvey') || '%'
       ORDER BY c.games DESC
       LIMIT 1
    `;
    expect(row.games).toBe(432);
    expect(row.clubs).toBe(1);
    // The historical stints are still recorded separately.
    expect(row.stints).toBe(2);
  });

  it('counts a genuine two-club career as two', async () => {
    // Ron Barassi Jr: Melbourne then Carlton — two organizations, not a rename.
    const [row] = await sql<{ games: number; clubs: number }[]>`
      SELECT c.games, c.clubs_played AS clubs
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.search_name LIKE '%' || afldb_normalise_name('barassi') || '%'
       ORDER BY c.games DESC
       LIMIT 1
    `;
    expect(row.games).toBe(254);
    expect(row.clubs).toBe(2);
  });

  it('keeps players who share a name distinct', async () => {
    const rows = await sql<{ id: number; games: number; debut: number }[]>`
      SELECT p.id, c.games, c.debut_season AS debut
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.search_name LIKE '%' || afldb_normalise_name('barassi') || '%'
       ORDER BY c.debut_season
    `;
    // Ron Barassi Sr and Jr must never be collapsed.
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect([rows[0].debut, rows[0].games]).toEqual([1936, 58]);
    expect([rows[1].debut, rows[1].games]).toEqual([1953, 254]);
  });
});

describe('search', () => {
  it('finds both Gary Abletts and ranks the more prominent first', async () => {
    const rows = await sql<{
      id: number; displayName: string; games: number; debut: number;
    }[]>`
      WITH q AS (SELECT afldb_normalise_name('ablett') AS term)
      SELECT p.id, p.display_name AS "displayName", c.games,
             c.debut_season AS debut
        FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
       CROSS JOIN q
       WHERE p.search_name LIKE '%' || q.term || '%'
       ORDER BY c.games DESC
    `;
    // AFLDB-ISSUE-108: asserted on the two careers, not on players.id. The IDs this
    // used to pin (1105, 567) were legacy surrogates the canonical rebuild re-seeded
    // and now address Ben King and Andrew Foster; the Abletts themselves are intact.
    // Ranking by games must put the son (357 games from 2002) ahead of the father
    // (248 from 1982), and both must survive as separate players.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect([rows[0].games, rows[0].debut]).toEqual([357, 2002]);
    expect([rows[1].games, rows[1].debut]).toEqual([248, 1982]);
  });

  it('matches a hyphenated surname by its second part', async () => {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM players
       WHERE search_name LIKE '%' || afldb_normalise_name('tipungwuti') || '%'
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('matches an apostrophe surname typed without the apostrophe', async () => {
    // Surnames sit at the end of search_name, so global search uses a
    // contains match rather than a prefix match.
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM players
       WHERE search_name LIKE '%' || afldb_normalise_name(${"O'Brien"}) || '%'
       LIMIT 5
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('normalises an apostrophe out of the search form', async () => {
    const [row] = await sql<{ withApostrophe: string; without: string }[]>`
      SELECT afldb_normalise_name($$O'Brien$$) AS "withApostrophe",
             afldb_normalise_name('OBrien')    AS without
    `;
    // Both spellings must reach the same search term.
    expect(row.withApostrophe).toBe(row.without);
  });

  it('uses an index for a prefix search rather than scanning', async () => {
    const plan = await sql<{ 'QUERY PLAN': string }[]>`
      EXPLAIN SELECT id FROM players WHERE search_name LIKE 'ablett%'
    `;
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).not.toMatch(/Seq Scan/);
  });
});

// AFLDB-ISSUE-108: the two counts re-pinned below follow from the accepted canonical
// baseline rather than merely matching current output. player_career_stats is an exact
// aggregate of the accepted full-history-20260827 fact table — measured on afldb_test:
// sum(games) 685,471 = player_match_stats rows 685,471; sum(finals) 29,318 = player
// rows in matches with is_final; sum(goals) 407,963 = player_match_stats goals — and
// db-health's drift gate asserts that agreement continuously. Any cohort defined over
// games/goals/finals is therefore entailed by the accepted fingerprint. The retired
// 117 and 222 were entailed by the 694,210-row legacy SQLite set instead.
describe('advanced search regression cases', () => {
  // Compared as exact ID sets in tools/validation; here the counts guard
  // the query paths the site actually uses.
  it('debuted in the 1960s and played for exactly two clubs', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_career_stats
       WHERE debut_season BETWEEN 1960 AND 1969 AND clubs_played = 2
    `;
    expect(row.n).toBe(110);
  });

  it('200-249 games with 16 or more finals', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_career_stats
       WHERE games BETWEEN 200 AND 249 AND finals >= 16
    `;
    expect(row.n).toBe(115);
  });

  // AFLDB-ISSUE-108: skipped — with no canonical career-Brownlow acquisition,
  // player_career_stats.brownlow_votes is 0 for almost every player, so this cohort
  // no longer isolates anything. Re-enable with the legacy-free Brownlow path.
  it.skip('50-199 goals and no Brownlow votes', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_career_stats
       WHERE goals BETWEEN 50 AND 199 AND brownlow_votes = 0
    `;
    // 269, not the 750 the legacy per-game derivation produced.
    expect(row.n).toBe(269);
  });

  it('200+ games, 100+ goals and 15+ finals', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_career_stats
       WHERE games >= 200 AND goals >= 100 AND finals >= 15
    `;
    expect(row.n).toBe(219);
  });
});

describe('query performance', () => {
  it('answers a career filter without scanning the fact table', async () => {
    const plan = await sql<{ 'QUERY PLAN': string }[]>`
      EXPLAIN SELECT player_id FROM player_career_stats
       WHERE games >= 200 AND goals >= 100
    `;
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).not.toMatch(/player_match_stats/);
  });

  it('returns a player match log quickly', async () => {
    const started = Date.now();
    await sql`
      SELECT s.*, m.match_date FROM player_match_stats s
        JOIN matches m ON m.id = s.match_id
       WHERE s.player_id = 4182
       ORDER BY m.match_date DESC LIMIT 50
    `;
    expect(Date.now() - started).toBeLessThan(200);
  });
});

/**
 * AFLDB-ISSUE-129 §11 T9 and T10 — the player-career and ladder halves of the
 * §8.4 decision, over a reserved fixture season.
 *
 * T9: a player whose only appearance is a Wildcard Final has played one game
 * and NO finals, because `player_career_stats.finals` counts
 * `matches.is_finals_series`. T10: the Wildcard Final moves no ladder figure —
 * no premiership points, no played/win/loss, no score — and never appears in
 * the round ladder, which reads `round_type = 'home_and_away'`.
 */
describe('AFLDB-ISSUE-129 wildcard finals semantics (player career and ladder)', () => {
  let fixture: WildcardFixture;

  beforeAll(async () => {
    fixture = await seedWildcardFinalSeason(2096);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('T9: a wildcard-only player has games = 1 and finals = 0', async () => {
    const [row] = await sql<{ games: number; finals: number }[]>`
      SELECT games, finals FROM player_career_stats WHERE player_id = ${fixture.wildcardOnlyPlayerId}
    `;
    expect(row.games).toBe(1);
    expect(row.finals).toBe(0);
  });

  it('T9: an elimination-final player is still counted as a finals game', async () => {
    const [row] = await sql<{ games: number; finals: number }[]>`
      SELECT games, finals FROM player_career_stats WHERE player_id = ${fixture.finalsSeriesPlayerId}
    `;
    expect(row.games).toBe(1);
    expect(row.finals).toBe(1);
  });

  it('T9: db-health finals parity reports 0 mismatches with the fixture present', async () => {
    const checks = await reconcileCareerTotals();
    const finals = checks.find((check) => check.check.startsWith('finals:'));
    expect(finals).toBeDefined();
    expect(finals!.mismatches).toBe(0);
  });

  it('T10: the Wildcard Final contributes nothing to club_seasons', async () => {
    const rows = await sql<{
      clubId: number; played: number; wins: number; losses: number;
      pointsFor: number; pointsAgainst: number; premiershipPoints: number;
    }[]>`
      SELECT club_id AS "clubId", played, wins, losses,
             points_for AS "pointsFor", points_against AS "pointsAgainst",
             premiership_points AS "premiershipPoints"
        FROM club_seasons WHERE season = ${fixture.season} ORDER BY club_id
    `;
    // Four clubs, one home-and-away match each: the two finals are invisible here.
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.played).toBe(1);

    const loser = rows.find((row) => row.clubId === fixture.wildcardLoserClubId)!;
    // Lost the home-and-away match 80-100 and lost the Wildcard Final 93-96.
    // Only the first is on the ladder.
    expect(loser.wins).toBe(0);
    expect(loser.losses).toBe(1);
    expect(loser.pointsFor).toBe(80);
    expect(loser.pointsAgainst).toBe(100);
    expect(loser.premiershipPoints).toBe(0);

    const winner = rows.find((row) => row.clubId === fixture.wildcardWinnerClubId)!;
    // Won the home-and-away match 100-80 and two finals; still 1 win, 4 points.
    expect(winner.wins).toBe(1);
    expect(winner.pointsFor).toBe(100);
    expect(winner.pointsAgainst).toBe(80);
    expect(winner.premiershipPoints).toBe(4);
  });

  it('T10: the Wildcard Final does not appear in the round ladder', async () => {
    const ladder = await getSeasonRoundLadder(fixture.season);
    expect(ladder.length).toBeGreaterThan(0);
    // Round 1 only: the WF and EF carry no round_number and no ladder row.
    expect([...new Set(ladder.map((row) => row.roundNumber))]).toEqual([1]);
    for (const row of ladder) {
      expect(row.played).toBe(1);
      expect(row.premiershipPoints).toBe(row.wins * 4 + row.draws * 2);
    }
  });

  /**
   * T16, the half a fixture can prove. `validate_ladder_witness.py --compare`
   * asks AFLDB which seasons contain a `wildcard_final` and declares exactly
   * those UNCOMPARABLE, because fitzRoy labels a WF row `Round.Type='Regular'`
   * and counts it on the ladder while AFLDB does not (ISSUE-129 §8.4 item 10).
   * The exclusion is driven by this query, so a wildcard season can never be
   * silently passed — and a season without one is never excluded.
   */
  it('T16: the ladder witness wildcard-season query names the fixture season', async () => {
    const rows = await sql<{ season: number }[]>`
      SELECT DISTINCT season FROM matches
       WHERE round_type = 'wildcard_final'
       ORDER BY season
    `;
    const seasons = rows.map((row) => row.season);
    expect(seasons).toContain(fixture.season);
    // Nothing historical is dragged into the exclusion.
    expect(seasons.filter((season) => season < 2026)).toEqual([]);
  });

  it('T10: the wildcard match is is_final but not is_finals_series', async () => {
    const [row] = await sql<{ isFinal: boolean; isFinalsSeries: boolean; roundNumber: number | null }[]>`
      SELECT is_final AS "isFinal", is_finals_series AS "isFinalsSeries",
             round_number AS "roundNumber"
        FROM matches WHERE id = ${fixture.wildcardMatchId}
    `;
    expect(row.isFinal).toBe(true);
    expect(row.isFinalsSeries).toBe(false);
    expect(row.roundNumber).toBeNull();
  });
});

/**
 * AFLDB-ISSUE-132 — the query surfaces the public season, match-search,
 * site-search, player and admin pages actually call. ISSUE-129 above pins the
 * derived aggregates; this pins what each page renders from a `wildcard_final`
 * row: visible, labelled "Wildcard Final" / "WF", ordered between the last
 * home-and-away round and the finals series, and on the excluded side of every
 * finals-only filter. Fixture season 2087 (2096 belongs to ISSUE-129 above).
 */
describe('AFLDB-ISSUE-132 wildcard final visibility (public and admin query surfaces)', () => {
  let fixture: WildcardFixture;

  beforeAll(async () => {
    fixture = await seedWildcardFinalSeason(2087);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('T1: getSeasonMatches orders H&A → WF → finals and groups like the season page', async () => {
    const rows = await getSeasonMatches(fixture.season);
    expect(rows.map((row) => row.roundType)).toEqual([
      'home_and_away', 'home_and_away', 'wildcard_final', 'elimination_final',
    ]);

    // Exactly the grouping src/app/seasons/[year]/page.tsx performs: keyed by
    // formatRound() in first-seen (chronological) order, anchor id derived from
    // the label.
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = formatRound(row.roundType, row.roundNumber);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const labels = [...groups.keys()];
    expect(labels).toEqual(['Round 1', 'Wildcard Final', 'Elimination Final']);
    expect(labels.map((label) => label.toLowerCase().replace(/\s+/g, '-')))
      .toEqual(['round-1', 'wildcard-final', 'elimination-final']);

    const wildcardGroup = groups.get('Wildcard Final')!;
    expect(wildcardGroup).toHaveLength(1);
    expect(wildcardGroup[0].id).toBe(fixture.wildcardMatchId);
    expect(wildcardGroup[0].roundNumber).toBeNull();

    // The WF sits strictly after the last home-and-away match and strictly
    // before the first finals-series match.
    const lastHomeAndAway = rows[1].matchDate.getTime();
    const wildcard = rows[2].matchDate.getTime();
    const firstFinal = rows[3].matchDate.getTime();
    expect(wildcard).toBeGreaterThan(lastHomeAndAway);
    expect(wildcard).toBeLessThan(firstFinal);
  });

  it('T2: runMatchSearch match types put the WF on the right side of every filter', async () => {
    const search = (matchType: MatchType) => runMatchSearch({
      filters: [{ field: 'season', min: fixture.season, max: fixture.season }],
      clubSlugs: [],
      outcome: 'all',
      matchType,
      sort: 'date_asc',
      page: 1,
      pageSize: 50,
    });

    const all = await search('all');
    expect(all.total).toBe(4);
    expect(all.rows.map((row) => row.roundType)).toEqual([
      'home_and_away', 'home_and_away', 'wildcard_final', 'elimination_final',
    ]);

    const homeAndAway = await search('home_and_away');
    expect(homeAndAway.total).toBe(2);
    expect(homeAndAway.rows.every((row) => row.roundType === 'home_and_away')).toBe(true);
    expect(homeAndAway.rows.map((row) => row.id)).not.toContain(fixture.wildcardMatchId);

    const finals = await search('finals');
    expect(finals.total).toBe(1);
    expect(finals.rows.map((row) => row.id)).toEqual([fixture.eliminationMatchId]);

    const wildcard = await search('wildcard_final');
    expect(wildcard.total).toBe(1);
    expect(wildcard.rows.map((row) => row.id)).toEqual([fixture.wildcardMatchId]);
    expect(wildcard.rows[0].roundType).toBe('wildcard_final');
  });

  it('T3: searchRounds returns the anchor the season page emits for the WF', async () => {
    const expectedSlug = `${fixture.season}#wildcard-final`;
    // The page's anchor for the WF group, derived exactly as in T1.
    const pageAnchor = formatRound('wildcard_final', null).toLowerCase().replace(/\s+/g, '-');
    expect(expectedSlug).toBe(`${fixture.season}#${pageAnchor}`);

    const yearFirst = await searchRounds(`${fixture.season} wildcard final`);
    expect(yearFirst).toHaveLength(1);
    expect(yearFirst[0]).toMatchObject({
      type: 'round',
      id: fixture.season,
      slug: expectedSlug,
      title: `Wildcard Final, ${fixture.season}`,
      subtitle: null,
    });

    const yearLast = await searchRounds(`wildcard final ${fixture.season}`);
    expect(yearLast).toEqual(yearFirst);

    // A numbered round stays home_and_away only: the WF never leaks into it.
    const roundOne = await searchRounds(`round 1 ${fixture.season}`);
    expect(roundOne).toHaveLength(1);
    expect(roundOne[0]).toMatchObject({
      type: 'round',
      slug: `${fixture.season}#round-1`,
      title: `Round 1, ${fixture.season}`,
      subtitle: '2 matches',
    });
  });

  it('T4: getPlayerMatches shows the WF row, labelled WF, for the wildcard-only player', async () => {
    const { rows, total } = await getPlayerMatches(fixture.wildcardOnlyPlayerId, {
      limit: 20, offset: 0,
    });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.matchId).toBe(fixture.wildcardMatchId);
    expect(row.season).toBe(fixture.season);
    expect(row.roundType).toBe('wildcard_final');
    expect(row.roundNumber).toBeNull();
    expect(formatRoundShort(row.roundType, row.roundNumber)).toBe('WF');
    expect(formatRound(row.roundType, row.roundNumber)).toBe('Wildcard Final');
    // On the winning side of the WF; no Brownlow votes exist for it.
    expect(row.outcome).toBe('W');
    expect(row.brownlowVotes).toBeNull();
  });

  it('T5: searchAdminMatches lists the WF for the season and drops it under a round-number filter', async () => {
    const season = await searchAdminMatches({ season: fixture.season });
    expect(season.total).toBe(4);
    expect(season.rows).toHaveLength(4);
    const wildcard = season.rows.find((row) => row.id === fixture.wildcardMatchId);
    expect(wildcard).toBeDefined();
    expect(wildcard!.roundType).toBe('wildcard_final');
    expect(wildcard!.roundCode).toBe('WF');
    expect(wildcard!.roundNumber).toBeNull();
    expect(wildcard!.playerCount).toBe(1);

    // Newest first: EF, WF, then the two home-and-away matches.
    expect(season.rows.map((row) => row.roundType)).toEqual([
      'elimination_final', 'wildcard_final', 'home_and_away', 'home_and_away',
    ]);

    const roundOne = await searchAdminMatches({ season: fixture.season, roundNumber: 1 });
    expect(roundOne.total).toBe(2);
    expect(roundOne.rows.every((row) => row.roundNumber === 1)).toBe(true);
    expect(roundOne.rows.map((row) => row.id)).not.toContain(fixture.wildcardMatchId);
  });
});
