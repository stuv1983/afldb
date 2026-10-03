/**
 * AFLDB-ISSUE-185 — `matchResults.promoteRow()` (`src/lib/ingest/datasets.ts`)
 * now stamps `source_id`/`source_record_id`/`import_batch_id` on the
 * canonical `matches` row it creates or updates, using the same
 * `sourceId`/`batchId` `promoteSubmission()` already resolves for every
 * dataset. Previously this dataset alone received both and wrote neither —
 * its sibling `playerMatchStats.promoteRow()` already writes
 * `source_id`/`import_batch_id` and was not touched by this change.
 *
 * Everything here runs through the real `promoteSubmission()` pipeline
 * (`src/lib/ingest/pipeline.ts`), the same entry point
 * `tests/integration/submission-promotion.test.ts` already exercises (for
 * `player_bio`) for the generic locking/concurrency/atomicity machinery —
 * this file adds `match_results`-specific provenance coverage only and does
 * not re-prove that generic machinery.
 *
 * Season 2073 is reserved for this suite (unclaimed elsewhere in the
 * repository as of AFLDB-ISSUE-185 — the 2084-2099 block is heavily
 * subscribed by other suites; see `tests/integration/wildcard-final-fixture.ts`
 * and `tests/integration/brownlow-fixture.ts` for the existing reservations).
 * Two REAL, existing club identities are read — never written — from
 * `clubs`, matching `wildcard-final-fixture.ts`'s own convention.
 *
 * AFLDB-ISSUE-258 adds the last describe block: a re-promotion over an
 * existing `matches` or `player_match_stats` row keeps every optional figure
 * the file is silent on, and a malformed cell is refused at validation. It
 * runs the real validateSubmission() -> promoteSubmission() path over
 * synthetic season-2073 rows, and over two fixture club identities (each its
 * own organization, spanning 2073 only) and fixture players that it creates
 * and deletes. Every pre-existing match, player_match_stats, club and
 * club_organizations row is fingerprinted before and after. No real club
 * resolves for 2073: real spans end at a concrete last season
 * (tools/migration/load_reference_data.py), and none is borrowed or widened.
 */
import './guard';

import postgres from 'postgres';
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';

import { authSql } from '@/db/authClient';
import { resolveClub } from '@/lib/ingest/datasets';
import { promoteSubmission, validateSubmission } from '@/lib/ingest/pipeline';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? testDbUrl;

const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-185';
const FIXTURE_SEASON = 2073;
const FIXTURE_EMAIL = 'issue-185-promotion-test-fixture@afldb.test';

let fixtureAdminId: number;
let homeClubId: number;
let homeClubName: string;
let awayClubId: number;
let awayClubName: string;
let sportsDataLabSourceId: number;
const submissionIds = new Set<number>();

function matchKey(roundCode: string, matchDate: string): string {
  return `${FIXTURE_SEASON}|${roundCode}|${matchDate}|${homeClubName}|${awayClubName}`;
}

/**
 * Inserts a `data_submissions` + `data_submission_rows` pair shaped exactly
 * as `validateSubmission()` would have left them for `match_results` — bypasses
 * `validateRow()` itself (already covered by `tests/integration/datasets.test.ts`)
 * so this file controls the resolved payload precisely, following
 * `submission-promotion.test.ts`'s `insertSubmission()` convention.
 */
async function insertMatchResultsSubmission(opts: {
  roundCode: string;
  matchDate: string;
  homeClubIdOverride?: number;
}): Promise<number> {
  const sha = `${MARKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [submission] = await owner<{ id: number }[]>`
    INSERT INTO data_submissions
      (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
    VALUES ('match_results', ${`${MARKER}.csv`}, ${Buffer.from('season,round_code\n')}, ${sha},
            ${fixtureAdminId}, 1, 'approved'::submission_status)
    RETURNING id
  `;
  submissionIds.add(submission.id);

  const resolvedHomeClubId = opts.homeClubIdOverride ?? homeClubId;
  await owner`
    INSERT INTO data_submission_rows (submission_id, row_no, payload, verdict, reasons)
    VALUES (
      ${submission.id}, 1,
      ${owner.json({
        season: String(FIXTURE_SEASON), round_code: opts.roundCode, match_date: opts.matchDate,
        venue: `${MARKER} Oval`, home_club: homeClubName, away_club: awayClubName,
        home_score: '100', away_score: '80',
      })},
      'ok',
      ${owner.json({
        resolved: {
          season: FIXTURE_SEASON, round_number: 1, round_type: 'home_and_away',
          home_club_id: resolvedHomeClubId, home_club_name: homeClubName,
          away_club_id: awayClubId, away_club_name: awayClubName,
          venue_id: null, home_score: 100, home_goals: null, home_behinds: null,
          away_score: 80, away_goals: null, away_behinds: null,
          attendance: null, attendance_status: 'not_collected',
          result: 'home_win', winner_club_id: resolvedHomeClubId, margin: 20,
        },
      })}
    )
  `;
  return submission.id;
}

async function readMatch(roundCode: string, matchDate: string) {
  const [row] = await owner<{
    id: number; sourceId: number | null; sourceRecordId: string | null; importBatchId: string | null;
  }[]>`
    SELECT id, source_id AS "sourceId", source_record_id AS "sourceRecordId",
           import_batch_id::text AS "importBatchId"
      FROM matches WHERE match_key = ${matchKey(roundCode, matchDate)}
  `;
  return row ?? null;
}

beforeAll(async () => {
  await owner`
    INSERT INTO seasons (year, league) VALUES (${FIXTURE_SEASON}, 'AFL')
    ON CONFLICT (year) DO NOTHING
  `;

  // Read-only: two real, existing club identities, distinct organizations.
  const clubs = await owner<{ id: number; name: string }[]>`
    SELECT DISTINCT ON (organization_id) id::int AS id, name
      FROM clubs
     WHERE organization_id IS NOT NULL
     ORDER BY organization_id, id
     LIMIT 2
  `;
  if (clubs.length < 2) throw new Error('fixture needs two existing club identities');
  [homeClubId, awayClubId] = clubs.map((c) => c.id);
  [homeClubName, awayClubName] = clubs.map((c) => c.name) as [string, string];

  // The promotion pipeline resolves this key (src/lib/ingest/pipeline.ts) but
  // no SQL migration seeds it -- only tools/migration/import_legacy_afl.py's
  // SOURCES list does, as part of a full historical rebuild. Idempotent,
  // matching migration 057's own `ON CONFLICT (key) DO NOTHING` idiom for
  // 'manual_admin_edit' -- never overwrites an already-seeded row, and (also
  // matching 057's convention) this row is never deleted by this suite.
  await owner`
    INSERT INTO sources (key, name, kind, description) VALUES (
      'sports_data_lab', 'Sports Data Lab legacy database', 'derived',
      'Legacy normalisation and derivation layer used as the migration source.'
    ) ON CONFLICT (key) DO NOTHING
  `;
  const [source] = await owner<{ id: number }[]>`
    SELECT id FROM sources WHERE key = 'sports_data_lab'
  `;
  if (!source) throw new Error("sources.key = 'sports_data_lab' could not be resolved or seeded");
  sportsDataLabSourceId = source.id;

  await owner`
    INSERT INTO auth_users (email, role)
    VALUES (${FIXTURE_EMAIL}, 'super_admin')
    ON CONFLICT (email) DO NOTHING
  `;
  const [admin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users WHERE email = ${FIXTURE_EMAIL}
  `;
  fixtureAdminId = admin.id;
});

afterAll(async () => {
  await owner`DELETE FROM matches WHERE season = ${FIXTURE_SEASON}`;
  // data_submission_rows cascades off data_submissions (migration 023).
  if (submissionIds.size > 0) {
    await owner`DELETE FROM data_submissions WHERE id = ANY(${[...submissionIds]}::int[])`;
  }
  // import_batches rows are left in place, matching submission-promotion.test.ts's
  // own convention -- import_batches/sources are append-only (001_foundations.sql).
  await owner`DELETE FROM seasons WHERE year = ${FIXTURE_SEASON}`;
  // The fixture auth_users row is intentionally retained, matching
  // submission-promotion.test.ts's rationale: deleting it would race a
  // concurrent run that reused it.

  await owner.end({ timeout: 5 });
});

describe('AFLDB-ISSUE-185 match_results promotion provenance', () => {
  it('A-C. a promoted match persists source_id, source_record_id and import_batch_id', async () => {
    const roundCode = 'R185A';
    const matchDate = `${FIXTURE_SEASON}-03-01`;
    const id = await insertMatchResultsSubmission({ roundCode, matchDate });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await readMatch(roundCode, matchDate);
    expect(row).not.toBeNull();
    expect(row!.sourceId).toBe(sportsDataLabSourceId);
    expect(row!.sourceRecordId).toBe(matchKey(roundCode, matchDate));
    expect(row!.importBatchId).toBe(result.batchId);
  });

  it('D. leaves no partially-provenanced match behind when promotion fails and rolls back', async () => {
    const roundCode = 'R185D';
    const matchDate = `${FIXTURE_SEASON}-03-08`;
    // A non-existent home_club_id/winner_club_id forces a real FK-violation
    // deep inside promoteRow's INSERT, inside promoteSubmission's savepoint --
    // the same "force a genuine mid-promotion SQL failure" style
    // submission-promotion.test.ts uses for player_bio's invalid dob, rather
    // than an application-level check.
    const id = await insertMatchResultsSubmission({
      roundCode, matchDate, homeClubIdOverride: -999999,
    });

    const result = await promoteSubmission(id);
    expect(result.ok).toBe(false);

    // Neither a bare row nor a partially-provenanced one survives: the
    // failed INSERT never committed at all.
    const row = await readMatch(roundCode, matchDate);
    expect(row).toBeNull();
  });

  it('item 4: an existing canonical row promoted-over keeps its own provenance untouched', async () => {
    // AFLDB-ISSUE-185 item 4: matchResults.promoteRow() can UPDATE an
    // existing canonical row via ON CONFLICT (match_key). Seeding one here
    // under a DIFFERENT source (afltables) and re-promoting a "corrected"
    // match_results row over the same natural key must never silently
    // reassign its provenance to sports_data_lab.
    const roundCode = 'R185F';
    const matchDate = `${FIXTURE_SEASON}-03-15`;
    const [afltables] = await owner<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
    if (!afltables) throw new Error("sources.key = 'afltables' is not seeded in this database");

    const seededSourceRecordId = `${MARKER}-preexisting-${roundCode}`;
    await owner`
      INSERT INTO matches (
        match_key, season, round_code, round_type, round_number, is_final, match_date,
        venue_raw, home_club_id, away_club_id, home_score, away_score, result,
        winner_club_id, margin, attendance_status, source_id, source_record_id
      ) VALUES (
        ${matchKey(roundCode, matchDate)}, ${FIXTURE_SEASON}::smallint, ${roundCode},
        'home_and_away', 1, false, ${matchDate}::date,
        ${MARKER}, ${homeClubId}, ${awayClubId}, 60, 50, 'home_win',
        ${homeClubId}, 10, 'not_collected', ${afltables.id}, ${seededSourceRecordId}
      )
    `;

    const id = await insertMatchResultsSubmission({ roundCode, matchDate });
    const result = await promoteSubmission(id);
    expect(result.ok).toBe(true);

    const row = await readMatch(roundCode, matchDate);
    expect(row).not.toBeNull();
    // The score DID update (proves the promotion really ran against this row)...
    const [scoreRow] = await owner<{ homeScore: number }[]>`
      SELECT home_score AS "homeScore" FROM matches WHERE id = ${row!.id}
    `;
    expect(scoreRow.homeScore).toBe(100);
    // ...but provenance did not move to sports_data_lab.
    expect(row!.sourceId).toBe(afltables.id);
    expect(row!.sourceRecordId).toBe(seededSourceRecordId);
  });
});

describe('AFLDB-ISSUE-258 optional columns keep stored figures on re-promotion', () => {
  const TAG = 'AFLDB-ISSUE-258';
  const STATS = [
    'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
    'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers',
    'frees_for', 'frees_against', 'contested', 'uncontested', 'contested_marks',
    'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
  ] as const;
  type Payload = Record<string, string | null>;
  type Fingerprint = { n: number; h: string };

  const CLUB_SLUG_PREFIX = 'afldb-issue-258-fixture-';
  const FIXTURE_CLUBS = [
    { slug: `${CLUB_SLUG_PREFIX}home`, name: `${TAG} Home Club`, abbreviation: 'I258H' },
    { slug: `${CLUB_SLUG_PREFIX}away`, name: `${TAG} Away Club`, abbreviation: 'I258A' },
  ] as const;

  let home: { id: number; name: string };
  let away: { id: number; name: string };
  const fixturePlayers = new Map<string, number>();
  const fixtureClubIds: number[] = [];
  const fixtureOrganizationIds: number[] = [];
  type Fingerprints = { matches: Fingerprint; stats: Fingerprint; clubs: Fingerprint; organizations: Fingerprint };
  let baseline: Fingerprints;

  // Every pre-existing row, as a count and an order-free hash of each row's
  // text. clubs and club_organizations are whole-table: taken before the
  // fixture identities exist and after they are deleted, so they also prove
  // no real identity was touched.
  async function fingerprint(): Promise<Fingerprints> {
    const [matches] = await owner<Fingerprint[]>`
      SELECT count(*)::int AS n, coalesce(sum(hashtext(m::text)::bigint), 0)::text AS h
        FROM matches m WHERE m.season <> ${FIXTURE_SEASON}
    `;
    const [stats] = await owner<Fingerprint[]>`
      SELECT count(*)::int AS n, coalesce(sum(hashtext(s::text)::bigint), 0)::text AS h
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season <> ${FIXTURE_SEASON}
    `;
    const [clubs] = await owner<Fingerprint[]>`
      SELECT count(*)::int AS n, coalesce(sum(hashtext(c::text)::bigint), 0)::text AS h
        FROM clubs c
    `;
    const [organizations] = await owner<Fingerprint[]>`
      SELECT count(*)::int AS n, coalesce(sum(hashtext(o::text)::bigint), 0)::text AS h
        FROM club_organizations o
    `;
    return { matches, stats, clubs, organizations };
  }

  /** Stage rows exactly as toObjects() would (absent column = absent key), then validate. */
  async function stageAndValidate(dataset: string, payloads: Payload[]) {
    const sha = `${TAG}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const [submission] = await owner<{ id: number }[]>`
      INSERT INTO data_submissions
        (dataset, filename, content, content_sha256, uploaded_by, row_count, status)
      VALUES (${dataset}, ${`${TAG}.csv`}, ${Buffer.from('synthetic\n')}, ${sha},
              ${fixtureAdminId}, ${payloads.length}, 'staged'::submission_status)
      RETURNING id
    `;
    submissionIds.add(submission.id);
    for (const [index, payload] of payloads.entries()) {
      await owner`
        INSERT INTO data_submission_rows (submission_id, row_no, payload)
        VALUES (${submission.id}, ${index + 1}, ${owner.json(payload)})
      `;
    }
    const summary = await validateSubmission(submission.id);
    const rows = await owner<{ verdict: string; reasons: { reasons: string[] } }[]>`
      SELECT verdict, reasons FROM data_submission_rows
       WHERE submission_id = ${submission.id} ORDER BY row_no
    `;
    return { id: submission.id, summary, rows };
  }

  async function approveAndPromote(id: number) {
    await owner`UPDATE data_submissions SET status = 'approved' WHERE id = ${id}`;
    return promoteSubmission(id);
  }

  async function promoteFile(dataset: string, payloads: Payload[]) {
    const staged = await stageAndValidate(dataset, payloads);
    expect(staged.summary.errors).toBe(0);
    // toMatchObject, so a failure prints the promotion error itself.
    expect(await approveAndPromote(staged.id)).toMatchObject({ ok: true });
  }

  function matchPayload(roundCode: string, day: string, extra: Payload = {}): Payload {
    return {
      season: String(FIXTURE_SEASON), round_code: roundCode, round_number: '1',
      match_date: `${FIXTURE_SEASON}-04-${day}`, venue: `${TAG} Oval`,
      home_club: home.name, away_club: away.name, home_score: '86', away_score: '70',
      ...extra,
    };
  }

  async function readMatchFigures(roundCode: string) {
    const [row] = await owner<{
      homeGoals: number | null; homeBehinds: number | null; homeScore: number;
      awayGoals: number | null; awayBehinds: number | null;
      attendance: number | null; attendanceStatus: string;
    }[]>`
      SELECT home_goals AS "homeGoals", home_behinds AS "homeBehinds", home_score AS "homeScore",
             away_goals AS "awayGoals", away_behinds AS "awayBehinds",
             attendance, attendance_status::text AS "attendanceStatus"
        FROM matches WHERE season = ${FIXTURE_SEASON} AND round_code = ${roundCode}
    `;
    return row;
  }

  function statsPayload(player: string, extra: Payload = {}): Payload {
    return {
      season: String(FIXTURE_SEASON), round_code: 'R258P',
      home_club: home.name, away_club: away.name, player, club: home.name,
      ...extra,
    };
  }

  async function readStats(player: string) {
    const [row] = await owner<Record<string, number | string | null>[]>`
      SELECT s.career_game_no, s.jumper_number, s.brownlow_votes, ${owner([...STATS])}
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season = ${FIXTURE_SEASON} AND m.round_code = 'R258P'
         AND s.player_id = ${fixturePlayers.get(player)!}
    `;
    return row;
  }

  // Every optional player_match_stats column, distinct values (kicks 1 .. goal_assists 21).
  const FULL_STATS: Payload = {
    ...Object.fromEntries(STATS.map((key, index) => [key, String(index + 1)])),
    career_game_no: '5', jumper_number: '23', brownlow_votes: '2',
  };
  const FULL_STORED = {
    ...Object.fromEntries(STATS.map((key, index) => [key, index + 1])),
    career_game_no: 5, jumper_number: '23', brownlow_votes: 2,
  };

  beforeAll(async () => {
    // validateSubmission() writes verdicts through the auth pool, whose DSN
    // tests/setup.ts does not check. Refuse unless it is this same _test
    // database, so no submission id can reach another database.
    const target = (db: string, addr: string | null, port: number | null) => `${db}@${addr}:${port}`;
    const [authTarget] = await authSql<{ db: string; addr: string | null; port: number | null }[]>`
      SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port
    `;
    const [ownerTarget] = await owner<{ db: string; addr: string | null; port: number | null }[]>`
      SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port
    `;
    const authAt = target(authTarget.db, authTarget.addr, authTarget.port);
    const ownerAt = target(ownerTarget.db, ownerTarget.addr, ownerTarget.port);
    if (authAt !== ownerAt || !/_test$/.test(authTarget.db)) {
      throw new Error(`AFLDB_AUTH_DATABASE_URL must target ${ownerAt}; it targets ${authAt}`);
    }

    baseline = await fingerprint();

    // Two fixture club identities, each its own organization, spanning the
    // fixture season only. Refuse leftovers rather than adopt or delete them.
    const [leftover] = await owner<{ n: number }[]>`
      SELECT ((SELECT count(*) FROM clubs WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`})
            + (SELECT count(*) FROM club_organizations WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`}))::int AS n
    `;
    if (leftover.n !== 0) {
      throw new Error(`fixture club identities (${CLUB_SLUG_PREFIX}*) already exist; remove that residue first`);
    }
    // One transaction: both identities exist or neither does. The
    // self-referencing current_identity_id FK is deferred, then pointed at
    // itself, as tests/integration/match-admin-create.test.ts does.
    await owner.begin(async (tx) => {
      await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
      for (const club of FIXTURE_CLUBS) {
        const [organization] = await tx<{ id: number }[]>`
          INSERT INTO club_organizations (name, slug, first_season, last_season, is_active)
          VALUES (${club.name}, ${club.slug}, ${FIXTURE_SEASON}, ${FIXTURE_SEASON}, true)
          RETURNING id
        `;
        const [created] = await tx<{ id: number }[]>`
          INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id,
                             legacy_club_hist, organization_id, first_season, last_season)
          VALUES (${club.slug}, ${club.name}, ${club.name}, ${club.abbreviation}, -1,
                  ${club.slug}, ${organization.id}, ${FIXTURE_SEASON}, ${FIXTURE_SEASON})
          RETURNING id
        `;
        await tx`UPDATE clubs SET current_identity_id = ${created.id} WHERE id = ${created.id}`;
        fixtureOrganizationIds.push(organization.id);
        fixtureClubIds.push(created.id);
      }
    });

    // Each must resolve, for the fixture season, to itself through the
    // validator's own resolver; nothing about resolution is relaxed.
    const resolved = await Promise.all(FIXTURE_CLUBS.map((c) => resolveClub(owner, c.name, FIXTURE_SEASON)));
    if (resolved.some((club, index) => !club || club.id !== fixtureClubIds[index])) {
      throw new Error('fixture club identities do not resolve to themselves for the fixture season');
    }
    [home, away] = resolved as [{ id: number; name: string }, { id: number; name: string }];

    for (const tag of ['Kept', 'Fresh']) {
      const name = `${TAG} ${tag} Player`;
      const [player] = await owner<{ id: number }[]>`
        INSERT INTO players (display_name, search_name, sort_name, slug, debut_season, final_season)
        VALUES (${name}, afldb_normalise_name(${name}), ${name},
                ${`issue-258-${tag.toLowerCase()}-${Date.now().toString(36)}`},
                ${FIXTURE_SEASON}, ${FIXTURE_SEASON})
        RETURNING id
      `;
      fixturePlayers.set(name, player.id);
    }

    // The match every player_match_stats case attaches to.
    await promoteFile('match_results', [matchPayload('R258P', '20')]);
  });

  afterAll(async () => {
    const playerIdList = [...fixturePlayers.values()];
    await owner`DELETE FROM player_match_stats WHERE player_id = ANY(${playerIdList}::int[])`;
    await owner`DELETE FROM matches WHERE season = ${FIXTURE_SEASON} AND round_code LIKE 'R258%'`;
    await owner`DELETE FROM players WHERE id = ANY(${playerIdList}::int[])`;
    // Only the identities this run created; club_aliases would cascade (none are made).
    await owner`DELETE FROM clubs WHERE id = ANY(${fixtureClubIds}::int[])`;
    await owner`DELETE FROM club_organizations WHERE id = ANY(${fixtureOrganizationIds}::int[])`;

    const [left] = await owner<{
      matches: number; stats: number; players: number; clubs: number; organizations: number;
    }[]>`
      SELECT (SELECT count(*)::int FROM matches
               WHERE season = ${FIXTURE_SEASON} AND round_code LIKE 'R258%') AS matches,
             (SELECT count(*)::int FROM player_match_stats
               WHERE player_id = ANY(${playerIdList}::int[])) AS stats,
             (SELECT count(*)::int FROM players WHERE id = ANY(${playerIdList}::int[])) AS players,
             (SELECT count(*)::int FROM clubs
               WHERE id = ANY(${fixtureClubIds}::int[]) OR slug LIKE ${`${CLUB_SLUG_PREFIX}%`}) AS clubs,
             (SELECT count(*)::int FROM club_organizations
               WHERE id = ANY(${fixtureOrganizationIds}::int[])
                  OR slug LIKE ${`${CLUB_SLUG_PREFIX}%`}) AS organizations
    `;
    expect(left).toEqual({ matches: 0, stats: 0, players: 0, clubs: 0, organizations: 0 });
    // No historical row was touched: every pre-existing row is byte-for-byte as it was.
    expect(await fingerprint()).toEqual(baseline);
  });

  it('match_results: a silent column and a blank cell keep goals, behinds and attendance together', async () => {
    await promoteFile('match_results', [matchPayload('R258A', '01', {
      home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10', attendance: '45000',
    })]);
    const stored = {
      homeGoals: 13, homeBehinds: 8, homeScore: 86, awayGoals: 10, awayBehinds: 10,
      attendance: 45000, attendanceStatus: 'complete',
    };
    expect(await readMatchFigures('R258A')).toEqual(stored);

    // No such columns at all.
    await promoteFile('match_results', [matchPayload('R258A', '01')]);
    expect(await readMatchFigures('R258A')).toEqual(stored);

    // The columns, every cell blank.
    await promoteFile('match_results', [matchPayload('R258A', '01', {
      home_goals: null, home_behinds: null, away_goals: null, away_behinds: null, attendance: null,
    })]);
    expect(await readMatchFigures('R258A')).toEqual(stored);

    // A supplied figure still applies, and only that figure moves.
    await promoteFile('match_results', [matchPayload('R258A', '01', { attendance: '50123' })]);
    expect(await readMatchFigures('R258A')).toEqual({ ...stored, attendance: 50123 });
  });

  it('match_results: a malformed cell is a validation error and promotion is refused', async () => {
    await promoteFile('match_results', [matchPayload('R258B', '02', {
      home_goals: '13', home_behinds: '8', attendance: '30000',
    })]);
    const before = await readMatchFigures('R258B');

    const staged = await stageAndValidate('match_results', [
      matchPayload('R258B', '02', { home_goals: '1O', attendance: 'n/a' }),
    ]);
    expect(staged.summary.errors).toBe(1);
    expect(staged.rows[0].verdict).toBe('error');
    expect(staged.rows[0].reasons.reasons.join(' ')).toMatch(/home_goals "1O".*attendance "n\/a"/);

    const result = await approveAndPromote(staged.id);
    expect(result.ok).toBe(false);
    expect(await readMatchFigures('R258B')).toEqual(before);
  });

  it('match_results: a new score the kept breakdown cannot reach is refused at validation', async () => {
    await promoteFile('match_results', [matchPayload('R258D', '04', {
      home_goals: '13', home_behinds: '8',
    })]);
    const staged = await stageAndValidate('match_results', [
      matchPayload('R258D', '04', { home_score: '92' }),
    ]);
    expect(staged.rows[0].verdict).toBe('error');
    expect(staged.rows[0].reasons.reasons[0]).toMatch(/stored figure.*home_score 92/);
  });

  it('match_results: a new match with silent optional columns stores them as not recorded', async () => {
    await promoteFile('match_results', [matchPayload('R258C', '03', { attendance: null })]);
    expect(await readMatchFigures('R258C')).toEqual({
      homeGoals: null, homeBehinds: null, homeScore: 86, awayGoals: null, awayBehinds: null,
      attendance: null, attendanceStatus: 'not_collected',
    });
  });

  it('player_match_stats: a partial file changes only the figures it carries', async () => {
    const player = `${TAG} Kept Player`;
    await promoteFile('player_match_stats', [statsPayload(player, FULL_STATS)]);
    expect(await readStats(player)).toEqual(FULL_STORED);

    // goals only: every other statistic, brownlow_votes, career_game_no and
    // jumper_number keep their stored values.
    await promoteFile('player_match_stats', [statsPayload(player, { goals: '40' })]);
    expect(await readStats(player)).toEqual({ ...FULL_STORED, goals: 40 });

    // Every optional column present and blank, except a new jumper text.
    const blanks = Object.fromEntries(Object.keys(FULL_STATS).map((key) => [key, null]));
    await promoteFile('player_match_stats', [statsPayload(player, { ...blanks, jumper_number: '23B' })]);
    expect(await readStats(player)).toEqual({ ...FULL_STORED, goals: 40, jumper_number: '23B' });
  });

  it('player_match_stats: a malformed cell is a validation error and the row is untouched', async () => {
    const player = `${TAG} Kept Player`;
    const before = await readStats(player);
    expect(before).toBeDefined();

    const staged = await stageAndValidate('player_match_stats', [
      statsPayload(player, { kicks: '1O', marks: '12.5', goals: '7' }),
    ]);
    expect(staged.summary.errors).toBe(1);
    expect(staged.rows[0].reasons.reasons.map((r) => r.split(' ')[0])).toEqual(['kicks', 'marks']);

    const result = await approveAndPromote(staged.id);
    expect(result.ok).toBe(false);
    expect(await readStats(player)).toEqual(before);
  });

  it('player_match_stats: a new row with silent optional columns stores them as not recorded', async () => {
    const player = `${TAG} Fresh Player`;
    await promoteFile('player_match_stats', [statsPayload(player)]);
    const row = await readStats(player);
    expect(Object.values(row).every((value) => value === null)).toBe(true);
    expect(Object.keys(row)).toHaveLength(STATS.length + 3);
  });
});
