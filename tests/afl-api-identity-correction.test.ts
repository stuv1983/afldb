/**
 * AFLDB-ISSUE-238 Slice 2: DB-free unit tests for the standalone pure
 * correction planner (`src/lib/acquisition/afl-api-identity-correction.ts`).
 * No database, filesystem, network or process-environment access. Case
 * numbers in comments refer to the runbook's §12.1 planned-case matrix
 * (`issues/open/AFLDB-ISSUE-238.md`).
 */
import { describe, expect, it } from 'vitest';

import {
  PLANNER_VERSION,
  PLAYER_MATCH_STATS_CONTRACT_FIELDS,
  classifyBrownlowChain,
  classifyBrownlowChainApplication,
  compareReconstruction,
  compareSubstantiveBrownlow,
  compareSubstantivePlayerMatchStats,
  decideBrownlowDisposition,
  decidePlayerMatchStatsDisposition,
  detectPostCorrectionReappearance,
  evaluateBrownlowAttribution,
  evaluateBrownlowGuards,
  evaluateBrownlowMutationEligibility,
  evaluateBrownlowParticipation,
  evaluateCorrectionSatisfaction,
  evaluateCorrectionTargetAbsent,
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
  type MutationPlan,
  type PlayerMatchStatsRowEvidence,
} from '@/lib/acquisition/afl-api-identity-correction';

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
    }],
    stops: [],
  };

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
