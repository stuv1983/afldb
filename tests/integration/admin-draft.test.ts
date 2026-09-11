/**
 * Draft administration against a real PostgreSQL (AFLDB-ISSUE-160 gates 6, 7,
 * 8, 10, 11, 12).
 *
 * These are the claims that can be proved nowhere else: that a mutation really
 * writes the canonical row, the `data_overrides` durable record and the
 * `data_edits` audit row TOGETHER and rolls all three back on any failure; that
 * a manually created player and selection really come back — with the same
 * tokens and without a twin — when the replay runs over a database they have
 * been deleted from, which is what a promotion does to them; that a legacy
 * `source_id IS NULL` row really gains a promotable identity; and that the
 * fitzRoy D-2 guard really refuses.
 *
 * The pure half — the frozen enumeration, the key shapes and the J-rules over a
 * fake transaction — is `tests/admin-draft-actions.test.ts` and is not
 * re-proved here.
 *
 * FIXTURES: everything is created under an `AFLDB-ISSUE-160-TEST` marker in a
 * draft year no real selection uses (max season + 1), and removed in afterAll.
 * No real player, club or selection row is written to.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  adoptLegacyPick,
  attachAflTablesIdentity,
  createManualPick,
  createPlayerAndDraftPick,
  getDraftPickAdminDetail,
  listDraftPicksForAdmin,
  listManualPlayersAwaitingIdentity,
  manualEntityKey,
  type ManualPickFields,
  needsPlayerLinkReview,
  playerLinksHref,
  readActiveDraftOverrideKeys,
  readDraftOverrides,
  retireManualPick,
  retireSourcePickOverride,
  saveManualPick,
  saveSourcePickFields,
  sourcePickEntityKey,
  supersedeManualPickBySourceRow,
} from '@/db/queries/admin-draft';

import { lockDraftTables, unlockDraftTables } from './draft-lock';

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

const MARKER = 'AFLDB-ISSUE-160-TEST';
const GATE8_FAIL_NOTE = 'AFLDB-ISSUE-160-GATE8-FORCE-FAIL';
const SOURCE_URL = `https://www.draftguru.com.au/players/${MARKER.toLowerCase()}/1`;

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
 * reimplementation of the replay in TypeScript would prove only that two
 * pieces of test code agree.
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
let fixtureYear = 0;
let clubSlug = '';
let clubId = 0;
let otherClubSlug = '';
let sourcePickId = 0;
let sourcedPlayerId = 0;
let draftguruSourceId = 0;

/** Every player id this suite created, for a deterministic teardown. */
const createdPlayerIds = new Set<number>();
const createdPickIds = new Set<number>();
const createdPersonIds = new Set<number>();

beforeAll(async () => {
  await lockDraftTables(testDbUrl);

  // Debris from a crashed earlier run would be REPLAYED by this one and would
  // re-create the players it describes, so the suite clears its own marker first
  // rather than assuming the last run exited cleanly.
  await admin`
    DELETE FROM data_overrides
     WHERE entity_key LIKE 'manual_admin_edit:%'
       AND (override_values->>'display_name' LIKE ${`%${MARKER}%`}
            OR override_values->>'player_name_raw' LIKE ${`%${MARKER}%`})`;

  const [existingAdmin] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await admin<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-160-draft-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  // The highest draft year that is BOTH empty of real selections and inside the
  // club-identity coverage, so the fixture can assert on pick-number collisions
  // without touching the real 6,810-row population.
  //
  // The two bounds are not the same number, and that is worth recording: J-8
  // admits up to max(season) + 1, while J-6 requires a club identity active in
  // the year, and `clubs.last_season` is populated (not NULL) on this database.
  // A selection for a draft one season ahead of the club table is therefore
  // refused by J-6 until that table advances -- a real product constraint, not a
  // test artefact.
  const [bound] = await sql<{ maxSeason: number }[]>`SELECT max(season)::int AS "maxSeason" FROM matches`;
  let clubs: { id: number; slug: string }[] = [];
  for (let candidate = bound.maxSeason + 1; candidate > bound.maxSeason - 4; candidate -= 1) {
    const [picks] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM draft_picks WHERE draft_year = ${candidate}`;
    if (picks.n > 0) continue;
    const active = await sql<{ id: number; slug: string }[]>`
      SELECT id, slug FROM clubs
       WHERE afldb_identity_for_season(organization_id, ${candidate}) = id
       ORDER BY id LIMIT 2`;
    if (active.length < 2) continue;
    fixtureYear = candidate;
    clubs = active;
    break;
  }
  expect(fixtureYear, 'need an empty draft year with active club identities').toBeGreaterThan(0);
  expect(clubs.length).toBe(2);
  clubId = clubs[0].id;
  clubSlug = clubs[0].slug;
  otherClubSlug = clubs[1].slug;

  [{ id: draftguruSourceId }] = await sql<{ id: number }[]>`
    SELECT id FROM sources WHERE key = 'draftguru'`;

  // A throwaway "sourced" player with an AFL Tables identity, standing in for a
  // real one -- the identity NAMESPACE is all the code under test cares about.
  const [player] = await admin<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${`${MARKER} Sourced Player`},
            afldb_normalise_name(${`${MARKER} Sourced Player`}),
            ${`${MARKER} Sourced Player`}, ${`${MARKER.toLowerCase()}-sourced-player`})
    RETURNING id`;
  sourcedPlayerId = player.id;
  createdPlayerIds.add(sourcedPlayerId);
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
            ${`players/T/${MARKER}0.html`}, ${sourcedPlayerId}, 'unique', 'afltables_profile_url')`;

  // A throwaway DraftGuru-owned selection, for the 6.1/6.2 correction tests.
  const [pick] = await admin<{ id: number }[]>`
    INSERT INTO draft_picks
      (draft_year, draft_type, draft_kind, pick_number, player_name_raw, player_id,
       link_status_value, club_id, club_name_raw, source_id, source_record_id, player_url)
    VALUES (${fixtureYear}, 'National', 'national', 1, ${`${MARKER} Sourced Player`},
            ${sourcedPlayerId}, 'resolved', ${clubId},
            (SELECT name FROM clubs WHERE id = ${clubId}),
            ${draftguruSourceId}, ${`${MARKER}#0`}, ${SOURCE_URL})
    RETURNING id`;
  sourcePickId = pick.id;
  createdPickIds.add(sourcePickId);

  // Gate 8: two suite-scoped failure seams, one per table the mutations write
  // besides the canonical row. Every §6 function takes an optional `note` that
  // flows into recordDataEdit() and nowhere else, so this exercises a seam the
  // production code already exposes rather than adding one for the test.
  await admin`
    CREATE OR REPLACE FUNCTION issue160_test_force_data_edits_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.note = 'AFLDB-ISSUE-160-GATE8-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-160 gate 8: forced data_edits failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue160_test_force_data_edits_failure_trg ON data_edits`;
  await admin`
    CREATE TRIGGER issue160_test_force_data_edits_failure_trg
      BEFORE INSERT ON data_edits
      FOR EACH ROW EXECUTE FUNCTION issue160_test_force_data_edits_failure()`;

  await admin`
    CREATE OR REPLACE FUNCTION issue160_test_force_overrides_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.override_values->>'pick_note' = 'AFLDB-ISSUE-160-GATE8-FORCE-FAIL'
         OR NEW.override_values->>'notes' = 'AFLDB-ISSUE-160-GATE8-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-160 gate 8: forced data_overrides failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue160_test_force_overrides_failure_trg ON data_overrides`;
  await admin`
    CREATE TRIGGER issue160_test_force_overrides_failure_trg
      BEFORE INSERT OR UPDATE ON data_overrides
      FOR EACH ROW EXECUTE FUNCTION issue160_test_force_overrides_failure()`;
});

afterAll(async () => {
  await admin`DROP TRIGGER IF EXISTS issue160_test_force_data_edits_failure_trg ON data_edits`;
  await admin`DROP FUNCTION IF EXISTS issue160_test_force_data_edits_failure()`;
  await admin`DROP TRIGGER IF EXISTS issue160_test_force_overrides_failure_trg ON data_overrides`;
  await admin`DROP FUNCTION IF EXISTS issue160_test_force_overrides_failure()`;

  // A durable record OUTLIVES the rows it describes -- that is the point of it --
  // so the teardown cannot find override rows by walking from the player or the
  // selection: several tests delete those deliberately, to simulate a promoted
  // candidate. The PAYLOAD carries the marker, so the cleanup reads that. Left
  // behind, an orphan record would be replayed by the next run and would
  // re-create the player it describes.
  await admin`
    DELETE FROM data_overrides
     WHERE entity_key LIKE 'manual_admin_edit:%'
       AND (override_values->>'display_name' LIKE ${`%${MARKER}%`}
            OR override_values->>'player_name_raw' LIKE ${`%${MARKER}%`}
            OR (override_values->>'draft_year')::int = ${fixtureYear})`;

  const tokens = await admin<{ token: string }[]>`
    SELECT source_record_id AS token FROM draft_picks
     WHERE draft_year = ${fixtureYear} AND source_record_id IS NOT NULL
    UNION
    SELECT e.external_id FROM external_identities e
      JOIN sources s ON s.id = e.source_id AND s.key = 'manual_admin_edit'
     WHERE e.player_id = ANY(${[...createdPlayerIds]}::int[])`;
  const keys = tokens.map((t) => manualEntityKey(t.token));

  const playerIds = await admin<{ id: number }[]>`
    SELECT id FROM players WHERE display_name LIKE ${`%${MARKER}%`}`;
  for (const p of playerIds) createdPlayerIds.add(p.id);
  const ids = [...createdPlayerIds];

  await admin`DELETE FROM data_overrides WHERE entity_key = ANY(${keys.length ? keys : ['']}::text[])`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'draft_picks'
       AND entity_key LIKE ${`%|${SOURCE_URL}|%`}`;
  await admin`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ANY(${ids}::bigint[])`;
  await admin`
    DELETE FROM data_edits
     WHERE table_name = 'draft_picks'
       AND row_id IN (SELECT id FROM draft_picks WHERE draft_year = ${fixtureYear})`;
  await admin`DELETE FROM player_link_resolutions WHERE target_table = 'draft_picks'
                AND target_id IN (SELECT id FROM draft_picks WHERE draft_year = ${fixtureYear})`;
  await admin`DELETE FROM draft_picks WHERE draft_year = ${fixtureYear}`;
  await admin`DELETE FROM draft_persons WHERE id = ANY(${[...createdPersonIds]}::int[])`;
  await admin`DELETE FROM external_identities WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM player_career_stats WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM players WHERE id = ANY(${ids}::int[])`;
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;

  await admin.end({ timeout: 5 });
  await unlockDraftTables();
});

function manualFields(overrides: Partial<ManualPickFields> = {}): ManualPickFields {
  return {
    draftYear: fixtureYear,
    draftType: 'National',
    draftKind: 'national',
    pickNumber: 50,
    clubSlug,
    ...overrides,
  };
}

async function overrideRow(entityKey: string, fieldGroup: string) {
  const [row] = await admin<{
    overrideValues: Record<string, unknown>; isActive: boolean; adminUserId: number;
  }[]>`
    SELECT override_values AS "overrideValues", is_active AS "isActive",
           admin_user_id AS "adminUserId"
      FROM data_overrides
     WHERE entity_type = ${fieldGroup === 'identity' ? 'players' : 'draft_picks'}
       AND entity_key = ${entityKey} AND field_group = ${fieldGroup}`;
  return row ?? null;
}

// -------------------------------------------------------------------------
// gate 6 — existing-player creation and the live refusals
// -------------------------------------------------------------------------

describe('createManualPick — an existing player (6.3)', () => {
  it('writes the canonical row, its durable record and its audit in one transaction', async () => {
    const result = await createManualPick({
      // A DIFFERENT kind from the fixture source pick: same player, same year,
      // different kind is J-2, which is legitimate (23 real cases).
      ...manualFields({ pickNumber: 51, draftKind: 'rookie', draftType: 'Rookie' }),
      playerId: sourcedPlayerId, adminUserId: actorId, note: 'fixture',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    createdPickIds.add(result.pickId);

    // The canonical row carries provenance and identity, which is the whole
    // difference from a pre-ISSUE-160 admin row.
    const detail = await getDraftPickAdminDetail(result.pickId);
    expect(detail?.provenance).toBe('manual');
    expect(detail?.playerUrl).toBe(`manual:${result.pickToken}`);
    expect(detail?.linkStatusValue).toBe('resolved');
    expect(detail?.playerId).toBe(sourcedPlayerId);
    expect(detail?.entityKey).toBe(manualEntityKey(result.pickToken));

    // The durable record names the player by IDENTITY and the club by SLUG --
    // never by an id, which a promotion renumbers.
    const record = await overrideRow(manualEntityKey(result.pickToken), 'selection');
    expect(record?.isActive).toBe(true);
    expect(record?.adminUserId).toBe(actorId);
    expect(record?.overrideValues.player_identity).toBe(`afltables:players/T/${MARKER}0.html`);
    expect(record?.overrideValues.club_slug).toBe(clubSlug);
    expect(record?.overrideValues.draft_year).toBe(fixtureYear);
    expect(record?.overrideValues).not.toHaveProperty('player_id');
    expect(record?.overrideValues).not.toHaveProperty('club_id');

    // §9.1: the audit subject is the PLAYER, because a manual selection can be
    // retired by DELETE and an audit row pointing at a deleted draft_picks.id
    // would be unresolvable and would stop a PROD promotion.
    const [audit] = await admin<{ tableName: string; rowId: number; newValues: Record<string, unknown> }[]>`
      SELECT table_name AS "tableName", row_id::int AS "rowId", new_values AS "newValues"
        FROM data_edits
       WHERE table_name = 'players' AND row_id = ${sourcedPlayerId}
         AND field_group = 'draft_selection'
       ORDER BY id DESC LIMIT 1`;
    expect(audit.rowId).toBe(sourcedPlayerId);
    expect(audit.newValues.pick_token).toBe(result.pickToken);
  });

  it('J-1 refuses a second selection in the same year and kind, live', async () => {
    const result = await createManualPick({
      ...manualFields({ pickNumber: 52, draftKind: 'rookie', draftType: 'Rookie' }),
      playerId: sourcedPlayerId, adminUserId: actorId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('J-2 allows the same player in the same year under a different kind, live', async () => {
    const result = await createManualPick({
      ...manualFields({ draftKind: 'trade', draftType: 'Trade', pickNumber: null }),
      playerId: sourcedPlayerId, adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) createdPickIds.add(result.pickId);
  });

  it('J-3 refuses a pick number another selection already holds, live', async () => {
    // The fixture source pick holds pick 1 of this year and kind.
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 1 }),
      player: { displayName: `${MARKER} Pick One Clash`, dob: '2006-02-02' },
      adminUserId: actorId, confirmed: true,
    });
    expect(created).toMatchObject({ ok: false, reason: 'conflict' });
    const [orphans] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players WHERE display_name = ${`${MARKER} Pick One Clash`}`;
    expect(orphans.n, 'a refused creation must leave no player behind').toBe(0);
  });

  it('J-6 refuses a club that was not the identity active in the draft year', async () => {
    // A real historical identity -- one the identity function does NOT return for
    // the fixture year -- read from the data rather than assumed. This is the
    // Fitzroy/Kangaroos case: the row exists, and choosing it for the wrong era
    // would attribute a selection to a club that did not exist then.
    const [historical] = await sql<{ slug: string; name: string }[]>`
      SELECT slug, name FROM clubs
       WHERE afldb_identity_for_season(organization_id, ${fixtureYear}) IS DISTINCT FROM id
       ORDER BY id LIMIT 1`;
    expect(historical, 'need one club identity inactive in the fixture year').toBeDefined();

    const wrongEra = await createManualPick({
      ...manualFields({ clubSlug: historical.slug, pickNumber: 77, draftKind: 'mini_draft', draftType: 'Mini-Draft' }),
      playerId: sourcedPlayerId, adminUserId: actorId,
    });
    expect(wrongEra).toMatchObject({ ok: false, reason: 'validation' });
    expect((wrongEra as { error: string }).error).toContain('historical club identity');

    const unknownClub = await createManualPick({
      ...manualFields({ clubSlug: 'no-such-club-at-all', pickNumber: 78, draftKind: 'mini_draft', draftType: 'Mini-Draft' }),
      playerId: sourcedPlayerId, adminUserId: actorId,
    });
    expect(unknownClub).toMatchObject({ ok: false, reason: 'validation' });
  });
});

// -------------------------------------------------------------------------
// gate 7 — new player through the draft
// -------------------------------------------------------------------------

describe('createPlayerAndDraftPick — a genuinely new person (6.3b)', () => {
  let playerId = 0;
  let playerToken = '';
  let pickId = 0;
  let pickToken = '';

  it('creates one player, one identity, two durable records and two audits', async () => {
    const result = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 60 }),
      player: {
        displayName: `${MARKER} New Draftee`, dob: '2006-07-08',
        heightCm: 188, weightKg: 82,
      },
      adminUserId: actorId, note: 'fixture',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    ({ playerId, playerToken, pickId, pickToken } = result);
    createdPlayerIds.add(playerId);
    createdPickIds.add(pickId);

    const [counts] = await sql<{
      players: number; identities: number; careers: number; picks: number;
    }[]>`
      SELECT (SELECT count(*) FROM players WHERE id = ${playerId})::int AS players,
             (SELECT count(*) FROM external_identities WHERE player_id = ${playerId})::int AS identities,
             (SELECT count(*) FROM player_career_stats WHERE player_id = ${playerId})::int AS careers,
             (SELECT count(*) FROM draft_picks WHERE player_id = ${playerId})::int AS picks`;
    expect(counts).toEqual({ players: 1, identities: 1, careers: 1, picks: 1 });

    // Derived name columns come from SQL, by the same expressions the importer
    // and the replay use -- so a replayed twin is byte-identical.
    const [derived] = await sql<{ searchName: string; slug: string; sortName: string }[]>`
      SELECT search_name AS "searchName", slug, sort_name AS "sortName"
        FROM players WHERE id = ${playerId}`;
    const [expected] = await sql<{ searchName: string; slug: string }[]>`
      SELECT afldb_normalise_name(${`${MARKER} New Draftee`}) AS "searchName",
             regexp_replace(afldb_normalise_name(${`${MARKER} New Draftee`}), '\\s+', '-', 'g') AS slug`;
    expect(derived.searchName).toBe(expected.searchName);
    expect(derived.slug).toBe(expected.slug);
    expect(derived.sortName).toBe('Draftee, AFLDB-ISSUE-160-TEST New');

    // Two durable records, one per entity, each keyed by its OWN token.
    const identity = await overrideRow(manualEntityKey(playerToken), 'identity');
    expect(identity?.overrideValues).toMatchObject({
      display_name: `${MARKER} New Draftee`, dob: '2006-07-08', birth_year: 2006,
      dob_confidence: 'sourced', height_cm: 188, weight_kg: 82,
    });
    const selection = await overrideRow(manualEntityKey(pickToken), 'selection');
    expect(selection?.overrideValues.player_identity).toBe(manualEntityKey(playerToken));
    expect(pickToken).not.toBe(playerToken);

    // Two audits, both against the player.
    const groups = await admin<{ fieldGroup: string }[]>`
      SELECT field_group AS "fieldGroup" FROM data_edits
       WHERE table_name = 'players' AND row_id = ${playerId} ORDER BY id`;
    expect(groups.map((g) => g.fieldGroup)).toEqual(['player_creation', 'draft_selection']);
  });

  it('shows the new player as awaiting an AFL Tables identity', async () => {
    const awaiting = await listManualPlayersAwaitingIdentity();
    const mine = awaiting.find((p) => p.playerId === playerId);
    expect(mine?.token).toBe(playerToken);
    expect(mine?.selections).toBe(1);
  });

  it('lists the selection with its provenance and identity key', async () => {
    const { rows } = await listDraftPicksForAdmin({
      year: fixtureYear, provenance: 'manual', page: 1, pageSize: 50,
    });
    const mine = rows.find((r) => r.id === pickId);
    expect(mine?.provenance).toBe('manual');
    expect(mine?.entityKey).toBe(manualEntityKey(pickToken));
    expect(rows.every((r) => r.provenance === 'manual')).toBe(true);
  });

  it('J-10 refuses a namesake with no distinguishing date of birth, and leaves nothing behind', async () => {
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM players`;
    const result = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 61, draftKind: 'rookie', draftType: 'Rookie' }),
      player: { displayName: `${MARKER} New Draftee` },
      adminUserId: actorId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'duplicate' });
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM players`;
    expect(after[0].n).toBe(before[0].n);
  });

  it('J-12 admits a distinct namesake once the operator confirms it', async () => {
    const unconfirmed = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 62, draftKind: 'rookie', draftType: 'Rookie' }),
      player: { displayName: `${MARKER} New Draftee`, dob: '1988-01-01' },
      adminUserId: actorId,
    });
    expect(unconfirmed).toMatchObject({ ok: false, needsConfirmation: true });

    const confirmed = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 62, draftKind: 'rookie', draftType: 'Rookie' }),
      player: { displayName: `${MARKER} New Draftee`, dob: '1988-01-01' },
      adminUserId: actorId, confirmed: true,
    });
    expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);
    if (!confirmed.ok) return;
    createdPlayerIds.add(confirmed.playerId);
    createdPickIds.add(confirmed.pickId);
    expect(confirmed.playerId).not.toBe(playerId);
  });
});

// -------------------------------------------------------------------------
// gate 6 — 6.8 adoption of a legacy row (D-7)
// -------------------------------------------------------------------------

describe('adoptLegacyPick — the D-7 repair (6.8)', () => {
  async function legacyPick(playerId: number, pickNumber: number): Promise<number> {
    // Exactly what createPlayerInTransaction used to write before ISSUE-160:
    // source_id, source_record_id and player_url all NULL.
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, pick_number, player_name_raw, player_id,
         link_status_value, club_id, club_name_raw)
      VALUES (${fixtureYear}, 'National Draft', ${pickNumber},
              (SELECT display_name FROM players WHERE id = ${playerId}), ${playerId},
              'resolved', ${clubId}, (SELECT name FROM clubs WHERE id = ${clubId}))
      RETURNING id`;
    createdPickIds.add(row.id);
    return row.id;
  }

  async function legacyPlayer(name: string): Promise<number> {
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO players (display_name, search_name, sort_name, slug)
      VALUES (${name}, afldb_normalise_name(${name}), ${name},
              regexp_replace(afldb_normalise_name(${name}), '\\s+', '-', 'g'))
      RETURNING id`;
    createdPlayerIds.add(row.id);
    return row.id;
  }

  it('(i) reuses an AFL Tables identity and mints no player identity', async () => {
    const pickId = await legacyPick(sourcedPlayerId, 101);
    const result = await adoptLegacyPick({
      pickId, draftType: 'Pre-Season', draftKind: 'preseason',
      adminUserId: actorId, note: 'fixture',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(result.mintedPlayerIdentity).toBe(false);
    expect(result.playerIdentity).toBe(`afltables:players/T/${MARKER}0.html`);
    const detail = await getDraftPickAdminDetail(pickId);
    expect(detail?.provenance).toBe('manual');
    expect(detail?.playerUrl).toBe(`manual:${result.pickToken}`);
    expect(detail?.draftKind).toBe('preseason');
    const record = await overrideRow(manualEntityKey(result.pickToken), 'selection');
    expect(record?.overrideValues.player_identity).toBe(`afltables:players/T/${MARKER}0.html`);
    // No identity_adopted audit, because nothing was minted.
    const [adopted] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_edits
       WHERE table_name = 'players' AND row_id = ${sourcedPlayerId}
         AND field_group = 'identity_adopted'`;
    expect(adopted.n).toBe(0);
  });

  it('(ii) reuses an existing manual identity rather than minting a second one', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 110 }),
      player: { displayName: `${MARKER} Manual Adoptee`, dob: '2005-03-03' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const pickId = await legacyPick(created.playerId, 111);
    const result = await adoptLegacyPick({
      pickId, draftType: 'Rookie', draftKind: 'rookie', adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.mintedPlayerIdentity).toBe(false);
    expect(result.playerIdentity).toBe(manualEntityKey(created.playerToken));

    const [identities] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities WHERE player_id = ${created.playerId}`;
    expect(identities.n, 'a second identity must never be minted').toBe(1);
  });

  it('(iii) mints the player identity when the linked player has none', async () => {
    const playerId = await legacyPlayer(`${MARKER} Identityless`);
    // migration 018: a date of birth that is present must say where it came from.
    await admin`
      UPDATE players SET dob = '1999-09-09', dob_confidence = 'sourced', height_cm = 190
       WHERE id = ${playerId}`;
    const pickId = await legacyPick(playerId, 120);

    const result = await adoptLegacyPick({
      pickId, draftType: 'National', draftKind: 'national', adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.mintedPlayerIdentity).toBe(true);

    const token = result.playerIdentity.slice('manual_admin_edit:'.length);
    const [identity] = await sql<{ matchMethod: string; status: string }[]>`
      SELECT e.match_method AS "matchMethod", e.status::text AS status
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE e.player_id = ${playerId} AND s.key = 'manual_admin_edit' AND e.external_id = ${token}`;
    expect(identity).toMatchObject({ matchMethod: 'manual_admin_edit', status: 'resolved' });

    // The player's durable record is the WHOLE current row, so the replay can
    // re-create it -- not a delta, which would replay a half player.
    const record = await overrideRow(manualEntityKey(token), 'identity');
    expect(record?.overrideValues).toMatchObject({
      display_name: `${MARKER} Identityless`, dob: '1999-09-09', height_cm: 190,
    });
    const [audit] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_edits
       WHERE table_name = 'players' AND row_id = ${playerId} AND field_group = 'identity_adopted'`;
    expect(audit.n).toBe(1);
  });

  it('refuses a second adoption of the same row as stale', async () => {
    const playerId = await legacyPlayer(`${MARKER} Adopt Twice`);
    const pickId = await legacyPick(playerId, 130);
    const first = await adoptLegacyPick({
      pickId, draftType: 'Trade', draftKind: 'trade', adminUserId: actorId });
    expect(first.ok).toBe(true);
    const second = await adoptLegacyPick({
      pickId, draftType: 'Trade', draftKind: 'trade', adminUserId: actorId });
    expect(second).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('refuses a NULL-source row with no player link rather than inventing an identity', async () => {
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, pick_number, player_name_raw, link_status_value, club_id)
      VALUES (${fixtureYear}, 'National Draft', 140, ${`${MARKER} Orphan`}, 'unmatched', ${clubId})
      RETURNING id`;
    createdPickIds.add(row.id);
    const result = await adoptLegacyPick({
      pickId: row.id, draftType: 'National', draftKind: 'national', adminUserId: actorId });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
  });
});

// -------------------------------------------------------------------------
// 6.1 / 6.2 / 6.4 / 6.5 / 6.6 / 6.7
// -------------------------------------------------------------------------

describe('source-owned corrections (6.1, 6.2)', () => {
  const entityKey = () => sourcePickEntityKey({
    sourceId: draftguruSourceId, playerUrl: SOURCE_URL,
    draftYear: fixtureYear, draftKind: 'national',
  });

  it('writes a DELTA override and the audit against the selection itself', async () => {
    const result = await saveSourcePickFields({
      pickId: sourcePickId, groupKey: 'player_info',
      raw: { player_name_raw: `${MARKER} Corrected Name`, original_club_raw: 'Murray U18', draft_age: '18' },
      adminUserId: actorId, note: 'fixture',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const record = await overrideRow(entityKey(), 'player_info');
    // Delta only: a field that did not change keeps tracking the source.
    expect(record?.overrideValues).toEqual({
      player_name_raw: `${MARKER} Corrected Name`, original_club_raw: 'Murray U18', draft_age: 18,
    });
    const [audit] = await admin<{ rowId: number; fieldGroup: string }[]>`
      SELECT row_id::int AS "rowId", field_group AS "fieldGroup" FROM data_edits
       WHERE table_name = 'draft_picks' AND row_id = ${sourcePickId}
       ORDER BY id DESC LIMIT 1`;
    expect(audit).toMatchObject({ rowId: sourcePickId, fieldGroup: 'player_info' });
  });

  it('corrects pick number and club through the new selection_facts group', async () => {
    const result = await saveSourcePickFields({
      pickId: sourcePickId, groupKey: 'selection_facts',
      raw: { pick_number: '2', club_slug: otherClubSlug },
      adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const detail = await getDraftPickAdminDetail(sourcePickId);
    expect(detail?.pickNumber).toBe(2);
    expect(detail?.clubSlug).toBe(otherClubSlug);
    const record = await overrideRow(entityKey(), 'selection_facts');
    expect(record?.overrideValues).toEqual({ pick_number: 2, club_slug: otherClubSlug });
  });

  it('refuses to edit a manual selection through the source path', async () => {
    const created = await createManualPick({
      ...manualFields({ draftKind: 'free_agency', draftType: 'Free Agency', pickNumber: null }),
      playerId: sourcedPlayerId, adminUserId: actorId,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    createdPickIds.add(created.pickId);

    const result = await saveSourcePickFields({
      pickId: created.pickId, groupKey: 'player_info',
      raw: { player_name_raw: 'x', original_club_raw: '', draft_age: '' },
      adminUserId: actorId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('retires an override without rewriting the canonical row', async () => {
    const before = await getDraftPickAdminDetail(sourcePickId);
    const result = await retireSourcePickOverride({
      pickId: sourcePickId, groupKey: 'player_info', adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const record = await overrideRow(entityKey(), 'player_info');
    expect(record?.isActive).toBe(false);
    // The canonical value stays as last written; the NEXT reload restores the
    // source, because the replay no longer sees an active override. Re-reading
    // "the source value" here would be a guess this database cannot make.
    const after = await getDraftPickAdminDetail(sourcePickId);
    expect(after?.playerNameRaw).toBe(before?.playerNameRaw);
    expect(await readDraftOverrides(entityKey())).toContainEqual(
      expect.objectContaining({ fieldGroup: 'player_info', isActive: false }));
  });
});

describe('manual selection lifecycle (6.4, 6.5, 6.6, 6.7)', () => {
  it('rewrites the whole durable record on an edit, and audits a relink against both players', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 160 }),
      player: { displayName: `${MARKER} Editable`, dob: '2004-04-04' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const moved = await saveManualPick({
      pickId: created.pickId, playerId: sourcedPlayerId, adminUserId: actorId,
      draftYear: fixtureYear, draftType: 'Mid-Season', draftKind: 'midseason',
      pickNumber: 161, clubSlug: otherClubSlug, detail: 'moved',
    });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    if (!moved.ok) return;
    expect(moved.relinked).toBe(true);

    const record = await overrideRow(manualEntityKey(created.pickToken), 'selection');
    expect(record?.overrideValues).toMatchObject({
      draft_kind: 'midseason', draft_type: 'Mid-Season', pick_number: 161,
      club_slug: otherClubSlug, detail: 'moved',
      player_identity: `afltables:players/T/${MARKER}0.html`,
    });

    const groups = await admin<{ rowId: number; fieldGroup: string }[]>`
      SELECT row_id::int AS "rowId", field_group AS "fieldGroup" FROM data_edits
       WHERE table_name = 'players' AND field_group LIKE 'draft_selection%'
         AND row_id IN (${created.playerId}, ${sourcedPlayerId})
       ORDER BY id DESC LIMIT 2`;
    // One row against the player who LOSES the selection, one against the player
    // who gains it. A single row would erase the first person's history.
    expect(groups.map((g) => `${g.rowId}:${g.fieldGroup}`).sort()).toEqual([
      `${created.playerId}:draft_selection_unlinked`,
      `${sourcedPlayerId}:draft_selection`,
    ].sort());
  });

  it('attaches an AFL Tables identity, and the settle-shaped lookup then finds that player', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 170 }),
      player: { displayName: `${MARKER} Debutant`, dob: '2003-05-05' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const path = `players/D/${MARKER}-Debutant0.html`;
    const attached = await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: path, adminUserId: actorId,
    });
    expect(attached.ok, JSON.stringify(attached)).toBe(true);

    // §8.4: this is what makes the debut safe. The very next settle resolves the
    // profile path to THIS player -- the same registry lookup the settle does.
    const [resolved] = await sql<{ playerId: number }[]>`
      SELECT e.player_id AS "playerId"
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afltables' AND e.match_method = 'afltables_profile_url'
         AND e.status IN ('unique', 'resolved') AND e.external_id = ${path}`;
    expect(resolved.playerId).toBe(created.playerId);

    // The durable record gains the path, so a rebuilt candidate BINDS the token
    // onto the path-player instead of creating a twin (§8.1 step 2).
    const record = await overrideRow(manualEntityKey(created.playerToken), 'identity');
    expect(record?.overrideValues.afltables_profile_path).toBe(path);

    // and the player leaves the D-2 guard's candidate set.
    const awaiting = await listManualPlayersAwaitingIdentity();
    expect(awaiting.some((p) => p.playerId === created.playerId)).toBe(false);

    // J-15: the path now belongs to someone. Attaching it elsewhere is a MERGE.
    const clash = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 171 }),
      player: { displayName: `${MARKER} Other Debutant`, dob: '2003-06-06' },
      adminUserId: actorId,
    });
    expect(clash.ok).toBe(true);
    if (!clash.ok) return;
    createdPlayerIds.add(clash.playerId);
    createdPickIds.add(clash.pickId);
    expect(await attachAflTablesIdentity({
      playerId: clash.playerId, profilePath: path, adminUserId: actorId,
    })).toMatchObject({ ok: false, reason: 'forbidden' });

    // J-16: a tracked, evidence-bound continuity rule is never overridden here.
    expect(await attachAflTablesIdentity({
      playerId: clash.playerId, profilePath: 'players/C/Charlie_Cameron3.html', adminUserId: actorId,
    })).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('retires a manual selection by audited DELETE, keeping the whole row in the audit', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 180 }),
      player: { displayName: `${MARKER} Retiree`, dob: '2002-02-02' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);

    const retired = await retireManualPick({ pickId: created.pickId, adminUserId: actorId });
    expect(retired.ok, JSON.stringify(retired)).toBe(true);

    expect(await getDraftPickAdminDetail(created.pickId)).toBeNull();
    const record = await overrideRow(manualEntityKey(created.pickToken), 'selection');
    expect(record?.isActive).toBe(false);
    const [audit] = await admin<{ oldValues: Record<string, unknown> }[]>`
      SELECT old_values AS "oldValues" FROM data_edits
       WHERE table_name = 'players' AND row_id = ${created.playerId}
         AND field_group = 'draft_selection_retired' ORDER BY id DESC LIMIT 1`;
    expect(audit.oldValues).toMatchObject({
      pick_token: created.pickToken, pick_id: created.pickId, pick_number: 180,
    });
    // The player survives: retiring a selection is not retiring a person.
    const [player] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players WHERE id = ${created.playerId}`;
    expect(player.n).toBe(1);
  });

  it('refuses to retire a source-owned selection', async () => {
    expect(await retireManualPick({ pickId: sourcePickId, adminUserId: actorId }))
      .toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('gate 11: a later source row supersedes the manual one, leaving one selection and one player', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 190, draftKind: 'rookie', draftType: 'Rookie' }),
      player: { displayName: `${MARKER} Superseded`, dob: '2001-01-01' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);

    // DraftGuru publishes the same selection: an UNLINKED source-owned row. Source
    // linkage is PERSON-grained (migration 069), so the row needs its draft_persons
    // row exactly as a real reload would have written one.
    const sourceUrl = SOURCE_URL.replace('/1', '/2');
    const [person] = await admin<{ id: number }[]>`
      INSERT INTO draft_persons
        (source_id, dg_person_id, player_url, display_name_raw, name_key, link_status)
      VALUES (${draftguruSourceId}, 990001, ${sourceUrl}, ${`${MARKER} Superseded`},
              afldb_normalise_name(${`${MARKER} Superseded`}), 'unmatched')
      RETURNING id`;
    createdPersonIds.add(person.id);
    const [source] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, draft_kind, pick_number, player_name_raw,
         link_status_value, club_id, source_id, source_record_id, player_url, draft_person_id)
      VALUES (${fixtureYear}, 'Rookie', 'rookie', 191, ${`${MARKER} Superseded`},
              'unmatched', ${clubId}, ${draftguruSourceId}, ${`${MARKER}#1`},
              ${sourceUrl}, ${person.id})
      RETURNING id`;
    createdPickIds.add(source.id);

    const result = await supersedeManualPickBySourceRow({
      manualPickId: created.pickId, sourcePickId: source.id, adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const [after] = await sql<{ picks: number; players: number }[]>`
      SELECT (SELECT count(*) FROM draft_picks WHERE player_id = ${created.playerId})::int AS picks,
             (SELECT count(*) FROM players WHERE id = ${created.playerId})::int AS players`;
    expect(after).toEqual({ picks: 1, players: 1 });
    const [linked] = await sql<{ playerId: number; status: string }[]>`
      SELECT player_id AS "playerId", link_status_value::text AS status
        FROM draft_picks WHERE id = ${source.id}`;
    expect(linked.playerId).toBe(created.playerId);
    expect(linked.status).toBe('resolved');
  });
});

// -------------------------------------------------------------------------
// gate 8 — atomicity
// -------------------------------------------------------------------------

describe('gate 8: every mutation is all-or-nothing', () => {
  it('6.3b rolls back the player, identity, career row, selection and both records', async () => {
    const before = await sql<{ players: number; identities: number; overrides: number; picks: number }[]>`
      SELECT (SELECT count(*) FROM players)::int AS players,
             (SELECT count(*) FROM external_identities)::int AS identities,
             (SELECT count(*) FROM data_overrides)::int AS overrides,
             (SELECT count(*) FROM draft_picks)::int AS picks`;

    const result = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 200 }),
      player: { displayName: `${MARKER} Rollback Victim`, dob: '2000-01-01' },
      adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });

    const after = await sql<{ players: number; identities: number; overrides: number; picks: number }[]>`
      SELECT (SELECT count(*) FROM players)::int AS players,
             (SELECT count(*) FROM external_identities)::int AS identities,
             (SELECT count(*) FROM data_overrides)::int AS overrides,
             (SELECT count(*) FROM draft_picks)::int AS picks`;
    expect(after[0]).toEqual(before[0]);
    const [orphan] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players WHERE display_name = ${`${MARKER} Rollback Victim`}`;
    expect(orphan.n).toBe(0);
  });

  it('6.3b rolls the PLAYER back when the draft write is what fails', async () => {
    // The inverse ordering proof: "player succeeds, draft write fails". The club
    // is resolved before the player insert, so this drives the failure through
    // the durable record instead -- the same transaction, a later statement.
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM players`;
    const result = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 201, pickNote: GATE8_FAIL_NOTE }),
      player: { displayName: `${MARKER} Late Failure`, dob: '2000-02-02' },
      adminUserId: actorId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM players`;
    expect(after[0].n).toBe(before[0].n);
    const [orphan] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities
       WHERE external_name = ${`${MARKER} Late Failure`}`;
    expect(orphan.n).toBe(0);
  });

  it('6.3 rolls back the selection and its record', async () => {
    const before = await sql<{ picks: number; overrides: number }[]>`
      SELECT (SELECT count(*) FROM draft_picks)::int AS picks,
             (SELECT count(*) FROM data_overrides)::int AS overrides`;
    const result = await createManualPick({
      ...manualFields({ pickNumber: 202, draftKind: 'mini_draft', draftType: 'Mini-Draft' }),
      playerId: sourcedPlayerId, adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const after = await sql<{ picks: number; overrides: number }[]>`
      SELECT (SELECT count(*) FROM draft_picks)::int AS picks,
             (SELECT count(*) FROM data_overrides)::int AS overrides`;
    expect(after[0]).toEqual(before[0]);
  });

  it('6.1 rolls back the canonical UPDATE and the override upsert', async () => {
    const before = await getDraftPickAdminDetail(sourcePickId);
    const result = await saveSourcePickFields({
      pickId: sourcePickId, groupKey: 'notes',
      raw: { pick_note: 'should not persist', detail: 'should not persist' },
      adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const after = await getDraftPickAdminDetail(sourcePickId);
    expect(after?.pickNote).toBe(before?.pickNote);
    expect(await overrideRow(sourcePickEntityKey({
      sourceId: draftguruSourceId, playerUrl: SOURCE_URL,
      draftYear: fixtureYear, draftKind: 'national',
    }), 'notes')).toBeNull();
  });

  it('6.6 rolls the DELETE back with its audit', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 203 }),
      player: { displayName: `${MARKER} Undeleted`, dob: '1999-03-03' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const result = await retireManualPick({
      pickId: created.pickId, adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(await getDraftPickAdminDetail(created.pickId)).not.toBeNull();
    const record = await overrideRow(manualEntityKey(created.pickToken), 'selection');
    expect(record?.isActive, 'the override must not be left deactivated').toBe(true);
  });

  it('6.5 rolls back the identity and the record update', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 204 }),
      player: { displayName: `${MARKER} Unattached`, dob: '1998-04-04' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const result = await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: `players/U/${MARKER}-Unattached0.html`,
      adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    const [identities] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities WHERE player_id = ${created.playerId}`;
    expect(identities.n).toBe(1);
    const record = await overrideRow(manualEntityKey(created.playerToken), 'identity');
    expect(record?.overrideValues).not.toHaveProperty('afltables_profile_path');
  });

  it('6.5 rolls the identity back when the refusal is found AFTER the insert', async () => {
    // The late-refusal path: a manual player whose durable record is missing, so
    // the override UPDATE matches nothing and 6.5 refuses -- but only after its
    // `external_identities` INSERT has already run. `postgres.js` commits when
    // the `begin()` callback RESOLVES, so a returned refusal here would attach
    // the AFL Tables identity with no `data_edits` row and tell the operator it
    // failed. The refusal must roll back (§9.1).
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 206 }),
      player: { displayName: `${MARKER} Recordless`, dob: '1997-05-05' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    await admin`
      DELETE FROM data_overrides
       WHERE entity_type = 'players' AND entity_key = ${manualEntityKey(created.playerToken)}
         AND field_group = 'identity'`;

    const path = `players/R/${MARKER}-Recordless0.html`;
    const result = await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: path, adminUserId: actorId,
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });

    const [after] = await sql<{ identities: number; audits: number }[]>`
      SELECT (SELECT count(*) FROM external_identities WHERE external_id = ${path})::int AS identities,
             (SELECT count(*) FROM data_edits
               WHERE table_name = 'players' AND row_id = ${created.playerId}
                 AND field_group = 'source_identity')::int AS audits`;
    expect(after.identities, 'the identity must not be attached by a refused action').toBe(0);
    expect(after.audits, 'no audit row means no write may have survived').toBe(0);
  });

  it('6.8 rolls back the pick UPDATE, both records and both audits', async () => {
    const [player] = await admin<{ id: number }[]>`
      INSERT INTO players (display_name, search_name, sort_name, slug)
      VALUES (${`${MARKER} Unadopted`}, afldb_normalise_name(${`${MARKER} Unadopted`}),
              ${`${MARKER} Unadopted`}, ${`${MARKER.toLowerCase()}-unadopted`})
      RETURNING id`;
    createdPlayerIds.add(player.id);
    const [pick] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, pick_number, player_name_raw, player_id,
         link_status_value, club_id)
      VALUES (${fixtureYear}, 'National Draft', 205, ${`${MARKER} Unadopted`}, ${player.id},
              'resolved', ${clubId})
      RETURNING id`;
    createdPickIds.add(pick.id);

    const result = await adoptLegacyPick({
      pickId: pick.id, draftType: 'National', draftKind: 'national',
      adminUserId: actorId, note: GATE8_FAIL_NOTE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });

    const [after] = await sql<{ sourceId: number | null; identities: number; overrides: number }[]>`
      SELECT (SELECT source_id FROM draft_picks WHERE id = ${pick.id}) AS "sourceId",
             (SELECT count(*) FROM external_identities WHERE player_id = ${player.id})::int AS identities,
             (SELECT count(*) FROM data_edits WHERE table_name = 'players' AND row_id = ${player.id})::int AS overrides`;
    expect(after.sourceId, 'the pick must not be half-adopted').toBeNull();
    expect(after.identities).toBe(0);
    expect(after.overrides).toBe(0);
  });
});

// -------------------------------------------------------------------------
// §8.1 / §8.2 — the replay, run for real
// -------------------------------------------------------------------------

describe.skipIf(!canReplay)('gate 11: the durable record really re-creates a promoted-away row', () => {
  it('re-creates the manual player and selection with the same tokens, and no twin', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 210 }),
      player: {
        displayName: `${MARKER} Replay Subject`, dob: '2007-11-11',
        heightCm: 191, weightKg: 85, notes: 'fixture note',
      },
      adminUserId: actorId,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);

    const [beforePlayer] = await sql<{
      displayName: string; searchName: string; slug: string; sortName: string;
      dob: string | null; heightCm: number | null; weightKg: number | null; notes: string | null;
    }[]>`
      SELECT display_name AS "displayName", search_name AS "searchName", slug,
             sort_name AS "sortName", to_char(dob, 'YYYY-MM-DD') AS dob,
             height_cm AS "heightCm", weight_kg AS "weightKg", notes
        FROM players WHERE id = ${created.playerId}`;

    // Simulate the promoted candidate: the rebuild carries neither row, because
    // players and draft_picks are both REBUILT and no source knows about them.
    await admin`DELETE FROM draft_picks WHERE id = ${created.pickId}`;
    await admin`DELETE FROM external_identities WHERE player_id = ${created.playerId}`;
    await admin`DELETE FROM player_career_stats WHERE player_id = ${created.playerId}`;
    await admin`DELETE FROM players WHERE id = ${created.playerId}`;

    const replay = runReplay('players', 'draft_picks');
    expect(replay.stdout + replay.stderr).not.toMatch(/Traceback/);
    expect(replay.status, replay.stdout + replay.stderr).toBe(0);

    // ONE player, re-created from the durable record and byte-identical on every
    // derived column -- which is only true because both sides derive them in SQL.
    const rebuilt = await sql<typeof beforePlayer[]>`
      SELECT p.display_name AS "displayName", p.search_name AS "searchName", p.slug,
             p.sort_name AS "sortName", to_char(p.dob, 'YYYY-MM-DD') AS dob,
             p.height_cm AS "heightCm", p.weight_kg AS "weightKg", p.notes
        FROM players p
        JOIN external_identities e ON e.player_id = p.id
        JOIN sources s ON s.id = e.source_id AND s.key = 'manual_admin_edit'
       WHERE e.external_id = ${created.playerToken}`;
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toEqual(beforePlayer);

    const [twin] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players WHERE display_name = ${`${MARKER} Replay Subject`}`;
    expect(twin.n, 'the replay must never create a second player').toBe(1);

    const rebuiltPick = await sql<{
      id: number; playerUrl: string; draftYear: number; draftKind: string;
      pickNumber: number; clubId: number; playerId: number; status: string;
    }[]>`
      SELECT dp.id, dp.player_url AS "playerUrl", dp.draft_year AS "draftYear",
             dp.draft_kind AS "draftKind", dp.pick_number AS "pickNumber",
             dp.club_id AS "clubId", dp.player_id AS "playerId",
             dp.link_status_value::text AS status
        FROM draft_picks dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'manual_admin_edit' AND dp.player_url = ${`manual:${created.pickToken}`}`;
    expect(rebuiltPick).toHaveLength(1);
    expect(rebuiltPick[0]).toMatchObject({
      draftYear: fixtureYear, draftKind: 'national', pickNumber: 210,
      clubId, status: 'resolved',
    });
    // Re-linked to the re-created player, resolved through the token -- never a name.
    const [reborn] = await sql<{ id: number }[]>`
      SELECT p.id FROM players p
        JOIN external_identities e ON e.player_id = p.id
        JOIN sources s ON s.id = e.source_id AND s.key = 'manual_admin_edit'
       WHERE e.external_id = ${created.playerToken}`;
    expect(rebuiltPick[0].playerId).toBe(reborn.id);
    createdPlayerIds.add(reborn.id);
    createdPickIds.add(rebuiltPick[0].id);

    // Idempotent: running it again changes nothing.
    const again = runReplay('players', 'draft_picks');
    expect(again.status, again.stdout + again.stderr).toBe(0);
    const [stillOne] = await sql<{ players: number; picks: number }[]>`
      SELECT (SELECT count(*) FROM players WHERE display_name = ${`${MARKER} Replay Subject`})::int AS players,
             (SELECT count(*) FROM draft_picks WHERE player_url = ${`manual:${created.pickToken}`})::int AS picks`;
    expect(stillOne).toEqual({ players: 1, picks: 1 });
  });

  it('replays a corrected year and club onto the manual row', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 211 }),
      player: { displayName: `${MARKER} Corrected Selection`, dob: '2007-12-12' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const saved = await saveManualPick({
      pickId: created.pickId, playerId: created.playerId, adminUserId: actorId,
      draftYear: fixtureYear, draftType: 'Rookie', draftKind: 'rookie',
      pickNumber: 212, clubSlug: otherClubSlug,
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);

    // Corrupt the canonical row the way a destructive reload would.
    await admin`
      UPDATE draft_picks SET pick_number = 999, draft_kind = 'national', draft_type = 'National'
       WHERE id = ${created.pickId}`;

    const replay = runReplay('players', 'draft_picks');
    expect(replay.status, replay.stdout + replay.stderr).toBe(0);

    const detail = await getDraftPickAdminDetail(created.pickId);
    expect(detail).toMatchObject({ pickNumber: 212, draftKind: 'rookie', draftType: 'Rookie' });
    expect(detail?.clubSlug).toBe(otherClubSlug);
  });

  it('binds the token onto the path-player instead of creating a twin, after a debut', async () => {
    // §8.1 step 2, the case that makes a promotion AFTER the debut produce ONE
    // player: the candidate already has the footballer under their AFL Tables
    // profile, so the replay must attach the token rather than insert.
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 213 }),
      player: { displayName: `${MARKER} Bound Debutant`, dob: '2005-10-10' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const path = `players/B/${MARKER}-Bound0.html`;
    expect((await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: path, adminUserId: actorId,
    })).ok).toBe(true);

    // The candidate: the source-created player exists under the path; the manual
    // identity does not exist at all.
    await admin`DELETE FROM draft_picks WHERE id = ${created.pickId}`;
    await admin`
      DELETE FROM external_identities e USING sources s
       WHERE s.id = e.source_id AND s.key = 'manual_admin_edit' AND e.player_id = ${created.playerId}`;

    const replay = runReplay('players', 'draft_picks');
    expect(replay.status, replay.stdout + replay.stderr).toBe(0);

    const [players] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players WHERE display_name = ${`${MARKER} Bound Debutant`}`;
    expect(players.n, 'the replay must bind, not insert').toBe(1);
    const [bound] = await sql<{ playerId: number }[]>`
      SELECT e.player_id AS "playerId" FROM external_identities e
        JOIN sources s ON s.id = e.source_id AND s.key = 'manual_admin_edit'
       WHERE e.external_id = ${created.playerToken}`;
    expect(bound.playerId).toBe(created.playerId);
    const rebornPick = await sql<{ id: number; playerId: number }[]>`
      SELECT id, player_id AS "playerId" FROM draft_picks
       WHERE player_url = ${`manual:${created.pickToken}`}`;
    expect(rebornPick).toHaveLength(1);
    expect(rebornPick[0].playerId).toBe(created.playerId);
    createdPickIds.add(rebornPick[0].id);
  });

  it('refuses to commit a replay whose durable record cannot be resolved', async () => {
    // A reload that silently drops a human decision is worse than one that stops.
    const [orphan] = await admin<{ id: number }[]>`
      INSERT INTO data_overrides
            (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('draft_picks', ${manualEntityKey('issue-160-unresolvable')}, 'selection',
              ${admin.json({
                player_identity: 'manual_admin_edit:no-such-token',
                club_slug: 'no-such-club', draft_year: 2020,
                draft_kind: 'national', draft_type: 'National',
              })}, ${actorId}, true)
      RETURNING id`;
    try {
      const replay = runReplay('draft_picks');
      expect(replay.status).not.toBe(0);
      expect(replay.stdout + replay.stderr).toContain('refusing to commit');
    } finally {
      await admin`DELETE FROM data_overrides WHERE id = ${orphan.id}`;
    }
  });
});

// -------------------------------------------------------------------------
// gate 10 — the D-2 importer guard, run for real
// -------------------------------------------------------------------------

describe.skipIf(!canReplay)('gate 10: the D-2 fitzRoy guard', () => {
  function runGuard(script: string) {
    return spawnSync(python, ['-c', [
      'import sys, os',
      `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
      'import psycopg',
      'import import_fitzroy_core as fz',
      'conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"])',
      'cur = conn.cursor()',
      script,
      'conn.close()',
    ].join('\n')], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, AFLDB_REPLAY_DSN: testDbUrl },
    });
  }

  it('finds a manual player awaiting identity with the REAL candidate query, and refuses', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 220 }),
      player: { displayName: `${MARKER} Guarded`, dob: '2004-08-08' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const probe = runGuard([
      'cands = fz.load_manual_identity_candidates(cur)',
      `keys = fz.normalise_names_in_sql(cur, [${JSON.stringify(`${MARKER} Guarded`)}])`,
      `for_name = cands.get(keys[${JSON.stringify(`${MARKER} Guarded`)}], [])`,
      'print("CANDIDATES", len(for_name))',
      'import datetime',
      // Both dates known and DIFFERENT: a distinct namesake, safe to insert.
      'print("DIFFERENT", fz.manual_insert_verdict(datetime.date(2004,8,8), {datetime.date(1990,1,1)}))',
      // Both known and EQUAL: the same person. Refuse.
      'print("EQUAL", fz.manual_insert_verdict(datetime.date(2004,8,8), {datetime.date(2004,8,8)}))',
      // Manual side unknown: an unrecorded date distinguishes nobody. Refuse.
      'print("MANUAL_NULL", fz.manual_insert_verdict(None, {datetime.date(1990,1,1)}))',
      // Source side absent: same reasoning, the other way round. Refuse.
      'print("FACT_EMPTY", fz.manual_insert_verdict(datetime.date(2004,8,8), set()))',
      'try:',
      '    fz.refuse_unsafe_manual_insert("players/G/Guarded0.html", "x", set(), for_name)',
      '    print("RAISED no")',
      'except RuntimeError as e:',
      '    print("RAISED yes")',
      '    print("MESSAGE", str(e))',
    ].join('\n'));
    expect(probe.stderr).not.toMatch(/Traceback/);
    expect(probe.status, probe.stdout + probe.stderr).toBe(0);
    expect(probe.stdout).toContain('CANDIDATES 1');
    expect(probe.stdout).toContain('DIFFERENT allow');
    expect(probe.stdout).toContain('EQUAL refuse');
    expect(probe.stdout).toContain('MANUAL_NULL refuse');
    expect(probe.stdout).toContain('FACT_EMPTY refuse');
    expect(probe.stdout).toContain('RAISED yes');
    expect(probe.stdout).toContain('/admin/draft');

    // Attaching the identity is the operator correction, and it removes the
    // player from the candidate set -- so the rerun proceeds.
    expect((await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: `players/G/${MARKER}-Guarded0.html`,
      adminUserId: actorId,
    })).ok).toBe(true);

    const after = runGuard([
      'cands = fz.load_manual_identity_candidates(cur)',
      `keys = fz.normalise_names_in_sql(cur, [${JSON.stringify(`${MARKER} Guarded`)}])`,
      `print("CANDIDATES", len(cands.get(keys[${JSON.stringify(`${MARKER} Guarded`)}], [])))`,
    ].join('\n'));
    expect(after.status, after.stdout + after.stderr).toBe(0);
    expect(after.stdout).toContain('CANDIDATES 0');
  });
});

// -------------------------------------------------------------------------
// gate 12 — the promotion lineage rules, against real rows
// -------------------------------------------------------------------------

describe('gate 12: the lineage rules resolve these rows on a real database', () => {
  it('draft_pick_key names a source row and a manual row, and skips a NULL-source one', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 230 }),
      player: { displayName: `${MARKER} Lineage`, dob: '2003-03-13' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const [legacy] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, pick_number, player_name_raw, player_id, link_status_value, club_id)
      VALUES (${fixtureYear}, 'National Draft', 231, ${`${MARKER} Lineage`}, ${created.playerId},
              'resolved', ${clubId})
      RETURNING id`;
    createdPickIds.add(legacy.id);

    const { LINEAGE_IDENTITY_SQL } = await import('../../tools/db/promotion-inventory');
    const ids = [sourcePickId, created.pickId, legacy.id];
    const rows = await admin.unsafe(
      LINEAGE_IDENTITY_SQL.draft_pick_key.byId, [ids],
    ) as unknown as { id: number; identity: string }[];

    const byId = new Map(rows.map((r) => [Number(r.id), r.identity]));
    expect(byId.get(sourcePickId))
      .toBe(`draftguru|${SOURCE_URL}|${fixtureYear}|national`);
    expect(byId.get(created.pickId))
      .toBe(`manual_admin_edit|manual:${created.pickToken}|${fixtureYear}|national`);
    // The legacy row has NO key on either side, so it reports unresolved rather
    // than being carried across by an integer that now names someone else.
    expect(byId.has(legacy.id)).toBe(false);

    // Round trip: the same identity read back by identity names the same row.
    const back = await admin.unsafe(
      LINEAGE_IDENTITY_SQL.draft_pick_key.byIdentity, [[...byId.values()]],
    ) as unknown as { id: number; identity: string }[];
    expect(new Set(back.map((r) => Number(r.id)))).toEqual(new Set([sourcePickId, created.pickId]));
  });

  it('the players rule gives a manual player exactly one identity, path-first', async () => {
    const created = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 232 }),
      player: { displayName: `${MARKER} Two Identities`, dob: '2003-04-14' },
      adminUserId: actorId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdPlayerIds.add(created.playerId);
    createdPickIds.add(created.pickId);

    const { LINEAGE_IDENTITY_SQL } = await import('../../tools/db/promotion-inventory');
    const rule = LINEAGE_IDENTITY_SQL.afltables_profile_url;

    const tokenOnly = await admin.unsafe(rule.byId, [[created.playerId]]) as unknown as
      { id: number; identity: string }[];
    expect(tokenOnly).toHaveLength(1);
    expect(tokenOnly[0].identity).toBe(created.playerToken);

    const path = `players/T/${MARKER}-Two0.html`;
    expect((await attachAflTablesIdentity({
      playerId: created.playerId, profilePath: path, adminUserId: actorId,
    })).ok).toBe(true);

    // Now the player holds BOTH. Exactly one identity comes back, and it is the
    // path -- which is what lets a token-side row and a path-side row resolve to
    // each other across a promotion.
    const both = await admin.unsafe(rule.byId, [[created.playerId]]) as unknown as
      { id: number; identity: string }[];
    expect(both).toHaveLength(1);
    expect(both[0].identity).toBe(path);
  });
});


// -------------------------------------------------------------------------
// §18 - the list review states and the Player-links deep link
// -------------------------------------------------------------------------

describe('the /admin/draft list review states (§18)', () => {
  let overridePickId = 0;
  let awaitingPickId = 0;
  let awaitingPlayerId = 0;
  let duplicatePickId = 0;
  let duplicatePlayerId = 0;
  let duplicateSourcePickId = 0;
  let unlinkedSourcePickId = 0;

  beforeAll(async () => {
    // `override` WITHOUT `awaiting-identity`: a manual selection for a player
    // who already holds an AFL Tables identity. Every manual selection carries
    // an active `selection` record, and this player is not awaiting one, so the
    // three states stay independently observable.
    //
    // Its own player, not the suite's shared `sourcedPlayerId`: earlier tests
    // leave that one holding selections in several kinds (the 6.4 relink test
    // moves one onto them), and J-1 rightly refuses a second selection for one
    // player in one (year, kind). A dedicated player keeps this block's
    // fixtures independent of what ran before it.
    const [overridePlayer] = await admin<{ id: number }[]>`
      INSERT INTO players (display_name, search_name, sort_name, slug)
      VALUES (${MARKER + ' State Sourced'},
              afldb_normalise_name(${MARKER + ' State Sourced'}),
              ${MARKER + ' State Sourced'}, ${MARKER.toLowerCase() + '-state-sourced'})
      RETURNING id`;
    createdPlayerIds.add(overridePlayer.id);
    await admin`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
              ${'players/T/' + MARKER + '-State0.html'}, ${overridePlayer.id},
              'unique', 'afltables_profile_url')`;

    const withOverride = await createManualPick({
      ...manualFields({ pickNumber: 301, draftKind: 'trade', draftType: 'Trade' }),
      playerId: overridePlayer.id, adminUserId: actorId,
    });
    expect(withOverride.ok, JSON.stringify(withOverride)).toBe(true);
    if (!withOverride.ok) return;
    overridePickId = withOverride.pickId;
    createdPickIds.add(overridePickId);

    // `awaiting-identity`: a manually created player, which by construction
    // holds a manual_admin_edit identity and no AFL Tables one.
    const awaiting = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 302, draftKind: 'preseason', draftType: 'Pre-Season' }),
      player: { displayName: MARKER + ' State Awaiting', dob: '2002-06-06' },
      adminUserId: actorId,
    });
    expect(awaiting.ok, JSON.stringify(awaiting)).toBe(true);
    if (!awaiting.ok) return;
    awaitingPickId = awaiting.pickId;
    awaitingPlayerId = awaiting.playerId;
    createdPickIds.add(awaitingPickId);
    createdPlayerIds.add(awaitingPlayerId);

    // `duplicate` (J-14): the manual row goes in first, then DraftGuru publishes
    // the same selection and it is linked to the same player -- exactly the
    // sequence the state exists to surface, and the one 6.6/6.7 resolve.
    const dup = await createPlayerAndDraftPick({
      ...manualFields({ pickNumber: 303, draftKind: 'post_draft', draftType: 'Post-Draft' }),
      player: { displayName: MARKER + ' State Duplicate', dob: '2003-07-07' },
      adminUserId: actorId,
    });
    expect(dup.ok, JSON.stringify(dup)).toBe(true);
    if (!dup.ok) return;
    duplicatePickId = dup.pickId;
    duplicatePlayerId = dup.playerId;
    createdPickIds.add(duplicatePickId);
    createdPlayerIds.add(duplicatePlayerId);

    const [source] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, draft_kind, pick_number, player_name_raw, player_id,
         link_status_value, club_id, source_id, source_record_id, player_url)
      VALUES (${fixtureYear}, 'Post-Draft', 'post_draft', 304,
              ${MARKER + ' State Duplicate'}, ${duplicatePlayerId}, 'resolved', ${clubId},
              ${draftguruSourceId}, ${MARKER + '#3'}, ${SOURCE_URL.replace('/1', '/3')})
      RETURNING id`;
    duplicateSourcePickId = source.id;
    createdPickIds.add(duplicateSourcePickId);

    // An UNLINKED source-owned selection -- the only shape whose next action
    // belongs to /admin/player-links. The suite's other unlinked source row is
    // linked by the 6.7 supersede test before this block runs, so this one is
    // created here rather than depended upon.
    const [unlinked] = await admin<{ id: number }[]>`
      INSERT INTO draft_picks
        (draft_year, draft_type, draft_kind, pick_number, player_name_raw,
         link_status_value, club_id, source_id, source_record_id, player_url)
      VALUES (${fixtureYear}, 'Training Squad Selection', 'training_squad_selection', 305,
              ${MARKER + ' State Unlinked'}, 'unmatched', ${clubId},
              ${draftguruSourceId}, ${MARKER + '#4'}, ${SOURCE_URL.replace('/1', '/4')})
      RETURNING id`;
    unlinkedSourcePickId = unlinked.id;
    createdPickIds.add(unlinkedSourcePickId);
  });

  it('state=override returns EXACTLY the rows whose entity key carries an active record', async () => {
    // The pin between the two derivations of one key shape: the SQL predicate
    // inside `listDraftPicksForAdmin` and `entityKeyFor()`, which produces the
    // `entityKey` the page renders its badge from. If they ever disagree, this
    // fails.
    const activeKeys = await readActiveDraftOverrideKeys();
    const all = await listDraftPicksForAdmin({ year: fixtureYear, page: 1, pageSize: 200 });
    const expected = all.rows.filter((r) => r.entityKey !== null && activeKeys.has(r.entityKey));

    const filtered = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'override', overrideKeys: [...activeKeys], page: 1, pageSize: 200,
    });
    expect(filtered.rows.map((r) => r.id).sort((a, b) => a - b))
      .toEqual(expected.map((r) => r.id).sort((a, b) => a - b));
    expect(filtered.total).toBe(expected.length);
    expect(filtered.rows.map((r) => r.id)).toContain(overridePickId);
  });

  it('state=override with no active keys returns nothing rather than everything', async () => {
    const filtered = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'override', overrideKeys: [], page: 1, pageSize: 200,
    });
    expect(filtered.rows).toEqual([]);
    expect(filtered.total).toBe(0);
  });

  it('state=duplicate returns the manual row whose player also holds a source selection', async () => {
    const { rows, total } = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'duplicate', page: 1, pageSize: 200,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(duplicatePickId);
    // The source-owned half is not itself the duplicate: the manual row is the
    // one to retire or supersede.
    expect(ids).not.toContain(duplicateSourcePickId);
    // A manual selection with no source-owned sibling is not a duplicate.
    expect(ids).not.toContain(overridePickId);
    expect(ids).not.toContain(awaitingPickId);
    expect(rows.every((r) => r.provenance === 'manual')).toBe(true);
    expect(total).toBe(rows.length);
  });

  it('state=awaiting-identity follows the identity rows, not the names', async () => {
    const { rows } = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'awaiting-identity', page: 1, pageSize: 200,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(awaitingPickId);
    // The sourced player shares no identity gap: they hold an AFL Tables path.
    expect(ids).not.toContain(overridePickId);

    // Every row it returns names a player the D-2 guard would also treat as
    // awaiting identity -- one predicate, two readers.
    const awaiting = new Set((await listManualPlayersAwaitingIdentity()).map((p) => p.playerId));
    expect(rows.every((r) => r.playerId !== null && awaiting.has(r.playerId))).toBe(true);
  });

  it('attaching the identity removes the row from awaiting-identity', async () => {
    const before = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'awaiting-identity', page: 1, pageSize: 200,
    });
    expect(before.rows.map((r) => r.id)).toContain(awaitingPickId);

    const attached = await attachAflTablesIdentity({
      playerId: awaitingPlayerId,
      profilePath: 'players/S/' + MARKER + '-State-Awaiting0.html',
      adminUserId: actorId,
    });
    expect(attached.ok, JSON.stringify(attached)).toBe(true);

    const after = await listDraftPicksForAdmin({
      year: fixtureYear, state: 'awaiting-identity', page: 1, pageSize: 200,
    });
    expect(after.rows.map((r) => r.id)).not.toContain(awaitingPickId);
  });

  it('the deep link is offered for an unresolved SOURCE row and for nothing else', async () => {
    const { rows } = await listDraftPicksForAdmin({ year: fixtureYear, page: 1, pageSize: 200 });
    const unresolvedSource = rows.filter(
      (r) => r.provenance === 'draftguru' && r.playerId === null,
    );
    expect(unresolvedSource.map((r) => r.id)).toContain(unlinkedSourcePickId);
    for (const row of unresolvedSource) expect(needsPlayerLinkReview(row)).toBe(true);

    // The href names only the two parameters /admin/player-links supports, and
    // carries the row's own `player_name_raw`, which is what that page's `q`
    // matches its queue rows on.
    const unlinkedRow = rows.find((r) => r.id === unlinkedSourcePickId)!;
    expect(playerLinksHref(unlinkedRow)).toBe(
      '/admin/player-links?table=draft_picks&q=' + encodeURIComponent(unlinkedRow.playerNameRaw),
    );

    // Everything /admin/draft owns itself is excluded: manual rows (relinked by
    // 6.4), legacy rows (repaired by 6.8) and already-linked source rows.
    for (const row of rows) {
      if (row.provenance !== 'draftguru' || row.playerId !== null) {
        expect(needsPlayerLinkReview(row)).toBe(false);
      }
    }
  });
});
