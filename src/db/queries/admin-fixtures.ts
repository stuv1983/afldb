import { createHash, randomUUID } from 'node:crypto';

import 'server-only';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import {
  FINALS_ROUND_CODES,
  MAX_BATCH_ROWS,
  MAX_HOME_AND_AWAY_ROUND,
  isFixtureRoundType,
  type FixtureRoundType,
  type FixtureStatus,
} from '@/lib/fixtures/spec';

/**
 * Fixture administration: THE fixture mutation contract
 * (AFLDB-ISSUE-162, ISSUE-156 P3d, Stage 1).
 *
 * WHAT A FIXTURE MEANS (§3). One `fixtures` row asserts:
 *
 *     this AFL match is SCHEDULED to occur.
 *
 * `matches` asserts the other thing:
 *
 *     this AFL match WAS PLAYED, and here are its result facts.
 *
 * The two are different facts about different things and they live in
 * different tables. `fixtures` has no score, result, margin, winner,
 * attendance, period, lineup or statistic column, so "0-0 means not played" is
 * UNREPRESENTABLE here rather than merely forbidden; and nothing in this file
 * inserts, updates or deletes a `matches` row, so no ladder, club/venue/player/
 * coach record, season metadata figure, NL plan or Grid Solver answer can move
 * because a fixture was entered (§21).
 *
 * "PLAYED" IS DERIVED, NEVER STORED (§18, D-6). A fixture is played when
 * exactly one `matches` row exists for the SAME season, the SAME `round_code`
 * and the SAME club pair. The resolution is read-only, deterministic and fails
 * closed: the only inputs are those three exact facts, the `swapped` arm is the
 * same three facts with the two club ids exchanged, and any other outcome
 * leaves the fixture UNLINKED. There is no name matching, no date tolerance, no
 * venue comparison and no fuzzy fallback anywhere, because date, venue and time
 * are precisely the facts a reschedule changes — a resolution that used them
 * would stop resolving at the moment it was most needed.
 *
 * IDENTITY (§6, operator constraint 2026-09-11). `fixture_key` is a
 * `randomUUID()` minted once at creation and NEVER edited. It survives a
 * reschedule, a venue change, a round correction, a home/away swap, a club
 * replacement, cancellation, voiding, a destructive rebuild and a promotion,
 * and it REMAINS the fixture's identity after the match has been played. This
 * module never renders, stores or compares a `matches.match_key`, and
 * `fixtures` carries no `match_id` and no `match_key` column: the played row's
 * id is a read-time value only. `match_key` is a content address over
 * season|round|date|home|away — over exactly the fields a fixture exists in
 * order to change — which is why `tools/migration/match-rekey.ts` has to MOVE
 * it when a result's details are corrected, and why it is unfit to be a
 * fixture's identity.
 *
 * SEASON BOUNDARY (§8, D-3). `max(seasons.year) <= S <= max(seasons.year) + 1`.
 * No `seasons`, `clubs`, `club_seasons`, `venues` or `venue_aliases` row is
 * ever written: the reference register and the AFLDB-ISSUE-101 rollover own
 * those, and "opening a season" for fixtures is simply the first fixture
 * written for it. Eligible clubs come from the ONE rule AFLDB-ISSUE-161
 * introduced, `afldb_season_list_clubs(season)` (migration 096), which this
 * module reuses and does not modify.
 *
 * DURABILITY (§20) — the ISSUE-159/160/161 shape. The canonical row is an
 * ordinary registry-table row that a promotion rebuilds and a destructive
 * reload can remove. The durable record is one whole-row `data_overrides` row
 * keyed `manual_admin_edit:<token>`, carrying club SLUGS and a venue SLUG
 * rather than ids, replayed fail-closed by
 * `replay_admin_overrides('fixtures')` in `tools/migration/common.py`.
 *
 * REMOVAL IS NEVER A DELETE (§16, D-2). `cancelled` means a real scheduled
 * event did not happen and is reversible; `void` means a row was entered in
 * error and was never a real event. Both keep the row, so every `data_edits`
 * row pointing at `fixtures.id` stays resolvable through the `fixture_key`
 * lineage rule at the next promotion remap — the exact dangle AFLDB-ISSUE-160
 * D-3 was written to prevent.
 *
 * TRANSACTIONS (§25). Every mutation is one `AFLDB_IMPORT_DATABASE_URL`
 * transaction taking `pg_advisory_xact_lock(<namespace>, season)` first:
 * canonical write + `data_overrides` + `recordDataEdit()`, all or nothing.
 * Preconditions are checked BEFORE the first write. A refusal discovered after
 * a write is THROWN as a `RollbackRefusal`, never returned — `postgres.js`
 * commits when the `begin()` callback RESOLVES, so a plain `return refuse(...)`
 * past the first write would commit a half-done, partly-unaudited mutation
 * while telling the operator it had failed. That is the AFLDB-ISSUE-160 defect
 * this file will not repeat.
 *
 * NO PUBLIC EXPOSURE (§22, D-7). Nothing outside `/admin` reads this table in
 * AFLDB-ISSUE-162, and no Server Action in Stage 2 revalidates a public path.
 */

type Tx = postgres.TransactionSql;

// --- vocabulary ----------------------------------------------------------

export const FIXTURE_ENTITY_TYPE = 'fixtures';
export const FIXTURE_FIELD_GROUP = 'fixture';
export const FIXTURE_SOURCE_KEY = 'manual_admin_edit';

/**
 * The `0xAF1DB` advisory namespace: 1 honour teams, 2 admin lifecycle,
 * 3 Brownlow. Fixtures lock per SEASON rather than on a fixed key, so the
 * second argument is the season year itself. Seasons are 1897..2100 and the
 * three fixed keys are 1, 2 and 3, so the two schemes cannot collide.
 */
export const FIXTURE_LOCK_NAMESPACE = 717275;

/**
 * The enum members, finals codes and bounds §9 defines live in
 * `@/lib/fixtures/spec` and are re-exported here unchanged, so every server
 * consumer still imports the whole fixture contract from this one module.
 *
 * They are kept in a separate, `server-only`-free file because the Stage 2
 * admin forms are Client Components and need the same values: importing them
 * from here would drag this module — `postgres`, `@/db/client`, every
 * transaction — into the browser bundle, which the production build refuses.
 * Re-exporting rather than duplicating means the `<select>` a human sees and
 * the transaction that judges their submission read one definition.
 */
export {
  FINALS_ROUND_CODES,
  FIXTURE_ROUND_TYPES,
  FIXTURE_STATUSES,
  MAX_BATCH_ROWS,
  MAX_HOME_AND_AWAY_ROUND,
  isFixtureRoundType,
  isFixtureStatus,
} from '@/lib/fixtures/spec';
export type { FixtureRoundType, FixtureStatus } from '@/lib/fixtures/spec';

// --- entity_key shape (§20) ----------------------------------------------

/**
 * The durable key of one fixture. Mirrors the decode in
 * `tools/migration/common.py`'s `replay_admin_overrides('fixtures')`; the two
 * must never be able to disagree about what a key means.
 *
 * Unlike AFLDB-ISSUE-161's membership key this is a MINTED TOKEN, and for the
 * opposite reason: a membership has a natural key (club, season, player) that
 * no edit can change, whereas every candidate natural key for a fixture — the
 * date, the venue, even the round and the club pair — is a fact an
 * administrator is expected to correct. A key over mutable facts would change
 * identity on a reschedule, which is exactly what `fixture_key` prevents.
 */
export function fixtureEntityKey(fixtureKey: string): string {
  return `${FIXTURE_SOURCE_KEY}:${fixtureKey}`;
}

/** The inverse of {@link fixtureEntityKey}, or null when the key is not one. */
export function parseFixtureEntityKey(key: string): string | null {
  const prefix = `${FIXTURE_SOURCE_KEY}:`;
  if (!key.startsWith(prefix)) return null;
  const token = key.slice(prefix.length);
  return token.length > 0 ? token : null;
}

// --- season bounds (§8, D-3) ---------------------------------------------

export type FixtureSeasonBounds = { first: number; last: number };

/**
 * The seasons whose fixtures may be administered, given the reference
 * register's last season: `maxYear <= S <= maxYear + 1`.
 *
 * The LOWER bound admits the in-progress season, so finals fixtures can be
 * entered as participants become known. The UPPER bound is the register's last
 * season plus one, matching AFLDB-ISSUE-161's list bound so the two issues
 * share one season-boundary model. `S < maxYear` is history — source-owned
 * results already exist for it — and is refused for every write.
 *
 * With no register at all the range is EMPTY (`first > last`) rather than
 * open: fail-closed in the one state where nothing can be known.
 */
export function fixtureSeasonBounds(maxSeasonYear: number | null): FixtureSeasonBounds {
  if (maxSeasonYear === null) return { first: 1, last: 0 };
  return { first: maxSeasonYear, last: maxSeasonYear + 1 };
}

export function isAdministrableFixtureSeason(season: number, bounds: FixtureSeasonBounds): boolean {
  return Number.isInteger(season) && season >= bounds.first && season <= bounds.last;
}

/**
 * TEST ONLY, and structurally inert outside a test run.
 *
 * The real window admits the in-progress season, in which REAL matches and
 * REAL fixtures exist. The integration suite must write into seasons where
 * nothing real can be disturbed, so it raises the ceiling to `max + 1` and
 * works in `max + 1` / `max + 2` — without seeding a throwaway `seasons` row,
 * because `seasons` is tracked reference data other suites read and
 * AFLDB-ISSUE-162 writes none of it (D-3).
 *
 * `NODE_ENV` is 'test' under vitest and 'production' in a built server, so this
 * cannot be reached in production even if the variable were somehow set there.
 * It raises only the effective register year, so the window it produces is
 * always a contiguous two-season window of the same shape.
 */
function testCeilingSeason(): number | null {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.AFLDB_FIXTURE_TEST_MAX_SEASON;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

async function readFixtureSeasonBounds(db: postgres.Sql | Tx): Promise<FixtureSeasonBounds> {
  // One cast, here: `postgres.Sql` and `TransactionSql` carry the same tagged
  // template call signature but TypeScript will not call it through the union.
  const [row] = await (db as postgres.Sql)<{ maxYear: number | null }[]>`
    SELECT max(year)::int AS "maxYear" FROM seasons
  `;
  const ceiling = testCeilingSeason();
  const maxYear = row?.maxYear ?? null;
  const effective = ceiling === null ? maxYear : Math.max(maxYear ?? ceiling, ceiling);
  return fixtureSeasonBounds(effective);
}

function seasonBoundError(season: number, bounds: FixtureSeasonBounds): string {
  if (bounds.first > bounds.last) {
    return 'No fixture can be administered yet: the season register is empty.';
  }
  if (season < bounds.first) {
    return `${season} is before ${bounds.first}, the earliest season a fixture may be administered `
      + 'for. Earlier seasons are represented by the matches that were played, not by schedules.';
  }
  return `${season} is beyond ${bounds.last}, the latest season a fixture may be administered for. `
    + 'The season register has to advance first.';
}

// --- round rendering (§9) ------------------------------------------------

export type RoundInput = { roundType: FixtureRoundType; roundNumber?: number | null };
export type RenderedRound = {
  roundType: FixtureRoundType;
  roundNumber: number | null;
  roundCode: string;
};

/**
 * Render the stored round triple from what an administrator chooses. A human
 * never types a `round_code`: they pick a `round_type` and, for home-and-away,
 * a round number, and the server renders the code in the `matches` vocabulary.
 *
 * AFLDB numbers the Opening Round as round 1 from 2024 (§2.3), so round 0 is
 * not a thing here; Squiggle's and Kali's round 0 is normalised long before
 * anything this module sees.
 */
export function renderRound(input: RoundInput): RenderedRound | { error: string } {
  if (!isFixtureRoundType(input.roundType)) {
    return { error: 'Choose a round type.' };
  }
  if (input.roundType === 'home_and_away') {
    const n = input.roundNumber;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_HOME_AND_AWAY_ROUND) {
      return {
        error: `A home-and-away fixture needs a round number between 1 and `
          + `${MAX_HOME_AND_AWAY_ROUND}. AFLDB numbers the Opening Round as round 1.`,
      };
    }
    return { roundType: 'home_and_away', roundNumber: n as number, roundCode: String(n) };
  }
  if (input.roundNumber !== null && input.roundNumber !== undefined) {
    return { error: 'A finals fixture carries no round number; its round code names the final.' };
  }
  return {
    roundType: input.roundType,
    roundNumber: null,
    roundCode: FINALS_ROUND_CODES[input.roundType],
  };
}

// --- schedule validation (§10, D-5) --------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * True only for a `YYYY-MM-DD` string that names a REAL Gregorian calendar day.
 *
 * The shape test is not enough and `Date.parse()` is not a calendar check: it
 * normalises impossible days rather than rejecting them, so `2027-02-30` parses
 * — as 2 March — and a fixture would be stored on a day that does not exist, or
 * silently moved to one that does. The round trip below is the same arithmetic
 * `parseAuditDate()` uses (`src/lib/audit-view.ts`): build the day in UTC and
 * require all three components to survive, which fails exactly the dates the
 * calendar does not have (31 April, 30 February, 29 February in a common year).
 *
 * `Date.UTC` is used for CALENDAR ARITHMETIC ONLY. Nothing here converts a time
 * zone, and the value stored is the operator's string unchanged: a fixture's
 * date and local start time are AFL local facts (§10), never an instant.
 */
function isRealCalendarDate(value: string): boolean {
  const parts = ISO_DATE.exec(value);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day;
}

export type ScheduleInput = { matchDate?: string | null; matchTime?: string | null };
export type NormalisedSchedule = { matchDate: string | null; matchTime: string | null };

/**
 * NULL means genuinely unknown / TBC (D-5). There is no sentinel date, no
 * `00:00` standing in for "time not announced" and no synthetic TBC venue.
 *
 * A time without a date is refused rather than stored: "7:20pm on a day nobody
 * has announced" is not a fact, it is two halves of one. The migration carries
 * the same rule as a CHECK so no writer, replay or future importer can bypass
 * it.
 */
export function normaliseSchedule(input: ScheduleInput): NormalisedSchedule | { error: string } {
  const date = (input.matchDate ?? '').trim();
  const time = (input.matchTime ?? '').trim();
  if (date && !ISO_DATE.test(date)) {
    return { error: 'Enter the date as YYYY-MM-DD, or leave it blank for TBC.' };
  }
  if (date && !isRealCalendarDate(date)) {
    return { error: `${date} is not a real date.` };
  }
  if (time && !LOCAL_TIME.test(time)) {
    return { error: 'Enter the local start time as HH:MM (24-hour), or leave it blank for TBC.' };
  }
  if (time && !date) {
    return {
      error: 'A start time needs a date. Leave the time blank until the date is known — '
        + 'AFLDB stores an unknown time as unknown, never as midnight.',
    };
  }
  return { matchDate: date || null, matchTime: time || null };
}

// --- results (§25) -------------------------------------------------------

export type FixtureRefusalReason =
  | 'validation'
  | 'not_found'
  | 'season_out_of_window'
  | 'invalid_round'
  | 'same_club'
  | 'club_ineligible'
  | 'invalid_schedule'
  | 'invalid_venue'
  | 'duplicate_fixture'
  | 'club_already_scheduled'
  | 'already_played'
  | 'played_locked'
  | 'invalid_transition'
  | 'identity_collision'
  | 'stale'
  | 'stale_preview'
  | 'batch_invalid'
  | 'forbidden'
  | 'failed';

export type FixtureRowOutcome = {
  /** Position in the submitted batch, 0-based. */
  index: number;
  ok: boolean;
  reason?: FixtureRefusalReason;
  error?: string;
  /** Present only for a row that a real (non-preview) commit wrote. */
  fixtureKey?: string;
};

export type FixtureRefusal = {
  ok: false;
  error: string;
  reason: FixtureRefusalReason;
  /** The clubs or fixtures a refusal is ABOUT, so a caller need not parse the sentence. */
  subjects?: string[];
  /** Per-row outcomes for a batch refusal — every row, not just the failing ones. */
  rows?: FixtureRowOutcome[];
};

export type FixtureMutationResult<T> = ({ ok: true } & T) | FixtureRefusal;

function refuse(
  reason: FixtureRefusalReason, error: string, subjects?: string[], rows?: FixtureRowOutcome[],
): FixtureRefusal {
  const out: FixtureRefusal = { ok: false, error, reason };
  if (subjects?.length) out.subjects = subjects;
  if (rows?.length) out.rows = rows;
  return out;
}

/**
 * A refusal discovered AFTER this transaction has already written something.
 *
 * `postgres.js` commits when the `begin()` callback RESOLVES and rolls back
 * only when it REJECTS, so returning a refusal past the first write would
 * commit the half-done mutation while reporting failure — an unaudited
 * canonical write, which §25 forbids. Throwing rolls the transaction back, and
 * the mutation's own `catch` turns it back into exactly the refusal the caller
 * would otherwise have received, so the contract the action layer sees is
 * unchanged.
 *
 * This is the AFLDB-ISSUE-160 `RollbackRefusal` pattern, used here for EVERY
 * post-write refusal without exception.
 */
class RollbackRefusal extends Error {
  constructor(
    readonly reason: FixtureRefusalReason,
    readonly detail: string,
    readonly subjects: string[] = [],
    readonly rows: FixtureRowOutcome[] = [],
  ) {
    super(detail);
    this.name = 'RollbackRefusal';
  }
}

/** The refusal a `RollbackRefusal` carried, or null for a genuine failure. */
function rolledBackRefusal(error: unknown): FixtureRefusal | null {
  return error instanceof RollbackRefusal
    ? refuse(error.reason, error.detail, error.subjects, error.rows)
    : null;
}

function mutationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `The fixture could not be changed: ${message}`;
}

// --- the narrow SELECT-only import-role helper (ISSUE-159 D-2 precedent) --

async function withImportConnection<T>(fn: (importSql: postgres.Sql) => Promise<T>): Promise<T> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(importSql);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

// --- the read-time played resolution (§18, D-6) ---------------------------

export type PlayedState = 'unplayed' | 'played' | 'played_home_away_differs' | 'ambiguous';

export type PlayedCandidates = {
  status: FixtureStatus;
  exactCount: number;
  exactMatchId: number | null;
  swappedCount: number;
  swappedMatchId: number | null;
};

export type PlayedResolution = {
  state: PlayedState;
  /** The played `matches.id`, at READ TIME only. Never stored on the fixture. */
  matchId: number | null;
};

/**
 * THE played-resolution decision, as a pure function over counts the SQL
 * fragment below produces. Every read and the write-time `played_locked` check
 * go through it, so they cannot disagree.
 *
 * Deterministic and fail-closed (D-6): the only inputs are counts over EXACT
 * season, EXACT `round_code` and EXACT club ids. Nothing is guessed from names,
 * dates or venues — those are the facts a reschedule changes, so a resolution
 * that used them would stop resolving at the moment it was most needed — and
 * nothing is ever written by the resolution.
 *
 * The whole truth table, and there is no other arm:
 *
 *     exact 1, swapped 0  ->  played                     (exactMatchId)
 *     exact 0, swapped 1  ->  played_home_away_differs   (swappedMatchId)
 *     exact 0, swapped 0  ->  unplayed
 *     anything else       ->  ambiguous, linked to NOTHING
 *
 * ONE exact candidate is not enough on its own. A competing swapped candidate
 * means two different `matches` rows could each be this fixture, and preferring
 * the exact one because it is "the better match" is precisely the guess D-6
 * forbids: it would lock the fixture against edits, claim a result, and compare
 * the schedule against a row chosen by a tie-break rather than by identity.
 * Every ambiguous shape is surfaced as a hard diagnostic instead, to be fixed
 * by correcting the round or the clubs on one of the rows.
 *
 * A `void` fixture resolves to `unplayed`: a row entered in error is not a
 * record of anything, so it must not claim a real result.
 */
export function resolvePlayed(input: PlayedCandidates): PlayedResolution {
  if (input.status === 'void') return { state: 'unplayed', matchId: null };
  if (input.exactCount === 1 && input.swappedCount === 0) {
    return { state: 'played', matchId: input.exactMatchId };
  }
  if (input.exactCount === 0 && input.swappedCount === 1) {
    return { state: 'played_home_away_differs', matchId: input.swappedMatchId };
  }
  if (input.exactCount === 0 && input.swappedCount === 0) {
    return { state: 'unplayed', matchId: null };
  }
  // Any other combination — two exact rows, an exact and a swapped, two swapped
  // — is ambiguous and surfaced as a hard diagnostic, NEVER merged or guessed
  // at (the match-rekey.ts rule-4 discipline).
  return { state: 'ambiguous', matchId: null };
}

/** True when a resolution has bound the fixture to a real played match. */
export function isPlayedState(state: PlayedState): boolean {
  return state === 'played' || state === 'played_home_away_differs';
}

/**
 * The SQL half of §18, as a LATERAL that yields the four counts
 * {@link resolvePlayed} decides from. `f` must be the `fixtures` alias in the
 * enclosing query.
 *
 * Read-only by construction — it is a SELECT — and it touches `matches` on
 * nothing but `season`, `round_code` and the two club ids. `ix_matches_season_round`
 * already covers the leading columns.
 */
export const PLAYED_RESOLUTION_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT
      (count(*) FILTER (WHERE m.home_club_id = f.home_club_id))::int AS "exactCount",
      (min(m.id) FILTER (WHERE m.home_club_id = f.home_club_id))::int AS "exactMatchId",
      (count(*) FILTER (WHERE m.home_club_id = f.away_club_id))::int AS "swappedCount",
      (min(m.id) FILTER (WHERE m.home_club_id = f.away_club_id))::int AS "swappedMatchId"
      FROM matches m
     WHERE m.season = f.season
       AND m.round_code = f.round_code
       AND ((m.home_club_id = f.home_club_id AND m.away_club_id = f.away_club_id)
         OR (m.home_club_id = f.away_club_id AND m.away_club_id = f.home_club_id))
  ) pl ON true`;

/**
 * The same resolution for a fixture that does not exist yet — the
 * `already_played` precondition of a create (§13). Counts `matches` rows for
 * the season, round code and unordered club pair.
 */
async function playedCandidatesFor(tx: Tx, input: {
  season: number; roundCode: string; homeClubId: number; awayClubId: number;
}): Promise<{ exactCount: number; exactMatchId: number | null; swappedCount: number; swappedMatchId: number | null }> {
  const [row] = await tx<{
    exactCount: number; exactMatchId: number | null;
    swappedCount: number; swappedMatchId: number | null;
  }[]>`
    SELECT
      (count(*) FILTER (WHERE m.home_club_id = ${input.homeClubId}))::int AS "exactCount",
      (min(m.id) FILTER (WHERE m.home_club_id = ${input.homeClubId}))::int AS "exactMatchId",
      (count(*) FILTER (WHERE m.home_club_id = ${input.awayClubId}))::int AS "swappedCount",
      (min(m.id) FILTER (WHERE m.home_club_id = ${input.awayClubId}))::int AS "swappedMatchId"
      FROM matches m
     WHERE m.season = ${input.season}::smallint
       AND m.round_code = ${input.roundCode}
       AND ((m.home_club_id = ${input.homeClubId} AND m.away_club_id = ${input.awayClubId})
         OR (m.home_club_id = ${input.awayClubId} AND m.away_club_id = ${input.homeClubId}))
  `;
  return row ?? { exactCount: 0, exactMatchId: null, swappedCount: 0, swappedMatchId: null };
}

// --- eligible clubs (§12) ------------------------------------------------

export type EligibleFixtureClub = {
  id: number;
  slug: string;
  name: string;
  organizationId: number;
};

/**
 * The clubs a fixture may name for a season, resolved through the ONE rule —
 * `afldb_season_list_clubs()` in migration 096. AFLDB-ISSUE-162 adds no second
 * eligibility rule and modifies neither that function nor
 * `afldb_identity_for_season()`.
 *
 * Not circular: the eligible set never reads `fixtures` or `matches` for a
 * future season, so a season with no schedule and no results still has clubs.
 */
export async function eligibleFixtureClubs(season: number): Promise<EligibleFixtureClub[]> {
  return sql<EligibleFixtureClub[]>`
    SELECT id, slug, name, organization_id AS "organizationId"
      FROM afldb_season_list_clubs(${season}::smallint)
     ORDER BY name
  `;
}

type ResolvedFixtureClub = EligibleFixtureClub & { eligible: boolean };

async function resolveClubsById(
  tx: Tx, clubIds: readonly number[], season: number,
): Promise<Map<number, ResolvedFixtureClub>> {
  const rows = await tx<ResolvedFixtureClub[]>`
    SELECT c.id, c.slug, c.name, c.organization_id AS "organizationId",
           EXISTS (SELECT 1 FROM afldb_season_list_clubs(${season}::smallint) e WHERE e.id = c.id)
             AS eligible
      FROM clubs c
     WHERE c.id = ANY(${[...clubIds]}::int[])
  `;
  return new Map(rows.map((row) => [row.id, row]));
}

// --- venue resolution (§11) ----------------------------------------------

export type VenueInput = { venueId?: number | null; venueRaw?: string | null };
type ResolvedVenue = { venueId: number | null; venueRaw: string | null; venueSlug: string | null };

/**
 * Known venue → `venue_id` plus `venues.canonical_name` copied into
 * `venue_raw` (the `createMatch()` convention, `match-admin.ts:212-218`), so a
 * fixture renders a venue string the way a match does.
 * Named-but-unmapped venue → `venue_id NULL`, the typed name in `venue_raw` —
 * the same shape `matches` uses for an unresolved source string (003:74-75).
 * TBC → both NULL.
 *
 * NO INLINE VENUE CREATION. No `INSERT INTO venues` or `venue_aliases` exists
 * anywhere in `src/`, and none is added here: venues are created by
 * `import_venues()` from source strings and by the settle's alias resolution.
 * An unmapped name is handed to venue administration as a warning, never
 * invented as a row.
 */
async function resolveVenue(
  tx: Tx, input: VenueInput,
): Promise<ResolvedVenue | FixtureRefusal> {
  const typed = (input.venueRaw ?? '').trim();
  if (input.venueId !== null && input.venueId !== undefined) {
    if (!Number.isInteger(input.venueId)) {
      return refuse('invalid_venue', 'That is not a venue.');
    }
    const [venue] = await tx<{ id: number; slug: string; canonicalName: string }[]>`
      SELECT id, slug, canonical_name AS "canonicalName" FROM venues WHERE id = ${input.venueId}
    `;
    if (!venue) {
      return refuse('invalid_venue',
        `No venue with id ${input.venueId}. Choose an existing venue, type the name to record it `
        + 'unmapped, or leave it blank for TBC — AFLDB-ISSUE-162 never creates a venue.');
    }
    return { venueId: venue.id, venueRaw: venue.canonicalName, venueSlug: venue.slug };
  }
  if (typed) return { venueId: null, venueRaw: typed, venueSlug: null };
  return { venueId: null, venueRaw: null, venueSlug: null };
}

// --- the canonical row ---------------------------------------------------

export type FixtureRow = {
  id: number;
  fixtureKey: string;
  season: number;
  roundCode: string;
  roundNumber: number | null;
  roundType: FixtureRoundType;
  isFinal: boolean;
  matchDate: string | null;
  matchTime: string | null;
  venueId: number | null;
  venueSlug: string | null;
  venueRaw: string | null;
  homeClubId: number;
  homeClubSlug: string;
  homeClubName: string;
  awayClubId: number;
  awayClubSlug: string;
  awayClubName: string;
  status: FixtureStatus;
  statusReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const FIXTURE_COLUMNS = `
  f.id::int AS id, f.fixture_key AS "fixtureKey", f.season::int AS season,
  f.round_code AS "roundCode", f.round_number::int AS "roundNumber", f.round_type AS "roundType",
  f.is_final AS "isFinal", f.match_date::text AS "matchDate", f.match_time AS "matchTime",
  f.venue_id AS "venueId", v.slug AS "venueSlug", f.venue_raw AS "venueRaw",
  f.home_club_id AS "homeClubId", hc.slug AS "homeClubSlug", hc.name AS "homeClubName",
  f.away_club_id AS "awayClubId", ac.slug AS "awayClubSlug", ac.name AS "awayClubName",
  f.status AS status, f.status_reason AS "statusReason", f.notes AS notes,
  f.created_at::text AS "createdAt", f.updated_at::text AS "updatedAt"`;

const FIXTURE_JOINS = `
  FROM fixtures f
  JOIN clubs hc ON hc.id = f.home_club_id
  JOIN clubs ac ON ac.id = f.away_club_id
  LEFT JOIN venues v ON v.id = f.venue_id`;

/**
 * Lock one fixture for update and read it back whole.
 *
 * `FOR UPDATE` is taken on `fixtures` alone: the clubs and venues joins are
 * lookups, and `FOR UPDATE OF` an outer relation is not permitted.
 */
async function lockFixture(tx: Tx, fixtureKey: string): Promise<FixtureRow | null> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM fixtures WHERE fixture_key = ${fixtureKey} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${FIXTURE_COLUMNS} ${FIXTURE_JOINS} WHERE f.id = $1`, [locked.id],
  ) as unknown as FixtureRow[];
  return rows[0] ?? null;
}

/** The `manual_admin_edit` source every AFLDB-ISSUE-162 row is written under. */
async function manualSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    SELECT id FROM sources WHERE key = ${FIXTURE_SOURCE_KEY}
  `;
  if (!row) throw new Error(`Required source '${FIXTURE_SOURCE_KEY}' is not configured.`);
  return row.id;
}

async function lockSeason(tx: Tx, season: number): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${FIXTURE_LOCK_NAMESPACE}, ${season})`;
}

// --- the durable record (§20) --------------------------------------------

export type FixtureOverridePayload = {
  fixture_key: string;
  season: number;
  round_type: FixtureRoundType;
  round_number: number | null;
  round_code: string;
  match_date: string | null;
  match_time: string | null;
  home_club_slug: string;
  away_club_slug: string;
  venue_slug?: string;
  venue_raw?: string;
  status: FixtureStatus;
  status_reason?: string;
  notes?: string;
  batch_id?: string;
};

/**
 * The whole-row durable payload. Club SLUGS and a venue SLUG, never ids: ids
 * are renumbered by a promotion, slugs are tracked reference data.
 *
 * Keys that carry no value are OMITTED rather than written as null — an absent
 * key and an explicit null are different things to the replay — while the
 * scheduling facts that mean "TBC" are written as explicit nulls, because for
 * those the null IS the fact (D-5).
 */
export function fixtureOverridePayload(row: {
  fixtureKey: string;
  season: number;
  roundType: FixtureRoundType;
  roundNumber: number | null;
  roundCode: string;
  matchDate: string | null;
  matchTime: string | null;
  homeClubSlug: string;
  awayClubSlug: string;
  venueSlug?: string | null;
  venueRaw?: string | null;
  status: FixtureStatus;
  statusReason?: string | null;
  notes?: string | null;
  batchId?: string | null;
}): FixtureOverridePayload {
  const payload: FixtureOverridePayload = {
    fixture_key: row.fixtureKey,
    season: row.season,
    round_type: row.roundType,
    round_number: row.roundNumber,
    round_code: row.roundCode,
    match_date: row.matchDate,
    match_time: row.matchTime,
    home_club_slug: row.homeClubSlug,
    away_club_slug: row.awayClubSlug,
    status: row.status,
  };
  if (row.venueSlug) payload.venue_slug = row.venueSlug;
  if (row.venueRaw) payload.venue_raw = row.venueRaw;
  const reason = (row.statusReason ?? '').trim();
  if (reason) payload.status_reason = reason;
  const notes = (row.notes ?? '').trim();
  if (notes) payload.notes = notes;
  if (row.batchId) payload.batch_id = row.batchId;
  return payload;
}

/**
 * Write (or rewrite) the durable record for one fixture.
 *
 * `is_active` is ALWAYS true: unlike a season-list membership there is no
 * DELETE to tombstone, the lifecycle lives in the payload's `status`, and a
 * cancelled or void fixture must be RE-CREATED by the replay rather than
 * suppressed by it — otherwise its `data_edits` rows become unresolvable at
 * the next promotion lineage remap (§16).
 */
async function writeFixtureOverride(
  tx: Tx, payload: FixtureOverridePayload, adminUserId: number,
): Promise<void> {
  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
    VALUES (${FIXTURE_ENTITY_TYPE}, ${fixtureEntityKey(payload.fixture_key)}, ${FIXTURE_FIELD_GROUP},
            ${tx.json(payload as unknown as postgres.JSONValue)}, ${adminUserId}, true, now())
    ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
       SET override_values = EXCLUDED.override_values,
           is_active = true,
           admin_user_id = EXCLUDED.admin_user_id,
           updated_at = now()
  `;
}

/**
 * The identifying facts every audit row carries inside `new_values`, so an
 * entry is readable without joining anything (§24).
 */
function auditIdentity(row: {
  fixtureKey: string; season: number; roundCode: string;
  homeClubSlug: string; awayClubSlug: string;
}): Record<string, unknown> {
  return {
    fixture_key: row.fixtureKey,
    season: row.season,
    round_code: row.roundCode,
    home_club_slug: row.homeClubSlug,
    away_club_slug: row.awayClubSlug,
  };
}

// --- create (§13) --------------------------------------------------------

export type CreateFixtureInput = {
  season: number;
  roundType: FixtureRoundType;
  roundNumber?: number | null;
  homeClubId: number;
  awayClubId: number;
  matchDate?: string | null;
  matchTime?: string | null;
  venueId?: number | null;
  venueRaw?: string | null;
  notes?: string | null;
  adminUserId: number;
};

type PreparedRow = {
  index: number;
  homeClub: ResolvedFixtureClub;
  awayClub: ResolvedFixtureClub;
  schedule: NormalisedSchedule;
  venue: ResolvedVenue;
  notes: string | null;
};

/**
 * Every precondition of one fixture row, checked BEFORE the first write (§13).
 * Shared by the single create and by every row of a batch, so the two cannot
 * validate differently.
 *
 * `pending` carries the rows already accepted from the SAME submission, so the
 * cross-row rules of §14 (no pair twice, no club twice in a batch) are checked
 * with exactly the database rules and not as a second, weaker implementation.
 */
async function preflightFixtureRow(tx: Tx, input: {
  season: number;
  round: RenderedRound;
  homeClubId: number;
  awayClubId: number;
  schedule: ScheduleInput;
  venue: VenueInput;
  notes?: string | null;
  index: number;
  clubs: Map<number, ResolvedFixtureClub>;
  pending: readonly PreparedRow[];
}): Promise<{ ok: true; row: PreparedRow } | FixtureRefusal> {
  if (input.homeClubId === input.awayClubId) {
    return refuse('same_club', 'A fixture needs two different clubs.');
  }

  const homeClub = input.clubs.get(input.homeClubId);
  const awayClub = input.clubs.get(input.awayClubId);
  for (const [clubId, club] of [[input.homeClubId, homeClub], [input.awayClubId, awayClub]] as const) {
    if (!club) return refuse('club_ineligible', `No club with id ${clubId}.`);
    if (!club.eligible) {
      return refuse('club_ineligible',
        `${club.name} is not a club whose fixtures may be administered for ${input.season}. `
        + 'Choose one of the identities competing in that season.', [club.slug]);
    }
  }

  const schedule = normaliseSchedule(input.schedule);
  if ('error' in schedule) return refuse('invalid_schedule', schedule.error);

  const venue = await resolveVenue(tx, input.venue);
  if ('ok' in venue) return venue;

  // Cross-row rules within this submission (§14), before the database rules so
  // the operator sees the row they duplicated rather than a DB-state refusal.
  for (const other of input.pending) {
    const samePair = (other.homeClub.id === homeClub!.id && other.awayClub.id === awayClub!.id)
      || (other.homeClub.id === awayClub!.id && other.awayClub.id === homeClub!.id);
    if (samePair) {
      return refuse('duplicate_fixture',
        `${homeClub!.name} v ${awayClub!.name} appears twice in this round.`);
    }
    for (const club of [homeClub!, awayClub!]) {
      if (other.homeClub.id === club.id || other.awayClub.id === club.id) {
        return refuse('club_already_scheduled',
          `${club.name} appears in more than one fixture in this round.`, [club.slug]);
      }
    }
  }

  // I-1: the same pair already scheduled in this round.
  const [duplicate] = await tx<{ fixtureKey: string }[]>`
    SELECT fixture_key AS "fixtureKey" FROM fixtures
     WHERE season = ${input.season}::smallint AND round_code = ${input.round.roundCode}
       AND status = 'scheduled'
       AND ((home_club_id = ${input.homeClubId} AND away_club_id = ${input.awayClubId})
         OR (home_club_id = ${input.awayClubId} AND away_club_id = ${input.homeClubId}))
  `;
  if (duplicate) {
    return refuse('duplicate_fixture',
      `${homeClub!.name} v ${awayClub!.name} is already scheduled in that round.`,
      [duplicate.fixtureKey]);
  }

  // I-2: either club already has a scheduled fixture in this round. A BYE is a
  // club with NO fixture in a round and is never a row, so this rule says
  // nothing about how many games a round has — only that one club cannot play
  // twice in the same round.
  const clash = await tx<{ clubId: number; fixtureKey: string }[]>`
    SELECT CASE WHEN home_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[])
                THEN home_club_id ELSE away_club_id END AS "clubId",
           fixture_key AS "fixtureKey"
      FROM fixtures
     WHERE season = ${input.season}::smallint AND round_code = ${input.round.roundCode}
       AND status = 'scheduled'
       AND (home_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[])
         OR away_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[]))
     LIMIT 1
  `;
  if (clash.length) {
    const club = clash[0].clubId === homeClub!.id ? homeClub! : awayClub!;
    return refuse('club_already_scheduled',
      `${club.name} already has a fixture in that round.`, [club.slug]);
  }

  // I-3: the game already exists as a RESULT. There is nothing to schedule, and
  // a fixture entered now would resolve straight to played with no schedule
  // history worth keeping.
  const played = await playedCandidatesFor(tx, {
    season: input.season, roundCode: input.round.roundCode,
    homeClubId: input.homeClubId, awayClubId: input.awayClubId,
  });
  if (played.exactCount + played.swappedCount > 0) {
    return refuse('already_played',
      `${homeClub!.name} v ${awayClub!.name} in that round has already been played; `
      + 'AFLDB holds it as a result, so there is nothing to schedule.');
  }

  return {
    ok: true,
    row: {
      index: input.index,
      homeClub: homeClub!,
      awayClub: awayClub!,
      schedule,
      venue,
      notes: (input.notes ?? '').trim() || null,
    },
  };
}

/**
 * Insert one fixture: canonical row, durable override, audit row. Every caller
 * goes through here, so the three writes cannot come apart in one path and not
 * another.
 */
async function insertFixture(tx: Tx, input: {
  season: number;
  round: RenderedRound;
  row: PreparedRow;
  sourceId: number;
  adminUserId: number;
  batchId?: string | null;
  batchSize?: number;
}): Promise<{ fixtureId: number; fixtureKey: string }> {
  const fixtureKey = randomUUID();

  // Defensive (§13, identity_collision). randomUUID() colliding is not a real
  // event, but a token that already named a fixture would silently retarget one.
  const [existing] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM fixtures WHERE fixture_key = ${fixtureKey}
  `;
  if (existing) {
    throw new RollbackRefusal('identity_collision',
      'A fixture identity collided. Nothing was written; try again.');
  }

  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO fixtures
          (fixture_key, season, round_code, round_number, round_type,
           match_date, match_time, venue_id, venue_raw,
           home_club_id, away_club_id, status, notes, source_id, source_record_id)
    VALUES (${fixtureKey}, ${input.season}::smallint, ${input.round.roundCode},
            ${input.round.roundNumber}::smallint, ${input.round.roundType}::round_type,
            ${input.row.schedule.matchDate}::date, ${input.row.schedule.matchTime},
            ${input.row.venue.venueId}, ${input.row.venue.venueRaw},
            ${input.row.homeClub.id}, ${input.row.awayClub.id}, 'scheduled',
            ${input.row.notes}, ${input.sourceId}, ${fixtureKey})
    RETURNING id::int AS id
  `;
  if (!inserted) {
    throw new RollbackRefusal('failed', 'The fixture row was not written.');
  }

  const payload = fixtureOverridePayload({
    fixtureKey,
    season: input.season,
    roundType: input.round.roundType,
    roundNumber: input.round.roundNumber,
    roundCode: input.round.roundCode,
    matchDate: input.row.schedule.matchDate,
    matchTime: input.row.schedule.matchTime,
    homeClubSlug: input.row.homeClub.slug,
    awayClubSlug: input.row.awayClub.slug,
    venueSlug: input.row.venue.venueSlug,
    venueRaw: input.row.venue.venueRaw,
    status: 'scheduled',
    notes: input.row.notes,
    batchId: input.batchId,
  });
  await writeFixtureOverride(tx, payload, input.adminUserId);

  await recordDataEdit(tx, {
    tableName: 'fixtures',
    rowId: inserted.id,
    fieldGroup: 'fixture_creation',
    oldValues: {},
    newValues: {
      ...payload,
      ...(input.batchId ? { batch_id: input.batchId, batch_size: input.batchSize } : {}),
    },
    adminUserId: input.adminUserId,
    note: input.row.notes,
  });

  return { fixtureId: inserted.id, fixtureKey };
}

export async function createFixture(
  input: CreateFixtureInput,
): Promise<FixtureMutationResult<{ fixtureId: number; fixtureKey: string }>> {
  const round = renderRound(input);
  if ('error' in round) return refuse('invalid_round', round.error);

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const bounds = await readFixtureSeasonBounds(tx as unknown as typeof sql);
        if (!isAdministrableFixtureSeason(input.season, bounds)) {
          return refuse('season_out_of_window', seasonBoundError(input.season, bounds));
        }
        await lockSeason(tx, input.season);

        const clubs = await resolveClubsById(
          tx, [input.homeClubId, input.awayClubId], input.season,
        );
        const pre = await preflightFixtureRow(tx, {
          season: input.season,
          round,
          homeClubId: input.homeClubId,
          awayClubId: input.awayClubId,
          schedule: input,
          venue: input,
          notes: input.notes,
          index: 0,
          clubs,
          pending: [],
        });
        if (!pre.ok) return pre;

        const sourceId = await manualSourceId(tx);
        // Everything above refused before a write. From here, any refusal throws.
        const written = await insertFixture(tx, {
          season: input.season, round, row: pre.row, sourceId, adminUserId: input.adminUserId,
        });
        return { ok: true as const, ...written };
      }) as FixtureMutationResult<{ fixtureId: number; fixtureKey: string }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- round batch (§14, D-4) ----------------------------------------------

export type FixtureBatchRowInput = {
  homeClubId: number;
  awayClubId: number;
  matchDate?: string | null;
  matchTime?: string | null;
  venueId?: number | null;
  venueRaw?: string | null;
  notes?: string | null;
};

export type CreateFixturesInput = {
  season: number;
  roundType: FixtureRoundType;
  roundNumber?: number | null;
  rows: readonly FixtureBatchRowInput[];
  adminUserId: number;
  /** `true` validates everything and writes NOTHING. */
  dryRun: boolean;
  /**
   * The fingerprint the preview returned. Required on a real commit and
   * ignored on a preview: Confirm must act on the rows the operator actually
   * previewed (the AFLDB-ISSUE-161 `CopyForwardPanel` lesson).
   */
  previewFingerprint?: string | null;
};

export type CreateFixturesResult = {
  batchId: string;
  dryRun: boolean;
  /** SHA-256 over the canonicalised submission; Confirm must echo it back. */
  fingerprint: string;
  rows: FixtureRowOutcome[];
  created: number;
};

/**
 * A stable fingerprint over exactly what was submitted, so a Confirm that
 * carries different rows than the Preview is refused rather than silently
 * written. Canonicalised field-by-field in a fixed order — `JSON.stringify`
 * over the caller's objects would hash key order, which is not part of the
 * submission.
 */
export function fixtureBatchFingerprint(input: {
  season: number;
  roundType: FixtureRoundType;
  roundNumber?: number | null;
  rows: readonly FixtureBatchRowInput[];
}): string {
  const canonical = JSON.stringify([
    input.season,
    input.roundType,
    input.roundNumber ?? null,
    input.rows.map((row) => [
      row.homeClubId,
      row.awayClubId,
      (row.matchDate ?? '').trim() || null,
      (row.matchTime ?? '').trim() || null,
      row.venueId ?? null,
      (row.venueRaw ?? '').trim() || null,
      (row.notes ?? '').trim() || null,
    ]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Round-at-a-time entry, previewed server-side and written ALL-OR-NOTHING
 * (D-4).
 *
 * `dryRun: true` runs the identical validation over every row inside the
 * transaction and returns before the first write, so a preview writes nothing
 * at all. The real commit re-validates everything server-side — a preview is
 * never trusted as authority — and any failing row rolls the WHOLE round back:
 * a round is the natural unit, and partial success creates the "did row 7
 * land?" ambiguity that AFLDB-ISSUE-160's atomicity defect was about.
 *
 * Row-level outcomes are returned in full, so the operator sees every row's
 * verdict rather than only the first failure.
 *
 * Cross-row rules (§14): no club twice in the batch, no pair twice. There is
 * deliberately NO "every club exactly once per round" rule: a BYE is a club
 * with no fixture in a round, byes are never rows (§2.3), and AFL round shapes
 * vary. Shape is reported by the diagnostics, never enforced here.
 */
export async function createFixtures(
  input: CreateFixturesInput,
): Promise<FixtureMutationResult<CreateFixturesResult>> {
  const round = renderRound(input);
  if ('error' in round) return refuse('invalid_round', round.error);
  if (input.rows.length === 0) return refuse('validation', 'No fixtures were entered.');
  if (input.rows.length > MAX_BATCH_ROWS) {
    return refuse('validation',
      `A round batch carries at most ${MAX_BATCH_ROWS} fixtures; ${input.rows.length} were submitted.`);
  }

  const fingerprint = fixtureBatchFingerprint(input);
  if (!input.dryRun && input.previewFingerprint !== fingerprint) {
    return refuse('stale_preview',
      'These fixtures are not the ones that were previewed. Preview the round again and '
      + 'confirm from that preview.');
  }

  const batchId = randomUUID();
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const bounds = await readFixtureSeasonBounds(tx as unknown as typeof sql);
        if (!isAdministrableFixtureSeason(input.season, bounds)) {
          return refuse('season_out_of_window', seasonBoundError(input.season, bounds));
        }
        await lockSeason(tx, input.season);

        const clubs = await resolveClubsById(
          tx,
          input.rows.flatMap((row) => [row.homeClubId, row.awayClubId]),
          input.season,
        );

        // Every precondition of every row first, then every write.
        const outcomes: FixtureRowOutcome[] = [];
        const prepared: PreparedRow[] = [];
        let failed = false;
        for (const [index, row] of input.rows.entries()) {
          if (failed) { outcomes.push({ index, ok: false, reason: 'batch_invalid' }); continue; }
          const pre = await preflightFixtureRow(tx, {
            season: input.season,
            round,
            homeClubId: row.homeClubId,
            awayClubId: row.awayClubId,
            schedule: row,
            venue: row,
            notes: row.notes,
            index,
            clubs,
            pending: prepared,
          });
          if (!pre.ok) {
            outcomes.push({ index, ok: false, reason: pre.reason, error: pre.error });
            failed = true;
            continue;
          }
          prepared.push(pre.row);
          outcomes.push({ index, ok: true });
        }

        if (failed) {
          const first = outcomes.find((o) => !o.ok && o.error);
          return refuse(first?.reason ?? 'batch_invalid',
            `Nothing was written: ${first?.error ?? 'one of the fixtures was refused.'} `
            + 'A round is entered all at once or not at all.',
            undefined, outcomes);
        }

        if (input.dryRun) {
          // The identical code path, stopped before the first write. Nothing has
          // been written, so nothing has to be rolled back.
          return {
            ok: true as const,
            batchId, dryRun: true, fingerprint, rows: outcomes, created: 0,
          };
        }

        const sourceId = await manualSourceId(tx);
        // Everything above refused before a write. From here, any refusal throws.
        const written: FixtureRowOutcome[] = [];
        for (const row of prepared) {
          const result = await insertFixture(tx, {
            season: input.season,
            round,
            row,
            sourceId,
            adminUserId: input.adminUserId,
            batchId,
            batchSize: prepared.length,
          });
          written.push({ index: row.index, ok: true, fixtureKey: result.fixtureKey });
        }

        return {
          ok: true as const,
          batchId, dryRun: false, fingerprint, rows: written, created: written.length,
        };
      }) as FixtureMutationResult<CreateFixturesResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- edits (§15) ---------------------------------------------------------

/** The `data_edits.field_group` of every fixture mutation (§24). */
export type FixtureFieldGroup =
  | 'fixture_creation'
  | 'fixture_schedule'
  | 'fixture_venue'
  | 'fixture_round'
  | 'fixture_clubs'
  | 'fixture_cancelled'
  | 'fixture_reinstated'
  | 'fixture_void'
  | 'fixture_notes';

export type FixtureEditBase = {
  fixtureKey: string;
  /** The `updatedAt` the form rendered. Per-row compare-and-swap. */
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

type EditContext = {
  tx: Tx;
  row: FixtureRow;
  played: PlayedResolution;
};

/**
 * Which lifecycle states admit which edit (§15).
 *
 * `fixture_notes` is the only group a PLAYED fixture accepts: the result row is
 * authoritative for what happened, and letting an operator rewrite the schedule
 * of a game that has been played would separate the fixture's history from the
 * real result. Correcting a PLAYED match's own round, date or clubs is
 * AFLDB-ISSUE-156 P10 (`match-rekey.ts`), never a fixture edit — and no code
 * path here touches a `matches` row.
 *
 * `void` is terminal: a row entered in error is kept for audit and replay, not
 * maintained.
 */
export function isFixtureEditAllowed(input: {
  fieldGroup: FixtureFieldGroup;
  status: FixtureStatus;
  played: PlayedState;
}): { allowed: true } | { allowed: false; reason: FixtureRefusalReason; error: string } {
  if (input.fieldGroup === 'fixture_notes') return { allowed: true };
  if (input.status === 'void') {
    return {
      allowed: false,
      reason: 'invalid_transition',
      error: 'This fixture was voided as a data-entry error. Voided fixtures are kept for the '
        + 'record and are not maintained; enter a new fixture instead.',
    };
  }
  if (isPlayedState(input.played)) {
    return {
      allowed: false,
      reason: 'played_locked',
      error: 'This fixture has been played. The match result is authoritative for what happened, '
        + 'so only its notes may be changed. Correcting a played match belongs in match '
        + 'administration.',
    };
  }
  return { allowed: true };
}

/**
 * The shared edit transaction: lock, CAS, lifecycle gate, apply, rewrite the
 * durable record, audit — in one transaction, in that order.
 *
 * `apply` returns the mutated row's new values or throws a `RollbackRefusal`;
 * it runs AFTER every precondition, so a refusal inside it is a post-write
 * refusal and must throw, never return.
 */
type FixtureFieldUpdates = Partial<{
  roundType: FixtureRoundType; roundNumber: number | null; roundCode: string;
  matchDate: string | null; matchTime: string | null;
  venueId: number | null; venueRaw: string | null; venueSlug: string | null;
  homeClubId: number; homeClubSlug: string; awayClubId: number; awayClubSlug: string;
  status: FixtureStatus; statusReason: string | null; notes: string | null;
}>;

type FixtureEditResult = FixtureMutationResult<{ fixtureKey: string }>;

async function editFixture(input: FixtureEditBase & {
  fieldGroup: FixtureFieldGroup;
  /** Preconditions that do not depend on a write. Refuse from here, not from `apply`. */
  precheck?: (ctx: EditContext) => Promise<FixtureRefusal | null>;
  apply: (ctx: EditContext) => Promise<{
    updates: FixtureFieldUpdates;
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
  }>;
}): Promise<FixtureEditResult> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const row = await lockFixture(tx, input.fixtureKey);
        if (!row) return refuse('not_found', 'That fixture no longer exists.');
        await lockSeason(tx, row.season);

        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That fixture changed while this page was open. Reload it and try again.');
        }

        const [candidates] = await tx<{
          exactCount: number; exactMatchId: number | null;
          swappedCount: number; swappedMatchId: number | null;
        }[]>`
          SELECT
            (count(*) FILTER (WHERE m.home_club_id = ${row.homeClubId}))::int AS "exactCount",
            (min(m.id) FILTER (WHERE m.home_club_id = ${row.homeClubId}))::int AS "exactMatchId",
            (count(*) FILTER (WHERE m.home_club_id = ${row.awayClubId}))::int AS "swappedCount",
            (min(m.id) FILTER (WHERE m.home_club_id = ${row.awayClubId}))::int AS "swappedMatchId"
            FROM matches m
           WHERE m.season = ${row.season}::smallint
             AND m.round_code = ${row.roundCode}
             AND ((m.home_club_id = ${row.homeClubId} AND m.away_club_id = ${row.awayClubId})
               OR (m.home_club_id = ${row.awayClubId} AND m.away_club_id = ${row.homeClubId}))
        `;
        const played = resolvePlayed({ status: row.status, ...candidates });

        const gate = isFixtureEditAllowed({
          fieldGroup: input.fieldGroup, status: row.status, played: played.state,
        });
        if (!gate.allowed) return refuse(gate.reason, gate.error);

        const ctx: EditContext = { tx, row, played };
        if (input.precheck) {
          const refusal = await input.precheck(ctx);
          if (refusal) return refusal;
        }

        // Everything above refused before a write. From here, any refusal throws.
        const applied = await input.apply(ctx);
        const u = applied.updates;

        const next = {
          roundType: u.roundType ?? row.roundType,
          roundNumber: u.roundNumber === undefined ? row.roundNumber : u.roundNumber,
          roundCode: u.roundCode ?? row.roundCode,
          matchDate: u.matchDate === undefined ? row.matchDate : u.matchDate,
          matchTime: u.matchTime === undefined ? row.matchTime : u.matchTime,
          venueId: u.venueId === undefined ? row.venueId : u.venueId,
          venueRaw: u.venueRaw === undefined ? row.venueRaw : u.venueRaw,
          venueSlug: u.venueSlug === undefined ? row.venueSlug : u.venueSlug,
          homeClubId: u.homeClubId ?? row.homeClubId,
          homeClubSlug: u.homeClubSlug ?? row.homeClubSlug,
          awayClubId: u.awayClubId ?? row.awayClubId,
          awayClubSlug: u.awayClubSlug ?? row.awayClubSlug,
          status: u.status ?? row.status,
          statusReason: u.statusReason === undefined ? row.statusReason : u.statusReason,
          notes: u.notes === undefined ? row.notes : u.notes,
        };

        await tx`
          UPDATE fixtures
             SET round_type = ${next.roundType}::round_type,
                 round_number = ${next.roundNumber}::smallint,
                 round_code = ${next.roundCode},
                 match_date = ${next.matchDate}::date,
                 match_time = ${next.matchTime},
                 venue_id = ${next.venueId},
                 venue_raw = ${next.venueRaw},
                 home_club_id = ${next.homeClubId},
                 away_club_id = ${next.awayClubId},
                 status = ${next.status},
                 status_reason = ${next.statusReason},
                 notes = ${next.notes},
                 updated_at = now()
           WHERE id = ${row.id}
        `;

        const payload = fixtureOverridePayload({
          fixtureKey: row.fixtureKey,
          season: row.season,
          roundType: next.roundType,
          roundNumber: next.roundNumber,
          roundCode: next.roundCode,
          matchDate: next.matchDate,
          matchTime: next.matchTime,
          homeClubSlug: next.homeClubSlug,
          awayClubSlug: next.awayClubSlug,
          venueSlug: next.venueSlug,
          venueRaw: next.venueRaw,
          status: next.status,
          statusReason: next.statusReason,
          notes: next.notes,
        });
        await writeFixtureOverride(tx, payload, input.adminUserId);

        await recordDataEdit(tx, {
          tableName: 'fixtures',
          rowId: row.id,
          fieldGroup: input.fieldGroup,
          oldValues: applied.oldValues,
          newValues: {
            ...auditIdentity({
              fixtureKey: row.fixtureKey,
              season: row.season,
              roundCode: next.roundCode,
              homeClubSlug: next.homeClubSlug,
              awayClubSlug: next.awayClubSlug,
            }),
            ...applied.newValues,
          },
          adminUserId: input.adminUserId,
          note: input.note,
        });

        return { ok: true as const, fixtureKey: row.fixtureKey };
      }) as FixtureEditResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

export type RescheduleFixtureInput = FixtureEditBase & ScheduleInput;

/** Change the date and/or time. The identity does not move (§6). */
export async function rescheduleFixture(input: RescheduleFixtureInput) {
  const schedule = normaliseSchedule(input);
  if ('error' in schedule) return refuse('invalid_schedule', schedule.error);
  return editFixture({
    ...input,
    fieldGroup: 'fixture_schedule',
    apply: async ({ row }) => ({
      updates: { matchDate: schedule.matchDate, matchTime: schedule.matchTime },
      oldValues: { match_date: row.matchDate, match_time: row.matchTime },
      newValues: { match_date: schedule.matchDate, match_time: schedule.matchTime },
    }),
  });
}

export type ChangeFixtureVenueInput = FixtureEditBase & VenueInput;

/** Change the venue. The identity does not move (§6). */
export async function changeFixtureVenue(input: ChangeFixtureVenueInput) {
  // Resolved once in the precheck — i.e. before the first write — and reused by
  // `apply`, so the venue cannot change between validating it and storing it.
  let venue: ResolvedVenue | null = null;
  return editFixture({
    ...input,
    fieldGroup: 'fixture_venue',
    precheck: async ({ tx }) => {
      const resolved = await resolveVenue(tx, input);
      if ('ok' in resolved) return resolved;
      venue = resolved;
      return null;
    },
    apply: async ({ row }) => {
      const resolved = venue!;
      return {
        updates: {
          venueId: resolved.venueId, venueRaw: resolved.venueRaw, venueSlug: resolved.venueSlug,
        },
        oldValues: { venue_id: row.venueId, venue_raw: row.venueRaw },
        newValues: { venue_id: resolved.venueId, venue_raw: resolved.venueRaw },
      };
    },
  });
}

export type ChangeFixtureRoundInput = FixtureEditBase & RoundInput;

/**
 * Move the fixture to a different round, re-running the duplicate,
 * already-scheduled and already-played checks for the NEW round.
 */
export async function changeFixtureRound(input: ChangeFixtureRoundInput) {
  const round = renderRound(input);
  if ('error' in round) return refuse('invalid_round', round.error);
  return editFixture({
    ...input,
    fieldGroup: 'fixture_round',
    precheck: async ({ tx, row }) => {
      if (round.roundCode === row.roundCode) {
        return refuse('validation', 'That fixture is already in that round.');
      }
      return checkMoveTarget(tx, {
        excludeFixtureId: row.id,
        season: row.season,
        roundCode: round.roundCode,
        homeClubId: row.homeClubId,
        awayClubId: row.awayClubId,
        homeClubName: row.homeClubName,
        awayClubName: row.awayClubName,
      });
    },
    apply: async ({ row }) => ({
      updates: {
        roundType: round.roundType, roundNumber: round.roundNumber, roundCode: round.roundCode,
      },
      oldValues: {
        round_type: row.roundType, round_number: row.roundNumber, round_code: row.roundCode,
      },
      newValues: {
        round_type: round.roundType, round_number: round.roundNumber, round_code: round.roundCode,
      },
    }),
  });
}

export type ChangeFixtureClubsInput = FixtureEditBase & {
  homeClubId: number;
  awayClubId: number;
};

/**
 * Swap home and away, or replace one or both clubs — one primitive, because
 * both are the same edit to the same two columns and both must re-run the same
 * eligibility and collision checks.
 */
export async function changeFixtureClubs(input: ChangeFixtureClubsInput) {
  if (input.homeClubId === input.awayClubId) {
    return refuse('same_club', 'A fixture needs two different clubs.');
  }
  // Resolved once in the precheck — i.e. before the first write — and reused by
  // `apply`, so eligibility is decided exactly once per mutation.
  let target: { home: ResolvedFixtureClub; away: ResolvedFixtureClub } | null = null;
  return editFixture({
    ...input,
    fieldGroup: 'fixture_clubs',
    precheck: async ({ tx, row }) => {
      if (input.homeClubId === row.homeClubId && input.awayClubId === row.awayClubId) {
        return refuse('validation', 'Those are already this fixture\'s clubs.');
      }
      const clubs = await resolveClubsById(
        tx, [input.homeClubId, input.awayClubId], row.season,
      );
      for (const clubId of [input.homeClubId, input.awayClubId]) {
        const club = clubs.get(clubId);
        if (!club) return refuse('club_ineligible', `No club with id ${clubId}.`);
        if (!club.eligible) {
          return refuse('club_ineligible',
            `${club.name} is not a club whose fixtures may be administered for ${row.season}.`,
            [club.slug]);
        }
      }
      target = { home: clubs.get(input.homeClubId)!, away: clubs.get(input.awayClubId)! };
      return checkMoveTarget(tx, {
        excludeFixtureId: row.id,
        season: row.season,
        roundCode: row.roundCode,
        homeClubId: input.homeClubId,
        awayClubId: input.awayClubId,
        homeClubName: target.home.name,
        awayClubName: target.away.name,
      });
    },
    apply: async ({ row }) => {
      const { home, away } = target!;
      return {
        updates: {
          homeClubId: home.id, homeClubSlug: home.slug,
          awayClubId: away.id, awayClubSlug: away.slug,
        },
        oldValues: { home_club_slug: row.homeClubSlug, away_club_slug: row.awayClubSlug },
        newValues: { home_club_slug: home.slug, away_club_slug: away.slug },
      };
    },
  });
}

/**
 * The §13 collision rules re-applied to a fixture that is MOVING — the same
 * three checks, excluding the fixture itself.
 */
async function checkMoveTarget(tx: Tx, input: {
  excludeFixtureId: number;
  season: number;
  roundCode: string;
  homeClubId: number;
  awayClubId: number;
  homeClubName: string;
  awayClubName: string;
}): Promise<FixtureRefusal | null> {
  const [duplicate] = await tx<{ fixtureKey: string }[]>`
    SELECT fixture_key AS "fixtureKey" FROM fixtures
     WHERE season = ${input.season}::smallint AND round_code = ${input.roundCode}
       AND status = 'scheduled' AND id <> ${input.excludeFixtureId}
       AND ((home_club_id = ${input.homeClubId} AND away_club_id = ${input.awayClubId})
         OR (home_club_id = ${input.awayClubId} AND away_club_id = ${input.homeClubId}))
  `;
  if (duplicate) {
    return refuse('duplicate_fixture',
      `${input.homeClubName} v ${input.awayClubName} is already scheduled in that round.`,
      [duplicate.fixtureKey]);
  }

  const clash = await tx<{ clubId: number }[]>`
    SELECT CASE WHEN home_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[])
                THEN home_club_id ELSE away_club_id END AS "clubId"
      FROM fixtures
     WHERE season = ${input.season}::smallint AND round_code = ${input.roundCode}
       AND status = 'scheduled' AND id <> ${input.excludeFixtureId}
       AND (home_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[])
         OR away_club_id = ANY(${[input.homeClubId, input.awayClubId]}::int[]))
     LIMIT 1
  `;
  if (clash.length) {
    const name = clash[0].clubId === input.homeClubId ? input.homeClubName : input.awayClubName;
    return refuse('club_already_scheduled', `${name} already has a fixture in that round.`,
      [String(clash[0].clubId)]);
  }

  const played = await playedCandidatesFor(tx, {
    season: input.season, roundCode: input.roundCode,
    homeClubId: input.homeClubId, awayClubId: input.awayClubId,
  });
  if (played.exactCount + played.swappedCount > 0) {
    return refuse('already_played',
      `${input.homeClubName} v ${input.awayClubName} in that round has already been played.`);
  }
  return null;
}

export type UpdateFixtureNotesInput = FixtureEditBase & { notes?: string | null };

/** The only edit a PLAYED fixture accepts (§15). */
export async function updateFixtureNotes(input: UpdateFixtureNotesInput) {
  const notes = (input.notes ?? '').trim() || null;
  return editFixture({
    ...input,
    fieldGroup: 'fixture_notes',
    apply: async ({ row }) => ({
      updates: { notes },
      oldValues: { notes: row.notes },
      newValues: { notes },
    }),
  });
}

// --- lifecycle (§16, D-2) ------------------------------------------------

export type FixtureLifecycleInput = FixtureEditBase & { reason: string };

/**
 * A real-world cancellation: this scheduled event was genuine and did not
 * happen. The row, its identity, its schedule facts and its audit trail all
 * stay, and it can be reinstated if the game is later replayed.
 *
 * This is NOT a delete and NOT a void. Conflating a cancellation with an
 * operator's data-entry correction destroys the only record of which one
 * happened.
 */
export async function cancelFixture(input: FixtureLifecycleInput) {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for the cancellation.');
  return editFixture({
    ...input,
    fieldGroup: 'fixture_cancelled',
    precheck: async ({ row }) => (row.status === 'scheduled' ? null : refuse('invalid_transition',
      `That fixture is ${row.status}, so it cannot be cancelled.`)),
    apply: async ({ row }) => ({
      updates: { status: 'cancelled', statusReason: reason },
      oldValues: { status: row.status, status_reason: row.statusReason },
      newValues: { status: 'cancelled', status_reason: reason },
    }),
  });
}

/** Put a cancelled fixture back on the schedule, re-running the §13 checks. */
export async function reinstateFixture(input: FixtureEditBase) {
  return editFixture({
    ...input,
    fieldGroup: 'fixture_reinstated',
    precheck: async ({ tx, row }) => {
      if (row.status !== 'cancelled') {
        return refuse('invalid_transition',
          `That fixture is ${row.status}, so there is nothing to reinstate.`);
      }
      const bounds = await readFixtureSeasonBounds(tx as unknown as typeof sql);
      if (!isAdministrableFixtureSeason(row.season, bounds)) {
        return refuse('season_out_of_window', seasonBoundError(row.season, bounds));
      }
      return checkMoveTarget(tx, {
        excludeFixtureId: row.id,
        season: row.season,
        roundCode: row.roundCode,
        homeClubId: row.homeClubId,
        awayClubId: row.awayClubId,
        homeClubName: row.homeClubName,
        awayClubName: row.awayClubName,
      });
    },
    apply: async ({ row }) => ({
      updates: { status: 'scheduled', statusReason: null },
      oldValues: { status: row.status, status_reason: row.statusReason },
      newValues: { status: 'scheduled', status_reason: null },
    }),
  });
}

/**
 * A data-entry correction: this row should never have existed. It is kept —
 * never deleted — so its `data_edits` rows stay resolvable at the next
 * promotion lineage remap, and it is excluded from every uniqueness rule and
 * hidden from the default lists.
 *
 * Voiding is terminal and is not the reverse of cancelling: a voided fixture is
 * replaced by entering a new one, which mints a new identity because it is a
 * different assertion.
 */
export async function voidFixture(input: FixtureLifecycleInput) {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for voiding this fixture.');
  return editFixture({
    ...input,
    fieldGroup: 'fixture_void',
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That fixture is already void.')
      : null),
    apply: async ({ row }) => ({
      updates: { status: 'void', statusReason: reason },
      oldValues: { status: row.status, status_reason: row.statusReason },
      newValues: { status: 'void', status_reason: reason },
    }),
  });
}

// --- reads (§18, §27, §30) -----------------------------------------------

export type SeasonFixtureRow = FixtureRow & {
  playedState: PlayedState;
  /** The played `matches.id`, resolved at READ TIME. Never stored (D-6). */
  playedMatchId: number | null;
  /** True when the played row disagrees with the fixture on date, time or venue. */
  scheduleDiffersFromResult: boolean;
};

type RawSeasonFixtureRow = FixtureRow & {
  exactCount: number;
  exactMatchId: number | null;
  swappedCount: number;
  swappedMatchId: number | null;
  resultDate: string | null;
  resultTime: string | null;
  resultVenueId: number | null;
};

function withPlayedResolution(raw: RawSeasonFixtureRow): SeasonFixtureRow {
  const resolution = resolvePlayed({
    status: raw.status,
    exactCount: raw.exactCount,
    exactMatchId: raw.exactMatchId,
    swappedCount: raw.swappedCount,
    swappedMatchId: raw.swappedMatchId,
  });
  // A disagreement is only meaningful where BOTH sides hold the fact: a fixture
  // whose date is still TBC does not "differ" from the result, it simply has
  // nothing to compare (D-5 — NULL means unknown, never a value).
  //
  // `matchId !== null` restates in TypeScript the guard PLAYED_RESULT_FACTS
  // already carries in SQL: an ambiguous resolution links to nothing, so it has
  // no result row to disagree with. The two are deliberately both present —
  // this is the D-6 property that must not be able to come back by one of them
  // being edited.
  const differs = isPlayedState(resolution.state) && resolution.matchId !== null && (
    (raw.matchDate !== null && raw.resultDate !== null && raw.matchDate !== raw.resultDate)
    || (raw.matchTime !== null && raw.resultTime !== null && raw.matchTime !== raw.resultTime)
    || (raw.venueId !== null && raw.resultVenueId !== null && raw.venueId !== raw.resultVenueId)
  );
  return {
    id: raw.id,
    fixtureKey: raw.fixtureKey,
    season: raw.season,
    roundCode: raw.roundCode,
    roundNumber: raw.roundNumber,
    roundType: raw.roundType,
    isFinal: raw.isFinal,
    matchDate: raw.matchDate,
    matchTime: raw.matchTime,
    venueId: raw.venueId,
    venueSlug: raw.venueSlug,
    venueRaw: raw.venueRaw,
    homeClubId: raw.homeClubId,
    homeClubSlug: raw.homeClubSlug,
    homeClubName: raw.homeClubName,
    awayClubId: raw.awayClubId,
    awayClubSlug: raw.awayClubSlug,
    awayClubName: raw.awayClubName,
    status: raw.status,
    statusReason: raw.statusReason,
    notes: raw.notes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    playedState: resolution.state,
    playedMatchId: resolution.matchId,
    scheduleDiffersFromResult: differs,
  };
}

/**
 * The played row's date, time and venue, for `scheduleDiffersFromResult` — and
 * ONLY for a fixture whose played resolution is unique (D-6).
 *
 * The guard is the last predicate, and it is the whole point of this fragment.
 * Its candidate set is the same set `pl` counted, so `exactCount + swappedCount
 * = 1` means there is EXACTLY ONE candidate row: the one {@link resolvePlayed}
 * links to. Every ambiguous shape yields no row at all, so a disagreement can
 * never be reported against a result row picked by a tie-break — which is what
 * `ORDER BY m.id LIMIT 1` over all candidates did, independently of the
 * resolution, before this was corrected.
 *
 * `pl` must therefore precede this join in the FROM list; both readers below
 * compose them in that order.
 */
const PLAYED_RESULT_FACTS = `
  LEFT JOIN LATERAL (
    SELECT m.match_date::text AS "resultDate", m.match_time AS "resultTime",
           m.venue_id AS "resultVenueId"
      FROM matches m
     WHERE m.season = f.season AND m.round_code = f.round_code
       AND ((m.home_club_id = f.home_club_id AND m.away_club_id = f.away_club_id)
         OR (m.home_club_id = f.away_club_id AND m.away_club_id = f.home_club_id))
       AND pl."exactCount" + pl."swappedCount" = 1
  ) rf ON true`;

/**
 * TBC sorts to the END of its round, never to the start: a round whose dates
 * are half announced must read as "these, then the ones still to be confirmed".
 */
const FIXTURE_ORDER = `
  ORDER BY f.round_number NULLS LAST, f.round_code,
           f.match_date NULLS LAST, f.match_time NULLS LAST, f.id`;

/**
 * Every fixture of one season with its played resolution — ONE query (§30).
 *
 * Void fixtures are excluded unless asked for: a row entered in error is not
 * part of the schedule, but it is never deleted, so it stays available behind
 * an explicit filter with its reason.
 */
export async function readSeasonFixtures(
  season: number, options: { includeVoid?: boolean } = {},
): Promise<SeasonFixtureRow[]> {
  const raw = await sql.unsafe(
    `SELECT ${FIXTURE_COLUMNS},
            pl."exactCount", pl."exactMatchId", pl."swappedCount", pl."swappedMatchId",
            rf."resultDate", rf."resultTime", rf."resultVenueId"
     ${FIXTURE_JOINS}
     ${PLAYED_RESOLUTION_LATERAL}
     ${PLAYED_RESULT_FACTS}
      WHERE f.season = $1::smallint
        AND ($2::boolean OR f.status <> 'void')
     ${FIXTURE_ORDER}`,
    [season, options.includeVoid ?? false],
  ) as unknown as RawSeasonFixtureRow[];
  return raw.map(withPlayedResolution);
}

/** One fixture by its durable identity, with the same read-time resolution. */
export async function readFixture(fixtureKey: string): Promise<SeasonFixtureRow | null> {
  const raw = await sql.unsafe(
    `SELECT ${FIXTURE_COLUMNS},
            pl."exactCount", pl."exactMatchId", pl."swappedCount", pl."swappedMatchId",
            rf."resultDate", rf."resultTime", rf."resultVenueId"
     ${FIXTURE_JOINS}
     ${PLAYED_RESOLUTION_LATERAL}
     ${PLAYED_RESULT_FACTS}
      WHERE f.fixture_key = $1`,
    [fixtureKey],
  ) as unknown as RawSeasonFixtureRow[];
  return raw[0] ? withPlayedResolution(raw[0]) : null;
}

export type FixtureSeasonSummary = {
  season: number;
  fixtures: number;
  rounds: number;
  scheduled: number;
  cancelled: number;
  voided: number;
  dateTbc: number;
  timeTbc: number;
  venueTbc: number;
};

/** The season selector's counts — one grouped query per administrable season. */
export async function readFixtureSeasonSummary(season: number): Promise<FixtureSeasonSummary> {
  const [row] = await sql<FixtureSeasonSummary[]>`
    SELECT ${season}::int AS season,
           (count(*) FILTER (WHERE status <> 'void'))::int AS fixtures,
           (count(DISTINCT round_code) FILTER (WHERE status <> 'void'))::int AS rounds,
           (count(*) FILTER (WHERE status = 'scheduled'))::int AS scheduled,
           (count(*) FILTER (WHERE status = 'cancelled'))::int AS cancelled,
           (count(*) FILTER (WHERE status = 'void'))::int AS voided,
           (count(*) FILTER (WHERE status <> 'void' AND match_date IS NULL))::int AS "dateTbc",
           (count(*) FILTER (WHERE status <> 'void' AND match_time IS NULL))::int AS "timeTbc",
           (count(*) FILTER (WHERE status <> 'void' AND venue_id IS NULL
                               AND venue_raw IS NULL))::int AS "venueTbc"
      FROM fixtures
     WHERE season = ${season}::smallint
  `;
  return row ?? {
    season, fixtures: 0, rounds: 0, scheduled: 0, cancelled: 0, voided: 0,
    dateTbc: 0, timeTbc: 0, venueTbc: 0,
  };
}

/**
 * A played `matches` row in a season/round with no fixture at all — the
 * AFLDB-ISSUE-140 cue that a fixture was entered under the wrong round
 * convention (§27). Read-only, and it never proposes a change: it reports.
 */
export type PlayedMatchWithoutFixture = {
  matchId: number;
  roundCode: string;
  matchDate: string;
  homeClubName: string;
  awayClubName: string;
};

export async function readPlayedMatchesWithoutFixture(
  season: number,
): Promise<PlayedMatchWithoutFixture[]> {
  return sql<PlayedMatchWithoutFixture[]>`
    SELECT m.id AS "matchId", m.round_code AS "roundCode", m.match_date::text AS "matchDate",
           hc.name AS "homeClubName", ac.name AS "awayClubName"
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
     WHERE m.season = ${season}::smallint
       AND NOT EXISTS (
             SELECT 1 FROM fixtures f
              WHERE f.season = m.season AND f.round_code = m.round_code
                AND f.status <> 'void'
                AND ((f.home_club_id = m.home_club_id AND f.away_club_id = m.away_club_id)
                  OR (f.home_club_id = m.away_club_id AND f.away_club_id = m.home_club_id)))
     ORDER BY m.match_date, m.id
  `;
}

/** The administrable season range, for the season selector. */
export async function administrableFixtureSeasons(): Promise<FixtureSeasonBounds> {
  return readFixtureSeasonBounds(sql);
}

// --- diagnostics (§27) ---------------------------------------------------

export type FixtureDiagnosticSeverity = 'invalid' | 'warning' | 'info';

export type FixtureDiagnostic = {
  severity: FixtureDiagnosticSeverity;
  code: string;
  message: string;
  /** The fixtures a diagnostic is ABOUT, so a caller need not parse the sentence. */
  fixtureKeys?: string[];
};

/**
 * THE fixture diagnostics, as a pure function over rows a caller has already
 * read. Every one of them REPORTS; none refuses and none proposes a change.
 *
 * That is deliberate and is the whole design of §27: AFL season shapes vary —
 * an Opening Round, 22, 23 or 24 home-and-away rounds, unequal club counts, a
 * Wildcard round, split rounds — so a rule that enforced a shape would be wrong
 * about some real season. Byes in particular are the ABSENCE of a fixture and
 * are never rows, so "this club has no fixture in round 7" is listed as
 * information and never judged: bye and incomplete-entry are not decidable from
 * the data.
 *
 * The `invalid` class should be unreachable — the writer refuses each of these
 * before writing — and exists so that a row which somehow got past it (a direct
 * SQL edit, a future importer's bug) is SEEN rather than silently trusted.
 */
export function classifyFixtureDiagnostics(input: {
  fixtures: readonly SeasonFixtureRow[];
  playedWithoutFixture: readonly PlayedMatchWithoutFixture[];
  eligibleClubs: readonly EligibleFixtureClub[];
}): FixtureDiagnostic[] {
  const out: FixtureDiagnostic[] = [];
  const live = input.fixtures.filter((f) => f.status === 'scheduled');

  // --- invalid: should be impossible, shown if ever present ---------------
  const byRoundClub = new Map<string, string[]>();
  const byRoundPair = new Map<string, string[]>();
  for (const f of live) {
    for (const clubId of [f.homeClubId, f.awayClubId]) {
      const key = `${f.roundCode}|${clubId}`;
      byRoundClub.set(key, [...(byRoundClub.get(key) ?? []), f.fixtureKey]);
    }
    const pair = [f.homeClubId, f.awayClubId].slice().sort((a, b) => a - b).join('-');
    const key = `${f.roundCode}|${pair}`;
    byRoundPair.set(key, [...(byRoundPair.get(key) ?? []), f.fixtureKey]);
  }
  for (const [key, keys] of byRoundClub) {
    if (keys.length > 1) {
      out.push({
        severity: 'invalid',
        code: 'club_twice_in_round',
        message: `A club is scheduled twice in round ${key.split('|')[0]}.`,
        fixtureKeys: keys,
      });
    }
  }
  for (const [key, keys] of byRoundPair) {
    if (keys.length > 1) {
      out.push({
        severity: 'invalid',
        code: 'pair_twice_in_round',
        message: `The same two clubs are scheduled twice in round ${key.split('|')[0]}.`,
        fixtureKeys: keys,
      });
    }
  }
  const badRound = input.fixtures.filter(
    (f) => (f.roundType === 'home_and_away') !== (f.roundNumber !== null),
  );
  if (badRound.length) {
    out.push({
      severity: 'invalid',
      code: 'round_number_mismatch',
      message: 'A fixture\'s round type and round number disagree.',
      fixtureKeys: badRound.map((f) => f.fixtureKey),
    });
  }
  const ambiguous = input.fixtures.filter((f) => f.playedState === 'ambiguous');
  if (ambiguous.length) {
    out.push({
      severity: 'invalid',
      code: 'ambiguous_played_resolution',
      message: 'More than one played match could be this fixture, so it is deliberately left '
        + 'unlinked. Correct the round or the clubs on one of them.',
      fixtureKeys: ambiguous.map((f) => f.fixtureKey),
    });
  }

  // --- warnings -----------------------------------------------------------
  const pushWhen = (
    rows: readonly SeasonFixtureRow[], code: string, message: string,
    severity: FixtureDiagnosticSeverity = 'warning',
  ) => {
    if (rows.length) {
      out.push({ severity, code, message, fixtureKeys: rows.map((f) => f.fixtureKey) });
    }
  };

  pushWhen(
    input.fixtures.filter((f) => f.playedState === 'played_home_away_differs'),
    'played_home_away_differs',
    'The played match has the home and away clubs the other way round.',
  );
  pushWhen(
    input.fixtures.filter((f) => f.scheduleDiffersFromResult),
    'schedule_differs_from_result',
    'The played match disagrees with the fixture on its date, time or venue. The result is '
    + 'authoritative for what happened; the fixture records what was scheduled.',
  );
  pushWhen(
    input.fixtures.filter((f) => f.venueId === null && f.venueRaw !== null),
    'unmapped_venue',
    'The venue is recorded by name but is not in the venue register yet.',
  );
  if (input.playedWithoutFixture.length) {
    out.push({
      severity: 'warning',
      code: 'played_match_without_fixture',
      message: `${input.playedWithoutFixture.length} played match(es) in this season have no `
        + 'fixture. If one of them was entered under a different round, correct the fixture\'s '
        + 'round rather than adding a second one.',
    });
  }
  if (live.length) {
    const scheduledClubs = new Set(live.flatMap((f) => [f.homeClubId, f.awayClubId]));
    const missing = input.eligibleClubs.filter((c) => !scheduledClubs.has(c.id));
    if (missing.length) {
      out.push({
        severity: 'warning',
        code: 'club_with_no_fixtures',
        message: `No fixture at all for: ${missing.map((c) => c.name).join(', ')}. That is `
          + 'expected while a season is being entered, and a problem once it is complete.',
      });
    }
  }

  // --- information --------------------------------------------------------
  out.push({
    severity: 'info',
    code: 'counts',
    message: `${live.length} scheduled, `
      + `${input.fixtures.filter((f) => f.status === 'cancelled').length} cancelled, `
      + `${input.fixtures.filter((f) => isPlayedState(f.playedState)).length} played, `
      + `${new Set(live.map((f) => f.roundCode)).size} round(s); TBC: `
      + `${live.filter((f) => f.matchDate === null).length} date, `
      + `${live.filter((f) => f.matchTime === null).length} time, `
      + `${live.filter((f) => f.venueId === null && f.venueRaw === null).length} venue.`,
  });
  for (const roundCode of [...new Set(live.map((f) => f.roundCode))]) {
    const inRound = live.filter((f) => f.roundCode === roundCode);
    const playing = new Set(inRound.flatMap((f) => [f.homeClubId, f.awayClubId]));
    const idle = input.eligibleClubs.filter((c) => !playing.has(c.id));
    if (idle.length) {
      out.push({
        severity: 'info',
        code: 'round_byes',
        message: `Round ${roundCode}: ${inRound.length} fixture(s); no fixture for `
          + `${idle.map((c) => c.name).join(', ')}. A bye and an incomplete round look the same `
          + 'in the data, so this is reported rather than judged.',
      });
    }
  }
  return out;
}

/** The diagnostics for one season — three reads, then the pure classification. */
export async function readFixtureDiagnostics(season: number): Promise<FixtureDiagnostic[]> {
  const [fixtures, playedWithoutFixture, eligibleClubs] = await Promise.all([
    readSeasonFixtures(season),
    readPlayedMatchesWithoutFixture(season),
    eligibleFixtureClubs(season),
  ]);
  return classifyFixtureDiagnostics({ fixtures, playedWithoutFixture, eligibleClubs });
}

// --- durable-record reads (import role only, ISSUE-159 D-2) --------------

export type FixtureOverrideRow = {
  entityKey: string;
  fieldGroup: string;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: Date;
};

/**
 * The durable record for one fixture. `data_overrides` carries no
 * `grant_app_read` (073 grants SELECT to `afldb_import` only), so this goes
 * through the narrow SELECT-only import-role helper.
 */
export async function readFixtureOverrides(fixtureKey: string): Promise<FixtureOverrideRow[]> {
  return withImportConnection((importSql) => importSql<FixtureOverrideRow[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup",
           override_values AS "overrideValues", is_active AS "isActive", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = ${FIXTURE_ENTITY_TYPE} AND entity_key = ${fixtureEntityKey(fixtureKey)}
     ORDER BY field_group
  `);
}
