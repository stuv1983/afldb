/**
 * AFLDB-ISSUE-167 Stage 2 — migration 102 against a real PostgreSQL.
 *
 * These are the claims that can be proved nowhere else: that the lifecycle
 * columns really exist with the defaults every existing row silently inherits;
 * that the two CHECKs really REFUSE rather than merely being present in the
 * migration text; that both live allowlists really admit both tables while
 * still refusing every settle target; and that the grants the future admin
 * surface depends on are held by the REAL restricted roles rather than by the
 * owner the suite happens to connect as.
 *
 * THE OWNER-ROLE TRAP, which this file exists partly to avoid: AFLDB_TEST_DATABASE_URL
 * authenticates as `afldb_owner`, so a privilege assertion made through it
 * proves nothing about `afldb_app` or `afldb_import`. AFLDB-ISSUE-165 recorded
 * exactly this — owner-role tests hid migration 078's COLUMN-level
 * `data_overrides` grants until the restricted importer harness was wired in.
 * So every grant below is asked of the CATALOGUE for a named role, and the
 * importer's is additionally EXERCISED over a real `afldb_import` connection.
 *
 * FIXTURES: the two rows this file inserts are removed in `afterAll`, are
 * marked `AFLDB-ISSUE-167-TEST`, and are written against a fixture source of
 * this suite's own making. No real achievement or after-siren row is written to.
 */
import './guard';

import { createImportRoleParityHarness } from './import-role-parity';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SPECIAL_RECORD_TABLES } from '@/lib/special-records/identity';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;
const admin = postgres(testDbUrl, { max: 1, onnotice: () => {} });

const harness = createImportRoleParityHarness(
  testDbUrl,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);

const MARKER = 'AFLDB-ISSUE-167-TEST';
const FIXTURE_SOURCE_KEY = 'issue_167_fixture_source';

const LIFECYCLE_COLUMNS = ['status', 'status_reason', 'updated_at'] as const;

let fixtureSourceId: number;
let adminUserId: number;
let achievementId: number;
let kickId: number;

beforeAll(async () => {
  const [source] = await admin<{ id: number }[]>`
    INSERT INTO sources (key, name, kind, url)
    VALUES (${FIXTURE_SOURCE_KEY}, ${`${MARKER} fixture source`}, 'manual',
            'https://example.invalid/167')
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  fixtureSourceId = source.id;

  const [operator] = await admin<{ id: number }[]>`SELECT min(id)::int AS id FROM auth_users`;
  adminUserId = operator.id;

  const [achievement] = await admin<{ id: number }[]>`
    INSERT INTO player_achievements (
      achievement_type, player_name_raw, player_name_clean, link_status_value,
      candidate_count, club_name_raw, season, round_raw,
      source_id, source_record_id, notes
    ) VALUES (
      'first_kick_goal', ${MARKER}, ${MARKER}, 'unmatched', 0, ${MARKER}, 1897, ${MARKER},
      ${fixtureSourceId}, ${'fkg-i167-fixture'}, ${MARKER}
    ) RETURNING id`;
  achievementId = achievement.id;

  // kick_effect 'none' with kicker_result 'loss' satisfies after_siren_kicks_effect_ck's
  // third branch; premiership_season false with a NULL match_id satisfies _match_ck.
  const [kick] = await admin<{ id: number }[]>`
    INSERT INTO after_siren_kicks (
      player_name_raw, player_name_clean, link_status_value, candidate_count,
      club_name_raw, opponent_name_raw, competition, premiership_season,
      season, round_raw, kick_scored, kick_effect, kicker_result,
      kicker_score_raw, opponent_score_raw, kicker_points, opponent_points,
      source_id, source_record_id, notes
    ) VALUES (
      ${MARKER}, ${MARKER}, 'unmatched', 0,
      ${MARKER}, ${MARKER}, ${MARKER}, false,
      1897, ${MARKER}, 'none', 'none', 'loss',
      '0.0 (0)', '0.0 (0)', 0, 0,
      ${fixtureSourceId}, ${'asr-i167-fixture'}, ${MARKER}
    ) RETURNING id`;
  kickId = kick.id;
});

afterAll(async () => {
  await admin`DELETE FROM player_achievements WHERE source_id = ${fixtureSourceId}`;
  await admin`DELETE FROM after_siren_kicks WHERE source_id = ${fixtureSourceId}`;
  await admin`DELETE FROM sources WHERE key = ${FIXTURE_SOURCE_KEY}`;
  await admin.end({ timeout: 5 });
});

describe('migration 102 lifecycle columns', () => {
  it('adds status, status_reason and updated_at to both tables, and no created_at', async () => {
    const rows = await admin<{
      table: string; column: string; type: string; nullable: string; def: string | null;
    }[]>`
      SELECT table_name AS "table", column_name AS "column", data_type AS type,
             is_nullable AS nullable, column_default AS def
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY(${[...SPECIAL_RECORD_TABLES]})
         AND column_name = ANY(${[...LIFECYCLE_COLUMNS, 'created_at']})
       ORDER BY 1, 2`;

    // AFLDB-ISSUE-165 D-8, carried forward: nothing reads a creation instant,
    // and the data_edits row already carries when and by whom.
    expect(rows.filter((r) => r.column === 'created_at')).toEqual([]);

    for (const table of SPECIAL_RECORD_TABLES) {
      const byName = new Map(rows.filter((r) => r.table === table).map((r) => [r.column, r]));
      expect([...byName.keys()].sort(), table).toEqual([...LIFECYCLE_COLUMNS].sort());

      expect(byName.get('status')!.type, table).toBe('text');
      expect(byName.get('status')!.nullable, table).toBe('NO');
      expect(byName.get('status')!.def, table).toContain("'active'");

      // The reason is nullable at the column level and mandatory only for a
      // void — the CHECK carries that, not a NOT NULL.
      expect(byName.get('status_reason')!.nullable, table).toBe('YES');

      expect(byName.get('updated_at')!.type, table).toBe('timestamp with time zone');
      expect(byName.get('updated_at')!.nullable, table).toBe('NO');
      expect(byName.get('updated_at')!.def, table).toContain('now()');
    }
  });

  it('defaults every pre-existing row to active, so no public projection changes yet', async () => {
    const rows = await admin<{ table: string; total: number; active: number }[]>`
      SELECT 'player_achievements' AS "table", count(*)::int AS total,
             count(*) FILTER (WHERE status = 'active')::int AS active
        FROM player_achievements
      UNION ALL
      SELECT 'after_siren_kicks', count(*)::int,
             count(*) FILTER (WHERE status = 'active')::int
        FROM after_siren_kicks
       ORDER BY 1`;
    for (const row of rows) {
      expect(row.total, row.table).toBeGreaterThan(0);
      expect(row.active, row.table).toBe(row.total);
    }
  });

  it('names both CHECKs and gives them the two-state vocabulary', async () => {
    const required = [...SPECIAL_RECORD_TABLES]
      .flatMap((t) => [`${t}_status_ck`, `${t}_void_reason_ck`]);
    const checks = await admin<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid IN ('player_achievements'::regclass, 'after_siren_kicks'::regclass)
         AND contype = 'c'
         AND conname = ANY(${required})
       ORDER BY conname`;
    expect(checks.map((c) => c.name)).toEqual([...required].sort());

    const byName = new Map(checks.map((c) => [c.name, c.def] as const));
    for (const table of SPECIAL_RECORD_TABLES) {
      const status = byName.get(`${table}_status_ck`)!;
      expect(status, table).toContain("'active'");
      expect(status, table).toContain("'void'");
      // Two states, not three: an event does not CEASE the way an office does.
      expect(status, table).not.toContain("'ended'");

      const reason = byName.get(`${table}_void_reason_ck`)!;
      expect(reason, table).toContain('status_reason');
      expect(reason, table).toContain("'void'");
    }
  });

  it('REFUSES a void with no reason, and refuses an unknown state', async () => {
    for (const [table, id] of [
      ['player_achievements', () => achievementId],
      ['after_siren_kicks', () => kickId],
    ] as const) {
      await expect(
        admin`UPDATE ${admin(table)} SET status = 'void' WHERE id = ${id()}`,
      ).rejects.toThrow(new RegExp(`${table}_void_reason_ck`));

      await expect(
        admin`UPDATE ${admin(table)} SET status = 'retired' WHERE id = ${id()}`,
      ).rejects.toThrow(new RegExp(`${table}_status_ck`));

      // And the pairing it must ACCEPT, or suppression is unexpressible.
      await admin`
        UPDATE ${admin(table)}
           SET status = 'void', status_reason = ${`${MARKER} reason`}
         WHERE id = ${id()}`;
      const [row] = await admin<{ status: string; reason: string }[]>`
        SELECT status, status_reason AS reason FROM ${admin(table)} WHERE id = ${id()}`;
      expect(row.status, table).toBe('void');
      expect(row.reason, table).toBe(`${MARKER} reason`);

      await admin`
        UPDATE ${admin(table)} SET status = 'active', status_reason = NULL WHERE id = ${id()}`;
    }
  });

  it('leaves the source-uniqueness keys exactly as 053 and 089 wrote them', async () => {
    // Unlike migration 101, no ACTIVE-ROW-ONLY uniqueness is introduced: the
    // only uniqueness here IS the source key, and a manual replacement mints a
    // new one rather than reusing a voided row's.
    const rows = await admin<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conname IN ('player_achievements_source_uq', 'after_siren_kicks_source_uq')
       ORDER BY conname`;
    expect(rows.map((r) => r.name))
      .toEqual(['after_siren_kicks_source_uq', 'player_achievements_source_uq']);
    for (const row of rows) {
      expect(row.def, row.name).toContain('NULLS NOT DISTINCT');
      expect(row.def, row.name).toContain('source_record_id');
      expect(row.def, row.name).not.toContain('status');
    }
  });

  it('adds no index, speculative or otherwise', async () => {
    const rows = await admin<{ name: string }[]>`
      SELECT indexname AS name FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = ANY(${[...SPECIAL_RECORD_TABLES]})
         AND indexdef ILIKE '%status%'
       ORDER BY 1`;
    expect(rows).toEqual([]);
  });

  it('does not touch after_siren_kicks.cited, which is evidence and not lifecycle', async () => {
    // Gate G-3. `cited` is false when the SOURCE carried no reference for a kick
    // that happened (089); 'void' says the ROW should never have existed.
    // Conflating them would suppress every uncited kick from the public record.
    const [cited] = await admin<{ nullable: string; def: string | null }[]>`
      SELECT is_nullable AS nullable, column_default AS def
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'after_siren_kicks'
         AND column_name = 'cited'`;
    expect(cited.nullable).toBe('NO');
    expect(cited.def).toContain('true');

    const [counts] = await admin<{ uncited: number; uncitedVoid: number }[]>`
      SELECT count(*) FILTER (WHERE NOT cited)::int AS uncited,
             count(*) FILTER (WHERE NOT cited AND status = 'void')::int AS "uncitedVoid"
        FROM after_siren_kicks`;
    // Whatever the uncited count is, migration 102 voided none of them.
    expect(counts.uncitedVoid).toBe(0);
  });
});

describe('migration 102 allowlist widenings', () => {
  it('admits both tables as data_overrides entity types, and no settle target', async () => {
    const [check] = await admin<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'data_overrides_entity_type_check'`;
    for (const entity of SPECIAL_RECORD_TABLES) expect(check.def).toContain(entity);
    // Every literal migration 101 left is retained verbatim.
    for (const kept of ['players', 'matches', 'draft_picks', 'coaches', 'match_coaches',
      'season_list_members', 'fixtures', 'club_leadership', 'award_winners', 'hall_of_fame',
      'honour_team_members']) {
      expect(check.def, kept).toContain(`'${kept}'`);
    }
    // manual-authority.ts proves from this constraint that an override for a
    // settle target is UNREPRESENTABLE. Admitting one degrades the nightly
    // settle from apply to propose-only.
    for (const settle of ['match_period_scores', 'player_match_stats', 'brownlow_round_votes']) {
      expect(check.def).not.toContain(settle);
    }
  });

  it('admits both tables as data_edits table names, retaining every existing literal', async () => {
    const [check] = await admin<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'data_edits_table_name_check'`;
    for (const table of SPECIAL_RECORD_TABLES) expect(check.def).toContain(table);
    for (const kept of ['players', 'matches', 'draft_picks', 'award_winners', 'hall_of_fame',
      'honour_team_members', 'brownlow_vote_entry_state', 'brownlow_season_authority',
      'coaches', 'fixtures', 'club_leadership']) {
      expect(check.def, kept).toContain(`'${kept}'`);
    }
    // Absent by design, and this migration does not quietly change that:
    // match_coaches has a composite key and season_list_members is deletable,
    // so both are audited against another entity.
    for (const absent of ['match_coaches', 'season_list_members']) {
      expect(check.def, absent).not.toContain(`'${absent}'`);
    }
  });

  it('actually accepts an override and an audit row for both tables', async () => {
    // The CHECK definition is not the contract; what the database accepts is.
    // Rolled back, so the suite writes neither ledger.
    await expect(admin.begin(async (tx) => {
      for (const table of SPECIAL_RECORD_TABLES) {
        await tx`
          INSERT INTO data_overrides (entity_type, entity_key, field_group,
                                      override_values, admin_user_id)
          VALUES (${table}, ${`${FIXTURE_SOURCE_KEY}:i167`}, 'lifecycle',
                  ${tx.json({ status: 'void' })}, ${adminUserId})`;
        await tx`
          INSERT INTO data_edits (table_name, row_id, field_group,
                                  old_values, new_values, admin_user_id)
          VALUES (${table}, ${achievementId}, 'lifecycle',
                  ${tx.json({ status: 'active' })}, ${tx.json({ status: 'void' })},
                  ${adminUserId})`;
      }
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
  });
});

describe('the privilege contract, asked of the real roles', () => {
  /*
   * AFLDB-ISSUE-167 decision D-5 (operator, 2026-09-13), which SUPERSEDES §6.5.
   *
   * §6.5 had assumed the admin surface reads these tables on the AUTH pool and
   * therefore required `afldb_auth` SELECT in privileges.sql. Current source
   * contradicts that: every admin football-data surface reads on the APP pool
   * and writes on a short-lived `afldb_import` transaction
   * (src/db/queries/admin-awards.ts:274, admin-club-leadership.ts:336), and
   * src/db/queries/player-links.ts:86-88 states it for this exact family of
   * tables — "Reads run on the public client". `authClient.ts` holds afldb_auth
   * to the operational tables precisely so a compromise of the auth path cannot
   * touch statistics. D-5 therefore leaves privileges.sql unchanged: the grants
   * would widen a deliberate boundary with no caller.
   *
   * These five assertions are the decision's guard rail, retained by explicit
   * operator instruction: afldb_app can SELECT the lifecycle columns; afldb_app
   * cannot mutate them; afldb_import holds the intended import/write
   * privileges; afldb_auth has NO access; and privileges.sql's afldb_auth
   * specification does not name either table. The last one is what stops the
   * decision drifting on one side only — widen the spec array and this test
   * fails; weaken this test and the live grants still contradict it.
   */
  it('gives afldb_app SELECT on both tables, including the new columns', async () => {
    const rows = await admin<{ table: string; column: string; readable: boolean }[]>`
      SELECT t.name AS "table", c.name AS "column",
             has_column_privilege('afldb_app', t.name, c.name, 'SELECT') AS readable
        FROM unnest(${[...SPECIAL_RECORD_TABLES]}::text[]) AS t(name)
       CROSS JOIN unnest(${[...LIFECYCLE_COLUMNS]}::text[]) AS c(name)
       ORDER BY 1, 2`;
    expect(rows.filter((r) => !r.readable)).toEqual([]);
  });

  it('gives afldb_app no write, so the public role still cannot void a record', async () => {
    const rows = await admin<{ table: string; privilege: string }[]>`
      SELECT t.name AS "table", p.privilege
        FROM unnest(${[...SPECIAL_RECORD_TABLES]}::text[]) AS t(name)
       CROSS JOIN LATERAL (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
       WHERE has_table_privilege('afldb_app', t.name, p.privilege)
       ORDER BY 1, 2`;
    expect(rows).toEqual([]);
  });

  it('leaves afldb_auth without either table, which is the decision and not an oversight', async () => {
    const rows = await admin<{ table: string; privilege: string }[]>`
      SELECT t.name AS "table", p.privilege
        FROM unnest(${[...SPECIAL_RECORD_TABLES]}::text[]) AS t(name)
       CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
       WHERE has_table_privilege('afldb_auth', t.name, p.privilege)
       ORDER BY 1, 2`;
    expect(rows).toEqual([]);

    // And privileges.sql's afldb_auth spec does not name them either, which is
    // what makes the subtractive sweep's revoke correct rather than accidental.
    // If the operator decides §21.6 the other way, this assertion is the one that
    // inverts, so the decision cannot be changed silently on one side only.
    const reconciler = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..',
        'tools', 'maintenance', 'privileges.sql'),
      'utf8',
    );
    const authSection = reconciler.slice(
      reconciler.indexOf('afldb_auth — the operational tables'),
      reconciler.indexOf('afldb_auth: grants applied on'),
    );
    expect(authSection.length).toBeGreaterThan(0);
    for (const table of SPECIAL_RECORD_TABLES) {
      expect(authSection, table).not.toContain(`'${table}'`);
    }
  });

  it('keeps afldb_import write on both tables, new columns included', async () => {
    // grant_import_write() is table-level, so the three new columns are covered
    // without a further grant. This asserts that rather than assuming it.
    const rows = await admin<{ table: string; column: string; privilege: string; held: boolean }[]>`
      SELECT t.name AS "table", c.name AS "column", p.privilege,
             has_column_privilege('afldb_import', t.name, c.name, p.privilege) AS held
        FROM unnest(${[...SPECIAL_RECORD_TABLES]}::text[]) AS t(name)
       CROSS JOIN unnest(${[...LIFECYCLE_COLUMNS]}::text[]) AS c(name)
       CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(privilege)
       ORDER BY 1, 2, 3`;
    expect(rows.filter((r) => !r.held)).toEqual([]);
  });

  it.runIf(harness.isConfigured)(
    'lets the REAL afldb_import connection read and write the lifecycle columns',
    async () => {
      // The owner-role trap, closed: this is an actual afldb_import session, not
      // a has_table_privilege() answer given by afldb_owner.
      await harness.validate();
      const restricted = harness.connect();
      try {
        const [who] = await restricted<{ role: string }[]>`SELECT current_user AS role`;
        expect(who.role).toBe('afldb_import');

        for (const table of SPECIAL_RECORD_TABLES) {
          const [row] = await restricted<{ n: number }[]>`
            SELECT count(*)::int AS n FROM ${restricted(table)} WHERE status = 'active'`;
          expect(row.n, table).toBeGreaterThan(0);
        }

        // The replay adapters of Stage 4 will need this write. Rolled back.
        await expect(restricted.begin(async (tx) => {
          await tx`
            UPDATE player_achievements
               SET status = 'void', status_reason = ${`${MARKER} restricted`}
             WHERE id = ${achievementId}`;
          throw new Error('rollback');
        })).rejects.toThrow('rollback');

        const [after] = await admin<{ status: string }[]>`
          SELECT status FROM player_achievements WHERE id = ${achievementId}`;
        expect(after.status).toBe('active');
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );

  it.skipIf(harness.isConfigured)('reports the restricted importer validation was skipped', () => {
    expect(harness.skipMessage).toContain('AFLDB_TEST_IMPORT_DATABASE_URL');
  });
});
