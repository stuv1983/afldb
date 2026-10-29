/**
 * AFLDB V2 Stage 4 — the Coleman Medal derivation (docs/v2/plan.md §3 D6; ADR 0006).
 *
 * The Coleman Medal is DERIVED from promoted player goal facts, never ingested. The agreed scope is
 * the ISSUE-111 contract (data/reference/coleman-derivation.json, method_version 1), which this
 * module re-implements as a pure function so it can be tested without a database:
 *
 *  - home-and-away matches only (matches.round_type = 'home_and_away', i.e. NOT matches.is_final;
 *    migration 003 CHECK-constrains is_final = (round_type <> 'home_and_away'));
 *  - one total per player: the sum of goals over that player's home-and-away rows;
 *  - EVERY player tied on the maximum wins (no tiebreak), provided the maximum is at least
 *    `minimum_goals`; a season whose maximum is below that has no winner, which is a reported
 *    outcome, not an error;
 *  - the winner's club is the single distinct club over its home-and-away rows, or null when it
 *    represented more than one;
 *  - the durable key is `coleman:<season>:<afltables profile path>`; identity is exactly one
 *    `afltables_profile_url` identity with an accepted status, and the derivation FAILS CLOSED
 *    rather than fall back to a player id or a name.
 *
 * What V2 adds to the ISSUE-111 loader (see ADR 0006, "Divergences"): a settled-season attestation,
 * an incomplete-rounds check, an input checksum and a version/timestamp record.
 *
 * Pure: no database, no clock, no IO. `derivedAt` is supplied by the caller and is never read from
 * a clock here. The result is plain JSON-serialisable data, so a later transactional publisher can
 * persist it verbatim. Deriving the same inputs in any order yields a deep-equal result and an
 * identical `inputChecksum`.
 *
 * NULL goals are "not recorded", never zero: one NULL in a home-and-away row refuses the WHOLE
 * season (SUM() would silently skip it and understate a total). A recorded 0 is a real zero.
 */
import { createHash } from 'node:crypto';

import { isFixtureRoundType, isSealedSeason, sealedSeasonsFrom, type SeasonRegistry } from '@afldb/domain';

/** The version of THIS derivation code. Distinct from the contract's `method_version`; both are recorded. */
export const COLEMAN_DERIVATION_VERSION = 'v2.coleman.1';

/** The input-checksum canonical form's own identity (changing the canonical form requires a new value). */
export const COLEMAN_INPUT_FORMAT = 'afldb.v2.coleman-input';
export const COLEMAN_INPUT_FORMAT_VERSION = 1;

const HOME_AND_AWAY = 'home_and_away';
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SAMPLE_LIMIT = 20;

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

/** The keys the Python loader (`_COLEMAN_REQUIRED_CONTRACT_KEYS`) requires; the parser requires the same. */
export const COLEMAN_REQUIRED_CONTRACT_KEYS = [
  'award_slug', 'method_version', 'first_season', 'source_key',
  'minimum_goals', 'identity_match_method', 'identity_statuses',
  'key_separator', 'completed_seasons_only', 'legacy_transition',
] as const;

export interface ColemanContract {
  readonly awardSlug: 'coleman';
  /** The contract's `method_version` (an integer that changes when the declared method changes). */
  readonly methodVersion: number;
  /** First season the derivation covers (a preserved legacy award boundary, NOT the first award). */
  readonly firstSeason: number;
  /** The source a derived row is attributed to (the canonical source of the facts). */
  readonly sourceKey: string;
  readonly minimumGoals: number;
  readonly identityMatchMethod: string;
  readonly identityStatuses: readonly string[];
  readonly keySeparator: string;
}

export class ColemanContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColemanContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate the parsed JSON of data/reference/coleman-derivation.json and return the typed contract.
 * Refuses drift: every required key must be present and carry the declared shape. Nothing is
 * hard-coded here that the contract declares (the span, source, minimum, identity rule and key
 * separator all come from the file).
 */
export function parseColemanContract(json: unknown): ColemanContract {
  if (!isRecord(json)) throw new ColemanContractError('the Coleman derivation contract must be a JSON object');
  const missing = COLEMAN_REQUIRED_CONTRACT_KEYS.filter((key) => !(key in json));
  if (missing.length > 0) {
    throw new ColemanContractError(
      `the Coleman derivation contract is missing ${missing.join(', ')}; nothing has been read`,
    );
  }
  if (json.award_slug !== 'coleman') {
    throw new ColemanContractError(`award_slug is ${JSON.stringify(json.award_slug)}, not "coleman"`);
  }
  if (!Number.isSafeInteger(json.method_version) || (json.method_version as number) < 1) {
    throw new ColemanContractError('method_version must be a positive integer');
  }
  if (!Number.isSafeInteger(json.first_season)) {
    throw new ColemanContractError('first_season must be an integer');
  }
  if (json.completed_seasons_only !== true) {
    throw new ColemanContractError(
      'completed_seasons_only must be true — an undecided season cannot have a leading goalkicker of record',
    );
  }
  if (!isNonEmptyString(json.source_key)) throw new ColemanContractError('source_key must be a non-empty string');
  if (!Number.isSafeInteger(json.minimum_goals) || (json.minimum_goals as number) < 1) {
    throw new ColemanContractError(
      'minimum_goals must be an integer of at least 1 (a leading goalkicker must have kicked a goal)',
    );
  }
  if (!isNonEmptyString(json.identity_match_method)) {
    throw new ColemanContractError('identity_match_method must be a non-empty string');
  }
  const statuses = json.identity_statuses;
  if (!Array.isArray(statuses) || statuses.length === 0 || !statuses.every(isNonEmptyString)) {
    throw new ColemanContractError('identity_statuses must be a non-empty list of non-empty strings');
  }
  if (!isNonEmptyString(json.key_separator)) throw new ColemanContractError('key_separator must be a non-empty string');
  if (!isRecord(json.legacy_transition)) throw new ColemanContractError('legacy_transition must be an object');
  return {
    awardSlug: 'coleman',
    methodVersion: json.method_version as number,
    firstSeason: json.first_season as number,
    sourceKey: json.source_key,
    minimumGoals: json.minimum_goals as number,
    identityMatchMethod: json.identity_match_method,
    identityStatuses: [...(statuses as string[])],
    keySeparator: json.key_separator,
  };
}

/* ------------------------------------------------------------------ *
 * Input and output types
 * ------------------------------------------------------------------ */

/**
 * An identifier as the caller holds it. postgres.js returns int8 as a STRING, so numbers and
 * strings are both accepted and normalised to strings (`10` and `"10"` are the same id). Every
 * id in a result is a string.
 */
export type ColemanId = number | string;

export interface ColemanSeasonState {
  /** The subset of data/reference/seasons.json the seal reads; a season is COMPLETE iff it is sealed there. */
  readonly registry: SeasonRegistry;
  /**
   * The caller's attestation that the season is SETTLED: every promotion and settle for the season
   * has concluded and nothing is pending (no in-flight import batch, no open promotion candidate,
   * no unresolved record that could still change a goal fact). A registry status alone cannot
   * prove this, which is why it is an explicit input. `false` refuses the whole season.
   */
  readonly settled: boolean;
}

export interface ColemanMatchRow {
  readonly matchId: ColemanId;
  readonly season: number;
  /** matches.round_type. Only 'home_and_away' is in scope; every other value is a finals round. */
  readonly roundType: string;
  readonly homeClubId: ColemanId;
  readonly awayClubId: ColemanId;
}

export interface ColemanGoalFact {
  readonly matchId: ColemanId;
  readonly playerId: ColemanId;
  readonly clubId: ColemanId;
  /** player_match_stats.goals. null = NOT RECORDED (never zero). */
  readonly goals: number | null;
}

/** One external_identities row for a player. Rows of other methods or statuses are ignored. */
export interface ColemanIdentityRow {
  readonly playerId: ColemanId;
  readonly matchMethod: string;
  /** The normalised AFL Tables profile path (external_identities.external_id). */
  readonly externalId: string;
  readonly status: string;
}

export interface ColemanDerivationInput {
  readonly contract: ColemanContract;
  readonly season: number;
  readonly seasonState: ColemanSeasonState;
  /** Every match of the season the caller holds (home-and-away AND finals). */
  readonly matches: readonly ColemanMatchRow[];
  readonly playerMatchGoals: readonly ColemanGoalFact[];
  readonly identities: readonly ColemanIdentityRow[];
  /** Caller-supplied ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z). Never a clock read. */
  readonly derivedAt: string;
  /** Pass COLEMAN_DERIVATION_VERSION. */
  readonly derivationVersion: string;
}

export const COLEMAN_REFUSAL_CODES = [
  'invalid_input',
  'season_before_contract',
  'season_not_complete',
  'season_not_settled',
  'incomplete_rounds',
  'goals_not_recorded',
  'identity_missing',
  'identity_ambiguous',
  'unsafe_key',
] as const;
export type ColemanRefusalCode = (typeof COLEMAN_REFUSAL_CODES)[number];

export interface ColemanRefusal {
  readonly code: ColemanRefusalCode;
  readonly message: string;
  readonly season: number;
  readonly methodVersion: number;
  readonly derivationVersion: string;
  /** Machine-readable evidence; lists are sorted and capped at 20 items beside their full `count`. */
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ColemanLeaderboardEntry {
  readonly playerId: string;
  /** The single accepted AFL Tables profile path, or null when the player has none or several. */
  readonly profilePath: string | null;
  readonly goals: number;
  /** Distinct clubs over the player's home-and-away rows, sorted. */
  readonly clubIds: readonly string[];
}

export interface ColemanWinner {
  readonly playerId: string;
  readonly profilePath: string;
  readonly goals: number;
  /** The single distinct club, or null when the winner represented more than one. */
  readonly clubId: string | null;
  readonly clubCount: number;
  /** `coleman:<season>:<profilePath>` — the durable source_record_id. */
  readonly key: string;
}

export interface ColemanDerivationInputs {
  readonly format: typeof COLEMAN_INPUT_FORMAT;
  readonly formatVersion: typeof COLEMAN_INPUT_FORMAT_VERSION;
  readonly season: number;
  readonly contract: {
    readonly awardSlug: string;
    readonly methodVersion: number;
    readonly firstSeason: number;
    readonly sourceKey: string;
    readonly minimumGoals: number;
    readonly identityMatchMethod: string;
    readonly identityStatuses: readonly string[];
    readonly keySeparator: string;
  };
  readonly seasonState: { readonly status: 'complete'; readonly settled: true };
  readonly matches: readonly {
    readonly matchId: string;
    readonly roundType: string;
    readonly homeClubId: string;
    readonly awayClubId: string;
  }[];
  readonly goals: readonly {
    readonly matchId: string;
    readonly playerId: string;
    readonly clubId: string;
    /** null = not recorded; only finals rows (excluded from every total) may carry it in a derivable season. */
    readonly goals: number | null;
  }[];
  /** The accepted profile paths of every home-and-away player that has any, sorted. */
  readonly identities: readonly { readonly playerId: string; readonly paths: readonly string[] }[];
}

export interface ColemanDerivation {
  readonly season: number;
  readonly methodVersion: number;
  readonly derivationVersion: string;
  readonly derivedAt: string;
  /** sha256 hex of the canonical serialisation of `inputs`; independent of input row order. */
  readonly inputChecksum: string;
  readonly minimumGoals: number;
  /** The highest home-and-away total in the season (null only if the leaderboard is empty). */
  readonly maxGoals: number | null;
  /** More than one player is tied on the maximum and every one of them wins. */
  readonly tie: boolean;
  /** Empty when the maximum is below `minimumGoals` — a reported outcome, not an error. */
  readonly winners: readonly ColemanWinner[];
  /** Every home-and-away player with a total: goals desc, then profile path (null last), then player id. */
  readonly leaderboard: readonly ColemanLeaderboardEntry[];
  readonly counts: {
    readonly homeAndAwayMatches: number;
    readonly finalsMatches: number;
    readonly homeAndAwayGoalRows: number;
    /** Fact rows belonging to finals matches that were excluded from every total. */
    readonly finalsRowsExcluded: number;
    readonly players: number;
  };
  /** The exact canonical inputs that `inputChecksum` hashes: the derivation is reproducible from this. */
  readonly inputs: ColemanDerivationInputs;
}

export type ColemanDerivationOutcome =
  | { readonly ok: false; readonly refusal: ColemanRefusal }
  | { readonly ok: true; readonly result: ColemanDerivation };

/* ------------------------------------------------------------------ *
 * Canonical serialisation
 * ------------------------------------------------------------------ */

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Recursively sort object keys (arrays keep their order; undefined values are dropped). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = sortKeysDeep(source[key]);
    }
    return out;
  }
  return value;
}

/** Compact sorted-key JSON: byte-identical for equal values. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** Sorted-key JSON, two-space indent, one trailing newline — a stable form for persistence. */
export function serialiseColemanDerivation(result: ColemanDerivation): string {
  return `${JSON.stringify(sortKeysDeep(result), null, 2)}\n`;
}

/** The durable `source_record_id` for a winner: `<slug><sep><season><sep><profile path>`. */
export function colemanKey(contract: ColemanContract, season: number, profilePath: string): string {
  const sep = contract.keySeparator;
  return `${contract.awardSlug}${sep}${season}${sep}${profilePath}`;
}

/* ------------------------------------------------------------------ *
 * The derivation
 * ------------------------------------------------------------------ */

function isId(value: unknown): value is ColemanId {
  return (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isSafeInteger(value));
}

function sample<T>(list: readonly T[]): T[] {
  return list.slice(0, SAMPLE_LIMIT);
}

interface NormMatch {
  matchId: string;
  season: number;
  roundType: string;
  homeClubId: string;
  awayClubId: string;
}

interface NormFact {
  matchId: string;
  playerId: string;
  clubId: string;
  goals: number | null;
}

/**
 * Derive the Coleman Medal for one season. Whole-season refusal, never a partial answer: the first
 * failing gate (in the order below) refuses the season.
 *
 * Order: invalid_input (header) -> season_before_contract -> season_not_complete ->
 * season_not_settled -> invalid_input (rows) -> incomplete_rounds -> goals_not_recorded ->
 * identity_missing -> identity_ambiguous -> unsafe_key.
 */
export function deriveColeman(input: ColemanDerivationInput): ColemanDerivationOutcome {
  const { contract, season, derivedAt, derivationVersion } = input;
  const refuse = (
    code: ColemanRefusalCode,
    message: string,
    details: Record<string, unknown> = {},
  ): ColemanDerivationOutcome => ({
    ok: false,
    refusal: { code, message, season, methodVersion: contract.methodVersion, derivationVersion, details },
  });

  // 1. Header.
  const headerProblems: string[] = [];
  if (!Number.isSafeInteger(season)) headerProblems.push('season must be an integer');
  if (!(typeof derivedAt === 'string' && ISO_INSTANT.test(derivedAt) && !Number.isNaN(Date.parse(derivedAt)))) {
    headerProblems.push('derivedAt must be an ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z)');
  }
  if (!isNonEmptyString(derivationVersion)) headerProblems.push('derivationVersion must be a non-empty string');
  if (typeof input.seasonState?.settled !== 'boolean') headerProblems.push('seasonState.settled must be a boolean');
  if (headerProblems.length > 0) {
    return refuse('invalid_input', `Refused: invalid derivation input (${headerProblems.join('; ')}).`, {
      problems: headerProblems,
    });
  }

  // 2. The contract's first season.
  if (season < contract.firstSeason) {
    return refuse(
      'season_before_contract',
      `Refused: season ${season} is before the Coleman derivation contract's first season ${contract.firstSeason}. `
        + 'Earlier history is not backfilled by this derivation.',
      { firstSeason: contract.firstSeason },
    );
  }

  // 3. Completeness, from the season registry (the same seal the rest of V2 uses).
  let complete = false;
  let registryProblem: string | null = null;
  try {
    complete = isSealedSeason(sealedSeasonsFrom(input.seasonState.registry), season);
  } catch (error) {
    registryProblem = error instanceof Error ? error.message : String(error);
  }
  if (!complete) {
    return refuse(
      'season_not_complete',
      `Refused: season ${season} is not complete (in progress, outside the season registry, or the registry is unusable); `
        + 'an undecided season has no leading goalkicker of record.',
      { registryProblem },
    );
  }

  // 4. Settled, by the caller's explicit attestation.
  if (input.seasonState.settled !== true) {
    return refuse(
      'season_not_settled',
      `Refused: season ${season} is not attested as settled (a promotion or settle may still be pending), so its `
        + 'goal facts may still change.',
    );
  }

  // 5. Row validation.
  const rowProblems: string[] = [];
  const matchById = new Map<string, NormMatch>();
  for (const [index, match] of input.matches.entries()) {
    if (!isId(match?.matchId) || !isId(match.homeClubId) || !isId(match.awayClubId)
      || !Number.isSafeInteger(match.season) || typeof match.roundType !== 'string') {
      rowProblems.push(`matches[${index}] has an invalid id, season or round type`);
      continue;
    }
    if (!isFixtureRoundType(match.roundType)) {
      rowProblems.push(`match ${String(match.matchId)} has an unknown round_type '${match.roundType}'`);
      continue;
    }
    const matchId = String(match.matchId);
    if (matchById.has(matchId)) {
      rowProblems.push(`match ${matchId} is supplied more than once`);
      continue;
    }
    const homeClubId = String(match.homeClubId);
    const awayClubId = String(match.awayClubId);
    if (homeClubId === awayClubId) rowProblems.push(`match ${matchId} has the same home and away club`);
    matchById.set(matchId, { matchId, season: match.season, roundType: match.roundType, homeClubId, awayClubId });
  }

  const facts: NormFact[] = [];
  const seenFactKeys = new Set<string>();
  for (const [index, fact] of input.playerMatchGoals.entries()) {
    if (!isId(fact?.matchId) || !isId(fact.playerId) || !isId(fact.clubId)) {
      rowProblems.push(`playerMatchGoals[${index}] has an invalid match, player or club id`);
      continue;
    }
    if (fact.goals !== null && !(typeof fact.goals === 'number' && Number.isSafeInteger(fact.goals) && fact.goals >= 0)) {
      rowProblems.push(`playerMatchGoals[${index}] goals must be null or a non-negative integer`);
      continue;
    }
    const norm: NormFact = {
      matchId: String(fact.matchId),
      playerId: String(fact.playerId),
      clubId: String(fact.clubId),
      goals: fact.goals,
    };
    const factKey = `${norm.matchId}\u0000${norm.playerId}`;
    if (seenFactKeys.has(factKey)) {
      rowProblems.push(`player ${norm.playerId} has more than one goal row in match ${norm.matchId}`);
      continue;
    }
    seenFactKeys.add(factKey);
    const match = matchById.get(norm.matchId);
    if (match && match.roundType === HOME_AND_AWAY && norm.clubId !== match.homeClubId && norm.clubId !== match.awayClubId) {
      rowProblems.push(`player ${norm.playerId} club ${norm.clubId} did not play in match ${norm.matchId}`);
      continue;
    }
    facts.push(norm);
  }

  const identityRows: { playerId: string; path: string }[] = [];
  for (const [index, row] of input.identities.entries()) {
    if (!isId(row?.playerId) || typeof row.matchMethod !== 'string'
      || typeof row.externalId !== 'string' || typeof row.status !== 'string') {
      rowProblems.push(`identities[${index}] has an invalid player id, method, external id or status`);
      continue;
    }
    if (
      row.matchMethod === contract.identityMatchMethod
      && contract.identityStatuses.includes(row.status)
      && row.externalId.length > 0
    ) {
      identityRows.push({ playerId: String(row.playerId), path: row.externalId });
    }
  }
  if (rowProblems.length > 0) {
    return refuse('invalid_input', `Refused: invalid derivation input rows (${rowProblems.length} problem(s)).`, {
      count: rowProblems.length,
      problems: sample(rowProblems),
    });
  }

  // 6. Incomplete rounds.
  const allMatches = [...matchById.values()].sort((a, b) => codeUnitCompare(a.matchId, b.matchId));
  const otherSeasonMatches = allMatches.filter((m) => m.season !== season).map((m) => m.matchId);
  const haMatches = allMatches.filter((m) => m.season === season && m.roundType === HOME_AND_AWAY);
  const finalsMatches = allMatches.filter((m) => m.season === season && m.roundType !== HOME_AND_AWAY);
  const unknownMatchFacts = facts
    .filter((f) => !matchById.has(f.matchId))
    .map((f) => ({ matchId: f.matchId, playerId: f.playerId }))
    .sort((a, b) => codeUnitCompare(a.matchId, b.matchId) || codeUnitCompare(a.playerId, b.playerId));
  const clubsWithRows = new Map<string, Set<string>>();
  for (const fact of facts) {
    const set = clubsWithRows.get(fact.matchId) ?? new Set<string>();
    set.add(fact.clubId);
    clubsWithRows.set(fact.matchId, set);
  }
  const matchesMissingClubRows: { matchId: string; missingClubIds: string[] }[] = [];
  for (const match of haMatches) {
    const present = clubsWithRows.get(match.matchId) ?? new Set<string>();
    const missingClubIds = [match.homeClubId, match.awayClubId].filter((club) => !present.has(club)).sort(codeUnitCompare);
    if (missingClubIds.length > 0) matchesMissingClubRows.push({ matchId: match.matchId, missingClubIds });
  }
  const noHomeAndAwayMatches = haMatches.length === 0;
  if (
    otherSeasonMatches.length > 0 || unknownMatchFacts.length > 0
    || matchesMissingClubRows.length > 0 || noHomeAndAwayMatches
  ) {
    return refuse(
      'incomplete_rounds',
      `Refused: season ${season}'s home-and-away data is incomplete or inconsistent `
        + '(no home-and-away matches, a match from another season, a fact for an unknown match, or a '
        + 'home-and-away match with no goal rows for a club).',
      {
        noHomeAndAwayMatches,
        matchesFromOtherSeasons: { count: otherSeasonMatches.length, sample: sample(otherSeasonMatches) },
        factsForUnknownMatches: { count: unknownMatchFacts.length, sample: sample(unknownMatchFacts) },
        matchesMissingClubRows: { count: matchesMissingClubRows.length, sample: sample(matchesMissingClubRows) },
      },
    );
  }

  // 7. NULL goals: not recorded, never zero.
  const haIds = new Set(haMatches.map((m) => m.matchId));
  const haFacts = facts.filter((f) => haIds.has(f.matchId));
  const finalsIds = new Set(finalsMatches.map((m) => m.matchId));
  const finalsRowsExcluded = facts.filter((f) => finalsIds.has(f.matchId)).length;
  const unrecorded = haFacts
    .filter((f) => f.goals === null)
    .map((f) => ({ matchId: f.matchId, playerId: f.playerId }))
    .sort((a, b) => codeUnitCompare(a.matchId, b.matchId) || codeUnitCompare(a.playerId, b.playerId));
  if (unrecorded.length > 0) {
    return refuse(
      'goals_not_recorded',
      `Refused: ${unrecorded.length} home-and-away goal row(s) in season ${season} have goals not recorded. A missing `
        + 'statistic is not zero, so a total derived over them would be understated.',
      { count: unrecorded.length, sample: sample(unrecorded) },
    );
  }

  // 8. Totals and the leaderboard.
  const pathsByPlayer = new Map<string, string[]>();
  for (const row of identityRows) {
    const list = pathsByPlayer.get(row.playerId) ?? [];
    if (!list.includes(row.path)) list.push(row.path);
    pathsByPlayer.set(row.playerId, list);
  }
  for (const list of pathsByPlayer.values()) list.sort(codeUnitCompare);

  const totals = new Map<string, { goals: number; clubs: Set<string> }>();
  for (const fact of haFacts) {
    const entry = totals.get(fact.playerId) ?? { goals: 0, clubs: new Set<string>() };
    entry.goals += fact.goals as number;
    entry.clubs.add(fact.clubId);
    totals.set(fact.playerId, entry);
  }
  const leaderboard: ColemanLeaderboardEntry[] = [...totals.entries()].map(([playerId, entry]) => {
    const paths = pathsByPlayer.get(playerId) ?? [];
    return {
      playerId,
      profilePath: paths.length === 1 ? paths[0] : null,
      goals: entry.goals,
      clubIds: [...entry.clubs].sort(codeUnitCompare),
    };
  });
  leaderboard.sort((a, b) => {
    if (a.goals !== b.goals) return b.goals - a.goals;
    if (a.profilePath !== b.profilePath) {
      if (a.profilePath === null) return 1;
      if (b.profilePath === null) return -1;
      return codeUnitCompare(a.profilePath, b.profilePath);
    }
    return codeUnitCompare(a.playerId, b.playerId);
  });

  // 9. Winners: every player tied on the maximum, if the maximum is at least minimumGoals.
  const maxGoals = leaderboard.length > 0 ? leaderboard[0].goals : null;
  const leaders = maxGoals !== null && maxGoals >= contract.minimumGoals
    ? leaderboard.filter((entry) => entry.goals === maxGoals)
    : [];

  const missingIdentity: string[] = [];
  const ambiguousIdentity: { playerId: string; paths: string[] }[] = [];
  const unsafePaths: { playerId: string; path: string }[] = [];
  const winners: ColemanWinner[] = [];
  for (const leader of leaders) {
    const paths = pathsByPlayer.get(leader.playerId) ?? [];
    if (paths.length === 0) {
      missingIdentity.push(leader.playerId);
      continue;
    }
    if (paths.length > 1) {
      ambiguousIdentity.push({ playerId: leader.playerId, paths });
      continue;
    }
    const path = paths[0];
    if (path.includes(contract.keySeparator)) {
      unsafePaths.push({ playerId: leader.playerId, path });
      continue;
    }
    winners.push({
      playerId: leader.playerId,
      profilePath: path,
      goals: leader.goals,
      clubId: leader.clubIds.length === 1 ? leader.clubIds[0] : null,
      clubCount: leader.clubIds.length,
      key: colemanKey(contract, season, path),
    });
  }
  // Two winners sharing one path would collide on the durable key.
  const byPath = new Map<string, string[]>();
  for (const winner of winners) byPath.set(winner.profilePath, [...(byPath.get(winner.profilePath) ?? []), winner.playerId]);
  for (const [path, players] of byPath) {
    if (players.length > 1) ambiguousIdentity.push({ playerId: players.sort(codeUnitCompare).join(','), paths: [path] });
  }
  const identityEvidence = {
    missingIdentity: { count: missingIdentity.length, sample: sample(missingIdentity) },
    ambiguousIdentity: { count: ambiguousIdentity.length, sample: sample(ambiguousIdentity) },
    unsafePaths: { count: unsafePaths.length, sample: sample(unsafePaths) },
  };
  const noFallback = 'The derivation will not fall back to a player id, a fitzRoy numeric id or a name.';
  if (missingIdentity.length > 0) {
    return refuse(
      'identity_missing',
      `Refused: ${missingIdentity.length} winner(s) hold no ${contract.identityMatchMethod} identity with status in `
        + `[${contract.identityStatuses.join(', ')}]. ${noFallback}`,
      identityEvidence,
    );
  }
  if (ambiguousIdentity.length > 0) {
    return refuse(
      'identity_ambiguous',
      `Refused: ${ambiguousIdentity.length} winner(s) hold more than one profile identity, or share one. ${noFallback}`,
      identityEvidence,
    );
  }
  if (unsafePaths.length > 0) {
    return refuse(
      'unsafe_key',
      `Refused: ${unsafePaths.length} profile path(s) contain the '${contract.keySeparator}' key separator and are `
        + 'refused, not sanitised.',
      identityEvidence,
    );
  }
  winners.sort((a, b) => codeUnitCompare(a.profilePath, b.profilePath));

  // 10. The canonical inputs, their checksum, and the result.
  const haPlayerIds = new Set(totals.keys());
  const inputs: ColemanDerivationInputs = {
    format: COLEMAN_INPUT_FORMAT,
    formatVersion: COLEMAN_INPUT_FORMAT_VERSION,
    season,
    contract: {
      awardSlug: contract.awardSlug,
      methodVersion: contract.methodVersion,
      firstSeason: contract.firstSeason,
      sourceKey: contract.sourceKey,
      minimumGoals: contract.minimumGoals,
      identityMatchMethod: contract.identityMatchMethod,
      identityStatuses: [...contract.identityStatuses].sort(codeUnitCompare),
      keySeparator: contract.keySeparator,
    },
    seasonState: { status: 'complete', settled: true },
    matches: allMatches.map((m) => ({
      matchId: m.matchId,
      roundType: m.roundType,
      homeClubId: m.homeClubId,
      awayClubId: m.awayClubId,
    })),
    goals: [...facts]
      .sort((a, b) => codeUnitCompare(a.matchId, b.matchId) || codeUnitCompare(a.playerId, b.playerId))
      .map((f) => ({ matchId: f.matchId, playerId: f.playerId, clubId: f.clubId, goals: f.goals })),
    identities: [...pathsByPlayer.entries()]
      .filter(([playerId]) => haPlayerIds.has(playerId))
      .sort(([a], [b]) => codeUnitCompare(a, b))
      .map(([playerId, paths]) => ({ playerId, paths })),
  };
  const inputChecksum = createHash('sha256').update(canonicalJson(inputs)).digest('hex');

  return {
    ok: true,
    result: {
      season,
      methodVersion: contract.methodVersion,
      derivationVersion,
      derivedAt,
      inputChecksum,
      minimumGoals: contract.minimumGoals,
      maxGoals,
      tie: winners.length > 1,
      winners,
      leaderboard,
      counts: {
        homeAndAwayMatches: haMatches.length,
        finalsMatches: finalsMatches.length,
        homeAndAwayGoalRows: haFacts.length,
        finalsRowsExcluded,
        players: leaderboard.length,
      },
      inputs,
    },
  };
}
