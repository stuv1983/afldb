/**
 * AFLDB-ISSUE-228 S7 follow-up (2026-09-20) — the fixture-only Brownlow
 * identity PREREQUISITE.
 *
 * BACKGROUND (simulator evidence audit, same date): of the 207 real 2025
 * matches that are also Brownlow-voting matches, only a handful carry
 * captured `playerStats`/`matchRoster` evidence. The normal acquisition
 * (`acquire-afl-api.ts`) unconditionally fetches BOTH for every selected
 * match, so it cannot be pointed at the other ~200 without fabricating
 * evidence. This module is the smallest safe substitute: it gives Brownlow
 * match resolution (`afl-api-brownlow.ts`) enough TRUTHFUL identity evidence
 * from the season fixture feed ALONE — season, home/away club, and an exact
 * venue-local match date — to resolve a provider `CD_M…` to an EXISTING
 * canonical `matches` row, without ever touching `playerStats`/`matchRoster`/
 * CFS.
 *
 * WHY NOT `staging.afl_api_match` (migration 103, Option A). That table's
 * `match_date` is `NOT NULL` and is sourced from the companion
 * `match_roster` observation's `venueLocalStartTime` (103's own header:
 * "Sourced from the companion match_roster observation... see the header's
 * KNOWN LIMITATION"); `buildAflApiMatchIdentity()`
 * (`afl-api-match-identity.ts`) refuses `unproved_match_date` without it.
 * Fixture-only acquisition never has a roster capture, so that column can
 * never be truthfully populated here — weakening the NOT NULL or fabricating
 * a value is exactly what the operator's brief forbids. This module
 * therefore writes NOTHING to `staging.afl_api_match` and resolves identity
 * by a DIFFERENT, narrower path: (season, home club, away club, exact venue-
 * local match date) against the EXISTING `matches` table directly — trusted
 * fields the fixture feed alone (§2.1 of the runbook) already carries in
 * full.
 *
 * ROUND IS DELIBERATELY NOT PART OF THE LOOKUP KEY (S7 reschedule
 * correction, 2026-09-20). It used to be: (season, translated round, home,
 * away). Runtime evidence against the real 2025 season feed proved that
 * wrong for a legitimately rescheduled/postponed match —
 * `admin-fixtures.ts`'s `rescheduleFixture()` only ever moves a fixture's
 * date/time, never its `round_number` (a round change is the separate,
 * audited `changeFixtureRound()`), while the provider's OWN fixture round
 * for that match reflects whichever week it was actually played. Requiring
 * provider round == canonical round therefore refused two real, resolvable
 * matches (`unknown_match`) purely because they had been moved. The
 * replacement key drops round entirely and instead uses the fixture's own
 * `utcStartTime` + `venue.timezone` — via the SAME tested, timezone-aware
 * `convertUtcInstantToVenueLocal()` `afl-api-bundle.ts` already uses for its
 * roster cross-check — to derive the venue-local calendar date the match was
 * ACTUALLY played on, and matches that EXACTLY against `matches.match_date`.
 * This is READ-ONLY correlation evidence for an ambiguity-fails-closed
 * lookup, never identity CONSTRUCTION: `buildAflApiMatchIdentity()`'s
 * "never derived from utcStartTime alone" rule is about PROVING a
 * `match_key`/`match_date` well enough to WRITE it, which still requires the
 * roster cross-check exactly as before and is completely untouched here.
 * Two independently-observed clubs, a season, and an exact calendar date are
 * either unique enough to name one real match, or the query itself proves
 * that they were not (0 or >1 rows) and refuses — never a "nearest date"
 * guess, and never silently picked.
 *
 * WHAT THIS MODULE WRITES: exactly one thing — the `match` family's own
 * spine observation (`staging.source_records`/`source_record_versions`/
 * `source_payloads`, migration 074), using the SAME raw fixture payload a
 * full acquisition's own `match`-family record already carries
 * (`settle-afl-api.ts`'s `buildAflApiSettleRecords()` sets
 * `payload: fixtureRaw` for that family too) — so a later full acquisition
 * of the same match persists byte-identical content and this fixture-only
 * observation is simply head-touched or superseded in place (I1/I2), never
 * duplicated or reinterpreted as something it is not. It never writes
 * `staging.afl_api_match`, `matches`, `match_period_scores`,
 * `player_match_stats`, a promotion candidate, or a data_issues row — there
 * is no code path here that could.
 *
 * WHAT THIS MODULE RESOLVES (read-only): `resolveAflApiMatchViaFixtureObservation()`
 * answers "which existing canonical `matches` row, if any, is this provider
 * match id?" using ONLY (season, home club, away club, exact venue-local
 * match date) — never `match_key` (unavailable without a roster capture),
 * never a player or vote-recipient name, never fuzzy/nearest-date matching,
 * never provider round. 0 canonical hits is `unknown_match`; exactly 1 is
 * the resolution; more than 1 is `fixture_identity_ambiguous` — never
 * silently picked. It issues SELECTs only, so it can never re-own a foreign
 * (e.g. `afltables`) row or create a duplicate canonical match — ownership
 * and canonical-row identity are exactly as they were before this module
 * ran, always.
 */
import type postgres from 'postgres';

import {
  AflApiBundleError,
  convertUtcInstantToVenueLocal,
  emitAflApiMatch,
  type AflApiIdentities,
  type AflApiMatchProjection,
} from './afl-api-bundle';
import {
  AflApiMatchIdentityError,
  resolveAflApiMatchClubs,
  type AflApiMatchClubResolution,
} from './afl-api-match-identity';
import type { ImportBatchId } from '../import-batch-id';
import type { JsonValue } from './observations';
import { persistSourceObservation } from './observation-store';
import { getSourceFamily, type SourceFamilyRegistry } from './source-families';

type Sql = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

const MATCH_FAMILY = 'match';

/**
 * Distinguishes a `--fixtures-only` acquisition's manifest from a normal
 * `afl_api_match_snapshot` one — used by both `acquire-afl-api.ts` (to write
 * it) and `settle-afl-api-fixtures.ts` (to refuse a manifest that is not
 * this kind, and so that `settle-afl-api.ts` — which this constant does not
 * touch — can never mistake a fixtures-only snapshot for a complete one by
 * silently accepting it; that tool's own manifest check pins the OTHER
 * value, `afl_api_match_snapshot`).
 */
export const AFL_API_FIXTURE_ACQUISITION_KIND = 'afl_api_fixture_snapshot';

// ---------------------------------------------------------------------------
// Build: DB-free, exactly `emitAflApiMatch()` per already-selected raw
// fixture object — no roster, no stats, no database.
// ---------------------------------------------------------------------------

export type AflApiFixtureBuildFailure = { providerMatchId: string | null; error: string };

export type AflApiFixtureRecord = {
  providerMatchId: string;
  /** The raw, already-`JSON.parse()`d season-feed match object — the exact
   * shape a full acquisition's own per-match `fixture.json` carries, and
   * exactly what the `match` family's own spine payload already is (see the
   * module doc comment). Never a roster or stats payload. */
  payload: unknown;
  projection: AflApiMatchProjection;
};

function providerIdOf(fixtureRaw: unknown): string | null {
  if (fixtureRaw === null || typeof fixtureRaw !== 'object') return null;
  const value = (fixtureRaw as Record<string, unknown>).providerId;
  return typeof value === 'string' ? value : null;
}

/**
 * DB-free: `emitAflApiMatch()` for every already-selected raw fixture
 * object, isolating one match's contract violation from every other
 * (mirrors `buildAflApiSettleBundle()`'s per-unit failure isolation in
 * `settle-afl-api.ts` — a bad payload never aborts the whole snapshot).
 */
export function buildAflApiFixtureRecords(
  fixturesRaw: readonly unknown[],
  registry: SourceFamilyRegistry,
  identities: AflApiIdentities,
): { records: AflApiFixtureRecord[]; buildFailures: AflApiFixtureBuildFailure[] } {
  const records: AflApiFixtureRecord[] = [];
  const buildFailures: AflApiFixtureBuildFailure[] = [];
  for (const fixtureRaw of fixturesRaw) {
    const providerMatchId = providerIdOf(fixtureRaw);
    try {
      const { record: projection } = emitAflApiMatch(fixtureRaw, registry, identities);
      records.push({ providerMatchId: projection.sourceRecordId, payload: fixtureRaw, projection });
    } catch (error) {
      buildFailures.push({
        providerMatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { records, buildFailures };
}

// ---------------------------------------------------------------------------
// Persist: the ONE write this module performs — the `match` family's own
// spine observation. No projection, no target pass, no candidate.
// ---------------------------------------------------------------------------

export type AflApiFixtureObservationCounters = {
  observationsSeen: number;
  versionsAppended: number;
  observationsUnchanged: number;
};

/**
 * Persists ONLY the `match` family's spine observation for each fixture
 * record. Never `staging.afl_api_match` (see the module doc comment for
 * why), never a `matches`/`match_period_scores`/`player_match_stats` write,
 * never a promotion candidate, never a data_issues row — this function's
 * body is the entire write surface fixture-only settling has.
 */
export async function persistAflApiFixtureObservations(
  tx: Tx,
  input: {
    sourceId: number;
    season: number;
    registry: SourceFamilyRegistry;
    records: readonly AflApiFixtureRecord[];
    batchId: ImportBatchId;
    observedAt: string;
  },
): Promise<AflApiFixtureObservationCounters> {
  const contract = getSourceFamily(input.registry, 'afl_api', MATCH_FAMILY);
  const counters: AflApiFixtureObservationCounters = {
    observationsSeen: 0, versionsAppended: 0, observationsUnchanged: 0,
  };
  for (const record of input.records) {
    const action = await persistSourceObservation(
      tx,
      {
        contract,
        sourceId: input.sourceId,
        externalRecordId: record.providerMatchId,
        scopeKey: `season=${input.season}`,
        payload: record.payload as JsonValue,
      },
      input.batchId,
      input.observedAt,
    );
    counters.observationsSeen += 1;
    if (action === 'version_inserted') counters.versionsAppended += 1;
    else counters.observationsUnchanged += 1;
  }
  return counters;
}

// ---------------------------------------------------------------------------
// Resolve: the Brownlow identity FALLBACK. Read-only — see the module doc
// comment for why this can never re-own or duplicate a canonical match.
// ---------------------------------------------------------------------------

export type AflApiFixtureIdentityResolution =
  | { outcome: 'resolved'; matchId: number; isFinal: boolean; season: number }
  | {
    outcome: 'refused';
    reason:
      | 'no_fixture_observation'
      | 'fixture_observation_invalid'
      | 'unmapped_club_hist'
      | 'match_date_unavailable'
      | 'unknown_match'
      | 'fixture_identity_ambiguous';
  };

type FixtureHeadPayloadRow = { rawPayload: unknown };

/**
 * The exact venue-local calendar date this fixture observation was played
 * on — `projection.utcStartTime` converted via `projection.venueTimezone`
 * using the same tested derivation `afl-api-bundle.ts` uses for its roster
 * cross-check (see the module doc comment for why reusing it here, for a
 * READ-ONLY lookup, does not weaken that write-side guarantee). `null` when
 * the fixture carries no recognised venue timezone (`venue.timezone` is
 * known-but-not-required, §5.3) or an unparseable `utcStartTime` — either
 * means the date is unprovable, so the caller refuses rather than falling
 * back to a guess.
 */
function deriveFixtureVenueLocalMatchDate(projection: AflApiMatchProjection): string | null {
  if (projection.venueTimezone === null) return null;
  const utcInstant = new Date(projection.utcStartTime);
  if (Number.isNaN(utcInstant.getTime())) return null;
  const local = convertUtcInstantToVenueLocal(utcInstant, projection.venueTimezone);
  return local ? local.matchDate : null;
}

/**
 * The same three-table join `persistSourceObservation()` uses to read a
 * record's current head (`observation-store.ts`), narrowed to the one
 * column this resolver needs. Read-only.
 */
async function readCurrentFixturePayload(
  sql: Sql, sourceId: number, providerMatchId: string,
): Promise<unknown | null> {
  const [row] = await sql<FixtureHeadPayloadRow[]>`
    SELECT p.raw_payload AS "rawPayload"
      FROM staging.source_records r
      JOIN staging.source_record_versions v
        ON v.source_id = r.source_id
       AND v.family = r.family
       AND v.external_record_id = r.external_record_id
       AND v.version_seq = r.current_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id
       AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE r.source_id = ${sourceId}
       AND r.family = ${MATCH_FAMILY}
       AND r.external_record_id = ${providerMatchId}
  `;
  return row ? row.rawPayload : null;
}

type CanonicalMatchIdRow = { id: number };

/**
 * Resolves `providerMatchId` to an EXISTING canonical `matches` row using
 * ONLY (season, home club, away club, exact venue-local match date) —
 * trusted, independently-observed fixture fields, never `match_key`
 * (unavailable without a roster capture), never a name, never provider
 * round (S7 reschedule correction, 2026-09-20 — see the module doc comment),
 * never a "nearest date" guess. 0 hits is `unknown_match`; more than 1 is
 * `fixture_identity_ambiguous` — never silently picked. Issues SELECTs
 * only: this function cannot write `matches`, so it can never re-own a
 * foreign-owned row or create a duplicate canonical match.
 */
export async function resolveAflApiMatchViaFixtureObservation(
  sql: Sql,
  sourceId: number,
  providerMatchId: string,
  registry: SourceFamilyRegistry,
  identities: AflApiIdentities,
): Promise<AflApiFixtureIdentityResolution> {
  const rawPayload = await readCurrentFixturePayload(sql, sourceId, providerMatchId);
  if (rawPayload === null) return { outcome: 'refused', reason: 'no_fixture_observation' };

  let projection: AflApiMatchProjection;
  try {
    ({ record: projection } = emitAflApiMatch(rawPayload, registry, identities));
  } catch (error) {
    if (error instanceof AflApiBundleError) return { outcome: 'refused', reason: 'fixture_observation_invalid' };
    throw error;
  }

  const matchDate = deriveFixtureVenueLocalMatchDate(projection);
  if (matchDate === null) return { outcome: 'refused', reason: 'match_date_unavailable' };

  let clubs: { home: AflApiMatchClubResolution; away: AflApiMatchClubResolution };
  try {
    clubs = await resolveAflApiMatchClubs(sql, projection.homeClubHist, projection.awayClubHist);
  } catch (error) {
    if (error instanceof AflApiMatchIdentityError) return { outcome: 'refused', reason: 'unmapped_club_hist' };
    throw error;
  }

  const rows = await sql<CanonicalMatchIdRow[]>`
    SELECT id::int AS id
      FROM matches
     WHERE season = ${projection.season}
       AND home_club_id = ${clubs.home.clubId}
       AND away_club_id = ${clubs.away.clubId}
       AND match_date = ${matchDate}::date
  `;
  if (rows.length === 0) return { outcome: 'refused', reason: 'unknown_match' };
  if (rows.length > 1) return { outcome: 'refused', reason: 'fixture_identity_ambiguous' };

  return { outcome: 'resolved', matchId: rows[0].id, isFinal: projection.isFinal, season: projection.season };
}
