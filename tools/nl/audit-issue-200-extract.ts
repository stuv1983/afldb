#!/usr/bin/env tsx
/**
 * AFLDB-ISSUE-200 -- extracts the 1,063 remaining NL stress-corpus soft
 * findings (GRAIN_EQUIVALENT, UNEXPECTED_DECLINE, WRONG_FAILURE_REASON)
 * into one per-row audit CSV, for a human/agent clustering pass
 * (audit-issue-200-cluster.ts) to classify.
 *
 *   npx tsx tools/nl/audit-issue-200-extract.ts \
 *     --results /home/arm/nl-stress-v50-cleaned/results.jsonl \
 *     --entity-index /home/arm/nl-stress-v50-cleaned/entity-index.json \
 *     --out /home/arm/issue-200-soft-audit.csv
 *
 * DB-free and read-only: every row is re-scored with the real, unmodified
 * `scoreRow` export from tools/nl/corpus.ts (the same function the actual
 * run used), so this script's classification can never diverge from the
 * real run's. `--entity-index` is optional -- the three ISSUE-200 soft
 * classes are all decided before scoreRow's `index` parameter is ever
 * consulted (see the module comment in corpus.ts: the identity lookups it
 * powers only affect the WRONG_PLAYER/WRONG_CLUB/WRONG_OPPONENT/WRONG_VENUE
 * hard classes), but it is accepted and loaded when given for full parity
 * with how `--report-only` re-scores a run.
 *
 * FAILS CLOSED. Any of the following aborts the whole run with a non-zero
 * exit and writes nothing:
 *   - results.jsonl contains a duplicate row id;
 *   - a row carries more than one of the three target classes at once
 *     (AFLDB-ISSUE-200.md S1's mutual-exclusivity assumption broke);
 *   - the extracted per-class counts do not exactly match the parser-v50
 *     baseline (72 / 921 / 70, AFLDB-ISSUE-200.md S1);
 *   - the extracted total is not exactly 1,063.
 *
 * See AFLDB-ISSUE-200.md S3-S4 for why results.jsonl (not failures.csv) is
 * the correct source, and the full column list this script writes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from '@/lib/csv';

import {
  AUDIT_COLUMNS, EXPECTED_CLASS_COUNTS, EXPECTED_TOTAL, selectTargetFinding, str,
  TARGET_CLASSES, type AuditRow, type TargetClass,
} from './audit-issue-200-shared';
import {
  CORPUS_CLUB_SPELLINGS, scoreRow,
  type EntityIndex, type StressExpectation, type StressFinding, type StressObservation,
} from './corpus';
import { normaliseKey, option } from './engine';

// ------------------------------------------------------------------ reading

export type RunRecord = { expected: StressExpectation; actual: StressObservation };

/** Mirrors tools/nl/stress-test.ts's private readResults, applied to an arbitrary path. */
export function parseResultsJsonl(text: string): RunRecord[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunRecord);
}

/**
 * Mirrors tools/nl/stress-test.ts's private loadEntityIndex, parameterised
 * by path rather than the hardcoded OUT_DIR that function reads from --
 * duplicated here rather than exporting a path parameter onto the stress
 * harness's own function, to avoid touching that file for a read-only
 * audit tool. The lookup rules themselves (normaliseKey, CORPUS_CLUB_SPELLINGS)
 * are imported, not re-implemented.
 */
export function buildEntityIndexFromJson(json: string): EntityIndex {
  const { clubs, venues } = JSON.parse(json) as {
    clubs: Record<string, number>; venues: Record<string, number>;
  };
  return {
    clubOrgId: (name) => clubs[normaliseKey(name)]
      ?? clubs[normaliseKey(CORPUS_CLUB_SPELLINGS[name] ?? '')],
    venueId: (name) => venues[normaliseKey(name)],
  };
}

// -------------------------------------------------------------- formatting

/** The stable half of an equivalence group: mirrors stress-test.ts's private groupPrefix (same one-liner, not exported there). */
function templatePrefix(group: string): string {
  return group.split('|')[0] || '(none)';
}

function flattenConditions(conditions: readonly { column: string; op: string; value: number }[] | undefined): string {
  if (!conditions || conditions.length === 0) return '';
  return conditions.map((c) => `${c.column} ${c.op} ${c.value}`).join('; ');
}

type CareerCondition = NonNullable<StressObservation['plan']>['careerConditions'][number];

function flattenCareerConditions(conditions: readonly CareerCondition[] | undefined): string {
  if (!conditions || conditions.length === 0) return '';
  return conditions
    .map((c) => (c.kind === 'column' ? `${c.column} ${c.op} ${c.value}` : `${c.awardKey} ${c.op} ${c.value}`))
    .join('; ');
}

/**
 * The single most frequent term, by frequency computed across the whole
 * batch this function is called from (see buildAutoClusterKey's caller) --
 * ties broken alphabetically so the result is deterministic. Returns
 * undefined for an empty list.
 */
export function pickMostFrequentTerm(terms: readonly string[], frequency: ReadonlyMap<string, number>): string | undefined {
  if (terms.length === 0) return undefined;
  return [...terms].sort((a, b) => {
    const diff = (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0];
}

/**
 * Mechanical, explainable pre-bucketing key -- AFLDB-ISSUE-200.md S4b.
 * Never itself a disposition; the human/agent cluster pass in
 * audit-issue-200-cluster.ts assigns those.
 */
export function buildAutoClusterKey(
  cls: TargetClass,
  expected: StressExpectation,
  actual: StressObservation,
  template: string,
  topUnsupportedTerm: string | undefined,
): string {
  if (cls === 'GRAIN_EQUIVALENT') {
    return `${str(expected.grain) || '(none)'}->${str(actual.plan?.grain) || '(none)'}/${str(actual.plan?.mode) || '(none)'}`;
  }
  if (cls === 'WRONG_FAILURE_REASON') {
    return `${str(expected.failureReason) || '(none)'}->${str(actual.failureReason) || '(none)'}`;
  }
  const base = `${str(actual.failureReason) || '(none)'}|${template}`;
  return topUnsupportedTerm && actual.failureReason === 'unsupported_term' ? `${base}|${topUnsupportedTerm}` : base;
}

// ------------------------------------------------------------- extraction

export type ExtractSummary = {
  totalRecordsRead: number;
  includedByClass: Record<TargetClass, number>;
  includedTotal: number;
  excludedTotal: number;
};

/**
 * Pure, DB-free extraction. Throws (never partially applies) on any
 * invariant failure -- see the module header for the exact list. Exported
 * for tests/nl-issue-200-audit-extract.test.ts.
 */
export function extractAudit(records: readonly RunRecord[], index?: EntityIndex): { rows: AuditRow[]; summary: ExtractSummary } {
  const seenIds = new Set<number>();
  const duplicateIds = new Set<number>();
  for (const record of records) {
    const id = record.expected.id;
    if (seenIds.has(id)) duplicateIds.add(id); else seenIds.add(id);
  }
  if (duplicateIds.size > 0) {
    throw new Error(`results.jsonl contains duplicate row id(s): ${[...duplicateIds].sort((a, b) => a - b).join(', ')}.`);
  }

  const included: { record: RunRecord; cls: TargetClass; finding: StressFinding }[] = [];
  const multiClassIds: number[] = [];

  for (const record of records) {
    const findings = scoreRow(record.expected, record.actual, index);
    const selection = selectTargetFinding(findings);
    if (selection.kind === 'none') continue;
    if (selection.kind === 'multiple') { multiClassIds.push(record.expected.id); continue; }
    included.push({ record, cls: selection.class, finding: selection.finding });
  }

  if (multiClassIds.length > 0) {
    throw new Error(
      `Mutual-exclusivity assumption broke (AFLDB-ISSUE-200.md S1): row id(s) ${multiClassIds.join(', ')} carry `
      + `more than one of ${TARGET_CLASSES.join('/')}. Refusing to classify silently.`,
    );
  }

  const includedIds = included.map((item) => item.record.expected.id);
  if (new Set(includedIds).size !== includedIds.length) {
    throw new Error('Internal error: duplicate output row id(s) survived filtering.');
  }

  const includedByClass: Record<TargetClass, number> = { GRAIN_EQUIVALENT: 0, UNEXPECTED_DECLINE: 0, WRONG_FAILURE_REASON: 0 };
  for (const item of included) includedByClass[item.cls]++;

  for (const cls of TARGET_CLASSES) {
    if (includedByClass[cls] !== EXPECTED_CLASS_COUNTS[cls]) {
      throw new Error(`Expected exactly ${EXPECTED_CLASS_COUNTS[cls]} ${cls} rows, found ${includedByClass[cls]}.`);
    }
  }
  if (included.length !== EXPECTED_TOTAL) {
    throw new Error(`Expected exactly ${EXPECTED_TOTAL} soft rows across the three classes, found ${included.length}.`);
  }

  // Global unsupported-term frequency across UNEXPECTED_DECLINE rows, used
  // to append the "single most frequent" term to that class's cluster key
  // (AFLDB-ISSUE-200.md S4b) -- needs the whole batch, hence a second pass.
  const termFrequency = new Map<string, number>();
  for (const item of included) {
    if (item.cls !== 'UNEXPECTED_DECLINE' || item.record.actual.failureReason !== 'unsupported_term') continue;
    for (const term of item.record.actual.unsupportedTerms) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    }
  }

  const rows: AuditRow[] = included.map(({ record, cls, finding }) => {
    const { expected, actual } = record;
    const plan = actual.plan;
    const template = templatePrefix(expected.equivalenceGroup);
    const topTerm = cls === 'UNEXPECTED_DECLINE' && actual.failureReason === 'unsupported_term'
      ? pickMostFrequentTerm(actual.unsupportedTerms, termFrequency)
      : undefined;

    const row: AuditRow = {
      id: str(expected.id),
      class: cls,
      question: expected.question,
      category: expected.category,
      template,
      expected_status: expected.status,
      expected_grain: str(expected.grain),
      expected_mode: str(expected.mode),
      expected_metric: str(expected.metric),
      expected_metric_alternatives: expected.metricAlternatives?.join('|') ?? '',
      expected_aggregation: str(expected.aggregation),
      expected_top_n: str(expected.topN),
      expected_player: str(expected.player),
      expected_club: str(expected.club),
      expected_opponent: str(expected.opponent),
      expected_venue: str(expected.venue),
      expected_season_from: str(expected.seasonFrom),
      expected_season_to: str(expected.seasonTo),
      expected_match_type: str(expected.matchType),
      expected_boundary_event: str(expected.boundaryEvent),
      expected_conditions: flattenConditions(expected.conditions),
      expected_failure_reason: str(expected.failureReason),
      expected_min_confidence: str(expected.minConfidence),
      actual_status: actual.status,
      actual_failure_reason: str(actual.failureReason),
      actual_confidence: str(actual.confidence),
      actual_unsupported_terms: actual.unsupportedTerms.join(' '),
      actual_grain: str(plan?.grain),
      actual_mode: str(plan?.mode),
      actual_metric: str(plan?.metric),
      actual_aggregation: str(plan?.agg.kind),
      actual_top_n: str(plan && plan.agg.kind === 'top_n' ? plan.agg.n : undefined),
      actual_player: str(plan?.player?.name),
      actual_club_for: str(plan?.scope.clubFor?.name),
      actual_club_against: str(plan?.scope.clubAgainst?.name),
      actual_venue: str(plan?.scope.venue?.name),
      actual_season_min: str(plan?.scope.seasonMin),
      actual_season_max: str(plan?.scope.seasonMax),
      actual_match_type: str(plan?.scope.matchType),
      actual_career_conditions: flattenCareerConditions(plan?.careerConditions),
      finding_expected: finding.expected,
      finding_actual: finding.actual,
      auto_cluster_key: buildAutoClusterKey(cls, expected, actual, template, topTerm),
      cluster: '',
      provisional_disposition: '',
      notes: expected.notes,
    };
    return row;
  });

  return {
    rows,
    summary: {
      totalRecordsRead: records.length,
      includedByClass,
      includedTotal: included.length,
      excludedTotal: records.length - included.length,
    },
  };
}

// ---------------------------------------------------------------------- CLI

function main(): void {
  const resultsPath = option('results');
  const entityIndexPath = option('entity-index');
  const outPath = option('out');
  if (!resultsPath) throw new Error('--results <path> is required.');
  if (!outPath) throw new Error('--out <path> is required.');

  const records = parseResultsJsonl(readFileSync(resultsPath, 'utf8'));

  let index: EntityIndex | undefined;
  if (entityIndexPath) {
    if (!existsSync(entityIndexPath)) {
      throw new Error(`--entity-index path "${entityIndexPath}" does not exist.`);
    }
    index = buildEntityIndexFromJson(readFileSync(entityIndexPath, 'utf8'));
  }

  const { rows, summary } = extractAudit(records, index);
  writeFileSync(outPath, toCsv(AUDIT_COLUMNS, rows), 'utf8');

  process.stdout.write(`${[
    `records read:              ${summary.totalRecordsRead}`,
    `excluded (not soft-3):     ${summary.excludedTotal}`,
    `GRAIN_EQUIVALENT:          ${summary.includedByClass.GRAIN_EQUIVALENT}`,
    `UNEXPECTED_DECLINE:        ${summary.includedByClass.UNEXPECTED_DECLINE}`,
    `WRONG_FAILURE_REASON:      ${summary.includedByClass.WRONG_FAILURE_REASON}`,
    `total soft rows extracted: ${summary.includedTotal}`,
    `output path:               ${resolve(outPath)}`,
  ].join('\n')}\n`);
}

// Run only when this file is the entry point. Importing extractAudit() --
// as tests/nl-issue-200-audit-extract.test.ts does -- must not start a run.
const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
