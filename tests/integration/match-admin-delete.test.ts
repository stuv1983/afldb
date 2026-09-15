/**
 * AFLDB-ISSUE-177: `deleteMatch` refuses when current-season staging still
 * points at the match, instead of letting the raw FK violation on
 * `staging.external_current_matches.local_match_id` (migration 063) reach
 * the admin UI as an unhandled exception.
 *
 * Two refusal paths are proven here, deliberately kept separate:
 *
 *   1. THE FRIENDLY PRE-CHECK -- a staging row with `local_match_id` set to
 *      the fixture match is seeded directly, so `deleteMatch`'s own SELECT
 *      finds it before anything destructive runs. This is the path every
 *      real operator click takes.
 *
 *   2. THE 23503 FALLBACK -- the concurrency backstop for a staging row
 *      relinked between that pre-check and the `DELETE FROM matches`
 *      statement. That exact interleaving cannot be forced deterministically
 *      from outside a single `deleteMatch` call, so this test instead forces
 *      a REAL, un-pre-checked foreign-key violation via
 *      `player_match_period_stats.match_id` (migration 062, NOT NULL, no
 *      ON DELETE clause) -- a genuinely different, already-identified but
 *      out-of-scope blocking dependency (see AFLDB-ISSUE-177 follow-up
 *      notes). `deleteMatch` never pre-checks that table, so calling it
 *      against a match carrying a period-stats row exercises the real
 *      catch(error.code === '23503') mapping end-to-end against a genuine
 *      Postgres error, not a source-inspected assumption about the code.
 *
 * Neither test touches player_match_stats/match_period_scores content: the
 * fixture match has none, so "no partial dependent deletion" is proven by
 * the match row itself surviving intact, same as the ISSUE-167 Stage 6
 * pattern this file otherwise follows.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteMatch } from '@/db/queries/match-admin';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? testDbUrl;

const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-177';
const FIXTURE_SOURCE_KEY = 'issue_177_fixture_source';

let actorId: number;
let createdThrowawayAdmin = false;
let fixtureSourceId: number;
let clubHomeId: number;
let clubAwayId: number;
let fixturePlayerId: number;
let fixtureSeason: number;
let seeded = 0;

const nextKey = (prefix: string) => `${MARKER.toLowerCase()}-${prefix}-${Date.now().toString(36)}-${seeded += 1}`;

async function createFixtureMatch(matchKey: string): Promise<number> {
  const [match] = await owner<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${matchKey}, ${fixtureSeason}::smallint, '1', 'home_and_away', 1, false,
      ${`${fixtureSeason}-03-01`}::date, ${MARKER}, ${clubHomeId}, ${clubAwayId}, 82, 76,
      'home_win', ${clubHomeId}, 6, 'not_collected'
    ) RETURNING id::int AS id`;
  return match.id;
}

beforeAll(async () => {
  const [source] = await owner<{ id: number }[]>`
    INSERT INTO sources (key, name, kind, url)
    VALUES (${FIXTURE_SOURCE_KEY}, ${`${MARKER} fixture source`}, 'manual',
            'https://example.invalid/issue-177')
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  fixtureSourceId = source.id;

  const [clubs] = await owner<{ home: number; away: number }[]>`
    SELECT min(id)::int AS home, max(id)::int AS away FROM clubs`;
  clubHomeId = clubs.home;
  clubAwayId = clubs.away;

  const [player] = await owner<{ id: number }[]>`SELECT id::int AS id FROM players ORDER BY id LIMIT 1`;
  fixturePlayerId = player.id;

  const [season] = await owner<{ year: number }[]>`SELECT max(year)::int AS year FROM seasons`;
  fixtureSeason = season.year;

  const [existingAdmin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-177-fixture@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }
});

afterAll(async () => {
  await owner`DELETE FROM staging.external_current_matches WHERE source_id = ${fixtureSourceId}`;
  await owner`DELETE FROM sources WHERE key = ${FIXTURE_SOURCE_KEY}`;
  await owner`DELETE FROM matches WHERE venue_raw = ${MARKER}`;
  if (createdThrowawayAdmin) {
    await owner`DELETE FROM auth_users WHERE id = ${actorId}`;
  }
  await owner.end({ timeout: 5 });
});

describe('AFLDB-ISSUE-177 -- a match still linked by current-season staging cannot be deleted', () => {
  it('refuses deletion, names the staging dependency, and changes nothing', async () => {
    const matchId = await createFixtureMatch(nextKey('match-a'));
    const externalGameId = nextKey('game');

    await owner`
      INSERT INTO staging.external_current_matches (
        source_id, external_game_id, season, home_club_id, away_club_id,
        local_match_id, raw_payload
      ) VALUES (
        ${fixtureSourceId}, ${externalGameId}, ${fixtureSeason}::smallint,
        ${clubHomeId}, ${clubAwayId}, ${matchId}, ${owner.json({ marker: MARKER } as never)}
      )`;

    const result = await deleteMatch({ matchId, adminUserId: actorId, reason: `${MARKER} refusal proof` });

    expect(result.ok, result.ok ? '' : result.error).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/current-season staging/);
      expect(result.error).toContain(FIXTURE_SOURCE_KEY);
      expect(result.error).toContain(externalGameId);
      expect(result.error).not.toMatch(/foreign key|constraint|SQLSTATE|23503/i);
    }

    // The canonical match survives.
    const [stillMatch] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
    expect(stillMatch.n).toBe(1);

    // The staging row survives WITH its link intact -- never nulled/detached.
    const [staging] = await owner<{ localMatchId: number | null }[]>`
      SELECT local_match_id AS "localMatchId" FROM staging.external_current_matches
       WHERE source_id = ${fixtureSourceId} AND external_game_id = ${externalGameId}`;
    expect(staging.localMatchId).toBe(matchId);
  });

  it('still deletes normally when nothing references the match', async () => {
    const matchId = await createFixtureMatch(nextKey('match-b'));

    const result = await deleteMatch({ matchId, adminUserId: actorId, reason: `${MARKER} happy path` });

    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    const [gone] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
    expect(gone.n).toBe(0);
  });

  it('maps an un-pre-checked FK violation (23503) to a refusal instead of throwing', async () => {
    // player_match_period_stats.match_id (migration 062) is NOT NULL with no
    // ON DELETE clause and deleteMatch never clears or checks it -- a real,
    // already-flagged, out-of-scope gap (see AFLDB-ISSUE-177 follow-up notes)
    // used here only as a reliable way to force a genuine 23503 that the
    // staging pre-check above cannot have already caught.
    const matchId = await createFixtureMatch(nextKey('match-c'));
    await owner`
      INSERT INTO player_match_period_stats (player_id, match_id, club_id, period)
      VALUES (${fixturePlayerId}, ${matchId}, ${clubHomeId}, 1)`;

    const result = await deleteMatch({ matchId, adminUserId: actorId, reason: `${MARKER} 23503 fallback proof` });

    expect(result.ok, result.ok ? '' : result.error).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/another record still depends on it/);
      expect(result.error).not.toMatch(/foreign key|constraint|SQLSTATE|23503/i);
    }

    const [stillMatch] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
    expect(stillMatch.n).toBe(1);

    await owner`DELETE FROM player_match_period_stats WHERE match_id = ${matchId}`;
  });
});
