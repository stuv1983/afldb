/**
 * SYNTHETIC props for the AFLDB V2 Stage 5 operations-centre presentational components
 * (plan D9, ADR 0009; tests/v2-admin-operations-ui.test.ts and the component-level capture step).
 *
 * EVERY VALUE HERE IS SYNTHETIC unless a comment says it is derived from a committed file:
 *   - people are "Synthetic Player A" ... , identities are `afltables:players/S/Synthetic_Player_*.html`
 *     and `manual_admin_edit:SYNTHETIC-*`, emails end in `@example.invalid`, user ids are labels;
 *   - the award is `synthetic-medal`; season 2024 and 2090 are labels only;
 *   - run/batch ids, checksums and timestamps are invented;
 *   - the coverage health is DERIVED from the committed `COVERAGE_REGISTRY` (packages/domain), not
 *     invented; the Coleman derivation runs the real pure `deriveColeman` over the SYNTHETIC goal
 *     facts of tests/v2-coleman-publication-fixtures.ts.
 * Nothing here is, or may be presented as, real data. No database, network or clock is touched: every
 * timestamp is a constant.
 */
import type { DecisionRecord, ProposalHistory, ProposalRecord, ProposalStatus } from '@afldb/admin';
import {
  buildColemanComparisonReport,
  deriveColeman,
  type BrownlowReconciliationReport,
  type ColemanDerivationOutcome,
} from '@afldb/derived';
import { COVERAGE_REGISTRY, sealedSeasonsFrom, type SeasonRegistry } from '@afldb/domain';

import type { OperationsActionState } from '@/app/admin/operations/action-state';
import type { BrownlowStagingEvidence } from '@/db/queries/brownlow-reconciliation-inputs';
import type { ColemanComparisonView, ColemanPublicationView } from '@/lib/admin/operations-centre';

import type { OperationsOverview } from '@/app/admin/operations/page-data';
import {
  curatedLinksFor,
  inspectionLinksFor,
  loadedFail,
  loadedOk,
  sealedSeasonsView,
  summariseCoverage,
  summarisePending,
  unitRowView,
  type UnitStatusLike,
} from '@/app/admin/operations/views';

import { REGISTRY, makeInput, synthPath } from '../../../v2-coleman-publication-fixtures';

export const SYNTHETIC_NOTICE = 'SYNTHETIC: every value in this fixture is invented for a test or a capture; none is real data.';

/** SYNTHETIC signed-in users. */
export const SYNTHETIC_SUPER_ADMIN = {
  id: 9001, email: 'synthetic.super@example.invalid', role: 'super_admin', canManageAdmins: true, mustChangePassword: false,
} as const;
export const SYNTHETIC_PLAIN_ADMIN = {
  id: 9002, email: 'synthetic.admin@example.invalid', role: 'admin', canManageAdmins: false, mustChangePassword: false,
} as const;

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/** SYNTHETIC registry (the real file's shape): 2026 in progress, 1897-2025 sealed. */
export const SYNTHETIC_SEASON_REGISTRY: SeasonRegistry = {
  first_season: 1897,
  last_season: 2026,
  in_progress_seasons: [2026],
};

/** SYNTHETIC unit statuses: the AFL API units idle, the AFL Tables unit not installed on this host. */
const IDLE_UNIT = {
  loadState: 'loaded', phase: 'idle', activeState: 'inactive', result: 'success',
  inactiveEnterTimestamp: 'Mon 2026-10-19 04:30:12 AEDT',
};
const IDLE_STATUS: UnitStatusLike = {
  unit: IDLE_UNIT,
  unitError: null,
  latestRun: {
    batchId: '9000123', snapshotLabel: 'SYNTHETIC-SNAPSHOT-1', season: 2026, status: 'completed',
    completedAt: '2026-10-19 04:31:00', recordsRead: 1234, recordsRejected: 0,
  },
  latestRunError: null,
};

export const SYNTHETIC_UNIT_STATUSES = {
  afl_api: IDLE_STATUS,
  afl_api_brownlow: {
    ...IDLE_STATUS,
    unit: { ...IDLE_UNIT, phase: 'running', activeState: 'activating', inactiveEnterTimestamp: '' },
    latestRun: null,
  } satisfies UnitStatusLike,
  afltables: {
    unit: null,
    unitError: 'On-demand refresh is not enabled on this host.',
    latestRun: {
      batchId: '9000100', snapshotLabel: 'SYNTHETIC-SNAPSHOT-0', season: 2026, status: 'completed',
      completedAt: '2026-10-18 04:20:00', recordsRead: 4321, recordsRejected: 2,
    },
    latestRunError: null,
  } satisfies UnitStatusLike,
} as const;

/** The overview as a SUPER ADMIN sees it with every read succeeding. */
export function syntheticOverview(viewer: { role: 'admin' | 'super_admin'; canManageAdmins: boolean } = SYNTHETIC_SUPER_ADMIN): OperationsOverview {
  const sealed = sealedSeasonsFrom(SYNTHETIC_SEASON_REGISTRY);
  const curatedLinks = curatedLinksFor(viewer);
  return {
    coverage: loadedOk(summariseCoverage(COVERAGE_REGISTRY)),
    seasons: loadedOk(sealedSeasonsView(SYNTHETIC_SEASON_REGISTRY, sealed)),
    aflApiRuns: loadedOk([
      unitRowView('afl_api', 'AFL API match and player statistics settle', SYNTHETIC_UNIT_STATUSES.afl_api),
      unitRowView('afl_api_brownlow', 'AFL API Brownlow votes settle', SYNTHETIC_UNIT_STATUSES.afl_api_brownlow),
    ]),
    aflTablesRun: loadedOk(unitRowView('afltables', 'AFL Tables nightly settle (host timer)', SYNTHETIC_UNIT_STATUSES.afltables)),
    curatedLinks,
    pending: curatedLinks.some((link) => link.capability === 'data.awards.read')
      ? loadedOk(summarisePending([{ status: 'proposed' }, { status: 'validated' }, { status: 'approved' }]))
      : null,
    inspectionLinks: inspectionLinksFor(viewer),
  };
}

/** The same overview with the registry-backed reads failed: each section shows its own notice. */
export function syntheticOverviewReadsFailed(): OperationsOverview {
  const base = syntheticOverview();
  return {
    ...base,
    coverage: loadedFail('SYNTHETIC failure text: the coverage registry could not be summarised.'),
    seasons: loadedFail('SYNTHETIC failure text: the season registry could not be read.'),
    aflApiRuns: loadedFail('SYNTHETIC failure text: the run status could not be read.'),
    aflTablesRun: loadedFail('SYNTHETIC failure text: the run status could not be read.'),
    pending: loadedFail('SYNTHETIC failure text: this read failed unexpectedly.'),
  };
}

/* ------------------------------------------------------------------ *
 * Award proposals
 * ------------------------------------------------------------------ */

export function syntheticProposal(over: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    awardSlug: 'synthetic-medal',
    season: 2024,
    playerIdentity: 'afltables:players/S/Synthetic_Player_A.html',
    playerNameRaw: 'Synthetic Player A',
    clubSlug: 'synthetic-club-one',
    votes: '32',
    position: null,
    isCaptain: false,
    isViceCaptain: false,
    note: 'SYNTHETIC note',
    duplicateConfirmed: false,
    sourceKind: 'offline_file',
    sourceUrl: 'https://example.invalid/synthetic-source',
    citation: 'SYNTHETIC citation',
    acquiredOn: '2026-10-01',
    id: 501,
    proposalKey: '00000000-0000-4000-8000-000000000501',
    revision: 1,
    revisionOfId: null,
    status: 'validated',
    validationResult: { ok: true, issues: [], checkedAt: '2026-10-18T09:00:00Z' },
    validatedAt: '2026-10-18T09:00:00Z',
    approvedEntityKey: null,
    approvedAt: null,
    createdBy: 9001,
    createdAt: '2026-10-17T08:00:00Z',
    updatedAt: '2026-10-18T09:00:00Z',
    ...over,
  };
}

export const SYNTHETIC_QUEUE: ProposalRecord[] = [
  syntheticProposal({ id: 504, status: 'proposed', validationResult: null, validatedAt: null, playerNameRaw: 'Synthetic Player D', playerIdentity: null, votes: null }),
  syntheticProposal({
    id: 503, status: 'validation_failed', playerNameRaw: 'Synthetic Player C',
    validationResult: {
      ok: false,
      checkedAt: '2026-10-18T09:10:00Z',
      issues: [{ code: 'club_not_found', severity: 'error', field: 'clubSlug', message: "No club has the slug 'synthetic-club-none'." }],
    },
  }),
  syntheticProposal({ id: 502, status: 'rejected', playerNameRaw: 'Synthetic Player B' }),
  syntheticProposal({ id: 501, status: 'validated' }),
];

export function syntheticHistory(proposal: ProposalRecord = syntheticProposal()): ProposalHistory {
  const decision = (id: number, action: DecisionRecord['action'], fromStatus: ProposalStatus | null, toStatus: ProposalStatus, note: string | null): DecisionRecord => ({
    id, proposalId: proposal.id, action, fromStatus, toStatus, adminUserId: 9001,
    previousValues: null, newValues: null, note, decidedAt: `2026-10-18T09:0${id}:00Z`,
  });
  return {
    revisions: [proposal],
    decisions: [
      decision(1, 'create', null, 'proposed', null),
      decision(2, 'validate', 'proposed', 'validated', 'SYNTHETIC validation note'),
    ],
  };
}

/** A synthetic action state after a refused approval (sealed season, no note). */
export const SYNTHETIC_REFUSED_STATE: OperationsActionState = {
  error: 'A decision note of 20 to 2000 characters is required to approve into a sealed season.',
  code: 'season_sealed_correction_invalid',
  fieldErrors: { decisionNote: 'A decision note of 20 to 2000 characters is required to approve into a sealed season.' },
};

/* ------------------------------------------------------------------ *
 * Coleman
 * ------------------------------------------------------------------ */

const COMPARISON_AT = '2026-10-19T12:00:00Z';
const WINNER_A_KEY = `coleman:2024:${synthPath('A')}`;

function summary(outcome: ColemanDerivationOutcome): ColemanComparisonView['derivation'] {
  if (!outcome.ok) return { derivable: false, refusal: outcome.refusal };
  const r = outcome.result;
  return {
    derivable: true, season: r.season, methodVersion: r.methodVersion, derivationVersion: r.derivationVersion,
    derivedAt: r.derivedAt, inputChecksum: r.inputChecksum, minimumGoals: r.minimumGoals, maxGoals: r.maxGoals,
    tie: r.tie, winners: [...r.winners], leaderboardTop: r.leaderboard.slice(0, 5), leaderboardSize: r.leaderboard.length,
    counts: { ...r.counts },
  };
}

export const SYNTHETIC_PUBLICATION: ColemanPublicationView = {
  id: 7, season: 2024, methodVersion: 1, derivationVersion: 'SYNTHETIC-derivation-v1',
  inputChecksum: 'SYNTHETICCHECKSUM0123456789abcdef0123456789abcdef0123456789abcdef',
  derivedAt: '2026-10-19T11:00:00Z', publishedAt: '2026-10-19T11:05:00Z', publishedBy: 9001,
  supersedesId: null, winnerKeys: [WINNER_A_KEY],
};

export type ColemanKind = 'agree' | 'disagree' | 'not_derivable';

/** A comparison of the SYNTHETIC season 2024 goal facts, in each of the three categories. */
export function syntheticColemanComparison(kind: ColemanKind): ColemanComparisonView {
  const settled = kind !== 'not_derivable';
  const outcome = deriveColeman(makeInput({ seasonState: { registry: REGISTRY, settled } }));
  const stored = kind === 'agree'
    ? [{ season: 2024, playerId: 11, sourceKey: 'afltables', sourceRecordId: WINNER_A_KEY, status: 'active' }]
    : [];
  const report = buildColemanComparisonReport({ generatedAt: COMPARISON_AT, outcomes: [outcome], stored });
  return {
    season: 2024,
    settled,
    generatedAt: COMPARISON_AT,
    sealed: true,
    derivation: summary(outcome),
    report,
    current: kind === 'agree' ? SYNTHETIC_PUBLICATION : null,
    plan: outcome.ok ? (kind === 'agree' ? 'unchanged' : 'published') : null,
    // What publishing would do to award_winners (ADR 0015): agree = the one stored row is retained,
    // disagree = the one derived winner has no stored row yet, not derivable = no preview.
    projection: kind === 'not_derivable'
      ? null
      : {
        ok: true,
        counts: kind === 'agree'
          ? { inserted: 0, updated: 0, voided: 0, retained: 1 }
          : { inserted: 1, updated: 0, voided: 0, retained: 0 },
        changedCount: kind === 'agree' ? 0 : 1,
        actions: [{
          entityKey: `afltables:${WINNER_A_KEY}`,
          action: kind === 'agree' ? 'retained' : 'inserted',
          awardWinnerId: kind === 'agree' ? 1 : null,
        }],
      },
  };
}

/* ------------------------------------------------------------------ *
 * Brownlow
 * ------------------------------------------------------------------ */

type StagingKind = 'derived' | 'refused' | 'unstaged';

/** A hand-written SYNTHETIC staging summary (provider team ids SYN_T*, club ids 9001-9002). */
export function syntheticStaging(kind: StagingKind): BrownlowStagingEvidence {
  const unstaged = kind === 'unstaged';
  return {
    leaderboard: {
      staged: !unstaged,
      status: unstaged ? null : 'CONCLUDED',
      entries: unstaged ? 0 : 3,
      ineligibleEntries: unstaged ? 0 : 1,
      winnerEntries: unstaged ? 0 : 1,
      unresolvedPlayers: 0,
      absentEntries: 0,
    },
    teamMapping: kind === 'derived'
      ? {
        state: 'derived',
        fixtureMatches: 1,
        uncorroborated: [],
        entries: [
          { providerTeamId: 'SYN_T1', clubId: 9001, legacyClubHist: 'Synthetic Home', corroboratingSlots: 1 },
          { providerTeamId: 'SYN_T2', clubId: 9002, legacyClubHist: 'Synthetic Away', corroboratingSlots: 1 },
        ],
      }
      : kind === 'refused'
        ? {
          state: 'refused',
          fixtureMatches: 1,
          refusals: [{ code: 'fixture_evidence_conflict', providerTeamId: 'SYN_T1', detail: '1 fixture slot(s) name a club other than 9001' }],
        }
        : { state: 'not_attempted', reason: 'no_votes_staged' },
  };
}

type BrownlowKind = 'reconciled' | 'refused';

/** A hand-written SYNTHETIC report (season label 2090, players 1001-1003, provider ids SYN_*). */
export function syntheticBrownlowReport(kind: BrownlowKind): BrownlowReconciliationReport {
  const refused = kind === 'refused';
  return {
    format: 'afldb.v2.brownlow-reconciliation-report',
    formatVersion: 1,
    generatedAt: COMPARISON_AT,
    source: {
      sourceKey: 'afl_api',
      season: 2090,
      seasonState: 'complete',
      leaderboardStatus: null,
      evidence: { matchVoteRecords: 3, leaderboardEntries: null, storedRows: 3, contextMatches: 1 },
    },
    outcome: refused ? 'refused' : 'reconciled',
    findings: refused
      ? [{
        code: 'unresolved_player_identity',
        severity: 'refusal',
        providerMatchId: 'SYN_M1',
        playerId: null,
        providerPlayerId: 'SYN_P9',
        detail: { reason: 'SYNTHETIC: no stable player id for this provider player' },
      }]
      : [{
        code: 'club_unverifiable',
        severity: 'info',
        providerMatchId: 'SYN_M1',
        playerId: 1001,
        providerPlayerId: 'SYN_P1',
        detail: { reason: 'SYNTHETIC: provider team to club mapping is not committed' },
      }],
    findingCounts: refused ? { unresolved_player_identity: 1 } : { club_unverifiable: 1 },
    rawVotes: {
      basis: refused ? null : 'api_round_votes',
      matches: [],
      playerTotals: refused ? [] : [
        { playerId: 1001, votes: 3, matchesPolled: 1, eligible: true },
        { playerId: 1002, votes: 2, matchesPolled: 1, eligible: true },
        { playerId: 1003, votes: 1, matchesPolled: 1, eligible: false },
      ],
      topVoteGetters: refused ? [] : [
        { playerId: 1001, votes: 3, eligible: true },
        { playerId: 1002, votes: 2, eligible: true },
        { playerId: 1003, votes: 1, eligible: false },
      ],
      comparisons: {
        leaderboard: { state: 'not_supplied', compared: 0, mismatches: 0 },
        stored: { state: refused ? 'not_run' : 'compared', compared: refused ? 0 : 3, mismatches: 0 },
        storedInternal: { state: refused ? 'not_run' : 'compared', compared: refused ? 0 : 3, mismatches: 0 },
      },
    },
    awardResultPresentation: {
      status: refused ? 'refused_whole_set' : 'refused_eligibility_rule_unrecorded',
      refusalCode: refused ? 'unresolved_player_identity' : 'eligibility_rule_unrecorded',
      seasonState: 'complete',
      eligibilityRule: 'unrecorded',
      basis: refused ? null : 'api_round_votes',
      leaders: [],
      tie: null,
      providerClaims: { leaderboardWinners: null, leaderboardLeaders: null, storedWinners: null },
      note: 'SYNTHETIC note: no leader is stated while the eligibility rule is unrecorded.',
    },
  };
}
