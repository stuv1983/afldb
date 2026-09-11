/**
 * The fixture vocabulary, stated once (AFLDB-ISSUE-162 §9).
 *
 * Every value here is a pure enum member, code or bound that BOTH the fixture
 * mutation contract (`src/db/queries/admin-fixtures.ts`) and the Stage 2 admin
 * forms need to agree on. It lives outside `src/db/queries/` for one structural
 * reason: `admin-fixtures.ts` carries `import 'server-only'` because it opens
 * database transactions, so a `'use client'` form that imports a round bound
 * from it fails the production build ("You're importing a module that depends
 * on server-only"). Splitting the vocabulary out is the fix; copying it into
 * the forms would not be, because a second copy of `FIXTURE_ROUND_TYPES` or
 * `MAX_HOME_AND_AWAY_ROUND` could drift from the one the server enforces and
 * the browser would offer a choice the transaction refuses.
 *
 * No `server-only` here, and nothing that would want it: no SQL, no `@/db`
 * import, no transaction, no secret. These are the same enum values migration
 * 097's CHECK constraints and migrations 003/084's `round_type` already publish,
 * and the browser is shown them anyway the moment a `<select>` renders.
 *
 * This is vocabulary, NOT policy. What a round means, whether a season may be
 * administered, whether a fixture duplicates another and whether an edit is
 * allowed all stay in `admin-fixtures.ts` inside the mutation transaction —
 * the same line `src/app/admin/fixtures/validation.ts` draws for form parsing.
 * `admin-fixtures.ts` re-exports everything below, so a server consumer keeps
 * importing the one module it always did.
 */

/** Every `fixtures.status` the CHECK admits (migration 097). */
export const FIXTURE_STATUSES = ['scheduled', 'cancelled', 'void'] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

/**
 * The `round_type` enum exactly as migrations 003 and 084 leave it. The order
 * is the enum's own; nothing depends on it, but it keeps the two readable side
 * by side.
 */
export const FIXTURE_ROUND_TYPES = [
  'home_and_away',
  'wildcard_final',
  'elimination_final',
  'qualifying_final',
  'semi_final',
  'preliminary_final',
  'grand_final',
] as const;
export type FixtureRoundType = (typeof FIXTURE_ROUND_TYPES)[number];

/**
 * The finals `round_code` for each finals `round_type` — the `FINALS_CODES`
 * keys of `tools/migration/import_fitzroy_core.py:166-173`, which is what
 * `matches.round_code` actually holds. The played resolution compares this
 * string to `matches.round_code` verbatim, so it must be that vocabulary and
 * not, for example, the `R<n>`/`Final` rendering `createMatch()` invents
 * (`match-admin.ts:143-159`).
 */
export const FINALS_ROUND_CODES: Readonly<Record<Exclude<FixtureRoundType, 'home_and_away'>, string>> = {
  wildcard_final: 'WF',
  elimination_final: 'EF',
  qualifying_final: 'QF',
  semi_final: 'SF',
  preliminary_final: 'PF',
  grand_final: 'GF',
};

/**
 * The highest home-and-away round a fixture may be entered for. Not an
 * assertion that a season HAS 30 rounds — §9 forbids hard-coding a season
 * shape — only the point past which a typed number is certainly a mistake.
 */
export const MAX_HOME_AND_AWAY_ROUND = 30;

/** The most fixtures one round-batch submission may carry (§14). */
export const MAX_BATCH_ROWS = 20;

export function isFixtureRoundType(value: unknown): value is FixtureRoundType {
  return typeof value === 'string' && (FIXTURE_ROUND_TYPES as readonly string[]).includes(value);
}

export function isFixtureStatus(value: unknown): value is FixtureStatus {
  return typeof value === 'string' && (FIXTURE_STATUSES as readonly string[]).includes(value);
}
