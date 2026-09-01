import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { createHonourTeamMember } from '@/db/queries/awards-admin';
import {
  confirmUnlinked,
  listConfirmedUnlinked,
  resolveLink,
} from '@/db/queries/player-links';
import { lockHonoursTables, unlockHonoursTables } from './draft-lock';
import { createImportRoleParityHarness } from './import-role-parity';

/**
 * A full honours reload must not discard a human identity decision
 * (AFLDB-ISSUE-044).
 *
 * This is the only suite that drives a Python importer against a real
 * database, which is why it is its own file: tests/under-22-importer.test.ts
 * reads import_awards.py as text and never connects, and no existing
 * integration file owns the ETL boundary.
 *
 * The reproduction it guards is exact. Before the fix, `import_awards.py`
 * truncated its targets and re-COPYed them, so `hall_of_fame` id 1 "Alf
 * Brown" — linked by an admin to player 1 — came back as id 344 with
 * player_id NULL, and the `player_link_resolutions` row still claiming
 * target_id 1 pointed at nothing at all.
 *
 * Every write here lands in afldb_test. Fixture setup/assertion connections
 * remain owner-backed; only the real importer child is switched to the
 * validated AFLDB_TEST_IMPORT_DATABASE_URL by the shared role-parity harness.
 */
// In-process admin fixture paths still need the owner test credential. This is
// deliberately separate from runImporter(), whose child receives afldb_import.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const FIXTURE_EMAIL = 'issue-044-reload@example.test';
const NOTE = 'AFLDB-ISSUE-044 reload survival';
const UNDER_22_CSV = join(root, 'data', 'awards', '22-under-22.csv');
const HONOUR_TEAMS_CSV = join(root, 'data', 'awards', 'honour-teams.csv');
const HALL_OF_FAME_CSV = join(root, 'data', 'awards', 'hall-of-fame.csv');
const CAPTAINCIES_CSV = join(root, 'data', 'awards', 'captaincies.csv');
const RISING_STAR_CSV = join(root, 'data', 'awards', 'rising-star.csv');
const ALL_AUSTRALIAN_CSV = join(root, 'data', 'awards', 'all-australian.csv');

// The dev host keeps psycopg in the repo virtualenv; a bare python3 there
// cannot import it.
const venvPython = join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython)
    ? venvPython
    : (process.platform === 'win32' ? 'python' : 'python3'));

const legacySqlite = process.env.AFLDB_LEGACY_SQLITE;

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const canSpawnPython = hasPsycopg();

const integrationDsn = process.env.AFLDB_TEST_DATABASE_URL as string;
const importRole = createImportRoleParityHarness(
  integrationDsn,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);

const canRunFixtureImporter = canSpawnPython && importRole.isConfigured;
const canRunImporter = Boolean(legacySqlite)
  && existsSync(legacySqlite as string)
  && canRunFixtureImporter;
const canRunUnder22Importer = canSpawnPython
  && existsSync(UNDER_22_CSV)
  && importRole.isConfigured;
// AFLDB-ISSUE-112 honour-teams slice: legacy-free like under_22, gated the
// same way and deliberately independent of canRunImporter/legacySqlite.
const canRunHonourTeamsImporter = canSpawnPython
  && existsSync(HONOUR_TEAMS_CSV)
  && importRole.isConfigured;
// AFLDB-ISSUE-112 phase 2: Hall of Fame is legacy-free like honour_teams,
// gated the same way and independent of canRunImporter/legacySqlite.
const canRunHallOfFameImporter = canSpawnPython
  && existsSync(HALL_OF_FAME_CSV)
  && importRole.isConfigured;
// AFLDB-ISSUE-112 phase 3: captaincies is legacy-free like the two slices
// above, gated the same way and independent of canRunImporter/legacySqlite.
const canRunCaptainciesImporter = canSpawnPython
  && existsSync(CAPTAINCIES_CSV)
  && importRole.isConfigured;
// AFLDB-ISSUE-112 phase 4: Rising Star is legacy-free like the three slices
// above, gated the same way and independent of canRunImporter/legacySqlite.
const canRunRisingStarImporter = canSpawnPython
  && existsSync(RISING_STAR_CSV)
  && importRole.isConfigured;
// AFLDB-ISSUE-112 phase 5: All-Australian is legacy-free like the four
// slices above, gated the same way and independent of canRunImporter/legacySqlite.
const canRunAllAustralianImporter = canSpawnPython
  && existsSync(ALL_AUSTRALIAN_CSV)
  && importRole.isConfigured;
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

// One connection pool for the whole file: every describe block shares `sql`.
beforeAll(async () => {
  if (
    canRunFixtureImporter
    || canRunUnder22Importer
    || canRunHonourTeamsImporter
    || canRunHallOfFameImporter
    || canRunCaptainciesImporter
    || canRunRisingStarImporter
    || canRunAllAustralianImporter
  ) {
    await importRole.validate();
  }
});
beforeAll(() => lockHonoursTables(integrationDsn), 300_000);
afterAll(async () => {
  await unlockHonoursTables();
  await sql.end();
});

function runImporter(
  groups: string[],
  extra: string[] = [],
  sqlitePath: string | undefined = legacySqlite,
) {
  return importRole.spawn(
    python,
    ['tools/migration/import_awards.py', '--groups', ...groups, ...extra],
    {
      cwd: root,
      env: {
        AFLDB_LEGACY_SQLITE: sqlitePath,
      },
    },
  );
}

type HonoursRow = {
  id: number;
  name: string;
  playerId: number | null;
  status: string;
};

/** An unresolved row of `table`, skipping any this file already used. */
async function takeUnresolved(
  table: 'hall_of_fame' | 'honour_team_members' | 'award_winners',
  used: Set<number>,
): Promise<HonoursRow> {
  const nameColumn = table === 'hall_of_fame' ? sql`name` : sql`player_name_raw`;
  const rows = await sql<HonoursRow[]>`
    SELECT id, ${nameColumn} AS name, player_id AS "playerId",
           link_status_value::text AS status
      FROM ${sql(table)}
     WHERE link_status_value::text IN ('ambiguous', 'unmatched', 'implausible')
     ORDER BY id
     LIMIT 40
  `;
  const row = rows.find((candidate) => !used.has(candidate.id));
  if (!row) throw new Error(`no spare unresolved ${table} row in afldb_test`);
  used.add(row.id);
  return row;
}

async function readRow(
  table: 'hall_of_fame' | 'honour_team_members' | 'award_winners',
  id: number,
): Promise<HonoursRow | undefined> {
  const nameColumn = table === 'hall_of_fame' ? sql`name` : sql`player_name_raw`;
  const [row] = await sql<HonoursRow[]>`
    SELECT id, ${nameColumn} AS name, player_id AS "playerId",
           link_status_value::text AS status
      FROM ${sql(table)}
     WHERE id = ${id}
  `;
  return row;
}

async function countRows(table: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(table)}
  `;
  return row.n;
}

describe.skipIf(!canRunUnder22Importer)(
  `awards importer production-role parity (AFLDB-ISSUE-083)${roleParitySuffix}`,
  () => {
    it('imports the canonical Under 22 group as afldb_import (AFLDB-ISSUE-083)', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // Unlike the legacy honours groups, this production path resolves
      // player identity against the PostgreSQL graph. It therefore proves
      // awards importer privileges without assuming that PostgreSQL player
      // surrogate ids equal the old SQLite ids.
      const run = runImporter(['under_22']);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'under_22'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the restricted importer must record its completed batch').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(330);
      expect(Number(batch.recordsRejected)).toBe(0);

      const [rows] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN sources s ON s.id = w.source_id
         WHERE s.key = 'wikipedia_22under22'
           AND w.source_record_id LIKE '22under22:%'
      `;
      expect(rows.n).toBe(330);
    }, 120_000);
  },
);

describe.skipIf(!canRunImporter)(
  `honours reloads preserve manual player links (AFLDB-ISSUE-044)${roleParitySuffix}`,
  () => {
    let adminUserId = 0;
    let playerA = 0;
    let playerB = 0;
    const used = new Set<number>();
    /** Rows to put back exactly as they were, whatever the tests did. */
    const restore: Array<() => Promise<void>> = [];

    beforeAll(async () => {
      // A dedicated fixture admin. Picking the first real admin by id is the
      // trap AFLDB-ISSUE-074 records against the email-intake suite.
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;

      const players = await sql<{ id: number }[]>`
        SELECT id FROM players ORDER BY id LIMIT 2
      `;
      expect(players.length).toBe(2);
      playerA = players[0].id;
      playerB = players[1].id;
    });

    afterAll(async () => {
      for (const undo of restore.reverse()) {
        try {
          await undo();
        } catch {
          // Keep unwinding: one failed restore must not strand the rest.
        }
      }
      // The runner connects as the table owner, so the append-only grants
      // that protect this table in production do not apply here.
      await sql`
        DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}
      `;
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    });

    it('keeps a resolved Hall of Fame link, and its row id, across a reload', async () => {
      const row = await takeUnresolved('hall_of_fame', used);
      restore.push(async () => {
        await sql`
          UPDATE hall_of_fame
             SET player_id = ${row.playerId}, link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      });

      const linked = await resolveLink({
        targetTable: 'hall_of_fame',
        targetId: row.id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const before = await countRows('hall_of_fame');
      const run = runImporter(['hall_of_fame']);
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const after = await readRow('hall_of_fame', row.id);
      expect(after, 'the decided row must still exist under its own id').toBeDefined();
      expect(after!.name).toBe(row.name);
      expect(after!.playerId).toBe(playerA);
      expect(after!.status).toBe('resolved');
      expect(await countRows('hall_of_fame')).toBe(before);
    });

    it('keeps a confirmed-unlinked decision pointing at the same row', async () => {
      const row = await takeUnresolved('hall_of_fame', used);

      const confirmed = await confirmUnlinked({
        targetTable: 'hall_of_fame',
        targetId: row.id,
        adminUserId,
        note: NOTE,
      });
      expect(confirmed).toEqual({ ok: true });

      const run = runImporter(['hall_of_fame']);
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const after = await readRow('hall_of_fame', row.id);
      expect(after).toBeDefined();
      expect(after!.name).toBe(row.name);
      // Vetted as genuinely not an AFLDB player: it must stay that way.
      expect(after!.playerId).toBeNull();
      // The decision is only useful while it still names a live row: this is
      // exactly what the truncate-and-reload left dangling.
      const vetted = await listConfirmedUnlinked();
      expect(vetted.has(`hall_of_fame:${row.id}`)).toBe(true);
    });

    it("keeps the admin's link when the source later names someone else, and says so", async () => {
      // A row the legacy source links confidently, temporarily returned to the
      // queue so the real resolveLink path can decide it differently.
      const [row] = await sql<HonoursRow[]>`
        SELECT id, name, player_id AS "playerId", link_status_value::text AS status
          FROM hall_of_fame
         WHERE player_id IS NOT NULL AND link_status_value::text = 'unique'
         ORDER BY id
         LIMIT 1
      `;
      expect(row, 'afldb_test needs a source-linked Hall of Fame row').toBeDefined();
      used.add(row.id);
      restore.push(async () => {
        await sql`
          UPDATE hall_of_fame
             SET player_id = ${row.playerId}, link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      });

      const admins = row.playerId === playerA ? playerB : playerA;
      await sql`
        UPDATE hall_of_fame
           SET player_id = NULL, link_status_value = 'ambiguous'
         WHERE id = ${row.id}
      `;
      const linked = await resolveLink({
        targetTable: 'hall_of_fame',
        targetId: row.id,
        playerId: admins,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const run = runImporter(['hall_of_fame']);
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const after = await readRow('hall_of_fame', row.id);
      expect(after!.playerId, "the admin's decision is authoritative").toBe(admins);
      expect(after!.status).toBe('resolved');
      // A disagreement is never silent: the source still claims someone else.
      expect(run.stdout).toContain(`the source now links player ${row.playerId}`);
      expect(run.stdout).toContain(String(row.id));
    });

    it('aborts rather than lose a decision when a name-keyed source row is renamed', async () => {
      // hall_of_fame has no source_record_id, so migration 042's
      // (name, inducted_year) natural key is the reload key -- and the name is
      // the very thing a source correction changes.
      const row = await takeUnresolved('hall_of_fame', used);
      restore.push(async () => {
        await sql`
          UPDATE hall_of_fame
             SET name = ${row.name}, player_id = ${row.playerId},
                 link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      });

      const linked = await resolveLink({
        targetTable: 'hall_of_fame',
        targetId: row.id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      await sql`
        UPDATE hall_of_fame SET name = ${`${row.name} (renamed)`} WHERE id = ${row.id}
      `;
      const before = await countRows('hall_of_fame');

      const run = runImporter(['hall_of_fame']);
      expect(run.status, 'the reload must fail closed').toBe(1);
      expect(run.stdout).toContain('cannot survive');
      expect(run.stdout).toContain('hall_of_fame');
      expect(run.stdout).toContain(String(row.id));

      // Nothing written: the decision is neither discarded nor reattributed.
      const after = await readRow('hall_of_fame', row.id);
      expect(after!.name).toBe(`${row.name} (renamed)`);
      expect(after!.playerId).toBe(playerA);
      expect(after!.status).toBe('resolved');
      expect(await countRows('hall_of_fame')).toBe(before);

      // Restored, the same reload succeeds and the decision survives it.
      await sql`UPDATE hall_of_fame SET name = ${row.name} WHERE id = ${row.id}`;
      const rerun = runImporter(['hall_of_fame']);
      expect(rerun.status, rerun.stdout + rerun.stderr).toBe(0);
      const healed = await readRow('hall_of_fame', row.id);
      expect(healed!.playerId).toBe(playerA);
    });

    it('aborts on a renamed honour-team member for the same reason', async () => {
      // (team_name, player_name_raw): the other key derived from a name.
      const row = await takeUnresolved('honour_team_members', used);
      restore.push(async () => {
        await sql`
          UPDATE honour_team_members
             SET player_name_raw = ${row.name}, player_id = ${row.playerId},
                 link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      });

      const linked = await resolveLink({
        targetTable: 'honour_team_members',
        targetId: row.id,
        playerId: playerB,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      await sql`
        UPDATE honour_team_members
           SET player_name_raw = ${`${row.name} (renamed)`}
         WHERE id = ${row.id}
      `;
      const before = await countRows('honour_team_members');

      const run = runImporter(['honour_teams']);
      expect(run.status, 'the reload must fail closed').toBe(1);
      expect(run.stdout).toContain('honour_team_members');
      expect(run.stdout).toContain(String(row.id));

      const after = await readRow('honour_team_members', row.id);
      expect(after!.playerId).toBe(playerB);
      expect(after!.status).toBe('resolved');
      expect(await countRows('honour_team_members')).toBe(before);

      // --allow-link-loss is the deliberate escape hatch, and it itemises what
      // it discards rather than proceeding quietly.
      const forced = runImporter(['honour_teams'], ['--allow-link-loss']);
      expect(forced.status, forced.stdout + forced.stderr).toBe(0);
      expect(forced.stdout).toContain('DISCARDING');
      expect(forced.stdout).toContain(`player ${playerB}`);
    });

    it(
      'keeps an award-winner link across the full legacy awards reload',
      async () => {
        // Deliberately outside the 22 Under 22 award: that group owns its own
        // rows and is asserted separately below.
        const [u22] = await sql<{ id: number }[]>`
          SELECT id FROM awards WHERE slug = '22-under-22'
        `;
        const candidates = await sql<HonoursRow[]>`
          SELECT w.id, w.player_name_raw AS name, w.player_id AS "playerId",
                 w.link_status_value::text AS status
            FROM award_winners w
           WHERE w.link_status_value::text IN ('ambiguous', 'unmatched', 'implausible')
             AND w.award_id IS DISTINCT FROM ${u22?.id ?? null}
           ORDER BY w.id
           LIMIT 40
        `;
        const row = candidates.find((candidate) => !used.has(candidate.id));
        if (!row) throw new Error('no spare unresolved award_winners row in afldb_test');
        used.add(row.id);
        restore.push(async () => {
          await sql`
            UPDATE award_winners
               SET player_id = ${row.playerId},
                   link_status_value = ${row.status}::link_status
             WHERE id = ${row.id}
          `;
        });

        const linked = await resolveLink({
          targetTable: 'award_winners',
          targetId: row.id,
          playerId: playerA,
          adminUserId,
          note: NOTE,
        });
        expect(linked).toEqual({ ok: true });

        const before = await countRows('award_winners');
        // The 22 Under 22 rows the legacy group must not touch. Their ids are
        // the audit targets that a DELETE CASCADE used to invalidate.
        const u22Before = await sql<{ n: number; fingerprint: string }[]>`
          SELECT count(*)::int AS n,
                 md5(string_agg(id::text, ',' ORDER BY id)) AS fingerprint
            FROM award_winners WHERE award_id = ${u22?.id ?? null}
        `;

        // 'awards' closes over all_australian, under_22 and rising_star: the
        // whole destructive family in one run.
        const run = runImporter(['awards']);
        expect(run.status, run.stdout + run.stderr).toBe(0);

        const after = await readRow('award_winners', row.id);
        expect(after, 'the decided row must survive under its own id').toBeDefined();
        expect(after!.name).toBe(row.name);
        expect(after!.playerId).toBe(playerA);
        expect(after!.status).toBe('resolved');
        expect(await countRows('award_winners')).toBe(before);

        const u22After = await sql<{ n: number; fingerprint: string }[]>`
          SELECT count(*)::int AS n,
                 md5(string_agg(id::text, ',' ORDER BY id)) AS fingerprint
            FROM award_winners WHERE award_id = ${u22?.id ?? null}
        `;
        expect(u22After[0], '22 Under 22 rows and ids must be untouched')
          .toEqual(u22Before[0]);
      },
      300_000,
    );
  },
);

/**
 * AFLDB-ISSUE-112 honour-teams slice: the checked-in manifest
 * (data/awards/honour-teams.csv) replaces team_selections as the sole input
 * to the honour_teams group. Legacy-free like under_22 — deliberately run
 * with AFLDB_LEGACY_SQLITE forced unset, proving the group no longer needs
 * it, on top of the reload/link-preservation guarantees the ISSUE-080 block
 * above already covers generically for this table.
 */
describe.skipIf(!canRunHonourTeamsImporter)(
  `honour-teams manifest reload (AFLDB-ISSUE-112)${roleParitySuffix}`,
  () => {
    const FIXTURE_EMAIL_112 = 'issue-112-honour-teams@example.test';
    let wikipediaId = 0;
    let manualId = 0;
    let adminUserId = 0;

    beforeAll(async () => {
      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources WHERE key IN ('wikipedia', 'manual_admin_edit')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_112}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;
    });

    afterAll(async () => {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    });

    it('reloads the full 113-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // The third argument forces AFLDB_LEGACY_SQLITE unset regardless of
      // this process's own environment — the headline ISSUE-112 acceptance.
      const run = runImporter(['honour_teams'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'honour_teams'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the honour_teams batch must be recorded').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(113);
      expect(Number(batch.recordsRejected)).toBe(0);

      const [counts] = await sql<{
        total: number; linked: number; unlinked: number; teams: number;
      }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
               count(DISTINCT team_name)::int AS teams
          FROM honour_team_members
         WHERE source_id = ${wikipediaId}
      `;
      expect(counts).toEqual({ total: 113, linked: 89, unlinked: 24, teams: 5 });
    }, 120_000);

    it('is idempotent across three consecutive reloads with a byte-identical row-id fingerprint', async () => {
      async function fingerprint(): Promise<string> {
        const [row] = await sql<{ fp: string }[]>`
          SELECT md5(string_agg(
                   id || ':' || team_name || ':' || player_name_raw || ':'
                     || coalesce(player_id::text, '-'), ',' ORDER BY id
                 )) AS fp
            FROM honour_team_members WHERE source_id = ${wikipediaId}
        `;
        return row.fp;
      }

      const first = runImporter(['honour_teams'], [], undefined);
      expect(first.status, importRole.diagnostics(first)).toBe(0);
      const fp1 = await fingerprint();

      const second = runImporter(['honour_teams'], [], undefined);
      expect(second.status, importRole.diagnostics(second)).toBe(0);
      expect(await fingerprint()).toBe(fp1);

      const third = runImporter(['honour_teams'], [], undefined);
      expect(third.status, importRole.diagnostics(third)).toBe(0);
      expect(await fingerprint()).toBe(fp1);
    }, 180_000);

    it('keeps the one explicit honour_team_members link decision (Ted Whitten) resolved across a reload', async () => {
      const prime = runImporter(['honour_teams'], [], undefined);
      expect(prime.status, importRole.diagnostics(prime)).toBe(0);

      const [before] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM honour_team_members
         WHERE team_name = 'AFL/VFL Team of the Century'
           AND player_name_raw = 'Ted Whitten'
           AND source_id = ${wikipediaId}
      `;
      expect(before, 'Ted Whitten must resolve under the manifest natural key').toBeDefined();
      expect(before.status).toBe('resolved');
      expect(before.playerId).not.toBeNull();

      const run = runImporter(['honour_teams'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [after] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM honour_team_members WHERE id = ${before.id}
      `;
      expect(after.id).toBe(before.id);
      expect(after.playerId).toBe(before.playerId);
      expect(after.status).toBe('resolved');
    });

    it('leaves all 24 unlinked observations unlinked', async () => {
      const run = runImporter(['honour_teams'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM honour_team_members
         WHERE source_id = ${wikipediaId} AND player_id IS NULL
      `;
      expect(n).toBe(24);
    });

    it('does not touch a manual_admin_edit honour_team_members row', async () => {
      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO honour_team_members
          (team_name, player_name_raw, link_status_value, source_id)
        VALUES
          ('AFLDB-ISSUE-112 Team', 'AFLDB-ISSUE-112 Member', 'unmatched', ${manualId})
        RETURNING id
      `;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const after = await sql<{ id: number; name: string; sourceId: number | null }[]>`
          SELECT id, player_name_raw AS name, source_id AS "sourceId"
            FROM honour_team_members WHERE id = ${fixture.id}
        `;
        expect(after[0]).toEqual({
          id: fixture.id, name: 'AFLDB-ISSUE-112 Member', sourceId: manualId,
        });
        expect(await countRows('honour_team_members')).toBe(before);
      } finally {
        await sql`DELETE FROM honour_team_members WHERE id = ${fixture.id}`;
      }
    });

    it('does not change hall_of_fame, captaincies, award_winners or award_nominations row counts', async () => {
      const before = await Promise.all([
        countRows('hall_of_fame'), countRows('captaincies'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      const run = runImporter(['honour_teams'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);
      const after = await Promise.all([
        countRows('hall_of_fame'), countRows('captaincies'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      expect(after).toEqual(before);
    });
  },
);

/**
 * AFLDB-ISSUE-112 phase 2: the checked-in manifest
 * (data/awards/hall-of-fame.csv) replaces the legacy SQLite hall_of_fame
 * table as the sole input to the hall_of_fame group. Legacy-free like
 * honour_teams — deliberately run with AFLDB_LEGACY_SQLITE forced unset,
 * proving the group no longer needs it, on top of the reload/link
 * guarantees the ISSUE-044/080 blocks already cover generically for this
 * table. hall_of_fame reloads on the natural key (name, inducted_year).
 */
describe.skipIf(!canRunHallOfFameImporter)(
  `hall-of-fame manifest reload (AFLDB-ISSUE-112)${roleParitySuffix}`,
  () => {
    const FIXTURE_EMAIL_112_HOF = 'issue-112-hall-of-fame@example.test';
    // The five hall_of_fame player_link_resolutions decisions measured
    // read-only from afldb_dev (§18): all action='linked', all already
    // 'resolved' on their row. inductedYear null is the undated Legend row.
    const DECIDED = [
      { name: 'Albert Chadwick', inductedYear: 1996, player: 2666 },
      { name: 'Carji Greeves', inductedYear: 1996, player: 2959 },
      { name: "Graham 'Polly' Farmer", inductedYear: 1996, player: 2861 },
      { name: 'John Kennedy Sr', inductedYear: 1996, player: 1893 },
      { name: 'John Kennedy Sr.', inductedYear: null, player: 1893 },
    ];
    let wikipediaId = 0;
    let manualId = 0;
    let adminUserId = 0;

    beforeAll(async () => {
      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources WHERE key IN ('wikipedia', 'manual_admin_edit')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_112_HOF}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;
    });

    afterAll(async () => {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    });

    it('reloads the full 343-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // The third argument forces AFLDB_LEGACY_SQLITE unset regardless of
      // this process's own environment — the headline ISSUE-112 acceptance.
      const run = runImporter(['hall_of_fame'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'hall_of_fame'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the hall_of_fame batch must be recorded').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(343);
      expect(Number(batch.recordsRejected)).toBe(0);

      const [counts] = await sql<{
        total: number; linked: number; unlinked: number; legends: number;
      }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
               count(*) FILTER (WHERE is_legend)::int AS legends
          FROM hall_of_fame
         WHERE source_id = ${wikipediaId}
      `;
      expect(counts).toEqual({ total: 343, linked: 246, unlinked: 97, legends: 34 });
    }, 120_000);

    it('is idempotent across three consecutive reloads with a byte-identical row-id fingerprint', async () => {
      async function fingerprint(): Promise<string> {
        const [row] = await sql<{ fp: string }[]>`
          SELECT md5(string_agg(
                   id || ':' || name || ':'
                     || coalesce(inducted_year::text, '-') || ':'
                     || coalesce(player_id::text, '-'), ',' ORDER BY id
                 )) AS fp
            FROM hall_of_fame WHERE source_id = ${wikipediaId}
        `;
        return row.fp;
      }

      const first = runImporter(['hall_of_fame'], [], undefined);
      expect(first.status, importRole.diagnostics(first)).toBe(0);
      const fp1 = await fingerprint();

      const second = runImporter(['hall_of_fame'], [], undefined);
      expect(second.status, importRole.diagnostics(second)).toBe(0);
      expect(await fingerprint()).toBe(fp1);

      const third = runImporter(['hall_of_fame'], [], undefined);
      expect(third.status, importRole.diagnostics(third)).toBe(0);
      expect(await fingerprint()).toBe(fp1);
    }, 180_000);

    it('keeps all five explicit hall_of_fame link decisions resolved across a reload', async () => {
      const prime = runImporter(['hall_of_fame'], [], undefined);
      expect(prime.status, importRole.diagnostics(prime)).toBe(0);

      for (const decided of DECIDED) {
        const yearMatch = decided.inductedYear === null
          ? sql`inducted_year IS NULL`
          : sql`inducted_year = ${decided.inductedYear}`;
        const [before] = await sql<{ id: number; playerId: number | null; status: string }[]>`
          SELECT id, player_id AS "playerId", link_status_value::text AS status
            FROM hall_of_fame
           WHERE name = ${decided.name} AND ${yearMatch}
             AND source_id = ${wikipediaId}
        `;
        expect(before, `${decided.name} must resolve under the manifest natural key`)
          .toBeDefined();
        expect(before.status).toBe('resolved');
        expect(before.playerId).toBe(decided.player);

        const run = runImporter(['hall_of_fame'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const [after] = await sql<{ id: number; playerId: number | null; status: string }[]>`
          SELECT id, player_id AS "playerId", link_status_value::text AS status
            FROM hall_of_fame WHERE id = ${before.id}
        `;
        expect(after.id).toBe(before.id);
        expect(after.playerId).toBe(decided.player);
        expect(after.status).toBe('resolved');
      }
    }, 180_000);

    it('leaves all 97 name-only observations unlinked', async () => {
      const run = runImporter(['hall_of_fame'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM hall_of_fame
         WHERE source_id = ${wikipediaId} AND player_id IS NULL
      `;
      expect(n).toBe(97);
    });

    it('does not touch a manual_admin_edit hall_of_fame row', async () => {
      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO hall_of_fame
          (name, link_status_value, source_id)
        VALUES
          ('AFLDB-ISSUE-112 HoF Fixture', 'unmatched', ${manualId})
        RETURNING id
      `;
      try {
        const before = await countRows('hall_of_fame');
        const run = runImporter(['hall_of_fame'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const after = await sql<{ id: number; name: string; sourceId: number | null }[]>`
          SELECT id, name, source_id AS "sourceId"
            FROM hall_of_fame WHERE id = ${fixture.id}
        `;
        expect(after[0]).toEqual({
          id: fixture.id, name: 'AFLDB-ISSUE-112 HoF Fixture', sourceId: manualId,
        });
        expect(await countRows('hall_of_fame')).toBe(before);
      } finally {
        await sql`DELETE FROM hall_of_fame WHERE id = ${fixture.id}`;
      }
    });

    it('does not change honour_team_members, captaincies, award_winners or award_nominations row counts', async () => {
      const before = await Promise.all([
        countRows('honour_team_members'), countRows('captaincies'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      const run = runImporter(['hall_of_fame'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);
      const after = await Promise.all([
        countRows('honour_team_members'), countRows('captaincies'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      expect(after).toEqual(before);
    });
  },
);

/**
 * AFLDB-ISSUE-112 phase 3: the checked-in manifest
 * (data/awards/captaincies.csv) replaces the legacy SQLite `captaincies`
 * table as the sole input to the captaincies group. Legacy-free like
 * honour_teams / hall_of_fame — deliberately run with AFLDB_LEGACY_SQLITE
 * forced unset, proving the group no longer needs it.
 *
 * Captaincies differs from the two natural-keyed slices: it reloads on
 * (source_id, source_record_id), source_record_id is preserved verbatim
 * (not re-minted), and `club` is the canonical clubs.name re-resolved by
 * the season-aware ClubResolver rather than a frozen club_id. This block
 * also carries the AFLDB-ISSUE-085 ownership protections that the retired
 * synthetic-SQLite captaincy fixture used to prove — foreign-owned rows
 * untouched, and _refuse_captaincy_natural_key_collisions() failing closed
 * on an incoming natural key held by a row this loader does not own.
 */
describe.skipIf(!canRunCaptainciesImporter)(
  `captaincies manifest reload (AFLDB-ISSUE-112)${roleParitySuffix}`,
  () => {
    const FIXTURE_EMAIL_112_CAP = 'issue-112-captaincies@example.test';
    // A resolved link_status row measured read-only from afldb_dev (§19):
    // captaincies carries no player_link_resolutions rows, so the decision
    // under test is the row's own resolved link, which must survive a
    // reload with its id and player_id intact.
    const RESOLVED_ROW = {
      sourceRecordId: '066e8905ca84a59c1efd8e65',
      season: 1939, clubSlug: 'richmond', player: 'Percy Bentley', playerId: 2546,
    };
    // Era-identity pairs: the manifest carries the canonical clubs.name and
    // the loader re-resolves it season-aware, so each of these must land on
    // the right era identity, not merely the right organisation.
    const ERA_ROWS = [
      { sourceRecordId: '94bbb520bd76ee8914df97f9', slug: 'footscray' },
      { sourceRecordId: 'e3f3009b4a7733e213c29c97', slug: 'western-bulldogs' },
      { sourceRecordId: '73ffabd0ff761da06c915426', slug: 'south-melbourne' },
      { sourceRecordId: 'd8fbedba08e26f9fc14a501a', slug: 'sydney' },
      { sourceRecordId: 'c6dcc2fa163957ff34591a86', slug: 'kangaroos' },
    ];
    let wikipediaId = 0;
    let manualId = 0;
    let adminUserId = 0;

    beforeAll(async () => {
      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources WHERE key IN ('wikipedia', 'manual_admin_edit')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_112_CAP}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;
    });

    afterAll(async () => {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    });

    it('reloads the full 1,375-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // The third argument forces AFLDB_LEGACY_SQLITE unset regardless of
      // this process's own environment — the headline ISSUE-112 acceptance.
      const run = runImporter(['captaincies'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'captaincies'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the captaincies batch must be recorded').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(1375);
      expect(Number(batch.recordsRejected)).toBe(0);

      const [counts] = await sql<{
        total: number; linked: number; unlinked: number;
        clubs: number; seasons: number;
      }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
               count(DISTINCT club_id)::int AS clubs,
               count(DISTINCT season)::int AS seasons
          FROM captaincies
         WHERE source_id = ${wikipediaId}
      `;
      expect(counts).toEqual({
        total: 1375, linked: 1375, unlinked: 0, clubs: 18, seasons: 130,
      });
    }, 120_000);

    it('re-resolves each era identity from the canonical club name, season-aware', async () => {
      const run = runImporter(['captaincies'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      for (const era of ERA_ROWS) {
        const [row] = await sql<{ slug: string }[]>`
          SELECT c.slug
            FROM captaincies e
            JOIN clubs c ON c.id = e.club_id
           WHERE e.source_id = ${wikipediaId}
             AND e.source_record_id = ${era.sourceRecordId}
        `;
        expect(row, `${era.sourceRecordId} must load`).toBeDefined();
        expect(row.slug).toBe(era.slug);
      }
    });

    it('is idempotent across three consecutive reloads with a byte-identical row-id fingerprint', async () => {
      async function fingerprint(): Promise<string> {
        const [row] = await sql<{ fp: string }[]>`
          SELECT md5(string_agg(
                   id || ':' || source_record_id || ':' || season || ':'
                     || club_id || ':' || coalesce(player_id::text, '-'),
                   ',' ORDER BY id
                 )) AS fp
            FROM captaincies WHERE source_id = ${wikipediaId}
        `;
        return row.fp;
      }

      const first = runImporter(['captaincies'], [], undefined);
      expect(first.status, importRole.diagnostics(first)).toBe(0);
      const fp1 = await fingerprint();

      const second = runImporter(['captaincies'], [], undefined);
      expect(second.status, importRole.diagnostics(second)).toBe(0);
      expect(await fingerprint()).toBe(fp1);

      const third = runImporter(['captaincies'], [], undefined);
      expect(third.status, importRole.diagnostics(third)).toBe(0);
      expect(await fingerprint()).toBe(fp1);
    }, 180_000);

    it('keeps a resolved captaincy link stable across a reload', async () => {
      const prime = runImporter(['captaincies'], [], undefined);
      expect(prime.status, importRole.diagnostics(prime)).toBe(0);

      const [before] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM captaincies
         WHERE source_id = ${wikipediaId}
           AND source_record_id = ${RESOLVED_ROW.sourceRecordId}
      `;
      expect(before, 'the resolved captaincy row must load').toBeDefined();
      expect(before.status).toBe('resolved');
      expect(before.playerId).toBe(RESOLVED_ROW.playerId);

      const run = runImporter(['captaincies'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [after] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM captaincies WHERE id = ${before.id}
      `;
      expect(after.id).toBe(before.id);
      expect(after.playerId).toBe(RESOLVED_ROW.playerId);
      expect(after.status).toBe('resolved');
    });

    it('leaves every wikipedia-owned captaincy linked (none dropped to unlinked)', async () => {
      const run = runImporter(['captaincies'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM captaincies
         WHERE source_id = ${wikipediaId} AND player_id IS NULL
      `;
      expect(n).toBe(0);
    });

    it('does not touch a manual_admin_edit captaincy row (AFLDB-ISSUE-085)', async () => {
      const [ref] = await sql<{ season: number; clubId: number }[]>`
        SELECT s.year::int AS season, c.id AS "clubId"
          FROM clubs c
          JOIN seasons s
            ON (c.first_season IS NULL OR s.year >= c.first_season)
           AND (c.last_season IS NULL OR s.year <= c.last_season)
         WHERE c.slug = 'adelaide'
         ORDER BY s.year DESC
         LIMIT 1
      `;
      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO captaincies
          (season, club_id, player_name_raw, link_status_value, role, period,
           notes, source_id, source_record_id)
        VALUES
          (${ref.season}, ${ref.clubId}, 'AFLDB-ISSUE-112 Foreign Captaincy',
           'unmatched', 'Captain', 'fixture period', 'foreign row unchanged',
           ${manualId}, 'issue-112:foreign-captaincy')
        RETURNING id
      `;
      try {
        const before = await countRows('captaincies');
        const run = runImporter(['captaincies'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const [after] = await sql<{
          id: number; name: string; sourceId: number | null; notes: string | null;
        }[]>`
          SELECT id, player_name_raw AS name, source_id AS "sourceId", notes
            FROM captaincies WHERE id = ${fixture.id}
        `;
        expect(after).toEqual({
          id: fixture.id, name: 'AFLDB-ISSUE-112 Foreign Captaincy',
          sourceId: manualId, notes: 'foreign row unchanged',
        });
        expect(await countRows('captaincies')).toBe(before);
      } finally {
        await sql`DELETE FROM captaincies WHERE id = ${fixture.id}`;
      }
    }, 120_000);

    it('fails closed when an incoming natural key is held by a foreign-owned row (AFLDB-ISSUE-085)', async () => {
      // Prime so the real Percy Bentley 1939 Richmond row exists and is
      // wikipedia-owned, then flip it to manual_admin_edit ownership. The
      // next reload's incoming manifest row for the same source_record_id
      // carries the natural key (1939, Richmond, 'Percy Bentley', 'Captain')
      // now held by a row this loader does not own —
      // _refuse_captaincy_natural_key_collisions must refuse before any write.
      const prime = runImporter(['captaincies'], [], undefined);
      expect(prime.status, importRole.diagnostics(prime)).toBe(0);

      const [target] = await sql<{ id: number }[]>`
        SELECT id FROM captaincies
         WHERE source_record_id = ${RESOLVED_ROW.sourceRecordId}
           AND source_id = ${wikipediaId}
      `;
      expect(target, 'the Percy Bentley 1939 row must exist after a reload').toBeDefined();

      await sql`UPDATE captaincies SET source_id = ${manualId} WHERE id = ${target.id}`;
      try {
        const before = await countRows('captaincies');
        const run = runImporter(['captaincies'], [], undefined);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('natural key(s)');
        expect(run.stdout).toContain('does not own');
        expect(run.stdout).toContain(`id=${target.id}`);
        expect(await countRows('captaincies')).toBe(before);

        const [row] = await sql<{ sourceId: number | null }[]>`
          SELECT source_id AS "sourceId" FROM captaincies WHERE id = ${target.id}
        `;
        expect(row.sourceId, 'the colliding foreign row is untouched').toBe(manualId);
      } finally {
        await sql`UPDATE captaincies SET source_id = ${wikipediaId} WHERE id = ${target.id}`;
        // Reinstate a clean wikipedia-owned population for later blocks.
        const restore = runImporter(['captaincies'], [], undefined);
        expect(restore.status, importRole.diagnostics(restore)).toBe(0);
      }
    }, 180_000);

    it('does not change hall_of_fame, honour_team_members, award_winners or award_nominations row counts', async () => {
      const before = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      const run = runImporter(['captaincies'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);
      const after = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('award_winners'), countRows('award_nominations'),
      ]);
      expect(after).toEqual(before);
    });
  },
);

/**
 * AFLDB-ISSUE-112 phase 4 — Rising Star (§20). Legacy-free like the three
 * slices above, run with AFLDB_LEGACY_SQLITE forced unset. Rising Star
 * differs from captaincies in three ways worth exercising: it targets
 * award_nominations (scoped by award_id AND source_id = footywire), it
 * carries a stat_line jsonb that must round-trip losslessly (763 present /
 * 3 NULL), and club/opponent are re-resolved season-aware with one NULL
 * club and three NULL opponents that must survive. award_nominations
 * carries no player_link_resolutions rows, so the link decision under test
 * is a row's own resolved link surviving with its id and player_id intact.
 */
describe.skipIf(!canRunRisingStarImporter)(
  `rising-star manifest reload (AFLDB-ISSUE-112)${roleParitySuffix}`,
  () => {
    const FIXTURE_EMAIL_112_RS = 'issue-112-rising-star@example.test';
    // A resolved link_status nomination measured read-only from afldb_dev
    // (§20): award_nominations has no player_link_resolutions rows, so this
    // row's own resolved link must survive a reload with id + player_id.
    const RESOLVED_ROW = {
      sourceRecordId: '03b8449457729cac471c5b83',
      season: 2011, player: 'Zachary Clarke', playerId: 11771,
    };
    // The first row in deterministic order — its stat_line must round-trip
    // byte-for-byte through the jsonb column.
    const STAT_ROW = {
      sourceRecordId: '001777a0faa59ba117929aea',
      statLine: {
        goals: 0, kicks: 14, marks: 8, behinds: 0, hitouts: 0, tackles: 3,
        disposals: 22, frees_for: 2, handballs: 8, frees_against: 2,
      },
    };
    // Era-identity pairs: the manifest carries the canonical clubs.name and
    // the loader re-resolves it season-aware, so each must land on the right
    // era identity, not merely the right organisation.
    const ERA_ROWS = [
      { sourceRecordId: '204a9f8ca77c768b30d54e8f', slug: 'footscray' },
      { sourceRecordId: '01be5b3fa45d12b9f2a10c0d', slug: 'western-bulldogs' },
      { sourceRecordId: '0a43b433a6a07cee7d918093', slug: 'brisbane-bears' },
      { sourceRecordId: '055ea694eb815631b7c2c7fd', slug: 'brisbane-lions' },
      { sourceRecordId: '116a983827629b058430ff5c', slug: 'kangaroos' },
      { sourceRecordId: '100c084c179998103a5eaa59', slug: 'fitzroy' },
    ];
    // The one nomination with no club, and one with no opponent + no
    // stat_line — both must remain NULL after a reload.
    const NULL_CLUB_ROW = '91f274ba89461c84a6b2aeab';
    const NULL_OPP_ROW = 'eb92521199120b4260861d6f';

    let footywireId = 0;
    let manualId = 0;
    let risingStarAwardId = 0;
    let adminUserId = 0;
    // How many of the manifest's 766 nominations this fixture DB can link:
    // the manifest carries afldb_dev's player_id verbatim (the deferred §7
    // rebuild-stability risk), and a players table that is staler or fresher
    // than afldb_dev's will be missing some — those load unlinked, exactly
    // as the loader's preserved valid-player guard dictates. Parity is
    // stated against this number so it is 766 on a matching DB and precise
    // (not merely "close") on a divergent one.
    let expectedLinked = 0;
    // The 'rising-star' award definition is a prerequisite of this loader
    // (import_rising_star guards on it). In a legacy-loaded database the
    // 'awards' group creates it; in the deferred canonical rebuild the
    // AWARDS/HONOURS definitions step will (AFLDB-ISSUE-112 §7). When it is
    // absent — a canonically rebuilt afldb_test — this block seeds a minimal
    // stand-in and removes it again afterwards so the fixture DB is left as
    // found. The loader reads only awards.id, so the other columns are
    // representative, not authoritative.
    let seededAwardDefinition = false;

    beforeAll(async () => {
      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources WHERE key IN ('footywire', 'manual_admin_edit')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      footywireId = byKey.get('footywire') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(footywireId, 'footywire source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [existing] = await sql<{ id: number }[]>`
        SELECT id FROM awards WHERE slug = 'rising-star'
      `;
      if (existing) {
        risingStarAwardId = existing.id;
      } else {
        const [seeded] = await sql<{ id: number }[]>`
          INSERT INTO awards (slug, name, category, competition, first_season, last_season)
          VALUES ('rising-star', 'AFL Rising Star', 'award', 'AFL', 1993, 2026)
          RETURNING id
        `;
        risingStarAwardId = seeded.id;
        seededAwardDefinition = true;
      }

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_112_RS}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;

      // source_key is column 0 and player_id column 6 — both before the
      // quoted stat_line cell, so a plain comma split is safe for them.
      const manifestPlayerIds = readFileSync(RISING_STAR_CSV, 'utf8')
        .trimEnd().split(/\r?\n/).slice(1)
        .map((line) => Number(line.split(',')[6]));
      const presentRows = await sql<{ id: number }[]>`
        SELECT id FROM players WHERE id = ANY(${manifestPlayerIds})
      `;
      const present = new Set(presentRows.map((row) => row.id));
      expectedLinked = manifestPlayerIds.filter((id) => present.has(id)).length;
      expect(expectedLinked).toBeGreaterThan(740);
    });

    afterAll(async () => {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
      if (seededAwardDefinition) {
        // ON DELETE CASCADE clears the award_nominations this block loaded.
        await sql`DELETE FROM awards WHERE id = ${risingStarAwardId}`;
      }
    });

    it('reloads the full 766-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // The third argument forces AFLDB_LEGACY_SQLITE unset regardless of
      // this process's own environment — the headline ISSUE-112 acceptance.
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'rising_star'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the rising_star batch must be recorded').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(766);
      expect(Number(batch.recordsRejected)).toBe(0);

      const [counts] = await sql<{
        total: number; linked: number; unlinked: number;
        seasons: number; winners: number; ineligible: number;
        nullClub: number; nullOpp: number;
        statPresent: number; statNull: number;
      }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
               count(DISTINCT season)::int AS seasons,
               count(*) FILTER (WHERE is_winner)::int AS winners,
               count(*) FILTER (WHERE is_ineligible)::int AS ineligible,
               count(*) FILTER (WHERE club_id IS NULL)::int AS "nullClub",
               count(*) FILTER (WHERE opponent_club_id IS NULL)::int AS "nullOpp",
               count(*) FILTER (WHERE stat_line IS NOT NULL)::int AS "statPresent",
               count(*) FILTER (WHERE stat_line IS NULL)::int AS "statNull"
          FROM award_nominations
         WHERE award_id = ${risingStarAwardId} AND source_id = ${footywireId}
      `;
      expect(counts).toMatchObject({
        total: 766, seasons: 34, winners: 33, ineligible: 9,
        nullClub: 1, nullOpp: 3, statPresent: 763, statNull: 3,
      });
      // Every nomination whose player_id this DB can resolve is linked, and
      // only the unresolvable ones are not — no silent link loss anywhere
      // else. On a DB matching afldb_dev this is 766 / 0.
      expect(counts.linked).toBe(expectedLinked);
      expect(counts.unlinked).toBe(766 - expectedLinked);

      // No winner has yet been decided for the final season.
      const [{ n: winners2026 }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_nominations
         WHERE award_id = ${risingStarAwardId} AND season = 2026 AND is_winner
      `;
      expect(winners2026).toBe(0);
    }, 120_000);

    it('re-resolves each era identity from the canonical club name, season-aware', async () => {
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      for (const era of ERA_ROWS) {
        const [row] = await sql<{ slug: string }[]>`
          SELECT c.slug
            FROM award_nominations e
            JOIN clubs c ON c.id = e.club_id
           WHERE e.source_id = ${footywireId}
             AND e.source_record_id = ${era.sourceRecordId}
        `;
        expect(row, `${era.sourceRecordId} must load with a club`).toBeDefined();
        expect(row.slug).toBe(era.slug);
      }
    });

    it('preserves the NULL club and NULL opponent rows exactly', async () => {
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [noClub] = await sql<{ clubId: number | null; oppId: number | null }[]>`
        SELECT club_id AS "clubId", opponent_club_id AS "oppId"
          FROM award_nominations
         WHERE source_id = ${footywireId} AND source_record_id = ${NULL_CLUB_ROW}
      `;
      expect(noClub, 'the null-club row must load').toBeDefined();
      expect(noClub.clubId).toBeNull();
      expect(noClub.oppId).not.toBeNull();

      const [noOpp] = await sql<{
        clubId: number | null; oppId: number | null; statLine: unknown;
      }[]>`
        SELECT club_id AS "clubId", opponent_club_id AS "oppId", stat_line AS "statLine"
          FROM award_nominations
         WHERE source_id = ${footywireId} AND source_record_id = ${NULL_OPP_ROW}
      `;
      expect(noOpp, 'the null-opponent row must load').toBeDefined();
      expect(noOpp.clubId).not.toBeNull();
      expect(noOpp.oppId).toBeNull();
      expect(noOpp.statLine).toBeNull();
    });

    it('round-trips a stat_line jsonb object byte-for-byte', async () => {
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [row] = await sql<{ statLine: Record<string, number> }[]>`
        SELECT stat_line AS "statLine"
          FROM award_nominations
         WHERE source_id = ${footywireId}
           AND source_record_id = ${STAT_ROW.sourceRecordId}
      `;
      expect(row, 'the stat_line row must load').toBeDefined();
      expect(row.statLine).toEqual(STAT_ROW.statLine);
    });

    it('is idempotent across three consecutive reloads with a byte-identical row-id fingerprint', async () => {
      async function fingerprint(): Promise<string> {
        const [row] = await sql<{ fp: string }[]>`
          SELECT md5(string_agg(
                   id || ':' || source_record_id || ':' || season || ':'
                     || round_number || ':' || coalesce(club_id::text, '-') || ':'
                     || coalesce(opponent_club_id::text, '-') || ':'
                     || coalesce(player_id::text, '-') || ':'
                     || coalesce(stat_line::text, '-'),
                   ',' ORDER BY id
                 )) AS fp
            FROM award_nominations
           WHERE award_id = ${risingStarAwardId} AND source_id = ${footywireId}
        `;
        return row.fp;
      }

      const first = runImporter(['rising_star'], [], undefined);
      expect(first.status, importRole.diagnostics(first)).toBe(0);
      const fp1 = await fingerprint();

      const second = runImporter(['rising_star'], [], undefined);
      expect(second.status, importRole.diagnostics(second)).toBe(0);
      expect(await fingerprint()).toBe(fp1);

      const third = runImporter(['rising_star'], [], undefined);
      expect(third.status, importRole.diagnostics(third)).toBe(0);
      expect(await fingerprint()).toBe(fp1);
    }, 180_000);

    it('keeps a resolved nomination link stable across a reload', async () => {
      const prime = runImporter(['rising_star'], [], undefined);
      expect(prime.status, importRole.diagnostics(prime)).toBe(0);

      const [before] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM award_nominations
         WHERE source_id = ${footywireId}
           AND source_record_id = ${RESOLVED_ROW.sourceRecordId}
      `;
      expect(before, 'the resolved nomination row must load').toBeDefined();
      expect(before.status).toBe('resolved');
      expect(before.playerId).toBe(RESOLVED_ROW.playerId);

      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [after] = await sql<{ id: number; playerId: number | null; status: string }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM award_nominations WHERE id = ${before.id}
      `;
      expect(after.id).toBe(before.id);
      expect(after.playerId).toBe(RESOLVED_ROW.playerId);
      expect(after.status).toBe('resolved');
    });

    it('drops a link only where the player_id cannot be resolved — never otherwise', async () => {
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_nominations
         WHERE award_id = ${risingStarAwardId}
           AND source_id = ${footywireId} AND player_id IS NULL
      `;
      expect(n).toBe(766 - expectedLinked);

      // Every unlinked nomination is unlinked *because* its manifest
      // player_id is absent from this DB — not for any other reason.
      const unlinked = await sql<{ status: string }[]>`
        SELECT link_status_value::text AS status
          FROM award_nominations
         WHERE award_id = ${risingStarAwardId}
           AND source_id = ${footywireId} AND player_id IS NULL
      `;
      for (const row of unlinked) expect(row.status).toBe('unmatched');
    });

    it('does not touch a manual_admin_edit nomination row (AFLDB-ISSUE-080)', async () => {
      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO award_nominations
          (award_id, season, round_number, player_name_raw, link_status_value,
           is_winner, is_ineligible, source_id, source_record_id)
        VALUES
          (${risingStarAwardId}, 2024, 1, 'AFLDB-ISSUE-112 Foreign Nomination',
           'unmatched', false, false, ${manualId}, 'issue-112:foreign-nomination')
        RETURNING id
      `;
      try {
        const before = await countRows('award_nominations');
        const run = runImporter(['rising_star'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const [after] = await sql<{
          id: number; name: string; sourceId: number | null;
        }[]>`
          SELECT id, player_name_raw AS name, source_id AS "sourceId"
            FROM award_nominations WHERE id = ${fixture.id}
        `;
        expect(after).toEqual({
          id: fixture.id, name: 'AFLDB-ISSUE-112 Foreign Nomination',
          sourceId: manualId,
        });
        expect(await countRows('award_nominations')).toBe(before);
      } finally {
        await sql`DELETE FROM award_nominations WHERE id = ${fixture.id}`;
      }
    }, 120_000);

    it('does not change hall_of_fame, honour_team_members, captaincies or award_winners row counts', async () => {
      const before = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('captaincies'), countRows('award_winners'),
      ]);
      const run = runImporter(['rising_star'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);
      const after = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('captaincies'), countRows('award_winners'),
      ]);
      expect(after).toEqual(before);
    });
  },
);

/** Quote-aware CSV field split — a few carnival-era rows carry a comma
 *  inside a quoted source_key / player cell. */
function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    let cell = '';
    if (line[i] === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { cell += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        cell += line[i];
        i += 1;
      }
    } else {
      while (i < line.length && line[i] !== ',') { cell += line[i]; i += 1; }
    }
    cells.push(cell);
    if (line[i] === ',') { i += 1; continue; }
    break;
  }
  return cells;
}

/**
 * AFLDB-ISSUE-112 phase 5: the All-Australian family, run with
 * AFLDB_LEGACY_SQLITE forced unset. It differs from the four earlier slices
 * in ways worth exercising: TWO provenance sources per family (draftguru 906
 * / wikipedia 252) that stay distinct and drive the per-row source_id; it
 * targets award_winners (scoped by award_id AND source_id IN (draftguru,
 * wikipedia)); it carries legitimately-duplicated (season, player) rows —
 * the 1984 club/state dual selections and the 2016 pair of different
 * footballers both named "Josh Kennedy" — that must survive as distinct
 * rows; and award_winners carries player_link_resolutions decisions for this
 * award (linked + confirmed_unlinked) that must survive a reload.
 */
describe.skipIf(!canRunAllAustralianImporter)(
  `all-australian manifest reload (AFLDB-ISSUE-112)${roleParitySuffix}`,
  () => {
    const FIXTURE_EMAIL_112_AA = 'issue-112-all-australian@example.test';
    // Era-identity rows: the manifest carries the source's own club string
    // and the loader re-resolves it season-aware, so each must land on the
    // right era identity — including where the source names the club by a
    // later or earlier identity than the season.
    const ERA_ROWS = [
      { srid: 'aa:1987:118', slug: 'brisbane-bears' },
      { srid: 'aa:1999:319', slug: 'brisbane-lions' },
      { srid: 'aa:1986:83', slug: 'footscray' },   // source says "Western Bulldogs"; 1986 clamps back
      { srid: 'aa:1999:317', slug: 'kangaroos' },  // source says "North Melbourne"; 1999 -> Kangaroos
      { srid: 'aa:1980:31', slug: 'south-melbourne' },
      { srid: 'aah:1982:David Ackerly:Sydney Swans', slug: 'sydney' },
    ];
    // A resolved-status draftguru row that also carries a linked
    // player_link_resolutions decision.
    const LINKED_DECISION_ROW = { srid: 'aa:1979:1', playerId: 2063 };
    // A confirmed_unlinked decision — stays unlinked across a reload.
    const CONFIRMED_UNLINKED_ROW = 'aa:1979:6';
    // The 1984 club/state dual selection (same player, different club,
    // distinct source_key — the "*" carnival marker kept in the key).
    const DUAL_1984 = [
      'aah:1984:Ross Glendinning:North Melbourne',
      'aah:1984:Ross Glendinning*:WA',
    ];
    // Two different footballers, both "Josh Kennedy", both in the 2016 team.
    const KENNEDY_2016 = [
      { srid: 'aa:2016:698', playerId: 11672 },
      { srid: 'aa:2016:699', playerId: 4169 },
    ];

    let draftguruId = 0;
    let wikipediaId = 0;
    let manualId = 0;
    let allAustralianAwardId = 0;
    let adminUserId = 0;
    // How many of the manifest's 1,078 linked rows this fixture DB can
    // resolve: the manifest carries afldb_dev's player_id verbatim (the
    // deferred §7 rebuild-stability risk), so a staler/fresher players table
    // is missing some — those load unlinked via the preserved valid-player
    // guard. Parity is stated against this number.
    let expectedLinked = 0;
    // The 'all-australian' award definition is a prerequisite (the loader
    // guards on it). In a legacy-loaded DB the 'awards' group creates it; a
    // canonically rebuilt afldb_test has none, so this block seeds a minimal
    // stand-in and removes it again afterwards.
    let seededAwardDefinition = false;

    beforeAll(async () => {
      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources
         WHERE key IN ('draftguru', 'wikipedia', 'manual_admin_edit')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      draftguruId = byKey.get('draftguru') ?? 0;
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(draftguruId, 'draftguru source must exist').toBeGreaterThan(0);
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [existing] = await sql<{ id: number }[]>`
        SELECT id FROM awards WHERE slug = 'all-australian'
      `;
      if (existing) {
        allAustralianAwardId = existing.id;
      } else {
        const [seeded] = await sql<{ id: number }[]>`
          INSERT INTO awards (slug, name, category, competition, first_season, last_season)
          VALUES ('all-australian', 'All-Australian Team', 'honour_team', 'AFL', 1953, 2025)
          RETURNING id
        `;
        allAustralianAwardId = seeded.id;
        seededAwardDefinition = true;
      }

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_112_AA}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;

      // player_id is column 5; source_key (0) and player (4) may be
      // CSV-quoted, so a quote-aware split is required.
      const manifestPlayerIds = readFileSync(ALL_AUSTRALIAN_CSV, 'utf8')
        .trimEnd().split(/\r?\n/).slice(1)
        .map((line) => splitCsv(line)[5])
        .filter((cell) => cell !== '')
        .map(Number);
      expect(manifestPlayerIds).toHaveLength(1078);
      const presentRows = await sql<{ id: number }[]>`
        SELECT id FROM players WHERE id = ANY(${manifestPlayerIds})
      `;
      const present = new Set(presentRows.map((row) => row.id));
      expectedLinked = manifestPlayerIds.filter((id) => present.has(id)).length;
      expect(expectedLinked).toBeGreaterThan(1040);
    });

    afterAll(async () => {
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
      if (seededAwardDefinition) {
        // ON DELETE CASCADE clears the award_winners this block loaded.
        await sql`DELETE FROM awards WHERE id = ${allAustralianAwardId}`;
      }
    });

    async function scopedCount(): Promise<{
      total: number; draftguru: number; wikipedia: number;
      seasons: number; linked: number; unlinked: number;
      captains: number; vices: number; rows1984: number; dupPairs: number;
    }> {
      const [row] = await sql<{
        total: number; draftguru: number; wikipedia: number;
        seasons: number; linked: number; unlinked: number;
        captains: number; vices: number; rows1984: number;
      }[]>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE source_id = ${draftguruId})::int AS draftguru,
               count(*) FILTER (WHERE source_id = ${wikipediaId})::int AS wikipedia,
               count(DISTINCT season)::int AS seasons,
               count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked,
               count(*) FILTER (WHERE player_id IS NULL)::int AS unlinked,
               count(*) FILTER (WHERE is_captain)::int AS captains,
               count(*) FILTER (WHERE is_vice_captain)::int AS vices,
               count(*) FILTER (WHERE season = 1984)::int AS "rows1984"
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_id IN (${draftguruId}, ${wikipediaId})
      `;
      const [{ dup }] = await sql<{ dup: number }[]>`
        SELECT count(*)::int AS dup FROM (
          SELECT 1 FROM award_winners
           WHERE award_id = ${allAustralianAwardId}
             AND source_id IN (${draftguruId}, ${wikipediaId})
           GROUP BY season, player_name_raw
          HAVING count(*) > 1) t
      `;
      return { ...row, dupPairs: dup };
    }

    it('reloads the full 1,158-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset', async () => {
      const [before] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;

      // The third argument forces AFLDB_LEGACY_SQLITE unset regardless of
      // this process's own environment — the headline ISSUE-112 acceptance.
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const [batch] = await sql<{
        status: string; recordsRead: string; recordsRejected: string;
      }[]>`
        SELECT status::text AS status,
               records_read::text AS "recordsRead",
               records_rejected::text AS "recordsRejected"
          FROM import_batches
         WHERE id > ${before.id}::bigint
           AND tool = 'import_awards.py'
           AND target_table = 'all_australian'
         ORDER BY id DESC
         LIMIT 1
      `;
      expect(batch, 'the all_australian batch must be recorded').toBeDefined();
      expect(batch.status).toBe('completed');
      expect(Number(batch.recordsRead)).toBe(1158);
      expect(Number(batch.recordsRejected)).toBe(0);

      const counts = await scopedCount();
      expect(counts).toMatchObject({
        total: 1158, draftguru: 906, wikipedia: 252, seasons: 53,
        captains: 34, vices: 21, rows1984: 48, dupPairs: 10,
      });
      // Every selection whose player_id this DB can resolve is linked, and
      // only the unresolvable ones are not.
      expect(counts.linked).toBe(expectedLinked);
      expect(counts.unlinked).toBe(1158 - expectedLinked);
    }, 120_000);

    it('re-resolves each era identity from the source club string, season-aware', async () => {
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      for (const era of ERA_ROWS) {
        const [row] = await sql<{ slug: string }[]>`
          SELECT c.slug
            FROM award_winners w
            JOIN clubs c ON c.id = w.club_id
           WHERE w.award_id = ${allAustralianAwardId}
             AND w.source_record_id = ${era.srid}
        `;
        expect(row, `${era.srid} must load with a club`).toBeDefined();
        expect(row.slug).toBe(era.slug);
      }
    });

    it('keeps the 1984 club/state dual selections and the 2016 Josh Kennedy pair as distinct rows', async () => {
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const dual = await sql<{
        srid: string; playerId: number | null; clubId: number | null;
      }[]>`
        SELECT source_record_id AS srid, player_id AS "playerId", club_id AS "clubId"
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_record_id = ANY(${DUAL_1984})
         ORDER BY source_record_id
      `;
      expect(dual).toHaveLength(2);
      // Same footballer, two selections, different club identity.
      expect(dual[0].playerId).toBe(dual[1].playerId);
      expect(dual[0].playerId).not.toBeNull();
      expect(dual[0].clubId).not.toBe(dual[1].clubId);

      const kennedy = await sql<{ srid: string; playerId: number | null }[]>`
        SELECT source_record_id AS srid, player_id AS "playerId"
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_record_id = ANY(${KENNEDY_2016.map((k) => k.srid)})
         ORDER BY source_record_id
      `;
      expect(kennedy).toHaveLength(2);
      const kById = new Map(kennedy.map((k) => [k.srid, k.playerId]));
      for (const k of KENNEDY_2016) {
        // Only assert identity where this DB actually has that player.
        if (kById.get(k.srid) !== null) expect(kById.get(k.srid)).toBe(k.playerId);
      }
      // Two different footballers.
      expect(kennedy[0].playerId).not.toBe(kennedy[1].playerId);
    });

    it('preserves the carried link state and any player_link_resolutions decision on this award (G5 shape)', async () => {
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      // afldb_dev carries 23 curation decisions on this award (20 linked,
      // 3 confirmed_unlinked); a canonically rebuilt afldb_test carries none.
      // Whatever the test DB has, the guarantee is the same: no decision is
      // orphaned, and no linked decision's row now carries a different
      // player. `linked` / `unlinkedDecisions` are reported, not gated.
      const [{ badLinked, badUnlinked, linked, unlinkedDecisions }] = await sql<{
        badLinked: number; badUnlinked: number;
        linked: number; unlinkedDecisions: number;
      }[]>`
        SELECT count(*) FILTER (
                 WHERE r.action = 'linked'
                   AND (w.id IS NULL OR w.player_id IS DISTINCT FROM r.player_id)
               )::int AS "badLinked",
               count(*) FILTER (
                 WHERE r.action = 'confirmed_unlinked'
                   AND (w.id IS NULL OR w.player_id IS NOT NULL)
               )::int AS "badUnlinked",
               count(*) FILTER (WHERE r.action = 'linked')::int AS linked,
               count(*) FILTER (WHERE r.action = 'confirmed_unlinked')::int AS "unlinkedDecisions"
          FROM player_link_resolutions r
          JOIN award_winners w
            ON w.id = r.target_id AND w.award_id = ${allAustralianAwardId}
         WHERE r.target_table = 'award_winners'
      `;
      expect(badLinked).toBe(0);
      expect(badUnlinked).toBe(0);
      // On a DB that matches afldb_dev this is 20 / 3; on a rebuilt one, 0 / 0.
      expect(linked).toBeGreaterThanOrEqual(0);
      expect(unlinkedDecisions).toBeGreaterThanOrEqual(0);

      // The manifest's own carried link state must load regardless: a
      // resolved draftguru row lands linked to its decided player, a
      // confirmed-unlinked row stays unlinked.
      const [decided] = await sql<{
        id: number; playerId: number | null; status: string;
      }[]>`
        SELECT id, player_id AS "playerId", link_status_value::text AS status
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_record_id = ${LINKED_DECISION_ROW.srid}
      `;
      expect(decided.playerId).toBe(LINKED_DECISION_ROW.playerId);
      expect(decided.status).toBe('resolved');

      const [confirmed] = await sql<{ playerId: number | null; status: string }[]>`
        SELECT player_id AS "playerId", link_status_value::text AS status
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_record_id = ${CONFIRMED_UNLINKED_ROW}
      `;
      expect(confirmed.playerId).toBeNull();
      expect(confirmed.status).toBe('unmatched');

      // id stability across another reload.
      const rerun = runImporter(['all_australian'], [], undefined);
      expect(rerun.status, importRole.diagnostics(rerun)).toBe(0);
      const [after] = await sql<{ id: number; playerId: number | null }[]>`
        SELECT id, player_id AS "playerId" FROM award_winners WHERE id = ${decided.id}
      `;
      expect(after.id).toBe(decided.id);
      expect(after.playerId).toBe(LINKED_DECISION_ROW.playerId);
    }, 120_000);

    it('is idempotent across three consecutive reloads with a byte-identical row-id fingerprint', async () => {
      async function fingerprint(): Promise<string> {
        const [row] = await sql<{ fp: string }[]>`
          SELECT md5(string_agg(
                   id || ':' || source_record_id || ':' || season || ':'
                     || coalesce(club_id::text, '-') || ':'
                     || coalesce(player_id::text, '-') || ':'
                     || coalesce(position, '-') || ':'
                     || is_captain || ':' || is_vice_captain || ':'
                     || candidate_count || ':' || coalesce(note, '-'),
                   ',' ORDER BY id
                 )) AS fp
            FROM award_winners
           WHERE award_id = ${allAustralianAwardId}
             AND source_id IN (${draftguruId}, ${wikipediaId})
        `;
        return row.fp;
      }

      const first = runImporter(['all_australian'], [], undefined);
      expect(first.status, importRole.diagnostics(first)).toBe(0);
      const fp1 = await fingerprint();

      const second = runImporter(['all_australian'], [], undefined);
      expect(second.status, importRole.diagnostics(second)).toBe(0);
      expect(await fingerprint()).toBe(fp1);

      const third = runImporter(['all_australian'], [], undefined);
      expect(third.status, importRole.diagnostics(third)).toBe(0);
      expect(await fingerprint()).toBe(fp1);
    }, 180_000);

    it('drops a link only where the player_id cannot be resolved — never otherwise', async () => {
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);

      const unlinked = await sql<{ status: string }[]>`
        SELECT link_status_value::text AS status
          FROM award_winners
         WHERE award_id = ${allAustralianAwardId}
           AND source_id IN (${draftguruId}, ${wikipediaId})
           AND player_id IS NULL
      `;
      expect(unlinked).toHaveLength(1158 - expectedLinked);
      for (const row of unlinked) {
        expect(['unmatched', 'implausible', 'ambiguous']).toContain(row.status);
      }
    });

    it('does not touch a manual_admin_edit award_winners row (AFLDB-ISSUE-080)', async () => {
      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO award_winners
          (award_id, season, player_name_raw, link_status_value,
           source_id, source_record_id)
        VALUES
          (${allAustralianAwardId}, 1979, 'AFLDB-ISSUE-112 Foreign Selection',
           'unmatched', ${manualId}, 'issue-112:foreign-all-australian')
        RETURNING id
      `;
      try {
        const before = await countRows('award_winners');
        const run = runImporter(['all_australian'], [], undefined);
        expect(run.status, importRole.diagnostics(run)).toBe(0);

        const [after] = await sql<{
          id: number; name: string; sourceId: number | null;
        }[]>`
          SELECT id, player_name_raw AS name, source_id AS "sourceId"
            FROM award_winners WHERE id = ${fixture.id}
        `;
        expect(after).toEqual({
          id: fixture.id, name: 'AFLDB-ISSUE-112 Foreign Selection',
          sourceId: manualId,
        });
        expect(await countRows('award_winners')).toBe(before);
      } finally {
        await sql`DELETE FROM award_winners WHERE id = ${fixture.id}`;
      }
    }, 120_000);

    it('does not change other award families or the other honours tables', async () => {
      const [otherBefore] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w JOIN awards a ON a.id = w.award_id
         WHERE a.slug <> 'all-australian'
      `;
      const before = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('captaincies'), countRows('award_nominations'),
      ]);
      const run = runImporter(['all_australian'], [], undefined);
      expect(run.status, importRole.diagnostics(run)).toBe(0);
      const [otherAfter] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w JOIN awards a ON a.id = w.award_id
         WHERE a.slug <> 'all-australian'
      `;
      const after = await Promise.all([
        countRows('hall_of_fame'), countRows('honour_team_members'),
        countRows('captaincies'), countRows('award_nominations'),
      ]);
      expect(otherAfter.n).toBe(otherBefore.n);
      expect(after).toEqual(before);
    });
  },
);

/**
 * A source reload reconciles only the rows its own source supplies
 * (AFLDB-ISSUE-080). Rows created by an administrator, promoted from the
 * ingest pipeline, or of unknown provenance are outside every reload's
 * UPDATE/INSERT/DELETE population, and a collision between an incoming key
 * and a foreign-owned row fails closed before any write.
 */
const HONOUR_TEAM_LOCK_NAMESPACE = 717275;
const HONOUR_TEAM_LOCK_KEY = 1;
const NOTE_080 = 'AFLDB-ISSUE-080 ownership survival';
const FIXTURE_EMAIL_080 = 'issue-080-reload@example.test';

type MemberRow = {
  id: number;
  teamName: string;
  name: string;
  playerId: number | null;
  status: string;
};

describe.skipIf(!canRunImporter)(
  `honours reloads reconcile only rows they own (AFLDB-ISSUE-080)${roleParitySuffix}`,
  () => {
    let adminUserId = 0;
    let wikipediaId = 0;
    let manualId = 0;
    let sportsDataLabId = 0;
    let playerA = 0;
    let playerB = 0;
    /** Fixture rows to remove, run in reverse order. */
    const cleanup: Array<() => Promise<void>> = [];

    async function sourceMember(linked: boolean): Promise<MemberRow> {
      const rows = await sql<MemberRow[]>`
        SELECT id, team_name AS "teamName", player_name_raw AS "name",
               player_id AS "playerId", link_status_value::text AS status
          FROM honour_team_members
         WHERE source_id = ${wikipediaId}
           AND ${linked
             ? sql`player_id IS NOT NULL AND link_status_value::text = 'unique'`
             : sql`player_id IS NULL AND link_status_value::text IN ('ambiguous', 'unmatched', 'implausible')`}
         ORDER BY id
         LIMIT 1
      `;
      expect(rows[0], `afldb_test needs a ${linked ? 'linked' : 'unlinked'} wikipedia honour-team row`).toBeDefined();
      return rows[0];
    }

    async function playerNotInTeam(teamName: string): Promise<number> {
      const [p] = await sql<{ id: number }[]>`
        SELECT p.id FROM players p
         WHERE NOT EXISTS (
                 SELECT 1 FROM honour_team_members m
                  WHERE m.team_name = ${teamName} AND m.player_id = p.id)
         ORDER BY p.id
         LIMIT 1
      `;
      return p.id;
    }

    async function honoursFingerprint(): Promise<string[]> {
      const [hof] = await sql<{ fp: string }[]>`
        SELECT md5(string_agg(id || ':' || name || ':' || coalesce(player_id::text, '-'), ',' ORDER BY id)) AS fp
          FROM hall_of_fame
      `;
      const [members] = await sql<{ fp: string }[]>`
        SELECT md5(string_agg(id || ':' || team_name || ':' || player_name_raw || ':' || coalesce(player_id::text, '-'), ',' ORDER BY id)) AS fp
          FROM honour_team_members
      `;
      return [hof.fp, members.fp];
    }

    beforeAll(async () => {
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL_080}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;

      const sourceRows = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources
         WHERE key IN ('wikipedia', 'manual_admin_edit', 'sports_data_lab')
      `;
      const byKey = new Map(sourceRows.map((row) => [row.key, row.id]));
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      sportsDataLabId = byKey.get('sports_data_lab') ?? 0;
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);
      expect(sportsDataLabId, 'sports_data_lab source must exist').toBeGreaterThan(0);

      const players = await sql<{ id: number }[]>`
        SELECT id FROM players ORDER BY id LIMIT 2
      `;
      playerA = players[0].id;
      playerB = players[1].id;
    });

    afterAll(async () => {
      for (const undo of cleanup.reverse()) {
        try {
          await undo();
        } catch {
          // Keep unwinding: one failed cleanup must not strand the rest.
        }
      }
      await sql`
        DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}
      `;
      await sql`
        DELETE FROM data_edits WHERE admin_user_id = ${adminUserId}
      `;
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
    });

    it('keeps admin-created honours rows across a reload, linked, decided or not', async () => {
      // NULL provenance (a historical admin row) and manual_admin_edit (a new
      // one): both are outside the wikipedia scope and both must survive.
      const [hofNull] = await sql<{ id: number }[]>`
        INSERT INTO hall_of_fame (name, link_status_value, category, inducted_year)
        VALUES ('AFLDB-ISSUE-080 Null Provenance', 'unmatched', 'Player', 2099)
        RETURNING id
      `;
      const [hofManual] = await sql<{ id: number }[]>`
        INSERT INTO hall_of_fame (name, link_status_value, category, inducted_year, source_id)
        VALUES ('AFLDB-ISSUE-080 Manual Provenance', 'unmatched', 'Player', 2098, ${manualId})
        RETURNING id
      `;
      const [memberNull] = await sql<{ id: number }[]>`
        INSERT INTO honour_team_members (team_name, player_name_raw, link_status_value)
        VALUES ('AFLDB-ISSUE-080 Team', 'AFLDB-ISSUE-080 Unlinked Member', 'unmatched')
        RETURNING id
      `;
      const [memberManual] = await sql<{ id: number }[]>`
        INSERT INTO honour_team_members (team_name, player_name_raw, link_status_value, source_id)
        VALUES ('AFLDB-ISSUE-080 Team', 'AFLDB-ISSUE-080 Linked Member', 'unmatched', ${manualId})
        RETURNING id
      `;
      cleanup.push(async () => {
        await sql`DELETE FROM hall_of_fame WHERE id IN (${hofNull.id}, ${hofManual.id})`;
        await sql`DELETE FROM honour_team_members WHERE id IN (${memberNull.id}, ${memberManual.id})`;
      });

      // One of each carries a manual decision: before scoping, that decision
      // aborted the whole reload with LinkDecisionLoss; the undecided ones
      // were deleted silently.
      expect(await resolveLink({
        targetTable: 'hall_of_fame',
        targetId: hofManual.id,
        playerId: playerA,
        adminUserId,
        note: NOTE_080,
      })).toEqual({ ok: true });
      expect(await resolveLink({
        targetTable: 'honour_team_members',
        targetId: memberManual.id,
        playerId: playerB,
        adminUserId,
        note: NOTE_080,
      })).toEqual({ ok: true });

      const hofBefore = await countRows('hall_of_fame');
      const membersBefore = await countRows('honour_team_members');

      const run = runImporter(['hall_of_fame', 'honour_teams']);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).not.toContain('cannot survive');

      const survivors = await sql<{
        id: number; name: string; playerId: number | null; sourceId: number | null;
      }[]>`
        SELECT id, name, player_id AS "playerId", source_id AS "sourceId"
          FROM hall_of_fame WHERE id IN (${hofNull.id}, ${hofManual.id})
         ORDER BY id
      `;
      expect(survivors).toEqual([
        { id: hofNull.id, name: 'AFLDB-ISSUE-080 Null Provenance', playerId: null, sourceId: null },
        { id: hofManual.id, name: 'AFLDB-ISSUE-080 Manual Provenance', playerId: playerA, sourceId: manualId },
      ]);

      const memberSurvivors = await sql<{
        id: number; name: string; playerId: number | null; sourceId: number | null;
      }[]>`
        SELECT id, player_name_raw AS name, player_id AS "playerId", source_id AS "sourceId"
          FROM honour_team_members WHERE id IN (${memberNull.id}, ${memberManual.id})
         ORDER BY id
      `;
      expect(memberSurvivors).toEqual([
        { id: memberNull.id, name: 'AFLDB-ISSUE-080 Unlinked Member', playerId: null, sourceId: null },
        { id: memberManual.id, name: 'AFLDB-ISSUE-080 Linked Member', playerId: playerB, sourceId: manualId },
      ]);

      expect(await countRows('hall_of_fame')).toBe(hofBefore);
      expect(await countRows('honour_team_members')).toBe(membersBefore);
    });

    it(
      'keeps foreign-owned award rows across the full legacy awards reload',
      async () => {
        const [legacyAward] = await sql<{ id: number }[]>`
          SELECT id FROM awards
           WHERE slug NOT IN ('22-under-22', 'all-australian')
           ORDER BY id LIMIT 1
        `;
        const [aaAward] = await sql<{ id: number }[]>`
          SELECT id FROM awards WHERE slug = 'all-australian'
        `;
        const [rsAward] = await sql<{ id: number }[]>`
          SELECT id FROM awards WHERE slug = 'rising-star'
        `;
        const [{ year }] = await sql<{ year: number }[]>`
          SELECT max(year)::int AS year FROM seasons
        `;

        // A manual admin winner inside the legacy domain scope, an ingest-
        // promoted All-Australian row and an ingest-promoted Rising Star
        // nomination: three foreign owners the reloads used to delete.
        const [manualWinner] = await sql<{ id: number }[]>`
          INSERT INTO award_winners
            (award_id, season, player_name_raw, link_status_value, source_id, source_record_id)
          VALUES (${legacyAward.id}, ${year}, 'AFLDB-ISSUE-080 Manual Winner', 'unmatched',
                  ${manualId}, 'award_winner:issue-080-fixture')
          RETURNING id
        `;
        const [promotedAa] = await sql<{ id: number }[]>`
          INSERT INTO award_winners
            (award_id, season, player_name_raw, link_status_value, player_id, source_id, source_record_id)
          VALUES (${aaAward.id}, ${year}, 'AFLDB-ISSUE-080 Promoted AA', 'resolved',
                  ${playerA}, ${sportsDataLabId}, 'issue-080:aa-fixture')
          RETURNING id
        `;
        const [promotedNominee] = await sql<{ id: number }[]>`
          INSERT INTO award_nominations
            (award_id, season, round_number, player_name_raw, link_status_value, player_id, source_id, source_record_id)
          VALUES (${rsAward.id}, ${year}, 1, 'AFLDB-ISSUE-080 Promoted Nominee', 'resolved',
                  ${playerB}, ${sportsDataLabId}, 'issue-080:rs-fixture')
          RETURNING id
        `;
        cleanup.push(async () => {
          await sql`DELETE FROM award_winners WHERE id IN (${manualWinner.id}, ${promotedAa.id})`;
          await sql`DELETE FROM award_nominations WHERE id = ${promotedNominee.id}`;
        });

        // The manual winner also carries a decision, the double failure mode:
        // before scoping this aborted the reload; without it the row vanished.
        expect(await resolveLink({
          targetTable: 'award_winners',
          targetId: manualWinner.id,
          playerId: playerB,
          adminUserId,
          note: NOTE_080,
        })).toEqual({ ok: true });

        const winnersBefore = await countRows('award_winners');
        const nominationsBefore = await countRows('award_nominations');

        const run = runImporter(['awards']);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).not.toContain('cannot survive');

        const winnerSurvivors = await sql<{
          id: number; name: string; playerId: number | null; sourceId: number | null; recordId: string;
        }[]>`
          SELECT id, player_name_raw AS name, player_id AS "playerId",
                 source_id AS "sourceId", source_record_id AS "recordId"
            FROM award_winners WHERE id IN (${manualWinner.id}, ${promotedAa.id})
           ORDER BY id
        `;
        expect(winnerSurvivors).toEqual([
          {
            id: manualWinner.id,
            name: 'AFLDB-ISSUE-080 Manual Winner',
            playerId: playerB,
            sourceId: manualId,
            recordId: 'award_winner:issue-080-fixture',
          },
          {
            id: promotedAa.id,
            name: 'AFLDB-ISSUE-080 Promoted AA',
            playerId: playerA,
            sourceId: sportsDataLabId,
            recordId: 'issue-080:aa-fixture',
          },
        ]);

        const [nomineeSurvivor] = await sql<{
          id: number; playerId: number | null; sourceId: number | null;
        }[]>`
          SELECT id, player_id AS "playerId", source_id AS "sourceId"
            FROM award_nominations WHERE id = ${promotedNominee.id}
        `;
        expect(nomineeSurvivor).toEqual({
          id: promotedNominee.id,
          playerId: playerB,
          sourceId: sportsDataLabId,
        });

        expect(await countRows('award_winners')).toBe(winnersBefore);
        expect(await countRows('award_nominations')).toBe(nominationsBefore);
      },
      300_000,
    );

    it('refuses the Hall of Fame reload when a foreign row occupies an incoming key', async () => {
      // The dangerous shape check 1 exists for: a foreign-owned row holds a
      // key the extract still carries. Manufactured by disowning a source row.
      const [row] = await sql<{ id: number }[]>`
        SELECT id FROM hall_of_fame
         WHERE source_id = ${wikipediaId}
         ORDER BY id LIMIT 1
      `;
      await sql`UPDATE hall_of_fame SET source_id = NULL WHERE id = ${row.id}`;
      try {
        const before = await countRows('hall_of_fame');

        const run = runImporter(['hall_of_fame']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('does not own');
        expect(run.stdout).toContain(`id=${row.id}`);

        expect(await countRows('hall_of_fame')).toBe(before);
        const [after] = await sql<{ sourceId: number | null }[]>`
          SELECT source_id AS "sourceId" FROM hall_of_fame WHERE id = ${row.id}
        `;
        expect(after.sourceId, 'the foreign row is untouched').toBeNull();
      } finally {
        await sql`UPDATE hall_of_fame SET source_id = ${wikipediaId} WHERE id = ${row.id}`;
      }
    });

    it('refuses an honour-team reload over a foreign unlinked row with an incoming unlinked name', async () => {
      const row = await sourceMember(false);
      await sql`UPDATE honour_team_members SET source_id = NULL WHERE id = ${row.id}`;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('identity is unknown on both sides');
        expect(run.stdout).toContain(`id=${row.id}`);
        expect(await countRows('honour_team_members')).toBe(before);
      } finally {
        await sql`UPDATE honour_team_members SET source_id = ${wikipediaId} WHERE id = ${row.id}`;
      }
    });

    it('refuses when a foreign unlinked row meets the same name incoming linked', async () => {
      const row = await sourceMember(true);
      await sql`
        UPDATE honour_team_members
           SET source_id = NULL, player_id = NULL, link_status_value = 'unmatched'
         WHERE id = ${row.id}
      `;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('review whether they are the same person');
        expect(run.stdout).toContain(`id=${row.id}`);
        expect(await countRows('honour_team_members')).toBe(before);
      } finally {
        await sql`
          UPDATE honour_team_members
             SET source_id = ${wikipediaId}, player_id = ${row.playerId},
                 link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      }
    });

    it('refuses when a foreign linked row meets the same name incoming unlinked, creating no duplicate', async () => {
      // One of the two collision shapes with no unique-index backstop after
      // migration 059: only the preflight stands between this and a silent
      // duplicate person.
      const row = await sourceMember(false);
      const foreignPlayer = await playerNotInTeam(row.teamName);
      await sql`
        UPDATE honour_team_members
           SET source_id = NULL, player_id = ${foreignPlayer},
               link_status_value = 'resolved'
         WHERE id = ${row.id}
      `;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('review whether they are the same person');
        expect(run.stdout).toContain(`id=${row.id}`);
        expect(await countRows('honour_team_members'), 'no silent duplicate').toBe(before);
        const twins = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM honour_team_members
           WHERE team_name = ${row.teamName} AND player_name_raw = ${row.name}
        `;
        expect(twins[0].n).toBe(1);
      } finally {
        await sql`
          UPDATE honour_team_members
             SET source_id = ${wikipediaId}, player_id = NULL,
                 link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      }
    });

    it('refuses when a foreign row and the incoming row assert the same linked player', async () => {
      const row = await sourceMember(true);
      await sql`UPDATE honour_team_members SET source_id = NULL WHERE id = ${row.id}`;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain(`already records player ${row.playerId}`);
        expect(await countRows('honour_team_members')).toBe(before);
      } finally {
        await sql`UPDATE honour_team_members SET source_id = ${wikipediaId} WHERE id = ${row.id}`;
      }
    });

    it('refuses the same linked player recorded under a different raw name (§4.4)', async () => {
      const row = await sourceMember(true);
      await sql`
        UPDATE honour_team_members
           SET source_id = NULL, player_name_raw = ${`${row.name} (variant)`}
         WHERE id = ${row.id}
      `;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, 'the reload must fail closed').toBe(1);
        // The names differ, so only the (team_name, player_id) axis can fire.
        expect(run.stdout).toContain(`already records player ${row.playerId}`);
        expect(run.stdout).toContain('(variant)');
        expect(await countRows('honour_team_members')).toBe(before);
      } finally {
        await sql`
          UPDATE honour_team_members
             SET source_id = ${wikipediaId}, player_name_raw = ${row.name}
           WHERE id = ${row.id}
        `;
      }
    });

    it('createHonourTeamMember refuses the same linked player under a different display name (§4.4 axis 2, real database)', async () => {
      // The unit suite mocks this mutation's SQL, so only a real database can
      // prove that the player_id disjunct of the identity SELECT — same
      // team_name OR same non-NULL player_id — actually matches in
      // PostgreSQL. The fixture's raw name is guaranteed to differ from the
      // player's display name (which the mutation substitutes when playerId
      // is supplied), so the raw-name disjunct cannot fire: only
      // (team_name, player_id) can select the existing row.
      const teamName = 'AFLDB-ISSUE-080 Axis2 Team';
      const variantName = 'AFLDB-ISSUE-080 Axis2 Variant';
      const [display] = await sql<{ name: string }[]>`
        SELECT display_name AS name FROM players WHERE id = ${playerA}
      `;
      expect(display.name).not.toBe(variantName);

      const [fixture] = await sql<{ id: number }[]>`
        INSERT INTO honour_team_members
          (team_name, player_name_raw, player_id, link_status_value, source_id)
        VALUES (${teamName}, ${variantName}, ${playerA}, 'resolved', ${manualId})
        RETURNING id
      `;
      cleanup.push(async () => {
        await sql`DELETE FROM honour_team_members WHERE id = ${fixture.id}`;
      });

      const countAudits = async () => {
        const [r] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM data_edits
           WHERE admin_user_id = ${adminUserId}
             AND table_name = 'honour_team_members'
        `;
        return r.n;
      };
      const auditsBefore = await countAudits();

      await expect(createHonourTeamMember({
        teamName,
        playerId: playerA,
        adminUserId,
      })).rejects.toThrow(/already records this player as 'AFLDB-ISSUE-080 Axis2 Variant'/);

      // The refused create wrote nothing: no second row for the identity, the
      // existing row byte-identical, and no mutation-audit row.
      const rows = await sql<{
        id: number; name: string; playerId: number | null;
        sourceId: number | null; status: string;
      }[]>`
        SELECT id, player_name_raw AS name, player_id AS "playerId",
               source_id AS "sourceId", link_status_value::text AS status
          FROM honour_team_members
         WHERE team_name = ${teamName}
      `;
      expect(rows).toEqual([{
        id: fixture.id,
        name: variantName,
        playerId: playerA,
        sourceId: manualId,
        status: 'resolved',
      }]);
      expect(await countAudits()).toBe(auditsBefore);
    });

    it('lets two distinct linked players share a display name in one team (AFLDB-ISSUE-025)', async () => {
      // The §4.3 matrix's positive case, and the proof that the generic
      // out-of-scope key refusal is NOT enabled for honour teams: a blanket
      // reload-key refusal would fail this reload.
      const row = await sourceMember(true);
      const foreignPlayer = await playerNotInTeam(row.teamName);
      expect(foreignPlayer).not.toBe(row.playerId);
      await sql`
        UPDATE honour_team_members
           SET source_id = NULL, player_id = ${foreignPlayer},
               link_status_value = 'resolved'
         WHERE id = ${row.id}
      `;
      let insertedId: number | null = null;
      try {
        const before = await countRows('honour_team_members');
        const run = runImporter(['honour_teams']);
        expect(run.status, run.stdout + run.stderr).toBe(0);

        // The incoming row was inserted alongside the foreign row: two rows,
        // one display name, two positively different people.
        expect(await countRows('honour_team_members')).toBe(before + 1);
        const twins = await sql<{ id: number; playerId: number | null; sourceId: number | null }[]>`
          SELECT id, player_id AS "playerId", source_id AS "sourceId"
            FROM honour_team_members
           WHERE team_name = ${row.teamName} AND player_name_raw = ${row.name}
           ORDER BY id
        `;
        expect(twins).toHaveLength(2);
        expect(twins[0]).toEqual({ id: row.id, playerId: foreignPlayer, sourceId: null });
        expect(twins[1].playerId).toBe(row.playerId);
        expect(twins[1].sourceId).toBe(wikipediaId);
        insertedId = twins[1].id;
      } finally {
        if (insertedId !== null) {
          await sql`DELETE FROM honour_team_members WHERE id = ${insertedId}`;
        }
        await sql`
          UPDATE honour_team_members
             SET source_id = ${wikipediaId}, player_id = ${row.playerId},
                 link_status_value = ${row.status}::link_status
           WHERE id = ${row.id}
        `;
      }
    });

    it('reloads idempotently: a second identical run changes nothing', async () => {
      const first = runImporter(['hall_of_fame', 'honour_teams']);
      expect(first.status, first.stdout + first.stderr).toBe(0);
      const before = await honoursFingerprint();

      const second = runImporter(['hall_of_fame', 'honour_teams']);
      expect(second.status, second.stdout + second.stderr).toBe(0);
      expect(await honoursFingerprint()).toEqual(before);
    });

    describe('honour-team identity advisory lock (AFLDB-ISSUE-080 §5.3)', () => {
      const dsn = process.env.AFLDB_TEST_DATABASE_URL as string;

      it('serialises both writers over one identity and releases on commit and rollback', async () => {
        const holder = postgres(dsn, { max: 1, onnotice: () => {} });
        const rival = postgres(dsn, { max: 1, onnotice: () => {} });
        const tryLock = () => rival.begin(async (tx) => {
          const [r] = await tx<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(
              ${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY}
            ) AS locked
          `;
          return r.locked;
        });
        try {
          // Held by the blocking form (the importer's shape): the try form
          // (the admin path's shape) returns false rather than hanging.
          await holder.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY})`;
            expect(await tryLock(), 'contended while held').toBe(false);
          });
          expect(await tryLock(), 'commit releases the lock').toBe(true);

          await holder.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY})`;
            throw new Error('deliberate rollback');
          }).catch((error: Error) => {
            if (!/deliberate rollback/.test(String(error))) throw error;
          });
          expect(await tryLock(), 'rollback releases the lock').toBe(true);
        } finally {
          await holder.end({ timeout: 5 });
          await rival.end({ timeout: 5 });
        }
      });

      it('createHonourTeamMember fails fast while the reload lock is held, then succeeds', async () => {
        const holder = postgres(dsn, { max: 1, onnotice: () => {} });
        let releaseLock!: () => void;
        const gate = new Promise<void>((resolve) => { releaseLock = resolve; });
        let lockAcquired!: () => void;
        const acquired = new Promise<void>((resolve) => { lockAcquired = resolve; });
        const holding = holder.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY})`;
          lockAcquired();
          await gate;
        });
        try {
          await acquired;
          await expect(createHonourTeamMember({
            teamName: 'AFLDB-ISSUE-080 Lock Team',
            playerNameRaw: 'AFLDB-ISSUE-080 Lock Member',
            adminUserId,
          })).rejects.toThrow('An honours reload is in progress; try again shortly.');
        } finally {
          releaseLock();
          await holding;
          await holder.end({ timeout: 5 });
        }

        // Released, the identical create goes through and stamps provenance.
        const created = await createHonourTeamMember({
          teamName: 'AFLDB-ISSUE-080 Lock Team',
          playerNameRaw: 'AFLDB-ISSUE-080 Lock Member',
          adminUserId,
        });
        cleanup.push(async () => {
          await sql`DELETE FROM honour_team_members WHERE id = ${created.id}`;
        });
        const [row] = await sql<{ sourceId: number | null }[]>`
          SELECT source_id AS "sourceId" FROM honour_team_members WHERE id = ${created.id}
        `;
        expect(row.sourceId).toBe(manualId);
      });

      it('create-refusal is provenance-independent: a wikipedia-owned entry also refuses', async () => {
        const row = await sourceMember(false);
        await expect(createHonourTeamMember({
          teamName: row.teamName,
          playerNameRaw: row.name,
          adminUserId,
        })).rejects.toThrow(/already has an entry named/);

        const [unchanged] = await sql<{ playerId: number | null; sourceId: number | null }[]>`
          SELECT player_id AS "playerId", source_id AS "sourceId"
            FROM honour_team_members WHERE id = ${row.id}
        `;
        expect(unchanged, 'the existing row is untouched — no adopt, no overwrite')
          .toEqual({ playerId: null, sourceId: wikipediaId });
      });

      it(
        'the real runtime role can take both lock forms and contend across roles (§9.4b)',
        async () => {
          const restricted = importRole.connect();
          const owner = postgres(dsn, { max: 1, onnotice: () => {} });
          try {
            await restricted.begin(async (tx) => {
              await tx`SELECT pg_advisory_xact_lock(${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY})`;
            });

            // Cross-role contention on the same literal identity.
            await owner.begin(async (tx) => {
              await tx`SELECT pg_advisory_xact_lock(${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY})`;
              const [r] = await restricted.begin(async (rtx) => rtx<{ locked: boolean }[]>`
                SELECT pg_try_advisory_xact_lock(
                  ${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY}
                ) AS locked
              `);
              expect(r.locked, 'the try form fails rather than hangs across roles').toBe(false);
            });
            const [after] = await restricted.begin(async (rtx) => rtx<{ locked: boolean }[]>`
              SELECT pg_try_advisory_xact_lock(
                ${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY}
              ) AS locked
            `);
            expect(after.locked, 'released once the owner transaction ends').toBe(true);
          } finally {
            await restricted.end({ timeout: 5 });
            await owner.end({ timeout: 5 });
          }
        },
      );
    });
  },
);

// AFLDB-ISSUE-112 phase 3 retired the synthetic-SQLite captaincy fixture
// (buildCaptaincyFixtureDb) and the AFLDB-ISSUE-085 describe block that drove
// it: import_captaincies no longer reads a legacy SQLite handle. The two
// ownership protections that block proved — a foreign-owned (manual_admin_edit)
// captaincy row left untouched by a reload, and
// _refuse_captaincy_natural_key_collisions() failing closed on an incoming
// natural key held by a row this loader does not own — are now exercised
// manifest-driven inside the "captaincies manifest reload (AFLDB-ISSUE-112)"
// block above ("does not touch a manual_admin_edit captaincy row
// (AFLDB-ISSUE-085)" and "fails closed when an incoming natural key is held by
// a foreign-owned row (AFLDB-ISSUE-085)").

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-111 — the Coleman Medal derivation, against a real database
// ---------------------------------------------------------------------------
/*
 * The Coleman Medal is not acquired from an award scrape: it is DERIVED from
 * AFLDB's own canonical home-and-away match facts. tests/coleman-derivation.test.ts
 * proves the contract and the pure key composition without a database; only a
 * database can prove the SQL — that finals really are excluded, that an
 * in-progress season really produces nothing, that the persisted club really is
 * the sole home-and-away club, and that a reload really is stable.
 *
 * Every assertion here is scoped to the derived family (`awards.slug = 'coleman'`
 * owned by the contract's source). The synthetic fixtures (tie, multi-club,
 * missing identity) and the one-time legacy->derived transition are separate
 * slices and are not exercised here.
 *
 * Writes land in afldb_test only, through the same restricted afldb_import role
 * the production refresh uses.
 */
type ColemanContract = {
  first_season: number;
  minimum_goals: number;
  method_version: number;
  source_key: string;
  identity_match_method: string;
  identity_statuses: string[];
  key_separator: string;
  legacy_transition: {
    expected_rows: number;
    legacy_source_key: string;
    first_load_expectation: string;
  };
};

const coleman = JSON.parse(
  readFileSync(join(root, 'data', 'reference', 'coleman-derivation.json'), 'utf8'),
) as ColemanContract;

/** `rep.result("coleman winners", n, "(S seasons, U updated, I inserted, D deleted)")`. */
const COLEMAN_SIGNAL =
  /coleman winners\s+([\d,]+)\s+\((\d+) seasons, (\d+) updated, (\d+) inserted, (\d+) deleted\)/;

/** `note` is where the derivation records its character; `votes` is not a goal total. */
const COLEMAN_NOTE =
  /^Derived from AFLDB home-and-away match statistics: (\d+) goals \(coleman-derivation\.json method_version (\d+)\)$/;

const COLEMAN_KEY = /^coleman:(\d{4}):([^:]+)$/;

type ColemanRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  winners: number;
  seasons: number;
  updated: number;
  inserted: number;
  deleted: number;
};

/**
 * One derived load, with AFLDB_LEGACY_SQLITE deliberately unset.
 *
 * Deliberately not runImporter(): its `sqlitePath` parameter defaults to the
 * ambient legacy path, and passing `undefined` would silently restore that
 * default. Spawning directly sets the variable to `undefined`, which node drops
 * from the child environment entirely — that is the ISSUE-111 G9 proof: this
 * group reads no legacy database at all.
 */
function runColeman(): ColemanRun {
  const run = importRole.spawn(
    python,
    ['tools/migration/import_awards.py', '--groups', 'coleman'],
    { cwd: root, env: { AFLDB_LEGACY_SQLITE: undefined } },
  );
  const signal = COLEMAN_SIGNAL.exec(run.stdout);
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    winners: signal ? Number(signal[1].replace(/,/g, '')) : -1,
    seasons: signal ? Number(signal[2]) : -1,
    updated: signal ? Number(signal[3]) : -1,
    inserted: signal ? Number(signal[4]) : -1,
    deleted: signal ? Number(signal[5]) : -1,
  };
}

type ColemanWinnerRow = {
  id: number;
  season: number;
  playerId: number | null;
  playerNameRaw: string | null;
  displayName: string | null;
  status: string;
  candidateCount: number;
  clubId: number | null;
  clubNameRaw: string | null;
  votes: number | null;
  note: string | null;
  sourceKey: string;
  recordId: string | null;
  distinctClubs: number;
  soleClub: number | null;
  identityPaths: string[] | null;
};

/** Every persisted Coleman row, with the facts each assertion needs beside it. */
async function readColemanWinners(): Promise<ColemanWinnerRow[]> {
  return sql<ColemanWinnerRow[]>`
    SELECT w.id::int                        AS id,
           w.season                         AS season,
           w.player_id::int                 AS "playerId",
           w.player_name_raw                AS "playerNameRaw",
           p.display_name                   AS "displayName",
           w.link_status_value::text        AS status,
           w.candidate_count::int           AS "candidateCount",
           w.club_id::int                   AS "clubId",
           w.club_name_raw                  AS "clubNameRaw",
           w.votes::int                     AS votes,
           w.note                           AS note,
           s.key                            AS "sourceKey",
           w.source_record_id               AS "recordId",
           clubs.distinct_clubs::int        AS "distinctClubs",
           clubs.sole_club::int             AS "soleClub",
           ident.paths                      AS "identityPaths"
      FROM award_winners w
      JOIN awards  a ON a.id = w.award_id
      JOIN sources s ON s.id = w.source_id
      LEFT JOIN players p ON p.id = w.player_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT pms.club_id) AS distinct_clubs,
               min(pms.club_id)            AS sole_club
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE pms.player_id = w.player_id
           AND m.season = w.season
           AND NOT m.is_final
      ) clubs ON TRUE
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT ei.external_id) AS paths
          FROM external_identities ei
         WHERE ei.player_id = w.player_id
           AND ei.match_method = ${coleman.identity_match_method}
           AND ei.status::text = ANY(${coleman.identity_statuses})
      ) ident ON TRUE
     WHERE a.slug = 'coleman'
     ORDER BY w.season, w.player_id
  `;
}

/** The row-identity fingerprint the G8 reload-stability claim is measured on. */
async function colemanFingerprint(): Promise<string> {
  const [row] = await sql<{ fp: string | null }[]>`
    SELECT md5(string_agg(
             w.id::text || '|' || coalesce(w.source_record_id, '(null)'),
             ',' ORDER BY w.id)) AS fp
      FROM award_winners w
      JOIN awards a ON a.id = w.award_id
     WHERE a.slug = 'coleman'
  `;
  return row.fp ?? '';
}

async function colemanLinkDecisions(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM player_link_resolutions r
      JOIN award_winners w ON w.id = r.target_id
      JOIN awards a ON a.id = w.award_id
     WHERE r.target_table = 'award_winners'
       AND a.slug = 'coleman'
  `;
  return row.n;
}

describe.skipIf(!canRunFixtureImporter)(
  `Coleman Medal derived from canonical match facts (AFLDB-ISSUE-111)${roleParitySuffix}`,
  () => {
    let firstRun!: ColemanRun;
    let winners: ColemanWinnerRow[] = [];
    let decisionsBefore = 0;
    let batchFloor = '0';

    beforeAll(async () => {
      // The derived loader owns only its own provenance scope. Running it while
      // legacy-owned Coleman rows are still present is precisely the duplication
      // hazard the one-time transition exists to prevent — 46 legacy rows plus 46
      // derived ones, with neither uniqueness constraint able to stop it because
      // the two keys differ. Refuse rather than manufacture that state here.
      const [foreign] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards  a ON a.id = w.award_id
          JOIN sources s ON s.id = w.source_id
         WHERE a.slug = 'coleman'
           AND s.key <> ${coleman.source_key}
      `;
      if (foreign.n > 0) {
        throw new Error(
          `${foreign.n} Coleman award_winners row(s) in afldb_test are owned by a source `
          + `other than '${coleman.source_key}'. The derived load would add a second, `
          + 'differently keyed family beside them rather than replace them. Run the '
          + 'one-time transition (import_awards.py --rekey-coleman) against afldb_test '
          + 'first; this suite will not create a duplicated Coleman family.',
        );
      }

      decisionsBefore = await colemanLinkDecisions();
      const [batch] = await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM import_batches
      `;
      batchFloor = batch.id;

      firstRun = runColeman();
      winners = await readColemanWinners();
    }, 600_000);

    it('derives and loads with AFLDB_LEGACY_SQLITE unset (G9)', () => {
      expect(firstRun.status, firstRun.stdout + firstRun.stderr).toBe(0);
      expect(
        firstRun.stdout,
        'a legacy-free group must never announce a legacy source',
      ).not.toContain('legacy source :');
      expect(
        firstRun.winners,
        'the derivation reported no winner line; see stdout',
      ).toBeGreaterThan(0);
      expect(
        winners.length,
        'afldb_test produced no Coleman winners at all — the canonical match facts '
        + 'the derivation reads are missing or the seasons are not marked complete',
      ).toBe(firstRun.winners);
    });

    it('records its own batch against the derived provenance', async () => {
      const [batch] = await sql<{
        status: string;
        sourceKey: string;
        recordsRead: string;
        recordsRejected: string;
      }[]>`
        SELECT b.status::text          AS status,
               s.key                   AS "sourceKey",
               b.records_read::text    AS "recordsRead",
               b.records_rejected::text AS "recordsRejected"
          FROM import_batches b
          JOIN sources s ON s.id = b.source_id
         WHERE b.id > ${batchFloor}::bigint
           AND b.tool = 'import_awards.py'
           AND b.target_table = 'coleman'
         ORDER BY b.id DESC
         LIMIT 1
      `;
      expect(batch, 'the restricted importer must record its completed batch').toBeDefined();
      expect(batch.status).toBe('completed');
      // A derived row carries the canonical source of the facts it was derived
      // from (the ISSUE-095 club_seasons convention), never draftguru.
      expect(batch.sourceKey).toBe(coleman.source_key);
      expect(Number(batch.recordsRead)).toBe(winners.length);
      expect(Number(batch.recordsRejected)).toBe(0);
    });

    it('owns every row under the derived provenance and the durable key', () => {
      const wrongSource = winners.filter((w) => w.sourceKey !== coleman.source_key);
      expect(wrongSource.map((w) => `${w.season}:${w.sourceKey}`)).toEqual([]);

      // players.id is not rebuild-stable, so a key whose third field is an integer
      // is the rejected coleman:<season>:<players.id> form.
      const numericKeys = winners.filter((w) => /^coleman:\d{4}:\d+$/.test(w.recordId ?? ''));
      expect(numericKeys.map((w) => w.recordId)).toEqual([]);

      for (const winner of winners) {
        const key = COLEMAN_KEY.exec(winner.recordId ?? '');
        expect(key, `row ${winner.id} key ${winner.recordId}`).not.toBeNull();
        expect(Number(key![1]), 'the key carries its own season').toBe(winner.season);
        // The path is the durable AFL Tables identity the rebuild resolves by,
        // not a display name and not a surrogate id.
        expect(
          winner.identityPaths ?? [],
          `${winner.season} ${winner.displayName}: key path must be a persisted `
          + `${coleman.identity_match_method} identity`,
        ).toContain(key![2]);
      }

      const keys = winners.map((w) => w.recordId);
      expect(new Set(keys).size, 'every derived key is unique').toBe(keys.length);
    });

    it('is born linked, and records the goal total in note rather than votes', () => {
      for (const winner of winners) {
        // player_id comes from player_match_stats, so identity is canonical
        // rather than name-matched: an unlinked derived row is a defect.
        expect(winner.playerId, `${winner.season} has no player_id`).not.toBeNull();
        expect(winner.status).toBe('resolved');
        expect(winner.candidateCount).toBe(0);
        expect(winner.playerNameRaw).toBe(winner.displayName);

        // The UI labels this column "Votes"; a goal total is not a vote total.
        expect(winner.votes, `${winner.season} must not carry a goal total in votes`)
          .toBeNull();
        // There is no source club spelling to keep: the club is a canonical id
        // derived from the winner's own match rows.
        expect(winner.clubNameRaw).toBeNull();

        const note = COLEMAN_NOTE.exec(winner.note ?? '');
        expect(note, `${winner.season} note: ${winner.note}`).not.toBeNull();
        expect(Number(note![1])).toBeGreaterThanOrEqual(coleman.minimum_goals);
        expect(Number(note![2])).toBe(coleman.method_version);
      }
    });

    it('reproduces the persisted winner set with an independent oracle query (G2)', async () => {
      // Deliberately a different shape from COLEMAN_DERIVATION_SQL: round_type
      // instead of NOT is_final (which the migration-003 CHECK makes equivalent,
      // so this cross-checks that too), a season subquery instead of a join, and
      // a separately grouped per-season maximum joined back instead of a window
      // function.
      //
      // The per-season maximum is deliberately its own aggregate rather than a
      // correlated `(SELECT max(...) FROM totals t2 WHERE t2.season = t.season)`.
      // `totals` is referenced twice, so PostgreSQL 12+ materialises it, and a
      // materialised CTE carries no index: a correlated max rescans the whole CTE
      // once per outer row. Over ~46 seasons of home-and-away goalkickers that is
      // roughly 34k x 34k row comparisons, which exceeds the client's 5s
      // statement_timeout (src/db/client.ts) and cancels before it can compare
      // anything. Grouping once and equi-joining is linear, and is still not the
      // implementation's `max(goals) OVER (PARTITION BY season)`.
      const oracle = await sql<{ season: number; playerId: number; goals: number }[]>`
        WITH ha AS (
          SELECT m.season AS season, pms.player_id AS player_id, pms.goals AS goals
            FROM player_match_stats pms
            JOIN matches m ON m.id = pms.match_id
           WHERE m.round_type = 'home_and_away'
             AND m.season >= ${coleman.first_season}
             AND m.season IN (SELECT year FROM seasons WHERE status = 'complete')
        ),
        totals AS (
          SELECT season, player_id, sum(goals)::int AS goals
            FROM ha
           GROUP BY season, player_id
        ),
        maxima AS (
          SELECT season, max(goals) AS goals
            FROM totals
           GROUP BY season
        )
        SELECT t.season AS season, t.player_id::int AS "playerId", t.goals AS goals
          FROM totals t
          JOIN maxima mx ON mx.season = t.season AND mx.goals = t.goals
         WHERE t.goals >= ${coleman.minimum_goals}
         ORDER BY t.season, t.player_id
      `;

      expect(
        winners.map((w) => `${w.season}:${w.playerId}`),
        'the loader and an independently shaped query must name the same winners',
      ).toEqual(oracle.map((o) => `${o.season}:${o.playerId}`));

      // The persisted goal total is the same fact, not merely the same person.
      const persisted = winners.map((w) => Number(COLEMAN_NOTE.exec(w.note ?? '')![1]));
      expect(persisted).toEqual(oracle.map((o) => o.goals));
    });

    it('honours the declared span and the completed-season rule', async () => {
      const seasons = winners.map((w) => w.season);
      expect(
        Math.min(...seasons),
        'the declared span opens at the contract\'s first_season; a later value means '
        + 'afldb_test is missing that season\'s canonical match facts',
      ).toBe(coleman.first_season);
      expect(
        seasons.filter((season) => season < coleman.first_season),
        'the derivation never reaches behind the declared first season',
      ).toEqual([]);

      const [undecided] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards a ON a.id = w.award_id
          LEFT JOIN seasons s ON s.year = w.season
         WHERE a.slug = 'coleman'
           AND (s.year IS NULL OR s.status <> 'complete')
      `;
      expect(
        undecided.n,
        'a season still in progress has not decided the award and must produce no winner',
      ).toBe(0);

      // Every complete season the facts can decide produces a winner: the loader
      // must not silently drop one. The qualifying threshold is the contract's,
      // applied to a season total, exactly as the derivation applies it.
      const [expected] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT q.season)::int AS n
          FROM (
            SELECT m.season AS season
              FROM player_match_stats pms
              JOIN matches m ON m.id = pms.match_id
              JOIN seasons s ON s.year = m.season
             WHERE NOT m.is_final
               AND m.season >= ${coleman.first_season}
               AND s.status = 'complete'
             GROUP BY m.season, pms.player_id
            HAVING sum(pms.goals) >= ${coleman.minimum_goals}
          ) q
      `;
      expect(new Set(seasons).size).toBe(expected.n);
      expect(firstRun.seasons).toBe(expected.n);
    });

    it('persists the sole home-and-away club, or NULL when there is more than one (G4)', () => {
      for (const winner of winners) {
        if (winner.distinctClubs === 1) {
          expect(
            winner.clubId,
            `${winner.season} ${winner.displayName} represented one club`,
          ).toBe(winner.soleClub);
        } else {
          // No most-games / most-goals / final-club rule is invented: a
          // multi-club season is genuinely ambiguous at this grain.
          expect(
            winner.clubId,
            `${winner.season} ${winner.displayName} represented ${winner.distinctClubs} clubs`,
          ).toBeNull();
        }
      }
    });

    it('is stable across three consecutive reloads (G8)', async () => {
      const first = await colemanFingerprint();
      expect(first).not.toBe('');

      const second = runColeman();
      expect(second.status, second.stdout + second.stderr).toBe(0);
      expect(second.updated).toBe(winners.length);
      expect(second.inserted, 'a reload must match on the durable key, never insert').toBe(0);
      expect(second.deleted, 'a reload must not delete a row it is about to rewrite').toBe(0);
      expect(await colemanFingerprint(), 'surrogate ids survive a reload').toBe(first);

      const third = runColeman();
      expect(third.status, third.stdout + third.stderr).toBe(0);
      expect(third.updated).toBe(winners.length);
      expect(third.inserted).toBe(0);
      expect(third.deleted).toBe(0);
      expect(await colemanFingerprint()).toBe(first);
    }, 900_000);

    it('creates no player-link decision of its own', async () => {
      // Derived rows are born linked, so the loader has nothing to resolve and
      // must not manufacture a resolution row on anyone's behalf.
      expect(await colemanLinkDecisions()).toBe(decisionsBefore);
    });
  },
);

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-111 — the derivation rules history cannot demonstrate
// ---------------------------------------------------------------------------
/*
 * The real corpus proves the ordinary case and nothing else: G4 measured 45 of
 * 45 historical winners representing exactly one home-and-away club, so history
 * supplies no tie, no multi-club season, no in-progress season inside the
 * declared span and no finals total large enough to change a ranking. Those
 * rules are therefore only ever exercised by a fixture.
 *
 * Every fixture is synthetic canonical data — real players and real clubs in
 * reserved seasons the corpus does not use — loaded through the real
 * `--groups coleman` importer, not through a hand-written query. The point is
 * to prove COLEMAN_DERIVATION_SQL, so nothing here reimplements it.
 *
 * Cleanup is defensive at BOTH ends. A crashed run must not leave synthetic
 * matches, player_match_stats or seasons behind, because the release gates
 * count those tables; so the corpus is removed on entry as well as on exit,
 * and afterAll re-runs the loader and proves the real family came back with
 * byte-identical row ids.
 */
const FIXTURE_NOTE = 'AFLDB-ISSUE-111 synthetic fixture';
const FIXTURE_MATCH_PREFIX = 'afldb-issue-111-fixture:';
const FIXTURE_VENUE = 'AFLDB-ISSUE-111 fixture venue';

/**
 * The transition block's isolation witnesses live under an award of their own,
 * so "the transition touches nothing but Coleman" is measured against rows that
 * certainly exist rather than against whatever else afldb_test happens to hold.
 * Declared here because one cleanup function removes everything the ISSUE-111
 * fixtures create.
 */
const ISOLATION_AWARD_SLUG = 'afldb-issue-111-isolation';

/**
 * Reserved seasons. 2090–2093 are above every real season and below the
 * `seasons_year_ck` ceiling of 2100; the boundary case must be the season
 * immediately before the contract's own first_season, so it is read from the
 * contract rather than written as a literal.
 */
const TIE_SEASON = 2090;
const MULTI_CLUB_SEASON = 2091;
const IN_PROGRESS_SEASON = 2092;
const FINALS_SEASON = 2093;
const BOUNDARY_SEASON = coleman.first_season - 1;
const CREATED_SEASONS: { year: number; status: 'complete' | 'in_progress' }[] = [
  { year: BOUNDARY_SEASON, status: 'complete' },
  { year: TIE_SEASON, status: 'complete' },
  { year: MULTI_CLUB_SEASON, status: 'complete' },
  { year: IN_PROGRESS_SEASON, status: 'in_progress' },
  { year: FINALS_SEASON, status: 'complete' },
];
const FIXTURE_SEASONS = CREATED_SEASONS.map((s) => s.year);

/**
 * The identity block below reserves one further season of its own. It is
 * deliberately outside CREATED_SEASONS — that list drives the derivation-rule
 * fixtures and their status assertions — but it uses the same markers, so one
 * cleanup function still removes everything either block can create.
 */
const IDENTITY_SEASON = 2094;
const ALL_FIXTURE_SEASONS = [...FIXTURE_SEASONS, IDENTITY_SEASON];

/**
 * Removes every synthetic row either AFLDB-ISSUE-111 fixture block can create,
 * in foreign-key order.
 *
 * Seasons are matched on the fixture note, never on the year, so a real season
 * that already existed (the boundary season is a real one in a fully loaded
 * database) is never deleted — only one this block inserted. The synthetic
 * player and its external_identities are matched the same way, and go after the
 * award_winners delete because a derived winner row can point at that player.
 */
async function removeFixtureCorpus(): Promise<void> {
  await sql`
    DELETE FROM player_match_stats pms
      USING matches m
     WHERE m.id = pms.match_id
       AND m.match_key LIKE ${`${FIXTURE_MATCH_PREFIX}%`}
  `;
  await sql`DELETE FROM matches WHERE match_key LIKE ${`${FIXTURE_MATCH_PREFIX}%`}`;
  // award_winners.season references seasons(year), so any winner the fixtures
  // produced must go before the seasons themselves.
  await sql`
    DELETE FROM award_winners w
      USING awards a
     WHERE a.id = w.award_id
       AND a.slug = 'coleman'
       AND w.season = ANY(${ALL_FIXTURE_SEASONS}::int[])
  `;
  // The transition block's isolation witnesses, and the award they hang from.
  // The award cascades to its winners (migration 005); the explicit delete runs
  // first so the intent is legible rather than implied.
  await sql`
    DELETE FROM award_winners w
      USING awards a
     WHERE a.id = w.award_id
       AND a.slug = ${ISOLATION_AWARD_SLUG}
  `;
  await sql`DELETE FROM awards WHERE slug = ${ISOLATION_AWARD_SLUG}`;
  await sql`
    DELETE FROM external_identities ei
      USING players p
     WHERE p.id = ei.player_id
       AND p.notes = ${FIXTURE_NOTE}
  `;
  await sql`DELETE FROM players WHERE notes = ${FIXTURE_NOTE}`;
  await sql`DELETE FROM seasons WHERE notes = ${FIXTURE_NOTE}`;
}

describe.skipIf(!canRunFixtureImporter)(
  `Coleman derivation rules that history cannot demonstrate (AFLDB-ISSUE-111)${roleParitySuffix}`,
  () => {
    let playerA = 0;
    let playerB = 0;
    let playerC = 0;
    let clubA = 0;
    let clubB = 0;

    let baselineFingerprint = '';
    let baselineWinners: ColemanWinnerRow[] = [];
    let fixtureRun!: ColemanRun;
    let fixtureWinners: ColemanWinnerRow[] = [];

    const rowsFor = (season: number) => fixtureWinners.filter((w) => w.season === season);
    const goalsIn = (row: ColemanWinnerRow) => Number(COLEMAN_NOTE.exec(row.note ?? '')![1]);

    /** One synthetic match, returning its id. */
    async function insertFixtureMatch(
      season: number,
      ordinal: number,
      roundType: 'home_and_away' | 'elimination_final',
    ): Promise<number> {
      const isFinal = roundType !== 'home_and_away';
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_score, away_score, result, winner_club_id, margin,
          attendance, attendance_status
        ) VALUES (
          ${`${FIXTURE_MATCH_PREFIX}${season}:${ordinal}`}, ${season},
          ${isFinal ? 'EF' : String(ordinal)}, ${isFinal ? null : ordinal},
          ${roundType}::round_type, ${isFinal},
          ${`${season}-04-${String(ordinal).padStart(2, '0')}`}::date,
          ${FIXTURE_VENUE}, ${clubA}, ${clubB},
          60, 40, 'home_win', ${clubA}, 20,
          -- Not recorded, never defaulted to zero: matches_attendance_status_ck
          -- requires the number and its status to agree.
          NULL, 'not_collected'
        )
        RETURNING id::int AS id
      `;
      return row.id;
    }

    async function insertFixtureStat(
      matchId: number, playerId: number, clubId: number, goals: number,
    ): Promise<void> {
      await sql`
        INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
        VALUES (${playerId}, ${matchId}, ${clubId}, ${goals})
      `;
    }

    beforeAll(async () => {
      // A leaked corpus from a crashed run would silently change every count
      // below, so clear it before measuring the baseline rather than after.
      await removeFixtureCorpus();

      const [foreign] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards  a ON a.id = w.award_id
          JOIN sources s ON s.id = w.source_id
         WHERE a.slug = 'coleman'
           AND s.key <> ${coleman.source_key}
      `;
      if (foreign.n > 0) {
        throw new Error(
          `${foreign.n} Coleman award_winners row(s) in afldb_test are owned by a source `
          + `other than '${coleman.source_key}'. Run the one-time transition `
          + '(import_awards.py --rekey-coleman) first; this suite will not create a '
          + 'duplicated Coleman family.',
        );
      }

      baselineWinners = await readColemanWinners();
      baselineFingerprint = await colemanFingerprint();

      // Real players and real clubs: the fixtures exercise the derivation, not
      // the identity contract, so every winner must already hold exactly one
      // durable profile identity. A player holding two would make the loader
      // refuse for a reason this block is not testing.
      const players = await sql<{ id: number }[]>`
        SELECT p.id::int AS id
          FROM players p
          JOIN external_identities ei ON ei.player_id = p.id
         WHERE ei.match_method = ${coleman.identity_match_method}
           AND ei.status::text = ANY(${coleman.identity_statuses})
         GROUP BY p.id
        HAVING count(DISTINCT ei.external_id) = 1
         ORDER BY p.id
         LIMIT 3
      `;
      const clubs = await sql<{ id: number }[]>`
        SELECT id::int AS id FROM clubs ORDER BY id LIMIT 2
      `;
      if (players.length < 3 || clubs.length < 2) {
        throw new Error(
          'afldb_test lacks three singly-identified players or two clubs; the canonical '
          + 'corpus is not loaded, so the derivation fixtures cannot be built.',
        );
      }
      playerA = players[0].id;
      playerB = players[1].id;
      playerC = players[2].id;
      clubA = clubs[0].id;
      clubB = clubs[1].id;

      for (const season of CREATED_SEASONS) {
        await sql`
          INSERT INTO seasons (year, competition, league, status, notes)
          VALUES (${season.year}, 'VFL/AFL', ${season.year < 1990 ? 'VFL' : 'AFL'},
                  ${season.status}::season_status, ${FIXTURE_NOTE})
          ON CONFLICT (year) DO NOTHING
        `;
      }
      const statuses = await sql<{ year: number; status: string }[]>`
        SELECT year::int AS year, status::text AS status
          FROM seasons
         WHERE year = ANY(${FIXTURE_SEASONS}::int[])
         ORDER BY year
      `;
      for (const season of CREATED_SEASONS) {
        const found = statuses.find((s) => s.year === season.year);
        if (found?.status !== season.status) {
          throw new Error(
            `fixture season ${season.year} has status ${found?.status ?? '(absent)'}, `
            + `not ${season.status}; the fixture would not test what it claims`,
          );
        }
      }

      // Tie: two players share the season maximum, a third is below it.
      const tie1 = await insertFixtureMatch(TIE_SEASON, 1, 'home_and_away');
      const tie2 = await insertFixtureMatch(TIE_SEASON, 2, 'home_and_away');
      await insertFixtureStat(tie1, playerA, clubA, 3);
      await insertFixtureStat(tie2, playerA, clubA, 2);   // A: 5
      await insertFixtureStat(tie1, playerB, clubB, 5);   // B: 5
      await insertFixtureStat(tie2, playerC, clubB, 4);   // C: 4

      // Multi-club: the winner represents two clubs in the one season.
      const multi1 = await insertFixtureMatch(MULTI_CLUB_SEASON, 1, 'home_and_away');
      const multi2 = await insertFixtureMatch(MULTI_CLUB_SEASON, 2, 'home_and_away');
      await insertFixtureStat(multi1, playerA, clubA, 4);
      await insertFixtureStat(multi2, playerA, clubB, 3);  // A: 7 over two clubs
      await insertFixtureStat(multi1, playerB, clubB, 2);  // B: 2

      // In progress: a clear leader in a season that has not decided anything.
      const progress = await insertFixtureMatch(IN_PROGRESS_SEASON, 1, 'home_and_away');
      await insertFixtureStat(progress, playerA, clubA, 9);

      // Finals: B outscores A over the whole season but not over home-and-away.
      const homeAway = await insertFixtureMatch(FINALS_SEASON, 1, 'home_and_away');
      const finalMatch = await insertFixtureMatch(FINALS_SEASON, 2, 'elimination_final');
      await insertFixtureStat(homeAway, playerA, clubA, 6);    // A: 6 H&A, 6 total
      await insertFixtureStat(homeAway, playerB, clubB, 4);
      await insertFixtureStat(finalMatch, playerB, clubB, 10); // B: 4 H&A, 14 total

      // Boundary: a total nothing in the corpus could beat, one season early.
      const early = await insertFixtureMatch(BOUNDARY_SEASON, 1, 'home_and_away');
      await insertFixtureStat(early, playerA, clubA, 99);

      fixtureRun = runColeman();
      fixtureWinners = await readColemanWinners();
    }, 600_000);

    afterAll(async () => {
      // Unconditional: the corpus must go even if an assertion above threw.
      await removeFixtureCorpus();
      const restored = runColeman();
      if (restored.status !== 0) {
        throw new Error(
          `the restoring Coleman load failed (${restored.status}); afldb_test may still `
          + `hold fixture-derived winners.\n${restored.stdout}${restored.stderr}`,
        );
      }
      const after = await colemanFingerprint();
      if (baselineFingerprint !== '' && after !== baselineFingerprint) {
        throw new Error(
          'the real Coleman family was not restored byte-for-byte after the fixtures '
          + `were removed: fingerprint ${after} != ${baselineFingerprint}`,
        );
      }
    }, 900_000);

    it('loads the fixture corpus without refusing', () => {
      expect(fixtureRun.status, fixtureRun.stdout + fixtureRun.stderr).toBe(0);
      // Four new winners (two tied, one multi-club, one finals season) across
      // three new seasons: the in-progress and pre-span seasons decide nothing.
      expect(fixtureWinners.length).toBe(baselineWinners.length + 4);
      expect(new Set(fixtureWinners.map((w) => w.season)).size)
        .toBe(new Set(baselineWinners.map((w) => w.season)).size + 3);
      expect(fixtureRun.inserted, 'the four fixture winners are new rows').toBe(4);
      expect(fixtureRun.deleted, 'no real winner is displaced by a fixture').toBe(0);
    });

    it('awards every player tied on the season maximum', () => {
      const tied = rowsFor(TIE_SEASON);
      expect(
        tied.map((w) => w.playerId).sort((a, b) => (a ?? 0) - (b ?? 0)),
        'both leaders win; there is no tie-break and no silent single-row pick',
      ).toEqual([playerA, playerB].sort((a, b) => a - b));
      expect(tied.map(goalsIn)).toEqual([5, 5]);

      // Distinct people hold distinct durable paths, so a tie cannot collide on
      // the key — and no surviving row's key depends on a ranking position.
      const keys = tied.map((w) => w.recordId);
      expect(new Set(keys).size).toBe(2);
      for (const key of keys) {
        expect(COLEMAN_KEY.exec(key ?? '')?.[1]).toBe(String(TIE_SEASON));
      }
      expect(
        fixtureRun.stdout,
        'a tie is surfaced to the curator, never reconciled away',
      ).toMatch(new RegExp(`produced tied winners:[^\\n]*\\b${TIE_SEASON}\\b`));
    });

    it('persists NULL rather than inventing a club for a two-club winner', () => {
      const rows = rowsFor(MULTI_CLUB_SEASON);
      expect(rows.map((w) => w.playerId), 'exactly one leader that season').toHaveLength(1);
      const [winner] = rows;
      expect(winner.playerId).toBe(playerA);
      expect(goalsIn(winner), 'both clubs\' goals count towards the one total').toBe(7);
      expect(winner.distinctClubs, 'the fixture really did span two clubs').toBe(2);
      // No most-games / most-goals / final-club rule is invented.
      expect(winner.clubId).toBeNull();
      expect(winner.clubNameRaw).toBeNull();
      expect(fixtureRun.stdout).toMatch(
        new RegExp(`represented more than one[^\\n]*\\b${MULTI_CLUB_SEASON}\\b`),
      );
    });

    it('decides nothing in a season still in progress', async () => {
      expect(
        rowsFor(IN_PROGRESS_SEASON),
        'an in-progress season has not decided the award',
      ).toEqual([]);
      // The exclusion must be the season status, not an absence of facts.
      const [leader] = await sql<{ goals: number }[]>`
        SELECT sum(pms.goals)::int AS goals
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE m.season = ${IN_PROGRESS_SEASON}
           AND NOT m.is_final
         GROUP BY pms.player_id
         ORDER BY 1 DESC NULLS LAST
         LIMIT 1
      `;
      expect(
        leader?.goals ?? 0,
        'the season carries a clear leader it did not award',
      ).toBeGreaterThanOrEqual(9);
    });

    it('never reaches behind the declared first season', async () => {
      expect(rowsFor(BOUNDARY_SEASON)).toEqual([]);
      expect(fixtureWinners.filter((w) => w.season < coleman.first_season)).toEqual([]);
      const [leader] = await sql<{ goals: number }[]>`
        SELECT sum(pms.goals)::int AS goals
          FROM player_match_stats pms
          JOIN matches m ON m.id = pms.match_id
         WHERE m.season = ${BOUNDARY_SEASON}
           AND NOT m.is_final
         GROUP BY pms.player_id
         -- DESC defaults to NULLS FIRST in PostgreSQL; a pre-1980 season with an
         -- unrecorded goal total must not masquerade as the leader.
         ORDER BY 1 DESC NULLS LAST
         LIMIT 1
      `;
      expect(
        // >= rather than =: in a fully loaded corpus this is a real season, and
        // the fixture's 99 is added to whatever it already held.
        leader?.goals ?? 0,
        'the season immediately before the span holds an unbeatable total and still '
        + 'produces no winner',
      ).toBeGreaterThanOrEqual(99);
    });

    it('counts home-and-away goals only, never finals (G4 corollary)', () => {
      const rows = rowsFor(FINALS_SEASON);
      expect(rows.map((w) => w.playerId), 'exactly one leader that season').toHaveLength(1);
      const [winner] = rows;
      // B kicked 14 across the season and 4 across home-and-away; A kicked 6 of
      // each. Reading player_season_stats instead would name B.
      expect(
        winner.playerId,
        'the leading home-and-away goalkicker wins, not the leading goalkicker',
      ).toBe(playerA);
      expect(goalsIn(winner)).toBe(6);
    });
  },
);

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-111 — the durable-identity contract, against a real database (G5a)
// ---------------------------------------------------------------------------
/*
 * tests/coleman-derivation.test.ts already drives build_coleman_winners() over
 * synthetic rows through a Python subprocess, so all three refusals are proven
 * without a database. What that cannot prove is the same refusal reached
 * through COLEMAN_DERIVATION_SQL: that its LATERAL really does return no path
 * for a winner holding no identity, two paths for one holding two, and the
 * stored path verbatim for one carrying the key separator.
 *
 * The acceptance shape is the opposite of every other Coleman block — a
 * NON-ZERO exit, a named cause, and a database that did not move. The last is
 * asserted rather than assumed: a refusal that had already written half a
 * family would be worse than no refusal at all, so every refused run must
 * leave the real family's row-identity fingerprint and row count untouched.
 *
 * The fixture is one reserved season holding one synthetic player, who is
 * therefore that season's leading home-and-away goalkicker. Only that player's
 * external_identities rows change between cases, so each refusal isolates
 * identity as its cause. The final case gives the same player exactly one
 * ordinary identity and requires the load to SUCCEED, keyed on the path — which
 * is what makes the three refusals evidence about the identity contract rather
 * than about a fixture that could never load at all.
 *
 * A synthetic player is unavoidable here: every real player in afldb_test
 * already holds the identity this block needs to withhold. Cleanup therefore
 * reuses removeFixtureCorpus(), which matches the player on the same fixture
 * note it matches seasons on.
 */
const IDENTITY_PLAYER_NAME = 'AFLDB Issue 111 Fixture Goalkicker';
const IDENTITY_PATH = 'players/Z/Afldb_Issue111_Fixture.html';
const IDENTITY_PATH_ALIAS = 'players/Z/Afldb_Issue111_Fixture_Alias.html';
const IDENTITY_PATH_UNSAFE = `players/Z/Afldb${coleman.key_separator}Issue111_Fixture.html`;
const IDENTITY_GOALS = 7;

describe.skipIf(!canRunFixtureImporter)(
  `Coleman durable-identity refusals against a real database (AFLDB-ISSUE-111 G5a)${roleParitySuffix}`,
  () => {
    let baselineFingerprint = '';
    let baselineRows = 0;
    let fixturePlayer = 0;
    let identitySource = 0;

    const goalsIn = (row: ColemanWinnerRow) => Number(COLEMAN_NOTE.exec(row.note ?? '')![1]);

    async function colemanRowCount(): Promise<number> {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards a ON a.id = w.award_id
         WHERE a.slug = 'coleman'
      `;
      return row.n;
    }

    /** Replaces the fixture player's durable identities with exactly these paths. */
    async function setIdentities(paths: string[]): Promise<void> {
      await sql`DELETE FROM external_identities WHERE player_id = ${fixturePlayer}`;
      for (const path of paths) {
        await sql`
          INSERT INTO external_identities (
            source_id, external_id, external_name, player_id, status, match_method
          ) VALUES (
            ${identitySource}, ${path}, ${IDENTITY_PLAYER_NAME}, ${fixturePlayer},
            ${coleman.identity_statuses[0]}::link_status, ${coleman.identity_match_method}
          )
        `;
      }
    }

    /** One load that must refuse, with the database proven not to have moved. */
    async function expectRefusal(): Promise<string> {
      const run = runColeman();
      const output = run.stdout + run.stderr;

      expect(run.status, `the loader must refuse this load, not perform it:\n${output}`)
        .not.toBe(0);
      expect(output).toContain(
        'coleman: the derivation cannot produce a durable source_record_id',
      );
      // The whole point of the contract: no weaker identity is substituted.
      expect(output, 'the refusal states that nothing weaker is substituted')
        .toContain('will not fall back to players.id');
      expect(output).toContain('Nothing has been written.');

      expect(await colemanFingerprint(), 'a refused load moves no existing row')
        .toBe(baselineFingerprint);
      expect(await colemanRowCount(), 'a refused load creates no row').toBe(baselineRows);
      const [written] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards a ON a.id = w.award_id
         WHERE a.slug = 'coleman'
           AND w.season = ${IDENTITY_SEASON}
      `;
      expect(
        written.n,
        'the unkeyable winner is not written under some other key either',
      ).toBe(0);
      return output;
    }

    beforeAll(async () => {
      await removeFixtureCorpus();

      const [foreign] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM award_winners w
          JOIN awards  a ON a.id = w.award_id
          JOIN sources s ON s.id = w.source_id
         WHERE a.slug = 'coleman'
           AND s.key <> ${coleman.source_key}
      `;
      if (foreign.n > 0) {
        throw new Error(
          `${foreign.n} Coleman award_winners row(s) in afldb_test are owned by a source `
          + `other than '${coleman.source_key}'. Run the one-time transition `
          + '(import_awards.py --rekey-coleman) first; this suite will not create a '
          + 'duplicated Coleman family.',
        );
      }

      baselineRows = await colemanRowCount();
      baselineFingerprint = await colemanFingerprint();

      const [source] = await sql<{ id: number }[]>`
        SELECT id::int AS id FROM sources WHERE key = ${coleman.source_key}
      `;
      const clubs = await sql<{ id: number }[]>`
        SELECT id::int AS id FROM clubs ORDER BY id LIMIT 2
      `;
      if (!source || clubs.length < 2) {
        throw new Error(
          `afldb_test lacks the '${coleman.source_key}' source or two clubs; the canonical `
          + 'corpus is not loaded, so the identity fixtures cannot be built.',
        );
      }
      identitySource = source.id;

      await sql`
        INSERT INTO seasons (year, competition, league, status, notes)
        VALUES (${IDENTITY_SEASON}, 'VFL/AFL', 'AFL', 'complete'::season_status,
                ${FIXTURE_NOTE})
        ON CONFLICT (year) DO NOTHING
      `;

      // The id is taken above the corpus rather than from the identity
      // sequence: the canonical import seeds players with explicit ids, which
      // can leave the sequence behind max(id) and make a generated id collide.
      const [player] = await sql<{ id: number }[]>`
        INSERT INTO players (id, display_name, sort_name, search_name, slug, notes)
        SELECT coalesce(max(id), 0) + 1,
               ${IDENTITY_PLAYER_NAME},
               'Zzz Fixture, Issue111',
               'afldb issue 111 fixture goalkicker',
               'afldb-issue-111-fixture-goalkicker',
               ${FIXTURE_NOTE}
          FROM players
        RETURNING id::int AS id
      `;
      fixturePlayer = player.id;

      const [match] = await sql<{ id: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, venue_raw, home_club_id, away_club_id,
          home_score, away_score, result, winner_club_id, margin,
          attendance, attendance_status
        ) VALUES (
          ${`${FIXTURE_MATCH_PREFIX}${IDENTITY_SEASON}:1`}, ${IDENTITY_SEASON},
          '1', 1, 'home_and_away'::round_type, false,
          ${`${IDENTITY_SEASON}-04-01`}::date,
          ${FIXTURE_VENUE}, ${clubs[0].id}, ${clubs[1].id},
          60, 40, 'home_win', ${clubs[0].id}, 20,
          NULL, 'not_collected'
        )
        RETURNING id::int AS id
      `;
      // The only goalkicker in a reserved season, so unambiguously its winner:
      // whatever the loader does next is a decision about identity alone.
      await sql`
        INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
        VALUES (${fixturePlayer}, ${match.id}, ${clubs[0].id}, ${IDENTITY_GOALS})
      `;
    }, 600_000);

    afterAll(async () => {
      // Unconditional: the corpus must go even if an assertion above threw.
      await removeFixtureCorpus();
      const restored = runColeman();
      if (restored.status !== 0) {
        throw new Error(
          `the restoring Coleman load failed (${restored.status}); afldb_test may still `
          + `hold fixture-derived winners.\n${restored.stdout}${restored.stderr}`,
        );
      }
      const after = await colemanFingerprint();
      if (baselineFingerprint !== '' && after !== baselineFingerprint) {
        throw new Error(
          'the real Coleman family was not restored byte-for-byte after the identity '
          + `fixtures were removed: fingerprint ${after} != ${baselineFingerprint}`,
        );
      }
    }, 900_000);

    it('refuses the whole load when a winner holds no durable identity', async () => {
      const output = await expectRefusal();
      expect(output).toContain(
        `winner(s) hold no ${coleman.identity_match_method} identity with status in`,
      );
      expect(output, 'the refusal names the season and player it could not key')
        .toContain(`${IDENTITY_SEASON}: player ${fixturePlayer}`);

      // Refused, and recorded as refused: the batch it opened is marked failed
      // with the reason, not left running and not quietly completed.
      const [batch] = await sql<{ status: string; error: string | null }[]>`
        SELECT b.status::text AS status, b.error AS error
          FROM import_batches b
         WHERE b.tool = 'import_awards.py'
           AND b.target_table = 'coleman'
         ORDER BY b.id DESC
         LIMIT 1
      `;
      expect(batch.status).toBe('failed');
      expect(batch.error).toContain('durable source_record_id');
    }, 600_000);

    it('refuses rather than choosing when a winner holds two durable identities', async () => {
      await setIdentities([IDENTITY_PATH, IDENTITY_PATH_ALIAS]);
      const output = await expectRefusal();
      expect(output).toContain('winner(s) hold more than one');
      expect(
        output,
        'an ambiguous identity is reported in full, never resolved by picking one',
      ).toContain('holds 2 profile identities');
      expect(output).toContain(IDENTITY_PATH);
      expect(output).toContain(IDENTITY_PATH_ALIAS);
    }, 600_000);

    it('refuses a normalised path containing the key separator, and does not sanitise it', async () => {
      await setIdentities([IDENTITY_PATH_UNSAFE]);
      const output = await expectRefusal();
      expect(output).toContain(
        `normalised path(s) contain the '${coleman.key_separator}' key separator `
        + 'and are REFUSED, not sanitised',
      );
      expect(output).toContain(`${IDENTITY_SEASON}: '${IDENTITY_PATH_UNSAFE}'`);
    }, 600_000);

    it('loads that same winner once the identity contract is satisfied', async () => {
      // Without this the three refusals above would be consistent with a
      // fixture that could never load for some unrelated reason.
      await setIdentities([IDENTITY_PATH]);
      const run = runColeman();
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.inserted, 'exactly the one fixture winner is new').toBe(1);
      expect(run.deleted, 'no real winner is displaced').toBe(0);

      const winners = await readColemanWinners();
      const rows = winners.filter((w) => w.season === IDENTITY_SEASON);
      expect(rows).toHaveLength(1);
      const [winner] = rows;
      expect(winner.playerId).toBe(fixturePlayer);
      expect(goalsIn(winner)).toBe(IDENTITY_GOALS);
      // The key is composed from the durable path, never from players.id: the
      // whole key is pinned, so a surrogate id could not appear anywhere in it.
      expect(winner.recordId).toBe(
        `coleman${coleman.key_separator}${IDENTITY_SEASON}`
        + `${coleman.key_separator}${IDENTITY_PATH}`,
      );
      expect(await colemanRowCount()).toBe(baselineRows + 1);
    }, 600_000);
  },
);

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-111 — the one-time legacy -> derived ownership transition
// ---------------------------------------------------------------------------
/*
 * `reload_keyed` matches only within its own ownership scope. Left alone, the
 * derived loader would see an empty afltables scope beside 46 legacy
 * draftguru-owned rows, INSERT 46 new ones and leave the old ones standing —
 * 92 Coleman rows, silently duplicated, with neither uniqueness constraint able
 * to stop it because the two keys differ. `--rekey-coleman` exists to re-own
 * those rows in place instead, preserving every award_winners.id because
 * player_link_resolutions.target_id points at them.
 *
 * afldb_test's Coleman family is ALREADY derived, afltables-owned and keyed on
 * profile paths — passes 3 to 5 put it there. So the legacy state this block
 * needs is manufactured deliberately, from the derived family itself, and
 * reversed by id afterwards. That is also what makes the 1:1 assertion sharp:
 * the derived key each row must come back to is exactly the key it started
 * with, so a correct rekey restores the baseline fingerprint byte for byte.
 *
 * Every state transition happens in beforeAll, in one ordered choreography, so
 * each `it` is a pure assertion over a captured snapshot and a failing
 * assertion cannot strand the database midway. afterAll restores by id rather
 * than by reloading, so restoration does not depend on the loader it is
 * testing, and then proves the restoration.
 */
const TRANSITION = coleman.legacy_transition;

/** One `--rekey-coleman` run. AFLDB_LEGACY_SQLITE is dropped: it reads none. */
type RekeyRun = { status: number | null; output: string };

function runRekey(): RekeyRun {
  const run = importRole.spawn(
    python,
    ['tools/migration/import_awards.py', '--rekey-coleman'],
    { cwd: root, env: { AFLDB_LEGACY_SQLITE: undefined } },
  );
  return { status: run.status, output: run.stdout + run.stderr };
}

/** The ownership facts the transition is allowed to change, plus the ones it is not. */
type OwnershipRow = {
  id: number;
  season: number;
  sourceKey: string | null;
  recordId: string | null;
  playerId: number | null;
  status: string;
  playerNameRaw: string;
};

async function readOwnership(): Promise<OwnershipRow[]> {
  return sql<OwnershipRow[]>`
    SELECT w.id::int                 AS id,
           w.season::int             AS season,
           s.key                     AS "sourceKey",
           w.source_record_id        AS "recordId",
           w.player_id::int          AS "playerId",
           w.link_status_value::text AS status,
           w.player_name_raw         AS "playerNameRaw"
      FROM award_winners w
      JOIN awards a ON a.id = w.award_id
      LEFT JOIN sources s ON s.id = w.source_id
     WHERE a.slug = 'coleman'
     ORDER BY w.id
  `;
}

/** Comparable form: a row's identity, its ownership and the facts it carries. */
const ownershipOf = (rows: OwnershipRow[]) => rows.map(
  (r) => `${r.id}|${r.season}|${r.sourceKey}|${r.recordId}|${r.playerId}|${r.status}`,
);

type IsolationSnapshot = {
  fingerprint: string;
  rows: number;
  draftguru: number;
  unowned: number;
  witnessKey: string | null;
};

/**
 * Every award_winners row that is NOT a Coleman winner, fingerprinted on the
 * columns the transition writes plus the ones it must leave alone.
 */
async function readIsolation(): Promise<IsolationSnapshot> {
  const [row] = await sql<{
    fingerprint: string | null;
    rowCount: number;
    draftguru: number;
    unowned: number;
  }[]>`
    SELECT md5(string_agg(
             w.id::text || '|' || coalesce(s.key, '(null)') || '|'
             || coalesce(w.source_record_id, '(null)') || '|'
             || coalesce(w.player_id::text, '(null)') || '|'
             || w.link_status_value::text || '|' || coalesce(w.season::text, '(null)'),
             ',' ORDER BY w.id))                                    AS fingerprint,
           count(*)::int                                            AS "rowCount",
           (count(*) FILTER (WHERE s.key = 'draftguru'))::int        AS draftguru,
           (count(*) FILTER (WHERE w.source_id IS NULL
                                OR s.key = 'manual_admin_edit'))::int AS unowned
      FROM award_winners w
      JOIN awards a ON a.id = w.award_id
      LEFT JOIN sources s ON s.id = w.source_id
     WHERE a.slug <> 'coleman'
  `;
  const [witness] = await sql<{ recordId: string | null }[]>`
    SELECT w.source_record_id AS "recordId"
      FROM award_winners w
      JOIN awards a ON a.id = w.award_id
     WHERE a.slug = ${ISOLATION_AWARD_SLUG}
       AND w.source_record_id IS NOT NULL
     ORDER BY w.id
     LIMIT 1
  `;
  return {
    fingerprint: row.fingerprint ?? '',
    rows: row.rowCount,
    draftguru: row.draftguru,
    unowned: row.unowned,
    witnessKey: witness?.recordId ?? null,
  };
}

describe.skipIf(!canRunFixtureImporter)(
  `Coleman legacy to derived ownership transition (AFLDB-ISSUE-111)${roleParitySuffix}`,
  () => {
    let baseline: OwnershipRow[] = [];
    let baselineFingerprint = '';
    let unlinkedRowId = 0;
    let mixedRowId = 0;
    let duplicatedSeason = 0;
    let draftguruId = 0;
    let afltablesId = 0;

    let noopRun!: RekeyRun;
    let afterNoop: OwnershipRow[] = [];

    let mixedBefore: OwnershipRow[] = [];
    let mixedRun!: RekeyRun;
    let afterMixed: OwnershipRow[] = [];

    let unbridgeableBefore: OwnershipRow[] = [];
    let unbridgeableRun!: RekeyRun;
    let afterUnbridgeable: OwnershipRow[] = [];

    let legacyBefore: OwnershipRow[] = [];
    let rekeyRun!: RekeyRun;
    let afterRekey: OwnershipRow[] = [];
    let fingerprintAfterRekey = '';

    let firstLoad!: ColemanRun;
    let afterFirstLoad: OwnershipRow[] = [];
    let fingerprintAfterLoad = '';
    let decisionsAfterLoad = -1;

    let isolationBefore!: IsolationSnapshot;
    let isolationAfterRekey!: IsolationSnapshot;
    let isolationAfterLoad!: IsolationSnapshot;

    const legacyKeyFor = (season: number, id: number) =>
      `coleman${coleman.key_separator}${season}${coleman.key_separator}${id}`;

    /**
     * Rewrites the whole Coleman family into the legacy draftguru shape: the
     * pre-ISSUE-111 provenance and the `coleman:<season>:<int>` key form the
     * transition's preflight recognises. The integer is the row's own id, which
     * is unique by construction, so neither uniqueness constraint can object.
     *
     * One row is left unlinked and `implausible`, mirroring the measured legacy
     * 1982 Malcolm Blight row (id 9441 in afldb_dev). The transition must adopt
     * it without asserting anything about it; the first derived load is what
     * links it.
     */
    async function writeLegacyState(
      seasonOverrides: Map<number, number> = new Map(),
    ): Promise<void> {
      for (const row of baseline) {
        const season = seasonOverrides.get(row.id) ?? row.season;
        const unlinked = row.id === unlinkedRowId;
        await sql`
          UPDATE award_winners
             SET source_id         = ${draftguruId},
                 source_record_id  = ${legacyKeyFor(season, row.id)},
                 season            = ${season},
                 player_id         = ${unlinked ? null : row.playerId},
                 link_status_value = ${unlinked ? 'implausible' : row.status}::link_status
           WHERE id = ${row.id}
        `;
      }
    }

    /** Exactly one row moved back to legacy ownership: the mixed state. */
    async function writeMixedState(): Promise<void> {
      const row = baseline.find((r) => r.id === mixedRowId)!;
      await sql`
        UPDATE award_winners
           SET source_id        = ${draftguruId},
               source_record_id = ${legacyKeyFor(row.season, row.id)}
         WHERE id = ${row.id}
      `;
    }

    /**
     * Restores the derived family by id. Deliberately not a reload: restoration
     * must not depend on the loader this block is testing.
     */
    async function restoreBaseline(): Promise<void> {
      for (const row of baseline) {
        await sql`
          UPDATE award_winners
             SET source_id         = ${afltablesId},
                 source_record_id  = ${row.recordId},
                 season            = ${row.season},
                 player_id         = ${row.playerId},
                 link_status_value = ${row.status}::link_status,
                 player_name_raw   = ${row.playerNameRaw}
           WHERE id = ${row.id}
        `;
      }
    }

    beforeAll(async () => {
      await removeFixtureCorpus();

      const sources = await sql<{ key: string; id: number }[]>`
        SELECT key, id::int AS id
          FROM sources
         WHERE key = ANY(${[coleman.source_key, TRANSITION.legacy_source_key]})
      `;
      const derivedSource = sources.find((s) => s.key === coleman.source_key);
      const legacySource = sources.find((s) => s.key === TRANSITION.legacy_source_key);
      if (!derivedSource || !legacySource) {
        throw new Error(
          `afldb_test is missing the '${coleman.source_key}' or `
          + `'${TRANSITION.legacy_source_key}' source row; the transition cannot be `
          + 'exercised without both provenances.',
        );
      }
      afltablesId = derivedSource.id;
      draftguruId = legacySource.id;

      baseline = await readOwnership();
      baselineFingerprint = await colemanFingerprint();

      const foreign = baseline.filter((r) => r.sourceKey !== coleman.source_key);
      if (foreign.length > 0) {
        throw new Error(
          `${foreign.length} Coleman award_winners row(s) in afldb_test are not owned by `
          + `'${coleman.source_key}'. This block manufactures the legacy state from the `
          + 'derived family and restores it by id, so it refuses to run against a family '
          + 'it did not start from.',
        );
      }
      if (baseline.length !== TRANSITION.expected_rows) {
        throw new Error(
          `afldb_test holds ${baseline.length} Coleman winner row(s); the tracked contract `
          + `declares exactly ${TRANSITION.expected_rows} and the transition's preflight `
          + 'refuses any other count. The legacy state is manufactured from this family, so '
          + 'the 1:1 rekey cannot be tested against a family of a different size — rebuild '
          + 'afldb_test or reconcile data/reference/coleman-derivation.json.',
        );
      }
      const decisionsBefore = await colemanLinkDecisions();
      if (decisionsBefore !== 0) {
        throw new Error(
          `${decisionsBefore} human player-link decision(s) exist on Coleman rows in `
          + 'afldb_test. The transition refuses in that state by design, so the happy path '
          + 'below cannot be measured until they are understood.',
        );
      }

      const bySeason = [...baseline].sort((a, b) => a.season - b.season);
      unlinkedRowId = bySeason[0].id;
      mixedRowId = bySeason[bySeason.length - 1].id;
      // Move the earliest season's row onto the next season: that season then
      // carries two legacy rows, so the (award_id, season) bridge is no longer
      // 1:1 and the whole transaction must abort.
      duplicatedSeason = bySeason[1].season;

      // Isolation witnesses. The first is deliberately a legacy-SHAPED Coleman
      // key on a different award: the transition scopes by award_id, so a key
      // that merely looks like its own must be left completely alone. The
      // second carries manual/NULL provenance, the rows the runbook names as
      // untouchable.
      const [isolationAward] = await sql<{ id: number }[]>`
        INSERT INTO awards (slug, name, category, description)
        VALUES (${ISOLATION_AWARD_SLUG}, 'AFLDB-ISSUE-111 isolation witness', 'award',
                ${FIXTURE_NOTE})
        ON CONFLICT (slug) DO UPDATE SET description = ${FIXTURE_NOTE}
        RETURNING id::int AS id
      `;
      await sql`
        INSERT INTO award_winners (
          award_id, season, player_id, player_name_raw, link_status_value,
          source_id, source_record_id, note
        ) VALUES (
          ${isolationAward.id}, ${coleman.first_season}, NULL,
          'AFLDB-ISSUE-111 legacy-shaped witness', 'unmatched'::link_status,
          ${draftguruId}, ${legacyKeyFor(coleman.first_season, 0)}, ${FIXTURE_NOTE}
        ), (
          ${isolationAward.id}, ${coleman.first_season}, NULL,
          'AFLDB-ISSUE-111 unowned witness', 'unmatched'::link_status,
          (SELECT id FROM sources WHERE key = 'manual_admin_edit'), NULL, ${FIXTURE_NOTE}
        )
      `;
      isolationBefore = await readIsolation();

      // 1. Already transitioned: a re-run must recognise the state and no-op.
      noopRun = runRekey();
      afterNoop = await readOwnership();

      // 2. Mixed ownership: one legacy row beside the derived family aborts.
      await writeMixedState();
      mixedBefore = await readOwnership();
      mixedRun = runRekey();
      afterMixed = await readOwnership();
      await restoreBaseline();

      // 3. A season that cannot bridge 1:1 aborts the whole transaction.
      await writeLegacyState(new Map([[unlinkedRowId, duplicatedSeason]]));
      unbridgeableBefore = await readOwnership();
      unbridgeableRun = runRekey();
      afterUnbridgeable = await readOwnership();

      // 4. The real transition: an all-legacy family, rekeyed exactly 1:1.
      await writeLegacyState();
      legacyBefore = await readOwnership();
      rekeyRun = runRekey();
      afterRekey = await readOwnership();
      fingerprintAfterRekey = await colemanFingerprint();
      isolationAfterRekey = await readIsolation();

      // 5. The first derived load over the transitioned rows.
      firstLoad = runColeman();
      afterFirstLoad = await readOwnership();
      fingerprintAfterLoad = await colemanFingerprint();
      decisionsAfterLoad = await colemanLinkDecisions();
      isolationAfterLoad = await readIsolation();
    }, 1_800_000);

    afterAll(async () => {
      // Unconditional, and by id: restoration must not depend on the loader.
      if (baseline.length > 0) {
        await restoreBaseline();
        const restored = ownershipOf(await readOwnership());
        const fingerprint = await colemanFingerprint();
        await removeFixtureCorpus();
        if (fingerprint !== baselineFingerprint) {
          throw new Error(
            'the derived Coleman family was not restored after the transition fixtures: '
            + `fingerprint ${fingerprint} != ${baselineFingerprint}`,
          );
        }
        if (restored.join('\n') !== ownershipOf(baseline).join('\n')) {
          throw new Error(
            'the derived Coleman family came back with different ownership or facts after '
            + 'the transition fixtures; afldb_test still holds manufactured legacy state.',
          );
        }
      } else {
        await removeFixtureCorpus();
      }
    }, 900_000);

    it('verifies and no-ops when every Coleman row is already derived', () => {
      // Retry safety: the transition is a one-time command a curator may well
      // run twice, and the second run must recognise its own work.
      expect(noopRun.status, noopRun.output).toBe(0);
      expect(noopRun.output).toContain('Already rekeyed');
      expect(noopRun.output).toMatch(
        new RegExp(`owned by ${coleman.source_key}\\s+${baseline.length}\\b`),
      );
      expect(
        noopRun.output,
        'a no-op must not report a mutation it did not perform',
      ).not.toContain('Coleman row(s) in place');
      expect(ownershipOf(afterNoop)).toEqual(ownershipOf(baseline));
    });

    it('refuses a mixed ownership state and writes nothing', () => {
      // Half-transitioned is the one state no automatic rule can resolve: it
      // needs a human, so the tool says so rather than guessing.
      expect(mixedRun.status, mixedRun.output).not.toBe(0);
      expect(mixedRun.output).toContain('Mixed ownership state');
      expect(mixedRun.output).toContain('nothing was written');
      expect(mixedRun.output).toMatch(
        new RegExp(`owned by ${TRANSITION.legacy_source_key}\\s+1\\b`),
      );
      expect(
        ownershipOf(afterMixed),
        'a refused transition leaves every row exactly as it found it',
      ).toEqual(ownershipOf(mixedBefore));
    });

    it('refuses when a season cannot bridge 1:1, aborting the whole transaction', () => {
      expect(unbridgeableRun.status, unbridgeableRun.output).not.toBe(0);
      expect(unbridgeableRun.output).toContain('carry more than one legacy row');
      expect(unbridgeableRun.output).toContain(String(duplicatedSeason));
      expect(unbridgeableRun.output).toContain(
        'The mapping is not exactly 1:1; nothing was written.',
      );
      // Not one of the 45 bridgeable rows was moved on the way to finding the
      // one that was not: the refusal precedes every write.
      expect(ownershipOf(afterUnbridgeable)).toEqual(ownershipOf(unbridgeableBefore));
      expect(
        afterUnbridgeable.filter((r) => r.sourceKey !== TRANSITION.legacy_source_key),
        'every row is still legacy-owned after the abort',
      ).toEqual([]);
    });

    it('rekeys an all-legacy family exactly 1:1, preserving every surrogate id', () => {
      expect(
        legacyBefore.filter((r) => r.sourceKey !== TRANSITION.legacy_source_key),
        'the fixture really did put the whole family into the legacy state',
      ).toEqual([]);
      expect(legacyBefore.length).toBe(TRANSITION.expected_rows);

      expect(rekeyRun.status, rekeyRun.output).toBe(0);
      expect(rekeyRun.output).toMatch(
        new RegExp(`rows in the coleman award\\s+${baseline.length}\\b`),
      );
      expect(rekeyRun.output).toMatch(
        new RegExp(`owned by ${TRANSITION.legacy_source_key}\\s+${baseline.length}\\b`),
      );
      expect(rekeyRun.output).toMatch(
        new RegExp(`exact 1:1 mappings\\s+${baseline.length}\\b`),
      );
      // The zero is re-verified at run time rather than trusted from the
      // runbook: the first derived load rewrites player_name_raw, which is only
      // safe while no human decision is attached to these rows.
      expect(rekeyRun.output).toMatch(/Coleman player_link_resolutions rows\s+0\b/);
      expect(rekeyRun.output).toContain(`Rekeyed ${baseline.length} Coleman row(s) in place`);
      expect(rekeyRun.output).toContain('every surrogate id is unchanged');

      // No row is deleted and no row is created: player_link_resolutions
      // .target_id points at these ids and is not a foreign key, so a
      // replacement row would silently orphan a human decision.
      expect(afterRekey.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
      // 1:1 in the strongest available sense: each id came back to exactly the
      // derived key it held before the legacy state was manufactured.
      expect(afterRekey.map((r) => `${r.id}|${r.sourceKey}|${r.recordId}`))
        .toEqual(baseline.map((r) => `${r.id}|${r.sourceKey}|${r.recordId}`));
      expect(fingerprintAfterRekey).toBe(baselineFingerprint);

      // Only source_id and source_record_id change. The transition moves
      // ownership without asserting a single fact, so the unlinked legacy row
      // is still unlinked: linking it is the derived load's job, below.
      const adopted = afterRekey.find((r) => r.id === unlinkedRowId)!;
      expect(adopted.playerId, 'the transition links nobody').toBeNull();
      expect(adopted.status).toBe('implausible');
    });

    it('leaves every other award family untouched', () => {
      expect(
        isolationBefore.rows,
        'the isolation claim needs non-Coleman rows to be about anything',
      ).toBeGreaterThan(0);
      expect(isolationBefore.draftguru, 'including another draftguru-owned row')
        .toBeGreaterThan(0);
      expect(isolationBefore.unowned, 'including a manual or unowned-provenance row')
        .toBeGreaterThan(0);

      expect(isolationAfterRekey, 'the transition is scoped to the Coleman award alone')
        .toEqual(isolationBefore);
      expect(isolationAfterLoad, 'and so is the derived load that follows it')
        .toEqual(isolationBefore);
      // The sharpest case: a key that merely looks like a legacy Coleman key,
      // on a different award, survives verbatim.
      expect(isolationAfterLoad.witnessKey)
        .toBe(legacyKeyFor(coleman.first_season, 0));
    });

    it('reports 46 updated / 0 inserted / 0 deleted on the first derived load', () => {
      expect(firstLoad.status, firstLoad.stdout + firstLoad.stderr).toBe(0);
      // The acceptance signal from the runbook, read from the contract rather
      // than written as a literal. An insert or a delete here means the bridge
      // was wrong and the duplication the transition exists to prevent happened
      // anyway.
      expect(TRANSITION.first_load_expectation)
        .toBe(`${TRANSITION.expected_rows} updated, 0 inserted, 0 deleted`);
      expect(firstLoad.updated).toBe(TRANSITION.expected_rows);
      expect(firstLoad.inserted, 'a transitioned row is matched, never inserted beside').toBe(0);
      expect(firstLoad.deleted, 'and never deleted and rewritten').toBe(0);

      expect(afterFirstLoad.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
      expect(fingerprintAfterLoad).toBe(baselineFingerprint);

      // The 1982-Blight case: a legacy row the name matcher could not link is
      // adopted and linked by the derivation, because identity now comes from
      // player_match_stats rather than from a name.
      const adopted = afterFirstLoad.find((r) => r.id === unlinkedRowId)!;
      expect(adopted.playerId, 'the unlinked legacy row is adopted, not replaced').not.toBeNull();
      expect(adopted.status).toBe('resolved');
      expect(afterFirstLoad.filter((r) => r.playerId === null)).toEqual([]);
      // Overriding no human decision, because there are none to override.
      expect(decisionsAfterLoad).toBe(0);
    });
  },
);

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-111 — human link decisions across the derived reload
// ---------------------------------------------------------------------------
/*
 * The derived loader is born linked: it writes player_id, link_status_value AND
 * player_name_raw for every winner from the canonical facts. An admin decision
 * recorded against one of those rows is therefore in direct competition with
 * the derivation on every single reload, which is exactly the collision
 * AFLDB-ISSUE-044 exists to police.
 *
 * `import_coleman` passes target_table="award_winners" and takes reload_keyed's
 * default name_column="player_name_raw" (tools/migration/common.py), so all
 * three of that helper's decision rules apply here. This block measures them
 * against the real derived family rather than assuming they carry over:
 *
 *   1. a `linked` decision outranks the derivation's own player, and the
 *      disagreement is warned rather than silently reconciled;
 *   2. a `confirmed_unlinked` decision keeps the row unlinked, and that
 *      disagreement is warned too;
 *   3. a decided row whose stored name no longer matches the derivation fails
 *      the reload CLOSED, writing nothing.
 *
 * (3) is the runtime evidence for the transition runbook's safety claim: the
 * first derived load rewrites player_name_raw — for the unlinked 1982 row, from
 * the legacy spelling to the canonical display name — and that is safe ONLY
 * while no human decision is attached. The runbook states it; here it is
 * measured, together with the recovery that follows once the name agrees again.
 *
 * Both decisions are recorded through the real admin path (resolveLink /
 * confirmUnlinked), which refuses a row that is not in the review queue, so each
 * chosen row is returned to the queue first — the AFLDB-ISSUE-044 pattern above.
 * Every state change happens in beforeAll, in one ordered choreography, and
 * afterAll restores the touched rows BY ID and deletes the fixture decisions, so
 * neither a failing assertion nor a crashed run can leave afldb_test carrying a
 * human decision the other Coleman blocks refuse to run beside.
 */
const COLEMAN_LINK_EMAIL = 'issue-111-coleman-links@example.test';
const COLEMAN_LINK_NOTE = 'AFLDB-ISSUE-111 decision survival';

describe.skipIf(!canRunFixtureImporter)(
  `Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111)${roleParitySuffix}`,
  () => {
    let adminUserId = 0;
    let adminPlayerId = 0;

    let baseline: OwnershipRow[] = [];
    let baselineFingerprint = '';

    let linkedRowId = 0;
    let linkedSourcePlayer = 0;
    let linkedName = '';
    let linkedKey = '';
    let unlinkedRowId = 0;
    let unlinkedKey = '';

    let preservingRun!: ColemanRun;
    let afterPreserving: OwnershipRow[] = [];
    let fingerprintAfterPreserving = '';
    let vetted = new Set<string>();
    let decisionsAfterPreserving = -1;

    let renamedBefore: OwnershipRow[] = [];
    let refusedRun!: ColemanRun;
    let afterRefused: OwnershipRow[] = [];
    let fingerprintAfterRefused = '';

    let healRun!: ColemanRun;
    let afterHeal: OwnershipRow[] = [];
    let fingerprintAfterHeal = '';

    /** Ownership plus the two facts a decision moves: the link and the name. */
    const factsOf = (rows: OwnershipRow[]) => rows.map(
      (r) => `${r.id}|${r.sourceKey}|${r.recordId}|${r.playerId}|${r.status}|${r.playerNameRaw}`,
    );

    /**
     * Returns one derived row to the review queue. resolveLink/confirmUnlinked
     * lock an UNRESOLVED target and refuse anything else, so a born-linked
     * 'resolved' row cannot be decided until it is queued — the same step the
     * AFLDB-ISSUE-044 block takes for a source-linked Hall of Fame row.
     */
    async function queueForReview(id: number): Promise<void> {
      await sql`
        UPDATE award_winners
           SET player_id = NULL, link_status_value = 'ambiguous'
         WHERE id = ${id}
      `;
    }

    /**
     * Restores the three columns this block can move, by id. Deliberately not a
     * reload: restoration must not depend on the loader under test, and a
     * reload would in any case still honour a decision that has not been
     * deleted yet.
     */
    async function restoreBaselineFacts(): Promise<void> {
      for (const row of baseline) {
        await sql`
          UPDATE award_winners
             SET player_id         = ${row.playerId},
                 link_status_value = ${row.status}::link_status,
                 player_name_raw   = ${row.playerNameRaw}
           WHERE id = ${row.id}
        `;
      }
    }

    beforeAll(async () => {
      await removeFixtureCorpus();

      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${COLEMAN_LINK_EMAIL}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;
      // Defensive on entry: a crashed earlier run of this block would leave its
      // decisions behind, and the guard below — like every other Coleman
      // block's — refuses to run beside a Coleman decision it did not record.
      await sql`DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}`;

      baseline = await readOwnership();
      baselineFingerprint = await colemanFingerprint();

      const foreign = baseline.filter((r) => r.sourceKey !== coleman.source_key);
      if (foreign.length > 0) {
        throw new Error(
          `${foreign.length} Coleman award_winners row(s) in afldb_test are not owned by `
          + `'${coleman.source_key}'. This block decides rows of the derived family and `
          + 'restores them by id, so it refuses a family it did not start from.',
        );
      }
      if (baseline.length !== TRANSITION.expected_rows) {
        throw new Error(
          `afldb_test holds ${baseline.length} Coleman winner row(s); the tracked contract `
          + `declares exactly ${TRANSITION.expected_rows}. The reload signal asserted below `
          + 'is that count, so it cannot be measured against a family of a different size.',
        );
      }
      const decisionsBefore = await colemanLinkDecisions();
      if (decisionsBefore !== 0) {
        throw new Error(
          `${decisionsBefore} human player-link decision(s) already exist on Coleman rows in `
          + 'afldb_test and were not recorded by this block. They must be understood before '
          + 'a decision-survival fixture can mean anything.',
        );
      }

      const bySeason = [...baseline].sort((a, b) => a.season - b.season);
      linkedRowId = bySeason[0].id;
      unlinkedRowId = bySeason[bySeason.length - 1].id;

      // Both chosen rows must be exactly what a clean derived load leaves
      // behind — born linked, and carrying the derivation's own name — or the
      // disagreement and name-guard assertions below would be measuring a
      // half-restored state instead of the loader.
      const derived = await readColemanWinners();
      for (const id of [linkedRowId, unlinkedRowId]) {
        const winner = derived.find((w) => w.id === id);
        if (!winner || winner.playerId === null || winner.status !== 'resolved'
            || winner.playerNameRaw !== winner.displayName) {
          throw new Error(
            `Coleman row id=${id} is not in the born-linked derived state `
            + `(player_id=${winner?.playerId ?? 'missing row'}, `
            + `status=${winner?.status}, player_name_raw=${winner?.playerNameRaw}, `
            + `display_name=${winner?.displayName}). Run the derived loader before `
            + 'this block, or reconcile the row: a decision fixture is only evidence '
            + 'about the reload if the row started where the derivation puts it.',
          );
        }
      }
      const linkedRow = baseline.find((r) => r.id === linkedRowId)!;
      linkedSourcePlayer = linkedRow.playerId!;
      linkedName = linkedRow.playerNameRaw;
      linkedKey = linkedRow.recordId!;
      unlinkedKey = baseline.find((r) => r.id === unlinkedRowId)!.recordId!;

      // Someone the derivation certainly does not name for either row, so the
      // decision genuinely contradicts the source rather than agreeing with it.
      const derivedPlayers = [
        linkedSourcePlayer,
        baseline.find((r) => r.id === unlinkedRowId)!.playerId!,
      ];
      const [other] = await sql<{ id: number }[]>`
        SELECT id::int AS id
          FROM players
         WHERE id <> ALL(${derivedPlayers}::int[])
         ORDER BY id
         LIMIT 1
      `;
      if (!other) throw new Error('afldb_test holds no spare player for the fixture decision');
      adminPlayerId = other.id;

      await queueForReview(linkedRowId);
      const linked = await resolveLink({
        targetTable: 'award_winners',
        targetId: linkedRowId,
        playerId: adminPlayerId,
        adminUserId,
        note: COLEMAN_LINK_NOTE,
      });
      if (!linked.ok) throw new Error(`resolveLink refused the fixture link: ${linked.error}`);

      await queueForReview(unlinkedRowId);
      const confirmed = await confirmUnlinked({
        targetTable: 'award_winners',
        targetId: unlinkedRowId,
        adminUserId,
        note: COLEMAN_LINK_NOTE,
      });
      if (!confirmed.ok) {
        throw new Error(`confirmUnlinked refused the fixture decision: ${confirmed.error}`);
      }

      // 1. The reload that must honour both decisions.
      preservingRun = runColeman();
      afterPreserving = await readOwnership();
      fingerprintAfterPreserving = await colemanFingerprint();
      vetted = await listConfirmedUnlinked();
      decisionsAfterPreserving = await colemanLinkDecisions();

      // 2. The name guard: the decided row's stored name no longer matches the
      // name the derivation supplies, so the decision cannot be carried across.
      await sql`
        UPDATE award_winners
           SET player_name_raw = ${`${linkedName} (renamed)`}
         WHERE id = ${linkedRowId}
      `;
      renamedBefore = await readOwnership();
      refusedRun = runColeman();
      afterRefused = await readOwnership();
      fingerprintAfterRefused = await colemanFingerprint();

      // 3. Restored by id, the same reload succeeds and the decisions stand.
      await sql`
        UPDATE award_winners SET player_name_raw = ${linkedName} WHERE id = ${linkedRowId}
      `;
      healRun = runColeman();
      afterHeal = await readOwnership();
      fingerprintAfterHeal = await colemanFingerprint();
    }, 1_800_000);

    afterAll(async () => {
      // Decisions first: while one exists, every other Coleman block's guard
      // refuses, and a reload would keep re-applying it over the derived facts.
      if (adminUserId) {
        await sql`DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}`;
        await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
      }
      if (baseline.length > 0) {
        await restoreBaselineFacts();
        const restored = factsOf(await readOwnership());
        const fingerprint = await colemanFingerprint();
        const decisions = await colemanLinkDecisions();
        await removeFixtureCorpus();
        if (fingerprint !== baselineFingerprint) {
          throw new Error(
            'the derived Coleman family was not restored after the decision fixtures: '
            + `fingerprint ${fingerprint} != ${baselineFingerprint}`,
          );
        }
        if (restored.join('\n') !== factsOf(baseline).join('\n')) {
          throw new Error(
            'the derived Coleman family came back with different links or names after the '
            + 'decision fixtures; afldb_test still holds fixture state.',
          );
        }
        if (decisions !== 0) {
          throw new Error(
            `${decisions} Coleman player_link_resolutions row(s) survived this block's `
            + 'cleanup; the next Coleman run would refuse.',
          );
        }
      } else {
        await removeFixtureCorpus();
      }
    }, 900_000);

    it("keeps an admin's link across the derived reload, and reports the disagreement", () => {
      expect(preservingRun.status, preservingRun.stdout + preservingRun.stderr).toBe(0);
      // Both decisions were classified and carried across, and neither was
      // discarded: a reload that quietly dropped one would still exit 0.
      expect(preservingRun.stdout).toMatch(/coleman decisions preserved\s+2\b/);
      expect(preservingRun.stdout).not.toContain('DISCARDING');
      expect(decisionsAfterPreserving).toBe(2);

      const after = afterPreserving.find((r) => r.id === linkedRowId);
      expect(after, 'the decided row must survive under its own id').toBeDefined();
      expect(after!.playerId, "the admin's decision outranks the derivation").toBe(adminPlayerId);
      expect(after!.status).toBe('resolved');
      expect(after!.recordId, 'and its durable key is untouched').toBe(linkedKey);

      // Never silent: the derivation still names its own player, and says so.
      expect(preservingRun.stdout).toContain(`award_winners id=${linkedRowId}`);
      expect(preservingRun.stdout).toContain(`the source now links player ${linkedSourcePlayer}`);
      expect(preservingRun.stdout).toContain(`an admin linked player ${adminPlayerId}`);

      // Reconciled in place: nothing was inserted beside the decided rows and
      // nothing deleted, so no surrogate id — and no decision target — moved.
      expect(preservingRun.updated).toBe(TRANSITION.expected_rows);
      expect(preservingRun.inserted).toBe(0);
      expect(preservingRun.deleted).toBe(0);
      expect(fingerprintAfterPreserving).toBe(baselineFingerprint);

      // Only the two decided rows differ from the derived baseline: honouring a
      // decision must not perturb the rest of the family.
      const moved = afterPreserving
        .filter((row) => {
          const before = baseline.find((b) => b.id === row.id)!;
          return `${row.playerId}|${row.status}` !== `${before.playerId}|${before.status}`;
        })
        .map((row) => row.id)
        .sort((a, b) => a - b);
      expect(moved).toEqual([linkedRowId, unlinkedRowId].sort((a, b) => a - b));
    });

    it('keeps a confirmed-unlinked decision, and reports that disagreement too', () => {
      const after = afterPreserving.find((r) => r.id === unlinkedRowId);
      expect(after, 'the vetted row must survive under its own id').toBeDefined();
      // Vetted as genuinely not that player: born linked or not, the derivation
      // does not get to relink it.
      expect(after!.playerId).toBeNull();
      // The row honestly keeps the unresolved status the admin decided from,
      // rather than claiming a resolution nobody made.
      expect(after!.status).toBe('ambiguous');
      expect(after!.recordId).toBe(unlinkedKey);

      expect(preservingRun.stdout).toContain(`award_winners id=${unlinkedRowId}`);
      expect(preservingRun.stdout)
        .toContain('an admin confirmed this row is genuinely unlinked');

      // The decision is only useful while it still names a live row: that is
      // exactly what a truncate-and-reload used to leave dangling.
      expect(vetted.has(`award_winners:${unlinkedRowId}`)).toBe(true);
    });

    it('refuses the reload when a decided row no longer carries the derived name', () => {
      // The transition runbook's safety claim, measured: the derived load
      // rewrites player_name_raw, which is safe only while no human decision is
      // attached to the row. With one attached, the name guard fails closed
      // rather than reattributing the decision to a differently-named row.
      expect(refusedRun.status, 'the reload must fail closed').not.toBe(0);
      expect(refusedRun.stdout).toContain('cannot survive');
      expect(refusedRun.stdout).toContain(`award_winners id=${linkedRowId}`);
      expect(refusedRun.stdout).toContain('decision=linked');
      expect(refusedRun.stdout).toContain('the source name changed to');
      // The other decision is intact, so exactly one is at risk and it is named.
      expect(refusedRun.stdout).toContain('1 human identity decision(s) cannot survive');

      // It refused before writing anything at all: no reload report was even
      // printed (runColeman reports -1 when the signal line is absent).
      expect(refusedRun.updated, 'no reload ran, so there is no reload signal').toBe(-1);
      expect(factsOf(afterRefused)).toEqual(factsOf(renamedBefore));
      expect(fingerprintAfterRefused).toBe(baselineFingerprint);
    });

    it('loads again once the name agrees, with both decisions still standing', () => {
      expect(healRun.status, healRun.stdout + healRun.stderr).toBe(0);
      expect(healRun.updated).toBe(TRANSITION.expected_rows);
      expect(healRun.inserted).toBe(0);
      expect(healRun.deleted).toBe(0);

      const linked = afterHeal.find((r) => r.id === linkedRowId)!;
      expect(linked.playerId).toBe(adminPlayerId);
      expect(linked.status).toBe('resolved');
      expect(linked.playerNameRaw, 'the derivation owns the name again').toBe(linkedName);

      const unlinked = afterHeal.find((r) => r.id === unlinkedRowId)!;
      expect(unlinked.playerId).toBeNull();
      expect(unlinked.status).toBe('ambiguous');

      expect(fingerprintAfterHeal).toBe(baselineFingerprint);
    });
  },
);
