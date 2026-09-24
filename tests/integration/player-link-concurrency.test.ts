import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  linkAflApiProvider,
  revokeAflApiLink,
  type LinkAflApiProviderResult,
} from '@/db/queries/afl-api-player-links';
import { resolveLockedLink, confirmLockedUnlinked } from '@/db/queries/player-links';

import {
  cleanupS6Fixtures,
  insertS6BrownlowVote,
  issue235FixtureResidue,
  loadS6Refs,
  renderS6Form,
  routeS6ImportDsn,
  S6_NOTE,
  s6LedgerRows,
  s6MatchId,
  s6ProviderId,
  seedS6Actor,
  seedS6PendingEvidence,
  seedS6Player,
  ZERO_ISSUE235_RESIDUE,
  type S6Refs,
} from './afl-api-adjudication-fixtures';

const testDbUrl = process.env.AFLDB_TEST_DATABASE_URL;

describe('player-link concurrency integration (AFLDB-ISSUE-082)', () => {
  if (!testDbUrl) {
    throw new Error('AFLDB_TEST_DATABASE_URL is not configured');
  }

  // Safety gate
  const dbNameMatch = testDbUrl.match(/\/([^/?]+)(?:\?|$)/);
  const dbName = dbNameMatch ? dbNameMatch[1] : '';
  if (!dbName.endsWith('_test')) {
    throw new Error(`Safety gate failed: AFLDB_TEST_DATABASE_URL database name must end in '_test'. Found: ${dbName}`);
  }

  // We need connections capable of running concurrent transactions.
  // We'll create two isolated SQL instances for T1 and T2, and one for observing.
  const sql1 = postgres(testDbUrl, { max: 1 });
  const sql2 = postgres(testDbUrl, { max: 1 });
  const sqlObserver = postgres(testDbUrl, { max: 1 });

  // Track created IDs for targeted cleanup
  const createdAdminUserIds: number[] = [];
  const createdPlayerIds: number[] = [];
  const createdPersonIds: number[] = [];
  const createdPickIds: number[] = [];

  afterEach(async () => {
    // 1. delete test-owned player_link_resolutions
    if (createdPickIds.length > 0) {
      await sqlObserver`
        DELETE FROM player_link_resolutions
        WHERE target_table = 'draft_picks'
          AND target_id IN ${sqlObserver(createdPickIds)}
      `;
    }
    // 2. delete test-owned draft_picks
    if (createdPickIds.length > 0) {
      await sqlObserver`DELETE FROM draft_picks WHERE id IN ${sqlObserver(createdPickIds)}`;
      createdPickIds.length = 0;
    }
    // 3. delete test-owned draft_persons
    if (createdPersonIds.length > 0) {
      await sqlObserver`DELETE FROM draft_persons WHERE id IN ${sqlObserver(createdPersonIds)}`;
      createdPersonIds.length = 0;
    }
    // 4. delete test-owned players
    if (createdPlayerIds.length > 0) {
      await sqlObserver`DELETE FROM players WHERE id IN ${sqlObserver(createdPlayerIds)}`;
      createdPlayerIds.length = 0;
    }
    // 5. delete test-owned auth_users
    if (createdAdminUserIds.length > 0) {
      await sqlObserver`DELETE FROM auth_users WHERE id IN ${sqlObserver(createdAdminUserIds)}`;
      createdAdminUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await sql1.end();
    await sql2.end();
    await sqlObserver.end();
  });

  // Helper to wait until t2Pid is blocked by t1Pid
  async function waitForBlock(t1Pid: number, t2Pid: number): Promise<void> {
    let attempts = 0;
    while (attempts < 50) {
      const [{ blocking }] = await sqlObserver<{ blocking: number[] }[]>`
        SELECT pg_blocking_pids(${t2Pid}) AS blocking
      `;
      if (blocking && blocking.includes(t1Pid)) {
        return; // Confirmed blocked
      }
      await new Promise(r => setTimeout(r, 50));
      attempts++;
    }
    throw new Error(`Timeout waiting for PID ${t2Pid} to be blocked by PID ${t1Pid}`);
  }

  // Sets up the base draft person and two sibling picks
  async function setupDraftIdentity(): Promise<{ personId: number; pickA: number; pickB: number; playerId: number; adminUserId: number }> {
    const [{ id: adminUserId }] = await sqlObserver<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('admin' || floor(random() * 1000000) || '@example.test', 'admin') RETURNING id
    `;
    createdAdminUserIds.push(adminUserId);

    const [{ id: personId }] = await sqlObserver<{ id: number }[]>`
      INSERT INTO draft_persons (
        source_id, dg_person_id, player_url, display_name_raw, name_key, link_status
      )
      VALUES (
        (SELECT COALESCE((SELECT id FROM sources WHERE key = 'draftguru'), (SELECT min(id) FROM sources))),
        floor(random() * 1000000), '/x', 'John Smith', 'john smith', 'unmatched'
      )
      RETURNING id
    `;
    createdPersonIds.push(personId);

    const [{ id: pickA }] = await sqlObserver<{ id: number }[]>`
      INSERT INTO draft_picks (
        draft_year, draft_type, draft_person_id, player_name_raw, link_status_value
      )
      VALUES (2000, 'national', ${personId}, 'John Smith', 'unmatched')
      RETURNING id
    `;
    createdPickIds.push(pickA);

    const [{ id: pickB }] = await sqlObserver<{ id: number }[]>`
      INSERT INTO draft_picks (
        draft_year, draft_type, draft_person_id, player_name_raw, link_status_value
      )
      VALUES (2000, 'national', ${personId}, 'John Smith', 'unmatched')
      RETURNING id
    `;
    createdPickIds.push(pickB);

    const [{ id: playerId }] = await sqlObserver<{ id: number }[]>`
      INSERT INTO players (slug, display_name, sort_name, search_name)
      VALUES ('john-smith-' || ${personId}, 'John Smith', 'Smith, John', 'john smith') RETURNING id
    `;
    createdPlayerIds.push(playerId);

    return { personId, pickA, pickB, playerId, adminUserId };
  }

  it('Interleaving A (resolve lock first): confirmation waits and rejects', async () => {
    const { personId, pickA, pickB, playerId, adminUserId } = await setupDraftIdentity();

    let resolveResult: any = null;
    let confirmResult: any = null;
    let t2Promise: Promise<any> | null = null;
    let t1Done = false;

    try {
      await sql1.begin(async (tx1) => {
        const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx1`SELECT * FROM draft_persons WHERE id = ${personId} FOR UPDATE`;

        let resolveT2Pid!: (pid: number) => void;
        const t2PidPromise = new Promise<number>(r => resolveT2Pid = r);

        t2Promise = sql2.begin(async (tx2) => {
          const [{ pid: t2Pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          resolveT2Pid(t2Pid);
          return confirmLockedUnlinked(tx2 as any, 'draft_picks', pickB, adminUserId, 'Confirm B');
        });

        const t2Pid = await t2PidPromise;
        await waitForBlock(t1Pid, t2Pid);

        resolveResult = await resolveLockedLink(tx1 as any, {
          targetTable: 'draft_picks',
          targetId: pickA,
          playerId,
          adminUserId,
        });

        t1Done = true;
      });
    } finally {
      if (t2Promise) {
        try {
          confirmResult = await t2Promise;
        } catch (e) {
          // ignore error to allow cleanup to finish
        }
      }
    }

    expect(t1Done).toBe(true);
    expect(resolveResult.ok).toBe(true);
    expect(confirmResult.ok).toBe(false);
    expect(confirmResult.error).toBe('No unresolved row with that id — it may already be linked.');

    const resolutions = await sqlObserver<{ action: string }[]>`
      SELECT action FROM player_link_resolutions
      JOIN draft_picks ON draft_picks.id = player_link_resolutions.target_id
      WHERE draft_picks.draft_person_id = ${personId}
    `;
    expect(resolutions.length).toBe(1);
    expect(resolutions[0].action).toBe('linked');
  });

  it('Interleaving B (confirm lock first): resolve waits and rejects', async () => {
    const { personId, pickA, pickB, playerId, adminUserId } = await setupDraftIdentity();

    let confirmResult: any = null;
    let resolveResult: any = null;
    let t2Promise: Promise<any> | null = null;
    let t1Done = false;

    try {
      await sql1.begin(async (tx1) => {
        const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx1`SELECT * FROM draft_persons WHERE id = ${personId} FOR UPDATE`;

        let resolveT2Pid!: (pid: number) => void;
        const t2PidPromise = new Promise<number>(r => resolveT2Pid = r);

        t2Promise = sql2.begin(async (tx2) => {
          const [{ pid: t2Pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          resolveT2Pid(t2Pid);
          return resolveLockedLink(tx2 as any, {
            targetTable: 'draft_picks',
            targetId: pickB,
            playerId,
            adminUserId,
          });
        });

        const t2Pid = await t2PidPromise;
        await waitForBlock(t1Pid, t2Pid);

        confirmResult = await confirmLockedUnlinked(tx1 as any, 'draft_picks', pickA, adminUserId, 'Confirm A');

        t1Done = true;
      });
    } finally {
      if (t2Promise) {
        try {
          resolveResult = await t2Promise;
        } catch (e) {}
      }
    }

    expect(t1Done).toBe(true);
    expect(confirmResult.ok).toBe(true);
    expect(resolveResult.ok).toBe(false);
    expect(resolveResult.error).toMatch(/already confirmed unlinked and cannot be linked from a stale form/i);

    const resolutions = await sqlObserver<{ action: string }[]>`
      SELECT action FROM player_link_resolutions
      JOIN draft_picks ON draft_picks.id = player_link_resolutions.target_id
      WHERE draft_picks.draft_person_id = ${personId}
    `;
    expect(resolutions.length).toBe(1);
    expect(resolutions[0].action).toBe('confirmed_unlinked');
  });

  it('Interleaving C (confirm vs confirm): exact duplicate suppression', async () => {
    const { personId, pickA, pickB, adminUserId } = await setupDraftIdentity();

    let confirmResult1: any = null;
    let confirmResult2: any = null;
    let t2Promise: Promise<any> | null = null;
    let t1Done = false;

    try {
      await sql1.begin(async (tx1) => {
        const [{ pid: t1Pid }] = await tx1<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await tx1`SELECT * FROM draft_persons WHERE id = ${personId} FOR UPDATE`;

        let resolveT2Pid!: (pid: number) => void;
        const t2PidPromise = new Promise<number>(r => resolveT2Pid = r);

        t2Promise = sql2.begin(async (tx2) => {
          const [{ pid: t2Pid }] = await tx2<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          resolveT2Pid(t2Pid);
          return confirmLockedUnlinked(tx2 as any, 'draft_picks', pickB, adminUserId, 'Confirm B (dup)');
        });

        const t2Pid = await t2PidPromise;
        await waitForBlock(t1Pid, t2Pid);

        confirmResult1 = await confirmLockedUnlinked(tx1 as any, 'draft_picks', pickA, adminUserId, 'Confirm A');

        t1Done = true;
      });
    } finally {
      if (t2Promise) {
        try {
          confirmResult2 = await t2Promise;
        } catch (e) {}
      }
    }

    expect(t1Done).toBe(true);
    expect(confirmResult1.ok).toBe(true);
    expect(confirmResult2.ok).toBe(false);
    expect(confirmResult2.error).toMatch(/already confirmed unlinked by another admin/i);

    const resolutions = await sqlObserver<{ action: string }[]>`
      SELECT action FROM player_link_resolutions
      JOIN draft_picks ON draft_picks.id = player_link_resolutions.target_id
      WHERE draft_picks.draft_person_id = ${personId}
    `;
    expect(resolutions.length).toBe(1);
    expect(resolutions[0].action).toBe('confirmed_unlinked');
  });
});

/**
 * AFLDB-ISSUE-235 S6 (runbook §10.2 I8–I10) — `afl_api` human-adjudication races, with two (or
 * three) real PostgreSQL sessions.
 *
 * `linkAflApiProvider()`/`revokeAflApiLink()` each open their OWN connection and transaction,
 * so the Interleaving A/B/C trick above (running the locked function inside a test-held
 * transaction) does not apply. The barrier is instead a third session, `holder`, that holds the
 * exact lock the racers need -- the D7 advisory lock, an uncommitted loader-style INSERT, or a
 * settle-shaped read of `external_identities` -- until EVERY racer is observed blocked behind it
 * (`pg_blocking_pids`). Only then is it released. No sleep decides an outcome: the short poll in
 * `waitForBlocked()` only paces the check, exactly like `waitForBlock()` above.
 *
 * Fixtures, namespace (`CD_I999235…`) and teardown are shared with settle-afl-api.test.ts
 * through `./afl-api-adjudication-fixtures.ts`; the adjudication writes go through the import
 * DSN `routeS6ImportDsn()` routes (the `afldb_import` role when configured).
 */
describe('AFLDB-ISSUE-235 S6 (I8–I10): afl_api adjudication races', () => {
  const ownerUrl = process.env.AFLDB_TEST_DATABASE_URL as string;
  const holder = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  const observer = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  let refs: S6Refs;
  let actorId: number;
  let restoreImportDsn: (() => void) | undefined;

  beforeAll(async () => {
    refs = await loadS6Refs(observer);
    restoreImportDsn = (await routeS6ImportDsn()).restore;
    await cleanupS6Fixtures(observer, refs);
  });

  beforeEach(async () => {
    actorId = await seedS6Actor(observer);
  });

  afterEach(async () => {
    await cleanupS6Fixtures(observer, refs);
  });

  afterAll(async () => {
    await cleanupS6Fixtures(observer, refs);
    restoreImportDsn?.();
    await holder.end({ timeout: 5 });
    await observer.end({ timeout: 5 });
  });

  /**
   * Runs `work` in a transaction on `holder` and keeps it OPEN until `release()`, which then
   * commits it. Resolves once `work` has finished, with the holder's backend pid.
   */
  async function holdOpen(
    work: (tx: postgres.TransactionSql) => Promise<void>,
  ): Promise<{ pid: number; release: () => Promise<void> }> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let ready!: (pid: number) => void;
    const readyPid = new Promise<number>((resolve) => { ready = resolve; });
    const transaction = holder.begin(async (tx) => {
      const [{ pid }] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await work(tx);
      ready(pid);
      await released;
    });
    const endedEarly = transaction.then(() => {
      throw new Error('The holding transaction ended before it was released.');
    });
    endedEarly.catch(() => undefined); // observed only through the race below
    const pid = await Promise.race([readyPid, endedEarly]);
    return { pid, release: async () => { release(); await transaction; } };
  }

  function holdAdvisoryLock(key: string) {
    return holdOpen(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    });
  }

  /**
   * Start every racer, wait until ALL of them are blocked behind `held` (the barrier), then
   * release it. A racer that finishes before it ever blocks means the race was not constructed
   * -- it failed or returned early -- so that is reported at once, with its own result, rather
   * than being mistaken for a slow lock wait.
   */
  async function releaseWhenAllBlocked<T>(
    held: { pid: number; release: () => Promise<void> }, racers: readonly (() => Promise<T>)[],
  ): Promise<T[]> {
    const finishedEarly: string[] = [];
    const running = racers.map((start) => {
      const racer = start();
      racer.then(
        (value) => { finishedEarly.push(JSON.stringify(value)); },
        (error: unknown) => { finishedEarly.push(error instanceof Error ? error.message : String(error)); },
      );
      return racer;
    });
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (finishedEarly.length > 0) {
          throw new Error(`A racer finished before it blocked behind pid ${held.pid}: ${finishedEarly[0]}`);
        }
        const blocked = await observer<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${held.pid} = ANY(pg_blocking_pids(pid))
        `;
        if (blocked.length >= running.length) break;
        if (attempt >= 400) throw new Error(`Timed out waiting for ${running.length} backend(s) to block behind pid ${held.pid}.`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } catch (error) {
      await held.release();
      await Promise.allSettled(running);
      throw error;
    }
    await held.release();
    return Promise.all(running);
  }

  function link(providerId: string, playerId: number, fingerprint: string | null): Promise<LinkAflApiProviderResult> {
    if (fingerprint === null) throw new Error(`The admin page rendered no link fingerprint for ${providerId}.`);
    return linkAflApiProvider({
      providerId, playerId, adminUserId: actorId, note: S6_NOTE, surnameAcknowledged: false, fingerprint,
    });
  }

  async function aflApiRows(where: { providerIds?: string[]; playerIds?: number[] }) {
    return observer<{ externalId: string; playerId: number | null; status: string; matchMethod: string | null }[]>`
      SELECT external_id AS "externalId", player_id AS "playerId", status::text AS status, match_method AS "matchMethod"
        FROM external_identities
       WHERE source_id = ${refs.aflApiSourceId}
         AND (external_id = ANY(${where.providerIds ?? []}::text[]) OR player_id = ANY(${where.playerIds ?? []}::int[]))
       ORDER BY id
    `;
  }

  it('I8 — two links for the same provider to different players, released together from the provider lock: one resolved row, one audit row, the other refused as stale', async () => {
    const provider = s6ProviderId(801);
    const x = await seedS6Player(observer, refs, { key: 801 });
    const y = await seedS6Player(observer, refs, { key: 802 });
    await seedS6PendingEvidence(observer, refs, { providerId: provider, match: 801 });
    const form = await renderS6Form(provider); // both admins loaded the same page

    const held = await holdAdvisoryLock(`afl_api_identity:provider:${provider}`);
    const [forX, forY] = await releaseWhenAllBlocked(held, [
      () => link(provider, x.id, form.linkFingerprint),
      () => link(provider, y.id, form.linkFingerprint),
    ]);

    expect([forX, forY].filter((r) => r.ok)).toHaveLength(1);
    const loser = forX.ok ? forY : forX;
    expect(loser).toMatchObject({ ok: false, code: 'T6_stale_fingerprint' });
    const winner = forX.ok ? x.id : y.id;
    expect(await aflApiRows({ providerIds: [provider], playerIds: [x.id, y.id] })).toEqual([
      { externalId: provider, playerId: winner, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
    ]);
    const ledger = await s6LedgerRows(observer, [provider]);
    expect(ledger.map((r) => [r.action, r.playerId])).toEqual([['linked', winner]]);
  }, 90_000);

  it('I9 — two providers linked to the same player, released together from the player lock: one wins, the other is refused as a collision; the index backs it up', async () => {
    const [p1, p2] = [s6ProviderId(901), s6ProviderId(902)];
    const player = await seedS6Player(observer, refs, { key: 901 });
    await seedS6PendingEvidence(observer, refs, { providerId: p1, match: 901 });
    await seedS6PendingEvidence(observer, refs, { providerId: p2, match: 902 });
    const [form1, form2] = [await renderS6Form(p1), await renderS6Form(p2)];

    // Each racer takes its OWN provider lock unopposed, then queues on the shared player lock.
    const held = await holdAdvisoryLock(`afl_api_identity:player:${player.id}`);
    const [r1, r2] = await releaseWhenAllBlocked(held, [
      () => link(p1, player.id, form1.linkFingerprint),
      () => link(p2, player.id, form2.linkFingerprint),
    ]);

    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    const [winner, loser, loserResult] = r1.ok ? [p1, p2, r2] : [p2, p1, r1];
    expect(loserResult).toMatchObject({ ok: false, code: 'T4_player_holds_another_provider' });
    expect(loserResult.ok ? '' : loserResult.error).toContain(winner);
    expect(await aflApiRows({ providerIds: [p1, p2], playerIds: [player.id] })).toEqual([
      { externalId: winner, playerId: player.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
    ]);
    const ledger = await s6LedgerRows(observer, [p1, p2]);
    expect(ledger.map((r) => [r.externalId, r.action])).toEqual([[winner, 'linked']]);

    // Migration 104's one-provider-per-player index is the backstop for a writer that takes no
    // lock (the bridge loader, D7): a second afl_api row for the player cannot be committed.
    await expect(observer`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.aflApiSourceId}, ${loser}, ${player.id}, 'unique', 1, 'afl_api_stat_vector_season')
    `).rejects.toMatchObject({ code: '23505' });
    expect(await aflApiRows({ providerIds: [p1, p2], playerIds: [player.id] })).toHaveLength(1);
  }, 90_000);

  it('I10 — an admin link racing a raw bridge-style INSERT of the same provider: exactly one row, and the admin side reports stale on 23505; loader-second fails closed on both unique constraints', async () => {
    const provider = s6ProviderId(1001);
    const x = await seedS6Player(observer, refs, { key: 1001 });
    const y = await seedS6Player(observer, refs, { key: 1002 });
    await seedS6PendingEvidence(observer, refs, { providerId: provider, match: 1001 });
    const form = await renderS6Form(provider);

    // Loader first: its INSERT is uncommitted (the loader takes no advisory lock, D7), so the
    // admin transaction sees no row, passes every check, and its own INSERT then waits on the
    // unique index entry until the loader commits.
    const loader = await holdOpen(async (tx) => {
      await tx`
        INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
        VALUES (${refs.aflApiSourceId}, ${provider}, ${y.id}, 'unique', 1, 'afl_api_stat_vector_season')
      `;
    });
    const [adminResult] = await releaseWhenAllBlocked(loader, [() => link(provider, x.id, form.linkFingerprint)]);
    expect(adminResult).toMatchObject({ ok: false, code: 'T6_stale_fingerprint' });
    expect(await aflApiRows({ providerIds: [provider], playerIds: [x.id, y.id] })).toEqual([
      { externalId: provider, playerId: y.id, status: 'unique', matchMethod: 'afl_api_stat_vector_season' },
    ]);
    expect(await s6LedgerRows(observer, [provider])).toEqual([]); // the audit INSERT rolled back with it

    // Admin first: the committed human row wins; a later loader INSERT fails closed on the
    // provider's own uniqueness and, for another provider, on the one-provider-per-player index.
    const second = s6ProviderId(1003);
    await seedS6PendingEvidence(observer, refs, { providerId: second, match: 1003 });
    const secondForm = await renderS6Form(second);
    expect(await link(second, x.id, secondForm.linkFingerprint)).toEqual({ ok: true });
    await expect(observer`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.aflApiSourceId}, ${second}, ${y.id}, 'unique', 1, 'afl_api_stat_vector_season')
    `).rejects.toMatchObject({ code: '23505' });
    await expect(observer`
      INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES (${refs.aflApiSourceId}, ${s6ProviderId(1004)}, ${x.id}, 'unique', 1, 'afl_api_stat_vector_season')
    `).rejects.toMatchObject({ code: '23505' });
    expect(await aflApiRows({ providerIds: [second, s6ProviderId(1004)], playerIds: [x.id] })).toEqual([
      { externalId: second, playerId: x.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
    ]);
    expect((await s6LedgerRows(observer, [second])).map((r) => r.action)).toEqual(['linked']);
  }, 90_000);

  it('I10 (revoke race; the brief\'s I10) — a revoke racing an in-flight consumer of the link waits for it, sees its committed use, and refuses: one serial order, no lost decision, no orphan ledger row', async () => {
    const provider = s6ProviderId(1101);
    const player = await seedS6Player(observer, refs, { key: 1101 });
    await seedS6PendingEvidence(observer, refs, { providerId: provider, match: 1101 });
    const linkForm = await renderS6Form(provider);
    expect(await link(provider, player.id, linkForm.linkFingerprint)).toEqual({ ok: true });
    const revokeForm = await renderS6Form(provider); // rendered while the link is still unused

    // The consumer: a settle-shaped transaction that resolved the provider THROUGH the link
    // (holding ACCESS SHARE on external_identities) and wrote a LINK_DEPENDENT fact, not yet
    // committed. The revoke's ACCESS EXCLUSIVE request queues behind it, inside its 2 s
    // lock_timeout, and the consumer commits the moment the revoke is seen waiting.
    const consumer = await holdOpen(async (tx) => {
      const [resolved] = await tx<{ playerId: number }[]>`
        SELECT player_id AS "playerId" FROM external_identities
         WHERE source_id = ${refs.aflApiSourceId} AND external_id = ${provider} AND status IN ('unique', 'resolved')
      `;
      await insertS6BrownlowVote(tx, refs, { playerId: resolved.playerId, roundNumber: 24, sourceRecordId: s6MatchId(1101) });
    });
    const [revoked] = await releaseWhenAllBlocked(consumer, [() => revokeAflApiLink({
      providerId: provider, adminUserId: actorId, note: S6_NOTE, fingerprint: revokeForm.revokeFingerprint!,
    })]);

    // Serial order: consumer, then revoke. The revoke's proof ran after the consumer committed
    // and saw its row, so it refused rather than deleting a link that had just been used.
    expect(revoked).toMatchObject({ ok: false, code: 'T19_revoke_unprovable' });
    expect(revoked.ok ? '' : revoked.error).toContain('public.brownlow_round_votes');
    expect(await aflApiRows({ providerIds: [provider] })).toEqual([
      { externalId: provider, playerId: player.id, status: 'resolved', matchMethod: 'afl_api_admin_adjudication' },
    ]);
    expect((await s6LedgerRows(observer, [provider])).map((r) => r.action)).toEqual(['linked']);
    const [{ n }] = await observer<{ n: number }[]>`
      SELECT count(*)::int AS n FROM brownlow_round_votes
       WHERE player_id = ${player.id} AND source_id = ${refs.aflApiSourceId}
    `;
    expect(n).toBe(1);
  }, 90_000);
});

/**
 * AFLDB-ISSUE-235 S6 — the races' fixture-leftover gate. Its own describe, after the race
 * describe's teardown, with no per-case seeding of its own; it deletes nothing.
 */
describe('AFLDB-ISSUE-235 S6 (I8–I10) fixture-leftover gate', () => {
  it('I8–I10 fixture-leftover gate — the races leave zero ISSUE-235 fixture rows', async () => {
    const db = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 1, onnotice: () => {} });
    try {
      const refs = await loadS6Refs(db);
      expect(await issue235FixtureResidue(db, refs)).toEqual(ZERO_ISSUE235_RESIDUE);
    } finally {
      await db.end({ timeout: 5 });
    }
  });
});
