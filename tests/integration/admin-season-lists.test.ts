/**
 * Season list administration against a real PostgreSQL (AFLDB-ISSUE-161 Stage 1).
 *
 * These are the claims that can be proved nowhere else: that a mutation really
 * writes the canonical row, the `data_overrides` durable record and the
 * `data_edits` audit row TOGETHER and rolls all three back on any failure; that
 * a tombstone really survives — and really blocks — the REAL
 * `replay_admin_overrides('season_list_members')` out of `tools/migration/common.py`,
 * which is what a promotion and a destructive reload run; that `UNIQUE (season,
 * player_id)` really holds across add, transfer and copy-forward; and that the
 * whole mutation set really works for a season with ZERO matches, which is the
 * fixtures boundary (§9.4, W-14).
 *
 * The pure half — the key shape, the bound arithmetic and the precondition
 * refusals over a fake transaction — is `tests/admin-season-list-actions.test.ts`
 * and is not re-proved here.
 *
 * FIXTURES: every row is created under an `AFLDB-ISSUE-161-TEST` marker in the
 * two seasons after the register's last (`max(seasons.year) + 1` and `+ 2`), in
 * which no real row of any kind exists, and removed in `afterAll`. No real
 * player, club, membership or season row is written to, and NO `seasons`,
 * `clubs` or `club_seasons` row is created at all (D-6): the second
 * administrable season comes from the module's documented test-only ceiling,
 * which cannot lower `FIRST_LIST_SEASON` and is inert outside `NODE_ENV=test`.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  FIRST_LIST_SEASON,
  addSeasonListMember,
  addSeasonListMembers,
  administrableListSeasons,
  copySeasonListsForward,
  currentListSeason,
  eligibleClubsForSeason,
  readAppearanceReviewCandidates,
  readClubSeasonList,
  readPlayedNotListed,
  readSeasonListOverrides,
  readSeasonListOverview,
  removeSeasonListMember,
  seasonListEntityKey,
  transferSeasonListMember,
} from '@/db/queries/admin-season-lists';

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

const MARKER = 'AFLDB-ISSUE-161-TEST';
const GATE_FAIL_NOTE = 'AFLDB-ISSUE-161-GATE-FORCE-FAIL';

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

/** The fixture players, by role in the proofs. */
let aflPlayerId = 0;
let aflIdentity = '';
let manualPlayerId = 0;
let manualIdentity = '';
let identitylessPlayerId = 0;
let ambiguousPlayerId = 0;
let namesakePlayerId = 0;
const createdPlayerIds = new Set<number>();

/**
 * A throwaway player carrying a durable manual identity, and NOT listed
 * anywhere — so a test of what happens mid-write is not short-circuited by the
 * duplicate refusal, which happens earlier and would prove nothing about it.
 */
async function createIdentifiedPlayer(suffix: string): Promise<number> {
  const playerId = await createPlayer(`${MARKER} ${suffix}`);
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'),
            ${`${MARKER.toLowerCase()}-${suffix.toLowerCase().replace(/\s+/g, '-')}`},
            ${playerId}, 'resolved', 'manual_admin_edit')`;
  return playerId;
}

async function createPlayer(name: string): Promise<number> {
  const [row] = await admin<{ id: number }[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${name}, afldb_normalise_name(${name}), ${name},
            ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')})
    RETURNING id`;
  createdPlayerIds.add(row.id);
  return row.id;
}

async function membershipCount(season: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM season_list_members WHERE season = ${season}`;
  return row.n;
}

/**
 * Remove this suite's audit rows by SEASON, not by player id.
 *
 * The appearances review panel offers players who really played last season, so
 * the multi-select proof lists REAL players — whose `data_edits` rows a teardown
 * keyed on the fixture player ids would silently leave behind to accumulate run
 * after run. The fixture seasons are past the register's last, and no real list
 * work exists for them, so the season is the precise handle.
 */
async function clearFixtureAudits(): Promise<void> {
  await admin`
    DELETE FROM data_edits
     WHERE table_name = 'players'
       AND field_group IN ('season_list_added', 'season_list_removed')
       AND (new_values->>'season')::int IN (${seasonA}, ${seasonB})`;
}

async function auditRows(playerId: number, fieldGroup: string) {
  return admin<{ newValues: Record<string, unknown>; oldValues: Record<string, unknown> }[]>`
    SELECT new_values AS "newValues", old_values AS "oldValues"
      FROM data_edits
     WHERE table_name = 'players' AND row_id = ${playerId} AND field_group = ${fieldGroup}
     ORDER BY id`;
}

beforeAll(async () => {
  const [bound] = await sql<{ maxYear: number }[]>`SELECT max(year)::int AS "maxYear" FROM seasons`;
  maxYear = bound.maxYear;
  seasonA = maxYear + 1;
  seasonB = maxYear + 2;

  // The documented test-only ceiling (§11a needs TWO administrable seasons to
  // prove copy-forward, and the real rule admits exactly one). It raises the
  // ceiling only; FIRST_LIST_SEASON is untouched, so nothing here can write an
  // authoritative row for a season below 2027.
  process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON = String(seasonA);

  const [existingAdmin] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await admin<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-161-season-list-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  const eligible = await eligibleClubsForSeason(seasonA);
  expect(eligible.length, 'need eligible clubs for the first list season').toBeGreaterThan(1);
  clubA = eligible[0];
  clubB = eligible[1];

  // Debris from a crashed earlier run would be REPLAYED by this one, so the
  // suite clears its own marker before it starts rather than assuming the last
  // run exited cleanly.
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'season_list_members'
       AND (override_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})`;
  await clearFixtureAudits();

  aflPlayerId = await createPlayer(`${MARKER} Afl Identified`);
  aflIdentity = `afltables:players/T/${MARKER}0.html`;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
            ${`players/T/${MARKER}0.html`}, ${aflPlayerId}, 'unique', 'afltables_profile_url')`;

  manualPlayerId = await createPlayer(`${MARKER} Manual Created`);
  const manualToken = `${MARKER.toLowerCase()}-manual-token`;
  manualIdentity = `manual_admin_edit:${manualToken}`;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'),
            ${manualToken}, ${manualPlayerId}, 'resolved', 'manual_admin_edit')`;

  identitylessPlayerId = await createPlayer(`${MARKER} No Identity`);

  ambiguousPlayerId = await createPlayer(`${MARKER} Two Identities`);
  for (const n of [1, 2]) {
    await admin`
      INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
      VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
              ${`players/T/${MARKER}Ambiguous${n}.html`}, ${ambiguousPlayerId},
              'unique', 'afltables_profile_url')`;
  }

  // A NAMESAKE of the AFL-identified player: same display name, different
  // person, different identity. I-10 — a name never decides anything.
  namesakePlayerId = await createPlayer(`${MARKER} Afl Identified`);
  const namesakeToken = `${MARKER.toLowerCase()}-namesake-token`;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'),
            ${namesakeToken}, ${namesakePlayerId}, 'resolved', 'manual_admin_edit')`;

  // Two suite-scoped failure seams, one per table a mutation writes besides the
  // canonical row. Every §12/§13 function takes an optional `note` that flows
  // into recordDataEdit() and the override payload and nowhere else, so this
  // exercises a seam the production code already exposes.
  await admin`
    CREATE OR REPLACE FUNCTION issue161_test_force_data_edits_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.note = 'AFLDB-ISSUE-161-GATE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-161: forced data_edits failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue161_test_force_data_edits_failure_trg ON data_edits`;
  await admin`
    CREATE TRIGGER issue161_test_force_data_edits_failure_trg
      BEFORE INSERT ON data_edits
      FOR EACH ROW EXECUTE FUNCTION issue161_test_force_data_edits_failure()`;

  await admin`
    CREATE OR REPLACE FUNCTION issue161_test_force_overrides_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_type = 'season_list_members'
         AND NEW.override_values->>'note' = 'AFLDB-ISSUE-161-OVERRIDE-FORCE-FAIL' THEN
        RAISE EXCEPTION 'AFLDB-ISSUE-161: forced data_overrides failure for rollback proof';
      END IF;
      RETURN NEW;
    END $$`;
  await admin`DROP TRIGGER IF EXISTS issue161_test_force_overrides_failure_trg ON data_overrides`;
  await admin`
    CREATE TRIGGER issue161_test_force_overrides_failure_trg
      BEFORE INSERT OR UPDATE ON data_overrides
      FOR EACH ROW EXECUTE FUNCTION issue161_test_force_overrides_failure()`;
});

afterAll(async () => {
  await admin`DROP TRIGGER IF EXISTS issue161_test_force_data_edits_failure_trg ON data_edits`;
  await admin`DROP FUNCTION IF EXISTS issue161_test_force_data_edits_failure()`;
  await admin`DROP TRIGGER IF EXISTS issue161_test_force_overrides_failure_trg ON data_overrides`;
  await admin`DROP FUNCTION IF EXISTS issue161_test_force_overrides_failure()`;

  const ids = [...createdPlayerIds];
  // A durable record OUTLIVES the rows it describes — that is the point of it —
  // so the teardown reads the PAYLOAD, not the canonical row. An orphan left
  // behind would be replayed by the next run and would re-create the membership
  // it describes.
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type = 'season_list_members'
       AND (override_values->>'season')::int IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})`;
  await admin`DELETE FROM season_list_members WHERE player_id = ANY(${ids}::int[])`;
  await clearFixtureAudits();
  await admin`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ANY(${ids}::bigint[])`;
  await admin`DELETE FROM external_identities WHERE player_id = ANY(${ids}::int[])`;
  await admin`DELETE FROM players WHERE id = ANY(${ids}::int[])`;
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;

  delete process.env.AFLDB_SEASON_LIST_TEST_MAX_SEASON;
  await admin.end({ timeout: 5 });
  await sql.end({ timeout: 5 });
});

// -------------------------------------------------------------------------

describe('the fixtures boundary: a season with zero matches (§9.4, W-14)', () => {
  it('has no matches, no club_seasons row and no fixture for the list season', async () => {
    const [counts] = await sql<{ matches: number; clubSeasons: number }[]>`
      SELECT (SELECT count(*)::int FROM matches WHERE season = ${seasonA}) AS matches,
             (SELECT count(*)::int FROM club_seasons WHERE season = ${seasonA}) AS "clubSeasons"`;
    expect(counts.matches).toBe(0);
    expect(counts.clubSeasons).toBe(0);
  });

  it('still offers every current club, because eligibility never reads a fixture', async () => {
    const eligible = await eligibleClubsForSeason(seasonA);
    expect(eligible.length).toBeGreaterThan(1);
    const [currentClubs] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM clubs WHERE is_current_afl_club`;
    expect(eligible.length).toBe(currentClubs.n);
  });

  it('resolves a HISTORICAL season through the era identities instead', async () => {
    // The other arm of the one rule: before the register's last season, the
    // identity that actually competed, proven by a club_seasons row.
    const eligible1990 = await eligibleClubsForSeason(1990);
    expect(eligible1990.length).toBeGreaterThan(0);
    const [played] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM club_seasons WHERE season = 1990`;
    expect(eligible1990.length).toBe(played.n);
  });

  it('administers the bound as FIRST_LIST_SEASON .. max(year) + 1', async () => {
    const bounds = await administrableListSeasons();
    expect(bounds.first).toBe(FIRST_LIST_SEASON);
    expect(bounds.last).toBe(seasonB);
    expect(seasonA).toBeGreaterThanOrEqual(FIRST_LIST_SEASON);
  });
});

describe('add (§12.1)', () => {
  it('writes the canonical row, the durable override and the audit row together', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: aflPlayerId, adminUserId: actorId,
      note: 'listed for the fixture season',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(result.entityKey).toBe(seasonListEntityKey({
      clubSlug: clubA.slug, season: seasonA, playerIdentity: aflIdentity,
    }));

    const [row] = await sql<{ origin: string; sourceKey: string; copiedFromSeason: number | null }[]>`
      SELECT m.origin, s.key AS "sourceKey", m.copied_from_season::int AS "copiedFromSeason"
        FROM season_list_members m JOIN sources s ON s.id = m.source_id
       WHERE m.id = ${result.membershipId}`;
    expect(row.origin).toBe('added');
    expect(row.sourceKey).toBe('manual_admin_edit');
    expect(row.copiedFromSeason).toBeNull();

    const overrides = await readSeasonListOverrides(result.entityKey);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].isActive).toBe(true);
    expect(overrides[0].overrideValues).toMatchObject({
      club_slug: clubA.slug, season: seasonA, player_identity: aflIdentity, origin: 'added',
    });

    const audits = await auditRows(aflPlayerId, 'season_list_added');
    expect(audits).toHaveLength(1);
    expect(audits[0].newValues).toMatchObject({ entity_key: result.entityKey, season: seasonA });
  });

  it('lists a player who has played no games and holds no statistics at all', async () => {
    const rows = await readClubSeasonList(seasonA, clubA.slug);
    const listed = rows.find((r) => r.playerId === aflPlayerId)!;
    expect(listed).toBeDefined();
    // NULL, not 0: "the season has no matches" and "listed but has not played"
    // are different statements and the page must tell them apart.
    expect(listed.gamesInSeason).toBeNull();
    const [stats] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM player_club_season_stats
       WHERE player_id = ${aflPlayerId} AND season = ${seasonA}`;
    expect(stats.n).toBe(0);
  });

  it('refuses a second club for the same player in the same season (I-1)', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubB.slug, playerId: aflPlayerId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate');
    expect(result.error).toContain(clubA.name);
    expect(await membershipCount(seasonA)).toBe(1);
  });

  it('refuses re-adding the same player to the same club', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: aflPlayerId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate');
  });

  it('refuses every season below FIRST_LIST_SEASON, and writes nothing (D-2, I-4)', async () => {
    for (const season of [maxYear, FIRST_LIST_SEASON - 1, 1990]) {
      const result = await addSeasonListMember({
        season, clubSlug: clubA.slug, playerId: manualPlayerId, adminUserId: actorId,
      });
      expect(result.ok, String(season)).toBe(false);
      if (!result.ok) expect(result.reason).toBe('validation');
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM season_list_members WHERE season = ${season}`;
      expect(row.n, String(season)).toBe(0);
    }
  });

  it('refuses a club that is not eligible in the season', async () => {
    const [gone] = await sql<{ slug: string }[]>`
      SELECT slug FROM clubs WHERE NOT is_current_afl_club ORDER BY id LIMIT 1`;
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: gone.slug, playerId: manualPlayerId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
  });
});

describe('identity decides, never a name (§5, I-10)', () => {
  it('keys a manual player by their token and an AFL Tables player by their path', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubB.slug, playerId: manualPlayerId, adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.entityKey).toBe(`${clubB.slug}|${seasonA}|${manualIdentity}`);
    expect(result.entityKey).not.toContain('Manual Created');
  });

  it('gives two people with the SAME display name two different keys', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubB.slug, playerId: namesakePlayerId, adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const other = seasonListEntityKey({
      clubSlug: clubA.slug, season: seasonA, playerIdentity: aflIdentity,
    });
    expect(result.entityKey).not.toBe(other);
    expect(result.entityKey).toContain('manual_admin_edit:');
  });

  it('refuses a player holding two AFL Tables identities rather than choosing one', async () => {
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: ambiguousPlayerId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ambiguous_identity');
  });

  it('refuses an identity-less player and never mints an identity for them', async () => {
    const before = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities WHERE player_id = ${identitylessPlayerId}`;
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: identitylessPlayerId, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
    const after = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_identities WHERE player_id = ${identitylessPlayerId}`;
    expect(after[0].n).toBe(before[0].n);
    expect(after[0].n).toBe(0);
  });
});

describe('remove is not retirement (§12.2, D-4)', () => {
  it('deletes the row, tombstones the record, and changes nothing about the player', async () => {
    const rows = await readClubSeasonList(seasonA, clubB.slug);
    const target = rows.find((r) => r.playerId === namesakePlayerId)!;
    const [playerBefore] = await sql<{ debutSeason: number | null; finalSeason: number | null }[]>`
      SELECT debut_season AS "debutSeason", final_season AS "finalSeason"
        FROM players WHERE id = ${namesakePlayerId}`;

    const result = await removeSeasonListMember({
      membershipId: target.membershipId,
      expectedUpdatedAt: target.updatedAt,
      adminUserId: actorId,
      note: 'delisted in the fixture season',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const overrides = await readSeasonListOverrides(result.entityKey);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].isActive).toBe(false);

    const audits = await auditRows(namesakePlayerId, 'season_list_removed');
    expect(audits).toHaveLength(1);
    expect(audits[0].oldValues).toMatchObject({ season: seasonA, club_slug: clubB.slug });

    // Nothing player-level moved. There is no retired flag to set, and the
    // player's own row is untouched.
    const [playerAfter] = await sql<{ debutSeason: number | null; finalSeason: number | null }[]>`
      SELECT debut_season AS "debutSeason", final_season AS "finalSeason"
        FROM players WHERE id = ${namesakePlayerId}`;
    expect(playerAfter).toEqual(playerBefore);
  });

  it('refuses a stale compare-and-swap and leaves the row in place', async () => {
    const rows = await readClubSeasonList(seasonA, clubA.slug);
    const target = rows.find((r) => r.playerId === aflPlayerId)!;
    const result = await removeSeasonListMember({
      membershipId: target.membershipId,
      expectedUpdatedAt: '1999-01-01 00:00:00+00',
      adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale');
    const [still] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members WHERE id = ${target.membershipId}`;
    expect(still.n).toBe(1);
  });

  it('refuses a membership that no longer exists', async () => {
    const result = await removeSeasonListMember({
      membershipId: 2_000_000_000, expectedUpdatedAt: 'x', adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('lifts the tombstone when the player is added again — same record, not a second one', async () => {
    const key = seasonListEntityKey({
      clubSlug: clubB.slug, season: seasonA, playerIdentity: `manual_admin_edit:${MARKER.toLowerCase()}-namesake-token`,
    });
    const before = await admin<{ id: number }[]>`
      SELECT id FROM data_overrides
       WHERE entity_type = 'season_list_members' AND entity_key = ${key}`;
    expect(before).toHaveLength(1);

    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubB.slug, playerId: namesakePlayerId, adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const after = await admin<{ id: number; isActive: boolean }[]>`
      SELECT id, is_active AS "isActive" FROM data_overrides
       WHERE entity_type = 'season_list_members' AND entity_key = ${key}`;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].isActive).toBe(true);
  });
});

describe('transfer within a season (§13)', () => {
  it('moves the membership atomically, keeping I-1 and pairing the two audits', async () => {
    const rows = await readClubSeasonList(seasonA, clubA.slug);
    const target = rows.find((r) => r.playerId === aflPlayerId)!;

    const result = await transferSeasonListMember({
      membershipId: target.membershipId,
      toClubSlug: clubB.slug,
      expectedUpdatedAt: target.updatedAt,
      adminUserId: actorId,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const [moved] = await sql<{ clubSlug: string; origin: string }[]>`
      SELECT c.slug AS "clubSlug", m.origin FROM season_list_members m
        JOIN clubs c ON c.id = m.club_id WHERE m.id = ${result.membershipId}`;
    expect(moved.clubSlug).toBe(clubB.slug);
    expect(moved.origin).toBe('transferred');

    // Exactly one membership for the player in the season, still.
    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members
       WHERE season = ${seasonA} AND player_id = ${aflPlayerId}`;
    expect(count.n).toBe(1);

    const from = await readSeasonListOverrides(result.fromEntityKey);
    const to = await readSeasonListOverrides(result.toEntityKey);
    expect(from[0].isActive).toBe(false);
    expect(to[0].isActive).toBe(true);

    const removed = await auditRows(aflPlayerId, 'season_list_removed');
    const added = await auditRows(aflPlayerId, 'season_list_added');
    expect(removed.at(-1)!.newValues.transfer_id).toBe(result.transferId);
    expect(added.at(-1)!.newValues.transfer_id).toBe(result.transferId);
  });

  it('refuses a transfer to the club the player is already at', async () => {
    const rows = await readClubSeasonList(seasonA, clubB.slug);
    const target = rows.find((r) => r.playerId === aflPlayerId)!;
    const result = await transferSeasonListMember({
      membershipId: target.membershipId, toClubSlug: clubB.slug,
      expectedUpdatedAt: target.updatedAt, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('validation');
  });

  it('leaves the original membership intact when the transfer fails mid-flight', async () => {
    const rows = await readClubSeasonList(seasonA, clubB.slug);
    const target = rows.find((r) => r.playerId === aflPlayerId)!;
    const result = await transferSeasonListMember({
      membershipId: target.membershipId, toClubSlug: clubA.slug,
      expectedUpdatedAt: target.updatedAt, adminUserId: actorId,
      note: GATE_FAIL_NOTE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');

    // The DELETE, the INSERT, both overrides and both audits are one transaction:
    // a raising audit trigger must leave the player exactly where they were.
    const [still] = await sql<{ clubSlug: string }[]>`
      SELECT c.slug AS "clubSlug" FROM season_list_members m
        JOIN clubs c ON c.id = m.club_id WHERE m.id = ${target.membershipId}`;
    expect(still?.clubSlug).toBe(clubB.slug);
  });
});

describe('the transaction contract (§18)', () => {
  it('rolls the whole add back when the audit INSERT fails', async () => {
    const player = await createIdentifiedPlayer('Audit Rollback');
    const before = await membershipCount(seasonA);
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: player, adminUserId: actorId,
      note: GATE_FAIL_NOTE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(await membershipCount(seasonA)).toBe(before);
    // recordDataEdit has no try/catch by design, so the canonical row and the
    // durable record go with it. Neither may be left behind.
    const [orphan] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members WHERE player_id = ${player}`;
    expect(orphan.n).toBe(0);
    const [record] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_overrides
       WHERE entity_type = 'season_list_members'
         AND override_values->>'player_identity' LIKE ${'%audit-rollback%'}`;
    expect(record.n).toBe(0);
  });

  it('rolls the whole add back when the override write fails', async () => {
    const player = await createIdentifiedPlayer('Override Rollback');
    const before = await membershipCount(seasonA);
    const result = await addSeasonListMember({
      season: seasonA, clubSlug: clubA.slug, playerId: player, adminUserId: actorId,
      note: 'AFLDB-ISSUE-161-OVERRIDE-FORCE-FAIL',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(await membershipCount(seasonA)).toBe(before);
    // And no orphan canonical row, and no audit row claiming an edit that did
    // not survive — I-9: a membership that is not durable is not written at all.
    const [orphan] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members WHERE player_id = ${player}`;
    expect(orphan.n).toBe(0);
    const audits = await auditRows(player, 'season_list_added');
    expect(audits).toEqual([]);
  });

  it('rolls a multi-select add back entirely when one player of it refuses', async () => {
    const before = await membershipCount(seasonA);
    const fresh = await createIdentifiedPlayer('Multi One');

    // The second player is already listed, so the whole selection must refuse
    // and the first must NOT have been written.
    const result = await addSeasonListMembers({
      season: seasonA, clubSlug: clubA.slug,
      playerIds: [fresh, aflPlayerId], adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate');
    expect(await membershipCount(seasonA)).toBe(before);
    const [written] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members WHERE player_id = ${fresh}`;
    expect(written.n).toBe(0);
  });
});

describe('the appearances review projection is not a list (§23, D-2)', () => {
  it('offers who PLAYED last season, and writes absolutely nothing by itself', async () => {
    const overridesBefore = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'season_list_members'`;
    const membersBefore = await membershipCount(seasonA);

    const candidates = await readAppearanceReviewCandidates(seasonA, clubA.slug);
    // maxYear is a played season on this database, so the projection is not empty.
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].candidateSource).toBe(`appearances:${maxYear}`);

    expect((await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM data_overrides WHERE entity_type = 'season_list_members'
    `)[0].n).toBe(overridesBefore[0].n);
    expect(await membershipCount(seasonA)).toBe(membersBefore);
  });

  it('excludes anyone already listed in the target season', async () => {
    const candidates = await readAppearanceReviewCandidates(seasonA, clubA.slug);
    expect(candidates.some((c) => c.playerId === aflPlayerId)).toBe(false);
  });

  it('records candidate_source as evidence when a human explicitly picks one', async () => {
    const candidates = await readAppearanceReviewCandidates(seasonA, clubA.slug);
    const chosen = candidates.slice(0, 2).map((c) => c.playerId);
    const result = await addSeasonListMembers({
      season: seasonA, clubSlug: clubA.slug, playerIds: chosen, adminUserId: actorId,
      candidateSource: `appearances:${maxYear}`,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(chosen.length);

    for (const key of result.entityKeys) {
      const [override] = await readSeasonListOverrides(key);
      // origin is 'added' — an ordinary explicit decision. There is no
      // appearance-derived origin, and candidate_source is evidence only.
      expect(override.overrideValues.origin).toBe('added');
      expect(override.overrideValues.candidate_source).toBe(`appearances:${maxYear}`);
    }
    const [rows] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members
       WHERE season = ${seasonA} AND origin <> 'added' AND player_id = ANY(${chosen}::int[])`;
    expect(rows.n).toBe(0);
  });
});

describe('copy forward (§11a)', () => {
  it('refuses to copy into the first authoritative season, and says what to do instead', async () => {
    const result = await copySeasonListsForward({
      season: FIRST_LIST_SEASON, clubs: 'all', dryRun: false, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Either "nothing to copy" (no FIRST_LIST_SEASON-1 list can exist) or the
    // bound refusal — never a silent seed from appearances.
    expect(['validation', 'not_found']).toContain(result.reason);
  });

  it('previews without writing, then copies with copied_list provenance', async () => {
    const sourceCount = await membershipCount(seasonA);
    expect(sourceCount).toBeGreaterThan(0);

    const preview = await copySeasonListsForward({
      season: seasonB, clubs: 'all', dryRun: true, adminUserId: actorId,
    });
    expect(preview.ok, JSON.stringify(preview)).toBe(true);
    if (!preview.ok) return;
    expect(preview.dryRun).toBe(true);
    expect(preview.copied).toBe(0);
    expect(preview.clubs.reduce((n, c) => n + c.players, 0)).toBe(sourceCount);
    expect(await membershipCount(seasonB)).toBe(0);

    const done = await copySeasonListsForward({
      season: seasonB, clubs: 'all', dryRun: false, adminUserId: actorId,
    });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    expect(done.copied).toBe(sourceCount);
    expect(await membershipCount(seasonB)).toBe(sourceCount);

    const [provenance] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members
       WHERE season = ${seasonB} AND origin = 'copied_list' AND copied_from_season = ${seasonA}`;
    expect(provenance.n).toBe(sourceCount);

    // Every row of one copy shares a batch_id, so the audit viewer can group it.
    const batchIds = await admin<{ batchId: string }[]>`
      SELECT DISTINCT new_values->>'batch_id' AS "batchId" FROM data_edits
       WHERE table_name = 'players' AND field_group = 'season_list_added'
         AND (new_values->>'season')::int = ${seasonB}`;
    expect(batchIds).toHaveLength(1);
    expect(batchIds[0].batchId).toBe(done.batchId);
  });

  it('refuses when a target club already holds rows, naming it, before any write', async () => {
    const before = await membershipCount(seasonB);
    const result = await copySeasonListsForward({
      season: seasonB, clubs: 'all', dryRun: false, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    expect(result.subjects?.length).toBeGreaterThan(0);
    expect(await membershipCount(seasonB)).toBe(before);
  });

  it('refuses a requested club that is not eligible in the target season', async () => {
    const [gone] = await sql<{ slug: string }[]>`
      SELECT slug FROM clubs WHERE NOT is_current_afl_club ORDER BY id LIMIT 1`;
    const result = await copySeasonListsForward({
      season: seasonB, clubs: [gone.slug], dryRun: true, adminUserId: actorId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validation');
      expect(result.subjects).toContain(gone.slug);
    }
  });

  it('keeps I-1 across the copy: nobody gained two list places', async () => {
    const [dup] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT season, player_id FROM season_list_members
         WHERE season IN (${seasonA}, ${seasonB})
         GROUP BY 1, 2 HAVING count(*) > 1) x`;
    expect(dup.n).toBe(0);
  });
});

describe('derivations (§8)', () => {
  it('reads the current list season from the data, never from a clock', async () => {
    expect(await currentListSeason()).toBe(seasonB);
  });

  it('reports per-club completeness so "no membership" is never read as "retired"', async () => {
    const overview = await readSeasonListOverview(seasonA);
    expect(overview.length).toBeGreaterThan(1);
    const withMembers = overview.filter((c) => c.members > 0);
    const empty = overview.filter((c) => c.members === 0);
    expect(withMembers.length).toBeGreaterThan(0);
    // The incompleteness is visible: most clubs have no list in the fixture
    // season, which is exactly the state §8 says consumers must read as UNKNOWN.
    expect(empty.length).toBeGreaterThan(0);
  });

  it('reports no played-not-listed diagnostics for a season with no matches', async () => {
    expect(await readPlayedNotListed(seasonA, clubA.slug)).toEqual([]);
  });
});

describe('replay and rebuild (§19)', () => {
  it.runIf(canReplay)('re-creates every membership a rebuild removed, with the same keys', async () => {
    const before = await admin<{ season: number; clubId: number; playerId: number; origin: string }[]>`
      SELECT season::int AS season, club_id AS "clubId", player_id AS "playerId", origin
        FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})
       ORDER BY season, club_id, player_id`;
    expect(before.length).toBeGreaterThan(0);

    // Exactly what a promotion does to a registry table: the rows are gone and
    // only the durable record remains.
    await admin`DELETE FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})`;
    expect(await membershipCount(seasonA)).toBe(0);

    const replay = runReplay('season_list_members');
    expect(replay.stderr + replay.stdout).toContain('REPLAY OK');

    const after = await admin<{ season: number; clubId: number; playerId: number; origin: string }[]>`
      SELECT season::int AS season, club_id AS "clubId", player_id AS "playerId", origin
        FROM season_list_members WHERE season IN (${seasonA}, ${seasonB})
       ORDER BY season, club_id, player_id`;
    expect(after).toEqual(before);
  });

  it.runIf(canReplay)('is idempotent: a second replay changes nothing', async () => {
    const before = await membershipCount(seasonA) + await membershipCount(seasonB);
    const replay = runReplay('season_list_members');
    expect(replay.stderr + replay.stdout).toContain('REPLAY OK');
    expect(await membershipCount(seasonA) + await membershipCount(seasonB)).toBe(before);
  });

  it.runIf(canReplay)('will not resurrect a tombstoned membership, whoever planted the row', async () => {
    // The namesake was removed and then re-added, so take a fresh tombstone: the
    // transfer left one behind for the club the player moved away from.
    const [tombstone] = await admin<{ entityKey: string }[]>`
      SELECT entity_key AS "entityKey" FROM data_overrides
       WHERE entity_type = 'season_list_members' AND is_active = false
         AND (override_values->>'season')::int = ${seasonA}
       LIMIT 1`;
    expect(tombstone).toBeDefined();
    const [, , identity] = [
      tombstone.entityKey.slice(0, tombstone.entityKey.indexOf('|')),
      seasonA,
      tombstone.entityKey.slice(tombstone.entityKey.indexOf('|', tombstone.entityKey.indexOf('|') + 1) + 1),
    ];

    const [club] = await admin<{ id: number }[]>`
      SELECT id FROM clubs WHERE slug = ${tombstone.entityKey.slice(0, tombstone.entityKey.indexOf('|'))}`;
    const [player] = await admin<{ playerId: number }[]>`
      SELECT e.player_id AS "playerId" FROM external_identities e
        JOIN sources s ON s.id = e.source_id
       WHERE s.key = split_part(${identity}, ':', 1)
         AND e.external_id = substring(${identity} from position(':' in ${identity}) + 1)
         AND e.status IN ('unique', 'resolved')`;

    // A foreign source (or a stale dump) plants the row the tombstone forbids.
    // It must not survive the replay — the removal was a decision, and a reload
    // that silently undid it is the failure the tombstone exists to prevent.
    // It cannot be the player's only place in the season, so clear that first.
    await admin`
      DELETE FROM season_list_members
       WHERE season = ${seasonA} AND player_id = ${player.playerId}`;
    await admin`
      INSERT INTO season_list_members (season, club_id, player_id, source_id, origin)
      VALUES (${seasonA}, ${club.id}, ${player.playerId},
              (SELECT id FROM sources WHERE key = 'manual_admin_edit'), 'imported')`;

    const replay = runReplay('season_list_members');
    expect(replay.stderr + replay.stdout).toContain('REPLAY OK');

    const [survived] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM season_list_members
       WHERE season = ${seasonA} AND club_id = ${club.id} AND player_id = ${player.playerId}`;
    expect(survived.n).toBe(0);
  });

  it.runIf(canReplay)('fails the WHOLE batch closed on an unresolvable record, writing nothing', async () => {
    const before = await membershipCount(seasonA);
    await admin`
      INSERT INTO data_overrides
            (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('season_list_members',
              ${`${clubA.slug}|${seasonA}|afltables:players/Z/${MARKER}-does-not-exist.html`},
              'membership',
              ${admin.json({
                club_slug: clubA.slug, season: seasonA, origin: 'added',
                player_identity: `afltables:players/Z/${MARKER}-does-not-exist.html`,
              })},
              ${actorId}, true)`;

    const replay = runReplay('season_list_members');
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('refusing to commit');
    expect(replay.stderr).toContain('player_identity does not resolve to exactly one player');
    // Nothing was written: the refusal happens before the first statement and
    // the connection is closed without a commit.
    expect(await membershipCount(seasonA)).toBe(before);

    await admin`
      DELETE FROM data_overrides
       WHERE entity_type = 'season_list_members' AND entity_key LIKE ${`%${MARKER}-does-not-exist%`}`;
  });

  it.runIf(canReplay)('refuses an unresolvable TOMBSTONE just as hard as a membership', async () => {
    await admin`
      INSERT INTO data_overrides
            (entity_type, entity_key, field_group, override_values, admin_user_id, is_active)
      VALUES ('season_list_members',
              ${`not-a-real-club|${seasonA}|${aflIdentity}`}, 'membership',
              ${admin.json({
                club_slug: 'not-a-real-club', season: seasonA, origin: 'added',
                player_identity: aflIdentity,
              })},
              ${actorId}, false)`;

    const replay = runReplay('season_list_members');
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('club_slug does not resolve to exactly one club');

    await admin`
      DELETE FROM data_overrides
       WHERE entity_type = 'season_list_members' AND entity_key LIKE 'not-a-real-club|%'`;
  });
});
