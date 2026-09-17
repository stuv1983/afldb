/**
 * AFLDB-ISSUE-164 P1: baseline-versus-candidate comparison for the
 * player-link matching backtest.
 *
 * DB-free. The comparator's whole purpose is to make P1b's before/after
 * evidence mechanical, so the assertions here are semantic (which rows
 * moved where, and in what order) rather than snapshots of formatted text.
 */
import { describe, expect, it } from 'vitest';

import {
  MATERIAL_GAP_DELTA,
  compareBacktests,
  compareQueues,
  computeMetrics,
  detectReportKind,
  formatComparison,
  queueRowViews,
  sourceTypeOfEntityKey,
  type BacktestCase,
  type BacktestReport,
  type QueueProposal,
  type QueueReport,
} from '../tools/matching/compare-reports';
import {
  assessLeakage,
  describeZeroFailureBound,
  parseLabelSet,
  requiredZeroFailureSample,
  smallestSampleExpressing,
  zeroFailureUpperBound,
} from '../tools/matching/label-set';

function caseRow(overrides: Partial<BacktestCase> & Pick<BacktestCase, 'key'>): BacktestCase {
  return {
    sourceType: 'award_winners',
    targetTable: 'award_winners',
    targetId: 1,
    rawName: 'Aaron Cadman',
    context: 'Rising Star · 2023',
    expectedPlayerId: 10,
    chosenPlayerId: 10,
    chosenName: 'Aaron Cadman',
    correct: true,
    rank: 1,
    candidateCount: 1,
    score: 97,
    gap: null,
    band: 'very_high',
    ambiguous: false,
    hardConflict: false,
    bulkEligible: true,
    conflictReasons: [],
    signals: ['name_exact', 'club_in_season', 'era_season_in_career'],
    ...overrides,
  };
}

function backtest(cases: BacktestCase[], meta: Partial<BacktestReport> = {}): BacktestReport {
  return {
    algorithmVersion: 'v1',
    gitCommit: '0955db3',
    startedAt: '2026-09-12T04:04:25.943Z',
    tableFilter: null,
    cases,
    ...meta,
  };
}

function proposal(overrides: Partial<QueueProposal> & Pick<QueueProposal, 'entity'>): QueueProposal {
  return {
    target: 'award_winners#1',
    sourceName: 'Aaron Cadman',
    context: 'Rising Star · 2023',
    band: 'high',
    bulkEligible: false,
    ambiguous: false,
    hardConflict: false,
    gap: 20,
    score: 79,
    suggested: 'Aaron Cadman',
    suggestedId: 10,
    signals: ['name_trigram_high', 'club_anywhere'],
    conflicts: [],
    alternatives: [],
    ...overrides,
  };
}

describe('report kind detection', () => {
  it('discriminates on the payload, not the filename', () => {
    expect(detectReportKind({ cases: [] })).toBe('backtest');
    expect(detectReportKind({ proposals: [] })).toBe('queue');
    expect(() => detectReportKind({ rows: [] })).toThrow(/Not a matching report/);
  });
});

describe('logical source type of a queue row', () => {
  it('recovers the class from the resolution key the v1 baseline already carries', () => {
    expect(sourceTypeOfEntityKey('draft_person:412')).toBe('draft_person');
    expect(sourceTypeOfEntityKey('award_winners:33')).toBe('award_winners');
    expect(queueRowViews({ proposals: [proposal({ entity: 'hall_of_fame:7' })] })[0].sourceType)
      .toBe('hall_of_fame');
  });
});

describe('band migration', () => {
  it('counts unchanged, upward and downward moves row by row', () => {
    const baseline = backtest([
      caseRow({ key: 'award_winners:1', band: 'very_high', score: 97 }),
      caseRow({ key: 'award_winners:2', band: 'high', score: 79, bulkEligible: false }),
      caseRow({ key: 'award_winners:3', band: 'very_high', score: 90, bulkEligible: false }),
    ]);
    const candidate = backtest([
      caseRow({ key: 'award_winners:1', band: 'very_high', score: 97 }),
      caseRow({ key: 'award_winners:2', band: 'very_high', score: 97, bulkEligible: false }),
      caseRow({ key: 'award_winners:3', band: 'medium', score: 60, bulkEligible: false }),
    ]);

    const cmp = compareBacktests(baseline, candidate);

    expect(cmp.bandMigration.unchanged).toBe(1);
    expect(cmp.bandMigration.movedUp).toBe(1);
    expect(cmp.bandMigration.movedDown).toBe(1);
    expect(cmp.bandMigration.matrix.high.very_high).toBe(1);
    expect(cmp.bandMigration.matrix.very_high.medium).toBe(1);
    expect(cmp.bandMigration.matrix.very_high.very_high).toBe(1);
    expect(cmp.rowChanges.bandChanged.map((c) => [c.key, c.from, c.to, c.direction])).toEqual([
      ['award_winners:2', 'high', 'very_high', 'up'],
      ['award_winners:3', 'very_high', 'medium', 'down'],
    ]);
  });

  it('reports rows present in only one run instead of dropping them', () => {
    const cmp = compareBacktests(
      backtest([caseRow({ key: 'award_winners:1' }), caseRow({ key: 'award_winners:2' })]),
      backtest([caseRow({ key: 'award_winners:2' }), caseRow({ key: 'award_winners:3' })]),
    );

    expect(cmp.bandMigration.removedRows).toBe(1);
    expect(cmp.bandMigration.addedRows).toBe(1);
    expect(cmp.bandMigration.matrix.very_high.absent).toBe(1);
    expect(cmp.bandMigration.matrix.absent.very_high).toBe(1);
    expect(cmp.rowChanges.removedRows.map((r) => r.key)).toEqual(['award_winners:1']);
    expect(cmp.rowChanges.addedRows.map((r) => r.key)).toEqual(['award_winners:3']);
  });
});

describe('decision changes', () => {
  it('reports a changed top-1 with correctness on both sides', () => {
    const cmp = compareBacktests(
      backtest([
        caseRow({ key: 'award_winners:1', chosenPlayerId: 11, chosenName: 'Frank Johnson (1)', correct: false, rank: 2 }),
      ]),
      backtest([
        caseRow({ key: 'award_winners:1', chosenPlayerId: 10, chosenName: 'Frank Johnson (2)', correct: true, rank: 1 }),
      ]),
    );

    expect(cmp.rowChanges.top1Changed).toHaveLength(1);
    const change = cmp.rowChanges.top1Changed[0];
    expect(change.from.playerId).toBe(11);
    expect(change.to.playerId).toBe(10);
    expect(change.baselineCorrect).toBe(false);
    expect(change.candidateCorrect).toBe(true);
    expect(cmp.rowChanges.expectedRankChanged).toEqual([
      expect.objectContaining({ key: 'award_winners:1', expectedPlayerId: 10, from: 2, to: 1 }),
    ]);
  });

  it('reports ambiguity gained and lost separately', () => {
    const cmp = compareBacktests(
      backtest([
        caseRow({ key: 'award_winners:1', ambiguous: true }),
        caseRow({ key: 'award_winners:2', ambiguous: false }),
        caseRow({ key: 'award_winners:3', ambiguous: true }),
      ]),
      backtest([
        caseRow({ key: 'award_winners:1', ambiguous: false }),
        caseRow({ key: 'award_winners:2', ambiguous: true }),
        caseRow({ key: 'award_winners:3', ambiguous: true }),
      ]),
    );

    expect(cmp.rowChanges.ceasedAmbiguous.map((r) => r.key)).toEqual(['award_winners:1']);
    expect(cmp.rowChanges.becameAmbiguous.map((r) => r.key)).toEqual(['award_winners:2']);
    expect(cmp.overall.delta.ambiguous).toBe(0);
  });

  it('separates newly bulk-eligible rows from rows that lost eligibility', () => {
    const cmp = compareBacktests(
      backtest([
        caseRow({ key: 'award_winners:1', bulkEligible: false }),
        caseRow({ key: 'award_winners:2', bulkEligible: true }),
      ]),
      backtest([
        caseRow({ key: 'award_winners:1', bulkEligible: true }),
        caseRow({ key: 'award_winners:2', bulkEligible: false }),
      ]),
    );

    expect(cmp.rowChanges.becameBulkEligible.map((r) => r.key)).toEqual(['award_winners:1']);
    expect(cmp.rowChanges.ceasedBulkEligible.map((r) => r.key)).toEqual(['award_winners:2']);
    expect(cmp.overall.delta.bulkEligible).toBe(0);
  });

  it('classifies gap movement and treats an alone-transition as material', () => {
    const cmp = compareBacktests(
      backtest([
        caseRow({ key: 'award_winners:1', gap: 10 }),
        caseRow({ key: 'award_winners:2', gap: 10 }),
        caseRow({ key: 'award_winners:3', gap: null }),
      ]),
      backtest([
        caseRow({ key: 'award_winners:1', gap: 10 + MATERIAL_GAP_DELTA }),
        caseRow({ key: 'award_winners:2', gap: 11 }),
        caseRow({ key: 'award_winners:3', gap: 4 }),
      ]),
    );

    expect(cmp.rowChanges.gapChanged.map((g) => [g.key, g.delta, g.material])).toEqual([
      ['award_winners:1', MATERIAL_GAP_DELTA, true],
      ['award_winners:2', 1, false],
      ['award_winners:3', null, true],
    ]);
    expect(cmp.rowChanges.materialGapChanges).toBe(2);
  });

  it('reports a move between exact-name and trigram-name evidence', () => {
    const cmp = compareBacktests(
      backtest([
        caseRow({ key: 'draft_person:1', signals: ['name_trigram_high', 'club_anywhere'] }),
      ]),
      backtest([
        caseRow({ key: 'draft_person:1', signals: ['name_exact', 'club_anywhere'] }),
      ]),
    );

    expect(cmp.rowChanges.nameEvidenceChanged).toEqual([
      expect.objectContaining({ from: 'name_trigram_high', to: 'name_exact' }),
    ]);
  });
});

describe('per-source aggregation', () => {
  it('reports population, accuracy and bulk per logical source type', () => {
    const baseline = backtest([
      caseRow({ key: 'award_winners:1', sourceType: 'award_winners' }),
      caseRow({ key: 'award_winners:2', sourceType: 'award_winners', correct: false, rank: 3, band: 'very_high', bulkEligible: true }),
      caseRow({ key: 'draft_person:1', sourceType: 'draft_person', band: 'high', score: 79, bulkEligible: false }),
    ]);
    const candidate = backtest([
      caseRow({ key: 'award_winners:1', sourceType: 'award_winners' }),
      caseRow({ key: 'award_winners:2', sourceType: 'award_winners', correct: false, rank: 3, band: 'very_high', bulkEligible: false }),
      caseRow({ key: 'draft_person:1', sourceType: 'draft_person', band: 'very_high', score: 97, bulkEligible: false }),
    ]);

    const cmp = compareBacktests(baseline, candidate);

    expect(cmp.perSource.map((s) => s.sourceType)).toEqual(['award_winners', 'draft_person']);
    const awards = cmp.perSource[0];
    expect(awards.baseline.population).toBe(2);
    expect(awards.baseline.bulkEligible).toBe(2);
    expect(awards.baseline.bulkFalsePositives).toBe(1);
    expect(awards.candidate.bulkEligible).toBe(1);
    expect(awards.candidate.bulkFalsePositives).toBe(0);
    expect(awards.delta.bulkFalsePositives).toBe(-1);
    expect(awards.baseline.veryHighFalsePositives).toBe(1);

    const draft = cmp.perSource[1];
    expect(draft.baseline.veryHigh).toBe(0);
    expect(draft.candidate.veryHigh).toBe(1);
    expect(draft.delta.veryHigh).toBe(1);
  });

  it('leaves precision unmeasurable rather than assumed when there is no ground truth', () => {
    const metrics = computeMetrics(
      queueRowViews({ proposals: [proposal({ entity: 'award_winners:1', bulkEligible: true })] }),
    );
    expect(metrics.population).toBe(1);
    expect(metrics.bulkEligible).toBe(1);
    expect(metrics.recall).toBeNull();
    expect(metrics.top1).toBeNull();
    expect(metrics.bulkCorrect).toBeNull();
    expect(metrics.bulkFalsePositives).toBeNull();
  });
});

describe('queue comparison', () => {
  const baseline: QueueReport = {
    proposals: [
      proposal({ entity: 'draft_person:1', band: 'high', score: 79 }),
      proposal({ entity: 'award_winners:9', band: 'medium', score: 64, ambiguous: true }),
    ],
  };
  const candidate: QueueReport = {
    algorithmVersion: 'v2',
    gitCommit: 'abc1234',
    startedAt: '2026-09-13T00:00:00.000Z',
    tableFilter: null,
    proposals: [
      proposal({
        entity: 'draft_person:1',
        band: 'very_high',
        score: 97,
        signals: ['name_exact', 'club_anywhere'],
      }),
      proposal({ entity: 'award_winners:9', band: 'high', score: 82, ambiguous: false }),
    ],
  };

  it('compares band counts, migration and flags without ground truth', () => {
    const cmp = compareQueues(baseline, candidate);

    expect(cmp.meta.kind).toBe('queue');
    expect(cmp.overall.baseline.population).toBe(2);
    expect(cmp.overall.delta.band_very_high).toBe(1);
    expect(cmp.overall.delta.band_high).toBe(0);
    expect(cmp.overall.delta.band_medium).toBe(-1);
    expect(cmp.bandMigration.movedUp).toBe(2);
    expect(cmp.rowChanges.ceasedAmbiguous.map((r) => r.key)).toEqual(['award_winners:9']);
    expect(cmp.rowChanges.nameEvidenceChanged.map((r) => r.key)).toEqual(['draft_person:1']);
  });

  it('marks metadata the frozen v1 queue baseline cannot supply as unknown', () => {
    const cmp = compareQueues(baseline, candidate);

    expect(cmp.meta.baseline.algorithmVersion).toBeNull();
    expect(cmp.meta.baseline.missingFields).toEqual([
      'algorithmVersion',
      'gitCommit',
      'startedAt',
      'tableFilter',
    ]);
    expect(cmp.meta.candidate.missingFields).toEqual([]);
    expect(formatComparison(cmp)).toContain('unknown (not recorded)');
  });
});

describe('draft bulk stop condition (D-9)', () => {
  it('flags any bulk-eligible draft row in the candidate run', () => {
    const cmp = compareQueues(
      { proposals: [proposal({ entity: 'draft_person:1', bulkEligible: false })] },
      {
        proposals: [
          proposal({ entity: 'draft_person:1', band: 'very_high', score: 97, bulkEligible: true }),
        ],
      },
    );

    expect(cmp.draftBulk.triggered).toBe(true);
    expect(cmp.draftBulk.count).toBe(1);
    expect(cmp.draftBulk.rows[0].key).toBe('draft_person:1');
    expect(formatComparison(cmp)).toContain('*** STOP CONDITION');
  });

  it('covers draft_picks as well as draft_person', () => {
    const cmp = compareQueues(
      { proposals: [proposal({ entity: 'draft_picks:5', bulkEligible: false })] },
      { proposals: [proposal({ entity: 'draft_picks:5', bulkEligible: true })] },
    );
    expect(cmp.draftBulk.triggered).toBe(true);
  });

  it('passes when no draft row is bulk-eligible', () => {
    const cmp = compareQueues(
      { proposals: [proposal({ entity: 'draft_person:1', bulkEligible: false })] },
      {
        proposals: [
          proposal({ entity: 'draft_person:1', band: 'very_high', score: 97, bulkEligible: false }),
          proposal({ entity: 'award_winners:9', bulkEligible: true }),
        ],
      },
    );

    expect(cmp.draftBulk.triggered).toBe(false);
    expect(cmp.draftBulk.count).toBe(0);
    expect(formatComparison(cmp)).toContain('no bulk-eligible draft_person / draft_picks row');
  });
});

describe('determinism', () => {
  it('orders every emitted list by resolution key regardless of input order', () => {
    const keys = ['award_winners:30', 'award_winners:4', 'draft_person:2', 'award_winners:100'];
    const forwards = compareBacktests(
      backtest(keys.map((key) => caseRow({ key, band: 'high', bulkEligible: false }))),
      backtest(keys.map((key) => caseRow({ key, band: 'very_high', bulkEligible: true }))),
    );
    const backwards = compareBacktests(
      backtest([...keys].reverse().map((key) => caseRow({ key, band: 'high', bulkEligible: false }))),
      backtest([...keys].reverse().map((key) => caseRow({ key, band: 'very_high', bulkEligible: true }))),
    );

    const expected = ['award_winners:100', 'award_winners:30', 'award_winners:4', 'draft_person:2'];
    expect(forwards.rowChanges.bandChanged.map((r) => r.key)).toEqual(expected);
    expect(forwards.rowChanges.becameBulkEligible.map((r) => r.key)).toEqual(expected);
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
    expect(formatComparison(backwards)).toBe(formatComparison(forwards));
  });
});

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-164 P1c — frozen label sets
// ---------------------------------------------------------------------------

const DG = 'https://www.draftguru.com.au/players';

function labelFile(labels: unknown[]): unknown {
  return {
    schema_version: 1,
    source_key: 'draftguru',
    label_set: 'draft-bridge-test',
    labels,
  };
}

function linked(slug: string, path: string, provenance = 'draftguru_person_page_afltables_bridge') {
  return {
    player_url: `${DG}/${slug}/1`,
    expect: 'linked',
    afltables_external_id: path,
    provenance,
  };
}

describe('label set parsing', () => {
  it('reads a well-formed set and orders it by the durable key', () => {
    const set = parseLabelSet(labelFile([
      linked('nathan_fyfe', 'players/N/Nat_Fyfe.html'),
      { player_url: `${DG}/aaron_bruce/1`, expect: 'unlinked', provenance: 'human_link_decision' },
    ]));

    expect(set.labels.map((l) => l.playerUrl)).toEqual([
      `${DG}/aaron_bruce/1`,
      `${DG}/nathan_fyfe/1`,
    ]);
    expect(set.labels[0].expect).toBe('unlinked');
    expect(set.labels[0].afltablesExternalId).toBeNull();
    expect(set.labels[1].afltablesExternalId).toBe('players/N/Nat_Fyfe.html');
  });

  it('refuses a label whose truth came from the matcher under test', () => {
    expect(() => parseLabelSet(labelFile([
      linked('nathan_fyfe', 'players/N/Nat_Fyfe.html', 'scorer_top1'),
    ]))).toThrow(/derived from the matcher under test/);
  });

  it('refuses a surrogate or otherwise non-canonical key', () => {
    expect(() => parseLabelSet(labelFile([
      { player_url: '4163', expect: 'unlinked', provenance: 'manual_review' },
    ]))).toThrow(/canonical DraftGuru player_url/);
  });

  it('names both sides of a contradictory label rather than choosing one', () => {
    expect(() => parseLabelSet(labelFile([
      linked('sam_chapman', 'players/S/Sam_Chapman.html'),
      { player_url: `${DG}/sam_chapman/1`, expect: 'unlinked', provenance: 'manual_review' },
    ]))).toThrow(/contradictory labels/);
  });

  it('treats one AFLDB player claimed by two people as a finding, not a merge', () => {
    expect(() => parseLabelSet(labelFile([
      linked('brad_miller', 'players/B/Brad_Miller.html'),
      linked('bradley_miller', 'players/B/Brad_Miller.html'),
    ]))).toThrow(/never an instruction to merge/);
  });

  it('requires a target on a linked label and forbids one on an unlinked label', () => {
    expect(() => parseLabelSet(labelFile([
      { player_url: `${DG}/nathan_fyfe/1`, expect: 'linked', provenance: 'manual_review' },
    ]))).toThrow(/needs a canonical AFL Tables path/);
    expect(() => parseLabelSet(labelFile([
      {
        player_url: `${DG}/aaron_bruce/1`,
        expect: 'unlinked',
        afltables_external_id: 'players/A/Aaron_Bruce.html',
        provenance: 'manual_review',
      },
    ]))).toThrow(/must not name a target/);
  });
});

describe('label set leakage assessment', () => {
  it('reports the bridge as sharing no scored evidence family', () => {
    const set = parseLabelSet(labelFile([linked('nathan_fyfe', 'players/N/Nat_Fyfe.html')]));
    const [assessment] = assessLeakage(set);
    expect(assessment.provenance).toBe('draftguru_person_page_afltables_bridge');
    expect(assessment.sharedEvidenceFamilies).toEqual([]);
    expect(assessment.admissible).toBe(true);
  });

  it('records that manual review reuses the families the scorer scores', () => {
    const set = parseLabelSet(labelFile([
      linked('nathan_fyfe', 'players/N/Nat_Fyfe.html', 'manual_review'),
    ]));
    const [assessment] = assessLeakage(set);
    expect(assessment.sharedEvidenceFamilies).toContain('name');
    expect(assessment.sharedEvidenceFamilies).toContain('draft_stats');
  });

  it('refuses to vouch for a provenance it does not recognise', () => {
    const set = parseLabelSet(labelFile([
      linked('nathan_fyfe', 'players/N/Nat_Fyfe.html', 'someones_spreadsheet'),
    ]));
    const [assessment] = assessLeakage(set);
    expect(assessment.admissible).toBe(false);
    expect(assessment.sharedEvidenceFamilies).toEqual(['unknown']);
  });
});

describe('sample-size arithmetic', () => {
  it('reproduces the §9.1 bound for the weakest already-admitted class', () => {
    // 253 player_achievements bulk rows, 0 FP. The runbook quotes the rule-of-three
    // approximation 3/n = 1.186%; the exact bound is 1.177%. Neither is 0.1%.
    expect(zeroFailureUpperBound(253)! * 100).toBeCloseTo(1.177, 3);
    expect((3 / 253) * 100).toBeCloseTo(1.186, 3);
  });

  it('shows that 253 zero-failure rows do NOT prove 99.9% precision', () => {
    expect(zeroFailureUpperBound(253)!).toBeGreaterThan(0.001);
    expect(requiredZeroFailureSample(0.001)).toBe(2995);
  });

  it('separates an observed rate from a confidence bound', () => {
    // With one error, 99.9% is not even expressible below 1,000 rows.
    expect(smallestSampleExpressing(0.999)).toBe(1000);
  });

  // The P1c Tier 1 run measured zero bulk-eligible draft rows because D-9
  // suspends the class, not because a false positive was seen. The report
  // wording must not confuse an empty population with an observed failure.
  it('reports an empty bulk population as having no sample, not a failure', () => {
    const text = describeZeroFailureBound(0, 0);
    expect(text).toBe('n/a (no bulk-eligible labelled rows in this population)');
    expect(text).not.toContain('failure was observed');
  });

  it('reports an observed failure as disqualifying the zero-failure rule', () => {
    expect(describeZeroFailureBound(300, 1)).toBe(
      'n/a (1 false positive observed, so the zero-failure rule does not apply)',
    );
    expect(describeZeroFailureBound(300, 2)).toContain('2 false positives observed');
  });

  it('computes the bound only when the population is non-empty and clean', () => {
    expect(describeZeroFailureBound(253, 0)).toBe('1.177%');
  });
});
