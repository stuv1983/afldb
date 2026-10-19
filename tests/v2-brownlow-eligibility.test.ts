/**
 * AFLDB V2 Launch F (stream F-D) — the pure, eligibility-aware Brownlow Medal determination
 * (docs/v2/adr/0014-brownlow-eligibility.md). DB-free, network-free, clock-free.
 *
 * EVERY FIXTURE IS SYNTHETIC: season 2090, player ids 1001-1008, invented vote totals. No real
 * player's votes are used. The reports are built by the production `reconcileBrownlowSeason` (stored
 * totals as the evidence basis unless a test says otherwise), so the gating is the real gating.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BROWNLOW_MEDAL_STATUSES,
  determineBrownlowMedal,
  evaluateBrownlowEligibility,
  isEligibilityEvidenceFinding,
  reconcileBrownlowSeason,
  validateBrownlowMedalInput,
  type BrownlowDecisionFact,
  type BrownlowFinding,
  type BrownlowMedalDetermination,
  type BrownlowPlayerEligibilityEvidence,
  type BrownlowReconciliationReport,
  type BrownlowSeasonState,
  type BrownlowStoredTotalInput,
} from '@afldb/derived';
import { describe, expect, it } from 'vitest';

import {
  DecisionWorkbenchView,
  LEADERBOARD_VISIBLE_ROWS,
  MedalDeterminationSection,
  reviewPlayersOf,
} from '@/app/admin/operations/_components/BrownlowDeterminationViews';
import type { BrownlowEligibilityActionState } from '@/app/admin/operations/brownlow/action-state';
import type { BrownlowDeterminationView } from '@/lib/admin/operations-centre';

const GENERATED_AT = '2026-10-19T00:00:00Z';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

interface Row {
  id: number;
  votes: number;
  /** The stored `is_ineligible` flag. */
  ineligible?: boolean;
  /** `null` = the stored row carries NO eligible rank although it is not ineligible ("default-false"). */
  noRank?: boolean;
}

/** Stored totals whose ranks and winner flags are consistent, except where `noRank` blanks a rank. */
function storedRows(rows: Row[]): BrownlowStoredTotalInput[] {
  const ordered = [...rows].sort((a, b) => b.votes - a.votes || a.id - b.id);
  const rank = (list: Row[], row: Row) => 1 + list.filter((other) => other.votes > row.votes).length;
  const eligible = ordered.filter((row) => row.ineligible !== true);
  return ordered.map((row) => {
    const expected = row.ineligible === true ? null : rank(eligible, row);
    return {
      playerId: row.id,
      clubId: null,
      votes: row.votes,
      voteRank: rank(ordered, row),
      eligibleRank: row.noRank === true ? null : expected,
      isIneligible: row.ineligible === true,
      isWinner: row.ineligible !== true && expected === 1,
    };
  });
}

function reportOf(rows: Row[], state: BrownlowSeasonState = 'complete'): BrownlowReconciliationReport {
  return reconcileBrownlowSeason({
    season: 2090, seasonState: state, generatedAt: GENERATED_AT,
    matchVotes: [], leaderboard: null, storedTotals: storedRows(rows), matchContext: [],
  });
}

/** Evidence for a player whose stored row is read from `rows` (so the facts agree with the report). */
function storedEvidence(rows: Row[], id: number, extra: Partial<BrownlowPlayerEligibilityEvidence> = {}): BrownlowPlayerEligibilityEvidence {
  const stored = storedRows(rows).find((row) => row.playerId === id) ?? null;
  return {
    playerId: id,
    decision: null,
    stored: stored === null ? null : { isIneligible: stored.isIneligible, eligibleRank: stored.eligibleRank },
    stagedFlags: [],
    ...extra,
  };
}

function evidenceFor(rows: Row[], overrides: Record<number, Partial<BrownlowPlayerEligibilityEvidence>> = {}): BrownlowPlayerEligibilityEvidence[] {
  return rows.map((row) => storedEvidence(rows, row.id, overrides[row.id] ?? {}));
}

function determine(
  rows: Row[],
  overrides: Record<number, Partial<BrownlowPlayerEligibilityEvidence>> = {},
  options: { seasonAdminPublished?: boolean; state?: BrownlowSeasonState } = {},
): BrownlowMedalDetermination {
  return determineBrownlowMedal({
    report: reportOf(rows, options.state),
    seasonAdminPublished: options.seasonAdminPublished ?? false,
    players: evidenceFor(rows, overrides),
  });
}

const decision = (decisionId: number, verdict: 'eligible' | 'ineligible'): BrownlowDecisionFact => ({ decisionId, verdict });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** A clean season: 1001 leads (30), 1002 second (25), 1003 third (20). */
const CLEAN: Row[] = [{ id: 1001, votes: 30 }, { id: 1002, votes: 25 }, { id: 1003, votes: 20 }];

/* ------------------------------------------------------------------ *
 * Eligible leader, and the missing / ambiguous leader (the owner's rule)
 * ------------------------------------------------------------------ */

describe('a recorded eligible leader is determined', () => {
  it('names the leader as the sole winner; the raw leaderboard lists every vote-getter', () => {
    const result = determine(CLEAN);
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1001, votes: 30 }]);
    expect(result.tie).toBe(false);
    expect(result.rawLeaderboard.map((e) => [e.playerId, e.votes, e.rank])).toEqual([[1001, 30, 1], [1002, 25, 2], [1003, 20, 3]]);
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({ status: 'eligible', source: 'stored_season_votes' });
    expect(result.excludedIneligible).toEqual([]);
    expect(result.playersRequiringReview).toEqual([]);
    expect(result.inputChecksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('a leader whose eligibility is missing or ambiguous is never named', () => {
  const MISSING: Row[] = [{ id: 1001, votes: 30, noRank: true }, { id: 1002, votes: 25 }, { id: 1003, votes: 20 }];

  it('a default-false stored row with no eligible rank on a season that is not administrator-published is MISSING => requires_review', () => {
    const result = determine(MISSING);
    expect(result.status).toBe('requires_review');
    expect(result.winners).toEqual([]);
    expect(result.tie).toBeNull();
    expect(result.playersRequiringReview).toEqual([
      { playerId: 1001, votes: 30, status: 'missing', reason: expect.stringContaining('Missing') },
    ]);
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({
      status: 'missing', source: 'none', detail: { stored: 'not_recorded', storedEligibleRank: null, provider: 'none' },
    });
    // The exempted finding is still REPORTED by the reconciliation: nothing is hidden.
    expect(reportOf(MISSING).findings.some((f) => f.code === 'stored_rank_inconsistent')).toBe(true);
  });

  it('the same default-false row on an ADMINISTRATOR-PUBLISHED season is a recorded statement => determined', () => {
    const result = determine(MISSING, {}, { seasonAdminPublished: true });
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1001, votes: 30 }]);
    expect(result.rawLeaderboard[0].eligibility.detail.stored).toBe('recorded_eligible');
  });

  it('a player with no stored row at all is MISSING (the absence of evidence is not eligibility)', () => {
    const rows: Row[] = [{ id: 1001, votes: 30 }, { id: 1002, votes: 25 }];
    const result = determineBrownlowMedal({
      report: reportOf(rows), seasonAdminPublished: true,
      players: [storedEvidence(rows, 1002)], // 1001 has no evidence entry
    });
    expect(result.status).toBe('requires_review');
    expect(result.rawLeaderboard[0].eligibility.detail.stored).toBe('no_row');
    expect(result.playersRequiringReview.map((p) => p.playerId)).toEqual([1001]);
  });

  it('an AFL API flag that disagrees with a recorded stored statement is AMBIGUOUS => requires_review', () => {
    const result = determine(CLEAN, { 1001: { stagedFlags: [false] } });
    expect(result.status).toBe('requires_review');
    expect(result.playersRequiringReview).toEqual([
      { playerId: 1001, votes: 30, status: 'ambiguous', reason: expect.stringContaining('stored row records eligible') },
    ]);
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({
      status: 'ambiguous', source: 'stored_season_votes', detail: { provider: 'ineligible', stored: 'recorded_eligible' },
    });
  });

  it('a player\'s own staged flags disagreeing with each other is AMBIGUOUS even with no stored statement', () => {
    const result = determine(MISSING, { 1001: { stagedFlags: [true, false, true] } });
    expect(result.playersRequiringReview[0]).toMatchObject({ playerId: 1001, status: 'ambiguous' });
    expect(result.rawLeaderboard[0].eligibility.source).toBe('none');
  });

  it('a provider flag NEVER decides: with no decision and no recorded stored statement it stays MISSING, and is reported', () => {
    const result = determine(MISSING, { 1001: { stagedFlags: [true] } });
    expect(result.status).toBe('requires_review');
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({ status: 'missing', detail: { provider: 'eligible' } });
    expect(result.rawLeaderboard[0].eligibility.detail.reason).toContain('proposal only');
  });

  it('a provider flag that AGREES with a recorded stored statement changes nothing', () => {
    expect(determine(CLEAN, { 1001: { stagedFlags: [true, true] } }).status).toBe('determined');
  });

  it('the reconciliation\'s eligibility_flag_inconsistent finding makes that player AMBIGUOUS (API round votes disagreeing with themselves)', () => {
    const vote = (providerPlayerId: string, playerId: number, votes: number, eligible: boolean) => ({
      providerPlayerId, providerTeamId: 'SYN_T1', playerId, clubId: null, votes, eligible,
    });
    const report = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [
        { providerMatchId: 'SYN_M1', matchId: 1, apiRoundNumber: 1, canonicalRoundNumber: 1,
          votes: [vote('SYN_I1001', 1001, 3, true), vote('SYN_I1002', 1002, 2, true), vote('SYN_I1003', 1003, 1, true)] },
        { providerMatchId: 'SYN_M2', matchId: 2, apiRoundNumber: 2, canonicalRoundNumber: 2,
          votes: [vote('SYN_I1001', 1001, 3, false), vote('SYN_I1002', 1002, 2, true), vote('SYN_I1003', 1003, 1, true)] },
      ],
      leaderboard: null, storedTotals: null,
      matchContext: [1, 2].map((matchId) => ({
        matchId, season: 2090, roundNumber: matchId, isFinal: false,
        homeClubId: null, awayClubId: null, homeProviderTeamId: null, awayProviderTeamId: null,
      })),
    });
    expect(report.findings.some((f) => f.code === 'eligibility_flag_inconsistent' && f.playerId === 1001)).toBe(true);
    const result = determineBrownlowMedal({
      report, seasonAdminPublished: true,
      players: [1001, 1002, 1003].map((id) => ({ playerId: id, decision: null, stored: { isIneligible: false, eligibleRank: 1 }, stagedFlags: [] })),
    });
    expect(result.status).toBe('requires_review');
    expect(result.playersRequiringReview).toEqual([
      expect.objectContaining({ playerId: 1001, votes: 6, status: 'ambiguous' }),
    ]);
  });

  it('a missing player BELOW a determined group does not block the winner', () => {
    const rows: Row[] = [{ id: 1001, votes: 30 }, { id: 1002, votes: 25, noRank: true }];
    const result = determine(rows);
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1001, votes: 30 }]);
  });
});

/* ------------------------------------------------------------------ *
 * Known-ineligible players, ties, administrator decisions
 * ------------------------------------------------------------------ */

describe('ineligible players are excluded only on authoritative evidence', () => {
  it('a stored-ineligible leader is excluded and the next group is determined; the exclusion is listed, the votes are kept', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, ineligible: true }, { id: 1002, votes: 25 }, { id: 1003, votes: 20 }];
    const result = determine(rows);
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1002, votes: 25 }]);
    expect(result.excludedIneligible).toEqual([{ playerId: 1001, votes: 30 }]);
    expect(result.rawLeaderboard.map((e) => [e.playerId, e.votes])).toEqual([[1001, 30], [1002, 25], [1003, 20]]);
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({ status: 'ineligible', source: 'stored_season_votes' });
  });

  it('an administrator decision of ineligible excludes the player although the stored row says eligible', () => {
    const result = determine(CLEAN, { 1001: { decision: decision(7, 'ineligible') } });
    expect(result.winners).toEqual([{ playerId: 1002, votes: 25 }]);
    expect(result.rawLeaderboard[0].eligibility).toMatchObject({ status: 'ineligible', source: 'admin_decision', detail: { decisionId: 7, stored: 'recorded_eligible' } });
  });

  it('an administrator decision of eligible overrides a stored ineligible flag', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, ineligible: true }, { id: 1002, votes: 25 }];
    const result = determine(rows, { 1001: { decision: decision(3, 'eligible') } });
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1001, votes: 30 }]);
    expect(result.excludedIneligible).toEqual([]);
  });

  it('an administrator decision overrides a conflicting provider flag too (no ambiguity remains)', () => {
    const result = determine(CLEAN, { 1001: { decision: decision(4, 'eligible'), stagedFlags: [false, true] } });
    expect(result.status).toBe('determined');
    expect(result.rawLeaderboard[0].eligibility.status).toBe('eligible');
  });

  it('a decision of eligible RESOLVES a missing leader => determined (the recompute after a decision)', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, noRank: true }, { id: 1002, votes: 25 }];
    const before = determine(rows);
    const after = determine(rows, { 1001: { decision: decision(1, 'eligible') } });
    expect(before.status).toBe('requires_review');
    expect(after.status).toBe('determined');
    expect(after.winners).toEqual([{ playerId: 1001, votes: 30 }]);
    expect(after.inputChecksum).not.toBe(before.inputChecksum);
  });

  it('a decision of ineligible resolves a missing leader the OTHER way: the runner-up wins', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, noRank: true }, { id: 1002, votes: 25 }];
    const after = determine(rows, { 1001: { decision: decision(1, 'ineligible') } });
    expect(after.status).toBe('determined');
    expect(after.winners).toEqual([{ playerId: 1002, votes: 25 }]);
    expect(after.excludedIneligible).toEqual([{ playerId: 1001, votes: 30 }]);
  });

  it('every vote-getter ineligible => no_eligible_winner, with the raw leaderboard intact', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, ineligible: true }, { id: 1002, votes: 25, ineligible: true }];
    const result = determine(rows);
    expect(result.status).toBe('no_eligible_winner');
    expect(result.winners).toEqual([]);
    expect(result.excludedIneligible.map((e) => e.playerId)).toEqual([1001, 1002]);
    expect(result.rawLeaderboard).toHaveLength(2);
  });

  it('walking past ineligible groups stops at a missing player in a lower group', () => {
    const rows: Row[] = [{ id: 1001, votes: 30, ineligible: true }, { id: 1002, votes: 25, noRank: true }, { id: 1003, votes: 20 }];
    const result = determine(rows);
    expect(result.status).toBe('requires_review');
    expect(result.playersRequiringReview.map((p) => p.playerId)).toEqual([1002]);
    expect(result.excludedIneligible).toEqual([{ playerId: 1001, votes: 30 }]);
  });
});

describe('ties among leaders', () => {
  it('eligible leaders on equal votes are joint winners, sorted by player id, tie true', () => {
    const rows: Row[] = [{ id: 1005, votes: 30 }, { id: 1002, votes: 30 }, { id: 1003, votes: 20 }];
    const result = determine(rows);
    expect(result.status).toBe('determined');
    expect(result.winners).toEqual([{ playerId: 1002, votes: 30 }, { playerId: 1005, votes: 30 }]);
    expect(result.tie).toBe(true);
    expect(result.rawLeaderboard.map((e) => e.rank)).toEqual([1, 1, 3]);
  });

  it('a tie in which one player is ineligible leaves the other eligible player the sole winner', () => {
    const rows: Row[] = [{ id: 1002, votes: 30, ineligible: true }, { id: 1005, votes: 30 }, { id: 1003, votes: 20 }];
    const result = determine(rows);
    expect(result.winners).toEqual([{ playerId: 1005, votes: 30 }]);
    expect(result.tie).toBe(false);
  });

  it('a tie in which one tied player is missing => requires_review naming ONLY that player; no winner', () => {
    const rows: Row[] = [{ id: 1002, votes: 30, noRank: true }, { id: 1005, votes: 30 }, { id: 1003, votes: 20 }];
    const result = determine(rows);
    expect(result.status).toBe('requires_review');
    expect(result.winners).toEqual([]);
    expect(result.playersRequiringReview.map((p) => p.playerId)).toEqual([1002]);
  });
});

/* ------------------------------------------------------------------ *
 * Gating (pass-through statuses)
 * ------------------------------------------------------------------ */

describe('the reconciliation\'s gating passes through', () => {
  it('an in-progress season is season_incomplete', () => {
    const result = determine(CLEAN, {}, { state: 'in_progress' });
    expect(result.status).toBe('season_incomplete');
    expect(result.winners).toEqual([]);
    expect(result.rawLeaderboard).toHaveLength(3);
  });

  it('no vote evidence at all is no_vote_evidence', () => {
    const report = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [], leaderboard: null, storedTotals: null, matchContext: [],
    });
    const result = determineBrownlowMedal({ report, seasonAdminPublished: false, players: [] });
    expect(result.status).toBe('no_vote_evidence');
    expect(result.rawLeaderboard).toEqual([]);
  });

  it('an unresolved player (a whole-set refusal) is refused_whole_set', () => {
    const report = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [{
        providerMatchId: 'SYN_M1', matchId: 1, apiRoundNumber: 1, canonicalRoundNumber: 1,
        votes: [{ providerPlayerId: 'SYN_I1', providerTeamId: 'SYN_T1', playerId: null, clubId: null, votes: 3, eligible: true }],
      }],
      leaderboard: null, storedTotals: null, matchContext: [],
    });
    expect(report.outcome).toBe('refused');
    const result = determineBrownlowMedal({ report, seasonAdminPublished: false, players: [] });
    expect(result.status).toBe('refused_whole_set');
    expect(result.winners).toEqual([]);
  });

  it('a wrong stored rank (a discrepancy that is not about eligibility evidence) is refused_unreconciled_evidence, with the findings listed', () => {
    const rows = storedRows(CLEAN).map((row) => (row.playerId === 1002 ? { ...row, voteRank: 9 } : row));
    const report = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [], leaderboard: null, storedTotals: rows, matchContext: [],
    });
    const result = determineBrownlowMedal({ report, seasonAdminPublished: false, players: evidenceFor(CLEAN) });
    expect(result.status).toBe('refused_unreconciled_evidence');
    expect(result.blockingFindingCount).toBe(1);
    expect(result.blockingFindings).toEqual([{ code: 'stored_rank_inconsistent', playerId: 1002 }]);
    expect(result.winners).toEqual([]);
  });

  it('a stored eligible rank that is PRESENT but wrong still refuses (only an absent rank is a per-player gap)', () => {
    const rows = storedRows(CLEAN).map((row) => (row.playerId === 1001 ? { ...row, eligibleRank: 5 } : row));
    const report = reconcileBrownlowSeason({
      season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT,
      matchVotes: [], leaderboard: null, storedTotals: rows, matchContext: [],
    });
    expect(determineBrownlowMedal({ report, seasonAdminPublished: false, players: evidenceFor(CLEAN) }).status)
      .toBe('refused_unreconciled_evidence');
  });

  it('only the two eligibility-evidence findings are exempt from the gate', () => {
    const finding = (code: BrownlowFinding['code'], detail: BrownlowFinding['detail']): BrownlowFinding => ({
      code, severity: 'discrepancy', providerMatchId: null, playerId: 1, providerPlayerId: null, detail,
    });
    expect(isEligibilityEvidenceFinding(finding('eligibility_flag_inconsistent', {}))).toBe(true);
    expect(isEligibilityEvidenceFinding(finding('stored_rank_inconsistent', { field: 'eligible_rank', stored: null, expected: 1 }))).toBe(true);
    expect(isEligibilityEvidenceFinding(finding('stored_rank_inconsistent', { field: 'eligible_rank', stored: 3, expected: 1 }))).toBe(false);
    expect(isEligibilityEvidenceFinding(finding('stored_rank_inconsistent', { field: 'vote_rank', stored: null, expected: 1 }))).toBe(false);
    expect(isEligibilityEvidenceFinding(finding('stored_total_mismatch', {}))).toBe(false);
  });

  it('every status the determination can return is declared', () => {
    const seen = new Set<string>([
      determine(CLEAN).status,
      determine(CLEAN, {}, { state: 'in_progress' }).status,
      determine([{ id: 1001, votes: 30, noRank: true }]).status,
      determine([{ id: 1001, votes: 30, ineligible: true }]).status,
    ]);
    for (const status of seen) expect(BROWNLOW_MEDAL_STATUSES as readonly string[]).toContain(status);
    expect(seen).toEqual(new Set(['determined', 'season_incomplete', 'requires_review', 'no_eligible_winner']));
  });
});

/* ------------------------------------------------------------------ *
 * Raw votes are never altered; determinism; input validation
 * ------------------------------------------------------------------ */

describe('raw votes are preserved and the result is deterministic', () => {
  const MIXED: Row[] = [
    { id: 1004, votes: 30, ineligible: true },
    { id: 1001, votes: 30, noRank: true },
    { id: 1002, votes: 25 },
    { id: 1003, votes: 25 },
    { id: 1006, votes: 11 },
  ];

  it('the raw leaderboard equals the input totals exactly (nothing dropped, reordered by eligibility, or changed) and the input is not mutated', () => {
    const report = deepFreeze(reportOf(MIXED));
    const players = deepFreeze(evidenceFor(MIXED, { 1002: { decision: decision(9, 'ineligible') } }));
    const input = deepFreeze({ report, seasonAdminPublished: false, players });
    const result = determineBrownlowMedal(input);
    expect(result.rawLeaderboard.map(({ playerId, votes, matchesPolled }) => ({ playerId, votes, matchesPolled })))
      .toEqual(report.rawVotes.playerTotals.map(({ playerId, votes, matchesPolled }) => ({ playerId, votes, matchesPolled })));
    expect(result.rawLeaderboard.map((e) => e.rank)).toEqual([1, 1, 3, 3, 5]);
    // Ineligible and decided players are still on the leaderboard, with their raw votes.
    expect(result.rawLeaderboard.find((e) => e.playerId === 1004)).toMatchObject({ votes: 30, eligibility: { status: 'ineligible' } });
    expect(result.rawLeaderboard.find((e) => e.playerId === 1002)).toMatchObject({ votes: 25, eligibility: { status: 'ineligible', source: 'admin_decision' } });
  });

  it('shuffled players, totals and findings give an identical determination and checksum', () => {
    const report = reportOf(MIXED);
    const players = evidenceFor(MIXED, { 1003: { stagedFlags: [false, true] } });
    const a = determineBrownlowMedal({ report, seasonAdminPublished: false, players });
    const shuffledReport: BrownlowReconciliationReport = {
      ...report,
      findings: [...report.findings].reverse(),
      rawVotes: { ...report.rawVotes, playerTotals: [...report.rawVotes.playerTotals].reverse() },
    };
    const b = determineBrownlowMedal({ report: shuffledReport, seasonAdminPublished: false, players: [...players].reverse() });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('the checksum ignores generatedAt but changes with any evidence', () => {
    const base = determine(CLEAN);
    const later = determineBrownlowMedal({
      report: { ...reportOf(CLEAN), generatedAt: '2030-01-01T00:00:00Z' }, seasonAdminPublished: false, players: evidenceFor(CLEAN),
    });
    expect(later.inputChecksum).toBe(base.inputChecksum);
    expect(determine(CLEAN, {}, { seasonAdminPublished: true }).inputChecksum).not.toBe(base.inputChecksum);
    expect(determine(CLEAN, { 1002: { stagedFlags: [true] } }).inputChecksum).not.toBe(base.inputChecksum);
    expect(determine(CLEAN, { 1002: { decision: decision(2, 'eligible') } }).inputChecksum).not.toBe(base.inputChecksum);
  });

  it('never reads the reconciliation\'s folded per-player eligible boolean for a status', () => {
    const report = reportOf(CLEAN);
    const flip = (value: boolean): BrownlowReconciliationReport => ({
      ...report,
      rawVotes: { ...report.rawVotes, playerTotals: report.rawVotes.playerTotals.map((t) => ({ ...t, eligible: value })) },
    });
    const players = evidenceFor(CLEAN);
    const asTrue = determineBrownlowMedal({ report: flip(true), seasonAdminPublished: false, players });
    const asFalse = determineBrownlowMedal({ report: flip(false), seasonAdminPublished: false, players });
    expect(asFalse).toEqual(asTrue);
    expect(asFalse.status).toBe('determined');
  });

  it('evaluateBrownlowEligibility is total: no evidence at all is missing, not eligible', () => {
    expect(evaluateBrownlowEligibility(null, { seasonAdminPublished: true, reportFlagInconsistent: false }))
      .toMatchObject({ status: 'missing', source: 'none', detail: { stored: 'no_row', provider: 'none' } });
  });
});

describe('input validation', () => {
  it('a duplicate player entry or a malformed fact is reported and determineBrownlowMedal throws a RangeError', () => {
    const report = reportOf(CLEAN);
    const duplicate = { report, seasonAdminPublished: false, players: [storedEvidence(CLEAN, 1001), storedEvidence(CLEAN, 1001)] };
    expect(validateBrownlowMedalInput(duplicate)).toEqual([expect.stringContaining('appears twice')]);
    expect(() => determineBrownlowMedal(duplicate)).toThrow(RangeError);

    const malformed = {
      report, seasonAdminPublished: 'yes',
      players: [{ playerId: 0, decision: { decisionId: 1, verdict: 'maybe' }, stored: { isIneligible: 'no', eligibleRank: 1.5 }, stagedFlags: [1] }],
    };
    const problems = validateBrownlowMedalInput(malformed);
    expect(problems.join(' | ')).toMatch(/seasonAdminPublished/);
    expect(problems.join(' | ')).toMatch(/playerId must be a positive integer/);
    expect(problems.join(' | ')).toMatch(/decision must be null or/);
    expect(problems.join(' | ')).toMatch(/stored must be null or/);
    expect(problems.join(' | ')).toMatch(/stagedFlags must be an array of booleans/);
    expect(validateBrownlowMedalInput(null)).toEqual(['input must be an object.']);
    expect(validateBrownlowMedalInput({ report: {}, seasonAdminPublished: true, players: [] }).length).toBeGreaterThan(0);
  });

  it('a well-formed input has no problems', () => {
    expect(validateBrownlowMedalInput({ report: reportOf(CLEAN), seasonAdminPublished: false, players: evidenceFor(CLEAN) })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Presentation (static markup from synthetic props; no browser, no database)
 * ------------------------------------------------------------------ */

describe('the determination page markup', () => {
  const viewOf = (
    determination: BrownlowMedalDetermination,
    over: Partial<BrownlowDeterminationView> = {},
  ): BrownlowDeterminationView => ({
    season: 2090,
    generatedAt: GENERATED_AT,
    sealed: true,
    seasonAdminPublished: false,
    report: { outcome: 'reconciled', seasonState: 'complete', basis: 'stored_totals', findingCounts: {}, voteGetters: determination.rawLeaderboard.length },
    determination,
    identities: determination.rawLeaderboard.map((e) => ({ playerId: e.playerId, state: 'resolved' as const, identity: `afltables:players/s/synthetic_${e.playerId}.html` })),
    decisions: [],
    storedFlagCheck: { state: 'not_applicable', storedWinners: null, determinedWinners: [] },
    ...over,
  });
  const MISSING_ROWS: Row[] = [{ id: 1001, votes: 30, noRank: true }, { id: 1002, votes: 25 }, { id: 1003, votes: 20 }];
  const render = (view: BrownlowDeterminationView, canDecide: boolean, state: BrownlowEligibilityActionState = {}) =>
    renderToStaticMarkup(createElement(MedalDeterminationSection, {
      view,
      reviewPanel: createElement(DecisionWorkbenchView, {
        season: view.season, players: reviewPlayersOf(view), canDecide, actingEmail: 'super@example.invalid',
        sealedSeason: view.sealed, binding: { state, pending: false },
      }),
    }));

  it('requires_review: no winner is stated, the player is named, and a Super Admin gets the card BEFORE the form', () => {
    const markup = render(viewOf(determine(MISSING_ROWS)), true);
    expect(markup).toContain('data-medal-status="requires_review"');
    expect(markup).toContain('Requires review');
    expect(markup).toContain('data-medal-winners="true">none stated');
    expect(markup).toContain('data-review-player="1001"');
    expect(markup).toContain('afltables:players/s/synthetic_1001.html');
    expect(markup.indexOf('data-consequences="brownlow_eligibility"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-consequences="brownlow_eligibility"')).toBeLessThan(markup.indexOf('<form'));
    expect(markup).toContain('Not reversible');
    expect(markup).toContain('name="verdict" value="eligible"');
    expect(markup).toContain('name="verdict" value="ineligible"');
    expect(markup).toContain('name="expectedCurrentDecisionId" value=""');
    expect(markup).toContain('name="playerId" value="1001"');
    // The raw leaderboard lists every vote-getter with status and source.
    expect(markup).toContain('data-leaderboard-player="1002"');
    expect(markup).toContain('Stored season table');
  });

  it('an Admin sees the same evidence read-only: no form, an explanation', () => {
    const markup = render(viewOf(determine(MISSING_ROWS)), false);
    expect(markup).toContain('data-decision-unavailable="role"');
    expect(markup).not.toContain('<form');
    expect(markup).toContain('Super Admin');
  });

  it('a player with no durable identity cannot be decided: the form is replaced by the reason', () => {
    const view = viewOf(determine(MISSING_ROWS), {
      identities: [{ playerId: 1001, state: 'missing', identity: null }, { playerId: 1002, state: 'resolved', identity: 'afltables:x' }],
    });
    const markup = render(view, true);
    expect(markup).toContain('data-decision-unavailable="identity"');
    expect(markup).not.toContain('<form');
  });

  it('the current decision of a reviewed player is carried into the form as the expected id', () => {
    const base = viewOf(determine(MISSING_ROWS));
    const view: BrownlowDeterminationView = {
      ...base,
      decisions: [{
        id: 41, season: 2090, playerIdentity: 'afltables:players/s/synthetic_1001.html', playerIdAtDecision: 1001,
        verdict: 'eligible', citation: 'ref', note: 'n'.repeat(25), decidedBy: 1, decidedAt: '2026-10-19T00:00:00Z',
        basis: 'audited_correction', correction: null, supersedesId: null, current: true,
      }],
    };
    const markup = render(view, true);
    expect(markup).toContain('name="expectedCurrentDecisionId" value="41"');
    expect(markup).toContain('supersede decision #41');
    expect(markup).toContain('data-decision-current="true"');
  });

  it('determined with a tie: joint winners and the stored-flag disagreement notice, with nothing claimed as changed', () => {
    const determination = determine([{ id: 1002, votes: 30 }, { id: 1005, votes: 30 }, { id: 1003, votes: 20 }]);
    const markup = render(viewOf(determination, {
      storedFlagCheck: { state: 'disagrees', storedWinners: [1002], determinedWinners: [1002, 1005] },
    }), true);
    expect(markup).toContain('Joint winners');
    expect(markup).toContain('player 1002 (30 votes), player 1005 (30 votes)');
    expect(markup).toContain('data-stored-flag-disagreement="true"');
    expect(markup).toContain('Nothing was changed');
    expect(markup).toContain('data-no-review="true"');
  });

  it('every other status is stated in words and no winner is named', () => {
    const allIneligible = render(viewOf(determine([{ id: 1001, votes: 30, ineligible: true }])), true);
    expect(allIneligible).toContain('No eligible winner');
    expect(allIneligible).toContain('data-medal-winners="true">none stated');
    expect(allIneligible).toContain('data-eligibility="ineligible"');
    expect(render(viewOf(determine(CLEAN, {}, { state: 'in_progress' })), true)).toContain('Season in progress');
    const empty = determineBrownlowMedal({
      report: reconcileBrownlowSeason({ season: 2090, seasonState: 'complete', generatedAt: GENERATED_AT, matchVotes: [], leaderboard: null, storedTotals: null, matchContext: [] }),
      seasonAdminPublished: false, players: [],
    });
    const emptyMarkup = render(viewOf(empty), true);
    expect(emptyMarkup).toContain('No vote evidence');
    expect(emptyMarkup).toContain('data-empty-leaderboard="true"');
    expect(emptyMarkup).toContain('data-no-decisions="true"');
  });

  it('a long leaderboard shows the first rows and folds the rest into a disclosure; nobody is dropped', () => {
    const rows: Row[] = Array.from({ length: LEADERBOARD_VISIBLE_ROWS + 7 }, (_, i) => ({ id: 2000 + i, votes: 100 - i }));
    const markup = render(viewOf(determine(rows)), true);
    expect(markup.match(/data-leaderboard-player=/g)).toHaveLength(LEADERBOARD_VISIBLE_ROWS + 7);
    expect(markup).toContain('Show the other 7 vote-getters');
  });

  it('a successful decision shows the RECOMPUTED determination; a refusal shows only on the form it was about', () => {
    const view = viewOf(determine(MISSING_ROWS));
    const success: BrownlowEligibilityActionState = {
      ok: true, playerId: 1001, message: 'x',
      decision: { id: 5, season: 2090, verdict: 'eligible', basis: 'audited_correction', supersededId: null, decidedAt: GENERATED_AT },
      determination: { status: 'determined', winners: [{ playerId: 1001, votes: 30 }], tie: false, stillRequiringReview: [], inputChecksum: 'a'.repeat(64) },
    };
    const ok = render(view, true, success);
    expect(ok).toContain('data-decision-result="eligible"');
    expect(ok).toContain('Decision #5 recorded');
    expect(ok).toContain('Winner determined');
    expect(ok).toContain('player 1001 (30 votes)');

    const second = viewOf(determine([{ id: 1001, votes: 30, noRank: true }, { id: 1002, votes: 30, noRank: true }]));
    const refused: BrownlowEligibilityActionState = {
      error: 'Refused: stale', code: 'stale_decision', playerId: 1001,
      fieldErrors: { note: 'Write at least 20 characters explaining the ruling.' },
    };
    const markup = render(second, true, refused);
    expect(markup).toContain('Refused: stale');
    expect(markup).toContain('(stale_decision)');
    expect([...markup.matchAll(/data-field-error="note"/g)]).toHaveLength(1); // player 1001's form only, not 1002's
    expect(markup.indexOf('data-field-error="note"')).toBeLessThan(markup.indexOf('data-review-player="1002"'));
  });

  it('wraps long identities and never forces a no-wrap layout', () => {
    const view = viewOf(determine(MISSING_ROWS), {
      identities: [{ playerId: 1001, state: 'resolved', identity: `afltables:players/s/${'x'.repeat(300)}.html` }],
    });
    const markup = render(view, true);
    expect(markup).toContain('overflow-wrap:anywhere');
    expect(markup).not.toMatch(/white-space:\s*nowrap/);
  });

  it('the client wrapper and the views take only TYPES from server modules (nothing server-only can reach a browser bundle)', () => {
    const dir = join(process.cwd(), 'src', 'app', 'admin', 'operations', '_components');
    for (const file of ['BrownlowEligibilityClient.tsx', 'BrownlowDeterminationViews.tsx']) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gms)) {
        expect(match[1], `${file} value-imports ${match[1]}`).not.toMatch(/^@\/(db|lib)\/|^@afldb\/(db|derived)$|server-only/);
      }
    }
    expect(readFileSync(join(dir, 'BrownlowEligibilityClient.tsx'), 'utf8')).toMatch(/^'use client';/);
  });
});
