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
 * Fixture ownership (AFLDB-ISSUE-268 hardening): the file-level and ISSUE-258 hooks run for every nested block.
 * The file-level `beforeAll` checks the target and the reserved namespace read-only and refuses any existing
 * reserved row (season 2073, its matches and club_seasons, the fixture clubs and players) before its first
 * write; the suite never adopts or deletes such a row. Teardown deletes only the season it inserted and the
 * matches, submissions, clubs, organizations and players it recorded as created, reports anything else it finds
 * in season 2073, and throws that residue list at the end instead of removing it.
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
 *
 * AFLDB-ISSUE-271/272 adds a block inside the ISSUE-258 one: canonical round
 * codes (an `R<n>` or lower-case final, fresh or validated before the fix,
 * promotes onto the existing canonical match, leaving one row; two rows of a
 * submission validated before the fix that name one canonical match, `R<n>`/`<n>`
 * or `gf`/`GF`, refuse whole and leave the match unchanged) and active Data
 * Editor authority (a correction recorded after validation refuses the whole
 * submission, which is left failed, and survives). Because match_results now
 * refuses a non-canonical round code, the file's long-standing round labels
 * ('R258X', ...) are mapped to canonical round numbers by fixtureRound().
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

// Fixture ownership (hardened under AFLDB-ISSUE-268). This file reserves season 2073 and the names below.
// Nothing is adopted: a read-only preflight refuses any existing reserved row before the first write, and
// teardown deletes only rows whose creation this run saw commit and recorded. Everything starts disabled,
// so a failed preflight leaves every teardown a no-op. A row found in the reserved namespace that this run
// does not own is left in place and reported, never deleted.
const CLUB_SLUG_PREFIX = 'afldb-issue-258-fixture-';
/** Every player display_name this file creates (the ISSUE-258 block and the ISSUE-264 block). */
const RESERVED_PLAYER_NAMES = [
  'AFLDB-ISSUE-258 Kept Player', 'AFLDB-ISSUE-258 Fresh Player',
  ...['Guarded', 'Removed', 'Added', 'Clear', 'Late'].map((tag) => `AFLDB-ISSUE-264 ${tag} Player`),
];
let preflightPassed = false; // set only after every read-only target and namespace check has passed
let seasonOwned = false; // set only after this run's own INSERT of the season returned
/** Matches this run created: claimed from its own promotions' batches, or recorded at a direct insert. */
const ownedMatchIds = new Set<number>();
/** Things teardown could not remove, or found that it does not own. Thrown once, at the end of the file. */
const residue: string[] = [];

type DbTarget = { db: string; addr: string | null; port: number | null };
const targetKey = (t: DbTarget) => `${t.db}@${t.addr}:${t.port}`;

/**
 * Read-only. validateSubmission() writes verdicts through the auth pool, whose DSN tests/setup.ts does not
 * check: refuse unless it reaches this same _test database, so no submission id can reach another one.
 */
async function assertTestTarget(): Promise<void> {
  const [authTarget] = await authSql<DbTarget[]>`
    SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port
  `;
  const [ownerTarget] = await owner<DbTarget[]>`
    SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port
  `;
  if (targetKey(authTarget) !== targetKey(ownerTarget) || !/_test$/.test(ownerTarget.db)) {
    throw new Error(
      `AFLDB_AUTH_DATABASE_URL must target ${targetKey(ownerTarget)} (a _test database); it targets ${targetKey(authTarget)}`,
    );
  }
}

/** Read-only. Refuses any existing row in the reserved namespace; the suite neither adopts nor deletes it. */
async function assertNamespaceFree(): Promise<void> {
  const [seen] = await owner<{
    season: number; matches: number; clubSeasons: number; clubs: number; organizations: number;
    players: number; adminRole: string | null;
  }[]>`
    SELECT (SELECT count(*) FROM seasons WHERE year = ${FIXTURE_SEASON})::int AS season,
           (SELECT count(*) FROM matches WHERE season = ${FIXTURE_SEASON})::int AS matches,
           (SELECT count(*) FROM club_seasons WHERE season = ${FIXTURE_SEASON})::int AS "clubSeasons",
           (SELECT count(*) FROM clubs WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`})::int AS clubs,
           (SELECT count(*) FROM club_organizations
             WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`})::int AS organizations,
           (SELECT count(*) FROM players WHERE display_name = ANY(${RESERVED_PLAYER_NAMES}::text[]))::int AS players,
           (SELECT role::text FROM auth_users WHERE email = ${FIXTURE_EMAIL}) AS "adminRole"
  `;
  const taken = (Object.entries(seen) as [string, number | string | null][])
    .filter(([key, value]) => key !== 'adminRole' && Number(value) > 0)
    .map(([key, value]) => `${key}: ${value}`);
  if (taken.length > 0) {
    throw new Error(
      `reserved fixture namespace (season ${FIXTURE_SEASON}, ${CLUB_SLUG_PREFIX}*, the fixture players) is not empty `
      + `(${taken.join(', ')}). Nothing was written and nothing will be deleted; remove that residue by hand first.`,
    );
  }
  // The one retained shared row (never deleted): refuse to adopt it unless it is the fixture super_admin.
  if (seen.adminRole !== null && seen.adminRole !== 'super_admin') {
    throw new Error(`${FIXTURE_EMAIL} exists with role ${seen.adminRole}, not super_admin; refusing to use it`);
  }
}

/** Claims matches the pipeline created from this run's own submissions (their batches are `submission N`). */
async function claimOwnedMatches(): Promise<void> {
  if (submissionIds.size === 0) return;
  const notes = [...submissionIds].map((id) => `submission ${id}`);
  const rows = await owner<{ id: number }[]>`
    SELECT m.id::int AS id
      FROM matches m JOIN import_batches b ON b.id = m.import_batch_id
     WHERE m.season = ${FIXTURE_SEASON} AND b.tool = 'admin-upload' AND b.notes = ANY(${notes}::text[])
  `;
  for (const row of rows) ownedMatchIds.add(row.id);
}

async function deleteOwnedMatches(): Promise<void> {
  await owner`
    DELETE FROM matches WHERE season = ${FIXTURE_SEASON} AND id = ANY(${[...ownedMatchIds]}::int[])
  `;
}

/** Reports, and leaves alone, any season-2073 match this run does not own. */
async function reportForeignMatches(): Promise<void> {
  const foreign = await owner<{ id: number; roundCode: string }[]>`
    SELECT id::int AS id, round_code AS "roundCode" FROM matches
     WHERE season = ${FIXTURE_SEASON} AND NOT (id = ANY(${[...ownedMatchIds]}::int[]))
     ORDER BY id
  `;
  if (foreign.length > 0) {
    residue.push(
      `season ${FIXTURE_SEASON} holds ${foreign.length} match row(s) this run does not own, left in place: `
      + foreign.map((m) => `${m.id} (${m.roundCode})`).join(', '),
    );
  }
}

/** One teardown step: a failure (for example a foreign row still referencing ours) is recorded, not fatal. */
async function cleanStep(label: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    residue.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function matchKey(roundCode: string, matchDate: string): string {
  return `${FIXTURE_SEASON}|${roundCode}|${matchDate}|${homeClubName}|${awayClubName}`;
}

/**
 * AFLDB-ISSUE-272: match_results accepts only a canonical round (the round number, `R` and the number,
 * or a finals code), so the labels this file has always used ('R185A', 'R258X', 'R258L3', ...) now NAME
 * a fixture round instead of being one. Each label maps, once per run, to its own home-and-away round
 * number in the reserved season (code = number), and every payload, key and lookup goes through this.
 */
const fixtureRounds = new Map<string, string>();
function fixtureRound(label: string): string {
  let round = fixtureRounds.get(label);
  if (round === undefined) {
    round = String(101 + fixtureRounds.size);
    fixtureRounds.set(label, round);
  }
  return round;
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
        // No round_code: the shape a submission validated before AFLDB-ISSUE-272 carries.
        resolved: {
          season: FIXTURE_SEASON, round_number: Number(opts.roundCode), round_type: 'home_and_away',
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
  // Read-only checks first; nothing is written until every one has passed.
  await assertTestTarget();
  await assertNamespaceFree();

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
  preflightPassed = true;

  // The first write. No ON CONFLICT: if the season appeared since the preflight this throws and the run
  // owns nothing, so the season is not deleted.
  await owner`INSERT INTO seasons (year, league) VALUES (${FIXTURE_SEASON}, 'AFL')`;
  seasonOwned = true;

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
  try {
    // Disabled unless the preflight passed; then it removes only what this run recorded as its own.
    if (preflightPassed) {
      await cleanStep('claim fixture matches', claimOwnedMatches);
      await cleanStep('owned matches', deleteOwnedMatches);
      await cleanStep('foreign matches', reportForeignMatches);
      // data_submission_rows cascades off data_submissions (migration 023). Every id here came back from
      // this run's own INSERT.
      if (submissionIds.size > 0) {
        await cleanStep('submissions', () => owner`
          DELETE FROM data_submissions WHERE id = ANY(${[...submissionIds]}::int[])
        `);
      }
      // import_batches rows are left in place, matching submission-promotion.test.ts's
      // own convention -- import_batches/sources are append-only (001_foundations.sql).
      // The season goes only if this run inserted it; a foreign row still referencing it fails the
      // DELETE, which is recorded as residue rather than forced.
      if (seasonOwned) {
        await cleanStep('season', () => owner`DELETE FROM seasons WHERE year = ${FIXTURE_SEASON}`);
      }
      // The fixture auth_users row and the sports_data_lab source are intentionally retained (never
      // deleted), matching submission-promotion.test.ts's rationale: deleting them would race a
      // concurrent run that reused them.
    }
  } finally {
    await owner.end({ timeout: 5 });
  }
  if (residue.length > 0) {
    throw new Error(`fixture teardown left residue (not deleted):\n- ${residue.join('\n- ')}`);
  }
});

describe('AFLDB-ISSUE-185 match_results promotion provenance', () => {
  it('A-C. a promoted match persists source_id, source_record_id and import_batch_id', async () => {
    const roundCode = fixtureRound('R185A');
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
    const roundCode = fixtureRound('R185D');
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
    const roundCode = fixtureRound('R185F');
    const matchDate = `${FIXTURE_SEASON}-03-15`;
    const [afltables] = await owner<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
    if (!afltables) throw new Error("sources.key = 'afltables' is not seeded in this database");

    const seededSourceRecordId = `${MARKER}-preexisting-${roundCode}`;
    // Seeded with no import batch, so teardown cannot claim it from a batch: its id is recorded here.
    const [seeded] = await owner<{ id: number }[]>`
      INSERT INTO matches (
        match_key, season, round_code, round_type, round_number, is_final, match_date,
        venue_raw, home_club_id, away_club_id, home_score, away_score, result,
        winner_club_id, margin, attendance_status, source_id, source_record_id
      ) VALUES (
        ${matchKey(roundCode, matchDate)}, ${FIXTURE_SEASON}::smallint, ${roundCode},
        'home_and_away', ${Number(roundCode)}, false, ${matchDate}::date,
        ${MARKER}, ${homeClubId}, ${awayClubId}, 60, 50, 'home_win',
        ${homeClubId}, 10, 'not_collected', ${afltables.id}, ${seededSourceRecordId}
      )
      RETURNING id::int AS id
    `;
    ownedMatchIds.add(seeded.id);

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

  /** One fixture round's row; `label` names the round through fixtureRound() (AFLDB-ISSUE-272). */
  function matchPayload(label: string, day: string, extra: Payload = {}): Payload {
    return {
      season: String(FIXTURE_SEASON), round_code: fixtureRound(label), round_number: fixtureRound(label),
      match_date: `${FIXTURE_SEASON}-04-${day}`, venue: `${TAG} Oval`,
      home_club: home.name, away_club: away.name, home_score: '86', away_score: '70',
      ...extra,
    };
  }

  async function readMatchFigures(label: string) {
    const [row] = await owner<{
      homeGoals: number | null; homeBehinds: number | null; homeScore: number;
      awayGoals: number | null; awayBehinds: number | null;
      attendance: number | null; attendanceStatus: string;
    }[]>`
      SELECT home_goals AS "homeGoals", home_behinds AS "homeBehinds", home_score AS "homeScore",
             away_goals AS "awayGoals", away_behinds AS "awayBehinds",
             attendance, attendance_status::text AS "attendanceStatus"
        FROM matches WHERE season = ${FIXTURE_SEASON} AND round_code = ${fixtureRound(label)}
    `;
    return row;
  }

  function statsPayload(player: string, extra: Payload = {}): Payload {
    return {
      season: String(FIXTURE_SEASON), round_code: fixtureRound('R258P'),
      home_club: home.name, away_club: away.name, player, club: home.name,
      ...extra,
    };
  }

  async function readStats(player: string) {
    const [row] = await owner<Record<string, number | string | null>[]>`
      SELECT s.career_game_no, s.jumper_number, s.brownlow_votes, ${owner([...STATS])}
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE m.season = ${FIXTURE_SEASON} AND m.round_code = ${fixtureRound('R258P')}
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
    // The target and namespace checks ran, read-only, in the file-level beforeAll before its first write.
    // Refuse to build anything on a run whose preflight did not pass.
    if (!preflightPassed) throw new Error('the file-level preflight did not pass; no fixture is created');

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
    // The ids are recorded only after the transaction commits: a rolled-back identity is never "ours".
    const made = await owner.begin(async (tx) => {
      const organizationIds: number[] = [];
      const clubIds: number[] = [];
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
        organizationIds.push(organization.id);
        clubIds.push(created.id);
      }
      return { organizationIds, clubIds };
    });
    fixtureOrganizationIds.push(...made.organizationIds);
    fixtureClubIds.push(...made.clubIds);

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
    // Disabled unless the file-level preflight passed. Every delete below is by an id this run recorded as
    // created (committed); a step a foreign row blocks is recorded as residue and the rest still run.
    if (!preflightPassed) return;
    const playerIdList = [...fixturePlayers.values()];
    await cleanStep('claim fixture matches', claimOwnedMatches);
    await cleanStep('fixture player_match_stats', () => owner`
      DELETE FROM player_match_stats WHERE player_id = ANY(${playerIdList}::int[])
    `);
    await cleanStep('owned matches', deleteOwnedMatches);
    await cleanStep('fixture players', () => owner`DELETE FROM players WHERE id = ANY(${playerIdList}::int[])`);
    // Only the identities this run created; club_aliases would cascade (none are made).
    await cleanStep('fixture clubs', () => owner`DELETE FROM clubs WHERE id = ANY(${fixtureClubIds}::int[])`);
    await cleanStep('fixture organizations', () => owner`
      DELETE FROM club_organizations WHERE id = ANY(${fixtureOrganizationIds}::int[])
    `);

    // A slug-prefixed identity this run did not create is reported, never deleted.
    const [strays] = await owner<{ n: number }[]>`
      SELECT ((SELECT count(*) FROM clubs
                WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`} AND NOT (id = ANY(${fixtureClubIds}::int[])))
            + (SELECT count(*) FROM club_organizations
                WHERE slug LIKE ${`${CLUB_SLUG_PREFIX}%`} AND NOT (id = ANY(${fixtureOrganizationIds}::int[]))))::int AS n
    `;
    if (strays.n > 0) {
      residue.push(`${strays.n} ${CLUB_SLUG_PREFIX}* club/organization row(s) this run does not own, left in place`);
    }

    const [left] = await owner<{
      matches: number; stats: number; players: number; clubs: number; organizations: number;
    }[]>`
      SELECT (SELECT count(*)::int FROM matches
               WHERE season = ${FIXTURE_SEASON} AND id = ANY(${[...ownedMatchIds]}::int[])) AS matches,
             (SELECT count(*)::int FROM player_match_stats
               WHERE player_id = ANY(${playerIdList}::int[])) AS stats,
             (SELECT count(*)::int FROM players WHERE id = ANY(${playerIdList}::int[])) AS players,
             (SELECT count(*)::int FROM clubs WHERE id = ANY(${fixtureClubIds}::int[])) AS clubs,
             (SELECT count(*)::int FROM club_organizations
               WHERE id = ANY(${fixtureOrganizationIds}::int[])) AS organizations
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

  // AFLDB-ISSUE-268: a blank match_attendance cell must never promote as a sourced zero, including from a
  // submission validated BEFORE the fix (stored verdict `ok`, resolved attendance 0). These run the real
  // pipeline on the fixture matches above; nothing here touches a match outside the fixture season. Every
  // match and submission they create is covered by the ownership ledger above (claimed at teardown from the
  // run's own submissions' batches); a case that fails part-way is cleaned the same way. They reach
  // `approved` through approveAndPromote()/insertStaleSubmission(), which set the status directly.
  describe('AFLDB-ISSUE-268 match_attendance blank cells and stale verdicts', () => {
    const TAG_268 = 'AFLDB-ISSUE-268';

    /** A fresh fixture match (never attendance-bearing), returning its id. */
    async function freshMatch(label: string, day: string): Promise<number> {
      await promoteFile('match_results', [matchPayload(label, day)]);
      const [row] = await owner<{ id: number }[]>`
        SELECT id::int AS id FROM matches WHERE season = ${FIXTURE_SEASON} AND round_code = ${fixtureRound(label)}
      `;
      return row.id;
    }

    async function readAttendance(matchId: number) {
      const [row] = await owner<{ attendance: number | null; status: string; sourceKey: string | null }[]>`
        SELECT m.attendance, m.attendance_status::text AS status, s.key AS "sourceKey"
          FROM matches m LEFT JOIN sources s ON s.id = m.attendance_source_id
         WHERE m.id = ${matchId}
      `;
      return row;
    }

    async function readSubmissionState(id: number) {
      const [row] = await owner<{ status: string; error: string | null; importBatchId: string | null }[]>`
        SELECT status::text, error, import_batch_id::text AS "importBatchId"
          FROM data_submissions WHERE id = ${id}
      `;
      const [{ batches }] = await owner<{ batches: number }[]>`
        SELECT count(*)::int AS batches FROM import_batches
         WHERE tool = 'admin-upload' AND notes = ${`submission ${id}`}
      `;
      return { ...row, batches };
    }

    /**
     * A submission exactly as the PRE-FIX validator left it: every row verdict `ok`, a blank cell resolved to
     * 0. Inserted directly (stageSubmission/validateSubmission would now refuse the blank), at the status
     * the scenario needs.
     */
    async function insertStaleSubmission(
      status: 'approved' | 'failed',
      rows: { matchId: number; cell: string | null; resolved: number }[],
    ): Promise<number> {
      const sha = `${TAG_268}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const [submission] = await owner<{ id: number }[]>`
        INSERT INTO data_submissions
          (dataset, filename, content, content_sha256, uploaded_by, row_count, status, error)
        VALUES ('match_attendance', ${`${TAG_268}.csv`}, ${Buffer.from('synthetic\n')}, ${sha},
                ${fixtureAdminId}, ${rows.length}, ${status}::submission_status,
                ${status === 'failed' ? 'first failure' : null})
        RETURNING id
      `;
      submissionIds.add(submission.id);
      for (const [index, row] of rows.entries()) {
        await owner`
          INSERT INTO data_submission_rows (submission_id, row_no, payload, verdict, reasons)
          VALUES (${submission.id}, ${index + 1},
                  ${owner.json({ match_id: String(row.matchId), attendance: row.cell })},
                  'ok',
                  ${owner.json({
                    reasons: [`sets fixture to ${row.resolved}`],
                    resolved: { match_id: row.matchId, attendance: row.resolved },
                  })})
        `;
      }
      return submission.id;
    }

    const NOT_RECORDED = { attendance: null, status: 'not_collected', sourceKey: null };

    it.each(['approved', 'failed'] as const)(
      'a stale `ok` blank row from a %s submission is refused: the match is untouched, no batch is created, and the submission is recorded as failed',
      async (status) => {
        const matchId = await freshMatch(`R258S${status === 'approved' ? 'A' : 'F'}`, status === 'approved' ? '11' : '12');
        expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);
        const id = await insertStaleSubmission(status, [{ matchId, cell: null, resolved: 0 }]);

        const result = await promoteSubmission(id);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toMatch(/Promotion failed and was rolled back: Nothing was promoted: 1 of 1 rows/);
          expect(result.error).toContain('Row 1: attendance is blank');
        }

        // The refusal throws inside the promotion savepoint, so the pipeline records it: the submission is
        // `failed` with the refusal text (an approved one is moved to failed; a failed one keeps failed with
        // a fresh error). The match table and the import-batch table are not written.
        const state = await readSubmissionState(id);
        expect(state.status).toBe('failed');
        expect(state.error).toMatch(/Nothing was promoted: 1 of 1 rows/);
        expect(state.error).not.toBe('first failure');
        expect(state.importBatchId).toBeNull();
        expect(state.batches).toBe(0);
        expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);

        // A retry from `failed` re-reads the same retained cell and refuses again.
        expect((await promoteSubmission(id)).ok).toBe(false);
        expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);
      },
    );

    it('a mixed file (valid rows around a blank one) refuses whole: the valid figures are not applied either', async () => {
      const a = await freshMatch('R258SM1', '13');
      const b = await freshMatch('R258SM2', '14');
      const c = await freshMatch('R258SM3', '15');
      const id = await insertStaleSubmission('approved', [
        { matchId: a, cell: '41000', resolved: 41000 },
        { matchId: b, cell: '', resolved: 0 },
        { matchId: c, cell: '42000', resolved: 42000 },
      ]);

      const result = await promoteSubmission(id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Row 2: attendance is blank');
      for (const matchId of [a, b, c]) expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);
      expect((await readSubmissionState(id)).batches).toBe(0);
    });

    it('a stored resolved value that disagrees with a typed cell is refused, not corrected', async () => {
      const matchId = await freshMatch('R258SD', '16');
      const id = await insertStaleSubmission('approved', [{ matchId, cell: '41000', resolved: 0 }]);
      const result = await promoteSubmission(id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/stored resolved attendance \(0\) disagrees with the cell \(41000\)/);
      expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);
    });

    // approveAndPromote() sets status = 'approved' with a direct UPDATE: the approval ACTION (decideSubmission,
    // its authorisation and error-row check) is not exercised by this file. What this case proves is that
    // validation stores an `error` row for a blank cell and that promoteSubmission() refuses such a submission.
    it('a blank cell validated afresh is stored as an error row, and promoteSubmission refuses it with no status write', async () => {
      const matchId = await freshMatch('R258SV', '17');
      const staged = await stageAndValidate('match_attendance', [{ match_id: String(matchId), attendance: '' }]);
      expect(staged.summary.errors).toBe(1);
      expect(staged.rows[0].verdict).toBe('error');
      expect(staged.rows[0].reasons.reasons[0]).toContain('attendance is blank');

      const result = await approveAndPromote(staged.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/error rows/i);
      // This is the pre-existing error-row refusal: it writes nothing, so the status stays as the helper forced it.
      const state = await readSubmissionState(staged.id);
      expect(state.status).toBe('approved');
      expect(state.error).toBeNull();
      expect(await readAttendance(matchId)).toEqual(NOT_RECORDED);
    });

    // The file has no citation column: the stored source is the manual-source provenance promoteRow records for
    // every figure of this dataset, not a separately supplied citation for the zero.
    it('a "0" cell validates and promotes as a complete zero with manual-source provenance (no separate citation is supplied)', async () => {
      const matchId = await freshMatch('R258SZ', '18');
      await promoteFile('match_attendance', [{ match_id: String(matchId), attendance: '0' }]);
      expect(await readAttendance(matchId)).toEqual({
        attendance: 0, status: 'complete', sourceKey: 'manual_admin_edit',
      });
    });

    it('the existing nonblank spellings still validate and promote to the figure Number() reads', async () => {
      const spellings: [string, string, number][] = [
        ['R258SN1', '1e2', 100], ['R258SN2', '0x10', 16], ['R258SN3', ' 41000 ', 41000], ['R258SN4', '0042', 42],
      ];
      const ids: number[] = [];
      for (const [index, [roundCode]] of spellings.entries()) {
        ids.push(await freshMatch(roundCode, String(20 + index)));
      }
      await promoteFile('match_attendance', spellings.map(([, cell], index) => ({
        match_id: String(ids[index]), attendance: cell,
      })));
      for (const [index, [, , expected]] of spellings.entries()) {
        expect(await readAttendance(ids[index])).toEqual({
          attendance: expected, status: 'complete', sourceKey: 'manual_admin_edit',
        });
      }
    });
  });

  // AFLDB-ISSUE-272 and AFLDB-ISSUE-271 against PostgreSQL, through the real validateSubmission() ->
  // promoteSubmission() path on fixture matches of the reserved season. A Data Editor correction is
  // emulated as the end state saveEdit() leaves (the corrected canonical values plus its active `matches`
  // override row), so no club-season, period-score or audit row is written. The override rows this block
  // inserts are removed by the ids their INSERT returned; the enclosing ledger removes its matches and
  // submissions. No background transaction is used.
  describe('AFLDB-ISSUE-271/272 canonical match identity and Data Editor authority', () => {
    const overrideIds: number[] = [];
    type Staged = Awaited<ReturnType<typeof stageAndValidate>>;
    const resolvedOf = (staged: Staged, index: number) =>
      (staged.rows[index].reasons as unknown as { resolved: Record<string, unknown> | null }).resolved;

    /** Every fixture match on that April day between the two fixture clubs, whatever its round code. */
    async function rowsOnDay(day: string) {
      return owner<{ id: number; roundCode: string }[]>`
        SELECT id::int AS id, round_code AS "roundCode" FROM matches
         WHERE season = ${FIXTURE_SEASON} AND match_date = ${`${FIXTURE_SEASON}-04-${day}`}::date
           AND home_club_id = ${home.id} AND away_club_id = ${away.id}
         ORDER BY id
      `;
    }

    async function fixtureMatch(label: string) {
      const [match] = await owner<{ id: number; key: string }[]>`
        SELECT id::int AS id, match_key AS key FROM matches
         WHERE season = ${FIXTURE_SEASON} AND round_code = ${fixtureRound(label)}
      `;
      if (!match) throw new Error(`fixture match ${label} was not created by the promotion`);
      return match;
    }

    async function submissionState(id: number) {
      const [row] = await owner<{ status: string; error: string | null; importBatchId: string | null }[]>`
        SELECT status::text AS status, error, import_batch_id::text AS "importBatchId"
          FROM data_submissions WHERE id = ${id}
      `;
      const [{ batches }] = await owner<{ batches: number }[]>`
        SELECT count(*)::int AS batches FROM import_batches
         WHERE tool = 'admin-upload' AND notes = ${`submission ${id}`}
      `;
      return { ...row, batches };
    }

    /** The active `matches` override a Data Editor save leaves (one row per field group). Fails on any existing row. */
    async function recordOverride(matchKey: string, fieldGroup: string, values: Record<string, number | null>) {
      const [row] = await owner<{ id: number }[]>`
        INSERT INTO data_overrides (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
        VALUES ('matches', ${matchKey}, ${fieldGroup}, ${owner.json(values as never)}, ${fixtureAdminId}, true)
        RETURNING id::int AS id
      `;
      overrideIds.push(row.id);
      return row.id;
    }

    afterAll(async () => {
      if (overrideIds.length === 0) return;
      await owner`DELETE FROM data_overrides WHERE id = ANY(${overrideIds}::int[])`;
      const [left] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM data_overrides WHERE id = ANY(${overrideIds}::int[])
      `;
      expect(left.n).toBe(0);
    });

    it('272: an R-code row and a lower-case final validate canonical and promote onto the existing match, one row each', async () => {
      await promoteFile('match_results', [
        matchPayload('R272A', '05', { home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10' }),
        matchPayload('R272F', '06', { round_code: 'GF', round_number: null }),
      ]);
      const round = fixtureRound('R272A');
      const before = { a: await rowsOnDay('05'), f: await rowsOnDay('06') };
      expect(before.a).toEqual([{ id: expect.any(Number), roundCode: round }]);
      expect(before.f).toEqual([{ id: expect.any(Number), roundCode: 'GF' }]);

      const staged = await stageAndValidate('match_results', [
        matchPayload('R272A', '05', { round_code: `R${round}`, attendance: '41000' }),
        matchPayload('R272F', '06', { round_code: 'gf', round_number: null, home_score: '90' }),
      ]);
      expect(staged.summary.errors).toBe(0);
      expect(resolvedOf(staged, 0)?.round_code).toBe(round);
      expect(resolvedOf(staged, 1)?.round_code).toBe('GF');
      expect(await approveAndPromote(staged.id)).toMatchObject({ ok: true });

      // ON CONFLICT fired on the canonical key: still one row each, now carrying the file's figures.
      expect(await rowsOnDay('05')).toEqual(before.a);
      expect(await rowsOnDay('06')).toEqual(before.f);
      expect(await readMatchFigures('R272A')).toMatchObject({ homeGoals: 13, attendance: 41000 });
      const [final] = await owner<{ homeScore: number }[]>`
        SELECT home_score AS "homeScore" FROM matches WHERE id = ${before.f[0].id}
      `;
      expect(final.homeScore).toBe(90);
      // The retained cells stay as uploaded, for the evidence.
      const cells = await owner<{ roundCode: string }[]>`
        SELECT payload->>'round_code' AS "roundCode" FROM data_submission_rows
         WHERE submission_id = ${staged.id} ORDER BY row_no
      `;
      expect(cells.map((cell) => cell.roundCode)).toEqual([`R${round}`, 'gf']);
    });

    it('272: an older prevalidated R-code row promotes onto the canonical match; unsupported round text refuses whole', async () => {
      await promoteFile('match_results', [matchPayload('R272B', '07')]);
      const round = fixtureRound('R272B');
      const before = await rowsOnDay('07');
      expect(before).toHaveLength(1);

      // Validated now, then stripped of resolved.round_code: exactly the row the pre-fix validator stored.
      const older = await stageAndValidate('match_results', [
        matchPayload('R272B', '07', { round_code: `R${round}`, home_score: '99' }),
      ]);
      expect(older.summary.errors).toBe(0);
      await owner`
        UPDATE data_submission_rows SET reasons = reasons #- '{resolved,round_code}' WHERE submission_id = ${older.id}
      `;
      expect(await approveAndPromote(older.id)).toMatchObject({ ok: true });
      expect(await rowsOnDay('07')).toEqual(before);
      expect((await readMatchFigures('R272B')).homeScore).toBe(99);

      // A pre-fix row whose cell is no supported round (the old validator accepted any text with a round number).
      const unsupported = await stageAndValidate('match_results', [matchPayload('R272B', '07', { home_score: '98' })]);
      expect(unsupported.summary.errors).toBe(0);
      await owner`
        UPDATE data_submission_rows
           SET payload = jsonb_set(payload, '{round_code}', to_jsonb(${`Round ${round}`}::text)),
               reasons = reasons #- '{resolved,round_code}'
         WHERE submission_id = ${unsupported.id}
      `;
      const refused = await approveAndPromote(unsupported.id);
      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : refused.error)
        .toMatch(/Nothing was promoted: 1 of 1 rows fail the round-code check applied at promotion/);
      expect(await submissionState(unsupported.id)).toMatchObject({ status: 'failed', importBatchId: null, batches: 0 });
      expect(await rowsOnDay('07')).toEqual(before);
      expect((await readMatchFigures('R272B')).homeScore).toBe(99);
    });

    /** The whole matches row, as text, so "unchanged" covers every column (provenance included). */
    async function matchRowText(id: number) {
      const [row] = await owner<{ text: string }[]>`SELECT m::text AS text FROM matches m WHERE m.id = ${id}`;
      return row.text;
    }

    /**
     * Rewrites a fresh validation as the pre-fix validator stored it: that validator compared the RAW round
     * spellings, so neither row was a duplicate, and it recorded no resolved.round_code. Each row keeps the
     * `resolved` today's validator produced for it (a duplicate verdict keeps its resolved values).
     */
    async function asPrevalidatedBeforeTheFix(submissionId: number) {
      await owner`
        UPDATE data_submission_rows
           SET verdict = 'ok',
               reasons = jsonb_build_object('reasons', '[]'::jsonb, 'resolved', (reasons->'resolved') - 'round_code')
         WHERE submission_id = ${submissionId}
      `;
    }

    // Each variant needs an April day no other case in this file uses for the same two fixture clubs
    // (01-18 and 20-24 are taken, 11 by the ISSUE-268 R258SA match), so rowsOnDay() sees only its own match.
    for (const variant of [
      { name: 'an R<n>/bare-number pair with different values', label: 'R272C', day: '10', finals: false },
      { name: 'a gf/GF pair with identical values', label: 'R272G', day: '19', finals: true },
    ]) {
      it(`272: ${variant.name}, prevalidated before the fix, refuses whole and cannot update the existing match twice`, async () => {
        // The gf/GF variant's final is DRAWN (no winner_club_id), as the 1948/1977/2010 Grand Finals are, so
        // R272F stays the reserved season's only decided Grand Final. recomputeClubSeasons() (run by the
        // F-002 deleteMatch case) joins one row per decided Grand Final: a second one won by the same club
        // duplicates that club's club_seasons row (23505 club_seasons_uq).
        const finals: Payload = variant.finals
          ? { round_code: 'GF', round_number: null, home_score: '80', away_score: '80' }
          : {};
        await promoteFile('match_results', [matchPayload(variant.label, variant.day, finals)]);
        const before = await rowsOnDay(variant.day);
        expect(before).toHaveLength(1);
        const existing = await matchRowText(before[0].id);
        const [{ key }] = await owner<{ key: string }[]>`SELECT match_key AS key FROM matches WHERE id = ${before[0].id}`;
        const round = variant.finals ? 'GF' : fixtureRound(variant.label);
        expect(key.split('|')[1]).toBe(round);

        const pair = variant.finals
          ? [matchPayload(variant.label, variant.day, { ...finals, round_code: 'gf' }),
            matchPayload(variant.label, variant.day, finals)]
          : [matchPayload(variant.label, variant.day, { round_code: `R${round}`, home_score: '95' }),
            matchPayload(variant.label, variant.day, { home_score: '96' })];
        const staged = await stageAndValidate('match_results', pair);
        // Today's validator already refuses the pair (the second row duplicates the first's canonical key).
        expect(staged.summary.duplicates).toBe(1);
        await asPrevalidatedBeforeTheFix(staged.id);

        const result = await approveAndPromote(staged.id);
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.error).toMatch(
          /^Promotion failed and was rolled back: Nothing was promoted: 1 canonical match key\(s\) are claimed by more than one row \(rows 1, 2 are all /,
        );
        expect(result.ok ? '' : result.error).toContain(`rows 1, 2 are all ${key}`);
        // The pipeline's refusal outcome: failed, no batch linked, and no batch survives the rollback.
        expect(await submissionState(staged.id)).toMatchObject({ status: 'failed', importBatchId: null, batches: 0 });
        expect(await rowsOnDay(variant.day)).toEqual(before);
        expect(await matchRowText(before[0].id)).toBe(existing);
        // The uploaded cells stay as uploaded.
        const cells = await owner<{ roundCode: string }[]>`
          SELECT payload->>'round_code' AS "roundCode" FROM data_submission_rows
           WHERE submission_id = ${staged.id} ORDER BY row_no
        `;
        expect(cells.map((cell) => cell.roundCode)).toEqual(pair.map((payload) => payload.round_code));
      });
    }

    it('271: a correction recorded after validation wins: the whole submission is refused and left failed', async () => {
      await promoteFile('match_results', [
        matchPayload('R271A', '08', {
          home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10', attendance: '45000',
        }),
        matchPayload('R271B', '09'),
      ]);
      // Validated while no authority exists: a change to another match, and the original 13.8 for R271A.
      const staged = await stageAndValidate('match_results', [
        matchPayload('R271B', '09', { home_score: '101' }),
        matchPayload('R271A', '08', { home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10' }),
      ]);
      expect(staged.summary.errors).toBe(0);

      // A Data Editor score correction lands between validation and promotion: 13.8 (86) becomes 14.8 (92).
      const match = await fixtureMatch('R271A');
      await owner`UPDATE matches SET home_goals = 14, home_score = 92, margin = 22 WHERE id = ${match.id}`;
      const overrideId = await recordOverride(match.key, 'score', { home_goals: 14 });
      const otherBefore = await readMatchFigures('R271B');

      const result = await approveAndPromote(staged.id);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toMatch(
        /1 row\(s\) conflict with active Data Editor authority; nothing was promoted\. row 2 .*home_goals \(file 13, Data Editor 14\).*home_score \(file 86, Data Editor 92\)/,
      );
      expect(await submissionState(staged.id)).toMatchObject({ status: 'failed', importBatchId: null, batches: 0 });
      // The correction stands, the override is untouched and still active, and row 1 was not applied either.
      expect(await readMatchFigures('R271A')).toMatchObject({ homeGoals: 14, homeBehinds: 8, homeScore: 92, attendance: 45000 });
      expect(await readMatchFigures('R271B')).toEqual(otherBefore);
      const [override] = await owner<{ isActive: boolean; unchanged: boolean }[]>`
        SELECT is_active AS "isActive", override_values = '{"home_goals": 14}'::jsonb AS unchanged
          FROM data_overrides WHERE id = ${overrideId}
      `;
      expect(override).toEqual({ isActive: true, unchanged: true });
      // A retry re-reads the authority and refuses again.
      expect((await promoteSubmission(staged.id)).ok).toBe(false);
      expect((await readMatchFigures('R271A')).homeGoals).toBe(14);
    });

    it('271: validation reports the conflict under the canonical key, and the identical figures still promote', async () => {
      // The R271A correction from the previous case is in place (14.8, 92, an active score override).
      const round = fixtureRound('R271A');
      const original = { home_goals: '13', home_behinds: '8', away_goals: '10', away_behinds: '10' };
      // `R<n>` is the same canonical match, so it cannot slip past the override recorded under `<n>`.
      for (const roundCode of [round, `R${round}`]) {
        const fresh = await stageAndValidate('match_results', [matchPayload('R271A', '08', { ...original, round_code: roundCode })]);
        expect(fresh.summary.errors).toBe(1);
        expect(fresh.rows[0].reasons.reasons).toHaveLength(1);
        expect(fresh.rows[0].reasons.reasons[0]).toMatch(
          /^Data Editor authority: the Data Editor protects home_goals \(file 13, Data Editor 14\), home_score \(file 86, Data Editor 92\);/,
        );
        expect(fresh.rows[0].reasons.reasons[0]).toContain('/admin/data-editor?entity=matches&id=');
        expect((await approveAndPromote(fresh.id)).ok).toBe(false); // an error row: refused with no write
      }

      // The corrected figures themselves, with an unprotected attendance change: admitted, one row.
      await promoteFile('match_results', [matchPayload('R271A', '08', {
        round_code: `R${round}`, home_goals: '14', home_behinds: '8', home_score: '92', attendance: '46000',
      })]);
      expect(await readMatchFigures('R271A')).toMatchObject({ homeGoals: 14, homeScore: 92, attendance: 46000 });
      expect(await rowsOnDay('08')).toHaveLength(1);
    });
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
    const row264 = (tag: Tag, extra: Payload = {}, label = 'R258X'): Payload => ({
      season: String(FIXTURE_SEASON), round_code: fixtureRound(label),
      home_club: home.name, away_club: away.name, player: nameOf(tag), club: home.name,
      ...extra,
    });

    async function matchOf(label: string): Promise<FixtureMatch> {
      const [match] = await owner<FixtureMatch[]>`
        SELECT id::int AS id, match_key AS key FROM matches
         WHERE season = ${FIXTURE_SEASON} AND round_code = ${fixtureRound(label)}
      `;
      if (!match) throw new Error(`fixture match ${label} was not created by the promotion`);
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
          payload: { round_code: fixtureRound(`R258L${n}`), match_date: dateOf(n) },
          resolved: {
            season: FIXTURE_SEASON, round_number: Number(fixtureRound(`R258L${n}`)), round_type: 'home_and_away',
            home_club_name: home.name, away_club_name: away.name,
          },
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
