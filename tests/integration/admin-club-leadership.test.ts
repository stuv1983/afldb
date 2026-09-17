/**
 * Club leadership administration against a real PostgreSQL (AFLDB-ISSUE-163
 * Stage 1).
 *
 * These are the claims that can be proved nowhere else: that migration 098's
 * CHECKs and its partial unique index really hold; that a mutation writes the
 * canonical row, the `data_overrides` durable record and the `data_edits` audit
 * row TOGETHER and rolls all three back on any failure; that the REAL
 * `replay_admin_overrides('club_leadership')` out of `tools/migration/common.py`
 * — which is what a promotion and a destructive reload run — re-creates active,
 * ended AND void appointments, is idempotent, and fails closed on an identity
 * it cannot resolve; that a season-list removal AFTER an appointment leaves the
 * appointment standing while AFLDB-ISSUE-161's own contract is untouched; and
 * that the public season boundary really answers each season from exactly one
 * source.
 *
 * FIXTURES: every row is created under an `AFLDB-ISSUE-163-TEST` marker in the
 * two seasons after the register's last (`max(seasons.year) + 1` and `+ 2`), in
 * which no real row of any kind exists, and removed in `afterAll`. No real
 * player, club, membership, captaincy or season row is written to, and NO
 * `seasons`, `clubs` or `club_seasons` row is created at all: the second
 * administrable season comes from the season-list module's documented test-only
 * ceiling, which cannot lower `FIRST_LIST_SEASON` and is inert outside
 * `NODE_ENV=test`.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  FIRST_LEADERSHIP_SEASON,
  appointLeader,
  clubPublicPaths,
  correctAppointment,
  endAppointment,
  leadershipEntityKey,
  readClubSeasonLeadership,
  readLeadershipDiagnostics,
  readLeadershipOverrides,
  readLeadershipOverview,
  reinstateAppointment,
  replaceLeader,
  voidAppointment,
} from '@/db/queries/admin-club-leadership';
import {
  addSeasonListMember,
  eligibleClubsForSeason,
  readClubSeasonList,
  removeSeasonListMember,
} from '@/db/queries/admin-season-lists';
import { getClubCaptains, getPlayerHonours } from '@/db/queries/awards';
import { getClubCurrentLeadership } from '@/db/queries/club-leadership';

/*
 * TEST DATABASE SAFETY. tests/setup.ts redirects DATABASE_URL to afldb_test and
 * refuses anything not ending in `_test`. It does NOT touch
 * AFLDB_IMPORT_DATABASE_URL, and the repository .env points that at afldb_dev —
 * so without this redirect every mutation here would land in afldb_dev.
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const admin = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const MARKER = 'AFLDB-ISSUE-163-TEST';
const AUDIT_FAIL_NOTE = 'AFLDB-ISSUE-163-GATE-FORCE-FAIL';
const OVERRIDE_FAIL_NOTE = 'AFLDB-ISSUE-163-OVERRIDE-FORCE-FAIL';

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
let seasonA = 0;
let seasonB = 0;
let clubA = { id: 0, slug: '', name: '', organizationId: 0 };
let clubB = { id: 0, slug: '', name: '', organizationId: 0 };

const createdPlayerIds = new Set<number>();
/** Listed at clubA in seasonA, with a durable AFL Tables identity. */
let captainId = 0;
let captainIdentity = '';
let viceOneId = 0;
let viceTwoId = 0;
let coCaptainId = 0;
let successorId = 0;
/** Listed at clubB in seasonA — appointable there, never at clubA. */
let otherClubPlayerId = 0;
/** Listed at clubA, but holding NO durable identity. */
let identitylessId = 0;
/** Listed at clubA, holding TWO AFL Tables profile identities. */
let ambiguousId = 0;
/** Not listed anywhere. */
let unlistedId = 0;

async function createPlayer(name: string): Promise<number> {
  const [row] = await admin<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${name}, afldb_normalise_name(${name}), ${name},
            ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')})
    RETURNING id`;
  createdPlayerIds.add(row.id);
  return row.id;
}

async function attachAflIdentity(playerId: number, suffix: string): Promise<string> {
  const path = `players/T/${MARKER}${suffix}.html`;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
            ${path}, ${playerId}, 'unique', 'afltables_profile_url')`;
  return `afltables:${path}`;
}

async function listAt(playerId: number, club: { slug: string }, season = seasonA): Promise<void> {
  const added = await addSeasonListMember({
    season, clubSlug: club.slug, playerId, adminUserId: actorId,
  });
  expect(added.ok, JSON.stringify(added)).toBe(true);
}

/** A player created, identified and listed at one club in one call. */
async function seedListedPlayer(
  suffix: string, club: { slug: string }, season = seasonA,
): Promise<{ id: number; identity: string }> {
  const id = await createPlayer(`${MARKER} ${suffix}`);
  const identity = await attachAflIdentity(id, suffix.replace(/[^A-Za-z0-9]/g, ''));
  await listAt(id, club, season);
  return { id, identity };
}

async function appointmentRow(appointmentKey: string) {
  const [row] = await admin<{
    id: number; season: number; clubId: number; playerId: number; role: string;
    status: string; statusReason: string | null; startedOn: string | null;
    endedOn: string | null; note: string | null; sourceRecordId: string;
  }[]>`
    SELECT id::int AS id, season::int AS season, club_id AS "clubId", player_id AS "playerId",
           role, status, status_reason AS "statusReason", started_on::text AS "startedOn",
           ended_on::text AS "endedOn", note, source_record_id AS "sourceRecordId"
      FROM club_leadership WHERE appointment_key = ${appointmentKey}`;
  return row ?? null;
}

async function auditRows(appointmentId: number) {
  return admin<{
    fieldGroup: string; newValues: Record<string, unknown>; oldValues: Record<string, unknown>;
  }[]>`
    SELECT field_group AS "fieldGroup", new_values AS "newValues", old_values AS "oldValues"
      FROM data_edits
     WHERE table_name = 'club_leadership' AND row_id = ${appointmentId}
     ORDER BY id`;
}

async function currentUpdatedAt(appointmentKey: string): Promise<string> {
  const [row] = await admin<{ updatedAt: string }[]>`
    SELECT updated_at::text AS "updatedAt" FROM club_leadership
     WHERE appointment_key = ${appointmentKey}`;
  return row.updatedAt;
}

/** Every row this suite could have written, in both fixture seasons. */
async function clearFixtureRows(): Promise<void> {
  await admin`
    DELETE FROM data_edits
     WHERE table_name = 'club_leadership'
       AND (new_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'club_leadership'
       AND (override_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM club_leadership WHERE season IN (${seasonA}, ${seasonB})`;
  await admin`
    DELETE FROM data_edits
     WHERE table_name = 'players'
       AND field_group IN ('season_list_added', 'season_list_removed')
       AND (new_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'season_list_members'
       AND (override_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})`;
}

beforeAll(async () => {
  const [bound] = await sql<{ maxYear: number }[]>`SELECT max(year)::int AS "maxYear" FROM seasons`;
  maxYear = bound.maxYear;
  seasonA = maxYear + 1;
  seasonB = maxYear + 2;

  // The season-list module's documented test-only ceiling — leadership reads
  // the SAME bounds function, which is the point of sharing it (§10). It raises
  // the ceiling only; FIRST_LIST_SEASON is untouched.
  process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = String(seasonA);

  const [existingAdmin] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await admin<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-163-leadership-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  const eligible = await eligibleClubsForSeason(seasonA);
  expect(eligible.length, 'need eligible clubs for the first leadership season').toBeGreaterThan(1);
  clubA = eligible[0];
  clubB = eligible[1];

  // Debris from a crashed earlier run would be REPLAYED by this one, so the
  // suite clears its own seasons before it starts rather than assuming the last
  // run exited cleanly.
  await clearFixtureRows();

  const captain = await seedListedPlayer('Captain One', clubA);
  captainId = captain.id;
  captainIdentity = captain.identity;
  viceOneId = (await seedListedPlayer('Vice One', clubA)).id;
  viceTwoId = (await seedListedPlayer('Vice Two', clubA)).id;
  coCaptainId = (await seedListedPlayer('Co Captain', clubA)).id;
  successorId = (await seedListedPlayer('Successor', clubA)).id;
  otherClubPlayerId = (await seedListedPlayer('Other Club', clubB)).id;

  identitylessId = await createPlayer(`${MARKER} No Identity`);
  // Listed through a direct write: the AFLDB-ISSUE-161 action refuses an
  // identity-less player, and the point of this fixture is to prove the
  // LEADERSHIP writer refuses one too rather than relying on that.
  await admin`
    INSERT INTO season_list_members (season, club_id, player_id, source_id, origin)
    VALUES (${seasonA}::smallint, ${clubA.id}, ${identitylessId},
            (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'added')`;

  ambiguousId = await createPlayer(`${MARKER} Two Identities`);
  for (const n of [1, 2]) {
    await admin`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
              ${`players/T/${MARKER}Ambiguous${n}.html`}, ${ambiguousId},
              'unique', 'afltables_profile_url')`;
  }
  await admin`
    INSERT INTO season_list_members (season, club_id, player_id, source_id, origin)
    VALUES (${seasonA}::smallint, ${clubA.id}, ${ambiguousId},
            (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'added')`;

  unlistedId = await createPlayer(`${MARKER} Unlisted`);
  await attachAflIdentity(unlistedId, 'Unlisted');

  // Two suite-scoped failure seams, one per table a mutation writes besides the
  // canonical row. Every mutation takes an optional `note` that flows into
  // recordDataEdit() and the override payload and nowhere else, so this
  // exercises a seam the production code already exposes.
  await admin`
    CREATE OR REPLACE FUNCTION issue163_test_force_data_edits_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.note = 'AFLDB-ISSUE-163-GATE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-163: forced data_edits failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue163_test_force_data_edits_failure_trg ON data_edits`;
  await admin`
    CREATE TRIGGER issue163_test_force_data_edits_failure_trg
      BEFORE INSERT ON data_edits
      FOR EACH ROW EXECUTE FUNCTION issue163_test_force_data_edits_failure()`;

  await admin`
    CREATE OR REPLACE FUNCTION issue163_test_force_overrides_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_type = 'club_leadership'
         AND NEW.override_values->>'note' = 'AFLDB-ISSUE-163-OVERRIDE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-163: forced data_overrides failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue163_test_force_overrides_failure_trg ON data_overrides`;
  await admin`
    CREATE TRIGGER issue163_test_force_overrides_failure_trg
      BEFORE INSERT OR UPDATE ON data_overrides
      FOR EACH ROW EXECUTE FUNCTION issue163_test_force_overrides_failure()`;
});

afterAll(async () => {
  await admin`DROP TRIGGER IF EXISTS issue163_test_force_data_edits_failure_trg ON data_edits`;
  await admin`DROP FUNCTION IF EXISTS issue163_test_force_data_edits_failure()`;
  await admin`DROP TRIGGER IF EXISTS issue163_test_force_overrides_failure_trg ON data_overrides`;
  await admin`DROP FUNCTION IF EXISTS issue163_test_force_overrides_failure()`;

  const ids = [...createdPlayerIds];
  // A durable record OUTLIVES the rows it describes — that is the point of it —
  // so the teardown reads the PAYLOAD, not the canonical row. An orphan left
  // behind would be replayed by the next run.
  await clearFixtureRows();
  await admin`DELETE FROM club_leadership WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM season_list_members WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ANY(${ids}::bigint[])`;
  await admin`DELETE FROM external_identities WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM players WHERE id = ANY(${ids}::int[])`;
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;

  delete process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON;
  await admin.end({ timeout: 5 });
  await sql.end({ timeout: 5 });
});

/** Clear every appointment between tests so each starts from a known state. */
async function resetAppointments(): Promise<void> {
  await admin`
    DELETE FROM data_edits
     WHERE table_name = 'club_leadership'
       AND (new_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'club_leadership'
       AND (override_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM club_leadership WHERE season IN (${seasonA}, ${seasonB})`;
}

// -------------------------------------------------------------------------

describe('the future-season boundary (§10, W-3)', () => {
  it('administers leadership for a season with no seasons, club_seasons or matches row', async () => {
    const [counts] = await sql<{ seasons: number; clubSeasons: number; matches: number }[]>`
      SELECT (SELECT count(*)::int FROM seasons WHERE year = ${seasonA}) AS seasons,
             (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonA}) AS "clubSeasons",
             (SELECT count(*)::int FROM matches WHERE season = ${seasonA}) AS matches`;
    expect(counts.seasons).toBe(0);
    expect(counts.clubSeasons).toBe(0);
    expect(counts.matches).toBe(0);

    await resetAppointments();
    const result = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    // And it created none of them on the way.
    const [after] = await sql<{ seasons: number; clubSeasons: number }[]>`
      SELECT (SELECT count(*)::int FROM seasons WHERE year = ${seasonA}) AS seasons,
             (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonA}) AS "clubSeasons"`;
    expect(after.seasons).toBe(0);
    expect(after.clubSeasons).toBe(0);
  });

  it('refuses a season below the first leadership season and above the window', async () => {
    expect(FIRST_LEADERSHIP_SEASON).toBe(2027);
    const early = await appointLeader({
      season: FIRST_LEADERSHIP_SEASON - 1, clubSlug: clubA.slug, playerId: captainId,
      role: 'captain', adminUserId: actorId,
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toBe('validation');

    const late = await appointLeader({
      season: seasonB + 1, clubSlug: clubA.slug, playerId: captainId,
      role: 'captain', adminUserId: actorId,
    });
    expect(late.ok).toBe(false);
  });
});

describe('schema invariants (migration 098)', () => {
  const insert = (values: string) => admin.unsafe(
    `INSERT INTO club_leadership
       (appointment_key, season, club_id, player_id, role, status, status_reason,
        started_on, ended_on, source_id, source_record_id)
     VALUES (${values})`,
  );

  const base = (key: string, over: Partial<{
    role: string; status: string; reason: string; started: string; ended: string;
  }> = {}) => `'${key}', ${seasonA}, ${clubA.id}, ${captainId}, '${over.role ?? 'captain'}',`
    + ` '${over.status ?? 'active'}', ${over.reason ? `'${over.reason}'` : 'NULL'},`
    + ` ${over.started ? `'${over.started}'` : 'NULL'}, ${over.ended ? `'${over.ended}'` : 'NULL'},`
    + ` (SELECT id FROM sources WHERE key = 'manual_admin_edit'), '${key}'`;

  beforeAll(resetAppointments);

  it('refuses a role outside the vocabulary — co_captain is not a role', async () => {
    await expect(insert(base('ck-role-1', { role: 'co_captain' })))
      .rejects.toThrow(/club_leadership_role_check|violates check constraint/i);
    await expect(insert(base('ck-role-2', { role: 'Captain' })))
      .rejects.toThrow(/violates check constraint/i);
  });

  it('refuses a status outside the lifecycle', async () => {
    await expect(insert(base('ck-status', { status: 'deleted', reason: 'x' })))
      .rejects.toThrow(/violates check constraint/i);
  });

  it('refuses an interval that ends before it starts', async () => {
    await expect(insert(base('ck-dates', {
      status: 'ended', started: `${seasonA}-06-01`, ended: `${seasonA}-03-01`,
    }))).rejects.toThrow(/club_leadership_dates_ck|violates check constraint/i);
  });

  it('refuses an ACTIVE appointment that carries an end date', async () => {
    await expect(insert(base('ck-active-open', { ended: `${seasonA}-06-01` })))
      .rejects.toThrow(/club_leadership_active_open_ck|violates check constraint/i);
  });

  it('refuses a VOID appointment with no reason', async () => {
    await expect(insert(base('ck-void', { status: 'void' })))
      .rejects.toThrow(/club_leadership_void_reason_ck|violates check constraint/i);
  });

  it('refuses a duplicate appointment_key', async () => {
    await insert(base('ck-unique'));
    await expect(insert(`${base('ck-unique')}`)).rejects.toThrow(/duplicate key|unique/i);
    await admin`DELETE FROM club_leadership WHERE appointment_key = 'ck-unique'`;
  });

  it('permits two ACTIVE captains at one club-season, and refuses one player twice', async () => {
    // Co-captaincy is two DIFFERENT players holding the office. The partial
    // unique index is on (season, player_id), never on (season, club, role).
    await insert(base('ck-co-1'));
    await admin.unsafe(
      `INSERT INTO club_leadership
         (appointment_key, season, club_id, player_id, role, status, source_id, source_record_id)
       VALUES ('ck-co-2', ${seasonA}, ${clubA.id}, ${coCaptainId}, 'captain', 'active',
               (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'ck-co-2')`,
    );
    // The SAME player, active twice in one season, is refused whatever the role
    // or club.
    await expect(admin.unsafe(
      `INSERT INTO club_leadership
         (appointment_key, season, club_id, player_id, role, status, source_id, source_record_id)
       VALUES ('ck-co-3', ${seasonA}, ${clubA.id}, ${captainId}, 'vice_captain', 'active',
               (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'ck-co-3')`,
    )).rejects.toThrow(/ux_club_leadership_active_player|duplicate key/i);

    // But an ENDED row leaves the index, so the same player may be appointed
    // again in the same season as a NEW appointment.
    await admin`
      UPDATE club_leadership SET status = 'ended' WHERE appointment_key = 'ck-co-1'`;
    await admin.unsafe(
      `INSERT INTO club_leadership
         (appointment_key, season, club_id, player_id, role, status, source_id, source_record_id)
       VALUES ('ck-co-4', ${seasonA}, ${clubA.id}, ${captainId}, 'captain', 'active',
               (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'ck-co-4')`,
    );
    await resetAppointments();
  });
});

describe('appointment write invariants (§9, §11)', () => {
  beforeAll(resetAppointments);

  it('appoints a listed player and writes row, override and audit together', async () => {
    await resetAppointments();
    const result = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      startedOn: `${seasonA}-02-14`, note: 'announced at the season launch', adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await appointmentRow(result.appointmentKey);
    expect(row).toMatchObject({
      season: seasonA,
      clubId: clubA.id,
      playerId: captainId,
      role: 'captain',
      status: 'active',
      startedOn: `${seasonA}-02-14`,
      endedOn: null,
      sourceRecordId: result.appointmentKey,
    });

    const [override] = await readLeadershipOverrides(result.appointmentKey);
    expect(override.entityKey).toBe(leadershipEntityKey(result.appointmentKey));
    expect(override.fieldGroup).toBe('appointment');
    expect(override.isActive).toBe(true);
    expect(override.overrideValues).toMatchObject({
      appointment_key: result.appointmentKey,
      club_slug: clubA.slug,
      season: seasonA,
      player_identity: captainIdentity,
      role: 'captain',
      status: 'active',
      started_on: `${seasonA}-02-14`,
      ended_on: null,
    });
    // The durable record names the player by IDENTITY and the club by SLUG —
    // never by an id a promotion renumbers, and never by a display name.
    const [{ displayName }] = await sql<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${captainId}`;
    expect(JSON.stringify(override.overrideValues)).not.toContain(displayName);
    expect(override.overrideValues).not.toHaveProperty('player_id');
    expect(override.overrideValues).not.toHaveProperty('club_id');

    const audits = await auditRows(row!.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].fieldGroup).toBe('leadership_appointed');
    expect(audits[0].newValues).toMatchObject({ appointment_key: result.appointmentKey });

    // The revalidation contract: this club's organisation, and nothing else.
    expect(result.revalidatePaths).toEqual(await clubPublicPaths(sql, clubA.id));
    expect(result.revalidatePaths).toContain(`/clubs/${clubA.slug}`);
    expect(result.revalidatePaths).not.toContain(`/clubs/${clubB.slug}`);
    expect(result.revalidatePaths.every((p) => /^\/clubs\/[a-z0-9-]+$/.test(p))).toBe(true);
  });

  it('refuses a player who is not on the club list, naming where they are', async () => {
    await resetAppointments();
    const wrongClub = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: otherClubPlayerId, role: 'captain',
      adminUserId: actorId,
    });
    expect(wrongClub.ok).toBe(false);
    if (!wrongClub.ok) {
      expect(wrongClub.reason).toBe('not_listed');
      expect(wrongClub.error).toContain(clubB.name);
    }

    const unlisted = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: unlistedId, role: 'captain',
      adminUserId: actorId,
    });
    expect(unlisted.ok).toBe(false);
    if (!unlisted.ok) expect(unlisted.reason).toBe('not_listed');

    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
    expect(n).toBe(0);
  });

  it('refuses an identity-less player and an ambiguous one, before any write', async () => {
    await resetAppointments();
    const none = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: identitylessId, role: 'captain',
      adminUserId: actorId,
    });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('conflict');

    const ambiguous = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: ambiguousId, role: 'captain',
      adminUserId: actorId,
    });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.reason).toBe('ambiguous_identity');

    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
    expect(n).toBe(0);
  });

  it('refuses an ineligible club and an unknown one', async () => {
    const unknown = await appointLeader({
      season: seasonA, clubSlug: 'not-a-club', playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe('validation');
  });

  it('refuses an invalid role and an impossible date', async () => {
    const role = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId,
      role: 'co_captain' as never, adminUserId: actorId,
    });
    expect(role.ok).toBe(false);
    if (!role.ok) expect(role.reason).toBe('validation');

    // 2027-02-30 PARSES with Date.parse (as 2 March) — the calendar check is
    // what refuses it (the AFLDB-ISSUE-162 §37.8 lesson).
    const date = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      startedOn: `${seasonA}-02-30`, adminUserId: actorId,
    });
    expect(date.ok).toBe(false);
    if (!date.ok) expect(date.reason).toBe('invalid_dates');
  });
});

describe('roles, co-captaincy and duplicates (§6, §11, D-6)', () => {
  it('requires confirmation for a second captain, then permits co-captains', async () => {
    await resetAppointments();
    const first = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(first.ok).toBe(true);

    const unconfirmed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: coCaptainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.reason).toBe('co_captaincy_unconfirmed');
      expect(unconfirmed.subjects).toContain(`${MARKER} Captain One`);
    }

    const confirmed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: coCaptainId, role: 'captain',
      confirmCoCaptaincy: true, adminUserId: actorId,
    });
    expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);

    const rows = await readClubSeasonLeadership(seasonA, clubA.slug);
    expect(rows.filter((r) => r.role === 'captain' && r.status === 'active')).toHaveLength(2);
  });

  it('permits several vice-captains with no confirmation at all', async () => {
    await resetAppointments();
    for (const playerId of [viceOneId, viceTwoId]) {
      const result = await appointLeader({
        season: seasonA, clubSlug: clubA.slug, playerId, role: 'vice_captain',
        adminUserId: actorId,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    const rows = await readClubSeasonLeadership(seasonA, clubA.slug);
    expect(rows.filter((r) => r.role === 'vice_captain' && r.status === 'active')).toHaveLength(2);
  });

  it('refuses the same player a second active appointment in one season', async () => {
    await resetAppointments();
    const first = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(first.ok).toBe(true);

    const second = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'vice_captain',
      adminUserId: actorId,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('duplicate_active');
  });
});

describe('lifecycle (§12, L-14)', () => {
  it('ends an appointment, keeps it as history, and refuses a stale edit', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      startedOn: `${seasonA}-02-01`, adminUserId: actorId,
    });
    expect(appointed.ok).toBe(true);
    if (!appointed.ok) return;
    const key = appointed.appointmentKey;

    const stale = await endAppointment({
      appointmentKey: key, expectedUpdatedAt: '1999-01-01 00:00:00+00', adminUserId: actorId,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('stale');

    const ended = await endAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      endedOn: `${seasonA}-07-01`, reason: 'stepped down', adminUserId: actorId,
    });
    expect(ended.ok, JSON.stringify(ended)).toBe(true);

    const row = await appointmentRow(key);
    expect(row).toMatchObject({ status: 'ended', endedOn: `${seasonA}-07-01` });
    // The row is KEPT — the whole point of no DELETE path.
    expect(row).not.toBeNull();
    const [override] = await readLeadershipOverrides(key);
    expect(override.isActive).toBe(true);
    expect(override.overrideValues).toMatchObject({ status: 'ended', ended_on: `${seasonA}-07-01` });
  });

  it('reinstates an ended appointment and clears its end date', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    const key = appointed.appointmentKey;

    await endAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      endedOn: `${seasonA}-07-01`, adminUserId: actorId,
    });
    const reinstated = await reinstateAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key), adminUserId: actorId,
    });
    expect(reinstated.ok, JSON.stringify(reinstated)).toBe(true);
    expect(await appointmentRow(key)).toMatchObject({ status: 'active', endedOn: null });
  });

  it('voids an appointment, keeps the row, and refuses every later transition', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    const key = appointed.appointmentKey;

    const noReason = await voidAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      reason: '   ', adminUserId: actorId,
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.reason).toBe('validation');

    const voided = await voidAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      reason: 'entered against the wrong club', adminUserId: actorId,
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);
    expect(await appointmentRow(key)).toMatchObject({
      status: 'void', statusReason: 'entered against the wrong club',
    });

    // Void is TERMINAL: not endable, not reinstatable, not correctable, not
    // voidable again.
    for (const result of [
      await endAppointment({
        appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key), adminUserId: actorId,
      }),
      await reinstateAppointment({
        appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key), adminUserId: actorId,
      }),
      await correctAppointment({
        appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key), adminUserId: actorId,
      }),
      await voidAppointment({
        appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
        reason: 'again', adminUserId: actorId,
      }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid_transition');
    }

    // A voided appointment leaves the active partial unique index, so the same
    // player may be appointed again.
    const again = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect(again.ok, JSON.stringify(again)).toBe(true);
  });

  it('corrects evidence only, and refuses an end date on an active appointment', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    const key = appointed.appointmentKey;

    const contradiction = await correctAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      endedOn: `${seasonA}-08-01`, adminUserId: actorId,
    });
    expect(contradiction.ok).toBe(false);
    if (!contradiction.ok) expect(contradiction.reason).toBe('invalid_dates');

    const backwards = await correctAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      startedOn: `${seasonA}-08-01`, endedOn: `${seasonA}-03-01`, adminUserId: actorId,
    });
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.reason).toBe('invalid_dates');

    const corrected = await correctAppointment({
      appointmentKey: key, expectedUpdatedAt: await currentUpdatedAt(key),
      startedOn: `${seasonA}-03-15`, appointmentNote: 'date confirmed by the club',
      adminUserId: actorId,
    });
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);

    const row = await appointmentRow(key);
    expect(row).toMatchObject({
      startedOn: `${seasonA}-03-15`, note: 'date confirmed by the club',
      // Role, player, club and season are NOT correctable — they are unchanged.
      role: 'captain', playerId: captainId, clubId: clubA.id, season: seasonA,
    });
  });

  it('leaves NULL dates NULL — an unknown date is never invented', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    expect(await appointmentRow(appointed.appointmentKey))
      .toMatchObject({ startedOn: null, endedOn: null });

    await endAppointment({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      adminUserId: actorId,
    });
    expect(await appointmentRow(appointed.appointmentKey))
      .toMatchObject({ status: 'ended', endedOn: null });
  });
});

describe('mid-season replacement (§12)', () => {
  it('ends the outgoing appointment and creates the incoming one, keeping both', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      startedOn: `${seasonA}-02-01`, adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');

    const replaced = await replaceLeader({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      newPlayerId: successorId,
      effectiveOn: `${seasonA}-06-20`,
      adminUserId: actorId,
    });
    expect(replaced.ok, JSON.stringify(replaced)).toBe(true);
    if (!replaced.ok) return;

    const outgoing = await appointmentRow(appointed.appointmentKey);
    const incoming = await appointmentRow(replaced.appointmentKey);
    expect(outgoing).toMatchObject({
      status: 'ended', endedOn: `${seasonA}-06-20`, playerId: captainId,
    });
    expect(incoming).toMatchObject({
      status: 'active', startedOn: `${seasonA}-06-20`, playerId: successorId, role: 'captain',
    });

    // The two payloads cross-reference each other, and the two audit rows share
    // one replacement_id, so the change reads as one movement.
    const [outgoingOverride] = await readLeadershipOverrides(appointed.appointmentKey);
    const [incomingOverride] = await readLeadershipOverrides(replaced.appointmentKey);
    expect(outgoingOverride.overrideValues)
      .toMatchObject({ replaced_by_appointment_key: replaced.appointmentKey });
    expect(incomingOverride.overrideValues)
      .toMatchObject({ replaces_appointment_key: appointed.appointmentKey });

    const outgoingAudits = await auditRows(outgoing!.id);
    const incomingAudits = await auditRows(incoming!.id);
    expect(outgoingAudits.at(-1)!.newValues.replacement_id).toBe(replaced.replacementId);
    expect(incomingAudits.at(-1)!.newValues.replacement_id).toBe(replaced.replacementId);

    // Only the replacement is current; both are history.
    const current = await getClubCurrentLeadership(clubA.id);
    expect(current!.captains.map((c) => c.playerId)).toEqual([successorId]);
    const rows = await readClubSeasonLeadership(seasonA, clubA.slug);
    expect(rows).toHaveLength(2);
  });

  it('refuses a replacement by a player who is not on the list', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');

    const refused = await replaceLeader({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      newPlayerId: otherClubPlayerId,
      adminUserId: actorId,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('not_listed');

    // Nothing moved: the sitting captain is still active and still alone.
    expect(await appointmentRow(appointed.appointmentKey)).toMatchObject({ status: 'active' });
    expect(await readClubSeasonLeadership(seasonA, clubA.slug)).toHaveLength(1);
  });
});

describe('the transaction contract (§13)', () => {
  it('rolls the canonical row back when the audit write fails', async () => {
    await resetAppointments();
    const result = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      note: AUDIT_FAIL_NOTE, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    const [{ rows, overrides }] = await sql<{ rows: number; overrides: number }[]>`
      SELECT (SELECT count(*)::int FROM club_leadership WHERE season = ${seasonA}) AS rows,
             (SELECT count(*)::int FROM data_overrides
               WHERE entity_type = 'club_leadership'
                 AND (override_values->>'season')::int = ${seasonA}) AS overrides`;
    expect(rows).toBe(0);
    expect(overrides).toBe(0);
  });

  it('rolls the canonical row back when the durable record write fails', async () => {
    await resetAppointments();
    const result = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      note: OVERRIDE_FAIL_NOTE, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
    expect(n).toBe(0);
  });
});

describe('the season-list relation (§9, D-5, R-3/R-4)', () => {
  it('badges an active leader on the list, and warns rather than blocking removal', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');

    const members = await readClubSeasonList(seasonA, clubA.slug);
    const captainMember = members.find((m) => m.playerId === captainId)!;
    expect(captainMember.activeLeadershipRole).toBe('captain');
    expect(members.find((m) => m.playerId === viceOneId)!.activeLeadershipRole).toBeNull();

    // AFLDB-ISSUE-161's removal is UNCHANGED: it still succeeds.
    const removed = await removeSeasonListMember({
      membershipId: captainMember.membershipId,
      expectedUpdatedAt: captainMember.updatedAt,
      adminUserId: actorId,
    });
    expect(removed.ok, JSON.stringify(removed)).toBe(true);

    // And the appointment SURVIVES it — historical validity, not current
    // eligibility. It is reported as a diagnostic, never deleted.
    const row = await appointmentRow(appointed.appointmentKey);
    expect(row).toMatchObject({ status: 'active', playerId: captainId });
    const diagnostics = await readLeadershipDiagnostics(seasonA, clubA.slug);
    expect(diagnostics.map((d) => d.playerId)).toContain(captainId);
    const leadership = await readClubSeasonLeadership(seasonA, clubA.slug);
    expect(leadership.find((l) => l.playerId === captainId)!.listed).toBe(false);
    const overview = (await readLeadershipOverview(seasonA))
      .find((c) => c.clubSlug === clubA.slug)!;
    expect(overview.unlistedActive).toBe(1);

    // Put the membership back for the remaining tests.
    await listAt(captainId, clubA);
  });

  it('never writes a membership of its own', async () => {
    await resetAppointments();
    const before = (await readClubSeasonList(seasonA, clubA.slug)).length;
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    expect((await readClubSeasonList(seasonA, clubA.slug)).length).toBe(before);
  });
});

describe('the public read model (§8, §20)', () => {
  it('reports the active captain, co-captains and vice-captains separately', async () => {
    await resetAppointments();
    expect(await getClubCurrentLeadership(clubA.id)).toBeNull();

    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: coCaptainId, role: 'captain',
      confirmCoCaptaincy: true, adminUserId: actorId,
    });
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceOneId, role: 'vice_captain',
      adminUserId: actorId,
    });
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceTwoId, role: 'vice_captain',
      adminUserId: actorId,
    });

    const current = await getClubCurrentLeadership(clubA.id);
    expect(current!.season).toBe(seasonA);
    expect(current!.captains.map((c) => c.playerId).sort()).toEqual([captainId, coCaptainId].sort());
    expect(current!.viceCaptains.map((c) => c.playerId).sort())
      .toEqual([viceOneId, viceTwoId].sort());
    // Every leader is linkable: player_id is NOT NULL and the slug is joined.
    expect(current!.captains.every((c) => c.playerSlug.length > 0)).toBe(true);
    // Another club's page is unaffected.
    expect(await getClubCurrentLeadership(clubB.id)).toBeNull();
  });

  it('drops ended and void appointments from current leadership', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    await endAppointment({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      adminUserId: actorId,
    });
    // Nothing active in the only season on record: "vacant" and "unknown" are
    // indistinguishable, so the answer is null and the caller omits the block.
    expect(await getClubCurrentLeadership(clubA.id)).toBeNull();

    // A captain ended while vice-captains remain is a TRUE statement with an
    // empty captain list — a different answer from null.
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceOneId, role: 'vice_captain',
      adminUserId: actorId,
    });
    const current = await getClubCurrentLeadership(clubA.id);
    expect(current!.captains).toEqual([]);
    expect(current!.viceCaptains.map((v) => v.playerId)).toEqual([viceOneId]);
  });

  it('answers each season from exactly one source in the captains history', async () => {
    await resetAppointments();
    const before = await getClubCaptains(clubA.id);
    // Every legacy row is below the boundary — the union can never double-count.
    expect(before.every((r) => r.season < FIRST_LEADERSHIP_SEASON)).toBe(true);

    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceOneId, role: 'vice_captain',
      adminUserId: actorId,
    });

    const after = await getClubCaptains(clubA.id);
    const canonical = after.filter((r) => r.season >= FIRST_LEADERSHIP_SEASON);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      season: seasonA, playerId: captainId, role: 'Captain', linkStatus: 'unique',
    });
    // A vice-captain is NOT captaincy history.
    expect(after.some((r) => r.playerId === viceOneId)).toBe(false);
    // The legacy half is untouched, row for row.
    expect(after.filter((r) => r.season < FIRST_LEADERSHIP_SEASON)).toHaveLength(before.length);
    // Canonical ids can never collide with a captaincies id in a React key.
    expect(canonical[0].id).toBeLessThan(0);

    // An ENDED captaincy stays in history; a VOID one never was history.
    await endAppointment({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      endedOn: `${seasonA}-06-01`, adminUserId: actorId,
    });
    const ended = (await getClubCaptains(clubA.id))
      .filter((r) => r.season >= FIRST_LEADERSHIP_SEASON);
    expect(ended).toHaveLength(1);
    expect(ended[0].period).toBe(`to ${seasonA}-06-01`);

    await voidAppointment({
      appointmentKey: appointed.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(appointed.appointmentKey),
      reason: 'never happened', adminUserId: actorId,
    });
    expect((await getClubCaptains(clubA.id))
      .filter((r) => r.season >= FIRST_LEADERSHIP_SEASON)).toHaveLength(0);
  });

  it('gives a player their 2027+ captaincy honour without touching captaincies', async () => {
    await resetAppointments();
    const before = await getPlayerHonours(captainId);
    expect(before.captaincies).toHaveLength(0);

    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceOneId, role: 'vice_captain',
      adminUserId: actorId,
    });

    const after = await getPlayerHonours(captainId);
    expect(after.captaincies).toHaveLength(1);
    expect(after.captaincies[0]).toMatchObject({
      season: seasonA, clubName: clubA.name, clubSlug: clubA.slug, role: 'Captain',
    });
    expect(after.total).toBe(before.total + 1);

    // A vice-captain is never a Captain honour.
    expect((await getPlayerHonours(viceOneId)).captaincies).toHaveLength(0);

    // And no captaincies row was written to make any of that true.
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM captaincies WHERE season >= ${FIRST_LEADERSHIP_SEASON}`;
    expect(n).toBe(0);
  });
});

describe('durability: the real replay (§19)', () => {
  it.runIf(canReplay)('re-creates active, ended and void appointments, and is idempotent', async () => {
    await resetAppointments();

    const active = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      startedOn: `${seasonA}-02-01`, note: 'season launch', adminUserId: actorId,
    });
    const ended = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceOneId, role: 'vice_captain',
      adminUserId: actorId,
    });
    const voided = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: viceTwoId, role: 'vice_captain',
      adminUserId: actorId,
    });
    if (!active.ok || !ended.ok || !voided.ok) throw new Error('setup failed');

    await endAppointment({
      appointmentKey: ended.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(ended.appointmentKey),
      endedOn: `${seasonA}-05-05`, adminUserId: actorId,
    });
    await voidAppointment({
      appointmentKey: voided.appointmentKey,
      expectedUpdatedAt: await currentUpdatedAt(voided.appointmentKey),
      reason: 'duplicate entry', adminUserId: actorId,
    });

    // A destructive reload, simulated exactly: the canonical rows go, the
    // durable records stay. This is the state a promoted or rebuilt database is
    // in before the replay runs.
    await admin`DELETE FROM club_leadership WHERE season = ${seasonA}`;
    expect(await appointmentRow(active.appointmentKey)).toBeNull();

    const first = runReplay('club_leadership');
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.stderr + first.stdout).toContain('REPLAY OK');

    expect(await appointmentRow(active.appointmentKey)).toMatchObject({
      season: seasonA, clubId: clubA.id, playerId: captainId, role: 'captain',
      status: 'active', startedOn: `${seasonA}-02-01`, endedOn: null, note: 'season launch',
    });
    // ENDED and VOID rows are re-created too — not suppressed — or their
    // data_edits rows would become unresolvable at the next lineage remap.
    expect(await appointmentRow(ended.appointmentKey)).toMatchObject({
      status: 'ended', endedOn: `${seasonA}-05-05`, playerId: viceOneId,
    });
    expect(await appointmentRow(voided.appointmentKey)).toMatchObject({
      status: 'void', statusReason: 'duplicate entry',
    });

    // Idempotent: a second run inserts nothing and changes nothing.
    const [{ n: afterFirst }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
    const second = runReplay('club_leadership');
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    const [{ n: afterSecond }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).toBe(3);
  });

  it.runIf(canReplay)('replays without any season-list membership — history outlives the list', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: successorId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');

    // §9, D-5. The membership is a precondition of MAKING the appointment, not
    // a property of a recorded one. With every membership for the season gone,
    // the replay must still re-create the appointment — anything else would
    // destroy valid leadership history whenever a list was corrected, and would
    // make AFLDB-ISSUE-161's removal destructive.
    await admin`DELETE FROM club_leadership WHERE season = ${seasonA}`;
    const memberships = await admin<{ id: number }[]>`
      SELECT id FROM season_list_members WHERE season = ${seasonA}`;
    await admin`DELETE FROM season_list_members WHERE season = ${seasonA}`;

    const replay = runReplay('club_leadership');
    expect(replay.status, `${replay.stdout}\n${replay.stderr}`).toBe(0);
    expect(await appointmentRow(appointed.appointmentKey))
      .toMatchObject({ status: 'active', playerId: successorId });
    expect(memberships.length).toBeGreaterThan(0);

    // Restore the fixture memberships for the rest of the suite.
    for (const playerId of [captainId, viceOneId, viceTwoId, coCaptainId, successorId]) {
      await listAt(playerId, clubA);
    }
    await listAt(otherClubPlayerId, clubB);
  });

  it.runIf(canReplay)('fails the whole batch closed when a payload cannot be resolved', async () => {
    await resetAppointments();
    const good = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!good.ok) throw new Error('setup failed');
    await admin`DELETE FROM club_leadership WHERE season = ${seasonA}`;

    const cases: [string, Record<string, unknown>][] = [
      ['identity resolves to no player', { player_identity: 'afltables:players/T/Nobody0.html' }],
      ['club does not resolve', { club_slug: 'no-such-club-at-all' }],
      ['role is not in the vocabulary', { role: 'co_captain' }],
      ['status is not in the lifecycle', { status: 'deleted' }],
      ['the interval is impossible', {
        status: 'ended', started_on: `${seasonA}-09-01`, ended_on: `${seasonA}-03-01`,
      }],
      ['an active row carries an end date', { ended_on: `${seasonA}-09-01` }],
      ['a void row carries no reason', { status: 'void' }],
      ['the payload key does not match the token', { appointment_key: 'something-else' }],
    ];

    for (const [label, patch] of cases) {
      const badKey = `${MARKER}-bad-${label.replace(/[^a-z]+/gi, '-')}`;
      await admin`
        INSERT INTO data_overrides
              (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
        VALUES ('club_leadership', ${leadershipEntityKey(badKey)}, 'appointment',
                ${admin.json({
                  appointment_key: badKey,
                  club_slug: clubA.slug,
                  season: seasonA,
                  player_identity: captainIdentity,
                  role: 'captain',
                  status: 'active',
                  started_on: null,
                  ended_on: null,
                  ...patch,
                } as never)}, ${actorId}, true)`;

      const replay = runReplay('club_leadership');
      expect(replay.status, `${label}: expected a refusal\n${replay.stdout}`).not.toBe(0);
      expect(`${replay.stdout}${replay.stderr}`, label)
        .toContain('replay_admin_overrides(club_leadership): refusing to commit');
      // NOTHING was written — not even the GOOD override alongside it. A reload
      // honours every human decision or none of them.
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM club_leadership WHERE season = ${seasonA}`;
      expect(n, label).toBe(0);

      await admin`
        DELETE FROM data_overrides
         WHERE entity_type = 'club_leadership' AND entity_key = ${leadershipEntityKey(badKey)}`;
    }

    // With the bad record gone, the same replay succeeds.
    const clean = runReplay('club_leadership');
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);
    expect(await appointmentRow(good.appointmentKey)).toMatchObject({ status: 'active' });
  });

  it.runIf(canReplay)('is unaffected by a display-name change — the payload carries no name', async () => {
    await resetAppointments();
    const appointed = await appointLeader({
      season: seasonA, clubSlug: clubA.slug, playerId: captainId, role: 'captain',
      adminUserId: actorId,
    });
    if (!appointed.ok) throw new Error('setup failed');

    await admin`DELETE FROM club_leadership WHERE season = ${seasonA}`;
    const [original] = await admin<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${captainId}`;
    await admin`
      UPDATE players SET display_name = ${`${MARKER} Renamed Entirely`} WHERE id = ${captainId}`;

    const replay = runReplay('club_leadership');
    expect(replay.status, `${replay.stdout}\n${replay.stderr}`).toBe(0);
    expect(await appointmentRow(appointed.appointmentKey))
      .toMatchObject({ playerId: captainId, status: 'active' });

    await admin`UPDATE players SET display_name = ${original.displayName} WHERE id = ${captainId}`;
  });

  it('cannot represent an identity that resolves to two players', async () => {
    // The replay refuses `identity_matches <> 1`, which covers both zero (proved
    // above) and more than one. More than one is UNREACHABLE while
    // external_identities_uq (source_id, external_id) holds — one source plus
    // one external id is one row, and therefore one player — so this asserts the
    // constraint that makes it so rather than faking a state the database
    // forbids.
    const [row] = await admin<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE conname = 'external_identities_uq'`;
    expect(row.definition).toMatch(/UNIQUE \(source_id, external_id\)/);
  });
});
