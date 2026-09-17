/**
 * Brownlow administration against a real PostgreSQL (AFLDB-ISSUE-155 Phase C1,
 * §27.27). Everything here needs a database and can be proved nowhere else:
 * that migration 094's objects and its backfill are really there, that the
 * writer really claims and demotes rather than deleting, that the revision and
 * fingerprint compare-and-sets really match, that the required audit row and
 * the facts really share one transaction, that a publication really re-derives
 * the season totals and the career totals with them, and that two Super Admins
 * acting at once really serialise.
 *
 * The pure half — which selections are legal, which transitions exist, how a
 * season row is derived — is tests/brownlow-entry.test.ts, which needs no
 * database at all. Read them together; nothing is asserted twice.
 *
 * ORDER IS LOAD-BEARING in the `main season` block, and deliberately so. A
 * season is administered as a narrative — draft, finalise, correct, void the
 * one nobody polled, publish, correct again — and the interesting failures are
 * the ones that depend on what came before. Each test says what state it
 * expects and asserts it, so a reordering fails loudly rather than silently
 * testing something else.
 *
 * FIXTURES: tests/integration/brownlow-fixture.ts, three reserved seasons above
 * every real one. No real Brownlow row is read as a subject or written at all.
 */
import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  correctBrownlowMatch,
  finaliseBrownlowMatch,
  getBrownlowMatchEditorModel,
  getBrownlowRound,
  getBrownlowSeasonOverview,
  listBrownlowSeasons,
  publishBrownlowSeason,
  saveDraftBrownlowMatch,
  voidBrownlowMatch,
} from '@/db/queries/admin-brownlow';
import { reconcileCareerTotals } from '@/db/queries/db-health';
import { deleteMatch } from '@/db/queries/match-admin';
import { saveMatchSheet } from '@/db/queries/match-sheet';
import { BROWNLOW_MANUAL_SOURCE_KEY } from '@/lib/brownlow/entry';
import {
  BROWNLOW_MAIN_SEASON,
  BROWNLOW_NO_MEDAL_SEASON,
  BROWNLOW_SHORT_SEASON,
  cleanupSeededBrownlowSeasons,
  seedBrownlowSeason,
  type BrownlowFixture,
} from './brownlow-fixture';

// The four transactions open their own short-lived connection from
// AFLDB_IMPORT_DATABASE_URL, read at call time; point it at the test database.
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL!;

/** Separate connections, for the concurrency proofs only. */
const holder = postgres(testDbUrl, { max: 1 });
const observer = postgres(testDbUrl, { max: 1 });

let main: BrownlowFixture;
let short: BrownlowFixture;
let noMedal: BrownlowFixture;
let actorId = 0;
let createdThrowawayAdmin = false;
let manualSourceId = 0;
let afltablesSourceId = 0;

beforeAll(async () => {
  const [existing] = await sql<{ id: number }[]>`
    SELECT id FROM auth_users ORDER BY id LIMIT 1
  `;
  if (existing) {
    actorId = existing.id;
  } else {
    const [created] = await sql<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-155-brownlow-test@example.test', 'super_admin')
      RETURNING id
    `;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }

  const sources = await sql<{ key: string; id: number }[]>`
    SELECT key, id::int AS id FROM sources
     WHERE key IN (${BROWNLOW_MANUAL_SOURCE_KEY}, 'afltables')
  `;
  const manual = sources.find((row) => row.key === BROWNLOW_MANUAL_SOURCE_KEY);
  const afltables = sources.find((row) => row.key === 'afltables');
  if (!manual || !afltables) {
    throw new Error(
      `Both sources '${BROWNLOW_MANUAL_SOURCE_KEY}' and 'afltables' must exist in this `
      + 'database; the Brownlow writer refuses without the manual one.',
    );
  }
  manualSourceId = manual.id;
  afltablesSourceId = afltables.id;

  main = await seedBrownlowSeason(BROWNLOW_MAIN_SEASON);
  short = await seedBrownlowSeason(BROWNLOW_SHORT_SEASON);
  noMedal = await seedBrownlowSeason(BROWNLOW_NO_MEDAL_SEASON);
});

afterAll(async () => {
  // §27.30: sweep the fixture's registry rather than the three handles. A
  // `beforeAll` timeout rejects the hook without cancelling the seeds, so
  // `main` / `short` / `noMedal` may never be assigned — and handle-based
  // cleanup would then leave committed rows behind with nothing to remove them.
  let teardownError: unknown;
  try {
    await cleanupSeededBrownlowSeasons();
  } catch (error) {
    teardownError = error;
  }

  // Database-wide residue that is not a row: a hard timeout or a kill inside
  // the audit-probe case would leave a trigger that raises on every data_edits
  // insert for the affected match. Unconditional, idempotent, and not dependent
  // on that `it` having reached its `finally`.
  try {
    await sql.unsafe('DROP TRIGGER IF EXISTS issue155_audit_probe_trg ON data_edits');
    await sql.unsafe('DROP FUNCTION IF EXISTS issue155_audit_probe()');
  } catch (error) {
    teardownError ??= error;
  }

  // Only once the fixture rows are gone: fixture data_edits rows reference this
  // actor, so deleting it first would fail on the FK and mask the real error.
  if (createdThrowawayAdmin && teardownError === undefined) {
    await sql`DELETE FROM auth_users WHERE id = ${actorId}`;
  }

  await holder.end();
  await observer.end();
  await sql.end();

  // Fail closed: a suite that could not clean up must not report green.
  if (teardownError !== undefined) throw teardownError;
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type RoundRow = {
  playerId: number;
  votes: number | null;
  matchId: number | null;
  sourceId: number | null;
  sourceRecordId: string | null;
  played: boolean;
};

async function roundRowsFor(matchId: number): Promise<RoundRow[]> {
  return sql<RoundRow[]>`
    SELECT player_id AS "playerId", votes, match_id AS "matchId",
           source_id AS "sourceId", source_record_id AS "sourceRecordId", played
      FROM brownlow_round_votes
     WHERE match_id = ${matchId}
     ORDER BY votes DESC NULLS LAST, player_id
  `;
}

async function mirrorFor(matchId: number): Promise<Map<number, number | null>> {
  const rows = await sql<{ playerId: number; votes: number | null }[]>`
    SELECT player_id AS "playerId", brownlow_votes AS votes
      FROM player_match_stats
     WHERE match_id = ${matchId}
  `;
  return new Map(rows.map((row) => [row.playerId, row.votes]));
}

async function auditRowsFor(
  tableName: string, rowId: number, fieldGroup?: string,
): Promise<Array<{ fieldGroup: string; oldValues: unknown; newValues: unknown; note: string | null }>> {
  return sql<Array<{ fieldGroup: string; oldValues: unknown; newValues: unknown; note: string | null }>>`
    SELECT field_group AS "fieldGroup", old_values AS "oldValues",
           new_values AS "newValues", note
      FROM data_edits
     WHERE table_name = ${tableName} AND row_id = ${rowId}
       AND (${fieldGroup ?? null}::text IS NULL OR field_group = ${fieldGroup ?? null})
     ORDER BY id
  `;
}

async function currentRevision(matchId: number): Promise<number> {
  const model = await getBrownlowMatchEditorModel(matchId);
  return model?.revision ?? 0;
}

async function currentFingerprint(matchId: number): Promise<string> {
  const model = await getBrownlowMatchEditorModel(matchId);
  return model!.canonicalFingerprint;
}

const POLL_ATTEMPTS = 400;
const POLL_INTERVAL_MS = 25;

const settle = () => new Promise((resolve) => { setTimeout(resolve, POLL_INTERVAL_MS); });

/**
 * Prove that `expected` backends are waiting *directly* on `blockerPid`.
 *
 * The idiom tests/integration/player-link-concurrency.test.ts established,
 * inverted: the production entry points open their own connections, so the
 * waiting PIDs are not known in advance and are discovered from the block
 * itself. No sleep is load-bearing — the poll waits for a fact.
 *
 * Correct for an advisory lock, where every waiter queues on the one lock
 * object the holder holds and so names the holder. NOT correct for a row
 * lock: use waitForRowLockChain() for those, and see why there.
 */
async function waitForBlockedBy(blockerPid: number, expected: number): Promise<number[]> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const rows = await observer<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
       WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    if (rows.length >= expected) return rows.map((row) => row.pid);
    await settle();
  }
  throw new Error(
    `Timeout waiting for ${expected} backends to be blocked by PID ${blockerPid}`,
  );
}

type ContenderRow = {
  pid: number;
  waitEventType: string | null;
  waitEvent: string | null;
  blockedBy: number[];
  query: string | null;
};

/**
 * Prove that `expected` contender backends are contending for the row lock
 * held by `blockerPid`, each of them executing a statement whose normalised
 * text contains every fragment in `queryFragments`.
 *
 * A row lock does not queue the way an advisory lock does. The first waiter
 * takes the *tuple* lock and then waits on the holder's transaction id; every
 * later waiter queues behind it on that tuple lock. So `pg_blocking_pids()` of
 * the second contender names the FIRST CONTENDER and never the holder —
 * measured on this suite as holder 3168847, contender 3168867 waiting on
 * Lock/transactionid blocked by [3168847], contender 3168868 waiting on
 * Lock/tuple blocked by [3168867]. "Both are blocked by the holder" is
 * therefore not a fact that can ever become true for a row lock, however long
 * it is polled; the race itself was correct throughout (one winner, one
 * stale), only the observation was wrong.
 *
 * The fact that IS true, and is the one worth proving, is asserted here: both
 * contenders are stopped on a lock, both are executing the statement that
 * takes the contended row, and both sit in the single blocking chain whose
 * root is the holder. The chain is walked transitively in SQL, so it holds
 * whichever contender arrived first and however deep the queue is.
 */
async function waitForRowLockChain(
  blockerPid: number,
  expected: number,
  queryFragments: string[],
): Promise<number[]> {
  const patterns = queryFragments.map((fragment) => `%${fragment}%`);

  const observe = () => observer<ContenderRow[]>`
    WITH RECURSIVE edge AS (
      SELECT a.pid AS waiter, blocker
        FROM pg_stat_activity a
        CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocker
       WHERE a.datname = current_database()
    ), chain AS (
      SELECT ${blockerPid}::int AS pid
       UNION
      SELECT edge.waiter FROM edge JOIN chain ON edge.blocker = chain.pid
    )
    SELECT a.pid,
           a.wait_event_type AS "waitEventType",
           a.wait_event      AS "waitEvent",
           pg_blocking_pids(a.pid) AS "blockedBy",
           left(regexp_replace(a.query, '\\s+', ' ', 'g'), 90) AS query
      FROM pg_stat_activity a
      JOIN chain ON chain.pid = a.pid
     WHERE a.pid <> ${blockerPid}
       AND a.pid <> pg_backend_pid()
       AND a.wait_event_type = 'Lock'
       AND regexp_replace(a.query, '\\s+', ' ', 'g') LIKE ALL (${patterns}::text[])
     ORDER BY a.pid
  `;

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const rows = await observe();
    if (rows.length >= expected) return rows.map((row) => row.pid);
    await settle();
  }

  // Say what was actually there, chain membership ignored, so a genuine
  // failure names the backend that never joined the holder's chain.
  const loose = await observer<ContenderRow[]>`
    SELECT pid,
           wait_event_type AS "waitEventType",
           wait_event      AS "waitEvent",
           pg_blocking_pids(pid) AS "blockedBy",
           left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS query
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> ${blockerPid}
       AND pid <> pg_backend_pid()
       AND regexp_replace(query, '\\s+', ' ', 'g') LIKE ALL (${patterns}::text[])
     ORDER BY pid
  `;
  throw new Error(
    `Timeout waiting for ${expected} contenders in the blocking chain rooted at `
    + `PID ${blockerPid}. Backends running the contended statement:\n`
    + (loose.length === 0 ? '  (none)' : loose.map((row) => (
      `  pid=${row.pid} wait=${row.waitEventType}/${row.waitEvent} `
      + `blocked_by=[${row.blockedBy.join(',')}] query: ${row.query}`
    )).join('\n')),
  );
}

/* ------------------------------------------------------------------ *
 * 1. Migration 094
 * ------------------------------------------------------------------ */

describe('migration 094 objects and backfill', () => {
  it('gives the round fact a nullable match identity', async () => {
    const [column] = await sql<{ dataType: string; isNullable: string }[]>`
      SELECT data_type AS "dataType", is_nullable AS "isNullable"
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'brownlow_round_votes'
         AND column_name = 'match_id'
    `;
    expect(column).toBeDefined();
    expect(column.dataType).toBe('integer');
    // Never NOT NULL, in this migration or a later one: an unresolved
    // historical row is a legitimate state (§27.5).
    expect(column.isNullable).toBe('YES');
  });

  it('carries both partial unique indexes, and only as partial ones', async () => {
    const rows = await sql<{ name: string; definition: string }[]>`
      SELECT indexname AS name, indexdef AS definition
        FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'brownlow_round_votes'
         AND indexname LIKE 'ux_brownlow_round_votes_match%'
       ORDER BY 1
    `;
    expect(rows.map((row) => row.name)).toEqual([
      'ux_brownlow_round_votes_match_player',
      'ux_brownlow_round_votes_match_value',
    ]);
    for (const row of rows) {
      expect(row.definition).toContain('CREATE UNIQUE INDEX');
      // Partial, so unresolved legacy rows are untouched by them.
      expect(row.definition).toMatch(/WHERE .*match_id IS NOT NULL/);
    }
    expect(rows[0].definition).toContain('(match_id, player_id)');
    // A published zero is excluded: every non-polling participant carries one.
    expect(rows[1].definition).toContain('votes > 0');
  });

  it('resolved every historical round row to exactly one match (preflight P2)', async () => {
    // The backfill's own expectation. On the rebuilt afldb_test P2 measured
    // 320,861 of 320,861 rows resolved and zero ambiguous; the assertion is
    // the zero, because that is the contract. The total is asserted as a floor
    // so a newer rebuild with more seasons does not read as a regression.
    const [counts] = await sql<{ total: number; unresolved: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE match_id IS NULL)::int AS unresolved
        FROM brownlow_round_votes
       WHERE season <= 2026
    `;
    expect(counts.unresolved).toBe(0);
    expect(counts.total).toBeGreaterThanOrEqual(320_861);
  });

  it('creates the two workflow tables and widens the audit allowlist', async () => {
    const tables = await sql<{ name: string }[]>`
      SELECT table_name AS name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('brownlow_vote_entry_state', 'brownlow_season_authority')
       ORDER BY 1
    `;
    expect(tables.map((row) => row.name)).toEqual([
      'brownlow_season_authority', 'brownlow_vote_entry_state',
    ]);

    const [check] = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conname = 'data_edits_table_name_check'
    `;
    expect(check.definition).toContain('brownlow_vote_entry_state');
    expect(check.definition).toContain('brownlow_season_authority');
    // Nothing was dropped to make room.
    for (const retained of ['players', 'matches', 'draft_picks', 'award_winners',
      'hall_of_fame', 'honour_team_members']) {
      expect(check.definition).toContain(retained);
    }
  });

  it('registers both tables for the app read grant', async () => {
    // Migration 039 made app reads fail-closed: a table absent from the
    // registry is unreadable after the next privileges reconcile, whatever
    // grant a migration issued by hand.
    const rows = await sql<{ name: string }[]>`
      SELECT name FROM afldb_meta.app_readable_tables
       WHERE name IN ('brownlow_vote_entry_state', 'brownlow_season_authority')
       ORDER BY 1
    `;
    expect(rows.map((row) => row.name)).toEqual([
      'brownlow_season_authority', 'brownlow_vote_entry_state',
    ]);
  });

  it('leaves data_overrides.entity_type exactly as migration 073 wrote it', async () => {
    // §27.22 stop condition: src/lib/acquisition/manual-authority.ts pins this
    // list as its proof that a brownlow_round_votes override is
    // unrepresentable. Widening it would flip the settle's manual-authority
    // answer from `clear` to `indeterminate`.
    const checks = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = 'data_overrides'::regclass
         AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%entity_type%'
    `;
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.definition).toContain('players');
      expect(check.definition).not.toContain('brownlow');
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. Refusals that never reach a write
 * ------------------------------------------------------------------ */

describe('refusals that write nothing', () => {
  it('refuses a match that is not home-and-away, wildcard final and grand final alike', async () => {
    for (const matchId of [main.wildcardFinalMatchId!, main.grandFinalMatchId!]) {
      const result = await finaliseBrownlowMatch({
        matchId,
        selection: { three: main.playerIds[0], two: main.playerIds[1], one: main.playerIds[2] },
        expectedRevision: 0,
        actorId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('not_home_and_away');

      expect(await roundRowsFor(matchId)).toEqual([]);
    }
    // And the read model does not offer them for editing at all.
    expect(await getBrownlowMatchEditorModel(main.wildcardFinalMatchId!)).toBeNull();
  });

  it('refuses a season whose coverage grid says no medal was awarded', async () => {
    const match = noMedal.matches[0];
    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
      },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('season_not_polled');
    expect(await roundRowsFor(match.matchId)).toEqual([]);
  });

  it('refuses a player who has no line-up row in the match', async () => {
    const match = main.matches[0];
    // A real player, in the same season, who played a different match.
    const outsider = main.matches[1].homePlayerIds[0];
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: { three: outsider, two: match.homePlayerIds[1], one: match.awayPlayerIds[0] },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('not_participant');
    expect(await currentRevision(match.matchId)).toBe(0);
  });

  it('refuses the same player twice', async () => {
    const match = main.matches[0];
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[0], one: match.awayPlayerIds[0],
      },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('duplicate_player');
    expect(await currentRevision(match.matchId)).toBe(0);
  });

  it('refuses to finalise an incomplete selection, though a draft may hold one', async () => {
    const match = main.matches[0];
    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection: { three: match.homePlayerIds[0], two: null, one: null },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('incomplete');
    expect(await roundRowsFor(match.matchId)).toEqual([]);
  });

  it('refuses a match whose line-up is short of the §27.6 threshold, and writes nothing', async () => {
    const shortMatch = short.matches[1];
    expect(shortMatch.awayPlayerIds.length).toBeLessThan(18);

    const result = await finaliseBrownlowMatch({
      matchId: shortMatch.matchId,
      selection: {
        three: shortMatch.homePlayerIds[0],
        two: shortMatch.homePlayerIds[1],
        one: shortMatch.awayPlayerIds[0],
      },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('participants_incomplete');
    // The detail names the shortfall, which is the only actionable part.
    expect(result.message).toMatch(/\d+ of 18/);

    expect(await roundRowsFor(shortMatch.matchId)).toEqual([]);
    expect(await currentRevision(shortMatch.matchId)).toBe(0);

    // A draft, by contrast, is allowed against an incomplete line-up: the
    // repair and the entry are different people's work (§27.6).
    const draft = await saveDraftBrownlowMatch({
      matchId: shortMatch.matchId,
      selection: {
        three: shortMatch.homePlayerIds[0],
        two: shortMatch.homePlayerIds[1],
        one: shortMatch.awayPlayerIds[0],
      },
      expectedRevision: 0,
      actorId,
    });
    expect(draft.ok).toBe(true);
    expect(await roundRowsFor(shortMatch.matchId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The main season, administered in order
 * ------------------------------------------------------------------ */

describe('the main season, administered in order', () => {
  it('creates a draft that reaches no public fact table', async () => {
    const match = main.matches[0];
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
      },
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.status).toBe('draft');
    expect(result.value.revision).toBe(1);
    expect(result.value.republishedSeason).toBeNull();

    // The whole point of a separate table: a draft is not a fact.
    expect(await roundRowsFor(match.matchId)).toEqual([]);
    const mirror = await mirrorFor(match.matchId);
    expect([...mirror.values()].every((value) => value === null)).toBe(true);

    // A draft does not touch season authority either.
    const [authority] = await sql<{ season: number }[]>`
      SELECT season FROM brownlow_season_authority WHERE season = ${main.season}
    `;
    expect(authority).toBeUndefined();

    const audit = await auditRowsFor('brownlow_vote_entry_state', match.matchId, 'draft');
    expect(audit).toHaveLength(1);
    expect(audit[0].oldValues).toMatchObject({ status: null, revision: 0 });
    expect(audit[0].newValues).toMatchObject({ status: 'draft', revision: 1 });
  });

  it('updates the draft and bumps the revision', async () => {
    const match = main.matches[0];
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[1], two: match.homePlayerIds[0], one: match.awayPlayerIds[1],
      },
      expectedRevision: 1,
      actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.revision).toBe(2);

    const model = await getBrownlowMatchEditorModel(match.matchId);
    expect(model!.selection).toEqual({
      three: match.homePlayerIds[1], two: match.homePlayerIds[0], one: match.awayPlayerIds[1],
    });
    expect(model!.status).toBe('draft');
  });

  it('refuses a stale revision without writing anything', async () => {
    const match = main.matches[0];
    const before = await getBrownlowMatchEditorModel(match.matchId);
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.awayPlayerIds[2], two: match.homePlayerIds[0], one: match.awayPlayerIds[1],
      },
      expectedRevision: 1, // the page was rendered a revision ago
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('stale');
    expect(result.message).toContain('revision 2, not 1');

    const after = await getBrownlowMatchEditorModel(match.matchId);
    expect(after!.selection).toEqual(before!.selection);
    expect(after!.revision).toBe(before!.revision);
  });

  it('finalises: three canonical rows, a dense mirror, one audit row, coverage moved', async () => {
    const match = main.matches[0];
    const revision = await currentRevision(match.matchId);
    const selection = {
      three: match.homePlayerIds[1], two: match.homePlayerIds[0], one: match.awayPlayerIds[1],
    };

    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection,
      expectedRevision: revision,
      expectedCanonicalFingerprint: await currentFingerprint(match.matchId),
      actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.status).toBe('final');
    // The season is source-published, not admin-published, so nothing was
    // re-derived: the artefact still owns the totals (§27.9).
    expect(result.value.republishedSeason).toBeNull();

    const rows = await roundRowsFor(match.matchId);
    expect(rows.map((row) => [row.playerId, row.votes])).toEqual([
      [selection.three, 3], [selection.two, 2], [selection.one, 1],
    ]);
    for (const row of rows) {
      expect(row.matchId).toBe(match.matchId);
      expect(row.played).toBe(true);
      expect(row.sourceId).toBe(manualSourceId);
      expect(row.sourceRecordId).toBe(`entry:${match.matchId}:r${result.value.revision}`);
    }

    // The mirror is dense across the line-up: 3/2/1 to the chosen, an explicit
    // zero to everyone else who played (§27.10 item 1).
    const mirror = await mirrorFor(match.matchId);
    expect(mirror.size).toBe(36);
    expect(mirror.get(selection.three)).toBe(3);
    expect(mirror.get(selection.two)).toBe(2);
    expect(mirror.get(selection.one)).toBe(1);
    const zeros = [...mirror.values()].filter((value) => value === 0);
    expect(zeros).toHaveLength(33);

    const audit = await auditRowsFor('brownlow_vote_entry_state', match.matchId, 'finalise');
    expect(audit).toHaveLength(1);
    expect(audit[0].newValues).toMatchObject({ status: 'final' });
    expect((audit[0].newValues as { canonicalRows: unknown[] }).canonicalRows).toHaveLength(3);
    // The before picture was empty: nothing was superseded.
    expect((audit[0].oldValues as { canonicalRows: unknown[] }).canonicalRows).toHaveLength(0);

    const availability = await sql<{ statKey: string; coverage: string; populated: number | null; total: number | null }[]>`
      SELECT stat_key AS "statKey", coverage::text AS coverage,
             populated_rows AS populated, total_rows AS total
        FROM stat_availability
       WHERE season = ${main.season} AND stat_key LIKE 'brownlow%'
       ORDER BY 1
    `;
    const byKey = new Map(availability.map((row) => [row.statKey, row]));
    expect(byKey.get('brownlow_match_votes')!.coverage).toBe('partial');
    expect(byKey.get('brownlow_match_votes')!.populated).toBe(1);
    expect(byKey.get('brownlow_match_votes')!.total).toBe(4);
    expect(byKey.get('brownlow_round_votes')!.coverage).toBe('partial');
    // The season has source-published totals, so this grain stays complete.
    expect(byKey.get('brownlow_season_total')!.coverage).toBe('complete');
  });

  it('leaves a source-published season total completely alone, and reports the disagreement', async () => {
    // §27.9's compatibility state: the artefact's totals stay authoritative
    // until somebody publishes, and the delta is shown, never applied.
    const seasonRows = await sql<{ playerId: number; votes: number; sourceId: number }[]>`
      SELECT player_id AS "playerId", votes, source_id AS "sourceId"
        FROM brownlow_season_votes
       WHERE season = ${main.season}
       ORDER BY votes DESC
    `;
    expect(seasonRows).toHaveLength(main.sourcePublishedPlayerIds.length);
    for (const row of seasonRows) expect(row.sourceId).toBe(afltablesSourceId);
    expect(seasonRows.map((row) => row.votes)).toEqual([20, 15, 10]);

    const overview = await getBrownlowSeasonOverview(main.season);
    expect(overview!.authority).toBe('source');
    expect(overview!.status).toBe('source_published');
    expect(overview!.disagreements.length).toBeGreaterThan(0);
    // Every seeded source player disagrees: the round facts say far less.
    for (const playerId of main.sourcePublishedPlayerIds) {
      const row = overview!.disagreements.find((entry) => entry.playerId === playerId);
      expect(row, `player ${playerId} should appear in the disagreement report`).toBeDefined();
    }
    expect(overview!.expected).toBe(4);
    expect(overview!.final).toBe(1);
    expect(overview!.notEntered).toBe(3);
    expect(overview!.complete).toBe(false);
  });

  it('refuses a draft on a finalised match', async () => {
    const match = main.matches[0];
    const revision = await currentRevision(match.matchId);
    const result = await saveDraftBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.awayPlayerIds[0], two: match.homePlayerIds[0], one: match.homePlayerIds[1],
      },
      expectedRevision: revision,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('already_final');
    // The published values are untouched.
    const rows = await roundRowsFor(match.matchId);
    expect(rows.filter((row) => (row.votes ?? 0) > 0)).toHaveLength(3);
  });

  it('corrects a finalised match, recording the reason and the full before and after', async () => {
    const match = main.matches[0];
    const before = await getBrownlowMatchEditorModel(match.matchId);
    const selection = {
      three: match.awayPlayerIds[0], two: match.homePlayerIds[1], one: match.homePlayerIds[0],
    };

    const result = await correctBrownlowMatch({
      matchId: match.matchId,
      selection,
      expectedRevision: before!.revision,
      expectedCanonicalFingerprint: before!.canonicalFingerprint,
      actorId,
      reason: 'AFL published a revised vote sheet for this match.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const rows = await roundRowsFor(match.matchId);
    const positive = rows.filter((row) => (row.votes ?? 0) > 0);
    expect(positive.map((row) => [row.playerId, row.votes])).toEqual([
      [selection.three, 3], [selection.two, 2], [selection.one, 1],
    ]);
    // This correction reshuffles rather than replaces: the former 3-vote
    // holder is still on the sheet, demoted to 2.
    const claimed = [selection.three, selection.two, selection.one];
    expect(claimed).toContain(before!.selection.three);
    expect(rows.find((row) => row.playerId === before!.selection.three)!.votes).toBe(2);

    // CLAIM AND DEMOTE, never delete: the one previous holder who is absent
    // from the corrected sheet keeps a row saying he played and polled nothing.
    const dropped = [before!.selection.three, before!.selection.two, before!.selection.one]
      .filter((playerId) => playerId !== null && !claimed.includes(playerId));
    expect(dropped, 'exactly one previous holder leaves the sheet').toEqual([before!.selection.one]);
    const demoted = rows.find((row) => row.playerId === dropped[0]);
    expect(demoted, 'the displaced player keeps a zero row').toBeDefined();
    expect(demoted!.votes).toBe(0);
    expect(demoted!.played).toBe(true);

    const audit = await auditRowsFor('brownlow_vote_entry_state', match.matchId, 'correct');
    expect(audit).toHaveLength(1);
    expect(audit[0].note).toBe('AFL published a revised vote sheet for this match.');
    expect((audit[0].oldValues as { three: number }).three).toBe(before!.selection.three);
    expect((audit[0].newValues as { three: number }).three).toBe(selection.three);
    expect((audit[0].oldValues as { canonicalRows: unknown[] }).canonicalRows).toHaveLength(3);
  });

  it('refuses a correction with no reason', async () => {
    const match = main.matches[0];
    const before = await getBrownlowMatchEditorModel(match.matchId);
    const result = await correctBrownlowMatch({
      matchId: match.matchId,
      selection: before!.selection,
      expectedRevision: before!.revision,
      actorId,
      reason: '  ',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('invalid');
    expect(await currentRevision(match.matchId)).toBe(before!.revision);
  });

  it('refuses a finalisation whose canonical picture moved since the page was rendered', async () => {
    const match = main.matches[1];
    // A settle-style arrival: afltables lands two votes for this match.
    for (const [index, votes] of [[0, 3], [1, 2]] as const) {
      await sql`
        INSERT INTO brownlow_round_votes
              (season, player_id, round_number, match_id, played, votes,
               source_id, source_record_id, imported_at)
        VALUES (${main.season}, ${match.homePlayerIds[index]}, ${match.roundNumber},
                ${match.matchId}, true, ${votes}, ${afltablesSourceId},
                ${`settle:${match.matchId}:${index}`}, now())
      `;
    }

    const rendered = await getBrownlowMatchEditorModel(match.matchId);
    expect(rendered!.assignment).toBe('partial');
    expect(rendered!.canonicalRows).toHaveLength(2);

    // ... and then a second settle changes one of them, after the page rendered.
    await sql`
      UPDATE brownlow_round_votes SET votes = 1
       WHERE match_id = ${match.matchId} AND player_id = ${match.homePlayerIds[0]}
    `;

    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
      },
      expectedRevision: rendered!.revision,
      expectedCanonicalFingerprint: rendered!.canonicalFingerprint,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('stale');
    expect(result.message).toContain('recorded votes for this match changed');

    // Nothing was claimed: the imported rows keep their own provenance.
    const rows = await roundRowsFor(match.matchId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.sourceId).toBe(afltablesSourceId);
  });

  it('adopts the imported rows on a fresh finalisation, demoting rather than deleting them', async () => {
    const match = main.matches[1];
    const model = await getBrownlowMatchEditorModel(match.matchId);
    const selection = {
      three: match.homePlayerIds[2], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
    };

    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection,
      expectedRevision: model!.revision,
      expectedCanonicalFingerprint: model!.canonicalFingerprint,
      actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const rows = await roundRowsFor(match.matchId);
    // Three claimed plus the displaced import, which survives at zero with
    // manual provenance because a human decided it was not a vote.
    const displaced = rows.find((row) => row.playerId === match.homePlayerIds[0]);
    expect(displaced!.votes).toBe(0);
    expect(displaced!.sourceId).toBe(manualSourceId);
    expect(rows.filter((row) => (row.votes ?? 0) > 0).map((row) => row.playerId))
      .toEqual([selection.three, selection.two, selection.one]);

    // The superseded imported values are in the audit's before picture, which
    // is the only place they now exist.
    const audit = await auditRowsFor('brownlow_vote_entry_state', match.matchId, 'finalise');
    const oldRows = (audit[0].oldValues as { canonicalRows: Array<{ sourceId: number }> }).canonicalRows;
    expect(oldRows).toHaveLength(2);
    expect(oldRows.every((row) => row.sourceId === afltablesSourceId)).toBe(true);
  });

  it('voids a match: the values are withdrawn, the participation record is not', async () => {
    const match = main.matches[2];
    // Give it something to withdraw first.
    const finalise = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
      },
      expectedRevision: 0,
      expectedCanonicalFingerprint: await currentFingerprint(match.matchId),
      actorId,
    });
    expect(finalise.ok).toBe(true);

    const revision = await currentRevision(match.matchId);
    const result = await voidBrownlowMatch({
      matchId: match.matchId,
      expectedRevision: revision,
      expectedCanonicalFingerprint: await currentFingerprint(match.matchId),
      actorId,
      reason: 'The match was abandoned; no votes were awarded.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.status).toBe('void');
    expect(result.value.selection).toEqual({ three: null, two: null, one: null });

    // Operator decision D2: withdraw the values, keep `played`. Asserting forty
    // zeros would claim every player polled nothing in a match that was never
    // polled at all.
    const rows = await roundRowsFor(match.matchId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.votes).toBeNull();
      expect(row.played).toBe(true);
    }
    const mirror = await mirrorFor(match.matchId);
    expect([...mirror.values()].every((value) => value === null)).toBe(true);

    const audit = await auditRowsFor('brownlow_vote_entry_state', match.matchId, 'void');
    expect(audit).toHaveLength(1);
    expect(audit[0].note).toBe('The match was abandoned; no votes were awarded.');
  });

  it('refuses a second void of the same match', async () => {
    const match = main.matches[2];
    const revision = await currentRevision(match.matchId);
    const result = await voidBrownlowMatch({
      matchId: match.matchId,
      expectedRevision: revision,
      actorId,
      reason: 'issue-155 second void',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('already_final');
    expect(await currentRevision(match.matchId)).toBe(revision);
  });

  it('refuses a void with no reason, and writes nothing', async () => {
    // A void is a reasoned declaration that nobody polled: it is the one
    // transition where the reason IS the record, so an empty one is refused
    // before the transaction touches a fact.
    const match = main.matches[3];
    expect(await currentRevision(match.matchId)).toBe(0);

    const result = await voidBrownlowMatch({
      matchId: match.matchId, expectedRevision: 0, actorId, reason: '   ',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('invalid');
    expect(result.message).toContain('A reason is required');

    expect(await currentRevision(match.matchId)).toBe(0);
    expect(await roundRowsFor(match.matchId)).toEqual([]);
  });

  it('rolls the facts back when the required audit row cannot be written', async () => {
    // §27.13 and the migration-066 discipline. The audit is forced to fail with
    // a trigger scoped to this one match and field group, and dropped again,
    // because there is no input that can make recordDataEdit fail on its own:
    // it truncates the note and every other column is derived.
    const match = main.matches[3];
    await sql.unsafe(
      'CREATE FUNCTION issue155_audit_probe() RETURNS trigger AS $probe$ '
      + "BEGIN RAISE EXCEPTION 'issue155 audit probe'; END; $probe$ LANGUAGE plpgsql",
    );
    await sql.unsafe(
      'CREATE TRIGGER issue155_audit_probe_trg BEFORE INSERT ON data_edits '
      + "FOR EACH ROW WHEN (NEW.table_name = 'brownlow_vote_entry_state' "
      + `AND NEW.row_id = ${match.matchId}) EXECUTE FUNCTION issue155_audit_probe()`,
    );

    try {
      const result = await finaliseBrownlowMatch({
        matchId: match.matchId,
        selection: {
          three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
        },
        expectedRevision: 0,
        expectedCanonicalFingerprint: await currentFingerprint(match.matchId),
        actorId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('db_error');
    } finally {
      await sql.unsafe('DROP TRIGGER IF EXISTS issue155_audit_probe_trg ON data_edits');
      await sql.unsafe('DROP FUNCTION IF EXISTS issue155_audit_probe()');
    }

    // The facts the transaction had already written are gone with the audit.
    expect(await roundRowsFor(match.matchId)).toEqual([]);
    expect(await currentRevision(match.matchId)).toBe(0);
    const mirror = await mirrorFor(match.matchId);
    expect([...mirror.values()].every((value) => value === null)).toBe(true);
  });

  it('finalises the last match, completing the season', async () => {
    const match = main.matches[3];
    const result = await finaliseBrownlowMatch({
      matchId: match.matchId,
      selection: {
        three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
      },
      expectedRevision: 0,
      expectedCanonicalFingerprint: await currentFingerprint(match.matchId),
      actorId,
    });
    expect(result.ok).toBe(true);

    const overview = await getBrownlowSeasonOverview(main.season);
    expect(overview!.expected).toBe(4);
    expect(overview!.final).toBe(3);
    expect(overview!.voided).toBe(1);
    expect(overview!.complete).toBe(true);
    expect(overview!.rounds.map((round) => [round.roundNumber, round.accounted]))
      .toEqual([[1, 2], [2, 2]]);
  });

  it('lists the round in fixture order with its current holders', async () => {
    const round = await getBrownlowRound(main.season, 1);
    expect(round.map((entry) => entry.matchId))
      .toEqual([main.matches[0].matchId, main.matches[1].matchId]);
    expect(round[0].status).toBe('final');
    expect(round[0].assignment).toBe('complete');
    expect(round[0].participantsComplete).toBe(true);
    expect(round[0].holders.map((holder) => holder.votes)).toEqual([3, 2, 1]);
    expect(round[0].homeClubName.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Publication
 * ------------------------------------------------------------------ */

describe('publication', () => {
  it('refuses a season that still has an unattached vote row', async () => {
    // An unresolved historical row is a legitimate state, but it is not a
    // publishable one: its votes belong to a match nobody has identified.
    const orphan = main.matches[3].awayPlayerIds[5];
    await sql`
      INSERT INTO brownlow_round_votes (season, player_id, round_number, played, votes)
      VALUES (${main.season}, ${orphan}, 9, true, 0)
    `;
    try {
      const overview = await getBrownlowSeasonOverview(main.season);
      expect(overview!.unresolved).toBe(1);

      const result = await publishBrownlowSeason({
        season: main.season,
        ineligiblePlayerIds: [],
        expectedRevision: overview!.revision,
        actorId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('season_incomplete');
      expect(result.message).toContain('not attached to a match');
    } finally {
      await sql`
        DELETE FROM brownlow_round_votes
         WHERE season = ${main.season} AND round_number = 9 AND match_id IS NULL
      `;
    }
  });

  it('refuses a season whose matches are not all accounted for', async () => {
    const overview = await getBrownlowSeasonOverview(short.season);
    expect(overview!.complete).toBe(false);
    const result = await publishBrownlowSeason({
      season: short.season,
      ineligiblePlayerIds: [],
      expectedRevision: overview!.revision,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('season_incomplete');
    expect(result.message).toMatch(/of 2 home-and-away matches/);

    // Nothing was derived for it.
    const [rows] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM brownlow_season_votes WHERE season = ${short.season}
    `;
    expect(rows.count).toBe(0);
  });

  it('refuses an ineligibility flag on a player who polled nothing', async () => {
    const overview = await getBrownlowSeasonOverview(main.season);
    const result = await publishBrownlowSeason({
      season: main.season,
      ineligiblePlayerIds: [main.matches[0].awayPlayerIds[9]],
      expectedRevision: overview!.revision,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('invalid');
    expect(result.message).toContain('polled no votes');
  });

  it('publishes: manual rows, measured ranks and winners, derived totals in step', async () => {
    const overview = await getBrownlowSeasonOverview(main.season);
    // The season's leading vote-getter, declared ineligible so the P13(a)/(f)
    // conventions have a subject at the top of the order where they matter.
    const [{ playerId: leader }] = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId", sum(votes) AS total
        FROM brownlow_round_votes
       WHERE season = ${main.season} AND votes > 0
       GROUP BY player_id
       ORDER BY total DESC, player_id
       LIMIT 1
    `;

    const careerBefore = await reconcileCareerTotals();
    const brownlowDriftBefore = careerBefore
      .find((check) => check.check.startsWith('brownlow votes'))!.mismatches;

    const result = await publishBrownlowSeason({
      season: main.season,
      ineligiblePlayerIds: [leader],
      expectedRevision: overview!.revision,
      actorId,
      note: 'issue-155 c1 publication',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.rowCount).toBeGreaterThan(0);

    const rows = await sql<Array<{
      playerId: number; votes: number; voteRank: number; eligibleRank: number | null;
      isIneligible: boolean; isWinner: boolean; games: number; pollingGames: number;
      threeVoteGames: number | null; sourceId: number; sourceRecordId: string;
      linkStatusValue: string; clubId: number | null;
    }>>`
      SELECT player_id AS "playerId", votes, vote_rank AS "voteRank",
             eligible_rank AS "eligibleRank", is_ineligible AS "isIneligible",
             is_winner AS "isWinner", games, polling_games AS "pollingGames",
             three_vote_games AS "threeVoteGames", source_id AS "sourceId",
             source_record_id AS "sourceRecordId",
             link_status_value AS "linkStatusValue", club_id AS "clubId"
        FROM brownlow_season_votes
       WHERE season = ${main.season}
       ORDER BY vote_rank, player_id
    `;
    expect(rows).toHaveLength(result.value.rowCount);
    // The artefact rows are gone: the season now has exactly one authority.
    for (const row of rows) {
      expect(row.sourceId).toBe(manualSourceId);
      expect(row.sourceRecordId).toBe(`publish:${main.season}:r${result.value.revision}`);
      expect(row.linkStatusValue).toBe('unique');
      // P13(b): club_id stays NULL, as it is on all 16,120 artefact rows.
      expect(row.clubId).toBeNull();
      expect(row.pollingGames).toBeGreaterThan(0);
    }
    // P13(a): the ineligible player keeps his place in the overall ranking,
    // has no eligible rank, and wins nothing.
    const ineligible = rows.find((row) => row.playerId === leader)!;
    expect(ineligible.isIneligible).toBe(true);
    expect(ineligible.eligibleRank).toBeNull();
    expect(ineligible.isWinner).toBe(false);
    expect(ineligible.voteRank).toBe(1);
    // P13(f): is_winner means exactly eligible_rank = 1, in both directions.
    for (const row of rows) {
      expect(row.isWinner).toBe(row.eligibleRank === 1);
    }
    expect(result.value.winners).toEqual(
      rows.filter((row) => row.isWinner).map((row) => row.playerId),
    );
    // P13(j): a zero count is stored as NULL, the way the artefact stores it,
    // so a manual row cannot be told from a source one by a plain IS NULL.
    expect(rows.every((row) => row.threeVoteGames === null || row.threeVoteGames > 0)).toBe(true);
    expect(rows.some((row) => row.threeVoteGames === null)).toBe(true);
    expect(rows.some((row) => (row.threeVoteGames ?? 0) > 0)).toBe(true);

    // The season is now admin-published and the read model says so.
    const after = await getBrownlowSeasonOverview(main.season);
    expect(after!.authority).toBe('manual');
    expect(after!.status).toBe('published');
    expect(after!.publishedRevision).toBe(result.value.revision);
    expect(after!.stale).toBe(false);
    expect(after!.disagreements).toEqual([]);

    // Derived surfaces moved with it.
    for (const row of rows) {
      const [season] = await sql<{ votes: number | null }[]>`
        SELECT brownlow_votes AS votes FROM player_season_stats
         WHERE player_id = ${row.playerId} AND season = ${main.season}
      `;
      expect(season.votes).toBe(row.votes);
      const [career] = await sql<{ votes: number; medals: number }[]>`
        SELECT brownlow_votes AS votes, brownlow_medals AS medals
          FROM player_career_stats WHERE player_id = ${row.playerId}
      `;
      expect(career.votes).toBe(row.votes);
      expect(career.medals).toBe(row.isWinner ? 1 : 0);
    }
    // The players whose artefact rows the publication removed fell back to
    // zero rather than keeping a stale total.
    for (const playerId of main.sourcePublishedPlayerIds) {
      if (rows.some((row) => row.playerId === playerId)) continue;
      const [career] = await sql<{ votes: number }[]>`
        SELECT brownlow_votes AS votes FROM player_career_stats WHERE player_id = ${playerId}
      `;
      expect(career.votes).toBe(0);
    }

    // db-health's own reconciliation is no worse than it was: the publication
    // introduced no career drift anywhere in the database.
    const careerAfter = await reconcileCareerTotals();
    expect(careerAfter.find((check) => check.check.startsWith('brownlow votes'))!.mismatches)
      .toBe(brownlowDriftBefore);

    const audit = await auditRowsFor('brownlow_season_authority', main.season, 'publish');
    expect(audit).toHaveLength(1);
    expect(audit[0].newValues).toMatchObject({
      authority: 'manual', ineligible: [leader],
    });
  });

  it('refuses a stale publication', async () => {
    const result = await publishBrownlowSeason({
      season: main.season,
      ineligiblePlayerIds: [],
      expectedRevision: 0,
      actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('stale');
  });

  it('is idempotent: re-publishing identical inputs produces identical rows', async () => {
    const before = await sql<Array<Record<string, unknown>>>`
      SELECT player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner,
             games, three_vote_games, two_vote_games, one_vote_games, polling_games
        FROM brownlow_season_votes WHERE season = ${main.season}
       ORDER BY player_id
    `;
    const overview = await getBrownlowSeasonOverview(main.season);
    const ineligible = overview!.ineligiblePlayerIds;

    const result = await publishBrownlowSeason({
      season: main.season,
      ineligiblePlayerIds: ineligible,
      expectedRevision: overview!.revision,
      actorId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // A new revision, the same facts.
    expect(result.value.revision).toBe(overview!.revision + 1);

    const after = await sql<Array<Record<string, unknown>>>`
      SELECT player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner,
             games, three_vote_games, two_vote_games, one_vote_games, polling_games
        FROM brownlow_season_votes WHERE season = ${main.season}
       ORDER BY player_id
    `;
    expect(after).toEqual(before);
  });

  it('re-derives a published season inside the correction that changed it', async () => {
    // §27.9: there is no published-but-stale state. The correction and the
    // re-derivation are one transaction, so a reader never sees totals that
    // disagree with the match set they came from.
    const match = main.matches[0];
    const model = await getBrownlowMatchEditorModel(match.matchId);
    const promoted = match.awayPlayerIds[7];
    const overviewBefore = await getBrownlowSeasonOverview(main.season);

    const result = await correctBrownlowMatch({
      matchId: match.matchId,
      selection: { three: promoted, two: model!.selection.two, one: model!.selection.one },
      expectedRevision: model!.revision,
      expectedCanonicalFingerprint: model!.canonicalFingerprint,
      actorId,
      reason: 'The 3 votes were credited to the wrong player.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.republishedSeason).toBe(main.season);

    const [row] = await sql<{ votes: number; sourceRecordId: string }[]>`
      SELECT votes, source_record_id AS "sourceRecordId"
        FROM brownlow_season_votes
       WHERE season = ${main.season} AND player_id = ${promoted}
    `;
    expect(row.votes).toBe(3);

    const overviewAfter = await getBrownlowSeasonOverview(main.season);
    expect(overviewAfter!.publishedRevision).toBe(overviewBefore!.publishedRevision! + 1);
    expect(overviewAfter!.stale).toBe(false);
    expect(overviewAfter!.disagreements).toEqual([]);

    const republish = await auditRowsFor('brownlow_season_authority', main.season, 'republish');
    expect(republish).toHaveLength(1);
    expect(republish[0].note).toBe('The 3 votes were credited to the wrong player.');

    const [career] = await sql<{ votes: number }[]>`
      SELECT brownlow_votes AS votes FROM player_career_stats WHERE player_id = ${promoted}
    `;
    expect(career.votes).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The neighbours: the reload paths, the match sheet, match deletion
 * ------------------------------------------------------------------ */

describe('precedence over the reload paths (§27.11)', () => {
  it("the artefact loader's own refusal predicate sees the admin-published season", async () => {
    // The database half of the guard in
    // tools/migration/import_brownlow_season.py::check_database_coverage,
    // executed rather than read. The source half is asserted in
    // tests/brownlow-season-artefact.test.ts.
    const rows = await sql<{ season: number }[]>`
      SELECT DISTINCT b.season
        FROM brownlow_season_votes b
        JOIN sources s ON s.id = b.source_id
       WHERE s.key = ${BROWNLOW_MANUAL_SOURCE_KEY}
       ORDER BY b.season
    `;
    expect(rows.map((row) => row.season)).toContain(main.season);
  });

  it("the fitzRoy loader's own refusal predicate sees the admin-finalised matches", async () => {
    // The database half of the guard in
    // tools/migration/import_fitzroy_core.py::import_brownlow_round_votes,
    // with the same season scoping the DELETE it protects uses.
    const snapshotSeasons = [main.season, short.season];
    const rows = await sql<{ season: number }[]>`
      SELECT DISTINCT b.season
        FROM brownlow_round_votes b
        JOIN sources s ON s.id = b.source_id
       WHERE b.season = ANY(${snapshotSeasons})
         AND s.key = ${BROWNLOW_MANUAL_SOURCE_KEY}
       ORDER BY b.season
    `;
    expect(rows.map((row) => row.season)).toEqual([main.season]);

    // A rebuild database holds no manual rows, which is why a real rebuild is
    // unaffected: the same predicate over a season nobody has administered
    // finds nothing.
    const [clean] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM brownlow_round_votes b
        JOIN sources s ON s.id = b.source_id
       WHERE b.season = ${noMedal.season} AND s.key = ${BROWNLOW_MANUAL_SOURCE_KEY}
    `;
    expect(clean.count).toBe(0);
  });
});

describe('the match sheet and match deletion (§27.15)', () => {
  it('preserves the Brownlow mirror through a match-sheet save', async () => {
    const match = main.matches[0];
    const model = await getBrownlowMatchEditorModel(match.matchId);
    const voter = model!.selection.two!;
    const before = await mirrorFor(match.matchId);
    expect(before.get(voter)).toBe(2);

    const result = await saveMatchSheet({
      matchId: match.matchId,
      syncMatchScores: false,
      players: [{ playerId: voter, clubId: match.homeClubId, kicks: 25, handballs: 5, disposals: 30 }],
      adminUserId: actorId,
      note: 'issue-155 mirror preservation',
    });
    expect(result.ok).toBe(true);

    const after = await mirrorFor(match.matchId);
    // The statistics the sheet carried were written; the column it no longer
    // writes was not touched.
    expect(after.get(voter)).toBe(2);
    expect(after.size).toBe(before.size);
    const [stat] = await sql<{ kicks: number }[]>`
      SELECT kicks FROM player_match_stats
       WHERE match_id = ${match.matchId} AND player_id = ${voter}
    `;
    expect(stat.kicks).toBe(25);
  });

  it('refuses to delete a match that carries a Brownlow decision, and changes nothing', async () => {
    const match = main.matches[0];
    const rowsBefore = await roundRowsFor(match.matchId);

    const result = await deleteMatch({
      matchId: match.matchId,
      adminUserId: actorId,
      reason: 'issue-155 restrict proof',
    });
    expect(result.ok).toBe(false);

    // The ON DELETE RESTRICT foreign key of migration 094 §4 is the whole
    // mechanism: match-admin.ts is unchanged and its existing error path
    // surfaces it.
    const [match_] = await sql<{ id: number }[]>`
      SELECT id FROM matches WHERE id = ${match.matchId}
    `;
    expect(match_).toBeDefined();
    expect(await roundRowsFor(match.matchId)).toEqual(rowsBefore);
    expect(await currentRevision(match.matchId)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Two administrators at once (§27.14)
 * ------------------------------------------------------------------ */

describe('two administrators acting at once', () => {
  /**
   * Every race here is made deterministic the same way: a third connection
   * takes the lock both contenders must pass through, both are started and
   * both are proven to be waiting on it with pg_blocking_pids(), and only then
   * is it released. That is the real race — the production entry points are
   * used unmodified, each on its own connection, with no test-only hook in the
   * transaction — with the interleaving pinned instead of hoped for. No sleep
   * is load-bearing.
   *
   * How "waiting on it" is observed depends on the lock: an advisory lock
   * queues every waiter on the holder, a row lock chains the second waiter
   * behind the first. `observe` says which, and defaults to the advisory
   * reading; see waitForRowLockChain().
   */
  async function withHeldLock<T>(
    take: (tx: postgres.TransactionSql) => Promise<unknown>,
    race: () => Promise<T>,
    observe: (holderPid: number) => Promise<number[]>
      = (holderPid) => waitForBlockedBy(holderPid, 2),
  ): Promise<T> {
    let racePromise!: Promise<T>;

    await holder.begin(async (tx) => {
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await take(tx);
      racePromise = race();
      // Both contenders, not one: a proof that only one of them ever reached
      // the lock would not be a proof that they contend.
      const blocked = await observe(pid);
      expect(blocked.length).toBeGreaterThanOrEqual(2);
    });
    return racePromise;
  }

  /**
   * Bring the main season to the state the finalisation race needs — every
   * home-and-away match accounted for, `main.matches[2]` `void`, the season
   * published — whatever ran before this.
   *
   * In the full file that is already true, established by the ordered `main
   * season` and `publication` blocks, and every step below is a read that
   * skips. Run on its own (`vitest -t "two finalisations …"`) only `beforeAll`
   * has run, and these calls establish it. Either way the race starts from one
   * state, and this file's ordered narrative is not a precondition of it.
   *
   * Nothing here re-implements the workflow: it is the workflow, called
   * through the same four production entry points, with the selections the
   * ordered suite uses. A refusal from any of them fails here rather than
   * surfacing later as a confusing race result.
   */
  async function ensureVoidedMatchInPublishedSeason(): Promise<void> {
    const target = main.matches[2];

    for (const match of main.matches) {
      const wanted = match === target ? 'void' : 'final';
      const model = (await getBrownlowMatchEditorModel(match.matchId))!;
      if (model.status === wanted) continue;

      if (model.status !== 'final') {
        const finalise = await finaliseBrownlowMatch({
          matchId: match.matchId,
          selection: {
            three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
          },
          expectedRevision: model.revision,
          expectedCanonicalFingerprint: model.canonicalFingerprint,
          actorId,
        });
        if (!finalise.ok) {
          throw new Error(`finalising match ${match.matchId} for the race: ${finalise.code}`);
        }
      }

      if (wanted === 'void') {
        const beforeVoid = (await getBrownlowMatchEditorModel(match.matchId))!;
        const voided = await voidBrownlowMatch({
          matchId: match.matchId,
          expectedRevision: beforeVoid.revision,
          expectedCanonicalFingerprint: beforeVoid.canonicalFingerprint,
          actorId,
          reason: 'The match was abandoned; no votes were awarded.',
        });
        if (!voided.ok) {
          throw new Error(`voiding match ${match.matchId} for the race: ${voided.code}`);
        }
      }
    }

    // The race asserts that the winner republishes the season, which is only
    // a fact about a season that has been published: §27.17 step 8 re-derives
    // only when `published_revision IS NOT NULL`.
    const overview = (await getBrownlowSeasonOverview(main.season))!;
    if (overview.publishedRevision === null) {
      const published = await publishBrownlowSeason({
        season: main.season,
        ineligiblePlayerIds: overview.ineligiblePlayerIds,
        expectedRevision: overview.revision,
        actorId,
      });
      if (!published.ok) {
        throw new Error(`publishing ${main.season} for the race: ${published.code} — ${published.message}`);
      }
    }
  }

  it('a draft and a finalisation of the same match: the loser is refused stale', async () => {
    const match = short.matches[0];
    const revision = await currentRevision(match.matchId);
    const fingerprint = await currentFingerprint(match.matchId);
    const selection = {
      three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
    };

    const [draft, final] = await withHeldLock(
      // Both contenders must pass the matches row lock; a draft takes no
      // advisory lock, so this is the lock they genuinely share.
      (tx) => tx`SELECT id FROM matches WHERE id = ${match.matchId} FOR UPDATE`,
      () => Promise.all([
        saveDraftBrownlowMatch({
          matchId: match.matchId,
          selection: { three: match.awayPlayerIds[1], two: null, one: null },
          expectedRevision: revision,
          actorId,
        }),
        finaliseBrownlowMatch({
          matchId: match.matchId,
          selection,
          expectedRevision: revision,
          expectedCanonicalFingerprint: fingerprint,
          actorId,
        }),
      ]),
      // A row lock, so the contenders form a chain rooted at the holder rather
      // than two direct waiters on it.
      (holderPid) => waitForRowLockChain(holderPid, 2, ['FROM matches', 'FOR UPDATE']),
    );

    const outcomes = [draft, final];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const loser = outcomes.find((outcome) => !outcome.ok)!;
    if (loser.ok) throw new Error('unreachable');
    // Either order is legitimate: the second one through sees a revision that
    // is no longer the one it was rendered from, or a final row it may not
    // draft over.
    expect(['stale', 'already_final']).toContain(loser.code);
    expect(await currentRevision(match.matchId)).toBe(revision + 1);
  });

  it('two corrections of the same finalised match: the second is refused stale', async () => {
    const match = short.matches[0];
    // Reach a clean starting point whatever the previous test left.
    const model = await getBrownlowMatchEditorModel(match.matchId);
    if (model!.status !== 'final') {
      const seed = await finaliseBrownlowMatch({
        matchId: match.matchId,
        selection: {
          three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
        },
        expectedRevision: model!.revision,
        expectedCanonicalFingerprint: model!.canonicalFingerprint,
        actorId,
      });
      expect(seed.ok).toBe(true);
    }

    const current = await getBrownlowMatchEditorModel(match.matchId);
    const input = {
      matchId: match.matchId,
      expectedRevision: current!.revision,
      expectedCanonicalFingerprint: current!.canonicalFingerprint,
      actorId,
      reason: 'issue-155 concurrent correction proof',
    };

    const results = await withHeldLock(
      // Corrections take the advisory lock first (§27.14), because they may
      // re-derive a published season. That is the lock they contend on.
      (tx) => tx`SELECT pg_advisory_xact_lock(717275, 3)`,
      () => Promise.all([
        correctBrownlowMatch({
          ...input,
          selection: {
            three: match.awayPlayerIds[0], two: match.homePlayerIds[0], one: match.homePlayerIds[1],
          },
        }),
        correctBrownlowMatch({
          ...input,
          selection: {
            three: match.homePlayerIds[1], two: match.awayPlayerIds[0], one: match.homePlayerIds[0],
          },
        }),
      ]),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok)!;
    if (loser.ok) throw new Error('unreachable');
    expect(loser.code).toBe('stale');
    expect(await currentRevision(match.matchId)).toBe(current!.revision + 1);
  });

  it('two finalisations of the same match: the second is refused stale', async () => {
    // The voided match of the published main season, brought back to a
    // decision by two Super Admins at once (§27.7 permits void -> final with a
    // reason). It also puts the re-derivation path under contention: the
    // winner republishes the season inside its own transaction.
    await ensureVoidedMatchInPublishedSeason();

    const match = main.matches[2];
    const model = await getBrownlowMatchEditorModel(match.matchId);
    expect(model!.status).toBe('void');

    const input = {
      matchId: match.matchId,
      expectedRevision: model!.revision,
      expectedCanonicalFingerprint: model!.canonicalFingerprint,
      actorId,
      reason: 'The abandoned match was replayed and votes were awarded.',
    };

    const results = await withHeldLock(
      (tx) => tx`SELECT pg_advisory_xact_lock(717275, 3)`,
      () => Promise.all([
        finaliseBrownlowMatch({
          ...input,
          selection: {
            three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0],
          },
        }),
        finaliseBrownlowMatch({
          ...input,
          selection: {
            three: match.awayPlayerIds[1], two: match.homePlayerIds[2], one: match.homePlayerIds[3],
          },
        }),
      ]),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok)!;
    if (loser.ok) throw new Error('unreachable');
    expect(loser.code).toBe('stale');

    const winner = results.find((result) => result.ok)!;
    if (!winner.ok) throw new Error('unreachable');
    expect(winner.value.republishedSeason).toBe(main.season);
    expect(await currentRevision(match.matchId)).toBe(model!.revision + 1);
    // Exactly one 3, one 2 and one 1 survived the race.
    const positive = (await roundRowsFor(match.matchId)).filter((row) => (row.votes ?? 0) > 0);
    expect(positive.map((row) => row.votes)).toEqual([3, 2, 1]);
  });

  it('two publications of the same season: the second is refused stale', async () => {
    const overview = await getBrownlowSeasonOverview(main.season);
    const input = {
      season: main.season,
      ineligiblePlayerIds: overview!.ineligiblePlayerIds,
      expectedRevision: overview!.revision,
      actorId,
    };

    const results = await withHeldLock(
      (tx) => tx`SELECT pg_advisory_xact_lock(717275, 3)`,
      () => Promise.all([
        publishBrownlowSeason(input),
        publishBrownlowSeason(input),
      ]),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok)!;
    if (loser.ok) throw new Error('unreachable');
    expect(loser.code).toBe('stale');

    const after = await getBrownlowSeasonOverview(main.season);
    expect(after!.revision).toBe(overview!.revision + 1);
    expect(after!.stale).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 7. The season list
 * ------------------------------------------------------------------ */

describe('the season list', () => {
  it('reports each fixture season with the state it is actually in', async () => {
    const seasons = await listBrownlowSeasons();
    const byYear = new Map(seasons.map((entry) => [entry.season, entry]));

    const published = byYear.get(main.season)!;
    expect(published.authority).toBe('manual');
    expect(published.status).toBe('published');
    expect(published.expected).toBe(4);
    expect(published.notEntered).toBe(0);

    const incomplete = byYear.get(short.season)!;
    expect(incomplete.authority).toBe('none');
    expect(incomplete.complete).toBe(false);
    expect(incomplete.participantsIncomplete).toBe(1);

    const unpolled = byYear.get(noMedal.season)!;
    expect(unpolled.polled).toBe(false);
    expect(unpolled.status).toBe('not_polled');
  });
});
