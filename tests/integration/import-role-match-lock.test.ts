/**
 * AFLDB-ISSUE-274, D-274-2. RUNTIME LOCK-PERMISSION EVIDENCE ONLY.
 *
 * What this proves: the real `afldb_import` role, connected to `afldb_test`, may take
 * `SELECT ... FOR NO KEY UPDATE` on exactly one existing, test-owned `matches` row inside a
 * transaction, and the row is free again after the rollback.
 *
 * What it does NOT prove: that the settle applier works under `afldb_import` (no applier code
 * runs here), that any other restricted-role suite passes, or anything about the lock ordering
 * or the concurrency behaviour of the fix (the other ISSUE-274 cases own those).
 *
 * SELECTION. The test runs only when BOTH are set, and it never falls back to another
 * credential:
 *   AFLDB_ISSUE274_IMPORT_LOCK=1             explicit selection
 *   AFLDB_ISSUE274_IMPORT_LOCK_DSN=<url>     a connection as `afldb_import` to `afldb_test`
 * Selected without the DSN, or with a DSN for another role, database or server, it FAILS with
 * a sentence. Not selected, the whole describe is SKIPPED (a skip is not a pass). The DSN has
 * its own variable on purpose: setting `AFLDB_TEST_IMPORT_DATABASE_URL` would also enable every
 * other restricted-role suite, and this test must not.
 *
 * WRITES (all committed by the OWNER connection, never by `afldb_import`):
 *   - one `seasons` row for 2093, only if absent, removed again only if this run's INSERT reported
 *     creating it, it carries the run's marker, and nothing else then references the season;
 *   - one `matches` row on the key `2093|issue122-274-importlock-1`, removed by its own id.
 * Both rows carry a unique per-run MARKER in `notes`, and EVERY DELETE requires it. A row on the
 * key without the marker (another session won a race for the key) is preserved and reported.
 * `afldb_import` itself writes nothing (it consumes a transaction id and may dirty a heap page
 * with the tuple lock; no logical change). The key sits under the ISSUE-122 prefix so the
 * existing census selectors see any residue.
 *
 * SAFETY. Every connection has a connect timeout, statement timeout and lock timeout; the
 * competing probe uses NOWAIT so it can never wait; the whole case has a hard timeout. The
 * fixture is removed only after the `afldb_import` session is confirmed gone; if that cannot
 * be confirmed nothing is removed and the failure names the fixture key and the session tag.
 * A row already on the fixture key is refused, never adopted. A season INSERT whose reply is
 * lost is reported as possible residue and NOT removed. The primary failure, every cleanup
 * problem and every connection-close failure are all in the reported error
 * (`import-role-lock-fixture.ts`, checked DB-free by `tests/import-role-lock-fixture.test.ts`).
 */
import { verifyIsolatedIntegrationDatabase } from './guard';

import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { finishImportRoleLockCase, type FixtureState, type Observation } from './import-role-lock-fixture';

const SELECTED = process.env.AFLDB_ISSUE274_IMPORT_LOCK === '1';

const SEASON = 2093;
const MATCH_KEY = `${SEASON}|issue122-274-importlock-1`;
const STATEMENT_TIMEOUT_MS = 15_000;
const LOCK_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_S = 10;
const CONFIRM_GONE_WINDOW_MS = 4_000;
const CASE_TIMEOUT_MS = 90_000;

type Target = { user: string; database: string; endpoint: string };

function targetOf(name: string, dsn: string): Target {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`${name} is not a valid connection URL.`);
  }
  return {
    user: decodeURIComponent(url.username),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    endpoint: `${url.hostname.toLowerCase()}:${url.port || '5432'}`,
  };
}

/** Refuses, before any connection and without printing a DSN, anything but afldb_import on afldb_test. */
function requireRoleDsn(ownerDsn: string): string {
  const roleDsn = process.env.AFLDB_ISSUE274_IMPORT_LOCK_DSN;
  if (!roleDsn) {
    throw new Error(
      'AFLDB_ISSUE274_IMPORT_LOCK=1 selects the afldb_import lock test, but '
      + 'AFLDB_ISSUE274_IMPORT_LOCK_DSN is not set. It needs a connection as the real afldb_import '
      + 'role to afldb_test and will not fall back to the owner connection, '
      + 'AFLDB_TEST_IMPORT_DATABASE_URL or any other role.',
    );
  }
  const role = targetOf('AFLDB_ISSUE274_IMPORT_LOCK_DSN', roleDsn);
  const owner = targetOf('AFLDB_TEST_DATABASE_URL', ownerDsn);
  if (role.user !== 'afldb_import') {
    throw new Error(`AFLDB_ISSUE274_IMPORT_LOCK_DSN must name the role afldb_import; it names '${role.user}'.`);
  }
  const isolated = process.env.AFLDB_V2_ISOLATED_PG === '1';
  if (role.database !== owner.database
      || (isolated ? !/^afldb_v2_[a-z0-9_]+_test$/.test(owner.database) : owner.database !== 'afldb_test')) {
    throw new Error(
      'Both AFLDB_ISSUE274_IMPORT_LOCK_DSN and AFLDB_TEST_DATABASE_URL must name the database afldb_test '
      + `(role DSN: '${role.database}', owner DSN: '${owner.database}').`,
    );
  }
  if (role.endpoint !== owner.endpoint) {
    throw new Error(
      'AFLDB_ISSUE274_IMPORT_LOCK_DSN must reach the same server as AFLDB_TEST_DATABASE_URL '
      + `(role: ${role.endpoint}, owner: ${owner.endpoint}).`,
    );
  }
  return roleDsn;
}

type Identity = { database: string; currentUser: string; sessionUser: string; superuser: boolean };

class RollbackAfterProbe extends Error {}

describe.runIf(SELECTED)('AFLDB-ISSUE-274 D-274-2 — runtime lock permission of afldb_import on afldb_test', () => {
  it('afldb_import takes FOR NO KEY UPDATE on exactly one test-owned matches row, which is free again after the rollback', async () => {
    const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL as string;
    const roleDsn = requireRoleDsn(ownerDsn);
    const tag = `afldb-i274-importlock-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    // Unique to this run; written to `notes` of every row this run creates and required by every DELETE.
    const marker = `ISSUE-274 import-role lock fixture ${tag}`;
    const options = (app: string) => ({
      max: 1,
      onnotice: () => {},
      connect_timeout: CONNECT_TIMEOUT_S,
      connection: {
        application_name: app,
        statement_timeout: STATEMENT_TIMEOUT_MS,
        lock_timeout: LOCK_TIMEOUT_MS,
        idle_in_transaction_session_timeout: 30_000,
      },
    });
    const owner = postgres(ownerDsn, options(`${tag}-owner`));
    const role = postgres(roleDsn, options(`${tag}-import`));

    // What this run may have written. Each flag is set BEFORE the statement that could write, so a
    // lost reply can never look like "nothing was written".
    const state: FixtureState = { seasonInsert: 'not-sent', matchInsertSent: false, matchId: null, rolePid: null };
    let failed = false;
    let failure: unknown;
    try {
      // 1. Both connections are who we think they are. The role DSN was checked before connecting;
      //    this checks what the SERVER says.
      const [ownerIdentity] = await owner<Identity[]>`
        SELECT current_database() AS database, current_user AS "currentUser", session_user AS "sessionUser",
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser
      `;
      const database = process.env.AFLDB_V2_ISOLATED_PG === '1'
        ? await verifyIsolatedIntegrationDatabase(owner) : 'afldb_test';
      if (process.env.AFLDB_V2_ISOLATED_PG === '1') await verifyIsolatedIntegrationDatabase(role);
      expect(ownerIdentity).toMatchObject({ database, currentUser: 'afldb_owner', sessionUser: 'afldb_owner' });
      const [roleIdentity] = await role<Identity[]>`
        SELECT current_database() AS database, current_user AS "currentUser", session_user AS "sessionUser",
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser
      `;
      expect(roleIdentity).toEqual({
        database, currentUser: 'afldb_import', sessionUser: 'afldb_import', superuser: false,
      });
      // The role's backend pid is how its end is confirmed later: `pid` is visible in pg_stat_activity
      // to every role, whereas `application_name` of ANOTHER role's session is hidden unless the viewer
      // has pg_read_all_stats, which would make an application_name poll report "gone" vacuously.
      const [pidRow] = await role<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      state.rolePid = pidRow.pid;
      const [visible] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ${pidRow.pid}
      `;
      expect(
        visible.n,
        'the owner connection can see the live afldb_import session in pg_stat_activity (positive control for the later "gone" check)',
      ).toBe(1);

      // 2. The test-owned fixture: refuse an unknown row on the key, then one season (if absent) and one match.
      const existing = await owner<{ id: number }[]>`SELECT id::int AS id FROM matches WHERE match_key = ${MATCH_KEY}`;
      if (existing.length > 0) {
        throw new Error(
          `Refusing to run: a matches row already exists on the fixture key ${MATCH_KEY} (id ${existing[0].id}). `
          + 'Remove it deliberately; this test never adopts or deletes a row it did not create.',
        );
      }
      const clubs = await owner<{ id: number }[]>`
        SELECT id::int AS id FROM clubs WHERE legacy_club_hist IS NOT NULL ORDER BY id LIMIT 2
      `;
      if (clubs.length < 2) throw new Error('afldb_test has fewer than two clubs with legacy_club_hist.');
      state.seasonInsert = 'unconfirmed'; // until the reply arrives, a throw here leaves it unconfirmed
      const season = await owner<{ year: number }[]>`
        INSERT INTO seasons (year, league, status, notes)
        VALUES (${SEASON}, 'AFL', 'in_progress'::season_status, ${marker})
        ON CONFLICT (year) DO NOTHING
        RETURNING year::int AS year
      `;
      state.seasonInsert = season.length === 1 ? 'created' : 'pre-existing';
      state.matchInsertSent = true;
      const [fixture] = await owner<{ id: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_type, round_number, is_final, match_date,
          venue_raw, home_club_id, away_club_id, home_score, away_score, result,
          winner_club_id, margin, attendance_status, notes
        ) VALUES (
          ${MATCH_KEY}, ${SEASON}::smallint, '9002', 'home_and_away', 9002, false,
          ${`${SEASON}-08-01`}::date, 'ISSUE-274 import-role lock fixture', ${clubs[0].id}, ${clubs[1].id}, 100, 80,
          'home_win', ${clubs[0].id}, 20, 'not_collected', ${marker}
        )
        RETURNING id::int AS id
      `;
      const fixtureId = fixture.id;
      state.matchId = fixtureId;
      const [count] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM matches WHERE match_key = ${MATCH_KEY}
      `;
      expect(count.n, 'exactly one test-owned fixture row').toBe(1);

      // 3. The probe. afldb_import selects the one row FOR NO KEY UPDATE inside a transaction.
      //    While it is held, a second session (the owner) must be REFUSED a conflicting FOR UPDATE
      //    at once (NOWAIT: it can never wait), which shows the role really holds a row lock rather
      //    than merely running a statement that matched nothing. Then the transaction is rolled back.
      let seen: { ids: number[]; inside: Identity; competingSqlstate: string | null } | null = null;
      try {
        await role.begin(async (tx) => {
          const [inside] = await tx<Identity[]>`
            SELECT current_database() AS database, current_user AS "currentUser", session_user AS "sessionUser",
                   (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser
          `;
          const rows = await tx<{ id: number }[]>`
            SELECT id::int AS id FROM matches WHERE match_key = ${MATCH_KEY} FOR NO KEY UPDATE
          `;
          let competingSqlstate: string | null = null;
          try {
            await owner`SELECT id FROM matches WHERE id = ${fixtureId} FOR UPDATE NOWAIT`;
          } catch (error) {
            competingSqlstate = typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code?: unknown }).code) : 'unknown';
          }
          seen = { ids: rows.map((row) => row.id), inside, competingSqlstate };
          throw new RollbackAfterProbe('rolled back on purpose');
        });
      } catch (error) {
        if (!(error instanceof RollbackAfterProbe)) throw error;
      }
      expect(seen, 'the probe ran to its rollback').not.toBeNull();
      const observed = seen as unknown as { ids: number[]; inside: Identity; competingSqlstate: string | null };
      expect(observed.inside).toEqual({
        database, currentUser: 'afldb_import', sessionUser: 'afldb_import', superuser: false,
      });
      expect(observed.ids, 'exactly the one test-owned row was locked').toEqual([fixtureId]);
      expect(observed.competingSqlstate, 'a conflicting FOR UPDATE NOWAIT was refused while the role held the lock')
        .toBe('55P03');

      // 4. Released by the rollback: the same competing statement now succeeds.
      const free = await owner<{ id: number }[]>`SELECT id::int AS id FROM matches WHERE id = ${fixtureId} FOR UPDATE NOWAIT`;
      expect(free.map((row) => row.id), 'the lock is gone after the rollback').toEqual([fixtureId]);
    } catch (error) {
      failed = true;
      failure = error;
    }

    // 5. Closing sequence (import-role-lock-fixture.ts; checked DB-free). Cleanup only after the role
    //    session has ended and the server confirms it is gone; every DELETE requires this run's marker;
    //    the primary failure and every cleanup or close problem end up in the reported error.
    await finishImportRoleLockCase(
      state,
      { matchKey: MATCH_KEY, season: SEASON, marker, roleApplicationName: `${tag}-import` },
      {
        closeRole: () => role.end({ timeout: 5 }),
        roleSessionGone: async (pid) => {
          const deadline = Date.now() + CONFIRM_GONE_WINDOW_MS;
          for (;;) {
            const [row] = await owner<{ n: number }[]>`
              SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ${pid}
            `;
            if (row.n === 0) return true;
            if (Date.now() > deadline) return false;
            await new Promise((resolve) => { setTimeout(resolve, 100); });
          }
        },
        deleteOwnedMatch: async (matchId) => {
          // Removed by its own id when the INSERT reported one. If the INSERT's reply was lost the id
          // is unknown, and the key is the handle; either way the run's marker is required, so a row
          // that another session put on the key is never matched.
          if (matchId !== null) {
            await owner`DELETE FROM matches WHERE id = ${matchId} AND match_key = ${MATCH_KEY} AND notes = ${marker}`;
          } else {
            await owner`DELETE FROM matches WHERE match_key = ${MATCH_KEY} AND notes = ${marker}`;
          }
        },
        deleteOwnedSeason: async () => {
          await owner`
            DELETE FROM seasons
             WHERE year = ${SEASON} AND notes = ${marker}
               AND NOT EXISTS (SELECT 1 FROM matches WHERE season = ${SEASON})
          `;
        },
        observe: async () => {
          const [row] = await owner<Observation[]>`
            SELECT (SELECT count(*) FROM matches WHERE match_key = ${MATCH_KEY} AND notes = ${marker})::int AS "ownedMatches",
                   (SELECT count(*) FROM matches WHERE match_key = ${MATCH_KEY} AND notes IS DISTINCT FROM ${marker})::int AS "foreignMatches",
                   (SELECT count(*) FROM seasons WHERE year = ${SEASON} AND notes = ${marker})::int AS "ownedSeasons"
          `;
          return row;
        },
        closeOwner: () => owner.end({ timeout: 5 }),
      },
      failed ? { failed: true, error: failure } : { failed: false },
    );
  }, CASE_TIMEOUT_MS);
});
