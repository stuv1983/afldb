/**
 * AFLDB V2 Launch F (stream F-D) — the eligibility-aware Brownlow Medal determination
 * (docs/v2/adr/0014-brownlow-eligibility.md; builds on the reconciliation of ADR 0007).
 *
 * Owner decision, implemented here exactly: preserve the raw vote leaderboard for every player;
 * exclude a player from the medal-winner determination ONLY when authoritative stored eligibility
 * evidence marks that player ineligible; if the vote leader's eligibility is missing or ambiguous,
 * do not invent a winner and mark the result `requires_review`; an authorised administrator may
 * resolve eligibility through an audited decision; the winner is recomputed deterministically
 * after a decision; ties among eligible leaders are supported; raw votes are never altered.
 *
 * PURE: no I/O, no clock, no database. It takes the reconciliation report (the raw totals and the
 * evidence gating, from `reconcileBrownlowSeason`) plus per-player RAW eligibility evidence, and it
 * NEVER reads `report.rawVotes.playerTotals[].eligible` for a status: that boolean folds the
 * provider flags and the stored flags together, so using it would let a provider proposal decide.
 *
 * AUTHORITATIVE ELIGIBILITY EVIDENCE, per (season, player), in precedence order:
 *   1. the CURRENT administrator decision (`brownlow_eligibility_decisions`, source `admin_decision`);
 *   2. else the season's `brownlow_season_votes` row, but ONLY as a RECORDED statement (source
 *      `stored_season_votes`): `is_ineligible = true` => ineligible; `is_ineligible = false` =>
 *      eligible only when the season is admin-published (`brownlow_season_authority`) or the row
 *      carries a non-NULL `eligible_rank`. `is_ineligible` is NOT NULL DEFAULT false, so a bare
 *      `false` is a default, not a statement; without either corroboration it is NOT recorded;
 *   3. the AFL API staged flag is a provider PROPOSAL: it can make a status `ambiguous` (it
 *      disagrees with a recorded stored statement, or a player's own flags disagree, or the
 *      reconciliation reports `eligibility_flag_inconsistent` for the player) but it never decides
 *      one. With no decision and no recorded stored statement the status is `missing`.
 *
 * MEDAL DETERMINATION. Gating first (pass-through `refused_whole_set`, `season_incomplete`,
 * `no_vote_evidence`, and `refused_unreconciled_evidence` for any `discrepancy` finding other than
 * the two eligibility-evidence findings described at {@link isEligibilityEvidenceFinding}). Then
 * the distinct vote totals are walked in descending order: in the current group, if ANY player is
 * missing or ambiguous the result is `requires_review` and no winner is stated; known-ineligible
 * players are removed; if at least one eligible player remains, ALL of them are the (joint)
 * winners; otherwise the walk continues with the next group; an exhausted walk is
 * `no_eligible_winner`. No tie-break exists.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from './coleman';
import type {
  BrownlowEvidenceBasis,
  BrownlowFinding,
  BrownlowReconciliationReport,
  BrownlowSeasonState,
} from './brownlow-reconciliation-report';

export const BROWNLOW_MEDAL_FORMAT = 'afldb.v2.brownlow-medal-determination';
export const BROWNLOW_MEDAL_FORMAT_VERSION = 1;

export const BROWNLOW_ELIGIBILITY_VERDICTS = ['eligible', 'ineligible'] as const;
export type BrownlowEligibilityVerdict = (typeof BROWNLOW_ELIGIBILITY_VERDICTS)[number];

export const BROWNLOW_ELIGIBILITY_STATUSES = ['eligible', 'ineligible', 'missing', 'ambiguous'] as const;
export type BrownlowEligibilityStatus = (typeof BROWNLOW_ELIGIBILITY_STATUSES)[number];

/** Where a status came from. `none` = no authoritative evidence decided it (missing, or ambiguous without a stored statement). */
export const BROWNLOW_ELIGIBILITY_SOURCES = ['admin_decision', 'stored_season_votes', 'none'] as const;
export type BrownlowEligibilitySource = (typeof BROWNLOW_ELIGIBILITY_SOURCES)[number];

export const BROWNLOW_MEDAL_STATUSES = [
  'refused_whole_set',
  'season_incomplete',
  'no_vote_evidence',
  'refused_unreconciled_evidence',
  'requires_review',
  'determined',
  'no_eligible_winner',
] as const;
export type BrownlowMedalStatus = (typeof BROWNLOW_MEDAL_STATUSES)[number];

/** The most blocking findings a refused-unreconciled determination lists; the count is always exact. */
export const BROWNLOW_MEDAL_BLOCKING_FINDINGS_LIMIT = 50;

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/** The CURRENT decision of (season, player), as the ledger holds it. */
export interface BrownlowDecisionFact {
  decisionId: number;
  verdict: BrownlowEligibilityVerdict;
}

/** The facts of the player's `brownlow_season_votes` row that bear on eligibility. */
export interface BrownlowStoredEligibilityFact {
  isIneligible: boolean;
  eligibleRank: number | null;
}

/** Raw eligibility evidence for ONE vote-getter. A vote-getter with no entry here has none of it. */
export interface BrownlowPlayerEligibilityEvidence {
  playerId: number;
  /** The current administrator decision, or null. */
  decision: BrownlowDecisionFact | null;
  /** The season's stored row, or null when the player has none. */
  stored: BrownlowStoredEligibilityFact | null;
  /** The AFL API staged `eligible` flags seen for the player (any number, repeats allowed); empty = none staged. */
  stagedFlags: readonly boolean[];
}

export interface BrownlowMedalInput {
  /** The reconciliation of the same season (default rule). Read for raw totals and gating only. */
  report: BrownlowReconciliationReport;
  /** `brownlow_season_authority.published_revision IS NOT NULL` for the season. */
  seasonAdminPublished: boolean;
  players: readonly BrownlowPlayerEligibilityEvidence[];
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

export interface BrownlowEligibilityDetail {
  decisionId: number | null;
  decisionVerdict: BrownlowEligibilityVerdict | null;
  /** What the stored row amounts to: no row, a default-only `false`, or a recorded statement. */
  stored: 'no_row' | 'not_recorded' | 'recorded_ineligible' | 'recorded_eligible';
  storedEligibleRank: number | null;
  /** What the staged provider flags say (a proposal only). */
  provider: 'none' | 'eligible' | 'ineligible' | 'conflicting';
  /** The reconciliation reported `eligibility_flag_inconsistent` for this player. */
  reportFlagInconsistent: boolean;
  /** One sentence, for people. */
  reason: string;
}

export interface BrownlowPlayerEligibility {
  status: BrownlowEligibilityStatus;
  source: BrownlowEligibilitySource;
  detail: BrownlowEligibilityDetail;
}

/** One vote-getter of the RAW leaderboard: the votes exactly as the reconciliation reported them. */
export interface BrownlowRawLeaderboardEntry {
  playerId: number;
  votes: number;
  matchesPolled: number | null;
  /** Competition rank over ALL vote-getters (1, 2, 2, 4 ...). */
  rank: number;
  eligibility: BrownlowPlayerEligibility;
}

export interface BrownlowMedalWinner {
  playerId: number;
  votes: number;
}

export interface BrownlowReviewPlayer {
  playerId: number;
  votes: number;
  status: 'missing' | 'ambiguous';
  reason: string;
}

export interface BrownlowBlockingFinding {
  code: string;
  playerId: number | null;
}

export interface BrownlowMedalDetermination {
  format: typeof BROWNLOW_MEDAL_FORMAT;
  formatVersion: typeof BROWNLOW_MEDAL_FORMAT_VERSION;
  season: number;
  seasonState: BrownlowSeasonState;
  /** The evidence basis the raw totals come from. */
  basis: BrownlowEvidenceBasis | null;
  seasonAdminPublished: boolean;
  status: BrownlowMedalStatus;
  /** Every vote-getter, votes descending then player id; the raw votes are never mutated or dropped. */
  rawLeaderboard: BrownlowRawLeaderboardEntry[];
  /** Joint winners (sorted by player id) when `determined`; empty otherwise. */
  winners: BrownlowMedalWinner[];
  /** More than one eligible leader tied; null unless `determined`. */
  tie: boolean | null;
  /** Known-ineligible players removed from the groups the walk examined. */
  excludedIneligible: BrownlowMedalWinner[];
  /** Missing/ambiguous players in the deciding group when `requires_review`; empty otherwise. */
  playersRequiringReview: BrownlowReviewPlayer[];
  /** Why the gating refused (`refused_unreconciled_evidence` only); empty otherwise. */
  blockingFindings: BrownlowBlockingFinding[];
  blockingFindingCount: number;
  /** sha256 hex of the canonical input; independent of supplied order and of `generatedAt`. */
  inputChecksum: string;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Every problem in `input` that would make a determination meaningless; empty means well formed. */
export function validateBrownlowMedalInput(input: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ['input must be an object.'];

  const report = input.report;
  if (!isRecord(report)) problems.push('report must be an object (a reconciliation report).');
  else {
    if (!Array.isArray(report.findings)) problems.push('report.findings must be an array.');
    if (report.outcome !== 'reconciled' && report.outcome !== 'discrepancies' && report.outcome !== 'refused') {
      problems.push('report.outcome must be reconciled, discrepancies or refused.');
    }
    const source = report.source;
    if (!isRecord(source) || !(isPositiveInt(source.season)) || (source.seasonState !== 'complete' && source.seasonState !== 'in_progress')) {
      problems.push('report.source must carry a season and a seasonState.');
    }
    const raw = report.rawVotes;
    if (!isRecord(raw) || !Array.isArray(raw.playerTotals)) problems.push('report.rawVotes.playerTotals must be an array.');
    else {
      const seen = new Set<unknown>();
      raw.playerTotals.forEach((total: unknown, i) => {
        if (!isRecord(total) || !isPositiveInt(total.playerId) || typeof total.votes !== 'number' || !Number.isInteger(total.votes) || total.votes < 0) {
          problems.push(`report.rawVotes.playerTotals[${i}] must carry a positive playerId and a non-negative integer votes.`);
        } else if (seen.has(total.playerId)) {
          problems.push(`report.rawVotes.playerTotals[${i}]: player ${String(total.playerId)} appears twice.`);
        } else seen.add(total.playerId);
      });
    }
    if (!isRecord(report.awardResultPresentation)) problems.push('report.awardResultPresentation must be an object.');
  }

  if (typeof input.seasonAdminPublished !== 'boolean') problems.push('seasonAdminPublished must be a boolean.');

  if (!Array.isArray(input.players)) problems.push('players must be an array.');
  else {
    const seen = new Set<unknown>();
    input.players.forEach((player: unknown, i) => {
      const path = `players[${i}]`;
      if (!isRecord(player)) {
        problems.push(`${path} must be an object.`);
        return;
      }
      if (!isPositiveInt(player.playerId)) problems.push(`${path}.playerId must be a positive integer.`);
      else if (seen.has(player.playerId)) problems.push(`${path}: player ${player.playerId} appears twice.`);
      else seen.add(player.playerId);
      const decision = player.decision;
      if (decision !== null) {
        if (!isRecord(decision) || !isPositiveInt(decision.decisionId)
          || !(BROWNLOW_ELIGIBILITY_VERDICTS as readonly unknown[]).includes(decision.verdict)) {
          problems.push(`${path}.decision must be null or { decisionId, verdict: eligible | ineligible }.`);
        }
      }
      const stored = player.stored;
      if (stored !== null) {
        if (!isRecord(stored) || typeof stored.isIneligible !== 'boolean'
          || !(stored.eligibleRank === null || (typeof stored.eligibleRank === 'number' && Number.isInteger(stored.eligibleRank)))) {
          problems.push(`${path}.stored must be null or { isIneligible: boolean, eligibleRank: integer | null }.`);
        }
      }
      if (!Array.isArray(player.stagedFlags) || !player.stagedFlags.every((flag: unknown) => typeof flag === 'boolean')) {
        problems.push(`${path}.stagedFlags must be an array of booleans.`);
      }
    });
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Evidence gating
 * ------------------------------------------------------------------ */

/**
 * A reconciliation finding that is about ELIGIBILITY EVIDENCE rather than about the vote evidence,
 * and so is handled per player instead of refusing the season:
 *   - `eligibility_flag_inconsistent` becomes that player's `ambiguous` status;
 *   - `stored_rank_inconsistent` on `eligible_rank` where the STORED rank is NULL reports that the
 *     stored row carries no eligible rank for a non-ineligible player. That is an absent
 *     statement ("not recorded", never a wrong rank), exactly the gap the `missing` status exists
 *     to name; refusing the whole season for it would make the gap impossible to resolve. A
 *     stored rank that is present but wrong still refuses.
 */
export function isEligibilityEvidenceFinding(finding: BrownlowFinding): boolean {
  // Winner flags are the publication OUTPUT, not vote or eligibility evidence.
  // A superseding decision may deliberately disagree with the old projection.
  if (finding.code === 'stored_winner_flag_inconsistent') return true;
  if (finding.code === 'eligibility_flag_inconsistent') return true;
  return finding.code === 'stored_rank_inconsistent'
    && finding.detail.field === 'eligible_rank'
    && finding.detail.stored === null;
}

function blockingFindingsOf(report: BrownlowReconciliationReport): BrownlowFinding[] {
  return report.findings.filter((finding) => finding.severity === 'discrepancy' && !isEligibilityEvidenceFinding(finding));
}

/* ------------------------------------------------------------------ *
 * Per-player eligibility
 * ------------------------------------------------------------------ */

function providerOf(flags: ReadonlySet<boolean>): BrownlowEligibilityDetail['provider'] {
  if (flags.size === 0) return 'none';
  if (flags.size > 1) return 'conflicting';
  return flags.has(true) ? 'eligible' : 'ineligible';
}

/**
 * The eligibility status of one vote-getter from its raw evidence (precedence: decision, recorded
 * stored statement, provider proposal). Pure and total.
 */
export function evaluateBrownlowEligibility(
  evidence: Omit<BrownlowPlayerEligibilityEvidence, 'playerId'> | null,
  context: { seasonAdminPublished: boolean; reportFlagInconsistent: boolean },
): BrownlowPlayerEligibility {
  const decision = evidence === null ? null : evidence.decision;
  const stored = evidence === null ? null : evidence.stored;
  const provider = providerOf(new Set(evidence === null ? [] : evidence.stagedFlags));

  let storedState: BrownlowEligibilityDetail['stored'] = 'no_row';
  if (stored !== null) {
    if (stored.isIneligible) storedState = 'recorded_ineligible';
    else if (context.seasonAdminPublished || stored.eligibleRank !== null) storedState = 'recorded_eligible';
    else storedState = 'not_recorded';
  }
  const base = {
    decisionId: decision === null ? null : decision.decisionId,
    decisionVerdict: decision === null ? null : decision.verdict,
    stored: storedState,
    storedEligibleRank: stored === null ? null : stored.eligibleRank,
    provider,
    reportFlagInconsistent: context.reportFlagInconsistent,
  };

  if (decision !== null) {
    return {
      status: decision.verdict,
      source: 'admin_decision',
      detail: { ...base, reason: `Administrator decision #${decision.decisionId} rules the player ${decision.verdict}; it takes precedence over the stored row and any provider flag.` },
    };
  }

  const statement: BrownlowEligibilityVerdict | null = storedState === 'recorded_ineligible'
    ? 'ineligible'
    : storedState === 'recorded_eligible' ? 'eligible' : null;
  const providerDisagrees = statement !== null && (provider === 'eligible' || provider === 'ineligible') && provider !== statement;

  if (provider === 'conflicting' || providerDisagrees || context.reportFlagInconsistent) {
    const why = provider === 'conflicting'
      ? 'the provider\'s own eligibility flags for the player disagree with each other'
      : providerDisagrees
        ? `the provider flags the player ${provider} but the stored row records ${statement}`
        : 'the reconciliation reports inconsistent eligibility flags for the player';
    return {
      status: 'ambiguous',
      source: statement === null ? 'none' : 'stored_season_votes',
      detail: { ...base, reason: `Ambiguous: ${why}. A provider flag never decides eligibility; an administrator decision is needed.` },
    };
  }
  if (statement !== null) {
    return {
      status: statement,
      source: 'stored_season_votes',
      detail: {
        ...base,
        reason: statement === 'ineligible'
          ? 'The stored Brownlow row records the player ineligible.'
          : context.seasonAdminPublished
            ? 'The stored Brownlow row of an administrator-published season records the player eligible.'
            : 'The stored Brownlow row carries an eligible rank, which records the player eligible.',
      },
    };
  }
  const observed = provider === 'none' ? 'no provider flag was staged' : `the provider flags the player ${provider}, which is a proposal only`;
  const storedWords = storedState === 'no_row'
    ? 'the player has no stored row for the season'
    : 'the stored row is a bare default (is_ineligible false, no eligible rank, season not administrator-published)';
  return {
    status: 'missing',
    source: 'none',
    detail: { ...base, reason: `Missing: no administrator decision; ${storedWords}; ${observed}.` },
  };
}

/* ------------------------------------------------------------------ *
 * Determination
 * ------------------------------------------------------------------ */

function compareTotals(a: { playerId: number; votes: number }, b: { playerId: number; votes: number }): number {
  return b.votes - a.votes || a.playerId - b.playerId;
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Determine the Brownlow Medal winner(s) of one season under the owner's eligibility-aware model.
 * Pure and deterministic: the same facts in any order yield an identical determination (and
 * checksum). Throws a RangeError on a malformed input (a caller programming error); every
 * evidence problem is a typed status instead.
 */
export function determineBrownlowMedal(input: BrownlowMedalInput): BrownlowMedalDetermination {
  const problems = validateBrownlowMedalInput(input);
  if (problems.length > 0) {
    throw new RangeError(`determineBrownlowMedal: ${problems.slice(0, 5).join(' | ')}`);
  }
  const { report, seasonAdminPublished } = input;
  const evidenceById = new Map(input.players.map((player) => [player.playerId, player]));
  const flagInconsistent = new Set<number>();
  for (const finding of report.findings) {
    if (finding.code === 'eligibility_flag_inconsistent' && finding.playerId !== null) flagInconsistent.add(finding.playerId);
  }

  // The raw leaderboard: copied, never mutated, never filtered. Rank is a competition rank.
  const totals = [...report.rawVotes.playerTotals].sort(compareTotals);
  const rawLeaderboard: BrownlowRawLeaderboardEntry[] = totals.map((total) => ({
    playerId: total.playerId,
    votes: total.votes,
    matchesPolled: total.matchesPolled,
    rank: 1 + totals.filter((other) => other.votes > total.votes).length,
    eligibility: evaluateBrownlowEligibility(evidenceById.get(total.playerId) ?? null, {
      seasonAdminPublished,
      reportFlagInconsistent: flagInconsistent.has(total.playerId),
    }),
  }));

  const blocking = blockingFindingsOf(report);
  const checksum = createHash('sha256').update(canonicalJson({
    format: BROWNLOW_MEDAL_FORMAT,
    season: report.source.season,
    seasonState: report.source.seasonState,
    basis: report.rawVotes.basis,
    outcome: report.outcome,
    awardStatus: report.awardResultPresentation.status,
    seasonAdminPublished,
    totals: totals.map((total) => ({ playerId: total.playerId, votes: total.votes, matchesPolled: total.matchesPolled })),
    findings: sortedStrings(
      report.findings
        .filter((finding) => finding.severity === 'refusal' || finding.severity === 'discrepancy')
        .map((finding) => canonicalJson({ code: finding.code, playerId: finding.playerId, detail: finding.detail })),
    ),
    evidence: totals.map((total) => {
      const evidence = evidenceById.get(total.playerId);
      return {
        playerId: total.playerId,
        decision: evidence === undefined ? null : evidence.decision,
        stored: evidence === undefined ? null : evidence.stored,
        stagedFlags: evidence === undefined ? [] : [...new Set(evidence.stagedFlags)].sort(),
      };
    }),
  })).digest('hex');

  const result = (
    status: BrownlowMedalStatus,
    parts: Partial<Pick<BrownlowMedalDetermination, 'winners' | 'tie' | 'excludedIneligible' | 'playersRequiringReview'>> = {},
  ): BrownlowMedalDetermination => ({
    format: BROWNLOW_MEDAL_FORMAT,
    formatVersion: BROWNLOW_MEDAL_FORMAT_VERSION,
    season: report.source.season,
    seasonState: report.source.seasonState,
    basis: report.rawVotes.basis,
    seasonAdminPublished,
    status,
    rawLeaderboard,
    winners: parts.winners ?? [],
    tie: parts.tie ?? null,
    excludedIneligible: parts.excludedIneligible ?? [],
    playersRequiringReview: parts.playersRequiringReview ?? [],
    blockingFindings: status === 'refused_unreconciled_evidence'
      ? blocking.slice(0, BROWNLOW_MEDAL_BLOCKING_FINDINGS_LIMIT).map((finding) => ({ code: finding.code, playerId: finding.playerId }))
      : [],
    blockingFindingCount: status === 'refused_unreconciled_evidence' ? blocking.length : 0,
    inputChecksum: checksum,
  });

  // Gating, in the reconciliation's own priority order.
  if (report.outcome === 'refused' || report.awardResultPresentation.status === 'refused_whole_set') return result('refused_whole_set');
  if (report.source.seasonState === 'in_progress') return result('season_incomplete');
  if (rawLeaderboard.length === 0) return result('no_vote_evidence');
  if (blocking.length > 0) return result('refused_unreconciled_evidence');

  // The walk: distinct totals, highest first.
  const excluded: BrownlowMedalWinner[] = [];
  let index = 0;
  while (index < rawLeaderboard.length) {
    const votes = rawLeaderboard[index].votes;
    const group: BrownlowRawLeaderboardEntry[] = [];
    while (index < rawLeaderboard.length && rawLeaderboard[index].votes === votes) group.push(rawLeaderboard[index++]);

    for (const entry of group) {
      if (entry.eligibility.status === 'ineligible') excluded.push({ playerId: entry.playerId, votes: entry.votes });
    }
    const unresolved = group.filter((entry) => entry.eligibility.status === 'missing' || entry.eligibility.status === 'ambiguous');
    if (unresolved.length > 0) {
      return result('requires_review', {
        excludedIneligible: excluded,
        playersRequiringReview: unresolved
          .map((entry): BrownlowReviewPlayer => ({
            playerId: entry.playerId,
            votes: entry.votes,
            status: entry.eligibility.status as 'missing' | 'ambiguous',
            reason: entry.eligibility.detail.reason,
          }))
          .sort((a, b) => a.playerId - b.playerId),
      });
    }
    const eligible = group.filter((entry) => entry.eligibility.status === 'eligible');
    if (eligible.length > 0) {
      const winners = eligible.map((entry) => ({ playerId: entry.playerId, votes: entry.votes })).sort((a, b) => a.playerId - b.playerId);
      return result('determined', { winners, tie: winners.length > 1, excludedIneligible: excluded });
    }
  }
  return result('no_eligible_winner', { excludedIneligible: excluded });
}
