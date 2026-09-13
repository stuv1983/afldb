/**
 * getPlayerAfterSirenEvents (after_siren_kicks, migration 089), added to
 * unblock the player-page UI exposure of after-the-siren events
 * (AFLDB-ISSUE-118 §W.4). Fixtures are the same tracked Wikipedia rows
 * tests/after-siren-normalisation.test.ts exercises at the loader level --
 * Luke Shuey (2017 EF, extra-time siren, goal to win), David King (1994 QF,
 * end_of_regulation miss) and Kerry Good (1980 Escort Championships GF, a
 * non-premiership-season event with no match_id) -- discovered dynamically
 * by name, never a hardcoded player id.
 */
import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getPlayerAfterSirenEvents } from '@/db/queries/after-siren';

afterAll(async () => {
  await sql.end();
});

async function afterSirenPlayerId(nameClean: string): Promise<number | null> {
  const [row] = await sql<{ playerId: number | null }[]>`
    SELECT player_id AS "playerId" FROM after_siren_kicks WHERE player_name_clean = ${nameClean} LIMIT 1
  `;
  return row?.playerId ?? null;
}

describe('getPlayerAfterSirenEvents', () => {
  it('Luke Shuey 2017: an extra-time-siren goal to win, linked to its match', async () => {
    const playerId = await afterSirenPlayerId('Luke Shuey');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const shuey = events.find((e) => e.season === 2017 && e.siren === 'end_of_extra_time');
    expect(shuey).toBeDefined();
    expect(shuey).toMatchObject({
      kickScored: 'goal',
      kickEffect: 'won',
      kickerResult: 'win',
      premiershipSeason: true,
    });
  });

  it('David King 1994: an end_of_regulation miss, kick_effect none', async () => {
    const playerId = await afterSirenPlayerId('David King');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const king = events.find((e) => e.season === 1994 && e.siren === 'end_of_regulation');
    expect(king).toBeDefined();
    expect(king).toMatchObject({ kickScored: 'none', kickEffect: 'none' });
  });

  it('Kerry Good 1980: a non-premiership-season event carries no match id', async () => {
    const playerId = await afterSirenPlayerId('Kerry Good');
    expect(playerId, 'the after-siren stage has not loaded this database').not.toBeNull();

    const events = await getPlayerAfterSirenEvents(playerId!);
    const good = events.find((e) => e.season === 1980);
    expect(good).toBeDefined();
    expect(good!.premiershipSeason).toBe(false);
    expect(good!.matchId).toBeNull();
    expect(good!.competition).toBe('Escort Championships');
  });

  it('a player with no after-siren events returns an empty array', async () => {
    const [someone] = await sql<{ id: number }[]>`
      SELECT p.id FROM players p
       WHERE NOT EXISTS (SELECT 1 FROM after_siren_kicks a WHERE a.player_id = p.id)
       LIMIT 1
    `;
    expect(someone).toBeDefined();
    expect(await getPlayerAfterSirenEvents(someone.id)).toEqual([]);
  });
});

// =====================================================================
// AFLDB-ISSUE-167 Stage 4 — the Python half of the durable suppression
// =====================================================================
// After-siren is D-3's straightforward adapter: `after_siren.py` reloads
// through `common.py`, so the replay is a branch of the existing
// `replay_admin_overrides` rather than a new implementation. What it still has
// to prove is the same three things the first-kick side proves — the lifecycle
// columns survive an ordinary reload, the OVERRIDE survives when the columns do
// not, and the stale-row DELETE refuses a row carrying a durable decision.
//
// Every one of these spawns the REAL loader. `tests/data-overrides-source-
// contract.test.ts` pins the wiring from source; this pins the behaviour
// against a live database, and `tests/special-records-replay-parity.test.ts`
// pins it against the TypeScript adapter.
const root = process.cwd();
const ARTEFACT = join(root, 'data', 'records', 'after-siren-events.csv');
const MARKER = 'afldb-issue-167-stage4-siren';
const FIXTURE_EMAIL = 'afldb-issue-167-siren@example.test';

const venvPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'));

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const importDsn = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? process.env.AFLDB_TEST_DATABASE_URL;
const canLoad = existsSync(ARTEFACT) && hasPsycopg() && !!importDsn;
const skipNote = !existsSync(ARTEFACT)
  ? 'the tracked after-siren artefact is absent'
  : (!importDsn ? 'no test import DSN is configured' : 'python with psycopg is required');

let adminUserId = 0;

/** Run the REAL loader. `--dsn-env` is named explicitly so the target is never inherited by accident. */
function runLoad(csv: string) {
  return spawnSync(
    python,
    [join(root, 'tools', 'migration', 'after_siren.py'), 'load', '--csv', csv,
      '--dsn-env', 'AFLDB_ISSUE_167_TEST_DSN', '--quiet'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AFLDB_ISSUE_167_TEST_DSN: importDsn },
    },
  );
}

function loadOutput(run: { stdout: unknown; stderr: unknown; error?: Error }): string {
  return String(run.stdout ?? '') + String(run.stderr ?? '') + (run.error ? `\n${run.error.message}` : '');
}

async function seedOverride(
  entityKey: string, fieldGroup: string, values: Record<string, unknown>,
): Promise<void> {
  await sql`
    INSERT INTO data_overrides
      (entity_type, entity_key, field_group, override_values, is_active, admin_user_id)
    VALUES ('after_siren_kicks', ${entityKey}, ${fieldGroup},
            ${sql.json(values as never)}, true, ${adminUserId})
  `;
}

async function clearFixtures(): Promise<void> {
  await sql`
    DELETE FROM data_overrides
     WHERE entity_type = 'after_siren_kicks'
       AND (entity_key LIKE ${`%${MARKER}%`}
            OR override_values->>'status_reason' LIKE ${`%${MARKER}%`})
  `;
  await sql`DELETE FROM after_siren_kicks WHERE source_record_id LIKE ${`%${MARKER}%`}`;
}

/** One event key the artefact carries, and the row it loaded to. */
async function anyLoadedEvent(): Promise<{ id: number; key: string }> {
  const [row] = await sql<{ id: number; key: string }[]>`
    SELECT k.id, k.source_record_id AS key
      FROM after_siren_kicks k JOIN sources s ON s.id = k.source_id
     WHERE s.key = 'wikipedia_after_siren_kicks' AND k.source_record_id IS NOT NULL
     ORDER BY k.id LIMIT 1
  `;
  expect(row, 'the after-siren stage has not loaded this database').toBeDefined();
  return row;
}

async function lifecycleOf(key: string): Promise<{ status: string; reason: string | null } | undefined> {
  const [row] = await sql<{ status: string; reason: string | null }[]>`
    SELECT status, status_reason AS reason FROM after_siren_kicks
     WHERE source_record_id = ${key}
  `;
  return row;
}

describe.skipIf(!canLoad)(
  `after-siren durable admin decisions (AFLDB-ISSUE-167 Stage 4)${canLoad ? '' : ` — ${skipNote}`}`,
  () => {
    beforeAll(async () => {
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;
      await clearFixtures();
    });

    afterAll(async () => {
      await clearFixtures();
      // Leave the canonical rows exactly as they were found.
      const restore = runLoad(ARTEFACT);
      expect(restore.status, loadOutput(restore)).toBe(0);
    }, 300_000);

    it('proves its target before mutating it', async () => {
      const [row] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
      expect(row.db).toMatch(/_test$/);
    });

    it('leaves the lifecycle columns alone on an ordinary reload (Layer 1)', async () => {
      // WRITTEN_COLUMNS / COMPARED_COLUMNS are explicit and closed, so the
      // three columns migration 102 added are simply not in them. The same
      // free protection award_winners.sort_order has relied on since 061.
      const row = await anyLoadedEvent();
      await sql`
        UPDATE after_siren_kicks
           SET status = 'void', status_reason = ${`${MARKER}: voided by hand`}
         WHERE id = ${row.id}
      `;

      const run = runLoad(ARTEFACT);
      expect(run.status, loadOutput(run)).toBe(0);

      const after = await lifecycleOf(row.key);
      expect(after?.status).toBe('void');
      expect(after?.reason).toContain(MARKER);

      await sql`
        UPDATE after_siren_kicks SET status = 'active', status_reason = NULL WHERE id = ${row.id}
      `;
    }, 300_000);

    it('re-asserts a lifecycle decision the canonical row lost (Layer 2)', async () => {
      // The durable half: the columns are a cache, data_overrides is the
      // authority. Clearing the columns stands in for the rebuild that would
      // have taken the whole row.
      const row = await anyLoadedEvent();
      await seedOverride(
        `wikipedia_after_siren_kicks:${row.key}`,
        'lifecycle',
        { status: 'void', status_reason: `${MARKER}: recorded in error` },
      );
      await sql`
        UPDATE after_siren_kicks SET status = 'active', status_reason = NULL WHERE id = ${row.id}
      `;

      const run = runLoad(ARTEFACT);
      expect(run.status, loadOutput(run)).toBe(0);

      const after = await lifecycleOf(row.key);
      expect(after?.status).toBe('void');
      expect(after?.reason).toBe(`${MARKER}: recorded in error`);

      await clearFixtures();
      await sql`
        UPDATE after_siren_kicks SET status = 'active', status_reason = NULL WHERE id = ${row.id}
      `;
    }, 300_000);

    it('re-creates a manual record row, and the stale-row DELETE leaves it alone', async () => {
      // A manual row carries source_id = manual_admin_edit, so the
      // `DELETE ... WHERE source_id = %s AND NOT (source_record_id = ANY(%s))`
      // cannot see it: the scope is this source's own rows.
      const recordId = `after_siren:${MARKER}-manual`;
      await seedOverride(`manual_admin_edit:${recordId}`, 'record', {
        player_name_raw: 'Stage Four Siren',
        player_name_clean: 'Stage Four Siren',
        club_name_raw: 'Manual Club',
        opponent_name_raw: 'Manual Opponent',
        competition: 'VFL/AFL',
        premiership_season: true,
        season: 1900,
        round_raw: 'R1',
        kick_scored: 'none',
        kick_effect: 'none',
        kicker_result: 'loss',
        siren: 'final',
        kicker_score_raw: '0.0 (0)',
        opponent_score_raw: '0.0 (0)',
        kicker_points: 0,
        opponent_points: 0,
        notes: `${MARKER}: created by an administrator`,
        status: 'active',
        status_reason: null,
      });

      const created = runLoad(ARTEFACT);
      expect(created.status, loadOutput(created)).toBe(0);

      const [manual] = await sql<{ id: number; sourceKey: string }[]>`
        SELECT k.id, s.key AS "sourceKey"
          FROM after_siren_kicks k JOIN sources s ON s.id = k.source_id
         WHERE k.source_record_id = ${recordId}
      `;
      expect(manual, 'the record override must re-create the row').toBeDefined();
      expect(manual.sourceKey).toBe('manual_admin_edit');

      // A second ordinary load must neither delete it nor duplicate it.
      const again = runLoad(ARTEFACT);
      expect(again.status, loadOutput(again)).toBe(0);
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM after_siren_kicks WHERE source_record_id = ${recordId}
      `;
      expect(n).toBe(1);

      await clearFixtures();
    }, 600_000);

    it('WARNS AND RETAINS a lifecycle override whose row is absent, and proceeds', async () => {
      const key = `wikipedia_after_siren_kicks:${MARKER}-absent`;
      await seedOverride(key, 'lifecycle', {
        status: 'void', status_reason: `${MARKER}: names nothing yet`,
      });

      const run = runLoad(ARTEFACT);
      expect(run.status, loadOutput(run)).toBe(0);
      expect(loadOutput(run)).toContain(key);
      expect(loadOutput(run)).toContain('RETAINED');

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM data_overrides
         WHERE entity_type = 'after_siren_kicks' AND entity_key = ${key} AND is_active = true
      `;
      expect(n, 'warn-and-retain must not discard the override').toBe(1);

      await clearFixtures();
    }, 300_000);

    it('REFUSES to delete a stale row carrying an active override, and writes nothing', async () => {
      // The stale-row DELETE is right for an ordinary retirement and wrong for
      // a row an administrator has voided: a SOURCE-OWNED row cannot be
      // re-created from a lifecycle payload, so deleting it would strand the
      // override permanently. Refused before the batch row is even written.
      //
      // The stale row is created in the DATABASE rather than by trimming the
      // artefact, and that is deliberate. `cmd_load` validates the tracked
      // `after-siren-events.source.json` measures against the artefact it is
      // given, so a trimmed copy is refused with "measures disagree with the
      // artefact" long before it reaches this refusal — a guard about
      // provenance, not about lifecycle. Seeding a source-owned row the
      // artefact never carried models "the source stopped carrying this row"
      // exactly, and leaves the tracked artefact untouched.
      const staleKey = `${MARKER}-stale`;
      await sql`
        INSERT INTO after_siren_kicks (
          player_name_raw, player_name_clean, link_status_value, club_name_raw,
          opponent_name_raw, competition, premiership_season, season, round_raw,
          kick_scored, kick_effect, kicker_result, siren,
          kicker_score_raw, opponent_score_raw, kicker_points, opponent_points,
          source_id, source_record_id
        ) VALUES (
          'Stale Fixture', 'Stale Fixture', 'unmatched', 'Fixture Club',
          'Fixture Opponent', 'VFL/AFL', true, 1900, 'R1',
          'none', 'none', 'loss', 'final',
          '0.0 (0)', '0.0 (0)', 0, 0,
          (SELECT id FROM sources WHERE key = 'wikipedia_after_siren_kicks'), ${staleKey}
        )
      `;
      await seedOverride(
        `wikipedia_after_siren_kicks:${staleKey}`,
        'lifecycle',
        { status: 'void', status_reason: `${MARKER}: protected from deletion` },
      );

      const [before] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM after_siren_kicks
      `;
      const [batchesBefore] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches WHERE tool = 'after_siren.py'
      `;

      const refused = runLoad(ARTEFACT);
      expect(refused.status, loadOutput(refused)).not.toBe(0);
      expect(loadOutput(refused)).toContain('carries an active lifecycle override');
      expect(loadOutput(refused)).toContain('cannot be deleted');

      const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM after_siren_kicks`;
      expect(after.n, 'the protected row must survive').toBe(before.n);
      expect(await lifecycleOf(staleKey), 'the protected row must survive').toBeDefined();
      const [batchesAfter] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches WHERE tool = 'after_siren.py'
      `;
      expect(batchesAfter.n, 'a refused run writes no batch row').toBe(batchesBefore.n);

      await clearFixtures();
    }, 300_000);
  },
);
