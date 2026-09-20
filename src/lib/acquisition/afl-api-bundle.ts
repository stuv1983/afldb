/**
 * AFLDB-ISSUE-228 S3 (§7.2, §9, §11) — the AFL.com.au bundle emitter.
 *
 * parse -> resolve -> project -> bundle, exactly as §16's S3 row names it:
 *   - `parse` is the caller's `JSON.parse()` of an already-acquired (S2)
 *     response body; this module never does I/O and never fetches.
 *   - `resolve` turns provider ids into AFLDB identities using ONLY
 *     already-parsed reference data (`afl-api-identities.json` via
 *     `parseAflApiIdentities`) and the round translation module
 *     (`afl-api-rounds.ts`). No database, so club/venue `id` values are
 *     never produced here — only provider ids and, where the identity map
 *     covers it, the resolved historical name string. Real numeric
 *     `club_id`/`venue_id` resolution is a settle-stage (S6) concern.
 *   - `project` is `assertProjectableColumns()` against the registry
 *     contract for observed leaf columns (`flattenObservedColumns`), plus
 *     the typed field mapping (§11).
 *   - `bundle` (`buildAflApiMatchBundle`) combines the match, match_roster
 *     and player_match_stats projections for ONE match into one record,
 *     because §11.1's local `match_date`/`match_time` and §9 assertion 4's
 *     "derived match_period_scores reproduce the final score" both need
 *     more than one family's payload at once.
 *
 * `match_roster`'s scope is DELIBERATELY NARROW. The measured raw payload
 * (`03-match-roster.raw.json`) is a much larger "match centre" response than
 * its name suggests: alongside `match` and `matchRoster` it also carries a
 * `recentMatchScores[]` head-to-head widget (of which ONLY the entry whose
 * `matchId` equals the requested match is this match's own quarter-by-quarter
 * score — the other entries are OTHER matches between the same two teams)
 * and at least one further, un-catalogued widget shape (`homeResult`/
 * `awayResult`/`scoreBreakdown`) plus a `teamPlayers` squad list. None of
 * that extra material is declared or projected here (§4: "Do not interpret
 * raw nested JSON keys as canonical family columns unless the emitter
 * exposes them") — `match_roster`'s `known_columns_status` stays
 * `incomplete` for exactly this reason; a future stage that wants those
 * widgets must measure and declare them first, never assume this module's
 * silence about them means they do not exist.
 *
 * Semantic hashing (§4.5, §9 assertion 9): `semanticHash()` canonicalises
 * (sorted keys, stable array order) the OBSERVATION object each family
 * emitter narrows the raw payload to (never the raw HTTP bytes wholesale for
 * `match_roster`), applies `hash_exclusions` (currently empty for every
 * family — nothing here proposes one) and SHA-256s the result.
 */

import { createHash } from 'node:crypto';

import { type FixtureRoundType } from '@/lib/fixtures/spec';
import {
  assertProjectableColumns,
  getSourceFamily,
  type SourceFamilyRegistry,
} from './source-families';
import {
  translateAflRound,
  type ObservedAflRound,
} from './afl-api-rounds';

export class AflApiBundleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AflApiBundleError';
  }
}

function fail(code: string, message: string): never {
  throw new AflApiBundleError(code, message);
}

// ---------------------------------------------------------------------------
// Generic column-flattening / canonical-hash primitives (family-agnostic)
// ---------------------------------------------------------------------------

/**
 * Deterministic, dedup'd, sorted set of leaf-value dot-paths present in
 * `value`. Arrays are transparent (no index in the path; every element is
 * unioned into the same path), matching the convention the S1 registry
 * already uses for `afl_api.lineup`/`afl_api.roster` (`player.playerId`
 * etc. for an array of players). An EMPTY array or object contributes no
 * path at all — a field that is only ever observed empty across the whole
 * backtest corpus never becomes part of the declared contract by accident;
 * it stays silent until a sample actually populates it.
 */
export function flattenObservedColumns(value: unknown): string[] {
  const out = new Set<string>();
  walkColumns(value, '', out);
  return [...out].sort();
}

function walkColumns(value: unknown, path: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkColumns(item, path, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walkColumns(child, path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (path) out.add(path);
}

/** Sorted-key, stable-array-order JSON — the same logical value always
 * stringifies identically regardless of source key order (§9 assertion 8/9). */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Deep-removes every property whose full dot-path (same convention as
 * `flattenObservedColumns`) is in `excluded`, at any array depth. */
export function applyHashExclusions(value: unknown, excluded: readonly string[]): unknown {
  if (excluded.length === 0) return value;
  return stripExcluded(value, '', new Set(excluded));
}

function stripExcluded(value: unknown, path: string, excluded: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripExcluded(item, path, excluded));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (excluded.has(childPath)) continue;
      out[key] = stripExcluded(child, childPath, excluded);
    }
    return out;
  }
  return value;
}

/** §4.5 / §9 assertion 9: immutable raw payload -> parse -> declared-column
 * selection (`applyHashExclusions`) -> canonical deterministic JSON -> hash. */
export function semanticHash(observation: unknown, hashExclusions: readonly string[] = []): string {
  const selected = applyHashExclusions(observation, hashExclusions);
  return createHash('sha256').update(canonicalStringify(selected), 'utf8').digest('hex');
}

/**
 * Runs the registry's fail-closed column gate for one family against one
 * observation, using this module's own flattening convention.
 *
 * `options.requireColumns` (default `true`) is `assertProjectableColumns()`'s
 * own escape hatch (`source-families.ts`) for a family whose observation
 * wraps a collection that can legitimately be observed empty (§10's
 * Brownlow families) — see that function's doc comment. Every other caller
 * omits it and is unaffected.
 */
export function projectFamily(
  registry: SourceFamilyRegistry, sourceKey: string, family: string, observation: unknown,
  options: { requireColumns?: boolean } = {},
): { observedColumns: string[] } {
  const contract = getSourceFamily(registry, sourceKey, family);
  const observedColumns = flattenObservedColumns(observation);
  assertProjectableColumns(contract, observedColumns, options);
  return { observedColumns };
}

// ---------------------------------------------------------------------------
// Reference identities (§5.3) — parsed, never read from disk here
// ---------------------------------------------------------------------------

export type AflApiTeamIdentity = {
  hist: string;
  rawName: string;
  rawAbbreviation: string;
  rawNickname: string;
};

export type AflApiVenueIdentity = {
  rawName: string;
  legacyName: string;
};

export type AflApiSeasonIdentity = {
  compSeasonId: number;
  providerId: string;
};

export type AflApiIdentities = {
  teams: ReadonlyMap<string, AflApiTeamIdentity>;
  venues: ReadonlyMap<string, AflApiVenueIdentity>;
  /** Keyed by season YEAR, not by providerId. */
  seasons: ReadonlyMap<number, AflApiSeasonIdentity>;
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_identities', `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail('invalid_identities', `${path} must be a non-empty string.`);
  return value as string;
}

/** Parses `data/reference/afl-api-identities.json`'s already-`JSON.parse()`d
 * content. `$comment` keys are ignored everywhere; every other key is
 * data. Fails closed on a malformed shape rather than guessing. */
export function parseAflApiIdentities(raw: unknown): AflApiIdentities {
  const root = record(raw, 'identities');

  const teams = new Map<string, AflApiTeamIdentity>();
  for (const [key, value] of Object.entries(record(root.teams, 'identities.teams'))) {
    if (key === '$comment') continue;
    const row = record(value, `identities.teams.${key}`);
    teams.set(key, {
      hist: str(row.hist, `identities.teams.${key}.hist`),
      rawName: str(row.raw_name, `identities.teams.${key}.raw_name`),
      rawAbbreviation: str(row.raw_abbreviation, `identities.teams.${key}.raw_abbreviation`),
      rawNickname: str(row.raw_nickname, `identities.teams.${key}.raw_nickname`),
    });
  }

  const venues = new Map<string, AflApiVenueIdentity>();
  for (const [key, value] of Object.entries(record(root.venues, 'identities.venues'))) {
    if (key === '$comment') continue;
    const row = record(value, `identities.venues.${key}`);
    venues.set(key, {
      rawName: str(row.raw_name, `identities.venues.${key}.raw_name`),
      legacyName: str(row.legacy_name, `identities.venues.${key}.legacy_name`),
    });
  }

  const seasons = new Map<number, AflApiSeasonIdentity>();
  for (const [key, value] of Object.entries(record(root.seasons, 'identities.seasons'))) {
    if (key === '$comment') continue;
    const year = Number(key);
    if (!Number.isInteger(year)) fail('invalid_identities', `identities.seasons.${key} is not a season year.`);
    const row = record(value, `identities.seasons.${key}`);
    const compSeasonId = row.compSeasonId;
    if (typeof compSeasonId !== 'number' || !Number.isInteger(compSeasonId)) {
      fail('invalid_identities', `identities.seasons.${key}.compSeasonId must be an integer.`);
    }
    seasons.set(year, { compSeasonId, providerId: str(row.providerId, `identities.seasons.${key}.providerId`) });
  }

  return { teams, venues, seasons };
}

function resolveTeam(identities: AflApiIdentities, providerId: unknown): AflApiTeamIdentity {
  const id = str(providerId, 'team.providerId');
  const team = identities.teams.get(id);
  if (!team) fail('unmapped_team', `Team provider id '${id}' is not in afl-api-identities.json.teams.`);
  return team;
}

/** Unmapped venue is a WARNING, never a HALT (§6.2): the caller gets `null`. */
function resolveVenue(identities: AflApiIdentities, providerId: string): AflApiVenueIdentity | null {
  return identities.venues.get(providerId) ?? null;
}

function resolveSeasonByCompProviderId(identities: AflApiIdentities, compSeasonProviderId: string): number {
  for (const [year, season] of identities.seasons) {
    if (season.providerId === compSeasonProviderId) return year;
  }
  fail('unknown_season', `compSeason.providerId '${compSeasonProviderId}' is not declared in afl-api-identities.json.seasons.`);
}

// ---------------------------------------------------------------------------
// Family: afl_api / match (01-fixture-result.json)
// ---------------------------------------------------------------------------

export type AflApiMatchProjection = {
  sourceRecordId: string;
  season: number;
  roundCode: string;
  roundNumber: number | null;
  roundType: FixtureRoundType;
  isFinal: boolean;
  status: string;
  utcStartTime: string;
  venueProviderId: string;
  venueRaw: string;
  venueLegacyName: string | null;
  /** MEASURED: the provider's own IANA timezone string (`match.venue.timezone`,
   * e.g. `'Australia/Melbourne'`) — never the machine's local timezone. `null`
   * when absent (known-but-not-required, §11.1): the local-time cross-check
   * in `buildAflApiMatchBundle()` then stays unproved rather than guessing. */
  venueTimezone: string | null;
  homeTeamProviderId: string;
  homeClubHist: string;
  awayTeamProviderId: string;
  awayClubHist: string;
  homeGoals: number;
  homeBehinds: number;
  homeScore: number;
  awayGoals: number;
  awayBehinds: number;
  awayScore: number;
  result: 'home_win' | 'away_win' | 'draw';
  margin: number;
};

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_match', `${path} must be a number.`);
  return value as number;
}

/** For a KNOWN-but-not-REQUIRED string column: absent (`undefined`/`null`)
 * reads as `null`; present-but-wrong-type still fails closed via `str()`. */
function strOrNull(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return str(value, path);
}

/**
 * `match` family emitter. `raw` is the already-`JSON.parse()`d body of one
 * `01-fixture-result.json` — itself the SELECTED record from the season
 * matches feed by `providerId` (§ "Match fixture source": there is no
 * separate fixture endpoint; S2's acquire tool performs the selection and
 * this function only ever sees one already-selected match object).
 */
export function emitAflApiMatch(
  raw: unknown, registry: SourceFamilyRegistry, identities: AflApiIdentities,
): { record: AflApiMatchProjection; observation: unknown; observedColumns: string[] } {
  const { observedColumns } = projectFamily(registry, 'afl_api', 'match', raw);
  const row = record(raw, 'match');

  const providerId = str(row.providerId, 'match.providerId');
  const compSeason = record(row.compSeason, 'match.compSeason');
  const season = resolveSeasonByCompProviderId(identities, str(compSeason.providerId, 'match.compSeason.providerId'));

  const roundRaw = record(row.round, 'match.round');
  const metadata = row.metadata !== undefined ? record(row.metadata, 'match.metadata') : {};
  const finalsMatchLabel = typeof metadata.finals_match_label === 'string' ? metadata.finals_match_label : null;
  const observedRound: ObservedAflRound = {
    apiRoundNumber: num(roundRaw.roundNumber, 'match.round.roundNumber'),
    apiAbbreviation: str(roundRaw.abbreviation, 'match.round.abbreviation'),
    apiName: str(roundRaw.name, 'match.round.name'),
    finalsMatchLabel,
  };
  const canonicalRound = translateAflRound(registry, season, observedRound);

  const home = record(row.home, 'match.home');
  const away = record(row.away, 'match.away');
  const homeTeam = record(home.team, 'match.home.team');
  const awayTeam = record(away.team, 'match.away.team');
  const homeScore = record(home.score, 'match.home.score');
  const awayScore = record(away.score, 'match.away.score');
  const venue = record(row.venue, 'match.venue');

  const homeIdentity = resolveTeam(identities, homeTeam.providerId);
  const awayIdentity = resolveTeam(identities, awayTeam.providerId);
  const venueProviderId = str(venue.providerId, 'match.venue.providerId');
  const venueIdentity = resolveVenue(identities, venueProviderId);

  const homeGoals = num(homeScore.goals, 'match.home.score.goals');
  const homeBehinds = num(homeScore.behinds, 'match.home.score.behinds');
  const homeTotal = num(homeScore.totalScore, 'match.home.score.totalScore');
  const awayGoals = num(awayScore.goals, 'match.away.score.goals');
  const awayBehinds = num(awayScore.behinds, 'match.away.score.behinds');
  const awayTotal = num(awayScore.totalScore, 'match.away.score.totalScore');

  const result: AflApiMatchProjection['result'] = homeTotal === awayTotal
    ? 'draw'
    : homeTotal > awayTotal ? 'home_win' : 'away_win';

  return {
    observation: raw,
    observedColumns,
    record: {
      sourceRecordId: providerId,
      season,
      roundCode: canonicalRound.roundCode,
      roundNumber: canonicalRound.roundNumber,
      roundType: canonicalRound.roundType,
      isFinal: canonicalRound.isFinal,
      status: str(row.status, 'match.status'),
      utcStartTime: str(row.utcStartTime, 'match.utcStartTime'),
      venueProviderId,
      venueRaw: str(venue.name, 'match.venue.name'),
      venueLegacyName: venueIdentity?.legacyName ?? null,
      venueTimezone: strOrNull(venue.timezone, 'match.venue.timezone'),
      homeTeamProviderId: str(homeTeam.providerId, 'match.home.team.providerId'),
      homeClubHist: homeIdentity.hist,
      awayTeamProviderId: str(awayTeam.providerId, 'match.away.team.providerId'),
      awayClubHist: awayIdentity.hist,
      homeGoals, homeBehinds, homeScore: homeTotal,
      awayGoals, awayBehinds, awayScore: awayTotal,
      result,
      margin: Math.abs(homeTotal - awayTotal),
    },
  };
}

// ---------------------------------------------------------------------------
// Family: afl_api / player_match_stats (02-player-stats.raw.json)
// ---------------------------------------------------------------------------

export type AflApiPlayerMatchStatsProjection = {
  providerMatchId: string;
  providerTeamId: string;
  providerPlayerId: string;
  jumperNumber: number | null;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  goals: number | null;
  behinds: number | null;
  hitouts: number | null;
  tackles: number | null;
  bounces: number | null;
  clangers: number | null;
  goalAssists: number | null;
  rebounds: number | null;
  inside50s: number | null;
  clearances: number | null;
  freesFor: number | null;
  freesAgainst: number | null;
  contested: number | null;
  uncontested: number | null;
  contestedMarks: number | null;
  marksInside50: number | null;
  onePercenters: number | null;
};

/**
 * §4.4: the player stats feed emits every count as a JSON float (MEASURED
 * `9.0` etc. on the full 2022-2026 corpus) — `JSON.parse('9.0')` and
 * `Number.isInteger` both treat that as the integer `9`, so a genuine
 * integral count still passes; only an actual fractional value (`9.5`)
 * refuses the record, never silently truncated or rounded.
 */
function numOrNull(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_player_match_stats', `${path} must be a number or null.`);
  if (!Number.isInteger(value)) fail('non_integral_statistic', `${path} must be an integral count; got ${value}.`);
  return value;
}

/**
 * §11.3. `raw` is one already-`JSON.parse()`d `02-player-stats.raw.json`.
 * `matchProviderId` is threaded from acquisition context (§7.1) — this
 * payload carries NO match-level identity field of its own (measured: no
 * `matchId`/`providerId` key anywhere in the response).
 *
 * MEASURED SHAPE (2026-09-19, full 14-sample corpus, 2022-2026, both sides of
 * every match — never a JSON duplicate-KEY artifact, an earlier draft's
 * misdiagnosis): each stats entry carries player identity at TWO DIFFERENT
 * PATHS, not one path with a shadowed duplicate. `entry.player.player` is the
 * POSITION-BEARING copy (`{position, player:{playerId, playerName, captain,
 * playerJumperNumber}}`), sibling to `entry.player.jumperNumber` (a plain
 * number) and `entry.player.photoURL`. `entry.playerStats.player` is a
 * SEPARATE, flat copy of the same identity fields (`{playerId, playerName,
 * captain, playerJumperNumber}`, no `position`), sibling to
 * `entry.playerStats.stats` and to `entry.playerStats.gamesPlayed` /
 * `.timeOnGroundPercentage` / `.lastUpdated` (which therefore live under
 * `playerStats`, never at the entry's own top level). This projection reads
 * identity and jumper number from the FLAT `playerStats.player.*` copy —
 * matching the original intent that never sources `position` from this
 * family (it comes from `match_roster`'s `positions[].position`) — and the
 * position-bearing `player.player.*` copy is declared in the registry for
 * schema-stability only, never read here.
 */
export function emitAflApiPlayerMatchStats(
  raw: unknown, registry: SourceFamilyRegistry, matchProviderId: string,
): { records: AflApiPlayerMatchStatsProjection[]; observation: unknown; observedColumns: string[] } {
  const row = record(raw, 'playerStats');

  // The registry's contract (`teamId`, `player.playerId`, `playerStats.stats.*`, …) is
  // declared at ONE-PLAYER-ENTRY grain, not at the envelope's `{homeTeamPlayerStats:
  // [...], awayTeamPlayerStats: [...]}` grain. Projecting the raw envelope directly
  // would flatten to side-key-prefixed paths (`homeTeamPlayerStats.teamId`, …) that
  // never match the declared columns, so every entry is narrowed FIRST — collected
  // across both sides into one array — and the column gate runs against that array.
  // `flattenObservedColumns()`'s array-transparent convention means the side-key
  // prefix and the entry index never appear in the resulting paths, exactly matching
  // the per-entry contract.
  const entries: { sideKey: 'homeTeamPlayerStats' | 'awayTeamPlayerStats'; index: number; entry: Record<string, unknown> }[] = [];
  for (const sideKey of ['homeTeamPlayerStats', 'awayTeamPlayerStats'] as const) {
    const side = row[sideKey];
    if (side === undefined) continue;
    if (!Array.isArray(side)) fail('invalid_player_match_stats', `playerStats.${sideKey} must be an array.`);
    for (const [index, entryRaw] of side.entries()) {
      entries.push({ sideKey, index, entry: record(entryRaw, `playerStats.${sideKey}[${index}]`) });
    }
  }

  const observation = entries.map((e) => e.entry);
  const { observedColumns } = projectFamily(registry, 'afl_api', 'player_match_stats', observation);

  const records: AflApiPlayerMatchStatsProjection[] = [];
  for (const { sideKey, index, entry } of entries) {
    const path = `playerStats.${sideKey}[${index}]`;
    const teamId = str(entry.teamId, `${path}.teamId`);
    const playerStatsBlock = record(entry.playerStats, `${path}.playerStats`);
    // The flat identity copy, never the position-bearing `entry.player.player.player`
    // one — see the function doc comment.
    const player = record(playerStatsBlock.player, `${path}.playerStats.player`);
    const playerId = str(player.playerId, `${path}.playerStats.player.playerId`);
    const stats = record(playerStatsBlock.stats, `${path}.playerStats.stats`);
    const clearances = stats.clearances !== undefined
      ? record(stats.clearances, `${path}.playerStats.stats.clearances`)
      : {};

    records.push({
      providerMatchId: matchProviderId,
      providerTeamId: teamId,
      providerPlayerId: playerId,
      jumperNumber: numOrNull(player.playerJumperNumber, `${path}.playerStats.player.playerJumperNumber`),
      kicks: numOrNull(stats.kicks, `${path}.stats.kicks`),
      handballs: numOrNull(stats.handballs, `${path}.stats.handballs`),
      disposals: numOrNull(stats.disposals, `${path}.stats.disposals`),
      marks: numOrNull(stats.marks, `${path}.stats.marks`),
      goals: numOrNull(stats.goals, `${path}.stats.goals`),
      behinds: numOrNull(stats.behinds, `${path}.stats.behinds`),
      hitouts: numOrNull(stats.hitouts, `${path}.stats.hitouts`),
      tackles: numOrNull(stats.tackles, `${path}.stats.tackles`),
      bounces: numOrNull(stats.bounces, `${path}.stats.bounces`),
      clangers: numOrNull(stats.clangers, `${path}.stats.clangers`),
      goalAssists: numOrNull(stats.goalAssists, `${path}.stats.goalAssists`),
      rebounds: numOrNull(stats.rebound50s, `${path}.stats.rebound50s`),
      inside50s: numOrNull(stats.inside50s, `${path}.stats.inside50s`),
      clearances: numOrNull(clearances.totalClearances, `${path}.stats.clearances.totalClearances`),
      freesFor: numOrNull(stats.freesFor, `${path}.stats.freesFor`),
      freesAgainst: numOrNull(stats.freesAgainst, `${path}.stats.freesAgainst`),
      contested: numOrNull(stats.contestedPossessions, `${path}.stats.contestedPossessions`),
      uncontested: numOrNull(stats.uncontestedPossessions, `${path}.stats.uncontestedPossessions`),
      contestedMarks: numOrNull(stats.contestedMarks, `${path}.stats.contestedMarks`),
      marksInside50: numOrNull(stats.marksInside50, `${path}.stats.marksInside50`),
      onePercenters: numOrNull(stats.onePercenters, `${path}.stats.onePercenters`),
    });
  }

  const seen = new Set<string>();
  for (const r of records) {
    const key = `${r.providerTeamId}\u0000${r.providerPlayerId}`;
    if (seen.has(key)) {
      fail('duplicate_player_match_stats', `Duplicate player ${r.providerPlayerId} (team ${r.providerTeamId}) appears more than once in match ${matchProviderId}.`);
    }
    seen.add(key);
  }

  return { records, observation, observedColumns };
}

// ---------------------------------------------------------------------------
// Family: afl_api / match_roster (03-match-roster.raw.json) — NARROW SCOPE
// ---------------------------------------------------------------------------

export type AflApiRosterPosition = {
  providerPlayerId: string;
  playerJumperNumber: number | null;
  position: string;
};

export type AflApiPeriodScore = {
  periodNumber: number;
  goals: number;
  behinds: number;
  totalScore: number;
  /** §9 assertion 4's "cumulative conversion": running total through this
   * period, matching `afltables.match.period_scores`' own convention
   * (T3 evidence: "periods 1-4 both sides preserved cumulative-to-date").
   * The AFL API itself publishes PER-PERIOD deltas (proven: summing the
   * four raw `totalScore` deltas equals the match's final score), so this
   * field is DERIVED here, never read off the payload directly. */
  cumulativeTotalScore: number;
};

export type AflApiMatchRosterProjection = {
  providerMatchId: string;
  status: string;
  /** MEASURED: an AFL provider SEASON id (`CD_S2026014`, `compSeason.providerId`'s own
   * value), never a numeric competition identifier — confirmed across every captured
   * `match_roster` sample, 2022-2026. Never coerced to a number; cross-checked against
   * the declared season identity in `buildAflApiMatchBundle()` where possible. */
  competitionId: string;
  apiRoundNumber: number;
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  homePositions: AflApiRosterPosition[];
  awayPositions: AflApiRosterPosition[];
  /** `null` when this match's own id is absent from `recentMatchScores[]`
   * (never fabricated — §9 assertion 4 is then reported as `skipped`, not
   * silently passed). */
  periodScores: { home: AflApiPeriodScore[]; away: AflApiPeriodScore[] } | null;
  /** MEASURED: `raw.match.venueLocalStartTime` — a NAIVE venue-local
   * wall-clock timestamp with no offset (e.g. `'2026-09-19T17:15:00'`),
   * retained exactly as published. Known-but-not-required (§11.1 operator
   * decision, 2026-09-20): `null` when the sibling `match` object or this
   * field is absent, never fabricated from any other value. Only the
   * bundle/cross-family layer (`buildAflApiMatchBundle()`) may turn this,
   * plus the `match` family's own `utcStartTime`/`venue.timezone`, into a
   * canonical local match date/time — this projection never claims that
   * derivation is its own. */
  venueLocalStartTime: string | null;
};

function toCumulative(periods: readonly { periodNumber: number; goals: number; behinds: number; totalScore: number }[]): AflApiPeriodScore[] {
  let goals = 0;
  let behinds = 0;
  let total = 0;
  return periods
    .slice()
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((p) => {
      goals += p.goals;
      behinds += p.behinds;
      total += p.totalScore;
      return { periodNumber: p.periodNumber, goals: p.goals, behinds: p.behinds, totalScore: p.totalScore, cumulativeTotalScore: total };
    });
}

function parsePositions(teamRow: Record<string, unknown>, path: string): AflApiRosterPosition[] {
  const positions = teamRow.positions;
  if (!Array.isArray(positions)) fail('invalid_match_roster', `${path}.positions must be an array.`);
  return positions.map((entryRaw, index) => {
    const entryPath = `${path}.positions[${index}]`;
    const entry = record(entryRaw, entryPath);
    const player = record(entry.player, `${entryPath}.player`);
    return {
      providerPlayerId: str(player.playerId, `${entryPath}.player.playerId`),
      playerJumperNumber: numOrNull(player.playerJumperNumber, `${entryPath}.player.playerJumperNumber`),
      position: str(entry.position, `${entryPath}.position`),
    };
  });
}

function parseTeamPeriodScore(sideRaw: unknown, path: string): { periodNumber: number; goals: number; behinds: number; totalScore: number }[] {
  const side = record(sideRaw, path);
  const periodScore = side.periodScore;
  if (!Array.isArray(periodScore)) fail('invalid_match_roster', `${path}.periodScore must be an array.`);
  return periodScore.map((entryRaw, index) => {
    const entryPath = `${path}.periodScore[${index}]`;
    const entry = record(entryRaw, entryPath);
    const score = record(entry.score, `${entryPath}.score`);
    return {
      periodNumber: num(entry.periodNumber, `${entryPath}.periodNumber`),
      goals: num(score.goals, `${entryPath}.score.goals`),
      behinds: num(score.behinds, `${entryPath}.score.behinds`),
      totalScore: num(score.totalScore, `${entryPath}.score.totalScore`),
    };
  });
}

/**
 * `match_roster` family emitter. `raw` is the already-`JSON.parse()`d body
 * of one `03-match-roster.raw.json`. The OBSERVATION this function projects
 * (and hashes) is deliberately narrowed to `matchRoster` plus the ONE
 * `recentMatchScores[]` entry matching `matchProviderId` — see the module
 * doc comment for why the rest of the payload is out of scope for v1.
 */
export function emitAflApiMatchRoster(
  raw: unknown, registry: SourceFamilyRegistry, matchProviderId: string,
): { record: AflApiMatchRosterProjection; observation: unknown; observedColumns: string[] } {
  const root = record(raw, 'matchRosterResponse');
  const matchRoster = record(root.matchRoster, 'matchRosterResponse.matchRoster');
  const homeTeam = record(matchRoster.homeTeam, 'matchRoster.homeTeam');
  const awayTeam = record(matchRoster.awayTeam, 'matchRoster.awayTeam');

  const recentMatchScores = Array.isArray(root.recentMatchScores) ? root.recentMatchScores : [];
  const ownScoreEntry = recentMatchScores
    .map((entryRaw) => record(entryRaw, 'recentMatchScores[]'))
    .find((entry) => entry.matchId === matchProviderId);

  // §11.1 operator decision (2026-09-20): the raw payload's SIBLING `match`
  // object (measured shape: `{name, date, status, matchId, ...}`) is never
  // read wholesale — only the one sanctioned `venueLocalStartTime` leaf is
  // retained, so an undeclared sibling field never silently starts
  // participating in the hashed observation.
  const matchSibling = root.match !== undefined ? record(root.match, 'match') : undefined;
  const venueLocalStartTime = strOrNull(matchSibling?.venueLocalStartTime, 'match.venueLocalStartTime');

  // Deliberately narrow: `ins`/`outs`/`milestones`/`clubDebuts` are present
  // in the raw payload but their POPULATED leaf shape is unmeasured (every
  // sample this family has been checked against shows no populated
  // milestone/in/out for the observed matches) — see the module doc
  // comment. They are excluded from the observation rather than guessed
  // into a column declaration, keeping `known_columns_status: 'incomplete'`
  // honest until a populated sample proves their shape.
  const observation: Record<string, unknown> = {
    matchId: matchRoster.matchId,
    status: matchRoster.status,
    competitionId: matchRoster.competitionId,
    roundNumber: matchRoster.roundNumber,
    weather: matchRoster.weather,
    umpires: matchRoster.umpires,
    homeTeam: { teamId: homeTeam.teamId, positions: homeTeam.positions },
    awayTeam: { teamId: awayTeam.teamId, positions: awayTeam.positions },
  };
  if (venueLocalStartTime !== null) {
    observation.match = { venueLocalStartTime };
  }
  if (ownScoreEntry) {
    observation.periodScores = {
      matchId: ownScoreEntry.matchId,
      status: ownScoreEntry.status,
      homeTeamScore: ownScoreEntry.homeTeamScore,
      awayTeamScore: ownScoreEntry.awayTeamScore,
    };
  }

  const { observedColumns } = projectFamily(registry, 'afl_api', 'match_roster', observation);

  const periodScores = ownScoreEntry
    ? {
      home: toCumulative(parseTeamPeriodScore(ownScoreEntry.homeTeamScore, 'recentMatchScores[].homeTeamScore')),
      away: toCumulative(parseTeamPeriodScore(ownScoreEntry.awayTeamScore, 'recentMatchScores[].awayTeamScore')),
    }
    : null;

  return {
    observation,
    observedColumns,
    record: {
      providerMatchId: str(matchRoster.matchId, 'matchRoster.matchId'),
      status: str(matchRoster.status, 'matchRoster.status'),
      competitionId: str(matchRoster.competitionId, 'matchRoster.competitionId'),
      apiRoundNumber: num(matchRoster.roundNumber, 'matchRoster.roundNumber'),
      homeTeamProviderId: str(homeTeam.teamId, 'matchRoster.homeTeam.teamId'),
      awayTeamProviderId: str(awayTeam.teamId, 'matchRoster.awayTeam.teamId'),
      homePositions: parsePositions(homeTeam, 'matchRoster.homeTeam'),
      awayPositions: parsePositions(awayTeam, 'matchRoster.awayTeam'),
      periodScores,
      venueLocalStartTime,
    },
  };
}

// ---------------------------------------------------------------------------
// Family: afl_api / brownlow_match_votes (01-brownlow-season.raw.json)
// ---------------------------------------------------------------------------

export type AflApiBrownlowVote = {
  providerPlayerId: string;
  providerTeamId: string;
  votes: number;
  eligible: boolean;
};

export type AflApiBrownlowMatchVoteRecord = {
  providerMatchId: string;
  apiRoundNumber: number;
  votes: AflApiBrownlowVote[];
};

const VALID_VOTE_SET = new Set([3, 2, 1]);

/**
 * §10 validation: exactly one 3-row vote set per match, votes exactly
 * {3,2,1}, total 6, no duplicate player within a match. A violating match
 * record throws `BrownlowVoteSetError` (all-or-none per match, mirroring
 * the match family) rather than silently dropping the bad rows.
 */
export class BrownlowVoteSetError extends AflApiBundleError {
  constructor(public readonly providerMatchId: string, message: string) {
    super('bad_vote_set', message);
  }
}

export function emitAflApiBrownlowMatchVotes(
  raw: unknown, registry: SourceFamilyRegistry,
): { records: AflApiBrownlowMatchVoteRecord[]; observation: unknown; observedColumns: string[] } {
  const row = record(raw, 'brownlowSeason');
  const matchVotes = row.matchVotes;
  if (!Array.isArray(matchVotes)) fail('invalid_brownlow', 'brownlowSeason.matchVotes must be an array.');

  // MEASURED (2026-09-19, full 2022-2025 corpus): the real season envelope also carries
  // top-level `players[]` (per-player eligibility/leader/winner summary) and `teams[]`
  // (per-team vote totals) collections, siblings of `matchVotes`. Those are OUT OF SCOPE
  // for this family's matchVotes-grain contract, so the observation is narrowed to the
  // declared top-level keys FIRST -- before the column gate runs -- rather than declaring
  // the unrelated collections just to absorb them (same projection-boundary discipline as
  // `emitAflApiPlayerMatchStats()`'s per-entry narrowing above).
  const observation = { seasonId: row.seasonId, status: row.status, matchVotes };
  // §10 pre-count publication: `matchVotes = []` is a VALID "no votes published
  // yet" state, never a malformed source. `matchVotes.matchId` etc. are declared
  // required per PUBLISHED VOTE RECORD, not per response — they cannot be
  // observed at all when there are zero records (`flattenObservedColumns()`
  // contributes no path for an empty array), so the required-column gate is
  // skipped only when the collection itself is empty. The unexpected-column
  // check still runs, and every per-field strict parse below (`str`/`num`) still
  // fails closed on any record that DOES exist and is malformed.
  const { observedColumns } = projectFamily(registry, 'afl_api', 'brownlow_match_votes', observation, {
    requireColumns: matchVotes.length > 0,
  });

  const records: AflApiBrownlowMatchVoteRecord[] = [];
  const seenMatchIds = new Set<string>();
  for (const [index, entryRaw] of matchVotes.entries()) {
    const path = `matchVotes[${index}]`;
    const entry = record(entryRaw, path);
    const providerMatchId = str(entry.matchId, `${path}.matchId`);
    if (seenMatchIds.has(providerMatchId)) {
      throw new BrownlowVoteSetError(providerMatchId, `Duplicate matchId '${providerMatchId}' in brownlowSeason.matchVotes.`);
    }
    seenMatchIds.add(providerMatchId);

    const votesRaw = entry.votes;
    if (!Array.isArray(votesRaw) || votesRaw.length !== 3) {
      throw new BrownlowVoteSetError(providerMatchId, `Match '${providerMatchId}' carries ${Array.isArray(votesRaw) ? votesRaw.length : 'no'} vote row(s); expected exactly 3.`);
    }
    const votes: AflApiBrownlowVote[] = votesRaw.map((voteRaw, voteIndex) => {
      const votePath = `${path}.votes[${voteIndex}]`;
      const vote = record(voteRaw, votePath);
      const player = record(vote.player, `${votePath}.player`);
      const team = record(vote.team, `${votePath}.team`);
      return {
        providerPlayerId: str(player.playerId, `${votePath}.player.playerId`),
        providerTeamId: str(team.teamId, `${votePath}.team.teamId`),
        votes: num(vote.votes, `${votePath}.votes`),
        eligible: vote.eligible === true,
      };
    });

    const values = votes.map((v) => v.votes).sort((a, b) => b - a);
    if (values.length !== 3 || !values.every((v, i) => v === [3, 2, 1][i]) || !values.every((v) => VALID_VOTE_SET.has(v))) {
      throw new BrownlowVoteSetError(providerMatchId, `Match '${providerMatchId}' vote values are [${values.join(', ')}]; expected exactly [3, 2, 1].`);
    }
    const total = values.reduce((a, b) => a + b, 0);
    if (total !== 6) throw new BrownlowVoteSetError(providerMatchId, `Match '${providerMatchId}' votes sum to ${total}; expected 6.`);

    const playerIds = new Set<string>();
    for (const v of votes) {
      if (playerIds.has(v.providerPlayerId)) {
        throw new BrownlowVoteSetError(providerMatchId, `Match '${providerMatchId}' has duplicate player '${v.providerPlayerId}' within its vote set.`);
      }
      playerIds.add(v.providerPlayerId);
    }

    records.push({ providerMatchId, apiRoundNumber: num(entry.roundNumber, `${path}.roundNumber`), votes });
  }

  return { records, observation, observedColumns };
}

// ---------------------------------------------------------------------------
// Family: afl_api / brownlow_leaderboard (02-brownlow-leaderboard.raw.json)
// ---------------------------------------------------------------------------

export type AflApiBrownlowLeaderboardRecord = {
  providerPlayerId: string;
  providerTeamId: string;
  votes: number;
  eligible: boolean;
  winner: boolean;
  /** Measured as a separate boolean from `winner` (both keys are present on
   * every entry); AFLDB has no current use for it, so it is carried
   * unprojected-to-nothing but still declared, matching `player.captain`'s
   * treatment in `afl_api.lineup`. */
  leader: boolean;
  roundVotes: { providerMatchId: string; apiRoundNumber: number; votes: number }[];
};

export function emitAflApiBrownlowLeaderboard(
  raw: unknown, registry: SourceFamilyRegistry,
): { records: AflApiBrownlowLeaderboardRecord[]; observation: unknown; observedColumns: string[] } {
  const row = record(raw, 'brownlowLeaderboard');
  const leaderboard = row.leaderboard;
  if (!Array.isArray(leaderboard)) fail('invalid_brownlow', 'brownlowLeaderboard.leaderboard must be an array.');

  // Same projection-boundary discipline as `emitAflApiBrownlowMatchVotes()` above: narrow
  // to this family's declared top-level keys BEFORE the column gate, rather than
  // projecting the whole envelope and risking an unrelated sibling collection tripping the
  // fail-closed gate. MEASURED (2026-09-19, full 2022-2025 corpus): the leaderboard
  // envelope currently carries no such sibling collections, but the emitter does not rely
  // on that staying true.
  const observation = { seasonId: row.seasonId, status: row.status, teamFilter: row.teamFilter, leaderboard };
  // §10 pre-count publication: an empty `leaderboard[]` is equally valid and
  // equally unable to carry its per-entry required columns — same reasoning as
  // `emitAflApiBrownlowMatchVotes()` above.
  const { observedColumns } = projectFamily(registry, 'afl_api', 'brownlow_leaderboard', observation, {
    requireColumns: leaderboard.length > 0,
  });

  const records = leaderboard.map((entryRaw, index) => {
    const path = `leaderboard[${index}]`;
    const entry = record(entryRaw, path);
    const player = record(entry.player, `${path}.player`);
    const team = record(entry.team, `${path}.team`);
    const roundByRoundVotes = entry.roundByRoundVotes;
    if (!Array.isArray(roundByRoundVotes)) fail('invalid_brownlow', `${path}.roundByRoundVotes must be an array.`);
    return {
      providerPlayerId: str(player.playerId, `${path}.player.playerId`),
      providerTeamId: str(team.teamId, `${path}.team.teamId`),
      // MEASURED: the leaderboard entry's season total is `totalVotes`, never a bare
      // `votes` key (confirmed on every captured season, 2022-2025) — `votes` on this
      // type is AFLDB's own field name, not a source key.
      votes: num(entry.totalVotes, `${path}.totalVotes`),
      eligible: entry.eligible === true,
      winner: entry.winner === true,
      leader: entry.leader === true,
      roundVotes: roundByRoundVotes.map((rvRaw, rvIndex) => {
        const rvPath = `${path}.roundByRoundVotes[${rvIndex}]`;
        const rv = record(rvRaw, rvPath);
        return {
          providerMatchId: str(rv.matchId, `${rvPath}.matchId`),
          apiRoundNumber: num(rv.roundNumber, `${rvPath}.roundNumber`),
          votes: num(rv.votes, `${rvPath}.votes`),
        };
      }),
    };
  });

  return { records, observation, observedColumns };
}

/** §10 validation: reconstructed per-player totals from `matchVotes` must
 * equal the leaderboard's own `votes` total. Returns the mismatching
 * provider player ids (empty = reconciled). Pure comparison — no I/O. */
export function reconcileBrownlowLeaderboard(
  matchVotes: readonly AflApiBrownlowMatchVoteRecord[],
  leaderboard: readonly AflApiBrownlowLeaderboardRecord[],
): { providerPlayerId: string; reconstructedTotal: number; leaderboardTotal: number }[] {
  const totals = new Map<string, number>();
  for (const match of matchVotes) {
    for (const vote of match.votes) {
      totals.set(vote.providerPlayerId, (totals.get(vote.providerPlayerId) ?? 0) + vote.votes);
    }
  }
  const mismatches: { providerPlayerId: string; reconstructedTotal: number; leaderboardTotal: number }[] = [];
  for (const entry of leaderboard) {
    const reconstructed = totals.get(entry.providerPlayerId) ?? 0;
    if (reconstructed !== entry.votes) {
      mismatches.push({ providerPlayerId: entry.providerPlayerId, reconstructedTotal: reconstructed, leaderboardTotal: entry.votes });
    }
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// §11.1 local match date/time derivation (S6-D3a) — cross-family ONLY. This
// is deliberately NOT part of either `emitAflApiMatch()` or
// `emitAflApiMatchRoster()`: it needs the `match` family's `utcStartTime` +
// `venue.timezone` AND the `match_roster` family's `venueLocalStartTime`
// together, and neither family may be credited with publishing the other's
// half of the cross-check (module doc comment, "provenance boundary").
// ---------------------------------------------------------------------------

export type AflApiLocalMatchDateTime = {
  /** `YYYY-MM-DD`, the venue-local calendar date. */
  matchDate: string;
  /** `HH:MM:SS`, the venue-local wall-clock time, second precision. */
  matchTime: string;
};

const NAIVE_LOCAL_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;

/** Splits the roster's own naive `venueLocalStartTime` string into its date
 * and time components — never parsed as a `Date` (that would reinterpret it
 * against SOME timezone, exactly what "naive" rules out). */
function parseNaiveLocalTimestamp(value: string, path: string): AflApiLocalMatchDateTime {
  const parsed = NAIVE_LOCAL_TIMESTAMP_RE.exec(value);
  if (!parsed) {
    fail('invalid_match_roster', `${path} is not a naive 'YYYY-MM-DDTHH:MM:SS' local timestamp: '${value}'.`);
  }
  return { matchDate: parsed[1], matchTime: parsed[2] };
}

/**
 * Converts a UTC instant to venue-local wall-clock date/time using
 * `Intl.DateTimeFormat`'s explicit `timeZone` option — timezone-aware
 * standard-library functionality that never consults the host's own
 * timezone, locale or `Date#getHours()`/`getDate()` (both of those read the
 * MACHINE's local timezone, which this derivation must never depend on:
 * the same inputs must produce the same output on any host). Returns `null`
 * for an unrecognised IANA zone rather than throwing — an invalid
 * `venue.timezone` means the derivation stays unproved, never a HALT.
 *
 * Exported (AFLDB-ISSUE-228 S7 reschedule follow-up, 2026-09-20) so
 * `afl-api-fixture-identity.ts` can derive the SAME exact venue-local date
 * from the `match` family's own `utcStartTime`/`venue.timezone` alone, for a
 * READ-ONLY resolution lookup — never for constructing/writing a
 * `match_date`, which stays exactly as `deriveAflApiLocalMatchDateTime()`
 * left it: roster-cross-checked or unproved, never derived from `utcStartTime`
 * alone. A resolution lookup that is wrong fails closed (0 or >1 candidates),
 * so reusing this same derivation there does not weaken §11.1's write-side
 * guarantee; it must not be reimplemented a second time.
 */
export function convertUtcInstantToVenueLocal(utcInstant: Date, timeZone: string): AflApiLocalMatchDateTime | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return null; // Not a recognised IANA zone.
  }
  const parts = Object.fromEntries(formatter.formatToParts(utcInstant).map((p) => [p.type, p.value] as const));
  return {
    matchDate: `${parts.year}-${parts.month}-${parts.day}`,
    matchTime: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

/**
 * §11.1: derives the canonical local `match_date`/`match_time` ONLY when the
 * roster's `venueLocalStartTime` and the match family's own
 * `utcStartTime`/`venue.timezone` agree at second precision. Absence of
 * either input (roster field not published, or an unrecognised/absent
 * timezone) leaves this `null` — unproved, never guessed from UTC alone.
 * An outright contradiction between the two independently-observed values
 * is a genuine cross-family fact and fails closed (`AflApiBundleError`),
 * never silently normalised toward one side.
 */
function deriveAflApiLocalMatchDateTime(
  match: AflApiMatchProjection, roster: AflApiMatchRosterProjection,
): AflApiLocalMatchDateTime | null {
  if (roster.venueLocalStartTime === null) return null;
  if (match.venueTimezone === null) return null;

  const utcInstant = new Date(match.utcStartTime);
  if (Number.isNaN(utcInstant.getTime())) {
    fail('invalid_match', `match.utcStartTime is not a valid instant: '${match.utcStartTime}'.`);
  }

  const derivedFromUtc = convertUtcInstantToVenueLocal(utcInstant, match.venueTimezone);
  if (derivedFromUtc === null) return null; // Unrecognised timezone: unproved, never derived.

  const observedLocal = parseNaiveLocalTimestamp(roster.venueLocalStartTime, 'match_roster (match sibling).venueLocalStartTime');

  if (observedLocal.matchDate !== derivedFromUtc.matchDate || observedLocal.matchTime !== derivedFromUtc.matchTime) {
    fail(
      'local_time_contradiction',
      `Match ${match.sourceRecordId}: roster venueLocalStartTime ('${roster.venueLocalStartTime}') `
      + `disagrees with utcStartTime ('${match.utcStartTime}') converted to '${match.venueTimezone}' `
      + `('${derivedFromUtc.matchDate}T${derivedFromUtc.matchTime}').`,
    );
  }

  return derivedFromUtc;
}

// ---------------------------------------------------------------------------
// Bundle: combine one match's family projections (§16 S3 "bundle" step)
// ---------------------------------------------------------------------------

/**
 * §16 S6, §7.3 (T3): the bundle contract version this emitter speaks once a
 * record can carry a `deferral`. The AFL Tables emitter/validator keeps
 * pinning contract v1 (`SUPPORTED_BUNDLE_CONTRACT_VERSION` in
 * `settle-afltables.ts`) and never gains a `deferral` key — v2 is declared
 * here, at the afl_api-only emitter, so nothing in the AFL Tables path can
 * accidentally start accepting it.
 */
export const AFL_API_BUNDLE_CONTRACT_VERSION = 2;

/**
 * §7.3 (T3): the two deferral reasons this emitter can produce. Mutually
 * exclusive with a rejection (`AflApiBundleError`) — a deferred unit is
 * observed and valid, just not yet promotable, never malformed.
 */
export type AflApiDeferralReason = 'status_not_concluded' | 'roster_not_concluded';

export type AflApiDeferral = {
  reason: AflApiDeferralReason;
  /** The observed status string that earned the deferral (e.g. `'POSTGAME'`). */
  detail: string;
};

export type AflApiMatchBundle = {
  match: AflApiMatchProjection;
  roster: AflApiMatchRosterProjection;
  playerStats: AflApiPlayerMatchStatsProjection[];
  /** §9 assertion 4: sum of the derived cumulative period scores' final
   * period must equal the match family's own final score, independently
   * sourced. `null` when `roster.periodScores` is `null` (skipped, not a
   * silent pass — see `AflApiMatchRosterProjection.periodScores`). */
  periodScoresReproduceFinalScore: boolean | null;
  /** §7.3 (T3), table row 1: non-null when `match.status !== 'CONCLUDED'`.
   * The whole unit — match, roster and player_match_stats alike — is
   * deferred: a live/POSTGAME fixture has not yet published a completed
   * match, so none of its families are promotable yet. Settling this
   * deferral (no target pass, no candidate, `recordsDeferred` counter) is
   * S6-C's concern, not this emitter's — this field only names the fact. */
  matchDeferral: AflApiDeferral | null;
  /** §7.3 (T3), table row 2: non-null only when `matchDeferral` is `null`
   * (the fixture itself is `CONCLUDED`) but `roster.status !== 'CONCLUDED'`.
   * Only the roster and player_match_stats families are deferred; the match
   * family still projects normally. Never set alongside `matchDeferral`. */
  rosterDeferral: AflApiDeferral | null;
  /** §11.1: the cross-family-validated local match date/time, or `null` when
   * the cross-check is unproved (roster `venueLocalStartTime` absent, or
   * `match.venueTimezone` absent/unrecognised) — never the `match` or
   * `match_roster` family's own value alone (see the provenance-boundary
   * module doc comment). A genuine contradiction between the two throws
   * `AflApiBundleError` rather than being represented here. */
  localMatchDateTime: AflApiLocalMatchDateTime | null;
};

export function buildAflApiMatchBundle(
  fixtureRaw: unknown, rosterRaw: unknown, playerStatsRaw: unknown,
  registry: SourceFamilyRegistry, identities: AflApiIdentities,
): AflApiMatchBundle {
  const { record: match } = emitAflApiMatch(fixtureRaw, registry, identities);
  const { record: roster } = emitAflApiMatchRoster(rosterRaw, registry, match.sourceRecordId);
  const { records: playerStats } = emitAflApiPlayerMatchStats(playerStatsRaw, registry, match.sourceRecordId);

  const matchDeferral: AflApiDeferral | null = match.status !== 'CONCLUDED'
    ? { reason: 'status_not_concluded', detail: match.status }
    : null;
  const rosterDeferral: AflApiDeferral | null = matchDeferral === null && roster.status !== 'CONCLUDED'
    ? { reason: 'roster_not_concluded', detail: roster.status }
    : null;

  // §8 gate 2 (season agreement), validated where possible: `roster.competitionId`
  // (a provider SEASON id, e.g. `CD_S2026014`) must name the same declared season as
  // the match family's own `compSeason.providerId`, which `match.season` has already
  // been resolved from. A mismatch is a genuine cross-family contradiction, never
  // silently accepted.
  const declaredSeason = identities.seasons.get(match.season);
  if (declaredSeason && roster.competitionId !== declaredSeason.providerId) {
    fail(
      'competition_id_mismatch',
      `match_roster.competitionId '${roster.competitionId}' does not match the declared `
      + `season ${match.season} providerId '${declaredSeason.providerId}' (match ${match.sourceRecordId}).`,
    );
  }

  let periodScoresReproduceFinalScore: boolean | null = null;
  if (roster.periodScores) {
    const { home, away } = roster.periodScores;
    const homeFinal = home.length > 0 ? home[home.length - 1].cumulativeTotalScore : null;
    const awayFinal = away.length > 0 ? away[away.length - 1].cumulativeTotalScore : null;
    periodScoresReproduceFinalScore = homeFinal === match.homeScore && awayFinal === match.awayScore;
  }

  const localMatchDateTime = deriveAflApiLocalMatchDateTime(match, roster);

  return {
    match, roster, playerStats, periodScoresReproduceFinalScore, matchDeferral, rosterDeferral, localMatchDateTime,
  };
}

// ---------------------------------------------------------------------------
// Settle records (§16 S6, §7.2, §19.6) — DB-free bundle-v2 record/envelope
// construction, S6-C. No database, no identity resolution beyond S3's own,
// no rejection synthesis: a thrown `AflApiBundleError` from the emitters
// above is the (not-yet-built) settle engine's rejection signal, never
// this function's — see `AflApiSettleRecord.rejection`'s doc comment.
// ---------------------------------------------------------------------------

/** The three families S6 settles (§16 S6 row, §5.2). Brownlow families are S7. */
export type AflApiSettleFamily = 'match' | 'match_roster' | 'player_match_stats';

/** Kept for shape parity with the AFL Tables `BundleRecord` contract
 * (`settle-afltables.ts:557`); never populated by this DB-free conversion. */
export type AflApiSettleRejection = { reason: string; detail: string | null };

/**
 * §5.2 / §7.2's per-record settle-record shape, generalised from the AFL
 * Tables `BundleRecord` contract (`settle-afltables.ts:559-568`,
 * `{family, scopeKey, externalRecordId, payload, observedColumns,
 * projection, rejection}`) to bundle contract v2 (§7.3, T3): the extra
 * `deferral` field, mutually exclusive with both `projection` and
 * `rejection` (§7.3, §19.6).
 */
export type AflApiSettleRecord = {
  family: AflApiSettleFamily;
  scopeKey: string;
  externalRecordId: string;
  payload: unknown;
  observedColumns: readonly string[];
  projection: unknown | null;
  rejection: AflApiSettleRejection | null;
  deferral: AflApiDeferral | null;
};

function assertSettleRecordExclusivity(settleRecord: AflApiSettleRecord): AflApiSettleRecord {
  const populated = [settleRecord.projection !== null, settleRecord.rejection !== null, settleRecord.deferral !== null]
    .filter(Boolean).length;
  if (populated > 1) {
    fail(
      'invalid_settle_record',
      `${settleRecord.family} record '${settleRecord.externalRecordId}' carries more than one of `
      + 'projection/rejection/deferral; §7.3 declares them mutually exclusive.',
    );
  }
  return settleRecord;
}

/**
 * Converts one match's already-built `AflApiMatchBundle` (S6-B) into the
 * explicit settle records a future `settle-afl-api.ts` will resolve,
 * reconcile and apply. `fixtureRaw`/`rosterRaw`/`playerStatsRaw` MUST be the
 * same three already-`JSON.parse()`d bodies `bundle` was built from — this
 * function re-derives each family's `payload` (observed-columns
 * observation) from them rather than threading it through
 * `AflApiMatchBundle` itself, so that type stays exactly the S6-B-validated
 * shape.
 *
 * Deferral mapping (§7.3 table, S6-B semantics preserved exactly):
 * - `match` carries `bundle.matchDeferral` only — it still projects on a
 *   CONCLUDED-fixture/non-CONCLUDED-roster unit (table row 2).
 * - `match_roster` and every `player_match_stats` row carry
 *   `bundle.matchDeferral ?? bundle.rosterDeferral` — either one defers the
 *   whole roster/stat side, and `matchDeferral` (the wider fact) always
 *   wins when both would apply (table row 1: the whole unit is deferred).
 *
 * `player_match_stats` is exploded to one record per player row
 * (`external_record_id` = `matchId|teamId|playerId`, §5.2), each carrying
 * its OWN narrowed raw entry as `payload` (the parallel `observation[i]` /
 * `records[i]` arrays `emitAflApiPlayerMatchStats` already returns in the
 * same order) rather than the whole-match observation array, matching the
 * registry's per-player `scope_key`/`external_record_id` grain.
 */
export function buildAflApiSettleRecords(
  bundle: AflApiMatchBundle,
  fixtureRaw: unknown, rosterRaw: unknown, playerStatsRaw: unknown,
  registry: SourceFamilyRegistry,
): readonly AflApiSettleRecord[] {
  const matchColumns = flattenObservedColumns(fixtureRaw);
  const { observation: rosterPayload, observedColumns: rosterColumns } =
    emitAflApiMatchRoster(rosterRaw, registry, bundle.match.sourceRecordId);
  const { records: statsRecords, observation: statsPayloads, observedColumns: statsColumns } =
    emitAflApiPlayerMatchStats(playerStatsRaw, registry, bundle.match.sourceRecordId);
  const statsPayloadList = statsPayloads as readonly unknown[];

  const seasonScope = `season=${bundle.match.season}`;
  const matchScope = `${seasonScope};match=${bundle.match.sourceRecordId}`;
  const rosterOrMatchDeferral = bundle.matchDeferral ?? bundle.rosterDeferral;

  const records: AflApiSettleRecord[] = [
    assertSettleRecordExclusivity({
      family: 'match',
      scopeKey: seasonScope,
      externalRecordId: bundle.match.sourceRecordId,
      payload: fixtureRaw,
      observedColumns: matchColumns,
      projection: bundle.matchDeferral ? null : bundle.match,
      rejection: null,
      deferral: bundle.matchDeferral,
    }),
    assertSettleRecordExclusivity({
      family: 'match_roster',
      scopeKey: matchScope,
      externalRecordId: bundle.roster.providerMatchId,
      payload: rosterPayload,
      observedColumns: rosterColumns,
      projection: rosterOrMatchDeferral ? null : bundle.roster,
      rejection: null,
      deferral: rosterOrMatchDeferral,
    }),
  ];

  statsRecords.forEach((stat, index) => {
    records.push(assertSettleRecordExclusivity({
      family: 'player_match_stats',
      scopeKey: matchScope,
      externalRecordId: `${stat.providerMatchId}|${stat.providerTeamId}|${stat.providerPlayerId}`,
      payload: statsPayloadList[index],
      observedColumns: statsColumns,
      projection: rosterOrMatchDeferral ? null : stat,
      rejection: null,
      deferral: rosterOrMatchDeferral,
    }));
  });

  return records;
}
