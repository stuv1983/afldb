/**
 * AFLDB-ISSUE-177: `deleteMatch` refuses when current-season staging still
 * points at the match, instead of letting the raw FK violation on
 * `staging.external_current_matches.local_match_id` (migration 063) reach
 * the admin UI as an unhandled exception.
 *
 * AFLDB-ISSUE-180 extends the same file with a second named dependency:
 * `player_match_period_stats.match_id` (migration 062, NOT NULL, no
 * ON DELETE clause) now gets its own friendly pre-check instead of falling
 * through to the generic 23503 fallback.
 *
 * AFLDB-ISSUE-181 extends it with a third: `staging.afl_api_lineup.match_id`
 * (migration 077, nullable, no ON DELETE clause) -- the AFL API team
 * announcement's staging projection -- now also gets its own friendly
 * pre-check.
 *
 * Four refusal paths are proven here, deliberately kept separate:
 *
 *   1. THE STAGING FRIENDLY PRE-CHECK (ISSUE-177) -- a staging row with
 *      `local_match_id` set to the fixture match is seeded directly, so
 *      `deleteMatch`'s own SELECT finds it before anything destructive
 *      runs.
 *
 *   2. THE PERIOD-STATS FRIENDLY PRE-CHECK (ISSUE-180) -- a
 *      `player_match_period_stats` row is seeded directly, so `deleteMatch`
 *      refuses with a named count instead of forcing a raw FK violation.
 *
 *   3. THE AFL API LINEUP FRIENDLY PRE-CHECK (ISSUE-181) -- a
 *      `staging.afl_api_lineup` row with `match_id` set to the fixture match
 *      is seeded directly (via `staging.source_payloads` /
 *      `staging.source_record_versions` / `staging.afl_api_lineup`,
 *      bypassing `persistLineupBundle()` entirely, the same technique the
 *      pre-ISSUE-181 fallback fixture below used), so `deleteMatch` refuses
 *      with a named provider game/season instead of forcing a raw FK
 *      violation.
 *
 *   4. THE 23503 FALLBACK -- the concurrency/race-window backstop. Before
 *      ISSUE-181 this test forced a REAL, un-pre-checked foreign-key
 *      violation via `staging.afl_api_lineup.match_id`; now that ISSUE-181
 *      pre-checks that table too, a repository-wide inventory of every
 *      foreign key into `matches(id)` (see the ISSUE-181 issue entry) found
 *      NO remaining un-pre-checked dependency any ordinary fixture could use
 *      to force one. Operator direction (ISSUE-181) was to instead prove the
 *      fallback's actual remaining purpose -- the documented race window
 *      between a pre-check and the `DELETE FROM matches` statement, inside
 *      the same transaction -- using a test-only `BEFORE DELETE` trigger on
 *      `matches`, scoped to this test's own uniquely-marked fixture match,
 *      that inserts a genuine `player_match_period_stats` row referencing
 *      it immediately before PostgreSQL's own delete removes the row. The
 *      resulting 23503 is real, PostgreSQL-raised, and not source-inspected
 *      or fabricated; the trigger and its function are dropped in a
 *      `finally` block so no test-only schema object survives a failed run.
 *
 * None of these tests touch player_match_stats/match_period_scores content:
 * the fixture match has none, so "no partial dependent deletion" is proven
 * by the match row itself surviving intact, same as the ISSUE-167 Stage 6
 * pattern this file otherwise follows.
 */
import './guard';

import { createHash } from 'node:crypto';

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

async function createFixtureMatch(matchKey: string, venueRaw: string = MARKER): Promise<number> {
  const [match] = await owner<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${matchKey}, ${fixtureSeason}::smallint, '1', 'home_and_away', 1, false,
      ${`${fixtureSeason}-03-01`}::date, ${venueRaw}, ${clubHomeId}, ${clubAwayId}, 82, 76,
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
  // Child-before-parent: staging.afl_api_lineup and staging.source_record_versions
  // both reference import_batches and (via the composite FK) each other's
  // source_payloads row; sources is deleted last since everything above
  // references source_id.
  await owner`DELETE FROM staging.afl_api_lineup WHERE source_id = ${fixtureSourceId}`;
  await owner`DELETE FROM staging.source_record_versions WHERE source_id = ${fixtureSourceId}`;
  await owner`DELETE FROM staging.source_payloads WHERE source_id = ${fixtureSourceId}`;
  await owner`DELETE FROM staging.external_current_matches WHERE source_id = ${fixtureSourceId}`;
  await owner`DELETE FROM import_batches WHERE source_id = ${fixtureSourceId}`;
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

  it('AFLDB-ISSUE-180: refuses deletion, names the period-stats dependency, and changes nothing', async () => {
    const matchId = await createFixtureMatch(nextKey('match-d'));
    await owner`
      INSERT INTO player_match_period_stats (player_id, match_id, club_id, period)
      VALUES (${fixturePlayerId}, ${matchId}, ${clubHomeId}, 1)`;

    const result = await deleteMatch({ matchId, adminUserId: actorId, reason: `${MARKER}-180 refusal proof` });

    expect(result.ok, result.ok ? '' : result.error).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/player period statistic/i);
      expect(result.error).toContain('1');
      expect(result.error).not.toMatch(/foreign key|constraint|SQLSTATE|23503/i);
    }

    // The canonical match survives.
    const [stillMatch] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
    expect(stillMatch.n).toBe(1);

    // The period-stat row survives untouched.
    const [stillStats] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_match_period_stats WHERE match_id = ${matchId}`;
    expect(stillStats.n).toBe(1);

    await owner`DELETE FROM player_match_period_stats WHERE match_id = ${matchId}`;
  });

  it('AFLDB-ISSUE-181: refuses deletion, names the AFL API lineup dependency, and changes nothing', async () => {
    const matchId = await createFixtureMatch(nextKey('match-e'));
    const providerMatchId = nextKey('provider-match');
    const providerTeamId = nextKey('provider-team');
    const providerPlayerId = nextKey('provider-player');
    const externalRecordId = `${providerMatchId}|${providerTeamId}|${providerPlayerId}`;
    const payloadHash = createHash('sha256').update(externalRecordId).digest('hex');

    const [batch] = await owner<{ id: number }[]>`
      INSERT INTO import_batches (source_id, tool, target_table)
      VALUES (${fixtureSourceId}, 'tests/integration/match-admin-delete', 'staging.afl_api_lineup')
      RETURNING id`;

    await owner`
      INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
      VALUES (${fixtureSourceId}, 'lineup', ${payloadHash}, 'issue-181-fixture',
              ${owner.json({ marker: MARKER } as never)})`;

    await owner`
      INSERT INTO staging.source_record_versions (
        source_id, family, external_record_id, version_seq, payload_hash,
        observed_from, opened_by_batch_id
      ) VALUES (
        ${fixtureSourceId}, 'lineup', ${externalRecordId}, 1, ${payloadHash},
        now(), ${batch.id}
      )`;

    await owner`
      INSERT INTO staging.afl_api_lineup (
        source_id, family, external_record_id, version_seq,
        provider_match_id, provider_team_id, provider_player_id,
        season, round_number, status, team_status,
        match_id, projected_by_batch_id
      ) VALUES (
        ${fixtureSourceId}, 'lineup', ${externalRecordId}, 1,
        ${providerMatchId}, ${providerTeamId}, ${providerPlayerId},
        ${fixtureSeason}::smallint, 1, 'CONCLUDED', 'FINAL_TEAM',
        ${matchId}, ${batch.id}
      )`;

    const result = await deleteMatch({ matchId, adminUserId: actorId, reason: `${MARKER}-181 refusal proof` });

    expect(result.ok, result.ok ? '' : result.error).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/AFL API lineup/i);
      expect(result.error).toContain(String(fixtureSeason));
      expect(result.error).toContain(providerMatchId);
      expect(result.error).not.toMatch(/foreign key|constraint|SQLSTATE|23503/i);
    }

    // The canonical match survives.
    const [stillMatch] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
    expect(stillMatch.n).toBe(1);

    // The staging lineup row survives, WITH its match_id link intact --
    // never nulled/detached.
    const [stillLineup] = await owner<{ matchId: number | null }[]>`
      SELECT match_id AS "matchId" FROM staging.afl_api_lineup
       WHERE source_id = ${fixtureSourceId} AND external_record_id = ${externalRecordId}`;
    expect(stillLineup.matchId).toBe(matchId);

    // Upstream staging lineage (the observation spine) survives untouched.
    const [stillVersion] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM staging.source_record_versions
       WHERE source_id = ${fixtureSourceId} AND external_record_id = ${externalRecordId}`;
    expect(stillVersion.n).toBe(1);

    await owner`DELETE FROM staging.afl_api_lineup WHERE source_id = ${fixtureSourceId} AND external_record_id = ${externalRecordId}`;
    await owner`DELETE FROM staging.source_record_versions WHERE source_id = ${fixtureSourceId} AND external_record_id = ${externalRecordId}`;
    await owner`DELETE FROM staging.source_payloads WHERE source_id = ${fixtureSourceId} AND payload_hash = ${payloadHash}`;
    await owner`DELETE FROM import_batches WHERE id = ${batch.id}`;
  });

  it('maps a genuine race-window FK violation (23503) to a refusal instead of throwing', async () => {
    // AFLDB-ISSUE-181's FK inventory (see the issue entry) found that every
    // static foreign key into matches(id) is now pre-checked, actively
    // cleared, or auto-handled (CASCADE/SET NULL) -- so no ordinary fixture
    // can force deleteMatch's own `DELETE FROM matches` to hit a raw,
    // un-pre-checked 23503 any more. The generic catch's real remaining job
    // is the race window its own comment names: a dependency created AFTER
    // a pre-check runs but BEFORE `DELETE FROM matches` executes, inside the
    // SAME transaction. That interleaving can't be forced deterministically
    // from a second connection, so it is simulated here from INSIDE
    // deleteMatch's own transaction with a test-only `BEFORE DELETE` trigger
    // on `matches`.
    //
    // The trigger is scoped by a `WHEN` clause to this one fixture match's
    // unique `venue_raw` marker (generated fresh per run), so it can never
    // fire for any other row -- in this file or any other test file sharing
    // afldb_test -- even under parallel test execution. When PostgreSQL
    // fires it (immediately before removing the matches row, which is
    // strictly after deleteMatch's own player_match_period_stats pre-check
    // already ran and found nothing), it inserts a genuine
    // player_match_period_stats row referencing the match being deleted.
    // The subsequent NO ACTION FK check on `DELETE FROM matches` then raises
    // a real PostgreSQL 23503 -- not a fabricated error -- and the whole
    // transaction, including the trigger's own INSERT, rolls back with it,
    // so nothing (not even the trigger-injected row) survives.
    const trapVenue = `${MARKER}-181-23503-trap-${Date.now().toString(36)}-${seeded += 1}`;
    const matchId = await createFixtureMatch(nextKey('match-c'), trapVenue);
    const fnName = `fn_issue_181_trap_${matchId}`;
    const trgName = `trg_issue_181_trap_${matchId}`;

    try {
      await owner.unsafe(`
        CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $trap$
        BEGIN
          INSERT INTO player_match_period_stats (player_id, match_id, club_id, period)
          VALUES ((SELECT id FROM players ORDER BY id LIMIT 1), OLD.id, OLD.home_club_id, 9);
          RETURN OLD;
        END;
        $trap$ LANGUAGE plpgsql
      `);
      await owner.unsafe(`
        CREATE TRIGGER ${trgName}
        BEFORE DELETE ON matches
        FOR EACH ROW
        WHEN (OLD.venue_raw = '${trapVenue}')
        EXECUTE FUNCTION ${fnName}()
      `);

      const result = await deleteMatch({
        matchId, adminUserId: actorId, reason: `${MARKER} 23503 race-window proof`,
      });

      expect(result.ok, result.ok ? '' : result.error).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/another record still depends on it/);
        expect(result.error).not.toMatch(/foreign key|constraint|SQLSTATE|23503/i);
      }

      // No partial deletion: the canonical match survives.
      const [stillMatch] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches WHERE id = ${matchId}`;
      expect(stillMatch.n).toBe(1);

      // The trigger's own INSERT rolled back with the rest of the failed
      // transaction -- it does not leak as an orphaned dependent row.
      const [leaked] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM player_match_period_stats WHERE match_id = ${matchId}`;
      expect(leaked.n).toBe(0);
    } finally {
      // Trigger/function/fixture cleanup runs even if an assertion above
      // throws, so a failed run never leaves test-only schema objects
      // behind for the next one.
      await owner.unsafe(`DROP TRIGGER IF EXISTS ${trgName} ON matches`);
      await owner.unsafe(`DROP FUNCTION IF EXISTS ${fnName}()`);
      await owner`DELETE FROM matches WHERE id = ${matchId}`;
    }
  });
});
