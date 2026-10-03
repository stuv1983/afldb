/**
 * AFLDB-ISSUE-238 Slice 2: DB-free unit tests for the standalone pure
 * correction planner (`src/lib/acquisition/afl-api-identity-correction.ts`).
 * No database, filesystem, network or process-environment access. Case
 * numbers in comments refer to the runbook's §12.1 planned-case matrix
 * (`issues/closed/AFLDB-ISSUE-238.md`).
 */
import { describe, expect, it } from 'vitest';

import {
  PLANNER_VERSION,
  PLAYER_MATCH_STATS_CONTRACT_FIELDS,
  affectedCachePaths,
  artefactRecurrenceRisk,
  careerDebut,
  careersBeforeCorrection,
  dependentRefreshPath,
  describeSeasonVerdict,
  evaluateColemanImpact,
  evaluateFirstKickGoalDebutChanges,
  matchLessDependentReports,
  selectOpenFindings,
  selectPendingCandidates,
  unresolvedDependentReports,
  classifyBrownlowChain,
  classifyBrownlowChainApplication,
  classifyCorrectedCandidate,
  compareReconstruction,
  compareSubstantiveBrownlow,
  compareSubstantivePlayerMatchStats,
  decideBrownlowDisposition,
  decidePlayerMatchStatsDisposition,
  deriveCorrectedPromotionSet,
  detectPostCorrectionReappearance,
  evaluateBrownlowAttribution,
  evaluateBrownlowGuards,
  evaluateBrownlowMutationEligibility,
  evaluateBrownlowParticipation,
  evaluateCorrectionSatisfaction,
  evaluateCorrectionTargetAbsent,
  evaluateDeleteLineage,
  evaluateDependents,
  evaluateL8,
  evaluateMoveLineage,
  evaluatePlayerMatchStatsAttribution,
  evaluatePlayerMatchStatsMutationEligibility,
  evaluateSeasonTotalIndependence,
  evaluateWholePlanStops,
  mutationPlanFingerprint,
  reconstructContract,
  verifyBrownlowReleaseClaimPair,
  type Application,
  type BrownlowChainApplication,
  type BrownlowRowEvidence,
  type CareerMatch,
  type ClosureImpactRow,
  type ColemanRowFacts,
  type CorrectionReportContext,
  type CpcInput,
  type FindingScope,
  type OpenFindingRow,
  type PendingCandidateRow,
  type CpcPrediction,
  type CpcProviderRow,
  type DeleteLineageEvidence,
  type MoveLineageEvidence,
  type MutationPlan,
  type PlayerMatchStatsRowEvidence,
} from '@/lib/acquisition/afl-api-identity-correction';
import {
  describeManualAuthorityBlockers,
  manualAuthorityBlockersForMatch,
  type ContinuityRulesLoad,
  type MatchAuthorityRecord,
} from '@/lib/acquisition/match-sheet-authority';

function app(partial: Partial<Application> & Pick<Application, 'id' | 'verb' | 'newValues'>): Application {
  return {
    previousValues: null,
    sourceId: 'afl_api',
    externalRecordId: 'M1|RICH|CD_I1',
    sourceVersionSeq: 1,
    importBatchId: 100,
    ...partial,
  };
}

const PMS_CURRENT_BASE: Record<string, number | string | null> = {
  club_id: 1, jumper_number: '7',
  kicks: 10, marks: 5, handballs: 8, disposals: 18, goals: 2, behinds: 1, hitouts: 0, tackles: 3,
  rebounds: 0, inside_50s: 2, clearances: 1, clangers: 2, frees_for: 1, frees_against: 0,
  contested: 4, uncontested: 6, contested_marks: 1, marks_inside_50: 1, one_percenters: 2,
  bounces: 0, goal_assists: 0,
};

function pmsInsertApplication(): Application {
  return app({ id: 1, verb: 'insert', newValues: { ...PMS_CURRENT_BASE } });
}

function baselinePmsEvidence(overrides: Partial<PlayerMatchStatsRowEvidence> = {}): PlayerMatchStatsRowEvidence {
  return {
    sourceId: 'afl_api',
    sourceRecordId: 'M1|RICH|CD_I1',
    importBatchId: 100,
    applications: [pmsInsertApplication()],
    projectionPlayerId: null,
    currentPlayerId: 501,
    current: { ...PMS_CURRENT_BASE, brownlow_votes: null },
    expectedSourceRecordId: 'M1|RICH|CD_I1',
    expectedImportBatchId: 100,
    ...overrides,
  };
}

describe('reconstructContract / compareReconstruction (§5.8)', () => {
  it('reconstructs from NULL through an insert and reports no divergence when the row matches (case 20-ish, basic)', () => {
    const applications = [pmsInsertApplication()];
    const reconstruction = reconstructContract(PLAYER_MATCH_STATS_CONTRACT_FIELDS, applications);
    expect(reconstruction.chainConsistent).toBe(true);
    const divergences = compareReconstruction(
      reconstruction,
      { ...PMS_CURRENT_BASE, brownlow_votes: null },
      PLAYER_MATCH_STATS_CONTRACT_FIELDS,
    );
    expect(divergences).toEqual([]);
  });

  it('detects an out-of-ledger edit before correction (case 16)', () => {
    const applications = [pmsInsertApplication()];
    const reconstruction = reconstructContract(PLAYER_MATCH_STATS_CONTRACT_FIELDS, applications);
    const divergences = compareReconstruction(
      reconstruction,
      { ...PMS_CURRENT_BASE, kicks: 99, brownlow_votes: null },
      PLAYER_MATCH_STATS_CONTRACT_FIELDS,
    );
    expect(divergences).toEqual([{ field: 'kicks', reconstructed: 10, current: 99 }]);
  });

  it('flags a chain break when a later application\'s previous_values disagrees with the reconstruction', () => {
    const applications = [
      pmsInsertApplication(),
      app({ id: 2, verb: 'update', previousValues: { kicks: 999 }, newValues: { kicks: 11 } }),
    ];
    const reconstruction = reconstructContract(PLAYER_MATCH_STATS_CONTRACT_FIELDS, applications);
    expect(reconstruction.chainConsistent).toBe(false);
    expect(reconstruction.chainBreak?.field).toBe('kicks');
  });
});

describe('P1-P7 player_match_stats attribution and mutation eligibility (§5.2)', () => {
  it('passes attribution and mutation eligibility for a clean afl_api row', () => {
    const evidence = baselinePmsEvidence();
    expect(evaluatePlayerMatchStatsAttribution(evidence)).toEqual({ ok: true });
    expect(evaluatePlayerMatchStatsMutationEligibility(evidence)).toEqual({ ok: true });
  });

  it('STOPs with no_application_evidence when the application history is empty (missing lineage evidence)', () => {
    const evidence = baselinePmsEvidence({ applications: [] });
    const result = evaluatePlayerMatchStatsAttribution(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('no_application_evidence');
  });

  it('STOPs with mixed_provider_application_history when a history application is not afl_api', () => {
    const evidence = baselinePmsEvidence({
      applications: [pmsInsertApplication(), app({ id: 2, verb: 'update', sourceId: 'afltables', newValues: { kicks: 11 } })],
    });
    const result = evaluatePlayerMatchStatsAttribution(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('mixed_provider_application_history');
  });

  it('P6: STOPs with brownlow_state_present when brownlow_votes is not NULL (BG1 mutation guard)', () => {
    const evidence = baselinePmsEvidence({ current: { ...PMS_CURRENT_BASE, brownlow_votes: 0 } });
    expect(evaluatePlayerMatchStatsAttribution(evidence)).toEqual({ ok: true });
    const result = evaluatePlayerMatchStatsMutationEligibility(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('brownlow_state_present');
  });

  it('P7: STOPs with out_of_ledger_edit for an unmodelled statistic change', () => {
    const evidence = baselinePmsEvidence({ current: { ...PMS_CURRENT_BASE, goals: 55, brownlow_votes: null } });
    const result = evaluatePlayerMatchStatsMutationEligibility(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('out_of_ledger_edit');
  });

  it('P5: STOPs with projection_disagrees when a present projection names a different player', () => {
    const evidence = baselinePmsEvidence({ projectionPlayerId: 999, currentPlayerId: 501 });
    const result = evaluatePlayerMatchStatsAttribution(evidence);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('projection_disagrees');
  });
});

describe('C1-C11 player_match_stats disposition (§5.4)', () => {
  it('basic safe MOVE: no counterpart, brownlow_votes NULL (C1)', () => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: false, ownership: 'foreign', row: null },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: null },
      wouldViolateUniqueConstraint: false,
    });
    expect(result.disposition).toBe('MOVE');
  });

  it('basic safe collision DELETE: identical foreign counterpart (C2)', () => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { ...PMS_CURRENT_BASE } },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: null },
      wouldViolateUniqueConstraint: false,
    });
    expect(result.disposition).toBe('DELETE_AS_FOREIGN_COLLISION');
  });

  it('substantive collision mismatch STOPs and names the differing field (C3, case 10)', () => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { ...PMS_CURRENT_BASE, kicks: 20 } },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: null },
      wouldViolateUniqueConstraint: false,
    });
    expect(result.disposition).toBe('STOP');
    if (result.disposition === 'STOP') {
      expect(result.stop.code).toBe('collision_values_disagree');
      expect(result.stop.detail).toContain('kicks');
    }
  });

  it('a non-NULL brownlow_votes on the closure row STOPs even with an identical counterpart (C1b/C3, case 11)', () => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { ...PMS_CURRENT_BASE } },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: 0 },
      wouldViolateUniqueConstraint: false,
    });
    expect(result.disposition).toBe('STOP');
    if (result.disposition === 'STOP') expect(result.stop.code).toBe('brownlow_state_present');
  });

  it('an afl_api-owned counterpart always STOPs (C7)', () => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership: 'afl_api', row: { ...PMS_CURRENT_BASE } },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: null },
      wouldViolateUniqueConstraint: false,
    });
    expect(result.disposition).toBe('STOP');
    if (result.disposition === 'STOP') expect(result.stop.code).toBe('p_prime_holds_another_provider');
  });
});

describe('Whole-plan STOPs (§5.4)', () => {
  it('STOPs when P equals P\' (case 26)', () => {
    const stops = evaluateWholePlanStops({
      pEqualsPPrimeByPlayerId: true,
      pEqualsPPrimeByStableIdentity: false,
      pPrimeHoldsAnotherAflApiProvider: false,
      stableIdentityMissingOrAmbiguous: false,
      identityIsManualAdminEditToken: false,
      netStateAlreadyCorrected: false,
    });
    expect(stops.map((s) => s.code)).toContain('p_equals_p_prime');
  });

  it('STOPs when the identity is a manual_admin_edit token (O-2, case 25)', () => {
    const stops = evaluateWholePlanStops({
      pEqualsPPrimeByPlayerId: false,
      pEqualsPPrimeByStableIdentity: false,
      pPrimeHoldsAnotherAflApiProvider: false,
      stableIdentityMissingOrAmbiguous: false,
      identityIsManualAdminEditToken: true,
      netStateAlreadyCorrected: false,
    });
    expect(stops.map((s) => s.code)).toContain('manual_admin_edit_identity');
  });

  it('D8: STOPs when P\' already holds another AFL API provider (case 24)', () => {
    const stops = evaluateWholePlanStops({
      pEqualsPPrimeByPlayerId: false,
      pEqualsPPrimeByStableIdentity: false,
      pPrimeHoldsAnotherAflApiProvider: true,
      stableIdentityMissingOrAmbiguous: false,
      identityIsManualAdminEditToken: false,
      netStateAlreadyCorrected: false,
    });
    expect(stops.map((s) => s.code)).toContain('p_prime_holds_another_provider');
  });

  it('D7: STOPs when the stable identity is missing or ambiguous (previous identity unresolved)', () => {
    const stops = evaluateWholePlanStops({
      pEqualsPPrimeByPlayerId: false,
      pEqualsPPrimeByStableIdentity: false,
      pPrimeHoldsAnotherAflApiProvider: false,
      stableIdentityMissingOrAmbiguous: true,
      identityIsManualAdminEditToken: false,
      netStateAlreadyCorrected: false,
    });
    expect(stops.map((s) => s.code)).toContain('identity_unresolvable');
  });
});

describe('BG1-BG3 Brownlow admin-state guards (§5.9)', () => {
  it('BG1: STOPs when the paired player_match_stats brownlow_votes is not NULL', () => {
    const result = evaluateBrownlowGuards({
      playerMatchStatsBrownlowVotes: 2,
      foreignBrownlowRowAtEvent: false,
      entryStateNamesPlayer: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('brownlow_state_present');
    expect(result.ok ? null : result.stop.step).toBe('BG1');
  });

  it('BG2: STOPs on a foreign brownlow_round_votes dependency at the event', () => {
    const result = evaluateBrownlowGuards({
      playerMatchStatsBrownlowVotes: null,
      foreignBrownlowRowAtEvent: true,
      entryStateNamesPlayer: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('foreign_brownlow_dependency');
  });

  it('BG3: STOPs when the entry-state names the player in any slot, at any status', () => {
    const result = evaluateBrownlowGuards({
      playerMatchStatsBrownlowVotes: null,
      foreignBrownlowRowAtEvent: false,
      entryStateNamesPlayer: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('brownlow_entry_names_player');
  });

  it('passes when no guard fires', () => {
    const result = evaluateBrownlowGuards({
      playerMatchStatsBrownlowVotes: null,
      foreignBrownlowRowAtEvent: false,
      entryStateNamesPlayer: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe('C1c Brownlow-only MOVE participation (§5.4, D-P5-2)', () => {
  it('STOPs a Brownlow-only MOVE when P\' has no participation and played is not false (case 83)', () => {
    const result = evaluateBrownlowParticipation(true, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('brownlow_move_without_participation');
  });

  it('fails closed when played is NULL (counts as not false)', () => {
    const result = evaluateBrownlowParticipation(null, false);
    expect(result.ok).toBe(false);
  });

  it('allows the move when P\' participation is present', () => {
    const result = evaluateBrownlowParticipation(true, true);
    expect(result.ok).toBe(true);
  });
});

describe('B3-C Brownlow chain classification (§5.3)', () => {
  function chainApp(partial: Partial<BrownlowChainApplication> & Pick<BrownlowChainApplication, 'id' | 'verb' | 'newValues' | 'citedPayloadVoterCountForCdI' | 'citedPayloadVoteForCdI'>): BrownlowChainApplication {
    return {
      previousValues: null,
      sourceId: 'afl_api',
      externalRecordId: 'CD_M2',
      sourceVersionSeq: 1,
      importBatchId: 200,
      ...partial,
    };
  }

  it('case 2: an I244-F002 demotion (payload has no CD_I entry, votes drops to 0) (case 6)', () => {
    const demotion = chainApp({
      id: 10, verb: 'update', previousValues: { votes: 3 }, newValues: { votes: 0 },
      citedPayloadVoterCountForCdI: 0, citedPayloadVoteForCdI: null,
    });
    const result = classifyBrownlowChainApplication(demotion, 3);
    expect(result).toEqual({ ok: true, case: 2 });
  });

  it('demotion carrying match_id and played alongside votes: 0 is still case 2', () => {
    const demotion = chainApp({
      id: 10, verb: 'update', previousValues: { votes: 3, match_id: null, played: false },
      newValues: { votes: 0, match_id: 55, played: true },
      citedPayloadVoterCountForCdI: 0, citedPayloadVoteForCdI: null,
    });
    const result = classifyBrownlowChainApplication(demotion, 3);
    expect(result).toEqual({ ok: true, case: 2 });
  });

  it('case 3: an I244-F007 release -> claim pair (case 76)', () => {
    const release = chainApp({
      id: 20, verb: 'update', previousValues: { votes: 2 }, newValues: { votes: 0 },
      citedPayloadVoterCountForCdI: 1, citedPayloadVoteForCdI: 3,
    });
    const claim = chainApp({
      id: 21, verb: 'update', previousValues: { votes: 0 }, newValues: { votes: 3 },
      citedPayloadVoterCountForCdI: 1, citedPayloadVoteForCdI: 3,
    });
    const result = verifyBrownlowReleaseClaimPair(release, claim, 2);
    expect(result).toEqual({ ok: true, case: 3 });

    const chainResult = classifyBrownlowChain([release, claim], 2);
    expect(chainResult).toEqual({ ok: true, finalVotes: 3 });
  });

  it('a release with no adjacent matching claim is a STOP', () => {
    const release = chainApp({
      id: 20, verb: 'update', previousValues: { votes: 2 }, newValues: { votes: 0 },
      citedPayloadVoterCountForCdI: 1, citedPayloadVoteForCdI: 3,
    });
    const unrelated = chainApp({
      id: 22, verb: 'update', previousValues: { votes: 0 }, newValues: { votes: 0 },
      citedPayloadVoterCountForCdI: 1, citedPayloadVoteForCdI: 1,
      importBatchId: 999,
    });
    const chainResult = classifyBrownlowChain([release, unrelated], 2);
    expect(chainResult.ok).toBe(false);
  });
});

describe('B1-B5 Brownlow attribution and mutation eligibility (§5.3)', () => {
  it('accepts a clean insert-only row via projection', () => {
    const insertApplication = app({ id: 1, verb: 'insert', newValues: { played: true, votes: 3, match_id: 1 } });
    const result = evaluateBrownlowAttribution({
      sourceId: 'afl_api',
      sourceRecordId: 'CD_M1',
      expectedSourceRecordId: 'CD_M1',
      importBatchId: 100,
      expectedImportBatchId: 100,
      insertApplication,
      insertProvenByPayload: false,
      projectionPlayerId: 501,
      currentPlayerId: 501,
      chain: [],
      anotherProviderAlsoResolved: false,
      current: { played: true, votes: 3, matchId: 1 },
    });
    expect(result.ok).toBe(true);
  });

  it('STOPs brownlow_insert_unproven when neither payload nor projection proves the insert (case 8)', () => {
    const insertApplication = app({ id: 1, verb: 'insert', newValues: { played: true, votes: 3, match_id: 1 } });
    const result = evaluateBrownlowAttribution({
      sourceId: 'afl_api',
      sourceRecordId: 'CD_M1',
      expectedSourceRecordId: 'CD_M1',
      importBatchId: 100,
      expectedImportBatchId: 100,
      insertApplication,
      insertProvenByPayload: false,
      projectionPlayerId: null,
      currentPlayerId: 501,
      chain: [],
      anotherProviderAlsoResolved: false,
      current: { played: true, votes: 3, matchId: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('brownlow_insert_unproven');
  });

  it('B5: mutation eligibility STOPs on a votes divergence from the reconstruction', () => {
    const insertApplication = app({ id: 1, verb: 'insert', newValues: { played: true, votes: 3, match_id: 1 } });
    const evidence = {
      sourceId: 'afl_api',
      sourceRecordId: 'CD_M1',
      expectedSourceRecordId: 'CD_M1',
      importBatchId: 100,
      expectedImportBatchId: 100,
      insertApplication,
      insertProvenByPayload: true,
      projectionPlayerId: null,
      currentPlayerId: 501,
      chain: [],
      anotherProviderAlsoResolved: false,
      current: { played: true, votes: 99, matchId: 1 },
    };
    expect(evaluateBrownlowAttribution(evidence).ok).toBe(true);
    const eligibility = evaluateBrownlowMutationEligibility(evidence);
    expect(eligibility.ok).toBe(false);
    if (!eligibility.ok) expect(eligibility.stop.code).toBe('out_of_ledger_edit');
  });
});

describe('C1-C6 Brownlow disposition (§5.4)', () => {
  it('basic safe collision DELETE: both zero-vote, equal played/match_id (C4)', () => {
    const result = decideBrownlowDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { votes: 0, played: true, matchId: 5 } },
      closureRow: { votes: 0, played: true, matchId: 5 },
    });
    expect(result.disposition).toBe('DELETE_AS_FOREIGN_COLLISION');
  });

  it('STOPs a positive-vote destructive collision (C5)', () => {
    const result = decideBrownlowDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { votes: 3, played: true, matchId: 5 } },
      closureRow: { votes: 3, played: true, matchId: 5 },
    });
    expect(result.disposition).toBe('STOP');
    if (result.disposition === 'STOP') expect(result.stop.code).toBe('collision_values_disagree');
  });

  it('STOPs a zero-vote collision whose played/match_id disagree (C6)', () => {
    const result = decideBrownlowDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { votes: 0, played: false, matchId: null } },
      closureRow: { votes: 0, played: true, matchId: 5 },
    });
    expect(result.disposition).toBe('STOP');
    if (result.disposition === 'STOP') expect(result.stop.code).toBe('collision_values_disagree');
  });
});

describe('§5.6 lineage: L1-L7 already-corrected MOVE (case 20)', () => {
  const goodEvidence = {
    correctionApplication: {
      id: 5, verb: 'update' as const, previousValues: { player_id: 501 }, newValues: { player_id: 502 },
      sourceId: 'afl_api', externalRecordId: 'M1|RICH|CD_I1', sourceVersionSeq: 1, importBatchId: 300,
      targetKey: { player_id: 502, match_id: 1 },
    },
    boundBatchCount: 1,
    previousPlayerId: 501,
    nextPlayerId: 502,
    keyComponentsMatch: true,
    bindsToOldHistory: true,
    preCorrectionHistoryNonEmpty: true,
    preCorrectionAttributionOk: true,
    preCorrectionChainConsistent: true,
    rowProofMatches: true,
    joinIsUnique: true,
    postCorrectionHistoryAllThroughCdI: true,
  };

  it('passes L1-L7 for a well-formed already-corrected MOVE', () => {
    expect(evaluateMoveLineage(goodEvidence)).toEqual({ ok: true });
  });

  it('L7: STOPs mixed_provider_after_correction when a later write is not through CD_I', () => {
    const result = evaluateMoveLineage({ ...goodEvidence, postCorrectionHistoryAllThroughCdI: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('mixed_provider_after_correction');
  });

  it('L5: STOPs row_proof_mismatch when the recorded contract hash disagrees (case 93)', () => {
    const result = evaluateMoveLineage({ ...goodEvidence, rowProofMatches: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('row_proof_mismatch');
  });

  it('L6: STOPs ambiguous_correction when the join is not unique', () => {
    const result = evaluateMoveLineage({ ...goodEvidence, joinIsUnique: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('ambiguous_correction');
  });
});

describe('L8 post-correction classification (§5.6, §5.12) and post_correction_edit (pass 5)', () => {
  it('post-correction Brownlow finalisation remains satisfied (case 69): brownlow_votes divergence explained by an audited finalise', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: true,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [{ field: 'brownlow_votes', reconstructed: null, current: 3 }],
      explanations: new Map([['brownlow_votes', { field: 'brownlow_votes', writer: 'brownlow_admin', auditId: 'audit-1' }]]),
      table: 'player_match_stats',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.postCorrectionEdits).toHaveLength(1);
  });

  it('post-correction match-sheet edit remains satisfied (case 70)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: true,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [{ field: 'kicks', reconstructed: 10, current: 12 }],
      explanations: new Map([['kicks', { field: 'kicks', writer: 'match_sheet', auditId: 'audit-2' }]]),
      table: 'player_match_stats',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(true);
  });

  it('an unexplained post-correction divergence STOPs (case 71)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: true,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [{ field: 'contested', reconstructed: 4, current: 9 }],
      explanations: new Map(),
      table: 'player_match_stats',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('post_correction_edit_unexplained');
  });

  it('R238-P5-01: a legitimate match_id NULL -> M resolve remains explainable on an afl_api-owned Brownlow row (case 99)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: true,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [{ field: 'match_id', reconstructed: null, current: 7 }],
      explanations: new Map([['match_id', { field: 'match_id', writer: 'brownlow_admin', auditId: 'audit-3' }]]),
      table: 'brownlow_round_votes',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(true);
  });

  it('R238-P5-01: an unaudited votes/played divergence on an afl_api-owned Brownlow row STOPs even with a brownlow_admin explanation for that field (case 98)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: true,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [{ field: 'votes', reconstructed: 0, current: 3 }],
      explanations: new Map([['votes', { field: 'votes', writer: 'brownlow_admin', auditId: 'draft-audit' }]]),
      table: 'brownlow_round_votes',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('post_correction_edit_unexplained');
  });

  it('a votes/played divergence together with re-ownership is explained (brownlow_admin_reowned, L8-b\', case 94)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: false,
      reownedByBrownlowAdmin: true,
      reownershipAuditOk: true,
      projectionOk: true,
      divergences: [{ field: 'votes', reconstructed: 0, current: 2 }],
      explanations: new Map([['votes', { field: 'votes', writer: 'brownlow_admin_reowned', auditId: 'audit-4' }]]),
      table: 'brownlow_round_votes',
      stillAflApiOwned: false,
    });
    expect(result.ok).toBe(true);
  });

  it('STOPs ownership_or_stamp_contradicts when ownership/stamps no longer match and there is no re-ownership audit (case 97)', () => {
    const result = evaluateL8({
      rowExists: true,
      ownershipAndStampsOk: false,
      reownedByBrownlowAdmin: false,
      reownershipAuditOk: false,
      projectionOk: true,
      divergences: [],
      explanations: new Map(),
      table: 'player_match_stats',
      stillAflApiOwned: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stop.code).toBe('ownership_or_stamp_contradicts');
  });
});

describe('correction_target_absent (C14), narrowed pass 5a R238-P5-02 (cases 14, 15)', () => {
  it('player_match_stats: satisfied when a durable match_deletion audit explains the absence (case 14)', () => {
    const result = evaluateCorrectionTargetAbsent({
      table: 'player_match_stats',
      rowExists: false,
      matchDeletedAuditAfterCorrection: true,
      matchStillExists: false,
    });
    expect(result.satisfied).toBe(true);
    expect(result.noop).toBe('correction_target_absent');
  });

  it('player_match_stats: STOPs when there is no durable match_deletion audit (case 15)', () => {
    const result = evaluateCorrectionTargetAbsent({
      table: 'player_match_stats',
      rowExists: false,
      matchDeletedAuditAfterCorrection: false,
      matchStillExists: true,
    });
    expect(result.satisfied).toBe(false);
    expect(result.stop?.code).toBe('correction_target_absent_unexplained');
  });

  it('brownlow_round_votes: absence is ALWAYS a STOP, even with a match_deletion audit (R238-P5-02)', () => {
    const result = evaluateCorrectionTargetAbsent({
      table: 'brownlow_round_votes',
      rowExists: false,
      matchDeletedAuditAfterCorrection: true,
      matchStillExists: false,
    });
    expect(result.satisfied).toBe(false);
    expect(result.stop?.code).toBe('correction_target_absent_unexplained');
  });

  it('a row that exists is trivially satisfied (not absent)', () => {
    const result = evaluateCorrectionTargetAbsent({
      table: 'player_match_stats', rowExists: true, matchDeletedAuditAfterCorrection: false, matchStillExists: true,
    });
    expect(result.satisfied).toBe(true);
    expect(result.noop).toBeUndefined();
  });
});

describe('post_correction_reappearance (pass 5a, R238-P5-05, case 101)', () => {
  it('reports a new, non-CD_I-attributed row at the vacated old key distinctly', () => {
    const result = detectPostCorrectionReappearance({ rowExistsAtOldKey: true, attributedThroughCdI: false });
    expect(result.reappeared).toBe(true);
  });

  it('does not flag a row that IS CD_I-attributed (that is unmoved_closure_row territory, SAT-5)', () => {
    const result = detectPostCorrectionReappearance({ rowExistsAtOldKey: true, attributedThroughCdI: true });
    expect(result.reappeared).toBe(false);
  });

  it('does not flag when no row exists at the old key', () => {
    const result = detectPostCorrectionReappearance({ rowExistsAtOldKey: false, attributedThroughCdI: false });
    expect(result.reappeared).toBe(false);
  });
});

describe('MUTATION ELIGIBILITY vs CORRECTION SATISFACTION (§5.12, SAT-1...SAT-5)', () => {
  const satBase = {
    identityResolvedToPPrime: true,
    ledgerNetStateIsCorrected: true,
    ledgerChainValid: true,
    boundBatchCount: 1,
    boundBatchIsCompletedOrCurrent: true,
    moveLineageResults: [{ ok: true } as const],
    deleteLineageResults: [],
    unmovedClosureRowAtP: false,
    laterApplicationAtOldKeyThroughCdI: false,
    secondCorrectedRowForExternalId: false,
  };

  it('passes when every SAT check holds (idempotency proof)', () => {
    expect(evaluateCorrectionSatisfaction(satBase)).toEqual({ satisfied: true });
  });

  it('SAT-5: STOPs unmoved_closure_row when a CD_I-attributed row remains at P (never masked as post_correction_edit, case 95)', () => {
    const result = evaluateCorrectionSatisfaction({ ...satBase, unmovedClosureRowAtP: true });
    expect(result.satisfied).toBe(false);
    if (!result.satisfied) expect(result.stop.code).toBe('unmoved_closure_row');
  });

  it('SAT-2: STOPs ambiguous_correction when more than one bound batch exists', () => {
    const result = evaluateCorrectionSatisfaction({ ...satBase, boundBatchCount: 2 });
    expect(result.satisfied).toBe(false);
    if (!result.satisfied) expect(result.stop.code).toBe('ambiguous_correction');
  });

  it('mutation eligibility (Q1) and correction satisfaction (Q2) are genuinely distinct calls over the same row', () => {
    // Q1 (mutation eligibility) re-runs P6/P7; a non-NULL brownlow_votes STOPs it.
    const q1 = evaluatePlayerMatchStatsMutationEligibility(
      baselinePmsEvidence({ current: { ...PMS_CURRENT_BASE, brownlow_votes: 3 } }),
    );
    expect(q1.ok).toBe(false);
    // Q2 (correction satisfaction) never re-runs P6/P7/BG1: it can PASS on
    // exactly the same evidence when the durable lineage is intact, because
    // it evaluates L8/SAT, not P6/P7.
    const q2 = evaluateCorrectionSatisfaction(satBase);
    expect(q2.satisfied).toBe(true);
  });
});

describe('§5.11 special-record dependents (DP-1...DP-5)', () => {
  it('DP-1: STOPs on an after_siren_kicks dependent (case 18)', () => {
    const result = evaluateDependents({
      afterSirenKicksRowForP: true, achievementRowForP: false, unresolvedRowAtMatch: false,
      matchLessDependentLosesParticipation: false, matchLessDependentParticipationRemains: false,
      firstKickGoalTieBreakChanges: false,
    });
    expect(result.stops.map((s) => s.code)).toContain('dependent_record_would_be_stale');
    expect(result.stops[0].step).toBe('DP-1');
  });

  it('DP-2: STOPs on a player_achievements dependent (case 19)', () => {
    const result = evaluateDependents({
      afterSirenKicksRowForP: false, achievementRowForP: true, unresolvedRowAtMatch: false,
      matchLessDependentLosesParticipation: false, matchLessDependentParticipationRemains: false,
      firstKickGoalTieBreakChanges: false,
    });
    expect(result.stops.map((s) => s.code)).toContain('dependent_record_would_be_stale');
    expect(result.stops[0].step).toBe('DP-2');
  });

  it('DP-4: STOPs when a match-less dependent loses its justifying participation (case 85)', () => {
    const result = evaluateDependents({
      afterSirenKicksRowForP: false, achievementRowForP: false, unresolvedRowAtMatch: false,
      matchLessDependentLosesParticipation: true, matchLessDependentParticipationRemains: false,
      firstKickGoalTieBreakChanges: false,
    });
    expect(result.stops.some((s) => s.step === 'DP-4')).toBe(true);
  });

  it('DP-4: reports (does not STOP) when participation remains sufficient', () => {
    const result = evaluateDependents({
      afterSirenKicksRowForP: false, achievementRowForP: false, unresolvedRowAtMatch: false,
      matchLessDependentLosesParticipation: false, matchLessDependentParticipationRemains: true,
      firstKickGoalTieBreakChanges: false,
    });
    expect(result.stops).toEqual([]);
    expect(result.reports.some((r) => r.startsWith('DP-4'))).toBe(true);
  });
});

describe('§5.10 season-total artefact independence predicate (SV-0, SV-1, SV-2a)', () => {
  it('SV-0: an empty season is independent', () => {
    expect(evaluateSeasonTotalIndependence({ kind: 'empty' })).toEqual({ independent: true });
  });

  it('SV-1: STOPs season_total_depends_on_correction when an admin-published season depends on the corrected facts', () => {
    const result = evaluateSeasonTotalIndependence({
      kind: 'admin_published',
      closureMovesOrDeletesPositiveBrownlowRowInSeason: true,
      pOrPPrimeHasRowInSeasonTotals: false,
    });
    expect(result.independent).toBe(false);
    if (!result.independent) expect(result.stop.code).toBe('season_total_depends_on_correction');
  });

  it('SV-2a: independent only when every executable step passes, including the identity.csv_sha256 binding (pass 5a, R238-P5-06, case 82)', () => {
    const pass = evaluateSeasonTotalIndependence({
      kind: 'artefact_schema_1',
      artefactCsvSha256Matches: true,
      identityCsvSha256Matches: true,
      rowForRowMatch: true,
      profilePathResolvesToExactlyOnePlayer: true,
    });
    expect(pass.independent).toBe(true);

    const failsOnIdentityHash = evaluateSeasonTotalIndependence({
      kind: 'artefact_schema_1',
      artefactCsvSha256Matches: true,
      identityCsvSha256Matches: false,
      rowForRowMatch: true,
      profilePathResolvesToExactlyOnePlayer: true,
    });
    expect(failsOnIdentityHash.independent).toBe(false);
    if (!failsOnIdentityHash.independent) expect(failsOnIdentityHash.stop.code).toBe('season_artefact_unprovable');
  });

  it('SV-3: unprovable independence is a STOP', () => {
    const result = evaluateSeasonTotalIndependence({ kind: 'unprovable' });
    expect(result.independent).toBe(false);
    if (!result.independent) expect(result.stop.code).toBe('season_artefact_unprovable');
  });
});

describe('fingerprint (§5.1, pass 5 P4-03)', () => {
  const basePlan: MutationPlan = {
    plannerVersion: PLANNER_VERSION,
    provider: { externalId: 'CD_I1', sourceKey: 'afl_api' },
    authority: {
      mode: 'ORIGINAL', netState: 'LINKED', ledgerId: 10, liveIdentityRowId: 20,
      previousPlayerIdentity: 'afltables:players/A/A_One.html', playerIdentity: 'afltables:players/B/B_Two.html',
    },
    identityAction: 'update_in_place',
    rows: [{
      table: 'player_match_stats', rowId: 1, naturalKey: { player_id: 502, match_id: 1 },
      disposition: 'MOVE', contractSha256: 'abc', provenance: { sourceKey: 'afl_api', sourceRecordId: 'M1|RICH|CD_I1', importBatchId: 100 },
      evidence: {
        applicationIds: [11, 12],
        citedVersion: { sourceId: 7, family: 'player_stats', externalRecordId: 'M1|RICH|CD_I1', seq: 3 },
        insertPayloadSha256: null,
      },
      collision: null,
    }],
    stops: [],
  };
  const withRow = (patch: Partial<MutationPlan['rows'][number]>): MutationPlan => ({
    ...basePlan, rows: [{ ...basePlan.rows[0], ...patch }],
  });
  const fp = mutationPlanFingerprint;
  const collided = {
    counterpartRowId: 900, counterpartContractSha256: 'ccc', outcome: 'C2' as const,
  };

  it('PLANNER_VERSION is 2 (S6-D1: evidence and collision are fingerprinted)', () => {
    expect(PLANNER_VERSION).toBe(2);
  });

  it('is sensitive to each row contract/disposition/collision/evidence field independently (runbook §5.1)', () => {
    const base = fp(basePlan);
    const variants: MutationPlan[] = [
      withRow({ contractSha256: 'abd' }),
      withRow({ disposition: 'DELETE_AS_FOREIGN_COLLISION' }),
      withRow({ collision: collided }),
      withRow({ collision: { ...collided, counterpartRowId: 901 } }),
      withRow({ collision: { ...collided, counterpartContractSha256: 'ddd' } }),
      withRow({ collision: { ...collided, outcome: 'C4' } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, applicationIds: [11, 12, 13] } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, citedVersion: { ...basePlan.rows[0].evidence.citedVersion, sourceId: 8 } } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, citedVersion: { ...basePlan.rows[0].evidence.citedVersion, family: 'other' } } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, citedVersion: { ...basePlan.rows[0].evidence.citedVersion, externalRecordId: 'M2|RICH|CD_I1' } } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, citedVersion: { ...basePlan.rows[0].evidence.citedVersion, seq: 4 } } }),
      withRow({ evidence: { ...basePlan.rows[0].evidence, insertPayloadSha256: 'e'.repeat(64) } }),
      { ...basePlan, stops: [{ table: 'player_match_stats', rowId: 1, step: 'C3', code: 'collision_values_disagree' }] },
      { ...basePlan, plannerVersion: PLANNER_VERSION + 1 },
      { ...basePlan, identityAction: 'upgrade_in_place' },
    ];
    const hashes = variants.map(fp);
    for (const h of hashes) expect(h).not.toBe(base);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('is insensitive to applicationIds order, to context, and to PREDICT vs ADJUDICATION mode (J-1)', () => {
    expect(fp(withRow({ evidence: { ...basePlan.rows[0].evidence, applicationIds: [12, 11] } }))).toBe(fp(basePlan));
    const withContext = { ...basePlan, context: { anything: 1 } } as unknown as MutationPlan;
    expect(fp(withContext)).toBe(fp(basePlan));
    const auth = { adjudicationId: 5, externalId: 'CD_I1', evidenceSha256: 'f'.repeat(64), previousPlayerIdentity: 'a', playerIdentity: 'b' };
    const predict: MutationPlan = { ...basePlan, authority: { mode: 'PREDICT', ...auth } };
    const replay: MutationPlan = { ...basePlan, authority: { mode: 'ADJUDICATION', ...auth } };
    expect(fp(predict)).toBe(fp(replay));
    expect(predict.authority.mode).toBe('PREDICT');
  });

  it('is stable for the same logical plan (§6 prediction and §7.4e replay must hash identically)', () => {
    const again: MutationPlan = { ...basePlan, rows: [...basePlan.rows] };
    expect(mutationPlanFingerprint(basePlan)).toBe(mutationPlanFingerprint(again));
  });

  it('is insensitive to row order (rows are sorted before hashing)', () => {
    const secondRow = { ...basePlan.rows[0], rowId: 2, table: 'brownlow_round_votes' as const, naturalKey: { season: 2024, player_id: 502, round_number: 1 } };
    const planA: MutationPlan = { ...basePlan, rows: [basePlan.rows[0], secondRow] };
    const planB: MutationPlan = { ...basePlan, rows: [secondRow, basePlan.rows[0]] };
    expect(mutationPlanFingerprint(planA)).toBe(mutationPlanFingerprint(planB));
  });

  it('is sensitive to a mutation-relevant change (a different disposition)', () => {
    const changed: MutationPlan = {
      ...basePlan,
      rows: [{ ...basePlan.rows[0], disposition: 'DELETE_AS_FOREIGN_COLLISION' }],
    };
    expect(mutationPlanFingerprint(basePlan)).not.toBe(mutationPlanFingerprint(changed));
  });

  it('is sensitive to plannerVersion', () => {
    const changed: MutationPlan = { ...basePlan, plannerVersion: PLANNER_VERSION + 1 };
    expect(mutationPlanFingerprint(basePlan)).not.toBe(mutationPlanFingerprint(changed));
  });

  it('is sensitive to the STOP set', () => {
    const withStop: MutationPlan = {
      ...basePlan,
      stops: [{ table: 'player_match_stats', rowId: 1, step: 'C3', code: 'collision_values_disagree' }],
    };
    expect(mutationPlanFingerprint(basePlan)).not.toBe(mutationPlanFingerprint(withStop));
  });

  it('is insensitive to STOP order (stops are sorted before hashing, mirroring row-order independence)', () => {
    const stopA = { table: 'brownlow_round_votes' as const, rowId: 1, step: 'BG2', code: 'foreign_brownlow_dependency' as const };
    const stopB = { table: 'player_match_stats' as const, rowId: 2, step: 'C3', code: 'collision_values_disagree' as const };
    const planA: MutationPlan = { ...basePlan, stops: [stopA, stopB] };
    const planB: MutationPlan = { ...basePlan, stops: [stopB, stopA] };
    expect(mutationPlanFingerprint(planA)).toBe(mutationPlanFingerprint(planB));
  });
});

describe('CPC classifier classifyCorrectedCandidate / deriveCorrectedPromotionSet (§9.1, S6-D4)', () => {
  const zero = { player_match_stats: 0, brownlow_round_votes: 0 };
  const okPrediction: CpcPrediction = {
    stops: [], moveOrDeleteRowCount: 2, fingerprint: 'fp1', plannerVersion: PLANNER_VERSION,
    moved: { player_match_stats: 2, brownlow_round_votes: 0 }, deleted: zero,
  };
  const providerRow = (over: Partial<CpcProviderRow> = {}): CpcProviderRow => ({
    id: 40, playerId: 100, status: 'resolved', matchMethod: 'importer', importerOwned: true, ...over,
  });
  const input = (over: Partial<CpcInput> = {}): CpcInput => ({
    externalId: 'CD_I1', adjudicationId: 5,
    pc: { kind: 'unique', playerId: 100 }, pPrime: { kind: 'unique', playerId: 200 },
    providerRow: providerRow(),
    collisions: { candidateImporterProvidersAtPPrime: [], targetHumanProvidersRemappingToPPrime: [] },
    pcStillImplicated: { rowsImplicatingCdIAtPc: 0, unprovableCdILineage: false },
    prediction: okPrediction,
    ...over,
  });

  it('class 1: importer row at Pc -> update_in_place', () => {
    const r = classifyCorrectedCandidate(input());
    expect(r).toMatchObject({
      outcome: 'PASS', candidateClass: 1, predictedIdentityAction: 'update_in_place', providerRowId: 40,
      predictedClosureFingerprint: 'fp1', plannerVersion: PLANNER_VERSION,
    });
  });

  it('class 2: importer row already at P\'c -> upgrade_in_place, only with an empty closure', () => {
    const empty: CpcPrediction = { ...okPrediction, moveOrDeleteRowCount: 0, moved: zero };
    expect(classifyCorrectedCandidate(input({ providerRow: providerRow({ playerId: 200 }), prediction: empty })))
      .toMatchObject({ outcome: 'PASS', candidateClass: 2, predictedIdentityAction: 'upgrade_in_place' });
    expect(classifyCorrectedCandidate(input({ providerRow: providerRow({ playerId: 200 }) })))
      .toMatchObject({ outcome: 'FAIL', code: 'IDENTITY_ONLY_CLOSURE_NOT_EMPTY', candidateClass: 2 });
  });

  it('class 3: no row -> insert; PC_STILL_IMPLICATED on either half', () => {
    expect(classifyCorrectedCandidate(input({ providerRow: null })))
      .toMatchObject({ outcome: 'PASS', candidateClass: 3, predictedIdentityAction: 'insert', providerRowId: null });
    expect(classifyCorrectedCandidate(input({ providerRow: null, pcStillImplicated: { rowsImplicatingCdIAtPc: 1, unprovableCdILineage: false } })))
      .toMatchObject({ outcome: 'FAIL', code: 'PC_STILL_IMPLICATED', candidateClass: 3 });
    expect(classifyCorrectedCandidate(input({ providerRow: null, pcStillImplicated: { rowsImplicatingCdIAtPc: 0, unprovableCdILineage: true } })))
      .toMatchObject({ outcome: 'FAIL', code: 'PC_STILL_IMPLICATED', candidateClass: 3 });
  });

  it('class 4: row at a third identity -> DISAGREE', () => {
    expect(classifyCorrectedCandidate(input({ providerRow: providerRow({ playerId: 300 }) })))
      .toMatchObject({ outcome: 'FAIL', code: 'DISAGREE', candidateClass: 4 });
  });

  it('class 5: both collision sources -> COLLISION; CD_I itself is excluded', () => {
    expect(classifyCorrectedCandidate(input({ collisions: { candidateImporterProvidersAtPPrime: ['CD_I2'], targetHumanProvidersRemappingToPPrime: [] } })))
      .toMatchObject({ outcome: 'FAIL', code: 'COLLISION', candidateClass: 5 });
    expect(classifyCorrectedCandidate(input({ collisions: { candidateImporterProvidersAtPPrime: [], targetHumanProvidersRemappingToPPrime: ['CD_I3'] } })))
      .toMatchObject({ outcome: 'FAIL', code: 'COLLISION', candidateClass: 5 });
    expect(classifyCorrectedCandidate(input({ collisions: { candidateImporterProvidersAtPPrime: ['CD_I1'], targetHumanProvidersRemappingToPPrime: ['CD_I1'] } })))
      .toMatchObject({ outcome: 'PASS', candidateClass: 1 });
  });

  it('class 6: any PREDICT STOP (or no / stale-version prediction) -> PREDICT_STOP', () => {
    const stopped: CpcPrediction = { ...okPrediction, stops: [{ code: 'brownlow_state_present', step: 'C1b' }] };
    expect(classifyCorrectedCandidate(input({ prediction: stopped })))
      .toMatchObject({ outcome: 'FAIL', code: 'PREDICT_STOP', candidateClass: 6, detail: 'brownlow_state_present' });
    expect(classifyCorrectedCandidate(input({ prediction: null })))
      .toMatchObject({ outcome: 'FAIL', code: 'PREDICT_STOP', candidateClass: 6 });
    expect(classifyCorrectedCandidate(input({ prediction: { ...okPrediction, plannerVersion: PLANNER_VERSION - 1 } })))
      .toMatchObject({ outcome: 'FAIL', code: 'PREDICT_STOP', candidateClass: 6 });
  });

  it('UNEVALUABLE: every reason, on either side, plus Pc = P\'c and a human provider row', () => {
    for (const reason of ['manual_admin_token', 'unresolved', 'ambiguous'] as const) {
      expect(classifyCorrectedCandidate(input({ pc: { kind: 'unevaluable', reason } })))
        .toMatchObject({ outcome: 'FAIL', code: 'UNEVALUABLE', candidateClass: null });
      const r = classifyCorrectedCandidate(input({ pPrime: { kind: 'unevaluable', reason } }));
      expect(r).toMatchObject({ outcome: 'FAIL', code: 'UNEVALUABLE', candidateClass: null });
      if (r.outcome === 'FAIL') expect(r.detail).toContain(reason);
    }
    expect(classifyCorrectedCandidate(input({ pPrime: { kind: 'unique', playerId: 100 } })))
      .toMatchObject({ outcome: 'FAIL', code: 'UNEVALUABLE' });
    expect(classifyCorrectedCandidate(input({ providerRow: providerRow({ importerOwned: false, status: 'linked' }) })))
      .toMatchObject({ outcome: 'FAIL', code: 'UNEVALUABLE' });
  });

  it('precedence: UNEVALUABLE > COLLISION > DISAGREE > PREDICT_STOP > class-specific', () => {
    const stopped: CpcPrediction = { ...okPrediction, stops: [{ code: 'p_equals_p_prime' }] };
    const collisions = { candidateImporterProvidersAtPPrime: ['CD_I2'], targetHumanProvidersRemappingToPPrime: [] };
    const third = providerRow({ playerId: 300 });
    expect(classifyCorrectedCandidate(input({ pc: { kind: 'unevaluable', reason: 'unresolved' }, collisions, providerRow: third, prediction: stopped })))
      .toMatchObject({ code: 'UNEVALUABLE' });
    expect(classifyCorrectedCandidate(input({ collisions, providerRow: third, prediction: stopped }))).toMatchObject({ code: 'COLLISION' });
    expect(classifyCorrectedCandidate(input({ providerRow: third, prediction: stopped }))).toMatchObject({ code: 'DISAGREE' });
    expect(classifyCorrectedCandidate(input({ providerRow: providerRow({ playerId: 200 }), prediction: stopped })))
      .toMatchObject({ code: 'PREDICT_STOP' });
  });

  it('deriveCorrectedPromotionSet: sorted class 1-3 set; FAIL, overlap and duplicates are problems', () => {
    const empty: CpcPrediction = { ...okPrediction, moveOrDeleteRowCount: 0, moved: zero };
    const a = classifyCorrectedCandidate(input({ externalId: 'CD_B' }));
    const b = classifyCorrectedCandidate(input({ externalId: 'CD_A', providerRow: null, prediction: empty }));
    expect(deriveCorrectedPromotionSet([a, b], new Set(['CD_Z']))).toEqual({ ok: true, cPromotion: ['CD_A', 'CD_B'] });
    expect(deriveCorrectedPromotionSet([], new Set())).toEqual({ ok: true, cPromotion: [] });

    const failed = classifyCorrectedCandidate(input({ externalId: 'CD_C', providerRow: providerRow({ playerId: 300 }) }));
    const r1 = deriveCorrectedPromotionSet([a, failed], new Set());
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.problems.join('\n')).toContain('CD_C: CPC FAIL DISAGREE');

    const r2 = deriveCorrectedPromotionSet([a, b], new Set(['CD_A']));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems).toEqual(['CD_A: in both C_promotion and E_promotion (must be disjoint)']);

    const r3 = deriveCorrectedPromotionSet([a, a], new Set());
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.problems[0]).toContain('duplicate');
  });
});

describe('cross-cutting: substantive comparison helpers used by both dispositions and satisfaction (§5.5)', () => {
  it('player_match_stats: NULL vs 0 is a difference, never equal', () => {
    const comparison = compareSubstantivePlayerMatchStats(
      { ...PMS_CURRENT_BASE, kicks: null },
      { ...PMS_CURRENT_BASE, kicks: 0 },
    );
    expect(comparison.equal).toBe(false);
    expect(comparison.differingFields.map((d) => d.field)).toContain('kicks');
  });

  it('brownlow: both votes = 0 counts as equal even if NULL would not', () => {
    const comparison = compareSubstantiveBrownlow(
      { votes: 0, played: true, matchId: 1 },
      { votes: 0, played: true, matchId: 1 },
    );
    expect(comparison.equal).toBe(true);
  });
});

/* ==================================================================== *
 * Slice 8: the structured operator report (§8.2 step 11, §5.1 `context`). Report-only: nothing
 * here may change a disposition, a STOP or the fingerprint.
 * ==================================================================== */

describe('Slice 8 §5.10: every affected season gets a structured verdict; the decision is unchanged', () => {
  it('PASS verdicts name their rule and proof (SV-0, SV-1, SV-2a) and carry no STOP', () => {
    const sv0 = describeSeasonVerdict({ season: 2024, seasonClass: 'empty', evidence: { kind: 'empty' }, verdict: { independent: true } });
    expect(sv0).toMatchObject({ season: 2024, verdict: 'INDEPENDENT', rule: 'SV-0', stop: null, failedChecks: [] });
    const sv1Evidence = { kind: 'admin_published' as const, closureMovesOrDeletesPositiveBrownlowRowInSeason: false, pOrPPrimeHasRowInSeasonTotals: false };
    const sv1 = describeSeasonVerdict({ season: 2023, seasonClass: 'admin_published', evidence: sv1Evidence, verdict: evaluateSeasonTotalIndependence(sv1Evidence) });
    expect(sv1).toMatchObject({ verdict: 'INDEPENDENT', rule: 'SV-1', stop: null });
    const sv2aEvidence = {
      kind: 'artefact_schema_1' as const,
      artefactCsvSha256Matches: true, identityCsvSha256Matches: true, rowForRowMatch: true, profilePathResolvesToExactlyOnePlayer: true,
    };
    const sv2a = describeSeasonVerdict({ season: 2022, seasonClass: 'artefact', evidence: sv2aEvidence, verdict: evaluateSeasonTotalIndependence(sv2aEvidence) });
    expect(sv2a).toMatchObject({ verdict: 'INDEPENDENT', rule: 'SV-2a', stop: null });
    expect(sv2a.proof).toContain('row-for-row');
  });

  it('a STOP verdict names the season, the class, the failing step/code and every failed condition', () => {
    const evidence = { kind: 'admin_published' as const, closureMovesOrDeletesPositiveBrownlowRowInSeason: true, pOrPPrimeHasRowInSeasonTotals: true };
    const verdict = evaluateSeasonTotalIndependence(evidence);
    const report = describeSeasonVerdict({ season: 2025, seasonClass: 'admin_published', evidence, verdict });
    expect(report).toMatchObject({
      season: 2025, seasonClass: 'admin_published', verdict: 'STOP', rule: 'SV-1',
      stop: { step: 'SV-1', code: 'season_total_depends_on_correction' },
    });
    expect(report.failedChecks).toHaveLength(2);
    // the STOP itself is exactly the planner's: describing it never re-decides it
    expect(verdict.independent).toBe(false);
    if (!verdict.independent) expect(report.stop).toEqual({ step: verdict.stop.step, code: verdict.stop.code });
  });

  it('an SV-2a STOP names each failing executable step, and never falls back to a PASS', () => {
    const evidence = {
      kind: 'artefact_schema_1' as const,
      artefactCsvSha256Matches: true, identityCsvSha256Matches: false, rowForRowMatch: false, profilePathResolvesToExactlyOnePlayer: true,
    };
    const report = describeSeasonVerdict({ season: 2021, seasonClass: 'artefact', evidence, verdict: evaluateSeasonTotalIndependence(evidence) });
    expect(report).toMatchObject({ verdict: 'STOP', rule: 'SV-2a', stop: { step: 'SV-2a', code: 'season_artefact_unprovable' } });
    expect(report.failedChecks.map((c) => c.slice(0, 8))).toEqual(['SV-2a(0)', 'SV-2a(4)']);
  });

  it('SV-3 (including a non-schema-1 artefact manifest) is a STOP naming SV-3', () => {
    const report = describeSeasonVerdict({ season: 2020, seasonClass: 'artefact', evidence: { kind: 'unprovable' }, verdict: evaluateSeasonTotalIndependence({ kind: 'unprovable' }) });
    expect(report).toMatchObject({ verdict: 'STOP', rule: 'SV-3', stop: { step: 'SV-3', code: 'season_artefact_unprovable' } });
    expect(report.failedChecks[0]).toContain('not schema 1');
  });

  it('the §4.G artefact recurrence-risk section names the provider, the deferred O-3 follow-up and the §5.10 outcome', () => {
    const pass = describeSeasonVerdict({ season: 2024, seasonClass: 'empty', evidence: { kind: 'empty' }, verdict: { independent: true } });
    const lines = artefactRecurrenceRisk({ providerId: 'CD_I1', seasonVerdicts: [pass] });
    expect(lines.join('\n')).toContain('CD_I1');
    expect(lines.join('\n')).toContain('O-3');
    expect(lines.join('\n')).toContain('every affected season proved independent (2024)');
    const stopped = describeSeasonVerdict({
      season: 2025, seasonClass: 'unprovable', evidence: { kind: 'unprovable' }, verdict: evaluateSeasonTotalIndependence({ kind: 'unprovable' }),
    });
    expect(artefactRecurrenceRisk({ providerId: 'CD_I1', seasonVerdicts: [pass, stopped] }).join('\n')).toContain('season(s) 2025');
    expect(artefactRecurrenceRisk({ providerId: 'CD_I1', seasonVerdicts: [] }).join('\n')).toContain('no affected season');
  });
});

describe('Slice 8 fingerprint stability: report-only context never reaches the hash', () => {
  const plan: MutationPlan = {
    plannerVersion: PLANNER_VERSION,
    provider: { externalId: 'CD_I1', sourceKey: 'afl_api' },
    authority: {
      mode: 'ORIGINAL', netState: 'NONE', ledgerId: null, liveIdentityRowId: 20,
      previousPlayerIdentity: 'afltables:players/A/A_One.html', playerIdentity: 'afltables:players/B/B_Two.html',
    },
    identityAction: 'update_in_place',
    rows: [{
      table: 'player_match_stats', rowId: 1, naturalKey: { player_id: 502, match_id: 1 },
      disposition: 'MOVE', contractSha256: 'abc', provenance: { sourceKey: 'afl_api', sourceRecordId: 'M1|RICH|CD_I1', importBatchId: 100 },
      evidence: { applicationIds: [11], citedVersion: { sourceId: 7, family: 'player_stats', externalRecordId: 'M1|RICH|CD_I1', seq: 3 }, insertPayloadSha256: null },
      collision: null,
    }],
    stops: [{ table: 'player_match_stats', rowId: null, step: 'SV-1', code: 'season_total_depends_on_correction' }],
  };
  const verdict = (season: number) => describeSeasonVerdict({
    season, seasonClass: 'admin_published',
    evidence: { kind: 'admin_published', closureMovesOrDeletesPositiveBrownlowRowInSeason: true, pOrPPrimeHasRowInSeasonTotals: false },
    verdict: evaluateSeasonTotalIndependence({ kind: 'admin_published', closureMovesOrDeletesPositiveBrownlowRowInSeason: true, pOrPPrimeHasRowInSeasonTotals: false }),
  });
  const contextA: CorrectionReportContext = {
    closureRows: [{ table: 'player_match_stats', rowId: 1, disposition: 'MOVE', matchId: 1, season: 2025, clubId: 3, goals: 2 }],
    seasonVerdicts: [verdict(2025)],
    dependents: unresolvedDependentReports({ closureRowId: 1, matchId: 1, rows: [{ table: 'after_siren_kicks', id: 9 }] }),
    artefactRisk: artefactRecurrenceRisk({ providerId: 'CD_I1', seasonVerdicts: [verdict(2025)] }),
  };
  const contextB: CorrectionReportContext = {
    closureRows: [], seasonVerdicts: [verdict(2019)], dependents: [], artefactRisk: ['different'],
  };

  it('the same plan with different report contexts (closure, verdict detail, dependents, risk) fingerprints identically', () => {
    const a = { plan, context: contextA };
    const b = { plan, context: contextB };
    expect(mutationPlanFingerprint(a.plan)).toBe(mutationPlanFingerprint(b.plan));
    // even a context accidentally spread into the plan object is ignored by the hash
    expect(mutationPlanFingerprint({ ...plan, context: contextA, report: 'x' } as unknown as MutationPlan)).toBe(mutationPlanFingerprint(plan));
  });

  it('the STOP object shape stays {table,rowId,step,code}: verdict detail lives only in the context', () => {
    expect(Object.keys(plan.stops[0]).sort()).toEqual(['code', 'rowId', 'step', 'table']);
    expect(contextA.seasonVerdicts[0].season).toBe(2025);
    expect(contextA.seasonVerdicts[0].failedChecks.length).toBeGreaterThan(0);
  });

  it('PLANNER_VERSION is unchanged by Slice 8', () => {
    expect(PLANNER_VERSION).toBe(2);
  });
});

describe('Slice 8 §4.H cache paths: exact, deterministic, deduplicated, report-only', () => {
  const pms = (over: Partial<ClosureImpactRow>): ClosureImpactRow => ({
    table: 'player_match_stats', rowId: 1, disposition: 'MOVE', matchId: 500, season: 2025, clubId: 3, goals: 1, ...over,
  });
  const brownlow = (over: Partial<ClosureImpactRow>): ClosureImpactRow => ({
    table: 'brownlow_round_votes', rowId: 7, disposition: 'MOVE', matchId: 500, season: 2025, clubId: null, goals: null, ...over,
  });
  const players = [{ id: 10, slug: 'alpha-one' }, { id: 20, slug: 'bravo-two' }];
  const clubSlugs = new Map([[3, 'carlton'], [4, 'adelaide']]);

  it('reports P, P′, every touched match, every season, the clubs and the generic record/root pages, in a fixed order', () => {
    const impact = affectedCachePaths({
      rows: [pms({ rowId: 2, matchId: 600, season: 2024, clubId: 4 }), pms({}), pms({ rowId: 3, disposition: 'DELETE_AS_FOREIGN_COLLISION', matchId: 500 })],
      players, clubSlugs,
    });
    expect(impact.canonicalRowsChanged).toBe(true);
    expect(impact.paths).toEqual([
      '/players/alpha-one-10', '/players/bravo-two-20',
      '/matches/500', '/matches/600',
      '/seasons/2024', '/seasons/2025',
      '/clubs/adelaide', '/clubs/carlton',
      '/records', '/records/[category]', '/',
    ]);
    expect(impact.seasonRevalidations).toEqual([2024, 2025]);
    expect(impact.unresolved).toEqual([]);
  });

  it('/brownlow/<year> appears only when a Brownlow closure row exists for that season', () => {
    expect(affectedCachePaths({ rows: [pms({})], players, clubSlugs }).paths.some((p) => p.startsWith('/brownlow/'))).toBe(false);
    const withBrownlow = affectedCachePaths({ rows: [pms({}), brownlow({ season: 2023, matchId: null })], players, clubSlugs });
    expect(withBrownlow.paths.filter((p) => p.startsWith('/brownlow/'))).toEqual(['/brownlow/2023']);
    // a match-less Brownlow row adds no /matches path, but its season is affected
    expect(withBrownlow.paths.filter((p) => p.startsWith('/matches/'))).toEqual(['/matches/500']);
    expect(withBrownlow.seasonRevalidations).toEqual([2023, 2025]);
  });

  it('is deterministic whatever the row order, and never duplicates a path', () => {
    const rows = [pms({}), pms({ rowId: 2 }), brownlow({}), pms({ rowId: 4, matchId: 501, clubId: 4 })];
    const a = affectedCachePaths({ rows, players, clubSlugs });
    const b = affectedCachePaths({ rows: [...rows].reverse(), players, clubSlugs });
    expect(a.paths).toEqual(b.paths);
    expect(new Set(a.paths).size).toBe(a.paths.length);
  });

  it('no canonical row moved or deleted: no route is claimed', () => {
    expect(affectedCachePaths({ rows: [], players, clubSlugs })).toEqual({
      canonicalRowsChanged: false, paths: [], seasonRevalidations: [], unresolved: [],
    });
  });

  it('a slug that could not be read is named as unresolved, never invented', () => {
    const impact = affectedCachePaths({ rows: [pms({ clubId: 99 })], players: [{ id: 10, slug: null }, players[1]], clubSlugs });
    expect(impact.paths).not.toContain('/players/null-10');
    expect(impact.unresolved).toEqual([
      'player 10: slug unavailable (/players/<slug>-10)',
      'club 99: slug unavailable (/clubs/<slug>)',
    ]);
  });
});

describe('Slice 8 §4.F Coleman: report-only stale-season detection under the live derivation contract', () => {
  const row = (over: Partial<ColemanRowFacts>): ColemanRowFacts => ({
    rowId: 1, season: 2024, matchId: 500, isFinal: false, seasonComplete: true, goals: 3, ...over,
  });
  const run = (rows: ColemanRowFacts[], winners: number[] = []) => evaluateColemanImpact({
    rows, firstSeason: 1980, winnerSeasonsForPOrPPrime: new Set(winners),
  });

  it('a complete home-and-away season with goals > 0 moved (or deleted) is potentially stale', () => {
    expect(run([row({})])).toEqual([{ season: 2024, reasons: ['goal_totals_change'], rowIds: [1] }]);
  });

  it('an in-progress season, a final, and a pre-contract season are never reported', () => {
    expect(run([row({ seasonComplete: false })])).toEqual([]);
    expect(run([row({ isFinal: true })])).toEqual([]);
    expect(run([row({ season: 1979 })])).toEqual([]);
  });

  it('goals = 0 or NULL changes no total: reported only when P or P′ is a current winner of that season (club attribution)', () => {
    expect(run([row({ goals: 0 })])).toEqual([]);
    expect(run([row({ goals: null })])).toEqual([]);
    expect(run([row({ goals: 0 })], [2024])).toEqual([{ season: 2024, reasons: ['winner_club_attribution'], rowIds: [1] }]);
  });

  it('MOVE and DELETE are treated alike (the input has no disposition: both change the derivation), and the season set is exact, sorted and deduplicated', () => {
    const result = run([
      row({ rowId: 5, season: 2025 }), row({ rowId: 2 }), row({ rowId: 3, goals: 0 }), row({ rowId: 4, isFinal: true, season: 2023 }),
    ], [2024]);
    expect(result).toEqual([
      { season: 2024, reasons: ['goal_totals_change', 'winner_club_attribution'], rowIds: [2, 3] },
      { season: 2025, reasons: ['goal_totals_change'], rowIds: [5] },
    ]);
  });
});

describe('Slice 8 §5.11 DP-3/DP-4 reports: exact rows and the refresh path', () => {
  it('case 18 (reporting half): DP-3 names each unresolved row id, its match, and the refresh path; never a STOP', () => {
    const entries = unresolvedDependentReports({
      closureRowId: 1, matchId: 500, rows: [{ table: 'player_achievements', id: 8 }, { table: 'after_siren_kicks', id: 4 }],
    });
    expect(entries.map((e) => `${e.rule}:${e.outcome}:${e.table}#${e.rowId}:${String(e.matchId)}`)).toEqual([
      'DP-3:REPORT:after_siren_kicks#4:500', 'DP-3:REPORT:player_achievements#8:500',
    ]);
    expect(entries[0].refreshPath).toEqual(dependentRefreshPath('after_siren_kicks', 4, 'REPORT'));
    expect(entries[0].refreshPath.join('\n')).toContain('/admin/records/after-the-siren/4');
    expect(entries[0].refreshPath.join('\n')).toContain('after-siren-reconcile');
    expect(entries[1].refreshPath.join('\n')).toContain('/admin/records/first-kick-goal/8');
  });

  it('DP-4 describes the unchanged loader verdict: STOP rows say "re-run the correction", reported rows do not', () => {
    const dep = (id: number, playerId: number) => ({ table: 'after_siren_kicks' as const, id, playerId, season: 2025, clubOrganizationId: 3 });
    const entries = matchLessDependentReports({
      losesParticipation: [dep(1, 10)], participationRemains: [dep(2, 10)], pPrimeReported: [dep(3, 20)],
    });
    expect(entries.map((e) => `${e.rule}:${e.outcome}:${e.rowId}`)).toEqual(['DP-4:STOP:1', 'DP-4:REPORT:2', 'DP-4:REPORT:3']);
    expect(entries[0].refreshPath[0]).toContain('then re-run the correction');
    expect(entries[1].refreshPath[0]).not.toContain('re-run');
    expect(entries.every((e) => e.refreshPath.some((p) => p.includes('db:test:rebuild')))).toBe(true);
  });
});

describe('Slice 8 §5.11 DP-5: first-kick-goal debut changes (report only, never a STOP)', () => {
  const m = (matchId: number, matchDate: string, season: number): CareerMatch => ({ matchId, matchDate, season });
  const fkg = (id: number, playerId: number) => ({ id, playerId, matchId: null, season: 2020 });
  const P = 10;
  const PP = 20;
  const run = (over: Partial<Parameters<typeof evaluateFirstKickGoalDebutChanges>[0]>) => evaluateFirstKickGoalDebutChanges({
    pId: P, pPrimeId: PP, pBefore: [], pPrimeBefore: [], moved: [], deleted: [], firstKickGoals: [], ...over,
  });

  it('careerDebut follows (match_date, match_id), and debut season is the minimum season', () => {
    expect(careerDebut([m(9, '2020-04-01', 2020), m(3, '2020-04-01', 2020), m(1, '2021-01-01', 2021)])).toEqual({ matchId: 3, season: 2020 });
    expect(careerDebut([])).toEqual({ matchId: null, season: null });
  });

  it('P loses its debut match -> reported for P\'s first_kick_goal row', () => {
    const entries = run({
      pBefore: [m(1, '2020-03-20', 2020), m(2, '2020-03-27', 2020)], moved: [m(1, '2020-03-20', 2020)], firstKickGoals: [fkg(70, P)],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ rule: 'DP-5', outcome: 'REPORT', table: 'player_achievements', rowId: 70, playerId: P });
    expect(entries[0].detail).toContain('debut match 1 -> 2');
    expect(entries[0].refreshPath.join('\n')).toContain('first-kick-goal');
  });

  it('P′ gains an earlier match -> reported for P′', () => {
    const entries = run({
      pBefore: [m(1, '2019-03-20', 2019)], pPrimeBefore: [m(5, '2020-03-20', 2020)], moved: [m(1, '2019-03-20', 2019)], firstKickGoals: [fkg(71, PP)],
    });
    expect(entries.map((e) => e.playerId)).toEqual([PP]);
    expect(entries[0].detail).toContain('debut match 5 -> 1');
    expect(entries[0].detail).toContain('debut season 2020 -> 2019');
  });

  it('a debut-season change is reported (P keeps no 2019 match after the move)', () => {
    const entries = run({
      pBefore: [m(1, '2019-09-01', 2019), m(2, '2020-03-20', 2020)], moved: [m(1, '2019-09-01', 2019)], firstKickGoals: [fkg(72, P)],
    });
    expect(entries[0].detail).toContain('debut season 2019 -> 2020');
  });

  it('an unchanged debut, or no first_kick_goal dependent, reports nothing', () => {
    expect(run({
      pBefore: [m(1, '2020-03-20', 2020), m(2, '2020-03-27', 2020)], moved: [m(2, '2020-03-27', 2020)], firstKickGoals: [fkg(70, P)],
    })).toEqual([]);
    expect(run({ pBefore: [m(1, '2020-03-20', 2020)], moved: [m(1, '2020-03-20', 2020)], firstKickGoals: [] })).toEqual([]);
  });

  it('a DELETE-only closure adds nothing to P′: P′ is unaffected, P may still change', () => {
    const entries = run({
      pBefore: [m(1, '2019-03-20', 2019), m(2, '2020-03-20', 2020)], pPrimeBefore: [m(1, '2019-03-20', 2019)],
      deleted: [m(1, '2019-03-20', 2019)], firstKickGoals: [fkg(70, P), fkg(71, PP)],
    });
    expect(entries.map((e) => e.playerId)).toEqual([P]);
  });

  it('never STOPs: every entry is a REPORT', () => {
    const entries = run({
      pBefore: [m(1, '2019-03-20', 2019)], pPrimeBefore: [m(5, '2020-03-20', 2020)], moved: [m(1, '2019-03-20', 2019)],
      firstKickGoals: [fkg(70, P), fkg(71, PP)],
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.outcome === 'REPORT')).toBe(true);
  });

  it('careersBeforeCorrection: a committed report reconstructs exactly the prospective (pre-correction) careers', () => {
    const moved = [m(1, '2019-03-20', 2019)];
    const deleted = [m(3, '2019-04-01', 2019)];
    const pBefore = [m(1, '2019-03-20', 2019), m(2, '2020-03-20', 2020), m(3, '2019-04-01', 2019)];
    const pPrimeBefore = [m(3, '2019-04-01', 2019), m(5, '2020-03-20', 2020)];
    const prospective = careersBeforeCorrection({ phase: 'prospective', pCurrent: pBefore, pPrimeCurrent: pPrimeBefore, moved, deleted });
    expect(prospective).toEqual({ pBefore, pPrimeBefore });
    const committed = careersBeforeCorrection({
      phase: 'committed',
      pCurrent: [m(2, '2020-03-20', 2020)], // P after: lost MOVE 1 and DELETE 3
      pPrimeCurrent: [m(3, '2019-04-01', 2019), m(5, '2020-03-20', 2020), m(1, '2019-03-20', 2019)], // P′ after: gained MOVE 1
      moved, deleted,
    });
    const byId = (rows: readonly CareerMatch[]) => [...rows].sort((a, b) => a.matchId - b.matchId);
    expect(byId(committed.pBefore)).toEqual(byId(pBefore));
    expect(byId(committed.pPrimeBefore)).toEqual(byId(pPrimeBefore));
  });
});

describe('Slice 8 §4.B open findings and pending candidates: selectors, and resolved rows are never open', () => {
  const scope: FindingScope = { providerId: 'CD_I1', pId: 10, pPrimeId: 20, pIdentity: 'id:P', pPrimeIdentity: 'id:P2' };
  const finding = (id: string, issueType: string, details: Record<string, string | number>, resolved = false): OpenFindingRow => ({
    id, issueType, issueKey: `key-${id}`, resolved, details,
  });

  it('selects each runbook category and excludes resolved/unrelated rows', () => {
    const rows = [
      finding('1', 'canonical_apply_failed', { source_key: 'afl_api', external_record_id: 'CD_M1|T1|CD_I1' }),
      finding('2', 'canonical_apply_failed', { source_key: 'afltables', external_record_id: 'x|CD_I1' }),
      finding('3', 'canonical_apply_failed', { source_key: 'afl_api', external_record_id: 'CD_M1|T1|CD_I10' }),
      finding('4', 'afl_api_identity_contradiction', { external_id: 'CD_I1', proposed_player_identity: 'id:P2' }),
      finding('5', 'afl_api_identity_contradiction', { external_id: 'CD_OTHER', proposed_player_id: 10 }),
      finding('6', 'afl_api_identity_contradiction', { external_id: 'CD_OTHER', existing_player_ref: 'id:P2' }),
      finding('7', 'afl_api_identity_contradiction', { external_id: 'CD_I1', proposed_player_identity: 'id:X' }, true),
      finding('8', 'afl_api_identity_contradiction', { external_id: 'CD_OTHER', proposed_player_id: 99 }),
      finding('9', 'settle_disagreement', { external_record_id: 'x|CD_I1' }),
      finding('10', 'afl_api_identity_contradiction', { external_id: 'CD_OTHER', existing_external_id: 'CD_I1' }),
    ];
    const selected = selectOpenFindings(rows, scope);
    expect(selected.map((f) => `${f.id}:${f.selector}:${String(f.adjudicatedByThisCorrection)}`)).toEqual([
      '1:canonical_apply_failed_for_provider:false',
      '4:contradiction_for_provider:true',
      '5:contradiction_names_player:false',
      '6:contradiction_names_player:false',
      '10:contradiction_for_provider:false',
    ]);
  });

  it('pending candidates: |CD_I records and proposals of P only; accepted/rejected/superseded never', () => {
    const cand = (id: string, externalRecordId: string, status: string, proposedPlayerId: string | null = null): PendingCandidateRow => ({
      id, family: 'player_stats', externalRecordId, targetTable: 'player_match_stats', verb: 'corrected', season: 2025, status, proposedPlayerId,
    });
    const selected = selectPendingCandidates([
      cand('1', 'CD_M1|T1|CD_I1', 'pending'),
      cand('2', 'CD_M1|T1|CD_I1', 'accepted'),
      cand('3', 'CD_M1|T1|CD_OTHER', 'pending', '10'),
      cand('4', 'CD_M1|T1|CD_OTHER', 'pending', '20'),
      cand('5', 'CD_M1|T1|CD_I1', 'superseded'),
      cand('6', 'CD_M1|T1|CD_I1', 'rejected'),
    ], { providerId: 'CD_I1', pId: 10 });
    expect(selected.map((c) => `${c.id}:${c.selector}`)).toEqual(['1:provider_record', '3:proposes_p']);
    expect(selected[0]).not.toHaveProperty('status');
  });

  it('the selectors are pure: inputs are not mutated', () => {
    const rows = [finding('1', 'canonical_apply_failed', { source_key: 'afl_api', external_record_id: 'a|CD_I1' })];
    const before = structuredClone(rows);
    selectOpenFindings(rows, scope);
    expect(rows).toEqual(before);
  });
});

/* ==================================================================== *
 * Slice 9: DB-free acceptance for the §12.1 U-level cases that have no later backstop (D-S9-1),
 * plus the cheap partials 10/52/54 (D-S9-5). Behavioural only, through the planner's exported
 * pure evaluators: nothing here changes a disposition, a STOP code, the plan or the fingerprint.
 * ==================================================================== */

const B3C_CHAIN_STOP = { ok: false, stop: { step: 'B3-C', code: 'brownlow_chain_inconsistent' } };

function brownlowEvidence(overrides: Partial<BrownlowRowEvidence> = {}): BrownlowRowEvidence {
  return {
    sourceId: 'afl_api',
    sourceRecordId: 'CD_M1',
    expectedSourceRecordId: 'CD_M1',
    importBatchId: 100,
    expectedImportBatchId: 100,
    insertApplication: app({ id: 1, verb: 'insert', newValues: { played: true, votes: 3, match_id: 1 } }),
    insertProvenByPayload: true,
    projectionPlayerId: null,
    currentPlayerId: 501,
    chain: [],
    anotherProviderAlsoResolved: false,
    current: { played: true, votes: 3, matchId: 1 },
    ...overrides,
  };
}

describe('Slice 9 case 13: DELETE lineage ambiguity STOPs (§5.6 D-4, D-5; D-6 is case 12 in the CLI suite)', () => {
  const goodDelete: DeleteLineageEvidence = {
    deleteApplication: app({ id: 7, verb: 'delete', previousValues: { player_id: 501 }, newValues: {} }),
    boundBatchCount: 1,
    previousPlayerId: 501,
    keyComponentsMatch: true,
    previousValuesContractComplete: true,
    previousValuesSourceIdIsAflApi: true,
    previousValuesBrownlowVotesIsNull: true,
    preCorrectionHistoryNonEmpty: true,
    reconstructionMatchesPreviousValues: true,
    noConflictingLaterHistory: true,
  };

  it('D-4: two bound delete applications at k -> STOP ambiguous_correction (the well-formed DELETE passes)', () => {
    expect(evaluateDeleteLineage(goodDelete)).toEqual({ ok: true });
    expect(evaluateDeleteLineage({ ...goodDelete, boundBatchCount: 2 }))
      .toMatchObject({ ok: false, stop: { step: 'D-4', code: 'ambiguous_correction' } });
  });

  it('D-5: previous_values that disagree with the immutable-history reconstruction (or an empty H) -> STOP row_proof_mismatch', () => {
    const patches: Partial<DeleteLineageEvidence>[] = [
      { reconstructionMatchesPreviousValues: false },
      { preCorrectionHistoryNonEmpty: false },
    ];
    for (const patch of patches) {
      expect(evaluateDeleteLineage({ ...goodDelete, ...patch }))
        .toMatchObject({ ok: false, stop: { step: 'D-5', code: 'row_proof_mismatch' } });
    }
  });
});

describe('Slice 9 case 50: correction joinability L1-L4 (§5.6)', () => {
  const lineage: MoveLineageEvidence = {
    correctionApplication: {
      id: 5, verb: 'update', previousValues: { player_id: 501 }, newValues: { player_id: 502 },
      sourceId: 'afl_api', externalRecordId: 'M1|RICH|CD_I1', sourceVersionSeq: 1, importBatchId: 300,
      targetKey: { player_id: 502, match_id: 1 },
    },
    boundBatchCount: 1,
    previousPlayerId: 501,
    nextPlayerId: 502,
    keyComponentsMatch: true,
    bindsToOldHistory: true,
    preCorrectionHistoryNonEmpty: true,
    preCorrectionAttributionOk: true,
    preCorrectionChainConsistent: true,
    rowProofMatches: true,
    joinIsUnique: true,
    postCorrectionHistoryAllThroughCdI: true,
  };
  type CorrectionApplicationPatch = Partial<MoveLineageEvidence['correctionApplication']>;
  const withApplication = (patch: CorrectionApplicationPatch): MoveLineageEvidence => ({
    ...lineage, correctionApplication: { ...lineage.correctionApplication, ...patch },
  });

  it('L1: the earliest application at k′ is not an update -> correction_not_bound; two bound -> ambiguous_correction', () => {
    expect(evaluateMoveLineage(lineage)).toEqual({ ok: true });
    for (const verb of ['insert', 'delete'] as const) {
      expect(evaluateMoveLineage(withApplication({ verb })))
        .toMatchObject({ ok: false, stop: { step: 'L1', code: 'correction_not_bound' } });
    }
    expect(evaluateMoveLineage({ ...lineage, boundBatchCount: 2 }))
      .toMatchObject({ ok: false, stop: { step: 'L1', code: 'ambiguous_correction' } });
  });

  it('L2: previous/new values that are not exactly {player_id: P} -> {player_id: P′} -> correction_values_contradict', () => {
    const patches: CorrectionApplicationPatch[] = [
      { previousValues: { player_id: 999 } },
      { previousValues: null },
      { previousValues: { player_id: 501, goals: 1 } },
      { newValues: { player_id: 777 } },
      { newValues: { player_id: 502, goals: 1 } },
    ];
    for (const patch of patches) {
      expect(evaluateMoveLineage(withApplication(patch)))
        .toMatchObject({ ok: false, stop: { step: 'L2', code: 'correction_values_contradict' } });
    }
  });

  it('L3: a non-player_id key component that does not match -> key_components_contradict', () => {
    expect(evaluateMoveLineage({ ...lineage, keyComponentsMatch: false }))
      .toMatchObject({ ok: false, stop: { step: 'L3', code: 'key_components_contradict' } });
  });

  it('L4: c does not cite the old-key history\'s latest source version -> correction_not_joinable, ahead of any L5-L7 failure', () => {
    expect(evaluateMoveLineage({ ...lineage, bindsToOldHistory: false }))
      .toMatchObject({ ok: false, stop: { step: 'L4', code: 'correction_not_joinable' } });
    expect(evaluateMoveLineage({ ...lineage, bindsToOldHistory: false, rowProofMatches: false, joinIsUnique: false }))
      .toMatchObject({ ok: false, stop: { step: 'L4', code: 'correction_not_joinable' } });
  });
});

describe('Slice 9 case 55: an intermediate out-of-ledger edit later overwritten by a settle STOPs reconstruction_inconsistent (§5.8)', () => {
  it('player_match_stats P7: the chain break is the STOP, not the adjacent out_of_ledger_edit, though the current row equals the latest write', () => {
    // kicks: 10 (insert) -> 99 (an out-of-ledger edit) -> 11 (a settle citing previous 99).
    const current = { ...PMS_CURRENT_BASE, kicks: 11, brownlow_votes: null };
    const overwritten = baselinePmsEvidence({
      applications: [pmsInsertApplication(), app({ id: 2, verb: 'update', previousValues: { kicks: 99 }, newValues: { kicks: 11 } })],
      current,
    });
    expect(evaluatePlayerMatchStatsAttribution(overwritten)).toEqual({ ok: true });
    expect(evaluatePlayerMatchStatsMutationEligibility(overwritten))
      .toMatchObject({ ok: false, stop: { step: 'P7', code: 'reconstruction_inconsistent' } });

    // Control: the same settle citing the true prior value is eligible -- only the break differs.
    const honest = baselinePmsEvidence({
      applications: [pmsInsertApplication(), app({ id: 2, verb: 'update', previousValues: { kicks: 10 }, newValues: { kicks: 11 } })],
      current,
    });
    expect(evaluatePlayerMatchStatsMutationEligibility(honest)).toEqual({ ok: true });
    // The adjacent failure: a consistent chain whose current row differs is out_of_ledger_edit instead.
    expect(evaluatePlayerMatchStatsMutationEligibility({ ...honest, current: { ...current, kicks: 12 } }))
      .toMatchObject({ ok: false, stop: { step: 'P7', code: 'out_of_ledger_edit' } });
  });

  it('brownlow_round_votes B5: played edited out of ledger, then re-set by a settle -> reconstruction_inconsistent', () => {
    const resettle: BrownlowChainApplication = {
      ...app({ id: 2, verb: 'update', previousValues: { played: false }, newValues: { played: true } }),
      citedPayloadVoterCountForCdI: 1,
      citedPayloadVoteForCdI: 3,
    };
    const evidence = brownlowEvidence({ chain: [resettle] });
    expect(evaluateBrownlowAttribution(evidence)).toEqual({ ok: true });
    expect(evaluateBrownlowMutationEligibility(evidence))
      .toMatchObject({ ok: false, stop: { step: 'B5', code: 'reconstruction_inconsistent' } });
    const honest = brownlowEvidence({ chain: [{ ...resettle, previousValues: { played: true } }] });
    expect(evaluateBrownlowMutationEligibility(honest)).toEqual({ ok: true });
  });
});

describe('Slice 9 case 77: a malformed I244-F007 release/claim STOPs brownlow_chain_inconsistent (§5.3 B3-C case 3)', () => {
  function chainStep(
    partial: Partial<BrownlowChainApplication> & Pick<BrownlowChainApplication, 'id' | 'previousValues' | 'newValues'>,
  ): BrownlowChainApplication {
    return {
      verb: 'update', sourceId: 'afl_api', externalRecordId: 'CD_M2', sourceVersionSeq: 1, importBatchId: 200,
      citedPayloadVoterCountForCdI: 1, citedPayloadVoteForCdI: 3, ...partial,
    };
  }
  const release = chainStep({ id: 20, previousValues: { votes: 2 }, newValues: { votes: 0 } });
  const claim = chainStep({ id: 21, previousValues: { votes: 0 }, newValues: { votes: 3 } });

  it('a release with no adjacent claim STOPs (the well-formed pair is case 3)', () => {
    expect(verifyBrownlowReleaseClaimPair(release, claim, 2)).toEqual({ ok: true, case: 3 });
    expect(classifyBrownlowChain([release], 2)).toMatchObject(B3C_CHAIN_STOP);
    const notAClaim = chainStep({
      id: 22, previousValues: { votes: 0 }, newValues: { votes: 0 }, citedPayloadVoterCountForCdI: 0, citedPayloadVoteForCdI: null,
    });
    expect(classifyBrownlowChain([release, notAClaim], 2)).toMatchObject(B3C_CHAIN_STOP);
  });

  it.each<[string, Partial<BrownlowChainApplication>]>([
    ['another batch', { importBatchId: 999 }],
    ['another source version', { sourceVersionSeq: 2 }],
  ])('a claim from %s STOPs', (_label, patch) => {
    const foreignClaim: BrownlowChainApplication = { ...claim, ...patch };
    expect(verifyBrownlowReleaseClaimPair(release, foreignClaim, 2)).toMatchObject({
      ok: false,
      stop: { step: 'B3-C', code: 'brownlow_chain_inconsistent', detail: expect.stringContaining('same source version') },
    });
    expect(classifyBrownlowChain([release, foreignClaim], 2)).toMatchObject(B3C_CHAIN_STOP);
  });

  it('a claim whose value is not CD_I\'s own payload entry STOPs', () => {
    const wrongClaim = chainStep({ id: 21, previousValues: { votes: 0 }, newValues: { votes: 2 } });
    expect(verifyBrownlowReleaseClaimPair(release, wrongClaim, 2)).toMatchObject({
      ok: false,
      stop: { step: 'B3-C', code: 'brownlow_chain_inconsistent', detail: expect.stringContaining('does not raise 0 to the cited value') },
    });
    expect(classifyBrownlowChain([release, wrongClaim], 2)).toMatchObject(B3C_CHAIN_STOP);
  });
});

describe('Slice 9 case 10: a jumper_number whitespace-only difference is a substantive collision difference (§5.4 C3, §5.5)', () => {
  it.each(['7 ', ' 7'])('counterpart jumper_number %j vs the closure row\'s "7" -> STOP C3 naming jumper_number only', (jumper) => {
    const result = decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership: 'foreign', row: { ...PMS_CURRENT_BASE, jumper_number: jumper } },
      closureRow: { ...PMS_CURRENT_BASE, brownlow_votes: null },
      wouldViolateUniqueConstraint: false,
    });
    expect(result).toEqual({
      disposition: 'STOP',
      stop: { step: 'C3', code: 'collision_values_disagree', detail: 'field(s) differ: jumper_number' },
    });
  });
});

describe('Slice 9 case 52: a NULL-owned P′ counterpart receives exactly the foreign-counterpart policy of cases 9/10', () => {
  it('player_match_stats: identical -> DELETE_AS_FOREIGN_COLLISION (C2); differing -> STOP C3; the same verdicts as a foreign owner', () => {
    const closureRow = { ...PMS_CURRENT_BASE, brownlow_votes: null };
    const identical = { ...PMS_CURRENT_BASE };
    const differing = { ...PMS_CURRENT_BASE, kicks: 20 };
    const decide = (ownership: 'null_owned' | 'foreign', row: typeof PMS_CURRENT_BASE) => decidePlayerMatchStatsDisposition({
      counterpart: { exists: true, ownership, row }, closureRow, wouldViolateUniqueConstraint: false,
    });
    expect(decide('null_owned', identical)).toEqual({ disposition: 'DELETE_AS_FOREIGN_COLLISION' });
    expect(decide('null_owned', differing))
      .toMatchObject({ disposition: 'STOP', stop: { step: 'C3', code: 'collision_values_disagree' } });
    for (const row of [identical, differing]) expect(decide('null_owned', row)).toEqual(decide('foreign', row));
  });

  it('brownlow_round_votes: zero-vote identical -> DELETE_AS_FOREIGN_COLLISION (C4); a positive vote -> STOP C5; the same verdicts as a foreign owner', () => {
    const closureRow = { votes: 0, played: true, matchId: 5 };
    const identical = { votes: 0, played: true, matchId: 5 };
    const positive = { votes: 2, played: true, matchId: 5 };
    const decide = (ownership: 'null_owned' | 'foreign', row: typeof identical) => decideBrownlowDisposition({
      counterpart: { exists: true, ownership, row }, closureRow,
    });
    expect(decide('null_owned', identical)).toEqual({ disposition: 'DELETE_AS_FOREIGN_COLLISION' });
    expect(decide('null_owned', positive))
      .toMatchObject({ disposition: 'STOP', stop: { step: 'C5', code: 'collision_values_disagree' } });
    for (const row of [identical, positive]) expect(decide('null_owned', row)).toEqual(decide('foreign', row));
  });
});

describe('Slice 9 case 54: the admin resolve step setting match_id on an AFL API-owned round row is an out-of-ledger edit (§5.3 B5)', () => {
  it('match_id NULL as inserted, M today, provenance untouched -> STOP B5 out_of_ledger_edit naming match_id only', () => {
    const evidence = brownlowEvidence({
      insertApplication: app({ id: 1, verb: 'insert', newValues: { played: true, votes: 3, match_id: null } }),
      current: { played: true, votes: 3, matchId: 55 },
    });
    expect(evaluateBrownlowAttribution(evidence)).toEqual({ ok: true });
    expect(evaluateBrownlowMutationEligibility(evidence)).toEqual({
      ok: false,
      stop: { step: 'B5', code: 'out_of_ledger_edit', detail: 'field(s) differ from reconstruction: match_id' },
    });
    expect(evaluateBrownlowMutationEligibility({ ...evidence, current: { ...evidence.current, matchId: null } })).toEqual({ ok: true });
  });
});

describe('AFLDB-ISSUE-257 Slice 6 A257: manualAuthorityBlockersForMatch (ORIGINAL guard decision, F-PR-06)', () => {
  const MK = '2025|1|carlton|essendon';
  const ID_P = 'afltables:players/P/Pee.html';
  const ID_Q = 'afltables:players/P/PeePrime.html';
  const ID_OTHER = 'afltables:players/O/Other.html';
  const okContinuity: ContinuityRulesLoad = { ok: true, rules: [] as unknown as Extract<ContinuityRulesLoad, { ok: true }>['rules'] };
  const players = new Map<string, number[]>([[ID_P, [1]], [ID_Q, [2]], [ID_OTHER, [3]]]);
  const rec = (identity: string, fieldGroup = 'match_sheet', isActive = true, overrideValues: unknown = { goals: 3 }, matchKey = MK): MatchAuthorityRecord => ({
    entityKey: `${matchKey}|${identity}`, fieldGroup, isActive, overrideValues,
  });
  const run = (records: MatchAuthorityRecord[], over: Partial<Parameters<typeof manualAuthorityBlockersForMatch>[0]> = {}) =>
    manualAuthorityBlockersForMatch({
      matchKey: MK, records, playerIdsByIdentity: players, continuity: okContinuity, pId: 1, pPrimeId: 2, ...over,
    });

  it('an active record resolving to (P, M) blocks and names the key and group', () => {
    const blockers = run([rec(ID_P)]);
    expect(blockers).toEqual([{ entityKey: `${MK}|${ID_P}`, fieldGroups: ['match_sheet'], kind: 'authority', reason: null }]);
    expect(describeManualAuthorityBlockers(blockers)).toBe(`active Match Sheet authority ${MK}|${ID_P} [match_sheet]`);
  });

  it('an active lineup record at (P′, M) blocks', () => {
    const blockers = run([rec(ID_Q, 'lineup', true, { present: false })]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'authority', fieldGroups: ['lineup'] });
  });

  it('a record of another player at M does not block', () => {
    expect(run([rec(ID_OTHER)])).toEqual([]);
  });

  it('a withdrawn-only key carries no authority, even with an unreadable continuity contract', () => {
    expect(run([rec(ID_P, 'match_sheet', false)])).toEqual([]);
    expect(run([rec(ID_P, 'match_sheet', false, null)], { continuity: { ok: false, detail: 'unreadable' } })).toEqual([]);
  });

  it('an undecodable key under the match prefix is indeterminate (fails closed)', () => {
    const blockers = run([{ entityKey: `${MK}|not-an-identity`, fieldGroup: 'match_sheet', isActive: true, overrideValues: { goals: 1 } }]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ kind: 'indeterminate', reason: 'key does not decode' });
    expect(describeManualAuthorityBlockers(blockers)).toContain('indeterminate Match Sheet authority');
  });

  it('an identity resolving to no player, or to several, is indeterminate', () => {
    expect(run([rec('afltables:players/N/Nobody.html')])[0]).toMatchObject({ kind: 'indeterminate', reason: 'identity unresolved' });
    const shared = new Map(players).set(ID_OTHER, [1, 3]);
    expect(run([rec(ID_OTHER)], { playerIdsByIdentity: shared })[0]).toMatchObject({ kind: 'indeterminate', reason: 'identity ambiguous' });
  });

  it('an unreadable payload is indeterminate, whoever the key names', () => {
    expect(run([rec(ID_OTHER, 'match_sheet', true, { bogus: 1 })])[0]).toMatchObject({ kind: 'indeterminate' });
  });

  it('an unreadable continuity contract makes every active record indeterminate', () => {
    const blockers = run([rec(ID_P), rec(ID_OTHER)], { continuity: { ok: false, detail: 'unreadable' } });
    expect(blockers.map((b) => b.kind)).toEqual(['indeterminate', 'indeterminate']);
  });

  it('records of another match, including a longer key sharing the prefix, are not considered', () => {
    expect(run([
      rec(ID_P, 'match_sheet', true, { goals: 1 }, '2025|2|carlton|essendon'),
      rec(ID_P, 'match_sheet', true, { goals: 1 }, `${MK}|extra`),
    ])).toEqual([]);
  });
});
