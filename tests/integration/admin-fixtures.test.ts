/**
 * Fixture administration against a real PostgreSQL (AFLDB-ISSUE-162 Stage 1).
 *
 * These are the claims that can be proved nowhere else: that a mutation really
 * writes the canonical row, the `data_overrides` durable record and the
 * `data_edits` audit row TOGETHER and rolls all three back on any failure; that
 * a fixture really survives the REAL `replay_admin_overrides('fixtures')` out of
 * `tools/migration/common.py` — the function a promotion and a destructive
 * reload run — including its `cancelled` and `void` states; that the read-time
 * played resolution really resolves against a real `matches` row and really
 * fails closed when it is ambiguous; and, above all, that entering a fixture
 * moves NO played-match fact and NO derived statistic (§21, S-1).
 *
 * The pure half — key shape, round rendering, TBC rules, season arithmetic, the
 * played-resolution truth table, the lifecycle matrix and the precondition
 * refusals over a fake transaction — is `tests/admin-fixture-actions.test.ts`
 * and is not re-proved here.
 *
 * FIXTURES AND SEASONS. Two seasons are used, deliberately:
 *
 *   seasonNext = max(seasons.year) + 1   the administrable FUTURE season. It has
 *                                        no `seasons` row, no `matches` row and
 *                                        no `club_seasons` row, and NONE is
 *                                        created (D-3) — which is the whole
 *                                        point: a fixture is intent about a
 *                                        season the register has not reached.
 *   seasonNow  = max(seasons.year)       the in-progress season, used ONLY for
 *                                        the played-resolution proofs, because
 *                                        `matches.season REFERENCES seasons(year)`
 *                                        so a played row cannot exist in a
 *                                        season the register does not hold. Work
 *                                        there is confined to round MARKER_ROUND,
 *                                        which no real match uses (asserted).
 *
 * Every row created here is removed in `afterAll`, including the durable
 * records — a `data_overrides` row OUTLIVES the canonical row it describes, so
 * an orphan left behind would be REPLAYED by the next run.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  administrableFixtureSeasons,
  cancelFixture,
  changeFixtureClubs,
  changeFixtureRound,
  changeFixtureVenue,
  createFixture,
  createFixtures,
  eligibleFixtureClubs,
  fixtureEntityKey,
  readFixture,
  readFixtureDiagnostics,
  readFixtureOverrides,
  readFixtureSeasonSummary,
  readPlayedMatchesWithoutFixture,
  readSeasonFixtures,
  reinstateFixture,
  rescheduleFixture,
  updateFixtureNotes,
  voidFixture,
} from '@/db/queries/admin-fixtures';

/*
 * TEST DATABASE SAFETY. tests/setup.ts redirects DATABASE_URL to afldb_test and
 * refuses anything not ending in `_test`. It does NOT touch
 * AFLDB_IMPORT_DATABASE_URL, and the repository .env points that at afldb_dev —
 * so without this redirect every mutation here would land in afldb_dev. The
 * module-level redirect is the established convention in this directory.
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const admin = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-162-TEST';
const AUDIT_FAIL_NOTE = 'AFLDB-ISSUE-162-GATE-FORCE-FAIL';
const OVERRIDE_FAIL_NOTE = 'AFLDB-ISSUE-162-OVERRIDE-FORCE-FAIL';
/** A home-and-away round no real match uses, so seasonNow work disturbs nothing. */
const MARKER_ROUND = 30;

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}
const canReplay = hasPsycopg();

/**
 * Run the REAL `replay_admin_overrides` out of `tools/migration/common.py`
 * against `afldb_test`. Spawning the real function is the point: a
 * reimplementation of the replay in TypeScript would prove only that two pieces
 * of test code agree.
 */
function runReplay(...tables: string[]) {
  const script = [
    'import sys, os',
    `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
    'import psycopg',
    'from common import replay_admin_overrides',
    'conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"])',
    'try:',
    `    for table in ${JSON.stringify(tables)}:`,
    '        replay_admin_overrides(conn, table)',
    '    conn.commit()',
    'finally:',
    '    conn.close()',
    'print("REPLAY OK")',
  ].join('\n');
  return spawnSync(python, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AFLDB_REPLAY_DSN: testDbUrl },
  });
}

let actorId = 0;
let createdThrowawayAdmin = false;
let maxYear = 0;
let seasonNow = 0;
let seasonNext = 0;
let clubA = { id: 0, slug: '', name: '', organizationId: 0 };
let clubB = { id: 0, slug: '', name: '', organizationId: 0 };
let clubC = { id: 0, slug: '', name: '', organizationId: 0 };
let clubD = { id: 0, slug: '', name: '', organizationId: 0 };
let venue = { id: 0, slug: '', canonicalName: '' };
let otherVenue = { id: 0, slug: '', canonicalName: '' };
const markerMatchIds: number[] = [];

type FixtureInput = Parameters<typeof createFixture>[0];

function baseInput(over: Partial<FixtureInput> = {}): FixtureInput {
  return {
    season: seasonNext,
    roundType: 'home_and_away',
    roundNumber: 1,
    homeClubId: clubA.id,
    awayClubId: clubB.id,
    matchDate: `${seasonNext}-03-18`,
    matchTime: '19:20',
    venueId: venue.id,
    adminUserId: actorId,
    ...over,
  };
}

/** Create a fixture and fail the test loudly rather than returning a refusal. */
async function mustCreate(over: Partial<FixtureInput> = {}): Promise<string> {
  const result = await createFixture(baseInput(over));
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  return (result as { fixtureKey: string }).fixtureKey;
}

async function fixtureRow(fixtureKey: string) {
  const [row] = await admin<Record<string, unknown>[]>`
    SELECT * FROM fixtures WHERE fixture_key = ${fixtureKey}`;
  return row ?? null;
}

async function updatedAt(fixtureKey: string): Promise<string> {
  const [row] = await admin<{ updatedAt: string }[]>`
    SELECT updated_at::text AS "updatedAt" FROM fixtures WHERE fixture_key = ${fixtureKey}`;
  return row.updatedAt;
}

async function auditRows(fixtureKey: string) {
  return admin<{
    fieldGroup: string; oldValues: Record<string, unknown>; newValues: Record<string, unknown>;
  }[]>`
    SELECT de.field_group AS "fieldGroup", de.old_values AS "oldValues",
           de.new_values AS "newValues"
      FROM data_edits de
      JOIN fixtures f ON f.id = de.row_id
     WHERE de.table_name = 'fixtures' AND f.fixture_key = ${fixtureKey}
     ORDER BY de.id`;
}

/** Every played-match and derived fact this issue must not be able to move. */
async function playedFacts() {
  const [row] = await sql<{
    matches: number; periodScores: number; playerMatchStats: number;
    clubSeasons: number; ladder: string | null; matchCount: number | null;
  }[]>`
    SELECT (SELECT count(*)::int FROM matches) AS matches,
           (SELECT count(*)::int FROM match_period_scores) AS "periodScores",
           (SELECT count(*)::int FROM player_match_stats) AS "playerMatchStats",
           (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonNow}) AS "clubSeasons",
           (SELECT md5(string_agg(
                     cs.club_id::text || ':' || cs.wins::text || ':' || cs.losses::text
                       || ':' || cs.draws::text || ':' || cs.points_for::text, ','
                     ORDER BY cs.club_id))
              FROM club_seasons cs WHERE cs.season = ${seasonNow}) AS ladder,
           (SELECT match_count FROM seasons WHERE year = ${seasonNow}) AS "matchCount"`;
  return row;
}

async function clearFixtureState(): Promise<void> {
  // The durable record OUTLIVES the canonical row — that is the point of it —
  // so the teardown clears BOTH. The override and audit deletes are
  // UNFILTERED within their entity: `fixtures` arrives with migration 097 and
  // nothing outside this suite writes it, and several proofs deliberately
  // CORRUPT a payload (a non-numeric season, an invalid status), so a teardown
  // that filtered on `(override_values->>'season')::int` would fail on the very
  // rows it exists to remove — and an orphan left behind would be REPLAYED by
  // the next run.
  await admin`DELETE FROM data_edits WHERE table_name = 'fixtures'`;
  await admin`DELETE FROM data_overrides WHERE entity_type = 'fixtures'`;
  await admin`DELETE FROM fixtures WHERE season IN (${seasonNow}, ${seasonNext})`;
}

beforeAll(async () => {
  const [bound] = await sql<{ maxYear: number }[]>`SELECT max(year)::int AS "maxYear" FROM seasons`;
  maxYear = bound.maxYear;
  seasonNow = maxYear;
  seasonNext = maxYear + 1;

  const eligible = await eligibleFixtureClubs(seasonNext);
  expect(eligible.length, 'need four eligible clubs').toBeGreaterThan(3);
  [clubA, clubB, clubC, clubD] = eligible;

  const venues = await admin<{ id: number; slug: string; canonicalName: string }[]>`
    SELECT id, slug, canonical_name AS "canonicalName" FROM venues ORDER BY id LIMIT 2`;
  expect(venues.length, 'need two venues').toBe(2);
  [venue, otherVenue] = venues;

  const [existingAdmin] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await admin<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-162-fixture-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  // Debris from a crashed earlier run would be REPLAYED by this one, so the
  // suite clears its own state before it starts rather than assuming the last
  // run exited cleanly.
  await clearFixtureState();
  await admin`DELETE FROM matches WHERE match_key LIKE ${`${MARKER}%`}`;

  // The marker round of the in-progress season must be empty, or the
  // played-resolution proofs would be reading someone else's data.
  const [markerRound] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches
     WHERE season = ${seasonNow} AND round_code = ${String(MARKER_ROUND)}`;
  expect(markerRound.n, `round ${MARKER_ROUND} of ${seasonNow} must hold no real match`).toBe(0);

  // Two suite-scoped failure seams, one per table a mutation writes besides the
  // canonical row. Every mutation takes an optional `note`/`notes` that flows
  // into recordDataEdit() and the override payload and nowhere else, so this
  // exercises a seam the production code already exposes.
  await admin`
    CREATE OR REPLACE FUNCTION issue162_test_force_data_edits_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.note = 'AFLDB-ISSUE-162-GATE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-162: forced data_edits failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue162_test_force_data_edits_failure_trg ON data_edits`;
  await admin`
    CREATE TRIGGER issue162_test_force_data_edits_failure_trg
      BEFORE INSERT ON data_edits
      FOR EACH ROW EXECUTE FUNCTION issue162_test_force_data_edits_failure()`;

  await admin`
    CREATE OR REPLACE FUNCTION issue162_test_force_overrides_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_type = 'fixtures'
         AND NEW.override_values->>'notes' = 'AFLDB-ISSUE-162-OVERRIDE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-162: forced data_overrides failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue162_test_force_overrides_failure_trg ON data_overrides`;
  await admin`
    CREATE TRIGGER issue162_test_force_overrides_failure_trg
      BEFORE INSERT OR UPDATE ON data_overrides
      FOR EACH ROW EXECUTE FUNCTION issue162_test_force_overrides_failure()`;
});

afterAll(async () => {
  await admin`DROP TRIGGER IF EXISTS issue162_test_force_data_edits_failure_trg ON data_edits`;
  await admin`DROP FUNCTION IF EXISTS issue162_test_force_data_edits_failure()`;
  await admin`DROP TRIGGER IF EXISTS issue162_test_force_overrides_failure_trg ON data_overrides`;
  await admin`DROP FUNCTION IF EXISTS issue162_test_force_overrides_failure()`;

  await clearFixtureState();
  if (markerMatchIds.length) {
    await admin`DELETE FROM matches WHERE id = ANY(${markerMatchIds}::int[])`;
  }
  await admin`DELETE FROM matches WHERE match_key LIKE ${`${MARKER}%`}`;
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;

  await admin.end({ timeout: 5 });
  await sql.end({ timeout: 5 });
});

/**
 * Insert a PLAYED match through the OWNER connection — never through
 * AFLDB-ISSUE-162 code, which has no path that writes `matches` at all. This is
 * the only thing in the suite that creates a result.
 *
 * ORDER IS PART OF THE CONTRACT, which is why this is no longer called a
 * "seed": a seed sounds like setup, and calling it as setup is wrong.
 *
 * §13's I-3 precondition REFUSES `createFixture()` for a game AFLDB already
 * holds as a result (`already_played`) — the result is the authority and there
 * is nothing left to schedule. The read-time linkage of §18 is about the other
 * chronology, and only that one:
 *
 *     1. the fixture exists while the game is SCHEDULED;
 *     2. the played `matches` row arrives LATER;
 *     3. reads of the fixture resolve against that result.
 *
 * A played-resolution test therefore writes the fixture FIRST and calls this
 * SECOND, as two explicit lines:
 *
 *     const key = await mustCreate({ ... });
 *     const matchId = await insertPlayedMatch({ ... });
 *
 * Calling this first makes `mustCreate()` fail with `already_played`, which is
 * the §13 guard working rather than a resolution defect. The two calls are
 * deliberately NOT folded into one helper: their order is the thing under test,
 * so it has to be visible in the test that depends on it.
 */
async function insertPlayedMatch(input: {
  suffix: string; homeClubId: number; awayClubId: number; roundCode?: string;
  roundNumber?: number | null; roundType?: string; matchDate?: string;
}): Promise<number> {
  const roundCode = input.roundCode ?? String(MARKER_ROUND);
  const roundType = input.roundType ?? 'home_and_away';
  const roundNumber = roundType === 'home_and_away'
    ? (input.roundNumber ?? MARKER_ROUND) : null;
  const [row] = await admin<{ id: number }[]>`
    INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final,
                         match_date, venue_raw, home_club_id, away_club_id,
                         home_score, away_score, result, winner_club_id, margin,
                         attendance, attendance_status)
    VALUES (${`${MARKER}|${input.suffix}`}, ${seasonNow}::smallint, ${roundCode},
            ${roundNumber}::smallint, ${roundType}::round_type,
            ${roundType !== 'home_and_away'},
            ${input.matchDate ?? `${seasonNow}-08-01`}::date, ${`${MARKER} Venue`},
            ${input.homeClubId}, ${input.awayClubId},
            100, 50, 'home_win'::match_result, ${input.homeClubId}, 50,
            NULL, 'not_collected'::coverage_status)
    RETURNING id`;
  markerMatchIds.push(row.id);
  return row.id;
}

// -------------------------------------------------------------------------

describe('the season boundary (§8, D-3)', () => {
  it('administers the next season without any seasons, clubs or club_seasons row', async () => {
    const bounds = await administrableFixtureSeasons();
    expect(bounds).toEqual({ first: seasonNow, last: seasonNext });

    const [counts] = await sql<{ seasons: number; matches: number; clubSeasons: number }[]>`
      SELECT (SELECT count(*)::int FROM seasons WHERE year = ${seasonNext}) AS seasons,
             (SELECT count(*)::int FROM matches WHERE season = ${seasonNext}) AS matches,
             (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonNext}) AS "clubSeasons"`;
    expect(counts).toEqual({ seasons: 0, matches: 0, clubSeasons: 0 });

    const key = await mustCreate();
    expect(await fixtureRow(key)).toMatchObject({ season: seasonNext, status: 'scheduled' });

    // Still none afterwards. "Opening a season" is the first fixture written
    // for it, not a database initialisation step.
    const [after] = await sql<{ seasons: number; clubSeasons: number }[]>`
      SELECT (SELECT count(*)::int FROM seasons WHERE year = ${seasonNext}) AS seasons,
             (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonNext}) AS "clubSeasons"`;
    expect(after).toEqual({ seasons: 0, clubSeasons: 0 });
    await clearFixtureState();
  });

  it('refuses history and refuses beyond the next season', async () => {
    expect(await createFixture(baseInput({ season: maxYear - 1 })))
      .toMatchObject({ ok: false, reason: 'season_out_of_window' });
    expect(await createFixture(baseInput({ season: maxYear + 2 })))
      .toMatchObject({ ok: false, reason: 'season_out_of_window' });
  });

  it('has a test ceiling that can only RAISE the window, never lower its floor', async () => {
    process.env.AFLDB_FIXTURE_TEST_MAX_SEASON = String(maxYear + 1);
    try {
      expect(await administrableFixtureSeasons()).toEqual({
        first: maxYear + 1, last: maxYear + 2,
      });
    } finally {
      delete process.env.AFLDB_FIXTURE_TEST_MAX_SEASON;
    }
    expect(await administrableFixtureSeasons()).toEqual({ first: seasonNow, last: seasonNext });
  });
});

describe('creating a fixture (§13)', () => {
  it('writes the canonical row, the durable record and the audit row together', async () => {
    const key = await mustCreate({ notes: 'Season opener' });
    const row = await fixtureRow(key);
    expect(row).toMatchObject({
      season: seasonNext,
      round_code: '1',
      round_number: 1,
      round_type: 'home_and_away',
      is_final: false,
      status: 'scheduled',
      status_reason: null,
      home_club_id: clubA.id,
      away_club_id: clubB.id,
      venue_id: venue.id,
      venue_raw: venue.canonicalName,
      source_record_id: key,
    });

    const overrides = await readFixtureOverrides(key);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      entityKey: fixtureEntityKey(key), fieldGroup: 'fixture', isActive: true,
    });
    expect(overrides[0].overrideValues).toMatchObject({
      fixture_key: key,
      season: seasonNext,
      round_code: '1',
      home_club_slug: clubA.slug,
      away_club_slug: clubB.slug,
      venue_slug: venue.slug,
      status: 'scheduled',
      notes: 'Season opener',
    });

    const audits = await auditRows(key);
    expect(audits).toHaveLength(1);
    expect(audits[0].fieldGroup).toBe('fixture_creation');
    expect(audits[0].oldValues).toEqual({});
    expect(audits[0].newValues).toMatchObject({ fixture_key: key, season: seasonNext });
    await clearFixtureState();
  });

  it('has no score, result, attendance or statistic anywhere on it', async () => {
    const key = await mustCreate();
    const row = (await fixtureRow(key))!;
    for (const column of Object.keys(row)) {
      expect(column).not.toMatch(/score|goal|behind|margin|winner|attendance|result/);
    }
    // And nothing that could become one: no match id, no match key.
    expect(Object.keys(row)).not.toContain('match_id');
    expect(Object.keys(row)).not.toContain('match_key');
    await clearFixtureState();
  });

  it('refuses the duplicate, the double-booked club and the same club twice', async () => {
    await mustCreate();
    expect(await createFixture(baseInput()))
      .toMatchObject({ ok: false, reason: 'duplicate_fixture' });
    expect(await createFixture(baseInput({ homeClubId: clubB.id, awayClubId: clubA.id })))
      .toMatchObject({ ok: false, reason: 'duplicate_fixture' });
    expect(await createFixture(baseInput({ awayClubId: clubC.id })))
      .toMatchObject({ ok: false, reason: 'club_already_scheduled' });
    expect(await createFixture(baseInput({ homeClubId: clubC.id, awayClubId: clubC.id })))
      .toMatchObject({ ok: false, reason: 'same_club' });

    // Exactly one row exists: every refusal wrote nothing.
    const [count] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fixtures WHERE season = ${seasonNext}`;
    expect(count.n).toBe(1);
    await clearFixtureState();
  });

  it('lets two other clubs play in the same round — a round is not one game', async () => {
    await mustCreate();
    const second = await mustCreate({ homeClubId: clubC.id, awayClubId: clubD.id });
    expect(await fixtureRow(second)).toMatchObject({ round_code: '1' });
    await clearFixtureState();
  });
});

describe('TBC facts (§10, §11, D-5)', () => {
  it('stores an unknown date, time and venue as NULL and nothing else', async () => {
    const key = await mustCreate({ matchDate: null, matchTime: null, venueId: null });
    expect(await fixtureRow(key)).toMatchObject({
      match_date: null, match_time: null, venue_id: null, venue_raw: null,
    });
    const summary = await readFixtureSeasonSummary(seasonNext);
    expect(summary).toMatchObject({ dateTbc: 1, timeTbc: 1, venueTbc: 1, fixtures: 1 });
    await clearFixtureState();
  });

  it('accepts a known date with an unknown time', async () => {
    const key = await mustCreate({ matchTime: null });
    expect(await fixtureRow(key)).toMatchObject({
      match_date: expect.anything(), match_time: null,
    });
    await clearFixtureState();
  });

  it('keeps a named but unmapped venue rather than creating one', async () => {
    const before = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM venues`;
    const key = await mustCreate({ venueId: null, venueRaw: 'A Ground Not In Venues' });
    expect(await fixtureRow(key)).toMatchObject({
      venue_id: null, venue_raw: 'A Ground Not In Venues',
    });
    const after = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM venues`;
    expect(after[0].n).toBe(before[0].n);
    await clearFixtureState();
  });

  it('fills a TBC in later without moving the identity', async () => {
    const key = await mustCreate({ matchDate: null, matchTime: null, venueId: null });
    const result = await rescheduleFixture({
      fixtureKey: key,
      expectedUpdatedAt: await updatedAt(key),
      adminUserId: actorId,
      matchDate: `${seasonNext}-03-20`,
      matchTime: '13:45',
    });
    expect(result).toMatchObject({ ok: true, fixtureKey: key });
    expect(await fixtureRow(key)).toMatchObject({
      fixture_key: key, match_time: '13:45',
    });
    await clearFixtureState();
  });
});

describe('editing never moves the identity (§6, §15)', () => {
  it('survives a date, time, venue, round and club change under one fixture_key', async () => {
    const key = await mustCreate();
    const originalId = (await fixtureRow(key))!.id;

    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNext}-03-25`, matchTime: '16:10',
    })).toMatchObject({ ok: true });

    expect(await changeFixtureVenue({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      venueId: otherVenue.id,
    })).toMatchObject({ ok: true });

    expect(await changeFixtureRound({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      roundType: 'home_and_away', roundNumber: 7,
    })).toMatchObject({ ok: true });

    expect(await changeFixtureClubs({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      homeClubId: clubB.id, awayClubId: clubA.id,
    })).toMatchObject({ ok: true });

    const row = (await fixtureRow(key))!;
    expect(row).toMatchObject({
      id: originalId,
      fixture_key: key,
      source_record_id: key,
      match_date: expect.anything(),
      match_time: '16:10',
      venue_id: otherVenue.id,
      venue_raw: otherVenue.canonicalName,
      round_code: '7',
      round_number: 7,
      home_club_id: clubB.id,
      away_club_id: clubA.id,
    });

    // The durable record moved with it — same key, new facts.
    const overrides = await readFixtureOverrides(key);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].overrideValues).toMatchObject({
      fixture_key: key, round_code: '7',
      home_club_slug: clubB.slug, away_club_slug: clubA.slug,
      venue_slug: otherVenue.slug,
    });

    // One audit row per change, each naming the fixture.
    expect((await auditRows(key)).map((a) => a.fieldGroup)).toEqual([
      'fixture_creation', 'fixture_schedule', 'fixture_venue', 'fixture_round', 'fixture_clubs',
    ]);
    await clearFixtureState();
  });

  it('refuses a stale edit rather than overwriting a concurrent one', async () => {
    const key = await mustCreate();
    const stale = await updatedAt(key);
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: stale, adminUserId: actorId,
      matchDate: `${seasonNext}-04-01`,
    })).toMatchObject({ ok: true });
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: stale, adminUserId: actorId,
      matchDate: `${seasonNext}-04-08`,
    })).toMatchObject({ ok: false, reason: 'stale' });
    await clearFixtureState();
  });

  it('re-runs the collision checks when a fixture moves round or clubs', async () => {
    const first = await mustCreate();
    await mustCreate({ roundNumber: 2, homeClubId: clubC.id, awayClubId: clubD.id });

    // Moving the first fixture into round 2 puts nobody in two games, so it works.
    expect(await changeFixtureRound({
      fixtureKey: first, expectedUpdatedAt: await updatedAt(first), adminUserId: actorId,
      roundType: 'home_and_away', roundNumber: 2,
    })).toMatchObject({ ok: true });

    // But swapping its clubs to a pair already booked in round 2 is refused.
    expect(await changeFixtureClubs({
      fixtureKey: first, expectedUpdatedAt: await updatedAt(first), adminUserId: actorId,
      homeClubId: clubC.id, awayClubId: clubD.id,
    })).toMatchObject({ ok: false, reason: 'duplicate_fixture' });
    await clearFixtureState();
  });
});

describe('cancel, reinstate and void (§16, D-2)', () => {
  it('cancels without deleting, and reinstates', async () => {
    const key = await mustCreate();
    expect(await cancelFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      reason: 'Abandoned: unplayable ground',
    })).toMatchObject({ ok: true });

    const cancelled = (await fixtureRow(key))!;
    expect(cancelled).toMatchObject({
      status: 'cancelled', status_reason: 'Abandoned: unplayable ground',
    });
    // The schedule facts are all still there — a cancellation records that a
    // REAL scheduled event did not happen, so what was scheduled still matters.
    expect(cancelled.match_date).not.toBeNull();
    expect(cancelled.venue_id).toBe(venue.id);
    expect((await readFixtureOverrides(key))[0].overrideValues)
      .toMatchObject({ status: 'cancelled', status_reason: 'Abandoned: unplayable ground' });

    expect(await reinstateFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
    })).toMatchObject({ ok: true });
    expect(await fixtureRow(key)).toMatchObject({ status: 'scheduled', status_reason: null });

    expect((await auditRows(key)).map((a) => a.fieldGroup))
      .toEqual(['fixture_creation', 'fixture_cancelled', 'fixture_reinstated']);
    await clearFixtureState();
  });

  it('voids without deleting, and a void row is terminal and excluded', async () => {
    const key = await mustCreate();
    expect(await voidFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      reason: 'Entered against the wrong club',
    })).toMatchObject({ ok: true });
    expect(await fixtureRow(key)).toMatchObject({ status: 'void' });

    // Terminal: every schedule edit is refused, and so is reinstating.
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNext}-05-01`,
    })).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(await reinstateFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
    })).toMatchObject({ ok: false, reason: 'invalid_transition' });

    // Excluded from the uniqueness rules: the same pair can be entered again.
    const replacement = await mustCreate();
    expect(replacement).not.toBe(key);

    // Hidden by default, visible on request, and never deleted.
    expect((await readSeasonFixtures(seasonNext)).map((f) => f.fixtureKey)).toEqual([replacement]);
    expect((await readSeasonFixtures(seasonNext, { includeVoid: true })).map((f) => f.fixtureKey)
      .sort()).toEqual([key, replacement].sort());
    // Notes stay writable, so the record of why can be completed.
    expect(await updateFixtureNotes({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      notes: 'Superseded by the corrected fixture',
    })).toMatchObject({ ok: true });
    await clearFixtureState();
  });

  it('refuses a cancellation or voiding with no reason, and writes nothing', async () => {
    const key = await mustCreate();
    const before = await updatedAt(key);
    expect(await cancelFixture({
      fixtureKey: key, expectedUpdatedAt: before, adminUserId: actorId, reason: ' ',
    })).toMatchObject({ ok: false, reason: 'validation' });
    expect(await updatedAt(key)).toBe(before);
    await clearFixtureState();
  });
});

describe('finals (§17)', () => {
  it('creates a finals fixture with no round number and no placeholder club', async () => {
    const key = await mustCreate({
      roundType: 'grand_final', roundNumber: null,
      matchDate: null, matchTime: null, venueId: null,
    });
    expect(await fixtureRow(key)).toMatchObject({
      round_type: 'grand_final', round_code: 'GF', round_number: null, is_final: true,
    });
    // Both clubs are tracked identities: no "TBC" club was invented.
    const [clubs] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM clubs
       WHERE name ILIKE '%TBC%' OR slug ILIKE '%tbc%'`;
    expect(clubs.n).toBe(0);

    // The same two clubs may meet twice in a series: round_code separates them.
    const qf = await mustCreate({
      roundType: 'qualifying_final', roundNumber: null,
      matchDate: null, matchTime: null, venueId: null,
    });
    expect(await fixtureRow(qf)).toMatchObject({ round_code: 'QF' });
    await clearFixtureState();
  });
});

describe('the read-time played resolution (§18, D-6)', () => {
  it('resolves to the played match on the exact season, round and club pair', async () => {
    // The chronology this contract is about: the fixture is entered while the
    // game is still SCHEDULED, so it reads as unplayed...
    const key = await mustCreate({
      season: seasonNow, roundNumber: MARKER_ROUND,
      matchDate: `${seasonNow}-08-01`, matchTime: '19:20',
    });
    expect((await readFixture(key))!.playedState).toBe('unplayed');

    // ...and the result arrives afterwards. Nothing about the fixture row
    // changes; the SAME row now reads as played, which is what "derived, never
    // stored" means (§18, D-6).
    const matchId = await insertPlayedMatch({
      suffix: 'exact', homeClubId: clubA.id, awayClubId: clubB.id,
    });
    const fixture = (await readFixture(key))!;
    expect(fixture.playedState).toBe('played');
    expect(fixture.playedMatchId).toBe(matchId);

    // The link is READ-TIME only: nothing was written onto the fixture.
    const row = (await fixtureRow(key))!;
    expect(Object.keys(row)).not.toContain('match_id');
    expect(JSON.stringify(row)).not.toContain(String(matchId));
    expect((await readFixtureOverrides(key))[0].overrideValues)
      .not.toHaveProperty('match_id');

    await clearFixtureState();
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });

  it('still resolves after the date, time and venue have all changed', async () => {
    // Scheduled for one day, one time and one ground...
    const key = await mustCreate({
      season: seasonNow, roundNumber: MARKER_ROUND,
      matchDate: `${seasonNow}-07-04`, matchTime: '19:20', venueId: venue.id,
    });
    // ...then moved twice while it is still unplayed, which is exactly what a
    // fixture exists to record.
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNow}-07-11`, matchTime: '13:10',
    })).toMatchObject({ ok: true });
    expect(await changeFixtureVenue({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      venueId: otherVenue.id,
    })).toMatchObject({ ok: true });

    // ...and the game is finally played on a different day again, at a ground
    // that is not the fixture's. Date, time and venue ALL disagree now, and the
    // resolution uses none of the three — it is season, round code and club ids
    // only, which is precisely why a reschedule cannot break it.
    const matchId = await insertPlayedMatch({
      suffix: 'reschedule', homeClubId: clubA.id, awayClubId: clubB.id,
      matchDate: `${seasonNow}-08-01`,
    });

    const fixture = (await readFixture(key))!;
    expect(fixture.matchDate).toBe(`${seasonNow}-07-11`);
    expect(fixture.venueId).toBe(otherVenue.id);
    expect(fixture.playedState).toBe('played');
    expect(fixture.playedMatchId).toBe(matchId);
    // ...and the disagreement is REPORTED rather than resolved away.
    expect(fixture.scheduleDiffersFromResult).toBe(true);

    await clearFixtureState();
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });

  it('links a swapped home/away with a warning, never silently', async () => {
    const key = await mustCreate({
      season: seasonNow, roundNumber: MARKER_ROUND,
      matchDate: `${seasonNow}-08-01`,
    });
    // The game was played with the home and away clubs the other way round.
    const matchId = await insertPlayedMatch({
      suffix: 'swapped', homeClubId: clubB.id, awayClubId: clubA.id,
    });

    const fixture = (await readFixture(key))!;
    expect(fixture.playedState).toBe('played_home_away_differs');
    expect(fixture.playedMatchId).toBe(matchId);

    // "Never silently": the link is made AND the disagreement is reported.
    const diagnostics = await readFixtureDiagnostics(seasonNow);
    expect(diagnostics.map((d) => d.code)).toContain('played_home_away_differs');
    const warning = diagnostics.find((d) => d.code === 'played_home_away_differs')!;
    expect(warning.severity).toBe('warning');
    expect(warning.fixtureKeys).toContain(key);

    // And nothing was written onto the fixture to record the association.
    const row = (await fixtureRow(key))!;
    expect(Object.keys(row)).not.toContain('match_id');
    expect(Object.keys(row)).not.toContain('match_key');
    expect(JSON.stringify(row)).not.toContain(String(matchId));

    await clearFixtureState();
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });

  it('FAILS CLOSED when two results could be the same fixture', async () => {
    // Deliberately scheduled for a day NEITHER result was played on, so a
    // resolution that reached for an arbitrary candidate row would report a
    // schedule disagreement against it. It must report nothing at all.
    const key = await mustCreate({
      season: seasonNow, roundNumber: MARKER_ROUND, matchDate: `${seasonNow}-07-04`,
    });
    // Two results for the same season, round and club pair: one exact, one
    // swapped. Either could be this fixture, so neither is it.
    const first = await insertPlayedMatch({
      suffix: 'ambiguous-a', homeClubId: clubA.id, awayClubId: clubB.id,
      matchDate: `${seasonNow}-08-01`,
    });
    const second = await insertPlayedMatch({
      suffix: 'ambiguous-b', homeClubId: clubB.id, awayClubId: clubA.id,
      matchDate: `${seasonNow}-08-08`,
    });

    const fixture = (await readFixture(key))!;
    expect(fixture.playedState).toBe('ambiguous');
    expect(fixture.playedMatchId).toBeNull();
    // D-6: no result fact is borrowed from either candidate. One exact
    // candidate is NOT preferred over a competing swapped one, and the
    // schedule is not compared against a row the resolution did not link.
    expect(fixture.scheduleDiffersFromResult).toBe(false);

    // The season read agrees with the single read — one resolution, two callers.
    const inSeason = (await readSeasonFixtures(seasonNow)).find((f) => f.fixtureKey === key)!;
    expect(inSeason).toMatchObject({
      playedState: 'ambiguous', playedMatchId: null, scheduleDiffersFromResult: false,
    });

    // ...and it is surfaced as INVALID rather than merged or guessed at.
    const diagnostics = await readFixtureDiagnostics(seasonNow);
    expect(diagnostics.map((d) => d.code)).toContain('ambiguous_played_resolution');
    const bad = diagnostics.find((d) => d.code === 'ambiguous_played_resolution')!;
    expect(bad.severity).toBe('invalid');
    expect(bad.fixtureKeys).toContain(key);

    await clearFixtureState();
    await admin`DELETE FROM matches WHERE id = ANY(${[first, second]}::int[])`;
  });

  it('locks a played fixture to notes-only edits', async () => {
    // Scheduled first, and freely editable while it is unplayed...
    const key = await mustCreate({
      season: seasonNow, roundNumber: MARKER_ROUND, matchDate: `${seasonNow}-08-01`,
    });
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNow}-08-01`, matchTime: '13:10',
    })).toMatchObject({ ok: true });

    // ...then the game is played, and the result becomes the authority.
    const matchId = await insertPlayedMatch({
      suffix: 'locked', homeClubId: clubA.id, awayClubId: clubB.id,
    });
    expect((await readFixture(key))!.playedState).toBe('played');

    // Each call carries the CURRENT CAS token, so a `stale` refusal cannot
    // stand in for the played lock these assertions are about.
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNow}-08-02`,
    })).toMatchObject({ ok: false, reason: 'played_locked' });
    expect(await changeFixtureVenue({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      venueId: otherVenue.id,
    })).toMatchObject({ ok: false, reason: 'played_locked' });
    expect(await cancelFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      reason: 'too late',
    })).toMatchObject({ ok: false, reason: 'played_locked' });
    expect(await voidFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      reason: 'too late',
    })).toMatchObject({ ok: false, reason: 'played_locked' });
    expect(await changeFixtureClubs({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      homeClubId: clubB.id, awayClubId: clubA.id,
    })).toMatchObject({ ok: false, reason: 'played_locked' });

    // Notes are the ONE edit it accepts.
    expect(await updateFixtureNotes({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      notes: 'Moved to a Friday night',
    })).toMatchObject({ ok: true });
    expect(await fixtureRow(key)).toMatchObject({ notes: 'Moved to a Friday night' });

    // And the played match itself was never touched by any of it.
    const [match] = await admin<{ matchDate: string; venueRaw: string }[]>`
      SELECT match_date::text AS "matchDate", venue_raw AS "venueRaw"
        FROM matches WHERE id = ${matchId}`;
    expect(match).toMatchObject({ venueRaw: `${MARKER} Venue` });

    await clearFixtureState();
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });

  it('refuses to schedule a game AFLDB already holds as a result', async () => {
    // The ONE test in this group that writes the result first, deliberately:
    // it is the §13 I-3 guard itself. A fixture entered after the fact has no
    // schedule history worth keeping and the result is already authoritative.
    const matchId = await insertPlayedMatch({
      suffix: 'already', homeClubId: clubA.id, awayClubId: clubB.id,
    });
    expect(await createFixture(baseInput({
      season: seasonNow, roundNumber: MARKER_ROUND, matchDate: `${seasonNow}-08-01`,
    }))).toMatchObject({ ok: false, reason: 'already_played' });
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });

  it('reports a played match with no fixture as the ISSUE-140 round cue', async () => {
    const matchId = await insertPlayedMatch({
      suffix: 'nofixture', homeClubId: clubA.id, awayClubId: clubB.id,
    });
    const orphans = await readPlayedMatchesWithoutFixture(seasonNow);
    expect(orphans.map((o) => o.matchId)).toContain(matchId);
    await admin`DELETE FROM matches WHERE id = ${matchId}`;
  });
});

describe('derived safety (§21, S-1)', () => {
  it('moves no played-match fact and no derived statistic', async () => {
    const before = await playedFacts();

    const keys = [
      await mustCreate(),
      await mustCreate({ roundNumber: 2, homeClubId: clubC.id, awayClubId: clubD.id }),
      await mustCreate({
        roundType: 'grand_final', roundNumber: null,
        homeClubId: clubB.id, awayClubId: clubC.id,
        matchDate: null, matchTime: null, venueId: null,
      }),
    ];
    await rescheduleFixture({
      fixtureKey: keys[0], expectedUpdatedAt: await updatedAt(keys[0]), adminUserId: actorId,
      matchDate: `${seasonNext}-04-01`, matchTime: '15:00',
    });
    await cancelFixture({
      fixtureKey: keys[1], expectedUpdatedAt: await updatedAt(keys[1]), adminUserId: actorId,
      reason: 'Ground unavailable',
    });
    await voidFixture({
      fixtureKey: keys[2], expectedUpdatedAt: await updatedAt(keys[2]), adminUserId: actorId,
      reason: 'Wrong clubs',
    });

    const after = await playedFacts();
    expect(after).toEqual(before);

    // The fixtures really are there — the counts above are unchanged because
    // the tables are separate, not because nothing happened.
    const [count] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fixtures WHERE season = ${seasonNext}`;
    expect(count.n).toBe(3);
    await clearFixtureState();
  });
});

describe('transaction safety (§25)', () => {
  it('rolls the canonical row back when the AUDIT insert fails', async () => {
    const result = await createFixture(baseInput({ notes: AUDIT_FAIL_NOTE }));
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const [counts] = await admin<{ fixtures: number; overrides: number }[]>`
      SELECT (SELECT count(*)::int FROM fixtures WHERE season = ${seasonNext}) AS fixtures,
             (SELECT count(*)::int FROM data_overrides
               WHERE entity_type = 'fixtures'
                 AND (override_values->>'season')::int = ${seasonNext}) AS overrides`;
    expect(counts).toEqual({ fixtures: 0, overrides: 0 });
  });

  it('rolls the canonical row back when the DURABLE RECORD insert fails', async () => {
    const result = await createFixture(baseInput({ notes: OVERRIDE_FAIL_NOTE }));
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const [counts] = await admin<{ fixtures: number }[]>`
      SELECT count(*)::int AS fixtures FROM fixtures WHERE season = ${seasonNext}`;
    expect(counts.fixtures).toBe(0);
  });

  it('rolls back an EDIT completely when its audit fails', async () => {
    const key = await mustCreate();
    const before = (await fixtureRow(key))!;
    expect(await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNext}-06-06`, note: AUDIT_FAIL_NOTE,
    })).toMatchObject({ ok: false, reason: 'failed' });
    expect(await fixtureRow(key)).toEqual(before);
    await clearFixtureState();
  });

  it('writes the WHOLE round or none of it', async () => {
    const rows = [
      { homeClubId: clubA.id, awayClubId: clubB.id },
      { homeClubId: clubC.id, awayClubId: clubD.id, notes: AUDIT_FAIL_NOTE },
    ];
    const batch = {
      season: seasonNext, roundType: 'home_and_away' as const, roundNumber: 3,
      rows, adminUserId: actorId,
    };
    const preview = await createFixtures({ ...batch, dryRun: true });
    expect(preview).toMatchObject({ ok: true, dryRun: true, created: 0 });

    // The preview wrote nothing at all.
    const [afterPreview] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fixtures WHERE season = ${seasonNext}`;
    expect(afterPreview.n).toBe(0);

    // The commit fails on the SECOND row's audit, after the first row has
    // already been written — so this is a genuine post-write rollback.
    const committed = await createFixtures({
      ...batch, dryRun: false,
      previewFingerprint: (preview as { fingerprint: string }).fingerprint,
    });
    expect(committed).toMatchObject({ ok: false });
    const [afterCommit] = await admin<{ fixtures: number; overrides: number }[]>`
      SELECT (SELECT count(*)::int FROM fixtures WHERE season = ${seasonNext}) AS fixtures,
             (SELECT count(*)::int FROM data_overrides
               WHERE entity_type = 'fixtures'
                 AND (override_values->>'season')::int = ${seasonNext}) AS overrides`;
    expect(afterCommit).toEqual({ fixtures: 0, overrides: 0 });
  });

  it('commits a whole clean round under one batch id', async () => {
    const rows = [
      { homeClubId: clubA.id, awayClubId: clubB.id, matchDate: `${seasonNext}-04-10` },
      { homeClubId: clubC.id, awayClubId: clubD.id },
    ];
    const batch = {
      season: seasonNext, roundType: 'home_and_away' as const, roundNumber: 4,
      rows, adminUserId: actorId,
    };
    const preview = await createFixtures({ ...batch, dryRun: true }) as { fingerprint: string };
    const committed = await createFixtures({
      ...batch, dryRun: false, previewFingerprint: preview.fingerprint,
    });
    expect(committed).toMatchObject({ ok: true, created: 2 });

    const batchIds = await admin<{ batchId: string }[]>`
      SELECT DISTINCT override_values->>'batch_id' AS "batchId"
        FROM data_overrides
       WHERE entity_type = 'fixtures'
         AND (override_values->>'season')::int = ${seasonNext}`;
    expect(batchIds).toHaveLength(1);
    expect(batchIds[0].batchId).toBeTruthy();
    await clearFixtureState();
  });
});

describe('the REAL replay (§20)', () => {
  it.runIf(canReplay)('re-creates a scheduled, a cancelled and a void fixture identically', async () => {
    const scheduled = await mustCreate({ notes: 'Opening night' });
    const cancelled = await mustCreate({ roundNumber: 2, homeClubId: clubC.id, awayClubId: clubD.id });
    const voided = await mustCreate({
      roundType: 'preliminary_final', roundNumber: null,
      homeClubId: clubB.id, awayClubId: clubC.id,
      matchDate: null, matchTime: null, venueId: null,
    });
    await cancelFixture({
      fixtureKey: cancelled, expectedUpdatedAt: await updatedAt(cancelled),
      adminUserId: actorId, reason: 'Ground unavailable',
    });
    await voidFixture({
      fixtureKey: voided, expectedUpdatedAt: await updatedAt(voided),
      adminUserId: actorId, reason: 'Wrong clubs entered',
    });

    // Everything a replay must reproduce EXACTLY. `id` is excluded because a
    // promotion renumbers it — that is precisely why `fixture_key` is the
    // identity — and the two timestamps because a re-created row is new.
    const comparable = (row: Record<string, unknown>) => {
      const rest: Record<string, unknown> = { ...row };
      delete rest.id;
      delete rest.created_at;
      delete rest.updated_at;
      return rest;
    };
    const before = Object.fromEntries(await Promise.all(
      [scheduled, cancelled, voided].map(async (k) => [k, comparable((await fixtureRow(k))!)]),
    ));

    // A destructive reload, or a promotion swap, leaves the table empty.
    await admin`DELETE FROM fixtures WHERE season IN (${seasonNow}, ${seasonNext})`;
    expect(await fixtureRow(scheduled)).toBeNull();

    const replay = runReplay('fixtures');
    expect(replay.stderr + replay.stdout).toContain('REPLAY OK');
    expect(replay.status).toBe(0);

    for (const key of [scheduled, cancelled, voided]) {
      const row = await fixtureRow(key);
      expect(row, key).not.toBeNull();
      expect(comparable(row!), key).toEqual(before[key]);
    }

    // Replaying again changes nothing and creates nothing.
    const second = runReplay('fixtures');
    expect(second.status, second.stderr).toBe(0);
    const [count] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fixtures WHERE season = ${seasonNext}`;
    expect(count.n).toBe(3);
    for (const key of [scheduled, cancelled, voided]) {
      expect(comparable((await fixtureRow(key))!), key).toEqual(before[key]);
    }
    await clearFixtureState();
  });

  it.runIf(canReplay)('re-applies an edit made while the canonical row was absent', async () => {
    const key = await mustCreate();
    await rescheduleFixture({
      fixtureKey: key, expectedUpdatedAt: await updatedAt(key), adminUserId: actorId,
      matchDate: `${seasonNext}-05-05`, matchTime: '12:30',
    });
    await admin`DELETE FROM fixtures WHERE fixture_key = ${key}`;
    expect(runReplay('fixtures').status).toBe(0);
    expect(await fixtureRow(key)).toMatchObject({ match_time: '12:30' });
    await clearFixtureState();
  });

  it.runIf(canReplay)('degrades an unresolvable VENUE and reports it, rather than stopping', async () => {
    const key = await mustCreate();
    await admin`
      UPDATE data_overrides
         SET override_values = jsonb_set(override_values, '{venue_slug}',
                                         ${'"a-venue-that-does-not-exist"'}::jsonb)
       WHERE entity_type = 'fixtures' AND entity_key = ${fixtureEntityKey(key)}`;
    await admin`DELETE FROM fixtures WHERE fixture_key = ${key}`;

    const replay = runReplay('fixtures');
    expect(replay.status, replay.stderr).toBe(0);
    expect(replay.stdout).toContain('name a venue slug this database does not have');
    expect(await fixtureRow(key)).toMatchObject({
      venue_id: null, venue_raw: venue.canonicalName,
    });
    await clearFixtureState();
  });

  it.runIf(canReplay)('FAILS CLOSED on an unresolvable club, and writes nothing at all', async () => {
    // TWO fixtures, one of them perfectly resolvable: the claim is that a
    // reload which cannot honour ONE human decision honours NONE of them.
    await mustCreate();
    const bad = await mustCreate({ roundNumber: 2, homeClubId: clubC.id, awayClubId: clubD.id });
    await admin`
      UPDATE data_overrides
         SET override_values = jsonb_set(override_values, '{home_club_slug}',
                                         ${'"not-a-club"'}::jsonb)
       WHERE entity_type = 'fixtures' AND entity_key = ${fixtureEntityKey(bad)}`;
    await admin`DELETE FROM fixtures WHERE season IN (${seasonNow}, ${seasonNext})`;

    const replay = runReplay('fixtures');
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('replay_admin_overrides(fixtures): refusing to commit');
    expect(replay.stderr).toContain('home_club_slug does not resolve to exactly one club');

    // Nothing was written — not even the fixture that WAS resolvable. A reload
    // that honours some human decisions and silently drops others is worse
    // than one that stops.
    const [count] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fixtures WHERE season = ${seasonNext}`;
    expect(count.n).toBe(0);
    await clearFixtureState();
  });

  it.runIf(canReplay)('FAILS CLOSED on an invalid status and on a broken round', async () => {
    for (const [path, value, message] of [
      ['{status}', '"deleted"', 'payload carries no valid status'],
      ['{round_code}', '"99"', 'round_number whose text is the round_code'],
      ['{season}', '"not-a-year"', 'names no season in the supported range'],
    ] as const) {
      const key = await mustCreate();
      await admin`
        UPDATE data_overrides
           SET override_values = jsonb_set(override_values, ${path}::text[], ${value}::jsonb)
         WHERE entity_type = 'fixtures' AND entity_key = ${fixtureEntityKey(key)}`;
      await admin`DELETE FROM fixtures WHERE season IN (${seasonNow}, ${seasonNext})`;

      const replay = runReplay('fixtures');
      expect(replay.status, `${path} should refuse`).not.toBe(0);
      expect(replay.stderr, path).toContain(message);
      await clearFixtureState();
    }
  });
});
