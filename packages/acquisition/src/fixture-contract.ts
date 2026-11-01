/**
 * AFLDB V2 Stage 3 — the AFL API FIXTURE IDENTITY CONTRACT (docs/v2/owner-instruction-2026-10-19.md
 * "Fixtures and player identity"; AFLDB-ISSUE-229).
 *
 * PURE: no database, no IO, no network. This module is the set of safe SURROUNDING contracts for
 * AFL API fixture ingestion — status routing, the projection preconditions, and collision
 * detection — and nothing more. It does NOT write fixtures, mint a `fixture_key`, resolve a club
 * id, or look anything up in PostgreSQL.
 *
 * ISSUE-229 IS STILL OPEN. The fixture WRITER is held by decision (issues.md:42056-42057: "Next
 * action: B2, the first authentic 2027 pre-match season feed (TBC representation, whole-season
 * shape validation), before the writer is wired or applied."; runbook
 * issues/open/AFLDB-ISSUE-229.md:515 "B2 is still required before the writer is wired or
 * applied."). Where the evidence is not yet observed this module REFUSES; it never invents the
 * answer. In particular it has no representation of a genuine TBC start time (runbook :564-565
 * "How a genuine TBC start is represented is still evidence-pending until B2.") and no mapping
 * for POSTPONED / CANCELLED / ABANDONED / TBC.
 *
 * DECISIONS ENCODED (each quoted from the runbook, `issues/open/AFLDB-ISSUE-229.md`):
 *   D-229-1 (revised, :520-530)  "`SCHEDULED`: eligible for fixture projection" / "`UNCONFIRMED_TEAMS`:
 *     **now also eligible** for fixture projection" / "Both project to AFLDB fixture status
 *     **`scheduled`**" / "`CONCLUDED`: the existing AFL API match/corroboration path. The fixture
 *     writer takes no action." / "Every other value: fails closed and stays visible verbatim."
 *   D-229-2 (revised, :531-537)  "If either observed pre-match status arrives with a score block,
 *     that is an unobserved shape and it refuses."
 *   D-229-3 (:538-541)  "Provider postponement and cancellation statuses stay unsupported until
 *     observed." / "No provider status maps automatically to `cancelled` or `void`." / "An
 *     unsupported status never mutates an existing fixture."
 *   D-229-5 (final, :550-566)  start time parses in exactly `YYYY-MM-DDTHH:MM:SS.sss+0000`; the
 *     provider venue id "resolves deterministically to an AFLDB venue"; `venue.timezone` is valid
 *     (`convertUtcInstantToVenueLocal` returns non-null); "the conversion is exact to fixture
 *     storage precision (`HH:MM`)... a non-zero seconds value refuses and is never truncated";
 *     "A known start time is never written as NULL/TBC." The zone is the provider's observed
 *     value; AFLDB does not own or store it.
 *   D-229-7 (:616-620)  "The durable provider identity is `(source_id, source_record_id)`, not
 *     `fixture_key`." Here that is `{ sourceKey: 'afl_api', sourceRecordId: providerId }`; the
 *     numeric `source_id` is a `sources.key` lookup, which is database work and so stays out.
 *   D-229-8a (:602-614)  "First-slice fixture ingestion does **not** persist pre-match rows into the
 *     existing AFL API `match` observation spine". A projection therefore targets `fixtures` only
 *     (`observationSpine: false`).
 *   PLACEHOLDER (owner decision 2026-11-01, observed in the first authentic 2027 feed): an UNCONFIRMED scheduled
 *     fixture. It projects to AFLDB status `scheduled` with `confirmation: 'unconfirmed'`; it is never a result,
 *     a cancellation or a void. A provider team that is a LABEL rather than a club (ladder position, bracket
 *     reference) must be declared in `identities.placeholderTeams` and is admitted ONLY on an unconfirmed fixture;
 *     it never becomes a club. A provider venue that is a LABEL ('To Be Confirmed') must be declared in
 *     `identities.placeholderVenues`, is admitted ONLY on an unconfirmed fixture, never becomes a venue, and,
 *     because no venue-local zone can be proven for it, leaves the local date and time unresolved (NULL).
 *   D-229-4 (:543-545) is about conflicts against EXISTING rows in the database (I-1, I-2, I-3,
 *     foreign_owned_collision) and so cannot be expressed here. See "Not covered" below.
 *
 * INPUT SHAPE — the RAW season-feed match object (`unknown`), not `AflApiFixtureRecord`.
 * `AflApiFixtureRecord` (afl-api-fixture-identity.ts:124) wraps an `AflApiMatchProjection` built by
 * `emitAflApiMatch()`, which REQUIRES all six score columns (`projectFamily` over the `match`
 * contract's `required_columns`). A genuine pre-match record carries no score block, so that
 * builder refuses it as a build failure (tests/afl-api-match.test.ts "today's contract refuses that
 * real SCHEDULED record as a build failure"). This contract therefore reads the raw entry itself,
 * reusing the same pure building blocks the match path uses: `translateAflRound`,
 * `convertUtcInstantToVenueLocal`, and `AflApiIdentities` (team/venue/season maps).
 *
 * ROUND. `translateAflRound()` already returns a `CanonicalRound` whose `roundType` IS the
 * `FixtureRoundType` of src/lib/fixtures/spec.ts (afl-api-rounds.ts `CanonicalRound`), so no second
 * mapping is invented. `admin-fixtures.ts renderRound()` (the only other renderer) is `server-only`
 * and cannot be imported; its invariant is re-checked here from the spec constants
 * (`MAX_HOME_AND_AWAY_ROUND`, `FINALS_ROUND_CODES`) so the projection cannot carry a round the
 * fixtures CHECK constraints would refuse.
 *
 * CLUBS. Provider team id -> `hist` string through `identities.teams` (the map `emitAflApiMatch`
 * uses). `hist` -> `clubs.id` (`resolveAflApiMatchClubs`) is a SELECT and is left to the writer.
 *
 * NOT COVERED (integration-only, never claimed here): that the venue's `legacyName` matches a
 * `venues` row; I-1/I-2/I-3 and `foreign_owned_collision` against existing `fixtures` rows;
 * `fixture_key` minting; the `fixtures_source_record_uq` index; the D-229-6 admin guard; the
 * manual queue in `promotion_candidates`.
 */
import { convertUtcInstantToVenueLocal, type AflApiIdentities } from '@/lib/acquisition/afl-api-bundle';
import {
  AflRoundTranslationError,
  translateAflRound,
  type CanonicalRound,
  type ObservedAflRound,
} from '@/lib/acquisition/afl-api-rounds';
import type { SourceFamilyRegistry } from '@/lib/acquisition/source-families';
import {
  FINALS_ROUND_CODES,
  MAX_HOME_AND_AWAY_ROUND,
  isFixtureRoundType,
  type FixtureStatus,
} from '@/lib/fixtures/spec';

// ---------------------------------------------------------------------------
// Status (D-229-1 revised, D-229-3)
// ---------------------------------------------------------------------------

/** The two observed pre-match statuses (D-229-1 revised; issues.md pass 6/7, B1 evidence). */
export const AFL_API_FIXTURE_SCHEDULED_STATUSES = ['SCHEDULED', 'UNCONFIRMED_TEAMS'] as const;

/**
 * The in-play statuses the existing code already recognises and defers rather than rejects
 * (afl-api-bundle.ts `matchDeferral` / `status_not_concluded`; named `POSTGAME` at
 * afl-api-bundle.ts:1146 and `LIVE` at afl-api-bundle.ts:1161 and in tests/afl-api-match.test.ts).
 * Neither is observed shape evidence (runbook :135-139) and neither is ever projected to a fixture.
 */
export const AFL_API_FIXTURE_DEFERRED_STATUSES = ['LIVE', 'POSTGAME'] as const;

/**
 * Observed 2026-11-01 (first authentic 2027 season feed; Rounds 17-24 and every finals match). Owner policy: an
 * UNCONFIRMED scheduled fixture, never a result, cancellation or void.
 */
export const AFL_API_FIXTURE_UNCONFIRMED_STATUSES = ['PLACEHOLDER'] as const;

/** Whether the provider has confirmed the fixture's details. Orthogonal to `fixtures.status`. */
export type AflApiFixtureConfirmation = 'confirmed' | 'unconfirmed';

export type AflApiFixtureStatusClass =
  /** `CONCLUDED`: the match path owns it; the fixture writer takes no action. */
  | { kind: 'concluded' }
  /** `SCHEDULED` / `UNCONFIRMED_TEAMS`: both project to AFLDB fixture status `scheduled`. */
  | { kind: 'scheduled'; fixtureStatus: Extract<FixtureStatus, 'scheduled'>; confirmation: AflApiFixtureConfirmation; observedStatus: string }
  /** In-play status already recognised and deferred: never projected, never mutating. */
  | { kind: 'defer'; observedStatus: string }
  /** Anything else: `status_unsupported`, kept verbatim. Never auto-mapped to cancelled/void. */
  | { kind: 'refuse'; code: 'status_unsupported'; observedStatus: string };

/**
 * Exact, case-sensitive classification. Whitespace or case variants of a known status are NOT
 * known statuses: they refuse verbatim, because the provider's spelling is the evidence.
 */
export function classifyAflApiFixtureStatus(status: string): AflApiFixtureStatusClass {
  if (status === 'CONCLUDED') return { kind: 'concluded' };
  if ((AFL_API_FIXTURE_SCHEDULED_STATUSES as readonly string[]).includes(status)) {
    return { kind: 'scheduled', fixtureStatus: 'scheduled', confirmation: 'confirmed', observedStatus: status };
  }
  if ((AFL_API_FIXTURE_UNCONFIRMED_STATUSES as readonly string[]).includes(status)) {
    return { kind: 'scheduled', fixtureStatus: 'scheduled', confirmation: 'unconfirmed', observedStatus: status };
  }
  if ((AFL_API_FIXTURE_DEFERRED_STATUSES as readonly string[]).includes(status)) {
    return { kind: 'defer', observedStatus: status };
  }
  return { kind: 'refuse', code: 'status_unsupported', observedStatus: status };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export type AflApiFixtureRefusalCode =
  | 'record_invalid'
  | 'provider_id_missing'
  | 'status_unsupported'
  | 'status_deferred'
  | 'status_not_pre_match'
  | 'prematch_score_present'
  | 'season_unresolved'
  | 'round_untranslatable'
  | 'team_unmapped'
  | 'clubs_identical'
  | 'venue_unresolved'
  | 'timezone_invalid'
  | 'start_time_unproven'
  | 'placeholder_in_confirmed_fixture';

export type AflApiFixtureRefusal = { code: AflApiFixtureRefusalCode; detail: string };

export type AflApiFixtureContractContext = {
  registry: SourceFamilyRegistry;
  identities: AflApiIdentities;
};

export type AflApiFixtureProjection = {
  /** D-229-7: the durable provider identity, `(source_id, source_record_id)`. */
  identity: { sourceKey: 'afl_api'; sourceRecordId: string };
  /** D-229-8a: a pre-match row targets `fixtures` only. */
  target: 'fixtures';
  /** D-229-8a: never written to the AFL API `match` observation spine. */
  observationSpine: false;
  fixtureStatus: Extract<FixtureStatus, 'scheduled'>;
  /** `unconfirmed` exactly when the provider status is in `AFL_API_FIXTURE_UNCONFIRMED_STATUSES`. */
  confirmation: AflApiFixtureConfirmation;
  providerStatus: string;
  season: number;
  round: CanonicalRound;
  /** Venue-local calendar date, from `utcStartTime` + the provider's `venue.timezone`; NULL for a placeholder venue and for every UNCONFIRMED record (its instant is provisional, not a proven kick-off). */
  matchDate: string | null;
  /** Venue-local `HH:MM`; D-229-5 condition 4 refuses anything not exact to the minute; NULL for a placeholder venue and for every UNCONFIRMED record. */
  matchTime: string | null;
  venueProviderId: string;
  /** `identities.venues[...].legacyName`; whether a `venues` row has it is a database fact. NULL for a placeholder venue. */
  venueLegacyName: string | null;
  /** True when the venue is a declared placeholder ('To Be Confirmed'): the fixture's venue is unresolved (NULL), never a venue row. */
  venueIsPlaceholder: boolean;
  /** The provider's observed zone; not stored or owned by AFLDB (D-229-5). NULL for a placeholder venue. */
  venueTimezone: string | null;
  homeTeamProviderId: string;
  /** NULL when the side is a declared placeholder team; then `homePlaceholderLabel` carries the provider's label. */
  homeClubHist: string | null;
  homePlaceholderLabel: string | null;
  awayTeamProviderId: string;
  awayClubHist: string | null;
  awayPlaceholderLabel: string | null;
};

export type AflApiFixtureEvaluation =
  | { ok: true; projection: AflApiFixtureProjection }
  | { ok: false; refusals: readonly AflApiFixtureRefusal[] };

/** The exact observed format (D-229-5 condition 1): no lenient parsing. */
const OBSERVED_UTC_START = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{3})\+0000$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** compSeason.providerId -> season year through the declared identities, or null. */
function seasonOf(row: Record<string, unknown>, identities: AflApiIdentities): number | null {
  const comp = asObject(row.compSeason);
  const providerId = comp === null ? null : nonEmptyString(comp.providerId);
  if (providerId === null) return null;
  for (const [year, season] of identities.seasons) {
    if (season.providerId === providerId) return year;
  }
  return null;
}

/**
 * The strictly parsed instant (D-229-5 condition 1), or a reason. The round trip rejects
 * calendar-invalid dates that `Date` would silently roll over (for example 2026-02-30).
 */
function parseObservedUtcStart(value: unknown): { instant: Date } | { reason: string } {
  if (typeof value !== 'string' || value.length === 0) return { reason: 'utcStartTime is missing.' };
  const match = OBSERVED_UTC_START.exec(value);
  if (match === null) {
    return { reason: `utcStartTime '${value}' is not in the observed format YYYY-MM-DDTHH:MM:SS.sss+0000.` };
  }
  const instant = new Date(`${match[1]}T${match[2]}.${match[3]}Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== `${match[1]}T${match[2]}.${match[3]}Z`) {
    return { reason: `utcStartTime '${value}' is not a real calendar instant.` };
  }
  return { instant };
}

/** `venue.timezone` is valid exactly when the tested converter accepts it (D-229-5 condition 3). */
function timezoneIsValid(timeZone: string): boolean {
  return convertUtcInstantToVenueLocal(new Date(0), timeZone) !== null;
}

/**
 * Evaluates one RAW season-feed match object for fixture projection. Collects every refusal it
 * can see (a status refusal returns alone: the rest of the record is not interpreted for a status
 * that is not projectable). Never throws on a malformed record and never guesses a value.
 */
export function evaluateAflApiFixtureProjection(
  record: unknown, ctx: AflApiFixtureContractContext,
): AflApiFixtureEvaluation {
  const row = asObject(record);
  if (row === null) {
    return { ok: false, refusals: [{ code: 'record_invalid', detail: 'The season-feed entry is not an object.' }] };
  }

  const refusals: AflApiFixtureRefusal[] = [];
  const providerId = nonEmptyString(row.providerId);
  if (providerId === null) {
    refusals.push({ code: 'provider_id_missing', detail: 'providerId is missing; there is no durable identity (D-229-7).' });
  }

  // --- status (D-229-1 revised, D-229-3) ---
  const observedStatus = row.status;
  if (typeof observedStatus !== 'string') {
    refusals.push({ code: 'status_unsupported', detail: 'status is missing or not a string.' });
    return { ok: false, refusals };
  }
  const statusClass = classifyAflApiFixtureStatus(observedStatus);
  if (statusClass.kind === 'concluded') {
    refusals.push({ code: 'status_not_pre_match', detail: "CONCLUDED belongs to the match path; the fixture writer takes no action (D-229-1)." });
    return { ok: false, refusals };
  }
  if (statusClass.kind === 'defer') {
    refusals.push({ code: 'status_deferred', detail: `Status '${observedStatus}' is deferred and never projected to a fixture.` });
    return { ok: false, refusals };
  }
  if (statusClass.kind === 'refuse') {
    refusals.push({
      code: 'status_unsupported',
      detail: `Status '${observedStatus}' is unsupported until observed (D-229-1, D-229-3); never mapped to cancelled or void.`,
    });
    return { ok: false, refusals };
  }

  // --- pre-match shape (D-229-2 revised): the score blocks are entirely absent ---
  const home = asObject(row.home);
  const away = asObject(row.away);
  if ((home !== null && home.score !== undefined) || (away !== null && away.score !== undefined)) {
    refusals.push({
      code: 'prematch_score_present',
      detail: `A ${observedStatus} record carries a score block; that shape is unobserved (D-229-2).`,
    });
  }

  // --- season and round ---
  const season = seasonOf(row, ctx.identities);
  if (season === null) {
    refusals.push({ code: 'season_unresolved', detail: 'compSeason.providerId is not declared in afl-api-identities.json seasons.' });
  }
  let round: CanonicalRound | null = null;
  if (season !== null) {
    const roundRaw = asObject(row.round);
    const metadata = asObject(row.metadata);
    const label = metadata !== null && typeof metadata.finals_match_label === 'string' ? metadata.finals_match_label : null;
    if (
      roundRaw === null
      || typeof roundRaw.roundNumber !== 'number'
      || nonEmptyString(roundRaw.abbreviation) === null
      || nonEmptyString(roundRaw.name) === null
    ) {
      refusals.push({ code: 'round_untranslatable', detail: 'round.roundNumber, round.abbreviation or round.name is missing.' });
    } else {
      const observed: ObservedAflRound = {
        apiRoundNumber: roundRaw.roundNumber,
        apiAbbreviation: roundRaw.abbreviation as string,
        apiName: roundRaw.name as string,
        finalsMatchLabel: label,
      };
      try {
        const translated = translateAflRound(ctx.registry, season, observed);
        const invariantError = fixtureRoundInvariantError(translated);
        if (invariantError === null) round = translated;
        else refusals.push({ code: 'round_untranslatable', detail: invariantError });
      } catch (error) {
        if (!(error instanceof AflRoundTranslationError)) throw error;
        refusals.push({ code: 'round_untranslatable', detail: `${error.code}: ${error.message}` });
      }
    }
  }

  // --- clubs ---
  const unconfirmed = statusClass.confirmation === 'unconfirmed';
  const homeTeamId = nonEmptyString(asObject(home?.team)?.providerId);
  const awayTeamId = nonEmptyString(asObject(away?.team)?.providerId);
  type Side = { hist: string; label: null } | { hist: null; label: string } | undefined;
  const sideOf = (teamId: string | null, name: string): Side => {
    const club = teamId === null ? undefined : ctx.identities.teams.get(teamId);
    if (club !== undefined) return { hist: club.hist, label: null };
    const placeholder = teamId === null ? undefined : ctx.identities.placeholderTeams?.get(teamId);
    if (placeholder !== undefined) {
      const observedName = nonEmptyString(asObject(asObject(name === 'Home' ? home : away)?.team)?.name);
      if (unconfirmed && observedName !== placeholder.rawName) {
        refusals.push({
          code: 'team_unmapped',
          detail: `${name} placeholder team '${teamId}' is declared as '${placeholder.rawName}' but the record names it '${observedName ?? ''}'; a renamed label is never stored under its old name.`,
        });
        return undefined;
      }
      if (!unconfirmed) {
        refusals.push({
          code: 'placeholder_in_confirmed_fixture',
          detail: `${name} team '${teamId}' ('${placeholder.rawName}') is a declared placeholder but the record's status '${observedStatus}' is a confirmed fixture status.`,
        });
        return undefined;
      }
      return { hist: null, label: placeholder.rawName };
    }
    refusals.push({ code: 'team_unmapped', detail: `${name} team provider id '${teamId ?? ''}' is not in afl-api-identities.json teams or placeholder_teams.` });
    return undefined;
  };
  const homeSide = sideOf(homeTeamId, 'Home');
  const awaySide = sideOf(awayTeamId, 'Away');
  if (homeTeamId !== null && homeTeamId === awayTeamId && homeSide?.hist === null && awaySide?.hist === null) {
    refusals.push({ code: 'clubs_identical', detail: `Home and away are the same provider team '${homeTeamId}'.` });
  }
  if (homeSide?.hist != null && awaySide?.hist != null && homeSide.hist === awaySide.hist) {
    refusals.push({ code: 'clubs_identical', detail: `Home and away both resolve to club '${homeSide.hist}'.` });
  }

  // --- venue (D-229-5 condition 2) ---
  const venue = asObject(row.venue);
  const venueProviderId = nonEmptyString(venue?.providerId);
  const venueIdentity = venueProviderId === null ? undefined : ctx.identities.venues.get(venueProviderId);
  const placeholderVenue = venueProviderId === null ? undefined : ctx.identities.placeholderVenues?.get(venueProviderId);
  let venueIsPlaceholder = false;
  if (venueIdentity === undefined) {
    if (placeholderVenue !== undefined && unconfirmed) {
      venueIsPlaceholder = true;
    } else if (placeholderVenue !== undefined) {
      refusals.push({
        code: 'placeholder_in_confirmed_fixture',
        detail: `Venue '${venueProviderId}' ('${placeholderVenue.rawName}') is a declared placeholder but the record's status '${observedStatus}' is a confirmed fixture status.`,
      });
    } else {
      refusals.push({
        code: 'venue_unresolved',
        detail: `Venue provider id '${venueProviderId ?? ''}' is not in afl-api-identities.json venues or placeholder_venues.`,
      });
    }
  }

  // --- timezone (D-229-5 condition 3); a placeholder venue has no provable zone and none is required ---
  const timeZone = nonEmptyString(venue?.timezone);
  const timeZoneValid = timeZone !== null && timezoneIsValid(timeZone);
  if (!venueIsPlaceholder && !timeZoneValid) {
    refusals.push({ code: 'timezone_invalid', detail: `venue.timezone '${timeZone ?? ''}' is missing or not a valid IANA zone.` });
  }

  // --- start time (D-229-5 conditions 1 and 4); a genuine TBC representation is unobserved (B2) ---
  let local: { matchDate: string | null; matchTime: string | null } | null = null;
  const start = parseObservedUtcStart(row.utcStartTime);
  if ('reason' in start) {
    refusals.push({ code: 'start_time_unproven', detail: start.reason });
  } else if (venueIsPlaceholder || unconfirmed) {
    // The instant is well formed but is not a proven kick-off: with no venue there is no zone to read it in, and on an
    // UNCONFIRMED record the provider pins the matches of a round to a shared provisional instant (2027 feed: round 17 has
    // 3 distinct starts across 9 matches against 9 across 9 for the confirmed round 16). Unresolved (NULL), retained in the snapshot.
    local = { matchDate: null, matchTime: null };
  } else if (timeZoneValid) {
    const converted = convertUtcInstantToVenueLocal(start.instant, timeZone as string);
    if (converted === null) {
      refusals.push({ code: 'timezone_invalid', detail: `venue.timezone '${timeZone}' was rejected by the converter.` });
    } else if (!converted.matchTime.endsWith(':00')) {
      refusals.push({
        code: 'start_time_unproven',
        detail: `utcStartTime '${row.utcStartTime as string}' is not exact to HH:MM in '${timeZone}' (D-229-5 condition 4); never truncated.`,
      });
    } else {
      local = { matchDate: converted.matchDate, matchTime: converted.matchTime.slice(0, 5) };
    }
  }

  if (
    refusals.length > 0 || providerId === null || season === null || round === null
    || homeTeamId === null || awayTeamId === null || homeSide === undefined || awaySide === undefined
    || venueProviderId === null || (venueIdentity === undefined && !venueIsPlaceholder) || local === null
    || (!venueIsPlaceholder && timeZone === null)
  ) {
    return { ok: false, refusals };
  }
  return {
    ok: true,
    projection: {
      identity: { sourceKey: 'afl_api', sourceRecordId: providerId },
      target: 'fixtures',
      observationSpine: false,
      fixtureStatus: statusClass.fixtureStatus,
      confirmation: statusClass.confirmation,
      providerStatus: statusClass.observedStatus,
      season,
      round,
      matchDate: local.matchDate,
      matchTime: local.matchTime,
      venueProviderId,
      venueLegacyName: venueIsPlaceholder ? null : venueIdentity!.legacyName,
      venueIsPlaceholder,
      venueTimezone: venueIsPlaceholder ? null : timeZone,
      homeTeamProviderId: homeTeamId,
      homeClubHist: homeSide.hist,
      homePlaceholderLabel: homeSide.label,
      awayTeamProviderId: awayTeamId,
      awayClubHist: awaySide.hist,
      awayPlaceholderLabel: awaySide.label,
    },
  };
}

/**
 * The invariant `admin-fixtures.ts renderRound()` enforces (server-only, so re-checked here from the
 * spec constants): home-and-away needs an integer round 1..MAX_HOME_AND_AWAY_ROUND whose code is
 * its decimal string; a finals round has no number and carries its own `FINALS_ROUND_CODES` code.
 */
function fixtureRoundInvariantError(round: CanonicalRound): string | null {
  if (!isFixtureRoundType(round.roundType)) return `roundType '${round.roundType}' is not a fixture round type.`;
  if (round.roundType === 'home_and_away') {
    const n = round.roundNumber;
    if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_HOME_AND_AWAY_ROUND) {
      return `home-and-away round ${String(n)} is outside 1..${MAX_HOME_AND_AWAY_ROUND}.`;
    }
    return round.roundCode === String(n) ? null : `round code '${round.roundCode}' is not '${n}'.`;
  }
  if (round.roundNumber !== null) return 'a finals round must carry no round number.';
  return round.roundCode === FINALS_ROUND_CODES[round.roundType]
    ? null
    : `finals round code '${round.roundCode}' is not '${FINALS_ROUND_CODES[round.roundType]}'.`;
}

// ---------------------------------------------------------------------------
// Collisions (the fixture-boundary refusal; the resolvers are deliberately not changed)
// ---------------------------------------------------------------------------

export type AflApiFixtureCollisionCode =
  | 'duplicate_provider_id'
  | 'fixture_identity_collision'
  | 'orientation_conflict';

export type AflApiFixtureCollision = {
  code: AflApiFixtureCollisionCode;
  detail: string;
  providerIds: readonly string[];
};

type CollisionKey = { providerId: string; season: number; homeHist: string; awayHist: string; matchDate: string };

function collisionKeyOf(record: unknown, ctx: AflApiFixtureContractContext): CollisionKey | null {
  const row = asObject(record);
  if (row === null) return null;
  const providerId = nonEmptyString(row.providerId);
  const season = seasonOf(row, ctx.identities);
  const homeId = nonEmptyString(asObject(asObject(row.home)?.team)?.providerId);
  const awayId = nonEmptyString(asObject(asObject(row.away)?.team)?.providerId);
  const homeIdentity = homeId === null ? undefined : ctx.identities.teams.get(homeId);
  const awayIdentity = awayId === null ? undefined : ctx.identities.teams.get(awayId);
  const timeZone = nonEmptyString(asObject(row.venue)?.timezone);
  const start = parseObservedUtcStart(row.utcStartTime);
  if (
    providerId === null || season === null || homeIdentity === undefined || awayIdentity === undefined
    || timeZone === null || 'reason' in start
  ) return null;
  const local = convertUtcInstantToVenueLocal(start.instant, timeZone);
  if (local === null) return null;
  return { providerId, season, homeHist: homeIdentity.hist, awayHist: awayIdentity.hist, matchDate: local.matchDate };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/**
 * Detects the identity collisions that must refuse at the fixture boundary, over a whole feed:
 *  (a) `duplicate_provider_id`: one provider id listed more than once.
 *  (b) `fixture_identity_collision`: two DIFFERENT provider ids with the same (season, home club,
 *      away club, venue-local match date). The match resolvers take the first hit without comparing
 *      source_record_id (afl-api-match-resolver.ts:181-190; afl-api-fixture-identity.ts:340 resolves
 *      both ids to one row); this contract refuses instead of letting two ids share one fixture.
 *  (c) `orientation_conflict`: the same two clubs on the same date with home and away swapped. Never
 *      auto-swapped. The existing MATCH path deliberately treats swapped orientation as a DIFFERENT
 *      fixture (tests/integration/settle-afl-api.test.ts "club ORIENTATION is exact"); this V2
 *      fixture contract is stricter on purpose: a refusal for human review, never a write.
 *
 * A record whose club, season or date cannot be proven (unmapped team, invalid zone, unparseable
 * start) takes part in (a) only: an unproven date cannot collide, and `evaluateAflApiFixtureProjection`
 * refuses it separately. Output is deterministic (sorted by code, then provider ids).
 */
export function detectAflApiFixtureCollisions(
  records: readonly unknown[], ctx: AflApiFixtureContractContext,
): readonly AflApiFixtureCollision[] {
  const collisions: AflApiFixtureCollision[] = [];

  const providerIds = records
    .map((record) => nonEmptyString(asObject(record)?.providerId))
    .filter((id): id is string => id !== null);
  for (const [id, group] of groupBy(providerIds, (value) => value)) {
    if (group.length > 1) {
      collisions.push({
        code: 'duplicate_provider_id',
        detail: `Provider id '${id}' is listed ${group.length} times.`,
        providerIds: [id],
      });
    }
  }

  // (b) and (c) work on distinct provider ids; a repeated id is already reported by (a).
  const seen = new Set<string>();
  const keys: CollisionKey[] = [];
  for (const record of records) {
    const key = collisionKeyOf(record, ctx);
    if (key === null || seen.has(key.providerId)) continue;
    seen.add(key.providerId);
    keys.push(key);
  }

  for (const [, group] of groupBy(keys, (k) => `${k.season}|${k.homeHist}|${k.awayHist}|${k.matchDate}`)) {
    if (group.length > 1) {
      const ids = group.map((k) => k.providerId).sort();
      collisions.push({
        code: 'fixture_identity_collision',
        detail: `Provider ids ${ids.join(', ')} share season ${group[0].season}, ${group[0].homeHist} v ${group[0].awayHist}, ${group[0].matchDate}.`,
        providerIds: ids,
      });
    }
  }

  const unordered = (k: CollisionKey): string =>
    `${k.season}|${[k.homeHist, k.awayHist].sort().join('|')}|${k.matchDate}`;
  for (const [, group] of groupBy(keys, unordered)) {
    const orientations = new Set(group.map((k) => `${k.homeHist}|${k.awayHist}`));
    if (orientations.size > 1) {
      const ids = group.map((k) => k.providerId).sort();
      collisions.push({
        code: 'orientation_conflict',
        detail: `Provider ids ${ids.join(', ')} name the same clubs on ${group[0].matchDate} with home and away swapped; never auto-swapped.`,
        providerIds: ids,
      });
    }
  }

  return collisions.sort((a, b) =>
    a.code === b.code ? a.providerIds.join(',').localeCompare(b.providerIds.join(',')) : a.code.localeCompare(b.code));
}
