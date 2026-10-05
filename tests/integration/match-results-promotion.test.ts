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
 *
 * AFLDB-ISSUE-264 nests inside that block and reuses its fixtures: synthetic
 * players with synthetic AFL Tables identities and synthetic `data_overrides`
 * Match Sheet records on two fixture-season matches (R258X, R258Y), all
 * removed in its own afterAll. It proves the refusal end to end through
 * validateSubmission() and promoteSubmission(), including authority recorded
 * between the two.
 *
 * AFLDB-ISSUE-264 F-002 nests a last block inside that one: the lock order and
 * bounded waits of the two legacy `preparePromotion` hooks. It forces each
 * ordering with side transactions (never a race), through the real hooks, the
 * real pipeline and the real Match Sheet, Return to source and deleteMatch
 * writers; a settle is emulated at the lock-statement level.
 */
import './guard';

import postgres from 'postgres';
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';

import { authSql } from '@/db/authClient';
import { deleteMatch } from '@/db/queries/match-admin';
import {
  loadMatchSheetStaleToken, returnMatchSheetToSource, saveMatchSheet, STALE_SHEET_REFUSAL,
} from '@/db/queries/match-sheet';
import { playerMatchStatsAuthorityStorable } from '@/lib/acquisition/manual-authority';
import { carryMatchOverrides } from '@/lib/acquisition/match-rekey';
import {
  DATASETS, LEGACY_PROMOTION_LOCK_REFUSAL, resolveClub, type PromotionRow,
} from '@/lib/ingest/datasets';
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
    // The baseline is taken before anything is created, so none means setup failed
    // first and there is nothing to compare.
    if (baseline) expect(await fingerprint()).toEqual(baseline);
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

  describe('AFLDB-ISSUE-264 durable Match Sheet authority refuses a reverting row', () => {
    const TAG_264 = 'AFLDB-ISSUE-264';
    const RUN = Date.now().toString(36);
    const TAGS = ['Guarded', 'Removed', 'Added', 'Clear', 'Late'] as const;
    type Tag = (typeof TAGS)[number];
    type FixtureMatch = { id: number; key: string };
    type StatRow = {
      clubId: number; goals: number | null; marks: number | null; disposals: number | null;
      sourceId: number | null;
    };

    const players264 = new Map<Tag, number>();
    // Everything the setup actually created, recorded as it is created, so the
    // teardown touches exactly that and survives a partial or failed setup.
    const createdMatchKeys: string[] = [];
    const createdIdentityPlayerIds: number[] = [];
    let matchX: FixtureMatch;
    let matchY: FixtureMatch;
    let matchZ: FixtureMatch;

    const nameOf = (tag: Tag) => `${TAG_264} ${tag} Player`;
    const pathOf = (tag: string) => `players/I/Issue264_${tag}_${RUN}.html`;
    const row264 = (tag: Tag, extra: Payload = {}, roundCode = 'R258X'): Payload => ({
      season: String(FIXTURE_SEASON), round_code: roundCode,
      home_club: home.name, away_club: away.name, player: nameOf(tag), club: home.name,
      ...extra,
    });

    async function matchOf(roundCode: string): Promise<FixtureMatch> {
      const [match] = await owner<FixtureMatch[]>`
        SELECT id::int AS id, match_key AS key FROM matches
         WHERE season = ${FIXTURE_SEASON} AND round_code = ${roundCode}
      `;
      if (!match) throw new Error(`fixture match ${roundCode} was not created by the promotion`);
      createdMatchKeys.push(match.key);
      return match;
    }

    /** One synthetic Match Sheet record, keyed exactly as the ISSUE-257 writer keys it. */
    async function seed(
      tag: string, fieldGroup: string, payload: unknown,
      opts: { match?: FixtureMatch; isActive?: boolean } = {},
    ) {
      await owner`
        INSERT INTO data_overrides
              (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
        VALUES ('player_match_stats', ${`${(opts.match ?? matchX).key}|afltables:${pathOf(tag)}`},
                ${fieldGroup}, ${owner.json(payload as never)}, ${fixtureAdminId}, ${opts.isActive ?? true})
      `;
    }

    async function rowOf(tag: Tag, match: FixtureMatch = matchX): Promise<StatRow | null> {
      const [row] = await owner<StatRow[]>`
        SELECT club_id::int AS "clubId", goals::int AS goals, marks::int AS marks,
               disposals::int AS disposals, source_id::int AS "sourceId"
          FROM player_match_stats
         WHERE match_id = ${match.id} AND player_id = ${players264.get(tag)!}
      `;
      return row ?? null;
    }

    /** Every record under the fixture matches this block created, timestamps included. */
    async function authorityRecords() {
      if (createdMatchKeys.length === 0) return [];
      return owner<{ entityKey: string; fieldGroup: string; payload: string; isActive: boolean; updatedAt: string }[]>`
        SELECT entity_key AS "entityKey", field_group AS "fieldGroup", override_values::text AS payload,
               is_active AS "isActive", updated_at::text AS "updatedAt"
          FROM data_overrides o
         WHERE entity_type = 'player_match_stats'
           AND EXISTS (SELECT 1 FROM unnest(${createdMatchKeys}::text[]) AS k
                        WHERE starts_with(o.entity_key, k || '|'))
         ORDER BY entity_key, field_group
      `;
    }

    beforeAll(async () => {
      // State B is required: under State A no record could be seeded and every case would be vacuous.
      if (!(await playerMatchStatsAuthorityStorable(owner))) {
        throw new Error('this database does not admit player_match_stats authority (migration 110)');
      }
      const [afltables] = await owner<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
      if (!afltables) throw new Error("sources.key = 'afltables' is not seeded in this database");

      await promoteFile('match_results', [
        matchPayload('R258X', '21'), matchPayload('R258Y', '22'), matchPayload('R258Z', '23'),
      ]);
      matchX = await matchOf('R258X');
      matchY = await matchOf('R258Y');
      matchZ = await matchOf('R258Z');

      for (const tag of TAGS) {
        const name = nameOf(tag);
        const [player] = await owner<{ id: number }[]>`
          INSERT INTO players (display_name, search_name, sort_name, slug, debut_season, final_season)
          VALUES (${name}, afldb_normalise_name(${name}), ${name},
                  ${`issue-264-${tag.toLowerCase()}-${RUN}`}, ${FIXTURE_SEASON}, ${FIXTURE_SEASON})
          RETURNING id
        `;
        players264.set(tag, player.id);
        // The enclosing afterAll removes these players and their rows.
        fixturePlayers.set(name, player.id);
        await owner`
          INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
          VALUES (${afltables.id}, ${pathOf(tag)}, ${player.id}, 'unique', 'afltables_profile_url')
        `;
        createdIdentityPlayerIds.push(player.id);
      }
    });

    // Runs even when the setup above threw part-way. It removes only what the
    // setup recorded as created (the enclosing afterAll removes the matches
    // and players), so an early failure leaves nothing to clean and no second
    // error masks the original one.
    afterAll(async () => {
      if (createdMatchKeys.length > 0) {
        await owner`
          DELETE FROM data_overrides o
           WHERE entity_type = 'player_match_stats'
             AND EXISTS (SELECT 1 FROM unnest(${createdMatchKeys}::text[]) AS k
                          WHERE starts_with(o.entity_key, k || '|'))
        `;
      }
      if (createdIdentityPlayerIds.length > 0) {
        await owner`
          DELETE FROM external_identities WHERE player_id = ANY(${createdIdentityPlayerIds}::int[])
        `;
      }
      expect(await authorityRecords()).toEqual([]);
      const [left] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM external_identities
         WHERE player_id = ANY(${createdIdentityPlayerIds}::int[])
      `;
      expect(left.n).toBe(0);
    });

    it('refuses a differing protected value at validation, and admits identical or silent ones', async () => {
      await promoteFile('player_match_stats', [row264('Guarded', {
        goals: '3', kicks: '10', handballs: '5', disposals: '15', marks: '2',
      })]);
      await seed('Guarded', 'match_sheet', {
        goals: 3, kicks: 10, handballs: 5, disposals: 15, club_slug: FIXTURE_CLUBS[0].slug,
      });
      const before = await rowOf('Guarded');

      const staged = await stageAndValidate('player_match_stats', [row264('Guarded', { goals: '4' })]);
      expect(staged.summary.errors).toBe(1);
      expect(staged.rows[0].reasons.reasons[0])
        .toMatch(/^Match Sheet authority: .*goals \(file 4, Match Sheet 3\)/);
      expect((await approveAndPromote(staged.id)).ok).toBe(false);
      expect(await rowOf('Guarded')).toEqual(before);

      // Identical protected values with an unprotected change, then a blank cell: both pass.
      await promoteFile('player_match_stats', [row264('Guarded', { goals: '3', disposals: '15', marks: '7' })]);
      await promoteFile('player_match_stats', [row264('Guarded', { goals: null })]);
      expect(await rowOf('Guarded')).toEqual({ ...before, marks: 7 });
    });

    it('refuses a protected club change and a coupled disposals change', async () => {
      const club = await stageAndValidate('player_match_stats', [row264('Guarded', { club: away.name })]);
      expect(club.rows[0].reasons.reasons[0]).toContain(`club_id (file ${away.id}, Match Sheet ${home.id})`);
      const disposals = await stageAndValidate('player_match_stats', [row264('Guarded', { disposals: '16' })]);
      expect(disposals.rows[0].reasons.reasons[0]).toContain('disposals (file 16, Match Sheet 15)');
    });

    it('refuses to re-insert a player the Match Sheet removed', async () => {
      await seed('Removed', 'lineup', { present: false });
      await seed('Removed', 'match_sheet', { goals: 1 }, { isActive: false });
      const staged = await stageAndValidate('player_match_stats', [row264('Removed', { goals: '1' })]);
      expect(staged.rows[0].reasons.reasons[0]).toContain('promoting would re-insert the row');
      expect((await approveAndPromote(staged.id)).ok).toBe(false);
      expect(await rowOf('Removed')).toBeNull();
    });

    it('keeps a durable addition: compatible values apply, ownership stays, a club change refuses', async () => {
      // The Match Sheet's own shape for an addition: an unowned row plus both records.
      await owner`
        INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
        VALUES (${players264.get('Added')!}, ${matchX.id}, ${home.id}, 2)
      `;
      await seed('Added', 'lineup', { present: true });
      await seed('Added', 'match_sheet', { club_slug: FIXTURE_CLUBS[0].slug, goals: 2 });

      await promoteFile('player_match_stats', [row264('Added', { goals: '2', marks: '4' })]);
      expect(await rowOf('Added')).toEqual({ clubId: home.id, goals: 2, marks: 4, disposals: null, sourceId: null });

      const staged = await stageAndValidate('player_match_stats', [row264('Added', { club: away.name })]);
      expect(staged.rows[0].reasons.reasons[0]).toContain(`club_id (file ${away.id}, Match Sheet ${home.id})`);
    });

    it('ignores withdrawn (inactive) records', async () => {
      await seed('Clear', 'lineup', { present: false }, { isActive: false });
      await seed('Clear', 'match_sheet', { goals: 9 }, { isActive: false });
      await promoteFile('player_match_stats', [row264('Clear', { goals: '1' })]);
      expect(await rowOf('Clear')).toMatchObject({ goals: 1 });
    });

    it('fails closed on a match carrying authority that resolves to no player', async () => {
      await seed('Nobody', 'match_sheet', { goals: 1 }, { match: matchY });
      const staged = await stageAndValidate('player_match_stats', [row264('Clear', { goals: '1' }, 'R258Y')]);
      expect(staged.rows[0].reasons.reasons[0]).toContain('cannot be attributed to exactly one player');
      expect((await approveAndPromote(staged.id)).ok).toBe(false);
      expect(await rowOf('Clear', matchY)).toBeNull();
    });

    it('refuses authority recorded after validation, rolling the whole submission back', async () => {
      await promoteFile('player_match_stats', [row264('Late', { goals: '5' })]);
      const lateBefore = await rowOf('Late');
      const clearBefore = await rowOf('Clear');
      const staged = await stageAndValidate('player_match_stats', [
        row264('Clear', { marks: '11' }),
        row264('Late', { goals: '6' }),
      ]);
      expect(staged.summary.errors).toBe(0);

      // A Match Sheet decision lands between validation and promotion.
      await seed('Late', 'match_sheet', { goals: 5 });
      const recordsBefore = await authorityRecords();

      const result = await approveAndPromote(staged.id);
      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? '' : result.error).toMatch(
        /1 row\(s\) conflict with durable Match Sheet authority; nothing was promoted\. row 2 .*goals \(file 6, Match Sheet 5\)/,
      );
      const [submission] = await owner<{ status: string }[]>`
        SELECT status::text AS status FROM data_submissions WHERE id = ${staged.id}
      `;
      expect(submission.status).toBe('failed');
      // Neither row of the submission landed, and the authority is untouched.
      expect(await rowOf('Clear')).toEqual(clearBefore);
      expect(await rowOf('Late')).toEqual(lateBefore);
      expect(await authorityRecords()).toEqual(recordsBefore);
    });

    // F-005 (pre-commit review): a supported rekey moves the authority with the match
    // (`carryMatchOverrides`, in the same transaction as the key change, as canonical-apply and
    // repair-match-rekeys do), so a submission validated before the rekey is still refused after it.
    it('still refuses a stale submission after a rekey carries the authority to the new key', async () => {
      // Validated while no authority exists: the row passes.
      const stale = await stageAndValidate('player_match_stats', [row264('Clear', { goals: '4' }, 'R258Z')]);
      expect(stale.summary.errors).toBe(0);

      await seed('Clear', 'match_sheet', { goals: 3 }, { match: matchZ });
      const oldKey = matchZ.key;
      const newKey = oldKey.replace('-04-23|', '-04-24|');
      expect(newKey).not.toBe(oldKey);
      createdMatchKeys.push(newKey);
      await owner.begin(async (tx) => {
        expect(await carryMatchOverrides(tx as unknown as postgres.Sql, oldKey, newKey)).toEqual({ carried: 1 });
        await tx`UPDATE matches SET match_key = ${newKey}, match_date = '2073-04-24' WHERE id = ${matchZ.id}`;
      });

      const records = await authorityRecords();
      const identity = `afltables:${pathOf('Clear')}`;
      expect(records.filter((r) => r.isActive).map((r) => r.entityKey)).toContain(`${newKey}|${identity}`);
      expect(records.filter((r) => r.isActive && r.entityKey.startsWith(`${oldKey}|`))).toEqual([]);

      const result = await approveAndPromote(stale.id);
      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? '' : result.error).toMatch(
        /1 row\(s\) conflict with durable Match Sheet authority; nothing was promoted\. row 1 .*goals \(file 4, Match Sheet 3\)/,
      );
      expect(await rowOf('Clear', matchZ)).toBeNull();

      // A fresh validation agrees, so the report and the promotion do not diverge.
      const fresh = await stageAndValidate('player_match_stats', [row264('Clear', { goals: '4' }, 'R258Z')]);
      expect(fresh.summary.errors).toBe(1);
      expect(fresh.rows[0].reasons.reasons[0]).toMatch(/^Match Sheet authority: .*goals \(file 4, Match Sheet 3\)/);
    });

    /**
     * F-002 — the two legacy writers take their match locks in `preparePromotion`, ascending id, and
     * bound the wait. Every ordering below is forced, not raced: a side transaction holds a lock and
     * is released only after `pg_blocking_pids` shows who is queued behind it. The real hooks, the real
     * pipeline and the real Match Sheet, Return to source and deleteMatch writers are used; the rekey
     * is `carryMatchOverrides` plus the key UPDATE exactly as canonical-apply runs them. The SETTLE is
     * emulated at the lock-statement level only (the statements `lockUnitMatchRows` and the unit's row
     * writes issue); its own coverage is in settle-afltables.test.ts.
     *
     * AFLDB-ISSUE-265: the hooks also take the exclusive settle/promotion gate before those locks.
     * Real settles take it shared, so a real settle and a real promotion never overlap. The settle
     * emulations below issue raw lock statements and take NO gate: they emulate an UNGATED writer, kept
     * to characterise the cycle the gate removes. The gated behaviour is proven with real settles in
     * settle-promotion-deadlock.test.ts (Phase B).
     */
    describe('F-002: match lock order and bounded waits of the legacy promotion hooks', () => {
      const NOTE = `${TAG_264} F-002 lock test`;
      type Tx = (tx: postgres.TransactionSql) => Promise<unknown>;
      type Held = { pid: number; go: () => void; outcome: Promise<unknown> };
      const MATCH_COUNT = 9;
      const lockMatch: FixtureMatch[] = [];
      const sides: postgres.Sql[] = [];
      const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
      const day = (n: number) => String(n).padStart(2, '0');
      const dateOf = (n: number) => `${FIXTURE_SEASON}-05-${day(n)}`;
      const lockPayload = (n: number, extra: Payload = {}): Payload =>
        matchPayload(`R258L${n}`, '01', { match_date: dateOf(n), ...extra });
      const asSql = (tx: postgres.TransactionSql) => tx as unknown as postgres.Sql;
      const sqlstate = (error: unknown): string | undefined => {
        const e = error as { code?: string; cause?: { code?: string } } | null;
        return e?.code ?? e?.cause?.code;
      };

      const side = (): postgres.Sql => {
        const connection = postgres(testDbUrl, { max: 1, onnotice: () => {} });
        sides.push(connection);
        return connection;
      };

      /** Runs `body` in its own transaction; the promise carries the error, or null. */
      const inTx = (body: Tx): Promise<unknown> => side().begin(body).then(() => null, (error: unknown) => error);

      /**
       * A transaction that runs `first`, reports its pid, waits for `go()`, runs `second`, commits.
       * `outcome` is the error it ended with, or null; it never rejects.
       */
      async function stage(first: Tx, second?: Tx): Promise<Held> {
        let go!: () => void;
        const gate = new Promise<void>((resolve) => { go = resolve; });
        let ready!: (pid: number) => void;
        let failed!: (error: unknown) => void;
        const reached = new Promise<number>((resolve, reject) => { ready = resolve; failed = reject; });
        const outcome = side().begin(async (tx) => {
          try {
            const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
            await first(tx);
            ready(pid);
          } catch (error) {
            failed(error);
            throw error;
          }
          await gate;
          if (second) await second(tx);
        }).then(() => null, (error: unknown) => error);
        return { pid: await reached, go, outcome };
      }

      /**
       * Waits until `count` sessions are queued behind `holder`, directly or behind each other (a second
       * row-lock waiter queues on the first waiter's tuple lock, not on the holder).
       */
      async function waitBlocked(holder: number, count = 1): Promise<void> {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const rows = await owner<{ pid: number }[]>`
            WITH RECURSIVE waiting AS (
              SELECT DISTINCT pid FROM pg_locks WHERE NOT granted
            ), edge AS (
              SELECT w.pid, blocker FROM waiting w, unnest(pg_blocking_pids(w.pid)) AS blocker
            ), reach(pid) AS (
              SELECT pid FROM edge WHERE blocker = ${holder}::int
              UNION
              SELECT e.pid FROM edge e JOIN reach r ON e.blocker = r.pid
            )
            SELECT pid::int AS pid FROM reach
          `;
          if (rows.length >= count) return;
          if (Date.now() > deadline) {
            throw new Error(`expected ${count} session(s) queued behind pid ${holder}; saw ${rows.length}`);
          }
          await pause(25);
        }
      }

      async function waitWaiting(pid: number): Promise<void> {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const [row] = await owner<{ n: number }[]>`SELECT cardinality(pg_blocking_pids(${pid}::int))::int AS n`;
          if (row.n > 0) return;
          if (Date.now() > deadline) throw new Error(`pid ${pid} never waited for a lock`);
          await pause(25);
        }
      }

      const statsPairs = (...pairs: [Tag, FixtureMatch][]): PromotionRow[] => pairs.map(([tag, match], index) => ({
        rowNo: index + 1,
        payload: { player: nameOf(tag) },
        resolved: { match_id: match.id, player_id: players264.get(tag)!, club_id: home.id },
      }));
      const runStatsHook = (tx: postgres.TransactionSql, ...pairs: [Tag, FixtureMatch][]) =>
        DATASETS.player_match_stats.preparePromotion!(statsPairs(...pairs), { sql: asSql(tx) });
      const runMatchResultsHook = (tx: postgres.TransactionSql, ...ns: number[]) =>
        DATASETS.match_results.preparePromotion!(ns.map((n, index) => ({
          rowNo: index + 1,
          payload: { round_code: `R258L${n}`, match_date: dateOf(n) },
          resolved: { season: FIXTURE_SEASON, home_club_name: home.name, away_club_name: away.name },
        })), { sql: asSql(tx) });

      const lockRow = (match: FixtureMatch, strength: 'FOR UPDATE' | 'FOR SHARE'): Tx => (tx) => (strength === 'FOR UPDATE'
        ? tx`SELECT id FROM matches WHERE id = ${match.id} FOR UPDATE`
        : tx`SELECT id FROM matches WHERE id = ${match.id} FOR SHARE`);

      const scoreOf = async (match: FixtureMatch) => (await owner<{ s: number }[]>`
        SELECT home_score::int AS s FROM matches WHERE id = ${match.id}
      `)[0]?.s;

      async function statusOf(id: number) {
        const [row] = await owner<{ status: string; error: string | null }[]>`
          SELECT status::text AS status, error FROM data_submissions WHERE id = ${id}
        `;
        return row;
      }

      const sheetPlayer = (tag: Tag, goals: number) => ({
        playerId: players264.get(tag)!, clubId: home.id, jumperNumber: null, goals, behinds: null, kicks: null,
        handballs: null, disposals: null, marks: null, tackles: null, hitouts: null, freesFor: null, freesAgainst: null,
      });

      /** Holds the stats hook's own locks (the real hook, in a transaction that has not committed). */
      async function holdStatsHook(...matches: FixtureMatch[]): Promise<Held> {
        return stage((tx) => runStatsHook(tx, ...matches.map((m): [Tag, FixtureMatch] => ['Late', m])));
      }

      /** Starts `start` while the promotion's locks are held; it must queue, then finish once they are released. */
      async function blockedUntilReleased<R>(matches: FixtureMatch[], start: () => Promise<R>): Promise<R> {
        const holder = await holdStatsHook(...matches);
        let run: Promise<R> | undefined;
        try {
          run = start();
          await waitBlocked(holder.pid);
          expect(await Promise.race([run.then(() => 'finished', () => 'finished'), pause(300).then(() => 'waiting')]))
            .toBe('waiting');
          holder.go();
          expect(await holder.outcome).toBeNull();
          return await run;
        } finally {
          holder.go();
          await holder.outcome;
          if (run) await Promise.allSettled([run]);
        }
      }

      beforeAll(async () => {
        await promoteFile('match_results', Array.from({ length: MATCH_COUNT }, (_, i) => lockPayload(i + 1)));
        for (let n = 1; n <= MATCH_COUNT; n += 1) lockMatch[n] = await matchOf(`R258L${n}`);
        // Ascending id is the lock order under test, and the fixtures promote in file order.
        for (let n = 2; n <= MATCH_COUNT; n += 1) expect(lockMatch[n].id).toBeGreaterThan(lockMatch[n - 1].id);
      });

      afterAll(async () => {
        await Promise.all(sides.map((connection) => connection.end({ timeout: 5 })));
        // What the real writers leave behind in the reserved fixture season: their audit rows and the
        // club-season rows deleteMatch and the Match Sheet recompute. Players' derived rows cascade.
        await owner`DELETE FROM data_edits WHERE admin_user_id = ${fixtureAdminId} AND note = ${NOTE}`;
        await owner`DELETE FROM club_seasons WHERE season = ${FIXTURE_SEASON}`;
        // player_clubs points at matches (first/last match) with no cascade; the enclosing afterAll
        // deletes the matches before the players, so these must go first.
        await owner`DELETE FROM player_clubs WHERE player_id = ANY(${[...players264.values()]}::int[])`;
      });

      it('characterises the cycle the shared lock order removes: an unordered match_results writer against the stats hook', async () => {
        const [A, B] = [lockMatch[1], lockMatch[2]];
        // Today's match_results upserts without a hook: file order B then A, each a FOR NO KEY UPDATE.
        const touch = (match: FixtureMatch): Tx => (tx) => tx`UPDATE matches SET venue_raw = venue_raw WHERE id = ${match.id}`;
        const unordered = await stage(touch(B), touch(A));
        const stats = inTx((tx) => runStatsHook(tx, ['Clear', A], ['Late', B]));
        await waitBlocked(unordered.pid); // the hook holds A and waits for B
        unordered.go(); // the unordered writer now asks for A
        const ended = (await Promise.all([unordered.outcome, stats])).filter((outcome) => outcome !== null);
        expect(ended).toHaveLength(1); // exactly one participant is the deadlock victim, the other commits
        expect(sqlstate(ended[0])).toBe('40P01');
      });

      // AFLDB-ISSUE-265 (D-265-6): the stats promotion takes the gate and queues at A; the match_results
      // promotion now queues at the GATE behind it (so it holds no match at all). Both are within the 5 s
      // bound and finish in turn once the holder releases A.
      it('match_results queues behind the stats promotion at the gate, holding no match; both legacy writers finish', async () => {
        const [A, B] = [lockMatch[1], lockMatch[2]];
        const stats = await stageAndValidate('player_match_stats', [
          row264('Clear', { goals: '1' }, 'R258L1'), row264('Late', { goals: '2' }, 'R258L2'),
        ]);
        // File order B then A: before the hook this writer upserted B first and kept it while it waited for A.
        const results = await stageAndValidate('match_results', [
          lockPayload(2, { home_score: '91' }), lockPayload(1, { home_score: '92' }),
        ]);
        expect(stats.summary.errors + results.summary.errors).toBe(0);

        const holder = await stage(lockRow(A, 'FOR UPDATE'));
        const runs: Promise<unknown>[] = [];
        try {
          runs.push(approveAndPromote(stats.id));
          await waitBlocked(holder.pid, 1);
          runs.push(approveAndPromote(results.id));
          await waitBlocked(holder.pid, 2);
          // The stats promotion is queued at A and the match_results one behind it at the gate. Neither
          // holds B (the later match), so it can be locked NOWAIT.
          const probe = side();
          await expect(probe.begin((tx) => tx`SELECT id FROM matches WHERE id = ${B.id} FOR UPDATE NOWAIT`))
            .resolves.toBeDefined();
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        const [statsResult, resultsResult] = await Promise.all(runs);
        expect(statsResult).toMatchObject({ ok: true });
        expect(resultsResult).toMatchObject({ ok: true });
        expect([await scoreOf(A), await scoreOf(B)]).toEqual([92, 91]);
        expect(await rowOf('Clear', A)).toMatchObject({ goals: 1 });
        expect(await rowOf('Late', B)).toMatchObject({ goals: 2 });
      });

      // AFLDB-ISSUE-265 (D-265-6): this used to assert that a second stats promotion FINISHES while the
      // first still holds its FOR SHARE locks. Promotions now serialise on the exclusive settle/promotion
      // gate, so the second is refused retryably after the hook's 5 s bound, writes nothing, and succeeds
      // on a retry once the first has finished. The hook's FOR SHARE still blocks no plain reader.
      it('FOR SHARE blocks no reader; another promotion is refused at the gate meanwhile, and a retry succeeds', async () => {
        const [A, B] = [lockMatch[1], lockMatch[2]];
        const other = await stageAndValidate('player_match_stats', [row264('Added', { goals: '1' }, 'R258L1')]);
        expect(other.summary.errors).toBe(0);
        const addedBefore = await rowOf('Added', A);
        const holder = await stage((tx) => runStatsHook(tx, ['Clear', A], ['Late', B]));
        try {
          const started = Date.now();
          const promoted = await approveAndPromote(other.id);
          expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
          expect(promoted.ok).toBe(false);
          expect(promoted.ok ? '' : promoted.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
          expect((await statusOf(other.id)).status).toBe('failed');
          expect(await rowOf('Added', A)).toEqual(addedBefore);
          expect(await Promise.race([scoreOf(A), pause(3000).then(() => 'blocked')])).not.toBe('blocked');
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        expect(await promoteSubmission(other.id)).toMatchObject({ ok: true });
        expect(await rowOf('Added', A)).toMatchObject({ goals: 1 });
      }, 60_000);

      it('blocks the Match Sheet save and Return to source until the promotion finishes', async () => {
        const M = lockMatch[3];
        await promoteFile('player_match_stats', [row264('Clear', { goals: '2' }, 'R258L3')]);
        const staleToken = await loadMatchSheetStaleToken(owner, M.id);

        const saved = await blockedUntilReleased([M], () => saveMatchSheet({
          matchId: M.id, syncMatchScores: false, players: [sheetPlayer('Clear', 3)], removedPlayerIds: [],
          adminUserId: fixtureAdminId, note: NOTE, staleToken,
        }));
        expect(saved).toMatchObject({ ok: true });
        const identity = `${M.key}|afltables:${pathOf('Clear')}`;
        expect((await authorityRecords()).filter((r) => r.entityKey === identity && r.isActive)).toHaveLength(1);

        const returned = await blockedUntilReleased([M], () => returnMatchSheetToSource({
          matchId: M.id, playerId: players264.get('Clear')!, adminUserId: fixtureAdminId, note: NOTE,
        }));
        expect(returned).toMatchObject({ ok: true });
        expect((await authorityRecords()).filter((r) => r.entityKey === identity && r.isActive)).toEqual([]);
      });

      it('blocks any other UPDATE of the match row until the promotion finishes', async () => {
        const M = lockMatch[3];
        const outcome = await blockedUntilReleased([M], () => inTx((tx) =>
          tx`UPDATE matches SET venue_raw = venue_raw WHERE id = ${M.id}`));
        expect(outcome).toBeNull();
      });

      it('blocks a rekey (carry plus key change) until the promotion finishes, then it carries the authority', async () => {
        const M = lockMatch[4];
        await seed('Clear', 'match_sheet', { goals: 3 }, { match: M });
        const newKey = M.key.replace(dateOf(4), `${FIXTURE_SEASON}-06-04`);
        expect(newKey).not.toBe(M.key);
        createdMatchKeys.push(newKey);
        const outcome = await blockedUntilReleased([M], () => inTx(async (tx) => {
          // As canonical-apply and repair-match-rekeys do: the retired match row is locked FOR UPDATE
          // BEFORE the carry writes any authority, so it is the carry itself that must wait.
          await tx`SELECT id FROM matches WHERE id = ${M.id} ORDER BY id FOR UPDATE`;
          expect(await carryMatchOverrides(asSql(tx), M.key, newKey)).toEqual({ carried: 1 });
          await tx`UPDATE matches SET match_key = ${newKey}, match_date = ${`${FIXTURE_SEASON}-06-04`} WHERE id = ${M.id}`;
        }));
        expect(outcome).toBeNull();
        expect((await authorityRecords()).filter((r) => r.isActive).map((r) => r.entityKey))
          .toContain(`${newKey}|afltables:${pathOf('Clear')}`);
      });

      it('blocks deleteMatch until the promotion finishes', async () => {
        const M = lockMatch[5];
        const result = await blockedUntilReleased([M], () => deleteMatch({
          matchId: M.id, adminUserId: fixtureAdminId, reason: NOTE,
        }));
        expect(result).toMatchObject({ ok: true, deletedId: M.id });
        expect(await scoreOf(M)).toBeUndefined();
      });

      it('authority recorded while a promotion waits wins: the promotion then refuses and writes nothing', async () => {
        const M = lockMatch[6];
        await promoteFile('player_match_stats', [row264('Late', { goals: '5' }, 'R258L6')]);
        const pending = await stageAndValidate('player_match_stats', [row264('Late', { goals: '6' }, 'R258L6')]);
        expect(pending.summary.errors).toBe(0);
        const staleToken = await loadMatchSheetStaleToken(owner, M.id);

        const holder = await stage(lockRow(M, 'FOR UPDATE'));
        const runs: Promise<unknown>[] = [];
        try {
          // The save asks first, the promotion second: the save is granted first and commits its authority.
          runs.push(saveMatchSheet({
            matchId: M.id, syncMatchScores: false, players: [sheetPlayer('Late', 7)], removedPlayerIds: [],
            adminUserId: fixtureAdminId, note: NOTE, staleToken,
          }));
          await waitBlocked(holder.pid, 1);
          runs.push(approveAndPromote(pending.id));
          await waitBlocked(holder.pid, 2);
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        const [saved, promoted] = await Promise.all(runs) as [{ ok: boolean }, { ok: boolean; error?: string }];
        expect(saved).toMatchObject({ ok: true });
        expect(promoted.ok).toBe(false);
        expect(promoted.error).toMatch(/conflict with durable Match Sheet authority; nothing was promoted\..*goals \(file 6, Match Sheet 7\)/);
        expect(await rowOf('Late', M)).toMatchObject({ goals: 7 });
        expect((await statusOf(pending.id)).status).toBe('failed');
      });

      it('a promotion that holds the match first makes a queued Match Sheet save refuse as stale, recording no authority', async () => {
        const M = lockMatch[9];
        await promoteFile('player_match_stats', [row264('Late', { goals: '5' }, 'R258L9')]);
        const pending = await stageAndValidate('player_match_stats', [row264('Late', { goals: '6' }, 'R258L9')]);
        expect(pending.summary.errors).toBe(0);
        const staleToken = await loadMatchSheetStaleToken(owner, M.id);

        const holder = await stage(lockRow(M, 'FOR UPDATE'));
        const runs: Promise<unknown>[] = [];
        try {
          runs.push(approveAndPromote(pending.id));
          await waitBlocked(holder.pid, 1);
          runs.push(saveMatchSheet({
            matchId: M.id, syncMatchScores: false, players: [sheetPlayer('Late', 7)], removedPlayerIds: [],
            adminUserId: fixtureAdminId, note: NOTE, staleToken,
          }));
          await waitBlocked(holder.pid, 2);
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        const [promoted, saved] = await Promise.all(runs);
        expect(promoted).toMatchObject({ ok: true });
        expect(saved).toMatchObject({ ok: false, error: STALE_SHEET_REFUSAL });
        expect(await rowOf('Late', M)).toMatchObject({ goals: 6 });
        expect((await authorityRecords()).filter((r) => r.entityKey.startsWith(`${M.key}|`))).toEqual([]);
      });

      it('bounds the wait at 5s with the retryable refusal, writes nothing, and a retry succeeds', async () => {
        const M = lockMatch[2];
        const stats = await stageAndValidate('player_match_stats', [row264('Late', { goals: '9' }, 'R258L2')]);
        const results = await stageAndValidate('match_results', [lockPayload(2, { home_score: '95' })]);
        expect(stats.summary.errors + results.summary.errors).toBe(0);
        const before = { score: await scoreOf(M), late: await rowOf('Late', M) };

        const holder = await stage(lockRow(M, 'FOR UPDATE'));
        let outcomes: Awaited<ReturnType<typeof promoteSubmission>>[] = [];
        const started = Date.now();
        try {
          outcomes = await Promise.all([approveAndPromote(stats.id), approveAndPromote(results.id)]);
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(4500);
        expect(elapsed).toBeLessThan(20_000);
        for (const outcome of outcomes) {
          expect(outcome.ok).toBe(false);
          expect(outcome.ok ? '' : outcome.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
        }
        for (const id of [stats.id, results.id]) {
          const failed = await statusOf(id);
          expect(failed.status).toBe('failed');
          expect(failed.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
        }
        expect({ score: await scoreOf(M), late: await rowOf('Late', M) }).toEqual(before);

        expect(await promoteSubmission(stats.id)).toMatchObject({ ok: true });
        expect(await promoteSubmission(results.id)).toMatchObject({ ok: true });
        expect(await scoreOf(M)).toBe(95);
        expect(await rowOf('Late', M)).toMatchObject({ goals: 9 });
      }, 60_000);

      it('keeps the timeout transaction-local: restored after the hook, absent on the connection afterwards', async () => {
        const connection = side();
        const show = async (db: postgres.Sql | postgres.TransactionSql) =>
          (await db<{ lock_timeout: string }[]>`SHOW lock_timeout`)[0].lock_timeout;
        const original = await show(connection);

        await connection.begin(async (tx) => {
          await runMatchResultsHook(tx, 1);
          await runStatsHook(tx, ['Clear', lockMatch[1]]);
          expect(await show(tx)).toBe(original); // restored inside the same transaction
        });
        expect(await show(connection)).toBe(original);

        // A hook that times out ends its transaction; the setting does not survive on the pooled connection.
        const holder = await stage(lockRow(lockMatch[2], 'FOR UPDATE'));
        try {
          await expect(connection.begin((tx) => runMatchResultsHook(tx, 2))).rejects.toThrow(LEGACY_PROMOTION_LOCK_REFUSAL);
        } finally {
          holder.go();
          expect(await holder.outcome).toBeNull();
        }
        expect(await show(connection)).toBe(original);
      }, 60_000);

      describe('an UNGATED settle holding match locks for its whole run (emulated at the lock-statement level)', () => {
        /**
         * (ISSUE-265: the emulated settle takes no settle/promotion gate, as a real settle now does.)
         * The settle is the first to hold the later match B, the promotion (ascending) holds A and waits for
         * B, then the settle's next unit asks for A. The promotion began waiting first, so its deadlock check
         * fires first and it is the victim: the retryable refusal, nothing written, the settle unharmed.
         */
        it.each([
          ['match_results'],
          ['player_match_stats'],
        ])('%s: the promotion is the victim, gets the retryable refusal, and a retry succeeds', async (dataset) => {
          const [A, B] = [lockMatch[1], lockMatch[2]];
          const stats = dataset === 'player_match_stats';
          const file = await stageAndValidate(dataset, stats
            ? [row264('Clear', { goals: '4' }, 'R258L1'), row264('Late', { goals: '4' }, 'R258L2')]
            : [lockPayload(1, { home_score: '96' }), lockPayload(2, { home_score: '96' })]);
          expect(file.summary.errors).toBe(0);
          const before = [await scoreOf(A), await scoreOf(B)];

          // A stats unit takes FOR SHARE on its match by key; a unit that writes or rekeys takes FOR UPDATE.
          const settle = await stage(
            stats ? lockRow(B, 'FOR UPDATE') : (tx) => tx`SELECT id FROM matches WHERE match_key = ${B.key} FOR SHARE`,
            (tx) => tx`SELECT id FROM matches WHERE id = ANY(${[A.id]}) OR match_key = ${A.key} ORDER BY id FOR UPDATE`,
          );
          let promotion: Promise<Awaited<ReturnType<typeof promoteSubmission>>> | undefined;
          const started = Date.now();
          try {
            promotion = approveAndPromote(file.id);
            await waitBlocked(settle.pid); // the hook holds A and waits for B
            settle.go(); // the settle's next unit asks for A: the cycle closes
          } finally {
            if (!promotion) settle.go();
          }
          const result = await promotion!;
          const elapsed = Date.now() - started;
          expect(await settle.outcome).toBeNull(); // the settle survives
          expect(result.ok).toBe(false);
          expect(result.ok ? '' : result.error).toContain(LEGACY_PROMOTION_LOCK_REFUSAL);
          expect(elapsed).toBeLessThan(4500); // a deadlock victim after ~1s, not the 5s lock timeout
          expect((await statusOf(file.id)).status).toBe('failed');
          expect([await scoreOf(A), await scoreOf(B)]).toEqual(before);

          expect(await promoteSubmission(file.id)).toMatchObject({ ok: true });
        }, 60_000);

        /**
         * The promotion holds its matches to commit while it still writes rows. If the settle began waiting for
         * one of those matches BEFORE the promotion reached a row the settle holds, the settle's check fires
         * first and the SETTLE is the victim. Inside canonical-apply that costs the unit it was applying: the unit
         * rolls back to its savepoint, one `canonical_apply_failed` finding is opened, and the run continues. The
         * shared lock order does not remove this; it only orders the promotion's own acquisitions.
         * ISSUE-265: a real settle takes the shared gate first, so it cannot overlap a promotion at all and
         * this cycle cannot form. The emulation here is ungated, which is the only reason the cycle still does.
         */
        it('characterises that an UNGATED settle can still be the deadlock victim', async () => {
          const [X, Y] = [lockMatch[7], lockMatch[8]];
          for (const tag of ['Clear', 'Late'] as const) {
            await owner`
              INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
              VALUES (${players264.get(tag)!}, ${X.id}, ${home.id}, 1)
            `;
          }
          const file = await stageAndValidate('player_match_stats', [
            row264('Clear', { goals: '2' }, 'R258L7'),
            row264('Late', { goals: '2' }, 'R258L7'),
            row264('Added', { goals: '2' }, 'R258L8'),
          ]);
          expect(file.summary.errors).toBe(0);
          const rowLock = (tag: Tag): Tx => (tx) =>
            tx`SELECT id FROM player_match_stats WHERE match_id = ${X.id} AND player_id = ${players264.get(tag)!} FOR UPDATE`;

          // Another writer keeps the promotion's first row waiting after its hook has taken its match locks.
          const slow = await stage(rowLock('Clear'));
          // The settle's first unit: the stats lock on X, then it writes (and so holds) Late's row.
          const settle = await stage(
            async (tx) => {
              await tx`SELECT id FROM matches WHERE match_key = ${X.key} FOR SHARE`;
              await rowLock('Late')(tx);
            },
            // A later unit writes or rekeys Y, which the promotion holds FOR SHARE.
            lockRow(Y, 'FOR UPDATE'),
          );
          let promotion: Promise<Awaited<ReturnType<typeof promoteSubmission>>> | undefined;
          try {
            promotion = approveAndPromote(file.id);
            await waitBlocked(slow.pid); // hook done; row 1 waits for the other writer
            settle.go();
            await waitWaiting(settle.pid); // the settle waits for Y first
            slow.go(); // the promotion now reaches row 2, which the settle holds: the cycle closes
          } finally {
            if (!promotion) { settle.go(); slow.go(); }
          }
          const [settled, promoted, slowEnded] = await Promise.all([settle.outcome, promotion!, slow.outcome]);
          expect(sqlstate(settled)).toBe('40P01'); // the settle's unit would roll back to its savepoint
          expect(promoted).toMatchObject({ ok: true }); // the promotion finishes once the settle is gone
          expect(slowEnded).toBeNull();
          expect([await rowOf('Clear', X), await rowOf('Late', X), await rowOf('Added', Y)].map((r) => r?.goals))
            .toEqual([2, 2, 2]);
        }, 60_000);
      });
    });
  });
});
