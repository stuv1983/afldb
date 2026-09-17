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
 */
import './guard';

import postgres from 'postgres';
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';

import { promoteSubmission } from '@/lib/ingest/pipeline';

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
