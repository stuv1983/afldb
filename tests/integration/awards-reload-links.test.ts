import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

// One connection pool for the whole file: both describe blocks share `sql`.
beforeAll(async () => {
  if (canRunFixtureImporter || canRunUnder22Importer) await importRole.validate();
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

type CaptaincyRow = {
  id: number;
  season: number;
  clubId: number;
  playerId: number | null;
  name: string;
  status: string;
  role: string;
  period: string | null;
  notes: string | null;
  sourceId: number | null;
  recordId: string | null;
};

const CAPTAINCY_FIXTURE_NAME = 'AFLDB-ISSUE-085 Fixture Captain';
const CAPTAINCY_FIXTURE_RECORD_ID = 'issue-085:owned-captaincy';

function buildCaptaincyFixtureDb(
  path: string,
  row: { season: number; club: string },
): void {
  const script = [
    'import json, sqlite3',
    `con = sqlite3.connect(${JSON.stringify(path)})`,
    'cur = con.cursor()',
    'cur.execute("""CREATE TABLE person_links (dg_person_id INTEGER, player_id INTEGER, match_status TEXT, candidate_count INTEGER)""")',
    'cur.execute("""CREATE TABLE captaincies (source_row_id TEXT, season INTEGER, club TEXT, player TEXT, role TEXT, source_period TEXT, source_notes TEXT, player_id INTEGER, match_status TEXT, candidate_count INTEGER, source_url TEXT)""")',
    `row = json.loads(${JSON.stringify(JSON.stringify(row))})`,
    'cur.execute("""INSERT INTO captaincies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",',
    `    (${JSON.stringify(CAPTAINCY_FIXTURE_RECORD_ID)}, row["season"], row["club"],`,
    `     ${JSON.stringify(CAPTAINCY_FIXTURE_NAME)}, "Captain", "fixture period",`,
    '     "fixture source notes", None, "unmatched", 0, "https://example.test/issue-085"))',
    'con.commit()',
    'con.close()',
  ].join('\n');
  const result = spawnSync(python, ['-c', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to build ISSUE-085 SQLite fixture: ${result.stderr}`);
  }
}

describe.skipIf(!canRunFixtureImporter)(
  'captaincies reload reconciles only wikipedia-owned rows (AFLDB-ISSUE-085)',
  () => {
    let wikipediaId = 0;
    let manualId = 0;
    let season = 0;
    let clubId = 0;
    let clubName = '';
    let ownedId = 0;
    let fixtureDirectory = '';
    let fixtureSqlite = '';

    async function readCaptaincy(id: number): Promise<CaptaincyRow | undefined> {
      const [row] = await sql<CaptaincyRow[]>`
        SELECT id, season, club_id AS "clubId", player_id AS "playerId",
               player_name_raw AS name, link_status_value::text AS status,
               role, period, notes, source_id AS "sourceId",
               source_record_id AS "recordId"
          FROM captaincies
         WHERE id = ${id}
      `;
      return row;
    }

    beforeAll(async () => {
      const sources = await sql<{ key: string; id: number }[]>`
        SELECT key, id FROM sources
         WHERE key IN ('wikipedia', 'manual_admin_edit')
      `;
      const byKey = new Map(sources.map((row) => [row.key, row.id]));
      wikipediaId = byKey.get('wikipedia') ?? 0;
      manualId = byKey.get('manual_admin_edit') ?? 0;
      expect(wikipediaId, 'wikipedia source must exist').toBeGreaterThan(0);
      expect(manualId, 'manual_admin_edit source must exist').toBeGreaterThan(0);

      const [reference] = await sql<{
        season: number; clubId: number; clubName: string;
      }[]>`
        SELECT s.year::int AS season, c.id AS "clubId", c.name AS "clubName"
          FROM clubs c
          JOIN seasons s
            ON (c.first_season IS NULL OR s.year >= c.first_season)
           AND (c.last_season IS NULL OR s.year <= c.last_season)
         WHERE c.slug = 'adelaide'
         ORDER BY s.year DESC
         LIMIT 1
      `;
      expect(reference, 'afldb_test needs the reference Adelaide club and one valid season')
        .toBeDefined();
      season = reference.season;
      clubId = reference.clubId;
      clubName = reference.clubName;

      fixtureDirectory = mkdtempSync(join(tmpdir(), 'afldb-issue085-'));
      fixtureSqlite = join(fixtureDirectory, 'captaincies.sqlite');
      buildCaptaincyFixtureDb(fixtureSqlite, { season, club: clubName });

      const [owned] = await sql<{ id: number }[]>`
        INSERT INTO captaincies
          (season, club_id, player_name_raw, link_status_value, role, period,
           notes, source_id, source_record_id)
        VALUES
          (${season}, ${clubId}, ${CAPTAINCY_FIXTURE_NAME}, 'unmatched',
           'Captain', 'stale stored period', 'stale stored notes',
           ${wikipediaId}, ${CAPTAINCY_FIXTURE_RECORD_ID})
        RETURNING id
      `;
      ownedId = owned.id;
    });

    afterAll(async () => {
      if (ownedId > 0) {
        await sql`DELETE FROM captaincies WHERE id = ${ownedId}`;
      }
      if (fixtureDirectory) {
        rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    });

    it('reconciles its own row, preserves a foreign row, and remains idempotent', async () => {
      const countBefore = await countRows('captaincies');
      const [foreign] = await sql<{ id: number }[]>`
        INSERT INTO captaincies
          (season, club_id, player_name_raw, link_status_value, role, period,
           notes, source_id, source_record_id)
        VALUES
          (${season}, ${clubId}, 'AFLDB-ISSUE-085 Foreign Captaincy',
           'unmatched', 'Captain', 'fixture period', 'foreign row unchanged',
           ${manualId}, 'issue-085:foreign-captaincy')
        RETURNING id
      `;

      try {
        const first = runImporter(['captaincies'], [], fixtureSqlite);
        expect(first.status, first.stdout + first.stderr).toBe(0);
        const expectedOwned: CaptaincyRow = {
          id: ownedId,
          season,
          clubId,
          playerId: null,
          name: CAPTAINCY_FIXTURE_NAME,
          status: 'unmatched',
          role: 'Captain',
          period: 'fixture period',
          notes: 'fixture source notes',
          sourceId: wikipediaId,
          recordId: CAPTAINCY_FIXTURE_RECORD_ID,
        };
        const expectedForeign: CaptaincyRow = {
          id: foreign.id,
          season,
          clubId,
          playerId: null,
          name: 'AFLDB-ISSUE-085 Foreign Captaincy',
          status: 'unmatched',
          role: 'Captain',
          period: 'fixture period',
          notes: 'foreign row unchanged',
          sourceId: manualId,
          recordId: 'issue-085:foreign-captaincy',
        };
        expect(await readCaptaincy(ownedId), 'owned row is refreshed under the same id')
          .toEqual(expectedOwned);
        expect(await readCaptaincy(foreign.id), 'foreign row is neither adopted nor mutated')
          .toEqual(expectedForeign);
        expect(await countRows('captaincies')).toBe(countBefore + 1);

        const second = runImporter(['captaincies'], [], fixtureSqlite);
        expect(second.status, second.stdout + second.stderr).toBe(0);
        expect(await readCaptaincy(ownedId)).toEqual(expectedOwned);
        expect(await readCaptaincy(foreign.id)).toEqual(expectedForeign);
        expect(await countRows('captaincies')).toBe(countBefore + 1);
      } finally {
        await sql`DELETE FROM captaincies WHERE id = ${foreign.id}`;
      }
    }, 300_000);

    it('refuses a foreign-owned row occupying an incoming natural key', async () => {
      await sql`UPDATE captaincies SET source_id = ${manualId} WHERE id = ${ownedId}`;
      try {
        const before = await countRows('captaincies');
        const beforeRow = await readCaptaincy(ownedId);
        const run = runImporter(['captaincies'], [], fixtureSqlite);
        expect(run.status, 'the reload must fail closed').toBe(1);
        expect(run.stdout).toContain('natural key(s)');
        expect(run.stdout).toContain('does not own');
        expect(run.stdout).toContain(`id=${ownedId}`);
        expect(await countRows('captaincies')).toBe(before);
        expect(await readCaptaincy(ownedId), 'the colliding foreign row is untouched')
          .toEqual(beforeRow);
      } finally {
        await sql`UPDATE captaincies SET source_id = ${wikipediaId} WHERE id = ${ownedId}`;
      }
    });
  },
);
