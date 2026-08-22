import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  confirmUnlinked,
  listConfirmedUnlinked,
  resolveLink,
} from '@/db/queries/player-links';

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
 * Every write here lands in afldb_test: tests/setup.ts redirects
 * DATABASE_URL, and the two role URLs the product code opens for itself are
 * redirected below.
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const FIXTURE_EMAIL = 'issue-044-reload@example.test';
const NOTE = 'AFLDB-ISSUE-044 reload survival';

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

const canRunImporter = Boolean(legacySqlite)
  && existsSync(legacySqlite as string)
  && hasPsycopg();

function runImporter(groups: string[], extra: string[] = []) {
  return spawnSync(
    python,
    ['tools/migration/import_awards.py', '--groups', ...groups, ...extra],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        AFLDB_IMPORT_DATABASE_URL: process.env.AFLDB_TEST_DATABASE_URL,
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

describe.skipIf(!canRunImporter)(
  'honours reloads preserve manual player links (AFLDB-ISSUE-044)',
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
      await sql.end();
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
        previousStatus: row.status,
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
