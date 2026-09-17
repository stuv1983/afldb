/**
 * The retired-only rule, evaluated by PostgreSQL (AFLDB-ISSUE-117).
 *
 * A code is deletable when it is revoked or spent, and not otherwise.
 * tests/admin-access-actions.test.ts proves the server action issues a
 * DELETE carrying both limbs and refuses whatever it does not match.
 * That is a statement about the code. This file is the statement about
 * the database: the same predicate, run by the same query function the
 * action calls, against real rows in a real cluster. Between them the
 * guard is checked at both ends, which matters because a rule that only
 * ever exists as a string in a test regex is a rule nobody has run.
 *
 * The cases that earn their place are the boundaries, not the happy
 * path: a PARTLY USED code and an UNLIMITED one are both still
 * redeemable and must survive, and only PostgreSQL evaluating
 * `use_count >= max_uses` against a real NULL settles the second.
 *
 * Each case inserts its own code and removes it again, so the suite
 * leaves beta_access_codes as it found it — this is the shared, mutable
 * afldb_test (AFLDB-ISSUE-108) and the auth tables are nobody's fixture.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { deleteRetiredAccessCode } from '@/db/queries/access-codes';

/** A label no real code would carry, so a leaked row is obvious. */
const LABEL = 'ISSUE-117 integration fixture';

afterAll(async () => {
  // Nothing should survive withCode's finally, but this suite writes to a
  // shared afldb_test and a leaked auth row would outlive the run.
  await sql`DELETE FROM beta_access_codes WHERE label = ${LABEL}`;
  await sql.end();
});

type Seed = {
  revoked: boolean;
  /** Uses already consumed. Equal to maxUses makes the code spent. */
  useCount?: number;
  /** Null is unlimited (migration 036) and can never be spent. */
  maxUses?: number | null;
};

/**
 * Run `body` against a freshly inserted code, then remove the fixture.
 *
 * Cleanup is an explicit DELETE in a `finally` rather than a rolled-back
 * transaction: rolling back would mean throwing out of `sql.begin` and
 * smuggling the result past the rethrow, which couples the suite to how
 * postgres.js propagates a non-Error. This way the fixture is gone
 * whether the body deleted it, refused to, or threw.
 *
 * The insert supplies its own code_hash — the column is NOT NULL UNIQUE
 * and nothing here needs a redeemable code, only a row.
 */
async function withCode<T>(
  seed: Seed,
  body: (tx: Parameters<typeof deleteRetiredAccessCode>[0], id: number) => Promise<T>,
): Promise<T> {
  const [created] = await sql<{ id: number }[]>`
    INSERT INTO beta_access_codes (code_hash, label, max_uses, use_count, revoked_at)
    VALUES (${`issue-117-${Math.random().toString(36).slice(2)}`}, ${LABEL},
            ${seed.maxUses === undefined ? 1 : seed.maxUses},
            ${seed.useCount ?? 0},
            ${seed.revoked ? new Date() : null})
    RETURNING id
  `;
  const id = created!.id;

  try {
    return await sql.begin(async (tx) => body(tx, id)) as T;
  } finally {
    await sql`DELETE FROM beta_access_codes WHERE id = ${id}`;
  }
}

describe('deleteRetiredAccessCode', () => {
  it('deletes a revoked code and reports what it removed', async () => {
    const deleted = await withCode({ revoked: true }, async (tx, id) => {
      const row = await deleteRetiredAccessCode(tx, id);
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes WHERE id = ${id}
      `;
      return { row, remaining: count };
    });

    expect(deleted.row).not.toBeNull();
    expect(deleted.row!.label).toBe(LABEL);
    expect(deleted.row!.revokedAt).toBeInstanceOf(Date);
    // The row is gone, so it can no longer reach the admin list — that
    // page selects every code with no state filter (src/app/admin/access/
    // page.tsx), so absence from the table IS absence from the UI.
    expect(deleted.remaining).toBe('0');
  });

  it('refuses an active unused code and leaves it in place', async () => {
    // The forged-request case: a hand-rolled POST naming a live code's id
    // reaches exactly this statement, with no button having been hidden
    // from it and no client-side check in its way.
    const attempted = await withCode({ revoked: false }, async (tx, id) => {
      const row = await deleteRetiredAccessCode(tx, id);
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes WHERE id = ${id}
      `;
      return { row, remaining: count };
    });

    expect(attempted.row).toBeNull();
    expect(attempted.remaining).toBe('1');
  });

  it('deletes a SPENT code that was never revoked', async () => {
    // The manual-validation finding. use_count has reached max_uses, so
    // redeemBetaCode already refuses it; requiring an admin to revoke it
    // first was ceremony that changed nothing.
    const deleted = await withCode({ revoked: false, maxUses: 2, useCount: 2 }, async (tx, id) => {
      const row = await deleteRetiredAccessCode(tx, id);
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes WHERE id = ${id}
      `;
      return { row, remaining: count };
    });

    expect(deleted.row).not.toBeNull();
    // Deleted for being spent, not for having been revoked.
    expect(deleted.row!.revokedAt).toBeNull();
    expect(deleted.row!.useCount).toBe(2);
    expect(deleted.row!.maxUses).toBe(2);
    expect(deleted.remaining).toBe('0');
  });

  it('refuses a PARTLY USED code, which can still be redeemed', async () => {
    // The boundary the widened rule must not cross. Two of five uses gone
    // is still three admissions available, so this code is not retired and
    // deleting it would be a silent revoke without a revocation record.
    const attempted = await withCode({ revoked: false, maxUses: 5, useCount: 2 }, async (tx, id) => {
      const row = await deleteRetiredAccessCode(tx, id);
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes WHERE id = ${id}
      `;
      return { row, remaining: count };
    });

    expect(attempted.row).toBeNull();
    expect(attempted.remaining).toBe('1');
  });

  it('refuses an UNLIMITED code however many times it has been used', async () => {
    // NULL max_uses means unlimited (migration 036), so `use_count >=
    // max_uses` is NULL rather than true and the code is never spent. It
    // stays redeemable forever and can only be disposed of by revoking it
    // first -- exactly what migration 036 means by "unlimited means
    // uncapped, not unrevocable".
    const attempted = await withCode({ revoked: false, maxUses: null, useCount: 99 }, async (tx, id) => {
      const row = await deleteRetiredAccessCode(tx, id);
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes WHERE id = ${id}
      `;
      return { row, remaining: count };
    });

    expect(attempted.row).toBeNull();
    expect(attempted.remaining).toBe('1');
  });

  it('deletes a code that is both revoked and spent, reporting it as revoked', async () => {
    // Both limbs true at once. It must delete (not error on ambiguity),
    // and revoked_at must survive into the row so the audit can say which
    // rule the admin was acting on.
    const deleted = await withCode({ revoked: true, maxUses: 3, useCount: 3 }, (tx, id) =>
      deleteRetiredAccessCode(tx, id));

    expect(deleted).not.toBeNull();
    expect(deleted!.revokedAt).toBeInstanceOf(Date);
  });

  it('fails cleanly on an id that does not exist', async () => {
    // No row, no error, no exception: the caller gets the same null a
    // live code gets and turns both into one refusal.
    const row = await withCode({ revoked: true }, async (tx, id) => {
      await deleteRetiredAccessCode(tx, id);
      // Deleting the same id twice is the already-deleted case.
      return deleteRetiredAccessCode(tx, id);
    });

    expect(row).toBeNull();
  });

  it('touches only the code it was given', async () => {
    // A missing or mistyped `id = ` would delete the whole table and pass
    // every assertion above, since each of those looks only at its own row.
    const survivors = await withCode({ revoked: true }, async (tx, id) => {
      const [{ count: before }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes
      `;
      await deleteRetiredAccessCode(tx, id);
      const [{ count: after }] = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM beta_access_codes
      `;
      return { before: Number(before), after: Number(after) };
    });

    expect(survivors.after).toBe(survivors.before - 1);
  });
});
