/**
 * Integration tests against the real afldb_test database.
 *
 * These verify PostgreSQL behaviour — constraints, indexes, search and
 * aggregation — so PostgreSQL is deliberately not mocked. afldb_test
 * carries the full migrated dataset, because a query that is fast and
 * correct against 100 rows proves nothing about 694,210.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';

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
    expect(row.n).toBe(694_210);
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

describe('Brownlow correctness', () => {
  it('uses the authoritative season totals for career votes', async () => {
    const [row] = await sql<{ career: number; authoritative: number }[]>`
      SELECT (SELECT sum(brownlow_votes) FROM player_career_stats)::int AS career,
             (SELECT sum(votes) FROM brownlow_season_votes)::int        AS authoritative
    `;
    expect(row.career).toBe(row.authoritative);
    expect(row.career).toBe(79_113);
  });

  it('does not derive career votes from per-game votes', async () => {
    const [row] = await sql<{ perGame: number }[]>`
      SELECT sum(brownlow_votes)::int AS "perGame" FROM player_match_stats
    `;
    // Per-game votes are incomplete (1935-1983 missing) and must not be
    // the basis of a career total.
    expect(row.perGame).toBe(46_979);
    expect(row.perGame).toBeLessThan(79_113);
  });

  it('credits Bob Skilton with the votes the legacy derivation lost', async () => {
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

describe('club identity', () => {
  it('counts a renamed club once in clubs_played', async () => {
    // Brent Harvey played for "Kangaroos" and "North Melbourne" — one club.
    const [career] = await sql<{ clubs: number }[]>`
      SELECT clubs_played AS clubs FROM player_career_stats WHERE player_id = 788
    `;
    const [stints] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_clubs WHERE player_id = 788
    `;
    expect(career.clubs).toBe(1);
    // The historical stints are still recorded separately.
    expect(stints.n).toBe(2);
  });

  it('counts a genuine two-club career as two', async () => {
    const [row] = await sql<{ clubs: number }[]>`
      SELECT clubs_played AS clubs FROM player_career_stats WHERE player_id = 2521
    `;
    expect(row.clubs).toBe(2);
  });

  it('keeps players who share a name distinct', async () => {
    const rows = await sql<{ id: number; games: number }[]>`
      SELECT p.id, c.games
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (2520, 2521)
       ORDER BY p.id
    `;
    // Ron Barassi Sr and Jr must never be collapsed.
    expect(rows).toHaveLength(2);
    expect(rows[0].games).toBe(58);
    expect(rows[1].games).toBe(254);
  });
});

describe('search', () => {
  it('finds both Gary Abletts and ranks the more prominent first', async () => {
    const rows = await sql<{ id: number; displayName: string; games: number }[]>`
      WITH q AS (SELECT afldb_normalise_name('ablett') AS term)
      SELECT p.id, p.display_name AS "displayName", c.games
        FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
       CROSS JOIN q
       WHERE p.search_name LIKE '%' || q.term || '%'
       ORDER BY c.games DESC
    `;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(1105);
    expect(ids).toContain(567);
    expect(rows[0].id).toBe(1105);
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
    expect(row.n).toBe(117);
  });

  it('50-199 goals and no Brownlow votes', async () => {
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
    expect(row.n).toBe(222);
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
