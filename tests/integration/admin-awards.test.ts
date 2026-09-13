/**
 * Awards & honours administration against a real PostgreSQL (AFLDB-ISSUE-165
 * Stages 1-3).
 *
 * These are the claims that can be proved nowhere else: that migration 101's
 * CHECKs and its ACTIVE-ROW-ONLY identity indexes really hold; that a mutation
 * writes the canonical row, the `data_overrides` durable record and the
 * `data_edits` audit row TOGETHER and rolls all three back on any failure; that
 * the REAL `reload_keyed()` and `replay_admin_overrides()` out of
 * `tools/migration/common.py` — which is what an import and a promotion run —
 * leave a lifecycle decision alone on an ordinary reload and RESTORE a
 * correction after a destructive one; that D-9's three missing-target answers
 * are the three the code actually gives; and that `awards.first_season` /
 * `last_season` move with a void inside the same transaction.
 *
 * FIXTURES: every row is created under an `AFLDB-ISSUE-165-TEST` marker, on a
 * fixture award of this suite's own making, and removed in `afterAll`. No real
 * award, inductee, honour team, player or club row is written to.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  awardWinnerEntityKey,
  correctAwardWinner,
  correctHallOfFameInductee,
  correctHonourTeamMember,
  createAwardWinner,
  createHallOfFameInductee,
  createHonourTeamMember,
  hallOfFameEntityKey,
  honourTeamEntityKey,
  readAwardWinner,
  readHallOfFameInductee,
  readHonourTeamMember,
  reinstateAwardWinner,
  replaceAwardWinner,
  replaceHallOfFameInductee,
  voidAwardWinner,
  voidHallOfFameInductee,
  voidHonourTeamMember,
} from '@/db/queries/admin-awards';
import { listUnresolvedLinks } from '@/db/queries/player-links';

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

/**
 * FIXTURE ISOLATION (repaired after the first DB-backed run).
 *
 * The first version of this suite shared ONE fixture award, ONE player and ONE
 * season across every test, and three failures followed directly from that —
 * none of them a defect in the code under test:
 *
 *   * the award-span test voided its winner and expected the award to span
 *     nothing, while eight earlier tests had left ACTIVE winners on the same
 *     award. `recomputeAwardSpan()` was right and the expectation was wrong;
 *   * the duplicate-confirmation test's FIRST create was refused as a
 *     duplicate, because earlier tests had already recorded that player on that
 *     award in that season — the duplicate check working exactly as designed;
 *   * the destructive-rebuild test could not create its row for the same reason.
 *
 * The repair is one rule: **every test that writes owns its own identity.** An
 * award is one INSERT, so each test makes its own; Hall of Fame names and
 * honour-team names carry the test's own tag. Nothing is shared but the season
 * and the two players, and neither of those can collide once the awards differ.
 *
 * REPEATABILITY is the second half, and it is what `purgeFixtures()` is for. It
 * runs in `beforeAll` AND `afterAll`, and it is keyed on two STABLE prefixes
 * (never a per-run nonce), so it also removes debris a CRASHED earlier run left
 * behind. One leak from the first run proved the need: a manual award winner's
 * durable record is keyed `manual_admin_edit:award_winner:<uuid>`, which carries
 * neither the marker nor the award slug, so the original cleanup missed it — and
 * a `record` override naming an award that no longer exists fails the next run's
 * replay closed. `purgeFixtures()` therefore also matches on the payload.
 */
const MARKER = 'AFLDB-ISSUE-165-TEST';
/** Every fixture award slug begins with this. Cleanup keys on it. */
const AWARD_PREFIX = 'afldb-issue-165-test-';
const AUDIT_FAIL_NOTE = 'AFLDB-ISSUE-165-GATE-FORCE-FAIL';

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

function runPython(body: string[]) {
  const script = [
    'import sys, os',
    `sys.path.insert(0, ${JSON.stringify(join(root, 'tools', 'migration'))})`,
    'import psycopg',
    'conn = psycopg.connect(os.environ["AFLDB_REPLAY_DSN"])',
    ...body,
  ].join('\n');
  return spawnSync(python, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AFLDB_REPLAY_DSN: testDbUrl },
  });
}

/**
 * Run the REAL `replay_admin_overrides` out of `tools/migration/common.py`.
 * Spawning the real function is the point: a reimplementation of the replay in
 * TypeScript would prove only that two pieces of test code agree.
 */
function runReplay(...tables: string[]) {
  return runPython([
    'from common import replay_admin_overrides',
    'try:',
    `    for table in ${JSON.stringify(tables)}:`,
    '        replay_admin_overrides(conn, table)',
    '    conn.commit()',
    'finally:',
    '    conn.close()',
    'print("REPLAY OK")',
  ]);
}

/**
 * Run the REAL `reload_keyed()` over the isolated reload fixture award, with the
 * exact key and column list `import_awards.py` passes for an award_winners
 * group. This is what proves the ORDINARY reload leaves `status` alone — the
 * whole reason migration 101 could add the column without an override for that
 * case — and that a corrected column IS reverted, which is why the correction
 * needs one.
 */
function runAwardReload(scopeAwardId: number, rows: unknown[][]) {
  return runPython([
    'import json',
    'from common import reload_keyed',
    `rows = json.loads(${JSON.stringify(JSON.stringify(rows))})`,
    'try:',
    '    reload_keyed(',
    '        conn, "award_winners", ["source_id", "source_record_id"],',
    '        ["award_id", "season", "player_id", "player_name_raw", "link_status_value",',
    '         "candidate_count", "club_id", "club_name_raw", "votes", "position",',
    '         "is_captain", "is_vice_captain", "note", "source_id", "source_record_id",',
    '         "import_batch_id"],',
    '        (tuple(r) for r in rows), None,',
    '        target_table="award_winners",',
    `        scope_column="award_id", scope_values=[${scopeAwardId}],`,
    `        scopes=[("source_id", [${wikipediaSourceId}], False)],`,
    '    )',
    '    conn.commit()',
    'finally:',
    '    conn.close()',
    'print("RELOAD OK")',
  ]);
}

let actorId = 0;
let createdThrowawayAdmin = false;
let season = 0;
let wikipediaSourceId = 0;
const createdPlayerIds = new Set<number>();
let linkedPlayerId = 0;
let linkedPlayerIdentity = '';
let secondPlayerId = 0;
let secondPlayerIdentity = '';

/**
 * One fixture award per test, named after it.
 *
 * Cheap (a single INSERT) and it is what makes every per-award invariant —
 * the duplicate check on `(award_id, season, player_id)`, and
 * `awards.first_season`/`last_season` — a statement about THIS test's rows and
 * nothing else. `award_winners.award_id` is `ON DELETE CASCADE`, so dropping
 * the award at the end takes its winners with it.
 */
async function makeAward(tag: string): Promise<number> {
  const slug = `${AWARD_PREFIX}${tag}`;
  const [row] = await admin<{ id: number }[]>`
    INSERT INTO awards (slug, name, category, competition)
    VALUES (${slug}, ${`${MARKER} ${tag}`}, 'award', 'AFL')
    RETURNING id`;
  return row.id;
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

async function attachAflIdentity(playerId: number, suffix: string): Promise<string> {
  const path = `players/T/${MARKER}${suffix}.html`;
  await admin`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES ((SELECT id FROM sources WHERE key = 'afltables'),
            ${path}, ${playerId}, 'unique', 'afltables_profile_url')`;
  return `afltables:${path}`;
}

/** A source-owned winner of the given award, as the wikipedia loader would leave one. */
async function seedSourceWinner(awardId: number, recordId: string, over: {
  playerId?: number | null; playerName?: string; votes?: string | null; note?: string | null;
} = {}): Promise<number> {
  const [row] = await admin<{ id: number }[]>`
    INSERT INTO award_winners
      (award_id, season, player_id, player_name_raw, link_status_value,
       club_id, club_name_raw, votes, position, note, source_id, source_record_id)
    VALUES (${awardId}, ${season}::smallint, ${over.playerId ?? linkedPlayerId},
            ${over.playerName ?? `${MARKER} Linked`},
            ${over.playerId === null ? 'unmatched' : 'resolved'}::link_status,
            NULL, NULL, ${over.votes ?? '12.00'}::numeric, NULL,
            ${over.note ?? null}, ${wikipediaSourceId}, ${recordId})
    RETURNING id`;
  return row.id;
}

async function winnerRow(id: number) {
  const [row] = await admin<{
    status: string; statusReason: string | null; votes: string | null; note: string | null;
    season: number; playerId: number | null; updatedAt: string;
  }[]>`
    SELECT status, status_reason AS "statusReason", votes::text AS votes, note,
           season::int AS season, player_id AS "playerId", updated_at::text AS "updatedAt"
      FROM award_winners WHERE id = ${id}`;
  return row ?? null;
}

async function overridesFor(entityType: string, entityKey: string) {
  return admin<{ fieldGroup: string; values: Record<string, unknown>; isActive: boolean }[]>`
    SELECT field_group AS "fieldGroup", override_values AS values, is_active AS "isActive"
      FROM data_overrides
     WHERE entity_type = ${entityType} AND entity_key = ${entityKey}
     ORDER BY field_group`;
}

async function auditRows(table: string, rowId: number) {
  return admin<{ fieldGroup: string; newValues: Record<string, unknown> }[]>`
    SELECT field_group AS "fieldGroup", new_values AS "newValues"
      FROM data_edits WHERE table_name = ${table} AND row_id = ${rowId} ORDER BY id`;
}

/**
 * Remove every row this suite can create, keyed on two STABLE prefixes so a
 * crashed earlier run is cleaned up too. Runs in `beforeAll` AND `afterAll`.
 *
 * Deliberately narrow: nothing is deleted that does not carry
 * `AFLDB-ISSUE-165-TEST` in a name or key, sit on an `afldb-issue-165-test-*`
 * award, or name one of those awards in its override payload. No real award,
 * inductee, honour team, player, override or audit row is inside any of these
 * predicates.
 *
 * The override sweep matches on the PAYLOAD as well as the key, and that is not
 * belt-and-braces. A manual award winner's durable record is keyed
 * `manual_admin_edit:award_winner:<uuid>`, which carries neither prefix — the
 * first DB-backed run leaked exactly one of those, and a `record` override
 * naming an award that no longer exists fails the NEXT run's replay closed with
 * "award_slug does not resolve to an award".
 */
async function purgeFixtures(): Promise<void> {
  const markerLike = `%${MARKER}%`;
  const markerPrefix = `${MARKER}%`;
  const awardLike = `${AWARD_PREFIX}%`;

  await admin`
    DELETE FROM data_edits
     WHERE table_name IN ('award_winners', 'hall_of_fame', 'honour_team_members')
       AND (new_values->>'entity_key' LIKE ${markerLike}
            OR new_values->>'award_slug' LIKE ${awardLike}
            OR new_values->>'team_name' LIKE ${markerPrefix}
            OR new_values->>'name' LIKE ${markerPrefix}
            OR new_values->>'player_name_raw' LIKE ${markerPrefix})`;
  await admin`
    DELETE FROM data_overrides
     WHERE entity_type IN ('award_winners', 'hall_of_fame', 'honour_team_members')
       AND (entity_key LIKE ${markerLike}
            OR entity_key LIKE ${`%${AWARD_PREFIX}%`}
            OR override_values->>'award_slug' LIKE ${awardLike}
            OR override_values->>'player_name_raw' LIKE ${markerPrefix})`;
  await admin`
    DELETE FROM award_winners
     WHERE award_id IN (SELECT id FROM awards WHERE slug LIKE ${awardLike})
        OR player_name_raw LIKE ${markerPrefix}`;
  await admin`DELETE FROM hall_of_fame WHERE name LIKE ${markerPrefix}`;
  await admin`DELETE FROM honour_team_members WHERE team_name LIKE ${markerPrefix}`;
  // The awards last: the CASCADE on award_winners.award_id takes any winner the
  // sweep above could not name.
  await admin`DELETE FROM awards WHERE slug LIKE ${awardLike}`;
  // And the fixture players, which exist only to be linked from the rows above.
  await admin`
    DELETE FROM external_identities
     WHERE player_id IN (SELECT id FROM players WHERE display_name LIKE ${markerPrefix})`;
  await admin`DELETE FROM players WHERE display_name LIKE ${markerPrefix}`;
}

beforeAll(async () => {
  const [bound] = await sql<{ year: number }[]>`SELECT max(year)::int AS year FROM seasons`;
  season = bound.year;

  const [existingAdmin] = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existingAdmin) {
    actorId = existingAdmin.id;
  } else {
    const [created] = await admin<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-165-awards-test@example.test', 'super_admin') RETURNING id`;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  const [wikipedia] = await admin<{ id: number }[]>`SELECT id FROM sources WHERE key = 'wikipedia'`;
  wikipediaSourceId = wikipedia.id;

  // Debris from a crashed earlier run would be REPLAYED by this one, so the
  // suite clears its own prefixes before it starts rather than assuming the
  // last run exited cleanly.
  await purgeFixtures();

  linkedPlayerId = await createPlayer(`${MARKER} Linked`);
  linkedPlayerIdentity = await attachAflIdentity(linkedPlayerId, 'Linked');
  secondPlayerId = await createPlayer(`${MARKER} Second`);
  secondPlayerIdentity = await attachAflIdentity(secondPlayerId, 'Second');
});

afterAll(async () => {
  await purgeFixtures();
  // Belt and braces for a player whose display name the suite changed: the
  // prefix sweep above is the general rule, this is the exact set.
  for (const id of createdPlayerIds) {
    await admin`DELETE FROM external_identities WHERE player_id = ${id}`;
    await admin`DELETE FROM players WHERE id = ${id}`;
  }
  if (createdThrowawayAdmin) await admin`DELETE FROM auth_users WHERE id = ${actorId}`;
  await admin.end({ timeout: 5 });
});

// -------------------------------------------------------------------------

describe('migration 101 — the schema the lifecycle stands on', () => {
  it('applies cleanly: three columns and two CHECKs on each of the three tables', async () => {
    const columns = await admin<{ table: string; column: string; nullable: string }[]>`
      SELECT table_name AS table, column_name AS column, is_nullable AS nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('award_winners', 'hall_of_fame', 'honour_team_members')
         AND column_name IN ('status', 'status_reason', 'updated_at')
       ORDER BY table_name, column_name`;
    expect(columns).toHaveLength(9);
    for (const c of columns) {
      expect(c.nullable, `${c.table}.${c.column}`)
        .toBe(c.column === 'status_reason' ? 'YES' : 'NO');
    }
    // created_at is deliberately absent (§8): data_edits already records when a
    // row was made and by whom.
    const [created] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'created_at'
         AND table_name IN ('award_winners', 'hall_of_fame', 'honour_team_members')`;
    expect(created.n).toBe(0);

    // Each constraint is named and checked EXPLICITLY. The first version of
    // this assertion counted `conname LIKE '%status%'` and expected 6, which
    // can only ever find 3: `<table>_void_reason_ck` does not contain the word
    // "status". That was a defect in the query, not in the migration — the
    // schema constraints are correctly named and are NOT renamed to suit it.
    const required = ['award_winners', 'hall_of_fame', 'honour_team_members']
      .flatMap((t) => [`${t}_status_ck`, `${t}_void_reason_ck`]);
    const checks = await admin<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid IN ('award_winners'::regclass, 'hall_of_fame'::regclass,
                          'honour_team_members'::regclass)
         AND contype = 'c'
         AND conname = ANY(${required})
       ORDER BY conname`;
    expect(checks.map((c) => c.name)).toEqual([...required].sort());

    const byName = new Map(checks.map((c) => [c.name, c.def] as const));
    for (const table of ['award_winners', 'hall_of_fame', 'honour_team_members']) {
      const status = byName.get(`${table}_status_ck`)!;
      expect(status, table).toContain("'active'");
      expect(status, table).toContain("'void'");
      // Two states, not three: an award result, an induction or a team
      // selection does not cease the way an appointment does.
      expect(status, table).not.toContain("'ended'");

      const reason = byName.get(`${table}_void_reason_ck`)!;
      expect(reason, table).toContain('status_reason');
      expect(reason, table).toContain("'void'");
    }
  });

  it('makes the identity keys active-row-only, and leaves award_winners alone', async () => {
    const indexes = await admin<{ name: string; def: string }[]>`
      SELECT indexname AS name, indexdef AS def FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('hall_of_fame_active_name_uq', 'honour_team_linked_player_uq',
                           'honour_team_unlinked_name_uq')
       ORDER BY indexname`;
    expect(indexes.map((i) => i.name)).toEqual([
      'hall_of_fame_active_name_uq', 'honour_team_linked_player_uq',
      'honour_team_unlinked_name_uq',
    ]);
    for (const index of indexes) expect(index.def).toContain("status <> 'void'");
    expect(indexes[0].def).toContain('NULLS NOT DISTINCT');

    // 042's global constraint is gone; award_winners' source key is untouched.
    const [gone] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'hall_of_fame_name_uq'`;
    expect(gone.n).toBe(0);
    const [kept] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'award_winners_source_uq'`;
    expect(kept.n).toBe(1);
  });

  it('admits the three entity types and no settle target', async () => {
    const [check] = await admin<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'data_overrides_entity_type_check'`;
    for (const entity of ['award_winners', 'hall_of_fame', 'honour_team_members',
      'players', 'club_leadership']) {
      expect(check.def).toContain(entity);
    }
    for (const settle of ['match_period_scores', 'player_match_stats', 'brownlow_round_votes']) {
      expect(check.def).not.toContain(settle);
    }
  });

  it('B-1 holds on this database: every award winner carries a durable key', async () => {
    const [counts] = await admin<{ total: number; noSource: number; noRecord: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE source_id IS NULL)::int AS "noSource",
             count(*) FILTER (WHERE source_record_id IS NULL)::int AS "noRecord"
        FROM award_winners`;
    expect(counts.noSource).toBe(0);
    expect(counts.noRecord).toBe(0);
    expect(counts.total).toBeGreaterThan(0);
  });
});

describe('award_winners — correction, void, reinstate, replace', () => {
  it('corrects a source-owned row as a DELTA, and audits it atomically', async () => {
    const awardId = await makeAward('correct');
    const recordId = `${MARKER}:correct`;
    const id = await seedSourceWinner(awardId, recordId, { votes: '12.00', note: null });
    const before = await winnerRow(id);

    const result = await correctAwardWinner({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: actorId,
      fields: { votes: '15.5', note: 'recount' },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const after = await winnerRow(id);
    expect(after!.votes).toBe('15.50');
    expect(after!.note).toBe('recount');

    // The durable record is a DELTA under 'correction' — only what changed, so
    // the reload keeps supplying everything else.
    const key = awardWinnerEntityKey('wikipedia', recordId);
    const overrides = await overridesFor('award_winners', key);
    expect(overrides).toHaveLength(1);
    expect(overrides[0].fieldGroup).toBe('correction');
    expect(Object.keys(overrides[0].values).sort()).toEqual(['note', 'votes']);
    expect(overrides[0].isActive).toBe(true);

    const audit = await auditRows('award_winners', id);
    expect(audit).toHaveLength(1);
    expect(audit[0].fieldGroup).toBe('award_winner_corrected');
    expect(audit[0].newValues.entity_key).toBe(key);
  });

  it('refuses a stale expectedUpdatedAt without writing anything', async () => {
    const awardId = await makeAward('stale');
    const recordId = `${MARKER}:stale`;
    const id = await seedSourceWinner(awardId, recordId);
    const before = await winnerRow(id);

    const result = await correctAwardWinner({
      rowId: id,
      expectedUpdatedAt: '1999-01-01 00:00:00+00',
      adminUserId: actorId,
      fields: { note: 'should not land' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale');

    const after = await winnerRow(id);
    expect(after!.note).toBe(before!.note);
    expect(await overridesFor('award_winners', awardWinnerEntityKey('wikipedia', recordId)))
      .toHaveLength(0);
    expect(await auditRows('award_winners', id)).toHaveLength(0);
  });

  it('refuses to correct an identity-bearing field at all', async () => {
    const awardId = await makeAward('identity');
    const id = await seedSourceWinner(awardId, `${MARKER}:identity`);
    const row = await winnerRow(id);
    const result = await correctAwardWinner({
      rowId: id,
      expectedUpdatedAt: row!.updatedAt,
      adminUserId: actorId,
      fields: { note: 'x' },
      identityAttempt: { playerId: secondPlayerId },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('forbidden');
      expect(result.error).toContain('Void this award winner');
    }
    expect(await auditRows('award_winners', id)).toHaveLength(0);
  });

  it('refuses a row with no durable key (B-1 defensive path)', async () => {
    const awardId = await makeAward('keyless');
    const [row] = await admin<{ id: number }[]>`
      INSERT INTO award_winners
        (award_id, season, player_name_raw, link_status_value, source_id, source_record_id)
      VALUES (${awardId}, ${season}::smallint, ${`${MARKER} Keyless`},
              'unmatched'::link_status, NULL, NULL)
      RETURNING id`;
    const current = await winnerRow(row.id);
    const result = await voidAwardWinner({
      rowId: row.id,
      expectedUpdatedAt: current!.updatedAt,
      adminUserId: actorId,
      reason: 'wrong',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_durable_key');
    expect((await winnerRow(row.id))!.status).toBe('active');
    await admin`DELETE FROM award_winners WHERE id = ${row.id}`;
  });

  it('voids, reinstates, and moves the award span inside the same transaction (D-11)', async () => {
    // This test's award has exactly ONE winner, which is what makes the
    // expectation below a statement about the invariant rather than about
    // whatever earlier tests happened to leave behind.
    const awardId = await makeAward('span');
    const recordId = `${MARKER}:span`;
    const id = await seedSourceWinner(awardId, recordId);
    await admin`UPDATE awards SET first_season = ${season}::smallint,
                                  last_season = ${season}::smallint WHERE id = ${awardId}`;

    const row = await winnerRow(id);
    const voided = await voidAwardWinner({
      rowId: id, expectedUpdatedAt: row!.updatedAt, adminUserId: actorId,
      reason: 'entered against the wrong award',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);
    expect((await winnerRow(id))!.status).toBe('void');

    // The only winner is void, so the award spans nothing. Honest, rather than
    // a stale span kept for tidiness.
    const [spanAfterVoid] = await admin<{ first: number | null; last: number | null }[]>`
      SELECT first_season::int AS first, last_season::int AS last FROM awards WHERE id = ${awardId}`;
    expect(spanAfterVoid.first).toBeNull();
    expect(spanAfterVoid.last).toBeNull();

    const overrides = await overridesFor('award_winners', awardWinnerEntityKey('wikipedia', recordId));
    expect(overrides.map((o) => o.fieldGroup)).toEqual(['lifecycle']);
    expect(overrides[0].values.status).toBe('void');
    expect(overrides[0].values.status_reason).toBe('entered against the wrong award');

    const reinstated = await reinstateAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
    });
    expect(reinstated.ok, JSON.stringify(reinstated)).toBe(true);
    expect((await winnerRow(id))!.status).toBe('active');
    expect((await winnerRow(id))!.statusReason).toBeNull();
    const [spanAfterReinstate] = await admin<{ first: number | null }[]>`
      SELECT first_season::int AS first FROM awards WHERE id = ${awardId}`;
    expect(spanAfterReinstate.first).toBe(season);
  });

  it('voids a voided row no further, and refuses a second void', async () => {
    const awardId = await makeAward('twice');
    const id = await seedSourceWinner(awardId, `${MARKER}:twice`);
    const first = await voidAwardWinner({
      rowId: id, expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId, reason: 'duplicate',
    });
    expect(first.ok).toBe(true);
    const second = await voidAwardWinner({
      rowId: id, expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId, reason: 'duplicate again',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('invalid_transition');
  });

  it('replaces the wrong winner with the right one, cross-linked by natural key', async () => {
    const awardId = await makeAward('replace');
    const recordId = `${MARKER}:replace`;
    const id = await seedSourceWinner(awardId, recordId);
    const result = await replaceAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
      reason: 'the wrong player was recorded',
      replacement: { awardId, season, playerId: secondPlayerId },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect((await winnerRow(id))!.status).toBe('void');
    const replacement = await readAwardWinner(result.rowId);
    expect(replacement!.status).toBe('active');
    expect(replacement!.playerId).toBe(secondPlayerId);
    expect(replacement!.sourceKey).toBe('manual_admin_edit');

    // Cross-linked by NATURAL KEY, never by surrogate id: a rebuild and a
    // promotion both renumber these rows.
    const oldKey = awardWinnerEntityKey('wikipedia', recordId);
    const [oldOverride] = await overridesFor('award_winners', oldKey);
    expect(oldOverride.fieldGroup).toBe('lifecycle');
    expect(oldOverride.values.replaced_by_key).toBe(result.entityKey);
    const [newOverride] = await overridesFor('award_winners', result.entityKey);
    expect(newOverride.fieldGroup).toBe('record');
    expect(newOverride.values.replaces_key).toBe(oldKey);
    expect(newOverride.values.player_identity).toBe(secondPlayerIdentity);
    for (const value of [
      JSON.stringify(oldOverride.values), JSON.stringify(newOverride.values),
    ]) {
      expect(value).not.toContain(`"${id}"`);
      expect(value).not.toContain('row_id');
    }
  });

  it('surfaces a same-player duplicate for confirmation rather than refusing it (R-5)', async () => {
    // Its OWN award, so the first create below is genuinely the first row for
    // this (award, season, player). Sharing one award across the suite is what
    // made this test's first create refuse on the first DB-backed run.
    const awardId = await makeAward('duplicate');
    const first = await createAwardWinner({
      awardId, season, playerId: linkedPlayerId, adminUserId: actorId,
    });
    expect(first.ok, JSON.stringify(first)).toBe(true);

    const second = await createAwardWinner({
      awardId, season, playerId: linkedPlayerId, adminUserId: actorId,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('duplicate');
      expect(second.error).toContain('1984 All-Australian');
    }

    // The 1984 All-Australian shape: two legitimate rows for one player in one
    // award season, which migration 042 exists to keep representable.
    const confirmed = await createAwardWinner({
      awardId, season, playerId: linkedPlayerId, adminUserId: actorId, confirmDuplicate: true,
    });
    expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);
  });

  it('rolls the canonical write back when its audit row cannot be written', async () => {
    // data_edits.note is capped at 2000 characters by the writer, so the forced
    // failure is an admin_user_id that no auth_users row carries: the audit
    // INSERT then violates its foreign key and must take the UPDATE with it.
    const awardId = await makeAward('atomic');
    const recordId = `${MARKER}:atomic`;
    const id = await seedSourceWinner(awardId, recordId, { note: AUDIT_FAIL_NOTE });
    const before = await winnerRow(id);

    const result = await voidAwardWinner({
      rowId: id,
      expectedUpdatedAt: before!.updatedAt,
      adminUserId: -1,
      reason: 'forced audit failure',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');

    const after = await winnerRow(id);
    expect(after!.status).toBe('active');
    expect(after!.statusReason).toBeNull();
    expect(await overridesFor('award_winners', awardWinnerEntityKey('wikipedia', recordId)))
      .toHaveLength(0);
    expect(await auditRows('award_winners', id)).toHaveLength(0);
  });

  it('D-10: a voided winner leaves the admin player-link queue', async () => {
    const awardId = await makeAward('queue');
    const id = await seedSourceWinner(awardId, `${MARKER}:queue`, {
      playerId: null, playerName: `${MARKER} Unlinked Winner`,
    });
    const inQueue = async () => (await listUnresolvedLinks('award_winners'))
      .some((r) => r.targetId === id);
    expect(await inQueue()).toBe(true);

    const voided = await voidAwardWinner({
      rowId: id, expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId, reason: 'never happened',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);
    expect(await inQueue()).toBe(false);
  });
});

describe('hall_of_fame — removed_year is not lifecycle, and replacement re-uses the key', () => {
  it('corrects removed_year without touching status, and vice versa', async () => {
    const name = `${MARKER} Removed Year Inductee`;
    const created = await createHallOfFameInductee({
      name, inductedYear: 2000, category: 'Player', adminUserId: actorId,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;

    const row = await readHallOfFameInductee(created.rowId);
    const corrected = await correctHallOfFameInductee({
      rowId: created.rowId,
      expectedUpdatedAt: row!.updatedAt,
      adminUserId: actorId,
      fields: { removedYear: 2010, notes: 'removed from the Hall in 2010' },
    });
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);

    const after = await readHallOfFameInductee(created.rowId);
    // A real inductee formally removed from the Hall of Fame. The ROW is still
    // completely valid, so its status is untouched.
    expect(after!.removedYear).toBe(2010);
    expect(after!.status).toBe('active');

    const voided = await voidHallOfFameInductee({
      rowId: created.rowId,
      expectedUpdatedAt: after!.updatedAt,
      adminUserId: actorId,
      reason: 'this row was a data-entry error',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);
    const final = await readHallOfFameInductee(created.rowId);
    // Voiding says nothing about removed_year and does not clear it: the two
    // concepts stay visibly separate.
    expect(final!.status).toBe('void');
    expect(final!.removedYear).toBe(2010);
  });

  it('replaces a source-owned entry under the same name and year', async () => {
    const name = `${MARKER} Source Inductee`;
    const [seeded] = await admin<{ id: number }[]>`
      INSERT INTO hall_of_fame (name, link_status_value, category, inducted_year, source_id)
      VALUES (${name}, 'unmatched'::link_status, 'Player', 1999, ${wikipediaSourceId})
      RETURNING id`;
    const row = await readHallOfFameInductee(seeded.id);

    const result = await replaceHallOfFameInductee({
      rowId: seeded.id,
      expectedUpdatedAt: row!.updatedAt,
      adminUserId: actorId,
      reason: 'the wrong person was recorded under this name',
      replacement: { name, inductedYear: 1999, playerId: linkedPlayerId, category: 'Player' },
    });
    // The active-row-only index (migration 101) is the whole reason this is
    // possible: under 042's global key the replacement collided with the record
    // of its own predecessor.
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect((await readHallOfFameInductee(seeded.id))!.status).toBe('void');
    const replacement = await readHallOfFameInductee(result.rowId);
    expect(replacement!.status).toBe('active');
    expect(replacement!.playerId).toBe(linkedPlayerId);

    // THE SUPPLIED NAME IS THE KEY, and linking a player does not move it.
    // The linked player's display name is deliberately DIFFERENT here, because
    // that is the case the first DB-backed run caught: `insertHallOfFame()`
    // overwrote the administrator's name with `players.display_name`, so the
    // induction was filed under a different (name, inducted_year) — a silent
    // identity move on the one table whose name IS its identity, and one that
    // makes "re-enter the voided inductee under the same name and year while
    // linking the person it should have been" impossible.
    const [linkedPlayer] = await admin<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${linkedPlayerId}`;
    expect(linkedPlayer.displayName).not.toBe(name);
    expect(replacement!.name).toBe(name);

    // Two rows, one name and year — distinguished by their SOURCE halves.
    expect(result.voidedEntityKey).toBe(hallOfFameEntityKey('wikipedia', name, 1999));
    expect(result.entityKey).toBe(hallOfFameEntityKey('manual_admin_edit', name, 1999));

    // A second active row for that identity is refused in a sentence, not by a
    // raw unique-index error.
    const duplicate = await createHallOfFameInductee({
      name, inductedYear: 1999, category: 'Player', adminUserId: actorId,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toBe('duplicate');
  });
});

describe('honour_team_members — both identity axes', () => {
  it('records, corrects and voids a linked row and a raw-name row', async () => {
    const teamName = `${MARKER} Team of the Century`;
    const linked = await createHonourTeamMember({
      teamName, playerId: linkedPlayerId, position: 'FB', adminUserId: actorId,
    });
    expect(linked.ok, JSON.stringify(linked)).toBe(true);
    const unlinked = await createHonourTeamMember({
      teamName, playerNameRaw: `${MARKER} Unlinked Member`,
      position: 'HB', adminUserId: actorId,
    });
    expect(unlinked.ok, JSON.stringify(unlinked)).toBe(true);
    if (!linked.ok || !unlinked.ok) return;

    expect(linked.entityKey)
      .toBe(honourTeamEntityKey('manual_admin_edit', teamName, linkedPlayerIdentity));
    expect(unlinked.entityKey)
      .toBe(honourTeamEntityKey('manual_admin_edit', teamName, `name:${MARKER} Unlinked Member`));

    const row = await readHonourTeamMember(linked.rowId);
    const corrected = await correctHonourTeamMember({
      rowId: linked.rowId,
      expectedUpdatedAt: row!.updatedAt,
      adminUserId: actorId,
      fields: { position: 'CHB', sortOrder: 3 },
    });
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);
    const after = await readHonourTeamMember(linked.rowId);
    expect(after!.position).toBe('CHB');
    expect(after!.sortOrder).toBe(3);

    // A manual row's durable record is the WHOLE row, not a delta: nothing
    // reloads it, so there is no source value for a delta to be a delta of.
    const [override] = await overridesFor('honour_team_members', linked.entityKey);
    expect(override.fieldGroup).toBe('record');
    expect(override.values.position).toBe('CHB');

    const voided = await voidHonourTeamMember({
      rowId: unlinked.rowId,
      expectedUpdatedAt: (await readHonourTeamMember(unlinked.rowId))!.updatedAt,
      adminUserId: actorId,
      reason: 'never selected',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);

    // Voided, so the team place is free again and the same raw name may be
    // recorded once more — which under migration 059's unqualified index it
    // could not have been.
    const again = await createHonourTeamMember({
      teamName, playerNameRaw: `${MARKER} Unlinked Member`, adminUserId: actorId,
    });
    expect(again.ok).toBe(false);
    // ...except that the durable key is natural, so the identity is already
    // claimed by the voided row's own record. Refused in a sentence (§ the
    // `refuseClaimedKey` rule), never by silently overwriting that record.
    if (!again.ok) expect(again.reason).toBe('conflict');
  });
});

// -------------------------------------------------------------------------

describe.runIf(canReplay)('reload and rebuild survival — the real Python', () => {
  it('an ORDINARY reload leaves the lifecycle alone and reverts a correction', async () => {
    const reloadAwardId = await makeAward('reload');
    const recordId = `${MARKER}:reload`;
    const id = await seedSourceWinner(reloadAwardId, recordId, { votes: '12.00' });
    const key = awardWinnerEntityKey('wikipedia', recordId);

    const corrected = await correctAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
      fields: { votes: '20' },
    });
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);
    const voided = await voidAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
      reason: 'recorded twice',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);

    // The source supplies the row again, with its ORIGINAL votes.
    const reload = runAwardReload(reloadAwardId, [[
      reloadAwardId, season, linkedPlayerId, `${MARKER} Linked`, 'resolved',
      0, null, null, 12, null, false, false, null,
      wikipediaSourceId, recordId, null,
    ]]);
    expect(reload.stderr + reload.stdout).toContain('RELOAD OK');

    const afterReload = await winnerRow(id);
    // status and status_reason are NOT in the importer's column list, so an
    // ordinary reload cannot touch them — the free protection migration 101
    // relies on, and the reason a void needs no replay for this case.
    expect(afterReload!.status).toBe('void');
    expect(afterReload!.statusReason).toBe('recorded twice');
    // votes IS in that list, so the correction is gone until the replay runs.
    expect(afterReload!.votes).toBe('12.00');

    const replay = runReplay('award_winners');
    expect(replay.stdout + replay.stderr).toContain('REPLAY OK');
    const afterReplay = await winnerRow(id);
    expect(afterReplay!.votes).toBe('20.00');
    expect(afterReplay!.status).toBe('void');

    // And it is idempotent.
    expect((runReplay('award_winners').stdout)).toContain('REPLAY OK');
    expect((await winnerRow(id))!.votes).toBe('20.00');
    expect((await overridesFor('award_winners', key)).map((o) => o.fieldGroup).sort())
      .toEqual(['correction', 'lifecycle']);
  });

  it('a DESTRUCTIVE rebuild re-creates a manual row from its record override', async () => {
    const awardId = await makeAward('rebuild');
    const created = await createAwardWinner({
      awardId, season, playerId: linkedPlayerId, votes: '7', note: 'manual',
      adminUserId: actorId,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) return;

    // What a TRUNCATE ... CASCADE on players does to this table.
    await admin`DELETE FROM award_winners WHERE id = ${created.rowId}`;
    expect(await winnerRow(created.rowId)).toBeNull();

    const replay = runReplay('award_winners');
    expect(replay.stdout + replay.stderr).toContain('REPLAY OK');

    const [recreated] = await admin<{
      id: number; votes: string; note: string; status: string; playerId: number;
    }[]>`
      SELECT id, votes::text AS votes, note, status, player_id AS "playerId"
        FROM award_winners
       WHERE source_record_id = ${created.entityKey.split(':').slice(1).join(':')}`;
    expect(recreated).toBeTruthy();
    expect(recreated.votes).toBe('7.00');
    expect(recreated.note).toBe('manual');
    expect(recreated.status).toBe('active');
    // The player is resolved through the DURABLE identity, not the display
    // name: the row comes back linked to the same person even with a new id.
    expect(recreated.playerId).toBe(linkedPlayerId);
  });

  it('D-9: a missing CORRECTION target fails the reload closed', async () => {
    const awardId = await makeAward('missing-correction');
    const recordId = `${MARKER}:missing-correction`;
    const id = await seedSourceWinner(awardId, recordId, { votes: '5.00' });
    const corrected = await correctAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
      fields: { votes: '9' },
    });
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);

    await admin`DELETE FROM award_winners WHERE id = ${id}`;
    const replay = runReplay('award_winners');
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('refusing to commit');
    expect(replay.stderr).toContain('correction target row does not exist');
    expect(replay.stderr).toContain(recordId);

    // Nothing was written, and the override is still there for the operator.
    const key = awardWinnerEntityKey('wikipedia', recordId);
    expect(await overridesFor('award_winners', key)).toHaveLength(1);
    await admin`DELETE FROM data_overrides WHERE entity_type = 'award_winners' AND entity_key = ${key}`;
  });

  it('D-9: a missing LIFECYCLE target warns and RETAINS the override', async () => {
    const awardId = await makeAward('missing-lifecycle');
    const recordId = `${MARKER}:missing-lifecycle`;
    const id = await seedSourceWinner(awardId, recordId);
    const voided = await voidAwardWinner({
      rowId: id,
      expectedUpdatedAt: (await winnerRow(id))!.updatedAt,
      adminUserId: actorId,
      reason: 'the source should never have carried this',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);

    // The source manifest stops carrying the row. That is NOT evidence that
    // voiding it was wrong, so the decision is kept.
    await admin`DELETE FROM award_winners WHERE id = ${id}`;
    const replay = runReplay('award_winners');
    expect(replay.status, replay.stderr).toBe(0);
    expect(replay.stdout).toContain('WARNING');
    expect(replay.stdout).toContain('RETAINED');
    expect(replay.stdout).toContain(recordId);

    const key = awardWinnerEntityKey('wikipedia', recordId);
    const kept = await overridesFor('award_winners', key);
    expect(kept).toHaveLength(1);
    expect(kept[0].values.status).toBe('void');
    await admin`DELETE FROM data_overrides WHERE entity_type = 'award_winners' AND entity_key = ${key}`;
  });

  it('re-creates a manual Hall of Fame row and a manual honour-team row', async () => {
    const name = `${MARKER} Rebuild Inductee`;
    const teamName = `${MARKER} Rebuild Team`;
    const hof = await createHallOfFameInductee({
      name, inductedYear: 2001, category: 'Coach', adminUserId: actorId,
    });
    expect(hof.ok, JSON.stringify(hof)).toBe(true);
    const member = await createHonourTeamMember({
      teamName, playerId: secondPlayerId, position: 'R', adminUserId: actorId,
    });
    expect(member.ok, JSON.stringify(member)).toBe(true);
    if (!hof.ok || !member.ok) return;

    await admin`DELETE FROM hall_of_fame WHERE id = ${hof.rowId}`;
    await admin`DELETE FROM honour_team_members WHERE id = ${member.rowId}`;

    const replay = runReplay('hall_of_fame', 'honour_team_members');
    expect(replay.stdout + replay.stderr).toContain('REPLAY OK');

    const [inductee] = await admin<{ category: string; status: string; year: number }[]>`
      SELECT category, status, inducted_year::int AS year FROM hall_of_fame WHERE name = ${name}`;
    expect(inductee).toBeTruthy();
    expect(inductee.category).toBe('Coach');
    expect(inductee.year).toBe(2001);
    expect(inductee.status).toBe('active');

    const [selection] = await admin<{ position: string; playerId: number; status: string }[]>`
      SELECT position, player_id AS "playerId", status FROM honour_team_members
       WHERE team_name = ${teamName} AND player_id = ${secondPlayerId}`;
    expect(selection).toBeTruthy();
    expect(selection.position).toBe('R');
    expect(selection.status).toBe('active');
  });

  it('a VOIDED out-of-scope row no longer refuses the awards import', async () => {
    // The `lifecycle_column` argument migration 101 forced onto
    // `reload_keyed()`'s out-of-scope key preflight, exercised directly.
    //
    // AFLDB-ISSUE-080 made the Hall of Fame reload refuse outright when an
    // incoming (name, inducted_year) is already held by a row it does not own.
    // Migration 101 then made that key ACTIVE-ROW-ONLY so a wrong row can be
    // replaced — at which point a VOIDED foreign row no longer holds the key,
    // and refusing the whole awards import over it would let an ordinary,
    // correct administrative decision brick the importer. An ACTIVE foreign row
    // must still refuse, exactly as ISSUE-080 decided, and both halves are
    // asserted here.
    //
    // `delete_missing=False` throughout: this reload's scope is the real
    // wikipedia Hall of Fame, and the incoming set is one fixture row.
    const name = `${MARKER} Collision`;
    const year = 1990;
    const [foreign] = await admin<{ id: number }[]>`
      INSERT INTO hall_of_fame (name, link_status_value, category, inducted_year, source_id)
      VALUES (${name}, 'unmatched'::link_status, 'Player', ${year}::smallint,
              (SELECT id FROM sources WHERE key = 'manual_admin_edit'))
      RETURNING id`;

    const reload = () => runPython([
      'import json',
      'from common import reload_keyed, ReloadOwnershipCollision',
      `rows = [(${JSON.stringify(name)}, None, "unmatched", "Player", ${year},`,
      '         False, None, None, None, None, None, None,',
      `         ${wikipediaSourceId}, None)]`,
      'try:',
      '    reload_keyed(',
      '        conn, "hall_of_fame", ["name", "inducted_year"],',
      '        ["name", "player_id", "link_status_value", "category", "inducted_year",',
      '         "is_legend", "legend_year", "club_name_raw", "state", "playing_career",',
      '         "removed_year", "notes", "source_id", "import_batch_id"],',
      '        iter(rows), None,',
      '        target_table="hall_of_fame", name_column="name",',
      `        scope_column="source_id", scope_values=[${wikipediaSourceId}],`,
      '        refuse_out_of_scope_key=True, lifecycle_column="status",',
      '        delete_missing=False,',
      '    )',
      '    conn.commit()',
      '    print("RELOAD OK")',
      'except ReloadOwnershipCollision as exc:',
      '    conn.rollback()',
      '    print("COLLISION: " + str(exc))',
      'finally:',
      '    conn.close()',
    ]);

    const active = reload();
    expect(active.stdout, active.stderr).toContain('COLLISION:');
    expect(active.stdout).toContain(name);

    await admin`
      UPDATE hall_of_fame SET status = 'void', status_reason = 'replaced'
       WHERE id = ${foreign.id}`;

    const voided = reload();
    expect(voided.stdout, voided.stderr).toContain('RELOAD OK');
    // The source now owns its own row for that identity, alongside the voided
    // one — which is the state a replacement leaves behind.
    const rows = await admin<{ id: number; status: string; sourceId: number }[]>`
      SELECT id, status, source_id AS "sourceId" FROM hall_of_fame
       WHERE name = ${name} ORDER BY id`;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'void']);
  });
});

describe('D-12 — the legacy ingest writer refuses to overwrite a decision', () => {
  it('refuses a promotion over a row carrying an active lifecycle override', async () => {
    // The all_australian ingest dataset upserts award_winners by
    // (award_id, source_record_id) and re-asserts every column from the file.
    // It knows nothing about the lifecycle, so the only safe answer is a
    // refusal that names the conflict — not a second, divergent replay.
    const awardId = await makeAward('ingest');
    const [sportsDataLab] = await admin<{ id: number }[]>`
      SELECT id FROM sources WHERE key = 'sports_data_lab'`;
    const player = `${MARKER} Ingest Winner`;
    const recordId = `${season}:${player}:`;

    const [seeded] = await admin<{ id: number }[]>`
      INSERT INTO award_winners
        (award_id, season, player_name_raw, link_status_value, source_id, source_record_id)
      VALUES (${awardId}, ${season}::smallint, ${player}, 'unmatched'::link_status,
              ${sportsDataLab.id}, ${recordId})
      RETURNING id`;

    const voided = await voidAwardWinner({
      rowId: seeded.id,
      expectedUpdatedAt: (await winnerRow(seeded.id))!.updatedAt,
      adminUserId: actorId,
      reason: 'this selection was never made',
    });
    expect(voided.ok, JSON.stringify(voided)).toBe(true);

    const { DATASETS } = await import('@/lib/ingest/datasets');
    await expect(DATASETS.all_australian.promoteRow(
      { player, year: String(season), club: null, position: null, captain: null },
      { season, club_id: null, player_id: null, link_status: 'unmatched' },
      {
        sql: admin as never,
        awardId,
        sourceId: sportsDataLab.id,
        batchId: null as never,
      },
    )).rejects.toThrow(/carries an active lifecycle decision/);

    // Still void, and the override is untouched.
    expect((await winnerRow(seeded.id))!.status).toBe('void');
    const key = awardWinnerEntityKey('sports_data_lab', recordId);
    expect((await overridesFor('award_winners', key))[0].values.status).toBe('void');
  });
});
