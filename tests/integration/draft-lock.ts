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
 *
 * AFLDB-ISSUE-090 adds a third lock for the birth-date enrichment passes'
 * dob_conflict/dob_internal_conflict/dob_disputed state, protecting it
 * against tests/integration/release-gates.test.ts -> `gate: birth dates`
 * the same way the two locks above protect draft and honours.
 *
 * Acquisition order, honoured everywhere more than one lock is held in the
 * same file (today only release-gates.test.ts, which takes honours then
 * birth dates then draft): honours (780_002) -> birth dates (780_003) ->
 * draft (780_001). A deadlock needs two holders acquiring two locks in
 * opposite orders; no other file takes more than one of these locks, so
 * that case is unreachable.
 */
const DRAFT_RELOAD_LOCK = 780_001;
const HONOURS_RELOAD_LOCK = 780_002;
const BIRTH_DATE_ENRICH_LOCK = 780_003;

let draftHolder: postgres.Sql | null = null;
let honoursHolder: postgres.Sql | null = null;
let birthDateHolder: postgres.Sql | null = null;

/** Blocks until no other test file is mutating the draft tables. */
export async function lockDraftTables(dsn: string): Promise<void> {
  if (!dsn) return;
  if (draftHolder) throw new Error('the draft table lock is already held by this file');
  const client = postgres(dsn, {
    max: 1,
    onnotice: () => {},
  });
  await client`SELECT pg_advisory_lock(${DRAFT_RELOAD_LOCK})`;
  draftHolder = client;
}

/** Safe to call even if the lock was never taken. */
export async function unlockDraftTables(): Promise<void> {
  if (!draftHolder) return;
  const client = draftHolder;
  draftHolder = null;
  try {
    await client`SELECT pg_advisory_unlock(${DRAFT_RELOAD_LOCK})`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Blocks until no other test file is mutating the honours tables. */
export async function lockHonoursTables(dsn: string): Promise<void> {
  if (!dsn) return;
  if (honoursHolder) throw new Error('the honours table lock is already held by this file');
  const client = postgres(dsn, {
    max: 1,
    onnotice: () => {},
  });
  await client`SELECT pg_advisory_lock(${HONOURS_RELOAD_LOCK})`;
  honoursHolder = client;
}

/** Safe to call even if the lock was never taken. */
export async function unlockHonoursTables(): Promise<void> {
  if (!honoursHolder) return;
  const client = honoursHolder;
  honoursHolder = null;
  try {
    await client`SELECT pg_advisory_unlock(${HONOURS_RELOAD_LOCK})`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Blocks until no other test file is mutating DOB conflict/dispute state. */
export async function lockBirthDateEnrichment(dsn: string): Promise<void> {
  if (!dsn) return;
  if (birthDateHolder) throw new Error('the birth-date enrichment lock is already held by this file');
  const client = postgres(dsn, {
    max: 1,
    onnotice: () => {},
  });
  await client`SELECT pg_advisory_lock(${BIRTH_DATE_ENRICH_LOCK})`;
  birthDateHolder = client;
}

/** Safe to call even if the lock was never taken. */
export async function unlockBirthDateEnrichment(): Promise<void> {
  if (!birthDateHolder) return;
  const client = birthDateHolder;
  birthDateHolder = null;
  try {
    await client`SELECT pg_advisory_unlock(${BIRTH_DATE_ENRICH_LOCK})`;
  } finally {
    await client.end({ timeout: 5 });
  }
}
