import postgres from 'postgres';

/**
 * A cross-file mutex for the draft tables.
 *
 * Vitest runs test FILES in parallel, and two of them care about the same
 * rows in opposite ways:
 *
 *   draft-reload-links.test.ts  links real draft people to fixture players
 *                               and reloads the draft repeatedly, for over
 *                               two minutes.
 *   release-gates.test.ts       asserts the exact number of draft people
 *                               the source resolves (5,057 people, 3,459
 *                               linked, 1,498 never played).
 *
 * Run concurrently, the gate counts the fixture links and fails on numbers
 * that are correct for the moment it read them. Neither assertion is wrong,
 * so neither is weakened: they are serialised instead.
 *
 * A PostgreSQL advisory lock is the right shape for this because it is held
 * by a SESSION, survives across the many statements and sub-processes a
 * reload spans, and is released automatically if the holder dies. It is
 * taken on a dedicated single connection: the shared pooled client would be
 * free to run the unlock on a different backend from the lock.
 */
const DRAFT_RELOAD_LOCK = 780_001;

let holder: postgres.Sql | null = null;

/** Blocks until no other test file is mutating the draft tables. */
export async function lockDraftTables(): Promise<void> {
  if (holder) throw new Error('the draft table lock is already held by this file');
  const client = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, {
    max: 1,
    onnotice: () => {},
  });
  await client`SELECT pg_advisory_lock(${DRAFT_RELOAD_LOCK})`;
  holder = client;
}

/** Safe to call even if the lock was never taken. */
export async function unlockDraftTables(): Promise<void> {
  if (!holder) return;
  const client = holder;
  holder = null;
  try {
    await client`SELECT pg_advisory_unlock(${DRAFT_RELOAD_LOCK})`;
  } finally {
    await client.end({ timeout: 5 });
  }
}
