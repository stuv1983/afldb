/**
 * AFLDB-ISSUE-157 — the audit viewer's readers against a real PostgreSQL.
 *
 * tests/admin-audit-viewer.test.ts proves what SQL the readers send. Only
 * the database can prove that SQL selects the right rows: that an actor
 * search reaches the recorded label AND the account's current email, that
 * the calendar-date bounds are UTC and inclusive at both ends, that the
 * bigint ids come back as exact strings and the jsonb payloads as objects,
 * and that paging clamps.
 *
 * Safety: every statement runs inside one transaction that is always rolled
 * back (the auth-audit-jsonb.test.ts / database.test.ts Rollback idiom), so
 * the two append-only ledgers receive no committed row and the throwaway
 * accounts never exist outside it. The readers take the transaction as
 * their handle, exactly as production hands them the auth pool. The suite
 * refuses to run outside a _test database (tests/setup.ts, guard.ts).
 *
 * Fixture ids are read back from RETURNING as text and every assertion
 * scopes itself to those ids or to the unique fixture emails, so whatever
 * afldb_test already holds in these tables cannot change a result.
 */
import './guard';

import { randomInt } from 'node:crypto';

import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  listAuthAuditActions,
  listAuthAuditEvents,
  listDataEditHistory,
  listDataEdits,
} from '@/db/queries/audit-reader';

class Rollback extends Error {}

type Db = postgres.Sql;

async function rolledBack(run: (tx: Db) => Promise<void>): Promise<void> {
  await expect(
    sql.begin(async (tx) => {
      await run(tx as unknown as Db);
      throw new Rollback('rolled back on purpose');
    }),
  ).rejects.toThrow('rolled back on purpose');
}

/**
 * Letters only, and no digits anywhere in a fixture email or label: the
 * actor search also matches an all-digit term against the user id, and a
 * fixture address that happened to contain those digits would make the
 * "by id" assertions depend on which ids the sequence handed out.
 */
const RUN = Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(26)]).join('');

type Fixture = {
  alice: { id: number; email: string };
  bob: { id: number; email: string };
  /** auth_audit_log ids as the driver returns bigint: strings. */
  e1: string; e2: string; e3: string;
  /** data_edits ids, likewise. */
  d1: string; d2: string; d3: string;
  playerRow: string;
};

async function seed(tx: Db): Promise<Fixture> {
  const account = async (tag: string) => {
    const [row] = await tx<{ id: number; email: string }[]>`
      INSERT INTO auth_users (email, role)
      VALUES (${`audit-${tag}-${RUN}@example.test`}, 'admin')
      RETURNING id, email
    `;
    return row;
  };
  const alice = await account('alice');
  const bob = await account('bob');

  const event = async (
    actorUserId: number | null, actorLabel: string | null, action: string,
    detail: Record<string, unknown> | null, at: string,
  ) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail, at)
      VALUES (${actorUserId}, ${actorLabel}, ${action},
              ${detail ? tx.json(detail as postgres.JSONValue) : null}, ${at}::timestamptz)
      RETURNING id::text AS id
    `;
    return row.id;
  };
  // The recorded label is the address at the time; alice's is deliberately
  // NOT her current email, so the actor search has to reach both.
  const e1 = await event(alice.id, `old-alice-${RUN}@example.test`, `i157.alpha.${RUN}`,
    { deletedLogRows: 4953, nested: { ok: true } }, '2001-02-03T10:00:00Z');
  const e2 = await event(null, `ghost-${RUN}@example.test`, `i157.beta.${RUN}`, null, '2001-02-05T10:00:00Z');
  const e3 = await event(bob.id, bob.email, `i157.alpha.${RUN}`, { n: 1 }, '2001-02-05T23:59:59Z');

  // A row id past 2^31 and past 2^53: exact only as a string.
  const playerRow = '9007199254740993';
  const edit = async (
    table: string, rowId: string, fieldGroup: string,
    oldValues: Record<string, unknown>, newValues: Record<string, unknown>,
    adminUserId: number, note: string | null, createdAt: string,
  ) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO data_edits (table_name, row_id, field_group, old_values, new_values,
                              admin_user_id, note, created_at)
      VALUES (${table}, ${rowId}::bigint, ${fieldGroup},
              ${tx.json(oldValues as postgres.JSONValue)}, ${tx.json(newValues as postgres.JSONValue)},
              ${adminUserId}, ${note}, ${createdAt}::timestamptz)
      RETURNING id::text AS id
    `;
    return row.id;
  };
  const d1 = await edit('players', playerRow, 'dob',
    { dob: '1990-01-01', dob_confidence: 'sourced' }, { dob: '1990-01-02', dob_confidence: 'sourced' },
    alice.id, `i157 ${RUN} dob`, '2001-02-03T10:00:00Z');
  const d2 = await edit('players', playerRow, 'height_cm',
    { height_cm: null }, { height_cm: 188 }, bob.id, null, '2001-02-05T23:59:59Z');
  const d3 = await edit('matches', '5', 'score',
    { home_goals: 12, home_behinds: 9 }, { home_goals: 13, home_behinds: 9 },
    alice.id, `i157 ${RUN} score`, '2001-02-04T10:00:00Z');

  return { alice, bob, e1, e2, e3, d1, d2, d3, playerRow };
}

const ids = <T extends { id: string }>(rows: T[]) => rows.map((row) => row.id);

describe('auth_audit_log reader (AFLDB-ISSUE-157)', () => {
  it('filters by exact action, newest first, with bigint ids as strings and jsonb detail as an object', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);

      const page = await listAuthAuditEvents({ action: `i157.alpha.${RUN}` }, 1, 50, tx);

      expect(page.total).toBe(2);
      expect(ids(page.rows)).toEqual([f.e3, f.e1]);
      for (const row of page.rows) {
        expect(typeof row.id).toBe('string');
        expect(row.id).toMatch(/^\d+$/);
        expect(row.at).toBeInstanceOf(Date);
      }
      const alpha = page.rows[1];
      expect(alpha.detail).toEqual({ deletedLogRows: 4953, nested: { ok: true } });
      expect(alpha.actorUserId).toBe(f.alice.id);
      expect(alpha.actorLabel).toBe(`old-alice-${RUN}@example.test`);
      expect(alpha.actorEmail).toBe(f.alice.email);
      expect(alpha.ip).toBeNull();
    });
  });

  it('matches an actor search against the recorded label, the current email, and an all-digit user id', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);
      const alpha = `i157.alpha.${RUN}`;

      // Current email: the label on e1 is the OLD address, so this reaches
      // the row only through the auth_users join.
      const byEmail = await listAuthAuditEvents({ actor: `alice-${RUN}`, action: alpha }, 1, 50, tx);
      expect(ids(byEmail.rows)).toEqual([f.e1]);

      // Recorded label only: e2 has no actor id at all.
      const byLabel = await listAuthAuditEvents({ actor: `ghost-${RUN}` }, 1, 50, tx);
      expect(ids(byLabel.rows)).toEqual([f.e2]);

      // Digits: the user id, as well as any label/email containing them.
      const byId = await listAuthAuditEvents({ actor: String(f.bob.id), action: alpha }, 1, 50, tx);
      expect(ids(byId.rows)).toEqual([f.e3]);

      // Case-insensitive, and a literal % is a character, not a wildcard.
      const upper = await listAuthAuditEvents({ actor: `GHOST-${RUN.toUpperCase()}` }, 1, 50, tx);
      expect(ids(upper.rows)).toEqual([f.e2]);
      const wildcard = await listAuthAuditEvents({ actor: `%-${RUN}`, action: alpha }, 1, 50, tx);
      expect(wildcard.total).toBe(0);
    });
  });

  it('bounds by UTC calendar date, inclusive at both ends', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);
      const alpha = `i157.alpha.${RUN}`;

      // e1 is on the 3rd, e3 is at 23:59:59Z on the 5th.
      expect(ids((await listAuthAuditEvents({ action: alpha, from: '2001-02-04' }, 1, 50, tx)).rows)).toEqual([f.e3]);
      expect(ids((await listAuthAuditEvents({ action: alpha, to: '2001-02-04' }, 1, 50, tx)).rows)).toEqual([f.e1]);
      expect(ids((await listAuthAuditEvents({ action: alpha, to: '2001-02-05' }, 1, 50, tx)).rows)).toEqual([f.e3, f.e1]);
      expect((await listAuthAuditEvents({ action: alpha, from: '2001-02-06' }, 1, 50, tx)).total).toBe(0);
      expect(ids((await listAuthAuditEvents({ action: alpha, from: '2001-02-03', to: '2001-02-03' }, 1, 50, tx)).rows)).toEqual([f.e1]);
    });
  });

  it('pages server-side and clamps a page past the end', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);
      const alpha = `i157.alpha.${RUN}`;

      const first = await listAuthAuditEvents({ action: alpha }, 1, 1, tx);
      expect(first).toMatchObject({ total: 2, page: 1, pageSize: 1, totalPages: 2 });
      expect(ids(first.rows)).toEqual([f.e3]);

      const second = await listAuthAuditEvents({ action: alpha }, 2, 1, tx);
      expect(ids(second.rows)).toEqual([f.e1]);

      const past = await listAuthAuditEvents({ action: alpha }, 9, 1, tx);
      expect(past.page).toBe(2);
      expect(ids(past.rows)).toEqual([f.e1]);
    });
  });

  it('lists the distinct action keys the trail holds', async () => {
    await rolledBack(async (tx) => {
      await seed(tx);
      const actions = await listAuthAuditActions(tx);
      expect(actions).toContain(`i157.alpha.${RUN}`);
      expect(actions).toContain(`i157.beta.${RUN}`);
      // Distinct: two fixture rows share the alpha key and it appears once.
      expect(actions.filter((a) => a === `i157.alpha.${RUN}`)).toHaveLength(1);
    });
  });
});

describe('data_edits reader (AFLDB-ISSUE-157)', () => {
  it('filters by entity with the row id exact as a string, newest first, snapshots as objects', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);

      const page = await listDataEdits({ table: 'players', rowId: f.playerRow }, 1, 50, tx);

      expect(page.total).toBe(2);
      expect(ids(page.rows)).toEqual([f.d2, f.d1]);
      const dob = page.rows[1];
      expect(dob.rowId).toBe('9007199254740993');
      expect(typeof dob.rowId).toBe('string');
      expect(dob.oldValues).toEqual({ dob: '1990-01-01', dob_confidence: 'sourced' });
      expect(dob.newValues).toEqual({ dob: '1990-01-02', dob_confidence: 'sourced' });
      expect(dob.adminUserId).toBe(f.alice.id);
      expect(dob.adminEmail).toBe(f.alice.email);
      expect(dob.note).toBe(`i157 ${RUN} dob`);
      // NULL inside a snapshot survives as null, not as 0 or ''.
      expect(page.rows[0].oldValues).toEqual({ height_cm: null });
    });
  });

  it('filters by actor, table, field group and date, all bound', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);

      const byActor = await listDataEdits({ actor: `alice-${RUN}` }, 1, 50, tx);
      expect(ids(byActor.rows)).toEqual([f.d3, f.d1]);

      // Scoped to the fixture row: another suite's admin whose email happens
      // to contain these digits must not widen the result.
      const byActorId = await listDataEdits(
        { actor: String(f.bob.id), table: 'players', rowId: f.playerRow }, 1, 50, tx,
      );
      expect(ids(byActorId.rows)).toEqual([f.d2]);

      const byField = await listDataEdits({ actor: `alice-${RUN}`, fieldGroup: 'score' }, 1, 50, tx);
      expect(ids(byField.rows)).toEqual([f.d3]);

      const byTable = await listDataEdits({ actor: `-${RUN}`, table: 'matches' }, 1, 50, tx);
      expect(ids(byTable.rows)).toEqual([f.d3]);

      // d1 on the 3rd, d3 on the 4th, d2 at 23:59:59Z on the 5th.
      const window = await listDataEdits({ actor: `-${RUN}`, from: '2001-02-04', to: '2001-02-05' }, 1, 50, tx);
      expect(ids(window.rows)).toEqual([f.d2, f.d3]);
      const upTo = await listDataEdits({ actor: `-${RUN}`, to: '2001-02-04' }, 1, 50, tx);
      expect(ids(upTo.rows)).toEqual([f.d3, f.d1]);
    });
  });

  it('gives one entity its whole history, newest first', async () => {
    await rolledBack(async (tx) => {
      const f = await seed(tx);

      const history = await listDataEditHistory('players', f.playerRow, tx);
      expect(ids(history)).toEqual([f.d2, f.d1]);
      expect(history.map((h) => h.fieldGroup)).toEqual(['height_cm', 'dob']);
      expect(history.map((h) => h.adminEmail)).toEqual([f.bob.email, f.alice.email]);

      expect(await listDataEditHistory('matches', f.playerRow, tx)).toEqual([]);
      expect(await listDataEditHistory('players', '1', tx)).not.toContainEqual(
        expect.objectContaining({ id: f.d1 }),
      );
    });
  });
});
