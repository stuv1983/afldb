import { afterAll, afterEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { resolveLockedLink, confirmLockedUnlinked } from '@/db/queries/player-links';

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
