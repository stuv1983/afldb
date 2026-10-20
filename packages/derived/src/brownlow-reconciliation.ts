/**
 * AFLDB V2 Stage 4 — pure Brownlow reconciliation (docs/v2/plan.md §3 D7, ADR 0007).
 *
 * The AFL API stays the authoritative source for current seasons. This module reconciles ONE
 * season's evidence and describes the result; it acquires nothing, writes nothing, opens no
 * database and reads no clock. The existing settle (src/lib/acquisition/afl-api-brownlow.ts), its
 * timers and settlement conditions are untouched: the input shapes below mirror that module's own
 * planned unit (`AflApiBrownlowVoteUnit`, `AflApiBrownlowMatchSetPlan`) and the bundle's
 * leaderboard record, but are declared here so this package imports nothing from the writer side.
 *
 * Inputs
 *   (a) the AFL API round votes, one record per match, each vote carrying its RESOLVED stable
 *       player id (`playerId`, null = unresolved) and provider ids;
 *   (b) the AFL API leaderboard, when present;
 *   (c) the stored authoritative season totals (`brownlow_season_votes` shape), when present;
 *   (d) the match / round / club context (which clubs played which match in which round);
 *   (e) the season state and a caller-supplied `generatedAt`.
 *
 * Whole-set refusal. An unresolved player (or match) refuses the WHOLE season: nothing is totalled,
 * compared or determined — the same discipline as the settle's own `planAflApiBrownlowMatchSet`
 * ("ANY player refusal refuses the whole set"), widened here to the season because a season total
 * built around an unidentified vote-getter is silently wrong. The vote-set STRUCTURE findings,
 * which need no identity, are still reported.
 *
 * Missing is not zero. A player present on one side only is reported as such; an absent total is
 * never read as 0 (the single exception is explicit: a leaderboard row whose own published total
 * is 0 agrees with "no round votes", because the round-vote list is sparse by construction).
 * Player identity is by stable id, never by name; no name appears in any input or output.
 *
 * Raw votes and the award-result presentation are kept in separate report sections. The module
 * never states a "winner". See `eligibilityRule` for the one place the repository's recorded
 * convention can be selected, and only explicitly.
 */
import {
  BROWNLOW_FINDING_CODES,
  BROWNLOW_RECONCILIATION_REPORT_FORMAT,
  BROWNLOW_RECONCILIATION_REPORT_VERSION,
  BROWNLOW_SEASON_STATES,
  BROWNLOW_ELIGIBILITY_RULES,
  brownlowCodeUnitCompare,
  compareBrownlowFindings,
  compareBrownlowTotals,
  isBrownlowIsoInstant,
  type BrownlowAwardLeader,
  type BrownlowAwardStatus,
  type BrownlowComparisonState,
  type BrownlowComparisonSummary,
  type BrownlowEligibilityRule,
  type BrownlowEvidenceBasis,
  type BrownlowFinding,
  type BrownlowFindingCode,
  type BrownlowFindingDetail,
  type BrownlowOutcome,
  type BrownlowPlayerTotal,
  type BrownlowReconciliationReport,
  type BrownlowReportMatch,
  type BrownlowReportVote,
  type BrownlowSeasonState,
} from './brownlow-reconciliation-report';

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export interface BrownlowVoteInput {
  providerPlayerId: string;
  providerTeamId: string;
  /** The RESOLVED stable player id; null means the provider player is unresolved. */
  playerId: number | null;
  /** The resolved club id, or null when club identity is not resolved (the settle writes NULL today). */
  clubId: number | null;
  votes: number;
  /** The provider's explicit flag; null = absent, null or not a boolean in the source (UNKNOWN, never false). */
  eligible: boolean | null;
}

export interface BrownlowMatchVotesInput {
  providerMatchId: string;
  /** The resolved canonical match id; null means the provider match is unresolved. */
  matchId: number | null;
  apiRoundNumber: number;
  /** The resolved canonical match's own round (never the provider's translated round). */
  canonicalRoundNumber: number | null;
  votes: readonly BrownlowVoteInput[];
}

export interface BrownlowLeaderboardEntryInput {
  providerPlayerId: string;
  providerTeamId: string;
  playerId: number | null;
  /** The leaderboard's own season total (the feed's `totalVotes`). */
  totalVotes: number;
  /** The provider's explicit flag; null = absent, null or not a boolean in the source (UNKNOWN, never false). */
  eligible: boolean | null;
  winner: boolean;
  leader: boolean;
}

export interface BrownlowLeaderboardInput {
  /** The feed's status string (e.g. IN_PROGRESS, CONCLUDED); null when not recorded. */
  status: string | null;
  entries: readonly BrownlowLeaderboardEntryInput[];
}

/** One `brownlow_season_votes` row (migrations 005 / 015). */
export interface BrownlowStoredTotalInput {
  playerId: number;
  clubId: number | null;
  votes: number;
  voteRank: number | null;
  eligibleRank: number | null;
  isIneligible: boolean;
  isWinner: boolean;
}

/** Which clubs played one match, in which season and round. */
export interface BrownlowMatchContextInput {
  matchId: number;
  season: number;
  roundNumber: number | null;
  isFinal: boolean;
  homeClubId: number | null;
  awayClubId: number | null;
  homeProviderTeamId: string | null;
  awayProviderTeamId: string | null;
}

export interface BrownlowReconciliationInput {
  season: number;
  seasonState: BrownlowSeasonState;
  /** Caller-supplied ISO-8601 UTC instant. Never read from a clock here. */
  generatedAt: string;
  /** Defaults to `unrecorded`: any ineligible vote-getter refuses the leader determination. */
  eligibilityRule?: BrownlowEligibilityRule;
  matchVotes: readonly BrownlowMatchVotesInput[];
  leaderboard: BrownlowLeaderboardInput | null;
  storedTotals: readonly BrownlowStoredTotalInput[] | null;
  matchContext: readonly BrownlowMatchContextInput[];
}

/* ------------------------------------------------------------------ *
 * Schema validation of the input
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isPositiveIntOrNull(value: unknown): boolean {
  return value === null || (isInt(value) && value > 0);
}

function isIntOrNull(value: unknown): boolean {
  return value === null || isInt(value);
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

const MAX_SCHEMA_PROBLEMS_REPORTED = 20;

/** Every schema problem in `input`, sorted; an empty array means the input is well formed. */
export function validateBrownlowReconciliationInput(input: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ['input must be an object.'];

  if (!isInt(input.season)) problems.push('season must be an integer.');
  if (!(typeof input.seasonState === 'string' && (BROWNLOW_SEASON_STATES as readonly string[]).includes(input.seasonState))) {
    problems.push(`seasonState must be one of ${BROWNLOW_SEASON_STATES.join(', ')}.`);
  }
  if (!isBrownlowIsoInstant(input.generatedAt)) problems.push('generatedAt must be an ISO-8601 UTC instant.');
  if (input.eligibilityRule !== undefined
    && !(typeof input.eligibilityRule === 'string'
      && (BROWNLOW_ELIGIBILITY_RULES as readonly string[]).includes(input.eligibilityRule))) {
    problems.push(`eligibilityRule must be one of ${BROWNLOW_ELIGIBILITY_RULES.join(', ')}.`);
  }

  if (!Array.isArray(input.matchVotes)) problems.push('matchVotes must be an array.');
  else {
    input.matchVotes.forEach((match: unknown, i) => {
      const path = `matchVotes[${i}]`;
      if (!isRecord(match)) {
        problems.push(`${path} must be an object.`);
        return;
      }
      if (!isNonEmptyString(match.providerMatchId)) problems.push(`${path}.providerMatchId must be a non-empty string.`);
      if (!isPositiveIntOrNull(match.matchId)) problems.push(`${path}.matchId must be a positive integer or null.`);
      if (!isInt(match.apiRoundNumber)) problems.push(`${path}.apiRoundNumber must be an integer.`);
      if (!isIntOrNull(match.canonicalRoundNumber)) problems.push(`${path}.canonicalRoundNumber must be an integer or null.`);
      if (!Array.isArray(match.votes)) problems.push(`${path}.votes must be an array.`);
      else {
        match.votes.forEach((vote: unknown, j) => {
          const votePath = `${path}.votes[${j}]`;
          if (!isRecord(vote)) {
            problems.push(`${votePath} must be an object.`);
            return;
          }
          if (!isNonEmptyString(vote.providerPlayerId)) problems.push(`${votePath}.providerPlayerId must be a non-empty string.`);
          if (typeof vote.providerTeamId !== 'string') problems.push(`${votePath}.providerTeamId must be a string.`);
          if (!isPositiveIntOrNull(vote.playerId)) problems.push(`${votePath}.playerId must be a positive integer or null.`);
          if (!isPositiveIntOrNull(vote.clubId)) problems.push(`${votePath}.clubId must be a positive integer or null.`);
          if (!isInt(vote.votes)) problems.push(`${votePath}.votes must be an integer.`);
          if (vote.eligible !== null && typeof vote.eligible !== 'boolean') problems.push(`${votePath}.eligible must be a boolean or null.`);
        });
      }
    });
  }

  if (input.leaderboard !== null) {
    const board = input.leaderboard;
    if (!isRecord(board)) problems.push('leaderboard must be an object or null.');
    else {
      if (!isStringOrNull(board.status)) problems.push('leaderboard.status must be a string or null.');
      if (!Array.isArray(board.entries)) problems.push('leaderboard.entries must be an array.');
      else {
        board.entries.forEach((entry: unknown, i) => {
          const path = `leaderboard.entries[${i}]`;
          if (!isRecord(entry)) {
            problems.push(`${path} must be an object.`);
            return;
          }
          if (!isNonEmptyString(entry.providerPlayerId)) problems.push(`${path}.providerPlayerId must be a non-empty string.`);
          if (typeof entry.providerTeamId !== 'string') problems.push(`${path}.providerTeamId must be a string.`);
          if (!isPositiveIntOrNull(entry.playerId)) problems.push(`${path}.playerId must be a positive integer or null.`);
          if (!(isInt(entry.totalVotes) && entry.totalVotes >= 0)) problems.push(`${path}.totalVotes must be a non-negative integer.`);
          for (const key of ['winner', 'leader'] as const) {
            if (typeof entry[key] !== 'boolean') problems.push(`${path}.${key} must be a boolean.`);
          }
          if (entry.eligible !== null && typeof entry.eligible !== 'boolean') problems.push(`${path}.eligible must be a boolean or null.`);
        });
      }
    }
  }

  if (input.storedTotals !== null) {
    if (!Array.isArray(input.storedTotals)) problems.push('storedTotals must be an array or null.');
    else {
      const seen = new Set<unknown>();
      input.storedTotals.forEach((row: unknown, i) => {
        const path = `storedTotals[${i}]`;
        if (!isRecord(row)) {
          problems.push(`${path} must be an object.`);
          return;
        }
        if (!(isInt(row.playerId) && row.playerId > 0)) problems.push(`${path}.playerId must be a positive integer.`);
        else if (seen.has(row.playerId)) problems.push(`${path}: player ${row.playerId} appears twice (one row per season and player).`);
        else seen.add(row.playerId);
        if (!isPositiveIntOrNull(row.clubId)) problems.push(`${path}.clubId must be a positive integer or null.`);
        if (!(isInt(row.votes) && row.votes >= 0)) problems.push(`${path}.votes must be a non-negative integer.`);
        if (!isIntOrNull(row.voteRank)) problems.push(`${path}.voteRank must be an integer or null.`);
        if (!isIntOrNull(row.eligibleRank)) problems.push(`${path}.eligibleRank must be an integer or null.`);
        if (typeof row.isIneligible !== 'boolean') problems.push(`${path}.isIneligible must be a boolean.`);
        if (typeof row.isWinner !== 'boolean') problems.push(`${path}.isWinner must be a boolean.`);
      });
    }
  }

  if (!Array.isArray(input.matchContext)) problems.push('matchContext must be an array.');
  else {
    const seen = new Set<unknown>();
    input.matchContext.forEach((ctx: unknown, i) => {
      const path = `matchContext[${i}]`;
      if (!isRecord(ctx)) {
        problems.push(`${path} must be an object.`);
        return;
      }
      if (!(isInt(ctx.matchId) && ctx.matchId > 0)) problems.push(`${path}.matchId must be a positive integer.`);
      else if (seen.has(ctx.matchId)) problems.push(`${path}: match ${ctx.matchId} appears twice.`);
      else seen.add(ctx.matchId);
      if (!isInt(ctx.season)) problems.push(`${path}.season must be an integer.`);
      if (!isIntOrNull(ctx.roundNumber)) problems.push(`${path}.roundNumber must be an integer or null.`);
      if (typeof ctx.isFinal !== 'boolean') problems.push(`${path}.isFinal must be a boolean.`);
      if (!isPositiveIntOrNull(ctx.homeClubId)) problems.push(`${path}.homeClubId must be a positive integer or null.`);
      if (!isPositiveIntOrNull(ctx.awayClubId)) problems.push(`${path}.awayClubId must be a positive integer or null.`);
      if (!isStringOrNull(ctx.homeProviderTeamId)) problems.push(`${path}.homeProviderTeamId must be a string or null.`);
      if (!isStringOrNull(ctx.awayProviderTeamId)) problems.push(`${path}.awayProviderTeamId must be a string or null.`);
    });
  }

  return [...new Set(problems)].sort(brownlowCodeUnitCompare);
}

/* ------------------------------------------------------------------ *
 * Report notes (constant, so equal reports stay byte-identical)
 * ------------------------------------------------------------------ */

const AWARD_NOTES: Record<BrownlowAwardStatus, string> = {
  determined: 'Leaders are the highest total on the stated basis, under the stated eligibility rule; '
    + 'tied leaders are joint. No winner is stated.',
  season_incomplete: 'The season is incomplete: no winner or leader of record is stated.',
  no_vote_evidence: 'No vote evidence was supplied, so nothing can be stated.',
  refused_whole_set: 'The evidence was refused as a whole (see the refusal findings); no total, comparison '
    + 'or determination was produced.',
  refused_unreconciled_evidence: 'The vote evidence has discrepancies; no leader of record is stated until they '
    + 'are resolved. Raw votes are reported unchanged.',
  refused_eligibility_rule_unrecorded: 'An ineligible player polled votes and no eligibility rule was selected for '
    + 'this determination. The repository records only the stored-table convention '
    + '(src/lib/brownlow/entry.ts:664-679), measured on AFL Tables history; no rule for API-sourced or '
    + 'retrospective results is recorded. No leader is stated; raw votes are reported unchanged.',
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const VALID_VOTE_VALUES: readonly number[] = [3, 2, 1];

/** Total order for a tri-state flag: false < true < unknown (null). */
function triOrder(flag: boolean | null): number {
  return flag === null ? 2 : Number(flag);
}

function compareVotes(a: BrownlowReportVote, b: BrownlowReportVote): number {
  return b.votes - a.votes
    || brownlowCodeUnitCompare(a.providerPlayerId, b.providerPlayerId)
    || brownlowCodeUnitCompare(a.providerTeamId, b.providerTeamId)
    || (a.playerId ?? -1) - (b.playerId ?? -1)
    || (a.clubId ?? -1) - (b.clubId ?? -1)
    || triOrder(a.eligible) - triOrder(b.eligible);
}

function compareMatches(a: BrownlowReportMatch, b: BrownlowReportMatch): number {
  return brownlowCodeUnitCompare(a.providerMatchId, b.providerMatchId)
    || (a.matchId ?? -1) - (b.matchId ?? -1)
    || a.apiRoundNumber - b.apiRoundNumber
    || (a.canonicalRoundNumber ?? -1) - (b.canonicalRoundNumber ?? -1)
    || brownlowCodeUnitCompare(JSON.stringify(a.votes), JSON.stringify(b.votes));
}

function sortedRecord(source: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(source).sort(brownlowCodeUnitCompare)) out[key] = source[key];
  return out;
}

/** Competition ranking (1, 2, 2, 4) over a descending list of totals (src/lib/brownlow/entry.ts:680). */
function competitionRanks(sortedDescending: readonly number[]): number[] {
  const ranks: number[] = [];
  let current = 0;
  let previous: number | null = null;
  sortedDescending.forEach((value, index) => {
    if (previous === null || value !== previous) {
      current = index + 1;
      previous = value;
    }
    ranks.push(current);
  });
  return ranks;
}

function ascending(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

const NOT_RUN: BrownlowComparisonSummary = { state: 'not_run', compared: 0, mismatches: 0 };

function idleComparison(supplied: boolean, state: BrownlowComparisonState): BrownlowComparisonSummary {
  return { state: supplied ? state : 'not_supplied', compared: 0, mismatches: 0 };
}

/* ------------------------------------------------------------------ *
 * Reconcile
 * ------------------------------------------------------------------ */

/**
 * Reconcile one season and return the report. Pure and deterministic: the same evidence in any
 * order yields a byte-identical serialisation. Throws a RangeError only when `season` or
 * `generatedAt` is unusable, because without them no well-formed report can be identified;
 * every other malformed input becomes an `input_schema_invalid` whole-set refusal.
 */
export function reconcileBrownlowSeason(input: BrownlowReconciliationInput): BrownlowReconciliationReport {
  const envelope: Record<string, unknown> = isRecord(input) ? input : {};
  if (!isInt(envelope.season)) throw new RangeError('reconcileBrownlowSeason: season must be an integer.');
  if (!isBrownlowIsoInstant(envelope.generatedAt)) {
    throw new RangeError('reconcileBrownlowSeason: generatedAt must be an ISO-8601 UTC instant supplied by the caller.');
  }
  const season = envelope.season;
  const generatedAt = envelope.generatedAt;

  const problems = validateBrownlowReconciliationInput(input);
  const seasonState: BrownlowSeasonState = envelope.seasonState === 'complete' ? 'complete' : 'in_progress';
  const eligibilityRule: BrownlowEligibilityRule = envelope.eligibilityRule === 'stored_eligible_rank_one'
    ? 'stored_eligible_rank_one'
    : 'unrecorded';

  const findings: BrownlowFinding[] = [];
  const add = (
    code: BrownlowFindingCode,
    fields: {
      providerMatchId?: string | null;
      playerId?: number | null;
      providerPlayerId?: string | null;
      detail?: BrownlowFindingDetail;
    } = {},
  ): void => {
    findings.push({
      code,
      severity: BROWNLOW_FINDING_CODES[code],
      providerMatchId: fields.providerMatchId ?? null,
      playerId: fields.playerId ?? null,
      providerPlayerId: fields.providerPlayerId ?? null,
      detail: fields.detail ?? {},
    });
  };

  const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  const evidenceOf = (leaderboardEntries: number | null, storedRows: number | null, matchVoteRecords: number,
    contextMatches: number) => ({ matchVoteRecords, leaderboardEntries, storedRows, contextMatches });

  /* ---- 0. Schema: a malformed input is refused whole, before anything is read from it. ---- */
  if (problems.length > 0) {
    add('input_schema_invalid', {
      detail: {
        problemCount: problems.length,
        problems: problems.slice(0, MAX_SCHEMA_PROBLEMS_REPORTED).join(' | '),
      },
    });
    const board = envelope.leaderboard;
    return assemble({
      season, seasonState, generatedAt, eligibilityRule,
      leaderboardStatus: null,
      evidence: evidenceOf(
        isRecord(board) && Array.isArray(board.entries) ? board.entries.length : null,
        Array.isArray(envelope.storedTotals) ? envelope.storedTotals.length : null,
        lengthOf(envelope.matchVotes),
        lengthOf(envelope.matchContext),
      ),
      findings, matches: [], basis: null, totals: [], topVoteGetters: [],
      comparisons: { leaderboard: NOT_RUN, stored: NOT_RUN, storedInternal: NOT_RUN },
      award: refusedAward('refused_whole_set', 'whole_set_refused'),
      claims: { leaderboardWinners: null, leaderboardLeaders: null, storedWinners: null },
    });
  }

  /* ---- 1. Normalise (copy, sort) so that supplied order can never matter. ---- */
  const matches: BrownlowReportMatch[] = input.matchVotes
    .map((match) => ({
      providerMatchId: match.providerMatchId,
      matchId: match.matchId,
      apiRoundNumber: match.apiRoundNumber,
      canonicalRoundNumber: match.canonicalRoundNumber,
      votes: match.votes
        .map((vote): BrownlowReportVote => ({
          providerPlayerId: vote.providerPlayerId,
          providerTeamId: vote.providerTeamId,
          playerId: vote.playerId,
          clubId: vote.clubId,
          votes: vote.votes,
          eligible: vote.eligible,
        }))
        .sort(compareVotes),
    }))
    .sort(compareMatches);
  const leaderboardEntries = input.leaderboard === null
    ? null
    : [...input.leaderboard.entries].sort((a, b) => (a.playerId ?? 0) - (b.playerId ?? 0)
      || brownlowCodeUnitCompare(a.providerPlayerId, b.providerPlayerId)
      || a.totalVotes - b.totalVotes
      || brownlowCodeUnitCompare(a.providerTeamId, b.providerTeamId)
      || triOrder(a.eligible) - triOrder(b.eligible)
      || Number(a.winner) - Number(b.winner)
      || Number(a.leader) - Number(b.leader));
  const storedRows = input.storedTotals === null
    ? null
    : [...input.storedTotals].sort((a, b) => a.playerId - b.playerId);
  const evidence = evidenceOf(
    leaderboardEntries === null ? null : leaderboardEntries.length,
    storedRows === null ? null : storedRows.length,
    matches.length,
    input.matchContext.length,
  );
  const leaderboardStatus = input.leaderboard === null ? null : input.leaderboard.status;

  /* ---- 2. Vote-set structure (needs no identity, so it is reported even when refused). ---- */
  const recordsPerMatch = new Map<string, number>();
  for (const match of matches) recordsPerMatch.set(match.providerMatchId, (recordsPerMatch.get(match.providerMatchId) ?? 0) + 1);
  for (const [providerMatchId, records] of recordsPerMatch) {
    if (records > 1) add('duplicate_match_vote_record', { providerMatchId, detail: { records } });
  }
  for (const match of matches) {
    const { providerMatchId } = match;
    if (match.votes.length > 3) add('too_many_vote_getters_in_match', { providerMatchId, detail: { voteGetters: match.votes.length } });
    if (match.votes.length < 3) add('too_few_vote_getters_in_match', { providerMatchId, detail: { voteGetters: match.votes.length } });
    const valueCounts = new Map<number, number>();
    const providerCounts = new Map<string, number>();
    for (const vote of match.votes) {
      if (!VALID_VOTE_VALUES.includes(vote.votes)) {
        add('invalid_vote_value', {
          providerMatchId, playerId: vote.playerId, providerPlayerId: vote.providerPlayerId, detail: { votes: vote.votes },
        });
      }
      valueCounts.set(vote.votes, (valueCounts.get(vote.votes) ?? 0) + 1);
      providerCounts.set(vote.providerPlayerId, (providerCounts.get(vote.providerPlayerId) ?? 0) + 1);
    }
    for (const [votes, count] of valueCounts) {
      if (count > 1) add('duplicate_vote_value_in_match', { providerMatchId, detail: { votes, count } });
    }
    for (const [providerPlayerId, count] of providerCounts) {
      if (count > 1) {
        add('duplicate_player_in_match', { providerMatchId, providerPlayerId, detail: { count, identity: 'provider_player_id' } });
      }
    }
  }

  /* ---- 3. Whole-set refusal: any unresolved match or player refuses the season. ---- */
  for (const match of matches) {
    if (match.matchId === null) add('unresolved_match_identity', { providerMatchId: match.providerMatchId });
    for (const vote of match.votes) {
      if (vote.playerId === null) {
        add('unresolved_player_identity', {
          providerMatchId: match.providerMatchId, providerPlayerId: vote.providerPlayerId,
          detail: { source: 'round_votes' },
        });
      }
    }
  }
  for (const entry of leaderboardEntries ?? []) {
    if (entry.playerId === null) {
      add('unresolved_player_identity', { providerPlayerId: entry.providerPlayerId, detail: { source: 'leaderboard' } });
    }
  }
  if (findings.some((f) => f.severity === 'refusal')) {
    return assemble({
      season, seasonState, generatedAt, eligibilityRule, leaderboardStatus, evidence,
      findings, matches, basis: null, totals: [], topVoteGetters: [],
      comparisons: {
        leaderboard: idleComparison(leaderboardEntries !== null, 'not_run'),
        stored: idleComparison(storedRows !== null, 'not_run'),
        storedInternal: idleComparison(storedRows !== null, 'not_run'),
      },
      award: refusedAward('refused_whole_set', 'whole_set_refused'),
      claims: { leaderboardWinners: null, leaderboardLeaders: null, storedWinners: null },
    });
  }

  /* ---- 4. Canonical-identity duplicates, then round / match / club consistency. ---- */
  const contextById = new Map(input.matchContext.map((ctx) => [ctx.matchId, ctx]));
  const votedMatchIds = new Set<number>();
  for (const match of matches) {
    const { providerMatchId } = match;
    const byPlayer = new Map<number, Set<string>>();
    for (const vote of match.votes) {
      const set = byPlayer.get(vote.playerId as number) ?? new Set<string>();
      set.add(vote.providerPlayerId);
      byPlayer.set(vote.playerId as number, set);
    }
    for (const [playerId, providers] of byPlayer) {
      if (providers.size > 1) {
        add('duplicate_player_in_match', {
          providerMatchId, playerId, detail: { count: providers.size, identity: 'canonical_player_id' },
        });
      }
    }

    const matchId = match.matchId as number;
    votedMatchIds.add(matchId);
    const ctx = contextById.get(matchId);
    if (ctx === undefined) {
      add('match_not_in_context', { providerMatchId, detail: { matchId } });
      continue;
    }
    if (ctx.season !== season) add('match_wrong_season', { providerMatchId, detail: { matchId, contextSeason: ctx.season, season } });
    if (ctx.isFinal) add('match_is_final', { providerMatchId, detail: { matchId } });
    if (ctx.roundNumber !== match.canonicalRoundNumber) {
      add('round_mismatch', {
        providerMatchId, detail: { matchId, voteRound: match.canonicalRoundNumber, contextRound: ctx.roundNumber },
      });
    }
    let unverifiable = 0;
    for (const vote of match.votes) {
      let played: boolean | null = null;
      if (vote.clubId !== null && ctx.homeClubId !== null && ctx.awayClubId !== null) {
        played = vote.clubId === ctx.homeClubId || vote.clubId === ctx.awayClubId;
      } else if (ctx.homeProviderTeamId !== null && ctx.awayProviderTeamId !== null) {
        played = vote.providerTeamId === ctx.homeProviderTeamId || vote.providerTeamId === ctx.awayProviderTeamId;
      }
      if (played === null) unverifiable += 1;
      else if (!played) {
        add('vote_club_not_in_match', {
          providerMatchId, playerId: vote.playerId, providerPlayerId: vote.providerPlayerId,
          detail: { matchId, clubId: vote.clubId, providerTeamId: vote.providerTeamId },
        });
      }
    }
    if (unverifiable > 0) add('club_unverifiable', { providerMatchId, detail: { matchId, votes: unverifiable } });
  }
  if (seasonState === 'complete') {
    for (const ctx of [...input.matchContext].sort((a, b) => a.matchId - b.matchId)) {
      if (ctx.season === season && !ctx.isFinal && !votedMatchIds.has(ctx.matchId)) {
        add('match_without_votes', { detail: { matchId: ctx.matchId, round: ctx.roundNumber } });
      }
    }
  }

  /* ---- 5. Totals from the API round votes, and eligibility evidence. ---- */
  type ApiTotal = { votes: number; matches: number; flags: Set<boolean>; unknown: number };
  const apiTotals = new Map<number, ApiTotal>();
  for (const match of matches) {
    for (const vote of match.votes) {
      const id = vote.playerId as number;
      const total = apiTotals.get(id) ?? { votes: 0, matches: 0, flags: new Set<boolean>(), unknown: 0 };
      total.votes += vote.votes;
      total.matches += 1;
      // BP-2025-ELIGIBILITY-v1: a missing/null/malformed provider flag is UNKNOWN. It is counted apart and
      // never folded into either boolean.
      if (vote.eligible === null) total.unknown += 1;
      else total.flags.add(vote.eligible);
      apiTotals.set(id, total);
    }
  }
  const ineligible = new Set<number>();
  /** Players whose provider eligibility evidence is incomplete: UNKNOWN, neither ineligible nor eligible. */
  const unknownEligibility = new Set<number>();
  for (const [playerId, total] of apiTotals) {
    if (total.flags.size > 1) add('eligibility_flag_inconsistent', { playerId, detail: { source: 'round_votes' } });
    if (total.unknown > 0) {
      add('eligibility_provider_unknown', { playerId, detail: { source: 'round_votes', unknownRecords: total.unknown, explicitRecords: total.matches - total.unknown } });
      unknownEligibility.add(playerId);
    }
    if (total.flags.has(false)) ineligible.add(playerId);
  }

  /* ---- 6. API round votes versus the API leaderboard. ---- */
  let leaderboardComparison = idleComparison(leaderboardEntries !== null, 'compared');
  const leaderboardById = new Map<number, BrownlowLeaderboardEntryInput>();
  if (leaderboardEntries !== null) {
    const before = findings.length;
    const counts = new Map<number, number>();
    for (const entry of leaderboardEntries) {
      const id = entry.playerId as number;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!leaderboardById.has(id)) leaderboardById.set(id, entry);
      if (entry.eligible === false) ineligible.add(id);
      else if (entry.eligible === null) {
        add('eligibility_provider_unknown', { playerId: id, providerPlayerId: entry.providerPlayerId, detail: { source: 'leaderboard', unknownRecords: 1, explicitRecords: 0 } });
        unknownEligibility.add(id);
      }
    }
    for (const [playerId, count] of counts) {
      if (count > 1) add('duplicate_leaderboard_entry', { playerId, detail: { entries: count } });
    }
    const concluded = leaderboardStatus === 'CONCLUDED';
    for (const [playerId, entry] of leaderboardById) {
      const api = apiTotals.get(playerId);
      if (api === undefined) {
        // The round-vote list is sparse by construction; a published total of 0 agrees with "no round votes".
        if (entry.totalVotes > 0) {
          add('leaderboard_only_player', { playerId, providerPlayerId: entry.providerPlayerId, detail: { leaderboardTotal: entry.totalVotes } });
        }
        continue;
      }
      if (api.votes !== entry.totalVotes) {
        add('leaderboard_total_mismatch', {
          playerId, providerPlayerId: entry.providerPlayerId,
          detail: { roundVotesTotal: api.votes, leaderboardTotal: entry.totalVotes, leaderboardConcluded: concluded },
        });
      }
      if (entry.eligible !== null && api.flags.size === 1 && !api.flags.has(entry.eligible)) {
        add('eligibility_flag_inconsistent', {
          playerId, detail: { source: 'leaderboard', roundVotesEligible: api.flags.has(true), leaderboardEligible: entry.eligible },
        });
      }
    }
    for (const [playerId, api] of apiTotals) {
      if (!leaderboardById.has(playerId)) add('round_votes_only_player', { playerId, detail: { roundVotesTotal: api.votes } });
    }
    leaderboardComparison = {
      state: 'compared',
      compared: new Set([...leaderboardById.keys(), ...apiTotals.keys()]).size,
      mismatches: findings.length - before,
    };
  }

  /* ---- 7. API round votes versus the stored authoritative totals; stored against itself. ---- */
  let storedComparison = idleComparison(storedRows !== null, 'compared');
  let storedInternal = idleComparison(storedRows !== null, 'compared');
  const storedWinners: number[] | null = storedRows === null ? null : ascending(storedRows.filter((r) => r.isWinner).map((r) => r.playerId));
  if (storedRows !== null) {
    for (const row of storedRows) if (row.isIneligible) ineligible.add(row.playerId);

    // Stored internal consistency: ranks and winner flags against the recorded convention.
    {
      const before = findings.length;
      const ordered = [...storedRows].sort(compareBrownlowTotals);
      const overall = competitionRanks(ordered.map((r) => r.votes));
      const eligibleOrdered = ordered.filter((r) => !r.isIneligible);
      const eligibleRanks = competitionRanks(eligibleOrdered.map((r) => r.votes));
      const eligibleRankById = new Map(eligibleOrdered.map((r, i) => [r.playerId, eligibleRanks[i]]));
      ordered.forEach((row, i) => {
        const expectedEligible = row.isIneligible ? null : eligibleRankById.get(row.playerId) ?? null;
        // A NULL vote_rank is "not recorded", not a rank; a NULL eligible_rank is a statement (ineligible).
        if (row.voteRank !== null && row.voteRank !== overall[i]) {
          add('stored_rank_inconsistent', { playerId: row.playerId, detail: { field: 'vote_rank', stored: row.voteRank, expected: overall[i] } });
        }
        if (row.eligibleRank !== expectedEligible) {
          add('stored_rank_inconsistent', { playerId: row.playerId, detail: { field: 'eligible_rank', stored: row.eligibleRank, expected: expectedEligible } });
        }
        const expectedWinner = !row.isIneligible && expectedEligible === 1;
        if (row.isWinner !== expectedWinner) {
          add('stored_winner_flag_inconsistent', { playerId: row.playerId, detail: { stored: row.isWinner, expected: expectedWinner } });
        }
      });
      storedInternal = { state: 'compared', compared: storedRows.length, mismatches: findings.length - before };
    }

    if (seasonState === 'in_progress') {
      storedComparison = idleComparison(true, 'skipped_season_incomplete');
    } else if (matches.length === 0) {
      storedComparison = idleComparison(true, 'not_run');
    } else {
      const before = findings.length;
      const storedById = new Map(storedRows.map((r) => [r.playerId, r]));
      for (const [playerId, api] of apiTotals) {
        const stored = storedById.get(playerId);
        if (stored === undefined) {
          add('api_only_player', { playerId, detail: { apiTotal: api.votes } });
          continue;
        }
        if (stored.votes !== api.votes) add('stored_total_mismatch', { playerId, detail: { apiTotal: api.votes, storedTotal: stored.votes } });
        if (api.flags.size === 1 && api.flags.has(true) === stored.isIneligible) {
          add('eligibility_flag_inconsistent', {
            playerId, detail: { source: 'stored', apiEligible: api.flags.has(true), storedEligible: !stored.isIneligible },
          });
        }
      }
      for (const row of storedRows) {
        if (!apiTotals.has(row.playerId)) add('stored_only_player', { playerId: row.playerId, detail: { storedTotal: row.votes } });
      }
      storedComparison = {
        state: 'compared',
        compared: new Set([...storedById.keys(), ...apiTotals.keys()]).size,
        mismatches: findings.length - before,
      };
    }
  }

  /* ---- 8. The evidence the raw section reports totals from. ---- */
  // Unknown provider evidence wins over any boolean: an incomplete record is never read as eligible or ineligible.
  const foldedEligibility = (playerId: number): boolean | null =>
    unknownEligibility.has(playerId) ? null : !ineligible.has(playerId);
  let basis: BrownlowEvidenceBasis | null = null;
  let totals: BrownlowPlayerTotal[] = [];
  if (matches.length > 0) {
    basis = 'api_round_votes';
    totals = [...apiTotals].map(([playerId, t]) => ({ playerId, votes: t.votes, matchesPolled: t.matches, eligible: foldedEligibility(playerId) }));
  } else if (leaderboardEntries !== null && leaderboardEntries.length > 0) {
    basis = 'api_leaderboard';
    totals = [...leaderboardById]
      .filter(([, e]) => e.totalVotes > 0)
      .map(([playerId, e]) => ({ playerId, votes: e.totalVotes, matchesPolled: null, eligible: foldedEligibility(playerId) }));
  } else if (storedRows !== null && storedRows.length > 0) {
    basis = 'stored_totals';
    totals = storedRows
      .filter((r) => r.votes > 0)
      .map((r) => ({ playerId: r.playerId, votes: r.votes, matchesPolled: null, eligible: foldedEligibility(r.playerId) }));
  }
  totals.sort(compareBrownlowTotals);
  const topVotes = totals.length > 0 ? totals[0].votes : null;
  const topVoteGetters = topVotes === null
    ? []
    : totals.filter((t) => t.votes === topVotes).map((t) => ({ playerId: t.playerId, votes: t.votes, eligible: t.eligible }));

  const claims = {
    leaderboardWinners: leaderboardEntries === null ? null : ascending(leaderboardEntries.filter((e) => e.winner).map((e) => e.playerId as number)),
    leaderboardLeaders: leaderboardEntries === null ? null : ascending(leaderboardEntries.filter((e) => e.leader).map((e) => e.playerId as number)),
    storedWinners,
  };

  /* ---- 9. The award-result presentation (never reads provider or stored claims). ---- */
  const hasDiscrepancy = findings.some((f) => f.severity === 'discrepancy');
  const ineligibleVoteGetters = totals.filter((t) => t.eligible === false);
  let award: AwardDraft;
  if (seasonState === 'in_progress') {
    award = { status: 'season_incomplete', refusalCode: null, leaders: [], tie: null };
  } else if (totals.length === 0) {
    award = { status: 'no_vote_evidence', refusalCode: null, leaders: [], tie: null };
  } else if (ineligibleVoteGetters.length > 0 && eligibilityRule === 'unrecorded') {
    for (const t of ineligibleVoteGetters) add('eligibility_rule_unrecorded', { playerId: t.playerId, detail: { votes: t.votes } });
    award = refusedAward('refused_eligibility_rule_unrecorded', 'eligibility_rule_unrecorded');
  } else if (hasDiscrepancy) {
    award = refusedAward('refused_unreconciled_evidence', 'evidence_unreconciled');
  } else {
    const candidates = eligibilityRule === 'stored_eligible_rank_one' ? totals.filter((t) => t.eligible === true) : totals;
    const best = candidates.length > 0 ? candidates[0].votes : null;
    if (best === null) award = { status: 'no_vote_evidence', refusalCode: null, leaders: [], tie: null };
    else {
      const leaders: BrownlowAwardLeader[] = candidates
        .filter((t) => t.votes === best)
        .map((t) => ({ playerId: t.playerId, votes: t.votes }))
        .sort((a, b) => a.playerId - b.playerId);
      award = { status: 'determined', refusalCode: null, leaders, tie: leaders.length > 1 };
    }
  }

  return assemble({
    season, seasonState, generatedAt, eligibilityRule, leaderboardStatus, evidence,
    findings, matches, basis, totals, topVoteGetters,
    comparisons: { leaderboard: leaderboardComparison, stored: storedComparison, storedInternal },
    award, claims,
  });
}

type AwardDraft = {
  status: BrownlowAwardStatus;
  refusalCode: string | null;
  leaders: BrownlowAwardLeader[];
  tie: boolean | null;
};

function refusedAward(status: BrownlowAwardStatus, refusalCode: string): AwardDraft {
  return { status, refusalCode, leaders: [], tie: null };
}

interface AssembleParts {
  season: number;
  seasonState: BrownlowSeasonState;
  generatedAt: string;
  eligibilityRule: BrownlowEligibilityRule;
  leaderboardStatus: string | null;
  evidence: BrownlowReconciliationReport['source']['evidence'];
  findings: BrownlowFinding[];
  matches: BrownlowReportMatch[];
  basis: BrownlowEvidenceBasis | null;
  totals: BrownlowPlayerTotal[];
  topVoteGetters: BrownlowReconciliationReport['rawVotes']['topVoteGetters'];
  comparisons: BrownlowReconciliationReport['rawVotes']['comparisons'];
  award: AwardDraft;
  claims: BrownlowReconciliationReport['awardResultPresentation']['providerClaims'];
}

function assemble(parts: AssembleParts): BrownlowReconciliationReport {
  const findings = [...parts.findings].sort(compareBrownlowFindings);
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.code] = (counts[finding.code] ?? 0) + 1;
  const outcome: BrownlowOutcome = findings.some((f) => f.severity === 'refusal')
    ? 'refused'
    : findings.some((f) => f.severity === 'discrepancy') ? 'discrepancies' : 'reconciled';
  return {
    format: BROWNLOW_RECONCILIATION_REPORT_FORMAT,
    formatVersion: BROWNLOW_RECONCILIATION_REPORT_VERSION,
    generatedAt: parts.generatedAt,
    source: {
      sourceKey: 'afl_api',
      season: parts.season,
      seasonState: parts.seasonState,
      leaderboardStatus: parts.leaderboardStatus,
      evidence: parts.evidence,
    },
    outcome,
    findings,
    findingCounts: sortedRecord(counts),
    rawVotes: {
      basis: parts.basis,
      matches: parts.matches,
      playerTotals: parts.totals,
      topVoteGetters: parts.topVoteGetters,
      comparisons: parts.comparisons,
    },
    awardResultPresentation: {
      status: parts.award.status,
      refusalCode: parts.award.refusalCode,
      seasonState: parts.seasonState,
      eligibilityRule: parts.eligibilityRule,
      basis: parts.award.status === 'determined' ? parts.basis : null,
      leaders: parts.award.leaders,
      tie: parts.award.tie,
      providerClaims: parts.claims,
      note: AWARD_NOTES[parts.award.status],
    },
  };
}
