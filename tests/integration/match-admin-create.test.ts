/**
 * AFLDB-ISSUE-182: first real-database coverage for `createMatch()`, plus
 * proof of the canonical-identity duplicate-detection hardening.
 *
 * Investigation established that admin canonical match creation
 * (`match-admin.ts:createMatch`, wired through
 * `src/app/admin/data-editor/actions.ts:createMatchAction`) already existed
 * and was already transactional and audited (AFLDB-ISSUE-027 shape), but had
 * two real gaps:
 *
 *   1. Its duplicate pre-check compared `match_key` strings, and
 *      `src/lib/acquisition/canonical-apply.ts` (~L39-42, ~L663-665)
 *      documents THREE mutually incompatible `match_key` renderings in this
 *      repository (this admin path: club IDs; `src/lib/ingest/datasets.ts`:
 *      club names; the canonical-apply/settle path: the legacy bundle's own
 *      key, carried verbatim). A row for the same real match written under a
 *      different scheme would not share this path's key, so the old check
 *      could silently admit a duplicate. `createMatch()` now checks the
 *      underlying canonical columns instead: `season`, `round_type`,
 *      `round_number`, `match_date`, `home_club_id`, `away_club_id`. Test B
 *      below is the regression proof.
 *
 *   2. No integration test ever called `createMatch()` against a real
 *      database. This file is the sibling of
 *      `tests/integration/match-admin-delete.test.ts` for the creation half
 *      of the same module, following its guard/fixture/cleanup conventions.
 *
 * PERMISSION BOUNDARY (item F of the AFLDB-ISSUE-182 brief) is deliberately
 * NOT re-tested here. `createMatch()` is domain/DB-layer code with no
 * authorization of its own; `createMatchAction` enforces
 * `requireCapability('data.dataEditor')` (SUPER_ADMIN_ONLY) as the first
 * thing it awaits. That boundary already has full, generic coverage in
 * `tests/auth.test.ts`'s "capability enforcement contract" and
 * "requireCapability against the real guard" suites, which walk every
 * `src/app/admin/**` boundary (including
 * `src/app/admin/data-editor/actions.ts`) and exercise every declared
 * capability -- `data.dataEditor` included -- against every viewer role.
 * Duplicating that here would conflate the action-layer authorization test
 * with this file's DB-transaction tests, which the investigation explicitly
 * called out to avoid.
 *
 * Round numbers are drawn from a private 9000+ counter so every seeded row
 * is unambiguously synthetic and can never collide with a real AFL round.
 */
import './guard';

import postgres from 'postgres';
import {
  afterAll, afterEach, beforeAll, describe, expect, it,
} from 'vitest';

import { saveEdit } from '@/db/queries/data-edits';
import { createMatch, deleteMatch, type CreateMatchInput } from '@/db/queries/match-admin';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_IMPORT_DATABASE_URL
  ?? testDbUrl;

const owner = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-182';

let seededCounter = 0;
/** A round_number no real AFL/VFL season has ever reached. */
const nextRound = () => 9000 + (seededCounter += 1);

/**
 * afldb_test is a migration-built database: it has the schema but none of
 * the reference/historical data (clubs, seasons, venues) a rebuilt or
 * imported database would carry. Every row this suite needs -- two
 * always-eligible club identities, one identity with a bounded lifespan,
 * and the season years their matches reference -- is therefore created and
 * torn down here, never assumed to pre-exist.
 */
const GENERAL_SEASON = 2099;
const STALE_VALID_SEASON = 2050; // well before GENERAL_SEASON

let actorId: number;
let createdThrowawayAdmin = false;
let season: number;
let clubA: number;
let clubB: number;
let staleClubId: number;
let staleClubName: string;
let orgAId: number;
let orgBId: number;
let orgStaleId: number;

/** Every match row this file has committed (via createMatch or a direct
 * seed insert), removed through the real deleteMatch() path in afterEach so
 * the recompute side effects createMatch() itself triggers (season
 * metadata, club_seasons, Brownlow eligibility) are reverted the same way a
 * real operator's undo would revert them. */
const committedMatchIds: number[] = [];

function baseInput(overrides: Partial<CreateMatchInput> = {}): CreateMatchInput {
  const roundNumber = overrides.roundNumber ?? nextRound();
  return {
    season,
    roundType: 'home_and_away',
    roundNumber,
    roundCode: String(roundNumber),
    matchDate: `${season}-01-01`,
    homeClubId: clubA,
    awayClubId: clubB,
    homeScore: 100,
    awayScore: 80,
    attendance: null,
    notes: `${MARKER} ${roundNumber}`,
    adminUserId: actorId,
    ...overrides,
  };
}

async function countIdentity(roundNumber: number, matchDate: string, homeClubId: number, awayClubId: number) {
  const [row] = await owner<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches
     WHERE season = ${season} AND round_type = 'home_and_away' AND round_number = ${roundNumber}
       AND match_date = ${matchDate}::date AND home_club_id = ${homeClubId} AND away_club_id = ${awayClubId}
  `;
  return row.n;
}

const SLUG_PREFIX = `${MARKER.toLowerCase()}-`; // matches club-a/-b/-stale AND org-a/-b/-stale

/**
 * Idempotent, pattern-based teardown of every club/organization fixture
 * (and anything still pointing at one), run both before and after the
 * suite -- the established convention in
 * tests/integration/nl-semantic-mapping.test.ts -- so a previous run that
 * crashed mid-suite cannot leave unique-slug fixtures behind to collide
 * with this one's beforeAll.
 */
async function cleanupClubFixtures(): Promise<void> {
  const slugPattern = `${SLUG_PREFIX}%`;
  await owner`
    DELETE FROM matches
     WHERE home_club_id IN (SELECT id FROM clubs WHERE slug LIKE ${slugPattern})
        OR away_club_id IN (SELECT id FROM clubs WHERE slug LIKE ${slugPattern})
        OR venue_raw = ${MARKER}`;
  await owner`DELETE FROM data_edits WHERE table_name = 'matches' AND note LIKE ${`${MARKER}%`}`;
  await owner`
    DELETE FROM club_seasons WHERE club_id IN (SELECT id FROM clubs WHERE slug LIKE ${slugPattern})`;
  await owner`DELETE FROM clubs WHERE slug LIKE ${slugPattern}`;
  await owner`DELETE FROM club_organizations WHERE slug LIKE ${slugPattern}`;
  await owner`DELETE FROM seasons WHERE year IN (${GENERAL_SEASON}, ${STALE_VALID_SEASON})`;
}

/**
 * Seeds a match for the same real game createMatch() would describe, but
 * with match_key rendered the way src/lib/ingest/datasets.ts:589-590 does
 * (club NAMES) rather than the way this admin path does (club IDs) -- one
 * of the three incompatible schemes canonical-apply.ts documents.
 */
async function seedNameKeyedMatch(input: {
  roundNumber: number; matchDate: string; homeClubId: number; awayClubId: number;
}): Promise<number> {
  const [homeClub] = await owner<{ name: string }[]>`SELECT name FROM clubs WHERE id = ${input.homeClubId}`;
  const [awayClub] = await owner<{ name: string }[]>`SELECT name FROM clubs WHERE id = ${input.awayClubId}`;
  const roundCode = String(input.roundNumber);
  const nameKeyedMatchKey = `${season}|${roundCode}|${input.matchDate}|${homeClub.name}|${awayClub.name}`;

  const [match] = await owner<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${nameKeyedMatchKey}, ${season}::smallint, ${roundCode}, 'home_and_away', ${input.roundNumber}, false,
      ${input.matchDate}::date, ${MARKER}, ${input.homeClubId}, ${input.awayClubId}, 100, 80,
      'home_win', ${input.homeClubId}, 20, 'not_collected'
    ) RETURNING id::int AS id`;
  return match.id;
}

beforeAll(async () => {
  await cleanupClubFixtures();
  season = GENERAL_SEASON;

  // matches.season / clubs.first_season / clubs.last_season all FK to
  // seasons(year); createMatch() itself only upserts the season it is
  // asked to write into, so GENERAL_SEASON's row would appear as a side
  // effect of the first successful create -- but STALE_VALID_SEASON is
  // needed up front, as the FK target for the stale club's bound below, so
  // both are seeded explicitly rather than left to test order.
  await owner`
    INSERT INTO seasons (year, league) VALUES (${GENERAL_SEASON}, 'AFL')
    ON CONFLICT (year) DO NOTHING`;
  await owner`
    INSERT INTO seasons (year, league) VALUES (${STALE_VALID_SEASON}, 'AFL')
    ON CONFLICT (year) DO NOTHING`;

  const [orgA] = await owner<{ id: number }[]>`
    INSERT INTO club_organizations (name, slug) VALUES (${`${MARKER} Org A`}, ${`${MARKER.toLowerCase()}-org-a`})
    RETURNING id`;
  const [orgB] = await owner<{ id: number }[]>`
    INSERT INTO club_organizations (name, slug) VALUES (${`${MARKER} Org B`}, ${`${MARKER.toLowerCase()}-org-b`})
    RETURNING id`;
  const [orgStale] = await owner<{ id: number }[]>`
    INSERT INTO club_organizations (name, slug) VALUES (${`${MARKER} Org Stale`}, ${`${MARKER.toLowerCase()}-org-stale`})
    RETURNING id`;
  orgAId = orgA.id;
  orgBId = orgB.id;
  orgStaleId = orgStale.id;

  // clubs.current_identity_id is NOT NULL and self-referencing (an
  // identity that never renamed points at itself). The established
  // fixture pattern for this (tests/integration/nl-semantic-mapping.test.ts)
  // defers the FK for the transaction, inserts with a placeholder, then
  // fixes it up before commit.
  await owner.begin(async (tx) => {
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;

    const [a] = await tx<{ id: number }[]>`
      INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
      VALUES (${`${MARKER.toLowerCase()}-club-a`}, ${`${MARKER} Club A`}, 'Fixture A', 'FXA', -1,
              ${`${MARKER}-club-a`}, ${orgAId})
      RETURNING id`;
    await tx`UPDATE clubs SET current_identity_id = ${a.id} WHERE id = ${a.id}`;

    const [b] = await tx<{ id: number }[]>`
      INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
      VALUES (${`${MARKER.toLowerCase()}-club-b`}, ${`${MARKER} Club B`}, 'Fixture B', 'FXB', -1,
              ${`${MARKER}-club-b`}, ${orgBId})
      RETURNING id`;
    await tx`UPDATE clubs SET current_identity_id = ${b.id} WHERE id = ${b.id}`;

    // Bounded to STALE_VALID_SEASON only -- afldb_identity_for_season
    // (migration 017) must refuse it for GENERAL_SEASON, which is later.
    const [stale] = await tx<{ id: number }[]>`
      INSERT INTO clubs (
        slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id,
        first_season, last_season
      ) VALUES (
        ${`${MARKER.toLowerCase()}-club-stale`}, ${`${MARKER} Club Stale`}, 'Fixture Stale', 'FXS', -1,
        ${`${MARKER}-club-stale`}, ${orgStaleId}, ${STALE_VALID_SEASON}, ${STALE_VALID_SEASON}
      )
      RETURNING id`;
    await tx`UPDATE clubs SET current_identity_id = ${stale.id} WHERE id = ${stale.id}`;

    clubA = a.id;
    clubB = b.id;
    staleClubId = stale.id;
  });
  staleClubName = `${MARKER} Club Stale`;

  // A permanent keep-alive match, never touched by per-test cleanup.
  // recomputeClubSeasons(tx, season) -- called inside every successful
  // createMatch()/deleteMatch() -- throws "refusing to rebuild club_seasons
  // from nothing" when a season has zero non-final matches
  // (src/db/queries/player-derived.ts:413-423). A synthetic season with
  // only this file's own per-test matches would hit exactly that the
  // moment the last one is cleaned up in afterEach, so this row (round 1,
  // outside every per-test fixture's 9000+ round-number range) is seeded
  // directly -- not through createMatch(), since it is scaffolding rather
  // than something under test -- and removed only by cleanupClubFixtures()
  // in afterAll.
  await owner`
    INSERT INTO matches (
      match_key, season, round_code, round_type, round_number, is_final, match_date,
      venue_raw, home_club_id, away_club_id, home_score, away_score, result,
      winner_club_id, margin, attendance_status
    ) VALUES (
      ${`${MARKER}-keepalive`}, ${GENERAL_SEASON}::smallint, '1', 'home_and_away', 1, false,
      ${`${GENERAL_SEASON}-01-01`}::date, ${MARKER}, ${clubA}, ${clubB}, 100, 80,
      'home_win', ${clubA}, 20, 'not_collected'
    )`;

  const [existingAdmin] = await owner<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-182-fixture@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }
});

afterEach(async () => {
  while (committedMatchIds.length > 0) {
    const id = committedMatchIds.pop()!;
    const result = await deleteMatch({ matchId: id, adminUserId: actorId, reason: `${MARKER} cleanup` });
    if (!result.ok) {
      // None of this file's fixtures carry a Brownlow/collateral/staging/
      // period-stat/lineup dependent, so deleteMatch is not expected to
      // refuse; this is a defensive fallback only.
      await owner`DELETE FROM matches WHERE id = ${id}`;
    }
  }
  await owner`DELETE FROM data_edits WHERE table_name = 'matches' AND note LIKE ${`${MARKER}%`}`;
});

afterAll(async () => {
  try {
    // cleanupClubFixtures() removes the keep-alive match, club_seasons,
    // clubs and club_organizations in FK-safe order (matches before
    // club_seasons before clubs before club_organizations/seasons) --
    // see its own comment for why deleteMatch() is deliberately not used
    // for the keep-alive row here.
    await cleanupClubFixtures();
    if (createdThrowawayAdmin) {
      await owner`DELETE FROM auth_users WHERE id = ${actorId}`;
    }
  } finally {
    await owner.end({ timeout: 5 });
  }
});

describe('AFLDB-ISSUE-182 -- createMatch() against a real database', () => {
  it('A. creates a canonical match with correct derived result/winner/margin, quarter scores and a required audit row', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-02`;
    const created = await createMatch(baseInput({
      roundNumber,
      matchDate,
      homeScore: null,
      awayScore: null,
      homeGoals: 15,
      homeBehinds: 10,
      awayGoals: 12,
      awayBehinds: 8,
      homeQuarters: { 1: { goals: 4, behinds: 2 } },
      awayQuarters: { 1: { goals: 3, behinds: 1 } },
    }));
    committedMatchIds.push(created.id);

    const [row] = await owner<{
      homeScore: number; awayScore: number; result: string; winnerClubId: number | null; margin: number;
    }[]>`
      SELECT home_score AS "homeScore", away_score AS "awayScore", result,
             winner_club_id AS "winnerClubId", margin
        FROM matches WHERE id = ${created.id}`;
    expect(row.homeScore).toBe(15 * 6 + 10);
    expect(row.awayScore).toBe(12 * 6 + 8);
    expect(row.result).toBe('home_win');
    expect(row.winnerClubId).toBe(clubA);
    expect(row.margin).toBe(row.homeScore - row.awayScore);

    const [period] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM match_period_scores WHERE match_id = ${created.id}`;
    expect(period.n).toBe(2);

    // data_edits.row_id is bigint (migration 057); postgres.js returns
    // bigint columns as strings, so it is cast to int here rather than
    // compared loosely -- matches.id fits comfortably in int range.
    const [audit] = await owner<{ fieldGroup: string; rowId: number }[]>`
      SELECT field_group AS "fieldGroup", row_id::int AS "rowId" FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${created.id}`;
    expect(audit?.fieldGroup).toBe('match_creation');
    expect(audit?.rowId).toBe(created.id);

    expect(await countIdentity(roundNumber, matchDate, clubA, clubB)).toBe(1);
  });

  it('B. refuses a duplicate even when the existing row was written under a different match_key rendering', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;

    const seededId = await seedNameKeyedMatch({
      roundNumber, matchDate, homeClubId: clubA, awayClubId: clubB,
    });
    committedMatchIds.push(seededId);
    expect(await countIdentity(roundNumber, matchDate, clubA, clubB)).toBe(1);

    let caught: unknown;
    try {
      await createMatch(baseInput({ roundNumber, matchDate }));
    } catch (error) {
      caught = error;
    }
    expect(caught, 'createMatch should have refused the duplicate').toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/already exists for that season, round, date and clubs/);
    // The refusal must not depend on -- or leak -- match_key/SQL detail:
    // this seeded row's match_key is club-NAME-keyed, nothing like the
    // club-ID key createMatch() would have rendered for the same inputs.
    expect(message).not.toMatch(/match_key|constraint|SQLSTATE|23505/i);

    // Still exactly one canonical row -- no duplicate inserted.
    expect(await countIdentity(roundNumber, matchDate, clubA, clubB)).toBe(1);

    // No audit/mutation collateral from the refused attempt.
    const [audit] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_edits WHERE table_name = 'matches' AND row_id = ${seededId}`;
    expect(audit.n).toBe(0);
  });

  it('C. rejects home == away before opening a transaction, committing nothing', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;

    let caught: unknown;
    try {
      await createMatch(baseInput({ roundNumber, matchDate, awayClubId: clubA }));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error | undefined)?.message).toMatch(/Home club and away club must be different/);
    expect(await countIdentity(roundNumber, matchDate, clubA, clubA)).toBe(0);
  });

  it('D. refuses a club identity that is not active in the requested season, committing nothing', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;

    let caught: unknown;
    try {
      await createMatch(baseInput({ roundNumber, matchDate, homeClubId: staleClubId }));
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error | undefined)?.message;
    expect(message).toMatch(/is not the historical club identity active in/);
    expect(message).toContain(staleClubName);
    expect(await countIdentity(roundNumber, matchDate, staleClubId, clubB)).toBe(0);
  });

  it('E/K. rolls back the match, its quarter scores and its creation provenance when the required audit write fails', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;
    const marker = `${MARKER}-audit-trap-${roundNumber}`;
    const fnName = `fn_issue_182_audit_trap_${roundNumber}`;
    const trgName = `trg_issue_182_audit_trap_${roundNumber}`;

    try {
      // A test-only BEFORE INSERT trigger on data_edits, scoped by WHEN to
      // this run's own unique note marker, so it can never fire for any
      // other row -- in this file or any other test file sharing
      // afldb_test -- even under parallel test execution. It forces a
      // genuine PostgreSQL-raised failure of the required audit write
      // (AFLDB-ISSUE-027's contract: recordDataEdit has no try/catch, so
      // this propagates and rolls back the whole transaction).
      await owner.unsafe(`
        CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $trap$
        BEGIN
          RAISE EXCEPTION 'AFLDB-ISSUE-182 forced audit failure';
        END;
        $trap$ LANGUAGE plpgsql
      `);
      await owner.unsafe(`
        CREATE TRIGGER ${trgName}
        BEFORE INSERT ON data_edits
        FOR EACH ROW
        WHEN (NEW.note = '${marker}')
        EXECUTE FUNCTION ${fnName}()
      `);

      let caught: unknown;
      try {
        await createMatch(baseInput({
          roundNumber,
          matchDate,
          notes: marker,
          homeQuarters: { 1: { goals: 4, behinds: 2 } },
        }));
      } catch (error) {
        caught = error;
      }
      expect(caught, 'createMatch should have propagated the forced audit failure').toBeTruthy();
      expect((caught as Error).message).toMatch(/forced audit failure/i);

      // No canonical match survives.
      expect(await countIdentity(roundNumber, matchDate, clubA, clubB)).toBe(0);

      // No orphaned quarter-score collateral (vacuous once no match row
      // exists to join against, but kept explicit so a future reordering
      // of the insert sequence would still be caught).
      const [period] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM match_period_scores mps
          JOIN matches m ON m.id = mps.match_id
         WHERE m.season = ${season} AND m.round_type = 'home_and_away' AND m.round_number = ${roundNumber}`;
      expect(period.n).toBe(0);

      // AFLDB-ISSUE-184 (K): the manual_admin_edit source_id/source_record_id
      // stamp createMatch() mints for this row rolls back with everything
      // else -- no orphaned provenance-bearing match survives a failed
      // creation. Redundant with the countIdentity(...) check above (the
      // same match_key columns identify it either way), but asserted
      // directly against provenance since that is what K asks for.
      const [orphanProvenance] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches m
          JOIN sources s ON s.id = m.source_id
         WHERE s.key = 'manual_admin_edit' AND m.season = ${season}
           AND m.round_type = 'home_and_away' AND m.round_number = ${roundNumber}`;
      expect(orphanProvenance.n).toBe(0);

      // The trigger's own target row rolled back with everything else.
      const [audit] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM data_edits WHERE note = ${marker}`;
      expect(audit.n).toBe(0);
    } finally {
      await owner.unsafe(`DROP TRIGGER IF EXISTS ${trgName} ON data_edits`);
      await owner.unsafe(`DROP FUNCTION IF EXISTS ${fnName}()`);
    }
  });

  it('G. refuses an immediate retry of the exact same creation (the original match_key-equality case)', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;
    const input = baseInput({ roundNumber, matchDate });

    const created = await createMatch(input);
    committedMatchIds.push(created.id);

    let caught: unknown;
    try {
      await createMatch(input);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error | undefined)?.message).toMatch(/already exists for that season, round, date and clubs/);
    expect(await countIdentity(roundNumber, matchDate, clubA, clubB)).toBe(1);
  });

  // AFLDB-ISSUE-183: a blank/omitted roundCode on a normal numbered round
  // used to fall back to `R${roundNumber}` ("R5"), diverging from the
  // decimal-string vocabulary every importer writes ("5") -- see
  // src/lib/external-afl/current-season-import.ts:roundCodes() and
  // src/lib/ingest/datasets.ts's required source round_code column. Finals
  // round_type values do not share this fallback (they derive GF/PF/SF/QF/
  // EF/WF from round_type via a separate branch, unchanged here) and are
  // not re-tested by this issue.
  it('H. derives the decimal-string round_code, not "R5", when roundCode is blank for a numbered round', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;
    const created = await createMatch(baseInput({ roundNumber, matchDate, roundCode: undefined }));
    committedMatchIds.push(created.id);

    const [row] = await owner<{ roundCode: string }[]>`
      SELECT round_code AS "roundCode" FROM matches WHERE id = ${created.id}`;
    expect(row.roundCode).toBe(String(roundNumber));
    expect(row.roundCode).not.toMatch(/^R/i);
  });

  it('I. preserves an explicitly supplied roundCode (trimmed/uppercased) rather than deriving one', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;
    const created = await createMatch(baseInput({
      roundNumber, matchDate, roundCode: `  round${roundNumber}  `,
    }));
    committedMatchIds.push(created.id);

    const [row] = await owner<{ roundCode: string }[]>`
      SELECT round_code AS "roundCode" FROM matches WHERE id = ${created.id}`;
    expect(row.roundCode).toBe(`ROUND${roundNumber}`);
  });

  // AFLDB-ISSUE-184: admin-created canonical matches previously left
  // source_id/source_record_id/import_batch_id entirely NULL --
  // canonical-apply.ts's own S5 comment named this as one of the reasons a
  // source-less canonical row's ownership could never be proven. createMatch()
  // now stamps the same manual_admin_edit provenance every other
  // admin/manual writer in the repository uses (fixtures, coaches, draft,
  // club leadership, special records): source_id resolves to the shared
  // manual_admin_edit sources row, source_record_id is a token minted once
  // at creation ('match:<uuid>'), and import_batch_id stays NULL (no
  // import_batches row exists for a single admin keystroke).
  it('J. an admin-created match receives manual_admin_edit creation provenance, with a distinct token per match', async () => {
    const roundNumberOne = nextRound();
    const roundNumberTwo = nextRound();
    const matchDate = `${season}-01-01`;

    const createdOne = await createMatch(baseInput({ roundNumber: roundNumberOne, matchDate }));
    committedMatchIds.push(createdOne.id);
    const createdTwo = await createMatch(baseInput({ roundNumber: roundNumberTwo, matchDate }));
    committedMatchIds.push(createdTwo.id);

    const rows = await owner<{
      id: number; sourceKey: string | null; sourceRecordId: string | null; importBatchId: number | null;
    }[]>`
      SELECT m.id, s.key AS "sourceKey", m.source_record_id AS "sourceRecordId",
             m.import_batch_id AS "importBatchId"
        FROM matches m
        LEFT JOIN sources s ON s.id = m.source_id
       WHERE m.id IN (${createdOne.id}, ${createdTwo.id})
       ORDER BY m.id`;
    expect(rows).toHaveLength(2);

    const uuidRe = /^match:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const row of rows) {
      expect(row.sourceKey).toBe('manual_admin_edit');
      expect(row.sourceRecordId).toMatch(uuidRe);
      expect(row.importBatchId).toBeNull();
    }
    // Two creates in the same run never share a token.
    expect(rows[0].sourceRecordId).not.toBe(rows[1].sourceRecordId);
  });

  it('L. a subsequent match edit preserves creation provenance; the correction lands only in data_edits', async () => {
    const roundNumber = nextRound();
    const matchDate = `${season}-01-01`;
    const created = await createMatch(baseInput({ roundNumber, matchDate }));
    committedMatchIds.push(created.id);

    const [before] = await owner<{
      matchKey: string; sourceId: number | null; sourceRecordId: string | null;
    }[]>`
      SELECT match_key AS "matchKey", source_id AS "sourceId", source_record_id AS "sourceRecordId"
        FROM matches WHERE id = ${created.id}`;

    const editNote = `${MARKER}-provenance-preservation-${roundNumber}`;
    try {
      const result = await saveEdit({
        entityKey: 'matches',
        rowId: created.id,
        groupKey: 'match_event',
        raw: { match_event: `${MARKER} edited ${roundNumber}` },
        adminUserId: actorId,
        note: editNote,
      });
      expect(result).toMatchObject({ ok: true });

      const [after] = await owner<{
        sourceId: number | null; sourceRecordId: string | null; matchEvent: string | null;
      }[]>`
        SELECT source_id AS "sourceId", source_record_id AS "sourceRecordId", match_event AS "matchEvent"
          FROM matches WHERE id = ${created.id}`;
      // The edit landed...
      expect(after.matchEvent).toBe(`${MARKER} edited ${roundNumber}`);
      // ...but did not touch the creation provenance stamped by createMatch().
      expect(after.sourceId).toBe(before.sourceId);
      expect(after.sourceRecordId).toBe(before.sourceRecordId);

      // The correction is recorded separately, in data_edits, not by
      // mutating provenance.
      const [edit] = await owner<{ fieldGroup: string; rowId: number }[]>`
        SELECT field_group AS "fieldGroup", row_id::int AS "rowId" FROM data_edits
         WHERE table_name = 'matches' AND note = ${editNote}`;
      expect(edit?.fieldGroup).toBe('match_event');
      expect(edit?.rowId).toBe(created.id);
    } finally {
      // saveEdit()'s data_overrides row (entity_type='matches', keyed by
      // match_key) has no FK to matches and is not covered by this file's
      // deleteMatch()-based afterEach, so it is cleaned up explicitly here
      // -- the same convention tests/integration/data-editor.test.ts uses
      // for its own matches/'notes' override proof.
      await owner`
        DELETE FROM data_overrides
         WHERE entity_type = 'matches' AND entity_key = ${before.matchKey} AND field_group = 'match_event'`;
    }
  });

  // M. Reconciliation-ownership proof: whether a manual_admin_edit-owned
  // match is treated as foreign-owned/protected by the settle/promotion
  // ownership gate is a pure function of autoApplyOwnership()/
  // evaluateTargetOwnership() (src/lib/acquisition/canonical-apply.ts,
  // reconciliation.ts) -- it needs no database row, since those functions
  // take a TargetOwnership value directly. That narrower, DB-free proof
  // lives alongside the gate's existing direct unit coverage in
  // tests/current-season-import.test.ts's 'E3 -- the automatic-path
  // ownership predicate' describe block (new case: "treats an
  // admin-created (manual_admin_edit-owned) row as foreign-owned, on both
  // the automatic and the generic gate"), rather than an elaborate
  // end-to-end promotion scenario duplicated here.

  // N. Missing manual_admin_edit source, rollback proof: NOT ADDED.
  // sources.key = 'manual_admin_edit' is a single, globally-seeded row
  // (migration 057) that every other manual-provenance writer's own
  // integration suite also depends on (admin-coaches, admin-fixtures,
  // admin-draft, admin-season-lists, admin-club-leadership,
  // admin-special-records, data-editor's attendance-group path, and this
  // file's own attendanceSourceId behaviour, pre-184). createMatch() opens
  // its OWN connection/transaction, so proving the missing-source refusal
  // would require deleting or renaming that row OUTSIDE this test's own
  // transaction -- a genuinely global mutation visible to every other
  // afldb_test connection for the duration of the test, including any
  // other integration file running concurrently against the same
  // database. That is exactly the "brittle global mutation of shared
  // source rows" the AFLDB-ISSUE-184 brief says to stop and report on
  // rather than build. The refusal branch itself
  // (`if (!manualSource) throw new Error('The manual_admin_edit provenance
  // source is not configured.')`, match-admin.ts) is the same pattern the
  // pre-184 attendanceSourceId lookup already used unit-untested; no
  // existing test in this repository exercises a missing manual_admin_edit
  // row for ANY writer, so this gap is consistent with established
  // practice rather than a new one.
});
