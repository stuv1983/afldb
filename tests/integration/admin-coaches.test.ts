/**
 * Coach administration against a real PostgreSQL (AFLDB-ISSUE-159 Stage 2,
 * §10.2 gates 8-11). Everything here needs a database and can be proved
 * nowhere else: that a mutation really writes the canonical row, the
 * `data_overrides` upsert and the `data_edits` audit row together and rolls
 * all three back on any failure; that a manual coach's identity really
 * survives only while its override is active; that linkage really resolves
 * through `external_identities`, never by name; and that an assignment
 * really lands in `match_coaches` with `source_id = manual_admin_edit`.
 *
 * The pure half -- `entity_key` shapes and form parsing -- is
 * `tests/admin-coach-actions.test.ts`, which needs no database. Reload/
 * replay behaviour for the `coaches` and `match_coaches` override branches is
 * Stage 1's `tests/coach-reconciliation.test.ts` and is not re-proved here.
 *
 * FIXTURES: created and cleaned up per-suite under a `AFLDB-ISSUE-159-TEST-`
 * marker; no real coach, player or match row is written to.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  clearCoachAssignment,
  createCoach,
  getCoachAdminDetail,
  linkCoachToPlayer,
  listClubSeasonMatches,
  readCoachOverrides,
  retireCoachOverride,
  saveCoachMetadata,
  setCoachAssignment,
  unlinkCoach,
} from '@/db/queries/admin-coaches';

// createCoach / saveCoachMetadata / etc. open their own short-lived
// connection from AFLDB_IMPORT_DATABASE_URL, read at call time; point it at
// the test database.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const admin = postgres(testDbUrl, { max: 1 });

const MARKER = 'AFLDB-ISSUE-159-TEST';
/** A reserved season above every real one, matching brownlow's own fixture convention. */
const FIXTURE_SEASON = 2091;

let actorId = 0;
let createdThrowawayAdmin = false;
let sourcedCoachId = 0;
let sourcedCoachPath = '';
let fixturePlayerId = 0;
let fixtureMatchId = 0;
let fixtureHomeClubId = 0;
let fixtureAwayClubId = 0;

beforeAll(async () => {
  const [existingAdmin] = await sql<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1
  `;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-159-coach-test@example.test', 'super_admin')
      RETURNING id
    `;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  // A throwaway "sourced" coach, standing in for an AFL Tables coach without
  // running the real importer -- the identity namespace is all that matters
  // to the code under test.
  sourcedCoachPath = `coaches/${MARKER}-Sourced0.html`;
  const [sourced] = await admin<{ id: number }[]>`
    INSERT INTO coaches (afltables_coach_path, name_key, display_name, source_id, source_record_id)
    VALUES (${sourcedCoachPath}, ${`${MARKER}, Sourced`}, 'Sourced Test Coach',
            (SELECT id FROM sources WHERE key = 'afltables'), ${MARKER})
    RETURNING id
  `;
  sourcedCoachId = sourced.id;

  // A throwaway player with a unique AFL Tables profile identity, for the
  // linkage tests -- §4.3 resolves through external_identities, never a name.
  // players.slug is NOT NULL (migration 002:125) but not globally UNIQUE --
  // the id after it in the URL is authoritative, exactly as coachSlug()'s
  // own doc comment says of coaches -- so a marker-derived literal, not a
  // random one, is both sufficient and deterministic across repeated runs.
  const fixturePlayerSlug = `${MARKER.toLowerCase()}-player`;
  const [player] = await admin<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${`${MARKER} Player`}, afldb_normalise_name(${`${MARKER} Player`}), ${`${MARKER} Player`}, ${fixturePlayerSlug})
    RETURNING id
  `;
  fixturePlayerId = player.id;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status)
    VALUES ((SELECT id FROM sources WHERE key = 'afltables'), ${`players/T/${MARKER}.html`}, ${fixturePlayerId}, 'unique')
  `;

  // A throwaway match, for the assignment tests. A reserved season above
  // every real one, matching the brownlow fixture's own convention
  // (tests/integration/brownlow-fixture.ts: 2084-2089) but a distinct value.
  await admin`
    INSERT INTO seasons (year, league)
    VALUES (${FIXTURE_SEASON}, 'AFL')
    ON CONFLICT (year) DO NOTHING
  `;
  const [home, away] = await admin<{ id: number }[]>`SELECT id FROM clubs ORDER BY id LIMIT 2`;
  fixtureHomeClubId = home.id;
  fixtureAwayClubId = away.id;
  const [match] = await admin<{ id: number }[]>`
    INSERT INTO matches (
      match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
      home_club_id, away_club_id, home_score, away_score, result, margin, attendance_status
    )
    VALUES (
      ${`${FIXTURE_SEASON}|1|${FIXTURE_SEASON}-01-01|${MARKER}-home|${MARKER}-away`}, ${FIXTURE_SEASON}, '1', 1,
      'home_and_away', false, ${`${FIXTURE_SEASON}-01-01`}, 'Test Venue',
      ${fixtureHomeClubId}, ${fixtureAwayClubId}, 60, 30, 'home_win', 30, 'not_collected'::coverage_status
    )
    RETURNING id
  `;
  fixtureMatchId = match.id;
});

afterAll(async () => {
  // A manually created coach's afltables_coach_path is 'manual:<uuid>' --
  // NEVER the marker -- so the coach-identifying condition here is on
  // display_name (every fixture coach, sourced or manual, carries it) OR
  // path, not path alone.
  const coachCond = admin`(display_name LIKE ${`%${MARKER}%`} OR afltables_coach_path LIKE ${`%${MARKER}%`})`;

  await admin`DELETE FROM data_edits WHERE table_name = 'matches' AND row_id = ${fixtureMatchId}`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_key LIKE ${`%${MARKER}%`}
        OR entity_key IN (
          SELECT CASE WHEN afltables_coach_path LIKE 'manual:%'
                      THEN 'manual_admin_edit:' || substring(afltables_coach_path FROM 8)
                      ELSE 'afltables:' || afltables_coach_path END
            FROM coaches WHERE ${coachCond}
        )
  `;
  await admin`DELETE FROM match_coaches WHERE match_id = ${fixtureMatchId}`;
  await admin`DELETE FROM matches WHERE id = ${fixtureMatchId}`;
  await admin`DELETE FROM seasons WHERE year = ${FIXTURE_SEASON}`;
  await admin`DELETE FROM data_edits WHERE table_name = 'coaches' AND row_id IN (
    SELECT id FROM coaches WHERE ${coachCond}
  )`;
  await admin`DELETE FROM coaches WHERE ${coachCond}`;
  await admin`DELETE FROM external_identities WHERE player_id = ${fixturePlayerId}`;
  await admin`DELETE FROM players WHERE id = ${fixturePlayerId}`;
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;
  await admin.end({ timeout: 5 });
});

describe('createCoach', () => {
  it('creates a manual coach row, its identity override, and its audit row in one transaction', async () => {
    const result = await createCoach({
      displayName: `${MARKER} Manual Coach`,
      givenName: 'Manual', surname: 'Coach', dob: '1950-01-01', notes: null,
      adminUserId: actorId, note: 'fixture',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = await getCoachAdminDetail(result.coachId);
    expect(detail?.provenance).toBe('manual');
    expect(detail?.afltablesCoachPath.startsWith('manual:')).toBe(true);
    expect(detail?.displayName).toBe(`${MARKER} Manual Coach`);

    const overrides = await readCoachOverrides(detail!.afltablesCoachPath);
    const identity = overrides.find((o) => o.fieldGroup === 'identity');
    expect(identity?.isActive).toBe(true);
    expect(identity?.overrideValues.display_name).toBe(`${MARKER} Manual Coach`);

    const [edit] = await sql<{ fieldGroup: string }[]>`
      SELECT field_group AS "fieldGroup" FROM data_edits
       WHERE table_name = 'coaches' AND row_id = ${result.coachId}
    `;
    expect(edit?.fieldGroup).toBe('identity');
  });

  it('refuses a duplicate name with the same or unrecorded date of birth', async () => {
    const first = await createCoach({
      displayName: `${MARKER} Dup Coach`, givenName: null, surname: null, dob: null, notes: null,
      adminUserId: actorId,
    });
    expect(first.ok).toBe(true);

    const second = await createCoach({
      displayName: `${MARKER} Dup Coach`, givenName: null, surname: null, dob: null, notes: null,
      adminUserId: actorId,
    });
    expect(second.ok).toBe(false);
    if (second.ok || 'needsConfirmation' in second) return;
    expect(second.error).toContain('already exists');
  });

  it('asks for confirmation, then proceeds, when the name matches but the dob differs', async () => {
    await createCoach({
      displayName: `${MARKER} Confirm Coach`, givenName: null, surname: null, dob: '1960-06-06', notes: null,
      adminUserId: actorId,
    });

    const proposed = await createCoach({
      displayName: `${MARKER} Confirm Coach`, givenName: null, surname: null, dob: '1970-07-07', notes: null,
      adminUserId: actorId,
    });
    expect('needsConfirmation' in proposed && proposed.needsConfirmation).toBe(true);

    const confirmed = await createCoach({
      displayName: `${MARKER} Confirm Coach`, givenName: null, surname: null, dob: '1970-07-07', notes: null,
      adminUserId: actorId, confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
  });

  it('rolls the canonical row back when the audit/override companion write cannot commit', async () => {
    const before = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM coaches WHERE afltables_coach_path LIKE ${`%${MARKER}-Atomic%`}
    `;
    // A nonexistent admin_user_id fails data_overrides' FK to auth_users
    // inside the same transaction as the canonical INSERT -- the same
    // "nothing commits without its audit companion" property a broken
    // recordDataEdit() would prove, reached without needing a seam into
    // the audit helper itself.
    const result = await createCoach({
      displayName: `${MARKER}-Atomic Coach`, givenName: null, surname: null, dob: null, notes: null,
      adminUserId: 999_999_999,
    });
    expect(result.ok).toBe(false);

    const after = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM coaches WHERE afltables_coach_path LIKE ${`%${MARKER}-Atomic%`}
    `;
    expect(after[0].count).toBe(before[0].count);
  });
});

describe('saveCoachMetadata', () => {
  it('updates the canonical row and merges an override on the sourced coach without touching identity columns', async () => {
    const result = await saveCoachMetadata({
      coachId: sourcedCoachId,
      displayName: 'Sourced Test Coach (edited)',
      givenName: 'Sourced', surname: 'Edited', dob: null, notes: 'edited by test',
      adminUserId: actorId,
    });
    expect(result.ok).toBe(true);

    const detail = await getCoachAdminDetail(sourcedCoachId);
    expect(detail?.displayName).toBe('Sourced Test Coach (edited)');
    // Identity is never touched by a metadata edit.
    expect(detail?.afltablesCoachPath).toBe(sourcedCoachPath);

    const overrides = await readCoachOverrides(sourcedCoachPath);
    const identity = overrides.find((o) => o.fieldGroup === 'identity' && o.isActive);
    expect(identity?.overrideValues.display_name).toBe('Sourced Test Coach (edited)');
  });
});

describe('linkCoachToPlayer / unlinkCoach', () => {
  it('links through external_identities, stores the profile path in the override, and unlinks cleanly', async () => {
    const linked = await linkCoachToPlayer({ coachId: sourcedCoachId, playerId: fixturePlayerId, adminUserId: actorId });
    expect(linked.ok).toBe(true);

    const afterLink = await getCoachAdminDetail(sourcedCoachId);
    expect(afterLink?.playerId).toBe(fixturePlayerId);
    expect(afterLink?.linkStatusValue).toBe('unique');
    expect(afterLink?.afltablesProfilePath).toBe(`players/T/${MARKER}.html`);

    const overrides = await readCoachOverrides(sourcedCoachPath);
    const linkage = overrides.find((o) => o.fieldGroup === 'linkage' && o.isActive);
    expect(linkage?.overrideValues.player_id_identity).toBe(`players/T/${MARKER}.html`);

    const alreadyLinked = await linkCoachToPlayer({ coachId: sourcedCoachId, playerId: fixturePlayerId, adminUserId: actorId });
    expect(alreadyLinked.ok).toBe(false);

    const unlinked = await unlinkCoach({ coachId: sourcedCoachId, adminUserId: actorId });
    expect(unlinked.ok).toBe(true);
    const afterUnlink = await getCoachAdminDetail(sourcedCoachId);
    expect(afterUnlink?.playerId).toBeNull();
    expect(afterUnlink?.linkStatusValue).toBe('unmatched');
  });
});

describe('setCoachAssignment / clearCoachAssignment', () => {
  it('writes match_coaches with the manual source and refuses a club that did not play in the match', async () => {
    const refused = await setCoachAssignment({
      assignments: [{ matchId: fixtureMatchId, clubId: 999_999 }],
      coachId: sourcedCoachId, adminUserId: actorId,
    });
    expect(refused.ok).toBe(false);

    const set = await setCoachAssignment({
      assignments: [{ matchId: fixtureMatchId, clubId: fixtureHomeClubId }],
      coachId: sourcedCoachId, adminUserId: actorId,
    });
    expect(set.ok).toBe(true);

    const rows = await listClubSeasonMatches(fixtureHomeClubId, FIXTURE_SEASON);
    const row = rows.find((r) => r.matchId === fixtureMatchId);
    expect(row?.currentCoachId).toBe(sourcedCoachId);
    expect(row?.currentSourceKey).toBe('manual_admin_edit');

    const [edit] = await sql<{ fieldGroup: string; newValues: Record<string, unknown> }[]>`
      SELECT field_group AS "fieldGroup", new_values AS "newValues" FROM data_edits
       WHERE table_name = 'matches' AND row_id = ${fixtureMatchId}
       ORDER BY id DESC LIMIT 1
    `;
    expect(edit?.fieldGroup).toBe('coach_assignment');
    expect(edit?.newValues.source).toBe('manual_admin_edit');

    const cleared = await clearCoachAssignment({ matchId: fixtureMatchId, clubId: fixtureHomeClubId, adminUserId: actorId });
    expect(cleared.ok).toBe(true);
    // Clearing retires the override; it does not revert match_coaches itself
    // (§6.2 -- there is no source-of-truth to revert to without a reload).
    const stillAssigned = await listClubSeasonMatches(fixtureHomeClubId, FIXTURE_SEASON);
    expect(stillAssigned.find((r) => r.matchId === fixtureMatchId)?.currentCoachId).toBe(sourcedCoachId);
  });
});

describe('retireCoachOverride', () => {
  it('retires a manual coach\'s identity override -- the documented reversibility mechanism (§1.4)', async () => {
    const created = await createCoach({
      displayName: `${MARKER} Retirable Coach`, givenName: null, surname: null, dob: null, notes: null,
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const retired = await retireCoachOverride({ coachId: created.coachId, fieldGroup: 'identity', adminUserId: actorId });
    expect(retired.ok).toBe(true);

    const detail = await getCoachAdminDetail(created.coachId);
    const overrides = await readCoachOverrides(detail!.afltablesCoachPath);
    expect(overrides.find((o) => o.fieldGroup === 'identity')?.isActive).toBe(false);
  });
});
