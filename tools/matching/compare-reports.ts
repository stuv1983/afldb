/**
 * Baseline-versus-candidate comparison for player-link matching reports
 * (AFLDB-ISSUE-164 P1).
 *
 * P1b has to prove what a normalisation-only change did, which means
 * answering row-level questions -- which rows moved band, which changed
 * their top-1 player, which became bulk-eligible -- not merely watching
 * two aggregate tables side by side. A migration matrix synthesised from
 * band counts would be a fiction: equal counts can hide an arbitrary
 * number of offsetting moves. So every comparison here joins the two
 * reports on the stable resolution key and derives the aggregates from
 * the joined rows.
 *
 * Pure and DB-free on purpose: it reads two saved JSON reports, mutates
 * neither, and is therefore unit-testable without a database. Nothing here
 * imports the application's db client, so `npm run match:compare` runs with
 * no DSN and no environment at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfidenceBand } from '@/lib/player-matching/types';

export const BANDS: ConfidenceBand[] = ['very_high', 'high', 'medium', 'low', 'none'];

/** Band as an ordinal, so "moved up" and "moved down" are computable. */
const BAND_ORDINAL: Record<ConfidenceBand, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

/**
 * A gap change worth reporting as material. 5 is not arbitrary: it is the
 * near-tie window in MATCH_POLICY (alternatives within 5 points make a row
 * ambiguous), so a gap move of 5 or more is the smallest change that can
 * cross the policy's own notion of "too close to call".
 */
export const MATERIAL_GAP_DELTA = 5;

/** Name-family signals, in the order the scorer tries them. */
const NAME_SIGNALS = [
  'name_exact',
  'name_alias_exact',
  'name_trigram_high',
  'name_surname_initial',
  'name_trigram_medium',
];

/** The logical source classes whose bulk approval D-9 suspends. */
export const DRAFT_SOURCE_TYPES = ['draft_person', 'draft_picks'];

// ---------------------------------------------------------------------------
// Report shapes, declared structurally so a saved v1 file parses unchanged
// ---------------------------------------------------------------------------

export type BacktestCase = {
  key: string;
  sourceType: string;
  targetTable: string;
  targetId: number;
  rawName: string;
  context: string;
  expectedPlayerId: number;
  chosenPlayerId: number | null;
  chosenName: string | null;
  correct: boolean;
  rank: number | null;
  candidateCount: number;
  score: number | null;
  gap: number | null;
  band: ConfidenceBand;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  conflictReasons: string[];
  signals: string[];
};

export type QueueProposal = {
  target: string;
  entity: string;
  sourceName: string;
  context: string;
  band: ConfidenceBand;
  bulkEligible: boolean;
  ambiguous: boolean;
  hardConflict: boolean;
  gap: number | null;
  score: number | null;
  suggested: string | null;
  suggestedId: number | null;
  signals: string[];
  conflicts: string[];
  alternatives: string[];
};

/** Fields every report carries after the P1 instrumentation. */
export type ReportMeta = {
  algorithmVersion?: string | null;
  gitCommit?: string | null;
  startedAt?: string | null;
  tableFilter?: string | null;
  /**
   * The S3/S4 club-text weights the run actually scored with
   * (AFLDB-ISSUE-164 P3B). Optional because every report written before
   * the grid predates it; absent reads as unknown rather than as
   * shipped, since a comparison must never assert a policy it cannot
   * see.
   */
  calibration?: {
    clubTextInSpan: number | null;
    clubTextAnywhere: number | null;
    source: 'shipped' | 'calibration-override';
  } | null;
};

export type BacktestReport = ReportMeta & { cases: BacktestCase[] };
export type QueueReport = ReportMeta & { proposals: QueueProposal[] };

export type ReportKind = 'backtest' | 'queue';

/**
 * Which report this is, from its payload rather than its filename.
 * `queue-v1-baseline.json` predates the metadata block, so the arrays are
 * the only reliable discriminator.
 */
export function detectReportKind(payload: unknown): ReportKind {
  const record = payload as Record<string, unknown> | null;
  if (record && Array.isArray(record.cases)) return 'backtest';
  if (record && Array.isArray(record.proposals)) return 'queue';
  throw new Error(
    'Not a matching report: expected a top-level "cases" (backtest) or "proposals" (queue) array.',
  );
}

// ---------------------------------------------------------------------------
// The common row view both report kinds reduce to
// ---------------------------------------------------------------------------

export type RowView = {
  /** Stable resolution key: the join column between the two reports. */
  key: string;
  sourceType: string;
  label: string;
  context: string;
  band: ConfidenceBand;
  score: number | null;
  gap: number | null;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  topPlayerId: number | null;
  topPlayerName: string | null;
  /** Which name-family signal paid, or 'none'. */
  nameEvidence: string;
  /** Ground truth, present for backtest reports only. */
  expectedPlayerId: number | null;
  rank: number | null;
  correct: boolean | null;
};

function nameEvidenceOf(signals: string[]): string {
  for (const signal of NAME_SIGNALS) {
    if (signals.includes(signal)) return signal;
  }
  return 'none';
}

/**
 * The logical source type behind a queue row. Queue proposals do not carry
 * one, but `entity` is a resolutionKey ("draft_person:412"), and the entity
 * type never contains a colon -- so the class is recoverable from the
 * frozen v1 file without re-running anything.
 */
export function sourceTypeOfEntityKey(entity: string): string {
  const colon = entity.indexOf(':');
  return colon > 0 ? entity.slice(0, colon) : entity;
}

export function backtestRowViews(report: BacktestReport): RowView[] {
  return report.cases.map((c) => ({
    key: c.key,
    sourceType: c.sourceType,
    label: c.rawName,
    context: c.context,
    band: c.band,
    score: c.score,
    gap: c.gap,
    ambiguous: c.ambiguous,
    hardConflict: c.hardConflict,
    bulkEligible: c.bulkEligible,
    topPlayerId: c.chosenPlayerId,
    topPlayerName: c.chosenName,
    nameEvidence: nameEvidenceOf(c.signals ?? []),
    expectedPlayerId: c.expectedPlayerId,
    rank: c.rank,
    correct: c.correct,
  }));
}

export function queueRowViews(report: QueueReport): RowView[] {
  return report.proposals.map((p) => ({
    key: p.entity,
    sourceType: sourceTypeOfEntityKey(p.entity),
    label: p.sourceName,
    context: p.context,
    band: p.band,
    score: p.score,
    gap: p.gap,
    ambiguous: p.ambiguous,
    hardConflict: p.hardConflict,
    bulkEligible: p.bulkEligible,
    topPlayerId: p.suggestedId,
    topPlayerName: p.suggested,
    nameEvidence: nameEvidenceOf(p.signals ?? []),
    expectedPlayerId: null,
    rank: null,
    correct: null,
  }));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type Metrics = {
  population: number;
  /** Null for queue reports: there is no ground truth to recall. */
  recall: number | null;
  top1: number | null;
  top3: number | null;
  top5: number | null;
  bands: Record<ConfidenceBand, number>;
  veryHigh: number;
  veryHighCorrect: number | null;
  veryHighFalsePositives: number | null;
  bulkEligible: number;
  bulkCorrect: number | null;
  bulkFalsePositives: number | null;
  ambiguous: number;
  hardConflict: number;
};

export function computeMetrics(rows: RowView[]): Metrics {
  const labelled = rows.some((r) => r.correct !== null);
  const countIf = (test: (r: RowView) => boolean) => rows.filter(test).length;
  const topN = (n: number) => countIf((r) => r.rank !== null && r.rank <= n);

  const bands = {} as Record<ConfidenceBand, number>;
  for (const band of BANDS) bands[band] = countIf((r) => r.band === band);

  const veryHigh = rows.filter((r) => r.band === 'very_high');
  const bulk = rows.filter((r) => r.bulkEligible);

  return {
    population: rows.length,
    recall: labelled ? countIf((r) => r.rank !== null) : null,
    top1: labelled ? topN(1) : null,
    top3: labelled ? topN(3) : null,
    top5: labelled ? topN(5) : null,
    bands,
    veryHigh: veryHigh.length,
    veryHighCorrect: labelled ? veryHigh.filter((r) => r.correct).length : null,
    veryHighFalsePositives: labelled ? veryHigh.filter((r) => r.correct === false).length : null,
    bulkEligible: bulk.length,
    bulkCorrect: labelled ? bulk.filter((r) => r.correct).length : null,
    bulkFalsePositives: labelled ? bulk.filter((r) => r.correct === false).length : null,
    ambiguous: countIf((r) => r.ambiguous),
    hardConflict: countIf((r) => r.hardConflict),
  };
}

export type MetricsTriple = {
  baseline: Metrics;
  candidate: Metrics;
  delta: Record<string, number | null>;
};

function deltaOf(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

function diffMetrics(baseline: Metrics, candidate: Metrics): MetricsTriple {
  const delta: Record<string, number | null> = {
    population: candidate.population - baseline.population,
    recall: deltaOf(baseline.recall, candidate.recall),
    top1: deltaOf(baseline.top1, candidate.top1),
    top3: deltaOf(baseline.top3, candidate.top3),
    top5: deltaOf(baseline.top5, candidate.top5),
    veryHigh: candidate.veryHigh - baseline.veryHigh,
    veryHighCorrect: deltaOf(baseline.veryHighCorrect, candidate.veryHighCorrect),
    veryHighFalsePositives: deltaOf(
      baseline.veryHighFalsePositives,
      candidate.veryHighFalsePositives,
    ),
    bulkEligible: candidate.bulkEligible - baseline.bulkEligible,
    bulkCorrect: deltaOf(baseline.bulkCorrect, candidate.bulkCorrect),
    bulkFalsePositives: deltaOf(baseline.bulkFalsePositives, candidate.bulkFalsePositives),
    ambiguous: candidate.ambiguous - baseline.ambiguous,
    hardConflict: candidate.hardConflict - baseline.hardConflict,
  };
  for (const band of BANDS) delta[`band_${band}`] = candidate.bands[band] - baseline.bands[band];
  return { baseline, candidate, delta };
}

// ---------------------------------------------------------------------------
// Band migration
// ---------------------------------------------------------------------------

/** 'absent' is a real outcome: a row can exist in only one of the two runs. */
export type MigrationBand = ConfidenceBand | 'absent';

export const MIGRATION_BANDS: MigrationBand[] = [...BANDS, 'absent'];

export type BandMigration = {
  /** matrix[from][to] = row count. Keys are inserted in MIGRATION_BANDS order. */
  matrix: Record<MigrationBand, Record<MigrationBand, number>>;
  unchanged: number;
  movedUp: number;
  movedDown: number;
  addedRows: number;
  removedRows: number;
};

function emptyMatrix(): Record<MigrationBand, Record<MigrationBand, number>> {
  const matrix = {} as Record<MigrationBand, Record<MigrationBand, number>>;
  for (const from of MIGRATION_BANDS) {
    const row = {} as Record<MigrationBand, number>;
    for (const to of MIGRATION_BANDS) row[to] = 0;
    matrix[from] = row;
  }
  return matrix;
}

// ---------------------------------------------------------------------------
// Row-level changes
// ---------------------------------------------------------------------------

export type RowRef = {
  key: string;
  sourceType: string;
  label: string;
  context: string;
};

export type Top1Change = RowRef & {
  from: { playerId: number | null; playerName: string | null; score: number | null; band: ConfidenceBand };
  to: { playerId: number | null; playerName: string | null; score: number | null; band: ConfidenceBand };
  /** Null for queue rows, which have no ground truth. */
  baselineCorrect: boolean | null;
  candidateCorrect: boolean | null;
};

export type RankChange = RowRef & {
  expectedPlayerId: number;
  from: number | null;
  to: number | null;
};

export type BandChange = RowRef & {
  from: ConfidenceBand;
  to: ConfidenceBand;
  direction: 'up' | 'down';
  fromScore: number | null;
  toScore: number | null;
  correct: boolean | null;
};

export type GapChange = RowRef & {
  from: number | null;
  to: number | null;
  delta: number | null;
  material: boolean;
};

export type NameEvidenceChange = RowRef & { from: string; to: string };

export type FlagChange = RowRef & { score: number | null; band: ConfidenceBand };

export type RowChanges = {
  top1Changed: Top1Change[];
  expectedRankChanged: RankChange[];
  bandChanged: BandChange[];
  becameAmbiguous: FlagChange[];
  ceasedAmbiguous: FlagChange[];
  gapChanged: GapChange[];
  materialGapChanges: number;
  becameBulkEligible: FlagChange[];
  ceasedBulkEligible: FlagChange[];
  nameEvidenceChanged: NameEvidenceChange[];
  addedRows: RowRef[];
  removedRows: RowRef[];
};

export type SourceDelta = {
  sourceType: string;
  baseline: Metrics;
  candidate: Metrics;
  delta: Record<string, number | null>;
};

export type DraftBulkFinding = {
  triggered: boolean;
  count: number;
  rows: Array<RowRef & { score: number | null; band: ConfidenceBand; topPlayerName: string | null }>;
};

export type ComparisonMeta = {
  kind: ReportKind;
  baseline: ReportMeta & { population: number; missingFields: string[] };
  candidate: ReportMeta & { population: number; missingFields: string[] };
};

export type Comparison = {
  meta: ComparisonMeta;
  overall: MetricsTriple;
  bandMigration: BandMigration;
  perSource: SourceDelta[];
  rowChanges: RowChanges;
  draftBulk: DraftBulkFinding;
};

function metaOf(report: ReportMeta, population: number) {
  const missingFields: string[] = [];
  for (const field of ['algorithmVersion', 'gitCommit', 'startedAt'] as const) {
    if (report[field] === undefined || report[field] === null) missingFields.push(field);
  }
  // tableFilter is legitimately null for a whole-population run, so absence
  // -- not a null value -- is what makes it unknown.
  if (!('tableFilter' in report)) missingFields.push('tableFilter');
  return {
    algorithmVersion: report.algorithmVersion ?? null,
    gitCommit: report.gitCommit ?? null,
    startedAt: report.startedAt ?? null,
    tableFilter: report.tableFilter ?? null,
    calibration: report.calibration ?? null,
    population,
    missingFields,
  };
}

function refOf(row: RowView): RowRef {
  return { key: row.key, sourceType: row.sourceType, label: row.label, context: row.context };
}

/** Deterministic ordering for every emitted list. */
function byKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Compare two sets of scored rows.
 *
 * The join is on `key`; a row missing from either side is reported as
 * added or removed rather than silently dropped, because a population
 * change is itself a finding (a rebuild, a filter, a link-status move).
 */
export function compareRowViews(
  baselineRows: RowView[],
  candidateRows: RowView[],
): Pick<Comparison, 'overall' | 'bandMigration' | 'perSource' | 'rowChanges' | 'draftBulk'> {
  const baselineByKey = new Map(baselineRows.map((r) => [r.key, r]));
  const candidateByKey = new Map(candidateRows.map((r) => [r.key, r]));

  const migration: BandMigration = {
    matrix: emptyMatrix(),
    unchanged: 0,
    movedUp: 0,
    movedDown: 0,
    addedRows: 0,
    removedRows: 0,
  };

  const changes: RowChanges = {
    top1Changed: [],
    expectedRankChanged: [],
    bandChanged: [],
    becameAmbiguous: [],
    ceasedAmbiguous: [],
    gapChanged: [],
    materialGapChanges: 0,
    becameBulkEligible: [],
    ceasedBulkEligible: [],
    nameEvidenceChanged: [],
    addedRows: [],
    removedRows: [],
  };

  for (const before of baselineRows) {
    const after = candidateByKey.get(before.key);
    if (!after) {
      migration.matrix[before.band].absent += 1;
      migration.removedRows += 1;
      changes.removedRows.push(refOf(before));
      continue;
    }

    migration.matrix[before.band][after.band] += 1;
    const moved = BAND_ORDINAL[after.band] - BAND_ORDINAL[before.band];
    if (moved === 0) migration.unchanged += 1;
    else if (moved > 0) migration.movedUp += 1;
    else migration.movedDown += 1;

    const ref = refOf(after);

    if (moved !== 0) {
      changes.bandChanged.push({
        ...ref,
        from: before.band,
        to: after.band,
        direction: moved > 0 ? 'up' : 'down',
        fromScore: before.score,
        toScore: after.score,
        correct: after.correct,
      });
    }

    if (before.topPlayerId !== after.topPlayerId) {
      changes.top1Changed.push({
        ...ref,
        from: {
          playerId: before.topPlayerId,
          playerName: before.topPlayerName,
          score: before.score,
          band: before.band,
        },
        to: {
          playerId: after.topPlayerId,
          playerName: after.topPlayerName,
          score: after.score,
          band: after.band,
        },
        baselineCorrect: before.correct,
        candidateCorrect: after.correct,
      });
    }

    if (
      after.expectedPlayerId !== null
      && before.expectedPlayerId !== null
      && before.rank !== after.rank
    ) {
      changes.expectedRankChanged.push({
        ...ref,
        expectedPlayerId: after.expectedPlayerId,
        from: before.rank,
        to: after.rank,
      });
    }

    if (before.ambiguous !== after.ambiguous) {
      const entry = { ...ref, score: after.score, band: after.band };
      if (after.ambiguous) changes.becameAmbiguous.push(entry);
      else changes.ceasedAmbiguous.push(entry);
    }

    if (before.gap !== after.gap) {
      const delta = before.gap === null || after.gap === null ? null : after.gap - before.gap;
      // A transition into or out of "alone" (null gap) is always material:
      // the row either gained or lost every rival it had.
      const material = delta === null || Math.abs(delta) >= MATERIAL_GAP_DELTA;
      if (material) changes.materialGapChanges += 1;
      changes.gapChanged.push({ ...ref, from: before.gap, to: after.gap, delta, material });
    }

    if (before.bulkEligible !== after.bulkEligible) {
      const entry = { ...ref, score: after.score, band: after.band };
      if (after.bulkEligible) changes.becameBulkEligible.push(entry);
      else changes.ceasedBulkEligible.push(entry);
    }

    if (before.nameEvidence !== after.nameEvidence) {
      changes.nameEvidenceChanged.push({
        ...ref,
        from: before.nameEvidence,
        to: after.nameEvidence,
      });
    }
  }

  for (const after of candidateRows) {
    if (baselineByKey.has(after.key)) continue;
    migration.matrix.absent[after.band] += 1;
    migration.addedRows += 1;
    changes.addedRows.push(refOf(after));
  }

  changes.top1Changed = byKey(changes.top1Changed);
  changes.expectedRankChanged = byKey(changes.expectedRankChanged);
  changes.bandChanged = byKey(changes.bandChanged);
  changes.becameAmbiguous = byKey(changes.becameAmbiguous);
  changes.ceasedAmbiguous = byKey(changes.ceasedAmbiguous);
  changes.gapChanged = byKey(changes.gapChanged);
  changes.becameBulkEligible = byKey(changes.becameBulkEligible);
  changes.ceasedBulkEligible = byKey(changes.ceasedBulkEligible);
  changes.nameEvidenceChanged = byKey(changes.nameEvidenceChanged);
  changes.addedRows = byKey(changes.addedRows);
  changes.removedRows = byKey(changes.removedRows);

  const sourceTypes = [
    ...new Set([...baselineRows, ...candidateRows].map((r) => r.sourceType)),
  ].sort();
  const perSource: SourceDelta[] = sourceTypes.map((sourceType) => {
    const baseline = computeMetrics(baselineRows.filter((r) => r.sourceType === sourceType));
    const candidate = computeMetrics(candidateRows.filter((r) => r.sourceType === sourceType));
    return { sourceType, ...diffMetrics(baseline, candidate) };
  });

  const draftRows = candidateRows.filter(
    (r) => DRAFT_SOURCE_TYPES.includes(r.sourceType) && r.bulkEligible,
  );
  const draftBulk: DraftBulkFinding = {
    triggered: draftRows.length > 0,
    count: draftRows.length,
    rows: byKey(
      draftRows.map((r) => ({
        ...refOf(r),
        score: r.score,
        band: r.band,
        topPlayerName: r.topPlayerName,
      })),
    ),
  };

  return {
    overall: diffMetrics(computeMetrics(baselineRows), computeMetrics(candidateRows)),
    bandMigration: migration,
    perSource,
    rowChanges: changes,
    draftBulk,
  };
}

export function compareBacktests(
  baseline: BacktestReport,
  candidate: BacktestReport,
): Comparison {
  return {
    meta: {
      kind: 'backtest',
      baseline: metaOf(baseline, baseline.cases.length),
      candidate: metaOf(candidate, candidate.cases.length),
    },
    ...compareRowViews(backtestRowViews(baseline), backtestRowViews(candidate)),
  };
}

export function compareQueues(baseline: QueueReport, candidate: QueueReport): Comparison {
  return {
    meta: {
      kind: 'queue',
      baseline: metaOf(baseline, baseline.proposals.length),
      candidate: metaOf(candidate, candidate.proposals.length),
    },
    ...compareRowViews(queueRowViews(baseline), queueRowViews(candidate)),
  };
}

// ---------------------------------------------------------------------------
// Human-readable rendering
// ---------------------------------------------------------------------------

function pct(part: number | null, whole: number): string {
  if (part === null) return 'n/a';
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function signed(value: number | null): string {
  if (value === null) return 'n/a';
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

/** S3/S4 as a report recorded them, or an honest admission that it did not. */
function describeCalibration(calibration: ReportMeta['calibration']): string {
  if (!calibration) return 'unknown (not recorded)';
  const value = (points: number | null) => (points === null ? 'null' : String(points));
  return (
    `S3=${value(calibration.clubTextInSpan)} S4=${value(calibration.clubTextAnywhere)} `
    + `[${calibration.source}]`
  );
}

function metaLine(label: string, meta: ComparisonMeta['baseline']): string[] {
  return [
    `${label} algorithm version  ${meta.algorithmVersion ?? 'unknown (not recorded)'}`,
    `${label} git commit         ${meta.gitCommit ?? 'unknown (not recorded)'}`,
    `${label} run started        ${meta.startedAt ?? 'unknown (not recorded)'}`,
    `${label} table filter       ${meta.tableFilter ?? (meta.missingFields.includes('tableFilter') ? 'unknown (not recorded)' : 'all')}`,
    `${label} club-text weights  ${describeCalibration(meta.calibration ?? null)}`,
    `${label} population         ${meta.population}`,
  ];
}

function metricRow(
  label: string,
  baseline: number | null,
  candidate: number | null,
  baselineWhole: number,
  candidateWhole: number,
): string {
  return [
    label.padEnd(26),
    `${baseline === null ? 'n/a' : baseline}`.padStart(7),
    pct(baseline, baselineWhole).padStart(9),
    '->'.padStart(4),
    `${candidate === null ? 'n/a' : candidate}`.padStart(7),
    pct(candidate, candidateWhole).padStart(9),
    signed(deltaOf(baseline, candidate)).padStart(8),
  ].join(' ');
}

/** Deterministic console rendering; the JSON output is the machine contract. */
export function formatComparison(cmp: Comparison, sampleLimit = 20): string {
  const lines: string[] = [];
  const { baseline: b, candidate: c } = cmp.overall;

  lines.push('=== RUN METADATA ===');
  lines.push(...metaLine('baseline ', cmp.meta.baseline));
  lines.push('');
  lines.push(...metaLine('candidate', cmp.meta.candidate));
  const unknown = [...new Set([
    ...cmp.meta.baseline.missingFields,
    ...cmp.meta.candidate.missingFields,
  ])].sort();
  if (unknown.length > 0) {
    lines.push('');
    lines.push(
      `NOTE: not comparable retrospectively (absent from at least one report): ${unknown.join(', ')}`,
    );
  }

  lines.push('');
  lines.push(`=== OVERALL (${cmp.meta.kind}) ===`);
  lines.push(
    ['metric'.padEnd(26), 'baseline'.padStart(7), ''.padStart(9), ''.padStart(4),
      'candidate'.padStart(7), ''.padStart(9), 'delta'.padStart(8)].join(' '),
  );
  lines.push(metricRow('candidate recall', b.recall, c.recall, b.population, c.population));
  lines.push(metricRow('top-1', b.top1, c.top1, b.population, c.population));
  lines.push(metricRow('top-3', b.top3, c.top3, b.population, c.population));
  lines.push(metricRow('top-5', b.top5, c.top5, b.population, c.population));
  lines.push(metricRow('very_high', b.veryHigh, c.veryHigh, b.population, c.population));
  lines.push(
    metricRow('very_high precision', b.veryHighCorrect, c.veryHighCorrect, b.veryHigh, c.veryHigh),
  );
  lines.push(
    metricRow(
      'very_high false pos',
      b.veryHighFalsePositives,
      c.veryHighFalsePositives,
      b.veryHigh,
      c.veryHigh,
    ),
  );
  lines.push(
    metricRow('bulk-eligible', b.bulkEligible, c.bulkEligible, b.population, c.population),
  );
  lines.push(
    metricRow('bulk precision', b.bulkCorrect, c.bulkCorrect, b.bulkEligible, c.bulkEligible),
  );
  lines.push(
    metricRow(
      'bulk false positives',
      b.bulkFalsePositives,
      c.bulkFalsePositives,
      b.bulkEligible,
      c.bulkEligible,
    ),
  );
  lines.push(metricRow('ambiguous', b.ambiguous, c.ambiguous, b.population, c.population));
  lines.push(metricRow('hard conflicts', b.hardConflict, c.hardConflict, b.population, c.population));

  lines.push('');
  lines.push('=== BAND COUNTS ===');
  for (const band of BANDS) {
    lines.push(
      `${band.padEnd(12)} ${String(b.bands[band]).padStart(7)} -> ${String(c.bands[band]).padStart(7)}  ${signed(c.bands[band] - b.bands[band]).padStart(8)}`,
    );
  }

  lines.push('');
  lines.push('=== BAND MIGRATION (rows joined on resolution key) ===');
  const header = ['from \\ to'.padEnd(12), ...MIGRATION_BANDS.map((x) => x.padStart(10))].join(' ');
  lines.push(header);
  lines.push('-'.repeat(header.length));
  for (const from of MIGRATION_BANDS) {
    lines.push(
      [
        from.padEnd(12),
        ...MIGRATION_BANDS.map((to) => String(cmp.bandMigration.matrix[from][to]).padStart(10)),
      ].join(' '),
    );
  }
  lines.push('');
  lines.push(
    `unchanged ${cmp.bandMigration.unchanged}  moved up ${cmp.bandMigration.movedUp}  `
    + `moved down ${cmp.bandMigration.movedDown}  `
    + `rows only in candidate ${cmp.bandMigration.addedRows}  `
    + `rows only in baseline ${cmp.bandMigration.removedRows}`,
  );

  lines.push('');
  lines.push('=== PER LOGICAL SOURCE TYPE ===');
  const sourceHeader = [
    'source'.padEnd(21),
    'n'.padStart(13),
    'recall'.padStart(13),
    'top1'.padStart(13),
    'vhigh'.padStart(13),
    'vh FP'.padStart(11),
    'bulk'.padStart(13),
    'bulk FP'.padStart(11),
    'conflicts'.padStart(13),
  ].join(' ');
  lines.push(sourceHeader);
  lines.push('-'.repeat(sourceHeader.length));
  const pair = (x: number | null, y: number | null, width: number) =>
    `${x === null ? 'n/a' : x}->${y === null ? 'n/a' : y}`.padStart(width);
  for (const s of cmp.perSource) {
    lines.push([
      s.sourceType.padEnd(21),
      pair(s.baseline.population, s.candidate.population, 13),
      pair(s.baseline.recall, s.candidate.recall, 13),
      pair(s.baseline.top1, s.candidate.top1, 13),
      pair(s.baseline.veryHigh, s.candidate.veryHigh, 13),
      pair(s.baseline.veryHighFalsePositives, s.candidate.veryHighFalsePositives, 11),
      pair(s.baseline.bulkEligible, s.candidate.bulkEligible, 13),
      pair(s.baseline.bulkFalsePositives, s.candidate.bulkFalsePositives, 11),
      pair(s.baseline.hardConflict, s.candidate.hardConflict, 13),
    ].join(' '));
  }
  lines.push('');
  lines.push('Very High / bulk precision per source, baseline -> candidate:');
  for (const s of cmp.perSource) {
    lines.push(
      `${s.sourceType.padEnd(21)} vh ${pct(s.baseline.veryHighCorrect, s.baseline.veryHigh).padStart(8)}`
      + ` -> ${pct(s.candidate.veryHighCorrect, s.candidate.veryHigh).padStart(8)}`
      + `   bulk ${pct(s.baseline.bulkCorrect, s.baseline.bulkEligible).padStart(8)}`
      + ` -> ${pct(s.candidate.bulkCorrect, s.candidate.bulkEligible).padStart(8)}`,
    );
  }

  const r = cmp.rowChanges;
  lines.push('');
  lines.push('=== ROW-LEVEL CHANGES ===');
  lines.push(`top-1 player changed        ${r.top1Changed.length}`);
  lines.push(`expected-player rank moved  ${r.expectedRankChanged.length}`);
  lines.push(`band changed                ${r.bandChanged.length}`);
  lines.push(`became ambiguous            ${r.becameAmbiguous.length}`);
  lines.push(`ceased being ambiguous      ${r.ceasedAmbiguous.length}`);
  lines.push(
    `gap changed                 ${r.gapChanged.length} (material, |delta| >= ${MATERIAL_GAP_DELTA} or alone-transition: ${r.materialGapChanges})`,
  );
  lines.push(`became bulk-eligible        ${r.becameBulkEligible.length}`);
  lines.push(`ceased bulk-eligible        ${r.ceasedBulkEligible.length}`);
  lines.push(`name evidence changed       ${r.nameEvidenceChanged.length}`);
  lines.push(`rows only in candidate      ${r.addedRows.length}`);
  lines.push(`rows only in baseline       ${r.removedRows.length}`);

  const sample = <T extends RowRef>(title: string, rows: T[], render: (row: T) => string) => {
    if (rows.length === 0) return;
    lines.push('');
    lines.push(`--- ${title} (${rows.length}${rows.length > sampleLimit ? `, first ${sampleLimit}` : ''}) ---`);
    for (const row of rows.slice(0, sampleLimit)) lines.push(`  ${render(row)}`);
  };

  // Every changed top-1 among labelled rows is enumerated in full: the P1b
  // gate (§13 item 2a) requires the list, not a sample.
  if (cmp.meta.kind === 'backtest') {
    if (r.top1Changed.length > 0) {
      lines.push('');
      lines.push(`--- every changed top-1 (${r.top1Changed.length}) ---`);
      for (const row of r.top1Changed) {
        lines.push(
          `  ${row.key} "${row.label}" (${row.context})`
          + `\n      ${row.from.playerName} #${row.from.playerId} ${row.from.score}/${row.from.band}`
          + ` [${row.baselineCorrect === null ? 'unlabelled' : row.baselineCorrect ? 'correct' : 'wrong'}]`
          + ` -> ${row.to.playerName} #${row.to.playerId} ${row.to.score}/${row.to.band}`
          + ` [${row.candidateCorrect === null ? 'unlabelled' : row.candidateCorrect ? 'correct' : 'wrong'}]`,
        );
      }
    }
  } else {
    sample(
      'top-1 changed',
      r.top1Changed,
      (row) =>
        `${row.key} "${row.label}" ${row.from.playerName} #${row.from.playerId} (${row.from.score})`
        + ` -> ${row.to.playerName} #${row.to.playerId} (${row.to.score})`,
    );
  }

  sample(
    'band moved down',
    r.bandChanged.filter((x) => x.direction === 'down'),
    (row) => `${row.key} "${row.label}" ${row.from} -> ${row.to} (${row.fromScore} -> ${row.toScore})`,
  );
  sample(
    'band moved up',
    r.bandChanged.filter((x) => x.direction === 'up'),
    (row) => `${row.key} "${row.label}" ${row.from} -> ${row.to} (${row.fromScore} -> ${row.toScore})`,
  );
  sample(
    'became bulk-eligible',
    r.becameBulkEligible,
    (row) => `${row.key} "${row.label}" score=${row.score} band=${row.band}`,
  );
  sample(
    'ceased bulk-eligible',
    r.ceasedBulkEligible,
    (row) => `${row.key} "${row.label}" score=${row.score} band=${row.band}`,
  );
  sample(
    'name evidence changed',
    r.nameEvidenceChanged,
    (row) => `${row.key} "${row.label}" ${row.from} -> ${row.to}`,
  );

  lines.push('');
  if (cmp.draftBulk.triggered) {
    lines.push('*** STOP CONDITION: BULK-ELIGIBLE DRAFT ROWS IN THE CANDIDATE RUN ***');
    lines.push(
      'AFLDB-ISSUE-164 D-9 suspends draft_person unattended bulk approval until P1c',
    );
    lines.push(
      're-gates the class under §9.1. Any bulk-eligible draft row is a stop condition (§14).',
    );
    lines.push(`bulk-eligible draft rows: ${cmp.draftBulk.count}`);
    for (const row of cmp.draftBulk.rows.slice(0, sampleLimit)) {
      lines.push(
        `  ${row.key} "${row.label}" -> ${row.topPlayerName} score=${row.score} band=${row.band}`,
      );
    }
    if (cmp.draftBulk.rows.length > sampleLimit) {
      lines.push(`  ... ${cmp.draftBulk.rows.length - sampleLimit} more`);
    }
  } else {
    lines.push('=== DRAFT BULK STOP CONDITION (D-9) ===');
    lines.push('no bulk-eligible draft_person / draft_picks row in the candidate run: PASS');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File-level helpers shared by the comparison CLI and the live backtest run
// ---------------------------------------------------------------------------

export function readReport(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/**
 * Render a comparison and, if asked, persist it.
 *
 * Neither input is ever written: a comparison that could overwrite the
 * frozen v1 baseline would destroy the evidence it exists to measure
 * against (AFLDB-ISSUE-164 §2.10). A met stop condition sets exit code 2,
 * which is deliberately distinguishable from a tool failure (1).
 */
export function emitComparison(
  comparison: Comparison,
  outPath: string | null,
  inputPaths: string[],
): void {
  console.log(formatComparison(comparison));
  if (outPath) {
    const target = resolve(outPath);
    for (const input of inputPaths) {
      if (resolve(input) === target) {
        throw new Error(`--compare-out would overwrite an input report: ${outPath}`);
      }
    }
    writeFileSync(target, JSON.stringify(comparison, null, 2), 'utf8');
    console.log(`\ncomparison written to ${outPath}`);
  }
  if (comparison.draftBulk.triggered) {
    console.log('\nexit code 2: AFLDB-ISSUE-164 D-9 stop condition met, not a tool failure.');
    process.exitCode = 2;
  }
}

/** Compare two saved reports of the same kind. No database is opened. */
export function runComparison(
  baselinePath: string,
  candidatePath: string,
  outPath: string | null,
): void {
  const baseline = readReport(baselinePath);
  const candidate = readReport(candidatePath);
  const baselineKind = detectReportKind(baseline);
  const candidateKind = detectReportKind(candidate);
  if (baselineKind !== candidateKind) {
    throw new Error(`Cannot compare a ${baselineKind} report with a ${candidateKind} report.`);
  }
  console.log(`baseline  ${baselinePath}`);
  console.log(`candidate ${candidatePath}`);
  const comparison = baselineKind === 'backtest'
    ? compareBacktests(baseline as BacktestReport, candidate as BacktestReport)
    : compareQueues(baseline as QueueReport, candidate as QueueReport);
  emitComparison(comparison, outPath, [baselinePath, candidatePath]);
}
