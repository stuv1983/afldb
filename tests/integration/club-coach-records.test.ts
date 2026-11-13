/**
 * getClubCoachRecords (coaches + match_coaches + matches), the club-page
 * club-specific coaching section added for AFLDB-ISSUE-148.
 *
 * The record must be CLUB-SPECIFIC: a coach who coached this club and
 * another must contribute only their matches for this club, and separate
 * periods in charge of the same club aggregate into one row.
 *
 * Truth is re-derived here from the raw scoreline (home_score vs
 * away_score), never matches.winner_club_id, so these assertions do not
 * simply replay the implementation. Identities are discovered dynamically
 * (Richmond by slug, multi-club / multi-tenure / outsider coaches by
 * query) -- never a hardcoded coach id, and never the full list of 42
 * Richmond coaches.
 *
 * AFLDB-ISSUE-363 TST-4: "a club with no per-match coaching data" is seeded
 * (`seedBareClub`: a synthetic organisation and club, committed, removed in
 * `finally`) instead of discovered. A production-shaped database has coaching
 * data for every club, so the discovered case used to `return` quietly. The
 * seeded club exists on every database and the test fails loudly if it does not.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubCoachRecords } from '@/db/queries/coaches';

afterAll(async () => {
  await sql.end();
});

/** Reserved synthetic organisation + club for the no-coaching-data case. COMMITTED; read through the shared client. */
const BARE_NS = 'issue363-bare-club';

async function removeBareClub(): Promise<void> {
  await sql`DELETE FROM clubs WHERE slug = ${BARE_NS}`;
  await sql`DELETE FROM club_organizations WHERE slug = ${`${BARE_NS}-org`}`;
}

/** Create one club with its own organisation (the clubs_current_identity_id FK is deferred, as the other fixtures do). */
async function seedBareClub(): Promise<number> {
  await removeBareClub();
  return sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
    const [org] = await tx<{ id: number }[]>`
      INSERT INTO club_organizations (name, slug) VALUES ('ISSUE-363 bare club organisation', ${`${BARE_NS}-org`})
      RETURNING id::int AS id`;
    const [club] = await tx<{ id: number }[]>`
      INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
      VALUES (${BARE_NS}, 'ISSUE-363 Bare Club', 'Bare 363', 'B363', -1, ${BARE_NS}, ${org.id})
      RETURNING id::int AS id`;
    await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
    return club.id;
  });
}

async function clubIdBySlug(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE slug = ${slug}`;
  expect(row, `club ${slug} is missing from afldb_test`).toBeDefined();
  return row.id;
}

/** Lineage-scoped truth, W/D/L from the scoreline, grouped by coach. */
async function coachTruth(clubId: number) {
  return sql<{
    coachId: number; games: number; wins: number; draws: number; losses: number;
    firstSeason: number; lastSeason: number; seasons: number;
  }[]>`
    WITH lineage AS (
      SELECT id FROM clubs
       WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
    ),
    coached AS (
      SELECT mc.coach_id, m.season,
             CASE
               WHEN (m.home_club_id = mc.club_id AND m.home_score > m.away_score)
                 OR (m.away_club_id = mc.club_id AND m.away_score > m.home_score) THEN 'W'
               WHEN m.home_score = m.away_score THEN 'D'
               ELSE 'L'
             END AS outcome
        FROM match_coaches mc
        JOIN matches m ON m.id = mc.match_id
       WHERE mc.club_id IN (SELECT id FROM lineage)
    )
    SELECT coach_id AS "coachId",
           count(*)::int AS games,
           count(*) FILTER (WHERE outcome = 'W')::int AS wins,
           count(*) FILTER (WHERE outcome = 'D')::int AS draws,
           count(*) FILTER (WHERE outcome = 'L')::int AS losses,
           min(season)::int AS "firstSeason",
           max(season)::int AS "lastSeason",
           count(DISTINCT season)::int AS seasons
      FROM coached
     GROUP BY coach_id
  `;
}

describe('getClubCoachRecords', () => {
  it('Richmond: every row is games = W + D + L and agrees with independent scoreline truth', async () => {
    const clubId = await clubIdBySlug('richmond');
    const rows = await getClubCoachRecords(clubId);
    expect(rows.length, 'the coaches stage has not loaded this database').toBeGreaterThan(10);

    const truth = new Map((await coachTruth(clubId)).map((t) => [t.coachId, t]));
    expect(rows.length).toBe(truth.size);

    for (const r of rows) {
      expect(r.games, r.displayName).toBe(r.wins + r.draws + r.losses);

      const t = truth.get(r.coachId);
      expect(t, r.displayName).toBeDefined();
      expect(r, r.displayName).toMatchObject({
        games: t!.games, wins: t!.wins, draws: t!.draws, losses: t!.losses,
        firstSeason: t!.firstSeason, lastSeason: t!.lastSeason, seasons: t!.seasons,
      });

      // Draw-weighted site convention ((W + D/2) / G), rounded to 2 dp --
      // NOT the plain W/G in the evidence file (see the issue entry).
      const expected = Math.round(((t!.wins + t!.draws * 0.5) * 100 / t!.games) * 100) / 100;
      expect(Math.abs(Number(r.winPct) - expected), r.displayName).toBeLessThanOrEqual(0.01);
    }
  });

  it('a coach who also coached another club contributes only their matches for this club', async () => {
    const clubId = await clubIdBySlug('richmond');
    const [multi] = await sql<{ coachId: number; clubGames: number; totalGames: number }[]>`
      WITH lineage AS (
        SELECT id FROM clubs
         WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
      )
      SELECT mc.coach_id AS "coachId",
             count(*) FILTER (WHERE mc.club_id IN (SELECT id FROM lineage))::int AS "clubGames",
             count(*)::int AS "totalGames"
        FROM match_coaches mc
       GROUP BY mc.coach_id
      HAVING count(*) FILTER (WHERE mc.club_id IN (SELECT id FROM lineage)) > 0
         AND count(*) FILTER (WHERE mc.club_id NOT IN (SELECT id FROM lineage)) > 0
       ORDER BY mc.coach_id
       LIMIT 1
    `;
    expect(multi, 'no Richmond coach in this DB also coached elsewhere').toBeDefined();

    const rows = await getClubCoachRecords(clubId);
    const row = rows.find((r) => r.coachId === multi.coachId);
    expect(row).toBeDefined();
    expect(row!.games).toBe(multi.clubGames);
    expect(row!.games).toBeLessThan(multi.totalGames);
  });

  it('a coach who never coached this club is absent', async () => {
    const clubId = await clubIdBySlug('richmond');
    const [outsider] = await sql<{ id: number }[]>`
      WITH lineage AS (
        SELECT id FROM clubs
         WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
      )
      SELECT c.id
        FROM coaches c
       WHERE EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.coach_id = c.id)
         AND NOT EXISTS (
           SELECT 1 FROM match_coaches mc
            WHERE mc.coach_id = c.id AND mc.club_id IN (SELECT id FROM lineage)
         )
       LIMIT 1
    `;
    expect(outsider).toBeDefined();

    const rows = await getClubCoachRecords(clubId);
    expect(rows.find((r) => r.coachId === outsider.id)).toBeUndefined();
  });

  it('separate periods in charge for one coach at one club aggregate into a single row', async () => {
    const clubId = await clubIdBySlug('richmond');
    // A coach whose Richmond seasons have a gap => more than one tenure block.
    const [split] = await sql<{ coachId: number; blocks: number }[]>`
      WITH lineage AS (
        SELECT id FROM clubs
         WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
      ),
      cseasons AS (
        SELECT DISTINCT mc.coach_id, m.season
          FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
         WHERE mc.club_id IN (SELECT id FROM lineage)
      ),
      grp AS (
        SELECT coach_id, season,
               season - dense_rank() OVER (PARTITION BY coach_id ORDER BY season) AS island
          FROM cseasons
      )
      SELECT coach_id AS "coachId", count(DISTINCT island)::int AS blocks
        FROM grp
       GROUP BY coach_id
      HAVING count(DISTINCT island) > 1
       ORDER BY coach_id
       LIMIT 1
    `;
    expect(split, 'no multi-tenure coach in this DB').toBeDefined();
    expect(split.blocks).toBeGreaterThan(1);

    const rows = await getClubCoachRecords(clubId);
    const matching = rows.filter((r) => r.coachId === split.coachId);
    expect(matching).toHaveLength(1);

    const truth = (await coachTruth(clubId)).find((t) => t.coachId === split.coachId)!;
    expect(matching[0].games).toBe(truth.games);
    expect(matching[0].firstSeason).toBe(truth.firstSeason);
    expect(matching[0].lastSeason).toBe(truth.lastSeason);
    // Distinct seasons in charge only -- the gap between tenures is not counted.
    expect(matching[0].seasons).toBe(truth.seasons);
    expect(matching[0].lastSeason - matching[0].firstSeason + 1).toBeGreaterThan(matching[0].seasons);
  });

  it('an equal-scores match counts as a draw for the coach, not a win or loss', async () => {
    const clubId = await clubIdBySlug('richmond');
    const withDraws = (await coachTruth(clubId)).filter((t) => t.draws > 0);
    expect(withDraws.length, 'no drawn match under any Richmond coach in this DB').toBeGreaterThan(0);

    const rows = await getClubCoachRecords(clubId);
    for (const t of withDraws) {
      const r = rows.find((x) => x.coachId === t.coachId)!;
      expect(r, `coach ${t.coachId}`).toBeDefined();
      expect(r.draws).toBe(t.draws);
      expect(r.games).toBe(r.wins + r.draws + r.losses);
    }
  });

  it('rows are ordered most recently in charge first', async () => {
    const clubId = await clubIdBySlug('richmond');
    const rows = await getClubCoachRecords(clubId);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].lastSeason).toBeGreaterThanOrEqual(rows[i].lastSeason);
    }
  });

  it('a renamed club reports the same coaches under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c
       WHERE c.current_identity_id <> c.id
         AND EXISTS (SELECT 1 FROM match_coaches mc WHERE mc.club_id = c.id)
       LIMIT 1
    `;
    if (!pair) return; // no multi-identity club with coaching data in this DB

    const era = await getClubCoachRecords(pair.eraId);
    const current = await getClubCoachRecords(pair.currentId);
    expect(new Set(era.map((r) => r.coachId))).toEqual(new Set(current.map((r) => r.coachId)));
  });

  it('a club with no per-match coaching data returns an empty list', async () => {
    const bare = await seedBareClub();
    try {
      // The subject is genuinely bare: no coaching row for any identity of its organisation.
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM match_coaches mc
          JOIN clubs l ON l.id = mc.club_id
         WHERE l.organization_id = (SELECT organization_id FROM clubs WHERE id = ${bare})`;
      expect(n, 'the seeded club must have no match_coaches').toBe(0);

      expect(await getClubCoachRecords(bare)).toEqual([]);
    } finally {
      await removeBareClub();
    }
  });

  it('an unknown club id returns an empty list, never throws', async () => {
    expect(await getClubCoachRecords(-1)).toEqual([]);
  });
});
